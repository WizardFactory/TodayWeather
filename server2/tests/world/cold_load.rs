//! D3 public behavior: a failed cold restoration belongs to one same-cell cohort.
//! Owned fake storage is held until every caller has entered the public records future.
//! No provider, network, wall-clock sleep or storage implementation internals are used.
use super::common::ms;
use futures_util::future::join_all;
use server2::{
    gateway::BoxFuture,
    storage::Error as StorageError,
    world::{
        Cell, Failure, FixedClock, Range, RawFetch, StoreError, Unconfigured, VcError, VcSource,
        World, WorldConfig, WorldStore,
    },
};
use std::{
    future::{Future, poll_fn},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    task::Poll,
    time::Duration,
};
use tokio::{
    sync::{Notify, Semaphore},
    time::{Instant, timeout},
};

struct HeldFailure {
    calls: AtomicUsize,
    entered: Notify,
    release: Semaphore,
    answer: Mutex<Option<Vec<RawFetch>>>,
    deadlines: Mutex<Vec<Instant>>,
    panic: AtomicBool,
}
impl HeldFailure {
    fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            entered: Notify::new(),
            release: Semaphore::new(0),
            answer: Mutex::new(None),
            deadlines: Mutex::new(Vec::new()),
            panic: AtomicBool::new(false),
        }
    }
}
impl WorldStore for HeldFailure {
    fn load(
        &self,
        _: Cell,
        _: f64,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, StoreError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.deadlines.lock().unwrap().push(deadline);
            self.entered.notify_one();
            // Returning the permit allows any incorrectly repeated owner to fail too,
            // so a duplicate load is reported by its counter rather than a timeout.
            let permit = self.release.acquire().await.unwrap();
            drop(permit);
            assert!(
                !self.panic.load(Ordering::SeqCst),
                "synthetic cold storage panic"
            );
            self.answer
                .lock()
                .unwrap()
                .clone()
                .ok_or(StoreError::Storage(StorageError::Transport))
        })
    }
    fn publish(&self, _: Cell, _: RawFetch, _: Instant) -> BoxFuture<'_, Result<(), StoreError>> {
        Box::pin(async { panic!("a failed cold read must not publish") })
    }
}

#[derive(Default)]
struct CountProvider(AtomicUsize);
impl VcSource for CountProvider {
    fn fetch(&self, _: Cell, _: Range, _: Instant) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(VcError::Failed)
        })
    }
}

async fn failed_cohort(cancel_initiator: bool) -> usize {
    let store = Arc::new(HeldFailure::new());
    let provider = Arc::new(CountProvider::default());
    let now = ms("2026-09-26T07:04:30.000Z");
    let world = World::new(
        store.clone(),
        provider.clone(),
        Arc::new(Unconfigured),
        Arc::new(FixedClock::new(now)),
        WorldConfig::default(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut waiters: Vec<_> = (0..16)
        .map(|_| Box::pin(world.records(51.507, -0.128, now, deadline)))
        .collect();
    // Explicitly poll each public future once before releasing storage. This proves
    // the whole cohort joined before completion without sleeps or a private hook.
    for waiter in &mut waiters {
        poll_fn(|cx| {
            assert!(waiter.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
    }
    timeout(Duration::from_secs(1), store.entered.notified())
        .await
        .expect("the initial cold storage owner must start");
    assert_eq!(store.calls.load(Ordering::SeqCst), 1);
    if cancel_initiator {
        drop(waiters.remove(0));
    }
    store.release.add_permits(1);
    let outcomes = timeout(Duration::from_secs(1), join_all(waiters))
        .await
        .expect("a released failure must settle every remaining waiter");
    assert_eq!(outcomes.len(), if cancel_initiator { 15 } else { 16 });
    assert!(outcomes.iter().all(|r| matches!(r, Err(Failure::Error))));
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
    store.calls.load(Ordering::SeqCst)
}

#[tokio::test]
async fn cold_load_failure_is_shared_by_sixteen_waiters() {
    assert_eq!(
        failed_cohort(false).await,
        1,
        "all sixteen same-cell callers must share the completed storage failure"
    );
}

#[tokio::test]
async fn cancelled_initial_waiter_keeps_one_shared_cold_failure() {
    assert_eq!(
        failed_cohort(true).await,
        1,
        "dropping the initial waiter must keep one owner and one failure for its cohort"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn whole_load_bytes_and_fetches_fail_closed_across_legal_partitions() {
    use super::common::{Peer, deadline};
    use server2::{
        storage::{CatalogLimits, sha256},
        world::{CatalogWorldStore, store::WorldLoadLimits},
    };
    let peer = Peer::new();
    let publisher = peer.store();
    let now = ms("2026-09-26T07:04:30.000Z");
    let cell = Cell::of(51.507, -0.128).unwrap();
    let mut expected = Vec::new();
    for (index, date) in [20260925, 20260926].into_iter().enumerate() {
        let body: Arc<[u8]> = vec![b'a' + index as u8; 80].into();
        let row = RawFetch {
            fetched_at_ms: now as u64 - 2000 + index as u64,
            range: Range::Combined,
            first_date: date,
            sha256: sha256(&body),
            body,
        };
        publisher
            .publish(cell, row.clone(), deadline())
            .await
            .unwrap();
        expected.push(row);
    }
    // Each 80-byte partition is individually legal under all three policies.
    for limits in [
        WorldLoadLimits {
            raw_bytes: 128,
            fetches: 2,
        },
        WorldLoadLimits {
            raw_bytes: 160,
            fetches: 1,
        },
    ] {
        let store =
            CatalogWorldStore::with_load_limits(peer.transport(), CatalogLimits::default(), limits)
                .unwrap();
        assert_eq!(
            store.load(cell, now, deadline()).await,
            Err(StoreError::Storage(StorageError::Capacity)),
            "individually valid partitions must not bypass the whole-load cap",
        );
        assert_eq!(
            store
                .load_first_dates(cell, &[20260925, 20260926], deadline())
                .await,
            Err(StoreError::Storage(StorageError::Capacity)),
            "summary restoration must use the same aggregate policy",
        );
        let provider = Arc::new(CountProvider::default());
        let world = World::new(
            Arc::new(store),
            provider.clone(),
            Arc::new(Unconfigured),
            Arc::new(FixedClock::new(now)),
            WorldConfig::default(),
        );
        assert!(matches!(
            world.records(51.507, -0.128, now, deadline()).await,
            Err(Failure::Error)
        ));
        assert_eq!(
            provider.0.load(Ordering::SeqCst),
            0,
            "a capacity refusal cannot fund VC"
        );
    }
    let store = CatalogWorldStore::with_load_limits(
        peer.transport(),
        CatalogLimits::default(),
        WorldLoadLimits {
            raw_bytes: 160,
            fetches: 2,
        },
    )
    .unwrap();
    assert_eq!(store.load(cell, now, deadline()).await.unwrap(), expected);
    assert_eq!(
        store
            .load_first_dates(cell, &[20260925, 20260926], deadline())
            .await
            .unwrap(),
        expected
    );
}

#[test]
fn whole_load_limits_reject_invalid_policy() {
    use server2::world::store::WorldLoadLimits;
    for limits in [
        WorldLoadLimits {
            raw_bytes: 0,
            fetches: 1,
        },
        WorldLoadLimits {
            raw_bytes: 1,
            fetches: 0,
        },
        WorldLoadLimits {
            raw_bytes: 32 * 1024 * 1024 + 1,
            fetches: 1,
        },
        WorldLoadLimits {
            raw_bytes: 1,
            fetches: 2049,
        },
    ] {
        assert!(limits.validate().is_err());
    }
}

fn recorded_rows(now: f64) -> Vec<RawFetch> {
    use super::common::{body, scenario};
    use server2::storage::sha256;
    let call = &scenario("london-recorded")["steps"][0]["requests"][0]["calls"][0];
    let bytes = body(call["body_sha256"].as_str().unwrap());
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let date = json["days"][0]["datetime"]
        .as_str()
        .unwrap()
        .replace('-', "");
    vec![RawFetch {
        fetched_at_ms: now as u64,
        range: Range::parse(call["range"].as_str().unwrap()).unwrap(),
        first_date: date.parse().unwrap(),
        sha256: sha256(&bytes),
        body: bytes.into(),
    }]
}
fn held_world(store: Arc<HeldFailure>, provider: Arc<CountProvider>, max_cells: usize) -> World {
    let now = ms("2026-09-26T07:04:30.000Z");
    World::new(
        store,
        provider,
        Arc::new(Unconfigured),
        Arc::new(FixedClock::new(now)),
        WorldConfig {
            max_cells,
            ..WorldConfig::default()
        },
    )
}

#[tokio::test(start_paused = true)]
async fn completed_failure_waits_three_seconds_then_recovers_without_provider() {
    let store = Arc::new(HeldFailure::new());
    let provider = Arc::new(CountProvider::default());
    let world = held_world(store.clone(), provider.clone(), 4096);
    let now = world.now_ms();
    store.release.add_permits(1);
    assert!(matches!(
        world
            .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
            .await,
        Err(Failure::Error)
    ));
    *store.answer.lock().unwrap() = Some(recorded_rows(now));
    assert!(matches!(
        world
            .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
            .await,
        Err(Failure::Error)
    ));
    assert_eq!(
        store.calls.load(Ordering::SeqCst),
        1,
        "completed error is shared, not absence"
    );
    tokio::time::advance(Duration::from_millis(3001)).await;
    let found = world
        .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert!(found.current.is_some() && found.today.is_some());
    assert_eq!(store.calls.load(Ordering::SeqCst), 2);
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn waiter_bounds_do_not_restart_the_eight_second_owner() {
    let store = Arc::new(HeldFailure::new());
    let provider = Arc::new(CountProvider::default());
    let world = held_world(store.clone(), provider.clone(), 4096);
    let now = world.now_ms();
    let started = Instant::now();
    let first = world
        .records(51.507, -0.128, now, started + Duration::from_secs(20))
        .await;
    assert!(matches!(first, Err(Failure::Error)));
    assert_eq!(Instant::now() - started, Duration::from_secs(3));
    assert_eq!(
        *store.deadlines.lock().unwrap(),
        vec![started + Duration::from_secs(8)]
    );
    // A second waiter at t=3 leaves at t=6; the same owner is still pending.
    assert!(matches!(
        world
            .records(51.507, -0.128, now, started + Duration::from_secs(20))
            .await,
        Err(Failure::Error)
    ));
    assert_eq!(Instant::now() - started, Duration::from_secs(6));
    tokio::time::advance(Duration::from_millis(2001)).await;
    tokio::task::yield_now().await;
    // Even a transport ignoring its deadline was cancelled by the original owner bound.
    store.release.add_permits(1);
    assert!(matches!(
        world
            .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
            .await,
        Err(Failure::Error)
    ));
    assert_eq!(store.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_millis(3001)).await;
    assert!(matches!(
        world
            .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
            .await,
        Err(Failure::Error)
    ));
    assert_eq!(
        store.calls.load(Ordering::SeqCst),
        2,
        "later demand can recover the expired owner"
    );
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn idle_eviction_does_not_reuse_a_retained_successful_db() {
    let store = Arc::new(HeldFailure::new());
    let provider = Arc::new(CountProvider::default());
    let world = held_world(store.clone(), provider.clone(), 1);
    let now = world.now_ms();
    store.release.add_permits(1);
    *store.answer.lock().unwrap() = Some(recorded_rows(now));
    for (lat, lon) in [(51.507, -0.128), (35.68, 139.76)] {
        assert!(
            world
                .records(lat, lon, now, Instant::now() + Duration::from_secs(3))
                .await
                .is_ok()
        );
        assert_eq!(world.cached_cells(), 1);
    }
    *store.answer.lock().unwrap() = None;
    assert!(matches!(
        world
            .records(51.507, -0.128, now, Instant::now() + Duration::from_secs(3))
            .await,
        Err(Failure::Error)
    ));
    assert_eq!(
        store.calls.load(Ordering::SeqCst),
        3,
        "eviction creates a fresh cell identity"
    );
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}

#[derive(Clone, Default)]
struct ImmediateReadFailure(Arc<AtomicUsize>);
impl server2::storage::ObjectTransport for ImmediateReadFailure {
    async fn put(&self, _: &server2::storage::PreparedRecord) -> Result<u16, StorageError> {
        Err(StorageError::Transport)
    }
    async fn head(&self, _: &str) -> Result<server2::storage::Object, StorageError> {
        Err(StorageError::Transport)
    }
    async fn get(&self, _: &str, _: usize) -> Result<server2::storage::Object, StorageError> {
        Err(StorageError::Transport)
    }
}
impl server2::storage::CatalogTransport for ImmediateReadFailure {
    async fn get_control(
        &self,
        _: &str,
        _: usize,
    ) -> Result<server2::storage::ControlObject, StorageError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(StorageError::Transport)
    }
    async fn put_control(
        &self,
        _: &str,
        _: &[u8],
        _: &server2::storage::WriteCondition,
    ) -> Result<u16, StorageError> {
        Err(StorageError::Transport)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, StorageError> {
        Err(StorageError::Transport)
    }
}

#[tokio::test]
async fn completed_unconsumed_partitions_keep_their_four_slots() {
    use server2::{storage::CatalogLimits, world::CatalogWorldStore};
    let transport = ImmediateReadFailure::default();
    let store = CatalogWorldStore::new(transport.clone(), CatalogLimits::default()).unwrap();
    let mut load = store.load(
        Cell::of(51.507, -0.128).unwrap(),
        ms("2026-09-26T07:04:30.000Z"),
        Instant::now() + Duration::from_secs(3),
    );
    poll_fn(|cx| {
        assert!(load.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    // Poll child tasks but deliberately do not poll the parent load again. A gate
    // released on task completion would let all21 tasks dispatch during this gap.
    for _ in 0..32 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        transport.0.load(Ordering::SeqCst),
        4,
        "completed results still occupy the four partition reservations"
    );
    assert_eq!(
        load.await,
        Err(StoreError::Storage(StorageError::Transport))
    );
    assert_eq!(
        transport.0.load(Ordering::SeqCst),
        4,
        "a failed wave starts no replacement"
    );
}

#[tokio::test]
async fn panicking_cold_owner_publishes_one_failed_outcome() {
    let store = Arc::new(HeldFailure::new());
    let provider = Arc::new(CountProvider::default());
    let world = held_world(store.clone(), provider.clone(), 4096);
    store.panic.store(true, Ordering::SeqCst);
    store.release.add_permits(1);
    for _ in 0..2 {
        assert!(matches!(
            world
                .records(
                    51.507,
                    -0.128,
                    world.now_ms(),
                    Instant::now() + Duration::from_secs(3)
                )
                .await,
            Err(Failure::Error)
        ));
    }
    assert_eq!(store.calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.0.load(Ordering::SeqCst), 0);
}
