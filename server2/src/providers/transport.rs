use super::ProviderKey;
use crate::budget::Provider;
use std::{future::Future, net::IpAddr, time::Duration};
/// Credential and response-format parameters a data.go.kr-style service declares (S13a).
/// `DataType` is the S13 default; the others are the legacy forms of services that do not
/// accept `dataType`. The transport appends them after the family query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
pub enum ResponseFormat {
    /// `serviceKey=<key>&dataType=JSON` (VilageFcst, MidFcst, life index).
    #[default]
    DataType,
    /// `serviceKey=<key>&returnType=json` (AirKorea B552584, `airkoreaObservation.buildUrl`).
    ReturnType,
    /// `_type=json&ServiceKey=<key>` (KASI RiseSetInfoService, `kasi.riseset.controller`).
    UnderscoreType,
    /// `type=json&ServiceKey=<key>` (newsky2 ForecastZoneInfoService, `kma.forecast.zone`).
    Type,
}
impl ResponseFormat {
    /// Credential parameter name, spelled as legacy sends it.
    pub fn key_param(self) -> &'static str {
        match self {
            Self::DataType | Self::ReturnType => "serviceKey",
            Self::UnderscoreType | Self::Type => "ServiceKey",
        }
    }
    /// Format parameter name and value, spelled as legacy sends it.
    pub fn format_param(self) -> (&'static str, &'static str) {
        match self {
            Self::DataType => ("dataType", "JSON"),
            Self::ReturnType => ("returnType", "json"),
            Self::UnderscoreType => ("_type", "json"),
            Self::Type => ("type", "json"),
        }
    }
    /// Legacy order: the credential first for the data.go.kr 2.0 and B552584 builders, last
    /// for the KASI and newsky2 URL builders.
    fn key_first(self) -> bool {
        matches!(self, Self::DataType | Self::ReturnType)
    }
    /// Header result codes that mean success. The newsky2 services answer `0000`.
    pub fn success_codes(self) -> &'static [&'static str] {
        match self {
            Self::Type => &["0", "00", "0000"],
            _ => &["0", "00"],
        }
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
pub struct HttpProviderTransport {
    client: reqwest::Client,
    maximum: usize,
}
impl HttpProviderTransport {
    pub fn new(maximum: usize) -> Result<Self, ProviderTransportError> {
        if maximum == 0 || maximum > 8 * 1024 * 1024 {
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
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| ProviderTransportError::Transport)?;
        Ok(Self { client, maximum })
    }
}
impl ProviderTransport for HttpProviderTransport {
    async fn send(&self, request: &Request) -> Result<ProviderResponse, ProviderTransportError> {
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
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| ProviderTransportError::Transport)?;
        read_bounded(response, self.maximum).await
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
