//! SWITCH: the world family is a native S10 backend handler; legacy remains the default and
//! the rollback target. Native output reproduces the S02 public gateway world goldens.
use super::common::*;
use axum::{
    body::{Body, to_bytes},
    http::{HeaderValue, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::{
    gateway::{
        BackendDispatcher, BackendMode, BoxFuture, Family, Gateway, GatewayError, Geocoder, Version,
    },
    geocode::{GeoClient, Location},
    world::{Unconfigured, World, WorldBackend, WorldConfig, runtime::from_vars},
};
use std::sync::Arc;

struct London;
impl Geocoder for London {
    fn coord(&self, _: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async {
            Ok(GeoClient {
                name: Some("London".into()),
                country: Some("GB".into()),
                address: Some("London, UK".into()),
                location: Some(Location {
                    lat: 51.507,
                    long: -0.128,
                }),
                kma_address: None,
            })
        })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], String::new())
    }
}
fn golden(id: &str) -> serde_json::Value {
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../golden/records.json")).unwrap();
    records["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}
async fn send(
    gateway: &Gateway,
    case: &serde_json::Value,
) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .uri(case["request"]["path"].as_str().unwrap())
        .body(Body::empty())
        .unwrap();
    for (k, v) in case["request"]["headers"].as_object().unwrap() {
        req.headers_mut().insert(
            axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
            HeaderValue::from_str(v.as_str().unwrap()).unwrap(),
        );
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_world_switch_reproduces_s02_gateway_world_and_rolls_back() {
    let sc = scenario("london-recorded");
    let e = engine(sc, memory());
    e.clock.set(ms("2026-09-26T07:04:30.000Z"));
    expect_calls(&e.vc, &sc["steps"][0]["requests"][0]);
    let backend = Arc::new(e.backend);
    // Port 9 is closed: a legacy hop fails, which proves which backend served a response.
    let dispatcher = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    backend.register(&dispatcher);
    for v in [Version::V000901, Version::V000902, Version::V000903] {
        assert_eq!(dispatcher.mode(v, Family::Dsf), BackendMode::Legacy);
    }
    let gateway = Gateway::new(Arc::new(London), dispatcher.clone());
    let cases = [
        "gateway-default-world",
        "gateway-v000901-world",
        "gateway-v000902-world",
        "gateway-v000903-world",
    ];
    let (status, _, _) = send(&gateway, &golden(cases[0])).await;
    assert_eq!(status, 501, "legacy default selected");
    assert_eq!(
        e.vc.calls.lock().unwrap().len(),
        0,
        "no native provider call while legacy"
    );
    WorldBackend::select(
        &dispatcher,
        &[Version::V000901, Version::V000902, Version::V000903],
        BackendMode::Native,
    )
    .unwrap();
    for id in cases {
        let case = golden(id);
        let (status, headers, bytes) = send(&gateway, &case).await;
        assert_eq!(status, case["status"].as_u64().unwrap() as u16, "{id}");
        let expected = STANDARD
            .decode(case["body_base64"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&bytes),
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
    assert_eq!(
        e.vc.calls.lock().unwrap().len(),
        1,
        "one combined fetch for the cell"
    );
    WorldBackend::select(&dispatcher, &[Version::V000901], BackendMode::Legacy).unwrap();
    let (status, _, _) = send(&gateway, &golden("gateway-default-world")).await;
    assert_eq!(status, 501, "rollback to legacy for v000901");
    let (status, _, _) = send(&gateway, &golden("gateway-v000903-world")).await;
    assert_eq!(status, 200, "v000903 stays native");
}

#[test]
fn runtime_option_is_opt_in_and_loopback_only() {
    let vars = |pairs: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| (*v).to_owned())
        }
    };
    assert!(from_vars(&vars(&[])).unwrap().is_none());
    assert!(from_vars(&vars(&[("SERVER2_WORLD_MODE", "native")])).is_err());
    const BASE: [(&str, &str); 8] = [
        ("SERVER2_WORLD_MODE", "native-local"),
        ("SERVER2_WORLD_S3_ENDPOINT", "http://127.0.0.1:9/"),
        ("SERVER2_WORLD_S3_BUCKET", "server2-local"),
        ("SERVER2_WORLD_S3_ACCESS_KEY_ID", "server2-local"),
        ("SERVER2_WORLD_S3_SECRET_ACCESS_KEY", "server2-local-secret"),
        ("SERVER2_WORLD_VC_DAILY_UNITS", "1000"),
        (
            "SERVER2_WORLD_VC_QUOTA_ID",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
        ("VC_SECRET_KEY", "synthetic-vc-key-0001"),
    ];
    static OK: [(&str, &str); 9] = [
        BASE[0],
        BASE[1],
        BASE[2],
        BASE[3],
        BASE[4],
        BASE[5],
        BASE[6],
        BASE[7],
        ("SERVER2_WORLD_VC_URL", "http://127.0.0.1:9/timeline/"),
    ];
    let (backend, versions) = from_vars(&vars(&OK)).unwrap().unwrap();
    assert_eq!(versions.len(), 3);
    let dispatcher = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    backend.register(&dispatcher);
    assert_eq!(
        dispatcher.mode(Version::V000903, Family::Dsf),
        BackendMode::Legacy
    );
    static LIVE: [(&str, &str); 9] = [
        BASE[0],
        BASE[1],
        BASE[2],
        BASE[3],
        BASE[4],
        BASE[5],
        BASE[6],
        BASE[7],
        (
            "SERVER2_WORLD_VC_URL",
            "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/",
        ),
    ];
    assert!(
        from_vars(&vars(&LIVE)).is_err(),
        "live provider URL rejected"
    );
    let _ = World::new(
        memory(),
        Arc::new(server2::world::Disabled),
        Arc::new(Unconfigured),
        Arc::new(server2::world::FixedClock::new(0.)),
        WorldConfig::default(),
    );
}
