//! Shared S15 fixtures: the pinned legacy-oracle recording and its replay stores (the library
//! `RecordedSource` test double).
#![allow(dead_code)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
#[path = "recorded.rs"]
pub mod recorded;
pub use recorded::{RecordedSource, RecordedStore};
use server2::domestic::kma::{AssemblyConfig, KmaRequest, backend::parse_path};
use std::{io::Read, sync::OnceLock};

pub const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/oracle.json.gz"
);
fn oracle_text() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        let gz = std::fs::read(FIXTURE).unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_string(&mut text)
            .unwrap();
        text
    })
}
pub fn oracle() -> &'static Value {
    static ORACLE: OnceLock<Value> = OnceLock::new();
    ORACLE.get_or_init(|| serde_json::from_str(oracle_text()).unwrap())
}
/// Parse both views of the recording before a timed (gateway deadline) test runs.
pub fn warm() {
    let _ = (oracle(), source());
}
pub fn scenarios() -> &'static Vec<Value> {
    oracle()["scenarios"].as_array().unwrap()
}
pub fn scenario(id: &str) -> &'static Value {
    scenarios()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap_or_else(|| panic!("scenario {id}"))
}
pub fn golden(id: &str) -> &'static Value {
    static GOLDEN: OnceLock<Value> = OnceLock::new();
    let g = GOLDEN
        .get_or_init(|| serde_json::from_str(include_str!("../golden/records.json")).unwrap());
    g["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("golden {id}"))
}
pub fn golden_body(id: &str) -> String {
    String::from_utf8(
        STANDARD
            .decode(golden(id)["body_base64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap()
}
/// S15b-3d: a test's fixed "now" (ms). The request-time S3 tests fix it instead of reading the
/// system clock: neither the KST hour a run starts at nor a KST day change during a run may change
/// what they expect (their wall-clock versions failed from 2026-10-16 00:00 KST on). Set under the
/// S3 peer lock by [`fixed_now`]; the stubs and the acquirers' [`TestClock`] read it.
pub struct TestInstant(std::sync::atomic::AtomicU64);
impl TestInstant {
    pub const fn new() -> Self {
        Self(std::sync::atomic::AtomicU64::new(0))
    }
    pub fn set(&self, ms: f64) {
        self.0
            .store(ms.to_bits(), std::sync::atomic::Ordering::SeqCst);
    }
    pub fn get(&self) -> f64 {
        let ms = f64::from_bits(self.0.load(std::sync::atomic::Ordering::SeqCst));
        assert!(ms > 0., "no fixed test instant");
        ms
    }
}
/// The acquirers' wall clock in tests: the fixed test instant.
pub struct TestClock(pub &'static TestInstant);
impl server2::budget::Clock for TestClock {
    fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
        Ok(self.0.get() as i64)
    }
}
/// Take `lock` (the S3 test peers') and fix `instant` at `at` (ISO) for the test holding the
/// guard.
pub async fn fixed_now(
    lock: &'static tokio::sync::Mutex<()>,
    instant: &'static TestInstant,
    at: &str,
) -> tokio::sync::MutexGuard<'static, ()> {
    let guard = lock.lock().await;
    instant.set(clock_ms(at));
    guard
}
/// The instant the request-time tests run at by default: 2026-10-16 00:00:30 KST, just after the
/// KST day change at which their wall-clock versions failed.
pub const FIXED_NOW: &str = "2026-10-15T15:00:30.000Z";
/// The instants the ignored `*_across_kst_boundaries` sweeps run at (KST): around the day change,
/// the 05시 dust-forecast announcement, the first MFDS slot (08:20), midday, the 17:21 slot and the
/// 23시 announcement.
pub const KST_BOUNDARIES: [&str; 9] = [
    "2026-10-15T14:59:59.000Z", // 10-15 23:59:59
    "2026-10-15T15:00:00.500Z", // 10-16 00:00:00.5
    "2026-10-15T19:59:59.000Z", // 10-16 04:59:59
    "2026-10-15T20:00:00.500Z", // 10-16 05:00:00.5
    "2026-10-15T23:19:59.000Z", // 10-16 08:19:59
    "2026-10-15T23:20:00.500Z", // 10-16 08:20:00.5
    "2026-10-16T03:00:00.000Z", // 10-16 12:00
    "2026-10-16T08:21:00.000Z", // 10-16 17:21
    "2026-10-16T14:00:30.000Z", // 10-16 23:00:30
];
/// `Date.parse` of the recorded ISO clock.
pub fn clock_ms(iso: &str) -> f64 {
    let ms = server2::history::legacy::parse_iso(iso).unwrap_or_else(|| panic!("clock {iso}"));
    ms as f64
}
/// The recording's `manager.MAX_CURRENT_COUNT`: the driver loads the harness with the deployed
/// 192 (D4), so recordings replay with the runtime default.
pub fn oracle_config() -> AssemblyConfig {
    let recorded = oracle()["oracle"]["max_current_count"].as_u64().unwrap() as usize;
    assert_eq!(recorded, AssemblyConfig::default().max_current_count);
    AssemblyConfig::default()
}
pub fn request(sc: &Value) -> KmaRequest {
    let mut path = format!("/v000903/kma{}", sc["path"].as_str().unwrap());
    let q = sc["query"].as_str().unwrap();
    if !q.is_empty() {
        path.push('?');
        path.push_str(q);
    }
    parse_path(&path, sc["lang"].as_str().unwrap_or("")).expect("parsable recorded path")
}

/// Recordings whose legacy result the port does not reproduce: the native assembly must forward
/// them to legacy for the stated reason instead of answering.
pub const FORWARDED: [(&str, &str); 2] = [
    // Legacy `decodeURI(req.originalUrl)` throws before its `try` (Express 500).
    (
        "query-malformed-escape",
        "getAllDataFromDb: uncaught URIError: URI malformed",
    ),
    (
        "stn-small-year-datetime",
        "date string form not reproduced (V8 legacy Date.parse): \"0001-09-24 09:03\"",
    ),
];

/// The recorded oracle as the library replay source (parsed once).
pub fn source() -> &'static RecordedSource {
    static SOURCE: OnceLock<RecordedSource> = OnceLock::new();
    SOURCE.get_or_init(|| RecordedSource::parse(&std::fs::read(FIXTURE).unwrap()).unwrap())
}
/// The replay store of one recorded scenario: answers each dependency call with the recorded
/// legacy answer after checking the method, order and arguments; any difference forwards.
pub fn replay(sc: &Value) -> RecordedStore {
    let id = sc["id"].as_str().unwrap();
    source()
        .store_for(id)
        .unwrap_or_else(|| panic!("recorded scenario {id}"))
}
