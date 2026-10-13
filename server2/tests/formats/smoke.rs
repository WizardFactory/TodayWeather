//! Functional smoke: loopback provider stub + owned S3 test peer for the S13a domestic families.
//! Run in release mode with `cargo test --release --test formats smoke`. No AWS/provider traffic.
use super::common::*;
use super::support::*;
use rusty_s3::Credentials;
use server2::budget::BudgetStore;
use server2::domestic::airkorea::{AirKoreaOperation, AirKoreaRequest};
use server2::domestic::family::{Endpoints, Service};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::riseset::RiseSetRequest;
use server2::domestic::zone::ZoneRequest;
use server2::domestic::{Acquired, DomesticAcquirer, KeyRing};
use server2::providers::{HttpProviderTransport, HttpPublicTransport, ProviderKey};
use server2::resolver::Acquisition;
use server2::storage::{CatalogLimits, CatalogStore, HttpS3Transport, LookupOutcome};
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
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
async fn publish_and_read_back(peer: &Peer, a: Acquisition, served: &[Vec<u8>]) {
    let id = a.declaration.partitions[0].clone();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
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
async fn smoke_new_formats_publish_and_read_back_exact_bytes() {
    let peer = Peer::new();
    let stub = Stub::start().await;
    let clk = clock(NOW_MS);
    let budget = Arc::new(peer.transport());
    let store = |owner| {
        Arc::new(BudgetStore::new(budget.clone(), policy(owner, 1000), clk.clone()).unwrap())
    };
    let key = |k: &str| ProviderKey::new(k.into()).unwrap();
    let mut rings = BTreeMap::new();
    rings.insert(
        Service::AirKorea,
        KeyRing::new(vec![(key(KEY_A), store('5'))]).unwrap(),
    );
    rings.insert(
        Service::RiseSet,
        KeyRing::new(vec![(key(KEY_A), store('a')), (key(KEY_B), store('b'))]).unwrap(),
    );
    rings.insert(
        Service::ForecastZone,
        KeyRing::new(vec![(key(KEY_A), store('c')), (key(KEY_B), store('d'))]).unwrap(),
    );
    let metrics = Arc::new(DomesticMetrics::default());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base)
            .unwrap()
            .with_newsky(&stub.base)
            .unwrap(),
        clk,
        metrics.clone(),
        CatalogLimits::default(),
    )
    .unwrap();

    let pages = [
        airkorea_page(1, 120, 100, "경기"),
        airkorea_page(2, 120, 20, "경기"),
    ];
    for p in &pages {
        stub.push(STATION, Reply::json(p.clone()));
    }
    let request = AirKoreaRequest::new(AirKoreaOperation::Station, "경기").unwrap();
    let a = complete(acquirer.acquire_airkorea(&request, deadline()).await);
    publish_and_read_back(&peer, a, &pages).await;

    let kasi = local("kasi-area-seoul.json");
    stub.push(KASI, Reply::json(kasi.clone()));
    let a = complete(
        acquirer
            .acquire_rise_set(&RiseSetRequest::new("서울", 20261013).unwrap(), deadline())
            .await,
    );
    publish_and_read_back(&peer, a, &[kasi]).await;

    let zone = local("forecast-zone.json");
    stub.push(ZONE, Reply::json(zone.clone()));
    let a = complete(
        acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    publish_and_read_back(&peer, a, &[zone]).await;

    // A rejected key produces nothing to publish.
    stub.push(STATION, Reply::json(fixture("gateway-30.json")));
    assert!(!matches!(
        acquirer.acquire_airkorea(&request, deadline()).await,
        Ok(Acquired::Complete(_))
    ));
    let m = metrics.snapshot();
    assert_eq!(m.groups_complete, 3);
    assert_eq!(m.funded_attempts, 5);
    println!("{}", metrics.render());
}
