//! Visual Crossing HTTP transport with the legacy `vcRequester._get` semantics: one GET with
//! `Accept-Encoding: gzip`, a 4 MiB raw body cap, gzip decoding, the call deadline as the only
//! timeout, and socket resets (`ECONNRESET`/`EPIPE`, including a connection closed before the
//! response) classified separately so the requester can retry them once.
use crate::gateway::BoxFuture;
use crate::observability::ObservedHttp as _;
use std::{io::Read, time::Duration};
use tokio::time::{Instant, timeout_at};

/// Legacy `MAX_BODY_BYTES` (raw bytes on the wire).
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
/// Decoded gzip bodies are bounded too (a combined body is about 70 KB).
const MAX_DECODED_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VcTransportError {
    /// The connection was reset or closed before a complete response (legacy RESET_CODES).
    Reset,
    /// Deadline, refused connection, oversized/undecodable body or any other failure.
    Failed,
}
/// Status and decoded body of one VC response. No Debug: the body is provider data only.
pub struct VcResponse {
    pub status: u16,
    pub body: Vec<u8>,
}
pub trait VcTransport: Send + Sync + 'static {
    /// GET `url` (which carries the key; never logged) before `deadline`.
    fn get(
        &self,
        url: reqwest::Url,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<VcResponse, VcTransportError>>;
}
fn io_reset(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut source = Some(error);
    while let Some(e) = source {
        if let Some(io) = e.downcast_ref::<std::io::Error>()
            && matches!(
                io.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
            )
        {
            return true;
        }
        // Node reports a peer that closes without a response as ECONNRESET ("socket hang up").
        if let Some(h) = e.downcast_ref::<hyper::Error>()
            && h.is_incomplete_message()
        {
            return true;
        }
        source = e.source();
    }
    false
}
fn classify(error: &reqwest::Error) -> VcTransportError {
    if io_reset(error) {
        VcTransportError::Reset
    } else {
        VcTransportError::Failed
    }
}
pub struct HttpVcTransport {
    client: reqwest::Client,
}
impl HttpVcTransport {
    pub fn new() -> Result<Self, VcTransportError> {
        let client = reqwest::Client::builder()
            .http1_max_headers(64)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| VcTransportError::Failed)?;
        Ok(Self { client })
    }
}
impl VcTransport for HttpVcTransport {
    fn get(
        &self,
        url: reqwest::Url,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<VcResponse, VcTransportError>> {
        Box::pin(async move {
            let call = async {
                let mut response = self
                    .client
                    .get(url)
                    .header("accept-encoding", "gzip")
                    .send()
                    .observed(crate::observability::Component::World)
                    .await
                    .map_err(|e| classify(&e))?;
                let status = response.status().as_u16();
                let gzip = response
                    .headers()
                    .get("content-encoding")
                    .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"gzip"));
                let mut raw = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(|e| classify(&e))? {
                    if chunk.len() > MAX_BODY_BYTES.saturating_sub(raw.len()) {
                        return Err(VcTransportError::Failed);
                    }
                    raw.extend_from_slice(&chunk);
                }
                let body = if gzip {
                    let mut out = Vec::new();
                    flate2::read::GzDecoder::new(raw.as_slice())
                        .take(MAX_DECODED_BYTES as u64 + 1)
                        .read_to_end(&mut out)
                        .map_err(|_| VcTransportError::Failed)?;
                    if out.len() > MAX_DECODED_BYTES {
                        return Err(VcTransportError::Failed);
                    }
                    out
                } else {
                    raw
                };
                Ok(VcResponse { status, body })
            };
            timeout_at(deadline, call)
                .await
                .map_err(|_| VcTransportError::Failed)?
        })
    }
}
