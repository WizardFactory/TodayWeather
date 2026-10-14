//! S13d (#2747) through the S10 gateway with the native world family: a request uses what is
//! ready within its attempt (3 s, or the remaining gateway deadline when shorter) and omits the
//! rest as legacy does (`DsfController._fallback`, `airStatus` pending). The owned acquisition
//! continues with the legacy provider timeout, publishes, and the next request includes it with
//! exactly one provider call.
use super::common::{Peer, ScriptedVc, body, deadline, expect_calls, matches, ms, path, scenario};
use super::support::{Reply, Stub, WAQI, live, waqi_only};
use axum::body::{Body, to_bytes};
use server2::{
    gateway::{
        BackendDispatcher, BackendMode, BoxFuture, Gateway, GatewayError, Geocoder, Version,
    },
    geocode::{GeoClient, Location},
    storage::CatalogLimits,
    world::{
        AirStore, BoundedS3, CatalogAirStore, CatalogWorldStore, Cell, FixedClock, Range,
        Unconfigured, VcError, VcSource, World, WorldBackend, WorldConfig, WorldStore,
    },
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::Instant;

/// Geocoder double: the requested coordinate in a non-KR country (world family).
struct Overseas;
impl Geocoder for Overseas {
    fn coord(&self, loc: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            Ok(GeoClient {
                name: Some("Overseas".into()),
                country: Some("DE".into()),
                address: Some("Overseas".into()),
                location: Some(Location {
                    lat: loc[0],
                    long: loc[1],
                }),
                kma_address: None,
            })
        })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], String::new())
    }
}
/// Scripted VC answers after a settable delay (the provider's response time).
struct Delayed {
    inner: Arc<ScriptedVc>,
    delay: Mutex<Duration>,
}
impl VcSource for Delayed {
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        let delay = *self.delay.lock().unwrap();
        Box::pin(async move {
            tokio::time::sleep(delay).await;
            self.inner.fetch(cell, range, deadline).await
        })
    }
}
fn native(backend: &Arc<WorldBackend>) -> BackendDispatcher {
    // Port 9 is closed: a legacy hop would fail, so every 200 below is native.
    let dispatcher = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    backend.register(&dispatcher);
    WorldBackend::select(
        &dispatcher,
        &[Version::V000901, Version::V000902, Version::V000903],
        BackendMode::Native,
    )
    .unwrap();
    dispatcher
}
async fn get(gateway: &Gateway, r: &serde_json::Value) -> (u16, String, Duration) {
    let uri = format!(
        "/weather/{}/coord/{}?{}",
        r["version"].as_str().unwrap(),
        r["loc"].as_str().unwrap(),
        r["query"].as_str().unwrap()
    );
    let request = axum::http::Request::builder()
        .uri(uri)
        .header("accept-language", r["lang"].as_str().unwrap())
        .body(Body::empty())
        .unwrap();
    let started = Instant::now();
    let response = gateway.handle(request).await;
    let elapsed = started.elapsed();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1 << 22).await.unwrap();
    (
        status,
        String::from_utf8_lossy(&bytes).into_owned(),
        elapsed,
    )
}
async fn until(what: &str, condition: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what} did not happen"));
}

/// Slow VC (4 s, inside the legacy 8-second call budget): the request is answered within the
/// 3-second attempt from the stored records, without the fetch (legacy `_fallback` after the
/// response budget). The owned fetch publishes to S3 and the next request equals the legacy
/// oracle response for that fetch with no further provider call.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_vc_answers_from_stored_records_and_the_next_request_includes_the_fetch() {
    let sc = scenario("stale-fallback");
    let req = |step: usize| &sc["steps"][step]["requests"][0];
    let peer = Peer::new();
    let s3 = BoundedS3::new(peer.transport(), 12);
    let store: Arc<dyn WorldStore> =
        Arc::new(CatalogWorldStore::new(s3, CatalogLimits::default()).unwrap());
    let scripted = Arc::new(ScriptedVc::default());
    let vc = Arc::new(Delayed {
        inner: scripted.clone(),
        delay: Mutex::new(Duration::ZERO),
    });
    let clock = Arc::new(FixedClock::new(0.));
    let backend = Arc::new(WorldBackend::new(World::new(
        store,
        vc.clone(),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    )));
    let gateway = Gateway::new(Arc::new(Overseas), native(&backend));
    // Earlier fetches stored records for the cell (07:04 combined, 21:50 forecast).
    for step in [0, 3] {
        clock.set(ms(sc["steps"][step]["at"].as_str().unwrap()));
        expect_calls(&scripted, req(step));
        matches(
            req(step),
            &backend.reply(&path(req(step)), "en", deadline()).await,
        )
        .unwrap();
    }
    // 22:40 (Berlin 00:40): yesterday is now required, and VC answers after 4 s.
    clock.set(ms(sc["steps"][5]["at"].as_str().unwrap()));
    expect_calls(&scripted, req(5));
    *vc.delay.lock().unwrap() = Duration::from_secs(4);
    let (status, slow, elapsed) = get(&gateway, req(5)).await;
    assert_eq!(status, 200, "{slow}");
    assert!(elapsed < Duration::from_secs(3), "{elapsed:?}");
    let world = backend.world().clone();
    until("owned VC publication", || {
        world
            .metrics()
            .publications
            .load(std::sync::atomic::Ordering::Relaxed)
            == 3
    })
    .await;
    // The next request includes the fetch: byte-equal to the legacy oracle at 22:40.
    matches(
        req(5),
        &backend.reply(&path(req(5)), "en", deadline()).await,
    )
    .unwrap();
    let (status, next, _) = get(&gateway, req(5)).await;
    assert_eq!(status, 200);
    assert_ne!(slow, next, "the first answer omitted the new fetch");
    assert_eq!(
        scripted.calls.lock().unwrap().len(),
        3,
        "one call per fetch"
    );
    assert_eq!(scripted.pending(), 0);
}

/// Slow air (2.5 s, inside the legacy 3-second air provider timeout) under a 2-second gateway
/// deadline: the weather is released before the shorter attempt ends with `airStatus` pending.
/// The owned air acquisition publishes its raw record, and the next request includes the air
/// data (legacy oracle bytes) with one WAQI call.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_air_is_omitted_then_included_with_one_provider_call() {
    let sc = scenario("air-waqi");
    let r = &sc["steps"][0]["requests"][0];
    let peer = Peer::new();
    let s3 = BoundedS3::new(peer.transport(), 12);
    let weather: Arc<dyn WorldStore> =
        Arc::new(CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap());
    let air_store: Arc<dyn AirStore> =
        Arc::new(CatalogAirStore::new(s3, CatalogLimits::default()).unwrap());
    let stub = Stub::start().await;
    let clock = Arc::new(FixedClock::new(ms(sc["steps"][0]["at"].as_str().unwrap())));
    let (air, _) = live(waqi_only(&stub), air_store, clock.clone());
    let scripted = Arc::new(ScriptedVc::default());
    expect_calls(&scripted, r);
    let backend = Arc::new(WorldBackend::new(World::new(
        weather,
        scripted.clone(),
        air,
        clock,
        WorldConfig::default(),
    )));
    let gateway = Gateway::with_limits(
        Arc::new(Overseas),
        native(&backend),
        40,
        Duration::from_secs(2),
    )
    .unwrap();
    let recorded = body(r["air"][0]["body_sha256"].as_str().unwrap());
    stub.push(WAQI, Reply::json(recorded).delayed(2_500));
    let (status, first, elapsed) = get(&gateway, r).await;
    assert_eq!(status, 200, "{first}");
    assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");
    assert!(
        first.contains(r#""airStatus":{"state":"pending","retryAfterSeconds":3}"#),
        "{first}"
    );
    until("owned air acquisition", || stub.calls().len() == 1).await;
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    let (status, next, _) = get(&gateway, r).await;
    assert_eq!(status, 200);
    assert!(!next.contains("airStatus"), "{next}");
    matches(r, &backend.reply(&path(r), "ko", deadline()).await).unwrap();
    assert_eq!(stub.calls().len(), 1, "one WAQI call");
    assert_eq!(scripted.calls.lock().unwrap().len(), 1);
}
