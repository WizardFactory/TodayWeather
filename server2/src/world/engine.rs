//! Per-cell state, owned loads and fetches: the legacy `DsfController._requestDatas` chain.
use super::{
    Cell, Range,
    air::{AirOutcome, AirSource},
    js::Val,
    records::{Db, Found},
    source::{VcError, VcSource},
    store::{RawFetch, WorldStore},
    vc::convert,
};
use crate::gateway::OrderedJson;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::time::{Instant, timeout_at};

const FAILURE_BACKOFF_MS: f64 = 2_000.;
const BAD_RESPONSE_BACKOFF_MS: f64 = 15. * 60_000.;
const PROVIDER_DOWN_MS: f64 = 10. * 60_000.;
const AIR_DEADLINE: Duration = Duration::from_millis(4_000);

/// Request instant source (the legacy `new Date()`); tests inject a fixed clock.
pub trait Clock: Send + Sync + 'static {
    fn now_ms(&self) -> f64;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now_ms(&self) -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(f64::NAN, |d| d.as_millis() as f64)
    }
}
/// Settable clock for replay tests and local smoke.
#[derive(Default)]
pub struct FixedClock(Mutex<f64>);
impl FixedClock {
    pub fn new(ms: f64) -> Self {
        Self(Mutex::new(ms))
    }
    pub fn set(&self, ms: f64) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = ms;
    }
}
impl Clock for FixedClock {
    fn now_ms(&self) -> f64 {
        *self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}
#[derive(Clone, Debug)]
pub struct WorldConfig {
    pub max_cells: usize,
    pub load: Duration,
    pub fetch: Duration,
    pub response: Duration,
}
impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            max_cells: 4096,
            load: Duration::from_secs(8),
            fetch: Duration::from_secs(8),
            response: Duration::from_millis(2_500),
        }
    }
}
/// Legacy failure classes after `_fallback`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Failure {
    /// 503 `EWEATHERUNAVAILABLE` with `retryAt`.
    Unavailable(f64),
    /// Any other legacy error response (400/401/500...).
    Error,
}
#[derive(Default)]
pub struct Metrics {
    pub requests: AtomicU64,
    pub memory_hits: AtomicU64,
    pub cold_loads: AtomicU64,
    pub load_failures: AtomicU64,
    pub fetches: [AtomicU64; 3],
    pub publications: AtomicU64,
    pub publication_failures: AtomicU64,
    pub provider_failures: AtomicU64,
    pub fallbacks: AtomicU64,
}
struct CellEntry {
    cell: Cell,
    db: Mutex<Option<Db>>,
    op: tokio::sync::Mutex<()>,
    backoff_until: Mutex<f64>,
}
type CellMap = HashMap<(i64, i64), (u64, Arc<CellEntry>)>;
struct Inner {
    store: Arc<dyn WorldStore>,
    source: Arc<dyn VcSource>,
    air: Arc<dyn AirSource>,
    clock: Arc<dyn Clock>,
    config: WorldConfig,
    cells: Mutex<(u64, CellMap)>,
    provider_down_until: Mutex<f64>,
    metrics: Metrics,
}
/// Native world weather engine. Cheap to clone; owned tasks hold their own references.
#[derive(Clone)]
pub struct World {
    inner: Arc<Inner>,
}
/// Owned attempt result; every outcome carries the output merged with the latest re-read.
enum Flight {
    Complete(Found),
    Failed(Found, Failure),
}
fn days_first_date(body: &Val) -> Option<u32> {
    let s = body
        .get("days")
        .arr()?
        .first()?
        .get("datetime")
        .str()?
        .to_owned();
    let ms = super::vc::parse_iso_z(&format!("{s}T00:00:00Z"));
    let p = super::js::parts(ms)?;
    (s.len() == 10).then_some((p.year * 10000 + p.month * 100 + p.day) as u32)
}
/// The legacy VC requester body check (`unexpected body`).
fn usable_shape(body: &Val) -> bool {
    let Some(days) = body.get("days").arr().filter(|d| !d.is_empty()) else {
        return false;
    };
    body.get("timezone").str().is_some()
        && (body.get("tzoffset").num().is_some()
            || days[0].get("hours").arr().is_some_and(|h| !h.is_empty()))
}
fn replay(fetches: &[RawFetch]) -> Db {
    let mut db = Db::default();
    for f in fetches {
        let Ok(json) = OrderedJson::parse(&f.body) else {
            continue;
        };
        if let Ok(converted) = convert(&Val::from_ordered(&json), f.fetched_at_ms as f64, f.range) {
            db.apply(converted);
        }
    }
    db
}
impl World {
    pub fn new(
        store: Arc<dyn WorldStore>,
        source: Arc<dyn VcSource>,
        air: Arc<dyn AirSource>,
        clock: Arc<dyn Clock>,
        config: WorldConfig,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                store,
                source,
                air,
                clock,
                config,
                cells: Mutex::new((0, HashMap::new())),
                provider_down_until: Mutex::new(f64::NEG_INFINITY),
                metrics: Metrics::default(),
            }),
        }
    }
    pub fn metrics(&self) -> &Metrics {
        &self.inner.metrics
    }
    pub fn now_ms(&self) -> f64 {
        self.inner.clock.now_ms()
    }
    /// Number of cells with volatile derived state.
    pub fn cached_cells(&self) -> usize {
        self.inner
            .cells
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .1
            .len()
    }
    fn entry(&self, cell: Cell) -> Arc<CellEntry> {
        let mut guard = self.inner.cells.lock().unwrap_or_else(|e| e.into_inner());
        let (tick, map) = &mut *guard;
        *tick += 1;
        let key = cell.key();
        if let Some((used, e)) = map.get_mut(&key) {
            *used = *tick;
            return e.clone();
        }
        if map.len() >= self.inner.config.max_cells
            && let Some(oldest) = map.iter().min_by_key(|(_, (u, _))| *u).map(|(k, _)| *k)
        {
            map.remove(&oldest);
        }
        let e = Arc::new(CellEntry {
            cell,
            db: Mutex::new(None),
            op: tokio::sync::Mutex::new(()),
            backoff_until: Mutex::new(f64::NEG_INFINITY),
        });
        map.insert(key, (*tick, e.clone()));
        e
    }
    async fn loaded(
        &self,
        entry: &Arc<CellEntry>,
        now: f64,
        deadline: Instant,
    ) -> Result<Db, Failure> {
        if let Some(db) = entry.db.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            db.prune(now);
            self.inner
                .metrics
                .memory_hits
                .fetch_add(1, Ordering::Relaxed);
            return Ok(db.clone());
        }
        let owned = self.clone();
        let task_entry = entry.clone();
        let task = tokio::spawn(async move {
            let _op = task_entry.op.lock().await;
            if let Some(db) = task_entry
                .db
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
            {
                return Ok(db);
            }
            owned
                .inner
                .metrics
                .cold_loads
                .fetch_add(1, Ordering::Relaxed);
            let load_deadline = Instant::now() + owned.inner.config.load;
            match owned
                .inner
                .store
                .load(task_entry.cell, now, load_deadline)
                .await
            {
                Ok(fetches) => {
                    let mut db = replay(&fetches);
                    db.prune(now);
                    *task_entry.db.lock().unwrap_or_else(|e| e.into_inner()) = Some(db.clone());
                    Ok(db)
                }
                Err(_) => {
                    owned
                        .inner
                        .metrics
                        .load_failures
                        .fetch_add(1, Ordering::Relaxed);
                    Err(Failure::Error)
                }
            }
        });
        match timeout_at(deadline, task).await {
            Ok(Ok(result)) => result,
            _ => Err(Failure::Error),
        }
    }
    fn provider_down(&self, now: f64) -> Option<f64> {
        let until = *self
            .inner
            .provider_down_until
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        (until > now).then_some(until)
    }
    fn back_off(&self, entry: &CellEntry, now: f64, ms: f64) {
        *entry
            .backoff_until
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = now + ms;
    }
    /// One owned acquisition attempt for the cell (lock + re-read + fetch + publication).
    async fn flight(
        self,
        entry: Arc<CellEntry>,
        now: f64,
        mut range: Range,
        no_yesterday: bool,
        mut output: Found,
    ) -> Flight {
        let _op = entry.op.lock().await;
        if let Some(db) = entry.db.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            output.merge(&db.classify(now));
        }
        // A failed fetch keeps the cell's lock (legacy backoff): waiters fall back at once.
        if now
            < *entry
                .backoff_until
                .lock()
                .unwrap_or_else(|e| e.into_inner())
        {
            return Flight::Failed(output, Failure::Error);
        }
        if output.has_all(no_yesterday) {
            return Flight::Complete(output);
        }
        let deadline = Instant::now() + self.inner.config.fetch;
        let mut forecast_only = false;
        let body = loop {
            self.inner.metrics.fetches[range as usize].fetch_add(1, Ordering::Relaxed);
            match self.inner.source.fetch(entry.cell, range, deadline).await {
                Ok(body) => break body,
                Err(VcError::Exhausted { retry_at_ms }) => {
                    if range != Range::Forecast && output.current.is_none() && !forecast_only {
                        forecast_only = true;
                        range = Range::Forecast;
                        if output.has_all(true) {
                            return Flight::Complete(output);
                        }
                        continue;
                    }
                    return Flight::Failed(output, Failure::Unavailable(retry_at_ms));
                }
                Err(VcError::ProviderDown) => {
                    self.inner
                        .metrics
                        .provider_failures
                        .fetch_add(1, Ordering::Relaxed);
                    *self
                        .inner
                        .provider_down_until
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = now + PROVIDER_DOWN_MS;
                    self.back_off(&entry, now, FAILURE_BACKOFF_MS);
                    return Flight::Failed(output, Failure::Error);
                }
                Err(VcError::Failed) => {
                    self.inner
                        .metrics
                        .provider_failures
                        .fetch_add(1, Ordering::Relaxed);
                    self.back_off(&entry, now, FAILURE_BACKOFF_MS);
                    return Flight::Failed(output, Failure::Error);
                }
                Err(VcError::Disabled) => return Flight::Failed(output, Failure::Error),
            }
        };
        let parsed = OrderedJson::parse(&body).map(|j| Val::from_ordered(&j));
        let checked = parsed.ok().filter(usable_shape).and_then(|v| {
            let first = days_first_date(&v)?;
            convert(&v, now, range).ok().map(|c| (first, c))
        });
        let Some((first_date, converted)) = checked else {
            self.back_off(&entry, now, BAD_RESPONSE_BACKOFF_MS);
            return Flight::Failed(output, Failure::Error);
        };
        let fetch = RawFetch {
            fetched_at_ms: now as u64,
            range,
            first_date,
            sha256: crate::storage::sha256(&body),
            body: body.into(),
        };
        if self
            .inner
            .store
            .publish(entry.cell, fetch, deadline)
            .await
            .is_err()
        {
            // O-9: an undurable provider reply is never a new success.
            self.inner
                .metrics
                .publication_failures
                .fetch_add(1, Ordering::Relaxed);
            self.back_off(&entry, now, FAILURE_BACKOFF_MS);
            return Flight::Failed(output, Failure::Error);
        }
        self.inner
            .metrics
            .publications
            .fetch_add(1, Ordering::Relaxed);
        let fetched = {
            let mut guard = entry.db.lock().unwrap_or_else(|e| e.into_inner());
            let db = guard.get_or_insert_with(Db::default);
            let fetched = db.apply(converted);
            db.prune(now);
            fetched
        };
        output.merge(&fetched);
        Flight::Complete(output)
    }
    /// `getDsfData`: stored records or an owned acquisition, then `_fallback`.
    pub async fn records(
        &self,
        lat: f64,
        lon: f64,
        now: f64,
        deadline: Instant,
    ) -> Result<Found, Failure> {
        let started = Instant::now();
        let Some(cell) = Cell::of(lat, lon) else {
            return Err(Failure::Error);
        };
        let entry = self.entry(cell);
        let db = self.loaded(&entry, now, deadline).await?;
        let found = db.classify(now);
        if found.has_all(false) {
            return Ok(found);
        }
        let no_yesterday = db.no_yesterday(now, &found);
        if found.has_all(no_yesterday) {
            return Ok(found);
        }
        let range = if no_yesterday {
            Range::Forecast
        } else if found.two_days_ago.is_none() {
            Range::Combined
        } else if found.yesterday.is_none() {
            Range::Recent
        } else {
            Range::Forecast
        };
        let fallback = |found: Found, failure: Failure| {
            self.inner.metrics.fallbacks.fetch_add(1, Ordering::Relaxed);
            found.fallback().ok_or(failure)
        };
        if let Some(until) = self.provider_down(now) {
            return fallback(found, Failure::Unavailable(until));
        }
        let task =
            tokio::spawn(
                self.clone()
                    .flight(entry, now, range, no_yesterday, found.clone()),
            );
        let waiter = deadline.min(started + self.inner.config.response);
        match timeout_at(waiter, task).await {
            Ok(Ok(Flight::Complete(out))) => Ok(out),
            Ok(Ok(Flight::Failed(out, failure))) => fallback(out, failure),
            _ => fallback(found, Failure::Error),
        }
    }
    /// The air branch with the legacy 4 s release.
    pub async fn air(&self, lat: f64, lon: f64, now: f64) -> AirOutcome {
        let source = self.inner.air.clone();
        let task = tokio::spawn(async move { source.current(lat, lon, now).await });
        match timeout_at(Instant::now() + AIR_DEADLINE, task).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => AirOutcome::None,
            Err(_) => AirOutcome::Pending,
        }
    }
}
