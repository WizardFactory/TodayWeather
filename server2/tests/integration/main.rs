//! S19 metrics hook: aggregate gateway/geocoder counters observed through actual loopback HTTP.
//! Counters are process-global, so every test serializes on one lock and asserts exact deltas.
use axum::{Router, body::Body, extract::Request, http::StatusCode, response::Response};
use server2::{
    Config, SharedState,
    gateway::{BackendDispatcher, Gateway, LegacyGeocoder, metrics},
    geocode::{Geocoder, GeocoderConfig, MockQuota},
    metrics_router,
};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tower::ServiceExt;

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const PROVIDERS: &str = include_str!("../gateway/fixtures/providers.json");

/// Peer behavior: backend 0=ok, 1=HTTP 500, 2=slow ok; provider delay in milliseconds.
#[derive(Default)]
struct Knobs {
    backend: AtomicU64,
    provider_delay_ms: AtomicU64,
}
async fn peer(knobs: Arc<Knobs>) -> String {
    let fixtures: serde_json::Value = serde_json::from_str(PROVIDERS).unwrap();
    let kakao = serde_json::to_vec(&fixtures["kakao.coord.seoul"]).unwrap();
    let app = Router::new().fallback(move |request: Request| {
        let knobs = knobs.clone();
        let kakao = kakao.clone();
        async move {
            let path = request.uri().path().to_string();
            let json = |status: StatusCode, body: Vec<u8>| {
                Response::builder()
                    .status(status)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap()
            };
            if path.starts_with("/v2/local/geo/") {
                let delay = knobs.provider_delay_ms.load(Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                return json(StatusCode::OK, kakao);
            }
            if path.starts_with("/geocode/") {
                return json(
                    StatusCode::OK,
                    br#"{"name":"legacy","country":"KR","address":"fixture","location":{"lat":37.566,"long":126.978},"kmaAddress":{"name1":"fixture"}}"#.to_vec(),
                );
            }
            match knobs.backend.load(Ordering::SeqCst) {
                1 => json(StatusCode::INTERNAL_SERVER_ERROR, b"{}".to_vec()),
                2 => {
                    tokio::time::sleep(Duration::from_millis(600)).await;
                    json(StatusCode::OK, br#"{"temperature":21}"#.to_vec())
                }
                _ => json(StatusCode::OK, br#"{"temperature":21}"#.to_vec()),
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}
fn values() -> HashMap<&'static str, u64> {
    metrics::snapshot().into_iter().collect()
}
fn delta(before: &HashMap<&'static str, u64>, name: &str) -> i64 {
    values()[name] as i64 - before[name] as i64
}
fn get(path: &str) -> Request {
    Request::builder().uri(path).body(Body::empty()).unwrap()
}
fn legacy_gateway(base: &str) -> Gateway {
    Gateway::new(
        Arc::new(LegacyGeocoder::new(base).unwrap()),
        BackendDispatcher::legacy(base).unwrap(),
    )
}
fn mock_geocoder(base: &str, quota: usize) -> Geocoder {
    let config = GeocoderConfig {
        mock_mode: true,
        kakao_base_url: base.into(),
        google_base_url: base.into(),
        kakao_keys: vec!["local-dummy".into()],
        google_key: None,
        ..GeocoderConfig::default()
    };
    Geocoder::new(config)
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(quota)))
}

#[tokio::test]
async fn outcomes_and_legacy_attempts_are_counted() {
    let _serial = SERIAL.lock().await;
    let knobs = Arc::new(Knobs::default());
    let base = peer(knobs.clone()).await;
    let gateway = legacy_gateway(&base);

    let before = values();
    let ok = gateway
        .handle(get("/weather/v000903/coord/37.566,126.978"))
        .await;
    assert_eq!(ok.status(), 200);
    assert_eq!(delta(&before, "server2_gateway_requests_total"), 1);
    assert_eq!(delta(&before, "server2_gateway_responses_ok_total"), 1);
    assert_eq!(
        delta(&before, "server2_gateway_legacy_geocode_attempts_total"),
        1
    );
    assert_eq!(delta(&before, "server2_gateway_backend_attempts_total"), 1);

    knobs.backend.store(1, Ordering::SeqCst);
    let before = values();
    let failed = gateway
        .handle(get("/weather/v000903/coord/37.566,126.978"))
        .await;
    assert_eq!(failed.status(), 501);
    // Legacy retry policy: three backend attempts, one public dependency failure.
    assert_eq!(delta(&before, "server2_gateway_backend_attempts_total"), 3);
    assert_eq!(
        delta(&before, "server2_gateway_responses_dependency_error_total"),
        1
    );
    assert_eq!(delta(&before, "server2_gateway_responses_ok_total"), 0);

    let before = values();
    let invalid = gateway.handle(get("/weather/coord/abc")).await;
    assert_eq!(invalid.status(), 400);
    assert_eq!(
        delta(&before, "server2_gateway_responses_client_error_total"),
        1
    );
    assert_eq!(delta(&before, "server2_gateway_backend_attempts_total"), 0);
    assert_eq!(
        delta(&before, "server2_gateway_legacy_geocode_attempts_total"),
        0
    );

    let state = Arc::new(SharedState::new(&Config::default()));
    let response = metrics_router(state)
        .oneshot(get("/internal/metrics"))
        .await
        .unwrap();
    let text = String::from_utf8(
        axum::body::to_bytes(response.into_body(), 1 << 16)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    for (name, _) in metrics::snapshot() {
        assert!(text.contains(&format!("\n{name} ")), "{name} missing");
    }
    assert!(text.starts_with("server2_health_requests_total "));
}

#[tokio::test]
async fn abandoned_waiter_keeps_owned_work_until_completion() {
    let _serial = SERIAL.lock().await;
    let knobs = Arc::new(Knobs::default());
    knobs.backend.store(2, Ordering::SeqCst);
    let base = peer(knobs).await;
    let gateway = legacy_gateway(&base);
    let before = values();
    let dropped = tokio::time::timeout(
        Duration::from_millis(150),
        gateway.handle(get("/weather/v000903/coord/37.566,126.978")),
    )
    .await;
    assert!(dropped.is_err());
    assert_eq!(delta(&before, "server2_gateway_abandoned_total"), 1);
    assert_eq!(delta(&before, "server2_gateway_owned_inflight"), 1);
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert_eq!(delta(&before, "server2_gateway_owned_inflight"), 0);
    // The owner finished its single attempt; no retry or replacement work was started.
    assert_eq!(delta(&before, "server2_gateway_backend_attempts_total"), 1);
    assert_eq!(delta(&before, "server2_gateway_responses_ok_total"), 0);
}

#[tokio::test]
async fn geocoder_cache_flight_join_and_quota_are_counted() {
    let _serial = SERIAL.lock().await;
    let knobs = Arc::new(Knobs::default());
    let base = peer(knobs.clone()).await;
    let geocoder = mock_geocoder(&base, 2);

    let before = values();
    assert!(geocoder.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(delta(&before, "server2_geocoder_flights_total"), 1);
    assert_eq!(delta(&before, "server2_geocoder_kakao_attempts_total"), 1);
    assert_eq!(delta(&before, "server2_geocoder_google_attempts_total"), 0);
    assert!(geocoder.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(delta(&before, "server2_geocoder_cache_hits_total"), 1);
    assert_eq!(delta(&before, "server2_geocoder_kakao_attempts_total"), 1);

    assert!(geocoder.coord([37.567, 126.978], "ko").await.is_ok());
    let before = values();
    assert!(geocoder.coord([37.568, 126.978], "ko").await.is_err());
    assert_eq!(delta(&before, "server2_geocoder_quota_rejections_total"), 1);
    assert_eq!(delta(&before, "server2_geocoder_kakao_attempts_total"), 0);

    knobs.provider_delay_ms.store(300, Ordering::SeqCst);
    let geocoder = mock_geocoder(&base, 10);
    let before = values();
    let waiters = (0..8).map(|_| {
        let geocoder = geocoder.clone();
        tokio::spawn(async move { geocoder.coord([36.5, 127.5], "ko").await.is_ok() })
    });
    for waiter in waiters.collect::<Vec<_>>() {
        assert!(waiter.await.unwrap());
    }
    assert_eq!(delta(&before, "server2_geocoder_flights_total"), 1);
    assert_eq!(delta(&before, "server2_geocoder_kakao_attempts_total"), 1);
    assert_eq!(
        delta(&before, "server2_geocoder_joined_total")
            + delta(&before, "server2_geocoder_cache_hits_total"),
        7
    );
}
