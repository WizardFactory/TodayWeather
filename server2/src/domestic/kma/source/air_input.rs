//! S15b-3: the AirKorea and air-fallback inputs of one request.
//!
//! National datasets are shared by every request: the station list (`airkorea-station-list`,
//! key `stations`), the nationwide hourly observations (`airkorea-station`, key
//! `sido-nationwide`, partition = the dataset's data hour) and the dust forecasts
//! (`airkorea-dust-forecast`, key `dust-forecast`, partition = search date). Each is read from
//! published S3 catalogs, folded with the legacy save rules into memory and answered with the
//! legacy readers ([`super::airkorea`]). A missing current dataset starts one owned, single-
//! flight acquisition keyed by dataset and period; the request waits for it only until its own
//! deadline and otherwise answers with what S3 holds (the legacy output for absent data).
use super::airkorea::{
    Forecasts, ObsRow, Observations, Stations, announcement_text, arpltn_answer, dust_answer,
    expected_announcement, fallback_arpltn, has_air_value,
};
use super::doc::{Doc, Val};
use super::live::{AirKoreaAcquire, Flights, wait};
use super::records::{Fetched, Reader, months};
use crate::domestic::airkorea::AirKoreaRequest;
use crate::domestic::publication::{self, Publication};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::history::{IndexListing, schedule};
use crate::storage::{CatalogId, CatalogStore, LookupOutcome, ProviderKey, sha256};
use crate::world::air::{AirOutcome, AirSource, usable};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::Instant;

const HOUR_MS: f64 = 3_600_000.;
const DAY_MS: f64 = 86_400_000.;
const SOURCE: &str = "data-go-kr";
/// Legacy collected real-time observations every 10 minutes; one attempt per dataset and
/// period at most every 10 minutes here.
const RETRY: Duration = Duration::from_secs(600);
/// A shared folded dataset is re-read at most this often unless an own acquisition completed.
const MEMO: Duration = Duration::from_secs(60);
/// The station list is acquired again when the newest list is older than this (legacy
/// requested it only at process start).
const STATION_LIST_AGE_MS: f64 = 7. * DAY_MS;
/// Partitions of the observation dataset re-read on every refresh (late acquisitions).
const OPEN_HOURS: f64 = 3.;
/// The station list is refreshed every 10 minutes from one day before the last folded list
/// (a late publication of an earlier day refolds) and refolded completely once a day.
const STATION_REFRESH: Duration = Duration::from_secs(600);
const STATION_REFOLD: Duration = Duration::from_secs(86_400);
/// Demand-gated capture of the nationwide hour: while a request arrived within this window, the
/// current hour is acquired even when no request needs it, so the 24-hour station rows have no
/// gaps (legacy collected every 10 minutes regardless of demand).
const DEMAND_MS: i64 = 24 * 3_600_000;
/// Capture check interval (legacy collected at UTC minutes 3, 13, ... 53).
const CAPTURE_EVERY: Duration = Duration::from_secs(600);

fn key(id: &str) -> ProviderKey {
    ProviderKey::Named { id: id.into() }
}
/// `response.body.items` of every page, in page order; None when a page is not an item page.
pub fn page_items(pages: &[Arc<[u8]>]) -> Option<Vec<Value>> {
    let mut out = Vec::new();
    for p in pages {
        let json: Value = serde_json::from_slice(p).ok()?;
        let items = json
            .get("response")?
            .get("body")?
            .get("items")?
            .as_array()?;
        out.extend(items.iter().cloned());
    }
    Some(out)
}
/// Run a read until `deadline` (including lock and parsing waits); a timeout is an error.
async fn bounded<T>(
    deadline: Instant,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout_at(deadline, work)
        .await
        .unwrap_or_else(|_| Err("request deadline".into()))
}
/// The wall clock in ms: acquisitions completed while a request waited for them are visible to
/// it, although they complete after the request instant.
fn wall_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0., |d| d.as_millis() as f64)
}
/// KST hour partition `YYYYMMDD-HH00` of an instant.
fn hour_partition(ms: f64) -> String {
    schedule::from_ms(ms as i64).hour_start().partition()
}

/// A dust-forecast acquisition: (completion instant, partition, announcement, pages).
type ForecastAcquisition = (u64, String, Option<String>, Vec<Arc<[u8]>>);
/// `(region, city, date)` of a dust-forecast answer.
pub type DustArgs = (String, String, String);
/// Parsed observation acquisitions per hour partition: (completion instant, rows).
type ObsParts = BTreeMap<String, Vec<(u64, Arc<Vec<ObsRow>>)>>;
type FoldKey = (usize, Option<(u64, String)>);
/// What one request reads from the AirKorea and air-provider inputs.
#[derive(Debug, Clone)]
pub struct AirAnswers {
    /// `getArpLtnInfo(town, now)`: Ok answer or the legacy error.
    pub arpltn: Result<OrderedJson, String>,
    /// `getDustFrcst({region, city}, date)` for the request's region, city and KST date, when
    /// the request asks for AirKorea forecasts.
    pub dust: Option<(DustArgs, Result<OrderedJson, String>)>,
    /// `AirFallback.getArpltn(gCoord, now)` when the AirKorea answer has no value.
    pub fallback: Option<((f64, f64), Option<OrderedJson>)>,
}

struct StationCache {
    stations: Arc<Stations>,
    newest_ms: f64,
    seen: HashSet<(u64, String)>,
    last: (u64, String),
    refreshed: std::time::Instant,
    folded: std::time::Instant,
    generation: u64,
}
struct ObsCache {
    parts: ObsParts,
    folded: Arc<Observations>,
    /// The acquisitions the fold covers: their count and the last (instant, partition).
    folded_key: Option<FoldKey>,
    refreshed: std::time::Instant,
    generation: u64,
}

/// Inputs shared by every request of the process.
pub struct AirInputs<T> {
    reader: Reader<T>,
    acquire: Option<Arc<dyn AirKoreaAcquire>>,
    air: Option<Arc<dyn AirSource>>,
    flights: Arc<Flights>,
    generation: Arc<AtomicU64>,
    stations: tokio::sync::Mutex<Option<StationCache>>,
    observations: tokio::sync::Mutex<Option<ObsCache>>,
    /// The last successful folds: a refresh that fails or misses the deadline answers with
    /// them (the readers apply the request's own freshness bounds).
    last_stations: std::sync::Mutex<Option<(Arc<Stations>, f64)>>,
    last_observations: std::sync::Mutex<Option<Arc<Observations>>>,
    last_forecasts: std::sync::Mutex<Option<Arc<Forecasts>>>,
    capture: Arc<Capture>,
    capture_every: Duration,
    /// Parsing, folding and reader work runs on blocking workers, two at a time, so a request
    /// deadline can always be observed (the future waiting for them is cancellable).
    cpu: Arc<tokio::sync::Semaphore>,
}
/// State of the demand-gated hourly capture.
#[derive(Default)]
struct Capture {
    /// Wall-clock ms of the last request (0: none yet).
    demand_ms: std::sync::atomic::AtomicI64,
    /// Nationwide hour partitions this process published.
    hours: std::sync::Mutex<HashSet<String>>,
    started: std::sync::atomic::AtomicBool,
}
impl<T: IndexListing + Clone + 'static> AirInputs<T> {
    pub fn new(transport: T, store: Arc<CatalogStore<T>>) -> Self {
        Self {
            reader: Reader { transport, store },
            acquire: None,
            air: None,
            flights: Arc::new(Flights::default()),
            generation: Arc::new(AtomicU64::new(0)),
            stations: tokio::sync::Mutex::new(None),
            observations: tokio::sync::Mutex::new(None),
            last_stations: std::sync::Mutex::new(None),
            last_observations: std::sync::Mutex::new(None),
            last_forecasts: std::sync::Mutex::new(None),
            capture: Arc::new(Capture::default()),
            capture_every: CAPTURE_EVERY,
            cpu: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
    /// Run CPU work on a blocking worker under the CPU admission. Dropping the returned future
    /// (a request deadline) leaves the worker to finish on its own; nothing waits for it.
    async fn cpu<R: Send + 'static>(
        &self,
        work: impl FnOnce() -> R + Send + 'static,
    ) -> Result<R, String> {
        cpu_task(&self.cpu, work).await
    }
    /// The capture check interval (10 minutes; tests shorten it).
    pub fn with_capture_interval(mut self, every: Duration) -> Self {
        self.capture_every = every;
        self
    }
    pub fn with_acquire(mut self, acquire: Option<Arc<dyn AirKoreaAcquire>>) -> Self {
        self.acquire = acquire;
        self
    }
    pub fn with_air(mut self, air: Option<Arc<dyn AirSource>>) -> Self {
        self.air = air;
        self
    }
    /// Start (or join) the owned acquisition of one dataset; None without a key.
    fn flight(
        &self,
        id: &str,
        request: AirKoreaRequest,
    ) -> Option<tokio::sync::watch::Receiver<bool>> {
        start_flight(
            &self.flights,
            self.acquire.clone()?,
            &self.generation,
            &self.capture,
            id,
            request,
        )
    }
    /// Record demand and start the hourly capture task once (with a key).
    fn note_demand(&self) {
        let Some(acquire) = self.acquire.clone() else {
            return;
        };
        self.capture
            .demand_ms
            .store(wall_ms() as i64, Ordering::Release);
        if self.capture.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let (flights, generation, capture, every) = (
            self.flights.clone(),
            self.generation.clone(),
            self.capture.clone(),
            self.capture_every,
        );
        tokio::spawn(async move {
            // The first check is one interval after the first request (that request already
            // acquires a missing hour itself).
            let mut tick = tokio::time::interval_at(Instant::now() + every, every);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let now = wall_ms();
                if now as i64 - capture.demand_ms.load(Ordering::Acquire) > DEMAND_MS {
                    continue;
                }
                let hour = hour_partition(now);
                let done = {
                    let mut hours = capture.hours.lock().unwrap_or_else(|e| e.into_inner());
                    // Hours older than the 26-hour read window are never checked again.
                    let oldest = hour_partition(now - 26. * HOUR_MS);
                    hours.retain(|h| *h >= oldest);
                    hours.contains(&hour)
                };
                if !done {
                    let _ = start_flight(
                        &flights,
                        acquire.clone(),
                        &generation,
                        &capture,
                        &format!("nationwide-{hour}"),
                        AirKoreaRequest::nationwide(),
                    );
                }
            }
        });
    }
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// The folded station list; an absent or old list starts its acquisition, and an absent
    /// list is waited for until `deadline`.
    pub async fn stations(&self, now: f64, deadline: Instant) -> Result<Arc<Stations>, String> {
        let current = match bounded(deadline, self.station_fold(now, now, false, deadline)).await {
            Ok(current) => {
                if let Some(found) = &current {
                    *self.last_stations.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(found.clone());
                }
                current
            }
            // A failed refresh answers with the last successful fold (no acquisition: S3 is
            // the failing part).
            Err(e) => {
                let last = self
                    .last_stations
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                return last.map(|(s, _)| s).ok_or(e);
            }
        };
        let stale = current
            .as_ref()
            .is_none_or(|(_, newest)| *newest < now - STATION_LIST_AGE_MS);
        if stale {
            let rx = self.flight("station-list", AirKoreaRequest::station_list());
            if current.is_none()
                && wait(rx, deadline).await
                && let Ok(Some(found)) = bounded(
                    deadline,
                    self.station_fold(now, wall_ms().max(now), false, deadline),
                )
                .await
            {
                *self.last_stations.lock().unwrap_or_else(|e| e.into_inner()) = Some(found.clone());
                return Ok(found.0);
            }
        }
        Ok(current.map(|(s, _)| s).unwrap_or_default())
    }
    /// Refresh the station list now (the 10-minute refresh of [`Self::stations`]).
    pub async fn refresh_stations(
        &self,
        now: f64,
        deadline: Instant,
    ) -> Result<Option<Arc<Stations>>, String> {
        bounded(deadline, self.station_fold(now, now, true, deadline))
            .await
            .map(|found| found.map(|(s, _)| s))
    }
    /// Every station-list acquisition since 2026-01 folded in completion order, refreshed every
    /// 10 minutes (new acquisitions are appended; one completed before the last folded one
    /// refolds everything). None when no list was ever acquired.
    /// Acquisitions completed after `until` are not applied yet.
    async fn station_fold(
        &self,
        now: f64,
        until: f64,
        force: bool,
        deadline: Instant,
    ) -> Result<Option<(Arc<Stations>, f64)>, String> {
        let generation = self.generation();
        let mut cache = self.stations.lock().await;
        if let Some(c) = cache.as_ref()
            && !force
            && c.generation == generation
            && c.refreshed.elapsed() < STATION_REFRESH
        {
            return Ok(Some((c.stations.clone(), c.newest_ms)));
        }
        if cache
            .as_ref()
            .is_some_and(|c| c.folded.elapsed() >= STATION_REFOLD)
        {
            *cache = None;
        }
        let k = key("stations");
        // Re-read from one day before the last folded list: a list fetched before midnight and
        // published after a later day's list is found and triggers a refold.
        let from = cache.as_ref().map(|c| super::day_before(&c.last.1));
        let all_months = super::history_months(now);
        let wanted: Vec<u32> = all_months
            .into_iter()
            .filter(|m| {
                from.as_deref()
                    .is_none_or(|f| format!("{m:06}").as_str() >= &f[..6])
            })
            .collect();
        let parts: Vec<String> = self
            .reader
            .partitions(SOURCE, "airkorea-station-list", &k, &wanted, deadline)
            .await
            .map_err(|e| format!("station-list listing: {e}"))?
            .into_iter()
            .filter(|p| from.as_deref().is_none_or(|f| p.as_str() >= f))
            .collect();
        let mut fetched = self
            .reader
            .all(SOURCE, "airkorea-station-list", &k, &parts, deadline)
            .await
            .map_err(|e| format!("station-list read: {e}"))?;
        fetched.retain(|f| f.fetched_at_ms as f64 <= until);
        let id = |f: &Fetched| (f.fetched_at_ms, f.partition.clone());
        if let Some(c) = cache.as_mut() {
            let new: Vec<Fetched> = fetched
                .iter()
                .filter(|f| !c.seen.contains(&id(f)))
                .cloned()
                .collect();
            if !new.is_empty() && new.iter().all(|f| id(f) > c.last) {
                let base = c.stations.clone();
                let applied = new.clone();
                let stations = self
                    .cpu(move || {
                        let mut stations = (*base).clone();
                        for f in &applied {
                            if let Some(items) = page_items(&f.pages) {
                                stations.apply(&items);
                            }
                        }
                        stations
                    })
                    .await?;
                for f in &new {
                    c.newest_ms = c.newest_ms.max(f.fetched_at_ms as f64);
                    c.seen.insert(id(f));
                    c.last = c.last.clone().max(id(f));
                }
                c.stations = Arc::new(stations);
                c.refreshed = std::time::Instant::now();
                c.generation = generation;
                return Ok(Some((c.stations.clone(), c.newest_ms)));
            }
            if new.is_empty() {
                c.refreshed = std::time::Instant::now();
                c.generation = generation;
                return Ok(Some((c.stations.clone(), c.newest_ms)));
            }
            // A late acquisition: refold from the start.
            *cache = None;
            drop(cache);
            return Box::pin(self.station_fold(now, until, force, deadline)).await;
        }
        if fetched.is_empty() {
            return Ok(None);
        }
        let mut seen = HashSet::new();
        let mut newest = f64::NEG_INFINITY;
        for f in &fetched {
            newest = newest.max(f.fetched_at_ms as f64);
            seen.insert(id(f));
        }
        let pages = fetched.clone();
        let stations = self
            .cpu(move || {
                let mut stations = Stations::default();
                for f in &pages {
                    if let Some(items) = page_items(&f.pages) {
                        stations.apply(&items);
                    }
                }
                stations
            })
            .await?;
        let last = fetched.iter().map(id).max().expect("not empty");
        let stations = Arc::new(stations);
        *cache = Some(StationCache {
            stations: stations.clone(),
            newest_ms: newest,
            seen,
            last,
            refreshed: std::time::Instant::now(),
            folded: std::time::Instant::now(),
            generation,
        });
        Ok(Some((stations, newest)))
    }

    /// The folded observations of the last 26 hours. When the current hour's national dataset
    /// is not stored, one acquisition starts and is waited for until `deadline`.
    pub async fn observations(
        &self,
        now: f64,
        deadline: Instant,
    ) -> Result<Arc<Observations>, String> {
        let (folded, current) =
            match bounded(deadline, self.observation_fold(now, now, deadline)).await {
                Ok((folded, current)) => {
                    *self
                        .last_observations
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = Some(folded.clone());
                    (folded, current)
                }
                // A failed refresh answers with the last successful fold.
                Err(e) => {
                    let last = self
                        .last_observations
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    return last.ok_or(e);
                }
            };
        if current {
            return Ok(folded);
        }
        let hour = hour_partition(now);
        let rx = self.flight(&format!("nationwide-{hour}"), AirKoreaRequest::nationwide());
        if wait(rx, deadline).await {
            // A refresh that cannot finish keeps the data read first.
            let refreshed = bounded(
                deadline,
                self.observation_fold(now, wall_ms().max(now), deadline),
            )
            .await;
            return Ok(match refreshed {
                Ok((o, _)) => {
                    *self
                        .last_observations
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = Some(o.clone());
                    o
                }
                Err(_) => folded,
            });
        }
        Ok(folded)
    }
    /// Parts are re-read from S3 at most every [`MEMO`] (or after an own acquisition); the fold
    /// covers the acquisitions completed by `until`.
    async fn observation_fold(
        &self,
        now: f64,
        until: f64,
        deadline: Instant,
    ) -> Result<(Arc<Observations>, bool), String> {
        let generation = self.generation();
        let current_hour = hour_partition(now);
        let mut cache = self.observations.lock().await;
        let fresh = cache
            .as_ref()
            .is_some_and(|c| c.generation == generation && c.refreshed.elapsed() < MEMO);
        if !fresh {
            let from = now - 26. * HOUR_MS;
            let oldest = hour_partition(from);
            let open = hour_partition(now - OPEN_HOURS * HOUR_MS);
            let k = key("sido-nationwide");
            let parts: Vec<String> = self
                .reader
                .partitions(SOURCE, "airkorea-station", &k, &months(from, now), deadline)
                .await
                .map_err(|e| format!("observation listing: {e}"))?
                .into_iter()
                .filter(|p| *p >= oldest)
                .collect();
            // Cloned, not taken: a request cancelled by its deadline leaves the cache intact.
            let mut kept: ObsParts = cache
                .as_ref()
                .map(|c| c.parts.clone())
                .unwrap_or_default()
                .into_iter()
                .filter(|(p, _)| *p >= oldest && *p < open)
                .collect();
            let read: Vec<String> = parts
                .iter()
                .filter(|p| !kept.contains_key(*p))
                .cloned()
                .collect();
            let fetched = self
                .reader
                .all(SOURCE, "airkorea-station", &k, &read, deadline)
                .await
                .map_err(|e| format!("observation read: {e}"))?;
            for p in &read {
                kept.entry(p.clone()).or_default();
            }
            // National pages are large (about 335 KB for 672 stations): parse off the reactor.
            let parsed = self
                .cpu(move || {
                    fetched
                        .into_iter()
                        .map(|f| {
                            let rows = page_items(&f.pages)
                                .map(|items| Observations::parse(&items))
                                .unwrap_or_default();
                            (f.partition, f.fetched_at_ms, rows)
                        })
                        .collect::<Vec<_>>()
                })
                .await?;
            for (partition, at, rows) in parsed {
                kept.entry(partition)
                    .or_default()
                    .push((at, Arc::new(rows)));
            }
            *cache = Some(ObsCache {
                parts: kept,
                folded: Arc::new(Observations::default()),
                folded_key: None,
                refreshed: std::time::Instant::now(),
                generation,
            });
        }
        let c = cache.as_mut().expect("refreshed");
        let mut order: Vec<(u64, &String, &Arc<Vec<ObsRow>>)> = c
            .parts
            .iter()
            .flat_map(|(p, a)| a.iter().map(move |(t, r)| (*t, p, r)))
            .filter(|(t, _, _)| *t as f64 <= until)
            .collect();
        order.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
        let folded_key = Some((
            order.len(),
            order.last().map(|(t, p, _)| (*t, (*p).clone())),
        ));
        if c.folded_key != folded_key {
            let rows: Vec<Arc<Vec<ObsRow>>> = order.iter().map(|(_, _, r)| (*r).clone()).collect();
            let folded = self
                .cpu(move || {
                    let mut folded = Observations::default();
                    for r in &rows {
                        folded.apply_rows(r);
                    }
                    folded
                })
                .await?;
            c.folded = Arc::new(folded);
            c.folded_key = folded_key;
        }
        let present = c
            .parts
            .get(&current_hour)
            .is_some_and(|a| a.iter().any(|(t, _)| *t as f64 <= until));
        if present {
            // Stored already (by this or another process): the capture skips this hour.
            self.capture
                .hours
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(current_hour);
        }
        Ok((c.folded.clone(), present))
    }

    /// The dust forecasts that can answer `getDustFrcst` for KST date `date` (search dates
    /// `date - 2 .. date`, which hold every document with `informData >= date`). When the
    /// announcement expected now is not stored, one acquisition starts and is waited for.
    pub async fn forecasts(
        &self,
        now: f64,
        date: u32,
        deadline: Instant,
    ) -> Result<Forecasts, String> {
        let folded = match bounded(deadline, self.forecast_fold(now, now, date, deadline)).await {
            Ok(folded) => {
                *self
                    .last_forecasts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(folded.clone()));
                folded
            }
            // A failed refresh answers with the last successful fold; the reader applies this
            // request's date (`informData >= date`).
            Err(e) => {
                let last = self
                    .last_forecasts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                return last.map(|f| (*f).clone()).ok_or(e);
            }
        };
        let expected = expected_announcement(now).unwrap_or_default();
        if folded
            .docs()
            .iter()
            .any(|d| d.data_time.as_deref() == Some(expected.as_str()))
        {
            return Ok(folded);
        }
        let Some(search) = publication::dust_forecast_announcement(now as i64) else {
            return Ok(folded);
        };
        let rx = self.flight(
            &format!("dust-forecast-{}", search.partition()),
            AirKoreaRequest::dust_forecast_for(search),
        );
        if wait(rx, deadline).await {
            let refreshed = bounded(
                deadline,
                self.forecast_fold(now, wall_ms().max(now), date, deadline),
            )
            .await;
            if let Ok(f) = &refreshed {
                *self
                    .last_forecasts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(f.clone()));
            }
            return Ok(refreshed.unwrap_or(folded));
        }
        Ok(folded)
    }
    async fn forecast_fold(
        &self,
        now: f64,
        until: f64,
        date: u32,
        deadline: Instant,
    ) -> Result<Forecasts, String> {
        let day = Publication::new(date, 0).ok_or("date")?;
        let first = day.add_hours(-48).ok_or("date")?;
        let from = super::super::time::make_date(
            f64::from(first.date() / 10000),
            f64::from((first.date() / 100) % 100) - 1.,
            f64::from(first.date() % 100),
            0.,
            0.,
            0.,
        ) - 9. * HOUR_MS;
        let k = key("dust-forecast");
        let parts: Vec<String> = self
            .reader
            .partitions(
                SOURCE,
                "airkorea-dust-forecast",
                &k,
                &months(from, now.max(from)),
                deadline,
            )
            .await
            .map_err(|e| format!("dust-forecast listing: {e}"))?
            .into_iter()
            .filter(|p| *p >= first.base_date() && *p <= day.base_date())
            .collect();
        let mut fetched = Vec::new();
        for p in &parts {
            fetched.extend(self.forecast_acquisitions(&k, p, deadline).await?);
        }
        fetched.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let runs: Vec<ForecastAcquisition> = fetched
            .into_iter()
            .filter(|f| f.0 as f64 <= until)
            .collect();
        self.cpu(move || {
            let mut out = Forecasts::default();
            for (at, _, expected, pages) in &runs {
                // The record period is the announcement chosen before the call; a record
                // without one falls back to the announcement expected when it completed.
                let Some(expected) = expected
                    .clone()
                    .or_else(|| expected_announcement(*at as f64))
                else {
                    continue;
                };
                if let Some(items) = page_items(pages) {
                    out.apply(&expected, &items);
                }
            }
            out
        })
        .await
    }
    /// Complete dust-forecast acquisitions of one search-date partition with their recorded
    /// announcement: (completion instant, partition, announcement text, pages in page order).
    async fn forecast_acquisitions(
        &self,
        k: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<Vec<ForecastAcquisition>, String> {
        let id = CatalogId {
            source: SOURCE.into(),
            kind: "airkorea-dust-forecast".into(),
            key_sha256: sha256(&k.canonical_bytes().map_err(|e| e.to_string())?),
            partition: partition.into(),
        };
        let set = match self.reader.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => set,
            Ok(LookupOutcome::Incomplete) => return Err("incomplete dust-forecast catalog".into()),
            Err(crate::storage::Error::NotFound) => return Ok(Vec::new()),
            Err(e) => return Err(format!("dust-forecast read: {e}")),
        };
        let mut out = Vec::new();
        for a in set.acquisitions() {
            let mut records: Vec<_> = a.records().to_vec();
            records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
            let Some(at) = records
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
            else {
                continue;
            };
            let period = &records[0].envelope.identity.period;
            let expected = period
                .slot
                .parse::<u16>()
                .ok()
                .and_then(|t| Publication::new(period.local_date, t))
                .filter(|p| p.minute() == 0 && [5, 11, 17, 23].contains(&p.hour()))
                .and_then(announcement_text);
            out.push((
                at,
                partition.to_owned(),
                expected,
                records.iter().map(|r| r.bytes.clone()).collect(),
            ));
        }
        Ok(out)
    }

    /// All AirKorea and fallback answers of one request (it also records demand for the hourly
    /// capture). S3 or provider failures give the
    /// legacy answer for missing data, never a forward.
    pub async fn load(
        &self,
        town: &Doc,
        region: &str,
        city: &str,
        dust_wanted: bool,
        now: f64,
        deadline: Instant,
    ) -> AirAnswers {
        self.note_demand();
        // Waits and reads end 200 ms before the deadline; the readers then have until 100 ms
        // before it, and the assembly keeps the last 100 ms.
        let wait_until = deadline
            .checked_sub(Duration::from_millis(200))
            .unwrap_or(deadline);
        let answer_until = deadline
            .checked_sub(Duration::from_millis(100))
            .unwrap_or(deadline);
        let g_coord = town
            .get("gCoord")
            .and_then(Val::as_doc)
            .and_then(|g| Some((g.get("lat")?.as_num()?, g.get("lon")?.as_num()?)));
        let date = kst_date(now);
        let (stations, observations, dust) = tokio::join!(
            self.stations(now, wait_until),
            self.observations(now, wait_until),
            async {
                if dust_wanted {
                    Some(self.forecasts(now, date, wait_until).await)
                } else {
                    None
                }
            }
        );
        let arpltn = match (stations, observations) {
            (Ok(s), Ok(o)) => bounded(
                answer_until,
                self.cpu(move || arpltn_answer(&s, &o, g_coord, now)),
            )
            .await
            .and_then(|a| a),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        let dust = match dust {
            None => None,
            Some(f) => {
                let (r, c, d) = (region.to_owned(), city.to_owned(), format!("{date:08}"));
                let answer = match f {
                    Ok(f) => {
                        let (r2, c2, d2) = (r.clone(), c.clone(), d.clone());
                        bounded(
                            answer_until,
                            self.cpu(move || dust_answer(&f, &r2, &c2, &d2)),
                        )
                        .await
                        .and_then(|a| a)
                    }
                    Err(e) => Err(e),
                };
                Some(((r, c, d), answer))
            }
        };
        let needs_fallback = arpltn.as_ref().map_or(true, |a| !has_air_value(a));
        let fallback = match (needs_fallback, g_coord) {
            (true, Some((lat, lon))) => {
                Some(((lat, lon), self.fallback(lat, lon, now, answer_until).await))
            }
            _ => None,
        };
        AirAnswers {
            arpltn,
            dust,
            fallback,
        }
    }
    /// `AirFallback.getArpltn`: the shared air chain (memory, S3, providers) for the town's
    /// coordinate, evaluated for this request; None without a provider, without a usable
    /// observation or when it is not ready before the deadline (its fetch continues).
    async fn fallback(
        &self,
        lat: f64,
        lon: f64,
        now: f64,
        deadline: Instant,
    ) -> Option<OrderedJson> {
        let air = self.air.clone()?;
        let task = tokio::spawn(async move { air.current(lat, lon, now).await });
        match tokio::time::timeout_at(deadline, task).await {
            Ok(Ok(AirOutcome::Observation(o))) if usable(&o, lat, lon, now) => fallback_arpltn(&o),
            _ => None,
        }
    }
}
/// Blocking work under a CPU admission (see [`AirInputs::cpu`]).
pub async fn cpu_task<R: Send + 'static>(
    admission: &Arc<tokio::sync::Semaphore>,
    work: impl FnOnce() -> R + Send + 'static,
) -> Result<R, String> {
    let permit = admission
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "cpu admission closed".to_owned())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(|_| "cpu task failed".to_owned())
}
/// Start (or join) one owned acquisition; a published nationwide hour is remembered for the
/// capture, and any publication advances the generation so readers re-read S3.
fn start_flight(
    flights: &Flights,
    acquire: Arc<dyn AirKoreaAcquire>,
    generation: &Arc<AtomicU64>,
    capture: &Arc<Capture>,
    id: &str,
    request: AirKoreaRequest,
) -> Option<tokio::sync::watch::Receiver<bool>> {
    let (generation, capture) = (generation.clone(), capture.clone());
    let nationwide = request.sido() == Some(crate::domestic::airkorea::NATIONWIDE);
    flights.start(id, RETRY, move || -> BoxFuture<'static, ()> {
        Box::pin(async move {
            if let Ok(Some(period)) = acquire.acquire(request).await {
                if nationwide {
                    capture
                        .hours
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(format!("{:08}-{}", period.local_date, period.slot));
                }
                generation.fetch_add(1, Ordering::AcqRel);
            }
        })
    })
}
/// Whether `getKecoDustForecast` reads dust forecasts for this query: legacy
/// `checkQueryValidation` sets an absent or `(null)` `airForecastSource` to `airkorea`, and the
/// middleware continues only for the string `airkorea` (a repeated key is an array: never).
pub fn airkorea_forecast_requested(query: &[(String, String)]) -> bool {
    let values: Vec<&str> = query
        .iter()
        .filter(|(k, _)| k == "airForecastSource")
        .map(|(_, v)| v.as_str())
        .collect();
    match values.as_slice() {
        [] => true,
        [one] => *one == "airkorea" || *one == "(null)",
        _ => false,
    }
}
/// The KST date `YYYYMMDD` of an instant (`_getCurrentTimeValue(+9).date`).
pub fn kst_date(now: f64) -> u32 {
    crate::world::js::parts(now + 9. * HOUR_MS)
        .map_or(0, |p| (p.year * 10000 + p.month * 100 + p.day) as u32)
}
