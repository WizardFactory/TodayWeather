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
                    .map_err(|_| StoreError::Storage(Error::LocalCapacity))?,
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
