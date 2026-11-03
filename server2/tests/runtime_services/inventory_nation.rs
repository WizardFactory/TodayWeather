//! CI-INVENTORY-002: real stored prose remains a strict positive; a late optional
//! read may be omitted without weakening the original weather/child shape.
use axum::{
    body::{Body, to_bytes},
    http::{Method, Request},
};
use serde_json::{Value, json};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::kma::{AssemblyConfig, KmaRequest, Outcome, backend::KmaBackend},
    gateway::{BackendDispatcher, BoxFuture, GatewayError, OrderedJson},
    narrative::{
        self, Read,
        provider::{Error, Page, Source},
        store::{Service, Store},
    },
    nation::{CitySource, NationAir, NationBackend, NationSource},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
#[path = "../nation/support.rs"]
mod nation_support;

pub(super) fn assert_response(value: &Value, expected: &Value) {
    assert_eq!(value["weather"].as_array().unwrap().len(), 15);
    // The real-clock all-family inventory may exhaust the existing optional-read
    // budget. Presence is exact, never null/corrupt; a separate fast native/S3
    // control below requires presence across fresh readers and both versions.
    if let Some(actual) = value.get("forecastNarrative") {
        assert_eq!(actual, expected);
    }
    assert!(
        value["weather"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.get("forecastNarrative").is_none())
    );
}
struct Cities;
impl CitySource for Cities {
    fn weather(&self, _: KmaRequest, _: Instant) -> BoxFuture<'_, Result<Outcome, GatewayError>> {
        Box::pin(async {
            Ok(Outcome::Json(OrderedJson::parse(
            br#"{"current":{"t1h":20},"forecastNarrative":{"text":"child must be stripped"}}"#
        ).unwrap()))
        })
    }
}
struct Air;
impl NationSource for Air {
    fn nation_air(&self, _: f64, _: Instant) -> BoxFuture<'_, NationAir> {
        Box::pin(async {
            NationAir {
                rows: vec![],
                status: OrderedJson::Null,
            }
        })
    }
}
fn routes(reader: Arc<dyn Read>) -> DirectRoutes {
    let clock = Arc::new(|| 0.);
    DirectRoutes::new(
        Arc::new(KmaBackend::new(
            Arc::new(nation_support::UnusedCitySource),
            clock.clone(),
            AssemblyConfig::default(),
        )),
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: true,
            town: false,
        },
        BackendDispatcher::native_only(),
    )
    .with_nation(Arc::new(
        NationBackend::new(Arc::new(Cities), Arc::new(Air), clock).with_narrative(Some(reader)),
    ))
}
async fn response(routes: &DirectRoutes, version: &str) -> Value {
    let path = format!("/{version}/nation/KR");
    assert!(routes.claims(&Method::GET, &path));
    let response = routes
        .handle(
            Request::builder()
                .uri(path)
                .header("accept-language", "ko")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), 200);
    serde_json::from_slice(&to_bytes(response.into_body(), 2 << 20).await.unwrap()).unwrap()
}
struct NoProvider;
impl Source for NoProvider {
    fn fetch(&self, _: u16, _: Instant) -> BoxFuture<'_, Result<Option<Page>, Error>> {
        Box::pin(async { panic!("stored national prose read must not acquire a provider") })
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn national_prose_positive_survives_reader_reconstruction_with_fast_city_inputs() {
    let peer = super::common::Peer::new();
    let transport = peer.services("notice").s3.unwrap();
    let now = narrative::now_ms();
    let publication: String = server2::world::js::iso((now + 9 * 3_600_000) as f64).unwrap()[..16]
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let page = Page {
        content_type: "application/json; charset=utf-8".into(),
        body: serde_json::to_vec(
            &json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{
                "stnId":108,"tmFc":publication,"wfSv1":"Owned national prose <plain> & unchanged"
            }]}}}}),
        )
        .unwrap()
        .into(),
        fetched_at_ms: now as u64,
    };
    let original = Store::new(transport.clone())
        .unwrap()
        .publish(108, page, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap()
        .unwrap();
    let expected = serde_json::to_value(original).unwrap();
    for _phase in 0..2 {
        // Each phase loses all reader memory; actual canonical S3 is retained.
        // City/air inputs are deterministic so optional-read eligibility is separate
        // from cold all-family weather cost. This is not production latency proof.
        let reader: Arc<dyn Read> =
            Arc::new(Service::new(transport.clone(), Arc::new(NoProvider)).unwrap());
        let routes = routes(reader);
        for version in ["v000903", "v000901"] {
            let value = response(&routes, version).await;
            assert_eq!(
                value.get("forecastNarrative"),
                Some(&expected),
                "strict positive: original national prose must survive each reconstructed reader"
            );
            assert_response(&value, &expected);
            assert!(
                value["weather"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| item["current"]["t1h"] == 20)
            );
        }
    }
}
struct PendingRead(Arc<AtomicUsize>);
impl Read for PendingRead {
    fn read(&self, _: u16, _: Instant) -> BoxFuture<'_, Option<narrative::Narrative>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn late_optional_national_prose_is_a_valid_inventory_response() {
    let calls = Arc::new(AtomicUsize::new(0));
    let routes = routes(Arc::new(PendingRead(calls.clone())));
    let started = Instant::now();
    let value = response(&routes, "v000903").await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(started.elapsed() >= Duration::from_secs(2));
    assert!(started.elapsed() <= Duration::from_secs(3));
    assert!(
        value.get("forecastNarrative").is_none(),
        "omit, never synthesize null prose"
    );
    assert_response(
        &value,
        &json!({"text":"original publication remains canonical"}),
    );
}
#[test]
fn national_inventory_still_rejects_null_corrupt_or_child_prose_and_bad_shape() {
    let expected = json!({"text":"original"});
    let valid =
        json!({"weather":vec![json!({"current":{"t1h":20}});15], "forecastNarrative":expected});
    assert_response(&valid, &expected);
    for malformed in [Value::Null, json!({"text":"changed"})] {
        let mut value = valid.clone();
        value["forecastNarrative"] = malformed;
        assert!(std::panic::catch_unwind(|| assert_response(&value, &expected)).is_err());
    }
    let mut child = valid.clone();
    child["weather"][0]["forecastNarrative"] = expected.clone();
    assert!(std::panic::catch_unwind(|| assert_response(&child, &expected)).is_err());
    let mut short = valid;
    short["weather"].as_array_mut().unwrap().pop();
    assert!(std::panic::catch_unwind(|| assert_response(&short, &expected)).is_err());
}
