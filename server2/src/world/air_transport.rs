//! Air provider HTTP (S13a), ported from `lib/air/httpClient.js` at 45e9193b: one request with
//! a fixed timeout and no retry. Google is a JSON POST; OpenWeather and WAQI are GETs. The key
//! travels only inside the URL and is never logged, stored or returned in an error.
use crate::gateway::BoxFuture;
use crate::observability::ObservedHttp as _;
use std::{net::IpAddr, time::Duration};
use tokio::time::{Instant, timeout_at};

/// No Debug: the URL carries the credential.
pub struct AirHttpRequest {
    pub(crate) url: reqwest::Url,
    pub(crate) post_json: Option<Vec<u8>>,
}
impl AirHttpRequest {
    pub fn is_post(&self) -> bool {
        self.post_json.is_some()
    }
}
pub struct AirHttpResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AirHttpError {
    /// Legacy `timeout` (ECONNABORTED).
    Timeout,
    /// Legacy `transport`: no usable response.
    Transport,
    /// Not an HTTPS (or literal loopback HTTP) target.
    Invalid,
}
pub trait AirTransport: Send + Sync + 'static {
    fn send(
        &self,
        request: AirHttpRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<AirHttpResponse, AirHttpError>>;
}
/// HTTPS, or HTTP to a literal loopback address (tests and local smoke).
pub(crate) fn valid_base(url: &reqwest::Url) -> bool {
    let loopback = url
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    (url.scheme() == "https" || (url.scheme() == "http" && loopback))
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.query().is_none()
        && url.path().ends_with('/')
}
pub struct HttpAirTransport {
    client: reqwest::Client,
    maximum: usize,
}
impl HttpAirTransport {
    /// 1 MiB body bound (the provider bodies are a few KiB); no redirects, proxy or decoding.
    pub fn new() -> Result<Self, AirHttpError> {
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
            .build()
            .map_err(|_| AirHttpError::Transport)?;
        Ok(Self {
            client,
            maximum: 1024 * 1024,
        })
    }
}
impl AirTransport for HttpAirTransport {
    fn send(
        &self,
        request: AirHttpRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<AirHttpResponse, AirHttpError>> {
        Box::pin(async move {
            let mut base = request.url.clone();
            base.set_query(None);
            base.set_path("/");
            if !valid_base(&base) || request.url.as_str().len() > 4096 {
                return Err(AirHttpError::Invalid);
            }
            let builder = match request.post_json {
                Some(body) => self
                    .client
                    .post(request.url)
                    .header("content-type", "application/json")
                    .body(body),
                None => self.client.get(request.url),
            };
            let work = async {
                let response = builder
                    .send()
                    .observed(crate::observability::Component::World)
                    .await
                    .map_err(|_| AirHttpError::Transport)?;
                match crate::providers::read_bounded(response, self.maximum).await {
                    Ok(r) => Ok(r),
                    // An error status keeps its class (auth/quota/http) without its body; an
                    // unreadable 2xx body is never data.
                    Err(crate::providers::ProviderTransportError::Response { status })
                        if !(200..300).contains(&status) =>
                    {
                        Ok(crate::providers::ProviderResponse {
                            status,
                            content_type: String::new(),
                            body: Vec::new(),
                        })
                    }
                    Err(_) => Err(AirHttpError::Transport),
                }
            };
            match timeout_at(deadline, work).await {
                Err(_) => Err(AirHttpError::Timeout),
                Ok(Err(e)) => Err(e),
                Ok(Ok(r)) => Ok(AirHttpResponse {
                    status: r.status,
                    content_type: r.content_type,
                    body: r.body,
                }),
            }
        })
    }
}
