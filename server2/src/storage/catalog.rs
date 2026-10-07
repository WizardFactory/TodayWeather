use super::catalog_model::identity_order;
use super::{
    Catalog, CatalogId, CatalogLimits, CatalogTransport, ControlObject, Envelope, Error,
    GroupDeclaration, Period, RawRecord, RawRecordStore, RecordId, SelectionPolicy, WriteCondition,
    decode_list, fold_values,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};

#[derive(Debug, Clone)]
pub struct DependencyToken {
    pub identity: CatalogId,
    pub generation: Option<u64>,
    pub etag: Option<String>,
    pub version: Option<String>,
}
#[derive(Debug, Clone)]
pub struct CompleteAcquisition {
    records: Vec<RawRecord>,
    group: Option<String>,
}
impl CompleteAcquisition {
    pub fn records(&self) -> &[RawRecord] {
        &self.records
    }
    pub fn group(&self) -> Option<&str> {
        self.group.as_deref()
    }
}
/// Constructed only after descriptor, all pinned siblings and exact raw metadata agree.
#[derive(Debug, Clone)]
pub struct CompleteSet {
    acquisitions: Vec<CompleteAcquisition>,
    dependencies: Vec<DependencyToken>,
    excluded: usize,
}
impl CompleteSet {
    pub fn acquisitions(&self) -> &[CompleteAcquisition] {
        &self.acquisitions
    }
    pub fn dependencies(&self) -> &[DependencyToken] {
        &self.dependencies
    }
    pub fn excluded_groups(&self) -> usize {
        self.excluded
    }
    /// Parse each complete acquisition's ordered pages in memory. No result is persisted.
    pub fn fold<F>(
        &self,
        policy: SelectionPolicy,
        mut parse: F,
    ) -> Result<Option<serde_json::Value>, Error>
    where
        F: FnMut(&[RawRecord]) -> Result<serde_json::Value, Error>,
    {
        let values = self
            .acquisitions
            .iter()
            .map(|a| parse(&a.records))
            .collect::<Result<Vec<_>, _>>()?;
        fold_values(&values, policy)
    }
}
#[derive(Debug, Clone)]
pub enum LookupOutcome {
    Ready(CompleteSet),
    Incomplete,
}
#[derive(Debug, Clone)]
pub struct RepairScope {
    pub catalog: CatalogId,
    pub periods: Vec<Period>,
}
#[derive(Debug, Clone)]
pub enum RepairOutcome {
    Complete(CompleteSet),
    CompleteEmpty { scope: RepairScope },
    Incomplete,
}
struct Pinned {
    catalog: Catalog,
    etag: String,
    version: Option<String>,
}
struct Context {
    controls: usize,
    output: usize,
    pins: BTreeMap<CatalogId, Option<Pinned>>,
}
impl Context {
    fn new() -> Self {
        Self {
            controls: 0,
            output: 0,
            pins: BTreeMap::new(),
        }
    }
}
pub struct CatalogStore<T> {
    transport: Arc<T>,
    raw: RawRecordStore<T>,
    limits: CatalogLimits,
    io: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
}
impl<T: CatalogTransport> CatalogStore<T> {
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        limits.validate()?;
        let transport = Arc::new(transport);
        Ok(Self {
            raw: RawRecordStore::new_shared(transport.clone(), limits.raw.clone())?,
            transport,
            io: Arc::new(Semaphore::new(limits.io)),
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            limits,
        })
    }
    fn deadline(&self, deadline: Instant) -> Instant {
        deadline.min(Instant::now() + self.limits.deadline)
    }
    async fn cpu<F, R>(&self, f: F) -> Result<R, Error>
    where
        F: FnOnce() -> Result<R, Error> + Send + 'static,
        R: Send + 'static,
    {
        let permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            f()
        })
        .await
        .map_err(|_| Error::Transport)?
    }
    async fn admit(&self) -> Result<tokio::sync::OwnedSemaphorePermit, Error> {
        self.io
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)
    }
    fn count_control(&self, c: &mut Context, n: usize) -> Result<(), Error> {
        c.controls = c
            .controls
            .checked_add(n)
            .ok_or(Error::Corrupt("control budget"))?;
        if c.controls > self.limits.retained_control_bytes {
            return Err(Error::Corrupt("control budget"));
        }
        Ok(())
    }
    async fn control(&self, key: &str, c: &mut Context) -> Result<ControlObject, Error> {
        let obj = self
            .transport
            .get_control(key, self.limits.control_bytes)
            .await?;
        self.count_control(c, obj.body.len())?;
        Ok(obj)
    }
    async fn catalog(&self, id: &CatalogId, c: &mut Context) -> Result<Option<Pinned>, Error> {
        match self.control(&id.key(), c).await {
            Ok(obj) => {
                let id = id.clone();
                let l = self.limits.clone();
                let catalog = self
                    .cpu(move || {
                        Catalog::from_bytes(&obj.body, &id, &l).map(|catalog| Pinned {
                            catalog,
                            etag: obj.etag,
                            version: obj.version,
                        })
                    })
                    .await?;
                Ok(Some(catalog))
            }
            Err(Error::NotFound) => Ok(None),
            Err(e) => Err(e),
        }
    }
    async fn pin(&self, id: &CatalogId, c: &mut Context) -> Result<(), Error> {
        if !c.pins.contains_key(id) {
            if c.pins.len() >= self.limits.partitions {
                return Err(Error::Corrupt("pinned partition bound"));
            }
            let p = self.catalog(id, c).await?;
            c.pins.insert(id.clone(), p);
        }
        Ok(())
    }
    async fn descriptor(
        &self,
        r: &super::FetchGroupRef,
        c: &mut Context,
    ) -> Result<GroupDeclaration, Error> {
        let obj = self.control(&r.descriptor_key()?, c).await?;
        let r = r.clone();
        let l = self.limits.clone();
        self.cpu(move || GroupDeclaration::from_bytes(&obj.body, &r, &l))
            .await
    }
    async fn raw_checked(&self, e: &Envelope, c: &mut Context) -> Result<RawRecord, Error> {
        c.output = c
            .output
            .checked_add(e.raw_length)
            .ok_or(Error::Corrupt("output budget"))?;
        if c.output > self.limits.output_bytes {
            return Err(Error::Corrupt("output budget"));
        }
        let record = self.raw.load(&e.identity).await?;
        if &record.envelope != e {
            return Err(Error::Corrupt("raw member envelope"));
        }
        Ok(record)
    }
    async fn envelopes(&self, d: &GroupDeclaration) -> Result<Vec<Envelope>, Error> {
        let l = self.limits.clone();
        let d = d.clone();
        self.cpu(move || d.envelopes(&l)).await
    }
    async fn group_records(
        &self,
        d: &GroupDeclaration,
        c: &mut Context,
    ) -> Result<Vec<RawRecord>, Error> {
        let envelopes = self.envelopes(d).await?;
        let mut records = Vec::new();
        for e in &envelopes {
            records.push(self.raw_checked(e, c).await?);
        }
        Ok(records)
    }
    async fn eligible(&self, d: &GroupDeclaration, c: &mut Context) -> Result<bool, Error> {
        for id in &d.partitions {
            self.pin(id, c).await?;
        }
        let l = self.limits.clone();
        let desc = d.clone();
        let envelopes = self.cpu(move || desc.envelopes(&l)).await?;
        for (m, e) in d.members.iter().zip(envelopes) {
            for id in &m.catalogs {
                let Some(Some(pin)) = c.pins.get(id) else {
                    return Ok(false);
                };
                if !pin.catalog.entries.contains(&e) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
    async fn lookup_inner(&self, id: &CatalogId, c: &mut Context) -> Result<LookupOutcome, Error> {
        self.pin(id, c).await?;
        let Some(Some(target)) = c.pins.get(id) else {
            return Ok(LookupOutcome::Incomplete);
        };
        let entries = target.catalog.entries.clone();
        let mut groups = BTreeSet::new();
        let mut acquisitions = Vec::new();
        let mut excluded = 0;
        for e in entries {
            if let Some(r) = &e.fetch_group {
                if !groups.insert(r.group_sha256.clone()) {
                    continue;
                }
                let d = match self.descriptor(r, c).await {
                    Ok(d) => d,
                    Err(Error::NotFound) => {
                        excluded += 1;
                        continue;
                    }
                    Err(err) => return Err(err),
                };
                // The target entry must itself be a declared owner; sibling-only stray entry cannot expose a group.
                let envelopes = self.envelopes(&d).await?;
                if !d
                    .members
                    .iter()
                    .zip(&envelopes)
                    .any(|(m, expected)| m.catalogs.contains(id) && expected == &e)
                {
                    return Err(Error::Corrupt("undeclared catalog group entry"));
                }
                if !self.eligible(&d, c).await? {
                    excluded += 1;
                    continue;
                }
                match self.group_records(&d, c).await {
                    Ok(records) => acquisitions.push(CompleteAcquisition {
                        records,
                        group: Some(r.group_sha256.clone()),
                    }),
                    Err(Error::NotFound) => {
                        excluded += 1;
                    }
                    Err(err) => return Err(err),
                }
            } else if e.pagination.is_none() {
                acquisitions.push(CompleteAcquisition {
                    records: vec![self.raw_checked(&e, c).await?],
                    group: None,
                });
            } else {
                excluded += 1;
            }
        }
        let acquisitions = self
            .cpu(move || {
                acquisitions.sort_by(|a, b| {
                    identity_order(&a.records[0].envelope)
                        .cmp(&identity_order(&b.records[0].envelope))
                });
                Ok(acquisitions)
            })
            .await?;
        if acquisitions.is_empty() {
            return Ok(LookupOutcome::Incomplete);
        }
        let dependencies = c
            .pins
            .iter()
            .map(|(id, p)| DependencyToken {
                identity: id.clone(),
                generation: p.as_ref().map(|p| p.catalog.generation),
                etag: p.as_ref().map(|p| p.etag.clone()),
                version: p.as_ref().and_then(|p| p.version.clone()),
            })
            .collect();
        Ok(LookupOutcome::Ready(CompleteSet {
            acquisitions,
            dependencies,
            excluded,
        }))
    }
    pub async fn lookup(&self, id: &CatalogId, deadline: Instant) -> Result<LookupOutcome, Error> {
        id.validate()?;
        timeout_at(self.deadline(deadline), async {
            let _admission = self.admit().await?;
            self.lookup_inner(id, &mut Context::new()).await
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
    fn uncertain(e: Error) -> Error {
        match e {
            Error::Invalid(_) | Error::Corrupt(_) => e,
            _ => Error::Ambiguous,
        }
    }
    async fn immutable(
        &self,
        key: &str,
        body: &[u8],
        c: &mut Context,
        started: &mut bool,
    ) -> Result<(), Error> {
        let mut unknown = false;
        for _ in 0..self.limits.cas_attempts {
            *started = true;
            let put = self
                .transport
                .put_control(key, body, &WriteCondition::Absent)
                .await;
            match put {
                Ok(200) => return Ok(()),
                Ok(412)
                | Ok(409)
                | Ok(500..=599)
                | Err(Error::Transport)
                | Err(Error::Timeout)
                | Err(Error::Ambiguous)
                | Err(Error::Capacity) => {
                    unknown = true;
                    match self.control(key, c).await {
                        Ok(found) => {
                            if found.body == body {
                                return Ok(());
                            }
                            return Err(Error::Corrupt("immutable descriptor collision"));
                        }
                        Err(Error::NotFound) => {}
                        Err(e) => return Err(Self::uncertain(e)),
                    }
                }
                Ok(s) => {
                    return Err(if unknown {
                        Error::Ambiguous
                    } else {
                        Error::Status(s)
                    });
                }
                Err(e) => return Err(if unknown { Self::uncertain(e) } else { e }),
            }
        }
        Err(Error::Ambiguous)
    }
    async fn union(
        &self,
        id: &CatalogId,
        entries: &[Envelope],
        c: &mut Context,
        started: &mut bool,
    ) -> Result<(), Error> {
        let mut unknown = false;
        for _ in 0..self.limits.cas_attempts {
            let pin = match self.catalog(id, c).await {
                Ok(p) => p,
                Err(e) => return Err(if unknown { Self::uncertain(e) } else { e }),
            };
            let base = pin
                .as_ref()
                .map(|p| p.catalog.clone())
                .unwrap_or_else(|| Catalog::empty(id.clone()));
            let input = entries.to_vec();
            let l = self.limits.clone();
            let merged = self.cpu(move || base.union(&input, &l)).await?;
            if pin.as_ref().is_some_and(|p| p.catalog == merged) {
                return Ok(());
            }
            let condition = pin
                .map(|p| WriteCondition::Match(p.etag))
                .unwrap_or(WriteCondition::Absent);
            let l = self.limits.clone();
            let bytes = self.cpu(move || merged.bytes(&l)).await?;
            *started = true;
            match self
                .transport
                .put_control(&id.key(), &bytes, &condition)
                .await
            {
                Ok(200) => return Ok(()),
                Ok(412) => {}
                Ok(409)
                | Ok(500..=599)
                | Err(Error::Transport)
                | Err(Error::Timeout)
                | Err(Error::Ambiguous)
                | Err(Error::Capacity) => unknown = true,
                Ok(s) => {
                    return Err(if unknown {
                        Error::Ambiguous
                    } else {
                        Error::Status(s)
                    });
                }
                Err(e) => return Err(if unknown { Self::uncertain(e) } else { e }),
            }
        }
        // Reconcile one final current snapshot, without another PUT.
        match self.catalog(id, c).await {
            Ok(Some(p)) if entries.iter().all(|e| p.catalog.entries.contains(e)) => Ok(()),
            Ok(_) => Err(if unknown {
                Error::Ambiguous
            } else {
                Error::Status(412)
            }),
            Err(e) => Err(if unknown { Self::uncertain(e) } else { e }),
        }
    }
    async fn publish_catalogs(
        &self,
        d: &GroupDeclaration,
        c: &mut Context,
        started: &mut bool,
    ) -> Result<(), Error> {
        let all = self.envelopes(d).await?;
        for id in &d.partitions {
            let entries = d
                .members
                .iter()
                .zip(&all)
                .filter(|(m, _)| m.catalogs.contains(id))
                .map(|(_, e)| e.clone())
                .collect::<Vec<_>>();
            self.union(id, &entries, c, started).await?;
        }
        Ok(())
    }
    pub async fn publish(
        &self,
        declaration: GroupDeclaration,
        records: Vec<RawRecord>,
        deadline: Instant,
    ) -> Result<CompleteSet, Error> {
        let mut started = false;
        let result = timeout_at(self.deadline(deadline), async {
            let _admission = self.admit().await?;
            let l = self.limits.clone();
            let d = declaration.clone();
            let (reference, body, records) = self
                .cpu(move || Ok((d.reference(&l)?, d.bytes(&l)?, d.attach(records, &l)?)))
                .await?;
            let mut context = Context::new();
            self.immutable(
                &reference.descriptor_key()?,
                &body,
                &mut context,
                &mut started,
            )
            .await?;
            for record in records {
                started = true;
                self.raw.publish(record).await?;
            }
            self.publish_catalogs(&declaration, &mut context, &mut started)
                .await?;
            context.pins.clear();
            match self
                .lookup_inner(&declaration.partitions[0], &mut context)
                .await?
            {
                LookupOutcome::Ready(set)
                    if set
                        .acquisitions
                        .iter()
                        .any(|a| a.group.as_deref() == Some(reference.group_sha256.as_str())) =>
                {
                    Ok(set)
                }
                _ => Err(Error::Ambiguous),
            }
        })
        .await;
        match result {
            Ok(r) => r,
            Err(_) => Err(if started {
                Error::Ambiguous
            } else {
                Error::Timeout
            }),
        }
    }
    fn prefix(id: &CatalogId, period: &Period) -> Result<String, Error> {
        let r = RecordId {
            source: id.source.clone(),
            kind: id.kind.clone(),
            key_sha256: id.key_sha256.clone(),
            period: period.clone(),
            fetched_at_ms: 1,
            raw_sha256: "0".repeat(64),
        };
        r.validate()?;
        let key = r.object_key()?;
        Ok(format!(
            "{}/",
            key.rsplit_once('/').ok_or(Error::Invalid("raw prefix"))?.0
        ))
    }
    fn identity(
        key: &str,
        prefix: &str,
        id: &CatalogId,
        period: &Period,
    ) -> Result<RecordId, Error> {
        let name = key
            .strip_prefix(prefix)
            .ok_or(Error::Corrupt("LIST scope"))?;
        let stem = name
            .strip_suffix(".raw.gz")
            .ok_or(Error::Corrupt("raw filename"))?;
        let (fetch, hash) = stem.split_once('-').ok_or(Error::Corrupt("raw filename"))?;
        let fetched_at_ms = fetch
            .parse::<u64>()
            .map_err(|_| Error::Corrupt("raw fetch"))?;
        let r = RecordId {
            source: id.source.clone(),
            kind: id.kind.clone(),
            key_sha256: id.key_sha256.clone(),
            period: period.clone(),
            fetched_at_ms,
            raw_sha256: hash.into(),
        };
        r.validate()?;
        if r.object_key()? != key {
            return Err(Error::Corrupt("raw canonical key"));
        }
        Ok(r)
    }
    async fn repair_inner(
        &self,
        scope: &RepairScope,
        c: &mut Context,
        started: &mut bool,
    ) -> Result<RepairOutcome, Error> {
        let mut keys = BTreeSet::new();
        let mut discovered = Vec::new();
        let mut incomplete = false;
        for period in &scope.periods {
            let prefix = Self::prefix(&scope.catalog, period)?;
            let mut token = None;
            let mut tokens = BTreeSet::new();
            let mut exhausted = false;
            for _ in 0..self.limits.list_pages {
                let bytes = self
                    .transport
                    .list_raw_document(
                        &prefix,
                        token.as_deref(),
                        self.limits.list_keys,
                        self.limits.control_bytes,
                    )
                    .await?;
                self.count_control(c, bytes.len())?;
                let maximum = self.limits.list_keys;
                let page = self.cpu(move || decode_list(&bytes, maximum)).await?;
                for key in page.keys {
                    if !keys.insert(key.clone()) {
                        return Err(Error::Corrupt("duplicate LIST key"));
                    }
                    if keys.len() > self.limits.candidates {
                        return Ok(RepairOutcome::Incomplete);
                    }
                    match Self::identity(&key, &prefix, &scope.catalog, period) {
                        Ok(identity) => match self.raw.load(&identity).await {
                            Ok(record) => {
                                c.output = c
                                    .output
                                    .checked_add(record.bytes.len())
                                    .ok_or(Error::Corrupt("repair output"))?;
                                if c.output > self.limits.output_bytes {
                                    return Ok(RepairOutcome::Incomplete);
                                }
                                discovered.push(record);
                            }
                            Err(Error::Corrupt(_))
                            | Err(Error::NotFound)
                            | Err(Error::Invalid(_)) => incomplete = true,
                            Err(e) => return Err(e),
                        },
                        Err(_) => incomplete = true,
                    }
                }
                if let Some(next) = page.next {
                    if !tokens.insert(next.clone()) {
                        return Err(Error::Corrupt("repeated LIST token"));
                    }
                    token = Some(next);
                } else {
                    exhausted = true;
                    break;
                }
            }
            if !exhausted {
                return Ok(RepairOutcome::Incomplete);
            }
        }
        if discovered.is_empty() {
            if let Some(known) = self.catalog(&scope.catalog, c).await?
                && known
                    .catalog
                    .entries
                    .iter()
                    .any(|e| scope.periods.contains(&e.identity.period))
            {
                incomplete = true;
            }
            return Ok(if incomplete {
                RepairOutcome::Incomplete
            } else {
                RepairOutcome::CompleteEmpty {
                    scope: scope.clone(),
                }
            });
        }
        let mut groups = BTreeSet::new();
        let mut singles = Vec::new();
        for record in discovered {
            if let Some(reference) = &record.envelope.fetch_group {
                if !groups.insert(reference.group_sha256.clone()) {
                    continue;
                }
                let descriptor = match self.descriptor(reference, c).await {
                    Ok(d) => d,
                    Err(Error::NotFound) | Err(Error::Corrupt(_)) | Err(Error::Invalid(_)) => {
                        incomplete = true;
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                let expected = self.envelopes(&descriptor).await?;
                if !descriptor
                    .members
                    .iter()
                    .zip(&expected)
                    .any(|(m, e)| m.catalogs.contains(&scope.catalog) && e == &record.envelope)
                {
                    incomplete = true;
                    continue;
                }
                // The same bodies were just scanned; verification is a fresh bounded read. Drop previous bodies before loading all members.
                match self.group_records(&descriptor, c).await {
                    Ok(_) => self.publish_catalogs(&descriptor, c, started).await?,
                    Err(Error::NotFound) | Err(Error::Corrupt(_)) | Err(Error::Invalid(_)) => {
                        incomplete = true
                    }
                    Err(e) => return Err(e),
                }
            } else if record.envelope.pagination.is_none() {
                singles.push(record.envelope);
            } else {
                incomplete = true;
            }
        }
        if !singles.is_empty() {
            self.union(&scope.catalog, &singles, c, started).await?;
        }
        if incomplete {
            return Ok(RepairOutcome::Incomplete);
        }
        c.pins.clear();
        match self.lookup_inner(&scope.catalog, c).await? {
            LookupOutcome::Ready(set) => Ok(RepairOutcome::Complete(set)),
            LookupOutcome::Incomplete => Ok(RepairOutcome::Incomplete),
        }
    }
    pub async fn repair(
        &self,
        scope: &RepairScope,
        deadline: Instant,
    ) -> Result<RepairOutcome, Error> {
        scope.catalog.validate()?;
        if scope.periods.is_empty() || scope.periods.len() > self.limits.partitions {
            return Err(Error::Invalid("repair scope periods"));
        }
        let mut seen = BTreeSet::new();
        for p in &scope.periods {
            let prefix = Self::prefix(&scope.catalog, p)?;
            if !seen.insert(prefix) {
                return Err(Error::Invalid("duplicate repair prefix"));
            }
        }
        let mut started = false;
        match timeout_at(self.deadline(deadline), async {
            let _admission = self.admit().await?;
            self.repair_inner(scope, &mut Context::new(), &mut started)
                .await
        })
        .await
        {
            Ok(r) => r,
            Err(_) => Err(if started {
                Error::Ambiguous
            } else {
                Error::Timeout
            }),
        }
    }
}
