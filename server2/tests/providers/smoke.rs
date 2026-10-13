//! Functional smoke: loopback provider stub + owned S3 test peer (budgets, raw, catalogs).
//! Run in release mode with `cargo test --release --test providers smoke`. No AWS/provider traffic.
use super::support::*;
use rusty_s3::Credentials;
use server2::budget::BudgetStore;
use server2::domestic::family::{
    DataGoKrFamily as F, DataGoKrRequest, Endpoints, Service, Target, WebRequest,
};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticAcquirer, DomesticError, KeyRing};
use server2::providers::{Disposition, HttpProviderTransport, HttpPublicTransport, ProviderKey};
use server2::resolver::Acquisition;
use server2::storage::{CatalogLimits, CatalogStore, HttpS3Transport, LookupOutcome, Pagination};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};

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
        let output = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line);
            let _ = tx.send(result.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(endpoint)) if endpoint.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: endpoint.trim().to_owned(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("peer startup failure: {other:?}");
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
    async fn puts(&self, prefix: &str) -> u64 {
        let bytes = reqwest::Client::new()
            .get(format!("{}__catalog/status", self.endpoint))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(&format!("PUT {prefix}")))
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
fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn complete(outcome: Result<Acquired, DomesticError>) -> Acquisition {
    match outcome {
        Ok(Acquired::Complete(a)) => a,
        other => panic!("expected complete acquisition, got {other:?}"),
    }
}
async fn publish_and_read_back(peer: &Peer, a: Acquisition, served: &[Vec<u8>]) {
    let id = a.declaration.partitions[0].clone();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    // A cold store reads the published group back from S3 only.
    let cold = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let set = match cold.lookup(&id, deadline()).await.unwrap() {
        LookupOutcome::Ready(set) => set,
        LookupOutcome::Incomplete => panic!("published group is incomplete"),
    };
    let records = set.acquisitions().last().unwrap().records();
    assert_eq!(records.len(), served.len());
    for (record, bytes) in records.iter().zip(served) {
        assert_eq!(&record.bytes[..], &bytes[..]);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn smoke_acquire_publish_and_read_back_exact_raw_bytes() {
    let peer = Peer::new();
    let stub = Stub::start().await;
    let clk = clock(1_791_000_000_000);
    let budget = Arc::new(peer.transport());
    let mut rings = BTreeMap::new();
    for (service, owners) in [
        (Service::VilageFcst, ['a', 'b']),
        (Service::MidFcst, ['c', 'd']),
        (Service::LivingWthrIdx, ['1', '2']),
        (Service::HealthWthrIdx, ['3', '4']),
    ] {
        let entries = [(KEY_A, owners[0]), (KEY_B, owners[1])]
            .into_iter()
            .map(|(key, owner)| {
                (
                    ProviderKey::new(key.into()).unwrap(),
                    Arc::new(
                        BudgetStore::new(budget.clone(), policy(owner, 1000), clk.clone()).unwrap(),
                    ),
                )
            })
            .collect();
        rings.insert(service, KeyRing::new(entries).unwrap());
    }
    let metrics = Arc::new(DomesticMetrics::default());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
        clk,
        metrics.clone(),
        CatalogLimits::default(),
    )
    .unwrap();

    // Two-page short forecast: complete ordered group published and read back exactly.
    let pages = [
        vilage_page(1, 1068, 999, ("20261013", "1400"), (60, 127)),
        vilage_page(2, 1068, 999, ("20261013", "1400"), (60, 127)),
    ];
    for page in &pages {
        stub.push(
            "1360000/VilageFcstInfoService_2.0/getVilageFcst",
            Reply::json(page.clone()),
        );
    }
    let request = DataGoKrRequest::new(
        F::VilageFcst,
        Target::Grid { nx: 60, ny: 127 },
        p(20261013, 1400),
    )
    .unwrap();
    let a = complete(acquirer.acquire(&request, deadline()).await);
    assert_eq!(
        a.records[1].envelope.pagination,
        Some(Pagination {
            page: 2,
            pages: 2,
            complete: true
        })
    );
    publish_and_read_back(&peer, a, &pages).await;
    assert!(
        peer.puts("budgets/v2/data_go_kr/").await >= 2,
        "authority and witness writes"
    );

    // KMA web RSS (UTF-8 XML) and AWS (EUC-KR HTML) keep their bytes through S3.
    let rss = fixture("town-rss.xml");
    stub.push(
        "wid/queryDFS.jsp",
        Reply::with(200, "text/xml; charset=UTF-8", rss.clone()),
    );
    let a = complete(
        acquirer
            .acquire_web(&WebRequest::town_rss(60, 127).unwrap(), deadline())
            .await,
    );
    publish_and_read_back(&peer, a, &[rss]).await;
    let aws = fixture("aws-minute-euckr.html");
    stub.push(
        "cgi-bin/aws/nph-aws_txt_min",
        Reply::with(200, "text/html", aws.clone()),
    );
    let a = complete(
        acquirer
            .acquire_web(&WebRequest::aws_minute(None), deadline())
            .await,
    );
    publish_and_read_back(&peer, a, &[aws]).await;

    // Rejected and late acquisitions produce nothing to publish: raw PUT count is unchanged.
    let before = peer.puts("raw/v2/").await;
    stub.push(
        "1360000/VilageFcstInfoService_2.0/getVilageFcst",
        Reply::json(fixture("gateway-30.json")),
    );
    stub.push(
        "1360000/VilageFcstInfoService_2.0/getVilageFcst",
        Reply::with(200, "text/xml", fixture("gateway-quota.xml")),
    );
    let r = acquirer.acquire(&request, deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Quota))),
        "{r:?}"
    );
    stub.push(
        "1360000/VilageFcstInfoService_2.0/getVilageFcst",
        Reply::json(result_code("03")),
    );
    assert!(matches!(
        acquirer.acquire(&request, deadline()).await,
        Ok(Acquired::NotPublished)
    ));
    assert_eq!(peer.puts("raw/v2/").await, before);

    let m = metrics.snapshot();
    assert_eq!(m.funded_attempts, 5);
    assert_eq!(m.groups_complete, 3);
    assert_eq!(stub.keys().len() as u64, m.funded_attempts);
    println!("{}", metrics.render());
}
