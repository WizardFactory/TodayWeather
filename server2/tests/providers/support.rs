//! Loopback provider stub, volatile budget peer and fixtures. TEST ONLY; never relays.
#![allow(dead_code)]
use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use server2::budget::{
    BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider,
};
use server2::domestic::KeyRing;
use server2::providers::ProviderKey;
use server2::storage::WriteCondition;
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use time::{Date, Month, PrimitiveDateTime, Time, macros::offset};
use tokio::time::Instant;

pub fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/providers/fixtures")
        .join(name);
    std::fs::read(path).unwrap()
}
/// KST wall clock to UTC milliseconds.
pub fn kst(y: i32, m: u8, d: u8, h: u8, mi: u8) -> i64 {
    let date = Date::from_calendar_date(y, Month::try_from(m).unwrap(), d).unwrap();
    let t = Time::from_hms(h, mi, 0).unwrap();
    PrimitiveDateTime::new(date, t)
        .assume_offset(offset!(+9))
        .unix_timestamp()
        * 1000
}
pub fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}

#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    pub location: Option<String>,
    pub delay_ms: u64,
}
impl Reply {
    pub fn json(body: impl Into<Vec<u8>>) -> Self {
        Self::with(200, "application/json;charset=UTF-8", body)
    }
    pub fn with(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            content_type: content_type.into(),
            body: body.into(),
            location: None,
            delay_ms: 0,
        }
    }
    pub fn redirect(location: String) -> Self {
        Self {
            status: 302,
            content_type: "text/html".into(),
            body: Vec::new(),
            location: Some(location),
            delay_ms: 0,
        }
    }
    pub fn delayed(mut self, ms: u64) -> Self {
        self.delay_ms = ms;
        self
    }
}
#[derive(Clone, Debug)]
pub struct Call {
    pub path: String,
    pub raw_query: String,
    pub query: Vec<(String, String)>,
}
impl Call {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}
#[derive(Default)]
struct Inner {
    replies: BTreeMap<String, VecDeque<Reply>>,
    calls: Vec<Call>,
}
pub struct Stub {
    pub base: String,
    inner: Arc<Mutex<Inner>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Stub {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Stub {
    pub async fn start() -> Self {
        let inner = Arc::new(Mutex::new(Inner::default()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let router = Router::new()
            .fallback(any(handle))
            .with_state(inner.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self { base, inner, task }
    }
    pub fn url(&self, path: &str) -> reqwest::Url {
        format!("{}{}", self.base, path.trim_start_matches('/'))
            .parse()
            .unwrap()
    }
    pub fn push(&self, path: &str, reply: Reply) {
        self.inner
            .lock()
            .unwrap()
            .replies
            .entry(format!("/{}", path.trim_start_matches('/')))
            .or_default()
            .push_back(reply);
    }
    pub fn calls(&self) -> Vec<Call> {
        self.inner.lock().unwrap().calls.clone()
    }
    pub fn keys(&self) -> Vec<String> {
        self.calls()
            .iter()
            .filter_map(|c| c.get("serviceKey").map(str::to_owned))
            .collect()
    }
}
async fn handle(State(inner): State<Arc<Mutex<Inner>>>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let raw_query = request.uri().query().unwrap_or("").to_owned();
    let parsed: reqwest::Url = format!("http://127.0.0.1/?{raw_query}").parse().unwrap();
    let query = parsed
        .query_pairs()
        .map(|(a, b)| (a.into_owned(), b.into_owned()))
        .collect();
    let reply = {
        let mut inner = inner.lock().unwrap();
        inner.calls.push(Call {
            path: path.clone(),
            raw_query,
            query,
        });
        inner.replies.get_mut(&path).and_then(VecDeque::pop_front)
    };
    let Some(reply) = reply else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "no stub reply").into_response();
    };
    if reply.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(reply.delay_ms)).await;
    }
    let mut response = (StatusCode::from_u16(reply.status).unwrap(), reply.body).into_response();
    let headers = response.headers_mut();
    headers.insert(
        "content-type",
        HeaderValue::from_str(&reply.content_type).unwrap(),
    );
    if let Some(location) = reply.location {
        headers.insert("location", HeaderValue::from_str(&location).unwrap());
    }
    response
}

#[derive(Default)]
pub struct Memory(pub Mutex<BTreeMap<String, Vec<u8>>>);
impl BudgetTransport for Memory {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        self.0
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .map(|body| BudgetObject {
                body,
                etag: "\"1\"".into(),
            })
            .ok_or(BudgetError::NotFound)
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        let mut map = self.0.lock().unwrap();
        if matches!(condition, WriteCondition::Absent) && map.contains_key(key) {
            return Ok(412);
        }
        map.insert(key.into(), body.into());
        Ok(200)
    }
}
pub struct TestClock(pub AtomicI64);
impl Clock for TestClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
pub fn clock(ms: i64) -> Arc<TestClock> {
    Arc::new(TestClock(AtomicI64::new(ms)))
}
pub fn policy(owner: char, limit: u64) -> BudgetPolicy {
    BudgetPolicy {
        provider: Provider::DataGoKr,
        quota_id: owner.to_string().repeat(64),
        window_id: "s13_local".into(),
        starts_at_ms: 1,
        ends_at_ms: i64::MAX,
        limit,
        block_units: 10,
    }
}
pub const KEY_A: &str = "S13_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/=";
pub const KEY_B: &str = "S13_LOCAL_KEY_B+bbbbbbbbbbbbbbbb/=";
pub fn ring<B: BudgetTransport + 'static>(
    wire: Arc<B>,
    clock: Arc<TestClock>,
    keys: &[(&str, char)],
) -> KeyRing<B> {
    KeyRing::new(
        keys.iter()
            .map(|(key, owner)| {
                (
                    ProviderKey::new((*key).into()).unwrap(),
                    Arc::new(
                        BudgetStore::new(wire.clone(), policy(*owner, 1000), clock.clone())
                            .unwrap(),
                    ),
                )
            })
            .collect(),
    )
    .unwrap()
}

/// Synthetic VilageFcst JSON page in the data.go.kr envelope. Rows are unique by
/// (category, fcstDate, fcstTime); `base` is the echoed baseDate/baseTime.
pub fn vilage_page(
    page: u32,
    total: u32,
    rows: u32,
    base: (&str, &str),
    grid: (u16, u16),
) -> Vec<u8> {
    const CATEGORIES: [&str; 12] = [
        "TMP", "UUU", "VVV", "VEC", "WSD", "SKY", "PTY", "POP", "WAV", "PCP", "REH", "SNO",
    ];
    let start = (page - 1) * rows;
    let end = (start + rows).min(total);
    let base_hour: u32 = base.1[..2].parse().unwrap();
    let base_day: u32 = base.0[6..].parse().unwrap();
    let items: Vec<serde_json::Value> = (start..end)
        .map(|i| {
            let hour = base_hour + 1 + i / 12;
            serde_json::json!({
                "baseDate": base.0,
                "baseTime": base.1,
                "category": CATEGORIES[(i % 12) as usize],
                "fcstDate": format!("{}{:02}", &base.0[..6], base_day + hour / 24),
                "fcstTime": format!("{:02}00", hour % 24),
                "fcstValue": "0",
                "nx": grid.0,
                "ny": grid.1,
            })
        })
        .collect();
    envelope(items, page, rows, total)
}
pub fn envelope(items: Vec<serde_json::Value>, page: u32, rows: u32, total: u32) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {
                "dataType": "JSON",
                "items": {"item": items},
                "pageNo": page,
                "numOfRows": rows,
                "totalCount": total,
            }
        }
    }))
    .unwrap()
}
pub fn result_code(code: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "response": {"header": {"resultCode": code, "resultMsg": "TEST"}}
    }))
    .unwrap()
}
pub fn empty_items() -> Vec<u8> {
    br#"{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},"body":{"dataType":"JSON","items":"","pageNo":1,"numOfRows":999,"totalCount":0}}}"#.to_vec()
}
/// Synthetic life-index page (unique `areaNo`, one issuance `date`).
pub fn life_page(page: u32, total: u32, rows: u32, issuance: &str) -> Vec<u8> {
    let start = (page - 1) * rows;
    let items = (start..(start + rows).min(total))
        .map(|i| {
            serde_json::json!({
                "code": "A07_2",
                "areaNo": format!("{}", 1_100_000_000u64 + u64::from(i)),
                "date": issuance,
                "h0": "1",
                "h3": "2",
            })
        })
        .collect();
    envelope(items, page, rows, total)
}
