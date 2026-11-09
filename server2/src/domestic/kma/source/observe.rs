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
use super::observe_product::{self as product, DayProduct, MadeOf, StoredPage};
use super::pages::{merge_aws_city, parse_aws, parse_city};
use super::records::Reader;
use super::representative::{self, Verdict};
use super::stations::{Registry, RowStore, StationGeo};
use crate::domestic::asos::{AsosKind, AsosRequest};
use crate::domestic::family::WebRequest;
use crate::domestic::kma::js::V;
use crate::domestic::kma::policy;
use crate::domestic::publication::Publication;
use crate::domestic::{Acquired, DomesticError};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::history::{IndexListing, schedule};
use crate::storage::{CatalogId, CatalogStore, ProviderKey, RawRecord};
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
/// Minute pages restored before the load ends (the newest; the rest follow in
/// [`Flight::LoadRest`]), and the most members of one targeted read.
const MINUTE_FIRST: usize = 4;
/// A day's product is stored at most once per this interval by one process.
const PRODUCT_EVERY: Duration = Duration::from_secs(600);
/// A reduced AWS hourly page whose full read was tried is read again after this long (an S3
/// read, retried as a failed ASOS S3 read is).
const EXPAND_RETRY: Duration = Duration::from_secs(60);
/// Acquisitions of one minute tried, newest first, when a newer one is not complete or does not
/// parse.
const MINUTE_CANDIDATES: usize = 3;
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
/// Stored ASOS ranges of one kind read at once by a station's S3 read.
const ASOS_READS: usize = 4;
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
    /// S16: the hourly and city pages this fold applied (input identities).
    pub pages: Arc<Vec<PageId>>,
    /// S16: the registry's content hash and the instant it first appeared in this process (the
    /// seed, every window page and the station geocodes decide station selection and the ASOS
    /// mapping of every date).
    pub registry_id: Option<(String, f64)>,
}
/// One station page a fold applied: its kind (`aws-hourly`, `city-obs`), hour, fetch instant and
/// raw SHA-256.
#[derive(Debug, Clone, PartialEq)]
pub struct PageId {
    pub kind: &'static str,
    pub hour: Publication,
    pub fetched_at_ms: f64,
    pub sha256: String,
    /// Full canonical identity retained with this page's RAM copy.
    pub raw_id: String,
}
type PageIds = BTreeMap<(&'static str, Publication), (f64, String, String)>;
fn page_ids(ids: &PageIds) -> Arc<Vec<PageId>> {
    Arc::new(
        ids.iter()
            .map(|((kind, hour), (at, sha, raw_id))| PageId {
                kind,
                hour: *hour,
                fetched_at_ms: *at,
                sha256: sha.clone(),
                raw_id: raw_id.clone(),
            })
            .collect(),
    )
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Flight {
    Load,
    /// The rest of a load after the answer: the other days' missing pages and minute pages.
    LoadRest,
    /// Store the day products whose pages changed.
    Product,
    /// Read AWS hourly pages in full again whose reduction misses a city station.
    Expand,
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
    /// The pass over the absent hours of today and yesterday of a raced restore.
    Fill(Publication),
    AsosRun(String),
}
#[derive(Default)]
struct Pages {
    hourly: BTreeMap<Publication, Arc<Vec<Doc>>>,
    /// Fetch instant of each hourly page.
    hourly_at: BTreeMap<Publication, f64>,
    city: BTreeMap<Publication, Arc<Vec<Doc>>>,
    /// Fetch instant and raw hash of each kept hourly and city page (S16 input identities).
    ids: PageIds,
    minute: BTreeMap<Publication, Arc<Vec<Doc>>>,
    days: HashMap<u32, std::time::Instant>,
    /// Days whose latest S3 read failed or was partial (S16 completeness; a later complete read
    /// clears them).
    failed_days: std::collections::BTreeSet<u32>,
    /// Days whose latest S3 read failed (no product is stored for them).
    unreadable: BTreeSet<u32>,
    /// Raw identities of the listed groups of each read day found complete beyond the held
    /// pages (superseded ones; S16 accounts for every listed group).
    known: BTreeMap<u32, BTreeSet<String>>,
    /// Raw identities of a member of each listed group of a read day S06 excluded (S16; checked
    /// again at every read of the day).
    excluded: BTreeMap<u32, BTreeSet<String>>,
    /// AWS hourly pages kept reduced to registry facts outside this city set.
    reduced: BTreeMap<Publication, Arc<BTreeSet<String>>>,
    minute_read: Option<std::time::Instant>,
    /// Pages changed since the last fold.
    dirty: bool,
    /// Hourly or city pages, the seed or station coordinates changed since the last hourly fold.
    hourly_dirty: bool,
}
struct AsosEntry {
    /// The station's data.go.kr acquisitions in fetch order.
    fetched: Vec<AsosFetched>,
    /// When the station state was last read from S3 (None: only this process's ranges of a
    /// raced restore, KMA-RESTART-RACE).
    loaded: Option<std::time::Instant>,
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
    /// Stations with a recovery run in progress (S16 completeness).
    asos_running: std::collections::HashSet<String>,
    /// Stations whose latest S3 read had a group S06 excluded (S16 completeness).
    asos_partial: std::collections::HashSet<String>,
    /// The latest registry seed read failed (S16 completeness).
    seed_failed: bool,
    /// Content hash of the last folded registry and the request instant it first appeared.
    registry_id: Option<(String, f64)>,
    /// The hourly part of the last fold (registry, hourly rows, national rows).
    hourly_fold: Option<HourlyFold>,
    /// What the last product of each day this process read or stored is made of.
    products: HashMap<u32, MadeOf>,
    /// When this process last tried to store each day's product.
    product_attempts: HashMap<u32, std::time::Instant>,
    /// A fold recomputed the hourly part since the products were last compared.
    product_due: bool,
    /// KMA-STATION-FLUSH V1: days a fill pass ended with new pages for. Their product is stored
    /// past [`PRODUCT_EVERY`] (only when what the day is made of changed); an intent waits until
    /// the day can be stored (read without failure, after a fold).
    flush: BTreeSet<u32>,
    /// When this process last read each reduced AWS hourly page in full again.
    expand_attempts: HashMap<Publication, std::time::Instant>,
}
#[derive(Clone)]
struct HourlyFold {
    registry: Arc<Registry>,
    hourly: Arc<RowStore>,
    national: Arc<HashMap<String, Vec<(f64, Doc)>>>,
    unresolved: Vec<String>,
    pages: Arc<Vec<PageId>>,
    /// The city set the hourly rows were kept in full for.
    cities: Arc<BTreeSet<String>>,
}

pub struct Observations<T> {
    reader: Reader<T>,
    /// Reads and writes no request waits for (the rest of a restart read, full reads of reduced
    /// pages and the day products) on the bulk lane of the shared S3 admission (KMA-RESTART-RACE).
    bulk: Reader<T>,
    acquire: Arc<dyn Acquire>,
    locate: Arc<dyn Locate>,
    state: Mutex<State>,
    flights: Mutex<HashMap<Flight, (watch::Receiver<bool>, crate::observability::Context)>>,
    attempts: Mutex<HashMap<Flight, std::time::Instant>>,
    /// ASOS range acquisitions in flight across stations.
    asos_gate: Arc<tokio::sync::Semaphore>,
    /// Owned request-time acquisitions: one task per key, surviving every waiter (S13d).
    owned: crate::resolver::OwnedFlights<Acq, ()>,
    observed_history: bool,
    raw_writer: Option<Arc<crate::storage::response_first::Writer>>,
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
        let bulk = transport.bulk_view();
        Self {
            bulk: Reader {
                store: Arc::new(
                    CatalogStore::new(bulk.clone(), store.limits().clone())
                        .expect("the limits of a built store"),
                ),
                transport: bulk,
            },
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
            observed_history: false,
            raw_writer: None,
        }
    }
    /// Select the ASOS-primary history contract before sharing this owner.
    pub fn observed_history(mut self) -> Self {
        self.observed_history = true;
        self
    }
    pub fn set_raw_writer(&mut self, writer: Arc<crate::storage::response_first::Writer>) {
        self.raw_writer = Some(writer);
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
        if let Some((rx, owner)) = flights.get(&key) {
            crate::observability::link(crate::observability::Component::Domestic, *owner);
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
        let owner = crate::observability::current().child();
        flights.insert(key.clone(), (rx.clone(), owner));
        let this = self.clone();
        crate::observability::spawn(async move {
            let done = this.clone();
            crate::observability::work_at(
                owner,
                crate::observability::Component::Domestic,
                crate::observability::Stage::SharedWork,
                work(this),
            )
            .await;
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
        self.stations_by(now_ms, until, until).await
    }
    /// [`Self::stations`] with the stored restore's head start (KMA-RESTART-RACE): what S3
    /// holds decides what to acquire when the restore ([`Flight::Load`]) is done by `race_at`.
    /// A restore still running then is raced: the owned acquisitions of what memory lacks start
    /// alongside it, as on an empty S3, with the hours of today and yesterday S3 does not list
    /// ([`Self::fill_window`]). Restore and acquisitions are waited for until `until`, and a
    /// restored page never replaces a newer acquired one ([`hold`]).
    pub async fn stations_by(
        self: &Arc<Self>,
        now_ms: i64,
        race_at: Instant,
        until: Instant,
    ) -> Option<Arc<Folded>> {
        let mut load = Box::pin(Self::wait(self.load(now_ms).into_iter().collect(), until));
        let raced = crate::resolver::race::races(
            &mut load,
            race_at,
            until,
            crate::observability::Component::Domestic,
        )
        .await;
        let mut owned = Vec::new();
        owned.extend(self.ensure_minute(now_ms, until));
        let latest = latest_hourly(now_ms);
        // A raced hour fetched now past its ongoing reach would replace a stored ongoing page
        // (its ASOS hour): such an hour is left to the fill, which asks only what S3 lacks.
        let direct =
            |h: Publication| !raced || now_ms as f64 <= schedule::to_ms(h) as f64 + ONGOING_MS;
        let mut asked = Vec::new();
        for hour in std::iter::once(latest).chain(latest.add_hours(-1)) {
            if direct(hour) {
                asked.push(hour);
                owned.extend(self.ensure_hourly(hour, until));
            }
        }
        owned.extend(self.ensure_city(latest, until));
        // ASOS owns completed history under the observed policy. A speculative 192-hour
        // AWS sweep would compete with the foreground sources without proving missing fields.
        if !self.observed_history {
            self.backfill_hours(now_ms);
        }
        // Each acquisition is a part of its own (RR2-page-progress): a page that arrives while a
        // slower provider is still waited for is folded then, not when the slowest one ends.
        let mut parts: futures_util::stream::FuturesUnordered<BoxFuture<'_, ()>> =
            owned.into_iter().collect();
        if raced {
            parts.push(self.fill_window(now_ms, asked, until));
            parts.push(Box::pin(load));
        }
        // Each part ends by `until`. What one brings is folded while the others are waited for,
        // so a restore still running at `until` leaves the acquired pages their fold.
        use futures_util::StreamExt;
        while parts.next().await.is_some() {
            if !parts.is_empty()
                && let Some(rx) = self.fold_if_dirty(now_ms)
            {
                Self::wait(vec![rx], until).await;
            }
        }
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
        // A product comparison a finishing one missed, and a due full read of reduced pages.
        if self.state().product_due && self.flight(&Flight::Product).is_none() {
            self.want_products(now_ms);
        }
        self.expand_due();
        // Before the first fold the carried seed alone is the registry (no pages yet).
        Some(self.state().folded.clone().unwrap_or_else(seed_only))
    }
    fn flight(&self, key: &Flight) -> Option<watch::Receiver<bool>> {
        self.flights
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .map(|(rx, owner)| {
                crate::observability::link(crate::observability::Component::Domestic, *owner);
                rx.clone()
            })
    }
    /// Read the hourly/city pages of the 8-day window and the latest minute pages from S3 (at
    /// start and every [`RELOAD`]). The load ends once the request can answer: every day's
    /// stored product (the parsed pages of that day), the pages of today and yesterday the
    /// products lack, the seed and the newest minute pages. Today's and yesterday's pages are
    /// folded as soon as they are held, before the older days' products and the minute pages
    /// (KMA-STATION-FLUSH V2); the load stays in flight (S16) until it ends. [`Flight::LoadRest`]
    /// then restores the other days' missing pages and the rest of the minute window; no request
    /// waits for it.
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
        let days = window_days(now_ms);
        // Published day catalogs of both page kinds and of the products (S16): a day whose catalog
        // is not listed has nothing published and reads as empty, as S14/S15b listings treat
        // absent catalogs. A failed listing keeps every day to its catalog read.
        let months = super::records::months(schedule::to_ms(first) as f64, now_ms as f64);
        let (aws_k, city_k) = (aws_key(), city_key());
        let (listed_products, listed_hourly, listed_city, seed, mut minutes) = tokio::join!(
            self.reader
                .partitions("kma-web", product::KIND, &aws_k, &months, deadline),
            self.reader
                .partitions("kma-web", "aws-hourly", &aws_k, &months, deadline),
            self.reader
                .partitions("kma-web", "city-obs", &city_k, &months, deadline),
            self.read_seed(now_ms, deadline),
            self.minute_entries(now_ms, deadline),
        );
        self.apply_seed(seed);
        let listed = |l: &Result<Vec<String>, crate::storage::Error>, p: &str| {
            l.as_ref().map_or(true, |l| l.iter().any(|x| x == p))
        };
        // Due days newest first: their catalogs and products, LOOKUPS at a time.
        let due: Vec<(u32, [bool; 3])> = {
            let s = self.state();
            days.iter()
                .rev()
                .filter(|day| {
                    !s.pages.days.get(day).is_some_and(|at| {
                        **day < today.date() && at.elapsed() < Duration::from_secs(86_400)
                            || at.elapsed() < RELOAD
                    })
                })
                .map(|day| {
                    let p = format!("{day:08}");
                    (
                        *day,
                        [
                            listed(&listed_hourly, &p),
                            listed(&listed_city, &p),
                            listed(&listed_products, &p),
                        ],
                    )
                })
                .collect()
        };
        // Today and yesterday are compared now; the other days after the answer. KMA-STATION-FLUSH
        // V2: today's and yesterday's catalogs and products are read, compared and folded without
        // waiting for the older days' catalogs and products (read meanwhile, from the lookups
        // left) or the minute pages (read after both).
        let yesterday = today.add_hours(-24).map_or(today.date(), Publication::date);
        let (recent, older): (Vec<_>, Vec<_>) =
            due.into_iter().partition(|(day, _)| *day >= yesterday);
        let lookups = super::records::LOOKUPS.saturating_sub(recent.len()).max(1);
        use futures_util::StreamExt;
        let ((), rest) = tokio::join!(
            async {
                if recent.is_empty() {
                    return;
                }
                let mut reads = crate::history::join_all(
                    recent
                        .into_iter()
                        .map(|(day, want)| self.list_day(day, want, deadline))
                        .collect(),
                )
                .await;
                self.apply_products(&mut reads);
                crate::history::join_all(
                    reads
                        .into_iter()
                        .map(|r| self.complete_day(&self.reader, r, deadline))
                        .collect(),
                )
                .await;
                self.fold_held(now_ms).await;
            },
            async {
                let mut reads: Vec<DayRead> = futures_util::stream::iter(older)
                    .map(|(day, want)| self.list_day(day, want, deadline))
                    .buffered(lookups)
                    .collect()
                    .await;
                self.apply_products(&mut reads);
                reads
            },
        );
        let floor = schedule::from_ms(now_ms - MINUTE_KEEP_MS as i64);
        let later = minutes.split_off(minutes.len().min(MINUTE_FIRST));
        self.restore_minutes(&self.reader, minutes, floor, deadline)
            .await;
        {
            let mut s = self.state();
            s.pages.minute.retain(|k, _| *k > floor);
            s.pages.minute_read = Some(std::time::Instant::now());
            s.pages.dirty = true;
            let oldest = first.date();
            s.pages.days.retain(|d, _| *d >= oldest);
            s.pages.failed_days.retain(|d| *d >= oldest);
            s.pages.unreadable.retain(|d| *d >= oldest);
            s.pages.excluded.retain(|d, _| *d >= oldest);
            s.pages.known.retain(|d, _| *d >= oldest);
            s.products.retain(|d, _| *d >= oldest);
            s.product_attempts.retain(|d, _| *d >= oldest);
            s.flush.retain(|d| *d >= oldest);
        }
        // No request waits for the rest: it reads on the bulk lane.
        if !rest.is_empty() || !later.is_empty() {
            let _ = self.start(Flight::LoadRest, Duration::ZERO, move |this| {
                Box::pin(async move {
                    for day in rest {
                        this.complete_day(&this.bulk, day, Instant::now() + READ_DEADLINE)
                            .await;
                    }
                    this.restore_minutes(&this.bulk, later, floor, Instant::now() + READ_DEADLINE)
                        .await;
                })
            });
        }
    }
    /// Use the seed read (S16: a failed read leaves the registry unproven; the previous seed stays
    /// in use).
    fn apply_seed(&self, seed: Result<(Option<Vec<Doc>>, bool), ()>) {
        let mut s = self.state();
        s.seed_failed = !matches!(seed, Ok((_, false)));
        if let Ok((Some(seed), _)) = seed
            && s.seed
                .as_ref()
                .is_none_or(|old| old.len() != seed.len() || **old != *seed)
        {
            s.seed = Some(Arc::new(seed));
            s.pages.dirty = true;
            s.pages.hourly_dirty = true;
        }
    }
    /// List one day's page catalogs (control objects only) and, the first time this process
    /// reads the day, read and decode its newest product.
    async fn list_day(&self, day: u32, want: [bool; 3], deadline: Instant) -> DayRead {
        let partition = format!("{day:08}");
        let known = self.state().pages.days.contains_key(&day);
        let list = |kind: &'static str, key: ProviderKey, wanted: bool| {
            let partition = partition.clone();
            async move {
                if !wanted {
                    return Ok(None);
                }
                let id = super::records::catalog("kma-web", kind, &key, &partition)?;
                let entries = self.reader.listed_acquisitions(&id, deadline).await?;
                Ok::<_, crate::storage::Error>(Some((id, entries)))
            }
        };
        let (hourly, city, products) = tokio::join!(
            list("aws-hourly", aws_key(), want[0]),
            list("city-obs", city_key(), want[1]),
            list(product::KIND, aws_key(), want[2] && !known),
        );
        let listed = match (hourly, city) {
            (Ok(hourly), Ok(city)) => {
                let mut pages = Vec::new();
                for (kind, listed) in [("aws-hourly", hourly), ("city-obs", city)] {
                    let Some((id, entries)) = listed else {
                        continue;
                    };
                    for (_, _, e) in entries {
                        if let Some(page) = ListedPage::new(kind, &id, e) {
                            pages.push(page);
                        }
                    }
                }
                Some(pages)
            }
            _ => None,
        };
        let newest = match (&listed, products) {
            (Some(_), Ok(Some((id, entries)))) => entries
                .into_iter()
                .max_by(|a, b| {
                    (a.0, &a.2.identity.raw_sha256).cmp(&(b.0, &b.2.identity.raw_sha256))
                })
                .map(|(_, _, e)| (id, e.identity)),
            _ => None,
        };
        let product = match newest {
            Some((id, member)) => self.read_product(&id, member, day, deadline).await,
            None => None,
        };
        DayRead {
            day,
            listed,
            product,
            base: None,
        }
    }
    /// One stored product of `day`, decoded; None when it cannot be read or is not a product of
    /// this schema and parse revision.
    async fn read_product(
        &self,
        id: &CatalogId,
        member: crate::storage::RecordId,
        day: u32,
        deadline: Instant,
    ) -> Option<DayProduct> {
        let read = self
            .reader
            .members(id, std::slice::from_ref(&member), deadline)
            .await
            .ok()
            .flatten()?;
        let bytes = read.first()?.first()?.bytes.clone();
        crate::observability::spawn_blocking(move || DayProduct::decode(&bytes, day))
            .await
            .ok()
            .flatten()
    }
    /// Hold the pages of each read product that its day catalogs list (S3 is truth), unless the
    /// product's city set does not cover the current one (its reduced rows may lack a city
    /// station's fields): such a day reads its raw pages. A held product's day is then compared
    /// with its catalogs; a day this process read before is compared with what it holds.
    fn apply_products(&self, reads: &mut [DayRead]) {
        let mut s = self.state();
        let cities = {
            let seed = s
                .seed
                .clone()
                .unwrap_or_else(|| Arc::new(super::seed::embedded().docs.clone()));
            let held = s.pages.city.values().map(|rows| &**rows);
            let stored = reads
                .iter()
                .filter_map(|r| r.product.as_ref())
                .flat_map(|p| p.pages.iter())
                .filter(|page| page.kind == "city-obs")
                .map(|page| &*page.rows);
            city_ids(Some(&seed), held.chain(stored))
        };
        for r in reads.iter_mut() {
            if s.pages.days.contains_key(&r.day) {
                r.base = Some(Accounted {
                    known: s.pages.known.get(&r.day).cloned().unwrap_or_default(),
                    excluded: s.pages.excluded.get(&r.day).cloned().unwrap_or_default(),
                });
                continue;
            }
            let (Some(listed), Some(stored)) = (&r.listed, r.product.take()) else {
                continue;
            };
            if !stored.city_ids.is_superset(&cities) {
                continue;
            }
            s.products.insert(r.day, stored.made_of());
            let reduced = Arc::new(stored.city_ids.clone());
            let mut stored = stored;
            for page in std::mem::take(&mut stored.pages) {
                if !listed.iter().any(|l| l.raw_id == page.raw_id) {
                    continue;
                }
                let reduced = (page.kind == "aws-hourly").then(|| reduced.clone());
                let raw_id = page.raw_id.clone();
                let held = (
                    page.hour,
                    page.rows,
                    page.fetched_at_ms,
                    page.sha256,
                    page.raw_id,
                );
                // A newer page of the hour (a provider page of a raced restore) stays held; the
                // product's page is a complete listed group all the same.
                if !hold(&mut s.pages, page.kind, held, reduced) {
                    stored.known.insert(raw_id);
                }
            }
            r.base = Some(Accounted {
                known: stored.known,
                excluded: stored.excluded,
            });
            s.pages.dirty = true;
            s.pages.hourly_dirty = true;
        }
    }
    /// Bring one day up to its catalogs. With pages held for it (a product, or an earlier read),
    /// only the listed groups not accounted for are restored: the excluded ones again and the new
    /// ones, and a new page newer than the held one of its kind and hour is parsed and held.
    /// Otherwise, or when such a page does not parse, every page of the day is read as before
    /// (the newest complete page of each hour).
    async fn complete_day(&self, reader: &Reader<T>, r: DayRead, deadline: Instant) {
        let DayRead {
            day, listed, base, ..
        } = r;
        let Some(listed) = listed else {
            self.day_failed(day);
            return;
        };
        if let Some(base) = base {
            match self.compare_day(reader, day, &listed, base, deadline).await {
                Ok(Some((changed, accounted))) => return self.day_read(day, accounted, changed),
                Ok(None) => {}
                Err(()) => return self.day_failed(day),
            }
        }
        self.raw_day(reader, day, &listed, deadline).await;
    }
    /// [`Self::complete_day`] with pages held. Ok(None): a new newest page does not parse.
    async fn compare_day(
        &self,
        reader: &Reader<T>,
        day: u32,
        listed: &[ListedPage],
        base: Accounted,
        deadline: Instant,
    ) -> Result<Option<(bool, Accounted)>, ()> {
        let Accounted { mut known, .. } = base;
        let unknown: Vec<&ListedPage> = {
            let s = self.state();
            let held: BTreeSet<&str> = s
                .pages
                .ids
                .iter()
                .filter(|((_, hour), _)| hour.date() == day)
                .map(|(_, (_, _, raw_id))| raw_id.as_str())
                .collect();
            listed
                .iter()
                .filter(|p| !held.contains(p.raw_id.as_str()) && !known.contains(&p.raw_id))
                .collect()
        };
        let wanted: Vec<(CatalogId, crate::storage::RecordId)> = unknown
            .iter()
            .map(|p| (p.catalog.clone(), p.member.clone()))
            .collect();
        let read = self.restore(reader, &wanted, deadline).await?;
        let mut excluded = BTreeSet::new();
        let mut complete: Vec<(&ListedPage, Vec<RawRecord>)> = Vec::new();
        for (page, records) in unknown.into_iter().zip(read) {
            match records {
                Some(records) => {
                    known.insert(page.raw_id.clone());
                    complete.push((page, records));
                }
                None => {
                    excluded.insert(page.raw_id.clone());
                }
            }
        }
        // Of each kind and hour the newest complete new page, when newer than the held one.
        let mut newest: BTreeMap<(&'static str, Publication), (&ListedPage, Vec<RawRecord>)> =
            BTreeMap::new();
        for (page, records) in complete {
            match newest.get(&(page.kind, page.hour)) {
                Some((other, _))
                    if !newer(page.at, &page.sha256, Some((other.at, &other.sha256))) => {}
                _ => {
                    newest.insert((page.kind, page.hour), (page, records));
                }
            }
        }
        let found: Vec<(&'static str, Vec<RawRecord>)> = {
            let s = self.state();
            newest
                .into_values()
                .filter(|(page, _)| {
                    newer(
                        page.at,
                        &page.sha256,
                        s.pages
                            .ids
                            .get(&(page.kind, page.hour))
                            .map(|(at, sha, _)| (*at, sha.as_str())),
                    )
                })
                .map(|(page, records)| (page.kind, records))
                .collect()
        };
        let parsed = crate::observability::spawn_blocking(move || {
            found
                .iter()
                .map(|(kind, records)| {
                    let parsed = if *kind == "aws-hourly" {
                        parse_hourly(records)
                    } else {
                        parse_city_record(records)
                    };
                    parsed.map(|page| (*kind, page))
                })
                .collect::<Option<Vec<_>>>()
        })
        .await
        .ok()
        .flatten();
        let Some(parsed) = parsed else {
            return Ok(None);
        };
        let mut s = self.state();
        let mut changed = false;
        for (kind, page) in parsed {
            changed |= hold(&mut s.pages, kind, page, None);
        }
        // Pages a newer one replaced stay accounted for.
        known.extend(s.pages.known.get(&day).into_iter().flatten().cloned());
        Ok(Some((changed, Accounted { known, excluded })))
    }
    /// Restore `wanted` (catalog and member), a few members per catalog read (each read is bounded
    /// by the S06 lookup deadline): the records of each, or None when its group is not complete.
    /// Err: a read failed.
    async fn restore(
        &self,
        reader: &Reader<T>,
        wanted: &[(CatalogId, crate::storage::RecordId)],
        deadline: Instant,
    ) -> Result<Vec<Option<Vec<RawRecord>>>, ()> {
        let mut out: Vec<Option<Vec<RawRecord>>> = vec![None; wanted.len()];
        let mut at = 0;
        while at < wanted.len() {
            let catalog = &wanted[at].0;
            let mut end = at + 1;
            while end < wanted.len() && end - at < MINUTE_FIRST && wanted[end].0 == *catalog {
                end += 1;
            }
            let members: Vec<_> = wanted[at..end].iter().map(|(_, m)| m.clone()).collect();
            match reader.members(catalog, &members, deadline).await {
                Ok(Some(read)) if read.len() == members.len() => {
                    for (slot, records) in out[at..end].iter_mut().zip(read) {
                        *slot = Some(records);
                    }
                }
                Ok(_) if members.len() == 1 => {}
                Ok(_) => {
                    // One of them is not complete: each alone.
                    for (slot, member) in out[at..end].iter_mut().zip(&members) {
                        *slot = reader
                            .members(catalog, std::slice::from_ref(member), deadline)
                            .await
                            .map_err(|_| ())?
                            .and_then(|mut read| read.pop());
                    }
                }
                Err(_) => return Err(()),
            }
            at = end;
        }
        Ok(out)
    }
    /// Read every page of one day (each complete acquisition is restored and parsed).
    async fn raw_day(
        &self,
        reader: &Reader<T>,
        day: u32,
        listed: &[ListedPage],
        deadline: Instant,
    ) {
        let partition = format!("{day:08}");
        let (aws, city_k) = (aws_key(), city_key());
        let (want_hourly, want_city) = (
            listed.iter().any(|p| p.kind == "aws-hourly"),
            listed.iter().any(|p| p.kind == "city-obs"),
        );
        let (hourly, city) = tokio::join!(
            async {
                if want_hourly {
                    reader
                        .raw_excluded("kma-web", "aws-hourly", &aws, &partition, deadline)
                        .await
                } else {
                    Ok((Vec::new(), Vec::new()))
                }
            },
            async {
                if want_city {
                    reader
                        .raw_excluded("kma-web", "city-obs", &city_k, &partition, deadline)
                        .await
                } else {
                    Ok((Vec::new(), Vec::new()))
                }
            },
        );
        let (Ok((hourly, hourly_excluded)), Ok((city, city_excluded))) = (hourly, city) else {
            return self.day_failed(day);
        };
        // S16: every listed group is complete (known) or excluded.
        let key = |r: &RawRecord| r.envelope.identity.object_key().ok();
        let accounted = Accounted {
            known: hourly
                .iter()
                .chain(&city)
                .filter_map(|a| a.first().and_then(key))
                .collect(),
            excluded: hourly_excluded
                .iter()
                .chain(&city_excluded)
                .filter_map(|id| id.object_key().ok())
                .collect(),
        };
        let parsed = crate::observability::spawn_blocking(move || {
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
        {
            let mut s = self.state();
            for page in parsed.0 {
                hold(&mut s.pages, "aws-hourly", page, None);
            }
            for page in parsed.1 {
                hold(&mut s.pages, "city-obs", page, None);
            }
        }
        // S16: a group S06 excluded makes the day's read partial.
        self.day_read(day, accounted, true);
    }
    /// A day read completely: its listed groups found complete and those S06 excluded (S16).
    fn day_read(&self, day: u32, accounted: Accounted, changed: bool) {
        let mut s = self.state();
        s.pages.days.insert(day, std::time::Instant::now());
        s.pages.unreadable.remove(&day);
        let partial = !accounted.excluded.is_empty();
        s.pages.known.insert(day, accounted.known);
        s.pages.excluded.insert(day, accounted.excluded);
        if partial {
            s.pages.failed_days.insert(day);
        } else {
            s.pages.failed_days.remove(&day);
        }
        if changed {
            s.pages.dirty = true;
            s.pages.hourly_dirty = true;
        }
    }
    /// A day whose catalogs or pages could not be read (S16; nothing is stored for it).
    fn day_failed(&self, day: u32) {
        let mut s = self.state();
        s.pages.unreadable.insert(day);
        s.pages.failed_days.insert(day);
    }
    /// The minute pages of the readers' reach that this process does not hold, newest first by
    /// completion: the day catalogs are listed (control objects only, no record is read). Of each
    /// minute up to [`MINUTE_CANDIDATES`] acquisitions are kept, newest first (the order a
    /// latest-first read meets them). A catalog that cannot be listed adds nothing (the next reload
    /// lists it again).
    async fn minute_entries(&self, now_ms: i64, deadline: Instant) -> Vec<Vec<MinuteEntry>> {
        let floor = schedule::from_ms(now_ms - MINUTE_KEEP_MS as i64);
        let today = schedule::from_ms(now_ms);
        let mut partitions = vec![format!("{:08}", today.date())];
        if floor.date() != today.date() {
            partitions.push(format!("{:08}", floor.date()));
        }
        let held: BTreeSet<Publication> = self.state().pages.minute.keys().copied().collect();
        let mut minutes: BTreeMap<Publication, Vec<MinuteEntry>> = BTreeMap::new();
        for partition in partitions {
            let Ok(id) = super::records::catalog("kma-web", "aws-minute", &aws_key(), &partition)
            else {
                continue;
            };
            let Ok(listed) = self.reader.listed_acquisitions(&id, deadline).await else {
                continue;
            };
            for (completed, _, e) in listed {
                let Some(p) = Publication::new(
                    e.identity.period.local_date,
                    e.identity.period.slot.parse().unwrap_or(u16::MAX),
                ) else {
                    continue;
                };
                if p <= floor || held.contains(&p) {
                    continue;
                }
                minutes.entry(p).or_default().push(MinuteEntry {
                    catalog: id.clone(),
                    member: e.identity,
                    completed,
                });
            }
        }
        let mut out: Vec<Vec<MinuteEntry>> = minutes
            .into_values()
            .map(|mut candidates| {
                candidates.sort_by(|a, b| b.order().cmp(&a.order()));
                candidates.truncate(MINUTE_CANDIDATES);
                candidates
            })
            .collect();
        out.sort_by(|a, b| b[0].order().cmp(&a[0].order()));
        out
    }
    /// Restore the minutes (candidates newest first) and keep the pages after `floor` that this
    /// process does not hold: the newest acquisition of each, and for a minute whose acquisition
    /// is not complete or does not parse, the next one.
    async fn restore_minutes(
        &self,
        reader: &Reader<T>,
        minutes: Vec<Vec<MinuteEntry>>,
        floor: Publication,
        deadline: Instant,
    ) {
        let mut pending: Vec<std::vec::IntoIter<MinuteEntry>> =
            minutes.into_iter().map(Vec::into_iter).collect();
        let mut done = vec![false; pending.len()];
        let mut kept = Vec::new();
        for _ in 0..MINUTE_CANDIDATES {
            let round: Vec<(usize, MinuteEntry)> = pending
                .iter_mut()
                .enumerate()
                .filter(|(i, _)| !done[*i])
                .filter_map(|(i, c)| c.next().map(|e| (i, e)))
                .collect();
            if round.is_empty() {
                break;
            }
            let wanted: Vec<_> = round
                .iter()
                .map(|(_, e)| (e.catalog.clone(), e.member.clone()))
                .collect();
            let Ok(read) = self.restore(reader, &wanted, deadline).await else {
                break;
            };
            let parsed = crate::observability::spawn_blocking(move || {
                read.iter()
                    .map(|a| a.as_deref().and_then(parse_minute))
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();
            for ((i, _), page) in round.iter().zip(parsed) {
                if let Some((p, rows)) = page {
                    done[*i] = true;
                    if p > floor {
                        kept.push((p, rows));
                    }
                }
            }
        }
        if kept.is_empty() {
            return;
        }
        let mut s = self.state();
        for (p, rows) in kept {
            s.pages.minute.entry(p).or_insert(rows);
        }
        s.pages.dirty = true;
    }
    /// The newest imported seed that parses and was exported after the carried one: partitions
    /// (export days) newest first, acquisitions newest first; a corrupt or older import is
    /// skipped. None keeps the seed in use (the carried one when nothing qualifies).
    /// Also reports whether a listed seed import was excluded by S06 (S16 completeness).
    async fn read_seed(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<(Option<Vec<Doc>>, bool), ()> {
        use super::seed;
        let mut partial = false;
        let carried = seed::embedded().exported_at_ms;
        let months = super::history_months(now_ms as f64);
        let parts = self
            .reader
            .partitions(seed::SOURCE, seed::KIND, &seed::key(), &months, deadline)
            .await
            .map_err(|_| ())?;
        for partition in parts.iter().rev() {
            let (mut acquisitions, excluded) = self
                .reader
                .raw_counted(seed::SOURCE, seed::KIND, &seed::key(), partition, deadline)
                .await
                .map_err(|_| ())?;
            // A seed import S06 excluded (raw body missing): the seed used may not be the newest.
            partial |= excluded > 0;
            acquisitions.sort_by_key(|a| {
                std::cmp::Reverse(a.first().map_or(0, |r| r.envelope.identity.fetched_at_ms))
            });
            for a in &acquisitions {
                if let Some(parsed) = a
                    .first()
                    .and_then(|r| seed::parse(&r.bytes).ok())
                    .filter(|s| s.exported_at_ms > carried)
                {
                    return Ok((Some(parsed.docs), partial));
                }
            }
        }
        Ok((None, partial))
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
    /// Acquire the AWS hourly page of `hour` unless one is held; true when the acquired page is
    /// held.
    async fn hourly_page(&self, hour: Publication) -> bool {
        if self.state().pages.hourly.contains_key(&hour) {
            return false;
        }
        let Ok(request) = WebRequest::aws_hourly(hour) else {
            return false;
        };
        if let Some(records) = self
            .acquire_web(request, Instant::now() + page_time())
            .await
            && let Some(page) = parse_hourly(&records)
        {
            // Newest wins: a restore that held this hour meanwhile keeps a newer page.
            let mut s = self.state();
            if hold(&mut s.pages, "aws-hourly", page, None) {
                s.pages.dirty = true;
                s.pages.hourly_dirty = true;
                return true;
            }
        }
        false
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
                    && let Some(page) = parse_city_record(&records)
                {
                    let mut s = this.state();
                    if hold(&mut s.pages, "city-obs", page, None) {
                        s.pages.dirty = true;
                        s.pages.hourly_dirty = true;
                    }
                }
            })
        }))
    }
    /// KMA-RESTART-RACE (AK 2026-11-07, decision 3): the AWS hourly pages of today and yesterday
    /// (before `latest`, other than the hours `asked` directly) that neither the day catalogs list
    /// nor memory holds, in one owned pass newest first, three at a time, each hour at most once
    /// per [`BACKFILL_RETRY`]. A held or listed hour is never fetched again (a later page would
    /// replace an ongoing one), and the days before yesterday come from S3 alone. A day whose
    /// catalog cannot be listed is not filled (absence is not proven). At the end of the pass the
    /// products of the days it held new pages for are stored ([`Self::flush_products`]).
    fn fill_window(
        self: &Arc<Self>,
        now_ms: i64,
        asked: Vec<Publication>,
        until: Instant,
    ) -> BoxFuture<'static, ()> {
        let latest = latest_hourly(now_ms);
        let today = schedule::from_ms(now_ms);
        let days: Vec<u32> = [today.add_hours(-24), Some(today)]
            .into_iter()
            .flatten()
            .map(|p| p.date())
            .collect();
        self.own(
            Acq::Fill(latest),
            crate::resolver::owned::MAX_OWNED,
            until,
            move |this| {
                Box::pin(async move {
                    let deadline = Instant::now() + READ_DEADLINE;
                    let listed = crate::history::join_all(
                        days.iter()
                            .map(|day| this.listed_hours(*day, deadline))
                            .collect(),
                    )
                    .await;
                    let mut wanted: Vec<Publication> = Vec::new();
                    for (day, listed) in days.iter().zip(listed) {
                        let Some(listed) = listed else {
                            continue;
                        };
                        let mut hour = Publication::new(*day, 0);
                        while let Some(h) = hour.filter(|h| h.date() == *day && *h < latest) {
                            if !listed.contains(&h) && !asked.contains(&h) {
                                wanted.push(h);
                            }
                            hour = h.add_hours(1);
                        }
                    }
                    wanted.retain(|h| !this.state().pages.hourly.contains_key(h));
                    wanted.sort_by(|a, b| b.cmp(a));
                    // An hour is claimed only when its acquisition starts, as a backfill pass.
                    let mut pending = wanted.into_iter();
                    let mut filled = BTreeSet::new();
                    loop {
                        let chunk: Vec<Publication> = pending
                            .by_ref()
                            .filter(|h| this.claim(&Flight::Hourly(*h), BACKFILL_RETRY))
                            .take(BACKFILL_CONCURRENCY)
                            .collect();
                        if chunk.is_empty() {
                            break;
                        }
                        let held = crate::history::join_all(
                            chunk.iter().map(|h| this.hourly_page(*h)).collect(),
                        )
                        .await;
                        filled.extend(
                            chunk
                                .iter()
                                .zip(held)
                                .filter(|(_, held)| *held)
                                .map(|(h, _)| h.date()),
                        );
                    }
                    // KMA-STATION-FLUSH V1: the products of the days the pass held new pages for
                    // are stored now, not when PRODUCT_EVERY next allows.
                    if !filled.is_empty() {
                        this.flush_products(filled, now_ms).await;
                    }
                })
            },
        )
    }
    /// The AWS hourly hours one day catalog lists (control object only), or None when it cannot
    /// be listed.
    async fn listed_hours(&self, day: u32, deadline: Instant) -> Option<BTreeSet<Publication>> {
        let id = super::records::catalog("kma-web", "aws-hourly", &aws_key(), &format!("{day:08}"))
            .ok()?;
        let entries = self.reader.listed_acquisitions(&id, deadline).await.ok()?;
        Some(
            entries
                .into_iter()
                .filter_map(|(_, _, e)| ListedPage::new("aws-hourly", &id, e))
                .map(|page| page.hour)
                .collect(),
        )
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
        crate::observability::spawn(pass);
    }
    /// Acquire and publish one KMA page; the published records, or None.
    async fn acquire_web(&self, request: WebRequest, deadline: Instant) -> Option<Vec<RawRecord>> {
        if let Some(writer) = &self.raw_writer {
            let key = format!("station/{request:?}");
            let acquire = self.acquire.clone();
            let reserve = crate::storage::Limits::default().raw_bytes
                + crate::storage::CatalogLimits::default().retained_control_bytes;
            return writer
                .acquire(key, reserve, deadline, async move {
                    match acquire
                        .web(request, deadline)
                        .await
                        .map_err(|_| crate::storage::Error::Transport)?
                    {
                        Acquired::Complete(a) => Ok(Some(crate::storage::response_first::Batch {
                            declaration: a.declaration,
                            records: a.records,
                        })),
                        _ => Ok(None),
                    }
                })
                .await
                .ok()
                .flatten()
                .map(|r| r.records.clone());
        }
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
    /// KMA-STATION-FLUSH V2: fold the pages held now (today's and yesterday's of a load) without
    /// waiting for the rest of the load or for a part of the request to end. A fold already
    /// running may have taken its pages before these were held: it ends first. The new fold is
    /// not waited for; the request takes it when it answers.
    async fn fold_held(self: &Arc<Self>, now_ms: i64) {
        if let Some(mut running) = self.flight(&Flight::Fold) {
            let _ = running.wait_for(|done| *done).await;
        }
        let _ = self.fold_if_dirty(now_ms);
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
            s.pages.ids.retain(|(_, h), _| *h >= first);
            s.pages.reduced.retain(|h, _| *h >= first);
            s.expand_attempts.retain(|h, _| *h >= first);
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
                    page_ids(&s.pages.ids),
                )
            });
            (inputs, s.pages.minute.clone(), cached)
        };
        let hourly_fold = match (cached, inputs) {
            (Some(cached), _) => cached,
            (None, Some((seed, hourly, hourly_at, city, geo, pages))) => {
                let fold_pages = pages.clone();
                let held = hourly.clone();
                let Ok((mut fold, reduced)) = crate::observability::spawn_blocking(move || {
                    fold_hourly(
                        seed.as_deref().map(Vec::as_slice),
                        &hourly,
                        &hourly_at,
                        &city,
                        &geo,
                        &fold_pages,
                    )
                })
                .await
                else {
                    return;
                };
                fold.pages = pages;
                let mut s = self.state();
                // Non-city stations' hourly rows are kept as registry facts only (unless a newer
                // page replaced the folded one meanwhile).
                for (h, rows) in reduced {
                    let same = s
                        .pages
                        .hourly
                        .get(&h)
                        .zip(held.get(&h))
                        .is_some_and(|(now, folded)| Arc::ptr_eq(now, folded));
                    if same {
                        s.pages.hourly.insert(h, rows);
                        s.pages.reduced.insert(h, fold.cities.clone());
                    }
                }
                s.hourly_fold = Some(fold.clone());
                drop(s);
                self.expand_due();
                self.want_products(now_ms);
                fold
            }
            (None, None) => return,
        };
        let minutes = crate::observability::spawn_blocking(move || {
            let mut minutes = RowStore::default();
            for page in minute.values() {
                minutes.save(page);
            }
            minutes
        })
        .await
        .unwrap_or_default();
        let digest = {
            let mut bytes = Vec::new();
            for d in hourly_fold.registry.docs() {
                bytes.extend_from_slice(&d.json().to_bytes());
                bytes.push(b'\n');
            }
            crate::storage::sha256(&bytes)
        };
        let mut s = self.state();
        let registry_id = match &s.registry_id {
            Some((hash, since)) if *hash == digest => (digest, *since),
            _ => (digest, now_ms as f64),
        };
        s.registry_id = Some(registry_id.clone());
        s.folded = Some(Arc::new(Folded {
            registry: hourly_fold.registry.clone(),
            hourly: hourly_fold.hourly.clone(),
            minute: Arc::new(minutes),
            national: hourly_fold.national.clone(),
            pages: hourly_fold.pages.clone(),
            registry_id: Some(registry_id),
        }));
        drop(s);
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
                    tasks.push(crate::observability::spawn(async move {
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

    // ---- reduced pages ----

    /// Pages reduced for a smaller city set than the last fold's lack a city station's rows (a
    /// station joined the set since): read the due ones in full again, unless a read runs. Called
    /// after every fold and request, so a retry does not wait for a new hourly page.
    fn expand_due(self: &Arc<Self>) {
        if self.flight(&Flight::Expand).is_some() {
            return;
        }
        let due: Vec<(Publication, String)> = {
            let s = self.state();
            stale_pages(&s)
                .into_iter()
                .filter(|(h, _)| {
                    s.expand_attempts
                        .get(h)
                        .is_none_or(|at| at.elapsed() >= EXPAND_RETRY)
                })
                .collect()
        };
        if due.is_empty() {
            return;
        }
        let _ = self.start(Flight::Expand, Duration::ZERO, move |this| {
            Box::pin(async move { this.read_full(due).await })
        });
    }
    /// Read the AWS hourly `pages` (hour and raw identity) in full again, a few at a time, and hold
    /// the whole rows of each read while still the held page. A read is kept as it completes; the
    /// pages not started before the deadline stay due (only started pages wait for
    /// [`EXPAND_RETRY`]).
    async fn read_full(&self, mut pages: Vec<(Publication, String)>) {
        let deadline = Instant::now() + READ_DEADLINE;
        pages.sort();
        let mut batches: Vec<Vec<(Publication, CatalogId, crate::storage::RecordId)>> = Vec::new();
        for (hour, raw_id) in pages {
            let (Ok(member), Ok(catalog)) = (
                crate::storage::RecordId::from_object_key(&raw_id),
                super::records::catalog("kma-web", "aws-hourly", &aws_key(), &hour.base_date()),
            ) else {
                // Not a readable identity: tried again after the retry interval.
                self.state()
                    .expand_attempts
                    .insert(hour, std::time::Instant::now());
                continue;
            };
            match batches.last_mut() {
                Some(batch) if batch.len() < MINUTE_FIRST && batch[0].1 == catalog => {
                    batch.push((hour, catalog, member))
                }
                _ => batches.push(vec![(hour, catalog, member)]),
            }
        }
        for batch in batches {
            if Instant::now() >= deadline {
                break;
            }
            {
                let mut s = self.state();
                for (hour, _, _) in &batch {
                    s.expand_attempts.insert(*hour, std::time::Instant::now());
                }
            }
            let wanted: Vec<_> = batch
                .into_iter()
                .map(|(_, catalog, member)| (catalog, member))
                .collect();
            let Ok(read) = self.restore(&self.bulk, &wanted, deadline).await else {
                continue;
            };
            let parsed = crate::observability::spawn_blocking(move || {
                read.iter()
                    .filter_map(|a| a.as_deref().and_then(parse_hourly))
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();
            let mut s = self.state();
            let mut changed = false;
            for (p, rows, _, _, raw_id) in parsed {
                let same = s
                    .pages
                    .ids
                    .get(&("aws-hourly", p))
                    .is_some_and(|(_, _, held)| *held == raw_id);
                if same {
                    s.pages.hourly.insert(p, rows);
                    s.pages.reduced.remove(&p);
                    changed = true;
                }
            }
            if changed {
                s.pages.dirty = true;
                s.pages.hourly_dirty = true;
            }
        }
    }

    // ---- day products ----

    /// Compare the day products with the pages held (after a fold recomputed the hourly part) and
    /// store the changed ones; no request waits for it. Returns the single product worker: a
    /// running one compares again before it ends.
    fn want_products(self: &Arc<Self>, now_ms: i64) -> Option<watch::Receiver<bool>> {
        self.state().product_due = true;
        self.start(Flight::Product, Duration::ZERO, move |this| {
            Box::pin(async move { this.write_products(now_ms).await })
        })
    }
    /// KMA-STATION-FLUSH V1 (DR-V-flush-ownership): a fill pass that ended with new pages for
    /// `days` has their products stored now, past [`PRODUCT_EVERY`] (only when what a day is made
    /// of changed). The intent is the single product worker's to honour: a running worker compares
    /// the days before it ends, and when it ended as the intent arrived (the comparison still due)
    /// the next one does. The pass waits for that comparison; no request waits for the pass.
    async fn flush_products(self: &Arc<Self>, days: BTreeSet<u32>, now_ms: i64) {
        self.state().flush.extend(days);
        while let Some(mut worker) = self.want_products(now_ms) {
            if worker.wait_for(|done| *done).await.is_err() || !self.state().product_due {
                break;
            }
        }
    }
    async fn write_products(self: Arc<Self>, now_ms: i64) {
        loop {
            let due = {
                let mut s = self.state();
                s.product_due = false;
                product_candidates(&mut s, now_ms)
            };
            for (stored, made_of) in due {
                let day = stored.day;
                if self.store_product(stored).await.is_ok() {
                    self.state().products.insert(day, made_of);
                }
            }
            if !self.state().product_due {
                break;
            }
        }
    }
    /// Store one day product (one record, one group, the day's product catalog).
    async fn store_product(&self, stored: DayProduct) -> Result<(), ()> {
        let (day, made) = (stored.day, stored.made);
        let bytes = crate::observability::spawn_blocking(move || stored.encode(facts))
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?;
        let limits = crate::storage::CatalogLimits::default();
        let record = RawRecord::new(
            "kma-web",
            product::KIND,
            &aws_key(),
            Publication::new(day, 0).ok_or(())?.period(),
            made as u64,
            200,
            "application/gzip",
            Some(crate::storage::Pagination {
                page: 1,
                pages: 1,
                complete: true,
            }),
            bytes.into(),
            &limits.raw,
        )
        .map_err(|_| ())?;
        let member = crate::storage::GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![
                CatalogId::for_record(&record.envelope.identity, &format!("{day:08}"))
                    .map_err(|_| ())?,
            ],
        };
        let declaration =
            crate::storage::GroupDeclaration::new(vec![member], &limits).map_err(|_| ())?;
        self.bulk
            .store
            .publish(declaration, vec![record], Instant::now() + READ_DEADLINE)
            .await
            .map(|_| ())
            .map_err(|_| ())
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
        self.history_with_inputs(town, folded, now_ms, until)
            .await
            .0
    }
    /// [`Self::history`] with the station's ASOS acquisitions it answered from (S16): `None`
    /// without a mapped, loaded station.
    pub async fn history_with_inputs(
        self: &Arc<Self>,
        town: &Doc,
        folded: Option<&Folded>,
        now_ms: f64,
        until: Instant,
    ) -> (OrderedJson, Option<AsosView>) {
        let reason = |r: &str, mapping: Option<OrderedJson>| {
            let mut out = Vec::new();
            if self.observed_history {
                out.push((
                    "policy",
                    OrderedJson::String("asos-primary-v1".encode_utf16().collect()),
                ));
            }
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
            return (reason("cache-read-timeout", None), None);
        };
        let chosen = if self.observed_history {
            match representative_mapping(town, folded.registry.docs(), ASOS_MAX_KM) {
                Ok(chosen) => chosen,
                Err(Unrepresentative) => return (reason("station-unrepresentative", None), None),
            }
        } else {
            nearest(town, folded.registry.docs(), ASOS_MAX_KM)
        };
        let Some(mapping) = chosen else {
            // Station coordinates still being resolved are late data, not an absent station.
            if self.flight(&Flight::Geocode).is_some() {
                return (reason("cache-read-timeout", None), None);
            }
            return (reason("station-unavailable", None), None);
        };
        let station = mapping.station.clone();
        let Some((start, end, _)) = policy::window(now_ms) else {
            return (reason("station-unavailable", None), None);
        };
        // Station state from S3 (a failed read is retried after ASOS_LOAD_RETRY).
        Self::wait(
            self.asos_load(&station, now_ms).into_iter().collect(),
            until,
        )
        .await;
        // A raced run's ranges answer before the S3 read ends.
        let loaded = self.state().asos.contains_key(&station);
        if !loaded {
            let failed = self
                .state()
                .asos_failed
                .get(&station)
                .is_some_and(|at| at.elapsed() < ASOS_LOAD_RETRY);
            let answer = if failed {
                reason("cache-read-failed", Some(mapping.json()))
            } else {
                reason("cache-read-timeout", None)
            };
            return (answer, None);
        }
        self.asos_run(&station, folded, &start, &end, now_ms, until)
            .await;
        // The acquisitions and their completeness are read under one lock (S16).
        // An S3 reload still running (the answer then uses the previous read) is not complete.
        let reloading = self.flight(&Flight::AsosLoad(station.clone())).is_some();
        let (fetched, settled) = {
            let s = self.state();
            (
                s.asos
                    .get(&station)
                    .map(|e| e.fetched.clone())
                    .unwrap_or_default(),
                !reloading
                    && !s.asos_running.contains(&station)
                    && !s.asos_partial.contains(&station)
                    && !s.asos_failed.contains_key(&station),
            )
        };
        let store = station_store(&station, &fetched, folded, self.observed_history);
        let view = AsosView {
            station: station.clone(),
            fetched: fetched.clone(),
            settled,
        };
        let docs = |d: Vec<Doc>| OrderedJson::Array(d.iter().map(Doc::json).collect());
        let mut answer = vec![
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
        ];
        if self.observed_history {
            answer.push((
                "policy",
                OrderedJson::String("asos-primary-v1".encode_utf16().collect()),
            ));
            answer.push((
                "startDate",
                OrderedJson::String(start.encode_utf16().collect()),
            ));
            answer.push(("endDate", OrderedJson::String(end.encode_utf16().collect())));
        }
        (object(answer), Some(view))
    }
    /// Start (or join) the S3 read of a station's ASOS state unless it is current or a failed
    /// read is waiting out [`ASOS_LOAD_RETRY`].
    fn asos_load(self: &Arc<Self>, station: &str, now_ms: f64) -> Option<watch::Receiver<bool>> {
        let (stale, failed) = {
            let s = self.state();
            (
                s.asos
                    .get(station)
                    .is_none_or(|e| e.loaded.is_none_or(|at| at.elapsed() >= ASOS_RELOAD)),
                s.asos_failed
                    .get(station)
                    .is_some_and(|at| at.elapsed() < ASOS_LOAD_RETRY),
            )
        };
        if !stale || failed {
            return None;
        }
        let station_c = station.to_owned();
        self.start(
            Flight::AsosLoad(station.to_owned()),
            ASOS_LOAD_RETRY,
            move |this| Box::pin(async move { this.load_asos(&station_c, now_ms).await }),
        )
    }
    /// One recovery run per station at a time and at most once per hour (legacy lease and
    /// hourly job): it plans the incomplete ranges and acquires them in order. Waited for until
    /// `until`.
    async fn asos_run(
        self: &Arc<Self>,
        station: &str,
        folded: &Folded,
        start: &str,
        end: &str,
        now_ms: f64,
        until: Instant,
    ) {
        let station_c = station.to_owned();
        let folded_c = folded.clone();
        let (start_c, end_c) = (start.to_owned(), end.to_owned());
        let run_key = Flight::AsosRun(format!("{station}/{end}"));
        // A pre-release miss must become eligible at the documented 11:00 API boundary.
        let release = Publication::new(schedule::from_ms(now_ms as i64).date(), 1100)
            .map(schedule::to_ms)
            .unwrap_or(now_ms as i64);
        let retry = if release > now_ms as i64 {
            ASOS_RUN_RETRY.min(Duration::from_millis((release - now_ms as i64) as u64))
        } else {
            ASOS_RUN_RETRY
        };
        self.own(
            Acq::AsosRun(station.to_owned()),
            crate::resolver::owned::MAX_OWNED,
            until,
            move |this| {
                Box::pin(async move {
                    if this.claim(&run_key, retry) {
                        this.recover_asos(&station_c, &folded_c, &start_c, &end_c)
                            .await;
                    }
                })
            },
        )
        .await;
    }
    /// KMA-RESTART-RACE (AK 2026-11-07, decision 2): the ASOS history of `town` starts with the
    /// request instead of after the station collections. The station comes from the current
    /// fold or, before any fold, from the default station list (the carried seed); its S3 state
    /// is read at once, and the recovery run starts at `race_at` (the head start). A read done by
    /// then leaves the run to the keys S3 lacks, as a running process plans it; a read still
    /// running is raced by a run over the whole window, whose ranges answer until the read
    /// ends. A failed read keeps its retry interval. Both are waited for until `until`;
    /// [`Self::history_with_inputs`] then answers from them.
    pub async fn prefetch_history(
        self: &Arc<Self>,
        town: &Doc,
        now_ms: f64,
        race_at: Instant,
        until: Instant,
    ) {
        let folded = self.state().folded.clone().unwrap_or_else(seed_only);
        let chosen = if self.observed_history {
            representative_mapping(town, folded.registry.docs(), ASOS_MAX_KM)
                .ok()
                .flatten()
        } else {
            nearest(town, folded.registry.docs(), ASOS_MAX_KM)
        };
        let (Some(mapping), Some((start, end, _))) = (chosen, policy::window(now_ms)) else {
            return;
        };
        let station = mapping.station;
        let mut load = Box::pin(Self::wait(
            self.asos_load(&station, now_ms).into_iter().collect(),
            until,
        ));
        let raced = crate::resolver::race::races(
            &mut load,
            race_at,
            until,
            crate::observability::Component::Domestic,
        )
        .await;
        let failed = self
            .state()
            .asos_failed
            .get(&station)
            .is_some_and(|at| at.elapsed() < ASOS_LOAD_RETRY);
        tokio::join!(
            async {
                if raced {
                    load.await;
                }
            },
            async {
                if !failed {
                    self.asos_run(&station, &folded, &start, &end, now_ms, until)
                        .await;
                }
            }
        );
    }
    async fn load_asos(self: Arc<Self>, station: &str, now_ms: f64) {
        let deadline = Instant::now() + READ_DEADLINE;
        let key = AsosRequest::record_key(station);
        // Ranges start at most 7 days before a window that starts 7 days before today.
        let months = super::records::months(now_ms - 15. * 86_400_000., now_ms);
        // The hourly and daily kinds are read together, each kind's ranges a few at a time.
        let reader = &self.reader;
        let kind = |kind: AsosKind| {
            let (key, months) = (&key, &months);
            async move {
                let parts = reader
                    .partitions("data-go-kr", kind.kind(), key, months, deadline)
                    .await
                    .map_err(|_| ())?;
                use futures_util::StreamExt;
                let read: Vec<_> = futures_util::stream::iter(parts)
                    .filter_map(|partition| async move {
                        let (start, end) = AsosRequest::parse_partition(kind, &partition)?;
                        Some((partition, start, end))
                    })
                    .map(|(partition, start, end)| async move {
                        reader
                            .raw_counted("data-go-kr", kind.kind(), key, &partition, deadline)
                            .await
                            .map(|read| (start, end, read))
                    })
                    .buffered(ASOS_READS)
                    .collect()
                    .await;
                let mut fetched = Vec::new();
                let mut partial = false;
                for result in read {
                    let (start, end, (acquisitions, excluded)) = result.map_err(|_| ())?;
                    partial |= excluded > 0;
                    for records in acquisitions {
                        fetched.push(asos_fetched(kind, &start, &end, &records));
                    }
                }
                Ok::<_, ()>((fetched, partial))
            }
        };
        let (hourly, daily) = tokio::join!(kind(AsosKind::Hourly), kind(AsosKind::Daily));
        let (Ok((mut fetched, hourly_partial)), Ok((daily, daily_partial))) = (hourly, daily)
        else {
            self.state()
                .asos_failed
                .insert(station.to_owned(), std::time::Instant::now());
            return;
        };
        fetched.extend(daily);
        let partial = hourly_partial || daily_partial;
        fetched.sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
        let mut s = self.state();
        s.asos_failed.remove(station);
        if partial {
            s.asos_partial.insert(station.to_owned());
        } else {
            s.asos_partial.remove(station);
        }
        // Keep acquisitions this process published after the read started.
        let mine: Vec<AsosFetched> = s
            .asos
            .get(station)
            .map(|e| e.fetched.clone())
            .unwrap_or_default();
        for f in mine {
            if !fetched.iter().any(|g| g.same_original(&f)) {
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
                loaded: Some(std::time::Instant::now()),
            },
        );
    }
    /// Legacy `Recovery.run` for one station: plan the incomplete window ranges, then acquire and
    /// publish them in order (hourly, then daily).
    async fn recover_asos(self: Arc<Self>, station: &str, folded: &Folded, start: &str, end: &str) {
        let _running = Running::new(&self, station);
        let fetched = self
            .state()
            .asos
            .get(station)
            .map(|e| e.fetched.clone())
            .unwrap_or_default();
        let plan = station_store(station, &fetched, folded, self.observed_history)
            .plan(station, start, end);
        for (kind, a, b) in plan {
            let Ok(request) = AsosRequest::new(kind, station, &a, &b) else {
                continue;
            };
            let _permit = self.asos_gate.clone().acquire_owned().await;
            let deadline = Instant::now() + range_time();
            let records = if let Some(writer) = &self.raw_writer {
                let acquire = self.acquire.clone();
                let wanted = request.clone();
                let key = format!("asos/{kind:?}/{station}/{a}/{b}");
                let reserve = crate::domestic::asos::MAX_PAGES as usize
                    * crate::storage::Limits::default().raw_bytes
                    + crate::storage::CatalogLimits::default().retained_control_bytes;
                let Ok(Some(ready)) = writer
                    .acquire(key, reserve, deadline, async move {
                        match acquire
                            .asos(wanted, deadline)
                            .await
                            .map_err(|_| crate::storage::Error::Transport)?
                        {
                            Acquired::Complete(a) => {
                                Ok(Some(crate::storage::response_first::Batch {
                                    declaration: a.declaration,
                                    records: a.records,
                                }))
                            }
                            _ => Ok(None),
                        }
                    })
                    .await
                else {
                    continue;
                };
                ready.records.clone()
            } else {
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
                records
            };
            let f = asos_fetched(kind, request.start(), request.end(), &records);
            // A raced run that ends before the S3 read answers with its own ranges; the read
            // keeps them when it ends.
            let mut s = self.state();
            let entry = s
                .asos
                .entry(station.to_owned())
                .or_insert_with(|| AsosEntry {
                    fetched: Vec::new(),
                    loaded: None,
                });
            entry.fetched.push(f);
            entry
                .fetched
                .sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
            retain_window(&mut entry.fetched, start);
        }
    }
}
/// Marks a station's recovery run in progress until dropped (also when the owned run times out).
struct Running<T> {
    observations: Arc<Observations<T>>,
    station: String,
}
impl<T> Running<T> {
    fn new(observations: &Arc<Observations<T>>, station: &str) -> Self {
        observations
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .asos_running
            .insert(station.to_owned());
        Self {
            observations: observations.clone(),
            station: station.to_owned(),
        }
    }
}
impl<T> Drop for Running<T> {
    fn drop(&mut self) {
        self.observations
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .asos_running
            .remove(&self.station);
    }
}
/// The station ASOS acquisitions a history answer used and whether they were complete (no
/// recovery run in flight, no failed S3 read).
#[derive(Debug, Clone)]
pub struct AsosView {
    pub station: String,
    pub fetched: Vec<AsosFetched>,
    pub settled: bool,
}
/// S16: whether the station state behind a snapshot was read completely.
impl<T> Observations<T> {
    /// Whether `folded` is the current fold of a complete read at `now_ms`: every day of the
    /// 8-day page window was read from S3 and its latest read did not fail, the minute pages were
    /// read, no newer page is waiting for a fold, and no S3 load (nor its rest), fold, geocoding
    /// or product comparison is in flight or due.
    pub fn settled(&self, now_ms: i64, folded: &Arc<Folded>) -> bool {
        let busy = {
            let flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
            [
                Flight::Load,
                Flight::LoadRest,
                Flight::Fold,
                Flight::Geocode,
                Flight::Product,
                Flight::Expand,
            ]
            .iter()
            .any(|f| flights.contains_key(f))
        };
        if busy {
            return false;
        }
        let s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        // The snapshot's fold must be the current one: a newer fold or newer pages are inputs
        // the snapshot did not use.
        if s.pages.dirty
            || s.product_due
            || !stale_pages(&s).is_empty()
            || s.seed_failed
            || s.pages.minute_read.is_none()
            || !s.folded.as_ref().is_some_and(|f| Arc::ptr_eq(f, folded))
        {
            return false;
        }
        window_days(now_ms)
            .iter()
            .all(|day| s.pages.days.contains_key(day) && !s.pages.failed_days.contains(day))
    }
}
/// Keep the acquisitions whose range reaches the window (older ones cannot change it).
pub fn retain_window(fetched: &mut Vec<AsosFetched>, start: &str) {
    fetched.retain(|f| f.end.get(..8).is_some_and(|d| d >= start));
}
/// The station's `asos_history` rows: its data.go.kr acquisitions and the ongoing-hour AWS page
/// rows in fetch order.
fn station_store(
    station: &str,
    fetched: &[AsosFetched],
    folded: &Folded,
    observed: bool,
) -> AsosStore {
    let national = folded
        .national
        .get(station)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if observed {
        super::asos::replay_observed(station, fetched, national)
    } else {
        super::asos::replay(station, fetched, national)
    }
}
fn asos_fetched(kind: AsosKind, start: &str, end: &str, records: &[RawRecord]) -> AsosFetched {
    AsosFetched {
        raw_ids: records
            .iter()
            .map(|r| r.envelope.identity.object_key())
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_default(),
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
/// A listed minute acquisition to restore.
struct MinuteEntry {
    catalog: CatalogId,
    member: crate::storage::RecordId,
    completed: u64,
}
impl MinuteEntry {
    /// Latest-first catalog order: completion, then the raw digest.
    fn order(&self) -> (u64, &str) {
        (self.completed, &self.member.raw_sha256)
    }
}
type ParsedPage = (Publication, Arc<Vec<Doc>>, f64, String, String);
fn parse_hourly(records: &[RawRecord]) -> Option<ParsedPage> {
    let r = records.first()?;
    let requested = record_publication(r)?;
    let page = parse_aws(&r.bytes, Some(&dotted(requested))).ok()?;
    Some((
        requested,
        Arc::new(page.rows),
        r.envelope.identity.fetched_at_ms as f64,
        r.envelope.identity.raw_sha256.clone(),
        r.envelope.identity.object_key().ok()?,
    ))
}
fn parse_city_record(records: &[RawRecord]) -> Option<ParsedPage> {
    let r = records.first()?;
    let requested = record_publication(r)?;
    let page = parse_city(&r.bytes, &r.envelope.content_type, Some(&dotted(requested))).ok()?;
    Some((
        requested,
        Arc::new(page.rows),
        r.envelope.identity.fetched_at_ms as f64,
        r.envelope.identity.raw_sha256.clone(),
        r.envelope.identity.object_key().ok()?,
    ))
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
pub(super) fn facts(row: &Doc) -> Doc {
    let mut out = Doc::new();
    for k in FACTS {
        if let Some(v) = row.get(k) {
            out.set(k, v.clone());
        }
    }
    out
}
/// The held AWS hourly pages (hour and raw identity) reduced for a city set that does not cover
/// the last fold's.
fn stale_pages(s: &State) -> Vec<(Publication, String)> {
    let Some(fold) = &s.hourly_fold else {
        return Vec::new();
    };
    s.pages
        .reduced
        .iter()
        .filter(|(_, set)| !set.is_superset(&fold.cities))
        .filter_map(|(h, _)| {
            let (_, _, raw_id) = s.pages.ids.get(&("aws-hourly", *h))?;
            Some((*h, raw_id.clone()))
        })
        .collect()
}
/// The day products to store at `now_ms` (each attempt is recorded): per day whose every hour
/// is in the window, that was read without failure and holds pages, the held pages unless the
/// last product this process read or stored for it is made of the same, at most once per
/// [`PRODUCT_EVERY`] or, for a day a fill pass ended with new pages for, at once (the intent is
/// spent by the attempt or by an unchanged day).
fn product_candidates(s: &mut State, now_ms: i64) -> Vec<(DayProduct, MadeOf)> {
    let Some(cities) = s.hourly_fold.as_ref().map(|f| f.cities.clone()) else {
        return Vec::new();
    };
    let first = latest_hourly(now_ms)
        .add_hours(-HOURLY_WINDOW_HOURS)
        .unwrap_or_else(|| latest_hourly(now_ms));
    let made = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0., |d| d.as_millis() as f64);
    let mut by_day: BTreeMap<u32, Vec<StoredPage>> = BTreeMap::new();
    for ((kind, hour), (at, sha, raw_id)) in &s.pages.ids {
        let rows = if *kind == "aws-hourly" {
            s.pages.hourly.get(hour)
        } else {
            s.pages.city.get(hour)
        };
        let Some(rows) = rows else {
            continue;
        };
        by_day.entry(hour.date()).or_default().push(StoredPage {
            kind,
            hour: *hour,
            fetched_at_ms: *at,
            sha256: sha.clone(),
            raw_id: raw_id.clone(),
            rows: rows.clone(),
        });
    }
    let mut out = Vec::new();
    for (day, pages) in by_day {
        if Publication::new(day, 0).is_none_or(|start| start < first)
            || !s.pages.days.contains_key(&day)
            || s.pages.unreadable.contains(&day)
        {
            continue;
        }
        // The rows of a reduced page are whole for its city set only.
        let city_ids = pages
            .iter()
            .filter(|p| p.kind == "aws-hourly")
            .filter_map(|p| s.pages.reduced.get(&p.hour))
            .fold(None::<BTreeSet<String>>, |all, set| {
                Some(match all {
                    None => (**set).clone(),
                    Some(all) => all.intersection(set).cloned().collect(),
                })
            })
            .unwrap_or_else(|| (*cities).clone());
        let excluded = s.pages.excluded.get(&day).cloned().unwrap_or_default();
        let made_of = MadeOf::new(
            pages.iter().map(|p| p.raw_id.as_str()),
            &city_ids,
            &excluded,
        );
        let flushed = s.flush.remove(&day);
        let gated = s
            .product_attempts
            .get(&day)
            .is_some_and(|at| at.elapsed() < PRODUCT_EVERY);
        if s.products.get(&day) == Some(&made_of) || (gated && !flushed) {
            continue;
        }
        s.product_attempts.insert(day, std::time::Instant::now());
        out.push((
            DayProduct {
                made,
                day,
                known: s
                    .pages
                    .known
                    .get(&day)
                    .into_iter()
                    .flatten()
                    .filter(|id| !pages.iter().any(|p| p.raw_id == **id))
                    .cloned()
                    .collect(),
                excluded,
                city_ids,
                pages,
            },
            made_of,
        ));
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
    page_ids: &[PageId],
) -> (HourlyFold, Vec<(Publication, Page)>) {
    let city_ids = city_ids(seed, city.values().map(|rows| &**rows));
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
                merged = {
                    let mut merged = merge_aws_city((**aws).clone(), c);
                    let city_at = page_ids
                        .iter()
                        .find(|id| id.kind == "city-obs" && id.hour == *h)
                        .map(|id| id.fetched_at_ms);
                    if city_at.is_some_and(|at| hourly_at.get(h).is_some_and(|aws_at| *aws_at > at))
                    {
                        // Legacy Mongoose update wraps the newer AWS row in $set: fields
                        // actually present overwrite, omitted city weather/cloud remain.
                        // A later city acquisition (or a same-acquisition pair) still wins.
                        for row in &mut merged {
                            if let Some(raw) =
                                aws.iter().find(|raw| raw.get("stnId") == row.get("stnId"))
                            {
                                for (key, value) in raw.entries() {
                                    row.set(key, value.clone());
                                }
                            }
                        }
                    }
                    merged
                };
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
            pages: Arc::new(Vec::new()),
            cities: Arc::new(city_ids),
        },
        reduced,
    )
}
/// The city stations: those of the city pages and the seed's `isCityWeather` stations.
fn city_ids<'a>(
    seed: Option<&[Doc]>,
    city: impl Iterator<Item = &'a Vec<Doc>>,
) -> BTreeSet<String> {
    city.flat_map(|rows| rows.iter())
        .filter_map(|r| r.get("stnId").and_then(Val::as_str).map(str::to_owned))
        .chain(seed.unwrap_or_default().iter().filter_map(|d| {
            (d.get("isCityWeather") == Some(&Val::Bool(true)))
                .then(|| d.get("stnId").and_then(Val::as_str).map(str::to_owned))
                .flatten()
        }))
        .collect()
}
/// Whether a page fetched at `at` with raw digest `sha` replaces `held`: a later fetch, or of one
/// instant the smaller digest (the page a read of every acquisition in catalog order keeps).
fn newer(at: f64, sha: &str, held: Option<(f64, &str)>) -> bool {
    held.is_none_or(|(held_at, held_sha)| at > held_at || (at == held_at && sha < held_sha))
}
/// Hold a page of `kind` unless the held one is newer ([`newer`]); `reduced`: the city set an
/// AWS page's rows are kept in full for. True when held.
fn hold(
    pages: &mut Pages,
    kind: &'static str,
    (p, rows, at, sha, raw_id): ParsedPage,
    reduced: Option<Arc<BTreeSet<String>>>,
) -> bool {
    let current = pages
        .ids
        .get(&(kind, p))
        .map(|(at, sha, _)| (*at, sha.as_str()));
    if !newer(at, &sha, current) {
        return false;
    }
    if let Some((_, _, replaced)) = pages.ids.get(&(kind, p)) {
        pages
            .known
            .entry(p.date())
            .or_default()
            .insert(replaced.clone());
    }
    if kind == "aws-hourly" {
        pages.hourly.insert(p, rows);
        pages.hourly_at.insert(p, at);
        match reduced {
            Some(cities) => pages.reduced.insert(p, cities),
            None => pages.reduced.remove(&p),
        };
    } else {
        pages.city.insert(p, rows);
    }
    pages.ids.insert((kind, p), (at, sha, raw_id));
    true
}
/// The KST days of the 8-day page window and the hour before it, oldest first.
fn window_days(now_ms: i64) -> Vec<u32> {
    let first = schedule::from_ms(now_ms - HOURLY_WINDOW_HOURS * 3_600_000 - 3_600_000);
    let today = schedule::from_ms(now_ms).date();
    let mut days = Vec::new();
    let mut d = Publication::new(first.date(), 0);
    while let Some(day) = d {
        if day.date() > today {
            break;
        }
        days.push(day.date());
        d = day.add_hours(24);
    }
    days
}
/// One day read: its listed pages (None: a catalog could not be listed), its stored product, and
/// the S06 exclusions of the pages held for it (None: none held, the raw pages are read).
struct DayRead {
    day: u32,
    listed: Option<Vec<ListedPage>>,
    product: Option<DayProduct>,
    base: Option<Accounted>,
}
/// The listed groups of a day beyond its held pages: found complete, and S06 excluded.
struct Accounted {
    known: BTreeSet<String>,
    excluded: BTreeSet<String>,
}
/// A page a day catalog lists.
struct ListedPage {
    kind: &'static str,
    hour: Publication,
    at: f64,
    sha256: String,
    raw_id: String,
    member: crate::storage::RecordId,
    catalog: CatalogId,
}
impl ListedPage {
    fn new(kind: &'static str, catalog: &CatalogId, e: crate::storage::Envelope) -> Option<Self> {
        let period = &e.identity.period;
        Some(Self {
            kind,
            hour: Publication::new(period.local_date, period.slot.parse().ok()?)?,
            at: e.identity.fetched_at_ms as f64,
            sha256: e.identity.raw_sha256.clone(),
            raw_id: e.identity.object_key().ok()?,
            member: e.identity,
            catalog: catalog.clone(),
        })
    }
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

/// No city station represents the town (`station-altitude-v1`).
#[derive(Debug, PartialEq, Eq)]
pub struct Unrepresentative;
/// [`nearest`] under ASOS-primary: the station the altitude rule allows for the town.
pub fn representative_mapping(
    town: &Doc,
    stations: &[Doc],
    max_km: f64,
) -> Result<Option<Mapping>, Unrepresentative> {
    match representative::verdict_for_doc(town, stations) {
        Verdict::Nearest => Ok(nearest(town, stations, max_km)),
        Verdict::NoStation => Err(Unrepresentative),
        Verdict::Station(id) => Ok(nearest(
            town,
            &representative::only_station(stations, &id),
            max_km,
        )),
    }
}

/// The services the KMA source calls with `DONGNAE_SECRET_KEYS` (S15b-2 ASOS; S15b-3b UV V5,
/// pollen V3 and KASI; S15b-4 the grid and mid forecasts and the forecast-zone list).
const DONGNAE_SERVICES: [crate::domestic::family::Service; 7] = [
    crate::domestic::family::Service::Asos,
    crate::domestic::family::Service::LivingWthrIdx,
    crate::domestic::family::Service::HealthWthrIdx,
    crate::domestic::family::Service::RiseSet,
    crate::domestic::family::Service::VilageFcst,
    crate::domestic::family::Service::MidFcst,
    crate::domestic::family::Service::ForecastZone,
];
/// Daily S08 units of one data.go.kr API per key (production: [`DataGoKrApi::daily_units`]).
pub type ApiUnits = fn(crate::domestic::quota::DataGoKrApi) -> u64;
/// The S13 acquirer for request-time acquisitions: KMA pages (keyless) and data.go.kr requests
/// funded by S08 per `DONGNAE_SECRET_KEYS` key, data.go.kr API and KST day (AK decision 5: one
/// quota owner per key and API, limited to that API's allowance; a new window opens when the
/// KST day changes). The warning requests (`WthrWrnInfoService`) use the same keys.
///
/// [`DataGoKrApi::daily_units`]: crate::domestic::quota::DataGoKrApi::daily_units
pub struct DailyAcquirer<P, W, B> {
    funded: Arc<P>,
    public: Arc<W>,
    budgets: Arc<B>,
    keys: Vec<String>,
    units: ApiUnits,
    endpoints: crate::domestic::family::Endpoints,
    clock: Arc<dyn crate::budget::Clock>,
    metrics: Arc<crate::domestic::metrics::DomesticMetrics>,
    current: DailyCurrent<P, W, B>,
}
type DailyCurrent<P, W, B> = tokio::sync::Mutex<Option<(i64, Arc<Daily<P, W, B>>)>>;
/// One KST day: the acquirer and, per key in configuration order, the S08 budget of the
/// warning API (`WthrWrnInfoService`) with its key.
pub struct Daily<P, W, B> {
    pub acquirer: Arc<crate::domestic::DomesticAcquirer<P, W, B>>,
    pub warnings: Vec<(Arc<crate::budget::BudgetStore<B>>, String)>,
    pub narratives: Vec<(Arc<crate::budget::BudgetStore<B>>, String)>,
}
/// The S08 quota owner of a `DONGNAE_SECRET_KEYS` key and data.go.kr API.
pub fn data_go_kr_quota_owner(key: &str, api: crate::domestic::quota::DataGoKrApi) -> String {
    crate::domestic::quota::quota_owner("DONGNAE_SECRET_KEYS", key, api)
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
        units: ApiUnits,
        endpoints: crate::domestic::family::Endpoints,
        clock: Arc<dyn crate::budget::Clock>,
        metrics: Arc<crate::domestic::metrics::DomesticMetrics>,
    ) -> Result<Self, DomesticError> {
        let this = Self {
            funded,
            public,
            budgets,
            keys,
            units,
            endpoints,
            clock,
            metrics,
            current: tokio::sync::Mutex::new(None),
        };
        // Validate keys and limits once with a window at the epoch.
        this.build(0)?;
        Ok(this)
    }
    fn build(&self, starts: i64) -> Result<Daily<P, W, B>, DomesticError> {
        use crate::budget::{BudgetPolicy, BudgetStore, Provider};
        use crate::domestic::quota::DataGoKrApi;
        let invalid = DomesticError::Invalid("data.go.kr key or daily units");
        if self.keys.is_empty() {
            return Err(invalid);
        }
        let window_id = crate::world::js::iso((starts + KST_MS) as f64)
            .map(|s| s[..10].to_owned())
            .ok_or(DomesticError::Invalid("window"))?;
        let store = |key: &str, api: DataGoKrApi| {
            let limit = (self.units)(api);
            if limit == 0 {
                return Err(invalid.clone());
            }
            let policy = BudgetPolicy {
                provider: Provider::DataGoKr,
                quota_id: data_go_kr_quota_owner(key, api),
                window_id: window_id.clone(),
                starts_at_ms: starts,
                ends_at_ms: starts + DAY_MS,
                limit,
                block_units: limit.min(50),
            };
            BudgetStore::new(self.budgets.clone(), policy, self.clock.clone())
                .map(Arc::new)
                .map_err(|_| invalid.clone())
        };
        // One quota owner per key, API and KST day; each service keeps its own key ring.
        let mut rings = BTreeMap::new();
        for service in DONGNAE_SERVICES {
            let entries = self
                .keys
                .iter()
                .map(|key| {
                    let budgets = service
                        .apis()
                        .iter()
                        .map(|api| Ok((*api, store(key, *api)?)))
                        .collect::<Result<BTreeMap<_, _>, DomesticError>>()?;
                    crate::providers::ProviderKey::new(key.clone())
                        .map(|k| (k, budgets))
                        .map_err(|_| invalid.clone())
                })
                .collect::<Result<Vec<_>, _>>()?;
            rings.insert(service, crate::domestic::KeyRing::per_api(entries)?);
        }
        let warnings = self
            .keys
            .iter()
            .map(|key| Ok((store(key, DataGoKrApi::WthrWrn)?, key.clone())))
            .collect::<Result<Vec<_>, DomesticError>>()?;
        let narratives = self
            .keys
            .iter()
            .map(|key| Ok((store(key, DataGoKrApi::VilageFcstMsg)?, key.clone())))
            .collect::<Result<Vec<_>, DomesticError>>()?;
        let acquirer = crate::domestic::DomesticAcquirer::new(
            self.funded.clone(),
            self.public.clone(),
            rings,
            self.endpoints.clone(),
            self.clock.clone(),
            self.metrics.clone(),
            crate::storage::CatalogLimits::default(),
        )?;
        Ok(Daily {
            acquirer: Arc::new(acquirer),
            warnings,
            narratives,
        })
    }
    /// The current KST day (acquirer and budgets).
    pub async fn day(&self) -> Result<Arc<Daily<P, W, B>>, DomesticError> {
        let now = self
            .clock
            .now_ms()
            .map_err(|_| DomesticError::Invalid("clock"))?;
        let starts = (now + KST_MS).div_euclid(DAY_MS) * DAY_MS - KST_MS;
        let mut current = self.current.lock().await;
        if let Some((at, day)) = current.as_ref()
            && *at == starts
        {
            return Ok(day.clone());
        }
        let day = Arc::new(self.build(starts)?);
        *current = Some((starts, day.clone()));
        Ok(day)
    }
    /// The funded provider transport (shared with the warning requester).
    pub fn funded_transport(&self) -> Arc<P> {
        self.funded.clone()
    }
    pub fn clock(&self) -> Arc<dyn crate::budget::Clock> {
        self.clock.clone()
    }
    /// The acquirer of the current KST day (S08 windows are per day).
    pub async fn today(
        &self,
    ) -> Result<Arc<crate::domestic::DomesticAcquirer<P, W, B>>, DomesticError> {
        Ok(self.day().await?.acquirer.clone())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-09-24 10:50 KST.
    const NOW_MS: i64 = 1_790_214_600_000;
    const DAY: u32 = 20260924;

    /// A process that read `DAY`, folded, holds one of its AWS pages and stored the day's product,
    /// made of another page, within the last ten minutes.
    fn stored_recently() -> State {
        let mut s = State::default();
        let hour = Publication::new(DAY, 500).unwrap();
        s.pages.hourly.insert(hour, Arc::new(Vec::new()));
        s.pages.ids.insert(
            ("aws-hourly", hour),
            (1., "a".repeat(64), "raw/a".to_owned()),
        );
        s.pages.days.insert(DAY, std::time::Instant::now());
        s.hourly_fold = Some(HourlyFold {
            registry: Arc::default(),
            hourly: Arc::default(),
            national: Arc::default(),
            unresolved: Vec::new(),
            pages: Arc::default(),
            cities: Arc::default(),
        });
        let none = BTreeSet::new();
        s.products
            .insert(DAY, MadeOf::new(["raw/b"].into_iter(), &none, &none));
        s.product_attempts.insert(DAY, std::time::Instant::now());
        s
    }

    /// FLUSH (DR-V-flush-ownership): the end of a fill pass bypasses only the ten-minute gate,
    /// once: a day whose made-of is unchanged is not stored (the intent is spent), and a day whose
    /// read failed, or a process that has not folded, stores nothing until it can (the intent
    /// waits).
    #[test]
    fn the_intent_of_a_fill_pass_bypasses_only_the_ten_minute_gate() {
        let days =
            |due: &[(DayProduct, MadeOf)]| due.iter().map(|(p, _)| p.day).collect::<Vec<_>>();
        let mut s = stored_recently();
        assert!(product_candidates(&mut s, NOW_MS).is_empty(), "the gate");
        s.flush.insert(DAY);
        let due = product_candidates(&mut s, NOW_MS);
        assert_eq!(days(&due), [DAY]);
        assert!(s.flush.is_empty(), "spent");
        assert!(product_candidates(&mut s, NOW_MS).is_empty(), "once");
        // Unchanged.
        let mut s = stored_recently();
        s.products.insert(DAY, due[0].1.clone());
        s.flush.insert(DAY);
        assert!(product_candidates(&mut s, NOW_MS).is_empty());
        assert!(s.flush.is_empty(), "nothing to store");
        // A failed read.
        let mut s = stored_recently();
        s.pages.unreadable.insert(DAY);
        s.flush.insert(DAY);
        assert!(product_candidates(&mut s, NOW_MS).is_empty());
        assert!(s.flush.contains(&DAY), "waits for a complete read");
        s.pages.unreadable.remove(&DAY);
        assert_eq!(days(&product_candidates(&mut s, NOW_MS)), [DAY]);
        // No fold yet.
        let mut s = stored_recently();
        s.hourly_fold = None;
        s.flush.insert(DAY);
        assert!(product_candidates(&mut s, NOW_MS).is_empty());
        assert!(s.flush.contains(&DAY), "waits for the fold");
    }
}
