//! Loopback air provider stub, volatile budget peer and LiveAir builders. TEST ONLY.
#![allow(dead_code)]
use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use server2::budget::{BudgetError, BudgetObject, BudgetTransport, Clock as BudgetClock};
use server2::storage::WriteCondition;
use server2::world::{
    AirConfig, AirFunding, AirProviderConfig, AirStore, FixedClock, HttpAirTransport, LiveAir,
};
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const GOOGLE_KEY: &str = "S13A_LOCAL_GOOGLE_KEY_wxyz";
pub const OWM_KEY: &str = "S13A_LOCAL_OWM_KEY_qrstuv";
pub const WAQI_KEY: &str = "S13A_LOCAL_WAQI_KEY_abcdef";
pub const GOOGLE: &str = "/v1/currentConditions:lookup";
pub const OWM: &str = "/data/2.5/air_pollution";
pub const WAQI: &str = "/feed/";

pub fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/air/fixtures")
            .join(name),
    )
    .unwrap()
}
#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
    pub delay_ms: u64,
}
impl Reply {
    pub fn json(body: impl Into<Vec<u8>>) -> Self {
        Self {
            status: 200,
            body: body.into(),
            delay_ms: 0,
        }
    }
    pub fn status(status: u16) -> Self {
        Self {
            status,
            body: b"{}".to_vec(),
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
    pub method: String,
    pub path: String,
    pub query: String,
    pub body: Vec<u8>,
}
#[derive(Default)]
struct Inner {
    /// Path prefix -> queued replies and the last served reply, which repeats.
    replies: BTreeMap<String, (VecDeque<Reply>, Option<Reply>)>,
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
    pub fn push(&self, prefix: &str, reply: Reply) {
        self.inner
            .lock()
            .unwrap()
            .replies
            .entry(prefix.into())
            .or_default()
            .0
            .push_back(reply);
    }
    pub fn calls(&self) -> Vec<Call> {
        self.inner.lock().unwrap().calls.clone()
    }
    pub fn calls_to(&self, prefix: &str) -> Vec<Call> {
        self.calls()
            .into_iter()
            .filter(|c| c.path.starts_with(prefix))
            .collect()
    }
}
async fn handle(
    State(inner): State<Arc<Mutex<Inner>>>,
    method: Method,
    uri: Uri,
    body: Bytes,
) -> Response {
    let path = uri.path().to_owned();
    let reply = {
        let mut inner = inner.lock().unwrap();
        inner.calls.push(Call {
            method: method.to_string(),
            path: path.clone(),
            query: uri.query().unwrap_or("").to_owned(),
            body: body.to_vec(),
        });
        let prefix = inner
            .replies
            .keys()
            .filter(|p| path.starts_with(p.as_str()))
            .max_by_key(|p| p.len())
            .cloned();
        prefix.and_then(|p| {
            let (queue, last) = inner.replies.get_mut(&p)?;
            if let Some(next) = queue.pop_front() {
                *last = Some(next);
            }
            last.clone()
        })
    };
    let Some(reply) = reply else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "no stub reply").into_response();
    };
    if reply.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(reply.delay_ms)).await;
    }
    let mut response = (StatusCode::from_u16(reply.status).unwrap(), reply.body).into_response();
    response.headers_mut().insert(
        "content-type",
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
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
/// Budget peer whose reads are delayed and whose concurrency is observed.
#[derive(Default)]
pub struct Slow {
    pub inner: Memory,
    pub delay_ms: u64,
    pub in_flight: std::sync::atomic::AtomicUsize,
    pub peak: std::sync::atomic::AtomicUsize,
}
impl BudgetTransport for Slow {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        use std::sync::atomic::Ordering::SeqCst;
        let now = self.in_flight.fetch_add(1, SeqCst) + 1;
        self.peak.fetch_max(now, SeqCst);
        tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
        self.in_flight.fetch_sub(1, SeqCst);
        self.inner.get_budget(key).await
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        self.inner.put_budget(key, body, condition).await
    }
}
/// Budget clock driven by the world test clock.
pub struct Linked(pub Arc<FixedClock>);
impl BudgetClock for Linked {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        use server2::world::Clock;
        Ok(self.0.now_ms() as i64)
    }
}
pub fn provider(stub: &Stub, key: &str, owner: char, units: u64) -> AirProviderConfig {
    AirProviderConfig {
        base_url: stub.base.clone(),
        key: key.into(),
        quota_id: owner.to_string().repeat(64),
        monthly_units: units,
        block_units: units.min(10),
    }
}
/// All three providers configured against one stub.
pub fn config(stub: &Stub, google_units: u64) -> AirConfig {
    AirConfig {
        google: Some(provider(stub, GOOGLE_KEY, 'a', google_units)),
        openweather: Some(provider(stub, OWM_KEY, 'b', 1000)),
        waqi: Some(provider(stub, WAQI_KEY, 'c', 1000)),
        ..AirConfig::default()
    }
}
pub fn waqi_only(stub: &Stub) -> AirConfig {
    AirConfig {
        waqi: Some(provider(stub, WAQI_KEY, 'c', 1000)),
        ..AirConfig::default()
    }
}
pub fn live(
    config: AirConfig,
    store: Arc<dyn AirStore>,
    clock: Arc<FixedClock>,
) -> (Arc<LiveAir<Memory>>, Arc<Memory>) {
    let budget = Arc::new(Memory::default());
    let air = LiveAir::new(
        config,
        store,
        Arc::new(HttpAirTransport::new().unwrap()),
        AirFunding {
            transport: budget.clone(),
            clock: Arc::new(Linked(clock.clone())),
        },
        clock,
    )
    .unwrap();
    (Arc::new(air), budget)
}
pub fn deadline() -> tokio::time::Instant {
    tokio::time::Instant::now() + Duration::from_secs(9)
}
/// A WAQI geo feed body observed at `iso` with the station at `geo`.
pub fn waqi_body(iso: &str, geo: [f64; 2]) -> Vec<u8> {
    let mut v: serde_json::Value = serde_json::from_slice(&fixture("waqi-seoul.json")).unwrap();
    v["data"]["time"]["iso"] = iso.into();
    v["data"]["city"]["geo"] = serde_json::json!(geo);
    serde_json::to_vec(&v).unwrap()
}
