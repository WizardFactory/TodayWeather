//! Keyless public-page transport (KMA web RSS/HTML). No credential, budget or retry policy here.
use super::{ProviderResponse, ProviderTransportError, transport::read_bounded};
use std::future::Future;

/// A validated keyless GET target. Construction rejects credentials and key parameters.
#[derive(Debug, Clone)]
pub struct PublicRequest {
    endpoint: reqwest::Url,
}
impl PublicRequest {
    pub fn new(endpoint: reqwest::Url) -> Result<Self, ProviderTransportError> {
        if !super::transport::valid_endpoint(&endpoint) {
            return Err(ProviderTransportError::Invalid);
        }
        Ok(Self { endpoint })
    }
    pub fn endpoint(&self) -> &reqwest::Url {
        &self.endpoint
    }
}
pub trait PublicTransport: Send + Sync {
    fn fetch(
        &self,
        request: &PublicRequest,
    ) -> impl Future<Output = Result<ProviderResponse, ProviderTransportError>> + Send;
}
/// Same body/header bounds as the funded transport. Redirects are followed at most three
/// times and only to the same scheme, host and port (legacy `request` followed redirects).
pub struct HttpPublicTransport {
    client: reqwest::Client,
    maximum: usize,
}
impl HttpPublicTransport {
    pub fn new(maximum: usize) -> Result<Self, ProviderTransportError> {
        if maximum == 0 || maximum > 8 * 1024 * 1024 {
            return Err(ProviderTransportError::Invalid);
        }
        let redirect = reqwest::redirect::Policy::custom(|attempt| {
            let Some(first) = attempt.previous().first() else {
                return attempt.stop();
            };
            let next = attempt.url();
            if attempt.previous().len() > 3
                || next.scheme() != first.scheme()
                || next.host_str() != first.host_str()
                || next.port_or_known_default() != first.port_or_known_default()
                || !super::transport::valid_endpoint(next)
            {
                return attempt.stop();
            }
            attempt.follow()
        });
        let client = reqwest::Client::builder()
            .http1_max_headers(32)
            .redirect(redirect)
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(super::transport::CONNECT_TIMEOUT)
            // Legacy `kmaScraper` 30 s per page (S13d); the caller deadline still bounds a call.
            .timeout(super::transport::legacy_timeout::KMA_WEB)
            .build()
            .map_err(|_| ProviderTransportError::Transport)?;
        Ok(Self { client, maximum })
    }
}
impl PublicTransport for HttpPublicTransport {
    async fn fetch(
        &self,
        request: &PublicRequest,
    ) -> Result<ProviderResponse, ProviderTransportError> {
        if !super::transport::valid_endpoint(&request.endpoint) {
            return Err(ProviderTransportError::Invalid);
        }
        let response = self
            .client
            .get(request.endpoint.clone())
            .send()
            .await
            .map_err(|_| ProviderTransportError::Transport)?;
        read_bounded(response, self.maximum).await
    }
}
