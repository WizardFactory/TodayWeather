//! SWITCH/FORWARD: the KMA v000903 family is a native S10 backend handler. Legacy stays the
//! default and the rollback; a request the source cannot supply goes to legacy; native output
//! reproduces the S02 gateway domestic v000903 goldens on the wire.
use super::support::*;
use axum::{
    body::{Body, to_bytes},
    http::{HeaderValue, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::{
    domestic::kma::{
        AssemblyConfig, KmaRequest,
        backend::{KmaBackend, KmaSource, SourceAnswer, select_native},
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

/// A source that keeps every request on legacy (TEST ONLY; the runtime uses the S3 source).
struct LegacyOnly;
impl KmaSource for LegacyOnly {
    fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        Box::pin(async { SourceAnswer::Forward("no native KMA input source configured".into()) })
    }
}
struct Myeongdong;
impl Geocoder for Myeongdong {
    fn coord(&self, _: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        // The S02 geocoder fixture labels by language; the KMA address stays Korean.
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
/// The scenario the frozen legacy origin answers next (several share one path).
type Case = Arc<Mutex<Option<&'static str>>>;
/// (scenario id, forwarded path, accept-language, recorded legacy body).
type OriginBody = (&'static str, String, Option<String>, String);
/// A frozen legacy origin returning the recorded legacy backend body for the forwarded path.
/// Bodies are prepared before serving so the origin answers well inside the hop deadline.
async fn legacy_origin(hits: Arc<AtomicUsize>, case: Case) -> String {
    let bodies: Arc<Vec<OriginBody>> = Arc::new(
        scenarios()
            .iter()
            .filter(|s| s["id"].as_str().unwrap().starts_with("gateway-"))
            .map(|s| {
                let mut p = format!("/v000903/kma{}", s["path"].as_str().unwrap());
                if !s["query"].as_str().unwrap().is_empty() {
                    p.push('?');
                    p.push_str(s["query"].as_str().unwrap());
                }
                (
                    s["id"].as_str().unwrap(),
                    p,
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
            let body = bodies
                .iter()
                .find(|(id, p, l, _)| Some(*id) == expected && *p == uri && *l == lang)
                .map(|(_, _, _, b)| b.clone());
            match body {
                Some(body) => axum::response::Response::builder()
                    .header("content-type", "application/json; charset=utf-8")
                    .body(Body::from(body))
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
async fn send(
    gateway: &Gateway,
    origin: &Case,
    id: &'static str,
) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    *origin.lock().unwrap() = Some(id);
    let case = golden(id);
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
    (
        status,
        headers,
        to_bytes(response.into_body(), 1 << 22)
            .await
            .unwrap()
            .to_vec(),
    )
}
fn assert_golden(id: &str, status: u16, headers: &axum::http::HeaderMap, bytes: &[u8]) {
    let case = golden(id);
    assert_eq!(status, case["status"].as_u64().unwrap() as u16, "{id}");
    let expected = STANDARD
        .decode(case["body_base64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(bytes),
        String::from_utf8_lossy(&expected),
        "{id}"
    );
    for pair in case["headers"].as_array().unwrap() {
        let key = pair[0].as_str().unwrap();
        if ["date", "connection"].contains(&key) {
            continue;
        }
        assert_eq!(
            headers.get(key).and_then(|v| v.to_str().ok()),
            pair[1].as_str(),
            "{id}: {key}"
        );
    }
}
const CASES: [&str; 5] = [
    "gateway-v000903-domestic",
    "gateway-query-normalization",
    "gateway-history-never-requested",
    "gateway-history-resumed-after-eight-days",
    "gateway-history-partial-eight-day-history",
];
fn backend(source: Arc<dyn KmaSource>) -> Arc<KmaBackend> {
    let now = clock_ms("2026-09-24T00:10:00.000Z");
    Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        oracle_config(),
    ))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_kma_reproduces_s02_gateway_goldens_and_rolls_back() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let case: Case = Arc::new(Mutex::new(None));
    let origin = legacy_origin(hits.clone(), case.clone()).await;
    let dispatcher = BackendDispatcher::legacy(&origin).unwrap();
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    backend(source.clone()).register(&dispatcher);
    assert_eq!(
        dispatcher.mode(Version::V000903, Family::Kma),
        BackendMode::Legacy
    );
    let gateway = Gateway::new(Arc::new(Myeongdong), dispatcher.clone());
    // Legacy default: the frozen legacy origin serves the recorded legacy body.
    for id in CASES {
        let (status, headers, bytes) = send(&gateway, &case, id).await;
        assert_golden(id, status, &headers, &bytes);
    }
    assert_eq!(
        hits.load(Ordering::SeqCst),
        CASES.len(),
        "legacy served every request"
    );
    assert!(
        source.requests.lock().unwrap().is_empty(),
        "native unused while legacy"
    );

    KmaBackend::select(&dispatcher, BackendMode::Native).unwrap();
    for id in CASES {
        *source.next.lock().unwrap() = Some(id);
        let (status, headers, bytes) = send(&gateway, &case, id).await;
        assert_golden(id, status, &headers, &bytes);
    }
    assert_eq!(
        hits.load(Ordering::SeqCst),
        CASES.len(),
        "native served without the legacy hop"
    );
    let requests = source.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), CASES.len());
    assert_eq!(
        requests[1].query,
        [
            ("temperatureUnit".to_owned(), "F".to_owned()),
            ("note".to_owned(), "a b".to_owned()),
            ("airForecastSource".to_owned(), "kaq".to_owned()),
        ]
    );
    assert_eq!(requests[0].locale.name(), "ko");
    assert_eq!(requests[2].locale.name(), "en");

    // A cell the source cannot supply is forwarded inside the same request.
    let (status, headers, bytes) = send(&gateway, &case, CASES[0]).await;
    assert_golden(CASES[0], status, &headers, &bytes);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        CASES.len() + 1,
        "forwarded to legacy"
    );

    // Rollback.
    KmaBackend::select(&dispatcher, BackendMode::Legacy).unwrap();
    *source.next.lock().unwrap() = Some(CASES[0]);
    let (status, headers, bytes) = send(&gateway, &case, CASES[0]).await;
    assert_golden(CASES[0], status, &headers, &bytes);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        CASES.len() + 2,
        "rolled back to legacy"
    );
}

/// `select_native` registers and selects the handler with the given source; a source that
/// supplies no inputs sends every request to legacy and the goldens hold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_source_without_inputs_forwards_everything_to_legacy() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let case: Case = Arc::new(Mutex::new(None));
    let origin = legacy_origin(hits.clone(), case.clone()).await;
    let dispatcher = BackendDispatcher::legacy(&origin).unwrap();
    assert_eq!(
        dispatcher.mode(Version::V000903, Family::Kma),
        BackendMode::Legacy
    );
    select_native(&dispatcher, Arc::new(LegacyOnly)).unwrap();
    assert_eq!(
        dispatcher.mode(Version::V000903, Family::Kma),
        BackendMode::Native
    );
    let gateway = Gateway::new(Arc::new(Myeongdong), dispatcher);
    for id in CASES {
        let (status, headers, bytes) = send(&gateway, &case, id).await;
        assert_golden(id, status, &headers, &bytes);
    }
    assert_eq!(hits.load(Ordering::SeqCst), CASES.len());
}

/// A town absent from the store's town list would be geocoded and saved by legacy, a
/// non-Korean coordinate redirected and a `KR` region remapped remotely: all forward.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn assembly_paths_legacy_cannot_share_are_forwarded() {
    struct Unknown;
    impl KmaSource for Unknown {
        fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
            // The store has towns, but not 명동.
            Box::pin(async {
                SourceAnswer::Snapshot(Box::new(replay(scenario("domestic-v000903"))))
            })
        }
    }
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let case: Case = Arc::new(Mutex::new(None));
    let origin = legacy_origin(hits.clone(), case.clone()).await;
    let dispatcher = BackendDispatcher::legacy(&origin).unwrap();
    backend(Arc::new(Unknown)).register(&dispatcher);
    KmaBackend::select(&dispatcher, BackendMode::Native).unwrap();
    let gateway = Gateway::new(Arc::new(Myeongdong), dispatcher);
    let (status, headers, bytes) = send(&gateway, &case, CASES[0]).await;
    assert_golden(CASES[0], status, &headers, &bytes);
    assert_eq!(hits.load(Ordering::SeqCst), 1, "absent town forwarded");
    let _ = AssemblyConfig::default();
}

/// The routing list is the only switch (S15b-1): `kma` builds the S3 input source from the
/// shared legacy S3 settings and (S15b-2) the legacy data.go.kr key list `DONGNAE_SECRET_KEYS`
/// (S10e), which are then required; unset keeps legacy and reads none.
#[test]
fn native_families_kma_is_the_only_switch() {
    use server2::gateway::runtime::{NativeFamilies, from_vars};
    let with = |families: Option<&'static str>, s3: bool| {
        move |name: &str| match name {
            "SERVER2_GATEWAY_LEGACY_URL" => Some("http://127.0.0.1:9".to_owned()),
            "SERVER2_NATIVE_FAMILIES" => families.map(str::to_owned),
            "SERVER2_S3_BUCKET" if s3 => Some("server2-test".to_owned()),
            "AWS_ACCESS_KEY" if s3 => Some("test-access".to_owned()),
            "AWS_SECRET_KEY" if s3 => Some("test-secret".to_owned()),
            "DONGNAE_SECRET_KEYS" if s3 => Some(r#"["s15b2-test-placeholder-key"]"#.to_owned()),
            _ => None,
        }
    };
    assert!(
        NativeFamilies::from_vars(&with(Some("kma"), false))
            .unwrap()
            .kma
    );
    assert!(!NativeFamilies::from_vars(&with(None, false)).unwrap().kma);
    assert!(from_vars(&with(Some("kma"), true)).unwrap().is_some());
    assert!(
        from_vars(&with(Some("kma"), false)).is_err(),
        "kma needs the shared S3 settings"
    );
    assert!(from_vars(&with(None, false)).unwrap().is_some());
    assert!(from_vars(&with(Some("kma,kma"), true)).is_err());
}

#[tokio::test]
async fn provider_independent_errors_do_not_touch_the_source() {
    use server2::gateway::BackendHandler;
    struct NoReads;
    impl KmaSource for NoReads {
        fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
            panic!("provider-independent error reached the data source");
        }
    }
    struct NoSummaries;
    impl server2::summary::SummarySink for NoSummaries {
        fn record(
            &self,
            _: server2::summary::GridInputs,
            _: Vec<server2::gateway::OrderedJson>,
            _: f64,
        ) {
            panic!("provider-independent error reached the summary sink");
        }
    }
    let now = clock_ms("2026-09-24T00:10:00.000Z");
    let native = KmaBackend::new(Arc::new(NoReads), Arc::new(move || now), oracle_config())
        .with_summaries(Some(Arc::new(NoSummaries)));
    for path in [
        "/v000903/kma/addr/중국",
        "/v000903/kma/addr/not-a-town?x=%ZZ",
        "/v000901/kma/addr/중국",
        "/v000902/kma/addr/not-a-town?x=%ZZ",
    ] {
        let result = native
            .fetch_or_forward(
                path.into(),
                "ko".into(),
                Instant::now() + std::time::Duration::from_secs(3),
            )
            .await;
        assert!(matches!(result, Err(GatewayError::Provider)), "{path}");
    }
}
