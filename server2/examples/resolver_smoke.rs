//! Distinct functional release example. Accept only a fresh owned loopback test peer.
use rusty_s3::Credentials;
use server2::{
    cache::{ByteBudget, ResponseKey, WeightedCache},
    resolver::*,
    storage::*,
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{sync::Semaphore, time::Instant};
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
fn transport(endpoint: &str) -> HttpS3Transport {
    HttpS3Transport::new(
        endpoint,
        "server2-local",
        "ap-northeast-2",
        Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap()
}
fn acquisition(nx: u16, fetch: u64, value: u32) -> Acquisition {
    let mut records = vec![];
    let mut members = vec![];
    for page in 1..=2 {
        let record = RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx, ny: 127 },
            Period {
                local_date: 20261008,
                slot: "1200".into(),
            },
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
            envelope: record.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, "20261008").unwrap()],
        });
        records.push(record);
    }
    Acquisition {
        declaration: GroupDeclaration::new(members, &CatalogLimits::default()).unwrap(),
        records,
    }
}
fn request(nx: u16, selection: ReadSelection, refresh: Duration) -> ResolutionRequest {
    let a = acquisition(nx, 1, 1);
    ResolutionRequest::new(
        ResponseKey::new(
            "weather/coord",
            "v000903",
            "37.5001,127.0001",
            "ko",
            "C",
            "aqi",
            "smoke-parser-1",
            BTreeMap::new(),
        )
        .unwrap(),
        RepairScope {
            catalog: a.declaration.partitions[0].clone(),
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
struct RecordedAcquirer {
    calls: Arc<AtomicUsize>,
    entered: Arc<Semaphore>,
    release: Arc<Semaphore>,
}
impl FundedAcquirer for RecordedAcquirer {
    async fn acquire(
        &self,
        r: AcquisitionRequest,
        c: OperationContext,
    ) -> Result<Acquisition, server2::resolver::Error> {
        // Test-only recorded contract. This is not an S08 funding implementation.
        if r.resolution().scope().catalog
            != request(61, ReadSelection::Latest, Duration::from_secs(30))
                .scope()
                .catalog
        {
            return Err(server2::resolver::Error::AcquisitionDenied);
        }
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.add_permits(1);
        tokio::time::timeout_at(c.deadline(), self.release.acquire())
            .await
            .map_err(|_| server2::resolver::Error::Storage(server2::storage::Error::Timeout))?
            .map_err(|_| server2::resolver::Error::Cancelled)?
            .forget();
        c.check()?;
        Ok(acquisition(61, 1, 42))
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
async fn requests(endpoint: &str) -> u64 {
    let value: serde_json::Value = serde_json::from_slice(
        &reqwest::Client::new()
            .get(format!("{endpoint}__catalog/status"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    value
        .as_object()
        .unwrap()
        .iter()
        .filter(|(k, _)| k.starts_with("GET ") || k.starts_with("PUT ") || k.starts_with("HEAD "))
        .map(|(_, v)| v.as_u64().unwrap())
        .sum()
}
async fn until(f: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !f() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned-work milestone");
}
async fn idle<T: CatalogTransport, A: FundedAcquirer, V: ViewBuilder>(r: &Resolver<T, A, V>) {
    tokio::time::timeout(Duration::from_secs(4), async {
        while r.metrics().active_maintenance != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
struct ConcurrentRecorded {
    entered: Arc<Semaphore>,
    release: Arc<Semaphore>,
    calls: Arc<AtomicUsize>,
}
impl FundedAcquirer for ConcurrentRecorded {
    async fn acquire(
        &self,
        r: AcquisitionRequest,
        c: OperationContext,
    ) -> Result<Acquisition, server2::resolver::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.add_permits(1);
        tokio::time::timeout_at(c.deadline(), self.release.acquire())
            .await
            .map_err(|_| server2::storage::Error::Timeout)?
            .unwrap()
            .forget();
        c.check()?;
        let nx = [62, 63]
            .into_iter()
            .find(|nx| {
                request(*nx, ReadSelection::Latest, Duration::from_secs(30))
                    .scope()
                    .catalog
                    == r.resolution().scope().catalog
            })
            .ok_or(server2::resolver::Error::AcquisitionDenied)?;
        Ok(acquisition(nx, 1, 42))
    }
}
struct SmallView;
impl ViewBuilder for SmallView {
    fn parse(
        &self,
        _: &[RawView<'_>],
        _: &str,
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        out.append(b"ok")
    }
    fn assemble(
        &self,
        r: &ResolutionRequest,
        _: &CheckedInput,
        _: &[&[u8]],
        out: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        if r.response_key().units() == "F" {
            out.append(&vec![b'r'; 200 * 1024])
        } else {
            out.append(b"small")
        }
    }
}
fn pressure_request(nx: u16, units: &str) -> ResolutionRequest {
    let r = request(nx, ReadSelection::Latest, Duration::from_secs(30));
    ResolutionRequest::new(
        ResponseKey::new(
            "weather/coord",
            "v000903",
            "fixture",
            "ko",
            units,
            "aqi",
            "smoke-parser-1",
            BTreeMap::new(),
        )
        .unwrap(),
        r.scope().clone(),
        ReadSelection::Latest,
        64,
        1024 * 1024,
        Duration::from_secs(60),
        Duration::from_secs(30),
    )
    .unwrap()
}
async fn corrections(endpoint: &str, callback: RecordedAcquirer) {
    let entered = Arc::new(Semaphore::new(0));
    let release = Arc::new(Semaphore::new(0));
    let calls = Arc::new(AtomicUsize::new(0));
    let resolver = Resolver::new(
        CatalogBackend::new(transport(endpoint), CatalogLimits::default()).unwrap(),
        ConcurrentRecorded {
            entered: entered.clone(),
            release: release.clone(),
            calls: calls.clone(),
        },
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let a = {
        let r = resolver.clone();
        tokio::spawn(async move {
            r.resolve(
                request(62, ReadSelection::Latest, Duration::from_secs(30)),
                deadline(),
            )
            .await
        })
    };
    let b = {
        let r = resolver.clone();
        tokio::spawn(async move {
            r.resolve(
                request(63, ReadSelection::Latest, Duration::from_secs(30)),
                deadline(),
            )
            .await
        })
    };
    tokio::time::timeout(Duration::from_secs(2), entered.acquire_many(2))
        .await
        .unwrap()
        .unwrap()
        .forget();
    release.add_permits(2);
    assert!(a.await.unwrap().is_ok());
    assert!(b.await.unwrap().is_ok());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    println!("R1: two independent complete publications both return checked bytes");
    let store = CatalogStore::new(transport(endpoint), CatalogLimits::default()).unwrap();
    for nx in 70..87 {
        let a = acquisition(nx, 1, 10);
        let mut records = vec![];
        for record in a.records {
            let mut bytes = vec![b'x'; 60 * 1024];
            bytes[0] = record.envelope.pagination.as_ref().unwrap().page as u8;
            records.push(
                RawRecord::new(
                    "kma",
                    "current",
                    &ProviderKey::Grid { nx, ny: 127 },
                    record.envelope.identity.period.clone(),
                    1,
                    200,
                    "application/octet-stream",
                    record.envelope.pagination.clone(),
                    bytes.into(),
                    &Limits::default(),
                )
                .unwrap(),
            );
        }
        let declaration = GroupDeclaration::new(
            records
                .iter()
                .map(|r| GroupMember {
                    envelope: r.envelope.clone(),
                    catalogs: vec![
                        CatalogId::for_record(&r.envelope.identity, "20261008").unwrap(),
                    ],
                })
                .collect(),
            &CatalogLimits::default(),
        )
        .unwrap();
        store
            .publish(declaration, records, deadline())
            .await
            .unwrap();
    }
    let bounded = Resolver::new(
        CatalogBackend::new(transport(endpoint), CatalogLimits::default()).unwrap(),
        callback.clone(),
        SmallView,
        ResolverConfig {
            cache_bytes: 1024 * 1024,
            ..ResolverConfig::default()
        },
    )
    .unwrap();
    for nx in 70..87 {
        bounded
            .resolve(pressure_request(nx, "C"), deadline())
            .await
            .unwrap();
    }
    assert_eq!(
        bounded
            .resolve(pressure_request(70, "F"), deadline())
            .await
            .unwrap()
            .bytes()
            .len(),
        200 * 1024
    );
    idle(&bounded).await;
    println!("R2: 17 raw scopes in 1 MiB cache do not strand a valid 200 KiB response");
    for fetch in 1..=30 {
        let a = acquisition(64, fetch, fetch as u32);
        store
            .publish(a.declaration, a.records, deadline())
            .await
            .unwrap();
    }
    let mut url: reqwest::Url = format!("{endpoint}__catalog").parse().unwrap();
    url.query_pairs_mut()
        .append_pair("mode", "slow-all")
        .append_pair("key", "unused");
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
    let latest = Resolver::new(
        CatalogBackend::new(transport(endpoint), CatalogLimits::default()).unwrap(),
        callback.clone(),
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let r = request(64, ReadSelection::Latest, Duration::from_secs(30));
    let cold = latest.resolve(r.clone(), deadline()).await.unwrap();
    assert!(String::from_utf8_lossy(cold.bytes()).contains("30"));
    assert!(latest.metrics().foreground_io <= 33);
    idle(&latest).await;
    let io = requests(endpoint).await;
    assert_eq!(
        latest.resolve(r, deadline()).await.unwrap().bytes(),
        cold.bytes()
    );
    assert_eq!(requests(endpoint).await, io);
    assert_eq!(
        callback.calls.load(Ordering::SeqCst),
        1,
        "no new recorded acquisition on corrected S3 reads"
    );
    println!(
        "R3: 30 complete revisions at synthetic 20 ms GET; selected cold read and idle warm zero-I/O pass"
    );
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let endpoint = std::env::args()
        .nth(1)
        .expect("usage: resolver_smoke http://127.0.0.1:PORT/");
    let url: reqwest::Url = endpoint.parse().expect("endpoint URL");
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/");
    assert!(url.query().is_none() && url.fragment().is_none());
    let started = Instant::now();
    let store = CatalogStore::new(transport(&endpoint), CatalogLimits::default()).unwrap();
    let a = acquisition(60, 1, 10);
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    let callback = RecordedAcquirer {
        calls: Arc::new(AtomicUsize::new(0)),
        entered: Arc::new(Semaphore::new(0)),
        release: Arc::new(Semaphore::new(0)),
    };
    let resolver = Resolver::new(
        CatalogBackend::new(transport(&endpoint), CatalogLimits::default()).unwrap(),
        callback.clone(),
        Builder,
        ResolverConfig::default(),
    )
    .unwrap();
    let req = request(60, ReadSelection::Latest, Duration::from_secs(30));
    let cold = resolver.resolve(req.clone(), deadline()).await.unwrap();
    idle(&resolver).await;
    let count = requests(&endpoint).await;
    let warm = resolver.resolve(req, deadline()).await.unwrap();
    assert_eq!(cold.bytes(), warm.bytes());
    assert_eq!(requests(&endpoint).await, count);
    assert_eq!(callback.calls.load(Ordering::SeqCst), 0);
    println!("cold/warm: checked fixture bytes identical; warm S3/provider calls = 0");
    let a = acquisition(60, 2, 20);
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    resolver.invalidate();
    let history = resolver
        .resolve(
            request(60, ReadSelection::FullHistory, Duration::from_secs(30)),
            deadline(),
        )
        .await
        .unwrap();
    let text = String::from_utf8_lossy(history.bytes());
    assert!(text.contains("10") && text.contains("20"));
    println!("history: all scoped revisions retained; whole ordered pages preserved");
    let request = request(61, ReadSelection::Latest, Duration::from_secs(30));
    let owner = resolver.clone();
    let first = tokio::spawn({
        let request = request.clone();
        async move { owner.resolve(request, deadline()).await }
    });
    tokio::time::timeout(Duration::from_secs(2), callback.entered.acquire())
        .await
        .unwrap()
        .unwrap()
        .forget();
    first.abort();
    let _ = first.await;
    let waiter = resolver.clone();
    let second = tokio::spawn({
        let request = request.clone();
        async move { waiter.resolve(request, deadline()).await }
    });
    until(|| resolver.metrics().shared_flights == 1).await;
    let draining = resolver.clone();
    let drain = tokio::spawn(async move { draining.drain(deadline()).await });
    until(|| resolver.is_draining()).await;
    assert!(matches!(
        resolver.resolve(request, deadline()).await,
        Err(server2::resolver::Error::Draining)
    ));
    callback.release.add_permits(1);
    let response = second.await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(response.bytes()).contains("42"));
    let report = drain.await.unwrap().unwrap();
    assert_eq!(report.unfinished_owners, 0);
    assert_eq!(report.unfinished_view_jobs, 0);
    assert_eq!(callback.calls.load(Ordering::SeqCst), 1);
    let id = acquisition(61, 1, 42).declaration.partitions[0].clone();
    match store.lookup(&id, deadline()).await.unwrap() {
        LookupOutcome::Ready(set) => assert_eq!(set.acquisitions()[0].records().len(), 2),
        _ => panic!("new response before durable complete group"),
    };
    println!(
        "singleflight/drain: cancelled initiator detached; one recorded acquisition; complete durable group before response"
    );
    let budget = ByteBudget::new(128).unwrap();
    let cache = WeightedCache::new(budget.clone(), 2, 4).unwrap();
    let pinned = cache.insert("pin", vec![0u8; 64], 64).unwrap();
    cache.clear();
    assert_eq!(budget.used(), 64);
    assert!(cache.insert("next", vec![0u8; 80], 80).is_err());
    drop(pinned);
    assert_eq!(budget.used(), 0);
    println!("pressure: evicted pin stays charged; last-owner drop releases capacity");
    let metrics = resolver.metrics();
    assert_eq!(metrics.publications, 1);
    assert_eq!(metrics.active_owners, 0);
    assert_eq!(metrics.operation_bytes, 0);
    println!(
        "metrics: hits={}, shared={}, acquisitions={}, publications={}, owners={}, cache_bytes={}",
        metrics.hits,
        metrics.shared_flights,
        metrics.acquisitions,
        metrics.publications,
        metrics.active_owners,
        metrics.cache_bytes
    );
    corrections(&endpoint, callback).await;
    println!(
        "PASS local real HTTP resolver smoke ({:.2} ms); no AWS/provider/route parity claim",
        started.elapsed().as_secs_f64() * 1000.0
    );
}
