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
    /// Original Incomplete plus actual CPU refusal within this load; not a storage Error.
    LocalIncomplete,
    Storage(Error),
    /// This invocation observed CPU refusal; the carried storage error retains write uncertainty.
    LocalPublication(Error),
}
impl StoreError {
    pub(crate) fn local_capacity(&self) -> bool {
        matches!(
            self,
            Self::Storage(Error::LocalCapacity) | Self::LocalPublication(_) | Self::LocalIncomplete
        )
    }
}
pub trait WorldStore: Send + Sync + 'static {
    /// Every durable fetch that can affect a request at `now_ms` (the legacy 48 h decision window).
    fn load(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>>;
    /// Explicit per-load CPU view; standalone implementations keep their old contract.
    fn load_with_cpu(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
        _cpu: Arc<crate::runtime_resources::CpuAdmission>,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        self.load(cell, now_ms, deadline)
    }
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
    cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    catalogs: Arc<CatalogStore<T>>,
    raw_limits: Limits,
}
impl<T: CatalogTransport + 'static> CatalogWorldStore<T> {
    pub fn new(transport: T, limits: CatalogLimits) -> Result<Self, Error> {
        Self::new_with_cpu(transport, limits, None)
    }
    pub fn new_with_cpu(
        transport: T,
        limits: CatalogLimits,
        cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> Result<Self, Error> {
        let raw_limits = limits.raw.clone();
        Ok(Self {
            catalogs: Arc::new(CatalogStore::new_with_cpu(transport, limits, cpu.clone())?),
            raw_limits,
            cpu,
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
    let store = Arc::new(store.local_invocation());
    let result = load_partition_inner(store.clone(), id, period, deadline, strict).await;
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
async fn load_partition_inner<T: CatalogTransport>(
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
impl<T: CatalogTransport + 'static> CatalogWorldStore<T> {
    fn load_inner(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
        cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
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
            let mut pending = (partitions(now_ms)).into_iter();
            let mut tasks = JoinSet::new();
            let spawn = |tasks: &mut JoinSet<Result<Vec<RawFetch>, StoreError>>,
                         (date, range)|
             -> Result<(), StoreError> {
                let id = catalog(cell, date, range).map_err(StoreError::Storage)?;
                let store = store.clone();
                tasks.spawn(crate::observability::inherit(async move {
                    load_partition(store, id, period(date, range), deadline, false).await
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
            out.sort_by(|a, b| (a.fetched_at_ms, &a.sha256).cmp(&(b.fetched_at_ms, &b.sha256)));
            Ok(out)
        })
    }
}
impl<T: CatalogTransport + 'static> WorldStore for CatalogWorldStore<T> {
    fn load(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        self.load_inner(cell, now_ms, deadline, self.cpu.clone())
    }
    fn load_with_cpu(
        &self,
        cell: Cell,
        now_ms: f64,
        deadline: Instant,
        cpu: Arc<crate::runtime_resources::CpuAdmission>,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        self.load_inner(cell, now_ms, deadline, Some(cpu))
    }
    fn publish(
        &self,
        cell: Cell,
        fetch: RawFetch,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            let raw_limits = self.raw_limits.clone();
            let prepare = move || -> Result<_, Error> {
                let raw = record(cell, &fetch, &raw_limits)?;
                let id = CatalogId::for_record(
                    &raw.envelope.identity,
                    &partition(fetch.first_date, fetch.range),
                )?;
                let declaration = GroupDeclaration::new(
                    vec![GroupMember {
                        envelope: raw.envelope.clone(),
                        catalogs: vec![id],
                    }],
                    &CatalogLimits::default(),
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
