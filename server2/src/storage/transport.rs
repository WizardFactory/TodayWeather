use super::{Error, Object, ObjectTransport, PreparedRecord};
use reqwest::{Client, Method, redirect::Policy};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use std::{collections::BTreeMap, net::IpAddr, sync::Arc, time::Duration};
use tokio::{sync::RwLock, time::timeout};
/// Caller-managed credential handle. No discovery, refresh task, Debug or credential diagnostics.
/// Replace before expiry; each request uses one coherent snapshot. In-flight requests retain it.
#[derive(Clone)]
pub struct RefreshableCredentials(Arc<RwLock<Credentials>>);
impl RefreshableCredentials {
    pub fn new(credentials: Credentials) -> Self {
        Self(Arc::new(RwLock::new(credentials)))
    }
    /// Async wait is bounded; callers must await replacement before relying on new credentials.
    pub async fn replace(&self, credentials: Credentials) -> Result<(), Error> {
        let mut held = timeout(Duration::from_secs(3), self.0.write())
            .await
            .map_err(|_| Error::Timeout)?;
        *held = credentials;
        Ok(())
    }
    pub(super) async fn snapshot(&self) -> Result<Credentials, Error> {
        let held = timeout(Duration::from_secs(3), self.0.read())
            .await
            .map_err(|_| Error::Timeout)?;
        Ok(held.clone())
    }
}
/// SigV4 HTTP adapter. Credentials are supplied/refreshed by the caller; never discovered here.
/// No Debug implementation: neither credentials nor signed URLs belong in diagnostics.
pub struct HttpS3Transport {
    pub(super) client: Client,
    pub(super) bucket: Bucket,
    pub(super) credentials: RefreshableCredentials,
}
impl HttpS3Transport {
    pub fn new(
        endpoint: &str,
        bucket: &str,
        region: &str,
        credentials: Credentials,
    ) -> Result<Self, Error> {
        Self::with_credentials(
            endpoint,
            bucket,
            region,
            RefreshableCredentials::new(credentials),
        )
    }
    pub fn with_credentials(
        endpoint: &str,
        bucket: &str,
        region: &str,
        credentials: RefreshableCredentials,
    ) -> Result<Self, Error> {
        let url: reqwest::Url = endpoint.parse().map_err(|_| Error::Invalid("endpoint"))?;
        let loopback = url
            .host_str()
            .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback());
        if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || !(3..=63).contains(&bucket.len())
            || !bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
            || !bucket.as_bytes()[0].is_ascii_alphanumeric()
            || !bucket.as_bytes()[bucket.len() - 1].is_ascii_alphanumeric()
            || bucket.contains("..")
            || region.is_empty()
            || region.len() > 32
            || !region
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(Error::Invalid("endpoint/bucket/region"));
        }
        let bucket = Bucket::new(url, UrlStyle::Path, bucket.to_owned(), region.to_owned())
            .map_err(|_| Error::Invalid("bucket"))?;
        let client = Client::builder()
            .http1_max_headers(32)
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(3))
            .pool_max_idle_per_host(16)
            .build()
            .map_err(|_| Error::Transport)?;
        Ok(Self {
            client,
            bucket,
            credentials,
        })
    }
    fn headers(response: &reqwest::Response) -> Result<(BTreeMap<String, String>, usize), Error> {
        let header_bytes: usize = response
            .headers()
            .iter()
            .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
            .sum();
        if header_bytes > 8192 {
            return Err(Error::Corrupt("header limit"));
        }
        let mut metadata = BTreeMap::new();
        let mut metadata_bytes = 0;
        for (key, value) in response.headers() {
            if let Some(key) = key.as_str().strip_prefix("x-amz-meta-") {
                metadata_bytes += key.len() + value.as_bytes().len();
                if metadata_bytes > 2048 {
                    return Err(Error::Corrupt("metadata limit"));
                }
                let value = value
                    .to_str()
                    .map_err(|_| Error::Corrupt("metadata header"))?;
                if metadata.insert(key.into(), value.into()).is_some() {
                    return Err(Error::Corrupt("duplicate metadata"));
                }
            }
        }
        if response.headers().get("content-encoding").is_some()
            || response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                != Some("application/gzip")
        {
            return Err(Error::Corrupt("object encoding/type"));
        }
        let length = response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok())
            .ok_or(Error::Corrupt("object length"))?;
        Ok((metadata, length))
    }
    async fn read(&self, key: &str, head: bool, maximum: usize) -> Result<Object, Error> {
        let credentials = self.credentials.snapshot().await?;
        let url = if head {
            self.bucket
                .head_object(Some(&credentials), key)
                .sign(Duration::from_secs(30))
        } else {
            self.bucket
                .get_object(Some(&credentials), key)
                .sign(Duration::from_secs(30))
        };
        let mut response = self
            .client
            .request(if head { Method::HEAD } else { Method::GET }, url)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        let status = response.status().as_u16();
        if status == 404 {
            return Err(Error::NotFound);
        }
        if status != 200 {
            return Err(Error::Status(status));
        }
        let (metadata, length) = Self::headers(&response)?;
        if length > maximum {
            return Err(Error::Corrupt("compressed size"));
        }
        let mut body = Vec::new();
        if !head {
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
                if chunk.len() > maximum.saturating_sub(body.len()) {
                    return Err(Error::Corrupt("compressed stream size"));
                }
                body.extend_from_slice(&chunk);
            }
        }
        Ok(Object {
            metadata,
            length,
            body,
        })
    }
}
impl ObjectTransport for HttpS3Transport {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        let credentials = self.credentials.snapshot().await?;
        let mut action = self.bucket.put_object(Some(&credentials), &record.key);
        action.headers_mut().insert("if-none-match", "*");
        action
            .headers_mut()
            .insert("content-md5", record.md5.as_str());
        action
            .headers_mut()
            .insert("content-type", "application/gzip");
        for (key, value) in &record.metadata {
            action
                .headers_mut()
                .insert(format!("x-amz-meta-{key}"), value.as_str());
        }
        let url = action.sign(Duration::from_secs(30));
        let mut request = self
            .client
            .put(url)
            .header("if-none-match", "*")
            .header("content-md5", &record.md5)
            .header("content-type", "application/gzip");
        for (key, value) in &record.metadata {
            request = request.header(format!("x-amz-meta-{key}"), value);
        }
        let response = request
            .body(record.body.clone())
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        Ok(response.status().as_u16())
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        self.read(key, true, 65 * 1024 * 1024).await
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
        self.read(key, false, maximum).await
    }
}

#[cfg(test)]
mod credential_review_regressions {
    use super::*;
    #[tokio::test]
    async fn snapshot_waits_for_coherent_rotation() {
        let credentials =
            RefreshableCredentials::new(Credentials::new("server2-local", "server2-local-secret"));
        let held = credentials.0.clone().write_owned().await;
        let c = credentials.clone();
        let task = tokio::spawn(async move { c.snapshot().await });
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(
            !task.is_finished(),
            "snapshot must yield while coherent rotation owns lock"
        );
        drop(held);
        let result = task.await.unwrap();
        assert!(
            result.is_ok(),
            "ordinary snapshot must wait for coherent replacement, not reject contention"
        );
    }
    #[tokio::test]
    async fn credential_wait_obeys_caller_deadline_without_blocking_worker() {
        let credentials =
            RefreshableCredentials::new(Credentials::new("server2-local", "server2-local-secret"));
        let held = credentials.0.clone().write_owned().await;
        assert!(
            timeout(Duration::from_millis(20), credentials.snapshot())
                .await
                .is_err()
        );
        assert!(
            timeout(
                Duration::from_millis(20),
                credentials.replace(Credentials::new(
                    "server2-local-rotated",
                    "server2-local-secret"
                ))
            )
            .await
            .is_err()
        );
        drop(held);
        assert!(credentials.snapshot().await.is_ok());
        credentials
            .replace(Credentials::new(
                "server2-local-rotated",
                "server2-local-secret",
            ))
            .await
            .unwrap();
    }
}
