//! Shared S17 fixtures: the pinned KMA oracle recordings of the older routers (S17a v000901 and
//! v000902; S17b town v000803 and v000705), their replay stores (the S15 `RecordedSource` test
//! double) and the S02 goldens.
#![allow(dead_code)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
#[path = "../domestic/recorded.rs"]
pub mod recorded;
pub use recorded::{RecordedSource, RecordedStore};
use server2::domestic::kma::{
    AssemblyConfig, KmaRequest,
    backend::{parse_path, parse_town_path},
};
use std::{io::Read, sync::OnceLock};

/// One pinned recording.
pub struct Fixture {
    path: &'static str,
    oracle: OnceLock<Value>,
    source: OnceLock<RecordedSource>,
}
impl Fixture {
    const fn new(path: &'static str) -> Self {
        Self {
            path,
            oracle: OnceLock::new(),
            source: OnceLock::new(),
        }
    }
    pub fn oracle(&self) -> &Value {
        self.oracle.get_or_init(|| {
            let gz = std::fs::read(self.path).unwrap();
            let mut text = String::new();
            flate2::read::GzDecoder::new(&gz[..])
                .read_to_string(&mut text)
                .unwrap();
            serde_json::from_str(&text).unwrap()
        })
    }
    pub fn scenarios(&self) -> &Vec<Value> {
        self.oracle()["scenarios"].as_array().unwrap()
    }
    pub fn source(&self) -> &RecordedSource {
        self.source
            .get_or_init(|| RecordedSource::parse(&std::fs::read(self.path).unwrap()).unwrap())
    }
}
/// S17a: v000901 and v000902 address routers.
pub static KMA: Fixture = Fixture::new(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/legacy_versions/fixtures/kma-older.json.gz"
));
/// S17b: v000803 and v000705 town routers.
pub static TOWN: Fixture = Fixture::new(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/legacy_versions/fixtures/kma-town.json.gz"
));
/// The S15 v000903 recording (direct `/v000903/kma/addr` wire tests only; ids shared with the
/// S17 recordings resolve to the S17 ones).
pub static S15: Fixture = Fixture::new(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/oracle.json.gz"
));
const FIXTURES: [&Fixture; 3] = [&KMA, &TOWN, &S15];

/// The S17a recording (most tests use it).
pub fn oracle() -> &'static Value {
    KMA.oracle()
}
/// Parse every view of the recordings before a timed (gateway deadline) test runs.
pub fn warm() {
    for f in FIXTURES {
        let _ = (f.oracle(), f.source());
    }
}
/// The S17a scenarios.
pub fn scenarios() -> &'static Vec<Value> {
    KMA.scenarios()
}
fn fixture_of(id: &str) -> &'static Fixture {
    FIXTURES
        .into_iter()
        .find(|f| f.scenarios().iter().any(|s| s["id"] == id))
        .unwrap_or_else(|| panic!("scenario {id}"))
}
pub fn scenario(id: &str) -> &'static Value {
    fixture_of(id)
        .scenarios()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap()
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
/// The recordings' `manager.MAX_CURRENT_COUNT` (the deployed 192, D4).
pub fn oracle_config() -> AssemblyConfig {
    for f in FIXTURES {
        let recorded = f.oracle()["oracle"]["max_current_count"].as_u64().unwrap() as usize;
        assert_eq!(recorded, AssemblyConfig::default().max_current_count);
    }
    AssemblyConfig::default()
}
fn is_town(sc: &Value) -> bool {
    matches!(sc["version"].as_str(), Some("v000803" | "v000705"))
}
/// The request path of a recorded scenario (`/{version}/kma/addr/...`, `/{version}/town/...`,
/// or the recorded URL).
pub fn path(sc: &Value) -> String {
    if let Some(url) = sc["url"].as_str() {
        return url.to_owned();
    }
    let mount = if is_town(sc) { "town" } else { "kma" };
    let mut path = format!(
        "/{}/{mount}{}",
        sc["version"].as_str().unwrap_or("v000903"),
        sc["path"].as_str().unwrap()
    );
    let q = sc["query"].as_str().unwrap();
    if !q.is_empty() {
        path.push('?');
        path.push_str(q);
    }
    path
}
/// The parsed request of a recorded scenario; None for a path the port does not route.
pub fn try_request(sc: &Value) -> Option<KmaRequest> {
    let lang = sc["lang"].as_str().unwrap_or("");
    if is_town(sc) {
        parse_town_path(&path(sc), lang)
    } else {
        parse_path(&path(sc), lang)
    }
}
pub fn request(sc: &Value) -> KmaRequest {
    try_request(sc).expect("parsable recorded path")
}
/// Recordings whose legacy result the port does not reproduce: the assembly (or the router,
/// for an unrouted path) forwards them to legacy for the stated reason.
pub const FORWARDED: [(&str, &str); 10] = [
    // The two S15 declared forwards on the v000901 router.
    (
        "query-malformed-escape",
        "getAllDataFromDb: uncaught URIError: URI malformed",
    ),
    (
        "stn-small-year-datetime",
        "date string form not reproduced (V8 legacy Date.parse): \"0001-09-24 09:03\"",
    ),
    // S17b: the same malformed escape on the town routers.
    (
        "v000803-query-malformed-escape",
        "getAllDataFromDb: uncaught URIError: URI malformed",
    ),
    (
        "v000705-query-malformed-escape",
        "getAllDataFromDb: uncaught URIError: URI malformed",
    ),
    // S17b: v000705 sub-routes without `midData`: `insertSkyIcon` calls `next(err)` and Express
    // answers 500 (forwarded like every S15 `next(err)`; reproducing Express's 500 is open).
    ("v000705-short", "insertSkyIcon error"),
    ("v000705-short-model-errors", "insertSkyIcon error"),
    ("v000705-shortest", "insertSkyIcon error"),
    ("v000705-current", "insertSkyIcon error"),
    ("v000705-current-model-errors", "insertSkyIcon error"),
    // An unknown sub-route is no legacy route (Express 404): not routed natively.
    ("v000705-unknown-part", "not routed"),
];
/// The replay store of one recorded scenario.
pub fn replay(sc: &Value) -> RecordedStore {
    let id = sc["id"].as_str().unwrap();
    fixture_of(id)
        .source()
        .store_for(id)
        .unwrap_or_else(|| panic!("recorded scenario {id}"))
}
/// The S17a replay source (gateway tests).
pub fn source() -> &'static RecordedSource {
    KMA.source()
}
