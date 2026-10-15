//! Bounded JSON adapter for `summary/v2/` objects: conditional create (`If-None-Match: *`),
//! GET and paged LIST. No other prefix, no overwrite, no delete, no SDK retries.
use crate::history::demand::DemandError;
use crate::history::transport::{body, decode_keys, headers, list_page, segment_ok, token_ok};
use crate::storage::{Error, HttpS3Transport, ListPage};
use crate::world::BoundedS3;
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use rusty_s3::S3Action;
use std::{future::Future, time::Duration};

pub const PREFIX: &str = "summary/v2/";
/// The largest summary body (a grid day summary is about 1 KiB).
pub const MAX_BYTES: usize = 64 * 1024;
const ACK_BYTES: usize = 8192;

fn key_ok(key: &str) -> bool {
    key.starts_with(PREFIX) && key.len() <= 512 && key.ends_with(".json") && segment_ok(key)
}
fn prefix_ok(prefix: &str) -> bool {
    prefix.starts_with(PREFIX)
        && prefix.len() <= 512
        && prefix.ends_with('/')
        && segment_ok(prefix.trim_end_matches('/'))
}
fn storage(e: DemandError) -> Error {
    match e {
        DemandError::Status(s) => Error::Status(s),
        DemandError::Transport => Error::Transport,
        DemandError::Invalid(m) => Error::Invalid(m),
        DemandError::Corrupt(_) | DemandError::Conflict => Error::Corrupt("summary object"),
    }
}

/// `summary/v2/` objects. `get_summary` is `None` for a missing object; `put_summary` creates an
/// absent object only and returns the exact HTTP status (412: the object exists).
pub trait SummaryTransport: Send + Sync + 'static {
    fn get_summary(&self, key: &str)
    -> impl Future<Output = Result<Option<Vec<u8>>, Error>> + Send;
    fn put_summary(
        &self,
        key: &str,
        body: &[u8],
    ) -> impl Future<Output = Result<u16, Error>> + Send;
    fn list_summary(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> impl Future<Output = Result<ListPage, Error>> + Send;
}

impl SummaryTransport for HttpS3Transport {
    async fn get_summary(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        if !key_ok(key) {
            return Err(Error::Invalid("summary key"));
        }
        let credentials = self
            .credentials
            .snapshot()
            .await
            .map_err(|_| Error::Transport)?;
        let url = self
            .bucket
            .get_object(Some(&credentials), key)
            .sign(Duration::from_secs(30));
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(None),
            s => return Err(Error::Status(s)),
        }
        let length = headers(&response, MAX_BYTES).map_err(storage)?;
        body(response, length, MAX_BYTES)
            .await
            .map(Some)
            .map_err(storage)
    }
    async fn put_summary(&self, key: &str, payload: &[u8]) -> Result<u16, Error> {
        if !key_ok(key) || payload.is_empty() || payload.len() > MAX_BYTES {
            return Err(Error::Invalid("summary object"));
        }
        let credentials = self
            .credentials
            .signing()
            .await
            .map_err(|_| Error::Transport)?;
        let digest = STANDARD.encode(Md5::digest(payload));
        let mut action = self.bucket.put_object(Some(&credentials), key);
        action.headers_mut().insert("if-none-match", "*");
        action.headers_mut().insert("content-md5", digest.as_str());
        action
            .headers_mut()
            .insert("content-type", "application/json");
        let url = action.sign(Duration::from_secs(30));
        let response = self
            .client
            .put(url)
            .header("if-none-match", "*")
            .header("content-md5", digest)
            .header("content-type", "application/json")
            .body(payload.to_vec())
            .send()
            .await
            .map_err(|_| Error::Ambiguous)?;
        let status = response.status().as_u16();
        if status == 200 {
            // A truncated acknowledgment is an unknown outcome; the caller re-reads.
            let length = headers(&response, ACK_BYTES).map_err(|_| Error::Ambiguous)?;
            body(response, length, ACK_BYTES)
                .await
                .map_err(|_| Error::Ambiguous)?;
        }
        Ok(status)
    }
    async fn list_summary(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        if !prefix_ok(prefix) || token.is_some_and(|t| !token_ok(t)) {
            return Err(Error::Invalid("summary list arguments"));
        }
        let bytes = list_page(self, prefix, token).await.map_err(storage)?;
        decode_keys(&bytes, prefix, key_ok)
            .map(|(keys, next)| ListPage { keys, next })
            .ok_or(Error::Corrupt("summary list"))
    }
}

/// Summary requests under the process S3 admission (12 in flight).
impl<T: SummaryTransport> SummaryTransport for BoundedS3<T> {
    async fn get_summary(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        let _permit = self.permit().await?;
        self.inner().get_summary(key).await
    }
    async fn put_summary(&self, key: &str, payload: &[u8]) -> Result<u16, Error> {
        let _permit = self.permit().await?;
        self.inner().put_summary(key, payload).await
    }
    async fn list_summary(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        let _permit = self.permit().await?;
        self.inner().list_summary(prefix, token).await
    }
}
impl<T: SummaryTransport> SummaryTransport for std::sync::Arc<T> {
    async fn get_summary(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        (**self).get_summary(key).await
    }
    async fn put_summary(&self, key: &str, payload: &[u8]) -> Result<u16, Error> {
        (**self).put_summary(key, payload).await
    }
    async fn list_summary(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        (**self).list_summary(prefix, token).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_stay_under_the_summary_prefix() {
        let sha = "a".repeat(64);
        assert!(key_ok(&format!(
            "summary/v2/grid/{sha}/20261014/1790000000000-000012-{sha}.json"
        )));
        assert!(!key_ok("summary/v2/../x.json"));
        assert!(!key_ok("raw/v2/x.json"));
        assert!(!key_ok("summary/v2/grid/x"));
        assert!(prefix_ok(&format!("summary/v2/grid/{sha}/20261014/")));
        assert!(!prefix_ok("summary/v2/grid"));
        assert!(!prefix_ok("index/v2/"));
    }
}
