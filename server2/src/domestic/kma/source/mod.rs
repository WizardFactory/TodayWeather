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
//! [`life_input`], [`life_live`]). The image forecasts (`air_forecast`, S15b-3c) still forward.
pub mod air_forecast;
pub mod air_input;
pub mod airkorea;
pub mod asos;
mod doc;
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
    zones: tokio::sync::Mutex<Option<ZoneCache>>,
    observations: Arc<observe::Observations<T>>,
    /// S15b-3: AirKorea national datasets and the air-provider fallback.
    air: air_input::AirInputs<T>,
    /// S15b-3b: life index, MFDS food poisoning and KASI rise/set national datasets.
    life: life_input::LifeInputs<T>,
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
            zones: tokio::sync::Mutex::new(None),
        })
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
            return Err("no complete forecast-zone list in S3 (S15b-4 acquires it)".into());
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
    /// The documents of one grid family at `now`; Err when its latest publication is absent.
    pub async fn grid_answer(
        &self,
        family: Family,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        self.grid_inputs(family, grid, now, deadline)
            .await
            .map(|(docs, _)| docs)
    }
    /// [`Self::grid_answer`] with the identities of the acquisitions it folded (S16), or `None`
    /// for them when S06 excluded a listed group (a partial read).
    async fn grid_inputs(
        &self,
        family: Family,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
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
        let latest = sf
            .latest(now as i64)
            .ok_or("clock outside the publication calendar")?;
        let (fetched, excluded) = self
            .reader
            .all_counted(sf.source(), sf.kind(), &key, &wanted, deadline)
            .await
            .map_err(|e| format!("{} read: {e}", sf.kind()))?;
        if !present(&fetched, &latest.partition(), now) {
            return Err(format!(
                "{} {} not in S3 (S15b-4 acquires the latest publication)",
                sf.kind(),
                latest.partition()
            ));
        }
        let ids = (excluded == 0).then(|| {
            fetched
                .iter()
                .filter(|f| f.fetched_at_ms as f64 <= now)
                .filter_map(|f| grid_input_id(family, sf.kind(), f))
                .collect()
        });
        Ok((grid_documents(family, coord, &fetched, now), ids))
    }
    /// The short RSS documents of one grid at `now`; Err when the latest publication is absent.
    pub async fn rss_answer(
        &self,
        grid: crate::history::Grid,
        now: f64,
        deadline: Instant,
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
        let fetched = self
            .reader
            .all("kma-web", "town-rss", &key, &wanted, deadline)
            .await
            .map_err(|e| format!("town-rss read: {e}"))?;
        if !present(&fetched, &latest.partition(), now) {
            return Err(format!(
                "town-rss {} not in S3 (S15b-4 acquires the latest publication)",
                latest.partition()
            ));
        }
        Ok(rss_documents(coord, &fetched, now))
    }
    /// The stored mid document of one region at `now`: the last successfully saved acquisition,
    /// searched month by month back to [`HISTORY_START_MONTH`] (legacy keeps it until a newer
    /// save replaces it). A region legacy collects (`collected`) whose latest publication is not
    /// in S3 is Err (S15b-4 acquires it); any other region answers what its records hold.
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
            let fetched = self
                .reader
                .all("data-go-kr", kind, &key, &parts, deadline)
                .await
                .map_err(|e| format!("{kind} read: {e}"))?;
            if collected && month == latest.date() / 100 && !present(&fetched, &latest_part, now) {
                return Err(format!(
                    "{kind} {reg_id} {latest_part} not in S3 (S15b-4 acquires the latest publication)"
                ));
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
            Err(reason) => SourceAnswer::Forward(reason),
        }
    }
    async fn build(&self, request: &KmaRequest, deadline: Instant) -> Result<Snapshot, String> {
        let now = (self.clock)();
        let region = request.region.clone().unwrap_or_default();
        let city = request.city.clone().unwrap_or_default();
        let town_name = request.town.clone().unwrap_or_default();
        let list = towns();
        let town = find_town(
            list,
            request.region.as_deref(),
            Some(&city),
            Some(&town_name),
        )
        .ok_or("town absent from the town list (S15b-4 geocodes and stores new towns)")?
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
        let grid = (coord.mx.fract() == 0. && coord.my.fract() == 0.)
            .then(|| crate::history::Grid::new(coord.mx as u16, coord.my as u16))
            .flatten()
            .ok_or("town grid outside the KMA grid")?;
        // Station observations and ASOS history: at most REQUEST_WAIT for late acquisitions.
        let until = deadline.min(Instant::now() + observe::REQUEST_WAIT);
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
        let dust_wanted = air_input::airkorea_forecast_requested(&request.query);
        let image_wanted = air_input::image_forecast_requested(&request.query);
        let (zones, (current, shortest, short, rss), (stations, (history, asos, settled)), air) = tokio::join!(
            self.zones(now, deadline),
            async {
                tokio::join!(
                    self.grid_inputs(Family::Current, grid, now, deadline),
                    self.grid_inputs(Family::Shortest, grid, now, deadline),
                    self.grid_inputs(Family::Short, grid, now, deadline),
                    self.rss_answer(grid, now, deadline),
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
                deadline
            ),
        );
        let zones = zones?;
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
        // The mid regions the chain asks for (`getAllDataFromDb`, `getMid`).
        let mut mids = HashMap::new();
        if let Ok(row) = region_code(&region, &city) {
            let mut wanted = vec![
                (MidModel::Forecast, row.point_number.clone()),
                (MidModel::Land, land_area_code(&row.city_code)),
            ];
            let found = zones.find_by_name(&region, &city);
            let temp = match found.as_slice() {
                [one] => one
                    .get("regId")
                    .and_then(Val::as_str)
                    .map_or_else(|| row.city_code.clone(), str::to_owned),
                _ => row.city_code.clone(),
            };
            wanted.push((MidModel::Temp, temp));
            for (model, reg_id) in wanted {
                let collected = collected(model, &reg_id, &zones);
                let answer = self
                    .mid_answer(model, &reg_id, collected, now, deadline)
                    .await?;
                mids.insert((model, reg_id), answer);
            }
        }
        let special = self
            .warnings
            .zone_state(now as i64, deadline)
            .await
            .map_err(|e| format!("warning zone state unavailable: {}", e.message()))?;
        // S15b-3b: the life inputs are loaded (and their owned acquisitions started) only for a
        // request the snapshot will serve; a forwarded request starts none.
        let life = self.life.load(now, deadline).await;
        let summary = match (settled, ids) {
            (true, Some(ids)) => {
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
    let Some(p) = partition_publication(&f.partition) else {
        return;
    };
    let slot_pub = match family {
        Family::Shortest => schedule::Family::Shortest.request_publication(p),
        _ => p,
    };
    let compact = slot_pub.compact();
    let slot = Slot::new(&compact[..8], &compact[8..]);
    let Some(list) = items(&f.page_refs()) else {
        return;
    };
    if let Organized::Rows(rows) = collect(family, &list, &slot, coord) {
        docs.save(family, rows);
    }
}
/// The S16 input identity of one grid acquisition: its publication through the last hour it
/// can write (current: the slot; ultra-short: six hours; short: four days).
fn grid_input_id(family: Family, kind: &str, f: &Fetched) -> Option<InputId> {
    let p = partition_publication(&f.partition)?;
    let start = schedule::to_ms(p);
    let horizon = match family {
        Family::Current => 0.,
        Family::Shortest => 6. * HOUR_MS,
        Family::Short => 4. * DAY_MS,
    };
    Some(InputId {
        family: kind.to_owned(),
        start_ms: start,
        end_ms: start + horizon as i64,
        fetched_at_ms: f.fetched_at_ms,
        content_sha256: identity(f).2,
    })
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
    let u: Vec<u16> = city_code.encode_utf16().collect();
    let head = |n: usize| String::from_utf16_lossy(&u[..n.min(u.len())]);
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
    special: Arc<ZoneState>,
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
    /// is gone, issue #2742), so `kaq` is the legacy rejection [`crate::domestic::kma::NO_KAQ_FORECAST`].
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
        Ok(list(&special_zone_docs(&self.special, area_codes)))
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(self.now)
    }
    fn summary_inputs(&self) -> Option<GridInputs> {
        self.summary.clone()
    }
}
