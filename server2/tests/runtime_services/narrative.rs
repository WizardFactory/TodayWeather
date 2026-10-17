use server2::narrative::{
    self, Acquire, Read,
    provider::{Error, Page, Source},
    store::{Service, Store},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
fn publication(now: i64) -> String {
    server2::world::js::iso((now + 9 * 3_600_000) as f64).unwrap()[..16]
        .chars()
        .filter(char::is_ascii_digit)
        .collect()
}
fn page(station: u16, now: i64, text: &str) -> Page {
    Page{content_type:"application/json; charset=utf-8".into(),body:serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"stnId":station,"tmFc":publication(now),"wfSv1":text}]}}}})).unwrap().into(),fetched_at_ms:now as u64}
}
struct Disabled(Arc<AtomicUsize>);
impl Source for Disabled {
    fn fetch(
        &self,
        _: u16,
        _: Instant,
    ) -> server2::gateway::BoxFuture<'_, Result<Option<Page>, Error>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(Error::Transport) })
    }
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(2)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn memory_loss_recovers_only_first_raw_original_without_provider_work() {
    let peer = super::common::Peer::new();
    let transport = peer.services("notice").s3.unwrap();
    let now = narrative::now_ms();
    let store = Store::new(transport.clone()).unwrap();
    let original = store
        .publish(109, page(109, now, "○ 원문\r\n<텍스트> & 0"), deadline())
        .await
        .unwrap()
        .unwrap();
    let changed = store
        .publish(109, page(109, now, "changed"), deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(changed, original);
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let restored = Service::new(transport.clone(), Arc::new(Disabled(calls.clone()))).unwrap();
        assert_eq!(restored.read(109, deadline()).await, Some(original.clone()));
        assert_eq!(restored.read(109, deadline()).await, Some(original.clone()));
        let mut body = server2::gateway::OrderedJson::parse(
            r#"{"source":"KMA","regionName":"서울특별시","weather":0}"#.as_bytes(),
        )
        .unwrap();
        let reader: Arc<dyn Read> = Arc::new(restored);
        narrative::attach(&mut body, Some(109), Some(&reader), deadline()).await;
        assert_eq!(
            body.get("forecastNarrative")
                .unwrap()
                .get("stationId")
                .unwrap()
                .number(),
            Some(109.)
        );
        assert_eq!(body.get("weather").unwrap().number(), Some(0.));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        store.read(109, now + 86_400_000, deadline()).await.unwrap(),
        None
    );
}
#[tokio::test]
async fn malformed_publication_and_failed_read_leave_weather_unchanged() {
    let peer = super::common::Peer::new();
    let transport = peer.services("notice").s3.unwrap();
    let now = narrative::now_ms();
    let store = Store::new(transport.clone()).unwrap();
    assert!(
        store
            .publish(108, page(109, now, "wrong office"), deadline())
            .await
            .is_err()
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let service = Arc::new(Service::new(transport, Arc::new(Disabled(calls.clone()))).unwrap());
    let reader: Arc<dyn Read> = service;
    let mut body = server2::gateway::OrderedJson::parse(br#"{"weather":false}"#).unwrap();
    let before = body.clone();
    narrative::attach(&mut body, Some(108), Some(&reader), Instant::now()).await;
    assert_eq!(body, before);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn overlapping_cycles_are_coalesced_and_office_failures_are_isolated() {
    struct Held {
        calls: AtomicUsize,
        gate: tokio::sync::Notify,
    }
    impl Source for Held {
        fn fetch(
            &self,
            station: u16,
            _: Instant,
        ) -> server2::gateway::BoxFuture<'_, Result<Option<Page>, Error>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if station == 108 {
                    self.gate.notified().await;
                }
                Err(Error::Transport)
            })
        }
    }
    let peer = super::common::Peer::new();
    let transport = peer.services("notice").s3.unwrap();
    let source = Arc::new(Held {
        calls: AtomicUsize::new(0),
        gate: tokio::sync::Notify::new(),
    });
    let service = Arc::new(Service::new(transport, source.clone()).unwrap());
    let first = tokio::spawn({
        let service = service.clone();
        async move {
            service.refresh().await;
        }
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while source.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.refresh().await;
    assert_eq!(source.calls.load(Ordering::SeqCst), 1);
    source.gate.notify_one();
    first.await.unwrap();
    assert_eq!(source.calls.load(Ordering::SeqCst), 10);
}
#[tokio::test]
async fn runtime_constructs_narrative_owner_only_for_native_kma_serving() {
    let peer = super::common::Peer::new();
    for (families, expected) in [
        ("notice", false),
        ("push", false),
        ("kma", true),
        ("town", true),
    ] {
        let services = peer.services(families);
        assert_eq!(services.narrative_acquire.is_some(), expected, "{families}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn funded_calls_rotate_all_keys_and_keep_narrative_quota_separate() {
    use axum::{Router, extract::State, http::Uri, routing::any};
    use server2::domestic::{kma::source::observe::DailyAcquirer, quota::DataGoKrApi};
    use server2::warnings::provider::{FundedSource, Operation, WarningSource};
    type Calls = Arc<std::sync::Mutex<Vec<(String, char)>>>;
    async fn handler(State(calls): State<Calls>, uri: Uri) -> impl axum::response::IntoResponse {
        let url: reqwest::Url = format!("http://127.0.0.1/?{}", uri.query().unwrap_or(""))
            .parse()
            .unwrap();
        let key = url
            .query_pairs()
            .find(|(k, _)| k == "serviceKey")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        let which = key
            .split("_KEY_")
            .nth(1)
            .and_then(|s| s.chars().next())
            .unwrap_or('?');
        calls.lock().unwrap().push((uri.path().into(), which));
        let code = if which == 'C' { "03" } else { "30" };
        let station = url
            .query_pairs()
            .find(|(k, _)| k == "stnId")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        let data = which == 'C' && matches!(station.as_str(), "109" | "184");
        let body = if data {
            serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"stnId":station,"tmFc":publication(narrative::now_ms()),"wfSv1":"original"}]}}}})
        } else {
            serde_json::json!({"response":{"header":{"resultCode":code}}})
        };
        (
            if station == "184" {
                axum::http::StatusCode::CREATED
            } else {
                axum::http::StatusCode::OK
            },
            [("content-type", "application/json; charset=utf-8")],
            body.to_string(),
        )
    }
    let peer = super::common::Peer::new();
    let transport = peer.services("notice").s3.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/", listener.local_addr().unwrap());
    let calls: Calls = Default::default();
    let router = Router::new()
        .fallback(any(handler))
        .with_state(calls.clone());
    let http = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let make = |units: server2::domestic::kma::source::observe::ApiUnits, keys: Vec<String>| {
        Arc::new(
            DailyAcquirer::new(
                Arc::new(server2::providers::HttpProviderTransport::new(2 << 20).unwrap()),
                Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
                Arc::new(transport.clone()),
                keys,
                units,
                server2::domestic::family::Endpoints::new(&root, &root, &root).unwrap(),
                Arc::new(server2::budget::SystemClock),
                Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
            )
            .unwrap(),
        )
    };
    let keys = ["A", "B", "C"]
        .iter()
        .map(|k| format!("S20E_LOCAL_KEY_{k}+aaaaaaaaaaaaaaaa/="))
        .collect();
    let daily = make(DataGoKrApi::daily_units, keys);
    let source = narrative::provider::Funded::new(daily, &root).unwrap();
    for _ in 0..2 {
        assert!(
            source
                .fetch(108, Instant::now() + Duration::from_secs(5))
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|(_, k)| *k)
            .collect::<Vec<_>>(),
        vec!['A', 'B', 'C', 'C']
    );
    let data = source
        .fetch(109, Instant::now() + Duration::from_secs(5))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(data.content_type, "application/json; charset=utf-8");
    assert!(
        source
            .fetch(184, Instant::now() + Duration::from_secs(5))
            .await
            .is_err(),
        "strict HTTP201 must be rejected"
    );
    calls.lock().unwrap().clear();
    fn units(api: DataGoKrApi) -> u64 {
        if api == DataGoKrApi::VilageFcstMsg {
            1
        } else {
            api.daily_units()
        }
    }
    // A new quota owner avoids reusing the previous test lease.
    let daily = make(units, vec!["S20E_LIMIT_KEY_C+bbbbbbbbbbbbbbbb/=".into()]);
    let source = narrative::provider::Funded::new(daily.clone(), &root).unwrap();
    assert!(
        source
            .fetch(108, Instant::now() + Duration::from_secs(5))
            .await
            .is_err()
    );
    assert!(
        calls.lock().unwrap().is_empty(),
        "unfunded acquisition must not send HTTP"
    );
    let warnings = FundedSource::new(
        daily.funded_transport(),
        &format!("{root}1360000/WthrWrnInfoService/"),
        daily.day().await.unwrap().warnings.clone(),
        daily.clock(),
    )
    .unwrap();
    assert!(
        warnings
            .fetch(
                Operation::WrnMsg,
                vec![],
                Instant::now() + Duration::from_secs(5)
            )
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(calls.lock().unwrap().len(), 1);
    assert!(calls.lock().unwrap()[0].0.contains("WthrWrnInfoService"));
    http.abort();
}
