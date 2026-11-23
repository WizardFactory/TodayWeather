//! KMA-NATION-READS: a catalog read the request waits on keeps the request's deadline up to
//! `read_deadline` (8 s), so a read queued behind other readers' admissions is late rather than
//! failed after the 3 s per-operation cap that writes keep. The SR-6 rehearsal answered the
//! nation route with HTTP 500 in 23 of 24 samples when the fifteen city reads queued past 3 s.
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error, Object,
    ObjectTransport, PreparedRecord, WriteCondition,
};
use std::time::Duration;
use tokio::time::Instant;

/// Every control read takes `delay` and finds nothing.
struct Slow(Duration);
impl ObjectTransport for Slow {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Ok(200)
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        tokio::time::sleep(self.0).await;
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Slow {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        tokio::time::sleep(self.0).await;
        Err(Error::NotFound)
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        tokio::time::sleep(self.0).await;
        Ok(Vec::new())
    }
}

fn id() -> CatalogId {
    CatalogId {
        source: "kma".into(),
        kind: "vilage-fcst".into(),
        key_sha256: "a".repeat(64),
        partition: "20261121".into(),
    }
}

async fn lookup(delay: Duration, budget: Duration) -> Result<(), Error> {
    let store = CatalogStore::new(Slow(delay), CatalogLimits::default()).unwrap();
    store
        .lookup(&id(), Instant::now() + budget)
        .await
        .map(|_| ())
}

#[tokio::test(start_paused = true)]
async fn a_read_slower_than_three_seconds_answers_within_the_request_deadline() {
    // Before KMA-NATION-READS the per-operation cap ended this read at 3 s.
    assert!(!matches!(
        lookup(Duration::from_secs(4), Duration::from_secs(8)).await,
        Err(Error::Timeout)
    ));
}

#[tokio::test(start_paused = true)]
async fn the_request_deadline_still_ends_a_read() {
    let start = Instant::now();
    assert!(matches!(
        lookup(Duration::from_secs(4), Duration::from_millis(3500)).await,
        Err(Error::Timeout)
    ));
    assert_eq!(start.elapsed(), Duration::from_millis(3500));
}

#[tokio::test(start_paused = true)]
async fn a_long_caller_deadline_is_capped_at_the_read_deadline() {
    let start = Instant::now();
    assert!(matches!(
        lookup(Duration::from_secs(20), Duration::from_secs(60)).await,
        Err(Error::Timeout)
    ));
    assert_eq!(start.elapsed(), CatalogLimits::default().read_deadline);
}

#[test]
fn read_deadline_defaults_to_eight_seconds_and_is_bounded() {
    let limits = CatalogLimits::default();
    assert_eq!(limits.read_deadline, Duration::from_secs(8));
    assert_eq!(limits.deadline, Duration::from_secs(3));
    assert!(limits.validate().is_ok());
    for read_deadline in [Duration::ZERO, Duration::from_secs(10)] {
        let bad = CatalogLimits {
            read_deadline,
            ..CatalogLimits::default()
        };
        assert!(bad.validate().is_err());
    }
}
