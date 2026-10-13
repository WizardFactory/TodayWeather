//! AirKorea B552584 station and sido observations (S13a). Ported from
//! `lib/airkoreaObservation.js` (`buildUrl`, `envelope`, `parseRows`, `kstInstant`) and the key
//! choice of `lib/kecoRequester.js` at 45e9193b. Nothing here normalizes concentrations.
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged};
use super::family::{Endpoints, Service};
use super::publication::Publication;
use crate::providers::ResponseFormat;
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;
use serde_json::Value;
use std::collections::BTreeSet;

/// Legacy `Arpltn.getCtprvnSidoList` with the record-key romanization.
pub const SIDOS: [(&str, &str); 17] = [
    ("서울", "seoul"),
    ("부산", "busan"),
    ("대구", "daegu"),
    ("인천", "incheon"),
    ("광주", "gwangju"),
    ("대전", "daejeon"),
    ("울산", "ulsan"),
    ("경기", "gyeonggi"),
    ("강원", "gangwon"),
    ("충북", "chungbuk"),
    ("충남", "chungnam"),
    ("전북", "jeonbuk"),
    ("전남", "jeonnam"),
    ("경북", "gyeongbuk"),
    ("경남", "gyeongnam"),
    ("제주", "jeju"),
    ("세종", "sejong"),
];
/// Legacy client bounds: 100 rows per page, at most 20 pages and 2,000 rows.
const PAGE_SIZE: u32 = 100;
const MAX_PAGES: u32 = 20;
const MAX_TOTAL: u64 = 2000;
const VALUES: [&str; 9] = [
    "so2Value",
    "coValue",
    "o3Value",
    "no2Value",
    "pm10Value",
    "pm25Value",
    "pm10Value24",
    "pm25Value24",
    "khaiValue",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AirKoreaOperation {
    /// `ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` (`ver=1.3`).
    Station,
    /// `ArpltnStatsSvc/getCtprvnMesureSidoLIst` (`searchCondition=HOUR`).
    Sido,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirKoreaRequest {
    operation: AirKoreaOperation,
    sido: &'static str,
    slug: &'static str,
}
impl AirKoreaRequest {
    pub fn new(operation: AirKoreaOperation, sido: &str) -> Result<Self, DomesticError> {
        let (sido, slug) = SIDOS
            .iter()
            .find(|(name, _)| *name == sido)
            .copied()
            .ok_or(DomesticError::Invalid("sido"))?;
        Ok(Self {
            operation,
            sido,
            slug,
        })
    }
    pub fn operation(&self) -> AirKoreaOperation {
        self.operation
    }
    pub fn sido(&self) -> &str {
        self.sido
    }
    /// Family query pairs in legacy order without `serviceKey`/`returnType`.
    pub fn query(&self, page: u32) -> Vec<(&'static str, String)> {
        let mut out = vec![
            ("sidoName", self.sido.to_owned()),
            ("pageNo", page.to_string()),
            ("numOfRows", PAGE_SIZE.to_string()),
        ];
        out.push(match self.operation {
            AirKoreaOperation::Station => ("ver", "1.3".into()),
            AirKoreaOperation::Sido => ("searchCondition", "HOUR".into()),
        });
        out
    }
}

/// `kstInstant`: `YYYY-MM-DD HH:MM` KST with 24:00 allowed only at minute 0, as the
/// publication of that hour (24:00 is the next day's 00:00).
fn data_time(value: &Value) -> Option<Publication> {
    let s = value.as_str()?;
    let b = s.as_bytes();
    if b.len() != 16
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b' '
        || b[13] != b':'
        || ![0..4, 5..7, 8..10, 11..13, 14..16]
            .iter()
            .all(|r| b[r.clone()].iter().all(u8::is_ascii_digit))
    {
        return None;
    }
    let date: u32 = format!("{}{}{}", &s[..4], &s[5..7], &s[8..10])
        .parse()
        .ok()?;
    let (h, m): (u16, u16) = (s[11..13].parse().ok()?, s[14..16].parse().ok()?);
    if h > 24 || m > 59 || (h == 24 && m != 0) {
        return None;
    }
    if h == 24 {
        return Publication::new(date, 0)?.add_hours(24);
    }
    Publication::new(date, h * 100 + m)
}
/// Legacy `number`: a nonnegative finite number or a plain decimal string.
fn numeric(value: &Value) -> bool {
    match value {
        Value::Number(n) => n.as_f64().is_some_and(|f| f.is_finite() && f >= 0.),
        Value::String(s) => {
            let t = s.trim();
            let (int, frac) = t.split_once('.').unwrap_or((t, "0"));
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
        }
        _ => false,
    }
}
/// JavaScript truthiness of a JSON value (legacy `item.sidoName && ...`).
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0. && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
fn nonblank(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
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

impl Paged for AirKoreaRequest {
    fn service(&self) -> Service {
        Service::AirKorea
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::ReturnType
    }
    fn rotates(&self) -> bool {
        false
    }
    fn per_page(&self) -> u32 {
        PAGE_SIZE
    }
    fn max_pages(&self) -> u32 {
        MAX_PAGES
    }
    fn kind(&self) -> &'static str {
        match self.operation {
            AirKoreaOperation::Station => "airkorea-station",
            AirKoreaOperation::Sido => "airkorea-sido",
        }
    }
    fn provider_key(&self) -> RecordKey {
        RecordKey::Named {
            id: format!("sido-{}", self.slug),
        }
    }
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page == 0 || page > MAX_PAGES {
            return Err(DomesticError::Invalid("page number"));
        }
        let path = match self.operation {
            AirKoreaOperation::Station => "B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
            AirKoreaOperation::Sido => "B552584/ArpltnStatsSvc/getCtprvnMesureSidoLIst",
        };
        let mut url = endpoints
            .data_go_kr()
            .join(path)
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query(page));
        Ok(url)
    }
    fn partition(&self, publication: Publication) -> String {
        publication.partition()
    }
    fn inspect(&self, page: u32, total: Option<u32>, json: &Value, _now_ms: i64) -> PageCheck {
        let Some(response) = json.get("response") else {
            return PageCheck::Invalid("envelope");
        };
        let code = match response.get("header").and_then(|h| h.get("resultCode")) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => return PageCheck::Invalid("envelope"),
        };
        if code != "00" {
            return PageCheck::Invalid("result code");
        }
        let Some(body) = response.get("body") else {
            return PageCheck::Invalid("items");
        };
        let Some(items) = body.get("items").and_then(Value::as_array) else {
            return PageCheck::Invalid("items");
        };
        let Some(count) = digits(body.get("totalCount")).filter(|t| *t <= MAX_TOTAL) else {
            return PageCheck::Invalid("totalCount");
        };
        let before = u64::from(PAGE_SIZE) * u64::from(page.saturating_sub(1));
        if page == 0
            || digits(body.get("pageNo")) != Some(u64::from(page))
            || digits(body.get("numOfRows")) != Some(u64::from(PAGE_SIZE))
            || items.len() as u64 != u64::from(PAGE_SIZE).min(count.saturating_sub(before))
            || total.is_some_and(|t| u64::from(t) != count)
        {
            return PageCheck::Invalid("incomplete page");
        }
        if count == 0 {
            // Legacy EMPTY_ITEMS: no observation published for this sido.
            return if page == 1 {
                PageCheck::NoData
            } else {
                PageCheck::Invalid("empty later page")
            };
        }
        let station = self.operation == AirKoreaOperation::Station;
        let mut seen = BTreeSet::new();
        let mut row_keys = Vec::with_capacity(items.len());
        let mut newest: Option<Publication> = None;
        let mut usable = false;
        for item in items {
            let Some(row) = item.as_object() else {
                return PageCheck::Invalid("observation");
            };
            let identity = nonblank(row.get(if station { "stationName" } else { "cityName" }));
            let Some(time) = row.get("dataTime").and_then(data_time) else {
                return PageCheck::Invalid("observation");
            };
            let Some(identity) = identity else {
                return PageCheck::Invalid("observation");
            };
            if (!station && nonblank(row.get("sidoName")).is_none())
                || row
                    .get("sidoName")
                    .is_some_and(|s| truthy(s) && s.as_str() != Some(self.sido))
            {
                return PageCheck::Invalid("observation");
            }
            let key = format!("{identity}@{}", time.compact());
            if !seen.insert(key.clone()) {
                return PageCheck::Invalid("duplicate observation");
            }
            row_keys.push(key);
            newest = newest.max(Some(time));
            usable |= VALUES
                .iter()
                .any(|name| row.get(*name).is_some_and(numeric));
        }
        let Some(publication) = newest else {
            return PageCheck::Invalid("observation");
        };
        PageCheck::Valid(PageFacts {
            total: count as u32,
            rows: items.len() as u32,
            row_keys,
            publication,
            usable,
        })
    }
}
