use super::ProviderKey;
use crate::budget::Provider;
use std::{future::Future, net::IpAddr, time::Duration};
/// No Debug: URL/query and key are privately held, never budget metadata or diagnostics.
pub struct Request {
    pub(crate) endpoint: reqwest::Url,
    pub(crate) key: ProviderKey,
    pub(crate) provider: Provider,
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
                    query.append_pair("serviceKey", &request.key.0);
                    query.append_pair("dataType", "JSON");
                }
                Provider::VisualCrossing => {
                    query.append_pair("key", &request.key.0);
                }
            }
        }
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| ProviderTransportError::Transport)?;
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
            .is_some_and(|n| n > self.maximum as u64)
        {
            return Err(ProviderTransportError::Response { status });
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| ProviderTransportError::Response { status })?
        {
            if chunk.len() > self.maximum.saturating_sub(body.len()) {
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
