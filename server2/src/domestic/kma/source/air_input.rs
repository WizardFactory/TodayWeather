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
    Forecasts, ObsRow, Observations, Stations, arpltn_answer, dust_answer, expected_announcement,
    fallback_arpltn, has_air_value,
};
use super::doc::{Doc, Val};
use super::live::{AirKoreaAcquire, Flights, wait};
use super::records::{Fetched, Reader, months};
use crate::domestic::airkorea::AirKoreaRequest;
use crate::domestic::publication::{self, Publication};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::history::{IndexListing, schedule};
use crate::storage::{CatalogStore, ProviderKey};
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
    capture: Arc<Capture>,
    capture_every: Duration,
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
            capture: Arc::new(Capture::default()),
            capture_every: CAPTURE_EVERY,
        }
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
                let done = capture
                    .hours
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .contains(&hour);
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
        let current = self.station_fold(now, now, deadline).await?;
        let stale = current
            .as_ref()
            .is_none_or(|(_, newest)| *newest < now - STATION_LIST_AGE_MS);
        if stale {
            let rx = self.flight("station-list", AirKoreaRequest::station_list());
            if current.is_none() && wait(rx, deadline).await {
                return Ok(self
                    .station_fold(now, wall_ms().max(now), deadline)
                    .await?
                    .map(|(s, _)| s)
                    .unwrap_or_default());
            }
        }
        Ok(current.map(|(s, _)| s).unwrap_or_default())
    }
    /// Every station-list acquisition since 2026-01 folded in completion order, refreshed every
    /// 10 minutes (new acquisitions are appended; one completed before the last folded one
    /// refolds everything). None when no list was ever acquired.
    /// Acquisitions completed after `until` are not applied yet.
    async fn station_fold(
        &self,
        now: f64,
        until: f64,
        deadline: Instant,
    ) -> Result<Option<(Arc<Stations>, f64)>, String> {
        let generation = self.generation();
        let mut cache = self.stations.lock().await;
        if let Some(c) = cache.as_ref()
            && c.generation == generation
            && c.refreshed.elapsed() < Duration::from_secs(600)
        {
            return Ok(Some((c.stations.clone(), c.newest_ms)));
        }
        let k = key("stations");
        let from = cache.as_ref().map(|c| c.last.1.clone());
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
            let new: Vec<&Fetched> = fetched
                .iter()
                .filter(|f| !c.seen.contains(&id(f)))
                .collect();
            if new.iter().all(|f| id(f) > c.last) {
                let mut stations = (*c.stations).clone();
                for f in new {
                    if let Some(items) = page_items(&f.pages) {
                        stations.apply(&items);
                    }
                    c.newest_ms = c.newest_ms.max(f.fetched_at_ms as f64);
                    c.seen.insert(id(f));
                    c.last = c.last.clone().max(id(f));
                }
                c.stations = Arc::new(stations);
                c.refreshed = std::time::Instant::now();
                c.generation = generation;
                return Ok(Some((c.stations.clone(), c.newest_ms)));
            }
            // A late acquisition: refold from the start.
            *cache = None;
            drop(cache);
            return Box::pin(self.station_fold(now, until, deadline)).await;
        }
        if fetched.is_empty() {
            return Ok(None);
        }
        let mut stations = Stations::default();
        let mut seen = HashSet::new();
        let mut newest = f64::NEG_INFINITY;
        for f in &fetched {
            if let Some(items) = page_items(&f.pages) {
                stations.apply(&items);
            }
            newest = newest.max(f.fetched_at_ms as f64);
            seen.insert(id(f));
        }
        let last = fetched.iter().map(id).max().expect("not empty");
        let stations = Arc::new(stations);
        *cache = Some(StationCache {
            stations: stations.clone(),
            newest_ms: newest,
            seen,
            last,
            refreshed: std::time::Instant::now(),
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
        let (folded, current) = self.observation_fold(now, now, deadline).await?;
        if current {
            return Ok(folded);
        }
        let hour = hour_partition(now);
        let rx = self.flight(&format!("nationwide-{hour}"), AirKoreaRequest::nationwide());
        if wait(rx, deadline).await {
            return Ok(self
                .observation_fold(now, wall_ms().max(now), deadline)
                .await?
                .0);
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
            let previous = cache.take();
            let mut kept: ObsParts = previous
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
            let parsed = tokio::task::spawn_blocking(move || {
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
            .await
            .map_err(|_| "observation parse task failed")?;
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
            let mut folded = Observations::default();
            for (_, _, rows) in &order {
                folded.apply_rows(rows);
            }
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
        let folded = self.forecast_fold(now, now, date, deadline).await?;
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
        let rx = AirKoreaRequest::dust_forecast(search.date())
            .ok()
            .and_then(|r| self.flight(&format!("dust-forecast-{}", search.partition()), r));
        if wait(rx, deadline).await {
            return self
                .forecast_fold(now, wall_ms().max(now), date, deadline)
                .await;
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
        let fetched = self
            .reader
            .all(SOURCE, "airkorea-dust-forecast", &k, &parts, deadline)
            .await
            .map_err(|e| format!("dust-forecast read: {e}"))?;
        let mut out = Forecasts::default();
        for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= until) {
            if let Some(items) = page_items(&f.pages) {
                out.apply(f.fetched_at_ms as f64, &items);
            }
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
        let wait_until = deadline
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
            (Ok(s), Ok(o)) => arpltn_answer(&s, &o, g_coord, now),
            (Err(e), _) | (_, Err(e)) => Err(e),
        };
        let dust = dust.map(|f| {
            let answer = f.and_then(|f| dust_answer(&f, region, city, &format!("{date:08}")));
            (
                (region.to_owned(), city.to_owned(), format!("{date:08}")),
                answer,
            )
        });
        let needs_fallback = arpltn.as_ref().map_or(true, |a| !has_air_value(a));
        let fallback = match (needs_fallback, g_coord) {
            (true, Some((lat, lon))) => {
                Some(((lat, lon), self.fallback(lat, lon, now, wait_until).await))
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
/// The KST date `YYYYMMDD` of an instant (`_getCurrentTimeValue(+9).date`).
pub fn kst_date(now: f64) -> u32 {
    crate::world::js::parts(now + 9. * HOUR_MS)
        .map_or(0, |p| (p.year * 10000 + p.month * 100 + p.day) as u32)
}
