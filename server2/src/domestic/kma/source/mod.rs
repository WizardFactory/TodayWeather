//! S15b-1: the S3 input source of the native v000903 KMA assembly (#2742).
//!
//! For a request the source resolves the town, loads the raw records the store calls need from
//! S3 and returns an in-memory [`Snapshot`] answering every `KmaStore` call the assembly makes.
//! Legacy documents are rebuilt in memory from server2's own raw records (S13/S13b provider
//! acquisitions, S12 warnings) and from repository data copied under `data/`; no normalized
//! weather view is stored. Legacy is shut down at cutover, so nothing here reads legacy data.
//!
//! S15b-1 sources the town list, region code, forecast zone, the DB 2.0 grid and short RSS
//! documents, the mid documents and the warning zones. Later increments add station observations
//! (S15b-2), air/life inputs (S15b-3) and owned request-time acquisition (S15b-4). The source
//! rebuilds these inputs without a legacy runtime dependency.
//!
//! S15b-3a adds the AirKorea inputs (`arpltn`, `dust_forecast`) from national datasets shared
//! by every request and the air-provider fallback (`air_fallback`), with request-time
//! acquisition of a missing national dataset ([`air_input`], [`live`]).
//!
//! S15b-3b adds the area numbers (repository data), the life index, KASI rise/set and MFDS food
//! poisoning from national datasets with owned acquisitions ([`life`], [`kasi`], [`mfds`],
//! [`life_input`], [`life_live`]); S15b-3c the image forecasts.
//!
//! S15b-4a acquires missing forecast inputs at request time ([`fetch`]): the latest grid, RSS and
//! mid publications (waiting at most 3 s), legacy's grid backfill in one owned pass per cell, the
//! forecast-zone list when the newest stored one is more than 24 h old (KMA-ZONE-NEWEST) and the
//! 3-minute warning cycle. A missing input is no longer a forward reason: the snapshot answers
//! what is stored, as legacy answers absent data.
pub mod air_forecast;
pub mod air_input;
pub mod airkorea;
pub mod asos;
mod doc;
pub mod fetch;
pub mod forecast_input;
pub mod gif;
mod grid;
pub mod html;
mod items;
pub mod kasi;
mod late;
pub mod life;
pub mod life_input;
pub mod life_live;
pub mod live;
pub mod mfds;
mod mid;
pub mod observe;
pub mod observe_product;
pub mod pages;
mod records;
mod reference;
pub mod representative;
pub mod required;
pub mod rnshit;
mod rss;
pub mod seed;
mod shown;
pub mod stations;
pub mod stn;
pub mod towns;
mod warning_cycle;
mod zone;

pub use doc::{Doc, Val};
pub use grid::{Coord, Family, GridDocs, Organized, Slot, collect, korea_date};
pub use items::{Item, items};
pub use mid::{LAND_CODES, MidDoc, POINT_NUMBERS, land_zone_ids, organize as organize_mid};
pub use reference::{RegionRow, find_town, grid_of, region_code, region_table, towns};
pub use rss::{RssDocs, last_run, parse_rss};
pub use zone::{Zones, complete_list, normalize as normalize_zone};

use super::backend::{Clock, KmaSource, SourceAnswer};
use super::{
    DbVersion, KmaRequest, KmaStore, MidModel, StoreError, StoreResult, TownModel, unavailable,
};
use crate::domestic::publication::{self, Publication};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::history::{IndexListing, schedule};
use crate::storage::{CatalogLimits, CatalogStore, ProviderKey};
use crate::summary::{GridInputs, InputId, grid::AsosInputs};
use crate::warnings::{
    service::{ServiceConfig, WarningService},
    store::{StoreConfig, WarningStore},
    zones::ZoneState,
};
use futures_util::FutureExt;
pub use records::Fetched;
use records::Reader;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::Instant;

/// Observed-history derivation identity for stored summaries; a new aggregation rule must change
/// it so that summaries built under an earlier rule are not reused. Its last segment is the
/// `aggregation_policy_version` of `server2/config/contracts/kma-history.v1.json`.
pub const OBSERVED_HISTORY_POLICY: &str = "asos-primary-v1;measured-history;public3h;rain-blank-semantics-v2;precipitation-guard-v1;dry-closure-v1;wet-bulb-rain-v1;station-altitude-v1;stored-read-window-v1";

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// A KST month before every server2 raw record (S13 and S13b landed in October 2026). Histories
/// legacy keeps without a time bound (the last stored mid document) are folded from here, and the
/// newest forecast-zone list is looked for from here; earlier months hold no record.
pub const HISTORY_START_MONTH: u32 = 202601;
/// How often a process checks S3 for a newer forecast-zone list (KMA-ZONE-NEWEST): memory answers
/// in between, and a check that finds the installed list again counts as one.
const ZONE_REFRESH: std::time::Duration = std::time::Duration::from_secs(600);
/// A forecast-zone list that completed more than this before a request is acquired again
/// (KMA-ZONE-NEWEST, AK 2026-11-10: not on every process start).
const ZONE_ACQUIRE_AGE_MS: f64 = DAY_MS;

/// How far back a family's publications can still own a retained document: the 216-hour
/// retention plus the latest slot a publication writes (its horizon and one trailing day).
fn lookback_ms(family: Family) -> f64 {
    let horizon = match family {
        Family::Current => 0.,
        // +1..+6 h, plus a trailing row of up to one day.
        Family::Shortest => 6. * HOUR_MS + DAY_MS,
        // Up to the fourth midnight, one three-hourly day, then a trailing day.
        Family::Short => 6. * DAY_MS,
    };
    grid::RETENTION_MS + horizon + HOUR_MS
}
/// RSS rows reach two days after their publication day; retention is 216 h before the run.
const RSS_LOOKBACK_MS: f64 = grid::RETENTION_MS + 4. * DAY_MS;
/// Stored grid and RSS publications the observed response reads. ASOS owns completed days, but
/// yesterday's ASOS arrives after 11:00 KST: the window reaches yesterday's first hour at any
/// clock (48 h) and the publications valid then (VSRT's six hours).
const OBSERVED_READ_MS: f64 = 54. * HOUR_MS;
/// KST months (`YYYYMM`) from [`HISTORY_START_MONTH`] through `now`, ascending.
pub(crate) fn history_months(now: f64) -> Vec<u32> {
    let end = records::months(now, now)
        .last()
        .copied()
        .unwrap_or(HISTORY_START_MONTH);
    let mut out = Vec::new();
    let mut m = HISTORY_START_MONTH;
    while m <= end {
        out.push(m);
        m = if m % 100 == 12 { m + 89 } else { m + 1 };
    }
    out
}

/// The forecast-zone memory (KMA-ZONE-NEWEST): the zones of the newest list this process
/// installed with that list's identity, and the last successful check of S3, kept apart from the
/// identity. The release's land zones and an empty collection carry no identity (no acquisition
/// instant).
struct ZoneMemory {
    zones: Arc<Zones>,
    identity: Option<Identity>,
    checked: Option<Instant>,
}
impl ZoneMemory {
    /// Whether a list of `identity` replaces the installed one: only a newer list does, so a
    /// slower, older result never replaces a newer one.
    fn newer(&self, identity: &Identity) -> bool {
        self.identity.as_ref().is_none_or(|have| identity > have)
    }
}
/// The zones of one complete list: [`Zones::apply`] on an empty collection, which leaves the
/// active zones the list would leave at the end of a fold (no zone is retired).
fn zones_of(list: &[Doc], completed: u64) -> Zones {
    let mut zones = Zones::default();
    zones.apply(list, completed as f64);
    zones
}
/// An acquisition identity in fold order: (completion instant, partition, content digest).
type Identity = (u64, String, String);
fn identity(f: &Fetched) -> Identity {
    (
        f.fetched_at_ms,
        f.partition.clone(),
        pages_digest(f.pages.iter().map(|page| crate::storage::sha256(page))),
    )
}
/// The content digest of an acquisition: the SHA-256 of its pages' SHA-256 hashes (hex) in page
/// order. A catalog entry carries its page's hash, so the catalog alone gives the same digest.
fn pages_digest<S: AsRef<str>>(hashes: impl IntoIterator<Item = S>) -> String {
    let mut digest = Vec::new();
    for hash in hashes {
        digest.extend_from_slice(hash.as_ref().as_bytes());
    }
    crate::storage::sha256(&digest)
}
/// One acquisition's records as a [`Fetched`] of catalog partition `partition`, its pages in
/// [`records::page_order`]: completed at its last page's arrival.
fn zone_fetched(mut records: Vec<crate::storage::RawRecord>, partition: &str) -> Option<Fetched> {
    records.sort_by(|a, b| records::page_order(&a.envelope).cmp(&records::page_order(&b.envelope)));
    Some(Fetched {
        fetched_at_ms: records
            .iter()
            .map(|r| r.envelope.identity.fetched_at_ms)
            .max()?,
        partition: partition.to_owned(),
        raw_ids: records
            .iter()
            .map(|r| r.envelope.identity.object_key().ok())
            .collect::<Option<Vec<_>>>()?,
        pages: records.into_iter().map(|r| r.bytes).collect(),
    })
}
/// The list and identity of an owned forecast-zone acquisition (None: not a complete list). Its
/// catalog partition is its KST fetch day, its records' period (`ZoneRequest::partition`).
fn acquired_zone_list(records: Vec<crate::storage::RawRecord>) -> Option<(Identity, Vec<Doc>)> {
    let day = format!(
        "{:08}",
        records.first()?.envelope.identity.period.local_date
    );
    let fetched = zone_fetched(records, &day)?;
    let list = complete_list(&fetched.page_refs())?;
    Some((identity(&fetched), list))
}
fn zone_key() -> ProviderKey {
    ProviderKey::Named {
        id: "forecast-zones".into(),
    }
}
/// The KST day partition (`YYYYMMDD`) one day before `partition`.
fn day_before(partition: &str) -> String {
    Publication::new(partition.parse().unwrap_or(0), 0)
        .and_then(|p| p.add_hours(-24))
        .map_or_else(|| partition.to_owned(), |p| format!("{:08}", p.date()))
}

/// The S3 source. `T` is the process S3 transport behind the shared admission.
pub struct S3Source<T> {
    reader: Reader<T>,
    /// Safe address-only town and KR-remap projections; owned acquisition survives waiters.
    town_resolver: towns::Resolver<T>,
    warnings: Arc<WarningService<T>>,
    clock: Clock,
    /// KMA-ZONE-NEWEST forecast-zone memory; its lock also orders every install.
    zones: Arc<tokio::sync::Mutex<Option<ZoneMemory>>>,
    observations: Arc<observe::Observations<T>>,
    /// S15b-3: AirKorea national datasets and the air-provider fallback (shared with the image
    /// forecast production of the observed source).
    air: Arc<air_input::AirInputs<T>>,
    /// S15b-3b: life index, MFDS food poisoning and KASI rise/set national datasets.
    life: life_input::LifeInputs<T>,
    /// S15b-4: request-time forecast acquisitions (None: stored records only).
    forecast: Option<Arc<dyn fetch::ForecastAcquire>>,
    raw_writer: Option<Arc<crate::storage::response_first::Writer>>,
    observed_history: bool,
    /// Owned latest-publication, forecast-zone and warning acquisitions (S13d), keyed by
    /// dataset and publication.
    owned: crate::resolver::OwnedFlights<String, Option<Fetched>>,
    /// Owned backfill passes: their own pool, so a long pass never takes a slot a latest
    /// publication needs.
    passes: crate::resolver::OwnedFlights<String, Option<Fetched>>,
    /// Retry bounds of the acquisition keys (failures included).
    attempts: Arc<Attempts>,
    /// B3 latest Short slots; generic retries and historical backfill stay independent.
    latest_short: Arc<late::LatestShort>,
    /// Requests and the process timer share one controlled warning cycle owner.
    warning_cycles: Option<Arc<warning_cycle::WarningCycles<T>>>,
}
/// Retry bookkeeping: each key holds the instant its retry bound ends. Expired keys are dropped
/// when the map has doubled since the last pruning (amortized), and at [`MAX_ATTEMPTS`] live keys
/// a new key is refused (its acquisition is skipped; the answer comes from S3 as stored).
#[derive(Default)]
struct Attempts {
    state: std::sync::Mutex<(HashMap<String, std::time::Instant>, usize)>,
}
/// Live retry keys held at once (about ten per active cell: latest, backfill pass, RSS, mid).
const MAX_ATTEMPTS: usize = 65_536;
const ATTEMPTS_PRUNE_FLOOR: usize = 4_096;
impl Attempts {
    /// Start the retry bound `memo` of `key` unless one is running.
    fn claim(&self, key: &str, memo: std::time::Duration) -> bool {
        let now = std::time::Instant::now();
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (map, next_prune) = &mut *state;
        if map.get(key).is_some_and(|until| *until > now) {
            return false;
        }
        if map.len() >= (*next_prune).clamp(ATTEMPTS_PRUNE_FLOOR, MAX_ATTEMPTS) {
            map.retain(|_, until| *until > now);
            *next_prune = (map.len() * 2).max(ATTEMPTS_PRUNE_FLOOR);
        }
        if map.len() >= MAX_ATTEMPTS && !map.contains_key(key) {
            return false;
        }
        map.insert(key.to_owned(), now + memo);
        true
    }
    fn remaining(&self, key: &str) -> std::time::Duration {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .get(key)
            .map_or(std::time::Duration::ZERO, |until| {
                until.saturating_duration_since(std::time::Instant::now())
            })
    }
}
/// What the observed grid answer of one family shares with another's.
enum Link<'a> {
    /// Nothing: the legacy replay, and the families no other answer waits for.
    None,
    /// The Current answer sends its newest document once its stored read and its latest
    /// publication settled, without today's earlier acquisitions, so the rows shown as current are
    /// decided early (review RP-lagging-current-publication).
    Newest(tokio::sync::oneshot::Sender<Option<Doc>>),
    /// The Short answer also reads or acquires the publications this resolves to: the ones
    /// covering the rows the client will show as current ([`shown::publications`]).
    Shown(BoxFuture<'a, Vec<Publication>>),
}
impl<T: IndexListing + Clone + Send + Sync + 'static> S3Source<T> {
    /// `acquire` makes the request-time acquisitions (S15b-2 station pages and ASOS ranges);
    /// `locate` geocodes new station addresses.
    pub fn new(
        transport: T,
        clock: Clock,
        acquire: Arc<dyn observe::Acquire>,
        locate: Arc<dyn observe::Locate>,
    ) -> Result<Self, crate::storage::Error> {
        let warnings = Arc::new(WarningStore::new(
            transport.clone(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )?);
        Self::new_with_warning_store(transport, clock, acquire, locate, warnings)
    }
    /// Reuse the process warning store for request acquisition and warning response reads.
    pub fn new_with_warning_store(
        transport: T,
        clock: Clock,
        acquire: Arc<dyn observe::Acquire>,
        locate: Arc<dyn observe::Locate>,
        warnings: Arc<WarningStore<T>>,
    ) -> Result<Self, crate::storage::Error> {
        Self::new_with_history_policy(transport, clock, acquire, locate, warnings, false)
    }
    /// AK's observations-primary contract; original constructor retains legacy replay.
    pub fn new_observed_with_warning_store(
        transport: T,
        clock: Clock,
        acquire: Arc<dyn observe::Acquire>,
        locate: Arc<dyn observe::Locate>,
        warnings: Arc<WarningStore<T>>,
    ) -> Result<Self, crate::storage::Error> {
        Self::new_with_history_policy(transport, clock, acquire, locate, warnings, true)
    }
    fn new_with_history_policy(
        transport: T,
        clock: Clock,
        acquire: Arc<dyn observe::Acquire>,
        locate: Arc<dyn observe::Locate>,
        warnings: Arc<WarningStore<T>>,
        observed: bool,
    ) -> Result<Self, crate::storage::Error> {
        let store = Arc::new(CatalogStore::new(
            transport.clone(),
            CatalogLimits::default(),
        )?);
        let observations =
            observe::Observations::new(transport.clone(), store.clone(), acquire, locate);
        let observations = Arc::new(if observed {
            observations.observed_history()
        } else {
            observations
        });
        // A request reads the warning state on its own lane (the process store's offers and
        // counters); the collector keeps the store it was given (KMA-RESTART-RACE).
        let warnings = Arc::new(warnings.on_transport(transport.clone())?);
        Ok(Self {
            town_resolver: towns::Resolver::new(transport.clone(), None).with_clock({
                let clock = clock.clone();
                Arc::new(move || clock().max(0.) as u64)
            }),
            observations,
            air: Arc::new({
                let air = air_input::AirInputs::new(transport.clone(), store.clone());
                if observed {
                    air.reading_produced_images()
                } else {
                    air
                }
            }),
            life: life_input::LifeInputs::new(transport.clone(), store.clone()),
            reader: Reader { transport, store },
            warnings: Arc::new(WarningService::new(
                warnings,
                Arc::new(crate::budget::SystemClock),
                ServiceConfig::default(),
            )),
            clock,
            zones: Arc::new(tokio::sync::Mutex::new(None)),
            forecast: None,
            raw_writer: None,
            observed_history: observed,
            owned: crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
                running: 64,
                entries: 8192,
                retain: std::time::Duration::from_secs(3),
            })
            .expect("static owned acquisition bounds"),
            passes: crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
                running: BACKFILL_PASSES,
                entries: 4096,
                retain: std::time::Duration::from_secs(3),
            })
            .expect("static backfill pass bounds"),
            attempts: Arc::new(Attempts::default()),
            latest_short: Arc::new(late::LatestShort::default()),
            warning_cycles: None,
        })
    }
    /// Address-derived town metadata, independent of public geocode coexistence routing.
    pub fn with_town_geocoder(
        mut self,
        acquire: Option<Arc<dyn crate::geocode::town::Acquire>>,
    ) -> Self {
        self.town_resolver = towns::Resolver::new(self.reader.transport.clone(), acquire)
            .with_clock({
                let clock = self.clock.clone();
                Arc::new(move || clock().max(0.) as u64)
            });
        self
    }
    /// S15b-4: request-time grid, RSS, mid, forecast-zone and warning acquisitions.
    /// Set the shared pool, Attempts, clock and warning service before this call:
    /// the warning capability captures those handles. Production constructs it last;
    /// later private zone-only test pool overrides are not warning-admission proofs.
    pub fn with_forecast(mut self, acquire: Option<Arc<dyn fetch::ForecastAcquire>>) -> Self {
        self.warning_cycles = acquire.as_ref().map(|acquire| {
            Arc::new(warning_cycle::WarningCycles::new(
                self.owned.clone(),
                self.attempts.clone(),
                self.warnings.clone(),
                self.clock.clone(),
                acquire.clone(),
            ))
        });
        self.forecast = acquire;
        self
    }
    /// Install one writer before the source/observation owner is shared.
    pub fn with_raw_writer(mut self, writer: Arc<crate::storage::response_first::Writer>) -> Self {
        Arc::get_mut(&mut self.observations)
            .expect("unshared observation owner")
            .set_raw_writer(writer.clone());
        self.raw_writer = Some(writer);
        self
    }
    /// The same source-owned admission used by request assembly. No work starts here.
    pub fn warning_cycles(
        &self,
    ) -> Option<Arc<dyn crate::warnings::acquisition_worker::Acquisition>> {
        self.warning_cycles
            .clone()
            .map(|cycles| cycles as Arc<dyn crate::warnings::acquisition_worker::Acquisition>)
    }
    /// Join (or start) the owned acquisition `key` and wait for it until `until`; the published
    /// records as one [`Fetched`], or None (not ready, nothing new, or no acquirer).
    ///
    /// The retry bound is claimed by whoever creates the flight, under the flight map's lock, so
    /// a concurrent request can only join the real acquisition. The provider call and its
    /// publication run in their own task: an owner timeout never cancels them.
    async fn acquire(
        &self,
        key: String,
        request: fetch::ForecastRequest,
        memo: std::time::Duration,
        until: Instant,
    ) -> Option<Fetched> {
        let admission = PublicationAdmission::Retry {
            attempts: self.attempts.clone(),
            key: key.clone(),
            memo,
        };
        self.acquire_admitted(key, request, admission, until).await
    }
    /// Admission runs under owned-flight creation, after callers have joined by key.
    async fn acquire_admitted(
        &self,
        key: String,
        request: fetch::ForecastRequest,
        admission: PublicationAdmission,
        until: Instant,
    ) -> Option<Fetched> {
        let acquire = self.forecast.clone()?;
        if let Some(records) = acquire.cached(&request) {
            return fetched_of(&records);
        }
        let owned_for = request.owned_for();
        let start = publication_flight(acquire, admission, request);
        let waited = self.owned.join(key, until, owned_for, start).await;
        match waited {
            crate::resolver::Waited::Ready(f) => f,
            _ => None,
        }
    }
    /// S15b-3: request-time AirKorea acquisition (None: stored records only) and the shared
    /// air-provider chain of the fallback (None: the legacy no-provider answer).
    pub fn with_air(
        self,
        acquire: Option<Arc<dyn live::AirKoreaAcquire>>,
        air: Option<Arc<dyn crate::world::AirSource>>,
    ) -> Self {
        self.map_air(|inputs| inputs.with_acquire(acquire).with_air(air))
    }
    /// S15b-3c: the AirKorea image calibration (the legacy `AIRKOREA_KOREA_IMAGE_*` settings with
    /// the deployed values as defaults).
    pub fn with_image_calibration(self, calibration: air_forecast::Calibration) -> Self {
        self.map_air(|inputs| inputs.with_calibration(calibration))
    }
    fn map_air(
        mut self,
        build: impl FnOnce(air_input::AirInputs<T>) -> air_input::AirInputs<T>,
    ) -> Self {
        let inputs = Arc::into_inner(self.air).expect("the air inputs are built before use");
        self.air = Arc::new(build(inputs));
        self
    }
    /// S15b-3c: the scheduled image hourly forecast production of the observed source, whose
    /// requests read only its product (None: the legacy source, whose requests fold and acquire
    /// the images, or no AirKorea acquirer).
    pub fn image_producer(&self) -> Option<Arc<dyn air_input::ImageProduction>> {
        self.air
            .produces_images()
            .then(|| self.air.clone() as Arc<dyn air_input::ImageProduction>)
    }
    /// S15b-3b: owned life-index, KASI and MFDS acquisitions (None: stored records only).
    pub fn with_life(mut self, acquire: Option<Arc<dyn life_live::LifeAcquire>>) -> Self {
        self.life = self.life.with_acquire(acquire);
        self
    }
    /// The forecast-zone collection at `now` (KMA-ZONE-NEWEST, AK 2026-11-10): the zones of the
    /// newest complete stored list ([`Self::refresh_zones`]), answered from memory and checked
    /// against S3 again once the last successful check is 10 minutes old. When the newest list
    /// known completed more than 24 h before `now`, or none is stored, the request starts the
    /// owned acquisition and does not wait for it; the acquired list is installed when it is
    /// newer. A failed check is the request's error, as before (memory is kept).
    pub async fn zones(&self, now: f64, deadline: Instant) -> Result<Arc<Zones>, String> {
        let (zones, identity) = {
            let mut memory = self.zones.lock().await;
            let recent = memory
                .as_ref()
                .and_then(|m| m.checked)
                .is_some_and(|checked| checked.elapsed() < ZONE_REFRESH);
            match memory.as_ref() {
                Some(m) if recent => (m.zones.clone(), m.identity.clone()),
                _ => self.check_zones(&mut memory, now, deadline).await?,
            }
        };
        if identity
            .as_ref()
            .is_none_or(|id| now - id.0 as f64 > ZONE_ACQUIRE_AGE_MS)
        {
            self.acquire_zones().await;
        }
        Ok(zones)
    }
    /// Check S3 now (the 10-minute check of [`Self::zones`]): select the newest complete stored
    /// list and install it when it is newer than memory's. The check time moves on every
    /// successful check, also when it finds the installed list again or nothing.
    pub async fn refresh_zones(&self, now: f64, deadline: Instant) -> Result<Arc<Zones>, String> {
        let mut memory = self.zones.lock().await;
        self.check_zones(&mut memory, now, deadline)
            .await
            .map(|(zones, _)| zones)
    }
    /// [`Self::refresh_zones`] under the zones lock: the installed zones and their identity.
    async fn check_zones(
        &self,
        memory: &mut Option<ZoneMemory>,
        now: f64,
        deadline: Instant,
    ) -> Result<(Arc<Zones>, Option<Identity>), String> {
        // On the heap: the selector's catalog reads would otherwise enlarge every snapshot's
        // future (a debug test thread of 2 MiB overflowed).
        let newest = Box::pin(self.newest_zone_list(now, deadline)).await?;
        let m = memory.get_or_insert_with(|| ZoneMemory {
            // No list installed: legacy's empty collection (`findForecastZoneByName` finds
            // nothing). The observed response uses the release's land zones until a list is
            // stored, so its first answer can ask for mid temperatures.
            zones: if self.observed_history {
                Zones::packaged()
            } else {
                Arc::new(Zones::default())
            },
            identity: None,
            checked: None,
        });
        if let Some((identity, list)) = newest
            && m.newer(&identity)
        {
            m.zones = Arc::new(zones_of(&list, identity.0));
            m.identity = Some(identity);
        }
        m.checked = Some(Instant::now());
        Ok((m.zones.clone(), m.identity.clone()))
    }
    /// The newest complete stored forecast-zone list at `now` with its identity (None: no
    /// eligible list is stored). Candidates come from catalog control objects alone, in the
    /// fold's order (completion instant, partition, digest of the pages); a group is restored only
    /// when it is tried. Day partitions are tried newest first; the first with an eligible list
    /// is the anchor, and only the day before it can hold a list that completed later: a list's
    /// partition is the latest KST day one of its pages was requested on, and its pages arrive
    /// within the provider budget (10 pages, 2 attempts of 10 s: 200 s) of that request, so a list
    /// of two days before the anchor completed before any list of the anchor's day began. A
    /// corrupt or unreadable store is the read's error, as before.
    async fn newest_zone_list(
        &self,
        now: f64,
        deadline: Instant,
    ) -> Result<Option<(Identity, Vec<Doc>)>, String> {
        let days = self
            .reader
            .partitions(
                "data-go-kr",
                "forecast-zone",
                &zone_key(),
                &history_months(now),
                deadline,
            )
            .await
            .map_err(|e| format!("forecast-zone listing: {e}"))?;
        for (i, day) in days.iter().enumerate().rev() {
            let Some(anchor) = self.eligible_zone_list(day, None, now, deadline).await? else {
                continue;
            };
            let before = day_before(day);
            if days[..i].binary_search(&before).is_ok()
                && let Some(later) = self
                    .eligible_zone_list(&before, Some(&anchor.0), now, deadline)
                    .await?
            {
                return Ok(Some(later));
            }
            return Ok(Some(anchor));
        }
        Ok(None)
    }
    /// The highest eligible list of one day partition, above `above` when given: its groups from
    /// the catalog alone in descending order key, each restored ([`Reader::members`]) until one
    /// is complete (S06), equals its catalog entries and is a list legacy would have written
    /// ([`complete_list`]). Lists that completed after `now` are skipped.
    async fn eligible_zone_list(
        &self,
        day: &str,
        above: Option<&Identity>,
        now: f64,
        deadline: Instant,
    ) -> Result<Option<(Identity, Vec<Doc>)>, String> {
        let read = |e: crate::storage::Error| format!("forecast-zone read: {e}");
        let id = records::catalog("data-go-kr", "forecast-zone", &zone_key(), day).map_err(read)?;
        let mut candidates: Vec<(Identity, crate::storage::Envelope)> = self
            .reader
            .listed_groups(&id, deadline)
            .await
            .map_err(read)?
            .into_iter()
            .filter(|g| g.completed as f64 <= now)
            .map(|g| {
                let key = (g.completed, day.to_owned(), pages_digest(&g.raw_sha256));
                (key, g.member)
            })
            .filter(|(key, _)| above.is_none_or(|above| key > above))
            .collect();
        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        for (key, member) in candidates {
            let Some(groups) = self
                .reader
                .members(&id, std::slice::from_ref(&member.identity), deadline)
                .await
                .map_err(read)?
            else {
                // Not complete: the next newest.
                continue;
            };
            let restored = groups
                .into_iter()
                .next()
                .and_then(|records| zone_fetched(records, day));
            let Some(fetched) = restored.filter(|f| identity(f) == key) else {
                return Err(format!(
                    "forecast-zone read: a restored list of {day} differs from its catalog entries"
                ));
            };
            if let Some(list) = complete_list(&fetched.page_refs()) {
                return Ok(Some((key, list)));
            }
        }
        Ok(None)
    }
    /// Start the owned forecast-zone acquisition without waiting for it. One runs at a time, and
    /// a failure is retried under the existing five-minute admission. Its complete list is
    /// installed when it is newer than memory's.
    async fn acquire_zones(&self) {
        let Some(acquire) = self.forecast.clone() else {
            return;
        };
        let request = fetch::ForecastRequest::Zones;
        let owned_for = request.owned_for();
        let attempts = self.attempts.clone();
        let memory = self.zones.clone();
        let _ = self
            .owned
            .join(
                "forecast-zones".into(),
                Instant::now(),
                owned_for,
                move |_| {
                    let fresh = attempts.claim("forecast-zones", LATEST_RETRY);
                    async move {
                        if fresh {
                            let _ = crate::observability::spawn(async move {
                                if let Ok(Some(records)) = acquire.acquire(request).await
                                    && let Some((identity, list)) = acquired_zone_list(records)
                                {
                                    let zones = Arc::new(zones_of(&list, identity.0));
                                    let mut memory = memory.lock().await;
                                    match memory.as_mut() {
                                        Some(m) if !m.newer(&identity) => {}
                                        Some(m) => {
                                            m.zones = zones;
                                            m.identity = Some(identity);
                                        }
                                        None => {
                                            *memory = Some(ZoneMemory {
                                                zones,
                                                identity: Some(identity),
                                                checked: None,
                                            });
                                        }
                                    }
                                }
                            })
                            .await;
                        }
                        None
                    }
                },
            )
            .await;
    }
    /// The documents of one grid family at `now`. A missing latest publication is acquired
    /// (waiting at most 3 s); the earlier publications legacy's backfill keeps (current and
    /// ultra-short 23, short 7) are acquired by one owned pass the request does not wait for.
    /// Err only when S3 cannot be read.
    pub async fn grid_answer(
        &self,
        family: Family,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        self.grid_answer_by(family, grid, now, deadline, wait_bound(deadline))
            .await
            .map(|(docs, _, _)| docs)
    }
    /// [`Self::grid_answer`] waiting for an acquisition only until `until` (the request's bound),
    /// with the S16 identities of the acquisitions it folded (`None` when S06 excluded a listed
    /// group: a partial read).
    async fn grid_answer_by(
        &self,
        family: Family,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
        until: Instant,
    ) -> Result<(Vec<Doc>, Option<Vec<InputId>>, Vec<String>), String> {
        self.grid_answer_with(family, grid, now, deadline, until, Link::None)
            .await
    }
    /// [`Self::grid_answer_by`] with what the observed answer of this family shares with another
    /// ([`Link`]): the Current answer tells its newest document early, and the Short answer also
    /// reads or acquires the publications covering the rows the client will show as current,
    /// under the same wait and retry bound as the required ones.
    async fn grid_answer_with(
        &self,
        family: Family,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
        until: Instant,
        link: Link<'_>,
    ) -> Result<(Vec<Doc>, Option<Vec<InputId>>, Vec<String>), String> {
        let coord = Coord {
            mx: f64::from(grid.nx()),
            my: f64::from(grid.ny()),
        };
        let sf = match family {
            Family::Current => schedule::Family::Current,
            Family::Shortest => schedule::Family::Shortest,
            Family::Short => schedule::Family::Short,
        };
        let key = grid.provider_key();
        let from = now
            - if self.observed_history {
                OBSERVED_READ_MS
            } else {
                lookback_ms(family)
            };
        let months = records::months(from, now);
        let parts = self
            .reader
            .partitions(sf.source(), sf.kind(), &key, &months, deadline)
            .await
            .map_err(|e| format!("{} listing: {e}", sf.kind()))?;
        let oldest = schedule::from_ms(from as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let read = || async {
            self.reader
                .all_counted(sf.source(), sf.kind(), &key, &wanted, deadline)
                .await
                .map_err(|e| format!("{} read: {e}", sf.kind()))
        };
        // A stored acquisition legacy would not keep (an invalid forecast, a current observation
        // with a recovery sentinel) leaves its publication missing, so it stays eligible for the
        // bounded retries.
        let missing = move |fetched: &[Fetched], p: &Publication| {
            let partition = p.partition();
            !fetched.iter().any(|f| {
                f.partition == partition
                    && f.fetched_at_ms as f64 <= now
                    && usable(family, coord, f)
            })
        };
        let (mut fetched, excluded, own) = if self.observed_history {
            let (newest, shown) = match link {
                Link::Newest(newest) => (Some(newest), None),
                Link::Shown(shown) => (None, Some(shown)),
                Link::None => (None, None),
            };
            let stored = read().shared();
            let latest = sf.latest(now as i64);
            let required_now = required::foreground(sf, now as i64);
            // What the listing shows absent is requested at once, so stored history does not
            // delay the provider.
            let absent = |p: &Publication| !wanted.iter().any(|w| *w == p.partition());
            // A listed publication is requested again as soon as the stored read shows it
            // unusable, whatever else is still being acquired (review
            // RP-previous-acquisition-starvation).
            let unusable = |listed: Vec<Publication>| {
                let stored = stored.clone();
                async move {
                    if listed.is_empty() {
                        return listed;
                    }
                    match stored.await {
                        Ok((fetched, _)) => listed
                            .into_iter()
                            .filter(|p| missing(&fetched, p))
                            .collect(),
                        Err(_) => Vec::new(),
                    }
                }
            };
            // Earlier publications: the absent ones and the unusable listed ones, under the one
            // wait.
            let acquired = |publications: Vec<Publication>| {
                let (first, listed): (Vec<_>, Vec<_>) =
                    publications.into_iter().partition(|p| absent(p));
                let again = unusable(listed);
                async move {
                    tokio::join!(self.foreground_grid(sf, grid, &first, until), async {
                        self.foreground_grid(sf, grid, &again.await, until).await
                    })
                }
            };
            let latest_part = async {
                let parts = match latest {
                    None => (None, None),
                    Some(latest) if absent(&latest) => {
                        (self.latest_grid(sf, grid, latest, now, until).await, None)
                    }
                    Some(latest) => {
                        let again = !unusable(vec![latest]).await.is_empty();
                        let acquired = if again {
                            self.latest_grid(sf, grid, latest, now, until).await
                        } else {
                            None
                        };
                        (None, acquired)
                    }
                };
                // The newest document once the stored read and the latest publication settled,
                // without today's earlier acquisitions (review RP-lagging-current-publication).
                if let Some(newest) = newest {
                    let mut known = stored.clone().await.map(|(f, _)| f).unwrap_or_default();
                    known.extend(parts.0.iter().chain(&parts.1).cloned());
                    let as_of = (self.clock)().max(now);
                    let _ = newest.send(grid_documents(family, coord, &known, as_of).pop());
                }
                parts
            };
            let earlier: Vec<Publication> = required_now
                .iter()
                .copied()
                .filter(|p| Some(*p) != latest)
                .collect();
            // The publications of the rows shown as current that the clock rule does not
            // require.
            let shown_part = async {
                let Some(shown) = shown else {
                    return (Vec::new(), Vec::new());
                };
                let extra: Vec<Publication> = shown
                    .await
                    .into_iter()
                    .filter(|p| Some(*p) != latest && !required_now.contains(p))
                    .collect();
                acquired(extra).await
            };
            let (
                stored,
                (latest_first, latest_again),
                (earlier_first, earlier_again),
                (shown_first, shown_again),
            ) = tokio::join!(stored.clone(), latest_part, acquired(earlier), shown_part);
            let (mut fetched, excluded) = stored?;
            // The fold order is the stored acquisitions, the ones of absent publications, then
            // the ones asked again.
            fetched.extend(
                latest_first
                    .into_iter()
                    .chain(earlier_first)
                    .chain(shown_first)
                    .chain(latest_again)
                    .chain(earlier_again)
                    .chain(shown_again),
            );
            (fetched, excluded, None)
        } else {
            let (mut fetched, excluded) = read().await?;
            // S16: this request's own acquisition keeps its stored fetch time in its identity
            // (the fold sees it at the request instant).
            let mut own: Option<InputId> = None;
            if let Some(latest) = sf.latest(now as i64) {
                let reach = fetch_reach(sf);
                let required = sf.required(now as i64);
                let backfill: Vec<Publication> = required
                    .iter()
                    .rev()
                    .skip(1)
                    .take(reach)
                    .copied()
                    .filter(|p| missing(&fetched, p))
                    .collect();
                if missing(&fetched, &latest)
                    && let Some(f) = self.latest_grid(sf, grid, latest, now, until).await
                {
                    if self.raw_writer.is_none() {
                        own = grid_input_id(family, sf.kind(), &f);
                    }
                    fetched.push(visible(f, now));
                }
                if !backfill.is_empty() {
                    self.backfill(sf, grid, latest, backfill).await;
                }
            }
            (fetched, excluded, own)
        };
        if self.observed_history {
            records::deduplicate(&mut fetched);
        }
        let as_of = if self.observed_history {
            (self.clock)().max(now)
        } else {
            now
        };
        let ids = (excluded == 0).then(|| {
            if self.observed_history {
                fetched
                    .iter()
                    .filter(|f| f.fetched_at_ms as f64 <= as_of)
                    .filter_map(|f| grid_input_id(family, sf.kind(), f))
                    .collect()
            } else {
                let stored = fetched.len() - usize::from(own.is_some());
                fetched[..stored]
                    .iter()
                    .filter(|f| f.fetched_at_ms as f64 <= now)
                    .filter_map(|f| grid_input_id(family, sf.kind(), f))
                    .chain(own)
                    .collect()
            }
        });
        let raw_ids = fetched
            .iter()
            .filter(|f| f.fetched_at_ms as f64 <= as_of)
            .flat_map(|f| f.raw_ids.iter().cloned())
            .collect();
        Ok((grid_documents(family, coord, &fetched, as_of), ids, raw_ids))
    }
    /// The latest publication of a cell and family, joined under the request's wait.
    async fn latest_grid(
        &self,
        sf: schedule::Family,
        grid: crate::history::Grid,
        latest: Publication,
        now: f64,
        until: Instant,
    ) -> Option<Fetched> {
        let request = grid_request(sf, grid, latest)?;
        let key = grid_flight(sf, grid, latest);
        let request = fetch::ForecastRequest::DataGoKr(request);
        if sf == schedule::Family::Short {
            self.acquire_admitted(
                key.clone(),
                request,
                PublicationAdmission::LatestShort {
                    gate: self.latest_short.clone(),
                    attempts: self.attempts.clone(),
                    key,
                    cell: grid_key(grid),
                    publication: latest,
                    now,
                },
                until,
            )
            .await
        } else {
            self.acquire(key, request, LATEST_RETRY, until).await
        }
    }
    /// Foreground history covers today's unavailable-in-ASOS hours and the D-1 24:00 boundary.
    /// Never request old SHRT for history: the only older SHRT is the previous publication the
    /// current three-hour slot needs from HH+2:10 to HH+2:59 (see [`required::foreground`]).
    async fn foreground_grid(
        &self,
        sf: schedule::Family,
        grid: crate::history::Grid,
        publications: &[Publication],
        until: Instant,
    ) -> Vec<Fetched> {
        let memo = if sf == schedule::Family::Short {
            PREVIOUS_SHORT_RETRY
        } else {
            LATEST_RETRY
        };
        let mut acquired = Vec::new();
        for chunk in publications.chunks(BACKFILL_CONCURRENCY) {
            if Instant::now() >= until {
                break;
            }
            let work = chunk.iter().filter_map(|p| {
                let request = grid_request(sf, grid, *p)?;
                Some(self.acquire(
                    grid_flight(sf, grid, *p),
                    fetch::ForecastRequest::DataGoKr(request),
                    memo,
                    until,
                ))
            });
            acquired.extend(
                crate::history::join_all(work.collect())
                    .await
                    .into_iter()
                    .flatten(),
            );
        }
        acquired
    }
    /// One owned pass over the missing backfill publications of a cell and family when its latest
    /// publication is `latest` (at most once per [`BACKFILL_RETRY`]), newest first, 3 in flight.
    /// Each publication joins the same owned flight and retry bound a latest acquisition of it
    /// uses: a publication that is still being acquired is joined, and one attempted within
    /// [`LATEST_RETRY`] (also a failure) is not asked again. A publication still missing is asked
    /// by the next pass. The flights run in their own tasks, so the pass's owned bound never
    /// cancels one that started. The request does not wait.
    async fn backfill(
        &self,
        sf: schedule::Family,
        grid: crate::history::Grid,
        latest: Publication,
        missing: Vec<Publication>,
    ) {
        let Some(acquire) = self.forecast.clone() else {
            return;
        };
        let publications: Vec<(String, fetch::ForecastRequest)> = missing
            .into_iter()
            .filter_map(|p| {
                Some((
                    grid_flight(sf, grid, p),
                    fetch::ForecastRequest::DataGoKr(grid_request(sf, grid, p)?),
                ))
            })
            .collect();
        if publications.is_empty() {
            return;
        }
        let key = format!(
            "backfill/{}/{}/{}",
            sf.kind(),
            grid_key(grid),
            latest.partition()
        );
        let attempts = self.attempts.clone();
        let owned = self.owned.clone();
        let claim = key.clone();
        let _ = self
            .passes
            .join(
                key,
                Instant::now(),
                crate::resolver::owned::MAX_OWNED,
                move |_| {
                    let fresh = attempts.claim(&claim, BACKFILL_RETRY);
                    async move {
                        if !fresh {
                            return None;
                        }
                        for chunk in publications.chunks(BACKFILL_CONCURRENCY) {
                            let flights: Vec<_> = chunk
                                .iter()
                                .map(|(key, request)| {
                                    owned.wait(
                                        key.clone(),
                                        request.owned_for(),
                                        publication_flight(
                                            acquire.clone(),
                                            PublicationAdmission::Retry {
                                                attempts: attempts.clone(),
                                                key: key.clone(),
                                                memo: LATEST_RETRY,
                                            },
                                            request.clone(),
                                        ),
                                    )
                                })
                                .collect();
                            crate::history::join_all(flights).await;
                        }
                        None
                    }
                },
            )
            .await;
    }
    /// The short RSS documents of one grid at `now`; a missing latest publication is acquired
    /// (waiting at most 3 s). Err only when S3 cannot be read.
    pub async fn rss_answer(
        &self,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        self.rss_answer_by(grid, now, deadline, wait_bound(deadline))
            .await
    }
    /// [`Self::rss_answer`] waiting for an acquisition only until `until`.
    async fn rss_answer_by(
        &self,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
        until: Instant,
    ) -> Result<Vec<Doc>, String> {
        let coord = Coord {
            mx: f64::from(grid.nx()),
            my: f64::from(grid.ny()),
        };
        let key = grid.provider_key();
        let from = now
            - if self.observed_history {
                OBSERVED_READ_MS
            } else {
                RSS_LOOKBACK_MS
            };
        let months = records::months(from, now);
        let parts = self
            .reader
            .partitions("kma-web", "town-rss", &key, &months, deadline)
            .await
            .map_err(|e| format!("town-rss listing: {e}"))?;
        let latest = publication::rss_latest(now as i64).ok_or("clock")?;
        let oldest = schedule::from_ms(from as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let request_latest = || async {
            let request = crate::domestic::family::WebRequest::town_rss(grid.nx(), grid.ny())
                .and_then(|r| r.not_before(latest))
                .ok()?;
            self.acquire(
                format!("town-rss/{}/{}", grid_key(grid), latest.partition()),
                fetch::ForecastRequest::Rss(request),
                LATEST_RETRY,
                until,
            )
            .await
        };
        // Observed: what the listing shows absent is requested while the stored reads run.
        let absent_first = self.observed_history && !wanted.contains(&latest.partition());
        let (read, requested) = tokio::join!(
            self.reader
                .all("kma-web", "town-rss", &key, &wanted, deadline),
            async {
                if absent_first {
                    request_latest().await
                } else {
                    None
                }
            }
        );
        let mut fetched = read.map_err(|e| format!("town-rss read: {e}"))?;
        if let Some(f) = requested {
            fetched.push(visible(f, now));
        } else if !absent_first
            && !present(&fetched, &latest.partition(), now)
            && let Some(f) = request_latest().await
        {
            fetched.push(visible(f, now));
        }
        Ok(rss_documents(coord, &fetched, now))
    }
    /// The stored mid document of one region at `now`: the last successfully saved acquisition,
    /// searched month by month back to [`HISTORY_START_MONTH`] (legacy keeps it until a newer
    /// save replaces it). A region legacy collects (`collected`) whose latest publication is not
    /// in S3 is acquired (waiting at most 3 s); any other region answers what its records hold.
    ///
    /// `saveMid` overwrites in save order. Legacy and the S15b-4 acquisition request only the
    /// wall-clock target `tmFc`, which never decreases, so save order is publication order
    /// across months: the newest publication month with a saved document holds the last save,
    /// and its acquisitions are folded in completion order.
    pub async fn mid_answer(
        &self,
        model: MidModel,
        reg_id: &str,
        collected: bool,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        self.mid_answer_by(
            model,
            reg_id,
            collected,
            now,
            deadline,
            wait_bound(deadline),
        )
        .await
    }
    /// [`Self::mid_answer`] waiting for an acquisition only until `until`.
    async fn mid_answer_by(
        &self,
        model: MidModel,
        reg_id: &str,
        collected: bool,
        now: f64,
        deadline: Instant,
        until: Instant,
    ) -> Result<Vec<Doc>, String> {
        let (kind, key) = match model {
            MidModel::Forecast => ("mid-fcst", format!("stn-{}", reg_id.to_ascii_lowercase())),
            MidModel::Land => (
                "mid-land-fcst",
                format!("reg-{}", reg_id.to_ascii_lowercase()),
            ),
            MidModel::Temp => ("mid-ta", format!("reg-{}", reg_id.to_ascii_lowercase())),
        };
        let key = ProviderKey::Named { id: key };
        let latest = publication::mid_tm_fc(now as i64).ok_or("clock")?;
        let latest_part = latest.partition();
        let request_latest = || async {
            let request = mid_request(model, reg_id, latest)?;
            self.acquire(
                format!("{kind}/{}/{latest_part}", reg_id.to_ascii_lowercase()),
                fetch::ForecastRequest::DataGoKr(request),
                LATEST_RETRY,
                until,
            )
            .await
        };
        if !self.observed_history {
            // Legacy `saveOnlyLastOne`: the last completed acquisition of the newest month.
            for month in history_months(now).into_iter().rev() {
                let parts = self
                    .reader
                    .partitions("data-go-kr", kind, &key, &[month], deadline)
                    .await
                    .map_err(|e| format!("{kind} listing: {e}"))?;
                let mut fetched = self
                    .reader
                    .all("data-go-kr", kind, &key, &parts, deadline)
                    .await
                    .map_err(|e| format!("{kind} read: {e}"))?;
                if collected
                    && month == latest.date() / 100
                    && !present(&fetched, &latest_part, now)
                    && let Some(f) = request_latest().await
                {
                    fetched.push(visible(f, now));
                }
                let found = mid_documents(model, reg_id, &fetched, now);
                if !found.is_empty() {
                    return Ok(found);
                }
            }
            // No acquisition was ever saved: legacy has no document either.
            return Ok(Vec::new());
        }
        let listed = self
            .reader
            .partitions("data-go-kr", kind, &key, &history_months(now), deadline)
            .await
            .map_err(|e| format!("{kind} listing: {e}"))?;
        // Each save replaces the whole document, so the newest publication that organizes is the
        // answer: start there and stop at the first document.
        if collected
            && !listed.contains(&latest_part)
            && let Some(f) = request_latest().await
        {
            let found = mid_documents(model, reg_id, &[visible(f, now)], now);
            if !found.is_empty() {
                return Ok(found);
            }
        }
        for partition in listed.iter().rev() {
            let mut fetched = self
                .reader
                .all(
                    "data-go-kr",
                    kind,
                    &key,
                    std::slice::from_ref(partition),
                    deadline,
                )
                .await
                .map_err(|e| format!("{kind} read: {e}"))?;
            if collected
                && *partition == latest_part
                && !present(&fetched, &latest_part, now)
                && let Some(f) = request_latest().await
            {
                fetched.push(visible(f, now));
            }
            let found = mid_documents(model, reg_id, &fetched, now);
            if !found.is_empty() {
                return Ok(found);
            }
        }
        // No acquisition was ever saved: legacy has no document either.
        Ok(Vec::new())
    }
    async fn load(&self, request: &KmaRequest, deadline: Instant) -> SourceAnswer {
        match self.build(request, deadline).await {
            Ok(s) => SourceAnswer::Snapshot(Box::new(s)),
            Err(Unbuilt::Failed(reason)) => SourceAnswer::Failed(reason),
        }
    }
    async fn build(&self, request: &KmaRequest, deadline: Instant) -> Result<Snapshot, Unbuilt> {
        // Covers the whole canonical discovery -> pending-overlay interval.
        let _raw_pin = self.raw_writer.as_ref().map(|writer| writer.pin());
        let now = (self.clock)();
        // One instant for the whole request, so a town lookup's wait and the rest do not add up.
        let observed = self.observed_history.then(|| {
            (
                observed_instant(deadline, OBSERVED_WAIT),
                observed_instant(deadline, OBSERVED_SECTION),
            )
        });
        // KMA-RESTART-RACE: the stored restores' head start (the legacy source has none).
        let race_at = |until: Instant| {
            if self.observed_history {
                observed_instant(deadline, crate::resolver::race::HEAD_START).min(until)
            } else {
                until
            }
        };
        let mut effective = request.clone();
        if super::middleware_of(&request.version, request.part.as_deref())
            .contains(&"getAllDataFromDb")
        {
            effective.city.get_or_insert_with(String::new);
            effective.town.get_or_insert_with(String::new);
        }
        let request = &effective;
        // Request names in the value layer's form, as the chain holds them.
        let region =
            crate::domestic::kma::js::canon_str(request.region.as_deref().unwrap_or_default());
        let city = crate::domestic::kma::js::canon_str(request.city.as_deref().unwrap_or_default());
        let town_name =
            crate::domestic::kma::js::canon_str(request.town.as_deref().unwrap_or_default());
        // `req.query` after `checkQueryValidation` (a non-`Send` value, dropped before any await).
        let (dust_wanted, image_wanted) = {
            let query = super::validated_query(request);
            (
                air_input::airkorea_forecast_requested(&query),
                air_input::image_forecast_requested(&query),
            )
        };
        let list = towns();
        let (town, preloaded_mids) = if let Some(town) = find_town(
            list,
            request.region.as_ref().map(|_| region.as_str()),
            Some(&city),
            Some(&town_name),
        ) {
            (town.clone(), None)
        } else {
            let address = format!(
                "{}{}{}",
                request.region.as_deref().unwrap_or("undefined"),
                request.city.as_deref().unwrap_or("undefined"),
                request.town.as_deref().unwrap_or("undefined")
            );
            // Medium-range inputs depend on region/city, not on a successful town geocode.
            // Start them alongside the owned lookup so a late location cannot discard already
            // available mid data or create a second acquisition wait budget.
            let until = observed.map_or_else(|| wait_bound(deadline), |o| o.0);
            let section = observed.map_or_else(
                || (until + std::time::Duration::from_millis(200)).min(deadline),
                |o| o.1,
            );
            let race_at = race_at(until);
            let absent_town = Doc::new();
            let lookup = self.town_resolver.resolve(
                crate::geocode::town::Operation::Town,
                address,
                until,
                now.max(0.) as u64,
            );
            let mid = async {
                let zones = self.zones(now, deadline).await?;
                let mids = self
                    .mids(&region, &city, &zones, now, deadline, until)
                    .await?;
                Ok::<_, String>((zones, mids))
            };
            let optional = async {
                tokio::join!(
                    self.air.load(
                        &absent_town,
                        &region,
                        &city,
                        dust_wanted,
                        image_wanted,
                        now,
                        section
                    ),
                    self.life.load_by(now, race_at, section),
                    self.special(now, until, section)
                )
            };
            if observed.is_some() {
                // The mid forecast starts with the lookup, so a late lookup still leaves it time.
                // A found town waits for neither it nor the optional arms, or its forecast would
                // start with no time left: the main path joins the same owned acquisitions.
                tokio::pin!(lookup, mid);
                let mut mid_done = None;
                let result = tokio::select! {
                    result = &mut lookup => result,
                    done = &mut mid => {
                        mid_done = Some(done);
                        lookup.await
                    }
                };
                match result {
                    Ok(result) => (
                        towns::town_document(&result, request, list),
                        mid_done.and_then(Result::ok),
                    ),
                    Err(towns::ResolveError::Storage) => {
                        return Err(Unbuilt::Failed("town projection unavailable".into()));
                    }
                    Err(_) => {
                        let (mid, (air, life, special)) = tokio::join!(
                            async {
                                match mid_done {
                                    Some(done) => done,
                                    None => mid.await,
                                }
                            },
                            optional
                        );
                        let (zones, mids) = mid?;
                        return Ok(Snapshot::missing_town(now, zones, mids, air, life, special));
                    }
                }
            } else {
                let (result, mid, (air, life, special)) = tokio::join!(lookup, mid, optional);
                let (zones, mids) = mid?;
                let result = match result {
                    Ok(result) => result,
                    Err(towns::ResolveError::Storage) => {
                        return Err(Unbuilt::Failed("town projection unavailable".into()));
                    }
                    Err(_) => {
                        return Ok(Snapshot::missing_town(now, zones, mids, air, life, special));
                    }
                };
                (
                    towns::town_document(&result, request, list),
                    Some((zones, mids)),
                )
            }
        };

        let m = town.get("mCoord").and_then(Val::as_doc);
        let num = |k| {
            m.and_then(|m| m.get(k))
                .and_then(Val::as_num)
                .unwrap_or(f64::NAN)
        };
        let coord = Coord {
            mx: num("mx"),
            my: num("my"),
        };
        // A coordinate outside the KMA grid has no grid collection: legacy's `find` by `mCoord`
        // finds no row, so every grid collection answers empty (no acquisition either).
        let grid = kma_grid(coord);
        // One wait bound for the whole request (OBSERVED_WAIT from its start, otherwise at most
        // REQUEST_WAIT, 3 s, and ANSWER_RESERVE before the deadline): station observations, ASOS history, the forecast, air and life
        // acquisitions all stop waiting at `until`, so the waits never add up; late parts are
        // answered as legacy answers absent data. The air and life inputs end their waits 200 ms
        // before the deadline they are given, so they get `until` + 200 ms (`section`), which
        // also bounds the warning-state read; the assembly keeps the last 300 ms.
        let until = observed.map_or_else(|| wait_bound(deadline), |o| o.0);
        let section = observed.map_or_else(
            || (until + std::time::Duration::from_millis(200)).min(deadline),
            |o| o.1,
        );
        let race_at = race_at(until);
        // The station state is shared: the observed Short answer also needs it, with the newest
        // current document, to find the rows the client will show as current
        // (`shown::publications`).
        let stations = self
            .observations
            .stations_by(now as i64, race_at, until)
            .shared();
        let (newest_sent, newest) = tokio::sync::oneshot::channel();
        let current_grid = async {
            match grid {
                Some(grid) => {
                    let link = if self.observed_history {
                        Link::Newest(newest_sent)
                    } else {
                        Link::None
                    };
                    self.grid_answer_with(Family::Current, grid, now, deadline, until, link)
                        .await
                }
                None => Ok((Vec::new(), None, Vec::new())),
            }
        };
        let observations = async {
            // The ASOS history starts with the request (its station from the current fold or
            // the default station list), beside the station collections.
            let (folded, ()) = tokio::join!(stations.clone(), async {
                if self.observed_history {
                    self.observations
                        .prefetch_history(&town, now, race_at, until)
                        .await;
                }
            });
            let (history, asos) = self
                .observations
                .history_with_inputs(&town, folded.as_deref(), now, until)
                .await;
            // S16: completeness of the station state these answers came from, judged at once.
            let settled = folded
                .as_ref()
                .is_some_and(|f| self.observations.settled(now as i64, f));
            (folded, (history, asos, settled))
        };
        // The mid regions follow the zone list (the temperature region comes from it); they do not
        // wait for the grids.
        let zones_and_mids = async {
            if let Some(loaded) = preloaded_mids {
                return Ok::<_, String>(loaded);
            }
            let zones = self.zones(now, deadline).await?;
            let mids = self
                .mids(&region, &city, &zones, now, deadline, until)
                .await?;
            Ok::<_, String>((zones, mids))
        };
        let (
            zones_and_mids,
            (current, shortest, short, rss),
            (stations, (history, asos, settled)),
            air,
            special,
            life,
        ) = tokio::join!(
            zones_and_mids,
            async {
                let Some(grid) = grid else {
                    return (
                        Ok((Vec::new(), None, Vec::new())),
                        Ok((Vec::new(), None, Vec::new())),
                        Ok((Vec::new(), None, Vec::new())),
                        Ok(Vec::new()),
                    );
                };
                // The station's time alone decides when it answers; otherwise the newest current
                // document does, as soon as the current answer has it. Neither waits for today's
                // whole current history (review RP-lagging-current-publication).
                let shown = if self.observed_history {
                    let (stations, town) = (stations.clone(), &town);
                    Link::Shown(Box::pin(async move {
                        let stations = stations.await;
                        let station = shown::station_time(stations.as_deref(), town, now, true);
                        let newest = match station {
                            Some(_) => None,
                            None => newest.await.ok().flatten(),
                        };
                        shown::publications(newest.as_ref(), station.as_deref(), now)
                    }))
                } else {
                    Link::None
                };
                tokio::join!(
                    current_grid,
                    self.grid_answer_by(Family::Shortest, grid, now, deadline, until),
                    self.grid_answer_with(Family::Short, grid, now, deadline, until, shown),
                    self.rss_answer_by(grid, now, deadline, until),
                )
            },
            observations,
            self.air.load(
                &town,
                &region,
                &city,
                dust_wanted,
                image_wanted,
                now,
                section
            ),
            // The warning state (see `special`).
            self.special(now, until, section),
            // S15b-3b life inputs (their owned acquisitions start for every request that reaches
            // this point), raced from the head start.
            self.life.load_by(now, race_at, section),
        );
        let (zones, mids) = zones_and_mids?;
        let (current, current_ids, current_raw) = current?;
        let (shortest, shortest_ids, shortest_raw) = shortest?;
        let (short, short_ids, short_raw) = short?;
        // S16: None when any grid family read was partial.
        let ids: Option<Vec<InputId>> = [current_ids, shortest_ids, short_ids]
            .into_iter()
            .try_fold(Vec::new(), |mut all, part| {
                all.extend(part?);
                Some(all)
            });
        let mut models = HashMap::new();
        models.insert(TownModel::Current, current);
        models.insert(TownModel::Shortest, shortest);
        models.insert(TownModel::Short, short);
        models.insert(TownModel::ShortRss, rss?);
        let mut raw_ids: Vec<_> = [current_raw, shortest_raw, short_raw]
            .into_iter()
            .flatten()
            .collect();
        if let Some(stations) = &stations {
            raw_ids.extend(stations.pages.iter().map(|page| page.raw_id.clone()));
        }
        if let Some(asos) = &asos {
            raw_ids.extend(asos.fetched.iter().flat_map(|f| f.raw_ids.iter().cloned()));
        }
        let summary_admitted = self.raw_writer.as_ref().is_none_or(|writer| {
            if let Some(scope) = crate::storage::response_first::ResponseScope::current() {
                scope.require_durable(writer, &raw_ids);
                true
            } else {
                writer.inputs_durable(&raw_ids)
            }
        });
        let summary = match (settled, ids, grid) {
            (true, Some(mut ids), Some(grid)) if summary_admitted => {
                if self.observed_history {
                    ids.push(InputId {
                        family: "asos-primary-v1".into(),
                        start_ms: i64::MIN / 2,
                        end_ms: i64::MAX / 2,
                        fetched_at_ms: 0,
                        content_sha256: crate::storage::sha256(OBSERVED_HISTORY_POLICY.as_bytes()),
                    });
                }
                summary_inputs(&town, grid, &history, ids, stations.as_deref(), asos)
            }
            _ => None,
        };
        Ok(Snapshot {
            summary,
            // Keep presentation/day attribution on the request's clock even if
            // acquisition crosses midnight. Raw visibility keeps its own fetch time.
            now,
            town,
            coord,
            models,
            mids,
            zones,
            special,
            stations,
            observed_history: self.observed_history,
            history,
            air,
            life,
        })
    }
    /// The mid regions the chain asks for (`getAllDataFromDb`, `getMid`), concurrently.
    async fn mids(
        &self,
        region: &str,
        city: &str,
        zones: &Zones,
        now: f64,
        deadline: Instant,
        until: Instant,
    ) -> Result<HashMap<(MidModel, String), Vec<Doc>>, String> {
        let mut mids = HashMap::new();
        if let Ok(row) = region_code(region, city) {
            let mut wanted = vec![
                (MidModel::Forecast, row.point_number.clone()),
                (MidModel::Land, land_area_code(&row.city_code)),
            ];
            let found = zones.find_by_name(region, city);
            let temp = match found.as_slice() {
                [one] => one
                    .get("regId")
                    .and_then(Val::as_str)
                    .map_or_else(|| row.city_code.clone(), str::to_owned),
                _ => row.city_code.clone(),
            };
            wanted.push((MidModel::Temp, temp));
            // The three regions concurrently, under the request's wait bound.
            let answers = crate::history::join_all(
                wanted
                    .iter()
                    .map(|(model, reg_id)| {
                        let collected = collected(*model, reg_id, zones);
                        self.mid_answer_by(*model, reg_id, collected, now, deadline, until)
                    })
                    .collect(),
            )
            .await;
            for ((model, reg_id), answer) in wanted.into_iter().zip(answers) {
                mids.insert((model, reg_id), answer?);
            }
        }
        Ok(mids)
    }
}
impl<T: IndexListing + Clone + Send + Sync + 'static> S3Source<T> {
    /// Join the shared warning owner, keeping the request's existing bounded wait.
    /// Legacy's lookups are exact, so the geocoder's newer province names would miss the town
    /// list and the region table.
    fn list_region(&self, request: &mut KmaRequest) {
        if self.observed_history
            && let Some(region) = request.region.as_deref()
        {
            let city = request.city.as_deref().unwrap_or_default();
            let listed = representative::listed_first(region, city).to_owned();
            if listed != region {
                request.requested_region = Some(region.to_owned());
                request.region = Some(listed);
            }
        }
    }
    /// The warning zone state of a request. The legacy warning cycle runs every 3 minutes; a due
    /// cycle is waited for until `until` at most, and the state is read by `section` (its
    /// refresh continues as an owned task). A failed or late read is the legacy store error
    /// (`getSpecialInfo` skips the section).
    ///
    /// Under the observed source the read starts with the request, on the request lane, beside
    /// the due cycle (KMA-RESTART-RACE): the answer takes the first state, the stored one or the
    /// one the cycle offers.
    async fn special(&self, now: f64, until: Instant, section: Instant) -> Option<Arc<ZoneState>> {
        if !self.observed_history {
            self.warning_wait(until).await;
            return self.warnings.zone_state(now as i64, section).await.ok();
        }
        let read = self.warnings.zone_state(now as i64, section);
        let cycle = self.warning_wait(until);
        tokio::pin!(read, cycle);
        tokio::select! {
            state = &mut read => match state {
                Ok(state) => Some(state),
                // A failed read still takes a state the cycle offers by `until`.
                Err(_) => {
                    (&mut cycle).await;
                    self.warnings.ready_state()
                }
            },
            () = &mut cycle => match self.warnings.ready_state() {
                Some(state) => Some(state),
                None => read.await.ok(),
            },
        }
    }
    /// Starts a due warning cycle and waits for it. Under the observed source the wait ends at
    /// the zone state it offers, so its publications do not hold the answer.
    async fn warning_wait(&self, until: Instant) {
        if self.observed_history {
            tokio::select! {
                biased;
                () = self.warning_cycle(until) => {}
                () = self.warnings.zones_ready() => {}
            }
        } else {
            self.warning_cycle(until).await;
        }
    }
    async fn warning_cycle(&self, until: Instant) {
        use crate::warnings::acquisition_worker::Acquisition;
        if let Some(cycles) = &self.warning_cycles {
            cycles.cycle(until).await;
        }
    }
}
/// S16: the summary inputs of a snapshot whose station state was read completely, or None
/// (the history answer still loading or failed, an ASOS recovery run in flight or a failed ASOS
/// read). Grid families that could not be read forward the request before this point.
fn summary_inputs(
    town: &Doc,
    grid: crate::history::Grid,
    history: &OrderedJson,
    mut ids: Vec<InputId>,
    folded: Option<&observe::Folded>,
    asos: Option<observe::AsosView>,
) -> Option<GridInputs> {
    let names = town.get("town").and_then(Val::as_doc)?;
    let name = |k: &str| names.get(k).and_then(Val::as_str).map(str::to_owned);
    let town_key = [name("first")?, name("second")?, name("third")?];
    match history
        .get("reason")
        .and_then(OrderedJson::string)
        .as_deref()
    {
        None | Some("station-unavailable") | Some("station-unrepresentative") => {}
        Some(_) => return None,
    }
    let folded = folded?;
    // The station registry decides station selection and the ASOS mapping of every date.
    let (registry, since) = folded.registry_id.clone()?;
    ids.push(InputId {
        family: "station-registry".into(),
        start_ms: i64::MIN / 2,
        end_ms: i64::MAX / 2,
        fetched_at_ms: since.max(0.) as u64,
        content_sha256: registry,
    });
    for page in folded.pages.iter() {
        let t = schedule::to_ms(page.hour);
        ids.push(InputId {
            family: page.kind.to_owned(),
            start_ms: t,
            end_ms: t,
            fetched_at_ms: page.fetched_at_ms.max(0.) as u64,
            content_sha256: page.sha256.clone(),
        });
    }
    let asos = match asos {
        Some(view) if view.settled => {
            ids.extend(
                view.fetched
                    .iter()
                    .filter_map(crate::summary::asos::input_id),
            );
            Some(AsosInputs {
                station: view.station,
                fetched: view.fetched,
            })
        }
        Some(_) => return None,
        // No mapped station within 100 km (`station-unavailable`).
        None => None,
    };
    Some(GridInputs {
        town: town_key,
        grid: (grid.nx(), grid.ny()),
        ids,
        asos,
    })
}
impl<T: IndexListing + Clone + Send + Sync + 'static> KmaSource for S3Source<T> {
    fn request_budget(&self) -> std::time::Duration {
        if self.observed_history {
            OBSERVED_BUDGET
        } else {
            std::time::Duration::from_secs(3)
        }
    }
    fn narrative_by(&self, deadline: Instant) -> Instant {
        if self.observed_history {
            observed_instant(deadline, OBSERVED_NARRATIVE)
        } else {
            deadline
        }
    }
    fn narrative_race(&self, deadline: Instant) -> Option<Instant> {
        self.observed_history
            .then(|| observed_instant(deadline, crate::resolver::race::HEAD_START))
    }
    fn prepare(
        &self,
        mut request: KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<KmaRequest, super::Outcome>> {
        Box::pin(async move {
            self.list_region(&mut request);
            if !super::middleware_of(&request.version, request.part.as_deref())
                .contains(&"checkParamValidation")
                || (request.city.as_deref() != Some("KR") && request.town.as_deref() != Some("KR"))
            {
                return Ok(request);
            }
            // checkParamValidation swaps city/region and clears town before name2address.
            let old_region = request.region.take();
            request.region = request.city.take();
            request.city = old_region;
            request.town = None;
            let address = format!(
                "{}{}",
                request.region.as_deref().unwrap_or("undefined"),
                request.city.as_deref().unwrap_or("undefined")
            );
            let result = self
                .town_resolver
                .resolve(
                    crate::geocode::town::Operation::Remap,
                    address,
                    wait_bound(deadline),
                    (self.clock)().max(0.) as u64,
                )
                .await
                .map_err(|_| {
                    super::Outcome::Status(500, super::js::INTERNAL_SERVER_ERROR.into())
                })?;
            let mut prior = serde_json::Map::new();
            if let Some(v) = &request.region {
                prior.insert("region".into(), Value::String(v.clone()));
            }
            if let Some(v) = &request.city {
                prior.insert("city".into(), Value::String(v.clone()));
            }
            let params = towns::remap_address(
                result["address"].as_str().unwrap_or_default(),
                &Value::Object(prior),
            );
            request.region = params["region"].as_str().map(str::to_owned);
            request.city = params["city"].as_str().map(str::to_owned);
            request.town = params["town"].as_str().map(str::to_owned);
            self.list_region(&mut request);
            // A still-KR result must terminate instead of recurring or forwarding.
            if request.city.as_deref() == Some("KR") || request.town.as_deref() == Some("KR") {
                return Err(super::Outcome::Status(
                    500,
                    super::js::INTERNAL_SERVER_ERROR.into(),
                ));
            }
            Ok(request)
        })
    }
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer> {
        let request = request.clone();
        Box::pin(async move { self.load(&request, deadline).await })
    }
}
/// The grid documents of `family` at `now` from its acquisitions in fetch order: each one
/// collected and saved as legacy does, then the retention run anchored on the family's latest
/// requested slot (`publicationInstant` of the run at the request instant).
pub fn grid_documents(family: Family, coord: Coord, fetched: &[Fetched], now: f64) -> Vec<Doc> {
    let sf = match family {
        Family::Current => schedule::Family::Current,
        Family::Shortest => schedule::Family::Shortest,
        Family::Short => schedule::Family::Short,
    };
    let mut docs = GridDocs::default();
    for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        apply_grid(&mut docs, family, coord, f);
    }
    if let Some(latest) = sf.latest(now as i64) {
        let anchor = match family {
            Family::Shortest => sf.request_publication(latest),
            _ => latest,
        };
        docs.retain(schedule::to_ms(anchor) as f64);
    }
    docs.answer()
}
/// The short RSS documents of a grid at `now`: each hourly run removes rows 216 h before its
/// wall clock, skips a stored publication, then parses and saves; the last run before `now`
/// removes again.
pub fn rss_documents(coord: Coord, fetched: &[Fetched], now: f64) -> Vec<Doc> {
    let mut docs = RssDocs::default();
    for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        docs.retain(f.fetched_at_ms as f64);
        let Some(page) = f.pages.first() else {
            continue;
        };
        let Some(parsed) = parse_rss(page) else {
            continue;
        };
        if korea_date(&parsed.publication).is_some_and(|p| docs.has_publication(p)) {
            continue;
        }
        docs.save(parsed);
    }
    docs.retain(last_run(now));
    let mine = |d: &Doc| {
        d.get("mCoord").and_then(Val::as_doc).is_some_and(|m| {
            m.get("mx") == Some(&Val::num(coord.mx)) && m.get("my") == Some(&Val::num(coord.my))
        })
    };
    docs.answer().into_iter().filter(mine).collect()
}
/// One mid region's stored document at `now` (fetch order, a stored publication skipped).
pub fn mid_documents(model: MidModel, reg_id: &str, fetched: &[Fetched], now: f64) -> Vec<Doc> {
    let mut doc = MidDoc::default();
    for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        let Some(p) = partition_publication(&f.partition) else {
            continue;
        };
        let compact = p.compact();
        let Some(p_ms) = korea_date(&compact) else {
            continue;
        };
        if doc.has_publication(p_ms) {
            continue;
        }
        let Some(list) = items(&f.page_refs()) else {
            continue;
        };
        if let Some(record) = organize_mid(model, &list, &compact, reg_id) {
            doc.save(model, &record);
        }
    }
    doc.answer()
}
/// The forecast-zone collection of these acquisitions at `now` (KMA-ZONE-NEWEST): the newest
/// complete list that completed by `now` (completion instant, partition, digest of the pages),
/// applied to an empty collection; None when none is complete.
pub fn zone_documents(fetched: &[Fetched], now: f64) -> Option<Zones> {
    fetched
        .iter()
        .filter(|f| f.fetched_at_ms as f64 <= now)
        .filter_map(|f| complete_list(&f.page_refs()).map(|list| (identity(f), list)))
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(identity, list)| zones_of(&list, identity.0))
}
fn apply_grid(docs: &mut GridDocs, family: Family, coord: Coord, f: &Fetched) {
    if let Some(Organized::Rows(rows)) = organized(family, coord, f) {
        docs.save(family, rows);
    }
}
/// The legacy collector steps over one stored grid acquisition (None: unreadable).
fn organized(family: Family, coord: Coord, f: &Fetched) -> Option<Organized> {
    let p = partition_publication(&f.partition)?;
    let slot_pub = match family {
        Family::Shortest => schedule::Family::Shortest.request_publication(p),
        _ => p,
    };
    let compact = slot_pub.compact();
    let slot = Slot::new(&compact[..8], &compact[8..]);
    let list = items(&f.page_refs())?;
    Some(collect(family, &list, &slot, coord))
}
/// Whether legacy collection keeps a stored grid acquisition: the collector saves its rows
/// (`invalidForecast` stays pending, `controllerManager.js:1212-1215`), and a current
/// observation carries no recovery sentinel (`t1h` -50 or `reh` -1 is collected again,
/// `PastConditionGather._isInvalid`, `PastConditionGather.js:80-90`).
fn usable(family: Family, coord: Coord, f: &Fetched) -> bool {
    match organized(family, coord, f) {
        Some(Organized::Rows(rows)) => {
            !rows.is_empty()
                && (family != Family::Current
                    || rows
                        .iter()
                        .all(|r| r.num("t1h") != -50. && r.num("reh") != -1.))
        }
        _ => false,
    }
}
/// The S16 input identity of one grid acquisition: its publication through the last row it can
/// write, the horizons of [`lookback_ms`] (current: the slot; ultra-short: six hours plus a
/// trailing day; short: six days).
pub fn grid_input_id(family: Family, kind: &str, f: &Fetched) -> Option<InputId> {
    let p = partition_publication(&f.partition)?;
    let start = schedule::to_ms(p);
    let horizon = lookback_ms(family) - grid::RETENTION_MS - HOUR_MS;
    Some(InputId {
        family: kind.to_owned(),
        start_ms: start,
        end_ms: start + horizon as i64,
        fetched_at_ms: f.fetched_at_ms,
        content_sha256: identity(f).2,
    })
}
/// Retry bound for generic latest and backfill acquisitions. Latest Short uses
/// its finite provision+2/+5/+10 slots, while keeping this memo for backfill.
const LATEST_RETRY: std::time::Duration = std::time::Duration::from_secs(5 * 60);
/// Retry bound of a backfill publication (legacy's past-condition pass runs hourly).
const BACKFILL_RETRY: std::time::Duration = std::time::Duration::from_secs(3600);
/// Retry bound of the previous SHRT publication the current slot needs (HH+2:10 to HH+2:59):
/// one attempt per cell and publication, at most one data.go.kr acquisition per cell and three
/// hours. A failure leaves that row with legacy's missing-publication values until the next one.
const PREVIOUS_SHORT_RETRY: std::time::Duration = std::time::Duration::from_secs(3 * 3600);
/// Backfill acquisitions in flight per pass.
const BACKFILL_CONCURRENCY: usize = 3;
/// Backfill passes running at once (each with [`BACKFILL_CONCURRENCY`] acquisitions).
const BACKFILL_PASSES: usize = 8;
/// Time kept after a request's waits for the remaining S3 reads and the assembly.
const ANSWER_RESERVE: std::time::Duration = std::time::Duration::from_millis(500);
/// The observed request's budget, which stored reads keep, so a slow S3 delays an answer instead
/// of failing it.
const OBSERVED_BUDGET: std::time::Duration = std::time::Duration::from_secs(8);
/// The observed request's wait for everything it started: its share of AK's 3 s, the rest being
/// the air and life section and the assembly.
const OBSERVED_WAIT: std::time::Duration = std::time::Duration::from_millis(2500);
/// The air and life inputs end their waits 200 ms before the deadline they are given.
const OBSERVED_SECTION: std::time::Duration = std::time::Duration::from_millis(2700);
/// The narrative is added after the assembly, so it stops last.
const OBSERVED_NARRATIVE: std::time::Duration = std::time::Duration::from_millis(2900);
/// `after` the start of an observed request, the same instant wherever it has got to: `deadline`
/// is its budget from the start, so a KR remap's wait counts as well. A past instant stays past.
fn observed_instant(deadline: Instant, after: std::time::Duration) -> Instant {
    deadline
        .checked_sub(OBSERVED_BUDGET - after)
        .unwrap_or_else(Instant::now)
}
/// Earlier publications legacy's backfill keeps per family (S14 `schedule`).
fn fetch_reach(sf: schedule::Family) -> usize {
    match sf {
        schedule::Family::Current => schedule::BACKFILL_CURRENT,
        schedule::Family::Shortest => schedule::BACKFILL_SHORTEST,
        schedule::Family::Short => schedule::BACKFILL_SHORT,
        _ => 0,
    }
}
fn grid_key(grid: crate::history::Grid) -> String {
    format!("{}-{}", grid.nx(), grid.ny())
}
/// The flight and retry key of one grid publication (shared by latest and backfill).
fn grid_flight(sf: schedule::Family, grid: crate::history::Grid, p: Publication) -> String {
    format!("{}/{}/{}", sf.kind(), grid_key(grid), p.partition())
}
/// Admission selected by the source; it never changes the owned flight key or deadline.
/// Latest Short slots also leave the existing memo for historical backfill.
enum PublicationAdmission {
    Retry {
        attempts: Arc<Attempts>,
        key: String,
        memo: std::time::Duration,
    },
    LatestShort {
        gate: Arc<late::LatestShort>,
        attempts: Arc<Attempts>,
        key: String,
        cell: String,
        publication: Publication,
        now: f64,
    },
}
impl PublicationAdmission {
    fn claim(self) -> bool {
        match self {
            Self::Retry {
                attempts,
                key,
                memo,
            } => attempts.claim(&key, memo),
            Self::LatestShort {
                gate,
                attempts,
                key,
                cell,
                publication,
                now,
            } => {
                if !gate.claim(&cell, publication, now) {
                    return false;
                }
                // Keep the shared recent-attempt memo for historical backfill.
                // Its result does not gate the next Short slot (the first two
                // slots are only three minutes apart, less than this memo).
                let _ = attempts.claim(&key, LATEST_RETRY);
                true
            }
        }
    }
}
/// Claim admission under owned-flight creation. The provider/publication owner
/// survives a caller that stops waiting, as before.
fn publication_flight(
    acquire: Arc<dyn fetch::ForecastAcquire>,
    admission: PublicationAdmission,
    request: fetch::ForecastRequest,
) -> impl FnOnce(Instant) -> BoxFuture<'static, Option<Fetched>> {
    move |_| {
        let fresh = admission.claim();
        Box::pin(async move {
            if !fresh {
                return None;
            }
            crate::observability::spawn(acquire.acquire(request))
                .await
                .ok()?
                .ok()
                .flatten()
                .and_then(|records| fetched_of(&records))
        })
    }
}
/// The S13 request of a grid publication (ultra-short asks for HH30 of a canonical HH00).
fn grid_request(
    sf: schedule::Family,
    grid: crate::history::Grid,
    p: Publication,
) -> Option<crate::domestic::family::DataGoKrRequest> {
    use crate::domestic::family::{DataGoKrFamily as F, DataGoKrRequest, Target};
    let family = match sf {
        schedule::Family::Current => F::UltraSrtNcst,
        schedule::Family::Shortest => F::UltraSrtFcst,
        schedule::Family::Short => F::VilageFcst,
        _ => return None,
    };
    DataGoKrRequest::new(
        family,
        Target::Grid {
            nx: grid.nx(),
            ny: grid.ny(),
        },
        sf.request_publication(p),
    )
    .ok()
}
/// The S13 request of a mid publication.
fn mid_request(
    model: MidModel,
    reg_id: &str,
    p: Publication,
) -> Option<crate::domestic::family::DataGoKrRequest> {
    use crate::domestic::family::{DataGoKrFamily as F, DataGoKrRequest, Target};
    let (family, target) = match model {
        MidModel::Forecast => (F::MidFcst, Target::Station(reg_id.to_owned())),
        MidModel::Land => (F::MidLandFcst, Target::Region(reg_id.to_owned())),
        MidModel::Temp => (F::MidTa, Target::Region(reg_id.to_owned())),
    };
    DataGoKrRequest::new(family, target, p).ok()
}
/// Published records as one acquisition (pages in order, dated by its last page).
fn fetched_of(records: &[crate::storage::RawRecord]) -> Option<Fetched> {
    let mut records = records.to_vec();
    records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
    let first = records.first()?;
    let period = &first.envelope.identity.period;
    Some(Fetched {
        raw_ids: records
            .iter()
            .map(|r| r.envelope.identity.object_key().ok())
            .collect::<Option<Vec<_>>>()?,
        fetched_at_ms: records
            .iter()
            .map(|r| r.envelope.identity.fetched_at_ms)
            .max()?,
        partition: format!("{:08}-{}", period.local_date, period.slot),
        pages: records.iter().map(|r| r.bytes.clone()).collect(),
    })
}
/// An acquisition made for this request is visible to it (it completed while the request ran).
fn visible(mut f: Fetched, now: f64) -> Fetched {
    f.fetched_at_ms = f.fetched_at_ms.min(now as u64);
    f
}
/// The latest instant a request waits for late inputs: at most 3 s (S13d) and
/// [`ANSWER_RESERVE`] before `deadline` (the gateway's native attempt ends there).
fn wait_bound(deadline: Instant) -> Instant {
    let now = Instant::now();
    deadline
        .checked_sub(ANSWER_RESERVE)
        .unwrap_or(now)
        .max(now)
        .min(now + observe::REQUEST_WAIT)
}
/// The KMA grid cell of a town's `mCoord` (None: not a cell, so no grid collection holds it).
fn kma_grid(coord: Coord) -> Option<crate::history::Grid> {
    (coord.mx.fract() == 0. && coord.my.fract() == 0.)
        .then(|| crate::history::Grid::new(coord.mx as u16, coord.my as u16))
        .flatten()
}
/// Why a snapshot was not built: a storage dependency failed. Missing/late geocoding yields
/// a partial native snapshot, as legacy's _getCoord error calls next() without weather fields.
enum Unbuilt {
    Failed(String),
}
impl From<String> for Unbuilt {
    fn from(reason: String) -> Self {
        Self::Failed(reason)
    }
}
/// Whether an acquisition of `partition` was complete at `now`.
fn present(fetched: &[Fetched], partition: &str, now: f64) -> bool {
    fetched
        .iter()
        .any(|f| f.partition == partition && f.fetched_at_ms as f64 <= now)
}
/// `YYYYMMDD-HHMM` to its publication.
fn partition_publication(p: &str) -> Option<Publication> {
    let (d, t) = p.split_once('-')?;
    if d.len() != 8 || t.len() != 4 {
        return None;
    }
    Publication::new(d.parse().ok()?, t.parse().ok()?)
}
/// `land_area_code(cityCode)` of the assembly.
fn land_area_code(city_code: &str) -> String {
    let u: Vec<u16> = crate::domestic::kma::js::units(city_code);
    let head = |n: usize| crate::domestic::kma::js::from16(&u[..n.min(u.len())]);
    match head(3).as_str() {
        "11B" => "11B00000".into(),
        "21F" => "11F10000".into(),
        _ => format!("{}0000", head(4)),
    }
}
/// Whether legacy currently collects this mid region (`listPointNumber`, `listAreaCode`,
/// `findMidTempZones`). It only decides whether a missing latest publication must be acquired;
/// stored documents are read for every region.
pub fn collected(model: MidModel, reg_id: &str, zones: &Zones) -> bool {
    match model {
        MidModel::Forecast => POINT_NUMBERS.contains(&reg_id),
        MidModel::Land => LAND_CODES.contains(&reg_id),
        MidModel::Temp => {
            land_zone_ids().iter().any(|id| id == reg_id)
                && zones.docs().iter().any(|d| {
                    d.get("regId").and_then(Val::as_str) == Some(reg_id)
                        && d.get("regSp").and_then(Val::as_str) == Some("C")
                        && d.get("retired") != Some(&Val::Bool(true))
                })
        }
    }
}

/// `KmaSpecialWeatherZone.find({active: true, warnVar: {$gt: 0}, areaCode: {$in: codes}},
/// {_id: 0, __v: 0})` over the S12 zone state, in state (natural) order.
pub fn special_zone_docs(state: &ZoneState, area_codes: &[String]) -> Vec<Doc> {
    state
        .entries()
        .filter(|e| e.active && e.warn_var > 0. && area_codes.contains(&e.area_code))
        .map(|e| {
            Doc::new()
                .with("areaCode", Val::str(&e.area_code))
                .with("areaName", Val::str(&e.area_name))
                .with("warnVar", Val::num(e.warn_var))
                .with("warnStress", Val::num(e.warn_stress))
                .with("active", Val::Bool(e.active))
                .with("command", Val::str(&e.command))
                .with("eventTmFc", Val::num(e.event_tm_fc))
                .with("eventTmSeq", Val::num(e.event_tm_seq))
                .with("eventRank", Val::num(e.event_rank))
        })
        .collect()
}

/// One request's inputs in memory.
pub struct Snapshot {
    /// S16 summary inputs (None: the reads were not complete).
    summary: Option<GridInputs>,
    now: f64,
    town: Doc,
    coord: Coord,
    models: HashMap<TownModel, Vec<Doc>>,
    mids: HashMap<(MidModel, String), Vec<Doc>>,
    zones: Arc<Zones>,
    /// None: the warning state could not be read (legacy's store error).
    special: Option<Arc<ZoneState>>,
    /// Station collections (None before the first fold: answered over empty collections).
    stations: Option<Arc<observe::Folded>>,
    /// ASOS-primary: station reads follow `station-altitude-v1`.
    observed_history: bool,
    /// `history.loadForTown` for the snapshot's town.
    history: OrderedJson,
    air: air_input::AirAnswers,
    life: life_input::LifeAnswers,
}
impl Snapshot {
    fn missing_town(
        now: f64,
        zones: Arc<Zones>,
        mids: HashMap<(MidModel, String), Vec<Doc>>,
        air: air_input::AirAnswers,
        life: life_input::LifeAnswers,
        special: Option<Arc<ZoneState>>,
    ) -> Self {
        Self {
            summary: None,
            now,
            town: Doc::new(),
            coord: Coord {
                mx: f64::NAN,
                my: f64::NAN,
            },
            models: HashMap::new(),
            mids,
            zones,
            special,
            stations: None,
            observed_history: false,
            history: OrderedJson::Null,
            air,
            life,
        }
    }
}
fn list(docs: &[Doc]) -> OrderedJson {
    OrderedJson::Array(docs.iter().map(Doc::json).collect())
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
}
impl KmaStore for Snapshot {
    fn db_version(&self) -> DbVersion {
        DbVersion::V2
    }
    /// The chain uses the town list only for `_findTown`; the snapshot lists the matched town,
    /// which `_findTown` finds first in the full list as well.
    fn towns(&self) -> StoreResult {
        Ok(if self.town.get("town").is_some() {
            list(std::slice::from_ref(&self.town))
        } else {
            OrderedJson::Array(Vec::new())
        })
    }
    fn town(&self, first: &str, second: &str, third: &str) -> StoreResult {
        let chosen = std::slice::from_ref(&self.town);
        let found: Vec<Doc> = find_town(chosen, Some(first), Some(second), Some(third))
            .into_iter()
            .cloned()
            .collect();
        Ok(list(&found))
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        region_code(region, city)
            .map(|row| row.doc().json())
            .map_err(StoreError)
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        if number(mx) != Some(self.coord.mx) || number(my) != Some(self.coord.my) {
            unavailable("town_model for a grid the snapshot did not load");
        }
        match self.models.get(&model) {
            Some(docs) => Ok(list(docs)),
            None => unavailable("town_model collection not loaded"),
        }
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        let id = match reg_id {
            Value::String(s) => s.clone(),
            _ => unavailable("mid_model for a non-string region"),
        };
        match self.mids.get(&(model, id)) {
            Some(docs) => Ok(list(docs)),
            None => unavailable("mid_model for a region the snapshot did not load"),
        }
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        Ok(list(&self.zones.find_by_name(region, city)))
    }
    fn stn_hourly_and_min_rns(&self, town: &Value, date_time: &str, _: &Value) -> StoreResult {
        let empty = observe::Folded::default();
        let f = self.stations.as_deref().unwrap_or(&empty);
        stn::Stations {
            registry: &f.registry,
            hourly: &f.hourly,
            minute: &f.minute,
            representative: self.observed_history,
        }
        .hourly_and_min_rns(town, date_time)
        .map(|d| d.json())
        .map_err(|e| StoreError(e.0))
    }
    fn city_hourly(&self, town: &Value) -> StoreResult {
        let empty = observe::Folded::default();
        let f = self.stations.as_deref().unwrap_or(&empty);
        stn::Stations {
            registry: &f.registry,
            hourly: &f.hourly,
            minute: &f.minute,
            representative: self.observed_history,
        }
        .city_hourly(town, self.now)
        .map(|rows| list(&rows))
        .map_err(|e| StoreError(e.0))
    }
    fn history(&self, _: &Value) -> StoreResult {
        Ok(self.history.clone())
    }
    /// `modelAreaNo.find({town}).limit(1)` over the repository area-number list.
    fn area_no(&self, first: &str, second: &str, third: &str) -> StoreResult {
        Ok(life::areas().by_town(first, second, third))
    }
    /// `modelAreaNo.find({geo: {$near: [lon, lat], $maxDistance: 0.3}}).limit(3)`; a point
    /// MongoDB cannot use is a query error.
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        match (
            lon_lat.get(0).and_then(Value::as_f64),
            lon_lat.get(1).and_then(Value::as_f64),
        ) {
            (Some(lon), Some(lat)) => Ok(life::areas().near(lon, lat)),
            _ => Err(StoreError("area_no_near: invalid point".into())),
        }
    }
    /// `LifeIndexKma2.find({areaNo})` over the national life-index fold.
    fn life_index(&self, area_no: f64) -> StoreResult {
        Ok(self.life.life.by_area(area_no))
    }
    /// `FoodPoisoning.find({sd, sgg: {$in: [sgg, '']}, date: {$gte, $lte}})`.
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        Ok(self.life.mfds.find(sd, sgg, start, end))
    }
    /// `getArpLtnInfo(townInfo, now)` for the snapshot's town and instant.
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
        let mine = self.town.get("gCoord").and_then(Val::as_doc).map(|g| {
            (
                g.get("lat").and_then(Val::as_num),
                g.get("lon").and_then(Val::as_num),
            )
        });
        let theirs = town.get("gCoord").map(|g| {
            (
                g.get("lat").and_then(Value::as_f64),
                g.get("lon").and_then(Value::as_f64),
            )
        });
        if now_ms != self.now || mine != theirs {
            unavailable("arpltn for a town or instant the snapshot did not load");
        }
        self.air.arpltn.clone().map_err(StoreError)
    }
    /// `getDustFrcst({region, city}, date)` (loaded for `airForecastSource=airkorea`).
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        match &self.air.dust {
            Some(((r, c, d), answer)) if r == region && c == city && d == date => {
                answer.clone().map_err(StoreError)
            }
            _ => unavailable("dust_forecast for arguments the snapshot did not load"),
        }
    }
    /// `AirFallback.getArpltn(gCoord, now)`: the evaluated observation or null.
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
        let coord = (
            g_coord.get("lat").and_then(Value::as_f64),
            g_coord.get("lon").and_then(Value::as_f64),
        );
        match &self.air.fallback {
            Some(((lat, lon), found))
                if now_ms == self.now && coord == (Some(*lat), Some(*lon)) =>
            {
                Ok(found.clone().unwrap_or(OrderedJson::Null))
            }
            _ => unavailable("air_fallback for a coordinate the snapshot did not load"),
        }
    }
    /// `getForecast(stationName)` of the AirKorea image forecast; KAQ has no forecast (its source
    /// is gone, issue #2742), so `kaq` is the legacy rejection [`crate::domestic::kma::NO_KAQ_FORECAST`]
    /// and a `kaq` request reads the AirKorea forecast (legacy #2771).
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        match source {
            "kaq" => Err(StoreError(crate::domestic::kma::NO_KAQ_FORECAST.into())),
            "airkorea" => {
                let Some(hourly) = self.air.hourly.as_ref() else {
                    unavailable("air_forecast for a request that did not load it");
                };
                // `find({stationName})`: Mongoose casts a number to its string.
                let name = match station {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => return Ok(OrderedJson::Array(Vec::new())),
                };
                Ok(hourly.by_station(&name))
            }
            _ => unavailable("air_forecast for an unknown source"),
        }
    }
    /// `kasiRiseSet.getRiseSetList(geocode, dates)` from the stored documents; `[]` until the
    /// first complete KASI read (legacy then computes rise/set itself).
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        Ok(self
            .life
            .kasi
            .as_ref()
            .map_or(OrderedJson::Array(Vec::new()), |k| k.answer(geocode, dates)))
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        match &self.special {
            Some(state) => Ok(list(&special_zone_docs(state, area_codes))),
            None => Err(StoreError("warning zone state unavailable".into())),
        }
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(self.now)
    }
    fn summary_inputs(&self) -> Option<GridInputs> {
        self.summary.clone()
    }
}

impl<T: IndexListing + Clone + Send + Sync + 'static> crate::nation::NationSource for S3Source<T> {
    fn nation_air(&self, now: f64, deadline: Instant) -> BoxFuture<'_, crate::nation::NationAir> {
        Box::pin(self.air.nation(now, deadline))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A town whose `mCoord` is not a KMA cell gets empty grid collections (S15b-4b-1).
    #[test]
    fn only_kma_cells_have_grid_collections() {
        let at = |mx: f64, my: f64| kma_grid(Coord { mx, my }).map(|g| (g.nx(), g.ny()));
        assert_eq!(at(60., 127.), Some((60, 127)));
        assert_eq!(at(1., 1.), Some((1, 1)));
        assert_eq!(at(149., 253.), Some((149, 253)));
        for (mx, my) in [
            (60.5, 127.),
            (0., 127.),
            (150., 127.),
            (60., 254.),
            (-1., 127.),
            (f64::NAN, 127.),
            (1e300, 127.),
        ] {
            assert_eq!(at(mx, my), None, "{mx},{my}");
        }
    }
}

#[cfg(test)]
mod previous_short_tests;
#[cfg(test)]
mod zone_retry_tests;
