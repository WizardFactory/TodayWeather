//! Forecast-zone code list from data.go.kr `1360000/FcstZoneInfoService/getFcstZoneCd` (S13b).
//! Ported from `controllers/kma/kma.forecast.zone.controller.js` at ae21b6cc (legacy #2740:
//! `_getKmaApiUrl`, `_parsePage`, `normalizeZone`, `_fetchAll`). It replaces the S13a newsky2
//! request, which legacy no longer sends. Live HTTPS behavior is unverified.
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged, Paging};
use super::family::{Endpoints, Service};
use super::publication::Publication;
use crate::providers::ResponseFormat;
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;
use serde_json::Value;
use std::collections::BTreeSet;

/// Legacy `ROWS_PER_PAGE` and `MAX_PAGES`.
const ROWS: u32 = 1000;
const MAX_PAGES: u32 = 10;
const TEXT_FIELDS: [&str; 6] = ["regEn", "regUp", "stnWn", "stnF3", "stnFd", "stnFw"];

/// The whole code list (`numOfRows=1000`, pages until a short page or `03`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ZoneRequest;
impl ZoneRequest {
    pub fn new() -> Self {
        Self
    }
    /// Family query pairs in legacy order without `serviceKey`/`dataType`.
    pub fn query(&self, page: u32) -> Vec<(&'static str, String)> {
        vec![
            ("numOfRows", ROWS.to_string()),
            ("pageNo", page.to_string()),
        ]
    }
}
/// Legacy `number` in `_parsePage`: a JSON number or a digit string.
fn count(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => {
            s.parse().ok()
        }
        _ => None,
    }
}
fn absent(value: Option<&Value>) -> bool {
    value.is_none_or(Value::is_null)
}
/// Legacy `decimal`: a number, or `/^-?\d+(\.\d+)?$/`, finite after conversion.
fn decimal(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        Value::String(s) => {
            let t = s.strip_prefix('-').unwrap_or(s);
            let (int, frac) = t.split_once('.').unwrap_or((t, "0"));
            let digits = |x: &str| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit());
            if !digits(int) || !digits(frac) {
                return None;
            }
            s.parse::<f64>().ok().filter(|f| f.is_finite())
        }
        _ => None,
    }
}
/// Legacy `digits` for `tmEd`/`tmSt`: a nonnegative integer or a digit string.
fn integer(value: &Value) -> bool {
    match value {
        // `Number.isInteger(value) && value >= 0` (a JSON `5.0` is an integer, as in JS).
        Value::Number(n) => {
            n.as_u64().is_some() || n.as_f64().is_some_and(|f| f.fract() == 0. && f >= 0.)
        }
        Value::String(s) => !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    }
}
/// Legacy `normalizeZone` acceptance; returns the `regId` of a storable item.
fn zone_item(item: &Value) -> Option<&str> {
    let row = item.as_object()?;
    let text = |name: &str| {
        row.get(name)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    };
    let id = text("regId")?;
    text("regName")?;
    text("regSp")?;
    for field in TEXT_FIELDS {
        let v = row.get(field);
        if !absent(v) && !v.is_some_and(|v| v.is_string() || v.is_number()) {
            return None;
        }
    }
    for field in ["tmEd", "tmSt"] {
        let v = row.get(field);
        if !absent(v) && !v.is_some_and(integer) {
            return None;
        }
    }
    for field in ["seq", "ht", "lat", "lon"] {
        let v = row.get(field);
        if !absent(v) && v.and_then(decimal).is_none() {
            return None;
        }
    }
    // A stored `geo` needs nonzero coordinates within the 2d index bounds.
    if let (Some(lon), Some(lat)) = (
        row.get("lon").and_then(decimal),
        row.get("lat").and_then(decimal),
    ) && lon != 0.
        && lat != 0.
        && !((-180. ..180.).contains(&lon) && (-90. ..=90.).contains(&lat))
    {
        return None;
    }
    Some(id)
}

impl Paged for ZoneRequest {
    fn service(&self) -> Service {
        Service::ForecastZone
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::DataType
    }
    fn rotates(&self) -> bool {
        true
    }
    fn paging(&self) -> Paging {
        Paging::UntilShort
    }
    fn per_page(&self) -> u32 {
        ROWS
    }
    fn max_pages(&self) -> u32 {
        MAX_PAGES
    }
    fn kind(&self) -> &'static str {
        "forecast-zone"
    }
    fn provider_key(&self) -> RecordKey {
        RecordKey::Named {
            id: "forecast-zones".into(),
        }
    }
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page == 0 || page > MAX_PAGES {
            return Err(DomesticError::Invalid("page number"));
        }
        let mut url = endpoints
            .data_go_kr()
            .join("1360000/FcstZoneInfoService/getFcstZoneCd")
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query(page));
        Ok(url)
    }
    fn partition(&self, publication: Publication) -> String {
        publication.base_date()
    }
    fn inspect(&self, page: u32, _: Option<u32>, json: &Value, now_ms: i64) -> PageCheck {
        let header = json.get("response").and_then(|r| r.get("header"));
        let code = match header.and_then(|h| h.get("resultCode")) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => return PageCheck::Invalid("envelope"),
        };
        if code != "00" {
            return PageCheck::Invalid("result code");
        }
        let body = json.get("response").and_then(|r| r.get("body"));
        let Some(items) = body
            .and_then(|b| b.get("items"))
            .and_then(|i| i.get("item"))
            .and_then(Value::as_array)
        else {
            return PageCheck::Invalid("items");
        };
        let rows = items.len();
        let field = |name: &str| body.and_then(|b| b.get(name));
        // `totalCount` counts the returned page only; `pageNo`/`numOfRows` must be echoed.
        if count(field("totalCount")) != Some(rows as f64)
            || count(field("pageNo")) != Some(f64::from(page))
            || count(field("numOfRows")) != Some(f64::from(ROWS))
            || rows > ROWS as usize
        {
            return PageCheck::Invalid("page echo or total");
        }
        let mut seen = BTreeSet::new();
        let mut row_keys = Vec::with_capacity(rows);
        for item in items {
            let Some(id) = zone_item(item) else {
                return PageCheck::Invalid("zone item");
            };
            if !seen.insert(id) {
                return PageCheck::Invalid("duplicate zone");
            }
            row_keys.push(id.to_owned());
        }
        let Some(day) = super::publication::observation_hour(now_ms)
            .and_then(|p| Publication::new(p.date(), 0))
        else {
            return PageCheck::Invalid("clock");
        };
        PageCheck::Valid(PageFacts {
            total: rows as u32,
            rows: rows as u32,
            row_keys,
            publication: day,
            usable: rows > 0,
        })
    }
}
