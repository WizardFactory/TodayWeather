use server2::geocode::{is_korea_area, language_from_header, normalize_loc};

#[test]
fn geocode_format_matches_js_binary_rounding_and_language() {
    assert_eq!(normalize_loc([1.0625, -2.0625]), [1.063, -2.063]);
    assert_eq!(normalize_loc([1.0005, 2.0005]), [1.0, 2.001]);
    assert_eq!(normalize_loc([-0.0001, 126.9779]), [0.0, 126.978]);
    assert_eq!(language_from_header(None), "en");
    assert_eq!(language_from_header(Some("ko-KR,en;q=0.9")), "ko");
    assert_eq!(language_from_header(Some("")), "");
    assert_eq!(language_from_header(Some(&"😀".repeat(33))), "en");
    assert!(is_korea_area([32.695, 123.953]));
    assert!(!is_korea_area([32.694, 123.952]));
}

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use server2::geocode::{GeocodeError, Geocoder, GeocoderConfig, MockQuota};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::task::JoinHandle;

#[derive(Clone)]
pub struct StubState {
    pub kakao: Arc<Mutex<VecDeque<(u16, Value, Duration)>>>,
    pub google: Arc<Mutex<VecDeque<(u16, Value, Duration)>>>,
    pub calls: Arc<Mutex<Vec<String>>>,
    pub count: Arc<AtomicUsize>,
}
pub struct Stub {
    pub base: String,
    pub state: StubState,
    task: JoinHandle<()>,
}
impl Drop for Stub {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub fn fixture(name: &str) -> Value {
    serde_json::from_slice::<Value>(include_bytes!("fixtures/providers.json")).unwrap()[name]
        .clone()
}
pub async fn stub(kakao: Vec<(u16, Value, Duration)>, google: Vec<(u16, Value, Duration)>) -> Stub {
    let state = StubState {
        kakao: Arc::new(Mutex::new(kakao.into())),
        google: Arc::new(Mutex::new(google.into())),
        calls: Arc::new(Mutex::new(Vec::new())),
        count: Arc::new(AtomicUsize::new(0)),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new().fallback(reply).with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Stub { base, state, task }
}
async fn reply(State(state): State<StubState>, request: Request<Body>) -> Response {
    state.count.fetch_add(1, Ordering::AcqRel);
    state.calls.lock().unwrap().push(request.uri().to_string());
    let google = request.uri().path().starts_with("/maps/");
    let item = if google {
        state.google.lock().unwrap().pop_front()
    } else {
        state.kakao.lock().unwrap().pop_front()
    };
    let (status, body, delay) = item.unwrap_or((
        500,
        json!({"error":"unexpected mock request"}),
        Duration::ZERO,
    ));
    tokio::time::sleep(delay).await;
    (
        StatusCode::from_u16(status).unwrap(),
        serde_json::to_vec(&body).unwrap(),
    )
        .into_response()
}
pub fn config(stub: &Stub) -> GeocoderConfig {
    GeocoderConfig {
        mock_mode: true,
        kakao_base_url: stub.base.clone(),
        google_base_url: stub.base.clone(),
        kakao_keys: vec!["mock-kakao".into()],
        google_key: Some("mock-google".into()),
        cache_bytes: 8192,
        max_owners: 40,
    }
}
pub fn service(stub: &Stub) -> Geocoder {
    Geocoder::new(config(stub))
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(1000)))
}
fn ok(name: &str) -> (u16, Value, Duration) {
    (200, fixture(name), Duration::ZERO)
}
fn bytes(geo: &server2::geocode::GeoClient) -> String {
    serde_json::to_string(geo).unwrap()
}

#[tokio::test]
async fn geocode_kakao_ko_and_warm_bytes_preserve_kma() {
    let peer = stub(vec![ok("kakao.coord.space")], vec![]).await;
    let geo = service(&peer);
    let first = geo.coord([37.3, 127.0], "ko").await.unwrap();
    assert_eq!(
        bytes(&first),
        r#"{"name":"파장동","country":"KR","address":"경기도 수원시 장안구 파장동","location":{"lat":37.3,"long":127},"kmaAddress":{"name1":"경기도","name2":"수원시장안구","name3":"파장동"}}"#
    );
    assert_eq!(
        bytes(&geo.coord([37.3, 127.0], "ko").await.unwrap()),
        bytes(&first)
    );
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
#[tokio::test]
async fn geocode_non_korean_supplements_successful_kakao_only() {
    let peer = stub(
        vec![ok("kakao.coord.seoul")],
        vec![ok("google.coord.seoul.en")],
    )
    .await;
    let geo = service(&peer).coord([37.566, 126.978], "en").await.unwrap();
    assert_eq!(geo.name.as_deref(), Some("Myeong-dong"));
    assert_eq!(geo.country.as_deref(), Some("KR"));
    assert!(geo.kma_address.is_some());
    assert_eq!(peer.state.count.load(Ordering::Acquire), 2);
    let peer = stub(
        vec![(401, json!({}), Duration::ZERO)],
        vec![ok("google.coord.seoul.en")],
    )
    .await;
    assert!(matches!(
        service(&peer).coord([37.566, 126.978], "en").await,
        Err(GeocodeError::Provider)
    ));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
#[tokio::test]
async fn geocode_foreign_google_selection_and_fallback_leading_space() {
    for (fixture_name, loc, name, address) in [
        (
            "google.coord.newyork",
            [40.748, -73.985],
            "Manhattan",
            "Manhattan, New York, NY, USA",
        ),
        ("google.coord.fallback", [70.0, -90.0], "Canada", " Canada"),
    ] {
        let peer = stub(vec![], vec![ok(fixture_name)]).await;
        let geo = service(&peer).coord(loc, "en").await.unwrap();
        assert_eq!(geo.name.as_deref(), Some(name));
        assert_eq!(geo.address.as_deref(), Some(address));
        assert!(
            geo.location
                .is_some_and(|value| [value.lat, value.long] == loc)
        );
        assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
    }
}
#[tokio::test]
async fn geocode_address_google_first_kakao_fallback_and_missing_country() {
    let peer = stub(vec![ok("kakao.addr.jamsil")], vec![ok("google.addr.zero")]).await;
    let geo = service(&peer).addr("잠실본동", "ko").await.unwrap();
    assert_eq!(
        bytes(&geo),
        r#"{"country":"KR","address":"잠실본동","location":{"lat":37.506,"long":127.084}}"#
    );
    let peer = stub(vec![], vec![ok("google.addr.nocountry")]).await;
    let geo = service(&peer);
    let first = geo.addr("Somewhere", "en").await.unwrap();
    assert_eq!(
        bytes(&first),
        r#"{"address":"Somewhere","location":{"lat":12.346,"long":56.789}}"#
    );
    assert_eq!(
        bytes(&geo.addr("Somewhere", "ko").await.unwrap()),
        bytes(&first)
    );
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
#[tokio::test]
async fn geocode_kakao_rotates_auth_quota_transient_each_key_once() {
    let peer = stub(
        vec![
            (401, json!({}), Duration::ZERO),
            (400, json!({"code":-10}), Duration::ZERO),
            ok("kakao.coord.seoul"),
        ],
        vec![],
    )
    .await;
    let mut options = config(&peer);
    options.kakao_keys = vec!["k0".into(), "k1".into(), "k2".into()];
    let quota = Arc::new(MockQuota::new(4));
    let geo = Geocoder::new(options).unwrap().with_quota(quota.clone());
    assert!(geo.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(peer.state.count.load(Ordering::Acquire), 3);
    assert_eq!(quota.remaining(), 0); // entire possible chain consumed once, including unused Google
}
#[tokio::test]
async fn geocode_same_key_waiter_cancel_does_not_cancel_owner_or_refund_quota() {
    let peer = stub(
        vec![(
            200,
            fixture("kakao.coord.seoul"),
            Duration::from_millis(150),
        )],
        vec![],
    )
    .await;
    let quota = Arc::new(MockQuota::new(2));
    let geo = Geocoder::new(config(&peer))
        .unwrap()
        .with_quota(quota.clone());
    let first = tokio::spawn({
        let geo = geo.clone();
        async move { geo.coord([37.566, 126.978], "ko").await }
    });
    while peer.state.count.load(Ordering::Acquire) == 0 {
        tokio::task::yield_now().await;
    }
    first.abort();
    assert!(geo.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
    assert_eq!(quota.remaining(), 0);
    assert_eq!(geo.active_owners(), 0);
}
#[tokio::test]
async fn geocode_distinct_owner_capacity_and_byte_cache_are_bounded() {
    let peer = stub(
        vec![
            (
                200,
                fixture("kakao.coord.seoul"),
                Duration::from_millis(100),
            ),
            ok("kakao.coord.seoul"),
        ],
        vec![],
    )
    .await;
    let mut options = config(&peer);
    options.max_owners = 1;
    options.cache_bytes = 800;
    let geo = Geocoder::new(options)
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(100)));
    let first = tokio::spawn({
        let geo = geo.clone();
        async move { geo.coord([37.566, 126.978], "ko").await }
    });
    while peer.state.count.load(Ordering::Acquire) == 0 {
        tokio::task::yield_now().await;
    }
    assert!(matches!(
        geo.coord([37.567, 126.978], "ko").await,
        Err(GeocodeError::Capacity)
    ));
    assert!(first.await.unwrap().is_ok());
    assert!(geo.coord([37.567, 126.978], "ko").await.is_ok());
    assert!(geo.cache_bytes() <= 800);
}
#[tokio::test]
async fn geocode_kr_without_kma_is_returned_but_never_cached() {
    let peer = stub(
        vec![ok("kakao.coord.empty"), ok("kakao.coord.empty")],
        vec![ok("google.coord.seoul.ko"), ok("google.coord.seoul.ko")],
    )
    .await;
    let geo = service(&peer);
    assert!(
        geo.coord([37.566, 126.978], "ko")
            .await
            .unwrap()
            .kma_address
            .is_none()
    );
    assert!(geo.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(peer.state.count.load(Ordering::Acquire), 4);
}
#[tokio::test]
async fn geocode_provider_and_overall_deadline_bound_owned_work() {
    let peer = stub(
        vec![
            (200, fixture("kakao.coord.seoul"), Duration::from_secs(10)),
            (200, fixture("kakao.coord.seoul"), Duration::from_secs(10)),
        ],
        vec![],
    )
    .await;
    let mut options = config(&peer);
    options.kakao_keys = vec!["k1".into(), "k2".into()];
    let geo = Geocoder::new(options)
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(3)));
    let start = std::time::Instant::now();
    assert!(matches!(
        geo.coord([37.566, 126.978], "ko").await,
        Err(GeocodeError::Provider)
    ));
    assert!(start.elapsed() >= Duration::from_millis(4900));
    assert!(start.elapsed() < Duration::from_millis(5800));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 2);
    assert_eq!(geo.active_owners(), 0);
}

#[tokio::test]
async fn geocode_provider_shapes_cover_island_jeju_london_and_missing_fields() {
    for (name, loc, label) in [
        ("kakao.coord.jeju", [33.509, 126.53], "이도1동"),
        ("kakao.coord.island", [37.484, 130.906], "울릉읍"),
    ] {
        let peer = stub(vec![ok(name)], vec![]).await;
        assert_eq!(
            service(&peer)
                .coord(loc, "ko")
                .await
                .unwrap()
                .name
                .as_deref(),
            Some(label)
        );
    }
    let peer = stub(vec![], vec![ok("google.coord.london")]).await;
    let geo = service(&peer).coord([51.507, -0.128], "en").await.unwrap();
    assert_eq!(geo.name.as_deref(), Some("London"));
    assert_eq!(geo.address.as_deref(), Some("London, UK"));
    let peer = stub(vec![], vec![ok("google.coord.noformatted")]).await;
    assert!(matches!(
        service(&peer).coord([10.0, 10.0], "en").await,
        Err(GeocodeError::Provider)
    ));
}
#[tokio::test]
async fn geocode_terminal_request_does_not_rotate_keys_or_google_fallback() {
    let peer = stub(
        vec![
            (
                400,
                json!({"code":-2,"msg":"invalid request"}),
                Duration::ZERO,
            ),
            ok("kakao.coord.seoul"),
        ],
        vec![ok("google.coord.seoul.en")],
    )
    .await;
    let mut options = config(&peer);
    options.kakao_keys = vec!["k0".into(), "k1".into()];
    let geo = Geocoder::new(options)
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(10)));
    assert!(matches!(
        geo.coord([37.566, 126.978], "ko").await,
        Err(GeocodeError::Provider)
    ));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
#[tokio::test]
async fn geocode_oversized_provider_body_fails_without_cache() {
    let peer = stub(
        vec![],
        vec![(
            200,
            json!({"status":"OK","padding":"x".repeat(1024*1024)}),
            Duration::ZERO,
        )],
    )
    .await;
    let geo = service(&peer);
    assert!(matches!(
        geo.coord([40.748, -73.985], "en").await,
        Err(GeocodeError::Provider)
    ));
    assert_eq!(geo.cache_bytes(), 0);
}

#[tokio::test]
async fn geocode_malformed_kakao_document_is_terminal_before_supplement() {
    let peer = stub(
        vec![(
            200,
            json!({"meta":{"total_count":2},"documents":[]}),
            Duration::ZERO,
        )],
        vec![ok("google.coord.seoul.en")],
    )
    .await;
    assert!(matches!(
        service(&peer).coord([37.566, 126.978], "en").await,
        Err(GeocodeError::Provider)
    ));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
