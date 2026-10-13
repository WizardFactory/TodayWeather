//! Frozen S02 wire bodies plus actual loopback forwarding, switches and owner lifetime.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{HeaderValue, Method, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use server2::{
    gateway::{
        BackendDispatcher, BackendHandler, BackendMode, BoxFuture, Family, Gateway, GatewayError,
        Geocoder, OrderedJson, Version,
    },
    geocode::{GeoClient, KmaAddress, Location},
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::Instant;

#[derive(Clone)]
struct FixedGeo {
    geo: GeoClient,
    error: Option<GatewayError>,
    delay: Duration,
}
impl Geocoder for FixedGeo {
    fn coord(&self, _: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            if let Some(error) = &self.error {
                Err(error.clone())
            } else {
                Ok(self.geo.clone())
            }
        })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], String::new())
    }
}
struct Native {
    body: Vec<u8>,
    error: Option<GatewayError>,
    seen: Arc<Mutex<Vec<(String, String)>>>,
}
impl BackendHandler for Native {
    fn fetch(
        &self,
        path: String,
        lang: String,
        _: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push((path, lang));
            if let Some(error) = &self.error {
                Err(error.clone())
            } else {
                OrderedJson::parse(&self.body)
            }
        })
    }
}
fn geo_world() -> GeoClient {
    GeoClient {
        name: Some("London".into()),
        country: Some("GB".into()),
        address: Some("London, UK".into()),
        location: Some(Location {
            lat: 51.507,
            long: -0.128,
        }),
        kma_address: None,
    }
}
type SeenHops = Arc<Mutex<Vec<(String, String)>>>;
fn native_gateway(
    geo: GeoClient,
    body: Vec<u8>,
    geo_error: Option<GatewayError>,
    backend_error: Option<GatewayError>,
) -> (Gateway, SeenHops) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let native = Arc::new(Native {
        body,
        error: backend_error,
        seen: seen.clone(),
    });
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    for version in [Version::V000901, Version::V000902, Version::V000903] {
        for family in [Family::Kma, Family::Dsf] {
            backends.register_native(version, family, native.clone());
            backends
                .set_backend(version, family, BackendMode::Native)
                .unwrap();
        }
    }
    (
        Gateway::new(
            Arc::new(FixedGeo {
                geo,
                error: geo_error,
                delay: Duration::ZERO,
            }),
            backends,
        ),
        seen,
    )
}
fn request(path: &str) -> Request {
    Request::builder().uri(path).body(Body::empty()).unwrap()
}
#[tokio::test]
async fn s02_gateway_and_geocode_wire_goldens() {
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../golden/records.json")).unwrap();
    let mut count = 0;
    for case in records["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        if !id.starts_with("gateway-")
            && !id.starts_with("geocode-")
            && !["weather-invalid", "weather-no-geocode"].contains(&id)
        {
            continue;
        }
        if id == "gateway-deadline" {
            continue;
        } // An actual nine-second owner scenario runs separately.
        let expected = STANDARD
            .decode(case["body_base64"].as_str().unwrap())
            .unwrap();
        let status = case["status"].as_u64().unwrap();
        let mut geo = geo_world();
        if status == 200 {
            let body: serde_json::Value = serde_json::from_slice(&expected).unwrap();
            let mut fields = serde_json::Map::new();
            for key in ["name", "country", "address", "location", "kmaAddress"] {
                if let Some(value) = body.get(key) {
                    fields.insert(key.into(), value.clone());
                }
            }
            geo = serde_json::from_value(serde_json::Value::Object(fields)).unwrap();
            if geo.country.as_deref() == Some("KR") && geo.kma_address.is_none() {
                geo.kma_address = Some(KmaAddress {
                    name1: "서울특별시".into(),
                    name2: Some("중구".into()),
                    name3: Some("명동".into()),
                });
            }
            // Public address result intentionally contains no KMA fields.
            if id.contains("-addr") {
                geo.kma_address = None;
            }
        }
        let geo_error = if [
            "geocode-auth",
            "geocode-quota",
            "geocode-empty",
            "weather-no-geocode",
        ]
        .contains(&id)
        {
            Some(GatewayError::Provider)
        } else {
            None
        };
        let backend_error = if id == "gateway-unavailable" {
            Some(GatewayError::Unavailable(60))
        } else if status >= 500 {
            Some(GatewayError::Provider)
        } else {
            None
        };
        let (gateway, seen) = native_gateway(geo, expected.clone(), geo_error, backend_error);
        let mut req = request(case["request"]["path"].as_str().unwrap());
        if let Some(headers) = case["request"]["headers"].as_object() {
            for (key, value) in headers {
                req.headers_mut().insert(
                    axum::http::HeaderName::from_bytes(key.as_bytes()).unwrap(),
                    HeaderValue::from_str(value.as_str().unwrap()).unwrap(),
                );
            }
        }
        let response = gateway.handle(req).await;
        assert_eq!(response.status().as_u16(), status as u16, "{id}");
        for pair in case["headers"].as_array().unwrap() {
            let key = pair[0].as_str().unwrap();
            if ["date", "connection"].contains(&key) {
                continue;
            }
            assert_eq!(
                response.headers().get(key).and_then(|v| v.to_str().ok()),
                pair[1].as_str(),
                "{id}: {key}"
            );
        }
        let body = to_bytes(response.into_body(), 6 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), expected, "{id}");
        if let Some(trace) = case["dependency_trace"]["backend"].as_array()
            && let Some(hop) = trace.first()
        {
            let seen = seen.lock().unwrap();
            assert_eq!(seen.len(), 1, "{id}");
            assert_eq!(seen[0].0, hop["path"].as_str().unwrap(), "{id}");
            assert_eq!(
                seen[0].1,
                hop["headers"]["accept-language"].as_str().unwrap(),
                "{id}"
            );
        }
        count += 1;
    }
    assert_eq!(count, 24);
}
#[tokio::test]
async fn head_conditional_preflight_and_methods() {
    let (gateway, _) = native_gateway(
        geo_world(),
        br#"{"answer":1,"name":"old"}"#.to_vec(),
        None,
        None,
    );
    let first = gateway.handle(request("/weather/coord/51,-.1")).await;
    let tag = first.headers()["etag"].clone();
    let length = first.headers()["content-length"].clone();
    let mut req = request("/weather/coord/51,-.1");
    *req.method_mut() = Method::HEAD;
    let head = gateway.handle(req).await;
    assert_eq!(head.status(), 200);
    assert_eq!(head.headers()["content-length"], length);
    assert!(to_bytes(head.into_body(), 1000).await.unwrap().is_empty());
    let mut req = request("/weather/coord/51,-.1");
    req.headers_mut().insert("if-none-match", tag);
    let not_modified = gateway.handle(req).await;
    assert_eq!(not_modified.status(), 304);
    assert!(!not_modified.headers().contains_key("content-type"));
    assert!(!not_modified.headers().contains_key("content-length"));
    let mut req = request("/weather/coord/51,-.1");
    req.headers_mut()
        .insert("if-none-match", HeaderValue::from_static("*"));
    req.headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-cache"));
    assert_eq!(gateway.handle(req).await.status(), 200);
    let mut req = request("/weather/coord/51,-.1");
    *req.method_mut() = Method::OPTIONS;
    req.headers_mut().insert(
        "access-control-request-headers",
        HeaderValue::from_static("content-type, x-example"),
    );
    let preflight = gateway.handle(req).await;
    assert_eq!(preflight.status(), 204);
    assert_eq!(
        preflight.headers()["access-control-allow-headers"],
        "content-type, x-example"
    );
    assert_eq!(
        preflight.headers()["vary"],
        "Access-Control-Request-Headers"
    );
    let mut req = request("/weather/coord/51,-.1");
    *req.method_mut() = Method::POST;
    assert_eq!(gateway.handle(req).await.status(), 404);
}
struct Peer {
    url: String,
    seen: Arc<Mutex<Vec<(String, String)>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn peer(replies: Vec<(u16, Vec<u8>)>) -> Peer {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let captured = seen.clone();
    let replies = Arc::new(replies);
    let app = Router::new().fallback(move |request: Request| {
        let seen = captured.clone();
        let replies = replies.clone();
        async move {
            let index = {
                let mut seen = seen.lock().unwrap();
                let index = seen.len();
                seen.push((
                    request.uri().to_string(),
                    request
                        .headers()
                        .get("accept-language")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .into(),
                ));
                index
            };
            let (status, body) = &replies[index.min(replies.len() - 1)];
            let mut response = Response::new(Body::from(body.clone()));
            *response.status_mut() = StatusCode::from_u16(*status).unwrap();
            response
                .headers_mut()
                .insert("content-type", HeaderValue::from_static("text/plain"));
            response
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Peer { url, seen, task }
}
#[tokio::test]
async fn actual_legacy_http_retry_parser_native_switch_and_rollback() {
    let peer = peer(vec![
        (503, b"upstream temporarily down".to_vec()),
        (502, b"bad gateway".to_vec()),
        (200, br#"{"source":"legacy","name":"old"}"#.to_vec()),
    ])
    .await;
    let backends = BackendDispatcher::legacy(&peer.url).unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    backends.register_native(
        Version::V000901,
        Family::Dsf,
        Arc::new(Native {
            body: br#"{"source":"native"}"#.to_vec(),
            error: None,
            seen: seen.clone(),
        }),
    );
    assert_eq!(
        backends.mode(Version::V000901, Family::Dsf),
        BackendMode::Legacy
    );
    assert_eq!(
        backends.set_backend(Version::V000902, Family::Dsf, BackendMode::Native),
        Err(GatewayError::InvalidConfiguration)
    );
    let gateway = Gateway::new(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::ZERO,
        }),
        backends.clone(),
    );
    let response = gateway
        .handle(request("/weather/coord/51.507,-.128?a=x+y&a=z"))
        .await;
    assert_eq!(response.status(), 200);
    assert!(
        String::from_utf8(to_bytes(response.into_body(), 1000).await.unwrap().to_vec())
            .unwrap()
            .contains("\"source\":\"legacy\"")
    );
    assert_eq!(peer.seen.lock().unwrap().len(), 3);
    backends
        .set_backend(Version::V000901, Family::Dsf, BackendMode::Native)
        .unwrap();
    let response = gateway.handle(request("/weather/coord/51.507,-.128")).await;
    assert!(
        String::from_utf8(to_bytes(response.into_body(), 1000).await.unwrap().to_vec())
            .unwrap()
            .contains("\"source\":\"native\"")
    );
    assert_eq!(seen.lock().unwrap().len(), 1);
    backends
        .set_backend(Version::V000901, Family::Dsf, BackendMode::Legacy)
        .unwrap();
    assert_eq!(
        gateway
            .handle(request("/weather/coord/51.507,-.128"))
            .await
            .status(),
        200
    );
    assert_eq!(peer.seen.lock().unwrap().len(), 4);
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen[0].0, "/v000901/dsf/coord/51.507,-0.128?a=z");
    assert_eq!(seen[0].1, "en");
}
#[tokio::test]
async fn unavailable_marker_stops_retries_and_legacy_geocoder_uses_exact_shape() {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        + 60_000;
    let p = peer(vec![(
        503,
        format!("{{\"code\":\"EWEATHERUNAVAILABLE\",\"retryAt\":{at}}}").into_bytes(),
    )])
    .await;
    let gateway = Gateway::new(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::ZERO,
        }),
        BackendDispatcher::legacy(&p.url).unwrap(),
    );
    let response = gateway.handle(request("/weather/coord/51,-.1")).await;
    assert_eq!(response.status(), 503);
    let retry = response.headers()["retry-after"]
        .to_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert!((59..=60).contains(&retry));
    assert_eq!(p.seen.lock().unwrap().len(), 1);
    let p = peer(vec![(200, serde_json::to_vec(&geo_world()).unwrap())]).await;
    let adapter = server2::gateway::LegacyGeocoder::new(&p.url).unwrap();
    let geo = adapter.coord([51.507, -0.128], "ko".into()).await.unwrap();
    assert_eq!(
        serde_json::to_vec(&geo).unwrap(),
        serde_json::to_vec(&geo_world()).unwrap()
    );
    adapter
        .addr("London / UK".into(), "en".into())
        .await
        .unwrap();
    let seen = p.seen.lock().unwrap();
    assert_eq!(
        seen[0],
        ("/geocode/v000903/coord/51.507,-0.128".into(), "ko".into())
    );
    assert_eq!(seen[1].0, "/geocode/v000903/addr/London%20%2F%20UK");
}
#[tokio::test]
async fn disconnected_waiter_does_not_release_owner_and_deadline_is_bounded() {
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    let gateway = Gateway::with_limits(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::from_millis(100),
        }),
        backends,
        1,
        Duration::from_millis(150),
    )
    .unwrap();
    let clone = gateway.clone();
    let waiter =
        tokio::spawn(async move { clone.handle(request("/geocode/v000903/coord/51,-.1")).await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(gateway.inflight(), 1);
    waiter.abort();
    let _ = waiter.await;
    assert_eq!(gateway.inflight(), 1);
    assert_eq!(
        gateway
            .handle(request("/geocode/v000903/coord/51,-.1"))
            .await
            .status(),
        503
    );
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert_eq!(gateway.inflight(), 0);
    let gateway = Gateway::with_limits(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::from_secs(1),
        }),
        BackendDispatcher::legacy("http://127.0.0.1:9").unwrap(),
        1,
        Duration::from_millis(20),
    )
    .unwrap();
    let start = Instant::now();
    assert_eq!(
        gateway
            .handle(request("/geocode/v000903/coord/51,-.1"))
            .await
            .status(),
        501
    );
    assert!(start.elapsed() < Duration::from_millis(200));
    assert_eq!(gateway.inflight(), 0);
}
#[tokio::test]
async fn production_nine_second_deadline_matches_s02() {
    let gateway = Gateway::new(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::from_secs(60),
        }),
        BackendDispatcher::legacy("http://127.0.0.1:9").unwrap(),
    );
    let start = Instant::now();
    let response = gateway
        .handle(request("/weather/v000903/coord/37.5,127"))
        .await;
    assert_eq!(response.status(), 501);
    assert_eq!(
        to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
        b"Not Implemented"
    );
    assert!(start.elapsed() >= Duration::from_secs(9));
    assert!(start.elapsed() < Duration::from_secs(10));
    assert_eq!(gateway.inflight(), 0);
}
#[test]
fn endpoint_validation_and_js_json_roundtrip() {
    assert!(BackendDispatcher::legacy("http://example.com").is_err());
    assert!(BackendDispatcher::legacy("http://127.0.0.1:3?key=secret").is_err());
    assert!(BackendDispatcher::legacy("https://user:password@example.com").is_err());
    let input =
        br#"{"10":0,"2":1,"name":"old","z":1.0,"a":1e-7,"huge":1e400,"text":"\ud800","2":2}"#;
    let mut json = OrderedJson::parse(input).unwrap();
    json.merge_geo(&OrderedJson::parse(br#"{"name":"new","country":"GB"}"#).unwrap());
    assert_eq!(
        json.to_bytes(),
        br#"{"2":2,"10":0,"name":"new","z":1,"a":1e-7,"huge":null,"text":"\ud800","country":"GB"}"#
    );
    for invalid in [
        b"[1,]".as_slice(),
        b"{\"x\":1e+-2}",
        b"01",
        br#""\u+001""#,
        b"{\"x\":true false}",
        b"{\"x\":1,}",
    ] {
        assert!(OrderedJson::parse(invalid).is_err());
    }
    for (value, expected) in [
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1e21, "1e+21"),
        (-0., "0"),
        (1e23, "1e+23"),
        (1000000000000000128., "1000000000000000100"),
        (f64::from_bits(0xc2d0645a6b4678e8), "-72092799015395.62"),
    ] {
        assert_eq!(server2::gateway::response::js_number(value), expected);
    }
    let mut array = OrderedJson::parse(b"[1,2]").unwrap();
    array.merge_geo(&OrderedJson::parse(br#"{"name":"ignored"}"#).unwrap());
    assert_eq!(array.to_bytes(), b"[1,2]");
}

struct SlowNative;
impl BackendHandler for SlowNative {
    fn fetch(
        &self,
        _: String,
        _: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(async move {
            assert!(deadline.saturating_duration_since(Instant::now()) <= Duration::from_secs(3));
            tokio::time::sleep(Duration::from_secs(30)).await;
            Err(GatewayError::Provider)
        })
    }
}
#[tokio::test]
async fn native_backend_attempt_is_capped_at_three_seconds() {
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9")
        .unwrap()
        .with_native(Version::V000901, Family::Dsf, Arc::new(SlowNative));
    backends
        .set_backend(Version::V000901, Family::Dsf, BackendMode::Native)
        .unwrap();
    let gateway = Gateway::new(
        Arc::new(FixedGeo {
            geo: geo_world(),
            error: None,
            delay: Duration::ZERO,
        }),
        backends,
    );
    let started = Instant::now();
    let response = gateway.handle(request("/weather/coord/51,-.1")).await;
    assert_eq!(response.status(), 501);
    assert!(started.elapsed() >= Duration::from_secs(3));
    assert!(started.elapsed() < Duration::from_secs(4));
    assert_eq!(gateway.inflight(), 0);
}
