//! Private readiness behavior through the real shared process; only owned loopback inputs.
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

struct Process {
    child: Child,
    reader: Option<std::thread::JoinHandle<()>>,
}
impl Process {
    fn start() -> (Self, String, String) {
        Self::with_s3(None)
    }
    fn with_s3(endpoint: Option<&str>) -> (Self, String, String) {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "readiness::owned_readiness_process_child",
                "--ignored",
                "--nocapture",
            ])
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("LANG", "C")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        serde_json::to_writer(
            child.stdin.take().unwrap(),
            &serde_json::json!({"s3":endpoint}),
        )
        .unwrap();
        let stream = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if let Some(addresses) = line.strip_prefix("server2 public=") {
                    let _ = tx.send(addresses.to_owned());
                }
            }
        });
        let guard = Self {
            child,
            reader: Some(reader),
        };
        let addresses = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("owned process must bind");
        let (public, private) = addresses.split_once(" metrics=").unwrap();
        (
            guard,
            format!("http://{public}"),
            format!("http://{private}"),
        )
    }
    fn stop(&mut self) {
        let status = Command::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
            .status()
            .unwrap();
        assert!(status.success());
        let deadline = Instant::now() + Duration::from_secs(7);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "owned process must gracefully stop");
                break;
            }
            assert!(Instant::now() < deadline, "owned process stop deadline");
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(reader) = self.reader.take() {
            reader.join().unwrap();
        }
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[tokio::test]
async fn actual_shared_process_mounts_private_readiness_and_preserves_liveness() {
    let (mut process, public, private) = Process::start();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let health = client
        .get(format!("{public}/health"))
        .send()
        .await
        .unwrap()
        .status();
    let hidden = client
        .get(format!("{public}/internal/ready"))
        .send()
        .await
        .unwrap()
        .status();
    let metrics = client
        .get(format!("{private}/internal/metrics"))
        .send()
        .await
        .unwrap()
        .status();
    let ready = client
        .get(format!("{private}/internal/ready"))
        .send()
        .await
        .unwrap();
    let status = ready.status();
    let body = ready.text().await.unwrap();
    process.stop();
    assert_eq!(health, 200);
    assert_eq!(hidden, 404);
    assert_eq!(metrics, 200);
    assert_eq!(
        status, 200,
        "private readiness must be mounted in the actual process; body={body}"
    );
    let report: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(report["ready"], true);
    assert_eq!(report["process"], "ready");
    assert_eq!(report["push"], "not_required");
    assert_eq!(report["credentials"], "not_required");
    assert_eq!(report["s3"], "not_required");
}

#[test]
#[ignore = "owned process child, launched only by readiness checks"]
fn owned_readiness_process_child() {
    let config = server2::Config {
        public_addr: "127.0.0.1:0".parse().unwrap(),
        metrics_addr: "127.0.0.1:0".parse().unwrap(),
        ..Default::default()
    };
    let input: serde_json::Value = serde_json::from_reader(std::io::stdin()).unwrap();
    let endpoint = input["s3"].as_str().map(str::to_owned);
    if let Some(endpoint) = &endpoint {
        assert!(endpoint.starts_with("http://127.0.0.1:"));
    }
    let configured = endpoint.is_some();
    let vars = move |n: &str| match n {
        "SERVER2_NATIVE_FAMILIES" if configured => Some("notice".to_owned()),
        "SERVER2_S3_BUCKET" | "AWS_ACCESS_KEY" if configured => Some("server2-local".to_owned()),
        "AWS_SECRET_KEY" if configured => Some("server2-local-secret".to_owned()),
        "SERVER2_S3_REGION" if configured => Some("ap-northeast-2".to_owned()),
        _ => None,
    };
    let builtins = server2::gateway::runtime::Builtins {
        s3: endpoint,
        ..server2::gateway::runtime::Builtins::production()
    };
    server2::process::run(config, move || {
        server2::runtime_services::RuntimeServices::from_vars_at(&vars, &builtins)
    })
    .unwrap();
}

use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use server2::{
    SharedState,
    storage::{
        CatalogTransport, ControlObject, Error, Object, ObjectTransport, PreparedRecord,
        WriteCondition,
    },
    world::BoundedS3,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
};
use tokio::sync::{Notify, watch};
use tower::ServiceExt;

#[derive(Clone, Default)]
struct Storage(Arc<StorageState>);
#[derive(Default)]
struct StorageState {
    credentials_fail: AtomicBool,
    credentials_delay_ms: std::sync::atomic::AtomicU64,
    list_delay_ms: std::sync::atomic::AtomicU64,
    mode: AtomicU8,
    credentials: AtomicUsize,
    lists: AtomicUsize,
    writes: AtomicUsize,
    active: AtomicUsize,
    entered: Notify,
    release: Notify,
}
struct Active(Arc<StorageState>);
impl Drop for Active {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}
impl ObjectTransport for Storage {
    async fn ready(&self) -> Result<(), Error> {
        self.0.credentials.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(
            self.0.credentials_delay_ms.load(Ordering::SeqCst),
        ))
        .await;
        if self.0.credentials_fail.load(Ordering::SeqCst) {
            Err(Error::Invalid("private-synthetic-secret"))
        } else {
            Ok(())
        }
    }
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        self.0.writes.fetch_add(1, Ordering::SeqCst);
        Err(Error::Transport)
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        panic!("readiness never HEADs objects")
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        panic!("readiness never GETs objects")
    }
}
impl CatalogTransport for Storage {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        panic!("no control GET")
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        self.0.writes.fetch_add(1, Ordering::SeqCst);
        Err(Error::Transport)
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        keys: usize,
        cap: usize,
    ) -> Result<Vec<u8>, Error> {
        assert_eq!((prefix, token, keys, cap), ("raw/v2/", None, 1, 65536));
        self.0.lists.fetch_add(1, Ordering::SeqCst);
        self.0.active.fetch_add(1, Ordering::SeqCst);
        let _active = Active(self.0.clone());
        tokio::time::sleep(Duration::from_millis(
            self.0.list_delay_ms.load(Ordering::SeqCst),
        ))
        .await;
        match self.0.mode.load(Ordering::SeqCst) {
            1 => return Err(Error::Status(403)),
            2 => return Ok(b"<invalid private-synthetic-secret>".to_vec()),
            3 => return Ok(vec![b'x'; cap + 1]),
            4 => {
                self.0.entered.notify_one();
                self.0.release.notified().await;
            }
            5 => return Err(Error::Status(503)),
            _ => (),
        }
        Ok(br#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>"#.to_vec())
    }
}
fn state() -> Arc<SharedState> {
    Arc::new(SharedState::new(&server2::Config {
        cpu_limit: 1,
        ..Default::default()
    }))
}
fn app(storage: BoundedS3<Storage>, stop: watch::Receiver<bool>) -> Router {
    server2::readiness::router(None, Some(storage), state(), stop)
}
async fn query(app: Router, method: &str) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    let r = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/internal/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status().as_u16();
    let headers = r.headers().clone();
    (
        status,
        headers,
        to_bytes(r.into_body(), 2048).await.unwrap().to_vec(),
    )
}
fn report(reply: &(u16, axum::http::HeaderMap, Vec<u8>)) -> serde_json::Value {
    assert_eq!(reply.1["cache-control"], "no-store");
    let body = String::from_utf8(reply.2.clone()).unwrap();
    assert!(!body.contains("private-synthetic-secret"));
    let d: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(d.as_object().unwrap().len(), 5);
    d
}
#[tokio::test]
async fn bounded_empty_list_faults_and_recovery_keep_fixed_private_states() {
    let storage = Storage::default();
    let (_tx, rx) = watch::channel(false);
    let app = app(BoundedS3::new(storage.clone(), 1), rx);
    for mode in [0, 1, 2, 3, 5, 0] {
        storage.0.mode.store(mode, Ordering::SeqCst);
        let reply = query(app.clone(), "GET").await;
        let d = report(&reply);
        assert_eq!(reply.0, if mode == 0 { 200 } else { 503 });
        assert_eq!(d["credentials"], "ready");
        assert_eq!(d["s3"], if mode == 0 { "ready" } else { "unavailable" });
    }
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), 6);
    assert_eq!(storage.0.writes.load(Ordering::SeqCst), 0);
    storage.0.credentials_fail.store(true, Ordering::SeqCst);
    let reply = query(app.clone(), "GET").await;
    let d = report(&reply);
    assert_eq!(reply.0, 503);
    assert_eq!(d["credentials"], "unavailable");
    assert_eq!(d["s3"], "not_checked");
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), 6);
    storage.0.credentials_fail.store(false, Ordering::SeqCst);
    assert_eq!(query(app.clone(), "GET").await.0, 200);
    let reads = storage.0.credentials.load(Ordering::SeqCst);
    assert_eq!(query(app.clone(), "POST").await.0, 405);
    assert_eq!(storage.0.credentials.load(Ordering::SeqCst), reads);
    let head = query(app, "HEAD").await;
    assert_eq!(head.0, 200);
    assert!(head.2.is_empty());
    assert_eq!(head.1["cache-control"], "no-store");
}
#[tokio::test]
async fn stop_during_probe_and_lost_watch_sender_cannot_return_stale_success() {
    let storage = Storage::default();
    storage.0.mode.store(4, Ordering::SeqCst);
    let (tx, rx) = watch::channel(false);
    let app = app(BoundedS3::new(storage.clone(), 1), rx);
    let job = tokio::spawn(query(app.clone(), "GET"));
    tokio::time::timeout(Duration::from_secs(1), storage.0.entered.notified())
        .await
        .unwrap();
    tx.send_replace(true);
    storage.0.release.notify_one();
    let reply = job.await.unwrap();
    let d = report(&reply);
    assert_eq!(reply.0, 503);
    assert_eq!(d["process"], "stopping");
    assert_eq!(d["s3"], "ready");
    let count = storage.0.credentials.load(Ordering::SeqCst);
    let reply = query(app, "GET").await;
    let d = report(&reply);
    assert_eq!(d["s3"], "not_checked");
    assert_eq!(storage.0.credentials.load(Ordering::SeqCst), count);
    let (tx, rx) = watch::channel(false);
    drop(tx);
    let reply = query(self::app(BoundedS3::new(storage, 1), rx), "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(report(&reply)["process"], "stopping");
}
#[tokio::test]
async fn cancelled_probe_releases_shared_s3_admission_without_detached_request() {
    let storage = Storage::default();
    storage.0.mode.store(4, Ordering::SeqCst);
    let s3 = BoundedS3::new(storage.clone(), 1);
    let (_tx, rx) = watch::channel(false);
    let app = app(s3.clone(), rx);
    let job = tokio::spawn(query(app.clone(), "GET"));
    tokio::time::timeout(Duration::from_secs(1), storage.0.entered.notified())
        .await
        .unwrap();
    assert_eq!(s3.available(), 0);
    job.abort();
    assert!(job.await.unwrap_err().is_cancelled());
    assert_eq!(storage.0.active.load(Ordering::SeqCst), 0);
    assert_eq!(s3.available(), 1);
    storage.0.mode.store(0, Ordering::SeqCst);
    assert_eq!(query(app, "GET").await.0, 200);
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), 2);
    assert_eq!(storage.0.writes.load(Ordering::SeqCst), 0);
}
#[tokio::test(start_paused = true)]
async fn one_deadline_includes_waiting_for_existing_s3_admission() {
    let storage = Storage::default();
    storage.0.mode.store(4, Ordering::SeqCst);
    let s3 = BoundedS3::new(storage.clone(), 1);
    let held = s3.clone();
    let hold = tokio::spawn(async move { held.list_raw_document("raw/v2/", None, 1, 65536).await });
    storage.0.entered.notified().await;
    let (_tx, rx) = watch::channel(false);
    let app = app(s3.clone(), rx);
    let began = tokio::time::Instant::now();
    let reply = query(app.clone(), "GET").await;
    assert_eq!(reply.0, 503);
    assert!(began.elapsed() <= Duration::from_secs(3));
    assert_eq!(
        storage.0.lists.load(Ordering::SeqCst),
        1,
        "only the separate held request reached transport"
    );
    assert_eq!(s3.available(), 0);
    hold.abort();
    assert!(hold.await.unwrap_err().is_cancelled());
    storage.0.mode.store(0, Ordering::SeqCst);
    tokio::time::resume();
    let reply = query(app, "GET").await;
    assert_eq!(reply.0, 200);
    assert_eq!(s3.available(), 1);
}
#[tokio::test]
async fn cpu_exhaustion_fails_closed_and_recovers_without_creating_another_pool() {
    let state = state();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let entered = Arc::new(Notify::new());
    let signal = entered.clone();
    let owned = state.clone();
    let work = tokio::spawn(async move {
        owned
            .run_cpu(move || {
                signal.notify_one();
                let _ = release_rx.recv_timeout(Duration::from_secs(5));
            })
            .await
            .unwrap();
    });
    tokio::time::timeout(Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    assert_eq!(state.cpu_available(), 0);
    let storage = Storage::default();
    let (_tx, rx) = watch::channel(false);
    let app = server2::readiness::router(None, Some(BoundedS3::new(storage, 1)), state.clone(), rx);
    let reply = query(app.clone(), "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(report(&reply)["s3"], "unavailable");
    release_tx.send(()).unwrap();
    work.await.unwrap();
    assert_eq!(state.cpu_available(), 1);
    assert_eq!(query(app, "GET").await.0, 200);
}
#[tokio::test]
async fn canonical_push_restore_and_closed_writer_prevent_a_ready_snapshot() {
    let peer = super::common::Peer::new();
    let services = peer.services("push");
    super::common::ready(&services).await;
    let push = services.push.as_ref().unwrap();
    let (_tx, rx) = watch::channel(false);
    let storage = Storage::default();
    let app = server2::readiness::router(
        Some(push.clone()),
        Some(BoundedS3::new(storage.clone(), 1)),
        state(),
        rx,
    );
    let reply = query(app.clone(), "GET").await;
    assert_eq!(reply.0, 200);
    assert_eq!(report(&reply)["push"], "ready");
    storage.0.mode.store(4, Ordering::SeqCst);
    let pending = tokio::spawn(query(app.clone(), "GET"));
    tokio::time::timeout(Duration::from_secs(1), storage.0.entered.notified())
        .await
        .unwrap();
    push.quiesce();
    assert!(
        push.drain(tokio::time::Instant::now() + Duration::from_secs(3))
            .await
    );
    assert!(!push.ready());
    storage.0.release.notify_one();
    let pending_reply = pending.await.unwrap();
    assert_eq!(pending_reply.0, 503);
    assert_eq!(report(&pending_reply)["push"], "not_ready");
    let before = storage.0.lists.load(Ordering::SeqCst);
    let reply = query(app, "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(report(&reply)["push"], "not_ready");
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), before);
}

#[tokio::test(start_paused = true)]
async fn credentials_and_network_share_one_deadline_without_per_phase_reset() {
    let storage = Storage::default();
    storage.0.credentials_delay_ms.store(2000, Ordering::SeqCst);
    storage.0.list_delay_ms.store(2000, Ordering::SeqCst);
    let s3 = BoundedS3::new(storage.clone(), 1);
    let (_tx, rx) = watch::channel(false);
    let app = app(s3.clone(), rx);
    let began = tokio::time::Instant::now();
    let reply = query(app.clone(), "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(began.elapsed(), Duration::from_secs(3));
    assert_eq!(report(&reply)["credentials"], "ready");
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), 1);
    assert_eq!(storage.0.active.load(Ordering::SeqCst), 0);
    assert_eq!(s3.available(), 1);
    storage.0.credentials_delay_ms.store(4000, Ordering::SeqCst);
    storage.0.list_delay_ms.store(0, Ordering::SeqCst);
    let reply = query(app.clone(), "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(report(&reply)["credentials"], "unavailable");
    assert_eq!(storage.0.lists.load(Ordering::SeqCst), 1);
    storage.0.credentials_delay_ms.store(0, Ordering::SeqCst);
    tokio::time::resume();
    assert_eq!(query(app, "GET").await.0, 200);
}

#[tokio::test]
async fn failed_push_restore_is_not_ready_and_skips_dependency_probe() {
    let peer = super::common::Peer::new();
    let s3 = peer.services("notice").s3.unwrap();
    assert_eq!(
        s3.put_control(
            "index/v2/push/state/head.json",
            b"invalid-owned-restore",
            &WriteCondition::Absent
        )
        .await
        .unwrap(),
        200
    );
    let services = peer.services("push");
    let push = services.push.unwrap();
    let client = reqwest::Client::new();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let counts: serde_json::Value = serde_json::from_slice(
                &client
                    .get(format!("{}__catalog/status", peer.endpoint))
                    .send()
                    .await
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap(),
            )
            .unwrap();
            if counts["GET index/v2/push/state/head.json"]
                .as_u64()
                .unwrap_or(0)
                > 0
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!push.ready());
    let storage = Storage::default();
    let (_tx, rx) = watch::channel(false);
    let app = server2::readiness::router(
        Some(push.clone()),
        Some(BoundedS3::new(storage.clone(), 1)),
        state(),
        rx,
    );
    let reply = query(app, "GET").await;
    assert_eq!(reply.0, 503);
    assert_eq!(report(&reply)["push"], "not_ready");
    assert_eq!(report(&reply)["s3"], "not_checked");
    assert_eq!(storage.0.credentials.load(Ordering::SeqCst), 0);
    push.quiesce();
    let _ = push
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    assert_eq!(
        s3.get_control("index/v2/push/state/head.json", 1024)
            .await
            .unwrap()
            .body,
        b"invalid-owned-restore"
    );
}

async fn wire_workflow() {
    let peer = super::common::Peer::new();
    let (mut process, public, private) = Process::with_s3(Some(&peer.endpoint));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap();
    let mut statuses = Vec::new();
    for (mode, expected) in [("clear", 200), ("bad-list", 503), ("clear", 200)] {
        peer.fault(mode, "raw/v2/readiness").await;
        let r = client
            .get(format!("{private}/internal/ready"))
            .send()
            .await
            .unwrap();
        let status = r.status().as_u16();
        assert_eq!(r.headers()["cache-control"], "no-store");
        let body = r.bytes().await.unwrap().to_vec();
        let d: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status, expected);
        assert_eq!(d["credentials"], "ready");
        assert_eq!(d["push"], "not_required");
        assert_eq!(d.as_object().unwrap().len(), 5);
        statuses.push(status);
    }
    assert_eq!(
        client
            .get(format!("{public}/health"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{public}/internal/ready"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        client
            .get(format!("{private}/internal/metrics"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        client
            .post(format!("{private}/internal/ready"))
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    let counters: serde_json::Value = serde_json::from_slice(
        &client
            .get(format!("{}__catalog/status", peer.endpoint))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(counters["OP LIST raw/v2/"], 3);
    assert!(
        counters
            .as_object()
            .unwrap()
            .keys()
            .all(|k| !k.starts_with("OP PUT ")),
        "readiness performs no S3 writes"
    );
    process.stop();
    for endpoint in [&public, &private] {
        let address = endpoint.strip_prefix("http://").unwrap();
        assert!(
            std::net::TcpStream::connect_timeout(
                &address.parse().unwrap(),
                Duration::from_millis(100)
            )
            .is_err()
        );
    }
    println!(
        "READINESS_WIRE_REPORT {}",
        serde_json::json!({"statuses":statuses,"list_requests":3,"s3_writes":0,"public_health":200,"public_readiness":404,"private_metrics":200,"wrong_method":405,"listeners_closed":true,"scope":"owned real shared process and signed loopback S3; no host/IAM/provider/device qualification"})
    );
}
#[tokio::test]
async fn actual_process_uses_shared_signed_s3_for_failure_and_recovery() {
    wire_workflow().await;
}
#[tokio::test]
#[ignore = "separate optimized owned functional CLI workflow"]
async fn owned_readiness_wire_smoke() {
    wire_workflow().await;
}
