use super::ProviderKey;
use crate::budget::Provider;
use crate::observability::ObservedHttp as _;
use std::{future::Future, net::IpAddr, time::Duration};
/// Credential and response-format parameters a data.go.kr-style service declares (S13a).
/// `DataType` is the S13 default; the others are the legacy forms of services that do not
/// accept `dataType`. The transport appends them after the family query. S13b removed the
/// newsky2-only `type=json` form: the forecast-zone list moved to data.go.kr `getFcstZoneCd`
/// with `dataType=JSON` (legacy #2740).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
pub enum ResponseFormat {
    /// `serviceKey=<key>&dataType=JSON` (VilageFcst, MidFcst, life index).
    #[default]
    DataType,
    /// `serviceKey=<key>&returnType=json` (AirKorea B552584, `airkoreaObservation.buildUrl`).
    ReturnType,
    /// `_type=json&ServiceKey=<key>` (KASI RiseSetInfoService, `kasi.riseset.controller`).
    UnderscoreType,
}
impl ResponseFormat {
    /// Credential parameter name, spelled as legacy sends it.
    pub fn key_param(self) -> &'static str {
        match self {
            Self::DataType | Self::ReturnType => "serviceKey",
            Self::UnderscoreType => "ServiceKey",
        }
    }
    /// Format parameter name and value, spelled as legacy sends it.
    pub fn format_param(self) -> (&'static str, &'static str) {
        match self {
            Self::DataType => ("dataType", "JSON"),
            Self::ReturnType => ("returnType", "json"),
            Self::UnderscoreType => ("_type", "json"),
        }
    }
    /// Legacy order: the credential first for the data.go.kr 2.0 and B552584 builders, last
    /// for the KASI URL builder.
    fn key_first(self) -> bool {
        matches!(self, Self::DataType | Self::ReturnType)
    }
    /// Header result codes that mean success (the same for every remaining format).
    pub fn success_codes(self) -> &'static [&'static str] {
        &["0", "00"]
    }
    /// The family query must not already carry a credential (any case) or format parameter.
    pub(crate) fn admits(self, url: &reqwest::Url) -> bool {
        let (format, _) = self.format_param();
        !url.query_pairs()
            .any(|(k, _)| k.eq_ignore_ascii_case("servicekey") || k == format || k == "dataType")
    }
}
/// No Debug: URL/query and key are privately held, never budget metadata or diagnostics.
pub struct Request {
    pub(crate) endpoint: reqwest::Url,
    pub(crate) key: ProviderKey,
    pub(crate) provider: Provider,
    pub(crate) format: ResponseFormat,
}
impl Request {
    /// The declared response format (the credential itself is never exposed).
    pub fn format(&self) -> ResponseFormat {
        self.format
    }
}
pub struct ProviderResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTransportError {
    Invalid,
    Transport,
    /// Status received, but headers/body were rejected or not completely downloaded.
    /// Carries no partial body, URL or credential; never a successful provider response.
    Response {
        status: u16,
    },
}
pub trait ProviderTransport: Send + Sync {
    fn send(
        &self,
        request: &Request,
    ) -> impl Future<Output = Result<ProviderResponse, ProviderTransportError>> + Send;
}
/// Connect bound shared by the provider transports; each attempt's total time is the
/// service's legacy timeout ([`attempt_timeout`]).
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Legacy per-request timeouts (S13d, AK 2026-10-14). server2 serves user requests, but a
/// request never waits for these: owned background acquisitions do, and a request uses what is
/// ready within its own 3-second bound.
pub mod legacy_timeout {
    use std::time::Duration;
    /// `collectTownForecast._requestPage` (VilageFcst 2.0, MidFcst) and the forecast-zone
    /// controller (`getFcstZoneCd`).
    pub const TOWN_FORECAST: Duration = Duration::from_secs(10);
    /// `lifeIndexKmaRequester` (UV V5, pollen V3).
    pub const LIFE_INDEX: Duration = Duration::from_secs(30);
    /// `kmaWarningRequester` `TIMEOUT_MS`.
    pub const WARNINGS: Duration = Duration::from_secs(30);
    /// `airkoreaObservation` default `timeoutMs` (all B552584 operations).
    pub const AIRKOREA: Duration = Duration::from_secs(5);
    /// `kasi.riseset.controller`.
    pub const KASI: Duration = Duration::from_secs(5);
    /// `DsfController.fetchTimeoutMs` (the S11 world VC call budget).
    pub const VISUAL_CROSSING: Duration = Duration::from_secs(8);
    /// `lib/history/provider.js` `timeout` (ASOS hourly/daily ranges, S15b-2).
    pub const ASOS: Duration = Duration::from_secs(10);
    /// `kmaScraper` AWS/city pages; legacy town RSS had no timeout, so every KMA web page gets
    /// the scraper value.
    pub const KMA_WEB: Duration = Duration::from_secs(30);
    /// A data.go.kr path that names none of the services above keeps the former bound.
    pub const OTHER: Duration = Duration::from_secs(3);
}
/// The legacy timeout of one HTTP attempt to `endpoint`, chosen by the data.go.kr service
/// named in its path (`1360000/<Service>/<operation>`, `B552584/...`, `B090041/...`).
pub fn attempt_timeout(provider: Provider, endpoint: &reqwest::Url) -> Duration {
    use legacy_timeout as t;
    if provider == Provider::VisualCrossing {
        return t::VISUAL_CROSSING;
    }
    let segments: Vec<&str> = endpoint
        .path_segments()
        .map(Iterator::collect)
        .unwrap_or_default();
    for (i, segment) in segments.iter().enumerate() {
        let service = segments.get(i + 1).copied();
        match (*segment, service) {
            (
                "1360000",
                Some("VilageFcstInfoService_2.0" | "MidFcstInfoService" | "FcstZoneInfoService"),
            ) => return t::TOWN_FORECAST,
            ("1360000", Some("LivingWthrIdxServiceV5" | "HealthWthrIdxServiceV3")) => {
                return t::LIFE_INDEX;
            }
            ("1360000", Some("WthrWrnInfoService")) => return t::WARNINGS,
            ("1360000", Some("AsosHourlyInfoService" | "AsosDalyInfoService")) => return t::ASOS,
            ("B552584", Some(_)) => return t::AIRKOREA,
            ("B090041", Some(_)) => return t::KASI,
            _ => (),
        }
    }
    t::OTHER
}
pub struct HttpProviderTransport {
    client: reqwest::Client,
    maximum: usize,
}
impl HttpProviderTransport {
    pub fn new(maximum: usize) -> Result<Self, ProviderTransportError> {
        Self::with_connect_timeout(maximum, CONNECT_TIMEOUT)
    }
    /// A transport whose connection (TCP and TLS) may take `connect`, for a service whose legacy
    /// timer also covers connecting (AirKorea: `airkoreaObservation` starts its 5 s timer before
    /// `https.get`). Each attempt keeps its [`attempt_timeout`]; `connect` is at most the
    /// longest legacy timeout.
    pub fn with_connect_timeout(
        maximum: usize,
        connect: Duration,
    ) -> Result<Self, ProviderTransportError> {
        if maximum == 0
            || maximum > 8 * 1024 * 1024
            || connect.is_zero()
            || connect > legacy_timeout::KMA_WEB
        {
            return Err(ProviderTransportError::Invalid);
        }
        let client = reqwest::Client::builder()
            .http1_max_headers(32)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(connect)
            .build()
            .map_err(|_| ProviderTransportError::Transport)?;
        Ok(Self { client, maximum })
    }
}
impl ProviderTransport for HttpProviderTransport {
    async fn send(&self, request: &Request) -> Result<ProviderResponse, ProviderTransportError> {
        crate::observability::observe_response(
            crate::observability::Component::Provider,
            crate::observability::Stage::ProviderHttp,
            |response: &ProviderResponse| response.status,
            async {
                let mut url = request.endpoint.clone();
                if !valid_endpoint(&url) {
                    return Err(ProviderTransportError::Invalid);
                }
                {
                    let mut query = url.query_pairs_mut();
                    match request.provider {
                        Provider::DataGoKr => {
                            let format = request.format;
                            if !format.admits(&request.endpoint) {
                                return Err(ProviderTransportError::Invalid);
                            }
                            let (name, value) = format.format_param();
                            if format.key_first() {
                                query.append_pair(format.key_param(), &request.key.0);
                                query.append_pair(name, value);
                            } else {
                                query.append_pair(name, value);
                                query.append_pair(format.key_param(), &request.key.0);
                            }
                        }
                        Provider::VisualCrossing => {
                            query.append_pair("key", &request.key.0);
                        }
                        // Geocoding and air providers use their own transports.
                        Provider::Kakao
                        | Provider::Google
                        | Provider::GoogleAirQuality
                        | Provider::OpenWeather
                        | Provider::Waqi => return Err(ProviderTransportError::Invalid),
                    }
                }
                let timeout = attempt_timeout(request.provider, &request.endpoint);
                let response = self
                    .client
                    .get(url)
                    .timeout(timeout)
                    .send()
                    .observed(crate::observability::Component::Provider)
                    .await
                    .map_err(|_| ProviderTransportError::Transport)?;
                read_bounded(response, self.maximum).await
            },
        )
        .await
    }
}

/// Shared header/body bounds for funded and keyless provider responses.
pub(crate) async fn read_bounded(
    mut response: reqwest::Response,
    maximum: usize,
) -> Result<ProviderResponse, ProviderTransportError> {
    let status = response.status().as_u16();
    let headers = response.headers();
    if headers
        .iter()
        .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
        .sum::<usize>()
        > 8192
        || headers.contains_key("content-encoding")
    {
        return Err(ProviderTransportError::Response { status });
    }
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if content_type.len() > 512 {
        return Err(ProviderTransportError::Response { status });
    }
    if response
        .content_length()
        .is_some_and(|n| n > maximum as u64)
    {
        return Err(ProviderTransportError::Response { status });
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ProviderTransportError::Response { status })?
    {
        if chunk.len() > maximum.saturating_sub(body.len()) {
            return Err(ProviderTransportError::Response { status });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(ProviderResponse {
        status,
        content_type,
        body,
    })
}

pub(crate) fn valid_endpoint(url: &reqwest::Url) -> bool {
    let loopback = url
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    (url.scheme() == "https" || (url.scheme() == "http" && loopback))
        && url.as_str().len() <= 4096
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && !url
            .query_pairs()
            .any(|(k, _)| matches!(k.as_ref(), "serviceKey" | "dataType" | "key"))
}
