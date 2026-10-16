use server2::{
    gateway::{BackendHandler, BoxFuture, GatewayError, OrderedJson, runtime::NativeHandles},
    push::deliver::{
        Fetch,
        native_fetch::{INTERNAL_ORIGIN, NativeFetch},
    },
};
use std::sync::{Arc, Mutex};
use tokio::time::Instant;
struct Recorded(Arc<Mutex<Vec<(String, String)>>>);
impl BackendHandler for Recorded {
    fn fetch(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        self.0.lock().unwrap().push((path.clone(), lang.clone()));
        Box::pin(async move {
            assert!(deadline <= Instant::now() + std::time::Duration::from_secs(3));
            OrderedJson::from_serde(&serde_json::json!({"path":path,"lang":lang}))
        })
    }
}
#[tokio::test]
async fn strict_native_targets_preserve_family_version_units_language() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let fetch = NativeFetch::new(NativeHandles {
        kma: Some(Arc::new(Recorded(calls.clone()))),
        dsf: Some(Arc::new(Recorded(calls.clone()))),
        geocoder: None,
    });
    for path in [
        "/v000902/kma/addr/Seoul?tempUnit=F&windUnit=mph",
        "/v000902/dsf/coord/10,20?tempUnit=F",
    ] {
        let (status, bytes) = fetch
            .get(format!("{INTERNAL_ORIGIN}{path}"), Some("en-US".into()))
            .await
            .unwrap();
        assert_eq!(status, 200);
        assert!(String::from_utf8(bytes).unwrap().contains("v000902"));
    }
    assert_eq!(
        calls.lock().unwrap()[0],
        (
            "/v000902/kma/addr/Seoul?tempUnit=F&windUnit=mph".into(),
            "en-US".into()
        )
    );
    for url in [
        "http://127.0.0.1/v000902/dsf/coord/10,20",
        "http://server2.internal.evil/v000902/dsf/coord/10,20",
        "http://server2.internal@evil/v000902/dsf/coord/10,20",
        "http://server2.internal/v000903/dsf/coord/10,20",
        "http://server2.internal/v000902/dsf/coord/10,20/extra",
        "http://server2.internal/v000902/kma/addr/%2e%2e",
        "http://server2.internal/v000902/kma/addr/a%2fb",
    ] {
        assert!(fetch.get(url.into(), None).await.is_err(), "{url}");
    }
    assert_eq!(calls.lock().unwrap().len(), 2);
    assert!(
        NativeFetch::new(NativeHandles::default())
            .get(format!("{INTERNAL_ORIGIN}/v000902/dsf/coord/10,20"), None)
            .await
            .is_err()
    );
}
#[tokio::test]
async fn production_native_handlers_are_built_for_push_without_public_selection() {
    // This test checks production factory wiring, not cold CSV reference initialization.
    // Initialize only repository-static data before NativeFetch starts its unchanged 3s timer.
    let _ = server2::domestic::kma::source::towns();
    let peer = super::common::Peer::persistent();
    let s = peer.services("push");
    super::common::ready(&s).await;
    // S3/provider inputs remain cold; unreachable owned provider roots cannot forward.
    let (status, bytes) = s
        .native_fetch
        .get(
            format!("{INTERNAL_ORIGIN}/v000902/kma/addr/Seoul"),
            Some("ko".into()),
        )
        .await
        .unwrap();
    assert_eq!(status, 200);
    assert!(
        serde_json::from_slice::<serde_json::Value>(&bytes).is_ok(),
        "unknown town retains native empty/sentinel response"
    );
    assert!(
        s.native_fetch
            .get(
                format!("{INTERNAL_ORIGIN}/geocode/v000903/coord/10,20"),
                None
            )
            .await
            .is_err()
    );
    let h = super::common::Http::new(s).await;
    assert_eq!(
        reqwest::get(format!("{}/v000903/kma/addr/Seoul", h.base))
            .await
            .unwrap()
            .status(),
        404
    );
}

#[path = "../legacy_versions/support.rs"]
mod kma_fixture;
#[path = "../world/common.rs"]
mod world_fixture;
struct KmaSnapshot(&'static serde_json::Value);
impl server2::domestic::kma::backend::KmaSource for KmaSnapshot {
    fn snapshot(
        &self,
        _: &server2::domestic::kma::KmaRequest,
        _: Instant,
    ) -> BoxFuture<'_, server2::domestic::kma::backend::SourceAnswer> {
        Box::pin(async move {
            server2::domestic::kma::backend::SourceAnswer::Snapshot(Box::new(kma_fixture::replay(
                self.0,
            )))
        })
    }
}
#[tokio::test]
async fn typed_fetch_replays_actual_kma_v902_native_handler_units_and_languages() {
    let _ = kma_fixture::KMA.source();
    let mut cases = 0;
    for sc in kma_fixture::KMA
        .scenarios()
        .iter()
        .filter(|s| {
            s["version"] == "v000902"
                && s["status"] == 200
                && s["body"].as_str().is_some_and(|s| s.starts_with('{'))
                && s["path"].as_str().is_some_and(|p| p.starts_with("/addr/"))
        })
        .take(12)
    {
        let now = kma_fixture::clock_ms(sc["clock"].as_str().unwrap());
        let backend = server2::domestic::kma::backend::KmaBackend::new(
            Arc::new(KmaSnapshot(sc)),
            Arc::new(move || now),
            kma_fixture::oracle_config(),
        );
        let fetch = NativeFetch::new(NativeHandles {
            kma: Some(Arc::new(backend)),
            ..Default::default()
        });
        let (_, bytes) = fetch
            .get(
                format!("{INTERNAL_ORIGIN}{}", kma_fixture::path(sc)),
                sc["lang"].as_str().map(str::to_owned),
            )
            .await
            .unwrap();
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            sc["body"].as_str().unwrap(),
            "{}",
            sc["id"]
        );
        cases += 1;
    }
    assert!(cases >= 8, "{cases}");
}
#[tokio::test]
async fn typed_fetch_replays_actual_dsf_v902_native_handler_units_and_languages() {
    let sc = world_fixture::scenario("tokyo-recorded");
    let e = world_fixture::engine(sc, world_fixture::memory());
    let mut cases = 0;
    let clock = e.clock.clone();
    let vc = e.vc.clone();
    let backend = Arc::new(e.backend);
    let fetch = NativeFetch::new(NativeHandles {
        dsf: Some(backend.clone()),
        ..Default::default()
    });
    for step in sc["steps"].as_array().unwrap() {
        clock.set(world_fixture::ms(step["at"].as_str().unwrap()));
        for r in step["requests"].as_array().unwrap() {
            vc.clear();
            world_fixture::expect_calls(&vc, r);
            if r["version"] != "v000902" {
                let reply = backend
                    .reply(
                        &world_fixture::path(r),
                        r["lang"].as_str().unwrap_or(""),
                        world_fixture::deadline(),
                    )
                    .await;
                world_fixture::matches(r, &reply).unwrap();
                continue;
            }
            let (_, bytes) = fetch
                .get(
                    format!("{INTERNAL_ORIGIN}{}", world_fixture::path(r)),
                    r["lang"].as_str().map(str::to_owned),
                )
                .await
                .unwrap();
            assert_eq!(
                String::from_utf8(bytes).unwrap(),
                r["body"].as_str().unwrap()
            );
            cases += 1;
        }
    }
    assert!(cases > 0);
}
struct Slow;
impl BackendHandler for Slow {
    fn fetch(
        &self,
        _: String,
        _: String,
        _: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn typed_fetch_bounds_native_wait() {
    let fetch = NativeFetch::new(NativeHandles {
        dsf: Some(Arc::new(Slow)),
        ..Default::default()
    });
    let start = Instant::now();
    assert!(
        fetch
            .get(format!("{INTERNAL_ORIGIN}/v000902/dsf/coord/10,20"), None)
            .await
            .is_err()
    );
    assert_eq!(start.elapsed(), std::time::Duration::from_secs(3));
}

#[tokio::test]
async fn production_native_geocode_fetch_preserves_language_without_persisting_reverse_coordinates()
{
    let peer = super::common::Peer::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let fixture: serde_json::Value =
        serde_json::from_slice(include_bytes!("../gateway/fixtures/providers.json")).unwrap();
    let fixture = fixture["kakao.coord.seoul"].clone();
    let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let h = hits.clone();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(move || {
                let f = fixture.clone();
                h.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async move { axum::Json(f) }
            }),
        )
        .await
        .unwrap();
    });
    let mut b = peer.builtins();
    b.kakao = format!("http://{addr}");
    let vars = peer.vars("push");
    let s = server2::runtime_services::RuntimeServices::from_vars_at(
        &|n| {
            if n == "GEOCODER_KAKAO_KEYS" {
                Some(r#"["synthetic-kakao-key"]"#.into())
            } else {
                vars(n)
            }
        },
        &b,
    )
    .unwrap();
    let (_, body) = s
        .native_fetch
        .get(
            format!("{INTERNAL_ORIGIN}/geocode/v000903/coord/37.566,126.978"),
            Some("ko-KR".into()),
        )
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["country"], "KR");
    assert!(value["kmaAddress"]["name1"].as_str().is_some());
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    let counts: serde_json::Value = serde_json::from_slice(
        &reqwest::get(format!("{}__catalog/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        counts
            .as_object()
            .unwrap()
            .keys()
            .all(|k| !k.contains("37.566") && !k.contains("126.978")),
        "exact reverse coordinates stay memory-only"
    );
    task.abort();
}

struct Forward;
impl BackendHandler for Forward {
    fn fetch(
        &self,
        _: String,
        _: String,
        _: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(async { Err(GatewayError::Provider) })
    }
    fn fetch_or_forward(
        &self,
        _: String,
        _: String,
        _: Instant,
    ) -> BoxFuture<'_, Result<server2::gateway::backend::Native, GatewayError>> {
        Box::pin(async { Ok(server2::gateway::backend::Native::Forward) })
    }
}
struct WorldGeo;
impl server2::gateway::Geocoder for WorldGeo {
    fn coord(
        &self,
        _: [f64; 2],
        _: String,
    ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, GatewayError>> {
        Box::pin(async {
            Ok(server2::geocode::GeoClient {
                country: Some("US".into()),
                location: Some(server2::geocode::Location {
                    lat: 10.,
                    long: 20.,
                }),
                ..Default::default()
            })
        })
    }
    fn addr(
        &self,
        _: String,
        _: String,
    ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, GatewayError>> {
        self.coord([10., 20.], String::new())
    }
}
#[tokio::test]
async fn selected_native_forward_is_terminal_even_with_explicit_legacy_origin() {
    use server2::gateway::{BackendDispatcher, BackendMode, Family, Gateway, Version};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let h = hits.clone();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().fallback(move || {
                h.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async { "{}" }
            }),
        )
        .await
        .unwrap();
    });
    let d = BackendDispatcher::legacy(&format!("http://{addr}"))
        .unwrap()
        .with_native(Version::V000902, Family::Dsf, Arc::new(Forward));
    d.set_backend(Version::V000902, Family::Dsf, BackendMode::Native)
        .unwrap();
    let g = Gateway::new(Arc::new(WorldGeo), d);
    let r = g
        .handle(
            axum::http::Request::get("/weather/v000902/coord/10,20")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(r.status(), 501);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
    task.abort();
}
