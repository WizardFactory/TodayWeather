//! #2849 empty-cache forecast reads over the owned S06 peer. A probe inside the 12-permit
//! process gate models S3 latency, counts operations in flight and injects per-partition
//! faults, so overlapped partition lookups, their partition-order consumption, the first
//! error, the store bounds and cancellation are observed through the public source.
use super::source::{docs_json, same};
use super::source_s3::{NOW, Peer, S3_PEERS, Unreachable, deadline};
use rusty_s3::Credentials;
use serde_json::json;
use server2::domestic::asos::AsosRequest;
use server2::domestic::family::WebRequest;
use server2::domestic::kma::source::observe::Acquire;
use server2::domestic::kma::source::{Doc, Family, S3Source, Val};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::BoxFuture;
use server2::history::{Grid, IndexListing, schedule};
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error,
    GroupDeclaration, GroupMember, HttpS3Transport, ListPage, Object, ObjectTransport, Pagination,
    PreparedRecord, RawRecord, WriteCondition,
};
use server2::world::BoundedS3;
use std::collections::BTreeMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, AtomicUsize, Ordering::SeqCst},
};
use std::time::Duration;
use tokio::time::Instant;

/// Hourly Current partitions of one grid, all inside its 217-hour lookback.
const PARTITIONS: usize = 130;
/// Catalog, group descriptor and raw GET of one single-page partition.
const CHAIN: u64 = 3;
const GATE: usize = 12;
const HOUR_MS: i64 = 3_600_000;

#[derive(Default)]
struct DenyProviders(AtomicUsize);
impl Acquire for DenyProviders {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
}

/// Operations in flight now and at most.
#[derive(Default)]
struct Gauge {
    now: AtomicUsize,
    peak: AtomicUsize,
}
impl Gauge {
    fn enter(&self) -> Held<'_> {
        let n = self.now.fetch_add(1, SeqCst) + 1;
        self.peak.fetch_max(n, SeqCst);
        Held(self)
    }
}
/// Leaves the gauge when the operation ends or its future is dropped.
struct Held<'a>(&'a Gauge);
impl Drop for Held<'_> {
    fn drop(&mut self) {
        self.0.now.fetch_sub(1, SeqCst);
    }
}
#[derive(Default)]
struct Probe {
    /// Delay of every read operation while it holds its gate permit.
    delay_ms: AtomicU64,
    /// Non-zero: xorshift state adding 0-15 ms to each read.
    jitter: AtomicU64,
    all: Gauge,
    catalogs: Gauge,
    catalog_reads: Mutex<Vec<String>>,
    /// Partition -> delay, then this error from its catalog GET.
    faults: Mutex<BTreeMap<String, (Duration, Error)>>,
}
impl Probe {
    async fn pause(&self) {
        let mut ms = self.delay_ms.load(SeqCst);
        let state = self.jitter.load(SeqCst);
        if state != 0 {
            let mut x = state;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.jitter.store(x, SeqCst);
            ms += x % 16;
        }
        if ms > 0 {
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
    }
    fn fault(&self, partition: &str, wait: Duration, error: Error) {
        self.faults
            .lock()
            .unwrap()
            .insert(partition.to_owned(), (wait, error));
    }
    fn in_flight(&self) -> usize {
        self.all.now.load(SeqCst)
    }
}
/// The HTTP S3 client of the peer behind the probe; writes pass through untouched.
struct Probed {
    inner: HttpS3Transport,
    probe: Arc<Probe>,
}
impl ObjectTransport for Probed {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        self.inner.put(record).await
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let _held = self.probe.all.enter();
        self.probe.pause().await;
        self.inner.head(key).await
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
        let _held = self.probe.all.enter();
        self.probe.pause().await;
        self.inner.get(key, maximum).await
    }
}
impl CatalogTransport for Probed {
    async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
        let _held = self.probe.all.enter();
        let catalog = !key.starts_with("index/v2/groups/");
        let _catalog = catalog.then(|| {
            self.probe
                .catalog_reads
                .lock()
                .unwrap()
                .push(key.to_owned());
            self.probe.catalogs.enter()
        });
        self.probe.pause().await;
        let partition = key
            .rsplit('/')
            .next()
            .and_then(|name| name.strip_suffix(".json"));
        let fault = partition
            .filter(|_| catalog)
            .and_then(|p| self.probe.faults.lock().unwrap().get(p).cloned());
        if let Some((wait, error)) = fault {
            tokio::time::sleep(wait).await;
            return Err(error);
        }
        self.inner.get_control(key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        self.inner.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, Error> {
        let _held = self.probe.all.enter();
        self.probe.pause().await;
        self.inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
}
impl IndexListing for Probed {
    async fn list_index(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        let _held = self.probe.all.enter();
        self.probe.pause().await;
        self.inner.list_index(prefix, token).await
    }
}

type Transport = BoundedS3<Probed>;
type Source = S3Source<Transport>;
fn http(peer: &Peer) -> HttpS3Transport {
    HttpS3Transport::new(
        peer.endpoint(),
        "server2-local",
        "ap-northeast-2",
        Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap()
}
/// A fresh source (empty forecast cache) whose S3 reads pass the probe inside a gate of `gate`.
fn source(peer: &Peer, probe: &Arc<Probe>, gate: usize) -> (Arc<Source>, Transport) {
    let transport = BoundedS3::new(
        Probed {
            inner: http(peer),
            probe: probe.clone(),
        },
        gate,
    );
    let source = S3Source::new(
        transport.clone(),
        Arc::new(|| NOW),
        Arc::new(DenyProviders::default()),
        Arc::new(Unreachable),
    )
    .unwrap();
    (Arc::new(source), transport)
}
fn grid(nx: u16) -> Grid {
    Grid::new(nx, 127).unwrap()
}
/// Newest first from 2026-09-24 10:00 KST (NOW is 10:50).
fn hourly(n: usize) -> Vec<Publication> {
    let newest = schedule::to_ms(Publication::new(20260924, 1000).unwrap());
    (0..n)
        .map(|h| schedule::from_ms(newest - h as i64 * HOUR_MS))
        .collect()
}
/// Partition ids in the order a read consumes them (ascending).
fn ascending(n: usize) -> Vec<String> {
    let mut parts: Vec<String> = hourly(n).iter().map(|p| p.partition()).collect();
    parts.sort();
    parts
}
fn current_page(grid: Grid, p: Publication, t1h: f64) -> Vec<u8> {
    let values = [
        ("PTY", "0".to_owned()),
        ("REH", "60".to_owned()),
        ("RN1", "0".to_owned()),
        ("T1H", format!("{t1h:.1}")),
        ("UUU", "1.2".to_owned()),
        ("VEC", "200".to_owned()),
        ("VVV", "-0.5".to_owned()),
        ("WSD", "2.1".to_owned()),
    ];
    let items: Vec<_> = values
        .into_iter()
        .map(|(category, value)| {
            json!({"baseDate":p.base_date(),"baseTime":p.base_time(),"category":category,
                   "nx":grid.nx(),"ny":grid.ny(),"obsrValue":value})
        })
        .collect();
    serde_json::to_vec(&json!({"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"dataType":"JSON","items":{"item":items},"pageNo":1,"numOfRows":999,"totalCount":items.len()}}}))
    .unwrap()
}
/// One complete acquisition (pages in order) of a Current partition.
async fn publish(
    store: &CatalogStore<BoundedS3<HttpS3Transport>>,
    grid: Grid,
    p: Publication,
    pages: &[Vec<u8>],
) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let record = RawRecord::new(
            "data-go-kr",
            "ultra-srt-ncst",
            &grid.provider_key(),
            p.period(),
            (schedule::to_ms(p) + 45 * 60_000) as u64,
            200,
            "application/json",
            (n > 1).then_some(Pagination {
                page: i as u32 + 1,
                pages: n,
                complete: true,
            }),
            page.clone().into(),
            &limits.raw,
        )
        .unwrap();
        members.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![
                CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap(),
            ],
        });
        records.push(record);
    }
    store
        .publish(
            GroupDeclaration::new(members, &limits).unwrap(),
            records,
            deadline(),
        )
        .await
        .unwrap();
}
/// A peer holding `PARTITIONS` hourly Current partitions for each of `grids`.
async fn seeded(grids: &[Grid]) -> Peer {
    let peer = Peer::persistent();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    for &grid in grids {
        for (h, p) in hourly(PARTITIONS).into_iter().enumerate() {
            publish(
                &store,
                grid,
                p,
                &[current_page(grid, p, 15. + (h % 10) as f64)],
            )
            .await;
        }
    }
    peer
}
fn fcs(doc: &Doc) -> f64 {
    match doc.get("fcsDate") {
        Some(Val::Date(ms)) => *ms,
        other => panic!("fcsDate {other:?}"),
    }
}
async fn drained(probe: &Probe, within: Duration) -> usize {
    let until = Instant::now() + within;
    while probe.in_flight() != 0 && Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    probe.in_flight()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn overlapped_lookups_read_every_partition_once_inside_the_gate() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let probe = Arc::new(Probe::default());
    probe.delay_ms.store(10, SeqCst);
    let (source, _) = source(&peer, &probe, GATE);
    let started = Instant::now();
    let docs = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap();
    let elapsed = started.elapsed();
    assert_eq!(
        docs.len(),
        PARTITIONS,
        "one Current Doc per hourly partition"
    );
    assert!(docs.windows(2).all(|w| fcs(&w[0]) < fcs(&w[1])));
    let reads = probe.catalog_reads.lock().unwrap().clone();
    let mut once = reads.clone();
    once.sort();
    once.dedup();
    assert_eq!((reads.len(), once.len()), (PARTITIONS, PARTITIONS));
    assert_eq!(
        source.forecast_cache_stats().parse_acquisitions,
        PARTITIONS as u64
    );
    let peak = probe.all.peak.load(SeqCst);
    assert!(peak <= GATE, "the process gate bounds every read: {peak}");
    let lookups = probe.catalogs.peak.load(SeqCst);
    let sequential = Duration::from_millis(PARTITIONS as u64 * CHAIN * 10);
    eprintln!(
        "cold read: {PARTITIONS} partitions at 10 ms, peak lookups {lookups}, peak reads {peak}, \
         {elapsed:?} (sequential estimate {sequential:?})"
    );
    assert!(
        lookups >= 8,
        "partition lookups must overlap: peak {lookups}"
    );
    assert!(
        elapsed <= sequential / 3,
        "{elapsed:?} for a sequential estimate of {sequential:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn jittered_overlapped_reads_equal_one_operation_at_a_time() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let (serial, _) = source(&peer, &Arc::new(Probe::default()), 1);
    let expected = serial
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap();
    assert_eq!(expected.len(), PARTITIONS);
    let probe = Arc::new(Probe::default());
    probe.jitter.store(0x9E37_79B9_7F4A_7C15, SeqCst);
    let (source, _) = source(&peer, &probe, GATE);
    let docs = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap();
    same(
        &docs_json(&docs),
        &docs_json(&expected),
        "jittered overlapped read",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_first_failing_partition_in_order_decides_the_answer() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let parts = ascending(PARTITIONS);
    let probe = Arc::new(Probe::default());
    probe.delay_ms.store(5, SeqCst);
    // The earlier partition fails late; a later one fails at once.
    probe.fault(&parts[20], Duration::from_millis(150), Error::Transport);
    probe.fault(
        &parts[25],
        Duration::ZERO,
        Error::Corrupt("injected later partition"),
    );
    let (source, _) = source(&peer, &probe, GATE);
    let error = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap_err();
    assert!(
        error.contains("Transport") && !error.contains("Corrupt"),
        "{error}"
    );
    assert_eq!(drained(&probe, Duration::from_millis(500)).await, 0);
    assert_eq!(source.forecast_cache_stats().mapped_entries, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_catalog_vanished_after_listing_fails_the_view_as_before() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let parts = ascending(PARTITIONS);
    let probe = Arc::new(Probe::default());
    probe.fault(&parts[20], Duration::ZERO, Error::NotFound);
    let (source, _) = source(&peer, &probe, GATE);
    let error = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap_err();
    assert!(error.contains("incomplete catalog"), "{error}");
    assert_eq!(drained(&probe, Duration::from_millis(500)).await, 0);
    assert_eq!(source.forecast_cache_stats().mapped_entries, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_owner_deadline_drops_every_lookup_in_flight() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let probe = Arc::new(Probe::default());
    // 1.2 s per partition: far more than the eight-second owner bound in total, each lookup
    // inside its own three-second bound.
    probe.delay_ms.store(400, SeqCst);
    let (source, _) = source(&peer, &probe, GATE);
    let started = Instant::now();
    let error = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap_err();
    assert!(started.elapsed() >= Duration::from_secs(7), "{error}");
    assert_eq!(
        drained(&probe, Duration::from_millis(500)).await,
        0,
        "no lookup outlives its owner"
    );
    let until = Instant::now() + Duration::from_secs(2);
    while source.forecast_cache_stats().active_workspace_logical_bytes != 0
        && Instant::now() < until
    {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let stats = source.forecast_cache_stats();
    assert_eq!(
        (stats.mapped_entries, stats.active_workspace_logical_bytes),
        (0, 0)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lookup_that_never_answers_times_out_and_stops_the_others() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60)]).await;
    let parts = ascending(PARTITIONS);
    let probe = Arc::new(Probe::default());
    probe.delay_ms.store(10, SeqCst);
    probe.fault(&parts[20], Duration::from_secs(30), Error::Transport);
    let (source, _) = source(&peer, &probe, GATE);
    let error = source
        .grid_answer(Family::Current, grid(60), NOW, deadline())
        .await
        .unwrap_err();
    assert!(error.contains("Timeout"), "{error}");
    assert_eq!(drained(&probe, Duration::from_millis(500)).await, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_cold_keys_share_the_gate_without_starving_another_reader() {
    let _serial = S3_PEERS.lock().await;
    let peer = seeded(&[grid(60), grid(61)]).await;
    let mut expected = Vec::new();
    for nx in [60, 61] {
        let (plain, _) = source(&peer, &Arc::new(Probe::default()), GATE);
        expected.push(
            plain
                .grid_answer(Family::Current, grid(nx), NOW, deadline())
                .await
                .unwrap(),
        );
    }
    let probe = Arc::new(Probe::default());
    probe.delay_ms.store(10, SeqCst);
    let (source, transport) = source(&peer, &probe, GATE);
    let builds: Vec<_> = [60, 61]
        .into_iter()
        .map(|nx| {
            let source = source.clone();
            tokio::spawn(async move {
                let docs = source
                    .grid_answer(Family::Current, grid(nx), NOW, deadline())
                    .await;
                (docs, Instant::now())
            })
        })
        .collect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let asked = Instant::now();
    let foreign = transport
        .get_control("index/v2/foreign/absent.json", 1024)
        .await;
    let answered = Instant::now();
    assert!(matches!(foreign, Err(Error::NotFound)), "{foreign:?}");
    for (build, expected) in builds.into_iter().zip(&expected) {
        let (docs, finished) = build.await.unwrap();
        same(
            &docs_json(&docs.unwrap()),
            &docs_json(expected),
            "concurrent cold key",
        );
        assert!(
            answered < finished,
            "another reader waited for a whole cold build"
        );
    }
    assert!(answered - asked < Duration::from_millis(250));
    let peak = probe.all.peak.load(SeqCst);
    assert!(peak <= GATE, "{peak}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_partition_above_four_mebibytes_is_refused_for_capacity() {
    let _serial = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let latest = hourly(1)[0];
    // Distinct 1 MiB pages (equal pages would share one member identity).
    let pages: Vec<Vec<u8>> = (b'a'..=b'd').map(|b| vec![b; 1024 * 1024]).collect();
    publish(&store, grid(62), latest, &pages).await;
    let mut above = pages.clone();
    above.push(b"e".to_vec());
    publish(&store, grid(63), latest, &above).await;
    let (source, _) = source(&peer, &Arc::new(Probe::default()), GATE);
    let at = source
        .grid_answer(Family::Current, grid(62), NOW, deadline())
        .await;
    assert!(
        at.as_ref().err().is_none_or(|e| !e.contains("Capacity")),
        "exactly 4 MiB is admitted: {at:?}"
    );
    let above = source
        .grid_answer(Family::Current, grid(63), NOW, deadline())
        .await
        .unwrap_err();
    assert!(above.contains("Capacity"), "{above}");
}
