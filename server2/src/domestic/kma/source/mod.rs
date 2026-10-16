//! S15b-1: the S3 input source of the native v000903 KMA assembly (#2742).
//!
//! For a request the source resolves the town, loads the raw records the store calls need from
//! S3 and returns an in-memory [`Snapshot`] answering every `KmaStore` call the assembly makes.
//! Legacy documents are rebuilt in memory from server2's own raw records (S13/S13b provider
//! acquisitions, S12 warnings) and from repository data copied under `data/`; no normalized
//! weather view is stored. Legacy is shut down at cutover, so nothing here reads legacy data.
//!
//! S15b-1 sources the town list, region code, forecast zone, the DB 2.0 grid and short RSS
//! documents, the mid documents and the warning zones. Station observations (S15b-2), air and
//! life inputs (S15b-3), request-time acquisition and unknown-town geocoding (S15b-4) are not
//! sourced yet: the snapshot ends the assembly with a named temporary forward for them, and the
//! `kma` family stays off until S15b-4.
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
//! forecast-zone list once per process and the 3-minute warning cycle. A missing input is no
//! longer a forward reason: the snapshot answers what is stored, as legacy answers absent data.
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
pub mod life;
pub mod life_input;
pub mod life_live;
pub mod live;
pub mod mfds;
mod mid;
pub mod observe;
pub mod pages;
mod records;
mod reference;
pub mod rnshit;
mod rss;
pub mod seed;
pub mod stations;
pub mod stn;
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
pub use records::Fetched;
use records::Reader;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::Instant;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// A KST month before every server2 raw record (S13 and S13b landed in October 2026). Histories
/// legacy keeps without a time bound (the last stored mid document, forecast-zone fields) are
/// folded from here; earlier months hold no record.
pub const HISTORY_START_MONTH: u32 = 202601;
/// Full forecast-zone refold interval; between refolds only newer acquisitions are applied.
const ZONE_REFOLD: std::time::Duration = std::time::Duration::from_secs(24 * 3600);
/// Incremental forecast-zone refresh interval.
const ZONE_REFRESH: std::time::Duration = std::time::Duration::from_secs(600);

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

struct ZoneCache {
    zones: Arc<Zones>,
    refreshed: std::time::Instant,
    folded: std::time::Instant,
    /// Identities of the acquisitions folded so far, and the last one in fold order.
    seen: std::collections::HashSet<Identity>,
    last: Identity,
}
/// An acquisition identity in fold order: (completion instant, partition, content digest).
type Identity = (u64, String, String);
fn identity(f: &Fetched) -> Identity {
    let mut digest = Vec::new();
    for page in &f.pages {
        digest.extend_from_slice(crate::storage::sha256(page).as_bytes());
    }
    (
        f.fetched_at_ms,
        f.partition.clone(),
        crate::storage::sha256(&digest),
    )
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
    warnings: Arc<WarningService<T>>,
    clock: Clock,
    zones: Arc<tokio::sync::Mutex<Option<ZoneCache>>>,
    observations: Arc<observe::Observations<T>>,
    /// S15b-3: AirKorea national datasets and the air-provider fallback.
    air: air_input::AirInputs<T>,
    /// S15b-3b: life index, MFDS food poisoning and KASI rise/set national datasets.
    life: life_input::LifeInputs<T>,
    /// S15b-4: request-time forecast acquisitions (None: stored records only).
    forecast: Option<Arc<dyn fetch::ForecastAcquire>>,
    /// Owned latest-publication, forecast-zone and warning acquisitions (S13d), keyed by
    /// dataset and publication.
    owned: crate::resolver::OwnedFlights<String, Option<Fetched>>,
    /// Owned backfill passes: their own pool, so a long pass never takes a slot a latest
    /// publication needs.
    passes: crate::resolver::OwnedFlights<String, Option<Fetched>>,
    /// Retry bounds of the acquisition keys (failures included).
    attempts: Arc<Attempts>,
    /// The forecast-zone list was requested by this process (legacy fetches it once at start).
    zones_requested: std::sync::atomic::AtomicBool,
    /// A warning cycle is running (cycles never overlap, as legacy's timer runs one at a time).
    warning_running: Arc<std::sync::atomic::AtomicBool>,
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
}
/// Clears a running flag when its task ends (also on a panic).
struct Running(Arc<std::sync::atomic::AtomicBool>);
impl Drop for Running {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
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
        let limits = CatalogLimits::default();
        let store = Arc::new(CatalogStore::new(transport.clone(), limits.clone())?);
        let warnings = WarningStore::new(transport.clone(), limits, StoreConfig::default())?;
        let observations = Arc::new(observe::Observations::new(
            transport.clone(),
            store.clone(),
            acquire,
            locate,
        ));
        Ok(Self {
            observations,
            air: air_input::AirInputs::new(transport.clone(), store.clone()),
            life: life_input::LifeInputs::new(transport.clone(), store.clone()),
            reader: Reader { transport, store },
            warnings: Arc::new(WarningService::new(
                Arc::new(warnings),
                Arc::new(crate::budget::SystemClock),
                ServiceConfig::default(),
            )),
            clock,
            zones: Arc::new(tokio::sync::Mutex::new(None)),
            forecast: None,
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
            zones_requested: std::sync::atomic::AtomicBool::new(false),
            warning_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }
    /// S15b-4: request-time grid, RSS, mid, forecast-zone and warning acquisitions.
    pub fn with_forecast(mut self, acquire: Option<Arc<dyn fetch::ForecastAcquire>>) -> Self {
        self.forecast = acquire;
        self
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
        let acquire = self.forecast.clone()?;
        let owned_for = request.owned_for();
        let start = publication_flight(acquire, self.attempts.clone(), key.clone(), memo, request);
        let waited = self.owned.join(key, until, owned_for, start).await;
        match waited {
            crate::resolver::Waited::Ready(f) => f,
            _ => None,
        }
    }
    /// S15b-3: request-time AirKorea acquisition (None: stored records only) and the shared
    /// air-provider chain of the fallback (None: the legacy no-provider answer).
    pub fn with_air(
        mut self,
        acquire: Option<Arc<dyn live::AirKoreaAcquire>>,
        air: Option<Arc<dyn crate::world::AirSource>>,
    ) -> Self {
        self.air = self.air.with_acquire(acquire).with_air(air);
        self
    }
    /// S15b-3c: the AirKorea image calibration (the legacy `AIRKOREA_KOREA_IMAGE_*` settings with
    /// the deployed values as defaults).
    pub fn with_image_calibration(mut self, calibration: air_forecast::Calibration) -> Self {
        self.air = self.air.with_calibration(calibration);
        self
    }
    /// S15b-3b: owned life-index, KASI and MFDS acquisitions (None: stored records only).
    pub fn with_life(mut self, acquire: Option<Arc<dyn life_live::LifeAcquire>>) -> Self {
        self.life = self.life.with_acquire(acquire);
        self
    }
    /// The forecast-zone collection at `now`: every complete `forecast-zone` acquisition since
    /// [`HISTORY_START_MONTH`] folded in fetch order (fields an older list set and a newer one
    /// omits stay, as legacy `$set` keeps them). Memory applies newer acquisitions every
    /// 10 minutes and refolds everything daily.
    pub async fn zones(&self, now: f64, deadline: Instant) -> Result<Arc<Zones>, String> {
        // Legacy fetches the list once at process start: one owned refresh per process (marked
        // when it starts), which no request waits for. A published list replaces the memory, so
        // the next request folds it.
        if let Some(acquire) = self.forecast.clone()
            && !self
                .zones_requested
                .load(std::sync::atomic::Ordering::SeqCst)
        {
            let request = fetch::ForecastRequest::Zones;
            let owned_for = request.owned_for();
            let requested = &self.zones_requested;
            let cache = self.zones.clone();
            let _ = self
                .owned
                .join(
                    "forecast-zones".into(),
                    Instant::now(),
                    owned_for,
                    move |_| {
                        let fresh = !requested.swap(true, std::sync::atomic::Ordering::SeqCst);
                        async move {
                            if fresh {
                                let _ = tokio::spawn(async move {
                                    if let Ok(Some(_)) = acquire.acquire(request).await {
                                        cache.lock().await.take();
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
        {
            let cache = self.zones.lock().await;
            if let Some(c) = cache.as_ref()
                && c.refreshed.elapsed() < ZONE_REFRESH
            {
                return Ok(c.zones.clone());
            }
        }
        self.refresh_zones(now, deadline).await
    }
    /// Refresh the forecast-zone memory now (the 10-minute refresh of [`Self::zones`]).
    pub async fn refresh_zones(&self, now: f64, deadline: Instant) -> Result<Arc<Zones>, String> {
        let mut cache = self.zones.lock().await;
        // Incremental: re-read the partitions from one day before the last folded acquisition
        // (an acquisition's day partition is its fetch day). A new acquisition there that sorts
        // before the last folded one (a late publication) cannot be appended: refold everything.
        let incremental = cache
            .as_ref()
            .filter(|c| c.folded.elapsed() < ZONE_REFOLD)
            .map(|c| day_before(&c.last.1));
        if let (Some(from), Some(c)) = (incremental, cache.as_ref()) {
            let fetched = self.zone_lists(now, Some(&from), deadline).await?;
            let new: Vec<&Fetched> = fetched
                .iter()
                .filter(|f| f.fetched_at_ms as f64 <= now && !c.seen.contains(&identity(f)))
                .collect();
            if new.iter().all(|f| identity(f) > c.last) {
                let mut zones = (*c.zones).clone();
                let (mut seen, mut last) = (c.seen.clone(), c.last.clone());
                for f in new {
                    if let Some(list) = complete_list(&f.page_refs()) {
                        zones.apply(&list, f.fetched_at_ms as f64);
                    }
                    let id = identity(f);
                    seen.insert(id.clone());
                    last = last.max(id);
                }
                let zones = Arc::new(zones);
                let folded = c.folded;
                *cache = Some(ZoneCache {
                    zones: zones.clone(),
                    refreshed: std::time::Instant::now(),
                    folded,
                    seen,
                    last,
                });
                return Ok(zones);
            }
        }
        let fetched = self.zone_lists(now, None, deadline).await?;
        let mut zones = Zones::default();
        let mut seen = std::collections::HashSet::new();
        let mut last = None;
        let mut applied = false;
        for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
            if let Some(list) = complete_list(&f.page_refs()) {
                zones.apply(&list, f.fetched_at_ms as f64);
                applied = true;
            }
            let id = identity(f);
            seen.insert(id.clone());
            last = Some(id);
        }
        let (true, Some(last)) = (applied, last) else {
            // No list stored: legacy's empty collection (`findForecastZoneByName` finds nothing).
            return Ok(Arc::new(Zones::default()));
        };
        let zones = Arc::new(zones);
        *cache = Some(ZoneCache {
            zones: zones.clone(),
            refreshed: std::time::Instant::now(),
            folded: std::time::Instant::now(),
            seen,
            last,
        });
        Ok(zones)
    }
    /// Every `forecast-zone` acquisition since [`HISTORY_START_MONTH`] (or from partition `from`),
    /// in fold order (completion instant, partition).
    async fn zone_lists(
        &self,
        now: f64,
        from: Option<&str>,
        deadline: Instant,
    ) -> Result<Vec<Fetched>, String> {
        let key = ProviderKey::Named {
            id: "forecast-zones".into(),
        };
        let months: Vec<u32> = history_months(now)
            .into_iter()
            .filter(|m| from.is_none_or(|f| format!("{m:06}").as_str() >= &f[..6]))
            .collect();
        let parts: Vec<String> = self
            .reader
            .partitions("data-go-kr", "forecast-zone", &key, &months, deadline)
            .await
            .map_err(|e| format!("forecast-zone listing: {e}"))?
            .into_iter()
            .filter(|p| from.is_none_or(|f| p.as_str() >= f))
            .collect();
        let mut fetched = self
            .reader
            .all("data-go-kr", "forecast-zone", &key, &parts, deadline)
            .await
            .map_err(|e| format!("forecast-zone read: {e}"))?;
        fetched.sort_by_key(identity);
        Ok(fetched)
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
            .map(|(docs, _)| docs)
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
    ) -> Result<(Vec<Doc>, Option<Vec<InputId>>), String> {
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
        let from = now - lookback_ms(family);
        let months = records::months(from, now);
        let parts = self
            .reader
            .partitions(sf.source(), sf.kind(), &key, &months, deadline)
            .await
            .map_err(|e| format!("{} listing: {e}", sf.kind()))?;
        let oldest = schedule::from_ms(from as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let (mut fetched, excluded) = self
            .reader
            .all_counted(sf.source(), sf.kind(), &key, &wanted, deadline)
            .await
            .map_err(|e| format!("{} read: {e}", sf.kind()))?;
        // S16: this request's own acquisition keeps its stored fetch time in its identity (the
        // fold sees it at the request instant).
        let mut own: Option<InputId> = None;
        if let Some(latest) = sf.latest(now as i64) {
            // A stored acquisition legacy would not keep (an invalid forecast, a current
            // observation with a recovery sentinel) leaves its publication missing, so it stays
            // eligible for the bounded retries.
            let missing = |p: &Publication| {
                let partition = p.partition();
                !fetched.iter().any(|f| {
                    f.partition == partition
                        && f.fetched_at_ms as f64 <= now
                        && usable(family, coord, f)
                })
            };
            let reach = fetch_reach(sf);
            let required = sf.required(now as i64);
            let backfill: Vec<Publication> = required
                .iter()
                .rev()
                .skip(1)
                .take(reach)
                .copied()
                .filter(|p| missing(p))
                .collect();
            if missing(&latest)
                && let Some(request) = grid_request(sf, grid, latest)
                && let Some(f) = self
                    .acquire(
                        grid_flight(sf, grid, latest),
                        fetch::ForecastRequest::DataGoKr(request),
                        LATEST_RETRY,
                        until,
                    )
                    .await
            {
                own = grid_input_id(family, sf.kind(), &f);
                fetched.push(visible(f, now));
            }
            if !backfill.is_empty() {
                self.backfill(sf, grid, latest, backfill).await;
            }
        }
        let ids = (excluded == 0).then(|| {
            let stored = fetched.len() - usize::from(own.is_some());
            fetched[..stored]
                .iter()
                .filter(|f| f.fetched_at_ms as f64 <= now)
                .filter_map(|f| grid_input_id(family, sf.kind(), f))
                .chain(own)
                .collect()
        });
        Ok((grid_documents(family, coord, &fetched, now), ids))
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
                                            attempts.clone(),
                                            key.clone(),
                                            LATEST_RETRY,
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
        let from = now - RSS_LOOKBACK_MS;
        let months = records::months(from, now);
        let parts = self
            .reader
            .partitions("kma-web", "town-rss", &key, &months, deadline)
            .await
            .map_err(|e| format!("town-rss listing: {e}"))?;
        let latest = publication::rss_latest(now as i64).ok_or("clock")?;
        let oldest = schedule::from_ms(from as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let mut fetched = self
            .reader
            .all("kma-web", "town-rss", &key, &wanted, deadline)
            .await
            .map_err(|e| format!("town-rss read: {e}"))?;
        if !present(&fetched, &latest.partition(), now)
            && let Ok(request) = crate::domestic::family::WebRequest::town_rss(grid.nx(), grid.ny())
                .and_then(|r| r.not_before(latest))
            && let Some(f) = self
                .acquire(
                    format!("town-rss/{}/{}", grid_key(grid), latest.partition()),
                    fetch::ForecastRequest::Rss(request),
                    LATEST_RETRY,
                    until,
                )
                .await
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
                && let Some(request) = mid_request(model, reg_id, latest)
                && let Some(f) = self
                    .acquire(
                        format!("{kind}/{}/{latest_part}", reg_id.to_ascii_lowercase()),
                        fetch::ForecastRequest::DataGoKr(request),
                        LATEST_RETRY,
                        until,
                    )
                    .await
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
            Err(Unbuilt::Forward(reason)) => SourceAnswer::Forward(reason),
            Err(Unbuilt::Failed(reason)) => SourceAnswer::Failed(reason),
        }
    }
    async fn build(&self, request: &KmaRequest, deadline: Instant) -> Result<Snapshot, Unbuilt> {
        let now = (self.clock)();
        // Request names in the value layer's form, as the chain holds them.
        let region =
            crate::domestic::kma::js::canon_str(request.region.as_deref().unwrap_or_default());
        let city = crate::domestic::kma::js::canon_str(request.city.as_deref().unwrap_or_default());
        let town_name =
            crate::domestic::kma::js::canon_str(request.town.as_deref().unwrap_or_default());
        let list = towns();
        let town = find_town(
            list,
            request.region.as_ref().map(|_| region.as_str()),
            Some(&city),
            Some(&town_name),
        )
        .ok_or_else(|| {
            Unbuilt::Forward(
                "town absent from the town list (S15b-4b-2 geocodes and stores new towns)".into(),
            )
        })?
        .clone();
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
        // One wait bound for the whole request (at most REQUEST_WAIT, 3 s, and ANSWER_RESERVE
        // before the deadline): station observations, ASOS history, the forecast, air and life
        // acquisitions all stop waiting at `until`, so the waits never add up; late parts are
        // answered as legacy answers absent data. The air and life inputs end their waits 200 ms
        // before the deadline they are given, so they get `until` + 200 ms (`section`), which
        // also bounds the warning-state read; the assembly keeps the last 300 ms.
        let until = wait_bound(deadline);
        let section = (until + std::time::Duration::from_millis(200)).min(deadline);
        let observations = async {
            let folded = self.observations.stations(now as i64, until).await;
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
        // `req.query` after `checkQueryValidation` (a non-`Send` value, dropped before any await).
        let (dust_wanted, image_wanted) = {
            let query = super::validated_query(request);
            (
                air_input::airkorea_forecast_requested(&query),
                air_input::image_forecast_requested(&query),
            )
        };
        // The mid regions follow the zone list (the temperature region comes from it); they do not
        // wait for the grids.
        let zones_and_mids = async {
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
                        Ok((Vec::new(), None)),
                        Ok((Vec::new(), None)),
                        Ok((Vec::new(), None)),
                        Ok(Vec::new()),
                    );
                };
                tokio::join!(
                    self.grid_answer_by(Family::Current, grid, now, deadline, until),
                    self.grid_answer_by(Family::Shortest, grid, now, deadline, until),
                    self.grid_answer_by(Family::Short, grid, now, deadline, until),
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
            // The legacy warning cycle runs every 3 minutes; a due cycle is waited for until
            // `until` at most, and the warning state is read by `section` (its refresh continues
            // as an owned task). A failed or late read is the legacy store error
            // (`getSpecialInfo` skips the section).
            async {
                self.warning_cycle(until).await;
                self.warnings.zone_state(now as i64, section).await.ok()
            },
            // S15b-3b life inputs (their owned acquisitions start for every request that reaches
            // this point).
            self.life.load(now, section),
        );
        let (zones, mids) = zones_and_mids?;
        let (current, current_ids) = current?;
        let (shortest, shortest_ids) = shortest?;
        let (short, short_ids) = short?;
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
        let summary = match (settled, ids, grid) {
            (true, Some(ids), Some(grid)) => {
                summary_inputs(&town, grid, &history, ids, stations.as_deref(), asos)
            }
            _ => None,
        };
        Ok(Snapshot {
            summary,
            now,
            town,
            coord,
            models,
            mids,
            zones,
            special,
            stations,
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
    /// One legacy warning cycle per 3-minute window while requests arrive, never two at once.
    /// The cycle runs in its own task (its steps carry the collector's 30 s deadlines), so the
    /// owned bound never cancels it; a request waits for it until `until` at most.
    async fn warning_cycle(&self, until: Instant) {
        let Some(acquire) = self.forecast.clone() else {
            return;
        };
        let key = format!(
            "warnings/{}",
            ((self.clock)() as i64).div_euclid(fetch::WARNING_CYCLE.as_millis() as i64)
        );
        let request = fetch::ForecastRequest::Warnings;
        let owned_for = request.owned_for();
        let warnings = self.warnings.clone();
        let attempts = self.attempts.clone();
        let running = self.warning_running.clone();
        let _ = self
            .owned
            .join(key, until, owned_for, move |_| {
                use std::sync::atomic::Ordering::SeqCst;
                let fresh = !running.load(SeqCst)
                    && attempts.claim("warnings", fetch::WARNING_CYCLE)
                    && !running.swap(true, SeqCst);
                async move {
                    if fresh {
                        let _ = tokio::spawn(async move {
                            let _running = Running(running);
                            if acquire.acquire(request).await.is_ok() {
                                // New rows are read again (the service memory holds the
                                // previous state).
                                warnings.clear_memory().await;
                            }
                        })
                        .await;
                    }
                    None
                }
            })
            .await;
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
        None | Some("station-unavailable") => {}
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
/// The forecast-zone collection at `now`; None when no complete list was fetched.
pub fn zone_documents(fetched: &[Fetched], now: f64) -> Option<Zones> {
    let mut zones = Zones::default();
    let mut applied = false;
    for f in fetched.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        if let Some(list) = complete_list(&f.page_refs()) {
            zones.apply(&list, f.fetched_at_ms as f64);
            applied = true;
        }
    }
    applied.then_some(zones)
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
/// Retry bound of a missing latest publication (legacy re-walks late grids near +5 and +10
/// minutes, #2676).
const LATEST_RETRY: std::time::Duration = std::time::Duration::from_secs(5 * 60);
/// Retry bound of a backfill publication (legacy's past-condition pass runs hourly).
const BACKFILL_RETRY: std::time::Duration = std::time::Duration::from_secs(3600);
/// Backfill acquisitions in flight per pass.
const BACKFILL_CONCURRENCY: usize = 3;
/// Backfill passes running at once (each with [`BACKFILL_CONCURRENCY`] acquisitions).
const BACKFILL_PASSES: usize = 8;
/// Time kept after a request's waits for the remaining S3 reads and the assembly.
const ANSWER_RESERVE: std::time::Duration = std::time::Duration::from_millis(500);
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
/// The start of a publication's owned acquisition. The retry bound `memo` of `key` is claimed by
/// the creator of the flight (`OwnedFlights` calls this under its map lock), so a concurrent
/// caller joins the real acquisition; the provider call and its publication run in their own
/// task, which no owned bound cancels.
fn publication_flight(
    acquire: Arc<dyn fetch::ForecastAcquire>,
    attempts: Arc<Attempts>,
    key: String,
    memo: std::time::Duration,
    request: fetch::ForecastRequest,
) -> impl FnOnce(Instant) -> BoxFuture<'static, Option<Fetched>> {
    move |_| {
        let fresh = attempts.claim(&key, memo);
        Box::pin(async move {
            if !fresh {
                return None;
            }
            tokio::spawn(acquire.acquire(request))
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
/// Why a snapshot was not built: a town legacy would geocode (forwarded until S15b-4b-2), or
/// inputs S3 could not supply (a dependency failure).
enum Unbuilt {
    Forward(String),
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
    /// `history.loadForTown` for the snapshot's town.
    history: OrderedJson,
    air: air_input::AirAnswers,
    life: life_input::LifeAnswers,
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
        Ok(list(std::slice::from_ref(&self.town)))
    }
    fn town(&self, first: &str, second: &str, third: &str) -> StoreResult {
        let found: Vec<Doc> = find_town(towns(), Some(first), Some(second), Some(third))
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
