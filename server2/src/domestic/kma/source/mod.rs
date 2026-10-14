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
mod items;
mod mid;
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
use std::sync::{Arc, Mutex};
use tokio::time::Instant;

const DAY_MS: f64 = 86_400_000.;
/// Days of captured grid and RSS publications read (the 216-hour retention plus the horizon of
/// a short forecast that may still own a retained slot).
const GRID_DAYS: f64 = 10.;
/// Days of mid publications read (the newest parsable publication is kept).
const MID_DAYS: f64 = 3.;
/// Forecast-zone lists read (KST months back from now).
const ZONE_DAYS: f64 = 62.;
/// Memory lifetime of the folded forecast-zone list.
const ZONE_REFRESH: std::time::Duration = std::time::Duration::from_secs(600);

/// The S3 source. `T` is the process S3 transport behind the shared admission.
pub struct S3Source<T> {
    reader: Reader<T>,
    warnings: Arc<WarningService<T>>,
    clock: Clock,
    zones: Mutex<Option<(std::time::Instant, Arc<Zones>)>>,
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
            zones: Mutex::new(None),
        })
    }
    async fn zone_state(&self, now: f64, deadline: Instant) -> Result<Arc<Zones>, String> {
        if let Some((at, zones)) = self
            .zones
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            && at.elapsed() < ZONE_REFRESH
        {
            return Ok(zones.clone());
        }
        let key = ProviderKey::Named {
            id: "forecast-zones".into(),
        };
        let months = records::months(now - ZONE_DAYS * DAY_MS, now);
        let parts = self
            .reader
            .partitions("data-go-kr", "forecast-zone", &key, &months, deadline)
            .await
            .map_err(|e| format!("forecast-zone listing: {e}"))?;
        let fetched = self
            .reader
            .all("data-go-kr", "forecast-zone", &key, &parts, deadline)
            .await
            .map_err(|e| format!("forecast-zone read: {e}"))?;
        let zones = Arc::new(
            zone_documents(&fetched, now)
                .ok_or("no complete forecast-zone list in S3 (S15b-4 acquires it)")?,
        );
        *self.zones.lock().unwrap_or_else(|e| e.into_inner()) =
            Some((std::time::Instant::now(), zones.clone()));
        Ok(zones)
    }
    /// The grid documents of one family at `now`; Err when the latest publication is absent.
    async fn grid(
        &self,
        family: Family,
        grid: crate::history::Grid,
        coord: Coord,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        let sf = match family {
            Family::Current => schedule::Family::Current,
            Family::Shortest => schedule::Family::Shortest,
            Family::Short => schedule::Family::Short,
        };
        let key = grid.provider_key();
        let months = records::months(now - GRID_DAYS * DAY_MS, now);
        let parts = self
            .reader
            .partitions(sf.source(), sf.kind(), &key, &months, deadline)
            .await
            .map_err(|e| format!("{} listing: {e}", sf.kind()))?;
        let oldest = schedule::from_ms((now - GRID_DAYS * DAY_MS) as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let latest = sf
            .latest(now as i64)
            .ok_or("clock outside the publication calendar")?;
        if !wanted.contains(&latest.partition()) {
            return Err(format!(
                "{} {} not in S3 (S15b-4 acquires the latest publication)",
                sf.kind(),
                latest.partition()
            ));
        }
        let fetched = self
            .reader
            .all(sf.source(), sf.kind(), &key, &wanted, deadline)
            .await
            .map_err(|e| format!("{} read: {e}", sf.kind()))?;
        Ok(grid_documents(family, coord, &fetched, now))
    }
    async fn rss(
        &self,
        grid: crate::history::Grid,
        coord: Coord,
        now: f64,
        deadline: Instant,
    ) -> Result<Vec<Doc>, String> {
        let key = grid.provider_key();
        let months = records::months(now - GRID_DAYS * DAY_MS, now);
        let parts = self
            .reader
            .partitions("kma-web", "town-rss", &key, &months, deadline)
            .await
            .map_err(|e| format!("town-rss listing: {e}"))?;
        let latest = publication::rss_latest(now as i64).ok_or("clock")?;
        if !parts.contains(&latest.partition()) {
            return Err(format!(
                "town-rss {} not in S3 (S15b-4 acquires the latest publication)",
                latest.partition()
            ));
        }
        let oldest = schedule::from_ms((now - GRID_DAYS * DAY_MS) as i64).partition();
        let wanted: Vec<String> = parts.into_iter().filter(|p| *p >= oldest).collect();
        let fetched = self
            .reader
            .all("kma-web", "town-rss", &key, &wanted, deadline)
            .await
            .map_err(|e| format!("town-rss read: {e}"))?;
        Ok(rss_documents(coord, &fetched, now))
    }
    async fn mid(
        &self,
        model: MidModel,
        reg_id: &str,
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
        let months = records::months(now - MID_DAYS * DAY_MS, now);
        let parts = self
            .reader
            .partitions("data-go-kr", kind, &key, &months, deadline)
            .await
            .map_err(|e| format!("{kind} listing: {e}"))?;
        let latest = publication::mid_tm_fc(now as i64).ok_or("clock")?;
        if !parts.contains(&latest.partition()) {
            return Err(format!(
                "{kind} {reg_id} {} not in S3 (S15b-4 acquires the latest publication)",
                latest.partition()
            ));
        }
        let fetched = self
            .reader
            .all("data-go-kr", kind, &key, &parts, deadline)
            .await
            .map_err(|e| format!("{kind} read: {e}"))?;
        Ok(mid_documents(model, reg_id, &fetched, now))
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
        let zones = self.zone_state(now, deadline).await?;
        let (current, shortest, short, rss) = tokio::join!(
            self.grid(Family::Current, grid, coord, now, deadline),
            self.grid(Family::Shortest, grid, coord, now, deadline),
            self.grid(Family::Short, grid, coord, now, deadline),
            self.rss(grid, coord, now, deadline),
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
                let answer = if collected(model, &reg_id, &zones) {
                    self.mid(model, &reg_id, now, deadline).await?
                } else {
                    Vec::new()
                };
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
/// Whether legacy collects this mid region (`listPointNumber`, `listAreaCode`,
/// `findMidTempZones`); an uncollected region has no document.
fn collected(model: MidModel, reg_id: &str, zones: &Zones) -> bool {
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
