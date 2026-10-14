//! S13d (#2747) shared owned acquisitions: one owned task per key (a grid publication or a
//! national dataset and publication time), request waiters bounded at 3 s or the attempt
//! deadline, and the outcome reused by later requests.
use server2::resolver::{OwnedConfig, OwnedFlights, WAITER_BOUND, Waited};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

type Key = (&'static str, &'static str);
/// AirKorea station observations for the whole country, one publication hour.
const NATIONAL: Key = ("airkorea-station", "2026101410");

fn flights(retain: Duration) -> OwnedFlights<Key, u32> {
    OwnedFlights::new(OwnedConfig {
        running: 4,
        entries: 64,
        retain,
    })
    .unwrap()
}
async fn provider(calls: Arc<AtomicUsize>, delay: Duration) -> u32 {
    calls.fetch_add(1, Ordering::SeqCst);
    tokio::time::sleep(delay).await;
    42
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn many_cells_wait_on_one_slow_national_acquisition() {
    let flights = flights(Duration::from_secs(2));
    let calls = Arc::new(AtomicUsize::new(0));
    let started = Instant::now();
    // 50 requests for different cells, each with a later attempt deadline than the bound.
    let waiters: Vec<_> = (0..50)
        .map(|_| {
            let flights = flights.clone();
            let calls = calls.clone();
            tokio::spawn(async move {
                flights
                    .join(
                        NATIONAL,
                        Instant::now() + Duration::from_secs(9),
                        Duration::from_secs(13),
                        move |_| provider(calls, Duration::from_secs(4)),
                    )
                    .await
            })
        })
        .collect();
    for w in waiters {
        assert!(matches!(w.await.unwrap(), Waited::Pending { .. }));
    }
    let waited = started.elapsed();
    assert!(
        waited >= WAITER_BOUND - Duration::from_millis(100)
            && waited < WAITER_BOUND + Duration::from_millis(500),
        "{waited:?}"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1, "one owned acquisition");
    // The owned task survives every waiter and finishes.
    tokio::time::timeout(Duration::from_secs(3), async {
        while flights.running() != 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    // A later request inside the retention window uses the outcome without a provider call.
    let later = flights
        .join(
            NATIONAL,
            Instant::now() + Duration::from_secs(3),
            Duration::from_secs(13),
            |_| async { unreachable!("retained outcome must be reused") },
        )
        .await;
    assert_eq!(later, Waited::Ready(42));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let m = flights.metrics();
    assert_eq!((m.started, m.joined, m.pending), (1, 50, 50));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fast_national_acquisition_is_ready_for_every_waiter() {
    let flights = flights(Duration::from_secs(2));
    let calls = Arc::new(AtomicUsize::new(0));
    let waiters: Vec<_> = (0..20)
        .map(|_| {
            let flights = flights.clone();
            let calls = calls.clone();
            tokio::spawn(async move {
                flights
                    .join(
                        NATIONAL,
                        Instant::now() + Duration::from_secs(3),
                        Duration::from_secs(13),
                        move |_| provider(calls, Duration::from_millis(200)),
                    )
                    .await
            })
        })
        .collect();
    for w in waiters {
        assert_eq!(w.await.unwrap(), Waited::Ready(42));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_shorter_attempt_deadline_bounds_the_waiter_and_keys_stay_separate() {
    let flights = flights(Duration::ZERO);
    let calls = Arc::new(AtomicUsize::new(0));
    let started = Instant::now();
    let c = calls.clone();
    let first = flights
        .join(
            NATIONAL,
            Instant::now() + Duration::from_millis(400),
            Duration::from_secs(5),
            move |_| provider(c, Duration::from_secs(1)),
        )
        .await;
    assert!(matches!(first, Waited::Pending { .. }));
    assert!(started.elapsed() < Duration::from_millis(800));
    // Another publication hour is another owned acquisition.
    let c = calls.clone();
    let other = flights
        .join(
            ("airkorea-station", "2026101411"),
            Instant::now() + Duration::from_secs(3),
            Duration::from_secs(5),
            move |_| provider(c, Duration::from_millis(50)),
        )
        .await;
    assert_eq!(other, Waited::Ready(42));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    // The first owned task still completes; with no retention the next request starts anew.
    let c = calls.clone();
    let resumed = flights
        .join(
            NATIONAL,
            Instant::now() + Duration::from_secs(3),
            Duration::from_secs(5),
            move |_| provider(c, Duration::from_millis(50)),
        )
        .await;
    assert_eq!(resumed, Waited::Ready(42), "joined the running task");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn owner_deadline_capacity_and_panics_are_bounded() {
    let flights = flights(Duration::from_secs(1));
    // The owned task ends at its own deadline; the waiter learns it expired.
    let expired = flights
        .wait(
            NATIONAL,
            Instant::now() + Duration::from_secs(2),
            Duration::from_millis(100),
            |_| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                1
            },
        )
        .await;
    assert_eq!(expired, Waited::Expired);
    // Running capacity is bounded; a new key beyond it starts nothing.
    let full = flights.clone();
    for i in 0..4u8 {
        let key: Key = ("grid", ["a", "b", "c", "d"][usize::from(i)]);
        let _ = full
            .join(
                key,
                Instant::now() + Duration::from_millis(10),
                Duration::from_secs(2),
                |_| async {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    1
                },
            )
            .await;
    }
    let busy = flights
        .join(
            ("grid", "e"),
            Instant::now() + Duration::from_secs(1),
            Duration::from_secs(2),
            |_| async { 1 },
        )
        .await;
    assert_eq!(busy, Waited::Busy);
    // A panicking owned task never blocks its key.
    let panicked = flights.clone();
    tokio::time::sleep(Duration::from_millis(1_200)).await;
    let first = panicked
        .join(
            ("grid", "p"),
            Instant::now() + Duration::from_secs(1),
            Duration::from_secs(2),
            |_| async { panic!("owned task failure") },
        )
        .await;
    assert_eq!(first, Waited::Failed);
    let again = panicked
        .join(
            ("grid", "p"),
            Instant::now() + Duration::from_secs(1),
            Duration::from_secs(2),
            |_| async { 7 },
        )
        .await;
    assert_eq!(again, Waited::Ready(7));
}
