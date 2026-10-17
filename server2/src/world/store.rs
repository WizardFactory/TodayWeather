//! Durable raw Visual Crossing fetches per 0.02-degree cell through S05/S06.
//! Keys, catalogs and metadata contain the cell identity only, never a request coordinate.
use super::{Cell, Range};
use crate::{
    gateway::BoxFuture,
    storage::{
        CatalogId, CatalogLimits, CatalogStore, CatalogTransport, Error, GroupDeclaration,
        GroupMember, Limits, LookupOutcome, Period, ProviderKey, RawRecord, RepairOutcome,
        RepairScope,
    },
};
use std::sync::{Arc, Mutex};
use tokio::{task::JoinSet, time::Instant};

pub const SOURCE: &str = "vc";
pub const KIND: &str = "timeline";
const DAY_MS: i64 = 86_400_000;
const LOAD_FANOUT: usize = 4;

/// One complete raw provider acquisition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawFetch {
    pub fetched_at_ms: u64,
    pub range: Range,
    /// First provider-local date covered (`days[0].datetime`) as YYYYMMDD.
    pub first_date: u32,
    pub body: Arc<[u8]>,
    pub sha256: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// The scope could not be read completely; absence is not proved.
    Incomplete,
    Storage(Error),
}
pub trait WorldStore: Send + Sync + 'static {
    /// Every durable fetch that can affect a request at `now_ms` (the legacy 48 h decision window).
    fn load(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>>;
    /// Complete raw PUT and catalog publication; Ok only after the group is acknowledged.
    fn publish(
        &self,
        cell: Cell,
        fetch: RawFetch,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>>;
}
fn civil_date(ms: i64) -> u32 {
    let days = ms.div_euclid(DAY_MS);
    let p = super::js::parts(days as f64 * DAY_MS as f64).expect("bounded date");
    (p.year * 10000 + p.month * 100 + p.day) as u32
}
/// Partitions (first local date, range) that can hold fetches made within 48 h of `now`.
/// A body's first date need not match its requested range (for example a `combined` reply
/// without yesterday), so every range is read over the whole first-date window D-5..D+1.
pub fn partitions(now_ms: f64) -> Vec<(u32, Range)> {
    let d = now_ms.floor() as i64;
    let mut out = Vec::new();
    for range in [Range::Combined, Range::Recent, Range::Forecast] {
        for shift in -5..=1 {
            out.push((civil_date(d + shift * DAY_MS), range));
        }
    }
    out
}
pub fn provider_key(cell: Cell) -> ProviderKey {
    ProviderKey::WorldCell {
        lat_hundredths: (cell.lat * 100.).round() as i16,
        lon_hundredths: (cell.lon * 100.).round() as i16,
    }
}
pub fn period(first_date: u32, range: Range) -> Period {
    Period {
        local_date: first_date,
        slot: range.as_str().into(),
    }
}
fn partition(first_date: u32, range: Range) -> String {
    format!("{first_date}-{}", range.as_str())
}
fn record(cell: Cell, fetch: &RawFetch, limits: &Limits) -> Result<RawRecord, Error> {
    RawRecord::new(
        SOURCE,
        KIND,
        &provider_key(cell),
        period(fetch.first_date, fetch.range),
        fetch.fetched_at_ms,
        200,
        "application/json",
        None,
        fetch.body.clone(),
        limits,
    )
}
fn catalog(cell: Cell, first_date: u32, range: Range) -> Result<CatalogId, Error> {
    let key_sha256 = crate::storage::sha256(&provider_key(cell).canonical_bytes()?);
    let id = CatalogId {
        source: SOURCE.into(),
        kind: KIND.into(),
        key_sha256,
        partition: partition(first_date, range),
    };
    id.validate()?;
    Ok(id)
}
fn fetches(set: &crate::storage::CompleteSet) -> Vec<RawFetch> {
    let mut out = Vec::new();
    for a in set.acquisitions() {
        for r in a.records() {
            let id = &r.envelope.identity;
            if let Some(range) = Range::parse(&id.period.slot) {
                out.push(RawFetch {
                    fetched_at_ms: id.fetched_at_ms,
                    range,
                    first_date: id.period.local_date,
                    body: r.bytes.clone(),
                    sha256: id.raw_sha256.clone(),
                });
            }
        }
    }
    out
}
/// S06-backed store. Absent catalogs are proved empty only by a complete one-period repair.
pub struct CatalogWorldStore<T> {
    catalogs: Arc<CatalogStore<T>>,
    raw_limits: Limits,
}
impl<T: CatalogTransport + 'static> CatalogWorldStore<T> {
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        let raw_limits = limits.raw.clone();
        Ok(Self {
            catalogs: Arc::new(CatalogStore::new(transport, limits)?),
            raw_limits,
        })
    }
    /// Every stored fetch of `cell` whose first local date is in `first_dates` (all ranges),
    /// in `(fetched_at_ms, sha256)` order. S16 derives VC summaries from them.
    pub async fn load_first_dates(
        &self,
        cell: Cell,
        first_dates: &[u32],
        deadline: Instant,
    ) -> Result<Vec<RawFetch>, StoreError> {
        let mut out = Vec::new();
        for &date in first_dates {
            for range in [Range::Combined, Range::Recent, Range::Forecast] {
                let id = catalog(cell, date, range).map_err(StoreError::Storage)?;
                out.extend(
                    load_partition(
                        self.catalogs.clone(),
                        id,
                        period(date, range),
                        deadline,
                        true,
                    )
                    .await?,
                );
            }
        }
        out.sort_by(|a, b| (a.fetched_at_ms, &a.sha256).cmp(&(b.fetched_at_ms, &b.sha256)));
        Ok(out)
    }
}
async fn load_partition<T: CatalogTransport>(
    store: Arc<CatalogStore<T>>,
    id: CatalogId,
    period: Period,
    deadline: Instant,
    strict: bool,
) -> Result<Vec<RawFetch>, StoreError> {
    // S16 (`strict`): a group S06 excluded (not eligible, raw body missing) makes the read
    // partial; world serving keeps the eligible groups.
    let take = |set: &crate::storage::CompleteSet| {
        if strict && set.excluded_groups() > 0 {
            Err(StoreError::Incomplete)
        } else {
            Ok(fetches(set))
        }
    };
    match store
        .lookup(&id, deadline)
        .await
        .map_err(StoreError::Storage)?
    {
        LookupOutcome::Ready(set) => return take(&set),
        LookupOutcome::Incomplete => (),
    }
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![period],
    };
    match store
        .repair(&scope, deadline)
        .await
        .map_err(StoreError::Storage)?
    {
        RepairOutcome::Complete(set) => take(&set),
        RepairOutcome::CompleteEmpty { .. } => Ok(Vec::new()),
        RepairOutcome::Indexed { .. } => match store
            .lookup(&id, deadline)
            .await
            .map_err(StoreError::Storage)?
        {
            LookupOutcome::Ready(set) => take(&set),
            LookupOutcome::Incomplete => Err(StoreError::Incomplete),
        },
        RepairOutcome::Incomplete => Err(StoreError::Incomplete),
    }
}
impl<T: CatalogTransport + 'static> WorldStore for CatalogWorldStore<T> {
    fn load(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        Box::pin(async move {
            // Bounded fan-out: a few catalog reads at a time rather than all 21 at once.
            let gate = Arc::new(tokio::sync::Semaphore::new(LOAD_FANOUT));
            let mut tasks = JoinSet::new();
            for (date, range) in partitions(now_ms) {
                let id = catalog(cell, date, range).map_err(StoreError::Storage)?;
                let (store, gate) = (self.catalogs.clone(), gate.clone());
                tasks.spawn(crate::observability::inherit(async move {
                    let _slot = gate
                        .acquire_owned()
                        .await
                        .map_err(|_| StoreError::Incomplete)?;
                    load_partition(store, id, period(date, range), deadline, false).await
                }));
            }
            let mut out = Vec::new();
            while let Some(joined) = tasks.join_next().await {
                out.extend(joined.map_err(|_| StoreError::Incomplete)??);
            }
            out.sort_by(|a, b| (a.fetched_at_ms, &a.sha256).cmp(&(b.fetched_at_ms, &b.sha256)));
            Ok(out)
        })
    }
    fn publish(
        &self,
        cell: Cell,
        fetch: RawFetch,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            let raw = record(cell, &fetch, &self.raw_limits).map_err(StoreError::Storage)?;
            let id = CatalogId::for_record(
                &raw.envelope.identity,
                &partition(fetch.first_date, fetch.range),
            )
            .map_err(StoreError::Storage)?;
            let declaration = GroupDeclaration::new(
                vec![GroupMember {
                    envelope: raw.envelope.clone(),
                    catalogs: vec![id],
                }],
                &CatalogLimits::default(),
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
/// Volatile in-process store for unit tests and examples; not a durable store.
#[derive(Default)]
pub struct MemoryWorldStore {
    rows: Mutex<Vec<(Cell, RawFetch)>>,
    fail: Mutex<bool>,
}
impl MemoryWorldStore {
    pub fn set_failing(&self, failing: bool) {
        *self.fail.lock().unwrap_or_else(|e| e.into_inner()) = failing;
    }
    pub fn all(&self) -> Vec<(Cell, RawFetch)> {
        self.rows.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}
impl WorldStore for MemoryWorldStore {
    fn load(
        &self,
        cell: Cell,
        now_ms: f64,
        _: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        Box::pin(async move {
            if *self.fail.lock().unwrap_or_else(|e| e.into_inner()) {
                return Err(StoreError::Storage(Error::Transport));
            }
            let wanted = partitions(now_ms);
            let mut out: Vec<RawFetch> = self
                .rows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .filter(|(c, f)| *c == cell && wanted.contains(&(f.first_date, f.range)))
                .map(|(_, f)| f.clone())
                .collect();
            out.sort_by(|a, b| (a.fetched_at_ms, &a.sha256).cmp(&(b.fetched_at_ms, &b.sha256)));
            Ok(out)
        })
    }
    fn publish(
        &self,
        cell: Cell,
        fetch: RawFetch,
        _: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            if *self.fail.lock().unwrap_or_else(|e| e.into_inner()) {
                return Err(StoreError::Storage(Error::Ambiguous));
            }
            self.rows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((cell, fetch));
            Ok(())
        })
    }
}
