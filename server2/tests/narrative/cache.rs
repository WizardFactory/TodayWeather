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
    Persistent,
    AfterEmpty,
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
        let n = self.calls.fetch_add(1, SeqCst);
        if matches!(self.first, First::AfterEmpty) && n == 2 {
            return Err(Error::Corrupt("owned fault after expired absence"));
        }
        if matches!(self.first, First::Persistent) {
            return Err(Error::Corrupt("owned persistent fault"));
        }
        if n == 0 {
            match self.first {
                First::Timeout => return Err(Error::Timeout),
                First::Transport => return Err(Error::Transport),
                First::Corrupt => return Err(Error::Corrupt("owned malformed index")),
                First::Capacity => return Err(Error::Capacity),
                First::Slow => tokio::time::sleep(Duration::from_secs(1)).await,
                First::Empty | First::Persistent | First::AfterEmpty => {}
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

#[tokio::test(start_paused = true)]
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
            1,
            "short error gate blocks repeated failed reads"
        );
        tokio::time::advance(Duration::from_millis(1100)).await;
        assert!(service.read(108, deadline()).await.is_none());
        assert_eq!(
            calls.load(SeqCst),
            3,
            "eligible retry inspects both date indexes, not a false thirty-second absence"
        );
        assert!(service.read(108, deadline()).await.is_none());
        assert_eq!(calls.load(SeqCst), 3, "confirmed absence still caches");
    }
}
/// KMA-RESTART-RACE (decision 6): a waiter that stops waiting neither cancels the stored read nor
/// gates the office; the next request joins the running read and answers from it.
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
        2,
        "the next request joins the read the first stopped waiting for (both date indexes)"
    );
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(service.read(108, deadline()).await.is_none());
    assert_eq!(
        calls.load(SeqCst),
        2,
        "its confirmed absence answers, no error gate and no new read"
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

#[tokio::test(start_paused = true)]
async fn persistent_fault_is_throttled_by_a_separate_short_error_gate() {
    let (service, calls) = fixture(First::Persistent);
    for _ in 0..8 {
        assert!(service.read(108, deadline()).await.is_none());
    }
    assert_eq!(
        calls.load(SeqCst),
        1,
        "completed errors must not repeat storage on every request"
    );
    tokio::time::advance(Duration::from_millis(1100)).await;
    service.read(108, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        2,
        "short error gate eventually permits new demand"
    );
    service.read(OFFICES[1].0, deadline()).await;
    assert_eq!(calls.load(SeqCst), 3, "error gate is office-local");
}

#[tokio::test(start_paused = true)]
async fn error_after_an_expired_answer_does_not_renew_its_thirty_second_ttl() {
    let (service, calls) = fixture(First::AfterEmpty);
    service.read(108, deadline()).await;
    assert_eq!(calls.load(SeqCst), 2);
    tokio::time::advance(Duration::from_secs(31)).await;
    service.read(108, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        3,
        "expired answer reaches the injected fault"
    );
    service.read(108, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        3,
        "short error gate, not a new confirmed answer"
    );
    tokio::time::advance(Duration::from_millis(1100)).await;
    service.read(108, deadline()).await;
    assert_eq!(
        calls.load(SeqCst),
        5,
        "error did not renew thirty-second absence"
    );
}

/// An in-memory S3 for the narrative store on a paused clock: raw objects, conditional control
/// objects and index listings. Each LIST takes `list_delay` and each control write `put_delay`
/// (virtual time).
#[derive(Clone, Default)]
struct Mem(Arc<std::sync::Mutex<MemData>>);
#[derive(Default)]
struct MemData {
    objects: std::collections::BTreeMap<String, Object>,
    controls: std::collections::BTreeMap<String, (Vec<u8>, u64)>,
    revision: u64,
    list_delay: Duration,
    put_delay: Duration,
}
impl Mem {
    fn data(&self) -> std::sync::MutexGuard<'_, MemData> {
        self.0.lock().unwrap()
    }
}
impl ObjectTransport for Mem {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        let mut d = self.data();
        if d.objects.contains_key(&record.key) {
            return Ok(412);
        }
        let object = Object {
            metadata: record.metadata.clone(),
            length: record.body.len(),
            body: record.body.clone(),
        };
        d.objects.insert(record.key.clone(), object);
        Ok(200)
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let d = self.data();
        let o = d.objects.get(key).ok_or(Error::NotFound)?;
        Ok(Object {
            metadata: o.metadata.clone(),
            length: o.length,
            body: Vec::new(),
        })
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
        let o = self
            .data()
            .objects
            .get(key)
            .cloned()
            .ok_or(Error::NotFound)?;
        if o.length > maximum {
            return Err(Error::Capacity);
        }
        Ok(o)
    }
}
impl CatalogTransport for Mem {
    async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
        let (body, revision) = self
            .data()
            .controls
            .get(key)
            .cloned()
            .ok_or(Error::NotFound)?;
        if body.len() > maximum {
            return Err(Error::Capacity);
        }
        Ok(ControlObject {
            body,
            etag: format!("\"{revision}\""),
            version: None,
        })
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let delay = self.data().put_delay;
        tokio::time::sleep(delay).await;
        let mut d = self.data();
        let current = d.controls.get(key).map(|(_, r)| format!("\"{r}\""));
        let allowed = match condition {
            WriteCondition::Absent => current.is_none(),
            WriteCondition::Match(etag) => current.as_deref() == Some(etag.as_str()),
        };
        if !allowed {
            return Ok(412);
        }
        d.revision += 1;
        let revision = d.revision;
        d.controls.insert(key.to_owned(), (body.to_vec(), revision));
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid("the narrative uses the declared index"))
    }
}
impl IndexListing for Mem {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, Error> {
        let delay = self.data().list_delay;
        tokio::time::sleep(delay).await;
        let keys = self
            .data()
            .controls
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        Ok(ListPage { keys, next: None })
    }
}
/// A KST hour (`YYYYMMDDHHMM`) `back` hours before the current one on the wall clock.
fn hour_before(back: i64) -> String {
    let now = server2::narrative::now_ms();
    server2::history::schedule::from_ms(now - back * 3_600_000)
        .hour_start()
        .compact()
}
/// Office 109's narrative published at `tm`.
fn narrative_page(tm: &str, text: &str) -> Page {
    let body = serde_json::json!({"response": {"header": {"resultCode": "00",
        "resultMsg": "NORMAL_SERVICE"}, "body": {"dataType": "JSON", "items": {"item": [
        {"stnId": 109, "tmFc": tm, "wfSv1": text}]}, "pageNo": 1, "numOfRows": 10,
        "totalCount": 1}}});
    Page {
        body: serde_json::to_vec(&body).unwrap().into(),
        fetched_at_ms: server2::narrative::now_ms() as u64,
        content_type: "application/json".into(),
    }
}
/// The provider of office 109: its fetch waits until released, then answers the narrative of
/// `tm`.
struct Held {
    tm: String,
    started: tokio::sync::watch::Sender<usize>,
    release: tokio::sync::watch::Sender<bool>,
}
impl Source for Held {
    fn fetch(
        &self,
        station: u16,
        _: Instant,
    ) -> BoxFuture<'_, Result<Option<Page>, AcquisitionError>> {
        Box::pin(async move {
            if station != 109 {
                return Ok(None);
            }
            self.started.send_modify(|n| *n += 1);
            let _ = self.release.subscribe().wait_for(|r| *r).await;
            Ok(Some(narrative_page(&self.tm, "acquired")))
        })
    }
}

/// KMA-RESTART-RACE (RR2-narrative-regression): an announcement older than one the office has
/// answered never answers again, also once that answer's 30 s TTL has passed. The race starts
/// at 0.7 s; the stored read installs the newer narrative at 0.8 s (TTL to 30.8 s); the
/// provider answers the older one at 29 s, within the fetch's 30 s, and its publication takes
/// 2 s, so it ends at 31 s, past the TTL.
#[tokio::test(start_paused = true)]
async fn an_older_announcement_never_replaces_a_newer_one_after_the_ttl() {
    let mem = Mem::default();
    server2::narrative::store::Store::new(mem.clone())
        .unwrap()
        .publish(
            109,
            narrative_page(&hour_before(0), "stored"),
            Instant::now() + Duration::from_secs(3),
        )
        .await
        .unwrap()
        .expect("the newer narrative");
    {
        let mut d = mem.data();
        // A stored read lists two KST dates: it ends 0.8 s after it starts.
        d.list_delay = Duration::from_millis(400);
        d.put_delay = Duration::from_secs(2);
    }
    let office = Arc::new(Held {
        tm: hour_before(1),
        started: tokio::sync::watch::channel(0).0,
        release: tokio::sync::watch::channel(false).0,
    });
    let service = Service::new(mem.clone(), office.clone()).unwrap();
    let start = Instant::now();
    service.prefetch(109, start + Duration::from_millis(700));
    let _ = office.started.subscribe().wait_for(|n| *n >= 1).await;
    assert_eq!(
        start.elapsed(),
        Duration::from_millis(700),
        "the race starts"
    );
    let read = service.read(109, start + Duration::from_secs(3)).await;
    assert_eq!(read.map(|n| n.text).as_deref(), Some("stored"));
    assert_eq!(
        start.elapsed(),
        Duration::from_millis(800),
        "the stored read answers"
    );
    tokio::time::sleep_until(start + Duration::from_secs(29)).await;
    office.release.send_replace(true);
    tokio::time::sleep_until(start + Duration::from_secs(32)).await;
    assert_eq!(
        mem.data()
            .controls
            .keys()
            .filter(|k| k.starts_with("index/v2/kma-forecast-narrative/"))
            .count(),
        2,
        "the older announcement is published"
    );
    let text = service
        .read(109, Instant::now() + Duration::from_secs(3))
        .await
        .map(|n| n.text);
    assert_eq!(
        text.as_deref(),
        Some("stored"),
        "the newer announcement answers"
    );
    assert_eq!(*office.started.borrow(), 1);
}
