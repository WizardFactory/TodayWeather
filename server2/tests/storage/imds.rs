//! Loopback IMDSv2 double (TEST ONLY): session token, role listing and role credentials.
//! Credentials are dummy values. The access key ID is `key` (numbered `key-N` per served document
//! when `numbered`), so the S3 test peers accept it.
#![allow(dead_code)]
use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU16, AtomicUsize, Ordering},
};

pub const ROLE: &str = "tw-server2-runtime";
const TOKEN: &str = "imds-session-token";

pub struct ImdsState {
    /// Requests of every kind.
    pub requests: AtomicUsize,
    /// Credential documents served.
    pub documents: AtomicUsize,
    /// Status of the credentials document (200 serves it).
    pub status: AtomicU16,
    /// Seconds until the served credentials expire.
    pub expires_in: Mutex<i64>,
    pub key: String,
    pub numbered: bool,
}
pub struct Imds {
    pub root: String,
    pub state: Arc<ImdsState>,
}
impl Imds {
    pub async fn start(key: &str, numbered: bool) -> Self {
        let state = Arc::new(ImdsState {
            requests: AtomicUsize::new(0),
            documents: AtomicUsize::new(0),
            status: AtomicU16::new(200),
            expires_in: Mutex::new(6 * 3600),
            key: key.to_owned(),
            numbered,
        });
        let app = Router::new()
            .route("/latest/api/token", put(token))
            .route("/latest/meta-data/iam/security-credentials/", get(roles))
            .route(
                "/latest/meta-data/iam/security-credentials/{role}",
                get(document),
            )
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await });
        Self { root, state }
    }
    pub fn requests(&self) -> usize {
        self.state.requests.load(Ordering::Acquire)
    }
}
async fn token(State(s): State<Arc<ImdsState>>, headers: HeaderMap) -> (StatusCode, String) {
    s.requests.fetch_add(1, Ordering::AcqRel);
    if headers
        .get("x-aws-ec2-metadata-token-ttl-seconds")
        .and_then(|v| v.to_str().ok())
        != Some("21600")
    {
        return (StatusCode::BAD_REQUEST, String::new());
    }
    (StatusCode::OK, TOKEN.to_owned())
}
fn authorized(headers: &HeaderMap) -> bool {
    headers
        .get("x-aws-ec2-metadata-token")
        .and_then(|v| v.to_str().ok())
        == Some(TOKEN)
}
async fn roles(State(s): State<Arc<ImdsState>>, headers: HeaderMap) -> (StatusCode, String) {
    s.requests.fetch_add(1, Ordering::AcqRel);
    if !authorized(&headers) {
        return (StatusCode::UNAUTHORIZED, String::new());
    }
    (StatusCode::OK, format!("{ROLE}\n"))
}
async fn document(
    State(s): State<Arc<ImdsState>>,
    Path(role): Path<String>,
    headers: HeaderMap,
) -> (StatusCode, String) {
    s.requests.fetch_add(1, Ordering::AcqRel);
    if !authorized(&headers) || role != ROLE {
        return (StatusCode::UNAUTHORIZED, String::new());
    }
    let status = s.status.load(Ordering::Acquire);
    if status != 200 {
        return (StatusCode::from_u16(status).unwrap(), String::new());
    }
    let n = s.documents.fetch_add(1, Ordering::AcqRel) + 1;
    let expires =
        time::OffsetDateTime::now_utc() + time::Duration::seconds(*s.expires_in.lock().unwrap());
    let expiration = expires
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let body = serde_json::json!({
        "Code": "Success",
        "LastUpdated": "2026-10-15T00:00:00Z",
        "Type": "AWS-HMAC",
        "AccessKeyId": if s.numbered { format!("{}-{n}", s.key) } else { s.key.clone() },
        "SecretAccessKey": "imds-test-secret",
        "Token": format!("imds-test-session-{n}"),
        "Expiration": expiration,
    });
    (StatusCode::OK, body.to_string())
}
