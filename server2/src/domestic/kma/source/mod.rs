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
mod doc;
mod grid;
pub mod asos;
pub mod html;
pub mod observe;
mod items;
mod mid;
pub mod pages;
pub mod stations;
pub mod stn;
mod records;
mod reference;
mod rss;
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
fn history_months(now: f64) -> Vec<u32> {
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
}
impl<T: IndexListing + Clone + 'static> S3Source<T> {
    pub fn new(transport: T, clock: Clock) -> Result<Self, crate::storage::Error> {
        let limits = CatalogLimits::default();
        let store = Arc::new(CatalogStore::new(transport.clone(), limits.clone())?);
        let warnings = WarningStore::new(transport.clone(), limits, StoreConfig::default())?;
        Ok(Self {
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
        let fetched = self
            .reader
            .all(sf.source(), sf.kind(), &key, &wanted, deadline)
            .await
            .map_err(|e| format!("{} read: {e}", sf.kind()))?;
        if !present(&fetched, &latest.partition(), now) {
            return Err(format!(
                "{} {} not in S3 (S15b-4 acquires the latest publication)",
                sf.kind(),
                latest.partition()
            ));
        }
        Ok(grid_documents(family, coord, &fetched, now))
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
        let zones = self.zones(now, deadline).await?;
        let (current, shortest, short, rss) = tokio::join!(
            self.grid_answer(Family::Current, grid, now, deadline),
            self.grid_answer(Family::Shortest, grid, now, deadline),
            self.grid_answer(Family::Short, grid, now, deadline),
            self.rss_answer(grid, now, deadline),
        );
        let mut models = HashMap::new();
        models.insert(TownModel::Current, current?);
        models.insert(TownModel::Shortest, shortest?);
        models.insert(TownModel::Short, short?);
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
        Ok(Snapshot {
            now,
            town,
            coord,
            models,
            mids,
            zones,
            special,
        })
    }
}
impl<T: IndexListing + Clone + 'static> KmaSource for S3Source<T> {
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
    now: f64,
    town: Doc,
    coord: Coord,
    models: HashMap<TownModel, Vec<Doc>>,
    mids: HashMap<(MidModel, String), Vec<Doc>>,
    zones: Arc<Zones>,
    special: Arc<ZoneState>,
}
fn list(docs: &[Doc]) -> OrderedJson {
    OrderedJson::Array(docs.iter().map(Doc::json).collect())
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
}
fn not_sourced(method: &str, slice: &str) -> ! {
    unavailable(format!("{method} is not sourced yet ({slice})"))
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
    fn stn_hourly_and_min_rns(&self, _: &Value, _: &str, _: &Value) -> StoreResult {
        not_sourced("stn_hourly_and_min_rns", "S15b-2")
    }
    fn city_hourly(&self, _: &Value) -> StoreResult {
        not_sourced("city_hourly", "S15b-2")
    }
    fn area_no(&self, _: &str, _: &str, _: &str) -> StoreResult {
        not_sourced("area_no", "S15b-3")
    }
    fn area_no_near(&self, _: &Value) -> StoreResult {
        not_sourced("area_no_near", "S15b-3")
    }
    fn life_index(&self, _: f64) -> StoreResult {
        not_sourced("life_index", "S15b-3")
    }
    fn food_poisoning(&self, _: &str, _: &str, _: &str, _: &str) -> StoreResult {
        not_sourced("food_poisoning", "S15b-3")
    }
    fn arpltn(&self, _: &Value, _: f64) -> StoreResult {
        not_sourced("arpltn", "S15b-3")
    }
    fn dust_forecast(&self, _: &str, _: &str, _: &str) -> StoreResult {
        not_sourced("dust_forecast", "S15b-3")
    }
    fn air_fallback(&self, _: &Value, _: f64) -> StoreResult {
        not_sourced("air_fallback", "S15b-3")
    }
    fn air_forecast(&self, _: &str, _: &Value) -> StoreResult {
        not_sourced("air_forecast", "S15b-3")
    }
    fn rise_set(&self, _: &Value, _: &[String]) -> StoreResult {
        not_sourced("rise_set", "S15b-3")
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        Ok(list(&special_zone_docs(&self.special, area_codes)))
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(self.now)
    }
}
