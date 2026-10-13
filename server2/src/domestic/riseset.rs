//! KASI area sunrise/sunset (S13a). Ported from `controllers/kasi.riseset.controller.js`
//! (`_makeAreaApiUrl`, `_checkDataValid`, `_apiRaw2modelKasiRiseSet`) and
//! `models/modelKasiRiseSet.js` (`getAreaList`, `getDataPropertyList`) at 45e9193b. The
//! coordinate API `getLCRiseSetInfo` is not ported: legacy never reaches it.
use super::DomesticError;
use super::acquire::{PageCheck, PageFacts, Paged};
use super::family::{Endpoints, Service};
use super::publication::Publication;
use crate::providers::ResponseFormat;
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;
use serde_json::Value;

/// Legacy `getAreaList` (102 KASI area names).
pub const AREAS: [&str; 102] = [
    "강릉",
    "강화도",
    "거제",
    "거창",
    "경산",
    "경주",
    "고성(강원)",
    "고양",
    "고흥",
    "광양",
    "광주",
    "광주(경기)",
    "구미",
    "군산",
    "김천",
    "김해",
    "남원",
    "남해",
    "대관령",
    "대구",
    "대덕",
    "대전",
    "독도",
    "동해",
    "마산",
    "목포",
    "무안",
    "밀양",
    "변산",
    "보령",
    "보성",
    "보현산",
    "부산",
    "부안",
    "부천",
    "사천",
    "삼척",
    "상주",
    "서귀포",
    "서산",
    "서울",
    "서천",
    "성산일출봉",
    "세종",
    "소백산",
    "속초",
    "수원",
    "순천",
    "승주",
    "시흥",
    "아산",
    "안동",
    "안산",
    "안양",
    "양양",
    "양평",
    "여수",
    "여수공항",
    "여주",
    "영광",
    "영덕",
    "영월",
    "영주",
    "영천",
    "완도",
    "용인",
    "울릉도",
    "울산",
    "울진",
    "원주",
    "의성",
    "익산",
    "인천",
    "임실",
    "장수",
    "장흥",
    "전주",
    "정읍",
    "제주",
    "제주(레)",
    "제천",
    "주문진",
    "진도",
    "진주",
    "진해",
    "창원",
    "천안",
    "청주",
    "청주공항",
    "추풍령",
    "춘양",
    "춘천",
    "충주",
    "태백",
    "태안",
    "통영",
    "파주",
    "평택",
    "포항",
    "해남",
    "화성",
    "흑산도",
];
/// Legacy `getDataPropertyList`: each must be a number or a string (`'------'` = none).
const FIELDS: [&str; 12] = [
    "sunrise",
    "suntransit",
    "sunset",
    "moonrise",
    "moontransit",
    "moonset",
    "civilm",
    "civile",
    "nautm",
    "naute",
    "astm",
    "aste",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiseSetRequest {
    area: &'static str,
    locdate: Publication,
}
impl RiseSetRequest {
    /// One legacy area and one KST calendar day (`YYYYMMDD`).
    pub fn new(area: &str, locdate: u32) -> Result<Self, DomesticError> {
        let area = AREAS
            .iter()
            .find(|a| **a == area)
            .copied()
            .ok_or(DomesticError::Invalid("area"))?;
        let locdate = Publication::new(locdate, 0).ok_or(DomesticError::Invalid("locdate"))?;
        Ok(Self { area, locdate })
    }
    pub fn area(&self) -> &str {
        self.area
    }
    pub fn locdate(&self) -> u32 {
        self.locdate.date()
    }
    /// Family query pairs in legacy order without `_type`/`ServiceKey`.
    pub fn query(&self) -> Vec<(&'static str, String)> {
        vec![
            ("location", self.area.to_owned()),
            ("locdate", self.locdate.base_date()),
        ]
    }
}
fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.trim().to_owned()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl Paged for RiseSetRequest {
    fn service(&self) -> Service {
        Service::RiseSet
    }
    fn format(&self) -> ResponseFormat {
        ResponseFormat::UnderscoreType
    }
    fn rotates(&self) -> bool {
        true
    }
    fn per_page(&self) -> u32 {
        1
    }
    fn max_pages(&self) -> u32 {
        1
    }
    fn kind(&self) -> &'static str {
        "kasi-area-rise-set"
    }
    /// The UTF-8 area name in lowercase hex (record keys are ASCII tokens).
    fn provider_key(&self) -> RecordKey {
        RecordKey::Named {
            id: format!(
                "area-{}",
                self.area
                    .bytes()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            ),
        }
    }
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page != 1 {
            return Err(DomesticError::Invalid("page number"));
        }
        let mut url = endpoints
            .data_go_kr()
            .join("B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo")
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query());
        Ok(url)
    }
    fn partition(&self, publication: Publication) -> String {
        publication.base_date()
    }
    fn inspect(&self, page: u32, _: Option<u32>, json: &Value, _now_ms: i64) -> PageCheck {
        let Some(response) = json.get("response") else {
            return PageCheck::Invalid("envelope");
        };
        // Legacy `resultCode != '00'` (loose, so a numeric 0 also passes).
        if !response
            .get("header")
            .and_then(|h| h.get("resultCode"))
            .and_then(text)
            .is_some_and(|c| matches!(c.as_str(), "00" | "0"))
        {
            return PageCheck::Invalid("result code");
        }
        let body = response.get("body");
        let Some(item) = body
            .and_then(|b| b.get("items"))
            .and_then(|i| i.get("item"))
            .and_then(Value::as_object)
        else {
            return PageCheck::Invalid("item");
        };
        if body
            .and_then(|b| b.get("totalCount"))
            .is_some_and(|t| text(t).as_deref() != Some("1"))
            || page != 1
        {
            return PageCheck::Invalid("item count");
        }
        if item.get("location").and_then(Value::as_str) != Some(self.area)
            || item.get("locdate").and_then(text) != Some(self.locdate.base_date())
            || !FIELDS
                .iter()
                .all(|f| matches!(item.get(*f), Some(Value::String(_) | Value::Number(_))))
        {
            return PageCheck::Invalid("rise/set item");
        }
        PageCheck::Valid(PageFacts {
            total: 1,
            rows: 1,
            row_keys: vec![self.locdate.base_date()],
            publication: self.locdate,
            usable: true,
        })
    }
}
