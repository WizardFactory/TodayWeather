//! Unknown-town/KR provider-boundary oracle, executed by pinned Node16 against actual legacy
//! High-read S3 cases reuse the existing bounded peer to avoid local ephemeral-port exhaustion.
//! functions. This does not represent complete S3-only assembly parity or live provider proof.
use serde_json::{Value, json};
use server2::domestic::kma::source::towns::{added_town, remap_address};
use std::{io::Read, sync::OnceLock};
fn oracle() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let bytes = include_bytes!("fixtures/towns-oracle.json.gz");
        let mut text = String::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .read_to_string(&mut text)
            .unwrap();
        serde_json::from_str(&text).unwrap()
    })
}
#[test]
fn kr_names_match_the_actual_legacy_component_rules() {
    for case in oracle()["remaps"].as_array().unwrap() {
        let answer = remap_address(
            case["address"].as_str().unwrap(),
            &json!({"region":"서울특별시","city":"중구"}),
        );
        assert_eq!(answer, case["params"], "{}", case["address"]);
    }
}
#[test]
fn unknown_town_preserves_coordinate_types_and_first_area_number() {
    for case in oracle()["towns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] != "provider-failure")
    {
        let kind = case["kind"].as_str().unwrap();
        let list = if kind == "no-area" {
            vec![
                json!({"town":{"first":"다른시","second":"다른구","third":"기존동"},"mCoord":{"mx":61,"my":128}}),
            ]
        } else {
            vec![
                json!({"town":{"first":"서울특별시","second":"중구","third":"기존동"},"mCoord":{"mx":if kind=="same-grid" {60}else{61},"my":127},"areaNo":"11140"}),
            ]
        };
        let converted =
            json!({"lat":if kind=="outside" {"20"}else{"37.566"},"lon":"126.978","mx":60,"my":127});
        let names = json!({"first":"서울특별시","second":"중구","third":"새동"});
        let answer = added_town(&converted, &names, &list);
        assert_eq!(answer, case["town"], "{kind}");
    }
}

#[test]
fn town_provider_parsers_preserve_the_two_legacy_coordinate_types() {
    use server2::geocode::town::{google_xml_location, kakao_location};
    let kakao = br#"{"meta":{"total_count":1},"documents":[{"y":"37.566","x":"126.978"}]}"#;
    assert_eq!(
        kakao_location(kakao).unwrap(),
        json!({"provider":"kakao","lat":"37.566","lon":"126.978"})
    );
    let google = b"<GeocodeResponse><status>OK</status><result><geometry><location><lat>37.566</lat><lng>126.978</lng></location></geometry></result></GeocodeResponse>";
    assert_eq!(
        google_xml_location(google).unwrap(),
        json!({"provider":"google","lat":37.566,"lon":126.978})
    );
    assert!(
        google_xml_location(b"<GeocodeResponse><status>ZERO_RESULTS</status></GeocodeResponse>")
            .is_err()
    );
    assert!(kakao_location(br#"{"meta":{"total_count":0},"documents":[]}"#).is_err());
}

use server2::domestic::kma::source::towns::{ResolveError, Resolver};
use server2::geocode::town::{Acquire, Operation};
use server2::geocode::{BoxFuture, GeocodeError};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::time::Instant;
struct AddressPeer {
    calls: AtomicUsize,
    delay: Duration,
}
impl Acquire for AddressPeer {
    fn address(&self, _: Operation, _: String) -> BoxFuture<'_, Result<Value, GeocodeError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            Ok(json!({"provider":"kakao","lat":"37.566","lon":"126.978"}))
        })
    }
}
#[tokio::test]
async fn dynamic_town_projection_survives_a_provider_free_cold_restart() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::ZERO,
    });
    let live = Resolver::new(peer.transport_limited(4), Some(provider.clone()));
    let first = live
        .resolve(
            Operation::Town,
            "서울특별시중구새동".into(),
            Instant::now() + Duration::from_secs(3),
            1000,
        )
        .await
        .unwrap();
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    drop(live);
    let cold = Resolver::new(peer.transport_limited(4), None);
    let restored = cold
        .resolve(
            Operation::Town,
            "서울특별시중구새동".into(),
            Instant::now() + Duration::from_secs(3),
            2000,
        )
        .await
        .unwrap();
    assert_eq!(oracle()["lifecycle"]["first"]["gCoord"]["lat"], "37.566");
    assert_eq!(
        first["lat"],
        oracle()["lifecycle"]["coldLean"]["gCoord"]["lat"]
    );
    assert_eq!(
        restored["lat"],
        oracle()["lifecycle"]["coldLean"]["gCoord"]["lat"]
    );
    assert_eq!(
        restored["lon"],
        oracle()["lifecycle"]["coldLean"]["gCoord"]["lon"]
    );
    assert_eq!(
        provider.calls.load(Ordering::SeqCst),
        1,
        "cold restore made no provider call"
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn same_address_waiters_share_one_owned_projection() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::from_millis(80),
    });
    let resolver = Arc::new(Resolver::new(
        peer.transport_limited(4),
        Some(provider.clone()),
    ));
    let mut jobs = Vec::new();
    for _ in 0..16 {
        let resolver = resolver.clone();
        jobs.push(tokio::spawn(async move {
            resolver
                .resolve(
                    Operation::Town,
                    "서울특별시중구동시동".into(),
                    Instant::now() + Duration::from_secs(3),
                    1000,
                )
                .await
        }));
    }
    for job in jobs {
        assert!(job.await.unwrap().is_ok());
    }
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn a_late_address_acquisition_publishes_after_its_waiter_leaves() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::from_millis(120),
    });
    let live = Resolver::new(peer.transport_limited(4), Some(provider.clone()));
    let result = live
        .resolve(
            Operation::Town,
            "서울특별시중구늦은동".into(),
            Instant::now() + Duration::from_millis(10),
            1000,
        )
        .await;
    assert_eq!(result, Err(ResolveError::Late));
    // Join completion with a bounded condition rather than a guessed sleep.
    let completed = live
        .resolve(
            Operation::Town,
            "서울특별시중구늦은동".into(),
            Instant::now() + Duration::from_secs(3),
            1000,
        )
        .await
        .unwrap();
    drop(live);
    let cold = Resolver::new(peer.transport_limited(4), None);
    let restored = cold
        .resolve(
            Operation::Town,
            "서울특별시중구늦은동".into(),
            Instant::now() + Duration::from_secs(3),
            2000,
        )
        .await
        .unwrap();
    assert_eq!(completed["lat"], 37.566);
    assert_eq!(restored["lat"], 37.566);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}

use server2::storage::{CatalogTransport, WriteCondition};
fn projection_key(operation: &str, address: &str) -> String {
    format!(
        "index/v2/town-address/{operation}/{}.json",
        server2::storage::sha256(format!("{operation}\0{address}").as_bytes())
    )
}
async fn fault(peer: &super::source_s3::Peer, mode: &str, key: &str) {
    assert_eq!(
        reqwest::Client::new()
            .post(format!(
                "{}/__catalog?mode={mode}&key={key}",
                peer.endpoint()
            ))
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        204
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn independent_writers_read_the_confirmed_conditional_winner() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let address = "서울특별시중구경쟁동";
    fault(&peer, "barrier", &projection_key("town", address)).await;
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::ZERO,
    });
    let a = Resolver::new(peer.transport_limited(2), Some(provider.clone()));
    let b = Resolver::new(peer.transport_limited(2), Some(provider.clone()));
    let (a, b) = tokio::join!(
        a.resolve(
            Operation::Town,
            address.into(),
            Instant::now() + Duration::from_secs(3),
            1000
        ),
        b.resolve(
            Operation::Town,
            address.into(),
            Instant::now() + Duration::from_secs(3),
            1000
        )
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    let coordinate = |v: &Value| {
        v.as_f64()
            .unwrap_or_else(|| v.as_str().unwrap().parse().unwrap())
    };
    assert_eq!(coordinate(&a["lat"]), coordinate(&b["lat"]));
    assert_eq!(coordinate(&a["lon"]), coordinate(&b["lon"]));
    assert_eq!(
        provider.calls.load(Ordering::SeqCst),
        2,
        "two processes really attempted publication"
    );
}
#[tokio::test]
async fn rejected_or_unreconciled_conditional_writes_never_admit_a_projection() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    for mode in ["reject", "conflict409", "unexpected202"] {
        let address = format!("서울특별시중구{mode}동");
        fault(&peer, mode, &projection_key("town", &address)).await;
        let provider = Arc::new(AddressPeer {
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
        });
        let a = Resolver::new(peer.transport_limited(4), Some(provider));
        assert_eq!(
            a.resolve(
                Operation::Town,
                address.clone(),
                Instant::now() + Duration::from_secs(3),
                1000
            )
            .await,
            Err(ResolveError::Storage),
            "{mode}"
        );
        fault(&peer, "clear", &projection_key("town", &address)).await;
        let cold = Resolver::new(peer.transport_limited(4), None);
        assert_eq!(
            cold.resolve(
                Operation::Town,
                address,
                Instant::now() + Duration::from_secs(3),
                2000
            )
            .await,
            Err(ResolveError::Provider)
        );
    }
}
#[tokio::test]
async fn corrupt_and_truncated_projections_are_never_used_or_repaired_from_untrusted_values() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    for (name, bytes) in [
        ("corrupt", b"corrupt".as_slice()),
        ("truncated", b"{\"schema\":1".as_slice()),
    ] {
        let address = format!("서울특별시중구{name}동");
        let transport = peer.transport_limited(4);
        assert_eq!(
            transport
                .put_control(
                    &projection_key("town", &address),
                    bytes,
                    &WriteCondition::Absent
                )
                .await
                .unwrap(),
            200
        );
        let provider = Arc::new(AddressPeer {
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
        });
        let resolver = Resolver::new(transport, Some(provider.clone()));
        assert_eq!(
            resolver
                .resolve(
                    Operation::Town,
                    address,
                    Instant::now() + Duration::from_secs(3),
                    1000
                )
                .await,
            Err(ResolveError::Storage)
        );
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    }
}
struct RemapPeer {
    calls: AtomicUsize,
}
impl Acquire for RemapPeer {
    fn address(&self, op: Operation, _: String) -> BoxFuture<'_, Result<Value, GeocodeError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            Ok(match op {
                Operation::Remap => {
                    json!({"provider":"google","address":"대한민국 서울특별시 중구 새동"})
                }
                Operation::Town => json!({"provider":"google","lat":37.566,"lon":126.978}),
            })
        })
    }
}
#[tokio::test]
async fn expired_remap_metadata_requires_a_new_conditional_projection() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(RemapPeer {
        calls: AtomicUsize::new(0),
    });
    let first = Resolver::new(peer.transport_limited(4), Some(provider.clone()));
    first
        .resolve(
            Operation::Remap,
            "서울특별시중구".into(),
            Instant::now() + Duration::from_secs(3),
            1000,
        )
        .await
        .unwrap();
    drop(first);
    let expired = 1001 + 30 * 86_400_000;
    let cold = Resolver::new(peer.transport_limited(4), None);
    assert_eq!(
        cold.resolve(
            Operation::Remap,
            "서울특별시중구".into(),
            Instant::now() + Duration::from_secs(3),
            expired
        )
        .await,
        Err(ResolveError::Provider)
    );
    drop(cold);
    let refreshed = Resolver::new(peer.transport_limited(4), Some(provider.clone()));
    refreshed
        .resolve(
            Operation::Remap,
            "서울특별시중구".into(),
            Instant::now() + Duration::from_secs(3),
            expired,
        )
        .await
        .unwrap();
    assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn dropping_every_waiter_and_resolver_does_not_cancel_owned_publication() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::from_millis(100),
    });
    let address = "서울특별시중구취소동";
    let transport = peer.transport_limited(4);
    let resolver = Arc::new(Resolver::new(transport.clone(), Some(provider.clone())));
    let job = {
        let resolver = resolver.clone();
        tokio::spawn(async move {
            resolver
                .resolve(
                    Operation::Town,
                    address.into(),
                    Instant::now() + Duration::from_secs(3),
                    1000,
                )
                .await
        })
    };
    tokio::time::timeout(Duration::from_secs(2), async {
        while provider.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    job.abort();
    drop(resolver);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if transport
                .get_control(&projection_key("town", address), 16384)
                .await
                .is_ok()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let cold = Resolver::new(transport, None);
    assert!(
        cold.resolve(
            Operation::Town,
            address.into(),
            Instant::now() + Duration::from_secs(3),
            2000
        )
        .await
        .is_ok()
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}

fn s3_source(
    peer: &super::source_s3::Peer,
    provider: Option<Arc<dyn Acquire>>,
) -> server2::domestic::kma::source::S3Source<
    server2::world::BoundedS3<server2::storage::HttpS3Transport>,
> {
    server2::domestic::kma::source::S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| super::source_s3::NOW),
        Arc::new(super::source_s3::Unreachable),
        Arc::new(super::source_s3::Unreachable),
    )
    .unwrap()
    .with_town_geocoder(provider)
}
#[tokio::test]
async fn unknown_town_native_answers_survive_s3_only_restart_with_legacy_absent() {
    use server2::domestic::kma::{AssemblyConfig, Outcome, backend::KmaBackend};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::ZERO,
    });
    let mut request = super::source_s3::request();
    request.town = Some("새동".into());
    let live = KmaBackend::new(
        Arc::new(s3_source(&peer, Some(provider.clone()))),
        Arc::new(|| super::source_s3::NOW),
        AssemblyConfig::default(),
    );
    let first = live
        .outcome(request.clone(), Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(oracle()["lifecycle"]["makeResult"]["first"]["status"], 500);
    assert!(
        matches!(first, Outcome::Json(_)),
        "AK-approved canonical first admission: {first:?}"
    );
    assert_eq!(
        live.outcome(request.clone(), Instant::now() + Duration::from_secs(3))
            .await
            .unwrap(),
        first,
        "same-process numeric response is stable"
    );
    drop(live);
    let cold = KmaBackend::new(
        Arc::new(s3_source(&peer, None)),
        Arc::new(|| super::source_s3::NOW),
        AssemblyConfig::default(),
    );
    let restored = cold
        .outcome(request, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(
        oracle()["lifecycle"]["makeResult"]["coldLean"]["status"],
        200
    );
    assert_eq!(
        restored, first,
        "first/same/cold native bytes are identical; legacy hot500 is preserved only in oracle evidence"
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn kr_remap_preserves_middleware_order_and_original_request_identity() {
    use server2::domestic::kma::{Outcome, backend::KmaSource};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let provider = Arc::new(RemapPeer {
        calls: AtomicUsize::new(0),
    });
    let source = s3_source(&peer, Some(provider.clone()));
    let mut request = super::source_s3::request();
    request.region = Some("중구".into());
    request.city = Some("서울특별시".into());
    request.town = Some("KR".into());
    request.original_url += "?ignored=%ZZ";
    let original = request.original_url.clone();
    let remapped = source
        .prepare(request, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(
        (
            remapped.region.as_deref(),
            remapped.city.as_deref(),
            remapped.town.as_deref()
        ),
        (Some("서울특별시"), Some("중구"), Some("새동"))
    );
    assert_eq!(remapped.original_url, original);
    let backend = server2::domestic::kma::backend::KmaBackend::new(
        Arc::new(source),
        Arc::new(|| super::source_s3::NOW),
        server2::domestic::kma::AssemblyConfig::default(),
    );
    assert_eq!(
        backend
            .outcome(remapped, Instant::now() + Duration::from_secs(3))
            .await
            .unwrap(),
        Outcome::Status(500, "Internal Server Error\n".into())
    );
    assert_eq!(
        provider.calls.load(Ordering::SeqCst),
        1,
        "malformed URL stops snapshot/town acquisition after the remap"
    );
}

struct Funding {
    allow: bool,
    events: Arc<std::sync::Mutex<Vec<String>>>,
}
impl server2::geocode::Quota for Funding {
    fn reserve(
        &self,
        d: Vec<server2::geocode::ProviderDemand>,
    ) -> BoxFuture<'_, Result<(), GeocodeError>> {
        self.events
            .lock()
            .unwrap()
            .push(format!("fund-{:?}-{}", d[0].provider, d[0].attempts));
        Box::pin(async move {
            if self.allow {
                Ok(())
            } else {
                Err(GeocodeError::Quota)
            }
        })
    }
}
struct HttpProvider {
    root: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for HttpProvider {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn provider_http(
    kakao_status: u16,
    google_failures: usize,
    events: Arc<std::sync::Mutex<Vec<String>>>,
) -> HttpProvider {
    use axum::{Router, body::Body, extract::Request, http::StatusCode, response::Response};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let handler = move |request: Request| {
        let events = events.clone();
        async move {
            let path = request.uri().path();
            let kakao = path.starts_with("/v2/");
            let xml = path.ends_with("/xml");
            let json_attempt = {
                let mut events = events.lock().unwrap();
                events.push(
                    if kakao {
                        "http-kakao"
                    } else if xml {
                        "http-google-xml"
                    } else {
                        "http-google-json"
                    }
                    .into(),
                );
                events
                    .iter()
                    .filter(|e| e.as_str() == "http-google-json")
                    .count()
            };
            let query = request.uri().query().unwrap();
            assert!(
                query.contains("%EC%84%9C%EC%9A%B8"),
                "encoded Korean address"
            );
            if kakao {
                assert_eq!(
                    request.headers().get("authorization").unwrap(),
                    "KakaoAK synthetic-kakao"
                );
            } else {
                assert!(query.contains("language=ko"));
                assert!(query.contains("key=synthetic-google"));
            }
            let (status, bytes) = if kakao {
                (
                    kakao_status,
                    br#"{"meta":{"total_count":1},"documents":[{"y":"37.566","x":"126.978"}]}"#
                        .to_vec(),
                )
            } else if xml {
                (200,b"<GeocodeResponse><status>OK</status><result><geometry><location><lat>37.566</lat><lng>126.978</lng></location></geometry></result></GeocodeResponse>".to_vec())
            } else {
                let fixture: Value =
                    serde_json::from_slice(include_bytes!("../gateway/fixtures/providers.json"))
                        .unwrap();
                (
                    if json_attempt <= google_failures {
                        500
                    } else {
                        200
                    },
                    serde_json::to_vec(&fixture["google.coord.seoul.ko"]).unwrap(),
                )
            };
            let mut response = Response::new(Body::from(bytes));
            *response.status_mut() = StatusCode::from_u16(status).unwrap();
            response
        }
    };
    let app = Router::new().fallback(handler);
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    HttpProvider { root, task }
}

#[tokio::test]
async fn real_town_http_funds_and_calls_kakao_then_google_xml_only_on_failure() {
    for status in [200, 500] {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let peer = provider_http(status, 0, events.clone()).await;
        let client = server2::geocode::town::Client::new(
            server2::geocode::GeocoderConfig {
                kakao_keys: vec!["synthetic-kakao".into()],
                google_key: Some("synthetic-google".into()),
                kakao_base_url: peer.root.clone(),
                google_base_url: peer.root.clone(),
                ..Default::default()
            },
            Arc::new(Funding {
                allow: true,
                events: events.clone(),
            }),
        )
        .unwrap();
        let result = client
            .address(Operation::Town, "서울특별시중구새동".into())
            .await
            .unwrap();
        if status == 200 {
            assert_eq!(result["lat"], 37.566);
            assert_eq!(*events.lock().unwrap(), vec!["fund-Kakao-1", "http-kakao"]);
        } else {
            assert_eq!(result["lat"], 37.566);
            assert_eq!(
                *events.lock().unwrap(),
                vec![
                    "fund-Kakao-1",
                    "http-kakao",
                    "fund-Google-1",
                    "http-google-xml"
                ]
            );
        }
    }
}
#[tokio::test]
async fn no_town_provider_http_attempt_precedes_funding() {
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let peer = provider_http(200, 0, events.clone()).await;
    let client = server2::geocode::town::Client::new(
        server2::geocode::GeocoderConfig {
            kakao_keys: vec!["synthetic-kakao".into()],
            google_key: Some("synthetic-google".into()),
            kakao_base_url: peer.root.clone(),
            google_base_url: peer.root.clone(),
            ..Default::default()
        },
        Arc::new(Funding {
            allow: false,
            events: events.clone(),
        }),
    )
    .unwrap();
    assert!(
        client
            .address(Operation::Town, "서울특별시중구새동".into())
            .await
            .is_err()
    );
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .all(|e| e.starts_with("fund-"))
    );
}

#[tokio::test]
async fn missing_and_late_town_locations_leave_fields_absent_without_a_legacy_dependency() {
    use server2::domestic::kma::{AssemblyConfig, Outcome, backend::KmaBackend};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = super::source_s3::Peer::persistent();
    let mut request = super::source_s3::request();
    request.town = Some("지연동".into());
    let unavailable = KmaBackend::new(
        Arc::new(s3_source(&peer, None)),
        Arc::new(|| super::source_s3::NOW),
        AssemblyConfig::default(),
    );
    let missing = unavailable
        .outcome(request.clone(), Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    let Outcome::Json(ref missing) = missing else {
        panic!("legacy _getCoord next() partial reply: {missing:?}")
    };
    assert!(
        serde_json::from_slice::<Value>(&missing.to_bytes())
            .unwrap()
            .get("location")
            .is_none()
    );
    let provider = Arc::new(AddressPeer {
        calls: AtomicUsize::new(0),
        delay: Duration::from_millis(2800),
    });
    let late = KmaBackend::new(
        Arc::new(s3_source(&peer, Some(provider.clone()))),
        Arc::new(|| super::source_s3::NOW),
        AssemblyConfig::default(),
    );
    let started = Instant::now();
    let answer = late
        .outcome(request.clone(), started + Duration::from_secs(3))
        .await
        .unwrap();
    assert!(started.elapsed() < Duration::from_millis(3100));
    let Outcome::Json(ref answer) = answer else {
        panic!("late partial reply: {answer:?}")
    };
    assert!(
        serde_json::from_slice::<Value>(&answer.to_bytes())
            .unwrap()
            .get("location")
            .is_none()
    );
    let key = projection_key("town", "서울특별시종로구지연동");
    let transport = peer.transport_limited(4);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if transport.get_control(&key, 16384).await.is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    drop(late);
    let cold = KmaBackend::new(
        Arc::new(s3_source(&peer, None)),
        Arc::new(|| super::source_s3::NOW),
        AssemblyConfig::default(),
    );
    let restored = cold
        .outcome(request, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    let Outcome::Json(restored) = restored else {
        panic!("{restored:?}")
    };
    assert!(
        serde_json::from_slice::<Value>(&restored.to_bytes())
            .unwrap()
            .get("location")
            .is_some()
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn kr_remap_http_uses_google_json_and_funds_each_legacy_request_retry() {
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let peer = provider_http(200, 2, events.clone()).await;
    let client = server2::geocode::town::Client::new(
        server2::geocode::GeocoderConfig {
            kakao_keys: vec!["synthetic-kakao".into()],
            google_key: Some("synthetic-google".into()),
            kakao_base_url: peer.root.clone(),
            google_base_url: peer.root.clone(),
            ..Default::default()
        },
        Arc::new(Funding {
            allow: true,
            events: events.clone(),
        }),
    )
    .unwrap();
    let answer = client
        .address(Operation::Remap, "서울특별시중구".into())
        .await
        .unwrap();
    assert_eq!(answer["provider"], "google");
    assert!(answer["address"].as_str().unwrap().contains("서울"));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "fund-Google-1",
            "http-google-json",
            "fund-Google-1",
            "http-google-json",
            "fund-Google-1",
            "http-google-json"
        ]
    );
}
