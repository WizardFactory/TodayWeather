//! AK approved ASOS-primary history: new measured numbers, unchanged wire cadence.
use super::support::*;
use serde_json::{Value, json};
use server2::domestic::asos::AsosKind;
use server2::domestic::kma::source::asos::AsosFetched;
use server2::domestic::kma::{
    DbVersion, KmaStore, MidModel, Outcome, StoreResult, TownModel, assemble,
};
use server2::gateway::OrderedJson;
use std::{collections::BTreeSet, sync::Arc};

fn history() -> OrderedJson {
    history_at("108")
}

/// ASOS hourly and daily records of `station` for September 17..23.
fn history_at(station: &str) -> OrderedJson {
    history_records(station, Some("asos-primary-v1"))
}

/// The ASOS records of `station` under `policy` (None: the legacy history read, which only fills
/// invalid fields).
fn history_records(station: &str, policy: Option<&str>) -> OrderedJson {
    let mut hourly = Vec::new();
    let mut daily = Vec::new();
    for day in 17..=23 {
        for hour in 0..24 {
            hourly.push(
                json!({"source":"KMA_ASOS","kind":"hourly","timeBasis":"UTC",
                "stationId":station,"key":format!("202609{day:02}{hour:02}00"),
                "values":{"t1h":17,"reh":60,"sky":4,"pty":1,"rn1":0.5,"wsd":2,"vec":180}}),
            );
        }
        daily.push(json!({"source":"KMA_ASOS","kind":"daily","timeBasis":"UTC",
            "stationId":station,"key":format!("202609{day:02}"),
            "values":{"taMin":7,"taMax":27,"t1d":17,"rn1":12,"reh":60,"wsd":2}}));
    }
    let mut data =
        json!({"startDate":"20260917","endDate":"20260923","hourly":hourly,"daily":daily});
    if let Some(policy) = policy {
        data["policy"] = json!(policy);
    }
    OrderedJson::parse(&serde_json::to_vec(&data).unwrap()).unwrap()
}

fn assembled(injected: bool) -> Value {
    assembled_with(injected.then(history))
}

fn assembled_with(history: Option<OrderedJson>) -> Value {
    assembled_scenario("domestic-v000903", history)
}

/// A recorded scenario at its clock, ASOS-primary when `history` is injected.
fn assembled_scenario(id: &str, history: Option<OrderedJson>) -> Value {
    let sc = scenario(id);
    let store = replay(sc);
    let store = match history {
        Some(history) => store.with_history(history),
        None => store,
    };
    assembled_from(sc, &store)
}

fn assembled_from(sc: &Value, store: &dyn KmaStore) -> Value {
    let out = assemble(
        &request(sc),
        store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    );
    let Outcome::Json(body) = out else {
        panic!("assembly failed: {out:?}")
    };
    serde_json::from_slice(&body.to_bytes()).unwrap()
}

/// The body legacy answered when the scenario was recorded.
fn recorded_body(id: &str) -> Value {
    serde_json::from_str(scenario(id)["body"].as_str().unwrap()).unwrap()
}

fn short_row<'a>(body: &'a Value, date: &str, time: u32) -> &'a Value {
    body["short"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["date"] == date && r["time"] == time)
        .unwrap_or_else(|| panic!("{date} {time} slot"))
}

/// The replay store of a recording with the documents of some grid collections changed. The
/// recording still answers every call first, so the assembly's calls and arguments stay checked.
struct Patched {
    inner: RecordedStore,
    town_model: fn(TownModel, OrderedJson) -> OrderedJson,
}
impl KmaStore for Patched {
    fn db_version(&self) -> DbVersion {
        self.inner.db_version()
    }
    fn towns(&self) -> StoreResult {
        self.inner.towns()
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.inner.town(a, b, c)
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        self.inner.region_code(region, city)
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        self.inner
            .town_model(model, mx, my)
            .map(|docs| (self.town_model)(model, docs))
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        self.inner.mid_model(model, reg_id)
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        self.inner.forecast_zone(region, city)
    }
    fn stn_hourly_and_min_rns(
        &self,
        town: &Value,
        date_time: &str,
        current: &Value,
    ) -> StoreResult {
        self.inner.stn_hourly_and_min_rns(town, date_time, current)
    }
    fn city_hourly(&self, town: &Value) -> StoreResult {
        self.inner.city_hourly(town)
    }
    fn history(&self, town: &Value) -> StoreResult {
        self.inner.history(town)
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.inner.area_no(a, b, c)
    }
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        self.inner.area_no_near(lon_lat)
    }
    fn life_index(&self, area_no: f64) -> StoreResult {
        self.inner.life_index(area_no)
    }
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        self.inner.food_poisoning(sd, sgg, start, end)
    }
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
        self.inner.arpltn(town, now_ms)
    }
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        self.inner.dust_forecast(region, city, date)
    }
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
        self.inner.air_fallback(g_coord, now_ms)
    }
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        self.inner.air_forecast(source, station)
    }
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        self.inner.rise_set(geocode, dates)
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        self.inner.special_zones(area_codes)
    }
    fn as_of_ms(&self) -> Option<f64> {
        self.inner.as_of_ms()
    }
    fn unconsumed(&self) -> Option<String> {
        self.inner.unconsumed()
    }
}
/// The documents of `docs` (a DB 2.0 grid collection) except those `drop` selects by the
/// `(date, time)` of their `data_key` row.
fn without(docs: OrderedJson, data_key: &str, drop: fn(&str, &str) -> bool) -> OrderedJson {
    let OrderedJson::Array(docs) = docs else {
        panic!("a grid collection is an array")
    };
    let at = |doc: &OrderedJson, key: &str| {
        doc.get(data_key)
            .and_then(|row| row.get(key))
            .and_then(OrderedJson::string)
            .unwrap_or_default()
    };
    OrderedJson::Array(
        docs.into_iter()
            .filter(|doc| !drop(&at(doc, "date"), &at(doc, "time")))
            .collect(),
    )
}

/// AK 2026-11-07 (client validation): the three-hour row of the current time (label <= now <
/// label + 3 h) keeps the forecast of the newest publication covering it, with the observed
/// fields merged over it as legacy `_mergeShortWithCurrent` does; it is not a past row. The
/// recording's clock is 09:10 KST, so the 09:00 row is current and legacy answered it.
#[test]
fn the_current_row_keeps_its_forecast_under_asos_primary() {
    let legacy = recorded_body("domestic-v000903");
    let body = assembled(true);
    let (now, was) = (
        short_row(&body, "20260924", 9),
        short_row(&legacy, "20260924", 9),
    );
    for field in ["pop", "wav", "s06", "s06Hours", "r06", "r06Hours"] {
        assert_eq!(now[field], was[field], "{field}: {now}");
    }
    assert_eq!(now["pop"], 20, "the 0500 publication's probability: {now}");
    assert_eq!(now["wav"], 0.8, "{now}");
}

/// The row the client shows as current keeps its forecast too. `currentIndex` follows the
/// observation's time: at 09:10 the recording's station reading is from 08:50, so the 06:00 row
/// is marked, as legacy marked it, although its interval has passed by the clock. Its forecast
/// holds `1mm 미만` rain and `5.0cm 이상` snow; the rows before it stay past.
#[test]
fn the_row_marked_current_keeps_its_forecast_when_the_observation_lags() {
    let legacy = recorded_body("rain-categories");
    let body = assembled_scenario("rain-categories", Some(history()));
    let (shown, was) = (
        short_row(&body, "20260924", 6),
        short_row(&legacy, "20260924", 6),
    );
    assert_eq!(was["currentIndex"], true, "legacy marks it: {was}");
    assert_eq!(shown["currentIndex"], true, "{shown}");
    for field in [
        "pop", "wav", "r06", "r06Hours", "r06Str", "s06", "s06Hours", "s06Str",
    ] {
        assert_eq!(shown[field], was[field], "{field}: {shown}");
    }
    let past = short_row(&body, "20260924", 3);
    assert_eq!(past["wav"], -1, "an unmarked past row stays past: {past}");
}

/// Past rows (label + 3 h <= now) keep the ASOS-primary rule, and no forecast precipitation
/// total stays behind the cleared amounts: the hidden total kept the forecast's text beside the
/// measured amount and turned the cleared -1 into -10 snow. The recording forecasts
/// `30.0~50.0mm` rain for 2026-09-23 06:00 and `5.0cm 이상` snow for 09:00 (ASOS-filled), and
/// nothing for 2026-09-24 03:00 (grid-observed).
#[test]
fn a_past_row_keeps_no_forecast_total_behind_its_cleared_amounts() {
    let legacy = recorded_body("rain-categories");
    assert_eq!(short_row(&legacy, "20260923", 6)["r06Str"], "30~50mm");
    assert_eq!(short_row(&legacy, "20260923", 9)["s06Str"], "5~?cm");
    let body = assembled_scenario("rain-categories", Some(history()));
    let wet = short_row(&body, "20260923", 6);
    assert_eq!(wet["r06"], 1.5, "three measured ASOS hours: {wet}");
    assert_eq!(wet["r06Str"], "1.5mm", "the measured amount's text: {wet}");
    let snowy = short_row(&body, "20260923", 9);
    assert_eq!(snowy["wav"], -1, "no past forecast value: {snowy}");
    assert_eq!(snowy["s06"], 0, "{snowy}");
    assert!(snowy.get("s06Str").is_none(), "no forecast text: {snowy}");
    let observed = short_row(&body, "20260924", 3);
    assert_eq!(observed["s06"], 0, "never -10: {observed}");
}

/// Failure path: with no publication covering the current slot the row keeps what legacy sends
/// for a missing publication (probability 0), and the request is still answered.
#[test]
fn without_a_covering_publication_the_current_row_keeps_legacys_missing_values() {
    let sc = scenario("domestic-v000903");
    let patch: fn(TownModel, OrderedJson) -> OrderedJson = |model, docs| match model {
        TownModel::Short => without(docs, "shortData", |d, t| d == "20260924" && t == "0900"),
        _ => docs,
    };
    let legacy = assembled_from(
        sc,
        &Patched {
            inner: replay(sc),
            town_model: patch,
        },
    );
    let body = assembled_from(
        sc,
        &Patched {
            inner: replay(sc).with_history(history()),
            town_model: patch,
        },
    );
    let (now, was) = (
        short_row(&body, "20260924", 9),
        short_row(&legacy, "20260924", 9),
    );
    assert_eq!(was["pop"], 0, "legacy adjustShort: {was}");
    for field in ["pop", "wav", "s06", "s06Hours"] {
        assert_eq!(now[field], was[field], "{field}: {now}");
    }
}

/// Legacy `adjustShort` sends a missing probability as 0, so "-1%" never reaches the app; past
/// ASOS rows included.
#[test]
fn a_missing_probability_reaches_the_client_as_legacy_sends_it() {
    let body = assembled(true);
    assert_eq!(short_row(&body, "20260923", 3)["pop"], 0);
    for row in body["short"].as_array().unwrap() {
        assert!(row["pop"].as_f64().unwrap() >= 0., "{row}");
    }
}

/// ASOS measures no wind components. Hours it fills without a grid observation carry legacy's
/// missing value -100 for them (`_convertSummaryTo3H`), so their past slot keeps that sentinel
/// rather than the validation template's -1; grid-observed components stay.
#[test]
fn asos_filled_hours_keep_the_missing_wind_component_value() {
    let sc = scenario("domestic-v000903");
    let patch: fn(TownModel, OrderedJson) -> OrderedJson = |model, docs| match model {
        TownModel::Current => without(docs, "currentData", |d, t| {
            d == "20260923" && ["1000", "1100", "1200"].contains(&t)
        }),
        _ => docs,
    };
    let body = assembled_from(
        sc,
        &Patched {
            inner: replay(sc).with_history(history()),
            town_model: patch,
        },
    );
    let filled = short_row(&body, "20260923", 12);
    assert_eq!(filled["t3h"], 17, "ASOS filled the slot: {filled}");
    assert_eq!(
        (filled["uuu"].clone(), filled["vvv"].clone()),
        (json!(-100), json!(-100))
    );
    let observed = short_row(&body, "20260923", 15);
    assert_eq!(
        (observed["uuu"].clone(), observed["vvv"].clone()),
        (json!(1), json!(-2))
    );
    // Legacy mode keeps legacy's own answer for the same template hours.
    let legacy = assembled_from(
        sc,
        &Patched {
            inner: replay(sc),
            town_model: patch,
        },
    );
    assert_eq!(short_row(&legacy, "20260923", 12)["uuu"], -1);
}

/// AK 2026-11-07: `current.yesterday.t1h` must be sent; the comparison rule is a last-resort
/// safeguard. The live reading of station 108 now and its ASOS hour exactly 24 h earlier come
/// from one thermometer.
#[test]
fn a_live_reading_compares_with_the_same_stations_asos_hour_a_day_earlier() {
    let body = assembled_scenario("station-first-rain", Some(history()));
    let current = &body["current"];
    assert_eq!(
        current["fieldObservations"]["t1h"]["source"],
        "KMA_STATION_LIVE"
    );
    let yesterday = &current["yesterday"];
    assert_eq!(yesterday["fieldObservations"]["t1h"]["source"], "KMA_ASOS");
    assert_eq!(yesterday["comparisonAvailable"], true, "{yesterday}");
    assert_eq!(yesterday["t1h"], 17, "{yesterday}");
}

/// Legacy mode keeps legacy's comparison safeguard: the paired replay of frozen legacy inputs
/// (`tools/shadow/replay.py --family kma-rich`) withholds a live reading against an ASOS hour.
/// Without the ASOS-primary policy ASOS only fills a missing grid hour, here 2026-09-23 09:00.
#[test]
fn legacy_mode_keeps_the_legacy_yesterday_safeguard() {
    let sc = scenario("station-first-rain");
    let patch: fn(TownModel, OrderedJson) -> OrderedJson = |model, docs| match model {
        TownModel::Current => without(docs, "currentData", |d, t| d == "20260923" && t == "0900"),
        _ => docs,
    };
    let body = assembled_from(
        sc,
        &Patched {
            inner: replay(sc).with_history(history_records("108", None)),
            town_model: patch,
        },
    );
    let current = &body["current"];
    assert_eq!(
        current["fieldObservations"]["t1h"]["source"],
        "KMA_STATION_LIVE"
    );
    let yesterday = &current["yesterday"];
    assert_eq!(
        yesterday["fieldObservations"]["t1h"]["source"], "KMA_ASOS",
        "{yesterday}"
    );
    assert_eq!(yesterday["comparisonAvailable"], false, "{yesterday}");
    assert!(yesterday.get("t1h").is_none(), "{yesterday}");
}

/// Another station's ASOS hour keeps the comparison safeguard.
#[test]
fn another_stations_asos_hour_keeps_the_comparison_safeguard() {
    let body = assembled_scenario("station-first-rain", Some(history_at("109")));
    let yesterday = &body["current"]["yesterday"];
    assert_eq!(yesterday["fieldObservations"]["t1h"]["stationId"], "109");
    assert_eq!(yesterday["comparisonAvailable"], false, "{yesterday}");
    assert!(yesterday.get("t1h").is_none(), "{yesterday}");
}

#[test]
fn asos_primary_replaces_forecast_history_and_uses_official_daily_values() {
    let body = assembled(true);
    let daily = body["midData"]["dailyData"].as_array().unwrap();
    for day in 17..=23 {
        let date = format!("202609{day:02}");
        let row = daily.iter().find(|r| r["date"] == date).unwrap();
        assert_eq!(row["tmn"], 7, "{date} min must be ASOS daily");
        assert_eq!(row["tmx"], 27, "{date} max must be ASOS daily");
        assert_eq!(row["rn1"], 12, "{date} rain must be ASOS daily");
        assert_eq!(
            row["wfAm"], "흐리고 비",
            "{date} AM must use observed cloud/PTY"
        );
        assert_eq!(
            row["wfPm"], "흐리고 비",
            "{date} PM must use observed cloud/PTY"
        );
    }
    let row = body["short"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["date"] == "20260923" && r["time"] == 3)
        .unwrap();
    assert_eq!(row["t3h"], 17);
    assert_eq!(row["rn1"], 1.5);
    assert_eq!(
        row["r06"], 1.5,
        "historical visible rain is the measured three-hour total"
    );
    assert_eq!(row["r06Hours"], 3);
    assert_eq!(row["pty"], 1);
    // The forecast total behind the cleared amount is gone (#2614 parity): the unsupported snow
    // amount finalizes like every past row without a covering publication, no amount over no
    // hours, and never inherits the forecast's amount or text.
    assert_eq!(
        (row["s06"].clone(), row["s06Hours"].clone()),
        (json!(0), json!(0)),
        "an unsupported snow amount cannot inherit the forecast: {row}"
    );
    assert!(row.get("s06Text").is_none());
    assert!(row.get("s06Str").is_none());
    assert_eq!(
        row["pop"], 0,
        "ASOS has no precipitation probability; legacy adjustShort sends a missing one as 0"
    );
}

#[test]
fn asos_primary_keeps_future_values_current_observation_and_public_cadence() {
    let old = assembled(false);
    let new = assembled(true);
    assert_eq!(new["units"], old["units"]);
    for field in ["t1h", "sky", "pty", "rn1"] {
        assert_eq!(new["current"][field], old["current"][field]);
    }
    let future = |body: &Value| {
        body["short"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["date"].as_str().unwrap() > "20260924")
            .cloned()
            .collect::<Vec<_>>()
    };
    assert_eq!(future(&new), future(&old));
    let slots = |body: &Value| {
        body["short"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["date"].clone(), r["time"].clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(slots(&new), slots(&old));
}

/// Contract kma-history v1 (precipitation-1). ASOS hourly records for September 17..23:
/// dry by default, `untyped` hours carry measured rain without a phenomenon code (no PTY, as
/// stations without phenomenon recording report it), `typed` hours carry PTY 1.
fn precipitation_history(untyped: &[&str], typed: &[&str]) -> OrderedJson {
    let mut hourly = Vec::new();
    let mut daily = Vec::new();
    for day in 17..=23 {
        for hour in 0..24 {
            let key = format!("202609{day:02}{hour:02}00");
            let values = if untyped.contains(&key.as_str()) {
                json!({"t1h":17,"reh":60,"sky":4,"rn1":0.5,"wsd":2,"vec":180})
            } else if typed.contains(&key.as_str()) {
                json!({"t1h":17,"reh":60,"sky":4,"pty":1,"rn1":1.0,"wsd":2,"vec":180})
            } else {
                json!({"t1h":17,"reh":60,"sky":4,"pty":0,"rn1":0,"wsd":2,"vec":180})
            };
            hourly.push(
                json!({"source":"KMA_ASOS","kind":"hourly","timeBasis":"UTC",
                "stationId":"108","key":key,"values":values}),
            );
        }
        daily.push(json!({"source":"KMA_ASOS","kind":"daily","timeBasis":"UTC",
            "stationId":"108","key":format!("202609{day:02}"),
            "values":{"taMin":7,"taMax":27,"t1d":17,"rn1":12,"reh":60,"wsd":2}}));
    }
    OrderedJson::parse(
        &serde_json::to_vec(&json!({"policy":"asos-primary-v1",
        "startDate":"20260917","endDate":"20260923","hourly":hourly,"daily":daily}))
        .unwrap(),
    )
    .unwrap()
}

fn day<'a>(body: &'a Value, date: &str) -> &'a Value {
    body["midData"]["dailyData"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["date"] == date)
        .unwrap_or_else(|| panic!("{date} must stay in dailyData"))
}

fn missing_dates(body: &Value) -> Vec<String> {
    body["historyStatus"]["missingDailyDates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_str().unwrap().to_string())
        .collect()
}

/// I1: a half with measured precipitation evidence is precipitation or missing, never dry.
fn assert_not_dry(row: &Value, half: &str) {
    let text = &row[format!("wf{half}")];
    assert!(
        text.is_null()
            || text
                .as_str()
                .is_some_and(|t| t.contains('비') || t.contains('눈')),
        "{half} with measured precipitation must not read dry: {row}"
    );
    assert_ne!(row[format!("pty{half}")], 0, "{half} PTY: {row}");
    if text.is_null() {
        assert!(
            row[format!("sky{half}")].is_null(),
            "no dry icon without a text: {row}"
        );
    }
}

#[test]
fn measured_precipitation_without_a_type_never_summarizes_as_dry() {
    let body = assembled_with(Some(precipitation_history(
        &["202609230800", "202609211200", "202609220000"],
        &["202609221500"],
    )));
    let d23 = day(&body, "20260923");
    assert_not_dry(d23, "Am");
    assert!(
        d23["wfAm"].is_null(),
        "an unknown type stays missing: {d23}"
    );
    assert_eq!(d23["wfPm"], "흐림", "a dry half keeps its text: {d23}");
    // I5: 1200 belongs to AM and 0000 to the previous day's 2400.
    let d21 = day(&body, "20260921");
    assert!(d21["wfAm"].is_null() && d21["wfPm"].is_null(), "{d21}");
    let d22 = day(&body, "20260922");
    assert_eq!(d22["wfAm"], "흐림", "0922 0000 is 0921 2400: {d22}");
    assert_eq!(
        d22["wfPm"], "흐리고 비",
        "a typed half keeps its text: {d22}"
    );
    let missing = missing_dates(&body);
    for date in ["20260921", "20260923"] {
        assert!(missing.contains(&date.to_string()), "{date} in {missing:?}");
    }
    assert!(!missing.contains(&"20260922".to_string()), "{missing:?}");
    let short = body["short"].as_array().unwrap();
    let slot = |date: &str, time: u32| {
        short
            .iter()
            .find(|r| r["date"] == date && r["time"] == time)
            .unwrap_or_else(|| panic!("{date} {time} slot"))
    };
    assert_eq!(
        slot("20260923", 9)["pty"],
        -1,
        "the 0700-0900 slot holds untyped rain"
    );
    assert_eq!(slot("20260923", 12)["pty"], 0, "a dry slot stays dry");
    assert_eq!(slot("20260922", 15)["pty"], 1, "typed rain is kept");
    assert!(
        slot("20260923", 9)["pty"].is_number(),
        "the legacy numeric sentinel, not null"
    );
    // Wire format: like legacy JSON.stringify, a guarded half omits its keys instead of sending
    // null, and the row keeps the fields the shared client and widgets read.
    let keys = d23.as_object().unwrap();
    for key in ["wfAm", "skyAm", "ptyAm"] {
        assert!(
            !keys.contains_key(key),
            "{key} is omitted, never null: {d23}"
        );
    }
    for key in [
        "date",
        "fromToday",
        "tmn",
        "tmx",
        "rn1",
        "wfPm",
        "skyPm",
        "ptyPm",
    ] {
        assert!(keys.contains_key(key), "{key} stays: {d23}");
    }
    assert!(
        d23["skyPm"].is_string(),
        "the other half keeps its icon name: {d23}"
    );
}

/// Normalize a recorded July month and re-date `first_day..first_day+6` onto September
/// 17..23; values and hours are unchanged.
fn recorded_history(station: &str, hourly: &[u8], daily: &[u8], first_day: u32) -> OrderedJson {
    let fetched = [
        (AsosKind::Hourly, hourly, "202607010000", "202607312300", 1.),
        (AsosKind::Daily, daily, "20260701", "20260731", 2.),
    ]
    .map(|(kind, body, start, end, at)| AsosFetched {
        raw_ids: Vec::new(),
        kind,
        start: start.into(),
        end: end.into(),
        fetched_at_ms: at,
        pages: vec![Arc::from(body)],
    });
    let store = server2::domestic::kma::source::asos::replay_observed(station, &fetched, &[]);
    let shift = |key: &str| -> Option<String> {
        let target = key[6..8].parse::<u32>().ok()?.checked_sub(first_day)? + 17;
        (17..=23)
            .contains(&target)
            .then(|| format!("202609{target:02}{}", &key[8..]))
    };
    let (from, to) = (format!("{first_day:02}"), format!("{:02}", first_day + 6));
    let records = |kind, start: String, end: String| -> Vec<Value> {
        store
            .read(kind, station, &start, &end)
            .iter()
            .filter_map(|doc| {
                let mut record: Value = serde_json::from_slice(&doc.json().to_bytes()).unwrap();
                let key = shift(record["key"].as_str()?)?;
                record["key"] = json!(key);
                Some(record)
            })
            .collect()
    };
    let hourly = records(
        AsosKind::Hourly,
        format!("202607{from}0000"),
        format!("202607{to}2300"),
    );
    let daily = records(
        AsosKind::Daily,
        format!("202607{from}"),
        format!("202607{to}"),
    );
    assert_eq!((hourly.len(), daily.len()), (168, 7));
    OrderedJson::parse(
        &serde_json::to_vec(&json!({"policy":"asos-primary-v1",
        "startDate":"20260917","endDate":"20260923","hourly":hourly,"daily":daily}))
        .unwrap(),
    )
    .unwrap()
}

/// (re-dated date, half) pairs whose recorded hours hold a normal-QC numeric amount.
fn measured_wet_halves(hourly: &[u8], first_day: u32) -> BTreeSet<(String, &'static str)> {
    let raw: Value = serde_json::from_slice(hourly).unwrap();
    let mut halves = BTreeSet::new();
    for item in raw["response"]["body"]["items"]["item"].as_array().unwrap() {
        let tm = item["tm"].as_str().unwrap();
        let qc = item["rnQcflg"].as_str().unwrap_or("");
        if item["rn"].as_str().unwrap_or("").is_empty() || !(qc.is_empty() || qc == "0") {
            continue;
        }
        let (mut date, mut hour) = (
            tm[8..10].parse::<u32>().unwrap(),
            tm[11..13].parse::<u32>().unwrap(),
        );
        if hour == 0 {
            (date, hour) = (date - 1, 24);
        }
        let Some(target) = date.checked_sub(first_day).map(|d| d + 17) else {
            continue;
        };
        if (17..=23).contains(&target) {
            halves.insert((
                format!("202609{target:02}"),
                if hour <= 12 { "Am" } else { "Pm" },
            ));
        }
    }
    halves
}

#[test]
fn recorded_rain_at_stations_without_phenomenon_codes_never_reads_dry() {
    for (station, hourly, daily, hourly_sha, first_day) in [
        (
            "101",
            include_bytes!("fixtures/asos-hourly-101-20260701-20260731.json").as_slice(),
            include_bytes!("fixtures/asos-daily-101-20260701-20260731.json").as_slice(),
            "6fcc6a3715a4d6f40f9558ccde2f10fc01278da32ce1e4ac719a8f3f5a54b042",
            22,
        ),
        (
            "156",
            include_bytes!("fixtures/asos-hourly-156-20260701-20260731.json").as_slice(),
            include_bytes!("fixtures/asos-daily-156-20260701-20260731.json").as_slice(),
            "0a1c5349d59c8f659c43d9557a966cec021b767075a02e3a27769a819d812666",
            13,
        ),
    ] {
        assert_eq!(
            server2::storage::sha256(hourly),
            hourly_sha,
            "{station} original"
        );
        let body = assembled_with(Some(recorded_history(station, hourly, daily, first_day)));
        let wet = measured_wet_halves(hourly, first_day);
        assert!(wet.len() >= 4, "{station}: {wet:?}");
        for (date, half) in &wet {
            assert_not_dry(day(&body, date), half);
            // R2s: July wet-bulb temperatures are far above the cutoff.
            assert_eq!(
                day(&body, date)[format!("pty{half}")],
                json!(1),
                "{station} {date} {half}"
            );
        }
    }
}

#[test]
fn a_measured_amount_beside_an_asos_dry_type_never_reads_dry() {
    // Originals of different sources can leave rn1 0.5 and PTY 0 on one hour.
    let mut hourly = Vec::new();
    let mut daily = Vec::new();
    for day in 17..=23 {
        for hour in 0..24 {
            let key = format!("202609{day:02}{hour:02}00");
            let rain = if key == "202609230800" { 0.5 } else { 0. };
            hourly.push(
                json!({"source":"KMA_ASOS","kind":"hourly","timeBasis":"UTC",
                "stationId":"108","key":key,
                "values":{"t1h":17,"reh":60,"sky":4,"pty":0,"rn1":rain,"wsd":2,"vec":180}}),
            );
        }
        daily.push(json!({"source":"KMA_ASOS","kind":"daily","timeBasis":"UTC",
            "stationId":"108","key":format!("202609{day:02}"),
            "values":{"taMin":7,"taMax":27,"t1d":17,"rn1":12,"reh":60,"wsd":2}}));
    }
    let history = OrderedJson::parse(
        &serde_json::to_vec(&json!({"policy":"asos-primary-v1",
            "startDate":"20260917","endDate":"20260923","hourly":hourly,"daily":daily}))
        .unwrap(),
    )
    .unwrap();
    let body = assembled_with(Some(history));
    let d23 = day(&body, "20260923");
    assert_not_dry(d23, "Am");
    assert!(d23["wfAm"].is_null(), "{d23}");
    assert_eq!(d23["wfPm"], "흐림", "the dry half stays: {d23}");
    assert!(missing_dates(&body).contains(&"20260923".to_string()));
}

#[test]
fn a_town_without_a_representative_station_lists_the_dates_it_omits() {
    // The #2560 contract: a day without temperatures is omitted and listed.
    let history = OrderedJson::parse(
        &serde_json::to_vec(&json!({"policy":"asos-primary-v1",
            "reason":"station-unrepresentative","hourly":[],"daily":[]}))
        .unwrap(),
    )
    .unwrap();
    let body = assembled_with(Some(history));
    let dates: BTreeSet<String> = body["midData"]["dailyData"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["date"].as_str().unwrap().to_string())
        .collect();
    let unavailable: BTreeSet<String> = body["midData"]["dailyStatus"]["unavailableDates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_str().unwrap().to_string())
        .collect();
    assert_eq!(body["historyStatus"]["reason"], "station-unrepresentative");
    for date in 17..=23 {
        let date = format!("202609{date:02}");
        assert!(
            dates.contains(&date) || unavailable.contains(&date),
            "{date} is neither served nor listed"
        );
    }
    assert!(!dates.is_empty(), "forecast days stay");
}

#[test]
fn qc9_hours_on_a_closed_dry_day_read_dry() {
    // R1b (approved 2026-10-31 after held-out validation): Daegu's dry-day QC9 block has no
    // phenomenon code, and the blank daily total closes a day without numeric hourly rain.
    let hourly = include_bytes!("fixtures/asos-hourly-143-20260701-20260731.json").as_slice();
    let daily = include_bytes!("fixtures/asos-daily-143-20260701-20260731.json").as_slice();
    assert_eq!(
        server2::storage::sha256(hourly),
        "9a49054fc3fc87ad0b44942bbe6039590d1f7be03fbaef2d02cf59fb9dae80c7"
    );
    assert_eq!(
        server2::storage::sha256(daily),
        "c3445122358d926a2d113d74909d1e39effbb9272e6902f5c9651d6c8000b625"
    );
    let fetched = [
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Hourly,
            start: "202607010000".into(),
            end: "202607312300".into(),
            fetched_at_ms: 1.,
            pages: vec![Arc::from(hourly)],
        },
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Daily,
            start: "20260701".into(),
            end: "20260731".into(),
            fetched_at_ms: 2.,
            pages: vec![Arc::from(daily)],
        },
    ];
    let store = server2::domestic::kma::source::asos::replay_observed("143", &fetched, &[]);
    let rows = store.read(AsosKind::Hourly, "143", "202607250200", "202607250800");
    assert_eq!(rows.len(), 7);
    for row in rows {
        let values = row.get("inferred").and_then(|v| v.as_doc()).unwrap();
        let num = |f: &str| values.get(f).and_then(|v| v.as_num());
        assert_eq!(
            (num("rn1"), num("pty")),
            (Some(0.), Some(0.)),
            "{:?}",
            row.get("key")
        );
    }
}

#[test]
fn observed_summary_identity_carries_the_contract_policy_version() {
    let contract: Value =
        serde_json::from_str(include_str!("../../config/contracts/kma-history.v1.json")).unwrap();
    let version = contract["aggregation_policy_version"].as_str().unwrap();
    assert!(
        server2::domestic::kma::source::OBSERVED_HISTORY_POLICY.ends_with(version),
        "stored observed summaries must not be reused across aggregation rules"
    );
    for edge in contract["edges"].as_array().unwrap() {
        if edge["approval"] == "approved" {
            let source = &contract["sources"][edge["source"].as_str().unwrap()];
            assert!(
                source.is_null() || source["history_allowed"] == true,
                "{edge}"
            );
        }
    }
}
