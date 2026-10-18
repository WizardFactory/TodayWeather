//! B3 latest-Short policy: owned S3/provider peers, synthetic request time and real S08 funding.
use axum::{Router, extract::State, routing::get};
use serde_json::json;
use server2::{
    budget::{
        BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider,
    },
    domestic::{
        Acquired, DomesticAcquirer, DomesticError, KeyRing,
        asos::AsosRequest,
        family::{DataGoKrFamily, Endpoints, Service, WebRequest},
        kma::source::{
            Family, S3Source,
            fetch::{ForecastAcquire, ForecastRequest, Published},
            observe::{Acquire, Locate},
        },
        metrics::DomesticMetrics,
        publication::{self, Publication},
    },
    gateway::BoxFuture,
    history::{Grid, schedule},
    providers::{HttpProviderTransport, HttpPublicTransport, ProviderKey},
    storage::{CatalogLimits, HttpS3Transport, WriteCondition},
    world::BoundedS3,
};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::time::Instant;
const KEY: &str = "B3_OWNED_ONLY+synthetic+aaaaaaaaaaaaaaaa/=";
#[derive(Default)]
struct Memory(Mutex<BTreeMap<String, (Vec<u8>, u64)>>);
impl BudgetTransport for Memory {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        self.0
            .lock()
            .unwrap()
            .get(key)
            .map(|(body, version)| BudgetObject {
                body: body.clone(),
                etag: format!("\"{version}\""),
            })
            .ok_or(BudgetError::NotFound)
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        let mut map = self.0.lock().unwrap();
        let valid = match (condition, map.get(key)) {
            (WriteCondition::Absent, None) => true,
            (WriteCondition::Match(tag), Some((_, version))) => *tag == format!("\"{version}\""),
            _ => false,
        };
        if !valid {
            return Ok(412);
        }
        let version = map.get(key).map_or(1, |(_, v)| v + 1);
        map.insert(key.into(), (body.to_vec(), version));
        Ok(200)
    }
}
struct Time(Arc<AtomicI64>);
impl Clock for Time {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(SeqCst))
    }
}
struct Never;
impl Acquire for Never {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
}
impl Locate for Never {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { None })
    }
}
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
struct Peer {
    clock: Arc<AtomicI64>,
    base: i64,
    minutes: Mutex<Vec<i64>>,
}
async fn unavailable(State(p): State<Arc<Peer>>) -> Vec<u8> {
    p.minutes
        .lock()
        .unwrap()
        .push((p.clock.load(SeqCst) - p.base) / 60_000);
    serde_json::to_vec(
        &json!({"response":{"header":{"resultCode":"03","resultMsg":"NODATA_ERROR"}}}),
    )
    .unwrap()
}
struct Forecast {
    actual: Arc<DomesticAcquirer<HttpProviderTransport, HttpPublicTransport, Memory>>,
    clock: Arc<AtomicI64>,
    latest_starts: AtomicUsize,
    skipped_history: AtomicUsize,
}
impl ForecastAcquire for Forecast {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let ForecastRequest::DataGoKr(r) = request else {
            return Box::pin(async { Ok(None) });
        };
        if r.family() != DataGoKrFamily::VilageFcst
            || Some(r.publication()) != publication::short_base(self.clock.load(SeqCst))
        {
            // Isolate latest policy: historical provider work is a declared stub,
            // not an exercised/funded historical rollback or recovery claim.
            self.skipped_history.fetch_add(1, SeqCst);
            return Box::pin(async { Ok(None) });
        }
        self.latest_starts.fetch_add(1, SeqCst);
        let actual = self.actual.clone();
        Box::pin(async move {
            match actual
                .acquire(&r, Instant::now() + Duration::from_secs(3))
                .await
                .map_err(|e| e.to_string())?
            {
                Acquired::NotPublished => Ok(None),
                _ => Err("owned provider must remain NotPublished".into()),
            }
        })
    }
}
#[tokio::main]
async fn main() {
    let mut s3 = OwnedS3::start();
    let base = schedule::to_ms(Publication::new(20261018, 200).unwrap());
    let clock = Arc::new(AtomicI64::new(base));
    let wire = Arc::new(Memory::default());
    let budget = Arc::new(
        BudgetStore::new(
            wire.clone(),
            BudgetPolicy {
                provider: Provider::DataGoKr,
                quota_id: "c".repeat(64),
                window_id: "b3_owned_latest".into(),
                starts_at_ms: base - 1,
                ends_at_ms: base + 24 * 3_600_000,
                limit: 100,
                block_units: 1,
            },
            Arc::new(Time(clock.clone())),
        )
        .unwrap(),
    );
    let authority = budget.policy().authority_key();
    let peer = Arc::new(Peer {
        clock: clock.clone(),
        base,
        minutes: Mutex::new(Vec::new()),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider_base = format!("http://{}/", listener.local_addr().unwrap());
    let router = Router::new()
        .route(
            "/1360000/VilageFcstInfoService_2.0/getVilageFcst",
            get(unavailable),
        )
        .with_state(peer.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let metrics = Arc::new(DomesticMetrics::default());
    let actual = Arc::new(
        DomesticAcquirer::new(
            Arc::new(HttpProviderTransport::new(1024 * 1024).unwrap()),
            Arc::new(HttpPublicTransport::new(1024 * 1024).unwrap()),
            BTreeMap::from([(
                Service::VilageFcst,
                KeyRing::new(vec![(ProviderKey::new(KEY.into()).unwrap(), budget)]).unwrap(),
            )]),
            Endpoints::new(&provider_base, &provider_base, &provider_base).unwrap(),
            Arc::new(Time(clock.clone())),
            metrics.clone(),
            CatalogLimits::default(),
        )
        .unwrap(),
    );
    let forecast = Arc::new(Forecast {
        actual,
        clock: clock.clone(),
        latest_starts: AtomicUsize::new(0),
        skipped_history: AtomicUsize::new(0),
    });
    let read = clock.clone();
    let transport = BoundedS3::new(
        HttpS3Transport::new(
            &s3.endpoint,
            "server2-local",
            "ap-northeast-2",
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        4,
    );
    let source = S3Source::new(
        transport,
        Arc::new(move || read.load(SeqCst) as f64),
        Arc::new(Never),
        Arc::new(Never),
    )
    .unwrap()
    .with_forecast(Some(forecast.clone()));
    for minute in 10..190 {
        // Keep the production completed-result retention unchanged; expire it
        // between synthetic due slots instead of mistaking it for admission.
        if matches!(minute, 12 | 15 | 20) {
            tokio::time::sleep(Duration::from_millis(3100)).await;
        }
        let now = base + minute * 60_000;
        clock.store(now, SeqCst);
        source
            .grid_answer(
                Family::Short,
                Grid::new(60, 127).unwrap(),
                now as f64,
                Instant::now() + Duration::from_secs(5),
            )
            .await
            .unwrap();
    }
    tokio::time::sleep(Duration::from_millis(3100)).await;
    source
        .grid_answer(
            Family::Short,
            Grid::new(60, 127).unwrap(),
            clock.load(SeqCst) as f64,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
    let observed = peer.minutes.lock().unwrap().clone();
    assert_eq!(observed, vec![12, 15, 20]);
    let m = metrics.snapshot();
    assert_eq!(forecast.latest_starts.load(SeqCst), 3);
    assert_eq!(m.funded_attempts, 3);
    assert_eq!(m.reserved_units, 3);
    assert_eq!(m.funding_denied, 0);
    let used = serde_json::from_slice::<serde_json::Value>(&wire.0.lock().unwrap()[&authority].0)
        .unwrap()["used"]
        .as_u64()
        .unwrap();
    assert_eq!(used, 3);
    drop(source);
    task.abort();
    let stopped = task.await.is_err_and(|e| e.is_cancelled());
    assert!(stopped);
    assert!(s3.stop());
    println!("{}",serde_json::to_string(&json!({"verdict":"PASS","scope":"owned-S3-provider-synthetic-clock-latest-Short",
        "latest_http_minutes_after_base":observed,"logical_latest_starts":3,"funded_http_attempts":m.funded_attempts,"logical_reserved_units":m.reserved_units,"authority_units":used,
        "post_window_after_cache_expiry_http":0,"owned_provider_stopped":stopped,"owned_s3_child_reaped":true,
        "historical_provider_calls_stubbed":forecast.skipped_history.load(SeqCst),"clock":"synthetic minute advancement, not realtime three-hour performance",
        "live_provider_calls":0,"production_eligible":false})).unwrap());
}
