//! The v000903 router list and the request context shared by its middleware.
use super::js::{Arr, Forward, Ob, Thrown, V, obj, sv, to_str};
use super::{
    AssemblyConfig, DbVersion, KmaRequest, KmaStore, MidModel, Outcome, StoreResult, TownModel,
    policy, time,
};
use crate::world::i18n::Locale;
use serde_json::Value;

/// `next()` or a final reply.
pub enum Flow {
    Next,
    Done(Outcome),
}
pub type Middleware = fn(&mut Cx) -> Flow;

pub struct Cx<'a> {
    /// The Express `req` object.
    pub req: V,
    pub locale: Locale,
    pub store: &'a dyn KmaStore,
    pub now: f64,
    pub config: AssemblyConfig,
    /// `self.dbTownList` (loaded once per controller).
    pub towns: Option<Arr>,
    /// S16: a JSON copy of the `_getDaySummaryList` rows `getPastMid` merged.
    pub past_days: Option<Vec<crate::gateway::OrderedJson>>,
}
impl Cx<'_> {
    pub fn r(&self, key: &str) -> V {
        self.req.get(key)
    }
    pub fn set(&self, key: &str, v: impl Into<V>) {
        self.req.set(key, v);
    }
    pub fn has(&self, key: &str) -> bool {
        self.req.has(key)
    }
    pub fn param(&self, key: &str) -> V {
        self.r("params").get(key)
    }
    pub fn query(&self, key: &str) -> V {
        self.r("query").get(key)
    }
    /// `manager.getWorldTime(tz)`.
    pub fn world_time(&self, tz: f64) -> String {
        time::world_time(self.now, tz)
    }
    /// `_getCurrentTimeValue(gmt)`: {date, time HH00}.
    pub fn current_time_value(&self, gmt: f64) -> (String, String) {
        let t = self.world_time(gmt);
        (t[..8].to_owned(), format!("{}00", &t[8..10]))
    }
    /// `_getShortestTimeValue(gmt)`: {date, time HH00|HH30}.
    pub fn shortest_time_value(&self, gmt: f64) -> (String, String) {
        let t = self.world_time(gmt);
        let minute: u32 = t[10..12].parse().unwrap_or(0);
        let half = if minute >= 30 { "30" } else { "00" };
        (t[..8].to_owned(), format!("{}{half}", &t[8..10]))
    }
    /// `_getTimeValue(gmt)`: {date, 3-hour slot time}.
    pub fn time_value(&self, gmt: f64) -> (String, String) {
        let t = self.world_time(gmt);
        let hhmm: u32 = t[8..12].parse().unwrap_or(0);
        let slot = match hhmm {
            0..300 => "0000",
            300..600 => "0300",
            600..900 => "0600",
            900..1200 => "0900",
            1200..1500 => "1200",
            1500..1800 => "1500",
            1800..2100 => "1800",
            _ => "2100",
        };
        (t[..8].to_owned(), slot.to_owned())
    }
    /// `_getTownInfo(region, city, town)`: the town document, or Err for the legacy error
    /// callback. A town absent from the list would be geocoded and saved by legacy: forward.
    pub fn town_info(&mut self) -> Result<V, ()> {
        let list = match &self.towns {
            Some(l) => l.clone(),
            None => {
                let raw = match self.store.towns() {
                    Ok(v) => super::js::from_store(&v),
                    Err(_) => return Err(()),
                };
                let Some(list) = raw.as_arr().cloned() else {
                    return Err(());
                };
                if list.is_empty() {
                    return Err(());
                }
                self.towns = Some(list.clone());
                list
            }
        };
        let (region, city, town) = (self.param("region"), self.param("city"), self.param("town"));
        for t in list.items() {
            let tt = t.get("town");
            if super::js::strict_eq(&tt.get("first"), &region)
                && super::js::strict_eq(&tt.get("second"), &city)
                && super::js::strict_eq(&tt.get("third"), &town)
            {
                return Ok(t);
            }
        }
        super::js::forward("town absent from the town list (legacy geocodes and saves it)")
    }
    /// `_getCoord`: (mCoord, gCoord).
    pub fn coord(&mut self) -> Result<(V, V), ()> {
        let t = self.town_info()?;
        Ok((t.get("mCoord"), t.get("gCoord")))
    }
}

/// `routes/v000903/route.kma.v000903.js`.
const CHAIN: [(&str, Middleware); 37] = [
    ("checkQueryValidation", check_query_validation),
    ("checkParamValidation", check_param_validation),
    ("getAllDataFromDb", super::data::get_all_data_from_db),
    ("getShort", super::short::get_short),
    ("getShortRss", super::short::get_short_rss),
    ("getShortest", super::short::get_shortest),
    ("getCurrent", super::short::get_current),
    (
        "updateCurrentListForValidation",
        super::short::update_current_list_for_validation,
    ),
    (
        "mergeCurrentSkyByShortest",
        super::short::merge_current_sky_by_shortest,
    ),
    (
        "mergeCurrentByStnHourly",
        super::short::merge_current_by_stn_hourly,
    ),
    (
        "getKmaStnMinuteWeather",
        super::short::get_kma_stn_minute_weather,
    ),
    ("convert0Hto24H", super::short::convert_0h_to_24h),
    (
        "mergeShortWithCurrentList",
        super::short::merge_short_with_current_list,
    ),
    ("mergeByShortest", super::short::merge_by_shortest),
    ("adjustShort", super::short::adjust_short),
    ("getMid", super::mid::get_mid),
    ("getMidRss", get_mid_rss),
    (
        "convertMidKorStrToSkyInfo",
        super::mid::convert_mid_kor_str_to_sky_info,
    ),
    ("getPastMid", super::mid::get_past_mid),
    ("mergeMidWithShort", super::mid::merge_mid_with_short),
    ("updateMidTempMaxMin", super::mid::update_mid_temp_max_min),
    ("getLifeIndexKma", super::air::get_life_index_kma),
    ("getKeco", super::air::get_keco),
    ("getAirFallback", super::air::get_air_fallback),
    ("getKecoDustForecast", super::air::get_keco_dust_forecast),
    ("getRiseSetInfo", super::air::get_rise_set_info),
    ("insertIndex", super::present::insert_index),
    ("makeAirInfoList", super::air::make_air_info_list),
    ("AirForecastList", super::air::air_forecast_list),
    (
        "insertSkyIconLowCase",
        super::present::insert_sky_icon_low_case,
    ),
    ("setYesterday", super::present::set_yesterday),
    ("getSpecialInfo", super::present::get_special_info),
    ("convertUnits", super::present::convert_units_mw),
    ("insertStrForData", super::present::insert_str_for_data),
    (
        "getSummaryAfterUnitConverter",
        super::present::get_summary_after_unit_converter,
    ),
    ("makeResult", make_result),
    ("sendResult", send_result),
];

/// Legacy middleware outside the v000903 list: the v000901/v000902 air and icon steps (S17a) and
/// the town steps (S17b).
const OLDER_STEPS: [(&str, Middleware); 5] = [
    ("makeAirInfo", super::air::make_air_info),
    ("AirForecast", super::air::air_forecast),
    ("insertSkyIcon", super::present::insert_sky_icon),
    ("getSummary", super::present::get_summary),
    ("dataToFixed", super::present::data_to_fixed),
];
/// The router-list prefix shared by every address version, up to `getKeco`.
const SHARED: usize = 23;
/// The v000901 tail after `getKeco` (`routes/v000901/route.kma.addr.js`): no air fallback or
/// warning step, one air object (`makeAirInfo`, `AirForecast`) and the `_parseSkyState` icons.
const TAIL_V000901: [&str; 12] = [
    "getKecoDustForecast",
    "getRiseSetInfo",
    "insertIndex",
    "makeAirInfo",
    "AirForecast",
    "insertSkyIcon",
    "setYesterday",
    "convertUnits",
    "insertStrForData",
    "getSummaryAfterUnitConverter",
    "makeResult",
    "sendResult",
];
/// The v000902 tail (`routes/v000902/route.kma.v000902.js`): v000901 with lower-case icons.
const TAIL_V000902: [&str; 12] = [
    "getKecoDustForecast",
    "getRiseSetInfo",
    "insertIndex",
    "makeAirInfo",
    "AirForecast",
    "insertSkyIconLowCase",
    "setYesterday",
    "convertUnits",
    "insertStrForData",
    "getSummaryAfterUnitConverter",
    "makeResult",
    "sendResult",
];
/// `routes/v000803/routeTownForecast.js` (`/:region[/:city[/:town]]`): no query defaults,
/// `getSummary` (ControllerTown) and the upper-case icons; `makeResult` without `location`.
const TOWN_V000803: [&str; 30] = [
    "checkParamValidation",
    "getAllDataFromDb",
    "getShort",
    "getShortRss",
    "getShortest",
    "getCurrent",
    "updateCurrentListForValidation",
    "mergeCurrentSkyByShortest",
    "mergeCurrentByStnHourly",
    "getKmaStnMinuteWeather",
    "convert0Hto24H",
    "mergeShortWithCurrentList",
    "mergeByShortest",
    "adjustShort",
    "getMid",
    "getMidRss",
    "convertMidKorStrToSkyInfo",
    "getPastMid",
    "mergeMidWithShort",
    "updateMidTempMaxMin",
    "getLifeIndexKma",
    "getKeco",
    "getKecoDustForecast",
    "getRiseSetInfo",
    "insertIndex",
    "insertStrForData",
    "insertSkyIcon",
    "getSummary",
    "makeResult",
    "sendResult",
];
/// `routes/v000705/routeTownForecast.js` (`/:region[/:city[/:town]]`): no `makeResult`, so
/// `sendResult` answers `res.json(undefined)`.
const TOWN_V000705: [&str; 27] = [
    "checkParamValidation",
    "getAllDataFromDb",
    "getShort",
    "getShortRss",
    "getShortest",
    "getCurrent",
    "updateCurrentListForValidation",
    "mergeCurrentByStnHourly",
    "getKmaStnMinuteWeather",
    "convert0Hto24H",
    "mergeShortWithCurrentList",
    "mergeByShortest",
    "adjustShort",
    "getMid",
    "getMidRss",
    "convertMidKorStrToSkyInfo",
    "getPastMid",
    "mergeMidWithShort",
    "getLifeIndexKma",
    "getKeco",
    "getKecoDustForecast",
    "insertIndex",
    "insertStrForData",
    "insertSkyIcon",
    "getSummary",
    "dataToFixed",
    "sendResult",
];
/// The v000705 `/:region/:city/:town/{mid,short,shortest,current}` lists.
const TOWN_V000705_MID: [&str; 13] = [
    "getMid",
    "getMidRss",
    "convertMidKorStrToSkyInfo",
    "getPastMid",
    "mergeMidWithShort",
    "getLifeIndexKma",
    "getKeco",
    "getKecoDustForecast",
    "insertIndex",
    "insertSkyIcon",
    "insertStrForData",
    "dataToFixed",
    "sendResult",
];
const TOWN_V000705_SHORT: [&str; 13] = [
    "getShort",
    "getShortRss",
    "getShortest",
    "convert0Hto24H",
    "mergeShortWithCurrentList",
    "adjustShort",
    "getLifeIndexKma",
    "getKeco",
    "insertIndex",
    "insertStrForData",
    "insertSkyIcon",
    "dataToFixed",
    "sendResult",
];
const TOWN_V000705_SHORTEST: [&str; 7] = [
    "getShortest",
    "convert0Hto24H",
    "insertIndex",
    "insertStrForData",
    "insertSkyIcon",
    "dataToFixed",
    "sendResult",
];
const TOWN_V000705_CURRENT: [&str; 13] = [
    "getCurrent",
    "updateCurrentListForValidation",
    "mergeCurrentByStnHourly",
    "getKmaStnMinuteWeather",
    "convert0Hto24H",
    "getLifeIndexKma",
    "getKeco",
    "insertIndex",
    "insertStrForData",
    "insertSkyIcon",
    "getSummary",
    "dataToFixed",
    "sendResult",
];
/// The implementation of a legacy middleware name.
fn step(name: &str) -> Option<(&'static str, Middleware)> {
    CHAIN
        .iter()
        .chain(OLDER_STEPS.iter())
        .find(|(n, _)| *n == name)
        .copied()
}
/// The legacy router list of a request: the address versions (`v000901`, `v000902`,
/// `v000903`) and the town versions (`v000803`, `v000705`, with the v000705 sub-routes in
/// `part`); None for any other route.
fn chain(version: &str, part: Option<&str>) -> Option<Vec<(&'static str, Middleware)>> {
    let names: Vec<&str> = match (version, part) {
        ("v000903", None) => return Some(CHAIN.to_vec()),
        ("v000902", None) => CHAIN[..SHARED]
            .iter()
            .map(|(n, _)| *n)
            .chain(TAIL_V000902)
            .collect(),
        ("v000901", None) => CHAIN[..SHARED]
            .iter()
            .map(|(n, _)| *n)
            .chain(TAIL_V000901)
            .collect(),
        ("v000803", None) => TOWN_V000803.to_vec(),
        ("v000705", None) => TOWN_V000705.to_vec(),
        ("v000705", Some("mid")) => TOWN_V000705_MID.to_vec(),
        ("v000705", Some("short")) => TOWN_V000705_SHORT.to_vec(),
        ("v000705", Some("shortest")) => TOWN_V000705_SHORTEST.to_vec(),
        ("v000705", Some("current")) => TOWN_V000705_CURRENT.to_vec(),
        _ => return None,
    };
    names.into_iter().map(step).collect()
}
/// S16: whether a router list reaches `getPastMid` through exactly the steps of v000903 that
/// shape its current list (`checkQueryValidation` only sets query defaults). Legacy v000901,
/// v000902 and v000803 share that prefix (`route.kma.addr.js:53`, `route.kma.v000902.js:53`,
/// `v000803/routeTownForecast.js:47`); v000705 has no ultra-short sky repair and its `/mid`
/// route no current steps, so their day rows are not the S16 grid summary.
fn summarizes(steps: &[(&'static str, Middleware)]) -> bool {
    let prefix = |list: &[(&'static str, Middleware)]| -> Option<Vec<&'static str>> {
        let at = list.iter().position(|(n, _)| *n == "getPastMid")?;
        Some(
            list[..at]
                .iter()
                .map(|(n, _)| *n)
                .filter(|n| *n != "checkQueryValidation")
                .collect(),
        )
    };
    prefix(steps).is_some_and(|p| Some(p) == prefix(&CHAIN))
}
/// Names of the router list of `version` (and a v000705 sub-route) in order (for tests and
/// diagnostics).
pub fn names(version: &str, part: Option<&str>) -> Vec<&'static str> {
    chain(version, part)
        .unwrap_or_default()
        .iter()
        .map(|(n, _)| *n)
        .collect()
}

/// The store as the chain sees it: each legacy asynchronous read answers in a callback.
struct Callbacks<'a>(&'a dyn KmaStore);
macro_rules! callback_reads {
    ($($name:ident($($arg:ident: $ty:ty),*);)*) => {
        $(fn $name(&self, $($arg: $ty),*) -> StoreResult {
            let answer = self.0.$name($($arg),*);
            super::js::async_boundary();
            answer
        })*
    };
}
impl KmaStore for Callbacks<'_> {
    fn db_version(&self) -> DbVersion {
        self.0.db_version()
    }
    /// `self.dbTownList` is loaded once per legacy process: the warm lookup is synchronous.
    fn towns(&self) -> StoreResult {
        self.0.towns()
    }
    callback_reads! {
        town(first: &str, second: &str, third: &str);
        region_code(region: &str, city: &str);
        town_model(model: TownModel, mx: &Value, my: &Value);
        mid_model(model: MidModel, reg_id: &Value);
        forecast_zone(region: &str, city: &str);
        stn_hourly_and_min_rns(town: &Value, date_time: &str, current: &Value);
        city_hourly(town: &Value);
        history(town: &Value);
        area_no(first: &str, second: &str, third: &str);
        area_no_near(lon_lat: &Value);
        life_index(area_no: f64);
        food_poisoning(sd: &str, sgg: &str, start: &str, end: &str);
        arpltn(town: &Value, now_ms: f64);
        dust_forecast(region: &str, city: &str, date: &str);
        air_fallback(g_coord: &Value, now_ms: f64);
        air_forecast(source: &str, station: &Value);
        rise_set(geocode: &Value, dates: &[String]);
        special_zones(area_codes: &[String]);
    }
    fn as_of_ms(&self) -> Option<f64> {
        self.0.as_of_ms()
    }
    fn unconsumed(&self) -> Option<String> {
        self.0.unconsumed()
    }
}

/// Run the router list; also returns the `getPastMid` day-summary rows (S16).
pub fn run_capturing(
    request: &KmaRequest,
    store: &dyn KmaStore,
    now: f64,
    config: AssemblyConfig,
) -> (Outcome, Option<Vec<crate::gateway::OrderedJson>>) {
    let store = &Callbacks(store);
    let params = Ob::new();
    if let Some(r) = &request.region {
        params.set("region", r.as_str());
    }
    if let Some(c) = &request.city {
        params.set("city", c.as_str());
    }
    if let Some(t) = &request.town {
        params.set("town", t.as_str());
    }
    let query = Ob::new();
    for (k, v) in &request.query {
        match query.get(k) {
            V::Undef if !query.has(k) => query.set(k, v.as_str()),
            V::Arr(a) => a.push(v.as_str()),
            prev => query.set(k, V::Arr(Arr::from_vec(vec![prev, V::s(v)]))),
        }
    }
    let req = obj(vec![
        ("params", V::Obj(params)),
        ("query", V::Obj(query)),
        ("baseUrl", V::from(request.mount.as_str())),
        ("originalUrl", V::from(request.original_url.as_str())),
    ]);
    let mut cx = Cx {
        req: V::Obj(req),
        locale: request.locale,
        store,
        now,
        config,
        towns: None,
        past_days: None,
    };
    let Some(steps) = chain(&request.version, request.part.as_deref()) else {
        return (
            Outcome::Legacy(format!("no native router list for {}", request.version)),
            None,
        );
    };
    let summarized = summarizes(&steps);
    for (name, step) in steps {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| step(&mut cx)));
        match result {
            Ok(Flow::Next) => (),
            Ok(Flow::Done(outcome)) => {
                return (outcome, cx.past_days.filter(|_| summarized));
            }
            Err(payload) => {
                let payload = match payload.downcast::<Forward>() {
                    Ok(f) => return (Outcome::Legacy(format!("{name}: {}", f.0)), None),
                    Err(p) => p,
                };
                match payload.downcast::<Thrown>() {
                    // Legacy Express turns an escaped exception into a 500 (or the process
                    // crashes for an async callback): never invent a reply, forward instead.
                    Ok(t) => {
                        return (Outcome::Legacy(format!("{name}: uncaught {}", t.0)), None);
                    }
                    Err(other) => std::panic::resume_unwind(other),
                }
            }
        }
    }
    (
        Outcome::Legacy("router list ended without a reply".into()),
        None,
    )
}

/// `checkQueryValidation` (ControllerTown24h).
fn check_query_validation(cx: &mut Cx) -> Flow {
    if !cx.has("query") {
        cx.set("query", V::Obj(Ob::new()));
    }
    let _ = super::js::catch(|| {
        let base = cx.r("baseUrl");
        if base.truthy() {
            let b = sv(&base);
            let version = b.split('/').nth(1).unwrap_or("").to_owned();
            cx.set("version", version.as_str());
            if !version.starts_with('v') {
                cx.req.del("version");
            }
        }
        let query = cx.r("query");
        for unit in crate::world::units::UNIT_LIST {
            if !query.has(unit) || super::js::loose_eq(&query.get(unit), &V::s("(null)")) {
                query.set(unit, crate::world::units::default_unit(unit));
            }
        }
        if !query.has("airForecastSource")
            || super::js::loose_eq(&query.get("airForecastSource"), &V::s("(null)"))
        {
            query.set("airForecastSource", "airkorea");
        }
    });
    Flow::Next
}

/// `checkParamValidation` (ControllerTown).
fn check_param_validation(cx: &mut Cx) -> Flow {
    let region = cx.param("region");
    let city = cx.param("city");
    let town = cx.param("town");
    let is = |v: &V, s: &str| super::js::loose_eq(v, &V::s(s));
    if ["중국", "일본", "미국", "하늘시"]
        .iter()
        .any(|r| is(&region, r))
    {
        return Flow::Done(Outcome::Status(400, "We didn't support this region".into()));
    }
    if is(&town, "KR") || is(&city, "KR") {
        // geo.name2address remaps through a remote geocoder.
        super::js::forward("KR region parameter remap (geo.name2address)");
    }
    if is(&town, "JP") {
        return Flow::Done(Outcome::Status(400, "We didn't support this region".into()));
    }
    Flow::Next
}

fn get_mid_rss(_cx: &mut Cx) -> Flow {
    Flow::Next
}

/// `makeResult` (ControllerTown24h).
fn make_result(cx: &mut Cx) -> Flow {
    let r = super::js::catch(|| {
        if cx.r("result").nullish() {
            cx.set("result", V::Obj(Ob::new()));
        }
        let result = cx.r("result");
        let hs = cx.r("historyStatus");
        if hs.truthy() {
            result.set("historyStatus", hs);
        }
        result.set("regionName", cx.param("region"));
        result.set("cityName", cx.param("city"));
        result.set("townName", cx.param("town"));
        for k in ["shortPubDate", "shortRssPubDate"] {
            let v = cx.r(k);
            if v.truthy() {
                result.set(k, v);
            }
        }
        let short = cx.r("short");
        if short.truthy() {
            result.set("short", V::Arr(policy::hourly_response(short.a())));
        }
        let sp = cx.r("shortestPubDate");
        if sp.truthy() {
            result.set("shortestPubDate", sp);
        }
        let shortest = cx.r("shortest");
        if shortest.truthy() {
            let pub_date = result.get("shortestPubDate");
            result.set(
                "shortest",
                V::Arr(
                    shortest
                        .a()
                        .filter(|s| super::js::strict_eq(&s.get("pubDate"), &pub_date)),
                ),
            );
        }
        let cp = cx.r("currentPubDate");
        if cp.truthy() {
            result.set("currentPubDate", cp);
        }
        let current = cx.r("current");
        if current.truthy() {
            result.set("current", current);
        }
        let mid = cx.r("midData");
        if mid.truthy() {
            result.set("midData", mid);
        }
        let ds = cx.r("dailySummary");
        if ds.truthy() {
            result.set("dailySummary", ds);
        }
        let ail = cx.r("airInfoList");
        if ail.truthy() {
            result.set("airInfoList", ail);
        } else {
            let ai = cx.r("airInfo");
            if ai.truthy() {
                result.set("airInfo", ai);
            }
        }
        result.set("source", "KMA");
        let units = Ob::new();
        for u in crate::world::units::UNIT_LIST {
            let q = cx.query(u);
            units.set(
                u,
                if q.truthy() {
                    q
                } else {
                    V::s(crate::world::units::default_unit(u))
                },
            );
        }
        result.set("units", V::Obj(units));
        let g = cx.r("gCoord");
        if g.truthy() && super::js::ge(&cx.r("version"), &V::s("v000901")) {
            let loc = obj(vec![
                (
                    "lat",
                    V::Num(super::js::parse_float(&V::from(fixed_str(
                        &g.get("lat"),
                        3,
                    )))),
                ),
                (
                    "long",
                    V::Num(super::js::parse_float(&V::from(fixed_str(
                        &g.get("lon"),
                        3,
                    )))),
                ),
            ]);
            result.set("location", V::Obj(loc));
        }
    });
    match r {
        Ok(()) => Flow::Next,
        // next(err): Express renders a 500 page.
        Err(t) => super::js::forward(format!("makeResult error {}", t.0)),
    }
}
/// `x.toFixed(d)` as a string (number receiver required).
pub fn fixed_str(v: &V, digits: usize) -> String {
    match v {
        V::Num(n) => crate::world::js::to_fixed(*n, digits),
        other => super::js::throw(format!(
            "TypeError: {}.toFixed is not a function",
            to_str(other)
        )),
    }
}

/// `sendResult`: `res.json(req.result)`.
fn send_result(cx: &mut Cx) -> Flow {
    let result = cx.r("result");
    if result.is_undef() {
        // The v000705 town list has no `makeResult`.
        return Flow::Done(Outcome::Undefined);
    }
    let body = super::js::to_json(&result).unwrap_or(crate::gateway::OrderedJson::Null);
    Flow::Done(Outcome::Json(body))
}
