//! Shared S12 test helpers: owned loopback S3 peer, fixed clock and recorded fixtures.
#![allow(dead_code)]
use rusty_s3::Credentials;
use server2::{
    budget::{BudgetError, Clock},
    gateway::OrderedJson,
    storage::{CatalogLimits, HttpS3Transport},
    warnings::{
        ServiceConfig, StoreConfig, WarningService, WarningStore,
        js::{key, ostr},
        text,
    },
};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

pub const WTHR_PWN: &str = include_str!("fixtures/wthr-pwn.json");
pub const WTHR_INFO: &str = include_str!("fixtures/wthr-info.json");
pub const BRK_NEWS: &str = include_str!("fixtures/brk-news.json");
pub const WRN_MSG: &str = include_str!("fixtures/wrn-msg-0926.json");
pub const PWN_STATUS: &str = include_str!("fixtures/pwn-status.json");
pub const PWN_CD: &str = include_str!("fixtures/pwn-cd-0921-0927.json");
pub const PWN_CD_DAILY: &str = include_str!("fixtures/pwn-cd-daily-excerpt.json");
pub const ERR_30: &str = include_str!("fixtures/err-30.json");
pub const ERR_99: &str = include_str!("fixtures/err-99.json");
pub const ORACLE: &str = include_str!("fixtures/oracle-expected.json");
pub const GOLDEN: &str = include_str!("../golden/records.json");

pub fn items(fixture: &str) -> Vec<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(fixture).unwrap();
    match &v["response"]["body"]["items"]["item"] {
        serde_json::Value::Array(a) => a.clone(),
        other => vec![other.clone()],
    }
}
pub fn oracle() -> serde_json::Value {
    serde_json::from_str(ORACLE).unwrap()
}
pub fn golden(id: &str) -> serde_json::Value {
    let all: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    all["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("golden case {id}"))
        .clone()
}
/// Milliseconds of an ISO instant.
pub fn ms(iso: &str) -> i64 {
    server2::warnings::js::parse_iso(iso).unwrap()
}
pub struct FixedClock(pub AtomicI64);
impl FixedClock {
    pub fn at(iso: &str) -> Arc<Self> {
        Arc::new(Self(AtomicI64::new(ms(iso))))
    }
    pub fn set(&self, iso: &str) {
        self.0.store(ms(iso), Ordering::SeqCst);
    }
    pub fn set_ms(&self, v: i64) {
        self.0.store(v, Ordering::SeqCst);
    }
}
impl Clock for FixedClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
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
    pub fn store(&self) -> Arc<WarningStore<HttpS3Transport>> {
        let limits = CatalogLimits {
            deadline: Duration::from_secs(9),
            ..CatalogLimits::default()
        };
        Arc::new(WarningStore::new(self.transport(), limits, StoreConfig::default()).unwrap())
    }
    pub fn service(&self, clock: Arc<FixedClock>) -> Arc<WarningService<HttpS3Transport>> {
        Arc::new(WarningService::new(
            self.store(),
            clock,
            ServiceConfig {
                deadline: Duration::from_secs(9),
                ..ServiceConfig::default()
            },
        ))
    }
    pub async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.endpoint).parse().unwrap();
        url.query_pairs_mut()
            .append_pair("mode", mode)
            .append_pair("key", key);
        let r = reqwest::Client::new()
            .post(url)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status().as_u16(), 204, "fault {mode} {key}");
    }
    pub async fn counts(&self) -> serde_json::Value {
        let body = reqwest::Client::new()
            .get(format!("{}__catalog/status", self.endpoint))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.kill();
    }
}
pub fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(9)
}
fn obj(fields: Vec<(&str, OrderedJson)>) -> OrderedJson {
    OrderedJson::Object(fields.into_iter().map(|(k, v)| (key(k), v)).collect())
}
fn s(v: &serde_json::Value) -> OrderedJson {
    ostr(v.as_str().unwrap())
}
fn list(l: Vec<text::Situation>) -> OrderedJson {
    OrderedJson::Array(l.iter().map(text::Situation::to_json).collect())
}
/// The S02 golden store rows (`server/test/offline/golden-record.js` warningCases) as
/// exported legacy documents: type-first order, raw comments, fixed stored announcements.
pub fn golden_seed_docs() -> Vec<OrderedJson> {
    let pre = &items(WTHR_PWN)[0];
    let info = &items(WTHR_INFO)[0];
    let flash = &items(BRK_NEWS)[0];
    let msg = items(WRN_MSG)
        .into_iter()
        .find(|m| m["tmSeq"] == 128)
        .unwrap();
    let old = "2026-09-20T09:10:00.000Z";
    vec![
        obj(vec![
            ("type", OrderedJson::Number(1.)),
            ("announcement", ostr(old)),
            (
                "situationList",
                list(text::parse_special_text(msg["t6"].as_str().unwrap())),
            ),
            ("comment", s(&msg["other"])),
            (
                "bulletin",
                obj(vec![
                    ("title", s(&msg["t1"])),
                    ("areas", s(&msg["t2"])),
                    ("effectiveTimes", s(&msg["t3"])),
                    ("releaseOutlook", s(&msg["t4"])),
                ]),
            ),
        ]),
        obj(vec![
            ("type", OrderedJson::Number(2.)),
            ("announcement", ostr(old)),
            (
                "situationList",
                list(text::parse_preliminary_text(pre["pwn"].as_str().unwrap())),
            ),
            ("comment", s(&pre["rem"])),
        ]),
        obj(vec![
            ("type", OrderedJson::Number(3.)),
            ("announcement", ostr(old)),
            ("situationList", OrderedJson::Array(vec![])),
            ("comment", s(&info["t1"])),
        ]),
        obj(vec![
            ("type", OrderedJson::Number(4.)),
            ("announcement", ostr("2026-09-27T09:10:00.000Z")),
            ("situationList", OrderedJson::Array(vec![])),
            ("comment", s(&flash["ann"])),
        ]),
    ]
}
/// A canonical seed file (export converter output shape).
pub fn seed_file(
    special: Vec<OrderedJson>,
    zones: Option<OrderedJson>,
    exported_at: &str,
) -> Vec<u8> {
    let mut fields = vec![
        ("schema", OrderedJson::Number(1.)),
        ("exportedAt", ostr(exported_at)),
        ("special", OrderedJson::Array(special)),
    ];
    if let Some(z) = zones {
        fields.push(("zones", z));
    }
    obj(fields).to_bytes()
}
/// Synthetic data.go.kr JSON body carrying `rows` (provider envelope shape of the fixtures).
pub fn provider_body(rows: &[serde_json::Value]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {"dataType": "JSON", "items": {"item": rows}, "pageNo": 1, "numOfRows": 1000, "totalCount": rows.len()}
        }
    }))
    .unwrap()
}
pub async fn get(
    service: &WarningService<HttpS3Transport>,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let mut h = axum::http::HeaderMap::new();
    for (k, v) in headers {
        h.insert(
            axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
            axum::http::HeaderValue::from_str(v).unwrap(),
        );
    }
    service
        .handle(&axum::http::Method::GET, "/v000903/kma/special", &h)
        .await
        .unwrap()
}
pub async fn body(r: axum::response::Response) -> Vec<u8> {
    axum::body::to_bytes(r.into_body(), 1 << 24)
        .await
        .unwrap()
        .to_vec()
}
