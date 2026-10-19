//! B3 request-time policy: real owned S3 reads with a synthetic publication clock.
use super::source_s3::{Peer, S3_PEERS, Unreachable, deadline};
use server2::{
    domestic::{
        family::DataGoKrFamily,
        kma::source::{
            Family, S3Source,
            fetch::{ForecastAcquire, ForecastRequest, Published},
        },
        publication::{self, Publication},
    },
    gateway::BoxFuture,
    history::{Grid, schedule},
    storage::HttpS3Transport,
    world::BoundedS3,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, Ordering::SeqCst},
};

const MINUTE: i64 = 60_000;
struct Missing {
    clock: Arc<AtomicI64>,
    latest: Mutex<Vec<i64>>,
    all: Mutex<Vec<(i64, Publication)>>,
}
impl ForecastAcquire for Missing {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        if let ForecastRequest::DataGoKr(r) = request {
            let now = self.clock.load(SeqCst);
            if r.family() == DataGoKrFamily::VilageFcst {
                self.all.lock().unwrap().push((now, r.publication()));
            }
            if r.family() == DataGoKrFamily::VilageFcst
                && Some(r.publication()) == publication::short_base(now)
            {
                self.latest.lock().unwrap().push(now);
            }
        }
        Box::pin(async { Ok(None) })
    }
}
struct Fixture {
    _peer: Peer,
    source: S3Source<BoundedS3<HttpS3Transport>>,
    provider: Arc<Missing>,
    clock: Arc<AtomicI64>,
    base: i64,
}
impl Fixture {
    fn new() -> Self {
        let peer = Peer::new();
        let base = schedule::to_ms(Publication::new(20261018, 200).unwrap());
        let clock = Arc::new(AtomicI64::new(base));
        let provider = Arc::new(Missing {
            clock: clock.clone(),
            latest: Mutex::new(Vec::new()),
            all: Mutex::new(Vec::new()),
        });
        let read = clock.clone();
        let source = S3Source::new(
            peer.transport(),
            Arc::new(move || read.load(SeqCst) as f64),
            Arc::new(Unreachable),
            Arc::new(Unreachable),
        )
        .unwrap()
        .with_forecast(Some(provider.clone()));
        Self {
            _peer: peer,
            source,
            provider,
            clock,
            base,
        }
    }
    async fn request(&self, minute_after_base: i64) {
        let now = self.base + minute_after_base * MINUTE;
        self.clock.store(now, SeqCst);
        self.source
            .grid_answer(
                Family::Short,
                Grid::new(60, 127).unwrap(),
                now as f64,
                deadline(),
            )
            .await
            .unwrap();
    }
    fn minutes(&self) -> Vec<i64> {
        self.provider
            .latest
            .lock()
            .unwrap()
            .iter()
            .map(|n| (n - self.base) / MINUTE)
            .collect()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_waits_until_provision_plus_two_minutes() {
    let _guard = S3_PEERS.lock().await;
    let f = Fixture::new();
    f.request(10).await;
    f.request(11).await;
    assert_eq!(f.minutes(), Vec::<i64>::new(), "no acquisition before HH12");
    // Existing owned completed results stay cached for three real seconds.
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    f.request(12).await;
    assert_eq!(f.minutes(), vec![12]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_minute_demand_uses_three_slots_then_stops() {
    let _guard = S3_PEERS.lock().await;
    let f = Fixture::new();
    // Synthetic request time, not three hours of elapsed wall time. Real source
    // calls and S3 peer operations still run for every minute.
    for minute in 12..190 {
        // Expire the unchanged real-time owned-result cache at each later
        // synthetic slot; do not alter production retention for this test.
        if matches!(minute, 15 | 20) {
            tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
        }
        f.request(minute).await;
    }
    // After the existing completed-result cache expires, the finite gate
    // must still refuse a fourth latest attempt in the final window.
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    f.request(189).await;
    assert_eq!(
        f.minutes(),
        vec![12, 15, 20],
        "one unavailable latest publication"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_late_first_demand_does_not_replay_missed_slots() {
    let _guard = S3_PEERS.lock().await;
    let f = Fixture::new();
    for minute in [40, 41, 60, 100, 189] {
        f.request(minute).await;
    }
    assert_eq!(f.minutes(), vec![40]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_usable_stored_data_needs_no_new_acquisition() {
    let _guard = S3_PEERS.lock().await;
    let f = Fixture::new();
    let store = server2::storage::CatalogStore::new(
        f._peer.transport(),
        server2::storage::CatalogLimits::default(),
    )
    .unwrap();
    super::source_s3::seed(&store, &["current", "shortest", "rss", "mid", "zone"]).await;
    let now = super::source_s3::NOW;
    f.clock.store(now as i64, SeqCst);
    let docs = f
        .source
        .grid_answer(Family::Short, Grid::new(60, 127).unwrap(), now, deadline())
        .await
        .unwrap();
    assert!(!docs.is_empty());
    assert!(f.minutes().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_new_base_preserves_recent_failure_backfill_guard() {
    let _guard = S3_PEERS.lock().await;
    let f = Fixture::new();
    f.request(20).await;
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    f.request(192).await; // Next Short base 05:00, provision+2 at 05:12.
    assert_eq!(f.minutes(), vec![20, 192]);
    let old = Publication::new(20261018, 200).unwrap();
    // Match the existing backfill tests' bounded owner-settlement wait. The
    // provider double completes immediately; all historical keys except this
    // previous latest already carry their original five-minute memo.
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    assert_eq!(
        f.provider
            .all
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p)| *p == old)
            .count(),
        1,
        "the existing real-time five-minute memo still protects a recent latest failure"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn latest_short_cancelled_waiter_does_not_cancel_shared_owner() {
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    struct Blocking {
        calls: AtomicUsize,
        started: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
        completed: Arc<AtomicBool>,
    }
    impl ForecastAcquire for Blocking {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> BoxFuture<'static, Result<Published, String>> {
            let ForecastRequest::DataGoKr(r) = request else {
                return Box::pin(async { Ok(None) });
            };
            if r.family() != DataGoKrFamily::VilageFcst
                || r.publication() != Publication::new(20261018, 200).unwrap()
            {
                return Box::pin(async { Ok(None) });
            }
            self.calls.fetch_add(1, SeqCst);
            self.started.notify_one();
            let release = self.release.clone();
            let done = self.completed.clone();
            Box::pin(async move {
                release.notified().await;
                done.store(true, SeqCst);
                Ok(None)
            })
        }
    }
    let _guard = S3_PEERS.lock().await;
    let peer = Peer::new();
    let now = schedule::to_ms(Publication::new(20261018, 212).unwrap());
    let provider = Arc::new(Blocking {
        calls: AtomicUsize::new(0),
        started: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Notify::new()),
        completed: Arc::new(AtomicBool::new(false)),
    });
    let source = Arc::new(
        S3Source::new(
            peer.transport(),
            Arc::new(move || now as f64),
            Arc::new(Unreachable),
            Arc::new(Unreachable),
        )
        .unwrap()
        .with_forecast(Some(provider.clone())),
    );
    let first = source.clone();
    let waiter = tokio::spawn(async move {
        first
            .grid_answer(
                Family::Short,
                Grid::new(60, 127).unwrap(),
                now as f64,
                deadline(),
            )
            .await
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        provider.started.notified(),
    )
    .await
    .unwrap();
    waiter.abort();
    assert!(waiter.await.unwrap_err().is_cancelled());
    let second = source.clone();
    let joined = tokio::spawn(async move {
        second
            .grid_answer(
                Family::Short,
                Grid::new(60, 127).unwrap(),
                now as f64,
                deadline(),
            )
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    provider.release.notify_one();
    joined.await.unwrap().unwrap();
    assert_eq!(provider.calls.load(SeqCst), 1);
    assert!(
        provider.completed.load(SeqCst),
        "owned acquisition survived cancelled waiter"
    );
}
