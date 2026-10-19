//! D1: exercise the public zone read with isolated empty S3 and explicit test-only expiry.
use super::*;
use crate::storage::{
    CatalogTransport, ControlObject, Error, ListPage, Object, ObjectTransport, Pagination, Period,
    PreparedRecord, RawRecord, WriteCondition,
};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::time::Duration;

#[derive(Clone)]
struct Empty;
impl ObjectTransport for Empty {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        panic!("unit storage must not write")
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Empty {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        Err(Error::NotFound)
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        panic!("unit storage must not write")
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Ok(b"<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>".to_vec())
    }
}
impl IndexListing for Empty {
    async fn list_index(&self, _: &str, _: Option<&str>) -> Result<ListPage, Error> {
        Ok(ListPage {
            keys: vec![],
            next: None,
        })
    }
}
struct Never;
impl observe::Acquire for Never {
    fn web(
        &self,
        _: crate::domestic::family::WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<crate::domestic::Acquired, crate::domestic::DomesticError>> {
        Box::pin(async { panic!("unrelated provider") })
    }
    fn asos(
        &self,
        _: crate::domestic::asos::AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<crate::domestic::Acquired, crate::domestic::DomesticError>> {
        Box::pin(async { panic!("unrelated provider") })
    }
}
impl observe::Locate for Never {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { panic!("unrelated geocoder") })
    }
}

const NOW: f64 = 1_792_224_000_000.;
fn records(body: &[u8]) -> Vec<RawRecord> {
    vec![
        RawRecord::new(
            "data-go-kr",
            "forecast-zone",
            &ProviderKey::Named {
                id: "forecast-zones".into(),
            },
            Period {
                local_date: 20261018,
                slot: "0000".into(),
            },
            NOW as u64,
            200,
            "application/json",
            Some(Pagination {
                page: 1,
                pages: 1,
                complete: true,
            }),
            Arc::from(body),
            &crate::storage::Limits::default(),
        )
        .unwrap(),
    ]
}
fn valid() -> Vec<RawRecord> {
    records(include_bytes!(
        "../../../../tests/formats/fixtures/forecast-zone.json"
    ))
}
struct FailsOnce(AtomicUsize);
impl fetch::ForecastAcquire for FailsOnce {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        assert_eq!(request, fetch::ForecastRequest::Zones);
        let call = self.0.fetch_add(1, SeqCst);
        Box::pin(async move {
            if call == 0 {
                Err("owned failure".into())
            } else {
                Ok(Some(valid()))
            }
        })
    }
}
fn fixture(forecast: Arc<dyn fetch::ForecastAcquire>) -> S3Source<Empty> {
    let mut s = S3Source::new(Empty, Arc::new(|| NOW), Arc::new(Never), Arc::new(Never))
        .unwrap()
        .with_forecast(Some(forecast));
    // Unit fixture only: real production retains completed owned results for three seconds.
    s.owned = crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
        retain: Duration::ZERO,
        ..Default::default()
    })
    .unwrap();
    s
}
async fn read(s: &S3Source<Empty>) {
    s.zones(NOW, Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    // Let the immediate-bound caller's independently owned task finish before assertions.
    tokio::time::sleep(Duration::from_millis(30)).await;
}
fn expire(s: &S3Source<Empty>) {
    // Test-only expiry, not a production clock, mode or retry override.
    s.attempts.state.lock().unwrap().0.remove("forecast-zones");
}

#[tokio::test]
async fn failed_zone_collection_retries_after_existing_memo() {
    let f = Arc::new(FailsOnce(AtomicUsize::new(0)));
    let s = fixture(f.clone());
    read(&s).await;
    assert_eq!(f.0.load(SeqCst), 1);
    read(&s).await;
    assert_eq!(f.0.load(SeqCst), 1, "no immediate retry storm");
    expire(&s);
    read(&s).await;
    assert_eq!(
        f.0.load(SeqCst),
        2,
        "first failure must not latch process completion"
    );
    expire(&s);
    read(&s).await;
    assert_eq!(f.0.load(SeqCst), 2, "readable success ends process refresh");
}

#[derive(Clone, Copy, Debug)]
enum Failure {
    None,
    Panic,
    Empty,
    Malformed,
    Incomplete,
}
struct Recover {
    first: Failure,
    calls: AtomicUsize,
}
impl fetch::ForecastAcquire for Recover {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        assert_eq!(request, fetch::ForecastRequest::Zones);
        let call = self.calls.fetch_add(1, SeqCst);
        let failure = self.first;
        Box::pin(async move {
            if call != 0 {
                return Ok(Some(valid()));
            }
            match failure {
                Failure::None => Ok(None),
                Failure::Panic => panic!("owned provider panic must not poison zone retry"),
                Failure::Empty => Ok(Some(Vec::new())),
                Failure::Malformed => Ok(Some(records(b"not json"))),
                Failure::Incomplete => {
                    let mut body: Value = serde_json::from_slice(&valid()[0].bytes).unwrap();
                    body["response"]["body"]["totalCount"] = Value::from(1001);
                    Ok(Some(records(&serde_json::to_vec(&body).unwrap())))
                }
            }
        })
    }
}
#[tokio::test]
async fn absent_panicked_and_unreadable_results_remain_retryable() {
    for first in [
        Failure::None,
        Failure::Panic,
        Failure::Empty,
        Failure::Malformed,
        Failure::Incomplete,
    ] {
        let f = Arc::new(Recover {
            first,
            calls: AtomicUsize::new(0),
        });
        let s = fixture(f.clone());
        read(&s).await;
        assert!(
            !s.zones_requested.load(SeqCst),
            "{first:?} is not successful publication"
        );
        read(&s).await;
        assert_eq!(f.calls.load(SeqCst), 1, "bounded failure: {first:?}");
        expire(&s);
        read(&s).await;
        assert_eq!(f.calls.load(SeqCst), 2, "recover after {first:?}");
        assert!(s.zones_requested.load(SeqCst));
    }
}
#[tokio::test]
async fn failed_refresh_keeps_last_good_zone_memory() {
    let f = Arc::new(FailsOnce(AtomicUsize::new(0)));
    let s = fixture(f);
    let fetched = fetched_of(&valid()).unwrap();
    let zones = Arc::new(zone_documents(&[fetched], NOW).unwrap());
    let last = (NOW as u64, "20261018-0000".into(), "a".repeat(64));
    *s.zones.lock().await = Some(ZoneCache {
        zones: zones.clone(),
        refreshed: std::time::Instant::now(),
        folded: std::time::Instant::now(),
        seen: Default::default(),
        last,
    });
    read(&s).await;
    let kept = s
        .zones(NOW, Instant::now() + Duration::from_secs(1))
        .await
        .unwrap();
    assert!(
        Arc::ptr_eq(&zones, &kept),
        "failure does not clear last-good memory"
    );
    assert_eq!(kept.docs().len(), 3);
}
struct Blocked {
    calls: AtomicUsize,
    release: Arc<tokio::sync::Notify>,
}
impl fetch::ForecastAcquire for Blocked {
    fn acquire(
        &self,
        _: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        self.calls.fetch_add(1, SeqCst);
        let release = self.release.clone();
        Box::pin(async move {
            release.notified().await;
            Ok(Some(valid()))
        })
    }
}
#[tokio::test]
async fn requests_return_while_one_owner_continues_and_publishes() {
    let f = Arc::new(Blocked {
        calls: AtomicUsize::new(0),
        release: Arc::new(tokio::sync::Notify::new()),
    });
    let s = fixture(f.clone());
    read(&s).await;
    read(&s).await;
    assert_eq!(f.calls.load(SeqCst), 1);
    assert!(!s.zones_requested.load(SeqCst));
    f.release.notify_one();
    tokio::time::timeout(Duration::from_secs(1), async {
        while !s.zones_requested.load(SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    expire(&s);
    read(&s).await;
    assert_eq!(
        f.calls.load(SeqCst),
        1,
        "finished successful owner ends refresh"
    );
}
