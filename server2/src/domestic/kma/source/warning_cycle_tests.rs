use super::*;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};

#[tokio::test]
async fn unpolled_wrapper_releases_its_reserved_owner() {
    let lane = Lane::default();
    let attempts = Attempts::default();
    let lease = lane.claim(&attempts, Duration::ZERO).unwrap();
    let work = lane.launch(lease, || async { panic!("must not poll") });
    drop(work);
    tokio::time::timeout(Duration::from_secs(1), lane.idle())
        .await
        .unwrap();
    assert!(lane.claim(&attempts, Duration::ZERO).is_some());
}
#[tokio::test]
async fn closed_before_first_poll_does_not_drop_under_watch_write_lock() {
    let lane = Lane::default();
    let lease = lane.claim(&Attempts::default(), Duration::ZERO).unwrap();
    lane.close();
    tokio::time::timeout(
        Duration::from_secs(1),
        lane.launch(lease, || async {
            panic!("closed source cannot launch");
        }),
    )
    .await
    .unwrap();
    assert!(lane.claim(&Attempts::default(), Duration::ZERO).is_none());
    lane.idle().await;
}
struct Destroyed(Arc<AtomicBool>);
impl Drop for Destroyed {
    fn drop(&mut self) {
        self.0.store(true, SeqCst);
    }
}
#[tokio::test]
async fn actual_provider_future_is_destroyed_before_idle_is_visible() {
    let lane = Lane::default();
    let lease = lane.claim(&Attempts::default(), Duration::ZERO).unwrap();
    let destroyed = Arc::new(AtomicBool::new(false));
    let d = destroyed.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let l = lane.clone();
    let wrapper = tokio::spawn(async move {
        l.launch(lease, move || async move {
            let _destroyed = Destroyed(d);
            let _ = tx.send(());
            std::future::pending::<()>().await;
        })
        .await
    });
    rx.await.unwrap();
    assert!(!destroyed.load(SeqCst));
    lane.abort();
    tokio::time::timeout(Duration::from_secs(1), lane.idle())
        .await
        .unwrap();
    assert!(destroyed.load(SeqCst));
    wrapper.await.unwrap();
}
#[tokio::test]
async fn detached_inner_survives_wrapper_expiry_and_remains_cancellable() {
    let lane = Lane::default();
    let attempts = Attempts::default();
    let lease = lane.claim(&attempts, Duration::ZERO).unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            lane.launch(lease, move || async {
                let _ = tx.send(());
                std::future::pending::<()>().await;
            })
        )
        .await
        .is_err()
    );
    rx.await.unwrap();
    assert!(lane.claim(&attempts, Duration::ZERO).is_none());
    lane.abort();
    tokio::time::timeout(Duration::from_secs(1), lane.idle())
        .await
        .unwrap();
}
#[tokio::test]
async fn synchronous_constructor_and_async_panics_clear_once() {
    let lane = Lane::default();
    let attempts = Attempts::default();
    let lease = lane.claim(&attempts, Duration::ZERO).unwrap();
    lane.launch(lease, || -> std::future::Ready<()> {
        panic!("constructor")
    })
    .await;
    lane.idle().await;
    let lease = lane.claim(&attempts, Duration::ZERO).unwrap();
    lane.launch(lease, || async {
        tokio::task::yield_now().await;
        panic!("after await")
    })
    .await;
    lane.idle().await;
    assert!(lane.claim(&attempts, Duration::ZERO).is_some());
}
#[tokio::test]
async fn nonoverlap_and_close_race_cannot_launch_after_fence() {
    for _ in 0..20 {
        let lane = Lane::default();
        let attempts = Attempts::default();
        let lease = lane.claim(&attempts, Duration::ZERO).unwrap();
        assert!(lane.claim(&attempts, Duration::ZERO).is_none());
        let l = lane.clone();
        let task = tokio::spawn(async move {
            l.launch(lease, || async {
                std::future::pending::<()>().await;
            })
            .await
        });
        lane.abort();
        tokio::time::timeout(Duration::from_secs(1), lane.idle())
            .await
            .unwrap();
        task.await.unwrap();
        assert!(lane.claim(&attempts, Duration::ZERO).is_none());
    }
}
#[tokio::test]
async fn memo_remaining_uses_real_attempt_expiry_not_a_fixed_timer_phase() {
    let attempts = Attempts::default();
    assert!(attempts.claim("warnings", Duration::from_millis(60)));
    tokio::time::sleep(Duration::from_millis(20)).await;
    let remaining = attempts.remaining("warnings");
    assert!(!remaining.is_zero());
    assert!(remaining <= Duration::from_millis(60));
    assert!(!attempts.claim("warnings", Duration::from_millis(60)));
    tokio::time::sleep(remaining + Duration::from_millis(2)).await;
    assert!(attempts.claim("warnings", Duration::from_millis(60)));
}

#[tokio::test]
async fn actual_owned_flight_expiry_does_not_lose_the_inner_abort_handle() {
    use crate::resolver::{OwnedConfig, Waited};
    let flights = OwnedFlights::<String, ()>::new(OwnedConfig::default()).unwrap();
    let lane = Lane::default();
    let l = lane.clone();
    let attempts = Attempts::default();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let result = flights
        .wait(
            "warnings/test".into(),
            Duration::from_millis(20),
            move |_| {
                let lease = l.claim(&attempts, Duration::ZERO).unwrap();
                async move {
                    l.launch(lease, move || async {
                        let _ = tx.send(());
                        std::future::pending::<()>().await;
                    })
                    .await
                }
            },
        )
        .await;
    rx.await.unwrap();
    assert_eq!(result, Waited::Expired);
    assert_eq!(
        flights.running(),
        0,
        "generic pool idle is not collector termination"
    );
    assert!(lane.0.borrow().running);
    lane.abort();
    tokio::time::timeout(Duration::from_secs(1), lane.idle())
        .await
        .unwrap();
}
#[tokio::test]
async fn abort_before_inner_first_poll_drops_lease_without_constructing_provider() {
    let lane = Lane::default();
    let lease = lane.claim(&Attempts::default(), Duration::ZERO).unwrap();
    let constructed = Arc::new(AtomicBool::new(false));
    let c = constructed.clone();
    let mut wrapper = std::pin::pin!(lane.launch(lease, move || {
        c.store(true, SeqCst);
        std::future::pending::<()>()
    }));
    // Single-thread Tokio: poll only the wrapper through spawn/handle registration.
    std::future::poll_fn(|cx| {
        assert!(wrapper.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    lane.abort();
    lane.idle().await;
    wrapper.await;
    assert!(!constructed.load(SeqCst));
}

/// Exercises the process guard against the real warning lane and actual spawned futures.
struct HeldSource {
    lane: Lane,
    attempts: Attempts,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
    destroyed: Arc<AtomicBool>,
}
impl Acquisition for HeldSource {
    fn cycle(&self, _: Instant) -> BoxFuture<'_, ()> {
        Box::pin(async {
            if let Some(lease) = self.lane.claim(&self.attempts, Duration::ZERO) {
                let release = self.release.clone();
                let destroyed = self.destroyed.clone();
                let entered = self.entered.clone();
                self.lane
                    .launch(lease, move || async move {
                        let _destroyed = Destroyed(destroyed);
                        entered.notify_one();
                        release.notified().await;
                    })
                    .await;
            }
        })
    }
    fn next_delay(&self) -> Duration {
        Duration::from_secs(180)
    }
    fn idle(&self) -> BoxFuture<'_, ()> {
        Box::pin(self.lane.idle())
    }
    fn close(&self) {
        self.lane.close();
    }
    fn abort(&self) {
        self.lane.abort();
    }
}
fn held_source() -> Arc<HeldSource> {
    Arc::new(HeldSource {
        lane: Lane::default(),
        attempts: Attempts::default(),
        entered: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Notify::new()),
        destroyed: Arc::new(AtomicBool::new(false)),
    })
}
#[tokio::test]
async fn process_guard_drop_cancels_actual_inner_after_driver_cancellation() {
    use crate::warnings::acquisition_worker::Owner;
    let source = held_source();
    let mut owner = Owner::new(source.clone());
    assert!(!source.lane.0.borrow().running, "constructor is inert");
    owner.start();
    source.entered.notified().await;
    // Ensure the inner future has begun, rather than observing only reservation.
    tokio::task::yield_now().await;
    drop(owner);
    tokio::time::timeout(Duration::from_secs(1), source.idle())
        .await
        .unwrap();
    assert!(source.destroyed.load(SeqCst));
}
#[tokio::test]
async fn cancelled_drain_future_is_not_a_join_and_explicit_abort_still_reaches_inner() {
    use crate::warnings::acquisition_worker::Owner;
    let source = held_source();
    let mut owner = Owner::new(source.clone());
    owner.start();
    source.entered.notified().await;
    tokio::task::yield_now().await;
    owner.quiesce();
    assert!(
        tokio::time::timeout(
            Duration::from_millis(5),
            owner.drain(Instant::now() + Duration::from_secs(1))
        )
        .await
        .is_err()
    );
    assert!(!source.destroyed.load(SeqCst));
    owner.abort();
    tokio::time::timeout(Duration::from_secs(1), source.idle())
        .await
        .unwrap();
    assert!(source.destroyed.load(SeqCst));
}
#[tokio::test]
async fn graceful_source_drain_waits_for_actual_future_destruction() {
    use crate::warnings::acquisition_worker::Owner;
    let source = held_source();
    let mut owner = Owner::new(source.clone());
    owner.start();
    source.entered.notified().await;
    tokio::task::yield_now().await;
    owner.quiesce();
    source.release.notify_one();
    assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
    assert!(source.destroyed.load(SeqCst));
    assert!(
        source
            .lane
            .claim(&source.attempts, Duration::ZERO)
            .is_none()
    );
}

#[derive(Clone)]
struct NoIo;
impl crate::storage::ObjectTransport for NoIo {
    async fn put(&self, _: &crate::storage::PreparedRecord) -> Result<u16, crate::storage::Error> {
        panic!("unexpected storage write")
    }
    async fn head(&self, _: &str) -> Result<crate::storage::Object, crate::storage::Error> {
        panic!("unexpected storage read")
    }
    async fn get(
        &self,
        _: &str,
        _: usize,
    ) -> Result<crate::storage::Object, crate::storage::Error> {
        panic!("unexpected storage read")
    }
}
impl crate::storage::CatalogTransport for NoIo {
    async fn get_control(
        &self,
        _: &str,
        _: usize,
    ) -> Result<crate::storage::ControlObject, crate::storage::Error> {
        panic!("unexpected control read")
    }
    async fn put_control(
        &self,
        _: &str,
        _: &[u8],
        _: &crate::storage::WriteCondition,
    ) -> Result<u16, crate::storage::Error> {
        panic!("unexpected control write")
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, crate::storage::Error> {
        panic!("unexpected raw list")
    }
}
impl IndexListing for NoIo {
    async fn list_index(
        &self,
        _: &str,
        _: Option<&str>,
    ) -> Result<crate::storage::ListPage, crate::storage::Error> {
        panic!("unexpected index list")
    }
}
struct CountErrors(Arc<std::sync::atomic::AtomicUsize>);
impl fetch::ForecastAcquire for CountErrors {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        assert_eq!(request, fetch::ForecastRequest::Warnings);
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err("unit provider error; memo remains authoritative".into()) })
    }
}
fn cycles(
    period: Duration,
    clock: Clock,
    pool: OwnedFlights<String, Option<Fetched>>,
) -> (
    Arc<WarningCycles<NoIo>>,
    Arc<std::sync::atomic::AtomicUsize>,
) {
    use crate::warnings::{
        service::ServiceConfig,
        store::{StoreConfig, WarningStore},
    };
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let store = Arc::new(
        WarningStore::new(
            NoIo,
            crate::storage::CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let warnings = Arc::new(WarningService::new(
        store,
        Arc::new(crate::budget::SystemClock),
        ServiceConfig::default(),
    ));
    let mut cycles = WarningCycles::new(
        pool,
        Arc::new(Attempts::default()),
        warnings,
        clock,
        Arc::new(CountErrors(count.clone())),
    );
    // Private real-time test injection only. Production keeps WARNING_CYCLE180s.
    cycles.period = period;
    (Arc::new(cycles), count)
}
async fn calls_by(count: &std::sync::atomic::AtomicUsize, n: usize, deadline: Instant) {
    tokio::time::timeout_at(deadline, async {
        while count.load(SeqCst) < n {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("expected cycle within its actual anchored wake");
}
#[tokio::test]
async fn a_request_memo_anchors_the_actual_driver_wake_instead_of_a_full_interval() {
    use crate::warnings::acquisition_worker::Owner;
    let clock_began = std::time::Instant::now();
    let (cycles, calls) = cycles(
        Duration::from_millis(1200),
        Arc::new(move || clock_began.elapsed().as_millis() as f64),
        OwnedFlights::new(Default::default()).unwrap(),
    );
    cycles.cycle(Instant::now() + Duration::from_secs(1)).await;
    assert_eq!(calls.load(SeqCst), 1, "request owns the first admission");
    tokio::time::sleep(Duration::from_millis(800)).await;
    let delay = cycles.next_delay();
    assert!(
        !delay.is_zero() && delay < Duration::from_millis(600),
        "remaining memo, not1200ms: {delay:?}"
    );
    let mut owner = Owner::new(cycles.clone());
    let start = Instant::now();
    owner.start();
    // Fixed sleep(period) after the initial retained result cannot meet this deadline.
    calls_by(&calls, 2, start + Duration::from_millis(800)).await;
    owner.quiesce();
    assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
    assert_eq!(calls.load(SeqCst), 2);
}
#[tokio::test]
async fn busy_shared_pool_waits_three_seconds_without_claiming_memo_or_calling_provider() {
    use crate::{resolver::OwnedConfig, warnings::acquisition_worker::Owner};
    let pool = OwnedFlights::new(OwnedConfig {
        running: 1,
        entries: 2,
        ..Default::default()
    })
    .unwrap();
    let held = pool.clone();
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let other = tokio::spawn(async move {
        held.wait(
            "other".into(),
            Duration::from_secs(10),
            move |_| async move {
                let _ = entered.send(());
                let _ = released.await;
                None
            },
        )
        .await
    });
    ready.await.unwrap();
    let (cycles, calls) = cycles(Duration::from_secs(1), Arc::new(|| 0.), pool);
    assert_eq!(cycles.next_delay(), Duration::from_secs(3));
    let mut owner = Owner::new(cycles.clone());
    let start = Instant::now();
    owner.start();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(calls.load(SeqCst), 0);
    assert!(
        cycles.attempts.state.lock().unwrap().0.is_empty(),
        "Busy never claims Attempts"
    );
    release.send(()).unwrap();
    other.await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        calls.load(SeqCst),
        0,
        "capacity recovery cannot bypass fallback"
    );
    calls_by(&calls, 1, start + Duration::from_millis(3800)).await;
    assert!(start.elapsed() >= Duration::from_millis(2800));
    owner.quiesce();
    assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
    assert_eq!(calls.load(SeqCst), 1);
}
#[tokio::test]
async fn retained_flight_waits_three_seconds_without_reclaiming_an_expired_memo() {
    use crate::warnings::acquisition_worker::Owner;
    let (cycles, calls) = cycles(
        Duration::from_millis(100),
        Arc::new(|| 0.),
        OwnedFlights::new(Default::default()).unwrap(),
    );
    cycles.cycle(Instant::now() + Duration::from_secs(1)).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(cycles.attempts.remaining("warnings").is_zero());
    let stamp = cycles.attempts.state.lock().unwrap().0["warnings"];
    let mut owner = Owner::new(cycles.clone());
    let start = Instant::now();
    owner.start();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(calls.load(SeqCst), 1);
    assert_eq!(
        cycles.attempts.state.lock().unwrap().0["warnings"],
        stamp,
        "retained result never claims Attempts"
    );
    calls_by(&calls, 2, start + Duration::from_millis(3800)).await;
    assert!(start.elapsed() >= Duration::from_millis(2800));
    owner.quiesce();
    assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
    assert_eq!(calls.load(SeqCst), 2);
}
