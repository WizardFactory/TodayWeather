//! Forecast-zone code list (S13a). Ported from `controllers/kma/kma.forecast.zone.controller.js`
//! (`_getKmaApiUrl`, `_request`, `_paresKmaForecastZoneCode`) at 45e9193b. Legacy keeps the
//! retired-looking newsky2 host; live HTTPS reachability is unverified.
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged};
use super::family::{Endpoints, Service};
use super::publication::Publication;
use crate::providers::ResponseFormat;
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;
use serde_json::Value;
use std::collections::BTreeSet;

const ROWS: u32 = 999;

/// The whole code list (`pageNo=1&numOfRows=999`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ZoneRequest;
impl ZoneRequest {
    pub fn new() -> Self {
        Self
    }
    /// Family query pairs in legacy order without `type`/`ServiceKey`.
    pub fn query(&self) -> Vec<(&'static str, String)> {
        vec![("pageNo", "1".into()), ("numOfRows", ROWS.to_string())]
    }
}
fn digits(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::Number(n) => n.as_u64(),
        Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => {
            s.parse().ok()
        }
        _ => None,
    }
}

impl Paged for ZoneRequest {
    fn service(&self) -> Service {
        Service::ForecastZone
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::Type
    }
    fn rotates(&self) -> bool {
        true
    }
    fn per_page(&self) -> u32 {
        ROWS
    }
    fn max_pages(&self) -> u32 {
        1
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
        if page != 1 {
            return Err(DomesticError::Invalid("page number"));
        }
        let mut url = endpoints
            .newsky()
            .join("service/ForecastZoneInfoService/ForecastZoneCodeDataInfo")
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query());
        Ok(url)
    }
    fn partition(&self, publication: Publication) -> String {
        publication.base_date()
    }
    fn inspect(&self, page: u32, _: Option<u32>, json: &Value, now_ms: i64) -> PageCheck {
        let response = json.get("response");
        // Legacy success check: `resultMsg === 'OK'` (result codes are checked by the
        // transport classifier with the newsky2 success codes).
        if response
            .and_then(|r| r.get("header"))
            .and_then(|h| h.get("resultMsg"))
            .and_then(Value::as_str)
            != Some("OK")
        {
            return PageCheck::Invalid("result message");
        }
        let body = response.and_then(|r| r.get("body"));
        let Some(items) = body
            .and_then(|b| b.get("items"))
            .and_then(|i| i.get("item"))
            .and_then(Value::as_array)
            .filter(|l| !l.is_empty())
        else {
            return PageCheck::Invalid("zone list");
        };
        let rows = items.len() as u64;
        let echo = |name: &str, wanted: u64| {
            body.and_then(|b| b.get(name))
                .is_none_or(|v| digits(Some(v)) == Some(wanted))
        };
        // Legacy read only page 1; a list longer than one page is incomplete, not truncated.
        if page != 1
            || rows > u64::from(ROWS)
            || !echo("totalCount", rows)
            || !echo("pageNo", 1)
            || !echo("numOfRows", u64::from(ROWS))
        {
            return PageCheck::Invalid("incomplete zone list");
        }
        let mut seen = BTreeSet::new();
        let mut row_keys = Vec::with_capacity(items.len());
        for item in items {
            let Some(id) = item
                .get("regId")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
            else {
                return PageCheck::Invalid("zone row");
            };
            if !seen.insert(id.to_owned()) {
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
            usable: true,
        })
    }
}
