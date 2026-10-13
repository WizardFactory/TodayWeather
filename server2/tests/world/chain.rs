//! CHAINS: real S08 funding over the S3 peer and an actual loopback VC HTTP stub, one owned
//! fetch per cell, cancellation, slow providers, publication and S3 read failures.
use super::common::*;
use axum::{Router, extract::Request, http::StatusCode, response::IntoResponse};
use server2::{
    budget::{BudgetError, BudgetPolicy, BudgetStore, Clock as BudgetClock, Provider},
    gateway::BoxFuture,
    providers::HttpProviderTransport,
    storage::Error as StorageError,
    world::{
        Cell, Disabled, FixedClock, FundedVc, MemoryWorldStore, Range, RawFetch, StoreError,
        Unconfigured, VcError, VcSource, World, WorldBackend, WorldConfig, WorldReply, WorldStore,
    },
};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

type Queue = Arc<Mutex<VecDeque<(u16, Vec<u8>)>>>;
/// Loopback Visual Crossing stub: answers queued (status, body) and records path+query.
struct Stub {
    endpoint: String,
    seen: Arc<Mutex<Vec<String>>>,
    queue: Queue,
}
async fn stub() -> Stub {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let queue: Queue = Arc::new(Mutex::new(VecDeque::new()));
    let (s, q) = (seen.clone(), queue.clone());
    let app = Router::new().fallback(move |req: Request| {
        let (s, q) = (s.clone(), q.clone());
        async move {
            s.lock().unwrap().push(req.uri().to_string());
            tokio::time::sleep(Duration::from_millis(30)).await;
            let (status, body) = q.lock().unwrap().pop_front().unwrap_or((599, Vec::new()));
            (
                StatusCode::from_u16(status).unwrap(),
                [("content-type", "application/json")],
                body,
            )
                .into_response()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Stub {
        endpoint: format!("http://{addr}/timeline/"),
        seen,
        queue,
    }
}
struct ScenarioClock(Arc<FixedClock>);
impl BudgetClock for ScenarioClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        use server2::world::Clock;
        Ok(self.0.now_ms() as i64)
    }
}
fn policy(day: i64, limit: u64) -> BudgetPolicy {
    BudgetPolicy {
        provider: Provider::VisualCrossing,
        quota_id: "a".repeat(64),
        window_id: "2026-09-26".into(),
        starts_at_ms: day,
        ends_at_ms: day + 86_400_000,
        limit,
        block_units: limit.min(98),
    }
}
fn funded(peer: &Peer, stub: &Stub, clock: Arc<FixedClock>, limit: u64) -> Arc<dyn VcSource> {
    let day = (ms("2026-09-26T00:00:00.000Z")) as i64;
    let budget = Arc::new(
        BudgetStore::new(
            Arc::new(peer.transport()),
            policy(day, limit),
            Arc::new(ScenarioClock(clock)),
        )
        .unwrap(),
    );
    Arc::new(
        FundedVc::new(
            &stub.endpoint,
            Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
            budget,
            "synthetic-vc-key-0001".into(),
        )
        .unwrap(),
    )
}
fn request_body(id: &str, step: usize, index: usize) -> (&'static serde_json::Value, Vec<u8>) {
    let r = &scenario(id)["steps"][step]["requests"][index];
    let body = r["calls"]
        .as_array()
        .unwrap()
        .first()
        .and_then(|c| c["body_sha256"].as_str())
        .map(body)
        .unwrap_or_default();
    (r, body)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn s08_funded_budget_chain_matches_the_legacy_daily_budget_scenario() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(0.));
    let sc = scenario("budget");
    let world = World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 4),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    );
    let backend = WorldBackend::new(world);
    for (si, step) in sc["steps"].as_array().unwrap().iter().enumerate() {
        clock.set(ms(step["at"].as_str().unwrap()));
        let (r, body) = request_body("budget", si, 0);
        if !body.is_empty() {
            stub.queue.lock().unwrap().push_back((200, body));
        }
        let reply = backend.reply(&path(r), "en", deadline()).await;
        matches(r, &reply).unwrap_or_else(|e| panic!("step {si}: {e}"));
    }
    let seen = stub.seen.lock().unwrap().clone();
    // Combined never reaches HTTP (unfundable); two funded forecasts, then exhausted.
    assert_eq!(seen.len(), 2, "{seen:?}");
    for url in &seen {
        assert!(url.starts_with("/timeline/38.27,140.87/today/next7days?unitGroup=us&lang=en&include=days,hours,current&elements=datetime,"), "{url}");
        assert!(url.ends_with("&key=synthetic-vc-key-0001"), "{url}");
    }
    let objects = peer.dump().await;
    assert!(
        objects
            .iter()
            .any(|(k, _, _)| k.starts_with("budgets/v2/visual_crossing/")
                && k.ends_with("authority.json"))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_same_cell_requests_share_one_funded_fetch() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (r, body) = request_body("london-recorded", 0, 0);
    stub.queue.lock().unwrap().push_back((200, body));
    let backend = Arc::new(WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 1000),
        Arc::new(Unconfigured),
        clock,
        WorldConfig::default(),
    )));
    let mut tasks = Vec::new();
    for i in 0..16 {
        let b = backend.clone();
        // Nearby precise coordinates in one cell, all versions.
        let p = path(r).replace(
            "51.507,-0.128",
            &format!("51.50{},-0.12{}", 1 + i % 9, 1 + i % 9),
        );
        tasks.push(tokio::spawn(
            async move { b.reply(&p, "ko", deadline()).await },
        ));
    }
    for t in tasks {
        assert!(matches!(t.await.unwrap(), WorldReply::Body(_)));
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 1);
    assert!(stub.seen.lock().unwrap()[0].starts_with("/timeline/51.51,-0.13/last1days/next7days?"));
    let reply = backend.reply(&path(r), "ko", deadline()).await;
    matches(r, &reply).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn provider_401_marks_down_then_unavailable_with_marker_retry() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    stub.queue
        .lock()
        .unwrap()
        .push_back((401, b"{\"error\":\"denied\"}".to_vec()));
    let backend = WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 1000),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let p = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    assert!(matches!(
        backend.reply(p, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:05:30.000Z"));
    match backend.reply(p, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-26T07:14:30.000Z")),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        stub.seen.lock().unwrap().len(),
        1,
        "no further provider call while down"
    );
}

/// Store that loads nothing and fails or delays publication.
struct FlakyStore {
    inner: MemoryWorldStore,
    fail_publish: Mutex<bool>,
    fail_load: Mutex<bool>,
}
impl WorldStore for FlakyStore {
    fn load(
        &self,
        cell: Cell,
        now: f64,
        d: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        Box::pin(async move {
            if *self.fail_load.lock().unwrap() {
                return Err(StoreError::Storage(StorageError::Transport));
            }
            self.inner.load(cell, now, d).await
        })
    }
    fn publish(
        &self,
        cell: Cell,
        f: RawFetch,
        d: Instant,
    ) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async move {
            if *self.fail_publish.lock().unwrap() {
                return Err(StoreError::Storage(StorageError::Ambiguous));
            }
            self.inner.publish(cell, f, d).await
        })
    }
}
/// Provider that counts calls and can be slow.
struct Slow {
    body: Vec<u8>,
    delay: Duration,
    calls: AtomicUsize,
}
impl VcSource for Slow {
    fn fetch(&self, _: Cell, _: Range, _: Instant) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(self.delay).await;
            Ok(self.body.clone())
        })
    }
}
fn flaky() -> Arc<FlakyStore> {
    Arc::new(FlakyStore {
        inner: MemoryWorldStore::default(),
        fail_publish: Mutex::new(false),
        fail_load: Mutex::new(false),
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn failed_publication_is_never_a_new_success_and_backs_off() {
    let (r, body) = request_body("london-recorded", 0, 0);
    let store = flaky();
    *store.fail_publish.lock().unwrap() = true;
    let source = Arc::new(Slow {
        body,
        delay: Duration::ZERO,
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let backend = WorldBackend::new(World::new(
        store.clone(),
        source.clone(),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    assert_eq!(
        source.calls.load(Ordering::SeqCst),
        1,
        "2 s backoff after a failed publication"
    );
    *store.fail_publish.lock().unwrap() = false;
    clock.set(ms("2026-09-26T07:04:30.000Z") + 2_500.);
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Body(_)
    ));
    assert_eq!(source.calls.load(Ordering::SeqCst), 2);
    assert_eq!(store.inner.all().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelled_or_slow_waiter_keeps_the_owned_fetch_and_publication() {
    let (r, body) = request_body("london-recorded", 0, 0);
    let store = flaky();
    let source = Arc::new(Slow {
        body,
        delay: Duration::from_millis(600),
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let config = WorldConfig {
        response: Duration::from_millis(150),
        ..WorldConfig::default()
    };
    let backend = Arc::new(WorldBackend::new(World::new(
        store.clone(),
        source.clone(),
        Arc::new(Unconfigured),
        clock,
        config,
    )));
    // A slow provider: the waiter answers within its response budget without data.
    let started = Instant::now();
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    assert!(started.elapsed() < Duration::from_millis(500));
    // A cancelled waiter does not cancel the owned fetch either.
    let b = backend.clone();
    let p = path(r);
    let _ = tokio::time::timeout(Duration::from_millis(20), async move {
        b.reply(&p, "ko", deadline()).await
    })
    .await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert_eq!(
        store.inner.all().len(),
        1,
        "owned fetch published after the waiter left"
    );
    let reply = backend.reply(&path(r), "ko", deadline()).await;
    matches(r, &reply).unwrap();
    assert_eq!(source.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unreadable_s3_on_a_cold_cell_never_authorizes_a_provider_call() {
    let (r, body) = request_body("london-recorded", 0, 0);
    let store = flaky();
    *store.fail_load.lock().unwrap() = true;
    let source = Arc::new(Slow {
        body,
        delay: Duration::ZERO,
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let backend = WorldBackend::new(World::new(
        store,
        source.clone(),
        Arc::new(Unconfigured),
        clock,
        WorldConfig::default(),
    ));
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    let disabled = WorldBackend::new(World::new(
        memory(),
        Arc::new(Disabled),
        Arc::new(Unconfigured),
        Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z"))),
        WorldConfig::default(),
    ));
    assert!(matches!(
        disabled.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
}
