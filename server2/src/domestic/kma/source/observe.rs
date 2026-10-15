//! S15b-2 station observations and ASOS history for the S3 source (#2742).
//!
//! Nationwide KMA pages are acquired once per publication and shared by every cell
//! (single-flight per dataset and publication), then published as raw records (S06):
//! - the AWS minute page (latest; legacy collects it every 2 minutes);
//! - the AWS hourly page per KST hour (legacy runs at minutes 4/9/15/30; here once, from minute
//!   15, when the table is complete), with a once-per-hour backfill of the hours of the 8-day
//!   `getCityHourlyList` window (legacy `getStnPastHourlyWeather`, `mapLimit` 3);
//! - the city observation page of the latest hour (the page serves only its latest hour).
//!
//! The station collections are rebuilt in memory from those records with the legacy saver rules
//! ([`super::stations`]); station coordinates come from the product geocoder like legacy
//! `_convertGeoCodeByApiServer`. ASOS history (`lib/history`) maps a town to the nearest city
//! station within 100 km and requests the station's missing D-7..D-1 ranges per data.go.kr call
//! like `Recovery.run` ([`super::asos`]).
//!
//! A request waits at most [`REQUEST_WAIT`] for the acquisitions it needs; late data is answered
//! as legacy answers absent data, and the owned acquisition continues and stores its records for
//! the next request. Nothing runs without a request.
use super::asos::{AsosFetched, AsosStore};
use super::doc::{Doc, Val};
use super::pages::{merge_aws_city, parse_aws, parse_city};
use super::records::Reader;
use super::stations::{Registry, RowStore, StationGeo};
use crate::domestic::asos::{AsosKind, AsosRequest};
use crate::domestic::family::WebRequest;
use crate::domestic::kma::js::V;
use crate::domestic::kma::policy;
use crate::domestic::publication::Publication;
use crate::domestic::{Acquired, DomesticError};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::history::{IndexListing, schedule};
use crate::storage::{CatalogStore, ProviderKey, RawRecord};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;
use tokio::time::Instant;

/// The longest a request waits for acquisitions (AK, 2026-10-14).
pub const REQUEST_WAIT: Duration = Duration::from_secs(3);
/// Deadline of one owned acquisition plus its publication (the request does not wait for it).
/// Publication allowance of an owned acquisition (S06 PUT and catalog).
const PUBLISH_ALLOWANCE: Duration = Duration::from_secs(10);
/// An owned KMA page acquisition: two attempts at the legacy `kmaScraper` timeout (S13d).
fn page_time() -> Duration {
    crate::domestic::family::owned_provider_time(crate::providers::legacy_timeout::KMA_WEB, 1)
        + PUBLISH_ALLOWANCE
}
/// One ASOS range: up to eight pages, two attempts each at the legacy history timeout.
fn range_time() -> Duration {
    crate::domestic::family::owned_provider_time(
        crate::providers::legacy_timeout::ASOS,
        crate::domestic::asos::MAX_PAGES,
    ) + PUBLISH_ALLOWANCE
}
/// S3 reads of one load (not a provider call).
const READ_DEADLINE: Duration = Duration::from_secs(30);
/// The hourly AWS table of HH:00 is acquired from HH:15.
const HOURLY_READY_MINUTE: u16 = 15;
/// `getCityHourlyList` reads 8 days of hourly rows.
const HOURLY_WINDOW_HOURS: i64 = 8 * 24;
/// Legacy `getStnPastHourlyWeather` fetches past hours three at a time.
const BACKFILL_CONCURRENCY: usize = 3;
/// The minute page is acquired at most once per legacy cadence, whatever the outcome.
const MINUTE_RETRY: Duration = Duration::from_secs(120);
/// A backfill hour that could not be acquired is tried again after this long.
const BACKFILL_RETRY: Duration = Duration::from_secs(6 * 3600);
/// A station's ASOS recovery runs at most once per hour (legacy hourly recovery job).
const ASOS_RUN_RETRY: Duration = Duration::from_secs(3600);
/// A failed ASOS S3 read is retried after this long.
const ASOS_LOAD_RETRY: Duration = Duration::from_secs(60);
/// An AWS hourly page counts as an ongoing-hour ASOS source only when fetched within this long
/// after its hour (AK 2026-10-15: past days come from the ASOS ranges).
const ONGOING_MS: f64 = 2. * 3_600_000.;
/// Memo entries older than this are dropped when the memo grows.
const MEMO_KEEP: Duration = Duration::from_secs(7 * 3600);
/// Minute pages kept in memory (the readers look back 20 minutes).
const MINUTE_KEEP_MS: f64 = 40. * 60_000.;
/// Legacy minute collection cadence.
const MINUTE_CADENCE: i64 = 2;
/// S3 day partitions read again after this long (other processes may have published).
const RELOAD: Duration = Duration::from_secs(300);
/// ASOS station state read again from S3 after this long.
const ASOS_RELOAD: Duration = Duration::from_secs(600);
/// Concurrent station geocoding requests.
const GEOCODE_CONCURRENCY: usize = 4;
/// ASOS range acquisitions in flight at once (legacy recovery runs two workers).
const ASOS_CONCURRENCY: usize = 2;
/// Legacy ASOS mapping radius.
const ASOS_MAX_KM: f64 = 100.;

/// S13 acquisition seam for request-time acquisitions (tests inject doubles).
pub trait Acquire: Send + Sync + 'static {
    fn web(
        &self,
        request: WebRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>>;
    fn asos(
        &self,
        request: AsosRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>>;
}
/// Station address geocoding (`[lon, lat]`), or None.
pub trait Locate: Send + Sync + 'static {
    fn locate(&self, address: String) -> BoxFuture<'_, Option<(f64, f64)>>;
}
/// The product geocoder as legacy `_convertGeoCodeByApiServer` uses it: a Korean location
/// inside the national bounds.
pub struct ProductGeocoder(pub Arc<dyn crate::gateway::Geocoder>);
impl Locate for ProductGeocoder {
    fn locate(&self, address: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async move {
            let geo = self.0.addr(address, "ko".into()).await.ok()?;
            let location = geo.location?;
            let (lat, lon) = (location.lat, location.long);
            (geo.country.as_deref() == Some("KR")
                && lat.is_finite()
                && lon.is_finite()
                && (33. ..=39.).contains(&lat)
                && (124. ..=132.).contains(&lon))
            .then_some((lon, lat))
        })
    }
}

/// The station collections at one instant.
#[derive(Debug, Clone, Default)]
pub struct Folded {
    pub registry: Arc<Registry>,
    pub hourly: Arc<RowStore>,
    pub minute: Arc<RowStore>,
    /// City stations' AWS hourly rows with their fetch instants (ongoing ASOS hours).
    pub national: Arc<HashMap<String, Vec<(f64, Doc)>>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Flight {
    Load,
    Fold,
    Geocode,
    Minute,
    Hourly(Publication),
    City(Publication),
    AsosLoad(String),
    /// One serialized recovery run per station (legacy station lease).
    AsosRun(String),
}
/// Owned acquisition keys: a national dataset and its publication, or a station's recovery run
/// (S13d `OwnedFlights`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Acq {
    /// The minute page due at a 2-minute bucket.
    Minute(Publication),
    Hourly(Publication),
    City(Publication),
    /// The backfill pass of the window ending at this hour.
    Backfill(Publication),
    AsosRun(String),
}
#[derive(Default)]
struct Pages {
    hourly: BTreeMap<Publication, Arc<Vec<Doc>>>,
    /// Fetch instant of each hourly page.
    hourly_at: BTreeMap<Publication, f64>,
    city: BTreeMap<Publication, Arc<Vec<Doc>>>,
    minute: BTreeMap<Publication, Arc<Vec<Doc>>>,
    days: HashMap<u32, std::time::Instant>,
    minute_read: Option<std::time::Instant>,
    /// Pages changed since the last fold.
    dirty: bool,
    /// Hourly or city pages, the seed or station coordinates changed since the last hourly fold.
    hourly_dirty: bool,
}
struct AsosEntry {
    /// The station's data.go.kr acquisitions in fetch order.
    fetched: Vec<AsosFetched>,
    loaded: std::time::Instant,
}
#[derive(Default)]
struct State {
    pages: Pages,
    /// The registry seed (legacy `kmastninfos` copy), when one was imported.
    seed: Option<Arc<Vec<Doc>>>,
    folded: Option<Arc<Folded>>,
    /// Address -> coordinates; failures are retried after an hour (legacy retries each run).
    geo: HashMap<String, (Option<(f64, f64)>, std::time::Instant)>,
    asos: HashMap<String, AsosEntry>,
    asos_failed: HashMap<String, std::time::Instant>,
    /// The hourly part of the last fold (registry, hourly rows, national rows).
    hourly_fold: Option<HourlyFold>,
}
#[derive(Clone)]
struct HourlyFold {
    registry: Arc<Registry>,
    hourly: Arc<RowStore>,
    national: Arc<HashMap<String, Vec<(f64, Doc)>>>,
    unresolved: Vec<String>,
}

pub struct Observations<T> {
    reader: Reader<T>,
    acquire: Arc<dyn Acquire>,
    locate: Arc<dyn Locate>,
    state: Mutex<State>,
    flights: Mutex<HashMap<Flight, watch::Receiver<bool>>>,
    attempts: Mutex<HashMap<Flight, std::time::Instant>>,
    /// ASOS range acquisitions in flight across stations.
    asos_gate: Arc<tokio::sync::Semaphore>,
    /// Owned request-time acquisitions: one task per key, surviving every waiter (S13d).
    owned: crate::resolver::OwnedFlights<Acq, ()>,
}
fn aws_key() -> ProviderKey {
    ProviderKey::Named {
        id: "aws-national".into(),
    }
}
fn city_key() -> ProviderKey {
    ProviderKey::Named {
        id: "city-national".into(),
    }
}
/// `YYYY.MM.DD.HH:MM` of a publication (the legacy requested `pubDate`).
fn dotted(p: Publication) -> String {
    let d = p.date();
    format!(
        "{:04}.{:02}.{:02}.{:02}:{:02}",
        d / 10000,
        (d / 100) % 100,
        d % 100,
        p.hour(),
        p.minute()
    )
}
fn record_publication(r: &RawRecord) -> Option<Publication> {
    let p = &r.envelope.identity.period;
    Publication::new(p.local_date, p.slot.parse().ok()?)
}
/// KST hour whose hourly table is complete at `now_ms`.
pub fn latest_hourly(now_ms: i64) -> Publication {
    let now = schedule::from_ms(now_ms);
    let hour = now.hour_start();
    if now.minute() >= HOURLY_READY_MINUTE {
        hour
    } else {
        hour.add_hours(-1).unwrap_or(hour)
    }
}

impl<T: IndexListing + Clone + Send + Sync + 'static> Observations<T> {
    pub fn new(
        transport: T,
        store: Arc<CatalogStore<T>>,
        acquire: Arc<dyn Acquire>,
        locate: Arc<dyn Locate>,
    ) -> Self {
        Self {
            reader: Reader { transport, store },
            acquire,
            locate,
            state: Mutex::new(State::default()),
            flights: Mutex::new(HashMap::new()),
            attempts: Mutex::new(HashMap::new()),
            asos_gate: Arc::new(tokio::sync::Semaphore::new(ASOS_CONCURRENCY)),
            owned: crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
                running: 16,
                entries: 1024,
                retain: Duration::from_secs(3),
            })
            .expect("static owned acquisition bounds"),
        }
    }
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Start `work` once per key; a key attempted within `memo` is not started again. Returns
    /// the flight to wait for (a running one is joined).
    fn start<F>(
        self: &Arc<Self>,
        key: Flight,
        memo: Duration,
        work: F,
    ) -> Option<watch::Receiver<bool>>
    where
        F: FnOnce(Arc<Self>) -> BoxFuture<'static, ()> + Send + 'static,
    {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(rx) = flights.get(&key) {
            return Some(rx.clone());
        }
        {
            let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
            if attempts.get(&key).is_some_and(|at| at.elapsed() < memo) {
                return None;
            }
            if attempts.len() > 4096 {
                attempts.retain(|_, at| at.elapsed() < MEMO_KEEP);
            }
            attempts.insert(key.clone(), std::time::Instant::now());
        }
        let (tx, rx) = watch::channel(false);
        flights.insert(key.clone(), rx.clone());
        let this = self.clone();
        tokio::spawn(async move {
            let done = this.clone();
            work(this).await;
            done.flights
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&key);
            let _ = tx.send(true);
        });
        Some(rx)
    }
    /// Record an attempt of `key` unless one was made within `memo` (retry bound).
    fn claim(&self, key: &Flight, memo: Duration) -> bool {
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        if attempts.get(key).is_some_and(|at| at.elapsed() < memo) {
            return false;
        }
        if attempts.len() > 4096 {
            attempts.retain(|_, at| at.elapsed() < MEMO_KEEP);
        }
        attempts.insert(key.clone(), std::time::Instant::now());
        true
    }
    /// Join (or start) the owned acquisition `key` and wait for it until `until`; the task gets
    /// `owned_for` and survives the waiter.
    fn own<F>(
        self: &Arc<Self>,
        key: Acq,
        owned_for: Duration,
        until: Instant,
        work: F,
    ) -> BoxFuture<'static, ()>
    where
        F: FnOnce(Arc<Self>) -> BoxFuture<'static, ()> + Send + 'static,
    {
        let owned = self.owned.clone();
        let this = self.clone();
        Box::pin(async move {
            let _ = owned.join(key, until, owned_for, move |_| work(this)).await;
        })
    }
    /// Wait for flights until `until` (late flights keep running).
    async fn wait(flights: Vec<watch::Receiver<bool>>, until: Instant) {
        for mut rx in flights {
            let _ = tokio::time::timeout_at(until, rx.wait_for(|done| *done)).await;
        }
    }

    // ---- national pages ----

    /// The station collections for a request at `now_ms`, waiting for the acquisitions the
    /// request needs until `until`. None when no fold exists yet (the readers answer as legacy
    /// does over empty collections).
    pub async fn stations(self: &Arc<Self>, now_ms: i64, until: Instant) -> Option<Arc<Folded>> {
        // What S3 already holds decides what to acquire.
        Self::wait(self.load(now_ms).into_iter().collect(), until).await;
        let mut owned = Vec::new();
        owned.extend(self.ensure_minute(now_ms, until));
        let latest = latest_hourly(now_ms);
        owned.extend(self.ensure_hourly(latest, until));
        owned.extend(self.ensure_city(latest, until));
        if let Some(previous) = latest.add_hours(-1) {
            owned.extend(self.ensure_hourly(previous, until));
        }
        self.backfill_hours(now_ms);
        crate::history::join_all(owned).await;
        // Pages beyond the readers' reach make the collections out of date by themselves.
        {
            let floor = schedule::from_ms(now_ms - MINUTE_KEEP_MS as i64);
            let mut s = self.state();
            if s.pages.minute.keys().next().is_some_and(|k| *k <= floor) {
                s.pages.dirty = true;
            }
        }
        // Fold; new station addresses are geocoded and folded again within the wait.
        for _ in 0..2 {
            if let Some(rx) = self.fold_if_dirty(now_ms) {
                Self::wait(vec![rx], until).await;
            }
            match self.flight(&Flight::Geocode) {
                Some(rx) => Self::wait(vec![rx], until).await,
                None => break,
            }
        }
        if let Some(rx) = self.fold_if_dirty(now_ms) {
            Self::wait(vec![rx], until).await;
        }
        // Before the first fold the carried seed alone is the registry (no pages yet).
        Some(self.state().folded.clone().unwrap_or_else(seed_only))
    }
    fn flight(&self, key: &Flight) -> Option<watch::Receiver<bool>> {
        self.flights
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .cloned()
    }
    /// Read hourly/city day partitions of the 8-day window and the latest minute pages from S3
    /// (at start and every [`RELOAD`]).
    fn load(self: &Arc<Self>, now_ms: i64) -> Option<watch::Receiver<bool>> {
        let stale = {
            let s = self.state();
            s.pages.minute_read.is_none_or(|at| at.elapsed() >= RELOAD)
        };
        if !stale {
            return None;
        }
        self.start(Flight::Load, Duration::ZERO, move |this| {
            Box::pin(async move { this.read_s3(now_ms).await })
        })
    }
    async fn read_s3(self: Arc<Self>, now_ms: i64) {
        let deadline = Instant::now() + READ_DEADLINE;
        let first = schedule::from_ms(now_ms - HOURLY_WINDOW_HOURS * 3_600_000 - 3_600_000);
        let today = schedule::from_ms(now_ms);
        let mut days = Vec::new();
        let mut d = Publication::new(first.date(), 0);
        while let Some(day) = d {
            if day.date() > today.date() {
                break;
            }
            days.push(day.date());
            d = day.add_hours(24);
        }
        for day in days {
            let fresh = {
                let s = self.state();
                s.pages.days.get(&day).is_some_and(|at| {
                    day < today.date() && at.elapsed() < Duration::from_secs(86_400)
                        || at.elapsed() < RELOAD
                })
            };
            if fresh {
                continue;
            }
            let partition = format!("{day:08}");
            let (aws, city_k) = (aws_key(), city_key());
            let (hourly, city) = tokio::join!(
                self.reader
                    .raw("kma-web", "aws-hourly", &aws, &partition, deadline),
                self.reader
                    .raw("kma-web", "city-obs", &city_k, &partition, deadline),
            );
            let (Ok(hourly), Ok(city)) = (hourly, city) else {
                continue;
            };
            let parsed = tokio::task::spawn_blocking(move || {
                (
                    hourly
                        .iter()
                        .filter_map(|a| parse_hourly(a))
                        .collect::<Vec<_>>(),
                    city.iter()
                        .filter_map(|a| parse_city_record(a))
                        .collect::<Vec<_>>(),
                )
            })
            .await
            .unwrap_or_default();
            let mut s = self.state();
            for (p, rows, at) in parsed.0 {
                if let std::collections::btree_map::Entry::Vacant(e) = s.pages.hourly.entry(p) {
                    e.insert(rows);
                    s.pages.hourly_at.insert(p, at);
                }
            }
            for (p, rows) in parsed.1 {
                s.pages.city.entry(p).or_insert(rows);
            }
            s.pages.days.insert(day, std::time::Instant::now());
            s.pages.dirty = true;
            s.pages.hourly_dirty = true;
        }
        self.state().pages.days.retain(|d, _| *d >= first.date());
        // The newest registry seed, if one was imported.
        if let Some(seed) = self.read_seed(now_ms, deadline).await {
            let mut s = self.state();
            if s.seed
                .as_ref()
                .is_none_or(|old| old.len() != seed.len() || **old != *seed)
            {
                s.seed = Some(Arc::new(seed));
                s.pages.dirty = true;
                s.pages.hourly_dirty = true;
            }
        }
        // Minute pages of the last 40 minutes, newest first.
        let floor = schedule::from_ms(now_ms - MINUTE_KEEP_MS as i64);
        let mut partitions = vec![format!("{:08}", today.date())];
        if floor.date() != today.date() {
            partitions.push(format!("{:08}", floor.date()));
        }
        let mut found = Vec::new();
        for partition in partitions {
            let read = self
                .reader
                .latest_raw(
                    "kma-web",
                    "aws-minute",
                    &aws_key(),
                    &partition,
                    4,
                    |read| {
                        read.last()
                            .and_then(|a| a.first())
                            .and_then(record_publication)
                            .is_some_and(|p| p < floor)
                    },
                    deadline,
                )
                .await;
            if let Ok(read) = read {
                found.extend(read);
            }
        }
        let parsed = tokio::task::spawn_blocking(move || {
            found
                .iter()
                .filter_map(|a| parse_minute(a))
                .filter(|(p, _)| *p > floor)
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();
        let mut s = self.state();
        for (p, rows) in parsed {
            s.pages.minute.entry(p).or_insert(rows);
        }
        s.pages.minute.retain(|k, _| *k > floor);
        s.pages.minute_read = Some(std::time::Instant::now());
        s.pages.dirty = true;
    }
    /// The newest imported seed that parses and was exported after the carried one: partitions
    /// (export days) newest first, acquisitions newest first; a corrupt or older import is
    /// skipped. None keeps the seed in use (the carried one when nothing qualifies).
    async fn read_seed(&self, now_ms: i64, deadline: Instant) -> Option<Vec<Doc>> {
        use super::seed;
        let carried = seed::embedded().exported_at_ms;
        let months = super::history_months(now_ms as f64);
        let parts = self
            .reader
            .partitions(seed::SOURCE, seed::KIND, &seed::key(), &months, deadline)
            .await
            .ok()?;
        for partition in parts.iter().rev() {
            let mut acquisitions = self
                .reader
                .raw(seed::SOURCE, seed::KIND, &seed::key(), partition, deadline)
                .await
                .ok()?;
            acquisitions.sort_by_key(|a| {
                std::cmp::Reverse(a.first().map_or(0, |r| r.envelope.identity.fetched_at_ms))
            });
            for a in &acquisitions {
                if let Some(parsed) = a
                    .first()
                    .and_then(|r| seed::parse(&r.bytes).ok())
                    .filter(|s| s.exported_at_ms > carried)
                {
                    return Some(parsed.docs);
                }
            }
        }
        None
    }
    fn ensure_minute(
        self: &Arc<Self>,
        now_ms: i64,
        until: Instant,
    ) -> Option<BoxFuture<'static, ()>> {
        let latest = self.state().pages.minute.keys().next_back().copied();
        let wanted = schedule::from_ms(now_ms - MINUTE_CADENCE * 60_000);
        if latest.is_some_and(|l| l > wanted) {
            return None;
        }
        let not_before = latest.map(|l| schedule::from_ms(schedule::to_ms(l) + 60_000));
        let step = MINUTE_CADENCE * 60_000;
        let bucket = schedule::from_ms(now_ms.div_euclid(step) * step);
        Some(
            self.own(Acq::Minute(bucket), page_time(), until, move |this| {
                Box::pin(async move {
                    if !this.claim(&Flight::Minute, MINUTE_RETRY) {
                        return;
                    }
                    let request = WebRequest::aws_minute(not_before);
                    if let Some(records) = this
                        .acquire_web(request, Instant::now() + page_time())
                        .await
                        && let Some((p, rows)) = parse_minute(&records)
                    {
                        let mut s = this.state();
                        s.pages.minute.insert(p, rows);
                        let floor = schedule::from_ms(schedule::to_ms(p) - MINUTE_KEEP_MS as i64);
                        s.pages.minute.retain(|k, _| *k > floor);
                        s.pages.dirty = true;
                    }
                })
            }),
        )
    }
    /// The hourly page of `hour` (the latest and previous hours; retried after 10 minutes).
    fn ensure_hourly(
        self: &Arc<Self>,
        hour: Publication,
        until: Instant,
    ) -> Option<BoxFuture<'static, ()>> {
        if self.state().pages.hourly.contains_key(&hour) {
            return None;
        }
        Some(
            self.own(Acq::Hourly(hour), page_time(), until, move |this| {
                Box::pin(async move {
                    if this.claim(&Flight::Hourly(hour), Duration::from_secs(600)) {
                        this.hourly_page(hour).await;
                    }
                })
            }),
        )
    }
    async fn hourly_page(&self, hour: Publication) {
        if self.state().pages.hourly.contains_key(&hour) {
            return;
        }
        let Ok(request) = WebRequest::aws_hourly(hour) else {
            return;
        };
        if let Some(records) = self
            .acquire_web(request, Instant::now() + page_time())
            .await
            && let Some((p, rows, at)) = parse_hourly(&records)
        {
            let mut s = self.state();
            s.pages.hourly.insert(p, rows);
            s.pages.hourly_at.insert(p, at);
            s.pages.dirty = true;
            s.pages.hourly_dirty = true;
        }
    }
    fn ensure_city(
        self: &Arc<Self>,
        hour: Publication,
        until: Instant,
    ) -> Option<BoxFuture<'static, ()>> {
        if self.state().pages.city.contains_key(&hour) {
            return None;
        }
        Some(self.own(Acq::City(hour), page_time(), until, move |this| {
            Box::pin(async move {
                if !this.claim(&Flight::City(hour), Duration::from_secs(600)) {
                    return;
                }
                let Ok(request) = WebRequest::city(hour) else {
                    return;
                };
                if let Some(records) = this
                    .acquire_web(request, Instant::now() + page_time())
                    .await
                    && let Some((p, rows)) = parse_city_record(&records)
                {
                    let mut s = this.state();
                    s.pages.city.insert(p, rows);
                    s.pages.dirty = true;
                    s.pages.hourly_dirty = true;
                }
            })
        }))
    }
    /// One owned backfill pass over the missing hours of the 8-day window, newest first, three
    /// at a time (legacy `getStnPastHourlyWeather`); each hour at most once per
    /// [`BACKFILL_RETRY`]. The request does not wait for it.
    fn backfill_hours(self: &Arc<Self>, now_ms: i64) {
        let latest = latest_hourly(now_ms);
        let missing: Vec<Publication> = {
            let s = self.state();
            (2..HOURLY_WINDOW_HOURS)
                .filter_map(|i| latest.add_hours(-i))
                .filter(|h| !s.pages.hourly.contains_key(h))
                .collect()
        };
        if missing.is_empty() {
            return;
        }
        let pass = self.own(
            Acq::Backfill(latest),
            crate::resolver::owned::MAX_OWNED,
            Instant::now(),
            move |this| {
                Box::pin(async move {
                    // An hour is claimed only when its acquisition starts, so hours a pass
                    // did not reach before its owned deadline stay due for the next pass.
                    let mut pending = missing.into_iter();
                    loop {
                        let chunk: Vec<Publication> = pending
                            .by_ref()
                            .filter(|h| this.claim(&Flight::Hourly(*h), BACKFILL_RETRY))
                            .take(BACKFILL_CONCURRENCY)
                            .collect();
                        if chunk.is_empty() {
                            break;
                        }
                        crate::history::join_all(
                            chunk.iter().map(|h| this.hourly_page(*h)).collect(),
                        )
                        .await;
                    }
                })
            },
        );
        tokio::spawn(pass);
    }
    /// Acquire and publish one KMA page; the published records, or None.
    async fn acquire_web(&self, request: WebRequest, deadline: Instant) -> Option<Vec<RawRecord>> {
        match self.acquire.web(request, deadline).await {
            Ok(Acquired::Complete(acquisition)) => {
                let records = acquisition.records.clone();
                let r = self
                    .reader
                    .store
                    .publish(acquisition.declaration, acquisition.records, deadline)
                    .await;
                r.ok()?;
                Some(records)
            }
            _ => None,
        }
    }
    /// A running fold (joined even when nothing is newer: it may hold this request's pages), or
    /// a new one when pages changed.
    fn fold_if_dirty(self: &Arc<Self>, now_ms: i64) -> Option<watch::Receiver<bool>> {
        if let Some(rx) = self.flight(&Flight::Fold) {
            return Some(rx);
        }
        if !self.state().pages.dirty {
            return None;
        }
        self.start(Flight::Fold, Duration::ZERO, move |this| {
            Box::pin(async move { this.fold(now_ms).await })
        })
    }
    async fn fold(self: Arc<Self>, now_ms: i64) {
        let (inputs, minute, cached) = {
            let mut s = self.state();
            s.pages.dirty = false;
            let first = latest_hourly(now_ms)
                .add_hours(-HOURLY_WINDOW_HOURS)
                .unwrap_or_else(|| latest_hourly(now_ms));
            s.pages.hourly.retain(|h, _| *h >= first);
            s.pages.hourly_at.retain(|h, _| *h >= first);
            s.pages.city.retain(|h, _| *h >= first);
            // Minute pages older than the readers' reach, however they arrived (S3 or local).
            let floor = schedule::from_ms(now_ms - MINUTE_KEEP_MS as i64);
            s.pages.minute.retain(|k, _| *k > floor);
            let cached = s.hourly_fold.clone().filter(|_| !s.pages.hourly_dirty);
            s.pages.hourly_dirty = false;
            let inputs = cached.is_none().then(|| {
                let geo: HashMap<String, (f64, f64)> = s
                    .geo
                    .iter()
                    .filter_map(|(k, (v, _))| Some((k.clone(), (*v)?)))
                    .collect();
                (
                    s.seed
                        .clone()
                        .or_else(|| Some(Arc::new(super::seed::embedded().docs.clone()))),
                    s.pages.hourly.clone(),
                    s.pages.hourly_at.clone(),
                    s.pages.city.clone(),
                    geo,
                )
            });
            (inputs, s.pages.minute.clone(), cached)
        };
        let hourly_fold = match (cached, inputs) {
            (Some(cached), _) => cached,
            (None, Some((seed, hourly, hourly_at, city, geo))) => {
                let Ok((fold, reduced)) = tokio::task::spawn_blocking(move || {
                    fold_hourly(
                        seed.as_deref().map(Vec::as_slice),
                        &hourly,
                        &hourly_at,
                        &city,
                        &geo,
                    )
                })
                .await
                else {
                    return;
                };
                let mut s = self.state();
                // Non-city stations' hourly rows are kept as registry facts only.
                for (h, rows) in reduced {
                    if s.pages.hourly.contains_key(&h) {
                        s.pages.hourly.insert(h, rows);
                    }
                }
                s.hourly_fold = Some(fold.clone());
                fold
            }
            (None, None) => return,
        };
        let minutes = tokio::task::spawn_blocking(move || {
            let mut minutes = RowStore::default();
            for page in minute.values() {
                minutes.save(page);
            }
            minutes
        })
        .await
        .unwrap_or_default();
        self.state().folded = Some(Arc::new(Folded {
            registry: hourly_fold.registry.clone(),
            hourly: hourly_fold.hourly.clone(),
            minute: Arc::new(minutes),
            national: hourly_fold.national.clone(),
        }));
        if !hourly_fold.unresolved.is_empty() {
            self.geocode(hourly_fold.unresolved.clone());
        }
    }
    /// Geocode new station addresses (bounded), then fold again.
    fn geocode(self: &Arc<Self>, addresses: Vec<String>) {
        let wanted: Vec<String> = {
            let s = self.state();
            addresses
                .into_iter()
                .filter(|a| {
                    s.geo.get(a).is_none_or(|(v, at)| {
                        v.is_none() && at.elapsed() >= Duration::from_secs(3600)
                    })
                })
                .collect()
        };
        if wanted.is_empty() {
            return;
        }
        let _ = self.start(Flight::Geocode, Duration::ZERO, move |this| {
            Box::pin(async move {
                let gate = Arc::new(tokio::sync::Semaphore::new(GEOCODE_CONCURRENCY));
                let mut tasks = Vec::new();
                for address in wanted {
                    let (this, gate) = (this.clone(), gate.clone());
                    tasks.push(tokio::spawn(async move {
                        let _permit = gate.acquire_owned().await;
                        let found = tokio::time::timeout(
                            Duration::from_secs(10),
                            this.locate.locate(address.clone()),
                        )
                        .await
                        .ok()
                        .flatten();
                        this.state()
                            .geo
                            .insert(address, (found, std::time::Instant::now()));
                    }));
                }
                for t in tasks {
                    let _ = t.await;
                }
                let mut s = this.state();
                s.pages.dirty = true;
                s.pages.hourly_dirty = true;
            })
        });
    }

    // ---- ASOS history ----

    /// `history.loadForTown(town)` at `now_ms`, waiting for the station's acquisitions until
    /// `until`.
    pub async fn history(
        self: &Arc<Self>,
        town: &Doc,
        folded: Option<&Folded>,
        now_ms: f64,
        until: Instant,
    ) -> OrderedJson {
        let reason = |r: &str, mapping: Option<OrderedJson>| {
            let mut out = Vec::new();
            if let Some(m) = mapping {
                out.push(("mapping", m));
            }
            out.push(("reason", OrderedJson::String(r.encode_utf16().collect())));
            out.push(("hourly", OrderedJson::Array(Vec::new())));
            out.push(("daily", OrderedJson::Array(Vec::new())));
            object(out)
        };
        let Some(folded) = folded else {
            // The station list is still loading: legacy's read budget expired.
            return reason("cache-read-timeout", None);
        };
        let Some(mapping) = nearest(town, folded.registry.docs(), ASOS_MAX_KM) else {
            // Station coordinates still being resolved are late data, not an absent station.
            if self.flight(&Flight::Geocode).is_some() {
                return reason("cache-read-timeout", None);
            }
            return reason("station-unavailable", None);
        };
        let station = mapping.station.clone();
        let Some((start, end, _)) = policy::window(now_ms) else {
            return reason("station-unavailable", None);
        };
        // Station state from S3 (a failed read is retried after ASOS_LOAD_RETRY).
        let (stale, failed) = {
            let s = self.state();
            (
                s.asos
                    .get(&station)
                    .is_none_or(|e| e.loaded.elapsed() >= ASOS_RELOAD),
                s.asos_failed
                    .get(&station)
                    .is_some_and(|at| at.elapsed() < ASOS_LOAD_RETRY),
            )
        };
        if stale && !failed {
            let station_c = station.clone();
            let rx = self.start(
                Flight::AsosLoad(station.clone()),
                ASOS_LOAD_RETRY,
                move |this| Box::pin(async move { this.load_asos(&station_c, now_ms).await }),
            );
            Self::wait(rx.into_iter().collect(), until).await;
        }
        let loaded = self.state().asos.contains_key(&station);
        if !loaded {
            let failed = self
                .state()
                .asos_failed
                .get(&station)
                .is_some_and(|at| at.elapsed() < ASOS_LOAD_RETRY);
            return if failed {
                reason("cache-read-failed", Some(mapping.json()))
            } else {
                reason("cache-read-timeout", None)
            };
        }
        // One recovery run per station at a time and at most once per hour (legacy lease and
        // hourly job): it plans the incomplete ranges and acquires them in order.
        let station_c = station.clone();
        let folded_c = folded.clone();
        let (start_c, end_c) = (start.clone(), end.clone());
        let run_key = Flight::AsosRun(station.clone());
        self.own(
            Acq::AsosRun(station.clone()),
            crate::resolver::owned::MAX_OWNED,
            until,
            move |this| {
                Box::pin(async move {
                    if this.claim(&run_key, ASOS_RUN_RETRY) {
                        this.recover_asos(&station_c, &folded_c, &start_c, &end_c)
                            .await;
                    }
                })
            },
        )
        .await;
        let fetched = self
            .state()
            .asos
            .get(&station)
            .map(|e| e.fetched.clone())
            .unwrap_or_default();
        let store = station_store(&station, &fetched, folded);
        let docs = |d: Vec<Doc>| OrderedJson::Array(d.iter().map(Doc::json).collect());
        object(vec![
            ("mapping", mapping.json()),
            (
                "hourly",
                docs(store.read(
                    AsosKind::Hourly,
                    &station,
                    &format!("{start}0000"),
                    &format!("{end}2300"),
                )),
            ),
            (
                "daily",
                docs(store.read(AsosKind::Daily, &station, &start, &end)),
            ),
        ])
    }
    async fn load_asos(self: Arc<Self>, station: &str, now_ms: f64) {
        let deadline = Instant::now() + READ_DEADLINE;
        let key = AsosRequest::record_key(station);
        // Ranges start at most 7 days before a window that starts 7 days before today.
        let months = super::records::months(now_ms - 15. * 86_400_000., now_ms);
        let mut fetched: Vec<AsosFetched> = Vec::new();
        for kind in [AsosKind::Hourly, AsosKind::Daily] {
            let parts = match self
                .reader
                .partitions("data-go-kr", kind.kind(), &key, &months, deadline)
                .await
            {
                Ok(p) => p,
                Err(_) => {
                    self.state()
                        .asos_failed
                        .insert(station.to_owned(), std::time::Instant::now());
                    return;
                }
            };
            for partition in parts {
                let Some((start, end)) = AsosRequest::parse_partition(kind, &partition) else {
                    continue;
                };
                match self
                    .reader
                    .raw("data-go-kr", kind.kind(), &key, &partition, deadline)
                    .await
                {
                    Ok(acquisitions) => {
                        for records in acquisitions {
                            fetched.push(asos_fetched(kind, &start, &end, &records));
                        }
                    }
                    Err(_) => {
                        self.state()
                            .asos_failed
                            .insert(station.to_owned(), std::time::Instant::now());
                        return;
                    }
                }
            }
        }
        fetched.sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
        let mut s = self.state();
        s.asos_failed.remove(station);
        // Keep acquisitions this process published after the read started.
        let mine: Vec<AsosFetched> = s
            .asos
            .get(station)
            .map(|e| e.fetched.clone())
            .unwrap_or_default();
        for f in mine {
            if !fetched.iter().any(|g| {
                g.fetched_at_ms == f.fetched_at_ms && g.start == f.start && g.kind == f.kind
            }) {
                fetched.push(f);
            }
        }
        fetched.sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
        if let Some((start, _, _)) = policy::window(now_ms) {
            retain_window(&mut fetched, &start);
        }
        s.asos.insert(
            station.to_owned(),
            AsosEntry {
                fetched,
                loaded: std::time::Instant::now(),
            },
        );
    }
    /// Legacy `Recovery.run` for one station: plan the incomplete window ranges, then acquire and
    /// publish them in order (hourly, then daily).
    async fn recover_asos(self: Arc<Self>, station: &str, folded: &Folded, start: &str, end: &str) {
        let fetched = self
            .state()
            .asos
            .get(station)
            .map(|e| e.fetched.clone())
            .unwrap_or_default();
        let plan = station_store(station, &fetched, folded).plan(station, start, end);
        for (kind, a, b) in plan {
            let Ok(request) = AsosRequest::new(kind, station, &a, &b) else {
                continue;
            };
            let _permit = self.asos_gate.clone().acquire_owned().await;
            let deadline = Instant::now() + range_time();
            let Ok(Acquired::Complete(acquisition)) =
                self.acquire.asos(request.clone(), deadline).await
            else {
                continue;
            };
            let records = acquisition.records.clone();
            if self
                .reader
                .store
                .publish(acquisition.declaration, acquisition.records, deadline)
                .await
                .is_err()
            {
                continue;
            }
            let f = asos_fetched(kind, request.start(), request.end(), &records);
            if let Some(entry) = self.state().asos.get_mut(station) {
                entry.fetched.push(f);
                entry
                    .fetched
                    .sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
                retain_window(&mut entry.fetched, start);
            }
        }
    }
}
/// Keep the acquisitions whose range reaches the window (older ones cannot change it).
pub fn retain_window(fetched: &mut Vec<AsosFetched>, start: &str) {
    fetched.retain(|f| f.end.get(..8).is_some_and(|d| d >= start));
}
/// The station's `asos_history` rows: its data.go.kr acquisitions and the ongoing-hour AWS page
/// rows in fetch order.
fn station_store(station: &str, fetched: &[AsosFetched], folded: &Folded) -> AsosStore {
    let national = folded
        .national
        .get(station)
        .map(Vec::as_slice)
        .unwrap_or_default();
    super::asos::replay(station, fetched, national)
}
fn asos_fetched(kind: AsosKind, start: &str, end: &str, records: &[RawRecord]) -> AsosFetched {
    AsosFetched {
        kind,
        start: start.to_owned(),
        end: end.to_owned(),
        fetched_at_ms: records
            .iter()
            .map(|r| r.envelope.identity.fetched_at_ms)
            .max()
            .unwrap_or(0) as f64,
        pages: records.iter().map(|r| r.bytes.clone()).collect(),
    }
}
fn object(pairs: Vec<(&str, OrderedJson)>) -> OrderedJson {
    OrderedJson::Object(
        pairs
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn parse_hourly(records: &[RawRecord]) -> Option<(Publication, Arc<Vec<Doc>>, f64)> {
    let r = records.first()?;
    let requested = record_publication(r)?;
    let page = parse_aws(&r.bytes, Some(&dotted(requested))).ok()?;
    Some((
        requested,
        Arc::new(page.rows),
        r.envelope.identity.fetched_at_ms as f64,
    ))
}
fn parse_city_record(records: &[RawRecord]) -> Option<(Publication, Arc<Vec<Doc>>)> {
    let r = records.first()?;
    let requested = record_publication(r)?;
    let page = parse_city(&r.bytes, &r.envelope.content_type, Some(&dotted(requested))).ok()?;
    Some((requested, Arc::new(page.rows)))
}
fn parse_minute(records: &[RawRecord]) -> Option<(Publication, Arc<Vec<Doc>>)> {
    let r = records.first()?;
    let page = parse_aws(&r.bytes, None).ok()?;
    let p = Publication::parse_dotted(&page.pub_date)?;
    Some((p, Arc::new(page.rows)))
}
struct Table<'a>(&'a HashMap<String, (f64, f64)>);
impl StationGeo for Table<'_> {
    fn locate(&self, addr: &str) -> Option<(f64, f64)> {
        self.0.get(addr).copied()
    }
}
/// Parsed rows of one page.
type Page = Arc<Vec<Doc>>;
/// Registry facts of a station row (the fields `_saveStnInfo` reads).
const FACTS: [&str; 5] = ["stnId", "stnName", "addr", "altitude", "isCityWeather"];
fn facts(row: &Doc) -> Doc {
    let mut out = Doc::new();
    for k in FACTS {
        if let Some(v) = row.get(k) {
            out.set(k, v.clone());
        }
    }
    out
}
/// Rebuild the hourly collections: runs in hour order (AWS rows merged with the city rows of the
/// same hour, or a `cityUnavailable` run). Hourly reads select city stations only, so rows of
/// other stations are needed for registration only; they are returned reduced to registry facts
/// (`reduced`) once a city page names the city stations. Also returns the addresses of
/// unregistered stations without coordinates.
fn fold_hourly(
    seed: Option<&[Doc]>,
    hourly: &BTreeMap<Publication, Arc<Vec<Doc>>>,
    hourly_at: &BTreeMap<Publication, f64>,
    city: &BTreeMap<Publication, Arc<Vec<Doc>>>,
    geo: &HashMap<String, (f64, f64)>,
) -> (HourlyFold, Vec<(Publication, Page)>) {
    let city_ids: BTreeSet<String> = city
        .values()
        .flat_map(|rows| rows.iter())
        .filter_map(|r| r.get("stnId").and_then(Val::as_str).map(str::to_owned))
        .chain(seed.unwrap_or_default().iter().filter_map(|d| {
            (d.get("isCityWeather") == Some(&Val::Bool(true)))
                .then(|| d.get("stnId").and_then(Val::as_str).map(str::to_owned))
                .flatten()
        }))
        .collect();
    let city_id = |r: &Doc| {
        r.get("stnId")
            .and_then(Val::as_str)
            .is_some_and(|id| city_ids.contains(id))
    };
    let mut registry = seed.map(Registry::seeded).unwrap_or_default();
    let mut rows = RowStore::default();
    let mut national: HashMap<String, Vec<(f64, Doc)>> = HashMap::new();
    let mut unresolved = BTreeSet::new();
    let mut reduced = Vec::new();
    let table = Table(geo);
    for (h, aws) in hourly {
        let merged;
        let (run, city_available): (&[Doc], bool) = match city.get(h) {
            Some(c) => {
                merged = merge_aws_city((**aws).clone(), c);
                (&merged, true)
            }
            None => (aws, false),
        };
        registry.apply_run(run, city_available, &table);
        for r in run {
            if let (Some(Val::Str(id)), Some(Val::Str(addr))) = (r.get("stnId"), r.get("addr"))
                && !registry.has(id)
            {
                unresolved.insert(addr.replace("(산간)", ""));
            }
        }
        let kept: Vec<Doc> = run.iter().filter(|r| city_id(r)).cloned().collect();
        rows.save(&kept);
        let at = hourly_at.get(h).copied().unwrap_or(0.);
        // Only pages acquired for the ongoing hour stand for ASOS hours; backfilled history pages
        // do not (past days come from the per-station ranges).
        let ongoing = at <= crate::history::schedule::to_ms(*h) as f64 + ONGOING_MS;
        for r in aws.iter().filter(|r| ongoing && city_id(r)) {
            if let Some(id) = r.get("stnId").and_then(Val::as_str) {
                national
                    .entry(id.trim_start_matches('0').to_owned())
                    .or_default()
                    .push((at, r.clone()));
            }
        }
        if !city_ids.is_empty()
            && aws
                .iter()
                .any(|r| !city_id(r) && r.entries().len() > FACTS.len())
        {
            let small: Vec<Doc> = aws
                .iter()
                .map(|r| if city_id(r) { r.clone() } else { facts(r) })
                .collect();
            reduced.push((*h, Arc::new(small)));
        }
    }
    (
        HourlyFold {
            registry: Arc::new(registry),
            hourly: Arc::new(rows),
            national: Arc::new(national),
            unresolved: unresolved.into_iter().collect(),
        },
        reduced,
    )
}

/// The collections before any page: the carried seed's registry.
fn seed_only() -> Arc<Folded> {
    static ONLY: std::sync::OnceLock<Arc<Folded>> = std::sync::OnceLock::new();
    ONLY.get_or_init(|| {
        Arc::new(Folded {
            registry: Arc::new(Registry::seeded(&super::seed::embedded().docs)),
            ..Folded::default()
        })
    })
    .clone()
}
/// `policy.nearest(town, stations, maxKm)` over the registry's city stations.
pub struct Mapping {
    pub station: String,
    name: Val,
    distance_km: f64,
}
impl Mapping {
    pub fn json(&self) -> OrderedJson {
        object(vec![
            (
                "stationId",
                OrderedJson::String(self.station.encode_utf16().collect()),
            ),
            ("stationName", self.name.json()),
            ("distanceKm", OrderedJson::Number(self.distance_km)),
            (
                "method",
                OrderedJson::String(
                    "nearest-configured-ASOS-city-station"
                        .encode_utf16()
                        .collect(),
                ),
            ),
        ])
    }
}
pub fn nearest(town: &Doc, stations: &[Doc], max_km: f64) -> Option<Mapping> {
    let coord = town.get("gCoord").and_then(Val::as_doc)?;
    let num = |k: &str| match coord.get(k) {
        Some(Val::Num(n)) => *n,
        Some(Val::Str(s)) => crate::world::js::string_to_number(s),
        _ => f64::NAN,
    };
    let (lat, lon) = (num("lat"), num("lon"));
    if !lat.is_finite() || !lon.is_finite() || lat.abs() > 90. || lon.abs() > 180. {
        return None;
    }
    let mut best: Option<Mapping> = None;
    for s in stations {
        if s.get("isCityWeather") != Some(&Val::Bool(true)) {
            continue;
        }
        let Some(Val::Arr(g)) = s.get("geo") else {
            continue;
        };
        let (Some(x), Some(y)) = (
            g.first().and_then(Val::as_num),
            g.get(1).and_then(Val::as_num),
        ) else {
            continue;
        };
        if g.len() != 2 || !x.is_finite() || !y.is_finite() || x.abs() > 180. || y.abs() > 90. {
            continue;
        }
        let id = s.get("stnId").cloned().unwrap_or(Val::Undef);
        let Some(station) = policy::station(&match &id {
            Val::Str(t) => V::s(t),
            Val::Num(n) => V::Num(*n),
            _ => V::Undef,
        }) else {
            continue;
        };
        let rad = std::f64::consts::PI / 180.;
        let dl = (y - lat) * rad;
        let dn = (x - lon) * rad;
        let a =
            (dl / 2.).sin().powi(2) + (lat * rad).cos() * (y * rad).cos() * (dn / 2.).sin().powi(2);
        let km = 6371. * 2. * a.sqrt().min(1.).asin();
        let better = best.as_ref().is_none_or(|b| {
            km < b.distance_km
                || (km == b.distance_km
                    && station.parse::<f64>().unwrap_or(f64::NAN)
                        < b.station.parse::<f64>().unwrap_or(f64::NAN))
        });
        if km <= max_km && better {
            best = Some(Mapping {
                station,
                name: s.get("stnName").cloned().unwrap_or(Val::Undef),
                distance_km: km,
            });
        }
    }
    best
}

/// The S13 acquirer for request-time acquisitions: KMA pages (keyless) and ASOS ranges funded by
/// S08 per data.go.kr key and KST day (each key its own quota owner with `daily_units`; a new
/// window opens when the KST day changes).
pub struct DailyAcquirer<P, W, B> {
    funded: Arc<P>,
    public: Arc<W>,
    budgets: Arc<B>,
    keys: Vec<String>,
    daily_units: u64,
    endpoints: crate::domestic::family::Endpoints,
    clock: Arc<dyn crate::budget::Clock>,
    metrics: Arc<crate::domestic::metrics::DomesticMetrics>,
    current: DailyCurrent<P, W, B>,
}
type DailyCurrent<P, W, B> =
    tokio::sync::Mutex<Option<(i64, Arc<crate::domestic::DomesticAcquirer<P, W, B>>)>>;
/// The S08 quota owner of a data.go.kr key (domain-separated SHA-256 of the key).
pub fn data_go_kr_quota_owner(key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-data-go-kr-quota-v1");
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
const KST_MS: i64 = 9 * 3_600_000;
const DAY_MS: i64 = 86_400_000;
impl<P, W, B> DailyAcquirer<P, W, B>
where
    P: crate::providers::ProviderTransport + 'static,
    W: crate::providers::PublicTransport + 'static,
    B: crate::budget::BudgetTransport + 'static,
{
    #[allow(clippy::too_many_arguments)] // Explicit transports, keys, funding and endpoints.
    pub fn new(
        funded: Arc<P>,
        public: Arc<W>,
        budgets: Arc<B>,
        keys: Vec<String>,
        daily_units: u64,
        endpoints: crate::domestic::family::Endpoints,
        clock: Arc<dyn crate::budget::Clock>,
        metrics: Arc<crate::domestic::metrics::DomesticMetrics>,
    ) -> Result<Self, DomesticError> {
        let this = Self {
            funded,
            public,
            budgets,
            keys,
            daily_units,
            endpoints,
            clock,
            metrics,
            current: tokio::sync::Mutex::new(None),
        };
        // Validate keys and limits once with a window at the epoch.
        this.build(0)?;
        Ok(this)
    }
    fn build(
        &self,
        starts: i64,
    ) -> Result<crate::domestic::DomesticAcquirer<P, W, B>, DomesticError> {
        use crate::budget::{BudgetPolicy, BudgetStore, Provider};
        let invalid = DomesticError::Invalid("data.go.kr key or daily units");
        if self.keys.is_empty() || self.daily_units == 0 {
            return Err(invalid);
        }
        let window_id = crate::world::js::iso((starts + KST_MS) as f64)
            .map(|s| s[..10].to_owned())
            .ok_or(DomesticError::Invalid("window"))?;
        let mut stores = Vec::new();
        for key in &self.keys {
            let policy = BudgetPolicy {
                provider: Provider::DataGoKr,
                quota_id: data_go_kr_quota_owner(key),
                window_id: window_id.clone(),
                starts_at_ms: starts,
                ends_at_ms: starts + DAY_MS,
                limit: self.daily_units,
                block_units: self.daily_units.min(50),
            };
            let store = BudgetStore::new(self.budgets.clone(), policy, self.clock.clone())
                .map_err(|_| invalid.clone())?;
            stores.push(Arc::new(store));
        }
        // One quota owner per key and KST day across the services server2 calls with these keys
        // (S15b-2 ASOS; S15b-3b UV V5, pollen V3 and KASI); each service keeps its own key ring.
        let mut rings = BTreeMap::new();
        for service in [
            crate::domestic::family::Service::Asos,
            crate::domestic::family::Service::LivingWthrIdx,
            crate::domestic::family::Service::HealthWthrIdx,
            crate::domestic::family::Service::RiseSet,
        ] {
            let entries = self
                .keys
                .iter()
                .zip(&stores)
                .map(|(key, store)| {
                    crate::providers::ProviderKey::new(key.clone())
                        .map(|k| (k, store.clone()))
                        .map_err(|_| invalid.clone())
                })
                .collect::<Result<Vec<_>, _>>()?;
            rings.insert(service, crate::domestic::KeyRing::new(entries)?);
        }
        crate::domestic::DomesticAcquirer::new(
            self.funded.clone(),
            self.public.clone(),
            rings,
            self.endpoints.clone(),
            self.clock.clone(),
            self.metrics.clone(),
            crate::storage::CatalogLimits::default(),
        )
    }
    /// The acquirer of the current KST day (S08 windows are per day).
    pub async fn today(
        &self,
    ) -> Result<Arc<crate::domestic::DomesticAcquirer<P, W, B>>, DomesticError> {
        let now = self
            .clock
            .now_ms()
            .map_err(|_| DomesticError::Invalid("clock"))?;
        let starts = (now + KST_MS).div_euclid(DAY_MS) * DAY_MS - KST_MS;
        let mut current = self.current.lock().await;
        if let Some((at, acquirer)) = current.as_ref()
            && *at == starts
        {
            return Ok(acquirer.clone());
        }
        let acquirer = Arc::new(self.build(starts)?);
        *current = Some((starts, acquirer.clone()));
        Ok(acquirer)
    }
}
impl<P, W, B> Acquire for DailyAcquirer<P, W, B>
where
    P: crate::providers::ProviderTransport + 'static,
    W: crate::providers::PublicTransport + 'static,
    B: crate::budget::BudgetTransport + 'static,
{
    fn web(
        &self,
        request: WebRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move { self.today().await?.acquire_web(&request, deadline).await })
    }
    fn asos(
        &self,
        request: AsosRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move { self.today().await?.acquire_asos(&request, deadline).await })
    }
}
