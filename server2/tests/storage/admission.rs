//! KMA-NATION-READS: waiting for a catalog store's I/O admission is bounded by the caller's
//! deadline; the 3 s per-operation cap starts once admitted. The SR-6 rehearsal answered the
//! nation route with HTTP 500 in 23 of 24 samples because fifteen cities' lookups queued for the
//! store's admissions and the cap, counted from before the queue, ended them at 3 s.
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error, Limits, Object,
    ObjectTransport, Period, PreparedRecord, ProviderKey, RawRecord, ReadOrder, WriteCondition,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::time::Instant;

/// Every read takes `delay` and finds nothing; writes succeed at once. Counts every call.
#[derive(Clone)]
struct Slow {
    delay: Duration,
    calls: Arc<AtomicUsize>,
    puts: Arc<AtomicUsize>,
}
impl Slow {
    fn new(delay: Duration) -> Self {
        Self {
            delay,
            calls: Arc::default(),
            puts: Arc::default(),
        }
    }
    async fn read(&self) {
        self.calls.fetch_add(1, SeqCst);
        tokio::time::sleep(self.delay).await;
    }
}
impl ObjectTransport for Slow {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        self.calls.fetch_add(1, SeqCst);
        self.puts.fetch_add(1, SeqCst);
        Ok(200)
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        self.read().await;
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        self.read().await;
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Slow {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        self.read().await;
        Err(Error::NotFound)
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        self.calls.fetch_add(1, SeqCst);
        self.puts.fetch_add(1, SeqCst);
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        self.read().await;
        Ok(Vec::new())
    }
}

fn record() -> RawRecord {
    RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20261007,
            slot: "1200".into(),
        },
        1791324000000,
        200,
        "application/json",
        None,
        br#"{"value":1}"#.to_vec().into(),
        &Limits::default(),
    )
    .unwrap()
}
fn id() -> CatalogId {
    CatalogId::for_record(&record().envelope.identity, "20261007").unwrap()
}
fn one_admission() -> CatalogLimits {
    CatalogLimits {
        io: 1,
        ..CatalogLimits::default()
    }
}
fn after(seconds: f64) -> Instant {
    Instant::now() + Duration::from_secs_f64(seconds)
}

#[derive(Clone, Copy, Debug)]
enum Read {
    Lookup,
    Wide,
    Members,
    Page,
}
const READS: [Read; 4] = [Read::Lookup, Read::Wide, Read::Members, Read::Page];
async fn read(store: &CatalogStore<Slow>, kind: Read, deadline: Instant) -> Result<(), Error> {
    let id = id();
    match kind {
        Read::Lookup => store.lookup(&id, deadline).await.map(drop),
        Read::Wide => store.lookup_wide(&id, 4, deadline).await.map(drop),
        Read::Members => store
            .lookup_members(&id, &[record().envelope.identity], deadline)
            .await
            .map(drop),
        Read::Page => store
            .lookup_page(&id, ReadOrder::LatestFirst, None, 1, deadline)
            .await
            .map(drop),
    }
}
/// The transport delay that makes one uncontended `kind` read take exactly two seconds.
async fn two_second_delay(kind: Read) -> Duration {
    let store = CatalogStore::new(Slow::new(Duration::from_secs(1)), one_admission()).unwrap();
    let start = Instant::now();
    read(&store, kind, after(60.)).await.unwrap();
    let reads = start.elapsed().as_secs();
    assert!(
        (1..=2).contains(&reads),
        "{kind:?}: {reads} sequential reads"
    );
    Duration::from_millis(2000 / reads)
}
/// Starts a read that holds the store's only admission, then returns once it has it.
async fn occupy(
    store: &Arc<CatalogStore<Slow>>,
    kind: Read,
) -> tokio::task::JoinHandle<Result<(), Error>> {
    let held = store.clone();
    let task = tokio::spawn(async move { read(&held, kind, after(8.)).await });
    tokio::task::yield_now().await;
    task
}

#[tokio::test(start_paused = true)]
async fn a_queued_read_completes_within_its_deadline() {
    for kind in READS {
        let store = Arc::new(
            CatalogStore::new(Slow::new(two_second_delay(kind).await), one_admission()).unwrap(),
        );
        let start = Instant::now();
        let first = occupy(&store, kind).await;
        assert!(read(&store, kind, after(8.)).await.is_ok(), "{kind:?}");
        assert_eq!(start.elapsed(), Duration::from_secs(4), "{kind:?}");
        assert!(first.await.unwrap().is_ok());
    }
}

#[tokio::test(start_paused = true)]
async fn a_read_queued_past_three_seconds_still_completes() {
    let kind = Read::Lookup;
    let store = Arc::new(
        CatalogStore::new(Slow::new(two_second_delay(kind).await), one_admission()).unwrap(),
    );
    let start = Instant::now();
    let first = occupy(&store, kind).await;
    let second = occupy(&store, kind).await;
    // Admitted at 4 s, after more than the 3 s cap of queueing; answered at 6 s.
    assert!(read(&store, kind, after(8.)).await.is_ok());
    assert_eq!(start.elapsed(), Duration::from_secs(6));
    assert!(first.await.unwrap().is_ok() && second.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn the_caller_deadline_ends_a_queued_read() {
    let kind = Read::Lookup;
    let store = Arc::new(
        CatalogStore::new(Slow::new(two_second_delay(kind).await), one_admission()).unwrap(),
    );
    let start = Instant::now();
    let first = occupy(&store, kind).await;
    assert!(matches!(
        read(&store, kind, after(3.5)).await,
        Err(Error::Timeout)
    ));
    assert_eq!(start.elapsed(), Duration::from_secs_f64(3.5));
    assert!(first.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_deadline_reached_while_queued_starts_no_work() {
    let kind = Read::Lookup;
    let slow = Slow::new(two_second_delay(kind).await);
    let store = Arc::new(CatalogStore::new(slow.clone(), one_admission()).unwrap());
    let first = occupy(&store, kind).await;
    let before = slow.calls.load(SeqCst);
    // The admission is released at the very instant the deadline passes.
    assert!(matches!(
        read(&store, kind, after(2.)).await,
        Err(Error::Timeout)
    ));
    assert!(first.await.unwrap().is_ok());
    assert_eq!(
        slow.calls.load(SeqCst),
        before,
        "the expired read sent a request"
    );
}

#[tokio::test(start_paused = true)]
async fn an_admitted_operation_keeps_the_three_second_cap() {
    let store =
        CatalogStore::new(Slow::new(Duration::from_secs(4)), CatalogLimits::default()).unwrap();
    let start = Instant::now();
    assert!(matches!(
        store.lookup(&id(), after(8.)).await,
        Err(Error::Timeout)
    ));
    assert_eq!(start.elapsed(), Duration::from_secs(3));
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_waiter_leaves_the_queue_and_the_admission() {
    let kind = Read::Lookup;
    let store = Arc::new(
        CatalogStore::new(Slow::new(two_second_delay(kind).await), one_admission()).unwrap(),
    );
    let start = Instant::now();
    let first = occupy(&store, kind).await;
    let cancelled = occupy(&store, kind).await;
    cancelled.abort();
    // The third read is admitted when the first ends, not after the cancelled one.
    assert!(read(&store, kind, after(8.)).await.is_ok());
    assert_eq!(start.elapsed(), Duration::from_secs(4));
    assert!(first.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_wide_lookup_returns_every_admission_it_took() {
    let kind = Read::Wide;
    let store = Arc::new(
        CatalogStore::new(
            Slow::new(two_second_delay(kind).await),
            CatalogLimits {
                io: 3,
                ..CatalogLimits::default()
            },
        )
        .unwrap(),
    );
    read(&store, kind, after(8.)).await.unwrap();
    // A plain lookup takes one admission; with all three free again, three run at once.
    let single = Instant::now();
    read(&store, Read::Lookup, after(8.)).await.unwrap();
    let one = single.elapsed();
    let start = Instant::now();
    let reads: Vec<_> = (0..3)
        .map(|_| {
            let store = store.clone();
            tokio::spawn(async move { read(&store, Read::Lookup, after(8.)).await })
        })
        .collect();
    for task in reads {
        assert!(task.await.unwrap().is_ok());
    }
    assert_eq!(start.elapsed(), one);
}

#[tokio::test(start_paused = true)]
async fn a_publish_queued_behind_a_read_is_admitted_and_writes() {
    let kind = Read::Lookup;
    let slow = Slow::new(two_second_delay(kind).await);
    let store = Arc::new(CatalogStore::new(slow.clone(), one_admission()).unwrap());
    let first = occupy(&store, kind).await;
    let start = Instant::now();
    // This transport does not return what was written, so the publish cannot confirm its write
    // (Ambiguous). What matters here: queueing did not time it out, and it wrote once admitted.
    let published = store.publish_once(id(), record(), after(8.)).await;
    assert!(!matches!(published, Err(Error::Timeout)), "{published:?}");
    assert!(start.elapsed() >= Duration::from_secs(2));
    assert!(slow.puts.load(SeqCst) > 0);
    assert!(first.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_publish_that_expires_while_queued_writes_nothing() {
    let kind = Read::Lookup;
    let slow = Slow::new(two_second_delay(kind).await);
    let store = Arc::new(CatalogStore::new(slow.clone(), one_admission()).unwrap());
    let first = occupy(&store, kind).await;
    // Definite: nothing was written, so not Ambiguous.
    assert!(matches!(
        store.publish_once(id(), record(), after(1.)).await,
        Err(Error::Timeout)
    ));
    assert_eq!(slow.puts.load(SeqCst), 0);
    assert!(first.await.unwrap().is_ok());
}
