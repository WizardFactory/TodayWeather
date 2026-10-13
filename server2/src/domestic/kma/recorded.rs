//! Local verification source: serves recorded store answers in the S15 oracle recording format
//! (`scenarios[]` with `path`, `query`, `lang`, `clock`, `db` and ordered `calls`). It lets the
//! release binary assemble native KMA responses against loopback peers for the smoke and paired
//! replay. It is not a production input source (S15b supplies that from S3).
use super::backend::{KmaSource, SourceAnswer, parse_path};
use super::{DbVersion, KmaRequest, KmaStore, MidModel, StoreError, StoreResult, TownModel};
use crate::gateway::{BoxFuture, OrderedJson};
use serde_json::Value;
use std::{io::Read, sync::Mutex};
use tokio::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingError(pub &'static str);

struct Recorded {
    request: KmaRequest,
    db: DbVersion,
    as_of_ms: f64,
    /// (method, answer); calls legacy made after replying are excluded.
    calls: Vec<(String, Result<OrderedJson, String>)>,
}
pub struct RecordedSource {
    scenarios: Vec<Recorded>,
}
fn text(v: &OrderedJson, key: &str) -> Option<String> {
    v.get(key).and_then(OrderedJson::string)
}
/// `Date.parse` of `YYYY-MM-DDTHH:MM:SS.sssZ`.
fn iso_ms(s: &str) -> Option<f64> {
    crate::history::legacy::parse_iso(s).map(|ms| ms as f64)
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
            let mut full = format!("/v000903/kma{path}");
            if !query.is_empty() {
                full.push('?');
                full.push_str(&query);
            }
            let Some(request) = parse_path(&full, &lang) else {
                continue;
            };
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
            let calls = calls
                .iter()
                .filter(|c| c.get("after_response").is_none())
                .map(|c| {
                    let m = text(c, "m").unwrap_or_default();
                    let answer = match c.get("error") {
                        Some(e) => Err(e.string().unwrap_or_default()),
                        None => Ok(c.get("result").cloned().unwrap_or(OrderedJson::Null)),
                    };
                    (m, answer)
                })
                .collect();
            scenarios.push(Recorded {
                request,
                db,
                as_of_ms,
                calls,
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
        let found = self.scenarios.iter().find(|s| same(&s.request, request));
        let answer = match found {
            Some(s) => SourceAnswer::Snapshot(Box::new(RecordedStore {
                db: s.db,
                as_of_ms: s.as_of_ms,
                zones_recorded: s.calls.iter().any(|(m, _)| m == "special_zones"),
                calls: s.calls.clone(),
                next: Mutex::new(0),
            })),
            None => SourceAnswer::Forward("no recorded snapshot for this request".into()),
        };
        Box::pin(async move { answer })
    }
}
/// Answers calls in the recorded order; a call out of order is a store error.
pub struct RecordedStore {
    db: DbVersion,
    as_of_ms: f64,
    zones_recorded: bool,
    calls: Vec<(String, Result<OrderedJson, String>)>,
    next: Mutex<usize>,
}
impl RecordedStore {
    fn answer(&self, m: &str) -> StoreResult {
        let mut next = self.next.lock().unwrap_or_else(|e| e.into_inner());
        match self.calls.get(*next) {
            Some((name, answer)) if name == m => {
                *next += 1;
                answer.clone().map_err(StoreError)
            }
            _ => Err(StoreError(format!("no recorded answer for {m}"))),
        }
    }
}
impl KmaStore for RecordedStore {
    fn db_version(&self) -> DbVersion {
        self.db
    }
    fn towns(&self) -> StoreResult {
        self.answer("towns")
    }
    fn town(&self, _: &str, _: &str, _: &str) -> StoreResult {
        self.answer("town")
    }
    fn region_code(&self, _: &str, _: &str) -> StoreResult {
        self.answer("region_code")
    }
    fn town_model(&self, _: TownModel, _: &Value, _: &Value) -> StoreResult {
        self.answer("town_model")
    }
    fn mid_model(&self, _: MidModel, _: &Value) -> StoreResult {
        self.answer("mid_model")
    }
    fn forecast_zone(&self, _: &str, _: &str) -> StoreResult {
        self.answer("forecast_zone")
    }
    fn stn_hourly_and_min_rns(&self, _: &Value, _: &str, _: &Value) -> StoreResult {
        self.answer("stn_hourly_and_min_rns")
    }
    fn city_hourly(&self, _: &Value) -> StoreResult {
        self.answer("city_hourly")
    }
    fn area_no(&self, _: &str, _: &str, _: &str) -> StoreResult {
        self.answer("area_no")
    }
    fn area_no_near(&self, _: &Value) -> StoreResult {
        self.answer("area_no_near")
    }
    fn life_index(&self, _: f64) -> StoreResult {
        self.answer("life_index")
    }
    fn food_poisoning(&self, _: &str, _: &str, _: &str, _: &str) -> StoreResult {
        self.answer("food_poisoning")
    }
    fn arpltn(&self, _: &Value, _: f64) -> StoreResult {
        self.answer("arpltn")
    }
    fn dust_forecast(&self, _: &str, _: &str, _: &str) -> StoreResult {
        self.answer("dust_forecast")
    }
    fn air_fallback(&self, _: &Value, _: f64) -> StoreResult {
        self.answer("air_fallback")
    }
    fn air_forecast(&self, _: &str, _: &Value) -> StoreResult {
        self.answer("air_forecast")
    }
    fn rise_set(&self, _: &Value, _: &[String]) -> StoreResult {
        self.answer("rise_set")
    }
    fn special_zones(&self, _: &[String]) -> StoreResult {
        if !self.zones_recorded {
            // The oracle harness stubs the warning controller without a read when no zone rows exist.
            return Ok(OrderedJson::Array(Vec::new()));
        }
        self.answer("special_zones")
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(self.as_of_ms)
    }
}
