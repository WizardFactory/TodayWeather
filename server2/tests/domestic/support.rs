//! Shared S15 fixtures: the pinned legacy-oracle recording and a replay store that answers each
//! dependency call with the recorded legacy answer, in the recorded order.
#![allow(dead_code)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use server2::domestic::kma::{
    AssemblyConfig, DbVersion, KmaRequest, KmaStore, MidModel, StoreError, StoreResult, TownModel,
    backend::parse_path,
};
use server2::gateway::OrderedJson;
use std::{
    io::Read,
    sync::{Mutex, OnceLock},
};

fn oracle_text() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        let gz = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/domestic/fixtures/oracle.json.gz"
        ))
        .unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_string(&mut text)
            .unwrap();
        text
    })
}
pub fn oracle() -> &'static Value {
    static ORACLE: OnceLock<Value> = OnceLock::new();
    ORACLE.get_or_init(|| serde_json::from_str(oracle_text()).unwrap())
}
/// Parse both views of the recording before a timed (gateway deadline) test runs.
pub fn warm() {
    let _ = (oracle(), ordered());
}
/// The same recording with JavaScript property order preserved (store answers).
fn ordered() -> &'static OrderedJson {
    static ORDERED: OnceLock<OrderedJson> = OnceLock::new();
    ORDERED.get_or_init(|| OrderedJson::parse(oracle_text().as_bytes()).unwrap())
}
fn ordered_results(id: &str) -> Vec<Option<OrderedJson>> {
    let Some(OrderedJson::Array(list)) = ordered().get("scenarios") else {
        panic!("scenarios");
    };
    let sc = list
        .iter()
        .find(|s| s.get("id").and_then(OrderedJson::string).as_deref() == Some(id))
        .unwrap();
    let Some(OrderedJson::Array(calls)) = sc.get("calls") else {
        panic!("calls");
    };
    calls.iter().map(|c| c.get("result").cloned()).collect()
}
pub fn scenarios() -> &'static Vec<Value> {
    oracle()["scenarios"].as_array().unwrap()
}
pub fn scenario(id: &str) -> &'static Value {
    scenarios()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap_or_else(|| panic!("scenario {id}"))
}
pub fn golden(id: &str) -> &'static Value {
    static GOLDEN: OnceLock<Value> = OnceLock::new();
    let g = GOLDEN
        .get_or_init(|| serde_json::from_str(include_str!("../golden/records.json")).unwrap());
    g["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("golden {id}"))
}
pub fn golden_body(id: &str) -> String {
    String::from_utf8(
        STANDARD
            .decode(golden(id)["body_base64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap()
}
/// `Date.parse` of the recorded ISO clock.
pub fn clock_ms(iso: &str) -> f64 {
    let ms = server2::history::legacy::parse_iso(iso).unwrap_or_else(|| panic!("clock {iso}"));
    ms as f64
}
/// The oracle harness stubs `manager.MAX_CURRENT_COUNT` as 200 (the deployed manager uses 192).
pub fn oracle_config() -> AssemblyConfig {
    AssemblyConfig {
        max_current_count: oracle()["oracle"]["max_current_count"].as_u64().unwrap() as usize,
    }
}
pub fn request(sc: &Value) -> KmaRequest {
    let mut path = format!("/v000903/kma{}", sc["path"].as_str().unwrap());
    let q = sc["query"].as_str().unwrap();
    if !q.is_empty() {
        path.push('?');
        path.push_str(q);
    }
    parse_path(&path, sc["lang"].as_str().unwrap_or("")).expect("parsable recorded path")
}

/// Numbers compare as f64 (recorded integers vs converted floats).
fn canonical(v: &Value) -> Value {
    match v {
        Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), canonical(v))).collect())
        }
        other => other.clone(),
    }
}
pub struct Replay {
    calls: Vec<Value>,
    results: Vec<Option<OrderedJson>>,
    db: DbVersion,
    next: Mutex<usize>,
    /// Calls the store received, in order (method names).
    pub seen: Mutex<Vec<String>>,
    /// The S02 harness stubs the warning controller without a store read unless zone rows exist.
    zones_recorded: bool,
}
impl Replay {
    pub fn new(sc: &Value) -> Self {
        let calls = sc["calls"].as_array().unwrap().clone();
        let zones_recorded = calls.iter().any(|c| c["m"] == "special_zones");
        Self {
            results: ordered_results(sc["id"].as_str().unwrap()),
            calls,
            db: if sc["db"] == "1.0" {
                DbVersion::V1
            } else {
                DbVersion::V2
            },
            next: Mutex::new(0),
            seen: Mutex::new(Vec::new()),
            zones_recorded,
        }
    }
    fn answer(&self, m: &str, args: Value) -> StoreResult {
        self.seen.lock().unwrap().push(m.to_owned());
        let mut next = self.next.lock().unwrap();
        let Some(call) = self.calls.get(*next) else {
            panic!(
                "unexpected store call {m} {args} after {} recorded calls",
                self.calls.len()
            );
        };
        assert_eq!(
            call["m"].as_str().unwrap(),
            m,
            "store call #{} ({args})",
            *next
        );
        assert!(
            call.get("after_response").is_none(),
            "call #{} {m} happened after the legacy reply",
            *next
        );
        if m != "arpltn" && m != "city_hourly" {
            assert_eq!(
                canonical(&call["args"]),
                canonical(&args),
                "store call #{} {m} arguments",
                *next
            );
        }
        let index = *next;
        *next += 1;
        match call.get("error") {
            Some(e) => Err(StoreError(e.as_str().unwrap().to_owned())),
            None => Ok(self.results[index].clone().expect("recorded result")),
        }
    }
    /// Every call legacy made before replying was made, in order. Calls legacy makes after the
    /// reply (async.map continuing past an error) cannot change the response and are not made.
    pub fn assert_consumed(&self, id: &str) {
        let before = self
            .calls
            .iter()
            .filter(|c| c.get("after_response").is_none())
            .count();
        assert_eq!(
            *self.next.lock().unwrap(),
            before,
            "{id}: unconsumed recorded calls"
        );
    }
}
fn model_name(m: TownModel) -> &'static str {
    match m {
        TownModel::Short => "Short",
        TownModel::Current => "Current",
        TownModel::Shortest => "Shortest",
        TownModel::ShortRss => "ShortRss",
    }
}
fn mid_name(m: MidModel) -> &'static str {
    match m {
        MidModel::Forecast => "Forecast",
        MidModel::Land => "Land",
        MidModel::Temp => "Temp",
    }
}
impl KmaStore for Replay {
    fn db_version(&self) -> DbVersion {
        self.db
    }
    fn towns(&self) -> StoreResult {
        self.answer("towns", serde_json::json!([]))
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.answer("town", serde_json::json!([a, b, c]))
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        self.answer("region_code", serde_json::json!([region, city]))
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        self.answer("town_model", serde_json::json!([model_name(model), mx, my]))
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        self.answer("mid_model", serde_json::json!([mid_name(model), reg_id]))
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        self.answer("forecast_zone", serde_json::json!([region, city]))
    }
    fn stn_hourly_and_min_rns(
        &self,
        _town: &Value,
        date_time: &str,
        _current: &Value,
    ) -> StoreResult {
        self.answer("stn_hourly_and_min_rns", serde_json::json!([date_time]))
    }
    fn city_hourly(&self, _town: &Value) -> StoreResult {
        self.answer("city_hourly", serde_json::json!([]))
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.answer("area_no", serde_json::json!([a, b, c]))
    }
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        self.answer("area_no_near", serde_json::json!([lon_lat]))
    }
    fn life_index(&self, area_no: f64) -> StoreResult {
        self.answer("life_index", serde_json::json!([area_no]))
    }
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        self.answer("food_poisoning", serde_json::json!([sd, sgg, start, end]))
    }
    fn arpltn(&self, _town: &Value, _now_ms: f64) -> StoreResult {
        self.answer("arpltn", serde_json::json!([]))
    }
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        self.answer("dust_forecast", serde_json::json!([region, city, date]))
    }
    fn air_fallback(&self, g_coord: &Value, _now_ms: f64) -> StoreResult {
        self.answer("air_fallback", serde_json::json!([g_coord]))
    }
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        self.answer("air_forecast", serde_json::json!([source, station]))
    }
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        self.answer("rise_set", serde_json::json!([geocode, dates]))
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        if !self.zones_recorded {
            // Stubbed controller in the oracle: no read, no rows.
            self.seen.lock().unwrap().push("special_zones(stub)".into());
            return Ok(OrderedJson::Array(Vec::new()));
        }
        self.answer("special_zones", serde_json::json!([area_codes]))
    }
}
