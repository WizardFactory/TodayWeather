//! Test double: serves recorded store answers in the S15 oracle recording format (`scenarios[]`
//! with `path`, `query`, `lang`, `clock`, `db` and ordered `calls` carrying the method, its
//! arguments as copied when legacy made the call, and the answer). It is the replay store of the
//! parity, gateway and checkpoint workloads; the runtime has no recorded or local input mode
//! (S15b supplies the S3 input source).
//!
//! A recording replays only the request it was made for: a call outside the recorded order, with
//! different arguments or beyond the recorded calls, and a reply leaving recorded calls unused,
//! forward the request to legacy (`kma::unavailable`) instead of assembling from inputs the
//! recording does not contain.
use serde_json::{Value, json};
use server2::domestic::kma::{
    DbVersion, KmaRequest, KmaStore, MidModel, StoreError, StoreResult, TownModel,
    backend::{KmaSource, SourceAnswer, parse_path, parse_town_path},
    unavailable,
};
use server2::gateway::{BoxFuture, OrderedJson};
use std::{io::Read, sync::Arc, sync::Mutex};
use tokio::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingError(pub &'static str);

/// One dependency call legacy made before replying.
struct Call {
    method: String,
    /// The recorded arguments, normalized by [`normalize`].
    args: Value,
    answer: Result<OrderedJson, String>,
}
struct Recorded {
    id: String,
    /// None for a recorded path the KMA backend does not route (still replayable by id).
    request: Option<KmaRequest>,
    db: DbVersion,
    as_of_ms: f64,
    /// Calls legacy made after replying (async.map continuing past an error) are excluded:
    /// they cannot change the response.
    calls: Arc<[Call]>,
}
pub struct RecordedSource {
    scenarios: Vec<Recorded>,
}
fn text(v: &OrderedJson, key: &str) -> Option<String> {
    v.get(key).and_then(OrderedJson::string)
}
/// `Date.parse` of `YYYY-MM-DDTHH:MM:SS.sssZ`.
fn iso_ms(s: &str) -> Option<f64> {
    server2::history::legacy::parse_iso(s).map(|ms| ms as f64)
}
fn is_undefined(v: &Value) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == 1 && o.get("$undefined") == Some(&Value::Bool(true)))
}
/// Store-argument equality form: numbers as f64, undefined object members dropped and undefined
/// array elements null (the encoding the assembly hands a store, see `to_store`).
fn normalize(v: &Value) -> Value {
    match v {
        Value::Number(n) => n
            .as_f64()
            .and_then(serde_json::Number::from_f64)
            .map_or(Value::Null, Value::Number),
        Value::Array(a) => Value::Array(
            a.iter()
                .map(|x| {
                    if is_undefined(x) {
                        Value::Null
                    } else {
                        normalize(x)
                    }
                })
                .collect(),
        ),
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, x)| !is_undefined(x))
                .map(|(k, x)| (k.clone(), normalize(x)))
                .collect(),
        ),
        other => other.clone(),
    }
}
fn date(ms: f64) -> Value {
    json!({ "$date": ms })
}
impl RecordedSource {
    /// Parse a recording (`.json` or gzip `.json.gz` bytes).
    pub fn parse(bytes: &[u8]) -> Result<Self, RecordingError> {
        let mut raw = Vec::new();
        let bytes = if bytes.starts_with(&[0x1f, 0x8b]) {
            flate2::read::GzDecoder::new(bytes)
                .read_to_end(&mut raw)
                .map_err(|_| RecordingError("gzip"))?;
            &raw[..]
        } else {
            bytes
        };
        let root = OrderedJson::parse(bytes).map_err(|_| RecordingError("json"))?;
        let Some(OrderedJson::Array(list)) = root.get("scenarios") else {
            return Err(RecordingError("scenarios"));
        };
        let mut scenarios = Vec::new();
        for sc in list {
            let path = text(sc, "path").ok_or(RecordingError("path"))?;
            let query = text(sc, "query").unwrap_or_default();
            let lang = text(sc, "lang").unwrap_or_default();
            // S17 recordings name their version (S15 recordings are v000903); town recordings
            // (S17b) record the path below `/{version}/town`.
            let version = text(sc, "version").unwrap_or_else(|| "v000903".into());
            let town = matches!(version.as_str(), "v000803" | "v000705");
            // S17b review recordings carry the requested URL (mixed-case mounts).
            let mut full = match text(sc, "url") {
                Some(url) => url.split('?').next().unwrap_or_default().to_owned(),
                None if town => format!("/{version}/town{path}"),
                None => format!("/{version}/kma{path}"),
            };
            if !query.is_empty() {
                full.push('?');
                full.push_str(&query);
            }
            let as_of_ms = text(sc, "clock")
                .and_then(|c| iso_ms(&c))
                .ok_or(RecordingError("clock"))?;
            let db = if text(sc, "db").as_deref() == Some("1.0") {
                DbVersion::V1
            } else {
                DbVersion::V2
            };
            let Some(OrderedJson::Array(calls)) = sc.get("calls") else {
                return Err(RecordingError("calls"));
            };
            let mut replay = Vec::new();
            for c in calls.iter().filter(|c| c.get("after_response").is_none()) {
                let args = c.get("args").ok_or(RecordingError("args"))?;
                let args: Value =
                    serde_json::from_slice(&args.to_bytes()).map_err(|_| RecordingError("args"))?;
                let answer = match c.get("error") {
                    Some(e) => Err(e.string().unwrap_or_default()),
                    None => Ok(c.get("result").cloned().unwrap_or(OrderedJson::Null)),
                };
                replay.push(Call {
                    method: text(c, "m").ok_or(RecordingError("m"))?,
                    args: normalize(&args),
                    answer,
                });
            }
            scenarios.push(Recorded {
                id: text(sc, "id").unwrap_or_default(),
                request: if town {
                    parse_town_path(&full, &lang)
                } else {
                    parse_path(&full, &lang)
                },
                db,
                as_of_ms,
                calls: replay.into(),
            });
        }
        Ok(Self { scenarios })
    }
    pub fn len(&self) -> usize {
        self.scenarios.len()
    }
    pub fn is_empty(&self) -> bool {
        self.scenarios.is_empty()
    }
    /// The replay store of the recorded scenario `id` (verification).
    pub fn store_for(&self, id: &str) -> Option<RecordedStore> {
        self.scenarios
            .iter()
            .find(|s| s.id == id)
            .map(RecordedStore::new)
    }
}
fn same(a: &KmaRequest, b: &KmaRequest) -> bool {
    a.version == b.version
        && a.region == b.region
        && a.city == b.city
        && a.town == b.town
        && a.query == b.query
        && a.locale == b.locale
}
impl KmaSource for RecordedSource {
    fn snapshot(&self, request: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        let found = self
            .scenarios
            .iter()
            .find(|s| s.request.as_ref().is_some_and(|r| same(r, request)));
        let answer = match found {
            Some(s) => SourceAnswer::Snapshot(Box::new(RecordedStore::new(s))),
            None => SourceAnswer::Forward("no recorded snapshot for this request".into()),
        };
        Box::pin(async move { answer })
    }
}
/// Answers calls in the recorded order with the recorded arguments.
pub struct RecordedStore {
    db: DbVersion,
    as_of_ms: f64,
    zones_recorded: bool,
    calls: Arc<[Call]>,
    next: Mutex<usize>,
}
impl RecordedStore {
    fn new(s: &Recorded) -> Self {
        Self {
            db: s.db,
            as_of_ms: s.as_of_ms,
            zones_recorded: s.calls.iter().any(|c| c.method == "special_zones"),
            calls: s.calls.clone(),
            next: Mutex::new(0),
        }
    }
    fn answer(&self, m: &str, args: Value) -> StoreResult {
        let mut next = self.next.lock().unwrap_or_else(|e| e.into_inner());
        let index = *next;
        let Some(call) = self.calls.get(index) else {
            drop(next);
            unavailable(format!(
                "recording has no call #{index} ({m}); {} recorded",
                self.calls.len()
            ));
        };
        if call.method != m {
            drop(next);
            unavailable(format!(
                "recorded call #{index} is {}, assembly called {m}",
                call.method
            ));
        }
        let args = normalize(&args);
        if call.args != args {
            drop(next);
            unavailable(format!(
                "recorded call #{index} {m} arguments differ: recorded {}, assembly {args}",
                call.args
            ));
        }
        *next += 1;
        call.answer.clone().map_err(StoreError)
    }
}
fn town_name(m: TownModel) -> &'static str {
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
impl KmaStore for RecordedStore {
    fn db_version(&self) -> DbVersion {
        self.db
    }
    fn towns(&self) -> StoreResult {
        self.answer("towns", json!([]))
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.answer("town", json!([a, b, c]))
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        self.answer("region_code", json!([region, city]))
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        self.answer("town_model", json!([town_name(model), mx, my]))
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        self.answer("mid_model", json!([mid_name(model), reg_id]))
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        self.answer("forecast_zone", json!([region, city]))
    }
    fn stn_hourly_and_min_rns(
        &self,
        town: &Value,
        date_time: &str,
        current: &Value,
    ) -> StoreResult {
        self.answer("stn_hourly_and_min_rns", json!([town, date_time, current]))
    }
    fn city_hourly(&self, town: &Value) -> StoreResult {
        self.answer("city_hourly", json!([town]))
    }
    fn history(&self, town: &Value) -> StoreResult {
        if !self.calls.iter().any(|c| c.method == "history") {
            // Recorded with ASOS history reads disabled: legacy makes no read.
            return Ok(OrderedJson::Null);
        }
        self.answer("history", json!([town]))
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.answer("area_no", json!([a, b, c]))
    }
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        self.answer("area_no_near", json!([lon_lat]))
    }
    fn life_index(&self, area_no: f64) -> StoreResult {
        self.answer("life_index", json!([area_no]))
    }
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        self.answer("food_poisoning", json!([sd, sgg, start, end]))
    }
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
        self.answer("arpltn", json!([town, date(now_ms)]))
    }
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        self.answer("dust_forecast", json!([region, city, date]))
    }
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
        self.answer("air_fallback", json!([g_coord, date(now_ms)]))
    }
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        self.answer("air_forecast", json!([source, station]))
    }
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        self.answer("rise_set", json!([geocode, dates]))
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        if !self.zones_recorded {
            // The oracle harness stubs the warning controller without a read when no zone rows exist.
            return Ok(OrderedJson::Array(Vec::new()));
        }
        self.answer("special_zones", json!([area_codes]))
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(self.as_of_ms)
    }
    fn unconsumed(&self) -> Option<String> {
        let next = *self.next.lock().unwrap_or_else(|e| e.into_inner());
        (next < self.calls.len()).then(|| {
            format!(
                "reply left recorded calls unused: {} of {} made",
                next,
                self.calls.len()
            )
        })
    }
}
