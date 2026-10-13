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
            // Legacy answered within 2.5 s and relied on a gateway retry; the native S10 attempt
            // is single, so the waiter uses the attempt deadline up to 3 s.
            response: Duration::from_millis(3_000),
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
    /// Set while an owner is acquiring from the provider (the legacy fetch lock holder).
    fetching: std::sync::atomic::AtomicBool,
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
    /// Funding windows already observed exhausted per range (never refunded, so monotonic).
    exhausted: Mutex<HashMap<Range, f64>>,
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
                exhausted: Mutex::new(HashMap::new()),
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
        trim(map, self.inner.config.max_cells.saturating_sub(1));
        let e = Arc::new(CellEntry {
            cell,
            db: Mutex::new(None),
            op: tokio::sync::Mutex::new(()),
            fetching: std::sync::atomic::AtomicBool::new(false),
            backoff_until: Mutex::new(f64::NEG_INFINITY),
        });
        map.insert(key, (*tick, e.clone()));
        e
    }
    /// Trim idle cells back to capacity after requests that had to exceed it while busy.
    fn trim_cells(&self) {
        let mut guard = self.inner.cells.lock().unwrap_or_else(|e| e.into_inner());
        trim(&mut guard.1, self.inner.config.max_cells);
    }
    /// The funding-window part of `_selectRange` for a request that would otherwise fail
    /// behind the cell lock: an exhausted window answers 503 with the window end.
    async fn unfundable(&self, range: Range, output: &Found) -> Option<f64> {
        let until = self.probe(range).await?;
        if range == Range::Forecast || output.current.is_some() {
            return Some(until);
        }
        self.probe(Range::Forecast).await
    }
    async fn probe(&self, range: Range) -> Option<f64> {
        if let Some(until) = self.exhausted(range, self.inner.clock.now_ms()) {
            return Some(until);
        }
        let until = self.inner.source.eligible(range).await?;
        self.inner
            .exhausted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(range, until);
        Some(until)
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
            // Declared before the entry so the entry is released first, then idle cells trim.
            let _trim = Trim(owned.clone());
            let task_entry = task_entry;
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
    /// Backoff and provider-down windows start when the failure is handled (legacy `Date.now()`).
    fn back_off(&self, entry: &CellEntry, ms: f64) {
        *entry
            .backoff_until
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = self.inner.clock.now_ms() + ms;
    }
    fn exhausted(&self, range: Range, now: f64) -> Option<f64> {
        self.inner
            .exhausted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&range)
            .copied()
            .filter(|until| *until > now)
    }
    /// One owned acquisition attempt for the cell (lock + re-read + fetch + publication).
    async fn flight(
        self,
        entry: Arc<CellEntry>,
        now: f64,
        mut range: Range,
        mut forecast_only: bool,
        mut output: Found,
    ) -> Flight {
        // A detached owned fetch trims idle cells when it finishes, after releasing its cell.
        let _trim = Trim(self.clone());
        let entry = entry;
        // Another owner is fetching (legacy lock held elsewhere): this request waits for it.
        let (_op, waiter) = match entry.op.try_lock() {
            Ok(guard) => (guard, false),
            Err(_) => {
                let fetching = entry.fetching.load(Ordering::Acquire);
                (entry.op.lock().await, fetching)
            }
        };
        let mut no_yesterday = false;
        if let Some(db) = entry.db.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            let found = db.classify(now);
            output.merge(&found);
            no_yesterday = db.no_yesterday(now, &output);
        }
        // A failed fetch keeps the cell's lock (legacy backoff), so this is also a waiter.
        let backoff = now
            < *entry
                .backoff_until
                .lock()
                .unwrap_or_else(|e| e.into_inner());
        if waiter || backoff {
            // `_waitForRecords`: stored current and today complete the request; otherwise fall back.
            if output.current.is_some() && output.today.is_some() {
                return Flight::Complete(output);
            }
            // Legacy checks the funding window before the lock, so exhaustion outranks backoff.
            return match self.unfundable(range, &output).await {
                Some(until) => Flight::Failed(output, Failure::Unavailable(until)),
                None => Flight::Failed(output, Failure::Error),
            };
        }
        if output.has_all(no_yesterday || forecast_only) {
            return Flight::Complete(output);
        }
        let deadline = Instant::now() + self.inner.config.fetch;
        struct Fetching<'a>(&'a std::sync::atomic::AtomicBool);
        impl Drop for Fetching<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        entry.fetching.store(true, Ordering::Release);
        let _fetching = Fetching(&entry.fetching);
        let body = loop {
            self.inner.metrics.fetches[range as usize].fetch_add(1, Ordering::Relaxed);
            match self.inner.source.fetch(entry.cell, range, deadline).await {
                Ok(body) => break body,
                Err(VcError::Exhausted { retry_at_ms }) => {
                    self.inner
                        .exhausted
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(range, retry_at_ms);
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
                        .unwrap_or_else(|e| e.into_inner()) =
                        self.inner.clock.now_ms() + PROVIDER_DOWN_MS;
                    self.back_off(&entry, FAILURE_BACKOFF_MS);
                    return Flight::Failed(output, Failure::Error);
                }
                Err(VcError::Failed) => {
                    self.inner
                        .metrics
                        .provider_failures
                        .fetch_add(1, Ordering::Relaxed);
                    self.back_off(&entry, FAILURE_BACKOFF_MS);
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
            self.back_off(&entry, BAD_RESPONSE_BACKOFF_MS);
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
            self.back_off(&entry, FAILURE_BACKOFF_MS);
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
        // Trims when the request finishes or is cancelled, after its cell reference is gone.
        let _trim = Trim(self.clone());
        self.acquire(lat, lon, now, deadline).await
    }
    async fn acquire(
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
        let mut range = if no_yesterday {
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
        // `_selectRange` before the lock: a window already observed exhausted needs no HTTP.
        let mut forecast_only = no_yesterday;
        if let Some(until) = self.exhausted(range, now) {
            if range == Range::Forecast || found.current.is_some() {
                return fallback(found, Failure::Unavailable(until));
            }
            if let Some(until) = self.exhausted(Range::Forecast, now) {
                return fallback(found, Failure::Unavailable(until));
            }
            range = Range::Forecast;
            forecast_only = true;
            if found.has_all(true) {
                return Ok(found);
            }
        }
        let task =
            tokio::spawn(
                self.clone()
                    .flight(entry, now, range, forecast_only, found.clone()),
            );
        let waiter = deadline.min(started + self.inner.config.response);
        match timeout_at(waiter, task).await {
            Ok(Ok(Flight::Complete(out))) => Ok(out),
            Ok(Ok(Flight::Failed(out, failure))) => fallback(out, failure),
            _ => fallback(found, Failure::Error),
        }
    }
    /// The air branch with the legacy 4 s release, bounded by the request attempt so a slow air
    /// provider releases the weather (`airStatus` pending) instead of failing it.
    pub async fn air(&self, lat: f64, lon: f64, now: f64, deadline: Instant) -> AirOutcome {
        let source = self.inner.air.clone();
        let task = tokio::spawn(async move { source.current(lat, lon, now).await });
        let release = (Instant::now() + AIR_DEADLINE).min(
            deadline
                .checked_sub(Duration::from_millis(100))
                .unwrap_or(deadline),
        );
        match timeout_at(release, task).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => AirOutcome::None,
            Err(_) => AirOutcome::Pending,
        }
    }
}
/// Remove least recently used idle cells until at most `keep` remain. A cell referenced by an
/// owned load/fetch keeps its lock identity, so it never gets a second single-flight owner.
fn trim(map: &mut CellMap, keep: usize) {
    while map.len() > keep {
        let Some(oldest) = map
            .iter()
            .filter(|(_, (_, e))| Arc::strong_count(e) == 1)
            .min_by_key(|(_, (u, _))| *u)
            .map(|(k, _)| *k)
        else {
            return;
        };
        map.remove(&oldest);
    }
}
/// Trims the cell map to capacity when dropped (request end, cancellation or owned-task end).
struct Trim(World);
impl Drop for Trim {
    fn drop(&mut self) {
        self.0.trim_cells();
    }
}
