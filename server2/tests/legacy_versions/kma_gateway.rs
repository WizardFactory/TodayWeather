//! SWITCH (S17a): the v000901 and v000902 KMA backends of the gateway (the unversioned
//! `/weather/coord` default is v000901). Legacy stays the default and the rollback; native output
//! reproduces the S02 gateway domestic goldens on the wire; each version switches alone.
use super::support::*;
use axum::{
    body::{Body, to_bytes},
    http::{HeaderValue, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::{
    domestic::kma::{
        KmaRequest,
        backend::{KmaBackend, KmaSource, LegacyOnly, SourceAnswer, select_native_versions},
    },
    gateway::{
        BackendDispatcher, BackendMode, BoxFuture, Family, Gateway, GatewayError, Geocoder, Version,
    },
    geocode::{GeoClient, KmaAddress, Location},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tokio::time::Instant;

struct Myeongdong;
impl Geocoder for Myeongdong {
    fn coord(&self, _: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        let ko = lang == "ko";
        Box::pin(async move {
            Ok(GeoClient {
                name: Some(if ko { "명동" } else { "Myeong-dong" }.into()),
                country: Some("KR".into()),
                address: Some(
                    if ko {
                        "서울특별시 중구 명동"
                    } else {
                        "Myeong-dong, Jung-gu, Seoul, South Korea"
                    }
                    .into(),
                ),
                location: Some(Location {
                    lat: 37.566,
                    long: 126.978,
                }),
                kma_address: Some(KmaAddress {
                    name1: "서울특별시".into(),
                    name2: Some("중구".into()),
                    name3: Some("명동".into()),
                }),
            })
        })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], String::new())
    }
}
/// Serves the recorded legacy input snapshot of the scenario the test selected.
struct Recorded {
    next: Mutex<Option<&'static str>>,
    requests: Mutex<Vec<KmaRequest>>,
}
impl KmaSource for Recorded {
    fn snapshot(&self, request: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        self.requests.lock().unwrap().push(request.clone());
        let id = self.next.lock().unwrap().take();
        Box::pin(async move {
            match id {
                Some(id) => SourceAnswer::Snapshot(Box::new(replay(scenario(id)))),
                None => SourceAnswer::Forward("no recorded snapshot".into()),
            }
        })
    }
}
/// The S02 gateway golden and the oracle scenario recording its backend request.
const CASES: [(&str, &str, Version); 3] = [
    (
        "gateway-default-domestic",
        "gateway-default-domestic",
        Version::V000901,
    ),
    (
        "gateway-v000901-domestic",
        "gateway-v000901-domestic",
        Version::V000901,
    ),
    (
        "gateway-v000902-domestic",
        "gateway-v000902-domestic",
        Version::V000902,
    ),
];
type Case = Arc<Mutex<Option<&'static str>>>;
/// (scenario id, forwarded path, accept-language, recorded legacy body).
type OriginBody = (&'static str, String, Option<String>, String);
/// A frozen legacy origin returning the recorded legacy backend body for the forwarded path.
async fn legacy_origin(hits: Arc<AtomicUsize>, case: Case) -> String {
    let bodies: Arc<Vec<OriginBody>> = Arc::new(
        CASES
            .iter()
            .map(|(_, id, _)| {
                let s = scenario(id);
                (
                    *id,
                    path(s),
                    s["lang"].as_str().map(str::to_owned),
                    s["body"].as_str().unwrap().to_owned(),
                )
            })
            .collect(),
    );
    let app = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let (hits, case, bodies) = (hits.clone(), case.clone(), bodies.clone());
        async move {
            hits.fetch_add(1, Ordering::SeqCst);
            let uri = req.uri().to_string();
            let expected = *case.lock().unwrap();
            let lang = req
                .headers()
                .get("accept-language")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            match bodies
                .iter()
                .find(|(id, p, l, _)| Some(*id) == expected && *p == uri && *l == lang)
            {
                Some((_, _, _, body)) => axum::response::Response::builder()
                    .header("content-type", "application/json; charset=utf-8")
                    .body(Body::from(body.clone()))
                    .unwrap(),
                None => axum::response::Response::builder()
                    .status(404)
                    .body(Body::from(format!("unexpected legacy path {uri}")))
                    .unwrap(),
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}/")
}
async fn send(gateway: &Gateway, origin: &Case, golden_id: &str, scenario_id: &'static str) {
    *origin.lock().unwrap() = Some(scenario_id);
    let case = golden(golden_id);
    let mut req = Request::builder()
        .uri(case["request"]["path"].as_str().unwrap())
        .body(Body::empty())
        .unwrap();
    if let Some(headers) = case["request"]["headers"].as_object() {
        for (k, v) in headers {
            req.headers_mut().insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v.as_str().unwrap()).unwrap(),
            );
        }
    }
    let response = gateway.handle(req).await;
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 22).await.unwrap();
    assert_eq!(
        status,
        case["status"].as_u64().unwrap() as u16,
        "{golden_id}"
    );
    let expected = STANDARD
        .decode(case["body_base64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&bytes),
        String::from_utf8_lossy(&expected),
        "{golden_id}"
    );
    for pair in case["headers"].as_array().unwrap() {
        let key = pair[0].as_str().unwrap();
        if ["date", "connection"].contains(&key) {
            continue;
        }
        assert_eq!(
            headers.get(key).and_then(|v| v.to_str().ok()),
            pair[1].as_str(),
            "{golden_id}: {key}"
        );
    }
}
fn backend(source: Arc<dyn KmaSource>) -> Arc<KmaBackend> {
    let now = clock_ms("2026-09-24T00:10:00.000Z");
    Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        oracle_config(),
    ))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_v000901_and_v000902_reproduce_s02_gateway_goldens_and_roll_back() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let case: Case = Arc::new(Mutex::new(None));
    let origin = legacy_origin(hits.clone(), case.clone()).await;
    let dispatcher = BackendDispatcher::legacy(&origin).unwrap();
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let kma = backend(source.clone());
    for version in [Version::V000901, Version::V000902] {
        kma.register_version(&dispatcher, version);
        assert_eq!(dispatcher.mode(version, Family::Kma), BackendMode::Legacy);
    }
    let gateway = Gateway::new(Arc::new(Myeongdong), dispatcher.clone());
    // Legacy default.
    for (golden_id, id, _) in CASES {
        send(&gateway, &case, golden_id, id).await;
    }
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len());
    assert!(source.requests.lock().unwrap().is_empty());

    // v000901 native only: the v000902 request still takes the legacy hop.
    KmaBackend::select_version(&dispatcher, Version::V000901, BackendMode::Native).unwrap();
    for (golden_id, id, version) in CASES {
        if version == Version::V000901 {
            *source.next.lock().unwrap() = Some(id);
        }
        send(&gateway, &case, golden_id, id).await;
    }
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len() + 1);
    // Both native.
    KmaBackend::select_version(&dispatcher, Version::V000902, BackendMode::Native).unwrap();
    for (golden_id, id, _) in CASES {
        *source.next.lock().unwrap() = Some(id);
        send(&gateway, &case, golden_id, id).await;
    }
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len() + 1);
    let requests = source.requests.lock().unwrap().clone();
    let versions: Vec<&str> = requests.iter().map(|r| r.version.as_str()).collect();
    assert_eq!(
        versions,
        ["v000901", "v000901", "v000901", "v000901", "v000902"]
    );
    assert_eq!(requests[0].locale.name(), "ko");

    // A request the source cannot supply is forwarded inside the same request.
    send(&gateway, &case, CASES[0].0, CASES[0].1).await;
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len() + 2);

    // Rollback of one version leaves the other native.
    KmaBackend::select_version(&dispatcher, Version::V000901, BackendMode::Legacy).unwrap();
    assert_eq!(
        dispatcher.mode(Version::V000902, Family::Kma),
        BackendMode::Native
    );
    *source.next.lock().unwrap() = Some(CASES[0].1);
    send(&gateway, &case, CASES[0].0, CASES[0].1).await;
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len() + 3);
}

/// `select_native_versions` selects exactly the listed versions; a source without inputs sends
/// every request to legacy and the goldens hold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listed_versions_are_selected_and_a_source_without_inputs_forwards() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let case: Case = Arc::new(Mutex::new(None));
    let origin = legacy_origin(hits.clone(), case.clone()).await;
    let dispatcher = BackendDispatcher::legacy(&origin).unwrap();
    select_native_versions(&dispatcher, Arc::new(LegacyOnly), &[Version::V000901]).unwrap();
    assert_eq!(
        dispatcher.mode(Version::V000901, Family::Kma),
        BackendMode::Native
    );
    for version in [Version::V000902, Version::V000903] {
        assert_eq!(dispatcher.mode(version, Family::Kma), BackendMode::Legacy);
    }
    let gateway = Gateway::new(Arc::new(Myeongdong), dispatcher);
    for (golden_id, id, _) in CASES {
        send(&gateway, &case, golden_id, id).await;
    }
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len());
}

/// `kma-v000901` and `kma-v000902` are separate `SERVER2_NATIVE_FAMILIES` entries beside `kma`
/// (v000903); any of them builds the shared S3 input source, which then needs the S3 settings
/// and the data.go.kr keys. Unknown or repeated entries are refused.
#[test]
fn kma_version_entries_are_separate_routing_switches() {
    use server2::gateway::runtime::{NativeFamilies, from_vars};
    let with = |families: &'static str, s3: bool| {
        move |name: &str| match name {
            "SERVER2_GATEWAY_LEGACY_URL" => Some("http://127.0.0.1:9".to_owned()),
            "SERVER2_NATIVE_FAMILIES" => Some(families.to_owned()),
            "SERVER2_S3_BUCKET" if s3 => Some("server2-test".to_owned()),
            "AWS_ACCESS_KEY" if s3 => Some("test-access".to_owned()),
            "AWS_SECRET_KEY" if s3 => Some("test-secret".to_owned()),
            "DONGNAE_SECRET_KEYS" if s3 => Some(r#"["s17a-test-placeholder-key"]"#.to_owned()),
            _ => None,
        }
    };
    let versions = |list| {
        NativeFamilies::from_vars(&with(list, false))
            .unwrap()
            .kma_versions()
    };
    assert_eq!(versions("kma-v000901"), [Version::V000901]);
    assert_eq!(
        versions("kma-v000902, kma"),
        [Version::V000902, Version::V000903]
    );
    assert_eq!(
        versions("kma,kma-v000901,kma-v000902"),
        [Version::V000901, Version::V000902, Version::V000903]
    );
    assert!(versions("dsf").is_empty());
    for refused in ["kma-v000901,kma-v000901", "kma-v000903", "kma-v000705"] {
        assert!(
            NativeFamilies::from_vars(&with(refused, false)).is_err(),
            "{refused}"
        );
    }
    assert!(from_vars(&with("kma-v000901", true)).unwrap().is_some());
    assert!(
        from_vars(&with("kma-v000902", false)).is_err(),
        "kma-v000902 needs the shared S3 settings"
    );
}
