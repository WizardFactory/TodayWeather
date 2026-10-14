//! Domestic request families and arguments. Ported from collectTownForecast.getUrl,
//! lifeIndexKmaRequester.getUvUrlV5/getPollenUrlV3, TownRss.makeUrl and
//! KmaScraper.getAWSWeather/getCityWeather at ca8735cf. `serviceKey`/`dataType=JSON` are
//! appended only by the funded transport.
use super::{DomesticError, publication::Publication};
use crate::storage::ProviderKey as RecordKey;
use reqwest::Url;

/// data.go.kr service whose key position is kept independently (#2604 stickiness).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Service {
    VilageFcst,
    MidFcst,
    LivingWthrIdx,
    HealthWthrIdx,
    /// AirKorea B552584 (S13a observations; S13b dust forecast and station list). Keys follow
    /// legacy `airkoreaObservation.withKeys` (#2737), not the #2604 ring rotation.
    AirKorea,
    /// KASI RiseSetInfoService (S13a).
    RiseSet,
    /// data.go.kr FcstZoneInfoService `getFcstZoneCd` (S13b; legacy #2740).
    ForecastZone,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DataGoKrFamily {
    UltraSrtNcst,
    UltraSrtFcst,
    VilageFcst,
    MidFcst,
    MidLandFcst,
    MidTa,
    MidSeaFcst,
    UvIdxV5,
    OakPollenV3,
    PinePollenV3,
    WeedsPollenV3,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shape {
    Town,
    Mid,
    Life,
}
impl DataGoKrFamily {
    pub fn kind(self) -> &'static str {
        match self {
            Self::UltraSrtNcst => "ultra-srt-ncst",
            Self::UltraSrtFcst => "ultra-srt-fcst",
            Self::VilageFcst => "vilage-fcst",
            Self::MidFcst => "mid-fcst",
            Self::MidLandFcst => "mid-land-fcst",
            Self::MidTa => "mid-ta",
            Self::MidSeaFcst => "mid-sea-fcst",
            Self::UvIdxV5 => "uv-idx-v5",
            Self::OakPollenV3 => "oak-pollen-v3",
            Self::PinePollenV3 => "pine-pollen-v3",
            Self::WeedsPollenV3 => "weeds-pollen-v3",
        }
    }
    pub fn service(self) -> Service {
        match self {
            Self::UltraSrtNcst | Self::UltraSrtFcst | Self::VilageFcst => Service::VilageFcst,
            Self::MidFcst | Self::MidLandFcst | Self::MidTa | Self::MidSeaFcst => Service::MidFcst,
            Self::UvIdxV5 => Service::LivingWthrIdx,
            Self::OakPollenV3 | Self::PinePollenV3 | Self::WeedsPollenV3 => Service::HealthWthrIdx,
        }
    }
    /// Path below the data.go.kr root.
    pub fn operation(self) -> &'static str {
        match self {
            Self::UltraSrtNcst => "1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
            Self::UltraSrtFcst => "1360000/VilageFcstInfoService_2.0/getUltraSrtFcst",
            Self::VilageFcst => "1360000/VilageFcstInfoService_2.0/getVilageFcst",
            Self::MidFcst => "1360000/MidFcstInfoService/getMidFcst",
            Self::MidLandFcst => "1360000/MidFcstInfoService/getMidLandFcst",
            Self::MidTa => "1360000/MidFcstInfoService/getMidTa",
            Self::MidSeaFcst => "1360000/MidFcstInfoService/getMidSeaFcst",
            Self::UvIdxV5 => "1360000/LivingWthrIdxServiceV5/getUVIdxV5",
            Self::OakPollenV3 => "1360000/HealthWthrIdxServiceV3/getOakPollenRiskIdxV3",
            Self::PinePollenV3 => "1360000/HealthWthrIdxServiceV3/getPinePollenRiskIdxV3",
            Self::WeedsPollenV3 => "1360000/HealthWthrIdxServiceV3/getWeedsPollenRiskndxV3",
        }
    }
    /// Requested `numOfRows` (legacy 999 forecasts, 1000 life index).
    pub fn rows(self) -> u32 {
        if self.shape() == Shape::Life {
            1000
        } else {
            999
        }
    }
    /// Page cap: legacy KMA_MAX_PAGES=5; life index (3,851 areas, 4 pages) is bounded at 8.
    pub fn max_pages(self) -> u32 {
        if self.shape() == Shape::Life { 8 } else { 5 }
    }
    pub(crate) fn shape(self) -> Shape {
        match self.service() {
            Service::VilageFcst => Shape::Town,
            Service::MidFcst => Shape::Mid,
            Service::LivingWthrIdx | Service::HealthWthrIdx => Shape::Life,
            // Not a DataGoKrFamily service.
            Service::AirKorea | Service::RiseSet | Service::ForecastZone => Shape::Life,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Grid {
        nx: u16,
        ny: u16,
    },
    /// getMidFcst `stnId`.
    Station(String),
    /// Other mid-range `regId`.
    Region(String),
    /// Life index `areaNo=` (all areas).
    AllAreas,
}
fn code(c: &str) -> bool {
    (1..=16).contains(&c.len())
        && c.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}
fn grid(nx: u16, ny: u16) -> bool {
    (1..=149).contains(&nx) && (1..=253).contains(&ny)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataGoKrRequest {
    family: DataGoKrFamily,
    target: Target,
    publication: Publication,
}
impl DataGoKrRequest {
    pub fn new(
        family: DataGoKrFamily,
        target: Target,
        publication: Publication,
    ) -> Result<Self, DomesticError> {
        let (h, m) = (publication.hour(), publication.minute());
        let ok = match (family, &target) {
            (DataGoKrFamily::UltraSrtNcst, Target::Grid { nx, ny }) => grid(*nx, *ny) && m == 0,
            (DataGoKrFamily::UltraSrtFcst, Target::Grid { nx, ny }) => grid(*nx, *ny) && m == 30,
            (DataGoKrFamily::VilageFcst, Target::Grid { nx, ny }) => {
                grid(*nx, *ny) && m == 0 && h % 3 == 2
            }
            (DataGoKrFamily::MidFcst, Target::Station(c))
            | (
                DataGoKrFamily::MidLandFcst | DataGoKrFamily::MidTa | DataGoKrFamily::MidSeaFcst,
                Target::Region(c),
            ) => code(c) && matches!(publication.time(), 600 | 1800),
            (DataGoKrFamily::UvIdxV5, Target::AllAreas) => m == 0 && h % 3 == 0,
            (
                DataGoKrFamily::OakPollenV3
                | DataGoKrFamily::PinePollenV3
                | DataGoKrFamily::WeedsPollenV3,
                Target::AllAreas,
            ) => m == 0,
            _ => false,
        };
        if !ok {
            return Err(DomesticError::Invalid("request target or publication"));
        }
        Ok(Self {
            family,
            target,
            publication,
        })
    }
    pub fn family(&self) -> DataGoKrFamily {
        self.family
    }
    pub fn target(&self) -> &Target {
        &self.target
    }
    pub fn publication(&self) -> Publication {
        self.publication
    }
    /// Query pairs in legacy order, without `serviceKey`/`dataType`.
    pub fn query(&self, page: u32) -> Vec<(&'static str, String)> {
        let p = self.publication;
        let mut out = match &self.target {
            Target::Grid { nx, ny } => vec![
                ("base_date", p.base_date()),
                ("base_time", p.base_time()),
                ("nx", nx.to_string()),
                ("ny", ny.to_string()),
            ],
            Target::Station(c) => vec![("stnId", c.clone()), ("tmFc", p.compact())],
            Target::Region(c) => vec![("regId", c.clone()), ("tmFc", p.compact())],
            Target::AllAreas => Vec::new(),
        };
        out.push(("pageNo", page.to_string()));
        out.push(("numOfRows", self.family.rows().to_string()));
        if self.target == Target::AllAreas {
            out.push(("areaNo", String::new()));
            out.push(("time", p.compact()[..10].to_owned()));
        }
        out
    }
    pub fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<Url, DomesticError> {
        if page == 0 || page > self.family.max_pages() {
            return Err(DomesticError::Invalid("page number"));
        }
        let mut url = endpoints
            .data_go_kr
            .join(self.family.operation())
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        url.query_pairs_mut().extend_pairs(self.query(page));
        Ok(url)
    }
    /// Record identity key: provider grid, or a lower-cased code (codes are uppercase-only).
    pub fn provider_key(&self) -> RecordKey {
        match &self.target {
            Target::Grid { nx, ny } => RecordKey::Grid { nx: *nx, ny: *ny },
            Target::Station(c) => RecordKey::Named {
                id: format!("stn-{}", c.to_ascii_lowercase()),
            },
            Target::Region(c) => RecordKey::Named {
                id: format!("reg-{}", c.to_ascii_lowercase()),
            },
            Target::AllAreas => RecordKey::Named {
                id: "all-areas".into(),
            },
        }
    }
    /// Canonical publication of an echoed forecast `baseDate`/`baseTime`, and whether it is
    /// the requested one. Ultra-short HH30 requests are answered as HH00 (#2676).
    pub(crate) fn echo(&self, echo: Publication) -> (bool, Publication) {
        if self.family == DataGoKrFamily::UltraSrtFcst {
            let canonical = echo.hour_start();
            return (canonical == self.publication.hour_start(), canonical);
        }
        (echo == self.publication, echo)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WebFamily {
    TownRss,
    AwsMinute,
    AwsHourly,
    CityObservation,
}
impl WebFamily {
    pub fn kind(self) -> &'static str {
        match self {
            Self::TownRss => "town-rss",
            Self::AwsMinute => "aws-minute",
            Self::AwsHourly => "aws-hourly",
            Self::CityObservation => "city-obs",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebRequest {
    family: WebFamily,
    grid: Option<(u16, u16)>,
    publication: Option<Publication>,
}
impl WebRequest {
    pub fn town_rss(nx: u16, ny: u16) -> Result<Self, DomesticError> {
        if !grid(nx, ny) {
            return Err(DomesticError::Invalid("grid"));
        }
        Ok(Self {
            family: WebFamily::TownRss,
            grid: Some((nx, ny)),
            publication: None,
        })
    }
    /// Latest minute page; an older page than `not_before` is reported as stale.
    pub fn aws_minute(not_before: Option<Publication>) -> Self {
        Self {
            family: WebFamily::AwsMinute,
            grid: None,
            publication: not_before,
        }
    }
    /// Minimum acceptable publication for grid RSS or the minute page (for example
    /// `publication::rss_latest` or the last stored one); an older page is `Stale`.
    pub fn not_before(mut self, minimum: Publication) -> Result<Self, DomesticError> {
        if !matches!(self.family, WebFamily::TownRss | WebFamily::AwsMinute) {
            return Err(DomesticError::Invalid("minimum publication"));
        }
        self.publication = Some(minimum);
        Ok(self)
    }
    pub fn aws_hourly(hour: Publication) -> Result<Self, DomesticError> {
        Self::hourly(WebFamily::AwsHourly, hour)
    }
    pub fn city(hour: Publication) -> Result<Self, DomesticError> {
        Self::hourly(WebFamily::CityObservation, hour)
    }
    fn hourly(family: WebFamily, hour: Publication) -> Result<Self, DomesticError> {
        if hour.minute() != 0 {
            return Err(DomesticError::Invalid("observation hour"));
        }
        Ok(Self {
            family,
            grid: None,
            publication: Some(hour),
        })
    }
    pub fn family(&self) -> WebFamily {
        self.family
    }
    pub fn grid(&self) -> Option<(u16, u16)> {
        self.grid
    }
    /// Requested (hourly/city) or minimum (minute) publication.
    pub fn publication(&self) -> Option<Publication> {
        self.publication
    }
    pub fn endpoint(&self, endpoints: &Endpoints) -> Result<Url, DomesticError> {
        let invalid = |_| DomesticError::Invalid("endpoint");
        let mut url = match self.family {
            WebFamily::TownRss => endpoints.kma.join("wid/queryDFS.jsp").map_err(invalid)?,
            WebFamily::AwsMinute | WebFamily::AwsHourly => endpoints
                .weather
                .join("cgi-bin/aws/nph-aws_txt_min")
                .map_err(invalid)?,
            WebFamily::CityObservation => endpoints
                .weather
                .join("weather/observation/currentweather.jsp")
                .map_err(invalid)?,
        };
        match (self.family, self.grid, self.publication) {
            (WebFamily::TownRss, Some((x, y)), _) => {
                url.query_pairs_mut()
                    .append_pair("gridx", &x.to_string())
                    .append_pair("gridy", &y.to_string());
            }
            (WebFamily::AwsHourly, _, Some(p)) => {
                url.set_query(Some(&format!("{}&0&MINDB_60M&0&m", p.compact())));
            }
            (WebFamily::CityObservation, _, Some(p)) => {
                let d = p.date();
                url.set_query(Some(&format!(
                    "tm={:04}.{:02}.{:02}.{:02}:00",
                    d / 10000,
                    (d / 100) % 100,
                    d % 100,
                    p.hour()
                )));
            }
            (WebFamily::AwsMinute, _, _) => {}
            _ => return Err(DomesticError::Invalid("web request")),
        }
        Ok(url)
    }
    pub fn provider_key(&self) -> RecordKey {
        match (self.family, self.grid) {
            (WebFamily::TownRss, Some((nx, ny))) => RecordKey::Grid { nx, ny },
            (WebFamily::CityObservation, _) => RecordKey::Named {
                id: "city-national".into(),
            },
            _ => RecordKey::Named {
                id: "aws-national".into(),
            },
        }
    }
    /// Catalog partition: grid RSS by publication; observation pages by KST day.
    pub(crate) fn partition(&self, publication: Publication) -> String {
        match self.family {
            WebFamily::TownRss => publication.partition(),
            _ => publication.base_date(),
        }
    }
}

/// Provider roots. Defaults use HTTPS (legacy used HTTP for these hosts); tests may use
/// literal loopback HTTP. No credentials, query or fragment.
#[derive(Debug, Clone)]
pub struct Endpoints {
    data_go_kr: Url,
    kma: Url,
    weather: Url,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self::new(
            "https://apis.data.go.kr/",
            "https://www.kma.go.kr/",
            "https://www.weather.go.kr/",
        )
        .expect("static endpoints")
    }
}
fn root(s: &str) -> Result<Url, DomesticError> {
    let url: Url = s.parse().map_err(|_| DomesticError::Invalid("endpoint"))?;
    if !crate::providers::valid_endpoint(&url)
        || url.query().is_some()
        || !url.path().ends_with('/')
    {
        return Err(DomesticError::Invalid("endpoint"));
    }
    Ok(url)
}
impl Endpoints {
    pub fn new(data_go_kr: &str, kma: &str, weather: &str) -> Result<Self, DomesticError> {
        Ok(Self {
            data_go_kr: root(data_go_kr)?,
            kma: root(kma)?,
            weather: root(weather)?,
        })
    }
    pub(crate) fn data_go_kr(&self) -> &Url {
        &self.data_go_kr
    }
}
