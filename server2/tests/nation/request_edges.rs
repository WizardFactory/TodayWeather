use axum::{
    body::{Body, to_bytes},
    http::{Method, Request},
};
use serde_json::Value;
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::kma::{
        AssemblyConfig, KmaRequest, Outcome,
        backend::{KmaBackend, LegacyOnly},
    },
    gateway::{BackendDispatcher, BoxFuture, GatewayError, OrderedJson},
    nation::{CitySource, NationAir, NationBackend, NationSource, object, text},
};
use std::sync::{Arc, Mutex};
use tokio::time::Instant;

struct Cities(Mutex<Vec<(String, String)>>);
impl CitySource for Cities {
    fn weather(&self, r: KmaRequest, _: Instant) -> BoxFuture<'_, Result<Outcome, GatewayError>> {
        Box::pin(async move {
            let locale = r.locale.name();
            self.0
                .lock()
                .unwrap()
                .push((r.version.clone(), locale.into()));
            let name = [r.region, r.city]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("/");
            Ok(Outcome::Json(object(vec![
                ("cityName", text(&name)),
                ("current", object(vec![("t1h", OrderedJson::Number(20.))])),
                ("childVersion", text(&r.version)),
                ("childLocale", text(locale)),
            ])))
        })
    }
}
struct Air(NationAir);
impl NationSource for Air {
    fn nation_air(&self, _: f64, _: Instant) -> BoxFuture<'_, NationAir> {
        Box::pin(async {
            NationAir {
                rows: self.0.rows.clone(),
                status: self.0.status.clone(),
            }
        })
    }
}
async fn assert_legacy_child_contract(id: &str) {
    let fixture: Value = serde_json::from_str(include_str!("oracle.json")).unwrap();
    let case = fixture["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap();
    let expected = OrderedJson::parse(case["body"].as_str().unwrap().as_bytes()).unwrap();
    let OrderedJson::Array(rows) = expected.get("air").unwrap() else {
        panic!()
    };
    let cities = Arc::new(Cities(Mutex::new(vec![])));
    let clock = Arc::new(|| 0.);
    let direct = DirectRoutes::new(
        Arc::new(KmaBackend::new(
            Arc::new(LegacyOnly),
            clock.clone(),
            AssemblyConfig::default(),
        )),
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: true,
            town: false,
        },
        BackendDispatcher::legacy("http://127.0.0.1:1").unwrap(),
    )
    .with_nation(Arc::new(NationBackend::new(
        cities.clone(),
        Arc::new(Air(NationAir {
            rows: rows.clone(),
            status: expected.get("airStatus").unwrap().clone(),
        })),
        clock,
    )));
    let path = format!("/{}/nation/KR", case["version"].as_str().unwrap());
    assert!(direct.claims(&Method::GET, &path));
    let mut request = Request::builder().uri(&path);
    for (name, value) in case["headers"].as_object().unwrap() {
        request = request.header(name, value.as_str().unwrap());
    }
    let response = direct.handle(request.body(Body::empty()).unwrap()).await;
    assert_eq!(response.status(), 200, "{id}");
    // Compare the actual city version/locale presented to the backend, as well as output bytes.
    let expected_calls = case["cityCalls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|call| {
            let url = reqwest::Url::parse(call["url"].as_str().unwrap()).unwrap();
            (
                url.path().split('/').nth(1).unwrap().to_owned(),
                call["locale"].as_str().unwrap().to_owned(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(*cities.0.lock().unwrap(), expected_calls, "{id}");
    assert_eq!(
        to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap()
            .as_ref(),
        case["body"].as_str().unwrap().as_bytes(),
        "{id}"
    );
}
#[tokio::test]
async fn uppercase_v903_nation_uses_the_actual_legacy_v901_child_default() {
    assert_legacy_child_contract("uppercase-v903-child-default").await;
}
#[tokio::test]
async fn nation_children_use_forwarded_language_header_and_never_the_parent_cookie() {
    assert_legacy_child_contract("nation-child-header-over-parent-cookie").await;
    assert_legacy_child_contract("nation-child-cookie-only-default").await;
}
