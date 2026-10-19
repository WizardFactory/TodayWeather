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
    /// Explicit per-load CPU view; standalone implementations keep their old contract.
    fn load_with_cpu(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
        _cpu: Arc<crate::runtime_resources::CpuAdmission>,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        self.load(cell, now_ms, deadline)
    }
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
    cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    catalogs: Arc<CatalogStore<T>>,
    raw_limits: Limits,
    limits: CatalogLimits,
}
impl<T: CatalogTransport + 'static> CatalogAirStore<T> {
    /// S3 I/O is capped at 4 concurrent operations for this store.
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        Self::new_with_cpu(transport, limits, None)
    }
    pub fn new_with_cpu(
        transport: T,
        mut limits: CatalogLimits,
        cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> Result<Self, Error> {
        limits.io = limits.io.min(4);
        Ok(Self {
            raw_limits: limits.raw.clone(),
            catalogs: Arc::new(CatalogStore::new_with_cpu(
                transport,
                limits.clone(),
                cpu.clone(),
            )?),
            limits,
            cpu,
        })
    }
}
async fn load_one<T: CatalogTransport>(
    store: Arc<CatalogStore<T>>,
    id: CatalogId,
    day: u32,
    deadline: Instant,
) -> Result<Vec<AirRecord>, StoreError> {
    let store = Arc::new(store.local_invocation());
    let result = load_one_inner(store.clone(), id, day, deadline).await;
    result.map_err(|error| {
        if store.cpu_refused() {
            match error {
                StoreError::Storage(e) | StoreError::LocalPublication(e) => {
                    StoreError::LocalPublication(e)
                }
                StoreError::Incomplete | StoreError::LocalIncomplete => StoreError::LocalIncomplete,
            }
        } else {
            error
        }
    })
}
async fn load_one_inner<T: CatalogTransport>(
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
impl<T: CatalogTransport + 'static> CatalogAirStore<T> {
    fn load_inner(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
        cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        Box::pin(async move {
            let cpu = cpu.map(|cpu| cpu.observed_view());
            let store = match &cpu {
                Some(cpu) => Arc::new(
                    self.catalogs
                        .cpu_view(cpu.clone())
                        .map_err(StoreError::Storage)?,
                ),
                None => self.catalogs.clone(),
            };
            let mut pending = (days(now_ms)
                .into_iter()
                .flat_map(|day| {
                    AirProvider::ORDER
                        .into_iter()
                        .map(move |provider| (day, provider))
                })
                .collect::<Vec<_>>())
            .into_iter();
            let mut tasks = JoinSet::new();
            let spawn = |tasks: &mut JoinSet<Result<Vec<AirRecord>, StoreError>>,
                         (day, provider)|
             -> Result<(), StoreError> {
                let id = catalog(cell, provider, day).map_err(StoreError::Storage)?;
                let store = store.clone();
                tasks.spawn(crate::observability::inherit(async move {
                    load_one(store, id, day, deadline).await
                }));
                Ok(())
            };
            let mut first_error = None;
            let mut local_error = None;
            for _ in 0..LOAD_FANOUT {
                if let Some(next) = pending.next()
                    && let Err(e) = spawn(&mut tasks, next)
                {
                    first_error = Some(e);
                    break;
                }
            }
            let mut out = Vec::new();
            while !tasks.is_empty() {
                let joined = match tokio::time::timeout_at(deadline, tasks.join_next()).await {
                    Ok(Some(result)) => result.map_err(|_| StoreError::Incomplete),
                    Ok(None) => break,
                    Err(_) => {
                        tasks.abort_all();
                        while tasks.join_next().await.is_some() {}
                        if first_error.is_none() {
                            first_error = Some(StoreError::Storage(Error::Timeout));
                        }
                        break;
                    }
                };
                let result = joined.and_then(|r| r);
                match result {
                    Ok(rows) => {
                        out.extend(rows);
                        if first_error.is_none()
                            && let Some(next) = pending.next()
                            && let Err(e) = spawn(&mut tasks, next)
                        {
                            first_error = Some(e);
                        }
                    }
                    Err(error) => {
                        if error.local_capacity() && local_error.is_none() {
                            local_error = Some(error.clone());
                        }
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
            }
            if let Some(error) = local_error.or(first_error) {
                // The inner catalog deadline can win before the caller's timeout.
                // Inspect this exact load after admitted jobs have drained/aborted;
                // their interrupted CPU completion must not become a funded miss.
                return Err(if cpu.as_ref().is_some_and(|cpu| cpu.local_unavailable()) {
                    match error {
                        StoreError::Storage(e) | StoreError::LocalPublication(e) => {
                            StoreError::LocalPublication(e)
                        }
                        StoreError::Incomplete | StoreError::LocalIncomplete => {
                            StoreError::LocalIncomplete
                        }
                    }
                } else {
                    error
                });
            }

            Ok(out)
        })
    }
}
impl<T: CatalogTransport + 'static> AirStore for CatalogAirStore<T> {
    fn load(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        self.load_inner(cell, now_ms, deadline, self.cpu.clone())
    }
    fn load_with_cpu(
        &self,
        cell: AirCell,
        now_ms: f64,
        deadline: Instant,
        cpu: Arc<crate::runtime_resources::CpuAdmission>,
    ) -> BoxFuture<'_, Result<Vec<AirRecord>, StoreError>> {
        self.load_inner(cell, now_ms, deadline, Some(cpu))
    }
    fn publish(
        &self,
        cell: AirCell,
        record: AirRecord,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            let raw_limits = self.raw_limits.clone();
            let limits = self.limits.clone();
            let prepare = move || -> Result<_, Error> {
                let day =
                    utc_day(record.fetched_at_ms as f64).ok_or(Error::Invalid("fetch time"))?;
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
                    &raw_limits,
                )?;
                let id = CatalogId::for_record(&raw.envelope.identity, &day.to_string())?;
                let declaration = GroupDeclaration::new(
                    vec![GroupMember {
                        envelope: raw.envelope.clone(),
                        catalogs: vec![id],
                    }],
                    &limits,
                )?;
                Ok((declaration, raw))
            };
            let prepared = match &self.cpu {
                Some(cpu) => cpu
                    .run(
                        crate::operational_metrics::CpuKind::StorageControl,
                        deadline,
                        None,
                        prepare,
                    )
                    .await
                    .map_err(|e| {
                        StoreError::Storage(
                            if matches!(
                                e,
                                crate::runtime_resources::CpuFailure::Capacity
                                    | crate::runtime_resources::CpuFailure::Deadline
                            ) {
                                Error::LocalCapacity
                            } else {
                                Error::Transport
                            },
                        )
                    })?,
                None => prepare(),
            };
            let (declaration, raw) = prepared.map_err(StoreError::Storage)?;
            self.catalogs
                .publish_with_local_provenance(declaration, vec![raw], deadline)
                .await
                .map(|_| ())
                .map_err(|failure| {
                    if failure.local_capacity {
                        StoreError::LocalPublication(failure.error)
                    } else {
                        StoreError::Storage(failure.error)
                    }
                })
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
    metrics: Arc<crate::operational_metrics::S3Metrics>,
}
impl<T> Clone for BoundedS3<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            gate: self.gate.clone(),
            limit: self.limit,
            metrics: self.metrics.clone(),
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
            metrics: Arc::new(crate::operational_metrics::S3Metrics::default()),
        }
    }
    pub fn metrics(&self) -> Arc<crate::operational_metrics::S3Metrics> {
        self.metrics.clone()
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    /// Permits currently free (for tests and metrics).
    pub fn available(&self) -> usize {
        self.gate.available_permits()
    }
    /// One admission permit, for request kinds implemented outside this file (S16 summaries).
    pub(crate) async fn permit(
        &self,
        kind: crate::operational_metrics::S3Kind,
        payload: usize,
    ) -> Result<S3Permit<'_>, Error> {
        let mut metric = self.metrics.queued(kind);
        let permit = self.gate.acquire().await.map_err(|_| Error::Capacity)?;
        metric.admit(payload);
        Ok(S3Permit {
            _permit: permit,
            metric,
        })
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
        let mut permit = self
            .permit(
                crate::operational_metrics::S3Kind::RawPut,
                record.body.len(),
            )
            .await?;
        let result = self.inner.put(record).await;
        permit.metric.result(&result, |code| (Some(*code), 0));
        result
    }
    async fn head(&self, key: &str) -> Result<crate::storage::Object, Error> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::RawHead, 0)
            .await?;
        let result = self.inner.head(key).await;
        permit.metric.result(&result, |_| (Some(200), 0));
        result
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<crate::storage::Object, Error> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::RawGet, 0)
            .await?;
        let result = self.inner.get(key, maximum).await;
        permit
            .metric
            .result(&result, |object| (Some(200), object.body.len()));
        result
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
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::ControlGet, 0)
            .await?;
        let result = self.inner.get_control(key, maximum).await;
        permit
            .metric
            .result(&result, |object| (Some(200), object.body.len()));
        result
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &crate::storage::WriteCondition,
    ) -> Result<u16, Error> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::ControlPut, body.len())
            .await?;
        let result = self.inner.put_control(key, body, condition).await;
        permit.metric.result(&result, |code| (Some(*code), 0));
        result
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, Error> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::RawList, 0)
            .await?;
        let result = self
            .inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await;
        permit
            .metric
            .result(&result, |body| (Some(200), body.len()));
        result
    }
}
/// S14 index LISTs (and S15b catalog listings) under the same admission.
impl<T: crate::history::IndexListing + Send + Sync> crate::history::IndexListing for BoundedS3<T> {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<crate::storage::ListPage, Error> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::IndexList, 0)
            .await?;
        let result = self.inner.list_index(prefix, token).await;
        permit.metric.result(&result, |_| (Some(200), 0));
        result
    }
}
impl<T: crate::budget::BudgetTransport> crate::budget::BudgetTransport for BoundedS3<T> {
    async fn get_budget(
        &self,
        key: &str,
    ) -> Result<crate::budget::BudgetObject, crate::budget::BudgetError> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::BudgetGet, 0)
            .await
            .map_err(|_| crate::budget::BudgetError::Transport)?;
        let result = self.inner.get_budget(key).await;
        permit
            .metric
            .result(&result, |object| (Some(200), object.body.len()));
        result
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &crate::storage::WriteCondition,
    ) -> Result<u16, crate::budget::BudgetError> {
        let mut permit = self
            .permit(crate::operational_metrics::S3Kind::BudgetPut, body.len())
            .await
            .map_err(|_| crate::budget::BudgetError::Transport)?;
        let result = self.inner.put_budget(key, body, condition).await;
        permit.metric.result(&result, |code| (Some(*code), 0));
        result
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

pub(crate) struct S3Permit<'a> {
    _permit: tokio::sync::SemaphorePermit<'a>,
    pub(crate) metric: crate::operational_metrics::S3Guard,
}

#[cfg(test)]
mod shared_s3_metrics_tests {
    use super::*;
    use crate::storage::{
        CatalogTransport, ControlObject, Object, ObjectTransport, PreparedRecord, WriteCondition,
    };
    struct Peer {
        entered: tokio::sync::Notify,
        release: tokio::sync::Notify,
        order: Mutex<Vec<String>>,
    }
    impl ObjectTransport for Arc<Peer> {
        async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
            panic!("no PUT")
        }
        async fn head(&self, key: &str) -> Result<Object, Error> {
            self.order.lock().unwrap().push(key.into());
            Err(Error::NotFound)
        }
        async fn get(&self, key: &str, _: usize) -> Result<Object, Error> {
            self.order.lock().unwrap().push(key.into());
            Ok(Object {
                metadata: Default::default(),
                length: 4,
                body: vec![1, 2, 3, 4],
            })
        }
    }
    impl CatalogTransport for Arc<Peer> {
        async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
            self.order.lock().unwrap().push(key.into());
            if key == "first" {
                self.entered.notify_one();
                self.release.notified().await;
            }
            Ok(ControlObject {
                body: vec![1, 2, 3],
                etag: "\"owned\"".into(),
                version: None,
            })
        }
        async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
            panic!("no control PUT")
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            panic!("no LIST")
        }
    }
    async fn until(metrics: &crate::operational_metrics::S3Metrics, line: &str) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !metrics.render(1).lines().any(|v| v == line) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn actual_shared_fifo_preserves_survivor_order_and_classifies_queue_and_active_cancel() {
        let peer = Arc::new(Peer {
            entered: tokio::sync::Notify::new(),
            release: tokio::sync::Notify::new(),
            order: Mutex::new(Vec::new()),
        });
        let store = BoundedS3::new(peer.clone(), 1);
        let metrics = store.metrics();
        let first = store.clone();
        let first = tokio::spawn(async move { first.get_control("first", 10).await });
        peer.entered.notified().await;
        let second = store.clone();
        let second = tokio::spawn(async move { second.head("cancelled").await });
        until(&metrics, "server2_s3_queued{kind=\"raw_head\"} 1").await;
        let third = store.clone();
        let third = tokio::spawn(async move { third.get_control("third", 10).await });
        until(&metrics, "server2_s3_queued{kind=\"control_get\"} 1").await;
        let fourth = store.clone();
        let fourth = tokio::spawn(async move { fourth.get("fourth", 10).await });
        until(&metrics, "server2_s3_queued{kind=\"raw_get\"} 1").await;
        second.abort();
        let _ = second.await;
        first.abort();
        let _ = first.await;
        assert_eq!(third.await.unwrap().unwrap().body.len(), 3);
        assert_eq!(fourth.await.unwrap().unwrap().body.len(), 4);
        assert_eq!(&*peer.order.lock().unwrap(), &["first", "third", "fourth"]);
        let text = metrics.render(1);
        for line in [
            "server2_s3_queued_cancelled_total{kind=\"raw_head\"} 1",
            "server2_s3_active_cancelled_total{kind=\"control_get\"} 1",
            "server2_s3_terminal_total{kind=\"control_get\",outcome=\"unknown\"} 1",
            "server2_s3_returned_body_bytes_total{kind=\"control_get\"} 3",
            "server2_s3_returned_body_bytes_total{kind=\"raw_get\"} 4",
            "server2_s3_pool_queued 0",
            "server2_s3_pool_active 0",
        ] {
            assert!(text.lines().any(|v| v == line), "missing {line}");
        }
    }
}

#[cfg(test)]
mod load_provenance_tests {
    use super::*;
    use crate::{
        budget::{BudgetError, BudgetObject, BudgetTransport, Clock as BudgetClock},
        operational_metrics::CpuKind,
        runtime_resources::{CpuAdmission, CpuFailure},
        storage::{ControlObject, Object, ObjectTransport, PreparedRecord, WriteCondition},
        world::{
            AirConfig, AirFunding, AirHttpError, AirHttpRequest, AirHttpResponse, AirOutcome,
            AirProviderConfig, AirSource, AirTransport, FixedClock, LiveAir,
        },
    };
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::Duration,
    };
    const NOW: f64 = 1_792_411_200_000.;
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Case {
        Ambiguous,
        IndexedAbsent,
        OrdinaryIncomplete,
    }
    struct Pressure {
        release: std::sync::mpsc::Sender<()>,
        held: tokio::task::JoinHandle<Result<(), CpuFailure>>,
        queued: Vec<tokio::task::JoinHandle<Result<(), CpuFailure>>>,
    }
    impl Pressure {
        async fn start(cpu: Arc<CpuAdmission>) -> Self {
            let (start, ready) = tokio::sync::oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let held_cpu = cpu.clone();
            let held = tokio::spawn(async move {
                held_cpu
                    .immediate(CpuKind::Foundation, move || {
                        let _ = start.send(());
                        let _ = wait.recv();
                    })
                    .await
            });
            ready.await.unwrap();
            let mut queued = Vec::new();
            for _ in 0..16 {
                let cpu = cpu.clone();
                queued.push(tokio::spawn(async move {
                    cpu.run(
                        CpuKind::VcParse,
                        Instant::now() + Duration::from_secs(5),
                        None,
                        || (),
                    )
                    .await
                }));
            }
            while !cpu
                .render()
                .lines()
                .any(|l| l == "server2_cpu_pool_queued 16")
            {
                tokio::task::yield_now().await;
            }
            Self {
                release,
                held,
                queued,
            }
        }
        async fn stop(self) {
            for t in self.queued {
                t.abort();
                let _ = t.await;
            }
            let _ = self.release.send(());
            assert!(self.held.await.unwrap().is_ok());
        }
    }
    struct Peer {
        raw: PreparedRecord,
        control: Mutex<Option<Vec<u8>>>,
        cpu: Arc<CpuAdmission>,
        pressure: Mutex<Option<Pressure>>,
        puts: AtomicUsize,
        post_reads: AtomicUsize,
        third: AtomicUsize,
        case: Case,
        ordinary_first: bool,
        ordinary_done: AtomicUsize,
    }
    impl Peer {
        fn new(cpu: Arc<CpuAdmission>, case: Case, ordinary_first: bool) -> Arc<Self> {
            let cell = AirCell::of(37.5, 127.).unwrap();
            let day = utc_day(NOW).unwrap();
            let raw = RawRecord::new(
                AirProvider::Google.source(),
                KIND,
                &cell.key(),
                period(day),
                NOW as u64,
                200,
                "application/json",
                None,
                b"{}".to_vec().into(),
                &Limits::default(),
            )
            .unwrap()
            .prepare(&Limits::default())
            .unwrap();
            Arc::new(Self {
                raw,
                control: Mutex::new(None),
                cpu,
                pressure: Mutex::new(None),
                puts: AtomicUsize::new(0),
                post_reads: AtomicUsize::new(0),
                third: AtomicUsize::new(0),
                case,
                ordinary_first,
                ordinary_done: AtomicUsize::new(0),
            })
        }
        async fn stop(&self) {
            let pressure = { self.pressure.lock().unwrap().take() };
            if let Some(p) = pressure {
                p.stop().await;
            }
        }
    }
    impl ObjectTransport for Arc<Peer> {
        async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
            panic!("repair never republishes raw")
        }
        async fn head(&self, _: &str) -> Result<Object, Error> {
            Ok(Object {
                metadata: self.raw.metadata.clone(),
                length: self.raw.body.len(),
                body: Vec::new(),
            })
        }
        async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
            if self.case == Case::OrdinaryIncomplete {
                return Err(Error::NotFound);
            }
            Ok(Object {
                metadata: self.raw.metadata.clone(),
                length: self.raw.body.len(),
                body: self.raw.body.clone(),
            })
        }
    }
    impl CatalogTransport for Arc<Peer> {
        async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
            if key.contains(AirProvider::OpenWeather.source()) && self.case == Case::Ambiguous {
                while self.puts.load(Ordering::SeqCst) == 0 {
                    tokio::task::yield_now().await;
                }
                if !self.ordinary_first {
                    while !self.cpu.render().lines().any(|l| {
                        l.starts_with("server2_cpu_rejected_total{kind=\"storage_control\"}")
                            && !l.ends_with(" 0")
                    }) {
                        tokio::task::yield_now().await;
                    }
                }
                self.ordinary_done.store(1, Ordering::SeqCst);
                return Err(Error::Transport);
            }
            if key.contains(AirProvider::Waqi.source()) {
                self.third.fetch_add(1, Ordering::SeqCst);
                return Err(Error::NotFound);
            }
            if !key.contains(AirProvider::Google.source()) {
                return Err(Error::NotFound);
            }
            let bytes = { self.control.lock().unwrap().clone() };
            let Some(bytes) = bytes else {
                return Err(Error::NotFound);
            };
            let n = self.post_reads.fetch_add(1, Ordering::SeqCst);
            if self.case == Case::Ambiguous && self.ordinary_first {
                while self.ordinary_done.load(Ordering::SeqCst) == 0 {
                    tokio::task::yield_now().await;
                }
            }
            if self.case == Case::IndexedAbsent && n == 1 {
                self.stop().await;
            }
            if self.case == Case::IndexedAbsent && n >= 2 {
                return Err(Error::NotFound);
            }
            Ok(ControlObject {
                body: bytes,
                etag: "\"owned-index\"".into(),
                version: None,
            })
        }
        async fn put_control(
            &self,
            _: &str,
            body: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, Error> {
            *self.control.lock().unwrap() = Some(body.to_vec());
            let pressure = Pressure::start(self.cpu.clone()).await;
            *self.pressure.lock().unwrap() = Some(pressure);
            self.puts.fetch_add(1, Ordering::SeqCst);
            Ok(200)
        }
        async fn list_raw_document(
            &self,
            prefix: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            let inside = if prefix.contains(AirProvider::Google.source()) {
                format!(
                    "<KeyCount>1</KeyCount><Contents><Key>{}</Key></Contents>",
                    self.raw.key
                )
            } else {
                "<KeyCount>0</KeyCount>".into()
            };
            Ok(format!(r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>{inside}</ListBucketResult>"#).into_bytes())
        }
    }
    #[derive(Default)]
    struct Budget(AtomicUsize);
    impl BudgetTransport for Budget {
        async fn get_budget(&self, _: &str) -> Result<BudgetObject, BudgetError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(BudgetError::Transport)
        }
        async fn put_budget(
            &self,
            _: &str,
            _: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, BudgetError> {
            panic!("never fund")
        }
    }
    struct Clock;
    impl BudgetClock for Clock {
        fn now_ms(&self) -> Result<i64, BudgetError> {
            Ok(NOW as i64)
        }
    }
    #[derive(Default)]
    struct Http(AtomicUsize);
    impl AirTransport for Http {
        fn send(
            &self,
            _: AirHttpRequest,
            _: Instant,
        ) -> BoxFuture<'_, Result<AirHttpResponse, AirHttpError>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AirHttpError::Transport) })
        }
    }
    async fn check(case: Case, ordinary_first: bool) {
        let cpu = CpuAdmission::new(1);
        let peer = Peer::new(cpu.clone(), case, ordinary_first);
        let store = CatalogAirStore::new_with_cpu(
            peer.clone(),
            CatalogLimits::default(),
            Some(cpu.clone()),
        )
        .unwrap();
        let error = store
            .load(
                AirCell::of(37.5, 127.).unwrap(),
                NOW,
                Instant::now() + Duration::from_secs(2),
            )
            .await
            .unwrap_err();
        peer.stop().await;
        if case == Case::OrdinaryIncomplete {
            assert_eq!(error, StoreError::Incomplete);
            assert!(!error.local_capacity());
            return;
        }
        assert!(error.local_capacity(), "original cause was lost: {error:?}");
        if case == Case::Ambiguous {
            assert_eq!(error, StoreError::LocalPublication(Error::Ambiguous));
            assert_eq!(
                peer.third.load(Ordering::SeqCst),
                0,
                "no refill after first error"
            );
        } else {
            assert_eq!(
                error,
                StoreError::LocalIncomplete,
                "Indexed is not a serving CompleteSet"
            );
        }
        let cpu = CpuAdmission::new(1);
        let peer = Peer::new(cpu.clone(), case, ordinary_first);
        let store = Arc::new(
            CatalogAirStore::new_with_cpu(
                peer.clone(),
                CatalogLimits::default(),
                Some(cpu.clone()),
            )
            .unwrap(),
        );
        let budget = Arc::new(Budget::default());
        let http = Arc::new(Http::default());
        let config = AirConfig {
            google: Some(AirProviderConfig {
                base_url: "http://127.0.0.1:9/".into(),
                key: "S13A_LOCAL_GOOGLE_KEY".into(),
                quota_id: "d".repeat(64),
                monthly_units: 100,
                block_units: 10,
            }),
            ..AirConfig::default()
        };
        let air = LiveAir::new_with_cpu(
            config,
            store,
            http.clone(),
            AirFunding {
                transport: budget.clone(),
                clock: Arc::new(Clock),
            },
            Arc::new(FixedClock::new(NOW)),
            Some(cpu),
        )
        .unwrap();
        assert!(matches!(
            air.current(37.5, 127., NOW).await,
            AirOutcome::None
        ));
        peer.stop().await;
        assert_eq!(
            air.metrics().chains.load(Ordering::SeqCst),
            0,
            "no funded chain after load CPU refusal"
        );
        assert_eq!(budget.0.load(Ordering::SeqCst), 0);
        assert_eq!(http.0.load(Ordering::SeqCst), 0);
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn repair_local_cpu_cause_survives_either_fanout_error_order_without_funding() {
        check(Case::Ambiguous, true).await;
        check(Case::Ambiguous, false).await;
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn indexed_after_actual_cpu_refusal_then_incomplete_keeps_both_meanings() {
        check(Case::IndexedAbsent, true).await;
        check(Case::OrdinaryIncomplete, true).await;
    }
    struct EmptyPeer;
    impl ObjectTransport for EmptyPeer {
        async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
            panic!("read only")
        }
        async fn head(&self, _: &str) -> Result<Object, Error> {
            Err(Error::NotFound)
        }
        async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
            Err(Error::NotFound)
        }
    }
    impl CatalogTransport for EmptyPeer {
        async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
            Err(Error::NotFound)
        }
        async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
            panic!("empty scope")
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            Ok(br#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>"#.to_vec())
        }
    }
    #[tokio::test(start_paused = true)]
    async fn actual_air_store_outer_timeout_has_no_funding_or_cold_failure_ttl() {
        let cpu = CpuAdmission::new(1);
        let (start, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let held = cpu.clone();
        let blocker = tokio::spawn(async move {
            held.immediate(CpuKind::Foundation, move || {
                let _ = start.send(());
                let _ = wait.recv();
            })
            .await
        });
        ready.await.unwrap();
        let store = Arc::new(
            CatalogAirStore::new_with_cpu(EmptyPeer, CatalogLimits::default(), Some(cpu.clone()))
                .unwrap(),
        );
        let budget = Arc::new(Budget::default());
        let http = Arc::new(Http::default());
        let config = AirConfig {
            google: Some(AirProviderConfig {
                base_url: "http://127.0.0.1:9/".into(),
                key: "S13A_LOCAL_GOOGLE_KEY".into(),
                quota_id: "d".repeat(64),
                monthly_units: 100,
                block_units: 10,
            }),
            ..AirConfig::default()
        };
        assert_eq!(config.store_timeout, Duration::from_secs(2));
        let air = LiveAir::new_with_cpu(
            config,
            store,
            http.clone(),
            AirFunding {
                transport: budget.clone(),
                clock: Arc::new(Clock),
            },
            Arc::new(FixedClock::new(NOW)),
            Some(cpu.clone()),
        )
        .unwrap();
        let a = air.clone();
        let call = tokio::spawn(async move { a.current_with_reason(37.5, 127., NOW).await });
        while !cpu
            .render()
            .lines()
            .any(|l| l == "server2_cpu_pool_queued 2")
        {
            tokio::task::yield_now().await;
        }
        // Both the concrete catalog CPU deadline and the enclosing Air timeout become ready.
        tokio::time::advance(Duration::from_secs(2)).await;
        let outcome = call.await.unwrap();
        let counters = (
            air.metrics().chains.load(Ordering::SeqCst),
            budget.0.load(Ordering::SeqCst),
            http.0.load(Ordering::SeqCst),
        );
        let _ = release.send(());
        assert!(blocker.await.unwrap().is_ok());
        while cpu.available() == 0
            || !cpu
                .render()
                .lines()
                .any(|l| l == "server2_cpu_pool_queued 0")
        {
            tokio::task::yield_now().await;
        }
        assert!(matches!(
            outcome,
            (AirOutcome::None, Some("fallback-unavailable"))
        ));
        assert_eq!(
            counters,
            (0, 0, 0),
            "an outer CPU timeout is not a funded provider chain"
        );
        assert!(matches!(
            air.current(37.5, 127., NOW).await,
            AirOutcome::None
        ));
        assert_eq!(
            air.metrics().chains.load(Ordering::SeqCst),
            1,
            "cold load timeout installs no two-minute or local cooldown"
        );
        assert_eq!(budget.0.load(Ordering::SeqCst), 1);
        assert_eq!(http.0.load(Ordering::SeqCst), 0);
    }
    #[tokio::test(start_paused = true)]
    async fn actual_catalog_inner_deadline_retains_interrupted_cpu_cause() {
        use std::task::Poll;
        let cpu = CpuAdmission::new(1);
        let view = cpu.observed_view();
        let (start, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let held = cpu.clone();
        let blocker = tokio::spawn(async move {
            held.immediate(CpuKind::Foundation, move || {
                let _ = start.send(());
                let _ = wait.recv();
            })
            .await
        });
        ready.await.unwrap();
        let store =
            CatalogAirStore::new_with_cpu(EmptyPeer, CatalogLimits::default(), Some(cpu.clone()))
                .unwrap();
        let mut load = store.load_with_cpu(
            AirCell::of(37.5, 127.).unwrap(),
            NOW,
            Instant::now() + Duration::from_secs(2),
            view.clone(),
        );
        assert!(
            std::future::poll_fn(|cx| Poll::Ready(load.as_mut().poll(cx)))
                .await
                .is_pending()
        );
        while !cpu
            .render()
            .lines()
            .any(|l| l == "server2_cpu_pool_queued 2")
        {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_secs(2)).await;
        let error = load.await.unwrap_err();
        let interrupted = view.local_unavailable();
        let cancelled = cpu.render().lines().any(|l| {
            l.starts_with("server2_cpu_queued_cancelled_total{kind=\"storage_control\"}")
                && !l.ends_with(" 0")
        });
        let _ = release.send(());
        assert!(blocker.await.unwrap().is_ok());
        assert!(
            cancelled,
            "inner load deadline aborts admitted child futures before their CPU result is polled"
        );
        assert!(
            interrupted,
            "actual scoped CPU interruption remains after queue retirement"
        );
        assert!(
            error.local_capacity(),
            "inner-first timeout must retain its original error and local cause: {error:?}"
        );
        assert_eq!(error, StoreError::LocalPublication(Error::Timeout));
    }
    #[tokio::test(start_paused = true)]
    async fn actual_catalog_outer_deadline_drops_cpu_children_before_inspection() {
        let cpu = CpuAdmission::new(1);
        let view = cpu.observed_view();
        let (start, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let held = cpu.clone();
        let blocker = tokio::spawn(async move {
            held.immediate(CpuKind::Foundation, move || {
                let _ = start.send(());
                let _ = wait.recv();
            })
            .await
        });
        ready.await.unwrap();
        let store =
            CatalogAirStore::new_with_cpu(EmptyPeer, CatalogLimits::default(), Some(cpu.clone()))
                .unwrap();
        let observed = view.clone();
        let call = tokio::spawn(async move {
            let now = Instant::now();
            tokio::time::timeout_at(
                now + Duration::from_secs(1),
                store.load_with_cpu(
                    AirCell::of(37.5, 127.).unwrap(),
                    NOW,
                    now + Duration::from_secs(2),
                    observed,
                ),
            )
            .await
        });
        while !cpu
            .render()
            .lines()
            .any(|l| l == "server2_cpu_pool_queued 2")
        {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_secs(1)).await;
        let timeout = call.await.unwrap();
        while !cpu
            .render()
            .lines()
            .any(|l| l == "server2_cpu_pool_queued 0")
        {
            tokio::task::yield_now().await;
        }
        let local = view.local_unavailable();
        let _ = release.send(());
        assert!(blocker.await.unwrap().is_ok());
        assert!(timeout.is_err());
        assert!(
            local,
            "actual outer drop retains interrupted CPU without an active queue"
        );
    }
}
