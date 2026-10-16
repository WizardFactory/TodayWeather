//! AK decision 5 (2026-10-16): S08 funds data.go.kr per key and API, as data.go.kr allocates its
//! daily quota. TEST ONLY: loopback provider stub and the S06 loopback S3 peer.
use super::source_s3::{Peer, S3_PEERS};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::json;
use server2::domestic::family::{DataGoKrFamily, DataGoKrRequest, Target};
use server2::domestic::publication::Publication;
use server2::domestic::quota::DataGoKrApi;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

/// Answers every data.go.kr call "no data" and logs its path.
async fn handle(State(log): State<Arc<Mutex<Vec<String>>>>, uri: Uri) -> impl IntoResponse {
    log.lock().unwrap().push(uri.path().to_owned());
    (
        axum::http::StatusCode::OK,
        [("content-type", "application/json")],
        json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}}).to_string(),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_exhausted_api_quota_leaves_the_other_apis_of_the_key_funded() {
    let _peers = S3_PEERS.lock().await;
    let log = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap());
    let router = Router::new().fallback(any(handle)).with_state(log.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let peer = Peer::new();
    // The short-forecast API allows two units per key and day (one funded call: S08 reserves the
    // call and its one retry); the mid-forecast API keeps its allowance.
    fn units(api: DataGoKrApi) -> u64 {
        if api == DataGoKrApi::VilageFcst {
            2
        } else {
            api.daily_units()
        }
    }
    let daily = server2::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(server2::providers::HttpProviderTransport::new(2 << 20).unwrap()),
        Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(peer.transport()),
        vec!["S15B4Q_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/=".into()],
        units,
        server2::domestic::family::Endpoints::new(&base, &base, &base).unwrap(),
        Arc::new(server2::budget::SystemClock),
        Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
    )
    .unwrap();
    let acquirer = daily.today().await.unwrap();
    let deadline = || Instant::now() + Duration::from_secs(20);
    let grid = |family, time| {
        DataGoKrRequest::new(
            family,
            Target::Grid { nx: 60, ny: 127 },
            Publication::new(20261016, time).unwrap(),
        )
        .unwrap()
    };
    let calls = |api: DataGoKrApi| {
        log.lock()
            .unwrap()
            .iter()
            .filter(|p| p.contains(&format!("/{}/", api.path())))
            .count()
    };
    // The first short-forecast call spends the API's day.
    let first = acquirer
        .acquire(&grid(DataGoKrFamily::UltraSrtNcst, 900), deadline())
        .await;
    assert!(first.is_ok(), "{first:?}");
    assert_eq!(calls(DataGoKrApi::VilageFcst), 1);
    // Another call of that API is refused by S08 without reaching the provider…
    let second = acquirer
        .acquire(&grid(DataGoKrFamily::VilageFcst, 800), deadline())
        .await;
    assert!(second.is_err(), "{second:?}");
    assert_eq!(calls(DataGoKrApi::VilageFcst), 1);
    // …while the same key still funds the mid-forecast API.
    let mid = DataGoKrRequest::new(
        DataGoKrFamily::MidFcst,
        Target::Station("109".into()),
        Publication::new(20261016, 600).unwrap(),
    )
    .unwrap();
    let third = acquirer.acquire(&mid, deadline()).await;
    assert!(third.is_ok(), "{third:?}");
    assert_eq!(calls(DataGoKrApi::MidFcst), 1);
    server.abort();
}
