use rusty_s3::Credentials;
use server2::storage::*;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::time::Instant;
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
    async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.endpoint).parse().unwrap();
        url.query_pairs_mut()
            .append_pair("mode", mode)
            .append_pair("key", key);
        let r = reqwest::Client::new()
            .post(url)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status().as_u16(), 204);
    }
    async fn puts(&self, key: &str) -> usize {
        let body = reqwest::Client::new()
            .get(format!("{}__catalog/status", self.endpoint))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        value[format!("PUT {key}")].as_u64().unwrap_or(0) as usize
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
fn group(fetch: u64, value: u32) -> (GroupDeclaration, Vec<RawRecord>) {
    let mut records = Vec::new();
    let mut members = Vec::new();
    for page in 1..=2 {
        let bytes = format!("{{\"value\":{value},\"page\":{page}}}");
        let r = RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20261007,
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
            bytes.into_bytes().into(),
            &Limits::default(),
        )
        .unwrap();
        let a = CatalogId::for_record(&r.envelope.identity, "20261007-a").unwrap();
        let b = CatalogId::for_record(&r.envelope.identity, "20261007-b").unwrap();
        members.push(GroupMember {
            envelope: r.envelope.clone(),
            catalogs: vec![a, b],
        });
        records.push(r);
    }
    (
        GroupDeclaration::new(members, &CatalogLimits::default()).unwrap(),
        records,
    )
}
fn ready(outcome: LookupOutcome) -> CompleteSet {
    match outcome {
        LookupOutcome::Ready(set) => set,
        _ => panic!("expected complete set"),
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_lookup_excludes_a_new_with_b_healthy_old_then_healthy_orphan_repair() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let (old, raw) = group(100, 1);
    let id = old.partitions[0].clone();
    store.publish(old.clone(), raw, deadline()).await.unwrap();
    let (new, raw) = group(200, 2);
    peer.fault("reject", &new.partitions[1].key()).await;
    assert_eq!(
        store
            .publish(new.clone(), raw, deadline())
            .await
            .unwrap_err(),
        Error::Status(403)
    );
    let cold = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let set = ready(cold.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 1);
    assert_eq!(
        set.acquisitions()[0].records()[0]
            .envelope
            .identity
            .fetched_at_ms,
        100
    );
    assert_eq!(set.excluded_groups(), 1);
    assert_eq!(set.dependencies().len(), 2);
    peer.fault("clear", "unused").await;
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![new.members[0].envelope.identity.period.clone()],
    };
    let l = CatalogLimits {
        list_keys: 1,
        ..CatalogLimits::default()
    };
    let repair = CatalogStore::new(peer.transport(), l).unwrap();
    assert!(matches!(
        repair.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Complete(_)
    ));
    let set = ready(cold.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 2);
    assert_eq!(set.acquisitions()[1].records().len(), 2);
    assert_eq!(set.excluded_groups(), 0);
    let result = set
        .fold(SelectionPolicy::ListReplace, |pages| {
            Ok(serde_json::Value::Array(
                pages
                    .iter()
                    .map(|p| serde_json::from_slice(&p.bytes).unwrap())
                    .collect(),
            ))
        })
        .unwrap()
        .unwrap();
    assert_eq!(result[0]["value"], 2);
    assert_eq!(result[1]["page"], 2);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forced_concurrent_cas_union_keeps_every_revision() {
    let peer = Peer::new();
    let (one, r1) = group(100, 1);
    let (two, r2) = group(200, 2);
    let id = one.partitions[0].clone();
    peer.fault("barrier", &id.key()).await;
    let a = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let b = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let (x, y) = tokio::join!(
        a.publish(one, r1, deadline()),
        b.publish(two, r2, deadline())
    );
    assert!(x.is_ok(), "first: {x:?}");
    assert!(y.is_ok(), "second: {y:?}");
    let set = ready(a.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 2);
    assert!(peer.puts(&id.key()).await >= 3);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn catalog_committed_drop_reconciles_and_late_commit_retry_rejection_stays_unknown() {
    for mode in ["drop-commit", "late-reject"] {
        let peer = Peer::new();
        let (d, raw) = group(100, 1);
        let id = d.partitions[0].clone();
        peer.fault(mode, &id.key()).await;
        let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        let result = store.publish(d, raw, deadline()).await;
        if mode == "drop-commit" {
            assert!(result.is_ok(), "{result:?}");
            assert_eq!(peer.puts(&id.key()).await, 1);
        } else {
            assert_eq!(result.unwrap_err(), Error::Ambiguous);
            assert_eq!(peer.puts(&id.key()).await, 2);
            let object = peer
                .transport()
                .get_control(&id.key(), 1024 * 1024)
                .await
                .unwrap();
            let catalog =
                Catalog::from_bytes(&object.body, &id, &CatalogLimits::default()).unwrap();
            assert_eq!(catalog.entries.len(), 2);
        }
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn direct_rejection_and_unexpected_accepted_status_do_not_acknowledge() {
    for (mode, status) in [("reject", 403), ("unexpected202", 202)] {
        let peer = Peer::new();
        let (d, raw) = group(100, 1);
        let id = d.partitions[0].clone();
        peer.fault(mode, &id.key()).await;
        let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        assert_eq!(
            store.publish(d, raw, deadline()).await.unwrap_err(),
            Error::Status(status)
        );
        assert_eq!(peer.puts(&id.key()).await, 1);
        assert!(matches!(
            store.lookup(&id, deadline()).await.unwrap(),
            LookupOutcome::Incomplete
        ));
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repair_full_scoped_empty_is_distinct_from_incomplete_or_invalid_list() {
    let peer = Peer::new();
    let (d, _) = group(100, 1);
    let scope = RepairScope {
        catalog: d.partitions[0].clone(),
        periods: vec![d.members[0].envelope.identity.period.clone()],
    };
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    assert!(matches!(
        store.lookup(&scope.catalog, deadline()).await.unwrap(),
        LookupOutcome::Incomplete
    ));
    assert!(matches!(
        store.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::CompleteEmpty { .. }
    ));
    peer.fault("bad-list", "").await;
    assert!(matches!(
        store.repair(&scope, deadline()).await,
        Err(Error::Corrupt(_))
    ));
    peer.fault("repeat-token", "").await;
    assert!(matches!(
        store.repair(&scope, deadline()).await,
        Err(Error::Corrupt(_))
    ));
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_after_partial_publication_never_creates_complete_and_repair_recovers() {
    let peer = Peer::new();
    let (d, raw) = group(100, 1);
    let id = d.partitions[0].clone();
    peer.fault("delay", &d.partitions[1].key()).await;
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    assert_eq!(
        store
            .publish(d.clone(), raw, Instant::now() + Duration::from_millis(70))
            .await
            .unwrap_err(),
        Error::Ambiguous
    );
    let fresh = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    assert!(matches!(
        fresh.lookup(&id, deadline()).await.unwrap(),
        LookupOutcome::Incomplete
    ));
    peer.fault("clear", "unused").await;
    let scope = RepairScope {
        catalog: id,
        periods: vec![d.members[0].envelope.identity.period.clone()],
    };
    assert!(matches!(
        fresh.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Complete(_)
    ));
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn absent_sibling_dependency_is_retained_when_old_complete_group_remains() {
    let peer = Peer::new();
    let (mut old, mut raw) = group(100, 1);
    for m in &mut old.members {
        m.catalogs.truncate(1);
    }
    old = GroupDeclaration::new(old.members, &CatalogLimits::default()).unwrap();
    let id = old.partitions[0].clone();
    let s = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    s.publish(old, std::mem::take(&mut raw), deadline())
        .await
        .unwrap();
    let (new, raw) = group(200, 2);
    let missing = new.partitions[1].clone();
    peer.fault("reject", &missing.key()).await;
    assert_eq!(
        s.publish(new, raw, deadline()).await.unwrap_err(),
        Error::Status(403)
    );
    let set = ready(s.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 1);
    assert_eq!(set.dependencies().len(), 2);
    let absent = set
        .dependencies()
        .iter()
        .find(|p| p.identity == missing)
        .unwrap();
    assert!(absent.etag.is_none());
    assert!(absent.generation.is_none());
    assert_eq!(set.excluded_groups(), 1);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bounded_or_corrupt_repair_never_means_empty_and_missing_descriptor_stays_excluded() {
    let peer = Peer::new();
    let (d, raw) = group(100, 1);
    let id = d.partitions[0].clone();
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![d.members[0].envelope.identity.period.clone()],
    };
    let s = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    s.publish(d.clone(), raw, deadline()).await.unwrap();
    let limits = CatalogLimits {
        list_keys: 1,
        list_pages: 1,
        ..CatalogLimits::default()
    };
    let capped = CatalogStore::new(peer.transport(), limits).unwrap();
    assert!(matches!(
        capped.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Incomplete
    ));
    peer.fault(
        "forget",
        &d.reference(&CatalogLimits::default())
            .unwrap()
            .descriptor_key()
            .unwrap(),
    )
    .await;
    assert!(matches!(
        s.lookup(&id, deadline()).await.unwrap(),
        LookupOutcome::Incomplete
    ));
    assert!(matches!(
        s.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Incomplete
    ));
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_publisher_leaves_safe_partial_group_then_repair() {
    let peer = Peer::new();
    let (d, raw) = group(100, 1);
    let id = d.partitions[0].clone();
    peer.fault("delay", &d.partitions[1].key()).await;
    let s = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let owned = s.clone();
    let declaration = d.clone();
    let task = tokio::spawn(async move { owned.publish(declaration, raw, deadline()).await });
    // Wait for actual A publication rather than a fixed scheduling assumption.
    let transport = peer.transport();
    let end = Instant::now() + Duration::from_secs(2);
    loop {
        if transport.get_control(&id.key(), 1024 * 1024).await.is_ok() {
            break;
        }
        assert!(Instant::now() < end);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let fresh = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    assert!(matches!(
        fresh.lookup(&id, deadline()).await.unwrap(),
        LookupOutcome::Incomplete
    ));
    peer.fault("clear", "unused").await;
    let scope = RepairScope {
        catalog: id,
        periods: vec![d.members[0].envelope.identity.period.clone()],
    };
    assert!(matches!(
        fresh.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Complete(_)
    ));
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn standalone_exact_euc_kr_bytes_recover_without_normalized_persistence() {
    let peer = Peer::new();
    let raw = RawRecord::new(
        "kma-web",
        "html",
        &ProviderKey::Named {
            id: "weather".into(),
        },
        Period {
            local_date: 20261007,
            slot: "1200".into(),
        },
        100,
        200,
        "text/html; charset=EUC-KR",
        None,
        vec![0xb0, 0xa1, 0xff, 0x00].into(),
        &Limits::default(),
    )
    .unwrap();
    let id = CatalogId::for_record(&raw.envelope.identity, "20261007").unwrap();
    RawRecordStore::new(peer.transport(), Limits::default())
        .unwrap()
        .publish(raw)
        .await
        .unwrap();
    let s = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![Period {
            local_date: 20261007,
            slot: "1200".into(),
        }],
    };
    assert!(matches!(
        s.repair(&scope, deadline()).await.unwrap(),
        RepairOutcome::Complete(_)
    ));
    let set = ready(s.lookup(&id, deadline()).await.unwrap());
    assert_eq!(
        &*set.acquisitions()[0].records()[0].bytes,
        &[0xb0, 0xa1, 0xff, 0x00]
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_409_retries_bounded_union_and_committed_500_reads_exact_union() {
    for (mode, puts) in [("conflict409", 2), ("commit500", 1)] {
        let peer = Peer::new();
        let (d, raw) = group(100, 1);
        let id = d.partitions[0].clone();
        peer.fault(mode, &id.key()).await;
        let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        store.publish(d, raw, deadline()).await.unwrap();
        let set = ready(store.lookup(&id, deadline()).await.unwrap());
        assert_eq!(set.acquisitions().len(), 1);
        assert_eq!(peer.puts(&id.key()).await, puts);
    }
}
