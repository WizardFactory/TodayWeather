use super::catalog_model::identity_order;
use super::{
    Catalog, CatalogId, CatalogLimits, CatalogTransport, ControlObject, Envelope, Error,
    GroupDeclaration, Period, RawRecord, RawRecordStore, RecordId, SelectionPolicy, WriteCondition,
    decode_list, fold_values,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};

#[derive(Debug, Clone, PartialEq, Eq)]
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
    coverage: RevisionCoverage,
    acquisitions: Vec<CompleteAcquisition>,
    dependencies: Vec<DependencyToken>,
    excluded: usize,
}
impl CompleteSet {
    pub fn coverage(&self) -> RevisionCoverage {
        self.coverage
    }
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
        if self.coverage != RevisionCoverage::FullHistory {
            return Err(Error::Invalid("fold requires full revision coverage"));
        }
        let values = self
            .acquisitions
            .iter()
            .map(|a| parse(&a.records))
            .collect::<Result<Vec<_>, _>>()?;
        fold_values(&values, policy)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevisionCoverage {
    FullHistory,
    PublishedGroup,
    Targeted,
    Paged,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadOrder {
    EarliestFirst,
    LatestFirst,
}
/// Opaque in-memory continuation; never a provider-miss proof or persisted weather view.
#[derive(Debug, Clone)]
pub struct ReadCursor {
    catalog: CatalogId,
    target: DependencyToken,
    order: ReadOrder,
    offset: usize,
    seen: BTreeSet<String>,
    dependencies: Vec<DependencyToken>,
    ordering_sha256: String,
}
struct OrderedCandidate {
    entry: Envelope,
    representative: Envelope,
    descriptor: Option<GroupDeclaration>,
}
#[derive(Debug, Clone)]
pub struct CompletePage {
    coverage: RevisionCoverage,
    acquisitions: Vec<CompleteAcquisition>,
    dependencies: Vec<DependencyToken>,
    excluded: usize,
    next: Option<Box<ReadCursor>>,
}
impl CompletePage {
    pub fn coverage(&self) -> RevisionCoverage {
        self.coverage
    }
    pub fn acquisitions(&self) -> &[CompleteAcquisition] {
        &self.acquisitions
    }
    pub fn dependencies(&self) -> &[DependencyToken] {
        &self.dependencies
    }
    pub fn excluded_groups(&self) -> usize {
        self.excluded
    }
    pub fn next(&self) -> Option<&ReadCursor> {
        self.next.as_deref()
    }
}
#[derive(Debug, Clone)]
pub enum PageOutcome {
    Ready(CompletePage),
    Incomplete,
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
    CompleteEmpty {
        scope: RepairScope,
    },
    /// Fully scanned/indexed nonempty scope, but no whole-history serving view materialized.
    Indexed {
        scope: RepairScope,
        dependencies: Vec<DependencyToken>,
    },
    Incomplete,
}
struct Pinned {
    catalog: Catalog,
    etag: String,
    version: Option<String>,
}
struct Context {
    deadline: Instant,
    controls: usize,
    output: usize,
    pins: BTreeMap<CatalogId, Option<Pinned>>,
}
impl Context {
    fn new(deadline: Instant) -> Self {
        Self {
            deadline,
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
    shared_cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    local_failure: Option<Arc<AtomicBool>>,
}
impl<T: CatalogTransport> CatalogStore<T> {
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        Self::new_with_cpu(transport, limits, None)
    }
    pub fn new_with_cpu(
        transport: T,
        limits: CatalogLimits,
        shared_cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> Result<Self, Error> {
        limits.validate()?;
        let transport = Arc::new(transport);
        Ok(Self {
            raw: RawRecordStore::new_shared_with_cpu(
                transport.clone(),
                limits.raw.clone(),
                shared_cpu.clone(),
            )?,
            transport,
            io: Arc::new(Semaphore::new(limits.io)),
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            limits,
            shared_cpu,
            local_failure: None,
        })
    }
    pub(crate) fn local_invocation(&self) -> Self {
        let flag = Arc::new(AtomicBool::new(false));
        Self {
            transport: self.transport.clone(),
            raw: self.raw.invocation(flag.clone()),
            limits: self.limits.clone(),
            io: self.io.clone(),
            cpu: self.cpu.clone(),
            shared_cpu: self.shared_cpu.clone(),
            local_failure: Some(flag),
        }
    }
    pub(crate) fn cpu_view(
        &self,
        cpu: Arc<crate::runtime_resources::CpuAdmission>,
    ) -> Result<Self, Error> {
        if self
            .shared_cpu
            .as_ref()
            .is_some_and(|original| !original.same_pool(&cpu))
        {
            return Err(Error::Invalid("different process CPU pool"));
        }
        let flag = Arc::new(AtomicBool::new(false));
        Ok(Self {
            transport: self.transport.clone(),
            raw: self
                .raw
                .invocation_with_cpu(flag.clone(), Some(cpu.clone())),
            limits: self.limits.clone(),
            io: self.io.clone(),
            cpu: self.cpu.clone(),
            shared_cpu: Some(cpu),
            local_failure: Some(flag),
        })
    }
    pub(crate) fn cpu_refused(&self) -> bool {
        self.local_failure
            .as_ref()
            .is_some_and(|f| f.load(Ordering::Acquire))
    }
    fn deadline(&self, deadline: Instant) -> Instant {
        deadline.min(Instant::now() + self.limits.deadline)
    }
    async fn cpu<F, R>(&self, deadline: Instant, f: F) -> Result<R, Error>
    where
        F: FnOnce() -> Result<R, Error> + Send + 'static,
        R: Send + 'static,
    {
        if let Some(cpu) = &self.shared_cpu {
            return match cpu
                .run(
                    crate::operational_metrics::CpuKind::StorageControl,
                    deadline,
                    Some(self.cpu.clone()),
                    f,
                )
                .await
            {
                Ok(value) => value,
                Err(
                    crate::runtime_resources::CpuFailure::Capacity
                    | crate::runtime_resources::CpuFailure::Deadline,
                ) => {
                    if let Some(flag) = &self.local_failure {
                        flag.store(true, Ordering::Release);
                    }
                    Err(Error::LocalCapacity)
                }
                Err(
                    crate::runtime_resources::CpuFailure::Panicked
                    | crate::runtime_resources::CpuFailure::Stopped,
                ) => Err(Error::Transport),
            };
        }
        let permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        crate::observability::spawn_blocking(move || {
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
        c.controls = c.controls.checked_add(n).ok_or(Error::Capacity)?;
        if c.controls > self.limits.retained_control_bytes {
            return Err(Error::Capacity);
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
        let deadline = c.deadline;
        match self.control(&id.key(), c).await {
            Ok(obj) => {
                let id = id.clone();
                let l = self.limits.clone();
                let catalog = self
                    .cpu(deadline, move || {
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
                return Err(Error::Capacity);
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
        let deadline = c.deadline;
        let obj = self.control(&r.descriptor_key()?, c).await?;
        let r = r.clone();
        let l = self.limits.clone();
        self.cpu(deadline, move || {
            GroupDeclaration::from_bytes(&obj.body, &r, &l)
        })
        .await
    }
    async fn raw_checked(&self, e: &Envelope, c: &mut Context) -> Result<RawRecord, Error> {
        c.output = c.output.checked_add(e.raw_length).ok_or(Error::Capacity)?;
        if c.output > self.limits.output_bytes {
            return Err(Error::Capacity);
        }
        let record = self.raw.load_at(&e.identity, c.deadline).await?;
        if &record.envelope != e {
            return Err(Error::Corrupt("raw member envelope"));
        }
        Ok(record)
    }
    async fn envelopes(
        &self,
        d: &GroupDeclaration,
        deadline: Instant,
    ) -> Result<Vec<Envelope>, Error> {
        let l = self.limits.clone();
        let d = d.clone();
        self.cpu(deadline, move || d.envelopes(&l)).await
    }
    async fn group_records(
        &self,
        d: &GroupDeclaration,
        c: &mut Context,
    ) -> Result<Vec<RawRecord>, Error> {
        let envelopes = self.envelopes(d, c.deadline).await?;
        let mut records = Vec::new();
        for e in &envelopes {
            records.push(self.raw_checked(e, c).await?);
        }
        Ok(records)
    }
    async fn eligible(&self, d: &GroupDeclaration, c: &mut Context) -> Result<bool, Error> {
        let deadline = c.deadline;
        for id in &d.partitions {
            self.pin(id, c).await?;
        }
        let l = self.limits.clone();
        let desc = d.clone();
        let envelopes = self.cpu(deadline, move || desc.envelopes(&l)).await?;
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
    fn dependencies(c: &Context) -> Vec<DependencyToken> {
        c.pins
            .iter()
            .map(|(id, p)| DependencyToken {
                identity: id.clone(),
                generation: p.as_ref().map(|p| p.catalog.generation),
                etag: p.as_ref().map(|p| p.etag.clone()),
                version: p.as_ref().and_then(|p| p.version.clone()),
            })
            .collect()
    }
    async fn acquisition(
        &self,
        id: &CatalogId,
        e: &Envelope,
        c: &mut Context,
    ) -> Result<Option<CompleteAcquisition>, Error> {
        self.acquisition_prepared(id, e, None, c).await
    }
    async fn acquisition_prepared(
        &self,
        id: &CatalogId,
        e: &Envelope,
        prepared: Option<&GroupDeclaration>,
        c: &mut Context,
    ) -> Result<Option<CompleteAcquisition>, Error> {
        let deadline = c.deadline;
        if let Some(r) = &e.fetch_group {
            let d = match prepared {
                Some(d) => d.clone(),
                None => match self.descriptor(r, c).await {
                    Ok(d) => d,
                    Err(Error::NotFound) => return Ok(None),
                    Err(e) => return Err(e),
                },
            };
            let envelopes = self.envelopes(&d, deadline).await?;
            if !d
                .members
                .iter()
                .zip(&envelopes)
                .any(|(m, expected)| m.catalogs.contains(id) && expected == e)
            {
                return Err(Error::Corrupt("undeclared catalog group entry"));
            }
            if !self.eligible(&d, c).await? {
                return Ok(None);
            }
            match self.group_records(&d, c).await {
                Ok(records) => Ok(Some(CompleteAcquisition {
                    records,
                    group: Some(r.group_sha256.clone()),
                })),
                Err(Error::NotFound) => Ok(None),
                Err(e) => Err(e),
            }
        } else if e.pagination.is_none() {
            Ok(Some(CompleteAcquisition {
                records: vec![self.raw_checked(e, c).await?],
                group: None,
            }))
        } else {
            Ok(None)
        }
    }
    async fn ordered_candidates(
        &self,
        id: &CatalogId,
        entries: Vec<Envelope>,
        c: &mut Context,
    ) -> Result<(Vec<OrderedCandidate>, usize, String), Error> {
        let deadline = c.deadline;
        let (groups, mut candidates) = self
            .cpu(deadline, move || {
                let mut groups: BTreeMap<String, Vec<Envelope>> = BTreeMap::new();
                let mut candidates = Vec::new();
                for e in entries {
                    if let Some(r) = &e.fetch_group {
                        groups.entry(r.group_sha256.clone()).or_default().push(e);
                    } else {
                        candidates.push(OrderedCandidate {
                            representative: e.clone(),
                            entry: e,
                            descriptor: None,
                        });
                    }
                }
                Ok((groups, candidates))
            })
            .await?;
        let mut excluded = 0;
        for entries in groups.into_values() {
            let d = match self
                .descriptor(entries[0].fetch_group.as_ref().unwrap(), c)
                .await
            {
                Ok(d) => d,
                Err(Error::NotFound) => {
                    excluded += 1;
                    continue;
                }
                Err(e) => return Err(e),
            };
            let expected = self.envelopes(&d, deadline).await?;
            let owner = id.clone();
            let candidate = self
                .cpu(deadline, move || {
                    for e in &entries {
                        if !d
                            .members
                            .iter()
                            .zip(&expected)
                            .any(|(m, expected)| m.catalogs.contains(&owner) && e == expected)
                        {
                            return Err(Error::Corrupt("undeclared catalog group entry"));
                        }
                    }
                    Ok(OrderedCandidate {
                        entry: entries[0].clone(),
                        representative: expected[0].clone(),
                        descriptor: Some(d),
                    })
                })
                .await?;
            candidates.push(candidate);
        }
        self.cpu(deadline, move || {
            candidates.sort_by(|a, b| {
                identity_order(&a.representative).cmp(&identity_order(&b.representative))
            });
            let cohort = candidates
                .iter()
                .map(|a| (&a.representative.identity, &a.representative.fetch_group))
                .collect::<Vec<_>>();
            let bytes = serde_json::to_vec(&cohort)
                .map_err(|_| Error::Invalid("ordering serialization"))?;
            Ok((candidates, excluded, super::sha256(&bytes)))
        })
        .await
    }
    /// Exact immutable member selection, never a proof of complete revision coverage.
    pub async fn lookup_acquisition(
        &self,
        id: &CatalogId,
        member: &RecordId,
        deadline: Instant,
    ) -> Result<PageOutcome, Error> {
        let deadline = self.deadline(deadline);
        id.validate()?;
        member.validate()?;
        if !id.matches(member) {
            return Err(Error::Invalid("targeted member namespace"));
        }
        timeout_at(deadline, async {
            let _admission = self.admit().await?;
            let mut c = Context::new(deadline);
            self.pin(id, &mut c).await?;
            let Some(Some(p)) = c.pins.get(id) else {
                return Ok(PageOutcome::Incomplete);
            };
            let Some(e) = p
                .catalog
                .entries
                .iter()
                .find(|e| &e.identity == member)
                .cloned()
            else {
                return Ok(PageOutcome::Incomplete);
            };
            let Some(a) = self.acquisition(id, &e, &mut c).await? else {
                return Ok(PageOutcome::Incomplete);
            };
            Ok(PageOutcome::Ready(CompletePage {
                coverage: RevisionCoverage::Targeted,
                acquisitions: vec![a],
                dependencies: Self::dependencies(&c),
                excluded: 0,
                next: None,
            }))
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
    async fn validate_cursor(
        &self,
        id: &CatalogId,
        order: ReadOrder,
        cursor: &ReadCursor,
        c: &mut Context,
    ) -> Result<bool, Error> {
        let deadline = c.deadline;
        if &cursor.catalog != id || cursor.order != order {
            return Err(Error::Invalid("cursor scope/order"));
        }
        for old in &cursor.dependencies {
            // Revalidate previous cohorts without retaining their catalogs as current-page pins.
            let mut ephemeral = Context::new(deadline);
            self.pin(&old.identity, &mut ephemeral).await?;
            if Self::dependencies(&ephemeral).first() != Some(old) {
                return Ok(false);
            }
            self.count_control(c, ephemeral.controls)?;
        }
        Ok(Self::dependencies(c).iter().any(|d| d == &cursor.target))
    }
    /// A bounded whole-acquisition page has no fold method. Cross-page coherence may exhaust its deadline.
    pub async fn lookup_page(
        &self,
        id: &CatalogId,
        order: ReadOrder,
        cursor: Option<&ReadCursor>,
        maximum_acquisitions: usize,
        deadline: Instant,
    ) -> Result<PageOutcome, Error> {
        let deadline = self.deadline(deadline);
        id.validate()?;
        if let Some(cursor) = cursor
            && (&cursor.catalog != id || cursor.order != order)
        {
            return Err(Error::Invalid("cursor scope/order"));
        }
        if maximum_acquisitions == 0 || maximum_acquisitions > self.limits.entries {
            return Err(Error::Invalid("page acquisition limit"));
        }
        timeout_at(deadline, async {
            let _admission = self.admit().await?;
            let mut c = Context::new(deadline);
            self.pin(id, &mut c).await?;
            let Some(Some(target)) = c.pins.get(id) else {
                return Ok(PageOutcome::Incomplete);
            };
            let entries = target.catalog.entries.clone();
            let (mut candidates, mut excluded, ordering_sha256) =
                self.ordered_candidates(id, entries, &mut c).await?;
            if order == ReadOrder::LatestFirst {
                candidates.reverse();
            }
            let target = Self::dependencies(&c)[0].clone();
            if let Some(cursor) = cursor
                && (cursor.ordering_sha256 != ordering_sha256
                    || !self.validate_cursor(id, order, cursor, &mut c).await?)
            {
                return Ok(PageOutcome::Incomplete);
            }
            let mut offset = cursor.map_or(0, |c| c.offset);
            let mut seen = cursor.map_or_else(BTreeSet::new, |c| c.seen.clone());
            let mut acquisitions = Vec::new();
            while offset < candidates.len() && acquisitions.len() < maximum_acquisitions {
                let candidate = &candidates[offset];
                let e = &candidate.entry;
                offset += 1;
                if let Some(r) = &e.fetch_group
                    && !seen.insert(r.group_sha256.clone())
                {
                    continue;
                }
                match self
                    .acquisition_prepared(id, e, candidate.descriptor.as_ref(), &mut c)
                    .await?
                {
                    Some(a) => acquisitions.push(a),
                    None => excluded += 1,
                }
            }
            if acquisitions.is_empty() {
                return Ok(PageOutcome::Incomplete);
            }
            let mut dependencies = cursor.map_or_else(Vec::new, |c| c.dependencies.clone());
            for token in Self::dependencies(&c) {
                if let Some(old) = dependencies.iter().find(|t| t.identity == token.identity) {
                    if old != &token {
                        return Ok(PageOutcome::Incomplete);
                    }
                } else {
                    dependencies.push(token);
                }
            }
            let bytes = dependencies
                .iter()
                .map(|t| {
                    t.identity.key().len()
                        + t.etag.as_ref().map_or(0, String::len)
                        + t.version.as_ref().map_or(0, String::len)
                        + 32
                })
                .sum::<usize>()
                + seen.len() * 64
                + ordering_sha256.len();
            if bytes > self.limits.retained_control_bytes {
                return Err(Error::Capacity);
            }
            let next = (offset < candidates.len()).then(|| {
                Box::new(ReadCursor {
                    catalog: id.clone(),
                    target,
                    order,
                    offset,
                    seen,
                    dependencies: dependencies.clone(),
                    ordering_sha256,
                })
            });
            Ok(PageOutcome::Ready(CompletePage {
                coverage: RevisionCoverage::Paged,
                acquisitions,
                dependencies,
                excluded,
                next,
            }))
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
    async fn lookup_inner(&self, id: &CatalogId, c: &mut Context) -> Result<LookupOutcome, Error> {
        let deadline = c.deadline;
        self.pin(id, c).await?;
        let Some(Some(target)) = c.pins.get(id) else {
            return Ok(LookupOutcome::Incomplete);
        };
        let entries = target.catalog.entries.clone();
        let mut groups = BTreeSet::new();
        let mut acquisitions = Vec::new();
        let mut excluded = 0;
        for e in entries {
            if let Some(r) = &e.fetch_group
                && !groups.insert(r.group_sha256.clone())
            {
                continue;
            }
            match self.acquisition(id, &e, c).await? {
                Some(a) => acquisitions.push(a),
                None => excluded += 1,
            }
        }
        let acquisitions = self
            .cpu(deadline, move || {
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
            coverage: RevisionCoverage::FullHistory,
            acquisitions,
            dependencies,
            excluded,
        }))
    }
    pub async fn lookup(&self, id: &CatalogId, deadline: Instant) -> Result<LookupOutcome, Error> {
        let deadline = self.deadline(deadline);
        crate::observability::observe(
            crate::observability::Component::S3,
            crate::observability::Stage::Lookup,
            async {
                id.validate()?;
                timeout_at(deadline, async {
                    let _admission = self.admit().await?;
                    self.lookup_inner(id, &mut Context::new(deadline)).await
                })
                .await
                .map_err(|_| Error::Timeout)?
            },
        )
        .await
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
        put_rejection: &mut Option<u16>,
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
                        // Terminal known rejection: unwind immediately; no read may inherit this.
                        *put_rejection = Some(s);
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
        put_rejection: &mut Option<u16>,
    ) -> Result<(), Error> {
        let deadline = c.deadline;
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
            let merged = self.cpu(deadline, move || base.union(&input, &l)).await?;
            if pin.as_ref().is_some_and(|p| p.catalog == merged) {
                return Ok(());
            }
            let condition = pin
                .map(|p| WriteCondition::Match(p.etag))
                .unwrap_or(WriteCondition::Absent);
            let l = self.limits.clone();
            let bytes = self.cpu(deadline, move || merged.bytes(&l)).await?;
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
                        // Terminal known rejection: unwind immediately; no read may inherit this.
                        *put_rejection = Some(s);
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
                // Only known CAS412 responses and a successful final pin lacking these entries.
                *put_rejection = Some(412);
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
        put_rejection: &mut Option<u16>,
    ) -> Result<(), Error> {
        let all = self.envelopes(d, c.deadline).await?;
        for id in &d.partitions {
            let entries = d
                .members
                .iter()
                .zip(&all)
                .filter(|(m, _)| m.catalogs.contains(id))
                .map(|(_, e)| e.clone())
                .collect::<Vec<_>>();
            self.union(id, &entries, c, started, put_rejection).await?;
        }
        Ok(())
    }
    /// A single immutable publication: the first conditional-absent catalog wins.
    /// Unlike `publish`, this never unions another acquisition into that catalog.
    /// A losing raw write remains unreferenced; callers must not repair it into the winner.
    pub async fn publish_once(
        &self,
        id: CatalogId,
        record: RawRecord,
        deadline: Instant,
    ) -> Result<RawRecord, Error> {
        let deadline = self.deadline(deadline);
        let mut started = false;
        let result = timeout_at(deadline, async {
            let _admission = self.admit().await?;
            id.validate()?;
            if !id.matches(&record.envelope.identity)
                || record.envelope.fetch_group.is_some()
                || record.envelope.pagination.is_some()
            {
                return Err(Error::Invalid("single publication identity"));
            }
            let candidate = record.clone();
            let l = self.limits.clone();
            let envelope = self
                .cpu(deadline, move || {
                    candidate.prepare(&l.raw)?;
                    Ok(candidate.envelope)
                })
                .await?;
            let mut context = Context::new(deadline);
            if let Some(p) = self.catalog(&id, &mut context).await? {
                return self.single_record(p, &mut context).await;
            }
            let catalog = Catalog::empty(id.clone()).union(&[envelope], &self.limits)?;
            let l = self.limits.clone();
            let bytes = self.cpu(deadline, move || catalog.bytes(&l)).await?;
            self.transport.ready().await?;
            started = true;
            self.raw.publish_at(record, deadline).await?;
            match self
                .transport
                .put_control(&id.key(), &bytes, &WriteCondition::Absent)
                .await
            {
                Ok(200 | 412 | 409 | 500..=599)
                | Err(Error::Transport | Error::Timeout | Error::Ambiguous | Error::Capacity) => {}
                Ok(status) => return Err(Error::Status(status)),
                Err(e) => return Err(e),
            }
            // A response alone is not serving authority: verify the committed raw winner.
            let mut context = Context::new(deadline);
            let winner = self
                .catalog(&id, &mut context)
                .await?
                .ok_or(Error::Ambiguous)?;
            self.single_record(winner, &mut context).await
        })
        .await;
        match result {
            Ok(Err(e)) if started => Err(Self::uncertain(e)),
            Ok(r) => r,
            Err(_) => Err(if started {
                Error::Ambiguous
            } else {
                Error::Timeout
            }),
        }
    }
    async fn single_record(&self, p: Pinned, context: &mut Context) -> Result<RawRecord, Error> {
        if p.catalog.entries.len() != 1 {
            return Err(Error::Corrupt("single publication cardinality"));
        }
        let e = &p.catalog.entries[0];
        if e.fetch_group.is_some() || e.pagination.is_some() {
            return Err(Error::Corrupt("single publication group"));
        }
        self.raw_checked(e, context).await
    }
    /// The flag belongs only to this invocation and its raw-store view. It is set only when
    /// this invocation observes an actual CPU admission failure. Late successful closure completion
    /// cannot turn an unrelated timeout into a local-capacity cause.
    pub(crate) async fn publish_with_local_provenance(
        &self,
        declaration: GroupDeclaration,
        records: Vec<RawRecord>,
        deadline: Instant,
    ) -> Result<CompleteSet, PublicationFailure> {
        let flag = Arc::new(AtomicBool::new(false));
        let view = Self {
            transport: self.transport.clone(),
            raw: self.raw.invocation(flag.clone()),
            limits: self.limits.clone(),
            io: self.io.clone(),
            cpu: self.cpu.clone(),
            shared_cpu: self.shared_cpu.clone(),
            local_failure: Some(flag.clone()),
        };
        view.publish(declaration, records, deadline)
            .await
            .map_err(|error| PublicationFailure {
                error,
                local_capacity: flag.load(Ordering::Acquire),
            })
    }
    pub async fn publish(
        &self,
        declaration: GroupDeclaration,
        records: Vec<RawRecord>,
        deadline: Instant,
    ) -> Result<CompleteSet, Error> {
        let deadline = self.deadline(deadline);
        crate::observability::observe(
            crate::observability::Component::S3,
            crate::observability::Stage::Publish,
            async {
                let mut started = false;
                // Stack-local terminal PUT evidence; unrelated reads/invocations cannot set it.
                let mut put_rejection = None;
                let result = timeout_at(deadline, async {
                    let _admission = self.admit().await?;
                    // S10F GROK-1: credentials before the first write; a failure here is definite.
                    self.transport.ready().await?;
                    let l = self.limits.clone();
                    let d = declaration.clone();
                    let (reference, body, records) = self
                        .cpu(deadline, move || {
                            Ok((d.reference(&l)?, d.bytes(&l)?, d.attach(records, &l)?))
                        })
                        .await?;
                    let total = records.iter().try_fold(0usize, |n, r| {
                        n.checked_add(r.bytes.len()).ok_or(Error::Capacity)
                    })?;
                    if total > self.limits.output_bytes {
                        return Err(Error::Capacity);
                    }
                    let worst = declaration
                        .partitions
                        .len()
                        .checked_mul(self.limits.control_bytes)
                        .and_then(|n| n.checked_add(body.len()))
                        .ok_or(Error::Capacity)?;
                    if worst > self.limits.retained_control_bytes {
                        return Err(Error::Capacity);
                    }
                    let mut preflight = Context::new(deadline);
                    let mut required = body.len();
                    let all = self.envelopes(&declaration, deadline).await?;
                    for id in &declaration.partitions {
                        let current = self
                            .catalog(id, &mut preflight)
                            .await?
                            .map(|p| p.catalog)
                            .unwrap_or_else(|| Catalog::empty(id.clone()));
                        let incoming = declaration
                            .members
                            .iter()
                            .zip(&all)
                            .filter(|(m, _)| m.catalogs.contains(id))
                            .map(|(_, e)| e.clone())
                            .collect::<Vec<_>>();
                        let l = self.limits.clone();
                        let n = self
                            .cpu(deadline, move || {
                                current.union(&incoming, &l)?.bytes(&l).map(|b| b.len())
                            })
                            .await
                            .map_err(|e| match e {
                                Error::Invalid("catalog bytes")
                                | Error::Corrupt("catalog schema/entries") => Error::Capacity,
                                _ => e,
                            })?;
                        required = required.checked_add(n).ok_or(Error::Capacity)?;
                    }
                    if required > self.limits.retained_control_bytes {
                        return Err(Error::Capacity);
                    }
                    let mut context = Context::new(deadline);
                    self.immutable(
                        &reference.descriptor_key()?,
                        &body,
                        &mut context,
                        &mut started,
                        &mut put_rejection,
                    )
                    .await?;
                    for record in records {
                        started = true;
                        self.raw
                            .publish_at_with_put_rejection(record, deadline, &mut put_rejection)
                            .await?;
                    }
                    self.publish_catalogs(
                        &declaration,
                        &mut context,
                        &mut started,
                        &mut put_rejection,
                    )
                    .await?;
                    // Publication checks the new group only; unrelated retained history must not poison success.
                    let mut context = Context::new(deadline);
                    if !self
                        .eligible(&declaration, &mut context)
                        .await
                        .map_err(Self::uncertain)?
                    {
                        return Err(Error::Ambiguous);
                    }
                    let records = self
                        .group_records(&declaration, &mut context)
                        .await
                        .map_err(Self::uncertain)?;
                    Ok(CompleteSet {
                        coverage: RevisionCoverage::PublishedGroup,
                        acquisitions: vec![CompleteAcquisition {
                            records,
                            group: Some(reference.group_sha256),
                        }],
                        dependencies: Self::dependencies(&context),
                        excluded: 0,
                    })
                })
                .await;
                match result {
                    Ok(Err(Error::Status(status))) if put_rejection == Some(status) => {
                        Err(Error::Status(status))
                    }
                    Ok(Err(error)) if started => Err(Self::uncertain(error)),
                    Ok(r) => r,
                    Err(_) => Err(if started {
                        Error::Ambiguous
                    } else {
                        Error::Timeout
                    }),
                }
            },
        )
        .await
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
        put_rejection: &mut Option<u16>,
        materialize: bool,
    ) -> Result<RepairOutcome, Error> {
        let deadline = c.deadline;
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
                let page = self
                    .cpu(deadline, move || decode_list(&bytes, maximum))
                    .await?;
                for key in page.keys {
                    if !keys.insert(key.clone()) {
                        return Err(Error::Corrupt("duplicate LIST key"));
                    }
                    if keys.len() > self.limits.candidates {
                        return Ok(RepairOutcome::Incomplete);
                    }
                    match Self::identity(&key, &prefix, &scope.catalog, period) {
                        Ok(identity) => match self.raw.load_at(&identity, c.deadline).await {
                            Ok(record) => {
                                if record.bytes.len() > self.limits.output_bytes {
                                    return Ok(RepairOutcome::Incomplete);
                                }
                                discovered.push(record.envelope);
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
        let mut groups: BTreeMap<String, (GroupDeclaration, Vec<Envelope>)> = BTreeMap::new();
        let mut eligible = BTreeSet::new();
        let mut singles = Vec::new();
        for envelope in discovered {
            if let Some(reference) = &envelope.fetch_group {
                if !groups.contains_key(&reference.group_sha256) {
                    let descriptor = match self.descriptor(reference, c).await {
                        Ok(d) => d,
                        Err(Error::NotFound) | Err(Error::Corrupt(_)) | Err(Error::Invalid(_)) => {
                            incomplete = true;
                            continue;
                        }
                        Err(e) => return Err(e),
                    };
                    let expected = self.envelopes(&descriptor, deadline).await?;
                    groups.insert(reference.group_sha256.clone(), (descriptor, expected));
                }
                let (descriptor, expected) = groups.get(&reference.group_sha256).unwrap();
                let group_sha256 = reference.group_sha256.clone();
                let members = descriptor.members.clone();
                let expected = expected.clone();
                let owner = scope.catalog.clone();
                let valid = self
                    .cpu(deadline, move || {
                        Ok(members
                            .iter()
                            .zip(&expected)
                            .any(|(m, e)| m.catalogs.contains(&owner) && e == &envelope))
                    })
                    .await?;
                if valid {
                    eligible.insert(group_sha256);
                } else {
                    incomplete = true;
                }
            } else if envelope.pagination.is_none() {
                singles.push(envelope);
            } else {
                incomplete = true;
            }
        }
        // Invalid discoveries keep the scope incomplete, but must not block other verified orphans.
        // Cached descriptors alone do not authorize publication: require a valid target-owned member.
        for (group_sha256, (descriptor, _)) in groups {
            if !eligible.contains(&group_sha256) {
                continue;
            }
            // Discovery retained only envelopes. Each verified group body is discarded before the next group.
            c.output = 0;
            match self.group_records(&descriptor, c).await {
                Ok(_) => {
                    self.publish_catalogs(&descriptor, c, started, put_rejection)
                        .await?;
                }
                Err(Error::NotFound) | Err(Error::Corrupt(_)) | Err(Error::Invalid(_)) => {
                    incomplete = true
                }
                Err(e) => return Err(e),
            }
        }
        if !singles.is_empty() {
            self.union(&scope.catalog, &singles, c, started, put_rejection)
                .await?;
        }
        if incomplete {
            return Ok(RepairOutcome::Incomplete);
        }
        *c = Context::new(deadline);
        if !materialize {
            self.pin(&scope.catalog, c)
                .await
                .map_err(|e| if *started { Self::uncertain(e) } else { e })?;
            return Ok(RepairOutcome::Indexed {
                scope: scope.clone(),
                dependencies: Self::dependencies(c),
            });
        }
        let materialized = self.lookup_inner(&scope.catalog, c).await;
        match materialized {
            Err(Error::Capacity | Error::LocalCapacity) => {
                let mut context = Context::new(deadline);
                self.pin(&scope.catalog, &mut context)
                    .await
                    .map_err(|e| if *started { Self::uncertain(e) } else { e })?;
                Ok(RepairOutcome::Indexed {
                    scope: scope.clone(),
                    dependencies: Self::dependencies(&context),
                })
            }
            Err(e) => Err(if *started { Self::uncertain(e) } else { e }),
            Ok(LookupOutcome::Ready(set)) => Ok(RepairOutcome::Complete(set)),
            Ok(LookupOutcome::Incomplete) => Ok(RepairOutcome::Incomplete),
        }
    }
    pub async fn repair(
        &self,
        scope: &RepairScope,
        deadline: Instant,
    ) -> Result<RepairOutcome, Error> {
        self.repair_mode(scope, deadline, true).await
    }
    /// Verifies and indexes every discovery in the finite caller-owned scope, without a final
    /// all-history body fold. Indexed proves scoped index recovery, not a serving CompleteSet.
    /// Empty, incomplete, cancellation, bounds and ambiguous writes retain repair's semantics.
    pub async fn repair_index(
        &self,
        scope: &RepairScope,
        deadline: Instant,
    ) -> Result<RepairOutcome, Error> {
        self.repair_mode(scope, deadline, false).await
    }
    async fn repair_mode(
        &self,
        scope: &RepairScope,
        deadline: Instant,
        materialize: bool,
    ) -> Result<RepairOutcome, Error> {
        let deadline = self.deadline(deadline);
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
        let mut put_rejection = None;
        match timeout_at(deadline, async {
            let _admission = self.admit().await?;
            // S10F GROK-1: credentials before the first write; a failure here is definite.
            self.transport.ready().await?;
            self.repair_inner(
                scope,
                &mut Context::new(deadline),
                &mut started,
                &mut put_rejection,
                materialize,
            )
            .await
        })
        .await
        {
            Ok(Err(Error::Status(status))) if put_rejection == Some(status) => {
                Err(Error::Status(status))
            }
            Ok(Err(error)) if started => Err(Self::uncertain(error)),
            Ok(r) => r,
            Err(_) => Err(if started {
                Error::Ambiguous
            } else {
                Error::Timeout
            }),
        }
    }
}

#[derive(Debug)]
pub(crate) struct PublicationFailure {
    pub error: Error,
    pub local_capacity: bool,
}

#[cfg(test)]
mod resource_admission_tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    struct Peer {
        descriptor_started: tokio::sync::Notify,
        descriptor_reply: tokio::sync::Notify,
        reject_ready: AtomicBool,
        raw_puts: AtomicUsize,
        control_puts: AtomicUsize,
    }
    impl Peer {
        fn new() -> Self {
            Self {
                descriptor_started: tokio::sync::Notify::new(),
                descriptor_reply: tokio::sync::Notify::new(),
                reject_ready: AtomicBool::new(false),
                raw_puts: AtomicUsize::new(0),
                control_puts: AtomicUsize::new(0),
            }
        }
    }
    impl super::super::ObjectTransport for Arc<Peer> {
        async fn ready(&self) -> Result<(), Error> {
            if self.reject_ready.load(Ordering::SeqCst) {
                Err(Error::Transport)
            } else {
                Ok(())
            }
        }
        async fn put(&self, _: &super::super::PreparedRecord) -> Result<u16, Error> {
            self.raw_puts.fetch_add(1, Ordering::SeqCst);
            Ok(200)
        }
        async fn head(&self, _: &str) -> Result<super::super::Object, Error> {
            Err(Error::NotFound)
        }
        async fn get(&self, _: &str, _: usize) -> Result<super::super::Object, Error> {
            Err(Error::NotFound)
        }
    }
    impl CatalogTransport for Arc<Peer> {
        async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
            Err(Error::NotFound)
        }
        async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
            self.control_puts.fetch_add(1, Ordering::SeqCst);
            self.descriptor_started.notify_one();
            self.descriptor_reply.notified().await;
            Ok(200)
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            Err(Error::Transport)
        }
    }
    fn group() -> (GroupDeclaration, Vec<RawRecord>) {
        let limits = CatalogLimits::default();
        let record = RawRecord::new(
            "vc",
            "world-weather",
            &super::super::ProviderKey::Named {
                id: "owned-grid".into(),
            },
            Period {
                local_date: 20261019,
                slot: "all".into(),
            },
            1,
            200,
            "application/json",
            None,
            br#"{}"#.to_vec().into(),
            &limits.raw,
        )
        .unwrap();
        let id = CatalogId::for_record(&record.envelope.identity, "owned").unwrap();
        let declaration = GroupDeclaration::new(
            vec![super::super::GroupMember {
                envelope: record.envelope.clone(),
                catalogs: vec![id],
            }],
            &limits,
        )
        .unwrap();
        (declaration, vec![record])
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn publication_cpu_provenance_preserves_uncertainty_and_is_invocation_scoped() {
        let peer = Arc::new(Peer::new());
        let cpu = crate::runtime_resources::CpuAdmission::new(1);
        let store = Arc::new(
            CatalogStore::new_with_cpu(peer.clone(), CatalogLimits::default(), Some(cpu.clone()))
                .unwrap(),
        );
        let (declaration, records) = group();
        let first = store.clone();
        let operation = tokio::spawn(async move {
            first
                .publish_with_local_provenance(
                    declaration,
                    records,
                    Instant::now() + std::time::Duration::from_millis(500),
                )
                .await
        });
        peer.descriptor_started.notified().await;
        let (start, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let held = cpu.clone();
        let blocker = tokio::spawn(async move {
            held.immediate(crate::operational_metrics::CpuKind::Foundation, move || {
                let _ = start.send(());
                wait.recv().unwrap();
            })
            .await
        });
        ready.await.unwrap();
        peer.reject_ready.store(true, Ordering::SeqCst);
        let (d, r) = group();
        let unrelated = store
            .publish_with_local_provenance(d, r, Instant::now() + std::time::Duration::from_secs(1))
            .await
            .unwrap_err();
        assert_eq!(unrelated.error, Error::Transport);
        assert!(!unrelated.local_capacity);
        peer.descriptor_reply.notify_one();
        let failure = operation.await.unwrap().unwrap_err();
        assert_eq!(failure.error, Error::Ambiguous);
        assert!(failure.local_capacity);
        assert_eq!(peer.control_puts.load(Ordering::SeqCst), 1);
        assert_eq!(peer.raw_puts.load(Ordering::SeqCst), 0);
        release.send(()).unwrap();
        assert!(blocker.await.unwrap().is_ok());
        assert!(
            !unrelated.local_capacity,
            "late completion cannot rewrite a different invocation receipt"
        );
    }
    struct Pressure {
        release: std::sync::mpsc::Sender<()>,
        held: tokio::task::JoinHandle<Result<(), crate::runtime_resources::CpuFailure>>,
        queued: Vec<tokio::task::JoinHandle<Result<(), crate::runtime_resources::CpuFailure>>>,
    }
    impl Pressure {
        async fn start(cpu: Arc<crate::runtime_resources::CpuAdmission>) -> Self {
            let (start, ready) = tokio::sync::oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let owner = cpu.clone();
            let held = tokio::spawn(async move {
                owner
                    .immediate(crate::operational_metrics::CpuKind::Foundation, move || {
                        let _ = start.send(());
                        wait.recv().unwrap();
                    })
                    .await
            });
            ready.await.unwrap();
            let mut queued = Vec::new();
            for _ in 0..16 {
                let cpu = cpu.clone();
                queued.push(tokio::spawn(async move {
                    cpu.run(
                        crate::operational_metrics::CpuKind::VcParse,
                        Instant::now() + std::time::Duration::from_secs(3),
                        None,
                        || (),
                    )
                    .await
                }));
            }
            tokio::time::timeout(std::time::Duration::from_secs(1), async {
                while !cpu
                    .render()
                    .lines()
                    .any(|l| l == "server2_cpu_pool_queued 16")
                {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            Self {
                release,
                held,
                queued,
            }
        }
        async fn stop(self) {
            for task in self.queued {
                task.abort();
                let _ = task.await;
            }
            self.release.send(()).unwrap();
            assert!(self.held.await.unwrap().is_ok());
        }
    }
    struct RepairPeer {
        raw: super::super::PreparedRecord,
        control: std::sync::Mutex<Option<Vec<u8>>>,
        cpu: Arc<crate::runtime_resources::CpuAdmission>,
        pressure: std::sync::Mutex<Option<Pressure>>,
        post_reads: AtomicUsize,
        puts: AtomicUsize,
        fail_fresh: bool,
        timeout_after_index: bool,
        materializing: AtomicBool,
    }
    impl super::super::ObjectTransport for Arc<RepairPeer> {
        async fn put(&self, _: &super::super::PreparedRecord) -> Result<u16, Error> {
            panic!("repair never republishes raw body")
        }
        async fn head(&self, _: &str) -> Result<super::super::Object, Error> {
            Ok(super::super::Object {
                metadata: self.raw.metadata.clone(),
                length: self.raw.body.len(),
                body: Vec::new(),
            })
        }
        async fn get(&self, key: &str, _: usize) -> Result<super::super::Object, Error> {
            assert_eq!(key, self.raw.key);
            if self.timeout_after_index && self.control.lock().unwrap().is_some() {
                self.materializing.store(true, Ordering::SeqCst);
                return std::future::pending().await;
            }
            Ok(super::super::Object {
                metadata: self.raw.metadata.clone(),
                length: self.raw.body.len(),
                body: self.raw.body.clone(),
            })
        }
    }
    impl CatalogTransport for Arc<RepairPeer> {
        async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
            let bytes = { self.control.lock().unwrap().clone() };
            let Some(bytes) = bytes else {
                return Err(Error::NotFound);
            };
            let read = self.post_reads.fetch_add(1, Ordering::SeqCst);
            if read == 0 && !self.timeout_after_index {
                let pressure = Pressure::start(self.cpu.clone()).await;
                *self.pressure.lock().unwrap() = Some(pressure);
            } else if read == 1 && !self.timeout_after_index {
                let pressure = { self.pressure.lock().unwrap().take() };
                pressure.unwrap().stop().await;
                if self.fail_fresh {
                    return Err(Error::Transport);
                }
            }
            Ok(ControlObject {
                body: bytes,
                etag: "\"committed-index\"".into(),
                version: None,
            })
        }
        async fn put_control(
            &self,
            _: &str,
            body: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, Error> {
            self.puts.fetch_add(1, Ordering::SeqCst);
            *self.control.lock().unwrap() = Some(body.to_vec());
            Ok(200)
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            Ok(format!(r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><KeyCount>1</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>{}</Key></Contents></ListBucketResult>"#,self.raw.key).into_bytes())
        }
    }
    async fn repaired_under_materialization_pressure(
        fail_fresh: bool,
    ) -> Result<RepairOutcome, Error> {
        let cpu = crate::runtime_resources::CpuAdmission::new(1);
        let (_, mut records) = group();
        let raw = records.remove(0);
        let scope = RepairScope {
            catalog: CatalogId::for_record(&raw.envelope.identity, "owned").unwrap(),
            periods: vec![raw.envelope.identity.period.clone()],
        };
        let peer = Arc::new(RepairPeer {
            raw: raw.prepare(&CatalogLimits::default().raw).unwrap(),
            control: std::sync::Mutex::new(None),
            cpu: cpu.clone(),
            pressure: std::sync::Mutex::new(None),
            post_reads: AtomicUsize::new(0),
            puts: AtomicUsize::new(0),
            fail_fresh,
            timeout_after_index: false,
            materializing: AtomicBool::new(false),
        });
        let store =
            CatalogStore::new_with_cpu(peer.clone(), CatalogLimits::default(), Some(cpu.clone()))
                .unwrap();
        let result = store
            .repair(&scope, Instant::now() + std::time::Duration::from_secs(2))
            .await;
        assert_eq!(
            peer.puts.load(Ordering::SeqCst),
            1,
            "all scope index writes acknowledged before materialization pressure"
        );
        assert_eq!(
            peer.post_reads.load(Ordering::SeqCst),
            2,
            "failed materialization requires a separate fresh pin"
        );
        assert!(peer.pressure.lock().unwrap().is_none());
        assert_eq!(cpu.available(), 1);
        result
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn acknowledged_repair_cpu_refusal_is_indexed_only_after_fresh_validated_pin() {
        match repaired_under_materialization_pressure(false)
            .await
            .unwrap()
        {
            RepairOutcome::Indexed { dependencies, .. } => assert_eq!(dependencies.len(), 1),
            other => panic!("not a serving CompleteSet: {other:?}"),
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn acknowledged_repair_cpu_refusal_and_failed_fresh_pin_stays_ambiguous() {
        assert!(matches!(
            repaired_under_materialization_pressure(true).await,
            Err(Error::Ambiguous)
        ));
    }
    #[tokio::test(start_paused = true)]
    async fn repair_inner_timeout_after_acknowledged_index_is_ambiguous() {
        let cpu = crate::runtime_resources::CpuAdmission::new(1);
        let (_, mut records) = group();
        let raw = records.remove(0);
        let scope = RepairScope {
            catalog: CatalogId::for_record(&raw.envelope.identity, "owned").unwrap(),
            periods: vec![raw.envelope.identity.period.clone()],
        };
        let peer = Arc::new(RepairPeer {
            raw: raw.prepare(&CatalogLimits::default().raw).unwrap(),
            control: std::sync::Mutex::new(None),
            cpu,
            pressure: std::sync::Mutex::new(None),
            post_reads: AtomicUsize::new(0),
            puts: AtomicUsize::new(0),
            fail_fresh: false,
            timeout_after_index: true,
            materializing: AtomicBool::new(false),
        });
        // This is the original standalone constructor, not only the injected path.
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let until = Instant::now() + std::time::Duration::from_secs(3);
        let task = tokio::spawn(async move { store.repair(&scope, until).await });
        while !peer.materializing.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
        assert_eq!(peer.puts.load(Ordering::SeqCst), 1);
        tokio::time::advance(std::time::Duration::from_secs(3)).await;
        let result = task.await.unwrap();
        assert!(
            matches!(result, Err(Error::Ambiguous)),
            "inner raw timeout after index acknowledgement is uncertain: {result:?}"
        );
        assert_eq!(
            peer.puts.load(Ordering::SeqCst),
            1,
            "no new publication attempt"
        );
    }
    #[tokio::test]
    async fn cpu_panic_and_stopped_are_not_local_capacity() {
        let cpu = crate::runtime_resources::CpuAdmission::new(1);
        let mut store =
            CatalogStore::new_with_cpu(Arc::new(Peer::new()), CatalogLimits::default(), Some(cpu))
                .unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        store.local_failure = Some(flag.clone());
        let panic: Result<(), Error> = store
            .cpu(Instant::now() + std::time::Duration::from_secs(1), || {
                panic!("owned CPU defect")
            })
            .await;
        assert_eq!(panic, Err(Error::Transport));
        assert!(!flag.load(Ordering::Acquire));
        store.cpu.close();
        let stopped: Result<(), Error> = store
            .cpu(
                Instant::now() + std::time::Duration::from_secs(1),
                || Ok(()),
            )
            .await;
        assert_eq!(stopped, Err(Error::Transport));
        assert!(!flag.load(Ordering::Acquire));
    }
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum StatusAt {
        Descriptor,
        Raw,
        Catalog,
        UnknownDescriptorReadback,
        AcceptedIndexReadback,
    }
    struct StatusPeer {
        mode: StatusAt,
        descriptor: String,
        controls: std::sync::Mutex<BTreeMap<String, Vec<u8>>>,
        raw: std::sync::Mutex<Option<(String, super::super::Object)>>,
        descriptor_puts: AtomicUsize,
        raw_puts: AtomicUsize,
        index_puts: AtomicUsize,
    }
    impl StatusPeer {
        fn new(mode: StatusAt, declaration: &GroupDeclaration) -> Arc<Self> {
            Arc::new(Self {
                mode,
                descriptor: declaration
                    .reference(&CatalogLimits::default())
                    .unwrap()
                    .descriptor_key()
                    .unwrap(),
                controls: Default::default(),
                raw: Default::default(),
                descriptor_puts: AtomicUsize::new(0),
                raw_puts: AtomicUsize::new(0),
                index_puts: AtomicUsize::new(0),
            })
        }
    }
    impl super::super::ObjectTransport for Arc<StatusPeer> {
        async fn put(&self, p: &super::super::PreparedRecord) -> Result<u16, Error> {
            self.raw_puts.fetch_add(1, Ordering::SeqCst);
            if self.mode == StatusAt::Raw {
                return Ok(403);
            }
            *self.raw.lock().unwrap() = Some((
                p.key.clone(),
                super::super::Object {
                    metadata: p.metadata.clone(),
                    length: p.body.len(),
                    body: p.body.clone(),
                },
            ));
            Ok(200)
        }
        async fn head(&self, key: &str) -> Result<super::super::Object, Error> {
            self.get(key, usize::MAX).await
        }
        async fn get(&self, key: &str, _: usize) -> Result<super::super::Object, Error> {
            self.raw
                .lock()
                .unwrap()
                .as_ref()
                .filter(|(k, _)| k == key)
                .map(|(_, o)| super::super::Object {
                    metadata: o.metadata.clone(),
                    length: o.length,
                    body: o.body.clone(),
                })
                .ok_or(Error::NotFound)
        }
    }
    impl CatalogTransport for Arc<StatusPeer> {
        async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
            if (self.mode == StatusAt::UnknownDescriptorReadback
                && key == self.descriptor
                && self.descriptor_puts.load(Ordering::SeqCst) > 0)
                || (self.mode == StatusAt::AcceptedIndexReadback
                    && key != self.descriptor
                    && self.index_puts.load(Ordering::SeqCst) > 0)
            {
                return Err(Error::Status(403));
            }
            self.controls
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .map(|body| ControlObject {
                    body,
                    etag: "\"owned-status\"".into(),
                    version: None,
                })
                .ok_or(Error::NotFound)
        }
        async fn put_control(
            &self,
            key: &str,
            body: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, Error> {
            if key == self.descriptor {
                self.descriptor_puts.fetch_add(1, Ordering::SeqCst);
                if self.mode == StatusAt::Descriptor {
                    return Ok(403);
                }
                if self.mode == StatusAt::UnknownDescriptorReadback {
                    return Err(Error::Transport);
                }
            } else {
                self.index_puts.fetch_add(1, Ordering::SeqCst);
                if self.mode == StatusAt::Catalog {
                    return Ok(403);
                }
            }
            self.controls
                .lock()
                .unwrap()
                .insert(key.into(), body.into());
            Ok(200)
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            let raw = self.raw.lock().unwrap();
            let key = &raw.as_ref().unwrap().0;
            Ok(format!(r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>1</KeyCount><Contents><Key>{key}</Key></Contents></ListBucketResult>"#).into_bytes())
        }
    }
    #[tokio::test]
    async fn definite_put_status_and_uncertain_readback_status_keep_distinct_boundaries() {
        for mode in [
            StatusAt::Descriptor,
            StatusAt::Raw,
            StatusAt::Catalog,
            StatusAt::UnknownDescriptorReadback,
            StatusAt::AcceptedIndexReadback,
        ] {
            let (d, raw) = group();
            let peer = StatusPeer::new(mode, &d);
            let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
            let error = store
                .publish(d, raw, Instant::now() + std::time::Duration::from_secs(3))
                .await
                .unwrap_err();
            let expected = if matches!(
                mode,
                StatusAt::UnknownDescriptorReadback | StatusAt::AcceptedIndexReadback
            ) {
                Error::Ambiguous
            } else {
                Error::Status(403)
            };
            assert_eq!(error, expected, "{mode:?}");
            assert!(
                peer.descriptor_puts.load(Ordering::SeqCst) <= 1,
                "no original descriptor resend"
            );
            assert!(
                peer.raw_puts.load(Ordering::SeqCst) <= 1,
                "no raw payload resend"
            );
            assert!(
                peer.index_puts.load(Ordering::SeqCst) <= 1,
                "no index resend"
            );
        }
    }
    #[tokio::test]
    async fn repair_accepted_index_then_readback_403_remains_ambiguous() {
        let (d, raw) = group();
        let peer = StatusPeer::new(StatusAt::AcceptedIndexReadback, &d);
        let record = raw
            .into_iter()
            .next()
            .unwrap()
            .prepare(&CatalogLimits::default().raw)
            .unwrap();
        *peer.raw.lock().unwrap() = Some((
            record.key,
            super::super::Object {
                metadata: record.metadata,
                length: record.body.len(),
                body: record.body,
            },
        ));
        let scope = RepairScope {
            catalog: d.partitions[0].clone(),
            periods: vec![d.members[0].envelope.identity.period.clone()],
        };
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        assert_eq!(
            store
                .repair(&scope, Instant::now() + std::time::Duration::from_secs(3))
                .await
                .unwrap_err(),
            Error::Ambiguous
        );
        assert_eq!(peer.index_puts.load(Ordering::SeqCst), 1);
        assert_eq!(
            peer.raw_puts.load(Ordering::SeqCst),
            0,
            "repair never resends raw"
        );
    }

    // RM-CLAUDE-011: statuses must be classified by request origin, not their number.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum OriginCase {
        SecondRead(u16),
        PreflightRead(u16),
        SecondPut403,
        RawPut403,
        RawReady403,
        PrewriteReady403,
        RawError403,
        Descriptor403,
        KnownConflict,
        FinalConflictRead412,
        LaterGroupRead(u16),
    }
    #[derive(Clone, Debug, PartialEq, Eq)]
    enum OriginEvent {
        Ready(Option<u16>),
        ControlGet(String, u16, usize),
        ControlPut(String, u16),
        RawPut(String, Option<u16>),
        RawGet(String, u16, usize),
        List(String),
    }
    struct OriginPeer {
        case: std::sync::Mutex<OriginCase>,
        ids: Vec<CatalogId>,
        descriptors: BTreeMap<String, Vec<u8>>,
        expected_raw: BTreeMap<String, super::super::Object>,
        controls: std::sync::Mutex<BTreeMap<String, Vec<u8>>>,
        raw: std::sync::Mutex<BTreeMap<String, super::super::Object>>,
        events: std::sync::Mutex<Vec<OriginEvent>>,
        ready_calls: AtomicUsize,
        index_acks: AtomicUsize,
        second_puts: AtomicUsize,
        faults: AtomicUsize,
        later_raw: Option<String>,
    }
    impl OriginPeer {
        fn new(
            groups: &[(GroupDeclaration, Vec<RawRecord>)],
            case: OriginCase,
            seed_orphans: bool,
        ) -> Arc<Self> {
            let limits = CatalogLimits::default();
            let mut ids = BTreeSet::new();
            let mut descriptors = BTreeMap::new();
            let mut expected_raw = BTreeMap::new();
            for (declaration, records) in groups {
                declaration.validate(&limits).unwrap();
                ids.extend(declaration.partitions.clone());
                let reference = declaration.reference(&limits).unwrap();
                assert!(
                    descriptors
                        .insert(
                            reference.descriptor_key().unwrap(),
                            declaration.bytes(&limits).unwrap()
                        )
                        .is_none()
                );
                for record in declaration.attach(records.clone(), &limits).unwrap() {
                    let prepared = record.prepare(&limits.raw).unwrap();
                    assert!(
                        expected_raw
                            .insert(
                                prepared.key,
                                super::super::Object {
                                    metadata: prepared.metadata,
                                    length: prepared.body.len(),
                                    body: prepared.body,
                                },
                            )
                            .is_none()
                    );
                }
            }
            let ids = ids.into_iter().collect::<Vec<_>>();
            let mut controls = if seed_orphans {
                descriptors.clone()
            } else {
                BTreeMap::new()
            };
            if matches!(
                case,
                OriginCase::KnownConflict | OriginCase::FinalConflictRead412
            ) {
                assert_eq!(ids.len(), 2);
                controls.insert(
                    ids[1].key(),
                    Catalog::empty(ids[1].clone()).bytes(&limits).unwrap(),
                );
            }
            let raw = if seed_orphans {
                expected_raw.clone()
            } else {
                BTreeMap::new()
            };
            let later_raw = if matches!(case, OriginCase::LaterGroupRead(_)) {
                assert_eq!(groups.len(), 2);
                assert!(
                    groups[0].0.reference(&limits).unwrap().group_sha256
                        < groups[1].0.reference(&limits).unwrap().group_sha256
                );
                Some(
                    groups[1].0.envelopes(&limits).unwrap()[0]
                        .identity
                        .object_key()
                        .unwrap(),
                )
            } else {
                None
            };
            Arc::new(Self {
                case: std::sync::Mutex::new(case),
                ids,
                descriptors,
                expected_raw,
                controls: std::sync::Mutex::new(controls),
                raw: std::sync::Mutex::new(raw),
                events: Default::default(),
                ready_calls: AtomicUsize::new(0),
                index_acks: AtomicUsize::new(0),
                second_puts: AtomicUsize::new(0),
                faults: AtomicUsize::new(0),
                later_raw,
            })
        }
        fn event(&self, event: OriginEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn etag(body: &[u8]) -> String {
            format!("\"{}\"", super::super::sha256(body))
        }
        fn assert_index(&self, id: &CatalogId, entries: &[Envelope]) {
            let controls = self.controls.lock().unwrap();
            let body = controls.get(&id.key()).expect("acknowledged index exists");
            let catalog = Catalog::from_bytes(body, id, &CatalogLimits::default()).unwrap();
            assert_eq!(catalog.entries, entries);
        }
        fn reset_after_rejection(&self, case: OriginCase) {
            // The previous future has returned; reuse the SAME peer/store, without a runtime setter.
            assert!(self.controls.lock().unwrap().is_empty());
            assert!(self.raw.lock().unwrap().is_empty());
            *self.case.lock().unwrap() = case;
            self.events.lock().unwrap().clear();
            self.ready_calls.store(0, Ordering::SeqCst);
            self.index_acks.store(0, Ordering::SeqCst);
            self.second_puts.store(0, Ordering::SeqCst);
            self.faults.store(0, Ordering::SeqCst);
        }
    }
    impl super::super::ObjectTransport for Arc<OriginPeer> {
        async fn ready(&self) -> Result<(), Error> {
            let call = self.ready_calls.fetch_add(1, Ordering::SeqCst) + 1;
            let case = *self.case.lock().unwrap();
            let fail = (case == OriginCase::PrewriteReady403 && call == 1)
                || (case == OriginCase::RawReady403 && call == 2);
            self.event(OriginEvent::Ready(fail.then_some(403)));
            if fail {
                Err(Error::Status(403))
            } else {
                Ok(())
            }
        }
        async fn put(&self, prepared: &super::super::PreparedRecord) -> Result<u16, Error> {
            let expected = self
                .expected_raw
                .get(&prepared.key)
                .expect("declared raw PUT");
            assert_eq!(prepared.body, expected.body);
            assert_eq!(prepared.metadata, expected.metadata);
            let case = *self.case.lock().unwrap();
            if case == OriginCase::RawError403 {
                self.event(OriginEvent::RawPut(prepared.key.clone(), None));
                return Err(Error::Status(403));
            }
            if case == OriginCase::RawPut403 {
                self.event(OriginEvent::RawPut(prepared.key.clone(), Some(403)));
                return Ok(403);
            }
            let mut raw = self.raw.lock().unwrap();
            assert!(!raw.contains_key(&prepared.key), "no unexpected raw resend");
            raw.insert(
                prepared.key.clone(),
                super::super::Object {
                    metadata: prepared.metadata.clone(),
                    length: prepared.body.len(),
                    body: prepared.body.clone(),
                },
            );
            self.event(OriginEvent::RawPut(prepared.key.clone(), Some(200)));
            Ok(200)
        }
        async fn head(&self, _: &str) -> Result<super::super::Object, Error> {
            panic!("no HEAD/reconciliation expected in these known-response traces")
        }
        async fn get(&self, key: &str, maximum: usize) -> Result<super::super::Object, Error> {
            assert!(self.expected_raw.contains_key(key), "declared raw GET");
            let acks = self.index_acks.load(Ordering::SeqCst);
            let case = *self.case.lock().unwrap();
            if let OriginCase::LaterGroupRead(status) = case
                && self.later_raw.as_deref() == Some(key)
                && acks > 0
            {
                self.faults.fetch_add(1, Ordering::SeqCst);
                self.event(OriginEvent::RawGet(key.into(), status, acks));
                return Err(Error::Status(status));
            }
            let object = self
                .raw
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .expect("seeded/written raw");
            assert!(object.body.len() <= maximum);
            self.event(OriginEvent::RawGet(key.into(), 200, acks));
            Ok(object)
        }
    }
    impl CatalogTransport for Arc<OriginPeer> {
        async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
            assert!(
                self.descriptors.contains_key(key) || self.ids.iter().any(|id| id.key() == key)
            );
            let acks = self.index_acks.load(Ordering::SeqCst);
            let is_second = self.ids.get(1).is_some_and(|id| id.key() == key);
            let case = *self.case.lock().unwrap();
            let fault = match case {
                OriginCase::SecondRead(status) if is_second && acks > 0 => Some(status),
                OriginCase::PreflightRead(status) if is_second && acks == 0 => Some(status),
                OriginCase::FinalConflictRead412
                    if is_second && self.second_puts.load(Ordering::SeqCst) == 4 =>
                {
                    Some(412)
                }
                _ => None,
            };
            if let Some(status) = fault {
                self.faults.fetch_add(1, Ordering::SeqCst);
                self.event(OriginEvent::ControlGet(key.into(), status, acks));
                return Err(Error::Status(status));
            }
            let body = self.controls.lock().unwrap().get(key).cloned();
            self.event(OriginEvent::ControlGet(
                key.into(),
                if body.is_some() { 200 } else { 404 },
                acks,
            ));
            match body {
                Some(body) => {
                    assert!(body.len() <= maximum);
                    Ok(ControlObject {
                        etag: OriginPeer::etag(&body),
                        body,
                        version: None,
                    })
                }
                None => Err(Error::NotFound),
            }
        }
        async fn put_control(
            &self,
            key: &str,
            body: &[u8],
            condition: &WriteCondition,
        ) -> Result<u16, Error> {
            let descriptor = self.descriptors.get(key);
            if let Some(expected) = descriptor {
                assert_eq!(body, expected);
            } else {
                let id = self
                    .ids
                    .iter()
                    .find(|id| id.key() == key)
                    .expect("declared index PUT");
                Catalog::from_bytes(body, id, &CatalogLimits::default()).unwrap();
            }
            let mut controls = self.controls.lock().unwrap();
            let matches = match (controls.get(key), condition) {
                (None, WriteCondition::Absent) => true,
                (Some(old), WriteCondition::Match(etag)) => *etag == OriginPeer::etag(old),
                _ => false,
            };
            assert!(
                matches,
                "test must not conceal an unexpected CAS condition/resend"
            );
            let case = *self.case.lock().unwrap();
            let is_second = self.ids.get(1).is_some_and(|id| id.key() == key);
            let status = if descriptor.is_some() && case == OriginCase::Descriptor403 {
                403
            } else if is_second {
                let attempt = self.second_puts.fetch_add(1, Ordering::SeqCst) + 1;
                match case {
                    OriginCase::SecondPut403 => {
                        assert_eq!(attempt, 1);
                        403
                    }
                    OriginCase::KnownConflict | OriginCase::FinalConflictRead412 => {
                        assert!(attempt <= 4, "fixed default CAS cap");
                        412
                    }
                    _ => 200,
                }
            } else {
                200
            };
            if status == 200 {
                assert!(
                    controls.insert(key.into(), body.to_vec()).is_none(),
                    "one accepted write per key"
                );
                if descriptor.is_none() {
                    self.index_acks.fetch_add(1, Ordering::SeqCst);
                }
            }
            self.event(OriginEvent::ControlPut(key.into(), status));
            Ok(status)
        }
        async fn list_raw_document(
            &self,
            prefix: &str,
            token: Option<&str>,
            maximum_keys: usize,
            cap: usize,
        ) -> Result<Vec<u8>, Error> {
            assert!(matches!(
                *self.case.lock().unwrap(),
                OriginCase::LaterGroupRead(_)
            ));
            assert!(token.is_none());
            let raw = self.raw.lock().unwrap();
            assert_eq!(raw.len(), 2);
            assert!(raw.len() <= maximum_keys);
            let mut body = format!(
                r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>{}</KeyCount>"#,
                raw.len()
            );
            for key in raw.keys() {
                assert!(key.starts_with(prefix));
                body.push_str(&format!("<Contents><Key>{key}</Key></Contents>"));
            }
            body.push_str("</ListBucketResult>");
            assert!(body.len() <= cap);
            self.event(OriginEvent::List(prefix.into()));
            Ok(body.into_bytes())
        }
    }
    fn origin_two_partitions() -> (GroupDeclaration, Vec<RawRecord>) {
        let (_, records) = group();
        let identity = &records[0].envelope.identity;
        let declaration = GroupDeclaration::new(
            vec![super::super::GroupMember {
                envelope: records[0].envelope.clone(),
                catalogs: vec![
                    CatalogId::for_record(identity, "owned-a").unwrap(),
                    CatalogId::for_record(identity, "owned-b").unwrap(),
                ],
            }],
            &CatalogLimits::default(),
        )
        .unwrap();
        assert_eq!(declaration.partitions.len(), 2);
        assert!(declaration.partitions[0] < declaration.partitions[1]);
        (declaration, records)
    }
    fn origin_deadline() -> Instant {
        Instant::now() + std::time::Duration::from_secs(3)
    }
    fn origin_publish_prefix(
        declaration: &GroupDeclaration,
        second_preflight: u16,
    ) -> Vec<OriginEvent> {
        vec![
            OriginEvent::Ready(None),
            OriginEvent::ControlGet(declaration.partitions[0].key(), 404, 0),
            OriginEvent::ControlGet(declaration.partitions[1].key(), second_preflight, 0),
        ]
    }
    fn origin_written_prefix(
        declaration: &GroupDeclaration,
        second_preflight: u16,
    ) -> Vec<OriginEvent> {
        let limits = CatalogLimits::default();
        let mut events = origin_publish_prefix(declaration, second_preflight);
        events.extend([
            OriginEvent::ControlPut(
                declaration
                    .reference(&limits)
                    .unwrap()
                    .descriptor_key()
                    .unwrap(),
                200,
            ),
            OriginEvent::Ready(None),
            OriginEvent::RawPut(
                declaration.envelopes(&limits).unwrap()[0]
                    .identity
                    .object_key()
                    .unwrap(),
                Some(200),
            ),
            OriginEvent::ControlGet(declaration.partitions[0].key(), 404, 0),
            OriginEvent::ControlPut(declaration.partitions[0].key(), 200),
        ]);
        events
    }
    fn origin_assert_late_read(peer: &OriginPeer, declaration: &GroupDeclaration, status: u16) {
        let mut expected = origin_written_prefix(declaration, 404);
        expected.push(OriginEvent::ControlGet(
            declaration.partitions[1].key(),
            status,
            1,
        ));
        assert_eq!(
            *peer.events.lock().unwrap(),
            expected,
            "setup/operation order, before error classification"
        );
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 1);
        assert_eq!(peer.second_puts.load(Ordering::SeqCst), 0);
        assert_eq!(peer.faults.load(Ordering::SeqCst), 1);
        peer.assert_index(
            &declaration.partitions[0],
            &declaration.envelopes(&CatalogLimits::default()).unwrap(),
        );
        assert!(
            !peer
                .controls
                .lock()
                .unwrap()
                .contains_key(&declaration.partitions[1].key())
        );
        assert_eq!(peer.raw.lock().unwrap().len(), 1);
    }
    async fn origin_publish_read(status: u16) {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(
            &[(declaration.clone(), records.clone())],
            OriginCase::SecondRead(status),
            false,
        );
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        origin_assert_late_read(&peer, &declaration, status);
        assert_eq!(
            error,
            Error::Ambiguous,
            "postwrite second partition GET{status}"
        );
    }
    async fn origin_preflight_read(status: u16) {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(
            &[(declaration.clone(), records.clone())],
            OriginCase::PreflightRead(status),
            false,
        );
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        assert_eq!(
            *peer.events.lock().unwrap(),
            origin_publish_prefix(&declaration, status)
        );
        assert!(peer.controls.lock().unwrap().is_empty());
        assert!(peer.raw.lock().unwrap().is_empty());
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 0);
        assert_eq!(peer.faults.load(Ordering::SeqCst), 1);
        assert_eq!(error, Error::Status(status));
    }
    async fn origin_raw_failure(case: OriginCase, expected_error: Error) {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(&[(declaration.clone(), records.clone())], case, false);
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        let mut expected = origin_publish_prefix(&declaration, 404);
        let descriptor = declaration
            .reference(&CatalogLimits::default())
            .unwrap()
            .descriptor_key()
            .unwrap();
        expected.push(OriginEvent::ControlPut(descriptor.clone(), 200));
        expected.push(OriginEvent::Ready(
            (case == OriginCase::RawReady403).then_some(403),
        ));
        if case != OriginCase::RawReady403 {
            let raw = declaration.envelopes(&CatalogLimits::default()).unwrap()[0]
                .identity
                .object_key()
                .unwrap();
            expected.push(OriginEvent::RawPut(
                raw,
                (case == OriginCase::RawPut403).then_some(403),
            ));
        }
        assert_eq!(
            *peer.events.lock().unwrap(),
            expected,
            "setup and raw failure origin"
        );
        assert_eq!(peer.controls.lock().unwrap().len(), 1);
        assert!(peer.controls.lock().unwrap().contains_key(&descriptor));
        assert!(peer.raw.lock().unwrap().is_empty());
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 0);
        assert_eq!(error, expected_error);
    }
    async fn origin_conflict(final_read_fails: bool) {
        let (declaration, records) = origin_two_partitions();
        assert_eq!(CatalogLimits::default().cas_attempts, 4);
        let case = if final_read_fails {
            OriginCase::FinalConflictRead412
        } else {
            OriginCase::KnownConflict
        };
        let peer = OriginPeer::new(&[(declaration.clone(), records.clone())], case, false);
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        let mut expected = origin_written_prefix(&declaration, 200);
        for _ in 0..4 {
            expected.push(OriginEvent::ControlGet(
                declaration.partitions[1].key(),
                200,
                1,
            ));
            expected.push(OriginEvent::ControlPut(
                declaration.partitions[1].key(),
                412,
            ));
        }
        expected.push(OriginEvent::ControlGet(
            declaration.partitions[1].key(),
            if final_read_fails { 412 } else { 200 },
            1,
        ));
        assert_eq!(
            *peer.events.lock().unwrap(),
            expected,
            "all known rejections before the final GET"
        );
        assert_eq!(peer.second_puts.load(Ordering::SeqCst), 4);
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 1);
        assert_eq!(
            peer.faults.load(Ordering::SeqCst),
            usize::from(final_read_fails)
        );
        peer.assert_index(
            &declaration.partitions[0],
            &declaration.envelopes(&CatalogLimits::default()).unwrap(),
        );
        peer.assert_index(&declaration.partitions[1], &[]);
        assert_eq!(
            error,
            if final_read_fails {
                Error::Ambiguous
            } else {
                Error::Status(412)
            }
        );
    }
    fn origin_two_groups() -> Vec<(GroupDeclaration, Vec<RawRecord>)> {
        let (first, records) = group();
        let limits = CatalogLimits::default();
        let record = RawRecord::new(
            "vc",
            "world-weather",
            &super::super::ProviderKey::Named {
                id: "owned-grid".into(),
            },
            Period {
                local_date: 20261019,
                slot: "all".into(),
            },
            2,
            200,
            "application/json",
            None,
            br#"{}"#.to_vec().into(),
            &limits.raw,
        )
        .unwrap();
        let second = GroupDeclaration::new(
            vec![super::super::GroupMember {
                envelope: record.envelope.clone(),
                catalogs: vec![CatalogId::for_record(&record.envelope.identity, "owned").unwrap()],
            }],
            &limits,
        )
        .unwrap();
        assert_eq!(first.partitions, second.partitions);
        let mut groups = vec![(first, records), (second, vec![record])];
        groups.sort_by_key(|(d, _)| d.reference(&limits).unwrap().group_sha256);
        assert_ne!(
            groups[0].0.reference(&limits).unwrap().group_sha256,
            groups[1].0.reference(&limits).unwrap().group_sha256
        );
        groups
    }
    async fn origin_repair_read(status: u16, materialize: bool) {
        let groups = origin_two_groups();
        let limits = CatalogLimits::default();
        let scope = RepairScope {
            catalog: groups[0].0.partitions[0].clone(),
            periods: vec![groups[0].0.members[0].envelope.identity.period.clone()],
        };
        let peer = OriginPeer::new(&groups, OriginCase::LaterGroupRead(status), true);
        let store = CatalogStore::new(peer.clone(), limits.clone()).unwrap();
        let result = if materialize {
            store.repair(&scope, origin_deadline()).await
        } else {
            store.repair_index(&scope, origin_deadline()).await
        };
        let mut descriptor_by_raw = BTreeMap::new();
        for (d, _) in &groups {
            descriptor_by_raw.insert(
                d.envelopes(&limits).unwrap()[0]
                    .identity
                    .object_key()
                    .unwrap(),
                d.reference(&limits).unwrap().descriptor_key().unwrap(),
            );
        }
        let raw_keys = descriptor_by_raw.keys().cloned().collect::<Vec<_>>();
        let prefix = format!("{}/", raw_keys[0].rsplit_once('/').unwrap().0);
        let first = groups[0].0.envelopes(&limits).unwrap()[0]
            .identity
            .object_key()
            .unwrap();
        let later = groups[1].0.envelopes(&limits).unwrap()[0]
            .identity
            .object_key()
            .unwrap();
        let mut expected = vec![OriginEvent::Ready(None), OriginEvent::List(prefix)];
        for key in &raw_keys {
            expected.push(OriginEvent::RawGet(key.clone(), 200, 0));
        }
        for key in &raw_keys {
            expected.push(OriginEvent::ControlGet(
                descriptor_by_raw[key].clone(),
                200,
                0,
            ));
        }
        expected.extend([
            OriginEvent::RawGet(first, 200, 0),
            OriginEvent::ControlGet(scope.catalog.key(), 404, 0),
            OriginEvent::ControlPut(scope.catalog.key(), 200),
            OriginEvent::RawGet(later, status, 1),
        ]);
        assert_eq!(
            *peer.events.lock().unwrap(),
            expected,
            "real discovery/group/write/later-read order before error assertion"
        );
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 1);
        assert_eq!(peer.faults.load(Ordering::SeqCst), 1);
        assert_eq!(peer.raw.lock().unwrap().len(), 2);
        assert_eq!(
            peer.controls.lock().unwrap().len(),
            3,
            "two seeded descriptors and exactly one written index"
        );
        peer.assert_index(&scope.catalog, &groups[0].0.envelopes(&limits).unwrap());
        assert_eq!(
            result.unwrap_err(),
            Error::Ambiguous,
            "later group GET{status}; materialize={materialize}"
        );
    }
    #[tokio::test]
    async fn status_origin_publish_second_get_503() {
        origin_publish_read(503).await;
    }
    #[tokio::test]
    async fn status_origin_publish_second_get_403() {
        origin_publish_read(403).await;
    }
    #[tokio::test]
    async fn status_origin_preflight_get_503() {
        origin_preflight_read(503).await;
    }
    #[tokio::test]
    async fn status_origin_preflight_get_403() {
        origin_preflight_read(403).await;
    }
    #[tokio::test]
    async fn status_origin_second_direct_put_403() {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(
            &[(declaration.clone(), records.clone())],
            OriginCase::SecondPut403,
            false,
        );
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        let mut expected = origin_written_prefix(&declaration, 404);
        expected.extend([
            OriginEvent::ControlGet(declaration.partitions[1].key(), 404, 1),
            OriginEvent::ControlPut(declaration.partitions[1].key(), 403),
        ]);
        assert_eq!(*peer.events.lock().unwrap(), expected);
        assert_eq!(peer.index_acks.load(Ordering::SeqCst), 1);
        assert_eq!(peer.second_puts.load(Ordering::SeqCst), 1);
        assert_eq!(peer.faults.load(Ordering::SeqCst), 0);
        peer.assert_index(
            &declaration.partitions[0],
            &declaration.envelopes(&CatalogLimits::default()).unwrap(),
        );
        assert!(
            !peer
                .controls
                .lock()
                .unwrap()
                .contains_key(&declaration.partitions[1].key())
        );
        assert_eq!(error, Error::Status(403));
    }
    #[tokio::test]
    async fn status_origin_raw_ready_status_is_not_put_evidence() {
        origin_raw_failure(OriginCase::RawReady403, Error::Ambiguous).await;
    }
    #[tokio::test]
    async fn status_origin_raw_transport_error_is_not_put_evidence() {
        origin_raw_failure(OriginCase::RawError403, Error::Ambiguous).await;
    }
    #[tokio::test]
    async fn status_origin_raw_direct_put_403() {
        origin_raw_failure(OriginCase::RawPut403, Error::Status(403)).await;
    }
    #[tokio::test]
    async fn status_origin_prewrite_ready_403() {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(
            &[(declaration.clone(), records.clone())],
            OriginCase::PrewriteReady403,
            false,
        );
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let error = store
            .publish(declaration, records, origin_deadline())
            .await
            .unwrap_err();
        assert_eq!(
            *peer.events.lock().unwrap(),
            vec![OriginEvent::Ready(Some(403))]
        );
        assert!(peer.controls.lock().unwrap().is_empty());
        assert!(peer.raw.lock().unwrap().is_empty());
        assert_eq!(error, Error::Status(403));
    }
    #[tokio::test]
    async fn status_origin_same_store_invocations_do_not_share_put_evidence() {
        let (declaration, records) = origin_two_partitions();
        let peer = OriginPeer::new(
            &[(declaration.clone(), records.clone())],
            OriginCase::Descriptor403,
            false,
        );
        let store = CatalogStore::new(peer.clone(), CatalogLimits::default()).unwrap();
        let first = store
            .publish(declaration.clone(), records.clone(), origin_deadline())
            .await
            .unwrap_err();
        let mut expected = origin_publish_prefix(&declaration, 404);
        expected.push(OriginEvent::ControlPut(
            declaration
                .reference(&CatalogLimits::default())
                .unwrap()
                .descriptor_key()
                .unwrap(),
            403,
        ));
        assert_eq!(*peer.events.lock().unwrap(), expected);
        assert_eq!(first, Error::Status(403));
        peer.reset_after_rejection(OriginCase::SecondRead(403));
        let second = store
            .publish(declaration.clone(), records, origin_deadline())
            .await
            .unwrap_err();
        origin_assert_late_read(&peer, &declaration, 403);
        assert_eq!(
            second,
            Error::Ambiguous,
            "previous invocation's terminal403 is not read provenance"
        );
    }
    #[tokio::test]
    async fn status_origin_known_cas_412_exhaustion() {
        origin_conflict(false).await;
    }
    #[tokio::test]
    async fn status_origin_final_get_412_is_not_cas_evidence() {
        origin_conflict(true).await;
    }
    #[tokio::test]
    async fn status_origin_repair_later_group_get_403() {
        origin_repair_read(403, true).await;
    }
    #[tokio::test]
    async fn status_origin_repair_later_group_get_503() {
        origin_repair_read(503, true).await;
    }
    #[tokio::test]
    async fn status_origin_repair_index_later_group_get_403() {
        origin_repair_read(403, false).await;
    }
    #[tokio::test]
    async fn status_origin_repair_index_later_group_get_503() {
        origin_repair_read(503, false).await;
    }
}
