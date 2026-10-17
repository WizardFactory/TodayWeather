use server2::storage::*;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::time::Instant;
struct Peer {
    child: Child,
    root: String,
}
impl Peer {
    fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let r = BufReader::new(output).read_line(&mut line);
            let _ = tx.send(r.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(root)) if root.starts_with("http://127.0.0.1:") => Self {
                child,
                root: root.trim().into(),
            },
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("owned peer startup");
            }
        }
    }
    fn transport(&self) -> HttpS3Transport {
        HttpS3Transport::new(
            &self.root,
            "server2-local",
            "ap-northeast-2",
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap()
    }
    async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.root).parse().unwrap();
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
                .status(),
            204
        );
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn raw(value: &str, fetched: u64) -> RawRecord {
    RawRecord::new(
        "kma-forecast-narrative",
        "overview",
        &ProviderKey::Named { id: "108".into() },
        Period {
            local_date: 20261017,
            slot: "1100".into(),
        },
        fetched,
        200,
        "application/json",
        None,
        value.as_bytes().to_vec().into(),
        &Limits::default(),
    )
    .unwrap()
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
#[tokio::test]
async fn first_commit_wins_even_if_later_fetch_timestamp_is_earlier() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let first = raw("first", 200);
    let second = raw("different", 100);
    let id = CatalogId::for_record(&first.envelope.identity, "202610171100").unwrap();
    let winner = store
        .publish_once(id.clone(), first.clone(), deadline())
        .await
        .unwrap();
    assert_eq!(winner.bytes, first.bytes);
    assert_eq!(
        store
            .publish_once(id.clone(), second, deadline())
            .await
            .unwrap()
            .bytes,
        first.bytes
    );
    let object = peer
        .transport()
        .get_control(&id.key(), 1_048_576)
        .await
        .unwrap();
    assert_eq!(
        Catalog::from_bytes(&object.body, &id, &CatalogLimits::default())
            .unwrap()
            .entries
            .len(),
        1
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn competing_conditional_publications_share_one_durable_winner() {
    let peer = Peer::new();
    let a = raw("a", 100);
    let b = raw("b", 200);
    let id = CatalogId::for_record(&a.envelope.identity, "202610171100").unwrap();
    peer.fault("barrier", &id.key()).await;
    let one = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let two = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let (a, b) = tokio::join!(
        one.publish_once(id.clone(), a, deadline()),
        two.publish_once(id.clone(), b, deadline())
    );
    assert_eq!(a.unwrap().envelope, b.unwrap().envelope);
    let object = peer
        .transport()
        .get_control(&id.key(), 1_048_576)
        .await
        .unwrap();
    assert_eq!(
        Catalog::from_bytes(&object.body, &id, &CatalogLimits::default())
            .unwrap()
            .entries
            .len(),
        1
    );
}
#[tokio::test]
async fn lost_conditional_reply_reconciles_exact_raw_winner() {
    for fault in ["drop-commit", "commit500"] {
        let peer = Peer::new();
        let record = raw("durable", 100);
        let id = CatalogId::for_record(&record.envelope.identity, "202610171100").unwrap();
        peer.fault(fault, &id.key()).await;
        let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        assert_eq!(
            store
                .publish_once(id, record.clone(), deadline())
                .await
                .unwrap()
                .envelope,
            record.envelope
        );
    }
}
