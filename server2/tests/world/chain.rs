//! CHAINS: real S08 funding over the S3 peer and an actual loopback VC HTTP stub, one owned
//! fetch per cell, cancellation, slow providers, publication and S3 read failures.
use super::common::*;
use axum::{Router, extract::Request, http::StatusCode, response::IntoResponse};
use server2::{
    budget::{BudgetError, BudgetObject, BudgetTransport, Clock as BudgetClock},
    gateway::{BackendHandler, BoxFuture, GatewayError},
    storage::{Error as StorageError, WriteCondition},
    world::{
        Cell, Disabled, Eligibility, FixedClock, FundedVc, HttpVcTransport, MemoryWorldStore,
        Range, RawFetch, StoreError, Unconfigured, VcError, VcFunding, VcSource, World,
        WorldBackend, WorldConfig, WorldReply, WorldStore,
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
    /// Response delay in milliseconds (default 30).
    delay: Arc<std::sync::atomic::AtomicU64>,
}
async fn stub() -> Stub {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let queue: Queue = Arc::new(Mutex::new(VecDeque::new()));
    let delay = Arc::new(std::sync::atomic::AtomicU64::new(30));
    let (s, q, d) = (seen.clone(), queue.clone(), delay.clone());
    let app = Router::new().fallback(move |req: Request| {
        let (s, q, d) = (s.clone(), q.clone(), d.clone());
        async move {
            s.lock().unwrap().push(req.uri().to_string());
            tokio::time::sleep(Duration::from_millis(d.load(Ordering::SeqCst))).await;
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
        delay,
    }
}
pub(crate) struct ScenarioClock(pub(crate) Arc<FixedClock>);
impl BudgetClock for ScenarioClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        use server2::world::Clock;
        Ok(self.0.now_ms() as i64)
    }
}
/// Real S08 funding over the S3 peer (one window per UTC day) and the world VC HTTP transport.
pub(crate) fn funded_at(
    peer: &Peer,
    endpoint: &str,
    clock: Arc<FixedClock>,
    limit: u64,
) -> Arc<FundedVc<HttpVcTransport, server2::storage::HttpS3Transport>> {
    funded_with(peer.transport(), endpoint, clock, limit, limit.min(98))
}
pub(crate) fn funded_with<T: BudgetTransport + 'static>(
    transport: T,
    endpoint: &str,
    clock: Arc<FixedClock>,
    limit: u64,
    block: u64,
) -> Arc<FundedVc<HttpVcTransport, T>> {
    Arc::new(
        FundedVc::new(
            endpoint,
            Arc::new(HttpVcTransport::new().unwrap()),
            VcFunding {
                transport: Arc::new(transport),
                quota_id: "a".repeat(64),
                daily_units: limit,
                block_units: block,
                clock: Arc::new(ScenarioClock(clock)),
            },
            "synthetic-vc-key-0001".into(),
        )
        .unwrap(),
    )
}
/// S3 budget transport whose authority reads are delayed, so funding steps overlap in time.
struct Delayed<T>(T, Duration);
impl<T: BudgetTransport> BudgetTransport for Delayed<T> {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        tokio::time::sleep(self.1).await;
        self.0.get_budget(key).await
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        self.0.put_budget(key, body, condition).await
    }
}
fn funded(peer: &Peer, stub: &Stub, clock: Arc<FixedClock>, limit: u64) -> Arc<dyn VcSource> {
    funded_at(peer, &stub.endpoint, clock, limit)
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

fn native(peer: &Peer, stub: &Stub, clock: Arc<FixedClock>) -> WorldBackend {
    WorldBackend::new(World::new(
        peer.store(),
        funded(peer, stub, clock.clone(), 1000),
        Arc::new(Unconfigured),
        clock,
        WorldConfig::default(),
    ))
}

/// S11-R1-F02: a concurrency 429 is retried once inside the funded call; a limit 429 marks the
/// provider down so another cell gets the legacy 503 retry time without HTTP.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn vc_429_classes_follow_the_legacy_requester() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (r, body) = request_body("london-recorded", 0, 0);
    stub.queue.lock().unwrap().push_back((
        429,
        br#"{"message":"Maximum concurrency exceeded"}"#.to_vec(),
    ));
    stub.queue.lock().unwrap().push_back((200, body));
    let backend = native(&peer, &stub, clock.clone());
    matches(r, &backend.reply(&path(r), "ko", deadline()).await).unwrap();
    assert_eq!(
        stub.seen.lock().unwrap().len(),
        2,
        "one retry after a concurrency 429"
    );
    stub.queue
        .lock()
        .unwrap()
        .push_back((429, br#"{"message":"Daily record limit reached"}"#.to_vec()));
    let other = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    assert!(matches!(
        backend.reply(other, "en", deadline()).await,
        WorldReply::Error
    ));
    let third = "/v000903/dsf/coord/43.06,141.35?temperatureUnit=C";
    match backend.reply(third, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-26T07:14:30.000Z")),
        other => panic!("{other:?}"),
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 3);
}

/// S11-R1-F03: a billed 200 body that is not usable JSON backs off 15 minutes, not 2 seconds.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unusable_billed_body_backs_off_fifteen_minutes() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (r, body) = request_body("london-recorded", 0, 0);
    stub.queue
        .lock()
        .unwrap()
        .push_back((200, b"<html>busy</html>".to_vec()));
    let backend = native(&peer, &stub, clock.clone());
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:14:30.000Z"));
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Error
    ));
    assert_eq!(
        stub.seen.lock().unwrap().len(),
        1,
        "no call inside the 15 min backoff"
    );
    clock.set(ms("2026-09-26T07:19:31.000Z"));
    stub.queue.lock().unwrap().push_back((200, body));
    assert!(matches!(
        backend.reply(&path(r), "ko", deadline()).await,
        WorldReply::Body(_)
    ));
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

/// Provider that advances the request clock while it works, then fails.
struct ClockAdvancing {
    clock: Arc<FixedClock>,
    by: f64,
    calls: AtomicUsize,
}
impl VcSource for ClockAdvancing {
    fn fetch(&self, _: Cell, _: Range, _: Instant) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            use server2::world::Clock;
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.clock.set(self.clock.now_ms() + self.by);
            Err(VcError::Failed)
        })
    }
}

/// S11-R1-F07: backoff starts when the failure is handled, not at the request instant.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backoff_window_starts_at_failure_time() {
    let start = ms("2026-09-26T07:04:30.000Z");
    let clock = Arc::new(FixedClock::new(start));
    let source = Arc::new(ClockAdvancing {
        clock: clock.clone(),
        by: 5_000.,
        calls: AtomicUsize::new(0),
    });
    let backend = WorldBackend::new(World::new(
        memory(),
        source.clone(),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let p = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    assert!(matches!(
        backend.reply(p, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(start + 6_000.);
    assert!(matches!(
        backend.reply(p, "en", deadline()).await,
        WorldReply::Error
    ));
    assert_eq!(
        source.calls.load(Ordering::SeqCst),
        1,
        "still inside failure+2 s"
    );
    clock.set(start + 7_100.);
    let _ = backend.reply(p, "en", deadline()).await;
    assert_eq!(source.calls.load(Ordering::SeqCst), 2);
}

/// S11-R1-F05/F06: a busy cell is never evicted into a second owner, and concurrent requests for
/// a cell whose reply lacks yesterday complete from one fetch (legacy waiters).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn busy_cells_keep_one_owner_and_waiters_use_stored_current() {
    let (r, body) = request_body("no-yesterday", 0, 0);
    let source = Arc::new(Slow {
        body,
        delay: Duration::from_millis(300),
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let config = WorldConfig {
        max_cells: 1,
        ..WorldConfig::default()
    };
    let backend = Arc::new(WorldBackend::new(World::new(
        memory(),
        source.clone(),
        Arc::new(Unconfigured),
        clock,
        config,
    )));
    let mut tasks = Vec::new();
    for i in 0..8u64 {
        let b = backend.clone();
        let p = path(r);
        tasks.push(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20 * i)).await;
            b.reply(&p, "en", deadline()).await
        }));
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    // Another cell while the first is busy: the busy entry must not be evicted.
    let other = backend
        .reply(
            "/v000903/dsf/coord/1.87,-157.36?temperatureUnit=C",
            "en",
            deadline(),
        )
        .await;
    assert!(matches!(other, WorldReply::Body(_) | WorldReply::Error));
    for t in tasks {
        matches(r, &t.await.unwrap()).unwrap();
    }
    // One fetch for the no-yesterday cell plus one for the other cell.
    assert_eq!(source.calls.load(Ordering::SeqCst), 2);
}

/// S11-R1-F08: once a funding window is observed exhausted, a backed-off cell still returns the
/// legacy 503 budget retry time instead of the backoff error class.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn observed_exhaustion_precedes_cell_backoff() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let backend = WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 4),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let a = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    let b = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    // Combined is unfundable (limit 4); forecast is funded and fails: cell A backs off 2 s.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    // Cell B uses the remaining forecast units.
    assert!(matches!(
        backend.reply(b, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    let c = "/v000903/dsf/coord/43.06,141.35?temperatureUnit=C";
    match backend.reply(c, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-27T00:00:00.000Z")),
        other => panic!("{other:?}"),
    }
    match backend.reply(a, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-27T00:00:00.000Z")),
        other => panic!("cell in backoff: {other:?}"),
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

struct SlowAir;
impl server2::world::AirSource for SlowAir {
    fn current(&self, _: f64, _: f64, _: f64) -> BoxFuture<'_, server2::world::AirOutcome> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            server2::world::AirOutcome::None
        })
    }
}

/// S11-R1-F04: a slow air branch releases the weather as `airStatus` pending within the attempt.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn slow_air_releases_weather_within_the_attempt() {
    let (r, body) = request_body("london-recorded", 0, 0);
    let source = Arc::new(Slow {
        body,
        delay: Duration::ZERO,
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let backend = WorldBackend::new(World::new(
        memory(),
        source,
        Arc::new(SlowAir),
        clock,
        WorldConfig::default(),
    ));
    let started = Instant::now();
    let reply = backend
        .reply(&path(r), "ko", Instant::now() + Duration::from_secs(3))
        .await;
    assert!(started.elapsed() < Duration::from_secs(3));
    match reply {
        WorldReply::Body(v) => {
            let t = text(&v);
            assert!(
                t.contains(r#""airStatus":{"state":"pending","retryAfterSeconds":3}"#),
                "{t}"
            );
        }
        other => panic!("{other:?}"),
    }
}

/// S11-R2-F01: the first request that meets an exhausted funding window behind a backed-off
/// cell answers the legacy 503 with the window end, without another cell observing it first.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_observed_exhaustion_outranks_backoff_through_s10() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let backend = WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 4),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let a = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    let b = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    // Combined is unfundable (limit 4); the funded forecast fails: cell A backs off 2 s.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    // Cell B funds the remaining forecast units and fails too.
    assert!(matches!(
        backend.reply(b, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    // A again, inside its backoff, with no other cell having observed forecast exhaustion.
    match backend
        .fetch(a.to_owned(), "en".to_owned(), deadline())
        .await
    {
        Err(GatewayError::Unavailable(seconds)) => {
            // Window end 2026-09-27T00:00Z, clamped by the S10 mapping to one hour.
            assert_eq!(
                seconds,
                server2::world::retry_seconds(
                    ms("2026-09-27T00:00:00.000Z"),
                    ms("2026-09-26T07:04:31.000Z")
                )
            )
        }
        other => panic!("{:?}", other.map(|_| ())),
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 2, "no HTTP for the 503");
}

/// The eligibility probe of a backed-off request keeps its funded reservation for the next
/// fetch of that range, so probing never discards units.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn probe_reservation_funds_the_next_fetch() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (_, body) = request_body("london-recorded", 0, 0);
    let backend = WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 6),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let a = "/v000903/dsf/coord/51.507,-0.128?temperatureUnit=C";
    let b = "/v000903/dsf/coord/51.6,-0.2?temperatureUnit=C";
    let c = "/v000903/dsf/coord/52.2,0.12?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    // Forecast funded (2 of 6) and failed: backoff.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    // Inside the backoff: the probe funds 2 more units (4 of 6) and keeps them.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    assert_eq!(stub.seen.lock().unwrap().len(), 1);
    clock.set(ms("2026-09-26T07:04:34.000Z"));
    stub.queue.lock().unwrap().push_back((200, body.clone()));
    stub.queue.lock().unwrap().push_back((200, body));
    // A uses the pooled reservation; B funds the last 2 units; C finds the window exhausted.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Body(_)
    ));
    assert!(matches!(
        backend.reply(b, "en", deadline()).await,
        WorldReply::Body(_)
    ));
    match backend.reply(c, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-27T00:00:00.000Z")),
        other => panic!("{other:?}"),
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 3);
}

/// A funding window is one UTC day: after midnight a fresh S08 window funds requests again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn funding_rolls_over_to_the_next_utc_day() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T23:59:00.000Z")));
    let source = funded(&peer, &stub, clock.clone(), 2);
    let cell = Cell::of(35.68, 139.76).unwrap();
    let soon = || Instant::now() + Duration::from_secs(3);
    stub.queue.lock().unwrap().push_back((200, b"{}".to_vec()));
    assert!(source.fetch(cell, Range::Forecast, soon()).await.is_ok());
    assert_eq!(
        source.fetch(cell, Range::Forecast, soon()).await,
        Err(VcError::Exhausted {
            retry_at_ms: ms("2026-09-27T00:00:00.000Z")
        })
    );
    clock.set(ms("2026-09-27T00:00:01.000Z"));
    stub.queue.lock().unwrap().push_back((200, b"{}".to_vec()));
    assert!(source.fetch(cell, Range::Forecast, soon()).await.is_ok());
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

/// S11-R2-F02: a burst that exceeds `max_cells` while every cell is busy is trimmed back to
/// capacity once the cells are idle, and repeated cells still have one owner.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn busy_burst_is_trimmed_back_to_capacity() {
    let (r, body) = request_body("london-recorded", 0, 0);
    let source = Arc::new(Slow {
        body,
        delay: Duration::from_millis(200),
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let world = World::new(
        memory(),
        source.clone(),
        Arc::new(Unconfigured),
        clock,
        WorldConfig {
            max_cells: 1,
            ..WorldConfig::default()
        },
    );
    let backend = Arc::new(WorldBackend::new(world.clone()));
    let cells = [
        path(r),
        "/v000903/dsf/coord/40.71,-74.0?temperatureUnit=C".to_owned(),
        "/v000903/dsf/coord/-33.86,151.2?temperatureUnit=C".to_owned(),
    ];
    let burst = |paths: Vec<String>| {
        let backend = backend.clone();
        async move {
            let tasks: Vec<_> = paths
                .into_iter()
                .map(|p| {
                    let b = backend.clone();
                    tokio::spawn(async move { b.reply(&p, "en", deadline()).await })
                })
                .collect();
            for t in tasks {
                assert!(matches!(t.await.unwrap(), WorldReply::Body(_)));
            }
        }
    };
    burst(cells.to_vec()).await;
    assert_eq!(source.calls.load(Ordering::SeqCst), 3);
    assert!(world.cached_cells() <= 1, "{}", world.cached_cells());
    // Repeated requests for one cell after the burst: still one owner and bounded state.
    burst(vec![cells[0].clone(); 4]).await;
    assert!(world.cached_cells() <= 1, "{}", world.cached_cells());
    assert_eq!(
        source.calls.load(Ordering::SeqCst),
        3,
        "restored from the store, no refetch"
    );
}

/// S11-R3-F01: concurrent requests behind backed-off cells share the funding outcome; both get
/// the legacy 503 for an exhausted window even while the first check is still in progress.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_backoff_requests_share_the_exhaustion_outcome() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let source = funded_with(
        Delayed(peer.transport(), Duration::from_millis(200)),
        &stub.endpoint,
        clock.clone(),
        4,
        4,
    );
    let backend = Arc::new(WorldBackend::new(World::new(
        peer.store(),
        source,
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    )));
    let a = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    let b = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    assert!(matches!(
        backend.reply(b, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    let tasks: Vec<_> = [a, b]
        .into_iter()
        .map(|p| {
            let backend = backend.clone();
            tokio::spawn(async move { backend.reply(p, "en", deadline()).await })
        })
        .collect();
    for t in tasks {
        match t.await.unwrap() {
            WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-27T00:00:00.000Z")),
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

/// S11-R3-F02: a fetch and an eligibility probe for the last funds of a window are serialized;
/// the fetch is funded (by its own or the probe's reservation) and never sees false exhaustion.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fetch_and_probe_never_race_into_false_exhaustion() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (r, body) = request_body("london-recorded", 0, 0);
    let source = funded_with(
        Delayed(peer.transport(), Duration::from_millis(200)),
        &stub.endpoint,
        clock.clone(),
        4,
        2,
    );
    let backend = Arc::new(WorldBackend::new(World::new(
        peer.store(),
        source,
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    )));
    let a = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    // First pair of units: A's forecast fails and backs off.
    assert!(matches!(
        backend.reply(a, "en", deadline()).await,
        WorldReply::Error
    ));
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    stub.queue.lock().unwrap().push_back((200, body));
    // Overlap A's probe (inside its backoff) with B's fetch for the final pair.
    let probe = {
        let backend = backend.clone();
        tokio::spawn(async move { backend.reply(a, "en", deadline()).await })
    };
    let fetch = {
        let backend = backend.clone();
        let p = path(r);
        tokio::spawn(async move { backend.reply(&p, "ko", deadline()).await })
    };
    assert!(
        matches!(fetch.await.unwrap(), WorldReply::Body(_)),
        "B must be funded"
    );
    assert!(matches!(
        probe.await.unwrap(),
        WorldReply::Error | WorldReply::Unavailable(_)
    ));
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

/// S11-R3-F03: unconsumed funds serve any range, so a combined failure plus a combined
/// eligibility check cannot starve forecast; a new UTC day funds again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pooled_funds_serve_any_range_and_roll_over() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let source = funded_with(peer.transport(), &stub.endpoint, clock.clone(), 196, 98);
    let cell = Cell::of(35.68, 139.76).unwrap();
    let soon = || Instant::now() + Duration::from_secs(3);
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    assert_eq!(
        source.fetch(cell, Range::Combined, soon()).await,
        Err(VcError::Failed)
    );
    // Eligibility for combined reserves the window's other 98 units.
    assert_eq!(
        source
            .eligible(Range::Combined, Instant::now() + Duration::from_secs(3))
            .await,
        Eligibility::Funded
    );
    stub.queue.lock().unwrap().push_back((200, b"{}".to_vec()));
    assert!(source.fetch(cell, Range::Forecast, soon()).await.is_ok());
    stub.queue.lock().unwrap().push_back((200, b"{}".to_vec()));
    assert!(source.fetch(cell, Range::Combined, soon()).await.is_ok());
    clock.set(ms("2026-09-27T00:00:01.000Z"));
    stub.queue.lock().unwrap().push_back((200, b"{}".to_vec()));
    assert!(source.fetch(cell, Range::Forecast, soon()).await.is_ok());
    assert_eq!(stub.seen.lock().unwrap().len(), 4);
}

/// S11-R3-F04: cells kept by detached owned fetches that outlive their requests are trimmed
/// when that owned work finishes, without another request.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn detached_burst_is_trimmed_after_owned_work_finishes() {
    let (_, body) = request_body("london-recorded", 0, 0);
    let source = Arc::new(Slow {
        body,
        delay: Duration::from_millis(500),
        calls: AtomicUsize::new(0),
    });
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let world = World::new(
        memory(),
        source.clone(),
        Arc::new(Unconfigured),
        clock,
        WorldConfig {
            max_cells: 1,
            ..WorldConfig::default()
        },
    );
    let backend = Arc::new(WorldBackend::new(world.clone()));
    let paths = [
        "/v000903/dsf/coord/51.507,-0.128?temperatureUnit=C",
        "/v000903/dsf/coord/40.71,-74.0?temperatureUnit=C",
        "/v000903/dsf/coord/-33.86,151.2?temperatureUnit=C",
    ];
    let tasks: Vec<_> = paths
        .into_iter()
        .map(|p| {
            let b = backend.clone();
            let short = Instant::now() + Duration::from_millis(100);
            tokio::spawn(async move { b.reply(p, "en", short).await })
        })
        .collect();
    for t in tasks {
        assert!(matches!(t.await.unwrap(), WorldReply::Error));
    }
    assert!(
        world.cached_cells() > 1,
        "busy cells exceed capacity meanwhile"
    );
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert!(world.cached_cells() <= 1, "{}", world.cached_cells());
    assert_eq!(source.calls.load(Ordering::SeqCst), 3);
}

/// S11-R4-F01: a funding outcome slower than 1.5 s is still awaited within the attempt, and a
/// queued caller gets the same 503.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_funding_outcome_is_awaited_within_the_attempt() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let source = funded_with(
        Delayed(peer.transport(), Duration::from_millis(2000)),
        &stub.endpoint,
        clock.clone(),
        4,
        4,
    );
    let backend = Arc::new(WorldBackend::new(World::new(
        peer.store(),
        source,
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    )));
    let a = "/v000903/dsf/coord/35.68,139.76?temperatureUnit=C";
    let b = "/v000903/dsf/coord/34.7,135.5?temperatureUnit=C";
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    stub.queue.lock().unwrap().push_back((500, Vec::new()));
    let _ = backend.reply(a, "en", deadline()).await;
    let _ = backend.reply(b, "en", deadline()).await;
    // Both owned fetches have run (each reached HTTP once) and backed off.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
    clock.set(ms("2026-09-26T07:04:31.000Z"));
    let attempt = || Instant::now() + Duration::from_secs(3);
    let tasks: Vec<_> = [a, b]
        .into_iter()
        .map(|p| {
            let backend = backend.clone();
            let until = attempt();
            tokio::spawn(async move { backend.fetch(p.to_owned(), "en".to_owned(), until).await })
        })
        .collect();
    for t in tasks {
        match t.await.unwrap() {
            Err(GatewayError::Unavailable(_)) => {}
            other => panic!("{:?}", other.map(|_| ())),
        }
    }
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}

/// S11-R4-F02: a denial observed while another cell holds the window's funds does not outlive
/// the units that cell returns; the next request is funded from the pool the same day.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn returned_units_fund_a_cell_after_an_observed_denial() {
    let peer = Peer::new();
    let stub = stub().await;
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    let (r, body) = request_body("london-recorded", 0, 0);
    let backend = Arc::new(WorldBackend::new(World::new(
        peer.store(),
        funded(&peer, &stub, clock.clone(), 98),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    )));
    stub.delay.store(600, Ordering::SeqCst);
    stub.queue.lock().unwrap().push_back((200, body.clone()));
    let a = {
        let backend = backend.clone();
        let p = path(r);
        tokio::spawn(async move { backend.reply(&p, "ko", deadline()).await })
    };
    tokio::time::sleep(Duration::from_millis(150)).await;
    // A holds the whole window (98 units) during HTTP: B is denied combined and forecast.
    let b = "/v000903/dsf/coord/48.85,2.35?temperatureUnit=C";
    match backend.reply(b, "en", deadline()).await {
        WorldReply::Unavailable(at) => assert_eq!(at, ms("2026-09-27T00:00:00.000Z")),
        other => panic!("{other:?}"),
    }
    assert!(matches!(a.await.unwrap(), WorldReply::Body(_)));
    // A consumed one 49-unit attempt and returned 49 units to the pool.
    tokio::time::sleep(Duration::from_millis(100)).await;
    stub.delay.store(30, Ordering::SeqCst);
    stub.queue.lock().unwrap().push_back((200, body));
    assert!(
        matches!(
            backend.reply(b, "en", deadline()).await,
            WorldReply::Body(_)
        ),
        "returned units fund B's forecast without waiting for the next day"
    );
    assert_eq!(stub.seen.lock().unwrap().len(), 2);
}
