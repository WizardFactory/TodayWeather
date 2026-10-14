//! KMA ASOS per-station date-range observations from data.go.kr (S15b-2, #2742), the legacy
//! #2564/#2648 history provider (`server/lib/history/provider.js` at 05c06c67):
//! `AsosHourlyInfoService/getWthrDataList` (`dateCd=HR`) and `AsosDalyInfoService/
//! getWthrDataList` (`dateCd=DAY`) for one station (`stnIds`) and a range of 1–7 completed KST
//! days. Legacy checks per page (`Provider.prototype.fetch`): `resultCode` `00`, an integer
//! `totalCount` within 8 x 999 rows, echoed `pageNo` and `numOfRows`, the expected item count
//! and no repeated page. The data.go.kr form has no nationwide request (live 2026-10-14:
//! omitting `stnIds` answers `11`, `stnIds=0` answers `03`, two stations answer `02`).
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged};
use super::family::{Endpoints, Service};
use super::publication::Publication;
use crate::providers::ResponseFormat;
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;
use serde_json::Value;

/// Legacy `pageSize` and `maxPages`.
pub const ROWS: u32 = 999;
pub const MAX_PAGES: u32 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AsosKind {
    Hourly,
    Daily,
}
impl AsosKind {
    pub fn kind(self) -> &'static str {
        match self {
            Self::Hourly => "asos-hourly",
            Self::Daily => "asos-daily",
        }
    }
    /// Legacy record `kind`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Hourly => "hourly",
            Self::Daily => "daily",
        }
    }
    fn key_len(self) -> usize {
        match self {
            Self::Hourly => 12,
            Self::Daily => 8,
        }
    }
}
/// One station and an inclusive range of hourly (`YYYYMMDDHH00`) or daily (`YYYYMMDD`) keys.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AsosRequest {
    kind: AsosKind,
    station: String,
    start: String,
    end: String,
}
fn digits(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit())
}
impl AsosRequest {
    /// `station` is a canonical legacy station id (`policy.station`: 1–3 digits, no leading
    /// zero); `start..=end` stay within seven KST days (`policy.range`).
    pub fn new(
        kind: AsosKind,
        station: &str,
        start: &str,
        end: &str,
    ) -> Result<Self, DomesticError> {
        let canonical = !station.is_empty()
            && station.len() <= 3
            && digits(station)
            && !station.starts_with('0');
        let key = |k: &str| {
            k.len() == kind.key_len()
                && digits(k)
                && Publication::new(k[..8].parse().unwrap_or(0), 0).is_some()
                && (kind == AsosKind::Daily
                    || (k[8..10].parse::<u16>().is_ok_and(|h| h < 24) && &k[10..] == "00"))
        };
        if !canonical || !key(start) || !key(end) || start > end {
            return Err(DomesticError::Invalid("ASOS station or range"));
        }
        let (a, b) = (
            Publication::new(start[..8].parse().unwrap_or(0), 0),
            Publication::new(end[..8].parse().unwrap_or(0), 0),
        );
        match (a, b.and_then(|b| b.add_hours(-24 * 6))) {
            (Some(a), Some(limit)) if limit <= a => {}
            _ => return Err(DomesticError::Invalid("ASOS range longer than seven days")),
        }
        Ok(Self {
            kind,
            station: station.to_owned(),
            start: start.to_owned(),
            end: end.to_owned(),
        })
    }
    pub fn asos_kind(&self) -> AsosKind {
        self.kind
    }
    pub fn station(&self) -> &str {
        &self.station
    }
    pub fn start(&self) -> &str {
        &self.start
    }
    pub fn end(&self) -> &str {
        &self.end
    }
    /// The record key of a station (`stn-<id>` is the getMidFcst key; ASOS uses `Station`).
    pub fn record_key(station: &str) -> RecordKey {
        RecordKey::Station {
            id: station.to_owned(),
        }
    }
    /// The catalog partition: the range (`YYYYMMDDHH-YYYYMMDDHH` or `YYYYMMDD-YYYYMMDD`).
    pub fn range_partition(&self) -> String {
        match self.kind {
            AsosKind::Hourly => format!("{}-{}", &self.start[..10], &self.end[..10]),
            AsosKind::Daily => format!("{}-{}", self.start, self.end),
        }
    }
    /// Parse a catalog partition back into its range keys.
    pub fn parse_partition(kind: AsosKind, partition: &str) -> Option<(String, String)> {
        let (a, b) = partition.split_once('-')?;
        let n = match kind {
            AsosKind::Hourly => 10,
            AsosKind::Daily => 8,
        };
        if a.len() != n || b.len() != n || !digits(a) || !digits(b) {
            return None;
        }
        Some(match kind {
            AsosKind::Hourly => (format!("{a}00"), format!("{b}00")),
            AsosKind::Daily => (a.to_owned(), b.to_owned()),
        })
    }
    /// Legacy query order without `serviceKey`/`dataType` (appended by the funded transport).
    pub fn query(&self, page: u32) -> Vec<(&'static str, String)> {
        let mut out = vec![
            ("dataCd", "ASOS".to_owned()),
            (
                "dateCd",
                match self.kind {
                    AsosKind::Hourly => "HR",
                    AsosKind::Daily => "DAY",
                }
                .to_owned(),
            ),
            ("stnIds", self.station.clone()),
            ("startDt", self.start[..8].to_owned()),
            ("endDt", self.end[..8].to_owned()),
            ("pageNo", page.to_string()),
            ("numOfRows", ROWS.to_string()),
        ];
        if self.kind == AsosKind::Hourly {
            out.push(("startHh", self.start[8..10].to_owned()));
            out.push(("endHh", self.end[8..10].to_owned()));
        }
        out
    }
    fn start_publication(&self) -> Option<Publication> {
        let hour = match self.kind {
            AsosKind::Hourly => self.start[8..10].parse::<u16>().ok()? * 100,
            AsosKind::Daily => 0,
        };
        Publication::new(self.start[..8].parse().ok()?, hour)
    }
}
/// Legacy `policy.number`: a finite JSON number, or a string matching
/// `/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/` after `trim()`.
pub fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        Value::String(s) => {
            let t = s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
            let body = t.strip_prefix(['+', '-']).unwrap_or(t);
            let (int, frac) = body.split_once('.').unwrap_or((body, ""));
            let ok = digits(int) && digits(frac) && !(int.is_empty() && frac.is_empty());
            if !ok {
                return None;
            }
            let n: f64 = format!("{}{int}.{frac}0", if t.starts_with('-') { "-" } else { "" })
                .parse()
                .ok()?;
            n.is_finite().then_some(n)
        }
        _ => None,
    }
}
impl Paged for AsosRequest {
    fn service(&self) -> Service {
        Service::Asos
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::DataType
    }
    fn rotates(&self) -> bool {
        true
    }
    fn per_page(&self) -> u32 {
        ROWS
    }
    fn max_pages(&self) -> u32 {
        MAX_PAGES
    }
    fn kind(&self) -> &'static str {
        self.kind.kind()
    }
    fn provider_key(&self) -> RecordKey {
        Self::record_key(&self.station)
    }
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page == 0 || page > MAX_PAGES {
            return Err(DomesticError::Invalid("page number"));
        }
        let operation = match self.kind {
            AsosKind::Hourly => "1360000/AsosHourlyInfoService/getWthrDataList",
            AsosKind::Daily => "1360000/AsosDalyInfoService/getWthrDataList",
        };
        let mut url = endpoints
            .data_go_kr()
            .join(operation)
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query(page));
        Ok(url)
    }
    fn partition(&self, _: Publication) -> String {
        self.range_partition()
    }
    fn inspect(&self, page: u32, total: Option<u32>, json: &Value, _: i64) -> PageCheck {
        let header = json.get("response").and_then(|r| r.get("header"));
        let code = match header.and_then(|h| h.get("resultCode")) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => return PageCheck::Invalid("envelope"),
        };
        // `03`: no observation for the range yet (legacy fails the range; nothing is stored).
        if code == "03" && page == 1 {
            return PageCheck::NoData;
        }
        if code != "00" {
            return PageCheck::Invalid("result code");
        }
        let Some(body) = json.get("response").and_then(|r| r.get("body")) else {
            return PageCheck::Invalid("body");
        };
        let count = number(body.get("totalCount"));
        let echoed = number(body.get("pageNo"));
        let size = number(body.get("numOfRows"));
        let max = f64::from(MAX_PAGES * ROWS);
        let Some(count) = count.filter(|c| c.fract() == 0. && *c >= 0. && *c <= max) else {
            return PageCheck::Invalid("pagination");
        };
        if echoed != Some(f64::from(page))
            || size != Some(f64::from(ROWS))
            || total.is_some_and(|t| f64::from(t) != count)
        {
            return PageCheck::Invalid("pagination");
        }
        let count = count as u32;
        if count == 0 {
            // Legacy returns no rows; there is nothing to store.
            return PageCheck::NoData;
        }
        let items: Vec<&Value> = match body.get("items").and_then(|i| i.get("item")) {
            Some(Value::Array(a)) => a.iter().collect(),
            Some(v @ Value::Object(_)) => vec![v],
            None | Some(Value::Null) => Vec::new(),
            Some(_) => return PageCheck::Invalid("items"),
        };
        let before = (page - 1) * ROWS;
        if items.len() as u32 != ROWS.min(count.saturating_sub(before)) {
            return PageCheck::Invalid("truncated page");
        }
        // Legacy rejects a page whose items repeat an earlier page (`ASOS_REPEATED_PAGE`).
        let row_keys = vec![serde_json::to_string(&items).unwrap_or_default()];
        let Some(publication) = self.start_publication() else {
            return PageCheck::Invalid("range");
        };
        PageCheck::Valid(PageFacts {
            total: count,
            rows: items.len() as u32,
            row_keys,
            publication,
            usable: true,
        })
    }
}
