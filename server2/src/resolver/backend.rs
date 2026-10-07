use super::{Error, OperationContext};
use crate::{
    cache::{ByteLease, ResponseKey},
    storage::*,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Semaphore;

#[derive(Clone, Debug, Serialize)]
pub enum ReadSelection {
    Earliest,
    Latest,
    FullHistory,
    Targeted(RecordId),
}
#[derive(Clone)]
pub struct ResolutionRequest {
    pub(super) response: ResponseKey,
    pub(super) scope: RepairScope,
    pub(super) selection: ReadSelection,
    pub(super) maximum_pages: usize,
    pub(super) maximum_bytes: usize,
    pub(super) ttl: Duration,
    pub(super) refresh: Duration,
}
impl ResolutionRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        response: ResponseKey,
        scope: RepairScope,
        selection: ReadSelection,
        maximum_pages: usize,
        maximum_bytes: usize,
        ttl: Duration,
        refresh: Duration,
    ) -> Result<Self, Error> {
        scope.catalog.validate()?;
        if scope.periods.is_empty()
            || scope.periods.len() > 16
            || maximum_pages == 0
            || maximum_pages > 64
            || maximum_bytes == 0
            || maximum_bytes > 32 * 1024 * 1024
            || ttl.is_zero()
            || ttl > Duration::from_secs(30 * 86400)
            || refresh.is_zero()
            || refresh > ttl
            || response.parser_revision().len() > 128
        {
            return Err(crate::storage::Error::Invalid("resolution policy").into());
        }
        let mut seen = BTreeSet::new();
        for p in &scope.periods {
            // Validate periods through the same identity contract, without persisting a new key.
            let identity = RecordId {
                source: scope.catalog.source.clone(),
                kind: scope.catalog.kind.clone(),
                key_sha256: scope.catalog.key_sha256.clone(),
                period: p.clone(),
                fetched_at_ms: 0,
                raw_sha256: "0".repeat(64),
            };
            identity.validate()?;
            if !seen.insert((p.local_date, p.slot.clone())) {
                return Err(crate::storage::Error::Invalid("duplicate scope period").into());
            }
        }
        if let ReadSelection::Targeted(id) = &selection {
            id.validate()?;
            if !scope.catalog.matches(id) || !scope.periods.contains(&id.period) {
                return Err(crate::storage::Error::Invalid("target outside owned scope").into());
            }
        }
        Ok(Self {
            response,
            scope,
            selection,
            maximum_pages,
            maximum_bytes,
            ttl,
            refresh,
        })
    }
    pub fn maximum_input_bytes(&self) -> usize {
        self.maximum_bytes
    }
    pub fn response_key(&self) -> &ResponseKey {
        &self.response
    }
    pub fn scope(&self) -> &RepairScope {
        &self.scope
    }
    pub fn selection(&self) -> &ReadSelection {
        &self.selection
    }
    pub fn fingerprint(&self) -> Result<String, Error> {
        let body = serde_json::to_vec(&(
            &self.response,
            &self.scope.catalog,
            &self.scope.periods,
            &self.selection,
            self.maximum_pages,
            self.maximum_bytes,
            self.ttl.as_nanos(),
            self.refresh.as_nanos(),
        ))
        .map_err(|_| crate::storage::Error::Invalid("request serialization"))?;
        Ok(sha256(&body))
    }
    pub(super) fn key_weight(&self) -> Result<usize, Error> {
        Ok(self.response.canonical()?.len()
            + serde_json::to_vec(&(&self.scope.catalog, &self.scope.periods, &self.selection))
                .map_err(|_| crate::storage::Error::Invalid("request weight"))?
                .len()
            + 256)
    }
}
/// Borrowed raw pages cannot escape the operation's byte lease as an uncharged Arc.
pub struct RawView<'a> {
    pub envelope: &'a Envelope,
    pub bytes: &'a [u8],
}
pub struct CheckedInput {
    pub(super) acquisitions: Vec<Vec<RawRecord>>,
    pub(super) dependencies: Vec<DependencyToken>,
    pub(super) full_history: bool,
    pub(super) excluded: usize,
}
impl CheckedInput {
    pub fn full_history(&self) -> bool {
        self.full_history
    }
    pub fn require_full_history(&self) -> Result<(), Error> {
        if self.full_history {
            Ok(())
        } else {
            Err(crate::storage::Error::Invalid("full revision coverage required").into())
        }
    }
    pub fn acquisitions(&self) -> impl Iterator<Item = Vec<RawView<'_>>> {
        self.acquisitions.iter().map(|a| {
            a.iter()
                .map(|r| RawView {
                    envelope: &r.envelope,
                    bytes: &r.bytes,
                })
                .collect()
        })
    }
    pub fn excluded_groups(&self) -> usize {
        self.excluded
    }
    fn from_page(page: &CompletePage) -> Self {
        Self {
            acquisitions: page
                .acquisitions()
                .iter()
                .map(|a| a.records().to_vec())
                .collect(),
            dependencies: page.dependencies().to_vec(),
            full_history: false,
            excluded: page.excluded_groups(),
        }
    }
}
pub(super) enum ColdOutcome {
    Input(CheckedInput),
    Empty,
}
struct SharedTransport<T>(Arc<T>);
impl<T: ObjectTransport> ObjectTransport for SharedTransport<T> {
    async fn put(&self, p: &PreparedRecord) -> Result<u16, crate::storage::Error> {
        self.0.put(p).await
    }
    async fn head(&self, k: &str) -> Result<Object, crate::storage::Error> {
        self.0.head(k).await
    }
    async fn get(&self, k: &str, m: usize) -> Result<Object, crate::storage::Error> {
        self.0.get(k, m).await
    }
}
impl<T: CatalogTransport> CatalogTransport for SharedTransport<T> {
    async fn get_control(&self, k: &str, m: usize) -> Result<ControlObject, crate::storage::Error> {
        self.0.get_control(k, m).await
    }
    async fn put_control(
        &self,
        k: &str,
        b: &[u8],
        c: &WriteCondition,
    ) -> Result<u16, crate::storage::Error> {
        self.0.put_control(k, b, c).await
    }
    async fn list_raw_document(
        &self,
        p: &str,
        t: Option<&str>,
        k: usize,
        b: usize,
    ) -> Result<Vec<u8>, crate::storage::Error> {
        self.0.list_raw_document(p, t, k, b).await
    }
}
pub struct CatalogBackend<T> {
    transport: Arc<T>,
    store: CatalogStore<SharedTransport<T>>,
    limits: CatalogLimits,
    io: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
}
impl<T: CatalogTransport> CatalogBackend<T> {
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        limits.validate()?;
        if limits.control_bytes > 1024 * 1024
            || limits.output_bytes > 32 * 1024 * 1024
            || limits.retained_control_bytes > 8 * 1024 * 1024
            || limits.raw.raw_bytes > 8 * 1024 * 1024
            || limits.raw.gzip_bytes > 8 * 1024 * 1024 + 65536
            || limits.members > 128
            || limits.partitions > 16
            || limits.entries > 2048
        {
            return Err(crate::storage::Error::Invalid("backend buffer bounds").into());
        }
        let transport = Arc::new(transport);
        Ok(Self {
            store: CatalogStore::new(SharedTransport(transport.clone()), limits.clone())?,
            transport,
            io: Arc::new(Semaphore::new(limits.io)),
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            limits,
        })
    }
    pub(super) async fn dependency(
        &self,
        old: &DependencyToken,
        context: &OperationContext,
        lease: Arc<ByteLease>,
    ) -> Result<DependencyToken, Error> {
        context.check()?;
        let _io = tokio::time::timeout_at(context.deadline(), self.io.clone().acquire_owned())
            .await
            .map_err(|_| crate::storage::Error::Timeout)?
            .map_err(|_| crate::storage::Error::Capacity)?;
        let id = old.identity.clone();
        let key = id.key();
        match self
            .transport
            .get_control(&key, self.limits.control_bytes)
            .await
        {
            Err(crate::storage::Error::NotFound) => Ok(DependencyToken {
                identity: id,
                generation: None,
                etag: None,
                version: None,
            }),
            Err(e) => Err(e.into()),
            Ok(object) => {
                let permit =
                    tokio::time::timeout_at(context.deadline(), self.cpu.clone().acquire_owned())
                        .await
                        .map_err(|_| crate::storage::Error::Timeout)?
                        .map_err(|_| crate::storage::Error::Capacity)?;
                let limits = self.limits.clone();
                tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    let _lease = lease;
                    let c = Catalog::from_bytes(&object.body, &id, &limits)?;
                    Ok(DependencyToken {
                        identity: id,
                        generation: Some(c.generation),
                        etag: Some(object.etag),
                        version: object.version,
                    })
                })
                .await
                .map_err(|_| Error::TaskFailed)?
            }
        }
    }
    pub(super) async fn cold(
        &self,
        r: &ResolutionRequest,
        c: &OperationContext,
    ) -> Result<ColdOutcome, Error> {
        c.check()?;
        // Always discover the owned finite scope on a cold operation, even with a healthy index.
        let repaired = self.store.repair(&r.scope, c.deadline()).await?;
        match repaired {
            RepairOutcome::CompleteEmpty { scope }
                if scope.catalog == r.scope.catalog && scope.periods == r.scope.periods =>
            {
                Ok(ColdOutcome::Empty)
            }
            RepairOutcome::CompleteEmpty { .. } | RepairOutcome::Incomplete => {
                Err(Error::Incomplete)
            }
            RepairOutcome::Complete(set) => {
                drop(set);
                Ok(ColdOutcome::Input(self.read(r, c).await?))
            }
            RepairOutcome::Indexed { .. } => Ok(ColdOutcome::Input(self.read(r, c).await?)),
        }
    }
    async fn read(
        &self,
        r: &ResolutionRequest,
        c: &OperationContext,
    ) -> Result<CheckedInput, Error> {
        if let ReadSelection::Targeted(member) = &r.selection {
            return match self
                .store
                .lookup_acquisition(&r.scope.catalog, member, c.deadline())
                .await?
            {
                PageOutcome::Ready(p) => {
                    let input = CheckedInput::from_page(&p);
                    self.validate_input(r, &input)?;
                    Ok(input)
                }
                PageOutcome::Incomplete => Err(Error::Incomplete),
            };
        }
        let order = if matches!(r.selection, ReadSelection::Latest) {
            ReadOrder::LatestFirst
        } else {
            ReadOrder::EarliestFirst
        };
        let mut result = CheckedInput {
            acquisitions: vec![],
            dependencies: vec![],
            full_history: false,
            excluded: 0,
        };
        let mut tokens = BTreeMap::new();
        let mut cursor = None;
        let mut bytes = 0usize;
        for _ in 0..r.maximum_pages {
            c.check()?;
            let page = match self
                .store
                .lookup_page(&r.scope.catalog, order, cursor.as_ref(), 1, c.deadline())
                .await?
            {
                PageOutcome::Ready(p) => p,
                PageOutcome::Incomplete => return Err(Error::Incomplete),
            };
            result.excluded = result.excluded.max(page.excluded_groups());
            for d in page.dependencies() {
                if let Some(old) = tokens.insert(d.identity.clone(), d.clone())
                    && old != *d
                {
                    return Err(Error::Incomplete);
                }
            }
            for a in page.acquisitions() {
                if !a
                    .records()
                    .iter()
                    .any(|record| r.scope.periods.contains(&record.envelope.identity.period))
                {
                    continue;
                }
                for record in a.records() {
                    bytes = bytes
                        .checked_add(record.bytes.len())
                        .ok_or(crate::storage::Error::Capacity)?;
                }
                if bytes > r.maximum_bytes {
                    return Err(crate::storage::Error::Capacity.into());
                }
                result.acquisitions.push(a.records().to_vec());
            }
            if (!matches!(r.selection, ReadSelection::FullHistory)
                && !result.acquisitions.is_empty())
                || page.next().is_none()
            {
                result.full_history = matches!(r.selection, ReadSelection::FullHistory);
                result.dependencies = tokens.into_values().collect();
                self.validate_input(r, &result)?;
                return if result.acquisitions.is_empty() {
                    Err(Error::Incomplete)
                } else {
                    Ok(result)
                };
            }
            cursor = page.next().cloned();
        }
        Err(crate::storage::Error::Capacity.into())
    }
    fn validate_input(&self, r: &ResolutionRequest, input: &CheckedInput) -> Result<(), Error> {
        let mut bytes = 0usize;
        for a in &input.acquisitions {
            if !a
                .iter()
                .any(|record| r.scope.periods.contains(&record.envelope.identity.period))
            {
                return Err(Error::Incomplete);
            }
            for record in a {
                let id = &record.envelope.identity;
                if id.source != r.scope.catalog.source
                    || id.kind != r.scope.catalog.kind
                    || id.key_sha256 != r.scope.catalog.key_sha256
                {
                    return Err(Error::Incomplete);
                }
                bytes = bytes
                    .checked_add(
                        record.bytes.len()
                            + serde_json::to_vec(&record.envelope)
                                .map_err(|_| {
                                    crate::storage::Error::Invalid("input envelope weight")
                                })?
                                .len()
                            + 128,
                    )
                    .ok_or(crate::storage::Error::Capacity)?;
            }
        }
        if bytes > r.maximum_bytes {
            return Err(crate::storage::Error::Capacity.into());
        }
        Ok(())
    }
    pub(super) async fn publish(
        &self,
        r: &ResolutionRequest,
        a: super::Acquisition,
        c: &OperationContext,
    ) -> Result<CheckedInput, Error> {
        c.check()?;
        a.declaration.validate(&self.limits)?;
        if a.records.is_empty() || a.records.len() != a.declaration.members.len() {
            return Err(crate::storage::Error::Invalid("acquisition membership").into());
        }
        let input = CheckedInput {
            acquisitions: vec![a.records.clone()],
            dependencies: vec![],
            full_history: false,
            excluded: 0,
        };
        self.validate_input(r, &input)?;
        if !a
            .declaration
            .members
            .iter()
            .any(|m| m.catalogs.contains(&r.scope.catalog))
        {
            return Err(crate::storage::Error::Invalid("acquisition catalog ownership").into());
        }
        // S06 verifies exact ordered membership/raw bytes before its first durable publication.
        self.store
            .publish(a.declaration, a.records, c.deadline())
            .await?;
        self.read(r, c).await
    }
}
