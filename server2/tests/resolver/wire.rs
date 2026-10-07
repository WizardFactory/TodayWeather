use rusty_s3::Credentials;
use server2::{cache::ResponseKey, resolver::*, storage::*};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{sync::Semaphore, time::Instant};
struct Peer {
    child: Child,
    endpoint: String,
}
impl Peer {
    fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let out = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let r = BufReader::new(out).read_line(&mut line);
            let _ = tx.send(r.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(line)) if line.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: line.trim().into(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("loopback peer startup: {other:?}")
            }
        }
    }
    fn transport(&self) -> HttpS3Transport {
        HttpS3Transport::new(
            &self.endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap()
    }
    async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.endpoint).parse().unwrap();
        url.query_pairs_mut()
            .append_pair("mode", mode)
            .append_pair("key", key);
        assert_eq!(
            reqwest::Client::new()
                .post(url)
                .header("X-Server2-Test-Key", "server2-local")
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            204
        );
    }
    async fn requests(&self) -> u64 {
        let v: serde_json::Value = serde_json::from_slice(
            &reqwest::Client::new()
                .get(format!("{}__catalog/status", self.endpoint))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        v.as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| {
                k.starts_with("GET ") || k.starts_with("HEAD ") || k.starts_with("PUT ")
            })
            .map(|(_, v)| v.as_u64().unwrap())
            .sum()
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
fn acquisition(fetch: u64, value: u32) -> Acquisition {
    acquisition_period(
        fetch,
        value,
        Period {
            local_date: 20261007,
            slot: "1200".into(),
        },
    )
}
fn acquisition_period(fetch: u64, value: u32, period: Period) -> Acquisition {
    let mut records = vec![];
    let mut members = vec![];
    for page in 1..=2 {
        let r = RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            period.clone(),
            fetch,
            200,
            "application/json",
            Some(Pagination {
                page,
                pages: 2,
                complete: true,
            }),
            format!("{{\"value\":{value},\"page\":{page}}}")
                .into_bytes()
                .into(),
            &Limits::default(),
        )
        .unwrap();
        members.push(GroupMember {
            envelope: r.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&r.envelope.identity, "20261007").unwrap()],
        });
        records.push(r);
    }
    Acquisition {
        declaration: GroupDeclaration::new(members, &CatalogLimits::default()).unwrap(),
        records,
    }
}
fn request(locale: &str, selection: ReadSelection, refresh: Duration) -> ResolutionRequest {
    let a = acquisition(1, 1);
    let id = CatalogId::for_record(&a.records[0].envelope.identity, "20261007").unwrap();
    ResolutionRequest::new(
        ResponseKey::new(
            "weather/coord",
            "v000903",
            "37.5001,127.0001",
            locale,
            "C",
            "aqi",
            "parser-1",
            BTreeMap::new(),
        )
        .unwrap(),
        RepairScope {
            catalog: id,
            periods: vec![a.records[0].envelope.identity.period.clone()],
        },
        selection,
        64,
        1024 * 1024,
        Duration::from_secs(60),
        refresh,
    )
    .unwrap()
}
#[derive(Clone)]
struct Gate {
    calls: Arc<AtomicUsize>,
    entered: Arc<Semaphore>,
    release: Arc<Semaphore>,
    denied: bool,
}
impl Gate {
    fn new(blocked: bool, denied: bool) -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            entered: Arc::new(Semaphore::new(0)),
            release: Arc::new(Semaphore::new(usize::from(!blocked) * 32)),
            denied,
        }
    }
    async fn entered(&self) {
        tokio::time::timeout(Duration::from_secs(2), self.entered.acquire())
            .await
            .unwrap()
            .unwrap()
            .forget();
    }
}
impl FundedAcquirer for Gate {
    async fn acquire(
        &self,
        _r: AcquisitionRequest,
        c: OperationContext,
    ) -> Result<Acquisition, server2::resolver::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.add_permits(1);
        let permit = tokio::time::timeout_at(c.deadline(), self.release.acquire())
            .await
            .map_err(|_| server2::resolver::Error::Storage(server2::storage::Error::Timeout))?
            .unwrap();
        permit.forget();
        c.check()?;
        if self.denied {
            Err(server2::resolver::Error::AcquisitionDenied)
        } else {
            Ok(acquisition(1, 42))
        }
    }
}
struct Builder;
impl ViewBuilder for Builder {
    fn parse(
        &self,
        pages: &[RawView<'_>],
        _: &str,
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        for p in pages {
            out.append(p.bytes)?;
            out.append(b"|")?;
        }
        Ok(())
    }
    fn assemble(
        &self,
        r: &ResolutionRequest,
        input: &CheckedInput,
        parsed: &[&[u8]],
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        if matches!(r.selection(), ReadSelection::FullHistory) {
            input.require_full_history()?;
        }
        out.append(r.response_key().locale().as_bytes())?;
        out.append(b":")?;
        out.append(r.response_key().location().as_bytes())?;
        for p in parsed {
            out.append(b"\n")?;
            out.append(p)?;
        }
        Ok(())
    }
}
fn make_resolver(
    peer: &Peer,
    gate: Gate,
    config: ResolverConfig,
) -> Resolver<HttpS3Transport, Gate, Builder> {
    Resolver::new(
        CatalogBackend::new(peer.transport(), CatalogLimits::default()).unwrap(),
        gate,
        Builder,
        config,
    )
    .unwrap()
}
async fn seed(peer: &Peer, fetch: u64, value: u32) {
    let a = acquisition(fetch, value);
    CatalogStore::new(peer.transport(), CatalogLimits::default())
        .unwrap()
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
}
#[tokio::test]
async fn real_http_cold_restore_warm_and_exact_labels_use_no_provider() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let cold = resolver.resolve(r.clone(), deadline()).await.unwrap();
    let count = peer.requests().await;
    let warm = resolver.resolve(r, deadline()).await.unwrap();
    assert_eq!(cold.bytes(), warm.bytes());
    assert_eq!(peer.requests().await, count);
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
    let en = resolver
        .resolve(
            request("en", ReadSelection::Latest, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    assert_ne!(en.bytes(), warm.bytes());
    assert!(en.bytes().starts_with(b"en:"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn initiating_waiter_cancellation_preserves_one_owned_acquisition_and_durable_group() {
    let peer = Peer::new();
    let gate = Gate::new(true, false);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let owner = resolver.clone();
    let first = tokio::spawn({
        let r = r.clone();
        async move { owner.resolve(r, deadline()).await }
    });
    gate.entered().await;
    first.abort();
    let _ = first.await;
    let waiter = resolver.clone();
    let second = tokio::spawn(async move { waiter.resolve(r, deadline()).await });
    until(|| resolver.metrics().shared_flights == 1).await;
    gate.release.add_permits(1);
    let response = second.await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(response.bytes()).contains("42"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    let a = acquisition(1, 42);
    let id = a.declaration.partitions[0].clone();
    let checked = CatalogStore::new(peer.transport(), CatalogLimits::default())
        .unwrap()
        .lookup(&id, deadline())
        .await
        .unwrap();
    match checked {
        LookupOutcome::Ready(set) => assert_eq!(set.acquisitions()[0].records().len(), 2),
        _ => panic!("response preceded complete durable publication"),
    };
    assert_eq!(resolver.metrics().cancelled_waiters, 1);
}
#[tokio::test]
async fn finite_empty_denial_is_terminal_and_bad_list_is_never_provider_permission() {
    let peer = Peer::new();
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    assert!(matches!(
        resolver.resolve(r.clone(), deadline()).await,
        Err(server2::resolver::Error::AcquisitionDenied)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    peer.fault("bad-list", "raw/v2/kma/current/").await;
    assert!(resolver.resolve(r, deadline()).await.is_err());
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn external_revision_refresh_and_local_invalidation_change_complete_response() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let r = request("ko", ReadSelection::Latest, Duration::from_millis(20));
    let old = resolver.resolve(r.clone(), deadline()).await.unwrap();
    seed(&peer, 2, 20).await;
    tokio::time::sleep(Duration::from_millis(25)).await;
    let new = resolver.resolve(r.clone(), deadline()).await.unwrap();
    assert_ne!(old.bytes(), new.bytes());
    assert!(String::from_utf8_lossy(new.bytes()).contains("20"));
    seed(&peer, 3, 30).await;
    resolver.invalidate();
    let latest = resolver.resolve(r, deadline()).await.unwrap();
    assert!(String::from_utf8_lossy(latest.bytes()).contains("30"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn selected_group_cannot_be_used_as_full_history_and_full_history_reaches_all_pages() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    seed(&peer, 2, 20).await;
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate, ResolverConfig::default());
    let latest = resolver
        .resolve(
            request("ko", ReadSelection::Latest, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    let history = resolver
        .resolve(
            request("ko", ReadSelection::FullHistory, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    let text = String::from_utf8_lossy(history.bytes());
    assert!(text.contains("10") && text.contains("20"));
    assert_ne!(latest.bytes(), history.bytes());
}
#[tokio::test]
async fn drain_stops_admission_and_waits_for_durable_owner_after_waiter_timeout() {
    let peer = Peer::new();
    let gate = Gate::new(true, false);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let first = resolver.clone();
    let task = tokio::spawn({
        let r = r.clone();
        async move {
            first
                .resolve(r, Instant::now() + Duration::from_millis(100))
                .await
        }
    });
    gate.entered().await;
    assert!(matches!(
        task.await.unwrap(),
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Timeout
        ))
    ));
    let draining = resolver.clone();
    let drain = tokio::spawn(async move { draining.drain(deadline()).await });
    until(|| resolver.is_draining()).await;
    assert!(matches!(
        resolver.resolve(r, deadline()).await,
        Err(server2::resolver::Error::Draining)
    ));
    gate.release.add_permits(1);
    let report = drain.await.unwrap().unwrap();
    assert_eq!(report.unfinished_owners, 0);
    assert_eq!(resolver.metrics().publications, 1);
    assert_eq!(resolver.metrics().active_owners, 0);
}

async fn until(condition: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("milestone did not occur");
}
#[tokio::test]
async fn unrelated_periods_in_one_catalog_neither_poison_selection_nor_create_a_global_empty_claim()
{
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    seed(&peer, 2, 20).await;
    let a = acquisition_period(
        9,
        99,
        Period {
            local_date: 20261008,
            slot: "1200".into(),
        },
    );
    CatalogStore::new(peer.transport(), CatalogLimits::default())
        .unwrap()
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    let latest = resolver
        .resolve(
            request("ko", ReadSelection::Latest, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    let text = String::from_utf8_lossy(latest.bytes());
    assert!(text.contains("20") && !text.contains("99"));
    let history = resolver
        .resolve(
            request("ko", ReadSelection::FullHistory, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    let text = String::from_utf8_lossy(history.bytes());
    assert!(text.contains("10") && text.contains("20") && !text.contains("99"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
    let empty_peer = Peer::new();
    let a = acquisition_period(
        9,
        99,
        Period {
            local_date: 20261008,
            slot: "1200".into(),
        },
    );
    CatalogStore::new(empty_peer.transport(), CatalogLimits::default())
        .unwrap()
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    let gate = Gate::new(false, false);
    let resolver = make_resolver(&empty_peer, gate.clone(), ResolverConfig::default());
    let response = resolver
        .resolve(
            request("ko", ReadSelection::Latest, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(response.bytes()).contains("42"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn owner_and_waiter_admission_are_separate_and_drain_reports_unfinished_work() {
    let peer = Peer::new();
    let gate = Gate::new(true, false);
    let config = ResolverConfig {
        operations: 1,
        waiters: 2,
        ..ResolverConfig::default()
    };
    let resolver = make_resolver(&peer, gate.clone(), config);
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let first = resolver.clone();
    let one = tokio::spawn({
        let r = r.clone();
        async move { first.resolve(r, deadline()).await }
    });
    gate.entered().await;
    assert!(matches!(
        resolver
            .resolve(
                request("en", ReadSelection::Latest, Duration::from_secs(30)),
                deadline()
            )
            .await,
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Capacity
        ))
    ));
    let second = resolver.clone();
    let two = tokio::spawn(async move { second.resolve(r, deadline()).await });
    until(|| resolver.metrics().shared_flights == 1).await;
    assert!(matches!(
        resolver
            .resolve(
                request("en", ReadSelection::Latest, Duration::from_secs(30)),
                deadline()
            )
            .await,
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Capacity
        ))
    ));
    let report = resolver
        .drain(Instant::now() + Duration::from_millis(20))
        .await
        .unwrap();
    assert_eq!(report.unfinished_owners, 1);
    gate.release.add_permits(1);
    assert!(matches!(
        one.await.unwrap(),
        Err(server2::resolver::Error::Cancelled)
    ));
    assert!(matches!(
        two.await.unwrap(),
        Err(server2::resolver::Error::Cancelled)
    ));
    assert_eq!(resolver.metrics().publications, 0);
}
struct ReleaseOnDrop(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        *self.0.0.lock().unwrap() = true;
        self.0.1.notify_all();
    }
}
struct BlockingBuilder {
    started: Arc<Semaphore>,
    gate: Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}
impl ViewBuilder for BlockingBuilder {
    fn parse(
        &self,
        pages: &[RawView<'_>],
        revision: &str,
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        Builder.parse(pages, revision, out)
    }
    fn assemble(
        &self,
        r: &ResolutionRequest,
        input: &CheckedInput,
        parsed: &[&[u8]],
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        self.started.add_permits(1);
        let (lock, condvar) = &*self.gate;
        let mut released = lock.lock().unwrap();
        while !*released {
            released = condvar.wait(released).unwrap();
        }
        Builder.assemble(r, input, parsed, out)
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn started_cpu_job_keeps_its_permit_and_input_lease_after_owner_timeout() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    let started = Arc::new(Semaphore::new(0));
    let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let _cleanup = ReleaseOnDrop(gate.clone());
    let builder = BlockingBuilder {
        started: started.clone(),
        gate: gate.clone(),
    };
    let resolver = Resolver::new(
        CatalogBackend::new(peer.transport(), CatalogLimits::default()).unwrap(),
        Gate::new(false, true),
        builder,
        ResolverConfig {
            operations: 1,
            cpu: 1,
            deadline: Duration::from_secs(1),
            ..ResolverConfig::default()
        },
    )
    .unwrap();
    let first = resolver.clone();
    let task = tokio::spawn(async move {
        first
            .resolve(
                request("ko", ReadSelection::Latest, Duration::from_secs(30)),
                deadline(),
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), started.acquire())
        .await
        .unwrap()
        .unwrap()
        .forget();
    assert!(matches!(
        task.await.unwrap(),
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Timeout
        ))
    ));
    until(|| resolver.metrics().active_owners == 0).await;
    assert_eq!(resolver.metrics().operation_bytes, 64 * 1024 * 1024);
    assert_eq!(resolver.metrics().active_cpu_jobs, 1);
    assert!(
        matches!(
            resolver
                .resolve(
                    request("en", ReadSelection::Latest, Duration::from_secs(30)),
                    deadline()
                )
                .await,
            Err(server2::resolver::Error::Storage(
                server2::storage::Error::Capacity
            ))
        ),
        "started job's operation lease must prevent a second full buffer reservation"
    );
    let report = resolver
        .drain(Instant::now() + Duration::from_millis(20))
        .await
        .unwrap();
    assert_eq!(report.unfinished_view_jobs, 1);
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let drained = resolver.drain(deadline()).await.unwrap();
    assert_eq!(drained.unfinished_view_jobs, 0);
}
#[tokio::test]
async fn partial_or_corrupt_s3_is_incomplete_and_cannot_call_the_acquirer() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    let a = acquisition(1, 10);
    let group_key = a
        .declaration
        .reference(&CatalogLimits::default())
        .unwrap()
        .descriptor_key()
        .unwrap();
    peer.fault("forget", &group_key).await;
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    assert!(matches!(
        resolver
            .resolve(
                request("ko", ReadSelection::Latest, Duration::from_secs(30)),
                deadline()
            )
            .await,
        Err(server2::resolver::Error::Incomplete)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
    let corrupt = Peer::new();
    seed(&corrupt, 1, 10).await;
    corrupt
        .fault(
            "corrupt",
            &a.records[0].envelope.identity.object_key().unwrap(),
        )
        .await;
    let gate = Gate::new(false, true);
    let resolver = make_resolver(&corrupt, gate.clone(), ResolverConfig::default());
    assert!(matches!(
        resolver
            .resolve(
                request("ko", ReadSelection::Latest, Duration::from_secs(30)),
                deadline()
            )
            .await,
        Err(server2::resolver::Error::Incomplete)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn rejected_publication_cannot_create_a_response_and_later_repair_needs_no_new_acquisition() {
    let peer = Peer::new();
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let key = r.scope().catalog.key();
    peer.fault("reject", &key).await;
    let gate = Gate::new(false, false);
    let resolver = make_resolver(&peer, gate.clone(), ResolverConfig::default());
    assert!(matches!(
        resolver.resolve(r.clone(), deadline()).await,
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Status(403)
        ))
    ));
    assert_eq!(resolver.metrics().publications, 0);
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    peer.fault("clear", &key).await;
    let response = resolver.resolve(r, deadline()).await.unwrap();
    assert!(String::from_utf8_lossy(response.bytes()).contains("42"));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
}
/// One control-read fault at the seam, while all other I/O is the real loopback HTTP adapter.
struct MissingDescriptor {
    inner: HttpS3Transport,
    key: String,
    reads: AtomicUsize,
}
impl ObjectTransport for MissingDescriptor {
    async fn put(&self, p: &PreparedRecord) -> Result<u16, server2::storage::Error> {
        self.inner.put(p).await
    }
    async fn head(&self, k: &str) -> Result<Object, server2::storage::Error> {
        self.inner.head(k).await
    }
    async fn get(&self, k: &str, m: usize) -> Result<Object, server2::storage::Error> {
        self.inner.get(k, m).await
    }
}
impl CatalogTransport for MissingDescriptor {
    async fn get_control(
        &self,
        k: &str,
        m: usize,
    ) -> Result<ControlObject, server2::storage::Error> {
        if k == self.key && self.reads.fetch_add(1, Ordering::SeqCst) == 2 {
            return Err(server2::storage::Error::NotFound);
        }
        self.inner.get_control(k, m).await
    }
    async fn put_control(
        &self,
        k: &str,
        b: &[u8],
        c: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put_control(k, b, c).await
    }
    async fn list_raw_document(
        &self,
        p: &str,
        t: Option<&str>,
        k: usize,
        b: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner.list_raw_document(p, t, k, b).await
    }
}
#[tokio::test]
async fn excluded_descriptor_response_never_enters_cache_even_when_catalog_etag_is_unchanged() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    seed(&peer, 2, 20).await;
    let a = acquisition(2, 20);
    let key = a
        .declaration
        .reference(&CatalogLimits::default())
        .unwrap()
        .descriptor_key()
        .unwrap();
    let transport = MissingDescriptor {
        inner: peer.transport(),
        key,
        reads: AtomicUsize::new(0),
    };
    let gate = Gate::new(false, true);
    let resolver = Resolver::new(
        CatalogBackend::new(transport, CatalogLimits::default()).unwrap(),
        gate.clone(),
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    let old = resolver.resolve(r.clone(), deadline()).await.unwrap();
    assert!(String::from_utf8_lossy(old.bytes()).contains("10"));
    let count = peer.requests().await;
    let new = resolver.resolve(r, deadline()).await.unwrap();
    assert!(peer.requests().await > count);
    assert!(String::from_utf8_lossy(new.bytes()).contains("20"));
    assert_eq!(resolver.metrics().hits, 0);
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
}
struct ReadFailure {
    inner: HttpS3Transport,
    fail: Arc<AtomicUsize>,
}
impl ObjectTransport for ReadFailure {
    async fn put(&self, p: &PreparedRecord) -> Result<u16, server2::storage::Error> {
        self.inner.put(p).await
    }
    async fn head(&self, k: &str) -> Result<Object, server2::storage::Error> {
        self.inner.head(k).await
    }
    async fn get(&self, k: &str, m: usize) -> Result<Object, server2::storage::Error> {
        self.inner.get(k, m).await
    }
}
impl CatalogTransport for ReadFailure {
    async fn get_control(
        &self,
        k: &str,
        m: usize,
    ) -> Result<ControlObject, server2::storage::Error> {
        match self.fail.load(Ordering::Acquire) {
            1 => Err(server2::storage::Error::Status(503)),
            2 => Err(server2::storage::Error::Corrupt(
                "injected refresh metadata",
            )),
            _ => self.inner.get_control(k, m).await,
        }
    }
    async fn put_control(
        &self,
        k: &str,
        b: &[u8],
        c: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put_control(k, b, c).await
    }
    async fn list_raw_document(
        &self,
        p: &str,
        t: Option<&str>,
        k: usize,
        b: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner.list_raw_document(p, t, k, b).await
    }
}
#[tokio::test]
async fn refresh_outage_can_use_unexpired_memory_but_corruption_never_extends_freshness() {
    let peer = Peer::new();
    seed(&peer, 1, 10).await;
    let fail = Arc::new(AtomicUsize::new(0));
    let resolver = Resolver::new(
        CatalogBackend::new(
            ReadFailure {
                inner: peer.transport(),
                fail: fail.clone(),
            },
            CatalogLimits::default(),
        )
        .unwrap(),
        Gate::new(false, true),
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let r = request("ko", ReadSelection::Latest, Duration::from_millis(20));
    let initial = resolver.resolve(r.clone(), deadline()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(25)).await;
    fail.store(1, Ordering::Release);
    let memory = resolver.resolve(r.clone(), deadline()).await.unwrap();
    assert_eq!(memory.bytes(), initial.bytes());
    fail.store(2, Ordering::Release);
    assert!(matches!(
        resolver.resolve(r, deadline()).await,
        Err(server2::resolver::Error::Storage(
            server2::storage::Error::Corrupt(_)
        ))
    ));
}
struct PanickingAcquirer {
    panic_once: std::sync::atomic::AtomicBool,
}
impl FundedAcquirer for PanickingAcquirer {
    async fn acquire(
        &self,
        _r: AcquisitionRequest,
        c: OperationContext,
    ) -> Result<Acquisition, server2::resolver::Error> {
        c.check()?;
        assert!(
            !self.panic_once.swap(false, Ordering::SeqCst),
            "injected owner panic"
        );
        Ok(acquisition(1, 42))
    }
}
#[tokio::test]
async fn owner_panic_is_terminal_and_does_not_leave_a_permanent_flight() {
    let peer = Peer::new();
    let resolver = Resolver::new(
        CatalogBackend::new(peer.transport(), CatalogLimits::default()).unwrap(),
        PanickingAcquirer {
            panic_once: std::sync::atomic::AtomicBool::new(true),
        },
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let r = request("ko", ReadSelection::Latest, Duration::from_secs(30));
    assert!(matches!(
        resolver.resolve(r.clone(), deadline()).await,
        Err(server2::resolver::Error::TaskFailed)
    ));
    until(|| resolver.metrics().active_owners == 0).await;
    assert!(resolver.resolve(r, deadline()).await.is_ok());
    assert_eq!(resolver.metrics().active_owners, 0);
}
