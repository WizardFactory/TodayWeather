//! S15: native assembly of the used v000903 KMA response (`/v000903/kma/addr/...`).
//!
//! The port runs the legacy router list of `routes/v000903/route.kma.v000903.js` in order over
//! the legacy store-read boundary: [`KmaStore`] answers each dependency call a legacy controller
//! makes (rows, station observations, air, life index, rise/set, warnings) with the value that
//! controller receives. Building those answers from S3 raw records (S13/S13a/S14) is a separate
//! source; nothing here calls a provider or reads legacy files.
//!
//! Legacy deployment facts preserved: process clock zone UTC, ASOS history reads as the store
//! supplies them ([`KmaStore::history`]: null is legacy `config.history.readEnabled` unset; the
//! S15b-2 S3 source reads them, AK 2026-10-14), `manager.MAX_CURRENT_COUNT` 192 (the S02 oracle harness
//! stubs 200; see [`AssemblyConfig`]), AirKorea dust-forecast and station-list collection not
//! ported (their store reads return whatever a source supplies).
mod air;
pub mod backend;
mod chain;
mod data;
pub mod js;
mod mid;
mod policy;
pub(crate) mod precip;
mod present;
mod short;
pub mod source;
mod time;

use crate::gateway::OrderedJson;
use crate::world::i18n::Locale;
use js::V;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

/// A store dependency failure (the legacy callback `err`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
/// Results keep JavaScript property order (`OrderedJson`); Dates are `{"$date": ms}`.
pub type StoreResult = Result<OrderedJson, StoreError>;

/// Legacy `config.db.version`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbVersion {
    V1,
    V2,
}
/// Town forecast collections (`townArray`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TownModel {
    Short,
    Current,
    Shortest,
    ShortRss,
}
impl TownModel {
    /// The `req[...]` cache name used by the legacy readers.
    pub fn req_name(self) -> &'static str {
        match self {
            Self::Short => "modelShort",
            Self::Current => "modelCurrent",
            Self::Shortest => "modelShortest",
            Self::ShortRss => "modelShortRss",
        }
    }
}
/// Medium-range collections (`midArray`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MidModel {
    Forecast,
    Land,
    Temp,
}
impl MidModel {
    pub fn req_name(self) -> &'static str {
        match self {
            Self::Forecast => "modelMidForecast",
            Self::Land => "modelMidLand",
            Self::Temp => "modelMidTemp",
        }
    }
}

/// The error legacy `KaqHourlyForecastController.getForecast` rejects with when no KAQ map case
/// exists, that is, when there is no KAQ forecast at all (L239).
pub const NO_KAQ_FORECAST: &str = "Fail to get map case";
/// One synchronous method per legacy dependency call of the v000903 chain. Values are the
/// legacy results as JSON with Dates as `{"$date": ms}`; `Err` is the callback error.
/// Implementations must answer from a snapshot already in memory. A snapshot that cannot answer
/// a call faithfully (the input is absent, not merely an error legacy would receive) calls
/// [`unavailable`], which forwards the request to legacy.
///
/// Except for the town list (`towns`, cached by the long-lived legacy controller), every method
/// is a legacy asynchronous read: the assembly treats each answer as an asynchronous callback, so
/// an exception thrown after it is not caught by a `try` entered before the read.
pub trait KmaStore {
    fn db_version(&self) -> DbVersion;
    /// `dbTown.find({})` (the `_findTown` list).
    fn towns(&self) -> StoreResult;
    /// `dbTown.find({town.first, town.second, town.third}).limit(1)`.
    fn town(&self, first: &str, second: &str, third: &str) -> StoreResult;
    /// `manager.getRegIdByTown(region, city)`.
    fn region_code(&self, region: &str, city: &str) -> StoreResult;
    /// DB 2.0: every `kma.town.*` document of the grid sorted by `fcsDate`; DB 1.0: the
    /// `model*` documents of the grid (`limit(1)` applied by the caller).
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult;
    /// DB 2.0: documents of `regId` sorted by `pubDate` descending; DB 1.0: the model documents.
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult;
    /// `KmaForecastZoneCode.findForecastZoneByName(region, city).exec`.
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult;
    /// `controllerKmaStnWeather.getStnHourlyAndMinRns(town, dateTime, current)`.
    fn stn_hourly_and_min_rns(&self, town: &Value, date_time: &str, current: &Value)
    -> StoreResult;
    /// `controllerKmaStnWeather.getCityHourlyList(town)`.
    fn city_hourly(&self, town: &Value) -> StoreResult;
    /// `history.loadForTown(town)` (legacy `lib/history/service.js`): `{mapping, hourly, daily,
    /// reason}` with ASOS records, or null when ASOS history reads are disabled (the legacy
    /// deployment default, and every store that does not source them).
    fn history(&self, _town: &Value) -> StoreResult {
        Ok(OrderedJson::Null)
    }
    /// `modelAreaNo.find({town.first, town.second, town.third}).limit(1)`.
    fn area_no(&self, first: &str, second: &str, third: &str) -> StoreResult;
    /// `modelAreaNo.find({geo: {$near: [lon, lat], $maxDistance: 0.3}}).limit(3)`.
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult;
    /// `kma.lifeindex.model.find({areaNo})`.
    fn life_index(&self, area_no: f64) -> StoreResult;
    /// `modelFoodPoisoning.find({sd, sgg: {$in: [sgg, '']}, date: {$gte, $lte}})`.
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult;
    /// `KecoController.getArpLtnInfo(town, now)`: `{arpltn, list, stnList}` or null.
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult;
    /// `KecoController.getDustFrcst({region, city}, date)` (stored forecasts only).
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult;
    /// `AirFallback.getArpltn(gCoord, now)`: an observation or null (no provider is called here).
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult;
    /// KAQ (`kaq`) or AirKorea (`airkorea`) hourly forecast rows of a station. A store without
    /// any KAQ forecast answers `kaq` with the error [`NO_KAQ_FORECAST`]; a `kaq` request then
    /// reads `airkorea` (legacy #2771, as for KAQ rows without a usable future row).
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult;
    /// `kasiRiseSet.getRiseSetList(geocode, dates)`.
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult;
    /// `KmaSpecialWeatherZone.find({active: true, warnVar > 0, areaCode in codes})`.
    fn special_zones(&self, area_codes: &[String]) -> StoreResult;
    /// The request instant a snapshot was taken for (`Date.now()`); None uses the backend clock.
    fn as_of_ms(&self) -> Option<f64> {
        None
    }
    /// After a reply: why the snapshot's inputs were not fully used (a replayed recording), or
    /// None. A reply built without inputs the snapshot holds is forwarded to legacy.
    fn unconsumed(&self) -> Option<String> {
        None
    }
}
/// The store cannot answer a call from its snapshot: end the assembly and forward to legacy.
/// It passes every legacy `catch` (see [`js::forward`]).
pub fn unavailable(reason: impl Into<String>) -> ! {
    js::forward(reason)
}

/// Legacy process parameters that differ between the deployed service and the S02 harness.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AssemblyConfig {
    /// `manager.MAX_CURRENT_COUNT`: 192 in `controllerManager.js`; the S02 harness stubs 200.
    pub max_current_count: usize,
}
impl Default for AssemblyConfig {
    fn default() -> Self {
        Self {
            max_current_count: 192,
        }
    }
}

/// An address request (`/v000901/kma/addr`, `/v000902/kma/addr`, `/v000903/kma/addr`) or a
/// town request (`/v000803/town`, `/v000705/town`, S17b) after Express routing.
#[derive(Debug, Clone)]
pub struct KmaRequest {
    /// First path segment of the mount (`req.baseUrl`), e.g. `v000903`; it selects the router
    /// list (S17a).
    pub version: String,
    /// `req.baseUrl` as requested (Express matches mounts case-insensitively), e.g.
    /// `/v000903/kma`, `/v000901/kma/addr`, `/v000803/town`.
    pub mount: String,
    /// The v000705 town sub-route (`mid`, `short`, `shortest`, `current`), else None.
    pub part: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub town: Option<String>,
    /// The raw request path and query (`req.originalUrl`).
    pub original_url: String,
    /// Decoded query pairs in order (Express `qs`: the first 1,000 raw fields, no bracket syntax).
    pub query: Vec<(String, String)>,
    pub locale: Locale,
}
/// Result of one assembly.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// `res.json(body)` with status 200.
    Json(OrderedJson),
    /// `res.json(undefined)` (v000705 town, which has no `makeResult`): status 200,
    /// `Content-Type: application/json`, an empty body and no ETag.
    Undefined,
    /// A legacy non-JSON reply (`res.status(code).send(text)`).
    Status(u16, String),
    /// Legacy would leave the assembly path (redirect, geocoding a new town, a remote remap or
    /// an unhandled exception). Forward the request to legacy.
    Legacy(String),
}

/// The v000903 router list in legacy order.
pub fn middleware() -> Vec<&'static str> {
    chain::names("v000903", None)
}
/// The router list of an address version (`v000901`, `v000902`, `v000903`) or a town version
/// (`v000803`, `v000705` and its sub-routes) in legacy order; empty for any other route.
pub fn middleware_of(version: &str, part: Option<&str>) -> Vec<&'static str> {
    chain::names(version, part)
}
/// Assemble one request. `now_ms` is the request instant (`Date.now()`).
pub fn assemble(
    request: &KmaRequest,
    store: &dyn KmaStore,
    now_ms: f64,
    config: AssemblyConfig,
) -> Outcome {
    let outcome = chain::run(request, store, now_ms, config);
    match (&outcome, store.unconsumed()) {
        (Outcome::Legacy(_), _) | (_, None) => outcome,
        (_, Some(reason)) => Outcome::Legacy(reason),
    }
}

fn table() -> &'static HashMap<String, HashMap<String, String>> {
    static TABLE: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let raw: Value =
            serde_json::from_str(include_str!("locales.json")).expect("embedded KMA locale subset");
        let mut out = HashMap::new();
        if let Some(locales) = raw.get("locales").and_then(Value::as_object) {
            for (locale, entries) in locales {
                let map = entries
                    .as_object()
                    .map(|o| {
                        o.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                            .collect()
                    })
                    .unwrap_or_default();
                out.insert(locale.clone(), map);
            }
        }
        out
    })
}
/// `res.__(key)` for the KMA chain: the KMA subset, then the shared S11 subset.
pub(crate) fn tr(locale: Locale, key: &str) -> String {
    table()
        .get(locale.name())
        .and_then(|t| t.get(key))
        .cloned()
        .unwrap_or_else(|| locale.tr(key))
}
/// Convert a JavaScript value to store JSON (Dates as `{"$date": ms}`).
pub(crate) fn to_store(v: &V) -> Value {
    match v {
        V::Undef | V::Null => Value::Null,
        V::Bool(b) => Value::Bool(*b),
        V::Num(n) => serde_json::Number::from_f64(*n).map_or(Value::Null, Value::Number),
        V::Str(s) => Value::String(s.to_string()),
        V::Date(ms) => serde_json::json!({ "$date": ms }),
        V::Arr(a) => Value::Array(a.items().iter().map(to_store).collect()),
        V::Obj(o) => Value::Object(
            o.entries()
                .into_iter()
                .filter(|(_, x)| !x.is_undef())
                .map(|(k, x)| (k, to_store(&x)))
                .collect(),
        ),
    }
}

/// NationAir reuses the legacy `KecoController.recalculateValue` port (including property order).
pub fn recalculate_nation_air(
    row: &OrderedJson,
    unit: &OrderedJson,
) -> Result<OrderedJson, String> {
    js::catch(|| {
        let row = js::from_store(row);
        air::recalculate_value(&row, &js::from_ordered(unit));
        js::to_json(&row).unwrap_or(OrderedJson::Null)
    })
    .map_err(|e| e.0)
}
