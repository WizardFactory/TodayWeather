//! EC2 instance-role credentials through IMDSv2 (S10f, #2759).
//!
//! AK (2026-10-15): server2 signs S3 requests with the credentials of the EC2 instance role
//! (instance profile `tw-server2-runtime`) unless real static keys are configured. One refresh is
//! three IMDSv2 requests: a session token (`PUT /latest/api/token`), the role name and the role's
//! credentials document. Credentials are cached and refreshed on use, five minutes before they
//! expire (EC2 publishes new role credentials at least five minutes before the old ones expire).
//! Each IMDS request has a 1 s connect and 2 s total timeout and a refresh at most 3 s. A failed
//! refresh keeps an unexpired cached credential; attempts (also attempts cancelled by a caller's
//! deadline) are spaced at least [`RETRY_AFTER`] apart, except that rotated credentials allow the
//! next refresh when they enter the refresh window. Every failure is a storage `Transport` error: an IMDS status is never
//! reported as an S3 status, so a missing role cannot look like a missing object.
//!
//! The IMDS root is built in ([`METADATA_ROOT`]). Only tests choose a loopback IMDS double, through
//! the test-only builders. Nothing here has a Debug implementation or logs a value.
use super::Error;
use crate::observability::ObservedHttp as _;
use reqwest::{Client, Method, redirect::Policy};
use rusty_s3::Credentials;
use std::{
    net::IpAddr,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::{Instant, timeout};

/// The EC2 instance metadata service (link-local; IMDS is plain HTTP by design).
pub const METADATA_ROOT: &str = "http://169.254.169.254";
/// Session-token lifetime requested from IMDSv2 (the documented maximum, six hours).
const TOKEN_TTL_SECONDS: &str = "21600";
/// Refresh credentials that expire within this window (milliseconds).
const REFRESH_BEFORE_MS: u64 = 5 * 60 * 1000;
/// Credentials are usable while they expire later than this (milliseconds); a signed S3 URL
/// lives 30 seconds.
const USABLE_FOR_MS: u64 = 60 * 1000;
/// A write signs with any cached credential that outlives this (milliseconds), without a
/// refresh: the 30-second signed URL plus a margin. Writers obtain credentials with
/// [`InstanceRole::credentials`] (at least [`USABLE_FOR_MS`]) before the operation, so within
/// an operation deadline (at most 9 seconds) signing a PUT never needs IMDS.
const SIGNING_FOR_MS: u64 = 35 * 1000;
/// Minimum spacing of refresh attempts after a failure or an unrotated credential.
pub const RETRY_AFTER: Duration = Duration::from_secs(10);
/// Bound of one refresh, and of the wait for a running refresh when no usable credential is
/// cached.
const WAIT: Duration = Duration::from_secs(3);
const HEADER_BYTES: usize = 8192;
const BODY_BYTES: usize = 16 * 1024;

struct Cached {
    credentials: Credentials,
    expires_ms: u64,
}

/// Instance-role credentials, refreshed on use. Deliberately has no Debug.
pub(crate) struct InstanceRole {
    root: String,
    client: Client,
    cached: Mutex<Option<Cached>>,
    /// Held by the one refreshing caller; the earliest instant of the next attempt.
    refresh: tokio::sync::Mutex<Option<Instant>>,
}
impl InstanceRole {
    /// `root` is [`METADATA_ROOT`] or, for tests, a plain-HTTP loopback root.
    pub(crate) fn new(root: &str) -> Result<Self, Error> {
        let root = root.trim_end_matches('/');
        if root != METADATA_ROOT && !loopback_root(root) {
            return Err(Error::Invalid("instance metadata root"));
        }
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
            .timeout(Duration::from_secs(2))
            .pool_max_idle_per_host(1)
            .build()
            .map_err(|_| Error::Transport)?;
        Ok(Self {
            root: root.to_owned(),
            client,
            cached: Mutex::new(None),
            refresh: tokio::sync::Mutex::new(None),
        })
    }
    fn cached(&self, now_ms: u64, margin_ms: u64) -> Option<Credentials> {
        let held = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        held.as_ref()
            .filter(|c| c.expires_ms > now_ms.saturating_add(margin_ms))
            .map(|c| c.credentials.clone())
    }
    /// Credentials for signing a write (S10F-R3-F1): a cached credential that outlives the
    /// signed URL, without a refresh; otherwise [`InstanceRole::credentials`].
    pub(crate) async fn signing(&self) -> Result<Credentials, Error> {
        match self.cached(now_ms()?, SIGNING_FOR_MS) {
            Some(cached) => Ok(cached),
            None => self.credentials().await,
        }
    }
    /// Current credentials: cached, or refreshed through IMDSv2.
    pub(crate) async fn credentials(&self) -> Result<Credentials, Error> {
        if let Some(fresh) = self.cached(now_ms()?, REFRESH_BEFORE_MS) {
            return Ok(fresh);
        }
        let mut next = match self.cached(now_ms()?, USABLE_FOR_MS) {
            // Another caller is refreshing: use the cached credential meanwhile.
            Some(usable) => match self.refresh.try_lock() {
                Ok(guard) => guard,
                Err(_) => return Ok(usable),
            },
            None => timeout(WAIT, self.refresh.lock())
                .await
                .map_err(|_| Error::Timeout)?,
        };
        let now = now_ms()?;
        if let Some(fresh) = self.cached(now, REFRESH_BEFORE_MS) {
            return Ok(fresh);
        }
        let usable = self.cached(now, USABLE_FOR_MS);
        if next.is_some_and(|at| Instant::now() < at) {
            return usable.ok_or(Error::Transport);
        }
        // Spaced before the attempt, so an attempt cancelled by the caller's deadline also
        // counts; the whole refresh is bounded.
        *next = Some(Instant::now() + RETRY_AFTER);
        let fetched = timeout(WAIT, self.fetch())
            .await
            .unwrap_or(Err(Error::Transport));
        match fetched {
            Ok(fetched) => {
                // Rotated credentials need no early attempt. Not rotated yet: use them, but do
                // not ask again on every request.
                if fetched.expires_ms > now_ms()?.saturating_add(REFRESH_BEFORE_MS) {
                    *next = None;
                }
                let credentials = fetched.credentials.clone();
                *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(fetched);
                Ok(credentials)
            }
            // Re-checked now: the cached credential may have aged during the attempt.
            Err(error) => self.cached(now_ms()?, USABLE_FOR_MS).ok_or(error),
        }
    }
    async fn fetch(&self) -> Result<Cached, Error> {
        let token = self
            .document(Method::PUT, "/latest/api/token", None)
            .await?;
        let token = String::from_utf8(token).map_err(|_| Error::Transport)?;
        if token.is_empty() || token.len() > 4096 || !token.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(Error::Transport);
        }
        let roles = self
            .document(
                Method::GET,
                "/latest/meta-data/iam/security-credentials/",
                Some(&token),
            )
            .await?;
        let role = std::str::from_utf8(&roles)
            .ok()
            .and_then(|text| text.lines().next())
            .map(str::trim)
            .filter(|role| role_name(role))
            .ok_or(Error::Transport)?
            .to_owned();
        let body = self
            .document(
                Method::GET,
                &format!("/latest/meta-data/iam/security-credentials/{role}"),
                Some(&token),
            )
            .await?;
        let text = std::str::from_utf8(&body).map_err(|_| Error::Transport)?;
        let code: serde_json::Value = serde_json::from_str(text).map_err(|_| Error::Transport)?;
        if code["Code"] != "Success" {
            return Err(Error::Transport);
        }
        let parsed =
            rusty_s3::credentials::Ec2SecurityCredentialsMetadataResponse::deserialize(text)
                .map_err(|_| Error::Transport)?;
        let expires_ms =
            u64::try_from(parsed.expiration().as_millisecond()).map_err(|_| Error::Transport)?;
        // Usable from now, after the requests, not from the start of the attempt.
        if expires_ms <= now_ms()?.saturating_add(USABLE_FOR_MS)
            || parsed.key().is_empty()
            || parsed.secret().is_empty()
            || parsed.token().is_empty()
        {
            return Err(Error::Transport);
        }
        Ok(Cached {
            credentials: parsed.into_credentials(),
            expires_ms,
        })
    }
    /// One bounded IMDS request; any status other than 200 is a transport failure.
    async fn document(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
    ) -> Result<Vec<u8>, Error> {
        let put = method == Method::PUT;
        let mut request = self.client.request(method, format!("{}{path}", self.root));
        if put {
            request = request.header("x-aws-ec2-metadata-token-ttl-seconds", TOKEN_TTL_SECONDS);
        }
        if let Some(token) = token {
            request = request.header("x-aws-ec2-metadata-token", token);
        }
        let mut response = request
            .send()
            .observed(crate::observability::Component::S3)
            .await
            .map_err(|_| Error::Transport)?;
        let headers = response.headers();
        if response.status().as_u16() != 200
            || headers
                .iter()
                .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                .sum::<usize>()
                > HEADER_BYTES
            || headers.contains_key("content-encoding")
            || headers.get("content-length").is_some_and(|v| {
                v.to_str()
                    .ok()
                    .and_then(|s| s.parse::<usize>().ok())
                    .is_none_or(|n| n > BODY_BYTES)
            })
        {
            return Err(Error::Transport);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
            if chunk.len() > BODY_BYTES - body.len() {
                return Err(Error::Transport);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}
fn now_ms() -> Result<u64, Error> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::Transport)?;
    u64::try_from(elapsed.as_millis()).map_err(|_| Error::Transport)
}
/// IAM role names: 1–64 characters of `[A-Za-z0-9+=,.@_-]`.
fn role_name(role: &str) -> bool {
    (1..=64).contains(&role.len())
        && role
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+=,.@_-".contains(&b))
}
/// A test IMDS root: plain HTTP to a loopback address, no path, user information, query or fragment.
pub(crate) fn loopback_root(root: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(root) else {
        return false;
    };
    url.scheme() == "http"
        && url
            .host_str()
            .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback())
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::{get, put},
    };
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    /// Builds the n-th credentials document: (status, body).
    type Document = Box<dyn Fn(usize) -> (u16, String) + Send>;
    /// Loopback IMDSv2 double: `document(n)` builds the n-th credentials document.
    struct Double {
        requests: AtomicUsize,
        documents: AtomicUsize,
        role: Mutex<String>,
        document: Mutex<Document>,
        /// Delay before the credentials document is answered (milliseconds).
        delay_ms: std::sync::atomic::AtomicU64,
    }
    fn expiring_in(seconds: i64) -> String {
        (time::OffsetDateTime::now_utc() + time::Duration::seconds(seconds))
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap()
    }
    fn success(seconds: i64) -> impl Fn(usize) -> (u16, String) + Send {
        move |n| {
            (
                200,
                serde_json::json!({
                    "Code": "Success",
                    "AccessKeyId": format!("role-key-{n}"),
                    "SecretAccessKey": "role-secret",
                    "Token": format!("role-session-{n}"),
                    "Expiration": expiring_in(seconds),
                })
                .to_string(),
            )
        }
    }
    async fn double() -> (Arc<Double>, InstanceRole) {
        let state = Arc::new(Double {
            requests: AtomicUsize::new(0),
            documents: AtomicUsize::new(0),
            role: Mutex::new("tw-server2-runtime\n".into()),
            document: Mutex::new(Box::new(success(6 * 3600))),
            delay_ms: std::sync::atomic::AtomicU64::new(0),
        });
        async fn token(State(s): State<Arc<Double>>, h: HeaderMap) -> (StatusCode, &'static str) {
            s.requests.fetch_add(1, Ordering::AcqRel);
            match h.get("x-aws-ec2-metadata-token-ttl-seconds") {
                Some(v) if v == "21600" => (StatusCode::OK, "session-token"),
                _ => (StatusCode::BAD_REQUEST, ""),
            }
        }
        fn authorized(h: &HeaderMap) -> bool {
            h.get("x-aws-ec2-metadata-token")
                .is_some_and(|v| v == "session-token")
        }
        async fn roles(State(s): State<Arc<Double>>, h: HeaderMap) -> (StatusCode, String) {
            s.requests.fetch_add(1, Ordering::AcqRel);
            if !authorized(&h) {
                return (StatusCode::UNAUTHORIZED, String::new());
            }
            (StatusCode::OK, s.role.lock().unwrap().clone())
        }
        async fn document(State(s): State<Arc<Double>>, h: HeaderMap) -> (StatusCode, String) {
            s.requests.fetch_add(1, Ordering::AcqRel);
            if !authorized(&h) {
                return (StatusCode::UNAUTHORIZED, String::new());
            }
            // Built first, answered after the delay: the expiry ages in transit.
            let n = s.documents.fetch_add(1, Ordering::AcqRel) + 1;
            let (status, body) = (s.document.lock().unwrap())(n);
            let delay = s.delay_ms.load(Ordering::Acquire);
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            (StatusCode::from_u16(status).unwrap(), body)
        }
        let app = Router::new()
            .route("/latest/api/token", put(token))
            .route("/latest/meta-data/iam/security-credentials/", get(roles))
            .route(
                "/latest/meta-data/iam/security-credentials/tw-server2-runtime",
                get(document),
            )
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}/", listener.local_addr().unwrap());
        crate::observability::spawn(async move { axum::serve(listener, app).await });
        (state, InstanceRole::new(&root).unwrap())
    }
    fn set(d: &Double, f: impl Fn(usize) -> (u16, String) + Send + 'static) {
        *d.document.lock().unwrap() = Box::new(f);
    }
    /// The retry spacing has elapsed (instead of sleeping ten seconds).
    async fn elapse(role: &InstanceRole) {
        *role.refresh.lock().await = None;
    }

    #[tokio::test]
    async fn imdsv2_credentials_are_cached_until_the_refresh_window() {
        let (d, role) = double().await;
        let first = role.credentials().await.unwrap();
        assert_eq!(first.key(), "role-key-1");
        assert_eq!(first.token(), Some("role-session-1"));
        assert_eq!(d.requests.load(Ordering::Acquire), 3);
        for _ in 0..5 {
            assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        }
        assert_eq!(d.requests.load(Ordering::Acquire), 3, "cached");
    }

    #[tokio::test]
    async fn credentials_inside_the_refresh_window_are_refreshed_and_not_polled() {
        let (d, role) = double().await;
        // Not rotated yet: usable for four minutes, inside the five-minute window.
        set(&d, success(240));
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        // Used meanwhile; no request per S3 operation.
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        assert_eq!(d.requests.load(Ordering::Acquire), 3);
        // After the retry spacing the rotated credentials replace them.
        set(&d, success(6 * 3600));
        elapse(&role).await;
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-2");
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-2");
        assert_eq!(d.requests.load(Ordering::Acquire), 6);
    }

    #[tokio::test]
    async fn a_failed_refresh_keeps_unexpired_credentials() {
        let (d, role) = double().await;
        set(&d, success(240));
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        set(&d, |_| (500, String::new()));
        elapse(&role).await;
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        assert_eq!(d.requests.load(Ordering::Acquire), 6);
        // The failed attempt is not repeated within the retry spacing.
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        assert_eq!(d.requests.load(Ordering::Acquire), 6);
    }

    #[tokio::test]
    async fn invalid_documents_are_transport_failures() {
        let documents: Vec<(&str, Document)> = vec![
            ("missing role", Box::new(|_| (404, String::new()))),
            (
                "not success",
                Box::new(|_| {
                    (
                        200,
                        serde_json::json!({"Code": "Failure", "AccessKeyId": "k",
                            "SecretAccessKey": "s", "Token": "t",
                            "Expiration": expiring_in(3600)})
                        .to_string(),
                    )
                }),
            ),
            (
                "no token",
                Box::new(|_| {
                    (
                        200,
                        serde_json::json!({"Code": "Success", "AccessKeyId": "k",
                            "SecretAccessKey": "s", "Expiration": expiring_in(3600)})
                        .to_string(),
                    )
                }),
            ),
            (
                "empty secret",
                Box::new(|_| {
                    (
                        200,
                        serde_json::json!({"Code": "Success", "AccessKeyId": "k",
                            "SecretAccessKey": "", "Token": "t",
                            "Expiration": expiring_in(3600)})
                        .to_string(),
                    )
                }),
            ),
            ("expired", Box::new(success(30))),
            ("not json", Box::new(|_| (200, "{".into()))),
            ("oversized", Box::new(|_| (200, "x".repeat(BODY_BYTES + 1)))),
        ];
        for (name, document) in documents {
            let (d, role) = double().await;
            *d.document.lock().unwrap() = document;
            assert_eq!(
                role.credentials().await.err(),
                Some(Error::Transport),
                "{name}"
            );
        }
        for listing in ["", "../escape", "role name\n", &"r".repeat(65)] {
            let (d, role) = double().await;
            *d.role.lock().unwrap() = listing.into();
            assert_eq!(
                role.credentials().await.err(),
                Some(Error::Transport),
                "{listing:?}"
            );
            assert_eq!(d.documents.load(Ordering::Acquire), 0);
        }
    }

    /// S10F-R1-F1: a cached credential that ages below the usable lifetime while a refresh
    /// fails is not returned.
    #[tokio::test]
    async fn a_credential_that_ages_during_a_failed_refresh_is_not_used() {
        let (d, role) = double().await;
        set(&d, success(62));
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        set(&d, |_| (500, String::new()));
        d.delay_ms.store(2500, Ordering::Release);
        elapse(&role).await;
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
    }

    /// S10F-R3-F1: a write signs with the credential obtained before the operation even when it
    /// aged below the refresh lifetime meanwhile and the refresh fails; no IMDS request.
    #[tokio::test]
    async fn a_write_signs_with_the_credential_obtained_before_the_operation() {
        let (d, role) = double().await;
        set(&d, success(62));
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        set(&d, |_| (500, String::new()));
        tokio::time::sleep(Duration::from_millis(2100)).await;
        let requests = d.requests.load(Ordering::Acquire);
        assert_eq!(role.signing().await.unwrap().key(), "role-key-1");
        assert_eq!(
            d.requests.load(Ordering::Acquire),
            requests,
            "no refresh to sign"
        );
        // A read needs the full lifetime and the refresh fails.
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
        // Nothing cached: signing obtains credentials like a read.
        let (d, role) = double().await;
        assert_eq!(role.signing().await.unwrap().key(), "role-key-1");
        assert_eq!(d.requests.load(Ordering::Acquire), 3);
    }

    /// S10F-R2-F1: credentials that enter the refresh window while the refresh is in transit
    /// keep the retry spacing.
    #[tokio::test]
    async fn credentials_that_age_into_the_refresh_window_in_transit_are_not_polled() {
        let (d, role) = double().await;
        set(&d, success(301));
        d.delay_ms.store(1500, Ordering::Release);
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-1");
        assert_eq!(
            d.requests.load(Ordering::Acquire),
            3,
            "no immediate new attempt"
        );
    }

    /// Concurrent first callers share one refresh; during a refresh, callers holding a usable
    /// credential do not wait for it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_callers_share_one_refresh() {
        let (d, role) = double().await;
        let role = Arc::new(role);
        d.delay_ms.store(200, Ordering::Release);
        let callers: Vec<_> = (0..8)
            .map(|_| {
                let role = role.clone();
                crate::observability::spawn(async move { role.credentials().await })
            })
            .collect();
        for caller in callers {
            assert_eq!(caller.await.unwrap().unwrap().key(), "role-key-1");
        }
        assert_eq!(d.documents.load(Ordering::Acquire), 1);
        // Inside the refresh window but usable: the refreshing caller waits for IMDS, the
        // others return the cached credential at once.
        set(&d, success(240));
        elapse(&role).await;
        *role.cached.lock().unwrap() = None;
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-2");
        set(&d, success(6 * 3600));
        elapse(&role).await;
        d.delay_ms.store(1000, Ordering::Release);
        let refreshing = {
            let role = role.clone();
            crate::observability::spawn(async move { role.credentials().await })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = std::time::Instant::now();
        assert_eq!(role.credentials().await.unwrap().key(), "role-key-2");
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(refreshing.await.unwrap().unwrap().key(), "role-key-3");
    }

    #[tokio::test]
    async fn a_slow_or_cancelled_refresh_is_bounded_and_spaced() {
        let (d, role) = double().await;
        // Slower than the per-request timeout: a transport failure within the refresh bound.
        d.delay_ms.store(2500, Ordering::Release);
        let started = std::time::Instant::now();
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
        assert!(started.elapsed() < Duration::from_millis(3500));
        assert_eq!(d.requests.load(Ordering::Acquire), 3);
        // A refresh cancelled by the caller's deadline still spaces the next attempt.
        let (d, role) = double().await;
        d.delay_ms.store(1000, Ordering::Release);
        assert!(
            timeout(Duration::from_millis(200), role.credentials())
                .await
                .is_err()
        );
        let before = d.requests.load(Ordering::Acquire);
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
        assert_eq!(d.requests.load(Ordering::Acquire), before, "no new attempt");
    }

    #[tokio::test]
    async fn an_unreachable_imds_fails_without_usable_credentials() {
        // A closed loopback port: connection refused.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let role = InstanceRole::new(&root).unwrap();
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
        // Within the retry spacing no request is attempted.
        assert_eq!(role.credentials().await.err(), Some(Error::Transport));
    }

    #[test]
    fn only_the_built_in_root_or_a_loopback_test_root_is_accepted() {
        assert!(InstanceRole::new(METADATA_ROOT).is_ok());
        assert!(InstanceRole::new("http://169.254.169.254/").is_ok());
        for root in [
            "https://169.254.169.254",
            "http://169.254.169.253",
            "http://10.0.0.5",
            "http://127.0.0.1:9/latest",
            "https://127.0.0.1:9",
        ] {
            assert!(InstanceRole::new(root).is_err(), "{root}");
        }
    }
}
