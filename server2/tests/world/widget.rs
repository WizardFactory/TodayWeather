//! AK's retained /ww widget supplement: current legacy raw rows, not /dsf converted rows.
use super::common::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::io::Read;

fn widget_oracle() -> serde_json::Value {
    let bytes = include_bytes!("fixtures/widget.json.gz");
    let mut text = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut text)
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn widget_body_matches_current_legacy_without_unit_conversion() {
    let sc = scenario("tokyo-recorded");
    let recorded = &sc["steps"][0]["requests"][0];
    for case in widget_oracle()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| {
            matches!(
                c["id"].as_str(),
                Some(
                    "widget-tokyo"
                        | "widget-units"
                        | "widget-locale-ko"
                        | "widget-locale-ja"
                        | "widget-locale-zh-CN"
                )
            )
        })
    {
        let e = engine(sc, memory());
        e.clock.set(ms(case["clock"].as_str().unwrap()));
        expect_calls(&e.vc, recorded);
        let reply = e
            .backend
            .reply(
                case["request"]["path"].as_str().unwrap(),
                case["request"]["headers"]["accept-language"]
                    .as_str()
                    .unwrap_or("en"),
                deadline(),
            )
            .await;
        let server2::world::WorldReply::Body(body) = reply else {
            panic!("widget must return legacy raw body, got {reply:?}")
        };
        let expected = STANDARD
            .decode(case["body_base64"].as_str().unwrap())
            .unwrap();
        assert_eq!(body.to_json(), expected, "{}", case["id"]);
        assert_eq!(e.vc.pending(), 0);
        assert_eq!(e.vc.calls.lock().unwrap().len(), 1);
    }
}

struct NoGeo;
impl server2::gateway::Geocoder for NoGeo {
    fn coord(
        &self,
        _: [f64; 2],
        _: String,
    ) -> server2::gateway::BoxFuture<
        '_,
        Result<server2::geocode::GeoClient, server2::gateway::GatewayError>,
    > {
        Box::pin(async { panic!("widget must not geocode") })
    }
    fn addr(
        &self,
        _: String,
        _: String,
    ) -> server2::gateway::BoxFuture<
        '_,
        Result<server2::geocode::GeoClient, server2::gateway::GatewayError>,
    > {
        Box::pin(async { panic!("widget must not geocode") })
    }
}
#[tokio::test]
async fn widget_http_contract_and_warm_cache_without_geocode_or_legacy() {
    use axum::{
        body::{Body, to_bytes},
        http::{HeaderName, HeaderValue, Request},
    };
    use server2::gateway::{BackendDispatcher, Gateway};
    use std::sync::Arc;
    let sc = scenario("tokyo-recorded");
    let e = engine(sc, memory());
    e.clock.set(ms("2026-09-26T07:04:30.000Z"));
    expect_calls(&e.vc, &sc["steps"][0]["requests"][0]);
    let gateway = Gateway::new(Arc::new(NoGeo), BackendDispatcher::native_only())
        .with_widget(Arc::new(e.backend));
    for case in widget_oracle()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| !c["id"].as_str().unwrap().contains("provider") && c["id"] != "widget-air")
    {
        let input = &case["request"];
        let mut request = Request::builder()
            .method(input["method"].as_str().unwrap_or("GET"))
            .uri(input["path"].as_str().unwrap());
        if let Some(headers) = input["headers"].as_object() {
            for (key, value) in headers {
                request = request.header(
                    HeaderName::from_bytes(key.as_bytes()).unwrap(),
                    HeaderValue::from_str(value.as_str().unwrap()).unwrap(),
                );
            }
        }
        let response = gateway.handle(request.body(Body::empty()).unwrap()).await;
        assert_eq!(
            response.status().as_u16(),
            case["status"].as_u64().unwrap() as u16,
            "{}",
            case["id"]
        );
        for pair in case["headers"].as_array().unwrap() {
            let key = pair[0].as_str().unwrap();
            // Session/date/HTTP framing are connection metadata, not weather contract.
            if ["date", "connection", "set-cookie", "transfer-encoding"].contains(&key) {
                continue;
            }
            assert_eq!(
                response.headers().get(key).and_then(|h| h.to_str().ok()),
                pair[1].as_str(),
                "{}: {key}",
                case["id"]
            );
        }
        assert!(
            response.headers().get("cache-control").is_none(),
            "no new cache policy"
        );
        let bytes = to_bytes(response.into_body(), 1 << 22).await.unwrap();
        assert_eq!(
            &bytes[..],
            &STANDARD
                .decode(case["body_base64"].as_str().unwrap())
                .unwrap(),
            "{}",
            case["id"]
        );
    }
    assert_eq!(
        e.vc.calls.lock().unwrap().len(),
        1,
        "warm/shared world cache; no extra provider work"
    );
    assert_eq!(gateway.inflight(), 0);
}

#[tokio::test]
async fn widget_provider_failure_keeps_401_503_and_500_wire_classes() {
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use server2::gateway::{BackendDispatcher, Gateway};
    use std::sync::Arc;
    for (id, error) in [
        ("widget-provider-401", server2::world::VcError::ProviderDown),
        ("widget-provider-500", server2::world::VcError::Failed),
    ] {
        let sc = scenario("tokyo-recorded");
        let e = engine(sc, memory());
        e.clock.set(ms("2026-09-26T07:04:30.000Z"));
        e.vc.expect(
            Call {
                range: server2::world::Range::Combined,
                lat: 35.69,
                lon: 139.77,
            },
            Answer::Error(error),
        );
        let gateway = Gateway::new(Arc::new(NoGeo), BackendDispatcher::native_only())
            .with_widget(Arc::new(e.backend));
        for name in if id == "widget-provider-401" {
            vec![id, "widget-provider-down-backoff"]
        } else {
            vec![id]
        } {
            let fixture = widget_oracle();
            let case = fixture["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == name)
                .unwrap();
            let req = Request::builder()
                .uri(case["request"]["path"].as_str().unwrap())
                .body(Body::empty())
                .unwrap();
            let response = gateway.handle(req).await;
            assert_eq!(
                response.status().as_u16(),
                case["status"].as_u64().unwrap() as u16,
                "{name}"
            );
            for pair in case["headers"].as_array().unwrap() {
                let key = pair[0].as_str().unwrap();
                if ["date", "connection", "set-cookie", "transfer-encoding"].contains(&key) {
                    continue;
                }
                assert_eq!(
                    response.headers().get(key).and_then(|v| v.to_str().ok()),
                    pair[1].as_str(),
                    "{name} {key}"
                );
            }
            let bytes = to_bytes(response.into_body(), 1 << 22).await.unwrap();
            assert_eq!(
                &bytes[..],
                &STANDARD
                    .decode(case["body_base64"].as_str().unwrap())
                    .unwrap(),
                "{name}"
            );
        }
        assert_eq!(e.vc.calls.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn widget_air_is_legacy_raw_current_only_without_converted_wrapper() {
    use server2::world::{World, WorldBackend, WorldConfig};
    use std::sync::Arc;
    let fixture = widget_oracle();
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "widget-air")
        .unwrap();
    let e = engine(scenario("tokyo-recorded"), memory());
    e.clock.set(ms(case["clock"].as_str().unwrap()));
    expect_calls(
        &e.vc,
        &scenario("tokyo-recorded")["steps"][0]["requests"][0],
    );
    let air =
        RecordedWaqi::new(&serde_json::to_vec(&case["dependency_trace"]["air_body"]).unwrap());
    let backend = WorldBackend::new(World::new(
        memory(),
        e.vc.clone(),
        Arc::new(air),
        e.clock,
        WorldConfig::default(),
    ));
    let reply = backend
        .reply(case["request"]["path"].as_str().unwrap(), "en", deadline())
        .await;
    let server2::world::WorldReply::Body(body) = reply else {
        panic!("{reply:?}")
    };
    assert_eq!(
        body.to_json(),
        STANDARD
            .decode(case["body_base64"].as_str().unwrap())
            .unwrap()
    );
    assert!(
        body.get("thisTime").arr().unwrap()[0]
            .get("airSource")
            .is_undef()
    );
    let current = &body.get("thisTime").arr().unwrap()[1];
    assert_eq!(current.get("airSource").str(), Some("aqicn"));
    assert!(current.get("arpltn").is_undef());
}
