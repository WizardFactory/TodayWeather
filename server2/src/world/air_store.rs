//! Durable raw air provider bodies per legacy air cell through S05/S06 (S13a).
//! The key is the `toFixed(2)` grid cell (AK decision 2026-10-13: provider station or grid,
//! never the precise user coordinate); keys, catalogs and metadata carry nothing else.
use super::{air::AirProvider, js, store::StoreError};
use crate::{
    gateway::BoxFuture,
    storage::{
        CatalogId, CatalogLimits, CatalogStore, CatalogTransport, Error, GroupDeclaration,
        GroupMember, Limits, LookupOutcome, Period, ProviderKey, RawRecord, RepairOutcome,
        RepairScope,
    },
};
use std::sync::{Arc, Mutex};
use tokio::{sync::Semaphore, task::JoinSet, time::Instant};

pub const KIND: &str = "current";
const SLOT: &str = "current";
const DAY_MS: f64 = 86_400_000.;
/// Legacy `CACHE_TTL_MS`: a stored observation serves requests for 30 minutes.
pub const TTL_MS: f64 = 30. * 60_000.;
/// Concurrent catalog reads per load (the S3 peer and S3 connection pools are bounded).
const LOAD_FANOUT: usize = 2;

/// Legacy `airFallback._cellOf`: `Number(v).toFixed(2)` per axis, held as hundredths.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AirCell {
    lat: i32,
    lon: i32,
}
impl AirCell {
    pub fn of(lat: f64, lon: f64) -> Option<Self> {
        let axis = |v: f64| -> Option<i32> {
            if !v.is_finite() || v.abs() > 1000. {
                return None;
            }
            Some((js::fixed(v, 2) * 100.).round() as i32)
        };
        Some(Self {
            lat: axis(lat)?,
            lon: axis(lon)?,
        })
    }
    /// The cell latitude sent to providers (`Number(toFixed(2))`).
    pub fn lat(self) -> f64 {
        f64::from(self.lat) / 100.
    }
    pub fn lon(self) -> f64 {
        f64::from(self.lon) / 100.
    }
    /// Record key token, for example `air-p3568-p13976` or `air-n3387-n15121`.
    pub fn id(self) -> String {
        let part = |v: i32| format!("{}{}", if v < 0 { 'n' } else { 'p' }, v.unsigned_abs());
        format!("air-{}-{}", part(self.lat), part(self.lon))
    }
    pub fn key(self) -> ProviderKey {
        ProviderKey::Named { id: self.id() }
    }
}
/// One stored provider body (exact bytes) for a cell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AirRecord {
    pub provider: AirProvider,
    pub fetched_at_ms: u64,
    pub content_type: String,
    pub body: Arc<[u8]>,
}
pub trait AirStore: Send + Sync + 'static {
    /// Every durable record of the cell fetched on the UTC days of `now - 30 min` and `now`.
    fn load(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>>;
    /// Raw PUT and catalog publication; Ok only after the group is acknowledged (O-9).
    fn publish(
        &self,
        cell: AirCell,
        record: AirRecord,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>>;
}
/// UTC civil day `YYYYMMDD` of a time value.
fn utc_day(ms: f64) -> Option<u32> {
    let p = js::parts((ms / DAY_MS).floor() * DAY_MS)?;
    Some((p.year * 10000 + p.month * 100 + p.day) as u32)
}
/// Days that can hold a record still valid at `now`.
pub fn days(now_ms: f64) -> Vec<u32> {
    let mut out: Vec<u32> = [now_ms - TTL_MS, now_ms]
        .into_iter()
        .filter_map(utc_day)
        .collect();
    out.dedup();
    out
}
fn period(day: u32) -> Period {
    Period {
        local_date: day,
        slot: SLOT.into(),
    }
}
fn catalog(cell: AirCell, provider: AirProvider, day: u32) -> Result<CatalogId, Error> {
    let id = CatalogId {
        source: provider.source().into(),
        kind: KIND.into(),
        key_sha256: crate::storage::sha256(&cell.key().canonical_bytes()?),
        partition: day.to_string(),
    };
    id.validate()?;
    Ok(id)
}
fn records(set: &crate::storage::CompleteSet) -> Vec<AirRecord> {
    let mut out = Vec::new();
    for a in set.acquisitions() {
        for r in a.records() {
            let id = &r.envelope.identity;
            if let Some(provider) = AirProvider::from_source(&id.source) {
                out.push(AirRecord {
                    provider,
                    fetched_at_ms: id.fetched_at_ms,
                    content_type: r.envelope.content_type.clone(),
                    body: r.bytes.clone(),
                });
            }
        }
    }
    out
}
/// S06-backed store. An absent catalog is proved empty only by a complete one-period repair.
pub struct CatalogAirStore<T> {
    catalogs: Arc<CatalogStore<T>>,
    raw_limits: Limits,
    limits: CatalogLimits,
}
impl<T: CatalogTransport + 'static> CatalogAirStore<T> {
    /// S3 I/O is capped at 4 concurrent operations for this store.
    pub fn new(transport: T, mut limits: CatalogLimits) -> Result<Self, Error> {
        limits.io = limits.io.min(4);
        Ok(Self {
            raw_limits: limits.raw.clone(),
            catalogs: Arc::new(CatalogStore::new(transport, limits.clone())?),
            limits,
        })
    }
}
async fn load_one<T: CatalogTransport>(
    store: Arc<CatalogStore<T>>,
    id: CatalogId,
    day: u32,
    deadline: Instant,
) -> Result<Vec<AirRecord>, StoreError> {
    if let LookupOutcome::Ready(set) = store
        .lookup(&id, deadline)
        .await
        .map_err(StoreError::Storage)?
    {
        return Ok(records(&set));
    }
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![period(day)],
    };
    match store
        .repair(&scope, deadline)
        .await
        .map_err(StoreError::Storage)?
    {
        RepairOutcome::Complete(set) => Ok(records(&set)),
        RepairOutcome::CompleteEmpty { .. } => Ok(Vec::new()),
        RepairOutcome::Indexed { .. } => match store
            .lookup(&id, deadline)
            .await
            .map_err(StoreError::Storage)?
        {
            LookupOutcome::Ready(set) => Ok(records(&set)),
            LookupOutcome::Incomplete => Err(StoreError::Incomplete),
        },
        RepairOutcome::Incomplete => Err(StoreError::Incomplete),
    }
}
impl<T: CatalogTransport + 'static> AirStore for CatalogAirStore<T> {
    fn load(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        Box::pin(async move {
            let gate = Arc::new(Semaphore::new(LOAD_FANOUT));
            let mut tasks = JoinSet::new();
            for day in days(now_ms) {
                for provider in AirProvider::ORDER {
                    let id = catalog(cell, provider, day).map_err(StoreError::Storage)?;
                    let (store, gate) = (self.catalogs.clone(), gate.clone());
                    tasks.spawn(crate::observability::inherit(async move {
                        let _slot = gate
                            .acquire_owned()
                            .await
                            .map_err(|_| StoreError::Incomplete)?;
                        load_one(store, id, day, deadline).await
                    }));
                }
            }
            let mut out = Vec::new();
            while let Some(joined) = tasks.join_next().await {
                out.extend(joined.map_err(|_| StoreError::Incomplete)??);
            }
            Ok(out)
        })
    }
    fn publish(
        &self,
        cell: AirCell,
        record: AirRecord,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            let day = utc_day(record.fetched_at_ms as f64)
                .ok_or(StoreError::Storage(Error::Invalid("fetch time")))?;
            let raw = RawRecord::new(
                record.provider.source(),
                KIND,
                &cell.key(),
                period(day),
                record.fetched_at_ms,
                200,
                &record.content_type,
                None,
                record.body.clone(),
                &self.raw_limits,
            )
            .map_err(StoreError::Storage)?;
            let id = CatalogId::for_record(&raw.envelope.identity, &day.to_string())
                .map_err(StoreError::Storage)?;
            let declaration = GroupDeclaration::new(
                vec![GroupMember {
                    envelope: raw.envelope.clone(),
                    catalogs: vec![id],
                }],
                &self.limits,
            )
            .map_err(StoreError::Storage)?;
            self.catalogs
                .publish(declaration, vec![raw], deadline)
                .await
                .map(|_| ())
                .map_err(StoreError::Storage)
        })
    }
}
/// One S3 admission shared by the world weather store, the air store and the S08 budgets of
/// a process (S13a-R1-F02): every object, control, list and budget request holds a permit, so
/// the combined in-flight S3 requests never exceed `limit` (the loopback S3 test peer drops
/// connections beyond 16).
pub struct BoundedS3<T> {
    inner: Arc<T>,
    gate: Arc<Semaphore>,
    limit: usize,
}
impl<T> Clone for BoundedS3<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            gate: self.gate.clone(),
            limit: self.limit,
        }
    }
}
impl<T> BoundedS3<T> {
    pub fn new(inner: T, limit: usize) -> Self {
        let limit = limit.max(1);
        Self {
            inner: Arc::new(inner),
            gate: Arc::new(Semaphore::new(limit)),
            limit,
        }
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    /// Permits currently free (for tests and metrics).
    pub fn available(&self) -> usize {
        self.gate.available_permits()
    }
    /// One admission permit, for request kinds implemented outside this file (S16 summaries).
    pub(crate) async fn permit(&self) -> Result<tokio::sync::SemaphorePermit<'_>, Error> {
        self.gate.acquire().await.map_err(|_| Error::Capacity)
    }
    /// The admitted transport.
    pub(crate) fn inner(&self) -> &T {
        &self.inner
    }
}
impl<T: crate::storage::ObjectTransport> crate::storage::ObjectTransport for BoundedS3<T> {
    fn raw_cache(&self) -> Option<Arc<crate::cache::disk::DiskCache>> {
        self.inner.raw_cache()
    }
    async fn put(&self, record: &crate::storage::PreparedRecord) -> Result<u16, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.put(record).await
    }
    async fn head(&self, key: &str) -> Result<crate::storage::Object, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.head(key).await
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<crate::storage::Object, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.get(key, maximum).await
    }
    /// Credentials only; no S3 request, so no admission permit.
    async fn ready(&self) -> Result<(), Error> {
        self.inner.ready().await
    }
}
impl<T: CatalogTransport> CatalogTransport for BoundedS3<T> {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<crate::storage::ControlObject, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.get_control(key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &crate::storage::WriteCondition,
    ) -> Result<u16, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
}
/// S14 index LISTs (and S15b catalog listings) under the same admission.
impl<T: crate::history::IndexListing + Send + Sync> crate::history::IndexListing for BoundedS3<T> {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<crate::storage::ListPage, Error> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        self.inner.list_index(prefix, token).await
    }
}
impl<T: crate::budget::BudgetTransport> crate::budget::BudgetTransport for BoundedS3<T> {
    async fn get_budget(
        &self,
        key: &str,
    ) -> Result<crate::budget::BudgetObject, crate::budget::BudgetError> {
        let _permit = self
            .gate
            .acquire()
            .await
            .map_err(|_| crate::budget::BudgetError::Transport)?;
        self.inner.get_budget(key).await
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &crate::storage::WriteCondition,
    ) -> Result<u16, crate::budget::BudgetError> {
        let _permit = self
            .gate
            .acquire()
            .await
            .map_err(|_| crate::budget::BudgetError::Transport)?;
        self.inner.put_budget(key, body, condition).await
    }
}
/// Volatile in-process store for tests and examples; not a durable store.
#[derive(Default)]
pub struct MemoryAirStore {
    rows: Mutex<Vec<(AirCell, AirRecord)>>,
    fail: Mutex<bool>,
}
impl MemoryAirStore {
    pub fn set_failing(&self, failing: bool) {
        *self.fail.lock().unwrap_or_else(|e| e.into_inner()) = failing;
    }
    pub fn all(&self) -> Vec<(AirCell, AirRecord)> {
        self.rows.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}
impl AirStore for MemoryAirStore {
    fn load(
        &self,
        cell: AirCell,
        now_ms: f64,
        _: Instant,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        Box::pin(async move {
            if *self.fail.lock().unwrap_or_else(|e| e.into_inner()) {
                return Err(StoreError::Storage(Error::Transport));
            }
            let wanted = days(now_ms);
            Ok(self
                .rows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .filter(|(c, r)| {
                    *c == cell
                        && utc_day(r.fetched_at_ms as f64).is_some_and(|d| wanted.contains(&d))
                })
                .map(|(_, r)| r.clone())
                .collect())
        })
    }
    fn publish(
        &self,
        cell: AirCell,
        record: AirRecord,
        _: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            if *self.fail.lock().unwrap_or_else(|e| e.into_inner()) {
                return Err(StoreError::Storage(Error::Ambiguous));
            }
            self.rows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((cell, record));
            Ok(())
        })
    }
}
