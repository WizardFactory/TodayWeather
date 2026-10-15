//! DIRECT (S17b): the legacy direct public routes `/v000901/kma/addr`, `/v000903/kma/addr`,
//! `/v000803/town` and `/v000705/town` through the server2 public handler. Listed entries answer
//! natively with the Express envelope of the S02 goldens (status, body and headers except `date`,
//! `connection` and the legacy session cookie); unlisted entries keep the previous 404; a request
//! the source cannot supply takes the unchanged legacy hop.
use super::support::*;
use axum::{
    body::{Body, to_bytes},
    http::{HeaderMap, HeaderValue, Method, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::kma::{
        KmaRequest,
        backend::{KmaBackend, KmaSource, SourceAnswer},
    },
    gateway::{BackendDispatcher, BoxFuture, Gateway, GatewayError, Geocoder},
    geocode::GeoClient,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tokio::time::Instant;

/// Headers outside the comparison: per-connection values and the legacy session cookie.
const IGNORED: [&str; 3] = ["date", "connection", "set-cookie"];

struct NoGeocoder;
impl Geocoder for NoGeocoder {
    fn coord(&self, _: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async { Err(GatewayError::Provider) })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async { Err(GatewayError::Provider) })
    }
}
/// Serves the recorded legacy input snapshot of the scenario the test selected and keeps the
/// parsed requests.
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
/// A frozen legacy origin answering the golden reply (status, headers and body) of the
/// requested path and `If-None-Match`.
async fn legacy_origin(hits: Arc<AtomicUsize>) -> String {
    let app = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let hits = hits.clone();
        async move {
            hits.fetch_add(1, Ordering::SeqCst);
            let uri = req.uri().to_string();
            let inm = req
                .headers()
                .get("if-none-match")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let case = GOLDENS.iter().map(|id| golden(id)).find(|c| {
                c["request"]["path"] == uri.as_str()
                    && c["request"]["headers"]["if-none-match"].as_str() == inm.as_deref()
            });
            let Some(case) = case else {
                return axum::response::Response::builder()
                    .status(404)
                    .body(Body::from(format!("unexpected legacy path {uri}")))
                    .unwrap();
            };
            let mut response =
                axum::response::Response::builder().status(case["status"].as_u64().unwrap() as u16);
            for pair in case["headers"].as_array().unwrap() {
                let key = pair[0].as_str().unwrap();
                if IGNORED.contains(&key) {
                    continue;
                }
                response = response.header(key, pair[1].as_str().unwrap());
            }
            response
                .body(Body::from(
                    STANDARD
                        .decode(case["body_base64"].as_str().unwrap())
                        .unwrap(),
                ))
                .unwrap()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}/")
}
/// The direct-route goldens and the oracle scenario recording each (the 304s revalidate it).
const GOLDENS: [&str; 7] = [
    "domestic-v000901",
    "domestic-v000901-304",
    "domestic-v000903",
    "domestic-v000903-304",
    "domestic-v000803",
    "domestic-v000803-304",
    "domestic-v000705",
];
fn recording_of(golden_id: &str) -> &'static str {
    match golden_id.strip_suffix("-304") {
        Some(base) => GOLDENS.into_iter().find(|g| *g == base).unwrap(),
        None => GOLDENS.into_iter().find(|g| *g == golden_id).unwrap(),
    }
}
async fn send(gateway: &Gateway, method: Method, golden_id: &str) -> (u16, HeaderMap, Vec<u8>) {
    let case = golden(golden_id);
    let mut req = Request::builder()
        .method(method)
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
    let bytes = to_bytes(response.into_body(), 1 << 22)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}
/// Status, body and every golden header (except `IGNORED`), and no other header.
fn assert_golden(
    golden_id: &str,
    head: bool,
    (status, headers, bytes): &(u16, HeaderMap, Vec<u8>),
) {
    let case = golden(golden_id);
    assert_eq!(
        *status,
        case["status"].as_u64().unwrap() as u16,
        "{golden_id}"
    );
    let expected = STANDARD
        .decode(case["body_base64"].as_str().unwrap())
        .unwrap();
    let expected: &[u8] = if head { &[] } else { &expected };
    assert_eq!(
        String::from_utf8_lossy(bytes),
        String::from_utf8_lossy(expected),
        "{golden_id}"
    );
    let mut names: Vec<&str> = Vec::new();
    for pair in case["headers"].as_array().unwrap() {
        let key = pair[0].as_str().unwrap();
        if IGNORED.contains(&key) {
            continue;
        }
        names.push(key);
        assert_eq!(
            headers.get(key).and_then(|v| v.to_str().ok()),
            pair[1].as_str(),
            "{golden_id}: {key}"
        );
    }
    let mut actual: Vec<&str> = headers
        .keys()
        .map(|k| k.as_str())
        .filter(|k| !IGNORED.contains(k))
        .collect();
    actual.sort_unstable();
    names.sort_unstable();
    assert_eq!(actual, names, "{golden_id}: header set");
}
fn gateway(origin: &str, source: Arc<dyn KmaSource>, families: DirectFamilies) -> Gateway {
    let dispatcher = BackendDispatcher::legacy(origin).unwrap();
    let now = clock_ms("2026-09-24T00:10:00.000Z");
    let kma = Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        oracle_config(),
    ));
    Gateway::new(Arc::new(NoGeocoder), dispatcher.clone())
        .with_direct(Arc::new(DirectRoutes::new(kma, families, dispatcher)))
}
const ALL: DirectFamilies = DirectFamilies {
    kma_v000903: true,
    kma_v000901: true,
    town: true,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listed_direct_routes_reproduce_the_s02_goldens_natively() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let origin = legacy_origin(hits.clone()).await;
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let gw = gateway(&origin, source.clone(), ALL);
    for golden_id in GOLDENS {
        let id = recording_of(golden_id);
        *source.next.lock().unwrap() = Some(id);
        let reply = send(&gw, Method::GET, golden_id).await;
        assert_golden(golden_id, false, &reply);
        // The parsed request is the recorded one (version, names, query and locale).
        let parsed = source.requests.lock().unwrap().last().cloned().unwrap();
        let recorded = request(scenario(id));
        assert_eq!(
            (
                &parsed.version,
                &parsed.part,
                &parsed.region,
                &parsed.city,
                &parsed.town
            ),
            (
                &recorded.version,
                &recorded.part,
                &recorded.region,
                &recorded.city,
                &recorded.town
            ),
            "{golden_id}"
        );
        assert_eq!(
            (&parsed.query, parsed.locale),
            (&recorded.query, recorded.locale)
        );
    }
    // HEAD of a JSON body: the GET headers without a body.
    *source.next.lock().unwrap() = Some("domestic-v000901");
    let reply = send(&gw, Method::HEAD, "domestic-v000901").await;
    assert_golden("domestic-v000901", true, &reply);
    assert_eq!(hits.load(Ordering::SeqCst), 0, "no legacy hop");
}

/// The town region guard and v000705 sub-routes answer natively; a malformed escape and an
/// unknown sub-route take the legacy hop.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn town_status_replies_and_declared_forwards() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let origin = legacy_origin(hits.clone()).await;
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let gw = gateway(&origin, source.clone(), ALL);
    for id in [
        "v000803-region-guard",
        "v000705-mid",
        "v000705-shortest-model-errors",
    ] {
        let sc = scenario(id);
        *source.next.lock().unwrap() = Some(id);
        let mut req = Request::builder()
            .uri(path(sc))
            .body(Body::empty())
            .unwrap();
        if let Some(lang) = sc["lang"].as_str() {
            req.headers_mut()
                .insert("accept-language", HeaderValue::from_str(lang).unwrap());
        }
        let response = gw.handle(req).await;
        assert_eq!(
            response.status().as_u16(),
            sc["status"].as_u64().unwrap() as u16,
            "{id}"
        );
        let h = response.headers().clone();
        assert_eq!(
            h.get("content-type").unwrap(),
            sc["content_type"].as_str().unwrap(),
            "{id}"
        );
        assert_eq!(
            h.get("etag").and_then(|v| v.to_str().ok()),
            sc["etag"].as_str(),
            "{id}"
        );
        let body = to_bytes(response.into_body(), 1 << 22).await.unwrap();
        assert_eq!(body, sc["body"].as_str().unwrap().as_bytes(), "{id}");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    // An unknown v000705 sub-route is not a native route: the legacy origin answers it.
    let req = Request::builder()
        .uri("/v000705/town/a/b/c/other")
        .body(Body::empty())
        .unwrap();
    let response = gw.handle(req).await;
    assert_eq!(response.status().as_u16(), 404);
    assert_eq!(hits.load(Ordering::SeqCst), 1, "legacy hop");
}

/// A source that cannot supply the inputs sends the request to legacy unchanged; the legacy
/// status, headers and body come back unchanged (including 304 revalidation).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forwarded_direct_requests_return_the_legacy_reply_unchanged() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let origin = legacy_origin(hits.clone()).await;
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let gw = gateway(&origin, source.clone(), ALL);
    for (n, golden_id) in GOLDENS.into_iter().enumerate() {
        let reply = send(&gw, Method::GET, golden_id).await;
        assert_golden(golden_id, false, &reply);
        assert_eq!(hits.load(Ordering::SeqCst), n + 1, "{golden_id}");
    }
}

/// Only listed entries claim their paths; unlisted direct paths keep the gateway's 404 and
/// other methods are never claimed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unlisted_direct_routes_keep_the_previous_reply() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let origin = legacy_origin(hits.clone()).await;
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let only_town = DirectFamilies {
        town: true,
        ..DirectFamilies::default()
    };
    let gw = gateway(&origin, source.clone(), only_town);
    for golden_id in ["domestic-v000901", "domestic-v000903"] {
        let (status, _, body) = send(&gw, Method::GET, golden_id).await;
        assert_eq!(
            (status, body.as_slice()),
            (404, &b"Not Found"[..]),
            "{golden_id}"
        );
    }
    // The zero-observed direct v000902 route is never claimed.
    let gw = gateway(&origin, source.clone(), ALL);
    let req = Request::builder()
        .uri("/v000902/kma/addr/a/b/c")
        .body(Body::empty())
        .unwrap();
    assert_eq!(gw.handle(req).await.status().as_u16(), 404);
    let req = Request::builder()
        .method(Method::POST)
        .uri("/v000803/town/a/b/c")
        .body(Body::empty())
        .unwrap();
    assert_eq!(gw.handle(req).await.status().as_u16(), 404);
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    assert!(source.requests.lock().unwrap().is_empty());
}

/// `town` is a `SERVER2_NATIVE_FAMILIES` entry; `kma` and `kma-v000901` also claim their direct
/// `/kma/addr` routes. Any of them builds the shared S3 input source (S3 settings required).
#[test]
fn town_entry_and_direct_claims_follow_the_routing_list() {
    use server2::gateway::runtime::{NativeFamilies, from_vars};
    let with = |families: &'static str, s3: bool| {
        move |name: &str| match name {
            "SERVER2_GATEWAY_LEGACY_URL" => Some("http://127.0.0.1:9".to_owned()),
            "SERVER2_NATIVE_FAMILIES" => Some(families.to_owned()),
            "SERVER2_S3_BUCKET" if s3 => Some("server2-test".to_owned()),
            "AWS_ACCESS_KEY" if s3 => Some("test-access".to_owned()),
            "AWS_SECRET_KEY" if s3 => Some("test-secret".to_owned()),
            "DONGNAE_SECRET_KEYS" if s3 => Some(r#"["s17b-test-placeholder-key"]"#.to_owned()),
            _ => None,
        }
    };
    let direct = |list| {
        NativeFamilies::from_vars(&with(list, false))
            .unwrap()
            .direct()
    };
    assert_eq!(
        direct("town"),
        DirectFamilies {
            town: true,
            ..DirectFamilies::default()
        }
    );
    assert_eq!(direct("kma,kma-v000901,town"), ALL);
    assert_eq!(direct("kma-v000902,dsf"), DirectFamilies::default());
    let town = NativeFamilies::from_vars(&with("town", false)).unwrap();
    assert!(town.kma_versions().is_empty() && town.kma_source());
    assert!(NativeFamilies::from_vars(&with("town,town", false)).is_err());
    assert!(from_vars(&with("town", true)).unwrap().is_some());
    assert!(
        from_vars(&with("town", false)).is_err(),
        "town needs the shared S3 settings"
    );
}

/// Review S17B-R1: the recorded usage roots (with and without the trailing slash), HEAD replies
/// (`res.json(undefined)` has no Content-Length on HEAD) and case-insensitive mounts (the
/// requested `req.baseUrl` spelling drops `location` on v000901) answer natively as legacy did.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn usage_roots_head_and_mixed_case_mounts_follow_the_recorded_replies() {
    warm();
    let hits = Arc::new(AtomicUsize::new(0));
    let origin = legacy_origin(hits.clone()).await;
    let source = Arc::new(Recorded {
        next: Mutex::new(None),
        requests: Mutex::new(Vec::new()),
    });
    let gw = gateway(&origin, source.clone(), ALL);
    let ids = [
        "v000803-usage",
        "v000803-usage-slash",
        "v000705-usage",
        "v000705-usage-slash",
        "v000901-usage",
        "v000901-usage-slash",
        "v000803-usage-head",
        "v000705-head",
        "v000803-head",
        "v000803-region-guard-head",
        "v000803-mixed-case",
        "v000705-mixed-case-mid",
        "v000901-mixed-case",
    ];
    for id in ids {
        let sc = scenario(id);
        *source.next.lock().unwrap() = Some(id);
        let method = Method::from_bytes(sc["method"].as_str().unwrap().as_bytes()).unwrap();
        let mut req = Request::builder()
            .method(method)
            .uri(sc["url"].as_str().unwrap())
            .body(Body::empty())
            .unwrap();
        if let Some(lang) = sc["lang"].as_str() {
            req.headers_mut()
                .insert("accept-language", HeaderValue::from_str(lang).unwrap());
        }
        let response = gw.handle(req).await;
        let h = response.headers().clone();
        assert_eq!(
            response.status().as_u16(),
            sc["status"].as_u64().unwrap() as u16,
            "{id}"
        );
        for (name, key) in [
            ("content-type", "content_type"),
            ("etag", "etag"),
            ("content-length", "content_length"),
        ] {
            assert_eq!(
                h.get(name).and_then(|v| v.to_str().ok()),
                sc[key].as_str(),
                "{id}: {name}"
            );
        }
        let body = to_bytes(response.into_body(), 1 << 22).await.unwrap();
        assert_eq!(body, sc["body"].as_str().unwrap().as_bytes(), "{id}");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0, "no legacy hop");
}

/// Review S17B-R1-F4: the legacy hop drops hop-by-hop headers in both directions, including the
/// headers a `Connection` header lists.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_legacy_hop_drops_connection_listed_headers_both_ways() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(String::new()));
    let record = seen.clone();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await.unwrap();
        *record.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).to_lowercase();
        let reply = [
            "HTTP/1.1 200 OK",
            "Connection: close, x-resp",
            "X-Resp: secret",
            "Keep-Alive: timeout=5",
            "X-Kept: yes",
            "Content-Length: 2",
            "",
            "ok",
        ]
        .join("\r\n");
        socket.write_all(reply.as_bytes()).await.unwrap();
        socket.shutdown().await.unwrap();
    });
    // A source without inputs: the direct request takes the legacy hop.
    let gw = gateway(
        &format!("http://{addr}/"),
        Arc::new(server2::domestic::kma::backend::LegacyOnly),
        ALL,
    );
    let req = Request::builder()
        .uri("/v000803/town/a/b/c")
        .header("connection", "x-private")
        .header("x-private", "value")
        .header("x-public", "kept")
        .body(Body::empty())
        .unwrap();
    let response = gw.handle(req).await;
    assert_eq!(response.status().as_u16(), 200);
    let h = response.headers().clone();
    assert_eq!(h.get("x-kept").unwrap(), "yes");
    for gone in ["x-resp", "keep-alive", "connection"] {
        assert!(h.get(gone).is_none(), "{gone}");
    }
    assert_eq!(to_bytes(response.into_body(), 1024).await.unwrap(), "ok");
    let request = seen.lock().unwrap().clone();
    assert!(request.contains("x-public: kept"), "{request}");
    assert!(!request.contains("x-private"), "{request}");
}
