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
    println!(
        "PASS local real HTTP resolver smoke ({:.2} ms); no AWS/provider/route parity claim",
        started.elapsed().as_secs_f64() * 1000.0
    );
}
