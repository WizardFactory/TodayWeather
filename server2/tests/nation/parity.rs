use super::support::UnusedCitySource;
use serde_json::Value;
use server2::{
    domestic::kma::{KmaRequest, Outcome, backend::parse_path},
    gateway::{BoxFuture, GatewayError, OrderedJson},
    nation::{CitySource, NationAir, NationBackend, NationSource, object, text},
};
use std::sync::{Arc, Mutex};
use tokio::time::Instant;
fn oracle() -> Value {
    serde_json::from_str(include_str!("oracle.json")).unwrap()
}
struct Cities {
    status: Option<u16>,
    calls: Mutex<Vec<String>>,
}
impl CitySource for Cities {
    fn weather(&self, r: KmaRequest, _: Instant) -> BoxFuture<'_, Result<Outcome, GatewayError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(r.version.clone());
            if let Some(status) = self.status {
                return Ok(Outcome::Status(status, "dependency error".into()));
            }
            let name = [r.region, r.city]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("/");
            Ok(Outcome::Json(object(vec![
                ("cityName", text(&name)),
                ("current", object(vec![("t1h", OrderedJson::Number(20.))])),
                (
                    "airInfo",
                    object(vec![("private", OrderedJson::Bool(true))]),
                ),
                ("airInfoList", OrderedJson::Array(vec![object(vec![])])),
            ])))
        })
    }
}
struct Air {
    rows: Vec<OrderedJson>,
    status: OrderedJson,
}
impl NationSource for Air {
    fn nation_air(&self, _: f64, _: Instant) -> BoxFuture<'_, NationAir> {
        Box::pin(async {
            NationAir {
                rows: self.rows.clone(),
                status: self.status.clone(),
            }
        })
    }
}
#[tokio::test]
async fn real_legacy_route_composition_matches_native_bytes_for_each_used_version_and_failure() {
    let oracle = oracle();
    let now =
        server2::world::vc::parse_iso_z(&oracle["now"].as_str().unwrap().replace(".000Z", "Z"));
    for case in oracle["scenarios"].as_array().unwrap() {
        // Header/version boundary cases exercise DirectRoutes in request_edges.rs.
        if case.get("headers").is_some() {
            continue;
        }
        let version = case["version"].as_str().unwrap();
        // This test isolates the route boundary; AirInputs storage/fallback is tested separately.
        let ordered = case
            .get("body")
            .map(|b| OrderedJson::parse(b.as_str().unwrap().as_bytes()).unwrap());
        let rows = match &ordered {
            Some(body) => match body.get("air").unwrap() {
                OrderedJson::Array(rows) => rows.clone(),
                _ => panic!(),
            },
            None => case["stored"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| OrderedJson::from_serde(v).unwrap())
                .collect(),
        };
        let status = ordered
            .as_ref()
            .and_then(|b| b.get("airStatus"))
            .cloned()
            .unwrap_or(OrderedJson::Null);
        let error = case
            .get("error")
            .and_then(|e| e["message"].as_str())
            .and_then(|m| m.strip_prefix("response.statusCode="))
            .and_then(|m| m.split(' ').next())
            .and_then(|n| n.parse().ok());
        let cities = Arc::new(Cities {
            status: error,
            calls: Mutex::new(Vec::new()),
        });
        let backend = NationBackend::new(
            cities.clone(),
            Arc::new(Air { rows, status }),
            Arc::new(move || now),
        );
        let query = case["query"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| format!("{k}={}", v.as_str().unwrap()))
            .collect::<Vec<_>>()
            .join("&");
        let req = parse_path(&format!("/{version}/kma/addr/Seoul?{query}"), "ko").unwrap();
        let outcome = backend.outcome(req).await;
        match outcome {
            Outcome::Json(body) => assert_eq!(
                String::from_utf8(body.to_bytes()).unwrap(),
                case["body"].as_str().unwrap(),
                "{}",
                case["id"]
            ),
            Outcome::Status(500, body) => {
                let msg = case["error"]["message"].as_str().unwrap();
                assert_eq!(
                    body,
                    case["error"]["html"].as_str().unwrap(),
                    "jade {}",
                    case["id"]
                );
                assert_eq!(
                    Outcome::Status(500, body),
                    server2::nation::rendered_error(msg),
                    "{}",
                    case["id"]
                );
            }
            other => panic!("unexpected {} {other:?}", case["id"]),
        }
        assert!(cities.calls.lock().unwrap().iter().all(|v| v == version));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_http_nation_get_head_and_304_never_contact_legacy() {
    use server2::{
        api::{DirectFamilies, DirectRoutes},
        domestic::kma::{AssemblyConfig, backend::KmaBackend},
        gateway::{BackendDispatcher, Gateway, LegacyGeocoder},
    };
    let oracle = oracle();
    let case = oracle["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "all-provinces")
        .unwrap();
    let expected = OrderedJson::parse(case["body"].as_str().unwrap().as_bytes()).unwrap();
    let rows = match expected.get("air").unwrap() {
        OrderedJson::Array(rows) => rows.clone(),
        _ => panic!(),
    };
    let cities = Arc::new(Cities {
        status: None,
        calls: Mutex::new(Vec::new()),
    });
    let now =
        server2::world::vc::parse_iso_z(&oracle["now"].as_str().unwrap().replace(".000Z", "Z"));
    let backend = Arc::new(NationBackend::new(
        cities,
        Arc::new(Air {
            rows,
            status: expected.get("airStatus").unwrap().clone(),
        }),
        Arc::new(move || now),
    ));
    let legacy = "http://127.0.0.1:1"; // Closed port: an accidental legacy hop fails this check.
    let dispatcher = BackendDispatcher::legacy(legacy).unwrap();
    let kma = Arc::new(KmaBackend::new(
        Arc::new(UnusedCitySource),
        Arc::new(move || now),
        AssemblyConfig::default(),
    ));
    let direct = DirectRoutes::new(
        kma,
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: true,
            town: false,
        },
        dispatcher.clone(),
    )
    .with_nation(backend);
    let gateway = Gateway::new(Arc::new(LegacyGeocoder::new(legacy).unwrap()), dispatcher)
        .with_direct(Arc::new(direct));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, gateway.router()).await.unwrap() });
    let client = reqwest::Client::new();
    for path in ["/v000903/nation/KR", "/V000901/NaTiOn/US/"] {
        let url = format!("http://{addr}{path}");
        let response = client.get(&url).send().await.unwrap();
        assert_eq!(response.status(), 200);
        let tag = response.headers()["etag"].to_str().unwrap().to_owned();
        assert_eq!(
            response.bytes().await.unwrap().as_ref(),
            case["body"].as_str().unwrap().as_bytes()
        );
        let response = client
            .get(&url)
            .header("if-none-match", &tag)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 304);
        assert!(response.bytes().await.unwrap().is_empty());
        let response = client.head(&url).send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["etag"], tag);
        assert!(response.bytes().await.unwrap().is_empty());
    }
    let bad = client
        .get(format!("http://{addr}/v000903/nation/%FF"))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 400);
    let body = bad.text().await.unwrap();
    assert!(body.contains("Failed to decode param '%FF'"));
    eprintln!(
        "Actual local HTTP: v000903 and v000901 GET=200 (15 cities, 17 provinces), HEAD=200 (empty), ETag revalidation=304 (empty); legacy origin closed."
    );
    task.abort();
}

#[test]
fn unconverted_stored_province_rows_recalculate_like_the_actual_legacy_controller() {
    let fixture = OrderedJson::parse(include_bytes!("oracle.json")).unwrap();
    let OrderedJson::Array(cases) = fixture.get("scenarios").unwrap() else {
        panic!()
    };
    for case in cases {
        let id = case.get("id").unwrap().string().unwrap();
        if !matches!(
            id.as_str(),
            "all-provinces"
                | "fresh-province"
                | "unit-airkorea_who"
                | "unit-airnow"
                | "unit-aqicn"
                | "unit-invalid"
                | "v901-success"
        ) {
            continue;
        }
        let unit = case
            .get("query")
            .unwrap()
            .get("airUnit")
            .cloned()
            .unwrap_or(text("airkorea"));
        let OrderedJson::Array(stored) = case.get("stored").unwrap() else {
            panic!()
        };
        let rows = stored
            .iter()
            .map(|row| {
                let OrderedJson::Object(mut fields) = row.clone() else {
                    panic!()
                };
                fields.push(("source".encode_utf16().collect(), text("airkorea")));
                fields.push((
                    "coverage".encode_utf16().collect(),
                    text("province-average"),
                ));
                server2::domestic::kma::recalculate_nation_air(&OrderedJson::Object(fields), &unit)
            })
            .collect::<Result<Vec<_>, _>>();
        if id == "unit-invalid" {
            assert!(rows.is_err());
            continue;
        }
        let expected =
            OrderedJson::parse(case.get("body").unwrap().string().unwrap().as_bytes()).unwrap();
        assert_eq!(
            OrderedJson::Array(rows.unwrap()).to_bytes(),
            expected.get("air").unwrap().to_bytes(),
            "{id}"
        );
    }
}

#[tokio::test]
async fn nation_rendered_errors_keep_jade_send_headers_after_native_finalhandler_integration() {
    use axum::{
        body::{Body, to_bytes},
        http::{Method, Request},
    };
    use server2::{
        api::{DirectFamilies, DirectRoutes},
        domestic::kma::{AssemblyConfig, backend::KmaBackend},
        gateway::BackendDispatcher,
    };
    let fixture = oracle();
    for (id, child_status) in [("v901-child-500", 500), ("v903-child-404", 404)] {
        let case = fixture["scenarios"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap();
        let expected = case["error"]["html"].as_str().unwrap().as_bytes();
        let clock = Arc::new(|| 0.);
        let direct = DirectRoutes::new(
            Arc::new(KmaBackend::new(
                Arc::new(UnusedCitySource),
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
            Arc::new(Cities {
                status: Some(child_status),
                calls: Mutex::new(vec![]),
            }),
            Arc::new(Air {
                rows: vec![],
                status: OrderedJson::Null,
            }),
            clock,
        )));
        let path = format!("/{}/nation/KR", case["version"].as_str().unwrap());
        let tag = server2::gateway::response::etag(expected);
        for method in [Method::GET, Method::HEAD] {
            let request = Request::builder()
                .method(method.clone())
                .uri(&path)
                .header("if-none-match", &tag)
                .body(Body::empty())
                .unwrap();
            let response = direct.handle(request).await;
            assert_eq!(response.status(), 500, "{id}");
            assert_eq!(
                response.headers()["content-type"],
                "text/html; charset=utf-8"
            );
            assert_eq!(
                response.headers()["content-length"],
                expected.len().to_string()
            );
            assert_eq!(response.headers()["etag"], tag);
            // res.render uses res.send's ETag contract, unlike the native finalhandler errors.
            assert!(!response.headers().contains_key("x-content-type-options"));
            assert!(!response.headers().contains_key("set-cookie"));
            let body = to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap();
            if method == Method::HEAD {
                assert!(body.is_empty());
            } else {
                assert_eq!(body.as_ref(), expected);
            }
        }
    }
}
