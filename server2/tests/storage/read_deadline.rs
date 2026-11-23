//! KMA-NATION-READS: a store with an 8 s `read_deadline` (the observed KMA source's) keeps a
//! read the request waits on up to the request's deadline, so a read queued behind other readers'
//! admissions is late rather than failed after the 3 s per-operation cap that writes and the
//! default stores keep. The SR-6 rehearsal answered the nation route with HTTP 500 in 23 of 24
//! samples when the fifteen city reads queued past 3 s.
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error, Object,
    ObjectTransport, PreparedRecord, WriteCondition,
};
use std::{sync::Arc, time::Duration};
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

fn observed() -> CatalogLimits {
    CatalogLimits {
        read_deadline: Duration::from_secs(8),
        ..CatalogLimits::default()
    }
}

async fn lookup_with(
    limits: CatalogLimits,
    delay: Duration,
    budget: Duration,
) -> Result<(), Error> {
    let store = CatalogStore::new(Slow(delay), limits).unwrap();
    store
        .lookup(&id(), Instant::now() + budget)
        .await
        .map(|_| ())
}

async fn lookup(delay: Duration, budget: Duration) -> Result<(), Error> {
    lookup_with(observed(), delay, budget).await
}

#[tokio::test(start_paused = true)]
async fn a_read_slower_than_three_seconds_answers_within_the_request_deadline() {
    // Before KMA-NATION-READS the per-operation cap ended this read at 3 s.
    assert!(
        lookup(Duration::from_secs(4), Duration::from_secs(8))
            .await
            .is_ok()
    );
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
    assert_eq!(start.elapsed(), Duration::from_secs(8));
}

#[tokio::test(start_paused = true)]
async fn default_stores_keep_the_three_second_read_cap() {
    let start = Instant::now();
    assert!(matches!(
        lookup_with(
            CatalogLimits::default(),
            Duration::from_secs(4),
            Duration::from_secs(8)
        )
        .await,
        Err(Error::Timeout)
    ));
    assert_eq!(start.elapsed(), Duration::from_secs(3));
}

#[test]
fn read_deadline_defaults_to_the_operation_cap_and_is_bounded() {
    let limits = CatalogLimits::default();
    assert_eq!(limits.read_deadline, limits.deadline);
    assert_eq!(limits.deadline, Duration::from_secs(3));
    assert!(limits.validate().is_ok() && observed().validate().is_ok());
    for read_deadline in [Duration::ZERO, Duration::from_secs(10)] {
        let bad = CatalogLimits {
            read_deadline,
            ..CatalogLimits::default()
        };
        assert!(bad.validate().is_err());
    }
}

#[tokio::test(start_paused = true)]
async fn a_read_queued_behind_another_completes_within_the_request_deadline() {
    // One admission: the second lookup waits for the first, as nation cities do for the store.
    let started = Instant::now();
    lookup(Duration::from_secs(1), Duration::from_secs(8))
        .await
        .unwrap();
    let operations = started.elapsed().as_secs();
    assert!(operations >= 1);
    // Each lookup alone takes 2 s; queued behind another it ends at 4 s.
    let delay = Duration::from_millis(2000 / operations);
    for (read_deadline, queued_completes) in [
        (Duration::from_secs(8), true),
        (Duration::from_secs(3), false),
    ] {
        let limits = CatalogLimits {
            io: 1,
            read_deadline,
            ..CatalogLimits::default()
        };
        let store = Arc::new(CatalogStore::new(Slow(delay), limits).unwrap());
        let start = Instant::now();
        let first = {
            let store = store.clone();
            tokio::spawn(async move {
                store
                    .lookup(&id(), Instant::now() + Duration::from_secs(8))
                    .await
                    .map(|_| ())
            })
        };
        tokio::task::yield_now().await;
        let queued = store
            .lookup(&id(), Instant::now() + Duration::from_secs(8))
            .await
            .map(|_| ());
        let elapsed = start.elapsed();
        assert!(first.await.unwrap().is_ok());
        if queued_completes {
            assert!(queued.is_ok());
            assert_eq!(elapsed, Duration::from_secs(4));
        } else {
            assert!(matches!(queued, Err(Error::Timeout)));
            assert_eq!(elapsed, Duration::from_secs(3));
        }
    }
}
