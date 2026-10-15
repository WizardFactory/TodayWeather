//! Shared S17 fixtures: the pinned v000901/v000902 KMA oracle recording, its replay stores (the
//! S15 `RecordedSource` test double) and the S02 goldens.
#![allow(dead_code)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
#[path = "../domestic/recorded.rs"]
pub mod recorded;
pub use recorded::{RecordedSource, RecordedStore};
use server2::domestic::kma::{AssemblyConfig, KmaRequest, backend::parse_path};
use std::{io::Read, sync::OnceLock};

pub const KMA_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/legacy_versions/fixtures/kma-older.json.gz"
);
pub fn oracle() -> &'static Value {
    static ORACLE: OnceLock<Value> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(KMA_FIXTURE).unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_string(&mut text)
            .unwrap();
        serde_json::from_str(&text).unwrap()
    })
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
pub fn golden_header(id: &str, name: &str) -> Option<&'static str> {
    golden(id)["headers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h[0] == name)
        .and_then(|h| h[1].as_str())
}
/// `Date.parse` of the recorded ISO clock.
pub fn clock_ms(iso: &str) -> f64 {
    let ms = server2::history::legacy::parse_iso(iso).unwrap_or_else(|| panic!("clock {iso}"));
    ms as f64
}
/// The recording's `manager.MAX_CURRENT_COUNT` (the deployed 192, D4).
pub fn oracle_config() -> AssemblyConfig {
    let recorded = oracle()["oracle"]["max_current_count"].as_u64().unwrap() as usize;
    assert_eq!(recorded, AssemblyConfig::default().max_current_count);
    AssemblyConfig::default()
}
/// The backend path of a recorded scenario (`/{version}/kma/addr/...`).
pub fn path(sc: &Value) -> String {
    let mut path = format!(
        "/{}/kma{}",
        sc["version"].as_str().unwrap(),
        sc["path"].as_str().unwrap()
    );
    let q = sc["query"].as_str().unwrap();
    if !q.is_empty() {
        path.push('?');
        path.push_str(q);
    }
    path
}
pub fn request(sc: &Value) -> KmaRequest {
    parse_path(&path(sc), sc["lang"].as_str().unwrap_or("")).expect("parsable recorded path")
}
/// Recordings whose legacy result the port does not reproduce (the S15 declared forwards, here
/// for the v000901 and v000902 routers): the assembly forwards them for the stated reason.
pub const FORWARDED: [(&str, &str); 2] = [
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
    SOURCE.get_or_init(|| RecordedSource::parse(&std::fs::read(KMA_FIXTURE).unwrap()).unwrap())
}
pub fn replay(sc: &Value) -> RecordedStore {
    let id = sc["id"].as_str().unwrap();
    source()
        .store_for(id)
        .unwrap_or_else(|| panic!("recorded scenario {id}"))
}
