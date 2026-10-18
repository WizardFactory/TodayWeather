//! Narrative error-cache recovery with an injected slow index read and actual owned S3.
use server2::{
    gateway::BoxFuture,
    history::IndexListing,
    narrative::{
        self, Read,
        provider::{Page, Source},
        store::{Service, Store},
    },
    providers::AcquisitionError,
    storage::{
        CatalogTransport, ControlObject, Error, HttpS3Transport, ListPage, Object, ObjectTransport,
        PreparedRecord, WriteCondition,
    },
    world::BoundedS3,
};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::time::Instant;
struct OwnedS3 {
    child: Option<Child>,
    endpoint: String,
}
impl OwnedS3 {
    fn start() -> Self {
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
            Ok(Ok(line)) if line.starts_with("http://127.0.0.1:") => Self {
                child: Some(child),
                endpoint: line.trim().into(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("owned S3 startup: {other:?}")
            }
        }
    }
    fn stop(&mut self) -> bool {
        self.child.take().is_none_or(|mut c| {
            let _ = c.kill();
            c.wait().is_ok()
        })
    }
}
impl Drop for OwnedS3 {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
#[derive(Clone)]
struct SlowIndex {
    inner: BoundedS3<HttpS3Transport>,
    calls: Arc<AtomicUsize>,
}
impl ObjectTransport for SlowIndex {
    async fn put(&self, r: &PreparedRecord) -> Result<u16, Error> {
        self.inner.put(r).await
    }
    async fn head(&self, k: &str) -> Result<Object, Error> {
        self.inner.head(k).await
    }
    async fn get(&self, k: &str, m: usize) -> Result<Object, Error> {
        self.inner.get(k, m).await
    }
    async fn ready(&self) -> Result<(), Error> {
        self.inner.ready().await
    }
}
impl CatalogTransport for SlowIndex {
    async fn get_control(&self, k: &str, m: usize) -> Result<ControlObject, Error> {
        self.inner.get_control(k, m).await
    }
    async fn put_control(&self, k: &str, b: &[u8], c: &WriteCondition) -> Result<u16, Error> {
        self.inner.put_control(k, b, c).await
    }
    async fn list_raw_document(
        &self,
        p: &str,
        t: Option<&str>,
        n: usize,
        b: usize,
    ) -> Result<Vec<u8>, Error> {
        self.inner.list_raw_document(p, t, n, b).await
    }
}
impl IndexListing for SlowIndex {
    async fn list_index(&self, p: &str, t: Option<&str>) -> Result<ListPage, Error> {
        if self.calls.fetch_add(1, SeqCst) == 0 {
            // An injected delayed storage operation, not a measured real S3 latency.
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        self.inner.list_index(p, t).await
    }
}
struct NoProvider;
impl Source for NoProvider {
    fn fetch(&self, _: u16, _: Instant) -> BoxFuture<'_, Result<Option<Page>, AcquisitionError>> {
        Box::pin(async { panic!("a stored narrative read must not call providers") })
    }
}
#[tokio::main]
async fn main() {
    let mut peer = OwnedS3::start();
    let transport = BoundedS3::new(
        HttpS3Transport::new(
            &peer.endpoint,
            "server2-local",
            "ap-northeast-2",
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        4,
    );
    let now = narrative::now_ms();
    let tm = format!("{}0000", server2::warnings::provider::kst_date(now, 0));
    let body=serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"items":{"item":[{"stnId":108,"tmFc":tm,"wfSv1":"Owned stored narrative recovery"}]}}}})).unwrap();
    let expected = Store::new(transport.clone())
        .unwrap()
        .publish(
            108,
            Page {
                body: Arc::from(body),
                fetched_at_ms: now as u64,
                content_type: "application/json".into(),
            },
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap()
        .expect("owned narrative publication");
    let calls = Arc::new(AtomicUsize::new(0));
    let service = Service::new(
        SlowIndex {
            inner: transport,
            calls: calls.clone(),
        },
        Arc::new(NoProvider),
    )
    .unwrap();
    let started = Instant::now();
    assert!(
        service
            .read(108, Instant::now() + Duration::from_millis(20))
            .await
            .is_none()
    );
    let first_elapsed_ms = started.elapsed().as_millis();
    assert_eq!(calls.load(SeqCst), 1);
    let recovered = service
        .read(108, Instant::now() + Duration::from_secs(3))
        .await
        .expect("next request must recover stored narrative immediately");
    assert_eq!(
        serde_json::to_value(&recovered).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let recovered_indexes = calls.load(SeqCst);
    assert!(recovered_indexes > 1);
    let cached = service
        .read(108, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&cached).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    assert_eq!(
        calls.load(SeqCst),
        recovered_indexes,
        "fresh value keeps the existing cache"
    );
    drop(service);
    let reaped = peer.stop();
    assert!(reaped);
    println!("{}",serde_json::to_string(&serde_json::json!({"verdict":"PASS","scope":"public narrative Service with actual owned S3 publication/readback and one injected slow index access",
        "first_request_omitted":true,"first_request_elapsed_ms":first_elapsed_ms,"recovered_exact_narrative":true,"index_calls_after_recovery":recovered_indexes,
        "cached_read_added_indexes":0,"owned_s3_child_reaped":reaped,"live_provider_calls":0,"production_eligible":false,
        "limit":"injected delay before first S3 delegate, not measured provider/S3 host latency; current local wall date and synthetic prose"})).unwrap());
}
