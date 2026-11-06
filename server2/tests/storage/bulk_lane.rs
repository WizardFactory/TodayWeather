//! KMA-RESTART-READS: the bulk lane of the shared S3 admission. Warning work (collector, zone
//! replay, publications and the persisted feed) holds at most a third of the permits, so request
//! reads after a restart are admitted while it runs.
use rusty_s3::Credentials;
use server2::storage::{Error, HttpS3Transport, Object, ObjectTransport, PreparedRecord};
use server2::world::BoundedS3;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering::SeqCst},
};
use std::time::Duration;
use tokio::sync::Notify;

/// Counts the reads inside the transport and holds every `hold/` read until released.
#[derive(Default)]
struct Gauge {
    inside: AtomicUsize,
    peak: AtomicUsize,
    release: Notify,
}
struct Held(Arc<Gauge>);
impl ObjectTransport for Held {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Ok(200)
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, key: &str, _: usize) -> Result<Object, Error> {
        if key.starts_with("hold/") {
            let n = self.0.inside.fetch_add(1, SeqCst) + 1;
            self.0.peak.fetch_max(n, SeqCst);
            self.0.release.notified().await;
            self.0.inside.fetch_sub(1, SeqCst);
        }
        Err(Error::NotFound)
    }
}

async fn until(what: &str, check: impl Fn() -> bool) {
    let end = tokio::time::Instant::now() + Duration::from_secs(5);
    while !check() {
        assert!(tokio::time::Instant::now() < end, "never: {what}");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bulk_work_holds_a_third_and_request_reads_are_admitted() {
    let gauge = Arc::new(Gauge::default());
    let s3 = BoundedS3::new(Held(gauge.clone()), 12);
    assert_eq!(s3.lane_limit(), 4);
    let bulk = s3.bulk();
    assert!(bulk.is_bulk() && !s3.is_bulk());
    // Ten bulk reads, half of them through a bulk view of a bulk view: one lane.
    let mut held = Vec::new();
    for i in 0..10 {
        let view = if i % 2 == 0 {
            bulk.clone()
        } else {
            bulk.bulk()
        };
        held.push(tokio::spawn(async move {
            let _ = view.get(&format!("hold/{i}"), 16).await;
        }));
    }
    until("four bulk reads inside", || gauge.inside.load(SeqCst) == 4).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gauge.peak.load(SeqCst), 4, "bulk work beyond the lane");
    // The six waiting bulk reads hold no shared permit.
    assert_eq!(s3.available(), 8);
    assert_eq!(s3.lane_available(), 0);
    // A request read is admitted while the lane is full.
    let read = tokio::time::timeout(Duration::from_millis(200), s3.get("answer", 16)).await;
    assert!(
        matches!(read, Ok(Err(Error::NotFound))),
        "request read not admitted"
    );
    // Eight request reads at once still fit beside the bulk work.
    let gauge2 = gauge.clone();
    let many: Vec<_> = (0..8)
        .map(|i| {
            let s3 = s3.clone();
            tokio::spawn(async move { s3.get(&format!("answer/{i}"), 16).await })
        })
        .collect();
    for task in many {
        let out = tokio::time::timeout(Duration::from_millis(500), task).await;
        assert!(matches!(out, Ok(Ok(Err(Error::NotFound)))));
    }
    // Release the bulk work; every bulk read finishes.
    while held.iter().any(|t| !t.is_finished()) {
        gauge2.release.notify_waiters();
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(gauge.peak.load(SeqCst), 4);
    assert_eq!(s3.available(), 12);
    assert_eq!(s3.lane_available(), 4);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn without_the_lane_bulk_work_takes_every_permit() {
    // The starvation the lane removes: twelve request-path reads held fill the admission.
    let gauge = Arc::new(Gauge::default());
    let s3 = BoundedS3::new(Held(gauge.clone()), 12);
    let mut held = Vec::new();
    for i in 0..12 {
        let s3 = s3.clone();
        held.push(tokio::spawn(async move {
            let _ = s3.get(&format!("hold/{i}"), 16).await;
        }));
    }
    until("twelve reads inside", || gauge.inside.load(SeqCst) == 12).await;
    let read = tokio::time::timeout(Duration::from_millis(100), s3.get("answer", 16)).await;
    assert!(read.is_err(), "a thirteenth read must wait for a permit");
    while held.iter().any(|t| !t.is_finished()) {
        gauge.release.notify_waiters();
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[test]
fn small_admissions_keep_one_bulk_permit() {
    let gauge = Arc::new(Gauge::default());
    assert_eq!(BoundedS3::new(Held(gauge.clone()), 1).lane_limit(), 1);
    assert_eq!(BoundedS3::new(Held(gauge.clone()), 2).lane_limit(), 1);
    assert_eq!(BoundedS3::new(Held(gauge), 16).lane_limit(), 5);
}

#[test]
fn the_process_warning_store_and_feed_use_the_bulk_lane() {
    let transport = HttpS3Transport::new(
        "http://127.0.0.1:9/",
        "server2-local",
        "ap-northeast-2",
        Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap();
    let s3 = BoundedS3::new(transport, 12);
    let store = server2::gateway::runtime::warning_store(&s3).unwrap();
    assert!(store.transport().is_bulk(), "warning store off the lane");
    let feed = server2::gateway::runtime::warning_feed(&s3);
    assert!(feed.transport().is_bulk(), "warning feed off the lane");
    // The caller's view stays a request view.
    assert!(!s3.is_bulk());
}
