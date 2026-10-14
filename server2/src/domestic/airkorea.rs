//! AirKorea B552584 operations. S13a ported the station and sido observations from
//! `lib/airkoreaObservation.js` (`buildUrl`, `envelope`, `parseRows`, `kstInstant`) at 45e9193b.
//! S13b adds the dust forecast and the station list and the shared key selection from the same
//! file at ae21b6cc (legacy #2737: `OPERATIONS`, `operationUrl`, `itemsBody`, `withKeys`).
//! Nothing here normalizes concentrations or forecast text.
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged};
use super::family::{Endpoints, Service};
use super::publication::{Publication, observation_hour};
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
    /// `ArpltnInforInqireSvc/getMinuDustFrcstDspth` (`searchDate`, `ver=1.1`; S13b).
    DustForecast,
    /// `MsrstnInfoInqireSvc/getMsrstnList` (no `ver`: `dmX` latitude, `dmY` longitude; S13b).
    StationList,
}
#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    Sido {
        name: &'static str,
        slug: &'static str,
    },
    /// The search date (time 0000).
    SearchDate(Publication),
    All,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirKoreaRequest {
    operation: AirKoreaOperation,
    target: Target,
}
impl AirKoreaRequest {
    /// Station or sido observations for one of the 17 legacy sido names.
    pub fn new(operation: AirKoreaOperation, sido: &str) -> Result<Self, DomesticError> {
        if !matches!(
            operation,
            AirKoreaOperation::Station | AirKoreaOperation::Sido
        ) {
            return Err(DomesticError::Invalid("operation"));
        }
        let (name, slug) = SIDOS
            .iter()
            .find(|(name, _)| *name == sido)
            .copied()
            .ok_or(DomesticError::Invalid("sido"))?;
        Ok(Self {
            operation,
            target: Target::Sido { name, slug },
        })
    }
    /// Dust forecasts searched by KST date `YYYYMMDD` (legacy `_getFrcst(dataDate)`); see
    /// `publication::dust_forecast_announcement` for the legacy choice of the date.
    pub fn dust_forecast(search_date: u32) -> Result<Self, DomesticError> {
        let day = Publication::new(search_date, 0).ok_or(DomesticError::Invalid("search date"))?;
        Ok(Self {
            operation: AirKoreaOperation::DustForecast,
            target: Target::SearchDate(day),
        })
    }
    /// The national measuring-station list (legacy `getMsrstnList`).
    pub fn station_list() -> Self {
        Self {
            operation: AirKoreaOperation::StationList,
            target: Target::All,
        }
    }
    pub fn operation(&self) -> AirKoreaOperation {
        self.operation
    }
    pub fn sido(&self) -> Option<&str> {
        match self.target {
            Target::Sido { name, .. } => Some(name),
            _ => None,
        }
    }
    /// Search date `YYYYMMDD` of a dust-forecast request.
    pub fn search_date(&self) -> Option<u32> {
        match self.target {
            Target::SearchDate(day) => Some(day.date()),
            _ => None,
        }
    }
    /// Family query pairs in legacy order without `serviceKey`/`returnType`.
    pub fn query(&self, page: u32) -> Vec<(&'static str, String)> {
        let mut out = match &self.target {
            Target::Sido { name, .. } => vec![("sidoName", (*name).to_owned())],
            Target::SearchDate(day) => {
                let d = day.base_date();
                vec![(
                    "searchDate",
                    format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..]),
                )]
            }
            Target::All => Vec::new(),
        };
        out.push(("pageNo", page.to_string()));
        out.push(("numOfRows", PAGE_SIZE.to_string()));
        match self.operation {
            AirKoreaOperation::Station => out.push(("ver", "1.3".into())),
            AirKoreaOperation::Sido => out.push(("searchCondition", "HOUR".into())),
            AirKoreaOperation::DustForecast => out.push(("ver", "1.1".into())),
            AirKoreaOperation::StationList => {}
        }
        out
    }
}

/// `kstInstant`: `YYYY-MM-DD HH:MM` KST with 24:00 allowed only at minute 0, as the
/// publication of that hour (24:00 is the next day's 00:00).
fn data_time(value: &Value) -> Option<Publication> {
    let s = value.as_str()?;
    let b = s.as_bytes();
    if b.len() != 16 || b[10] != b' ' || b[13] != b':' || !digits_at(b, &[11..13, 14..16]) {
        return None;
    }
    let date = day(&s[..10])?;
    let (h, m): (u16, u16) = (s[11..13].parse().ok()?, s[14..16].parse().ok()?);
    if h > 24 || m > 59 || (h == 24 && m != 0) {
        return None;
    }
    if h == 24 {
        return Publication::new(date, 0)?.add_hours(24);
    }
    Publication::new(date, h * 100 + m)
}
/// A dust-forecast announcement `YYYY-MM-DD HH시 발표` (the form legacy `_checkDataTime`
/// builds and `_parseFrcst` filters by).
fn announcement(value: &str) -> Option<Publication> {
    let (date, hour) = value.strip_suffix("시 발표")?.split_once(' ')?;
    if hour.len() != 2 || !hour.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Publication::new(day(date)?, hour.parse::<u16>().ok()? * 100)
}
fn digits_at(b: &[u8], ranges: &[std::ops::Range<usize>]) -> bool {
    ranges
        .iter()
        .all(|r| b[r.clone()].iter().all(u8::is_ascii_digit))
}
/// `YYYY-MM-DD` as `YYYYMMDD`.
fn day(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !digits_at(b, &[0..4, 5..7, 8..10]) {
        return None;
    }
    format!("{}{}{}", &s[..4], &s[5..7], &s[8..10]).parse().ok()
}
/// Legacy `number`: a nonnegative finite number or a plain decimal string.
fn numeric(value: &Value) -> bool {
    match value {
        Value::Number(n) => n.as_f64().is_some_and(|f| f.is_finite() && f >= 0.),
        Value::String(s) => {
            let t = s.trim();
            let (int, frac) = t.split_once('.').unwrap_or((t, "0"));
            // Legacy `/^\d+(?:\.\d+)?$/` and then `Number(value)` finite and nonnegative
            // (S13a-R2-F01: an overflowing decimal is Infinity, not a concentration).
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
                && t.parse::<f64>().is_ok_and(|f| f.is_finite() && f >= 0.)
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
/// Legacy `text`: a string with a non-whitespace character.
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
/// Legacy `itemsBody` deletes a per-item `serviceKey` echo before storage. A raw record keeps
/// the provider bytes, so a page that echoes a credential is not stored at all.
fn echoes_credential(row: &serde_json::Map<String, Value>) -> bool {
    row.get("serviceKey")
        .is_some_and(|v| !v.is_null() && v.as_str().is_none_or(|s| !s.trim().is_empty()))
}

impl Paged for AirKoreaRequest {
    fn service(&self) -> Service {
        Service::AirKorea
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::ReturnType
    }
    /// Legacy `withKeys`, not the #2604 ring rotation.
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
            AirKoreaOperation::DustForecast => "airkorea-dust-forecast",
            AirKoreaOperation::StationList => "airkorea-station-list",
        }
    }
    fn provider_key(&self) -> RecordKey {
        let id = match (&self.target, self.operation) {
            (Target::Sido { slug, .. }, _) => format!("sido-{slug}"),
            (_, AirKoreaOperation::DustForecast) => "dust-forecast".into(),
            _ => "stations".into(),
        };
        RecordKey::Named { id }
    }
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page == 0 || page > MAX_PAGES {
            return Err(DomesticError::Invalid("page number"));
        }
        let path = match self.operation {
            AirKoreaOperation::Station => "B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
            AirKoreaOperation::Sido => "B552584/ArpltnStatsSvc/getCtprvnMesureSidoLIst",
            AirKoreaOperation::DustForecast => "B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth",
            AirKoreaOperation::StationList => "B552584/MsrstnInfoInqireSvc/getMsrstnList",
        };
        let mut url = endpoints
            .data_go_kr()
            .join(path)
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query(page));
        Ok(url)
    }
    fn partition(&self, publication: Publication) -> String {
        match (&self.target, self.operation) {
            (Target::SearchDate(day), _) => day.base_date(),
            (_, AirKoreaOperation::StationList) => publication.base_date(),
            _ => publication.partition(),
        }
    }
    fn inspect(&self, page: u32, total: Option<u32>, json: &Value, now_ms: i64) -> PageCheck {
        let (items, count) = match envelope(page, total, json) {
            Ok(page) => page,
            Err(check) => return check,
        };
        let mut rows = Vec::with_capacity(items.len());
        for item in items {
            match item.as_object() {
                Some(row) if !echoes_credential(row) => rows.push(row),
                _ => return PageCheck::Invalid("item"),
            }
        }
        let facts = match &self.target {
            Target::Sido { name, .. } => self.observations(&rows, name),
            Target::SearchDate(day) => forecasts(&rows, *day),
            Target::All => stations(&rows, now_ms),
        };
        match facts {
            Ok((row_keys, publication, usable)) => PageCheck::Valid(PageFacts {
                total: count as u32,
                rows: items.len() as u32,
                row_keys,
                publication,
                usable,
            }),
            Err(reason) => PageCheck::Invalid(reason),
        }
    }
}

/// Row identities, the page publication and whether a row is usable.
type Rows = Result<(Vec<String>, Publication, bool), &'static str>;
type Object = serde_json::Map<String, Value>;

/// Legacy `envelope`: result code, items array, total and page echoes, expected row count.
/// `totalCount 0` on page 1 is terminal no data (legacy EMPTY_ITEMS).
fn envelope(page: u32, total: Option<u32>, json: &Value) -> Result<(&Vec<Value>, u64), PageCheck> {
    let Some(response) = json.get("response") else {
        return Err(PageCheck::Invalid("envelope"));
    };
    let code = match response.get("header").and_then(|h| h.get("resultCode")) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return Err(PageCheck::Invalid("envelope")),
    };
    if code != "00" {
        return Err(PageCheck::Invalid("result code"));
    }
    let Some(body) = response.get("body") else {
        return Err(PageCheck::Invalid("items"));
    };
    let Some(items) = body.get("items").and_then(Value::as_array) else {
        return Err(PageCheck::Invalid("items"));
    };
    let Some(count) = digits(body.get("totalCount")).filter(|t| *t <= MAX_TOTAL) else {
        return Err(PageCheck::Invalid("totalCount"));
    };
    let before = u64::from(PAGE_SIZE) * u64::from(page.saturating_sub(1));
    if page == 0
        || digits(body.get("pageNo")) != Some(u64::from(page))
        || digits(body.get("numOfRows")) != Some(u64::from(PAGE_SIZE))
        || items.len() as u64 != u64::from(PAGE_SIZE).min(count.saturating_sub(before))
        || total.is_some_and(|t| u64::from(t) != count)
    {
        return Err(PageCheck::Invalid("incomplete page"));
    }
    if count == 0 {
        return Err(if page == 1 {
            PageCheck::NoData
        } else {
            PageCheck::Invalid("empty later page")
        });
    }
    Ok((items, count))
}

impl AirKoreaRequest {
    /// Legacy `parseRows` checks for station and sido observations.
    fn observations(&self, rows: &[&Object], sido: &str) -> Rows {
        let station = self.operation == AirKoreaOperation::Station;
        let mut seen = BTreeSet::new();
        let mut row_keys = Vec::with_capacity(rows.len());
        let mut newest: Option<Publication> = None;
        let mut usable = false;
        for row in rows {
            let identity = nonblank(row.get(if station { "stationName" } else { "cityName" }));
            let time = row
                .get("dataTime")
                .and_then(data_time)
                .ok_or("observation")?;
            let identity = identity.ok_or("observation")?;
            if (!station && nonblank(row.get("sidoName")).is_none())
                || row
                    .get("sidoName")
                    .is_some_and(|s| truthy(s) && s.as_str() != Some(sido))
            {
                return Err("observation");
            }
            let key = format!("{identity}@{}", time.compact());
            if !seen.insert(key.clone()) {
                return Err("duplicate observation");
            }
            row_keys.push(key);
            newest = newest.max(Some(time));
            usable |= VALUES
                .iter()
                .any(|name| row.get(*name).is_some_and(numeric));
        }
        Ok((row_keys, newest.ok_or("observation")?, usable))
    }
}
/// Identity of a whole item: a repeated item across pages means shifted pages.
fn item_keys(rows: &[&Object]) -> Result<Vec<String>, &'static str> {
    let mut seen = BTreeSet::new();
    rows.iter()
        .map(|row| {
            let key = serde_json::to_string(row).map_err(|_| "item")?;
            if seen.insert(key.clone()) {
                Ok(key)
            } else {
                Err("duplicate item")
            }
        })
        .collect()
}
/// Legacy FORECAST `item`: text `dataTime`, `informCode`, `informData`; string `informGrade`.
/// The page publication is the newest announcement on the search date; a page without one
/// is not usable (legacy `_parseFrcst` keeps only rows of the expected announcement).
fn forecasts(rows: &[&Object], search: Publication) -> Rows {
    let mut newest = None;
    for row in rows {
        let time = nonblank(row.get("dataTime"));
        if time.is_none()
            || nonblank(row.get("informCode")).is_none()
            || nonblank(row.get("informData")).is_none()
            || !row.get("informGrade").is_some_and(Value::is_string)
        {
            return Err("forecast item");
        }
        if let Some(found) = time
            .and_then(announcement)
            .filter(|p| p.date() == search.date())
        {
            newest = newest.max(Some(found));
        }
    }
    Ok((item_keys(rows)?, newest.unwrap_or(search), newest.is_some()))
}
/// Legacy STATION_LIST `item`: text `stationName`; `dmX`/`dmY` a string (empty allowed for
/// geocoding) or a finite number; `addr` absent, null or a string. Period: KST fetch day.
fn stations(rows: &[&Object], now_ms: i64) -> Rows {
    let coordinate = |v: Option<&Value>| v.is_some_and(|v| v.is_string() || v.is_number());
    for row in rows {
        if nonblank(row.get("stationName")).is_none()
            || !coordinate(row.get("dmX"))
            || !coordinate(row.get("dmY"))
            || !row.get("addr").is_none_or(|a| a.is_null() || a.is_string())
        {
            return Err("station item");
        }
    }
    let day = observation_hour(now_ms)
        .and_then(|p| Publication::new(p.date(), 0))
        .ok_or("clock")?;
    Ok((item_keys(rows)?, day, true))
}
