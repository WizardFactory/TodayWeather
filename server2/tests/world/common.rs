//! Shared S11 fixtures: pinned-oracle recordings, scripted provider and S3 test peer.
#![allow(dead_code)]
use rusty_s3::Credentials;
use server2::{
    gateway::BoxFuture,
    storage::{CatalogLimits, HttpS3Transport},
    world::{
        AirSource, CatalogWorldStore, Cell, Clock, FixedClock, MemoryWorldStore, Range,
        Unconfigured, VcError, VcSource, World, WorldBackend, WorldConfig, WorldReply, WorldStore,
        js::Val,
    },
};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::time::Instant;

pub fn oracle() -> &'static serde_json::Value {
    static ORACLE: OnceLock<serde_json::Value> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/world/fixtures/oracle.json.gz"
        ))
        .unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_string(&mut text)
            .unwrap();
        serde_json::from_str(&text).unwrap()
    })
}
pub fn body(sha: &str) -> Vec<u8> {
    oracle()["bodies"][sha]
        .as_str()
        .unwrap()
        .as_bytes()
        .to_vec()
}
pub fn scenario(id: &str) -> &'static serde_json::Value {
    oracle()["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap_or_else(|| panic!("scenario {id}"))
}
pub fn ms(iso: &str) -> f64 {
    let p = server2::world::vc::parse_iso_z(&iso.replace(".000Z", "Z"));
    assert!(p.is_finite(), "{iso}");
    p
}
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub range: Range,
    pub lat: f64,
    pub lon: f64,
}
pub enum Answer {
    Body(Vec<u8>),
    Error(VcError),
}
/// Provider stub that serves exactly the oracle's recorded calls in order.
#[derive(Default)]
pub struct ScriptedVc {
    expected: Mutex<VecDeque<(Call, Answer)>>,
    pub calls: Mutex<Vec<Call>>,
}
impl ScriptedVc {
    pub fn expect(&self, call: Call, answer: Answer) {
        self.expected.lock().unwrap().push_back((call, answer));
    }
    pub fn pending(&self) -> usize {
        self.expected.lock().unwrap().len()
    }
    pub fn clear(&self) {
        self.expected.lock().unwrap().clear();
    }
}
impl VcSource for ScriptedVc {
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        _: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            let call = Call {
                range,
                lat: cell.lat,
                lon: cell.lon,
            };
            self.calls.lock().unwrap().push(call.clone());
            let Some((want, answer)) = self.expected.lock().unwrap().pop_front() else {
                panic!("unexpected provider call {call:?}");
            };
            assert_eq!(call, want, "provider call");
            match answer {
                Answer::Body(b) => Ok(b),
                Answer::Error(e) => Err(e),
            }
        })
    }
}
/// Funding emulation for the legacy daily record budget scenario: each attempt reserves
/// twice its units (S08), abandoned remainders are never refunded.
pub struct BudgetedVc {
    pub inner: Arc<ScriptedVc>,
    pub remaining: Mutex<u64>,
    pub clock: Arc<FixedClock>,
}
impl VcSource for BudgetedVc {
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            let units = match range {
                Range::Combined => 98,
                Range::Recent => 50,
                Range::Forecast => 2,
            };
            {
                let mut remaining = self.remaining.lock().unwrap();
                if *remaining < units {
                    let day = (self.clock.now_ms() / 86_400_000.).floor() * 86_400_000.;
                    return Err(VcError::Exhausted {
                        retry_at_ms: day + 86_400_000.,
                    });
                }
                *remaining -= units;
            }
            self.inner.fetch(cell, range, deadline).await
        })
    }
}
pub fn expect_calls(vc: &ScriptedVc, request: &serde_json::Value) {
    for c in request["calls"].as_array().unwrap() {
        // The legacy requester rejects a non-finite coordinate before HTTP; native never calls.
        if c["error"]["invalid_coordinate"].as_bool() == Some(true) {
            continue;
        }
        let call = Call {
            range: Range::parse(c["range"].as_str().unwrap()).unwrap(),
            lat: c["lat"].as_f64().unwrap(),
            lon: c["lon"].as_f64().unwrap(),
        };
        let answer = if let Some(sha) = c["body_sha256"].as_str() {
            Answer::Body(body(sha))
        } else if c["error"]["provider_down"].as_bool() == Some(true) {
            Answer::Error(VcError::ProviderDown)
        } else {
            Answer::Error(VcError::Failed)
        };
        vc.expect(call, answer);
    }
}
pub fn air_for(sc: &serde_json::Value) -> Arc<dyn AirSource> {
    for step in sc["steps"].as_array().unwrap() {
        for r in step["requests"].as_array().unwrap() {
            if let Some(a) = r["air"].as_array().and_then(|a| a.first()) {
                return Arc::new(RecordedWaqi::new(&body(a["body_sha256"].as_str().unwrap())));
            }
        }
    }
    Arc::new(Unconfigured)
}
pub fn path(r: &serde_json::Value) -> String {
    let q = r["query"].as_str().unwrap_or("");
    format!(
        "/{}/dsf/coord/{}{}{}",
        r["version"].as_str().unwrap(),
        r["loc"].as_str().unwrap(),
        if q.is_empty() { "" } else { "?" },
        q
    )
}
/// Compare a native reply with the oracle's legacy wire result.
pub fn matches(r: &serde_json::Value, reply: &WorldReply) -> Result<(), String> {
    let status = r["status"].as_u64().unwrap();
    let expected = r["body"].as_str().unwrap();
    match reply {
        WorldReply::Body(v) if status == 200 => {
            let actual = String::from_utf8(v.to_json()).unwrap();
            if actual == expected {
                Ok(())
            } else {
                let at = actual
                    .bytes()
                    .zip(expected.bytes())
                    .position(|(a, b)| a != b)
                    .unwrap_or(actual.len().min(expected.len()));
                let from = at.saturating_sub(160);
                Err(format!(
                    "body differs at {at}\n  native: {}\n  legacy: {}",
                    &actual[from..(at + 160).min(actual.len())],
                    &expected[from..(at + 160).min(expected.len())]
                ))
            }
        }
        WorldReply::Unavailable(at) if status == 503 => {
            let legacy: serde_json::Value = serde_json::from_str(expected).unwrap();
            if legacy["retryAt"].as_f64() == Some(*at) && legacy["code"] == "EWEATHERUNAVAILABLE" {
                Ok(())
            } else {
                Err(format!("retryAt {at} vs {expected}"))
            }
        }
        WorldReply::Error if status != 200 && status != 503 => Ok(()),
        other => Err(format!("class mismatch: legacy {status}, native {other:?}")),
    }
}
pub struct Engine {
    pub backend: WorldBackend,
    pub clock: Arc<FixedClock>,
    pub vc: Arc<ScriptedVc>,
}
pub fn engine(sc: &serde_json::Value, store: Arc<dyn WorldStore>) -> Engine {
    let clock = Arc::new(FixedClock::new(0.));
    let vc = Arc::new(ScriptedVc::default());
    let source: Arc<dyn VcSource> = if sc["options"]["daily_record_limit"].is_number() {
        Arc::new(BudgetedVc {
            inner: vc.clone(),
            remaining: Mutex::new(4),
            clock: clock.clone(),
        })
    } else {
        vc.clone()
    };
    let world = World::new(
        store,
        source,
        air_for(sc),
        clock.clone(),
        WorldConfig::default(),
    );
    Engine {
        backend: WorldBackend::new(world),
        clock,
        vc,
    }
}
pub fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(9)
}
/// Replay one scenario; returns mismatch descriptions (empty on parity).
pub async fn replay(
    sc: &serde_json::Value,
    store: Arc<dyn WorldStore>,
    mut after_step: impl AsyncStep,
) -> Vec<String> {
    let e = engine(sc, store);
    let mut errors = Vec::new();
    for (si, step) in sc["steps"].as_array().unwrap().iter().enumerate() {
        e.clock.set(ms(step["at"].as_str().unwrap()));
        for (ri, r) in step["requests"].as_array().unwrap().iter().enumerate() {
            e.vc.clear();
            expect_calls(&e.vc, r);
            let reply = e
                .backend
                .reply(&path(r), r["lang"].as_str().unwrap_or(""), deadline())
                .await;
            if let Err(m) = matches(r, &reply) {
                errors.push(format!(
                    "{} step {si} request {ri} {}: {m}",
                    sc["id"],
                    path(r)
                ));
            }
            if e.vc.pending() != 0 {
                errors.push(format!(
                    "{} step {si} request {ri}: provider call missing",
                    sc["id"]
                ));
            }
        }
        after_step.run(sc, si, step).await;
    }
    errors
}
pub trait AsyncStep {
    fn run<'a>(
        &'a mut self,
        sc: &'a serde_json::Value,
        index: usize,
        step: &'a serde_json::Value,
    ) -> BoxFuture<'a, ()>;
}
pub struct NoStep;
impl AsyncStep for NoStep {
    fn run<'a>(
        &'a mut self,
        _: &'a serde_json::Value,
        _: usize,
        _: &'a serde_json::Value,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}
pub fn memory() -> Arc<MemoryWorldStore> {
    Arc::new(MemoryWorldStore::default())
}
pub fn text(v: &Val) -> String {
    String::from_utf8(v.to_json()).unwrap()
}

/// S06 loopback S3 test peer (tests/storage/catalog_peer.py), killed on drop.
pub struct Peer {
    child: Child,
    pub endpoint: String,
}
impl Peer {
    pub fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line);
            let _ = tx.send(result.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(endpoint)) if endpoint.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: endpoint.trim().to_owned(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("peer startup failure: {other:?}");
            }
        }
    }
    pub fn transport(&self) -> HttpS3Transport {
        HttpS3Transport::new(
            &self.endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap()
    }
    pub fn store(&self) -> Arc<CatalogWorldStore<HttpS3Transport>> {
        Arc::new(CatalogWorldStore::new(self.transport(), CatalogLimits::default()).unwrap())
    }
    /// Every stored object key, metadata and body (the peer's local test-key control).
    pub async fn dump(&self) -> Vec<(String, String, Vec<u8>)> {
        let client = reqwest::Client::new();
        let base = format!("{}server2-local", self.endpoint);
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut url = format!("{base}?list-type=2");
            if let Some(t) = &token {
                url.push_str(&format!("&continuation-token={t}"));
            }
            let text = client
                .get(url)
                .header("X-Server2-Test-Key", "server2-local")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(text.contains("ListBucketResult"), "{text}");
            let between = |open: &str, close: &str| -> Vec<String> {
                text.split(open)
                    .skip(1)
                    .filter_map(|p| p.split(close).next().map(str::to_owned))
                    .collect()
            };
            for key in between("<Key>", "</Key>") {
                let response = client
                    .get(format!("{base}/{key}"))
                    .header("X-Server2-Test-Key", "server2-local")
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status().as_u16(), 200, "{key}");
                let meta = response
                    .headers()
                    .iter()
                    .filter(|(k, _)| k.as_str().starts_with("x-amz-meta-"))
                    .map(|(k, v)| format!("{}={}", k, v.to_str().unwrap_or("")))
                    .collect::<Vec<_>>()
                    .join(";");
                let bytes = response.bytes().await.unwrap().to_vec();
                out.push((key, meta, bytes));
            }
            match between("<NextContinuationToken>", "</NextContinuationToken>").pop() {
                Some(t) => token = Some(t),
                None => break,
            }
        }
        out
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub fn clock(engine: &Engine) -> f64 {
    engine.clock.now_ms()
}
impl<T: AsyncStep> AsyncStep for &mut T {
    fn run<'a>(
        &'a mut self,
        sc: &'a serde_json::Value,
        index: usize,
        step: &'a serde_json::Value,
    ) -> BoxFuture<'a, ()> {
        (**self).run(sc, index, step)
    }
}

/// VC source double for a restart with the provider down: every fetch fails (no billed body).
pub struct Down;
impl VcSource for Down {
    fn fetch(
        &self,
        _: server2::world::Cell,
        _: Range,
        _: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async { Err(VcError::Failed) })
    }
}
/// Air source double: one recorded WAQI body served for every request, evaluated per request.
pub struct RecordedWaqi {
    observation: Option<server2::world::air::Observation>,
}
impl RecordedWaqi {
    pub fn new(body: &[u8]) -> Self {
        Self {
            observation: server2::world::air::parse_waqi(body),
        }
    }
}
impl AirSource for RecordedWaqi {
    fn current(
        &self,
        lat: f64,
        lon: f64,
        request_ms: f64,
    ) -> BoxFuture<'_, server2::world::AirOutcome> {
        Box::pin(async move {
            match &self.observation {
                Some(o) if server2::world::air::usable(o, lat, lon, request_ms) => {
                    server2::world::AirOutcome::Observation(o.clone())
                }
                _ => server2::world::AirOutcome::None,
            }
        })
    }
}
