use server2::{Config, SharedState, gateway::runtime::Builtins, runtime_services::RuntimeServices};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};

mod firebase_fixture {
    include!("../support/firebase.rs");
}

/// Owned public test vector; never reads host Firebase settings or credentials.
struct CredentialFixture {
    dir: std::path::PathBuf,
    account: std::path::PathBuf,
}
impl CredentialFixture {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        loop {
            let dir = std::env::temp_dir().join(format!(
                "server2-runtime-account-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => {
                    let account =
                        firebase_fixture::account_file(&dir, "todayWeather", "runtime-oracle");
                    return Self { dir, account };
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("owned fixture directory: {e}"),
            }
        }
    }
}
impl Drop for CredentialFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.account);
        let _ = std::fs::remove_dir(&self.dir);
    }
}

pub struct Peer {
    child: Child,
    pub endpoint: String,
    credentials: CredentialFixture,
}
impl Peer {
    pub fn new() -> Self {
        Self::start(&[])
    }
    /// Case-specific HTTP reuse; the default peer and its admission/socket bounds stay unchanged.
    pub fn persistent() -> Self {
        Self::start(&["--persistent"])
    }
    fn start(args: &[&str]) -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .args(args)
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.starts_with("http://127.0.0.1:"));
        Self {
            child,
            endpoint: line.trim().to_owned(),
            credentials: CredentialFixture::new(),
        }
    }
    pub fn builtins(&self) -> Builtins {
        let dead = "http://127.0.0.1:9/".to_owned();
        Builtins {
            s3: Some(self.endpoint.clone()),
            instance_metadata: Some(dead.clone()),
            data_go_kr: dead.clone(),
            kma: dead.clone(),
            kma_weather: dead.clone(),
            mfds: dead.clone(),
            airkorea_images: dead.clone(),
            vc: dead.clone(),
            google_air: dead.clone(),
            openweather: dead.clone(),
            waqi: dead.clone(),
            kakao: dead.clone(),
            google: dead,
            ..Builtins::production()
        }
    }
    pub fn vars(&self, families: &str) -> impl Fn(&str) -> Option<String> + use<> {
        let families = families.to_owned();
        let account = self.credentials.account.to_str().unwrap().to_owned();
        move |n| match n {
            "SERVER2_NATIVE_FAMILIES" => Some(families.clone()),
            "SERVER2_S3_BUCKET" | "AWS_ACCESS_KEY" => Some("server2-local".into()),
            "AWS_SECRET_KEY" => Some("server2-local-secret".into()),
            "SERVER2_S3_REGION" => Some("ap-northeast-2".into()),
            "DONGNAE_SECRET_KEYS" => Some(r#"["synthetic-data-go-kr-key-0001"]"#.into()),
            "VC_SECRET_KEY" => Some("synthetic-vc-key".into()),
            "SERVER2_FIREBASE_TODAYWEATHER" => Some(account.clone()),
            _ => None,
        }
    }
    pub fn services(&self, families: &str) -> RuntimeServices {
        RuntimeServices::from_vars_at(&self.vars(families), &self.builtins()).unwrap()
    }
    pub async fn fault(&self, mode: &str, key: &str) {
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

pub struct Http {
    pub base: String,
    task: tokio::task::JoinHandle<()>,
}
impl Http {
    pub async fn new(services: RuntimeServices) -> Self {
        let config = Config::default();
        let app = services.public_router(Arc::new(SharedState::new(&config)));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { base, task }
    }
}
impl Drop for Http {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub async fn ready(s: &RuntimeServices) {
    if let Some(push) = &s.push {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !push.ready() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn fixture_http_reuse_is_case_specific_and_default_is_unchanged() {
    for (peer, version) in [
        (Peer::new(), reqwest::Version::HTTP_10),
        (Peer::persistent(), reqwest::Version::HTTP_11),
    ] {
        let client = reqwest::Client::new();
        for _ in 0..2 {
            let response = client
                .get(format!("{}__catalog/status", peer.endpoint))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.version(), version);
            let _: serde_json::Value =
                serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        }
    }
}

/// Mutually exclusive owned rehearsal scenarios, not production modes/settings.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WarningCase {
    NoHttp,
    Shared,
    HeldStop,
    Recurring,
    HttpOnly,
    FailedBind,
}
/// Real bind/start/stop plus owned provider/native S3. The quiet prior baseline is explicit.
pub async fn warning_case(case: WarningCase) -> serde_json::Value {
    let families = if case == WarningCase::HttpOnly {
        "kma"
    } else {
        "push"
    };
    let bind_failure = case == WarningCase::FailedBind;
    let race = case == WarningCase::Shared;
    let stop_held = case == WarningCase::HeldStop;
    let repeat = case == WarningCase::Recurring;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
    let peer = Peer::new();
    let changed = Arc::new(AtomicUsize::new(1));
    let calls = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider_addr = listener.local_addr().unwrap();
    let c = changed.clone();
    let n = calls.clone();
    let (release, released) = tokio::sync::watch::channel(!(race || stop_held));
    let entered = Arc::new(AtomicBool::new(false));
    let e = entered.clone();
    let app = axum::Router::new().fallback(move |uri: axum::http::Uri| {
        let c = c.clone();
        let n = n.clone();
        let mut released = released.clone();
        let e = e.clone();
        async move {
            n.fetch_add(1, SeqCst);
            if c.load(SeqCst) > 1 {
                e.store(true, SeqCst);
                while !*released.borrow_and_update() {
                    if released.changed().await.is_err() {
                        break;
                    }
                }
            }
            let rows = if uri.path().ends_with("getPwnCd") {
                serde_json::json!([{"areaCode":"L1082700","areaName":"Synthetic",
                    "cancel":"0","command":"1","stnId":"108","tmFc":202610162100_i64,
                    "tmSeq":c.load(SeqCst),"warnVar":1,"warnStress":0,
                    "startTime":202610162100_i64,"endTime":0,"allEndTime":0}])
            } else {
                serde_json::json!([])
            };
            axum::Json(serde_json::json!({"response":{"header":{"resultCode":"00"},
                "body":{"items":{"item":rows},"totalCount":rows.as_array().unwrap().len(),
                "pageNo":1,"numOfRows":10000}}}))
        }
    });
    let (provider_stop, provider_stopped) = tokio::sync::oneshot::channel::<()>();
    let mut provider = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = provider_stopped.await;
            })
            .await
            .unwrap()
    });
    let mut builtins = peer.builtins();
    builtins.data_go_kr = format!("http://{provider_addr}/");
    let defaults = peer.vars("push");
    let services = RuntimeServices::from_vars_with_fcm(
        &defaults,
        &builtins,
        server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
    )
    .unwrap();
    assert_eq!(
        calls.load(SeqCst),
        0,
        "factory construction performs no acquisition"
    );
    ready(&services).await;
    let feed = services.warning_feed.clone().unwrap();
    services
        .warning_acquire
        .as_ref()
        .unwrap()
        .acquire(server2::domestic::kma::source::fetch::ForecastRequest::Warnings)
        .await
        .unwrap();
    assert!(
        feed.read().await.unwrap().is_empty(),
        "declared quiet durable baseline"
    );
    if let Some(push) = &services.push {
        push.quiesce();
        assert!(
            push.drain(tokio::time::Instant::now() + Duration::from_secs(3))
                .await
        );
    }
    let before_counts: serde_json::Value = serde_json::from_slice(
        &reqwest::get(format!("{}__catalog/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    let source_count = |counts: &serde_json::Value| -> u64 {
        counts
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with("PUT raw/") && k.contains("pwn-cd"))
            .map(|(_, v)| v.as_u64().unwrap())
            .sum()
    };
    let before_source_puts = source_count(&before_counts);
    let before = calls.load(SeqCst);
    changed.store(2, SeqCst);
    let (started, bound) = tokio::sync::oneshot::channel();
    let (cycle_sender, cycle_receiver) = tokio::sync::oneshot::channel();
    let occupied = if bind_failure {
        Some(std::net::TcpListener::bind("127.0.0.1:0").unwrap())
    } else {
        None
    };
    let metrics_addr = occupied.as_ref().map_or_else(
        || "127.0.0.1:0".parse().unwrap(),
        |l| l.local_addr().unwrap(),
    );
    let process_vars = peer.vars(families);
    let enabled = families == "push";
    let process = std::thread::spawn(move || {
        server2::process::run_with_listener_hook(
            Config {
                public_addr: "127.0.0.1:0".parse().unwrap(),
                metrics_addr,
                ..Config::default()
            },
            move || {
                let services = RuntimeServices::from_vars_with_fcm(
                    &process_vars,
                    &builtins,
                    server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
                )?;
                let _ = cycle_sender.send(services.warning_cycles.clone());
                Ok(services)
            },
            move |listener| {
                let _ = started.send(listener);
            },
        )
        .map_err(|e| e.to_string())
    });
    // A known bind failure never invokes the hook; its captured sender can live through
    // the pre-existing push-writer34s drain. Do not mistake that for a five-second bind signal.
    let mut handle = if bind_failure {
        None
    } else {
        tokio::time::timeout(Duration::from_secs(5), bound)
            .await
            .unwrap()
            .ok()
    };
    let bound_ok = handle.is_some();
    let cycles = cycle_receiver.await.unwrap();
    let mut join_ms = 0;
    if race && bound_ok {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !entered.load(SeqCst) {
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .unwrap();
        let began = tokio::time::Instant::now();
        let mut joins = tokio::task::JoinSet::new();
        for _ in 0..4 {
            let cycles = cycles.clone().unwrap();
            joins.spawn(async move {
                cycles
                    .cycle(tokio::time::Instant::now() + Duration::from_secs(30))
                    .await;
            });
        }
        while let Some(result) = joins.join_next().await {
            result.unwrap();
        }
        join_ms = began.elapsed().as_millis();
    }
    let mut drain_waited_for_provider = false;
    if stop_held && bound_ok {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !entered.load(SeqCst) {
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
        .await
        .unwrap();
        handle.take().unwrap().abort();
        tokio::time::sleep(Duration::from_millis(100)).await;
        drain_waited_for_provider = !process.is_finished();
    }
    release.send_replace(true);

    // Only the durable test observer reads. No request enters either product listener.
    let mut events = if bound_ok {
        tokio::time::timeout(
            if enabled {
                Duration::from_secs(4)
            } else {
                Duration::from_millis(150)
            },
            async {
                loop {
                    let events = feed.read().await.unwrap();
                    if !events.is_empty() {
                        break events.len();
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            },
        )
        .await
        .unwrap_or(0)
    } else {
        0
    };
    let mut cadence_ms = None;
    if repeat && events == 1 {
        let first = tokio::time::Instant::now();
        changed.store(3, SeqCst);
        events = tokio::time::timeout(Duration::from_secs(185), async {
            loop {
                let events = feed.read().await.unwrap();
                if events.len() >= 2 {
                    break events.len();
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .unwrap_or(events);
        cadence_ms = Some(first.elapsed().as_millis());
    }
    // Always stop/join before behavioral assertions, including the intended parent Red.
    if let Some(handle) = handle {
        handle.abort();
    }
    let result = tokio::task::spawn_blocking(move || process.join().unwrap())
        .await
        .unwrap();
    drop(occupied);
    let counts: serde_json::Value = serde_json::from_slice(
        &reqwest::get(format!("{}__catalog/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    let source_put = counts
        .as_object()
        .unwrap()
        .keys()
        .any(|k| k.starts_with("PUT raw/") && k.contains("pwn-cd"));
    let new_source_puts = source_count(&counts) - before_source_puts;
    let provider_calls = calls.load(SeqCst) - before;
    let _ = provider_stop.send(());
    let provider_joined = match tokio::time::timeout(Duration::from_secs(3), &mut provider).await {
        Ok(Ok(())) => true,
        _ => {
            provider.abort();
            let _ = provider.await;
            false
        }
    };
    let provider_closed =
        provider_joined && tokio::net::TcpStream::connect(provider_addr).await.is_err();
    let peer_addr = reqwest::Url::parse(&peer.endpoint)
        .unwrap()
        .socket_addrs(|| None)
        .unwrap()[0];
    drop(peer);
    let storage_closed = tokio::net::TcpStream::connect(peer_addr).await.is_err();
    serde_json::json!({"provider_calls_after_bind":provider_calls,"baseline_provider_calls":before,
        "drain_waited_for_provider":drain_waited_for_provider,
        "shared_waiters":if race {4} else {0},"shared_wait_ms":join_ms,"cadence_ms":cadence_ms,"feed_events":events,
        "native_source_put":source_put,"new_native_source_puts":new_source_puts,
        "product_http_requests":0,"fcm_isolation":"empty registrations; endpoints closed loopback:9",
        "storage_listener_closed":storage_closed,
        "baseline":"explicit prior quiet durable warning","provider_listener_closed":provider_closed,"provider_graceful_joined":provider_joined,"provider_port":provider_addr.port(),
        "process_listener_failure_reported":result.is_err(),"bound":bound_ok,"families":families})
}
