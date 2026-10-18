//! Public narrative service: failed reads differ from confirmed absence.
use server2::{
    gateway::BoxFuture,
    history::IndexListing,
    narrative::{
        OFFICES, Read,
        provider::{Page, Source},
        store::Service,
    },
    providers::AcquisitionError,
    storage::{
        CatalogTransport, ControlObject, Error, ListPage, Object, ObjectTransport, PreparedRecord,
        WriteCondition,
    },
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::time::Instant;

#[derive(Clone, Copy)]
enum First {
    Timeout,
    Transport,
    Corrupt,
    Capacity,
    Slow,
    Empty,
}
#[derive(Clone)]
struct Storage {
    calls: Arc<AtomicUsize>,
    first: First,
}
impl ObjectTransport for Storage {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        panic!("read-only fixture")
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        panic!("empty index needs no raw read")
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        panic!("empty index needs no raw read")
    }
}
impl CatalogTransport for Storage {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        panic!("empty index needs no catalog")
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        panic!("read-only fixture")
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        panic!("narrative uses the declared index")
    }
}
impl IndexListing for Storage {
    async fn list_index(&self, _: &str, _: Option<&str>) -> Result<ListPage, Error> {
        if self.calls.fetch_add(1, SeqCst) == 0 {
            match self.first {
                First::Timeout => return Err(Error::Timeout),
                First::Transport => return Err(Error::Transport),
                First::Corrupt => return Err(Error::Corrupt("owned malformed index")),
                First::Capacity => return Err(Error::Capacity),
                First::Slow => tokio::time::sleep(Duration::from_secs(1)).await,
                First::Empty => {}
            }
        }
        Ok(ListPage {
            keys: vec![],
            next: None,
        })
    }
}
struct NoProvider;
impl Source for NoProvider {
    fn fetch(&self, _: u16, _: Instant) -> BoxFuture<'_, Result<Option<Page>, AcquisitionError>> {
        Box::pin(async { panic!("stored read must not acquire providers") })
    }
}
fn fixture(first: First) -> (Service<Storage>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    (
        Service::new(
            Storage {
                calls: calls.clone(),
                first,
            },
            Arc::new(NoProvider),
        )
        .unwrap(),
        calls,
    )
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(2)
}

#[tokio::test]
async fn failed_reads_do_not_cache_absence_for_the_next_request() {
    for first in [
        First::Timeout,
        First::Transport,
        First::Corrupt,
        First::Capacity,
    ] {
        let (service, calls) = fixture(first);
        assert!(service.read(108, deadline()).await.is_none());
        assert_eq!(calls.load(SeqCst), 1);
        assert!(service.read(108, deadline()).await.is_none());
        assert_eq!(
            calls.load(SeqCst),
            3,
            "retry must inspect both date indexes, not cached failure"
        );
        assert!(service.read(108, deadline()).await.is_none());
        assert_eq!(calls.load(SeqCst), 3, "confirmed absence still caches");
    }
}
#[tokio::test]
async fn a_deadline_expired_read_does_not_poison_the_next_request() {
    let (service, calls) = fixture(First::Slow);
    assert!(
        service
            .read(108, Instant::now() + Duration::from_millis(10))
            .await
            .is_none()
    );
    assert_eq!(calls.load(SeqCst), 1);
    assert!(service.read(108, deadline()).await.is_none());
    assert_eq!(
        calls.load(SeqCst),
        3,
        "new request retries immediately after the timed-out read"
    );
}
#[tokio::test(start_paused = true)]
async fn confirmed_absence_keeps_office_isolation_and_thirty_second_expiry() {
    let (service, calls) = fixture(First::Empty);
    service.read(OFFICES[0].0, deadline()).await;
    service.read(OFFICES[0].0, deadline()).await;
    assert_eq!(calls.load(SeqCst), 2);
    service.read(OFFICES[1].0, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        4,
        "another office has independent cache state"
    );
    tokio::time::advance(Duration::from_secs(31)).await;
    service.read(OFFICES[0].0, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        6,
        "confirmed absence expires at the existing TTL"
    );
}
