//! D1 recovery across the real five-minute admission, owned peers and actual S3 publication.
use axum::{Router, extract::State, routing::get};
use serde_json::json;
use server2::{
    budget::{
        BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider,
    },
    domestic::{
        Acquired, DomesticAcquirer, DomesticError, KeyRing,
        asos::AsosRequest,
        family::{Endpoints, Service, WebRequest},
        kma::source::{
            S3Source,
            fetch::{ForecastAcquire, ForecastRequest, Published},
            observe::{Acquire, Locate},
        },
        metrics::DomesticMetrics,
        publication::Publication,
        zone::ZoneRequest,
    },
    gateway::BoxFuture,
    history::schedule,
    providers::{HttpProviderTransport, HttpPublicTransport, ProviderKey},
    storage::{CatalogLimits, CatalogStore, HttpS3Transport, WriteCondition},
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
const KEY: &str = "D1_OWNED_ONLY+synthetic+aaaaaaaaaaaaaaaa/=";
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
struct Forecast {
    actual: Arc<DomesticAcquirer<HttpProviderTransport, HttpPublicTransport, Memory>>,
    store: Arc<CatalogStore<BoundedS3<HttpS3Transport>>>,
    starts: AtomicUsize,
    finished: Arc<AtomicUsize>,
}
impl ForecastAcquire for Forecast {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        assert_eq!(request, ForecastRequest::Zones);
        self.starts.fetch_add(1, SeqCst);
        let actual = self.actual.clone();
        let store = self.store.clone();
        let finished = self.finished.clone();
        Box::pin(async move {
            let outcome = match actual
                .acquire_zones(
                    &ZoneRequest::new(),
                    Instant::now() + Duration::from_secs(15),
                )
                .await
            {
                Ok(Acquired::Complete(a)) => {
                    let records = a.records.clone();
                    store
                        .publish(
                            a.declaration,
                            a.records,
                            Instant::now() + Duration::from_secs(10),
                        )
                        .await
                        .map(|_| Some(records))
                        .map_err(|e| format!("publication: {e}"))
                }
                Ok(_) => Ok(None),
                Err(e) => Err(e.to_string()),
            };
            finished.fetch_add(1, SeqCst);
            outcome
        })
    }
}
async fn provider(State(calls): State<Arc<AtomicUsize>>) -> (axum::http::StatusCode, Vec<u8>) {
    let n = calls.fetch_add(1, SeqCst);
    if n < 2 {
        (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            b"owned unavailable".to_vec(),
        )
    } else {
        (
            axum::http::StatusCode::OK,
            include_bytes!("../tests/formats/fixtures/forecast-zone.json").to_vec(),
        )
    }
}
async fn completed(f: &Forecast, n: usize) {
    tokio::time::timeout(Duration::from_secs(20), async {
        while f.finished.load(SeqCst) < n {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned acquisition must settle");
    // Publication completion precedes the source's success marker; allow its owner to return.
    tokio::time::sleep(Duration::from_millis(50)).await;
}
#[tokio::main]
async fn main() {
    let started = Instant::now();
    let mut s3 = OwnedS3::start();
    let base = schedule::to_ms(Publication::new(20261018, 200).unwrap());
    let clock = Arc::new(AtomicI64::new(base));
    let wire = Arc::new(Memory::default());
    let budget = Arc::new(
        BudgetStore::new(
            wire.clone(),
            BudgetPolicy {
                provider: Provider::DataGoKr,
                quota_id: "d".repeat(64),
                window_id: "d1_owned_zones".into(),
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
    let calls = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider_base = format!("http://{}/", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/1360000/FcstZoneInfoService/getFcstZoneCd", get(provider))
        .with_state(calls.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let metrics = Arc::new(DomesticMetrics::default());
    let actual = Arc::new(
        DomesticAcquirer::new(
            Arc::new(HttpProviderTransport::new(1024 * 1024).unwrap()),
            Arc::new(HttpPublicTransport::new(1024 * 1024).unwrap()),
            BTreeMap::from([(
                Service::ForecastZone,
                KeyRing::new(vec![(ProviderKey::new(KEY.into()).unwrap(), budget)]).unwrap(),
            )]),
            Endpoints::new(&provider_base, &provider_base, &provider_base).unwrap(),
            Arc::new(Time(clock.clone())),
            metrics.clone(),
            CatalogLimits::default(),
        )
        .unwrap(),
    );
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
    let forecast = Arc::new(Forecast {
        actual,
        store: Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap()),
        starts: AtomicUsize::new(0),
        finished: Arc::new(AtomicUsize::new(0)),
    });
    let source = S3Source::new(
        transport,
        Arc::new(move || base as f64),
        Arc::new(Never),
        Arc::new(Never),
    )
    .unwrap()
    .with_forecast(Some(forecast.clone()));
    let deadline = || Instant::now() + Duration::from_secs(5);
    assert!(
        source
            .zones(base as f64, deadline())
            .await
            .unwrap()
            .docs()
            .is_empty()
    );
    completed(&forecast, 1).await;
    assert_eq!(forecast.starts.load(SeqCst), 1);
    let failed_http = calls.load(SeqCst);
    assert_eq!(
        failed_http, 2,
        "two actual failed HTTP attempts in the first acquisition"
    );
    tokio::time::sleep(Duration::from_millis(3100)).await;
    source.zones(base as f64, deadline()).await.unwrap();
    assert_eq!(
        forecast.starts.load(SeqCst),
        1,
        "completed-flight expiry must not bypass five-minute admission"
    );
    assert_eq!(calls.load(SeqCst), failed_http);
    eprintln!("owned first acquisition failed; waiting for real five-minute memo expiry");
    tokio::time::sleep(Duration::from_secs(301).saturating_sub(started.elapsed())).await;
    let retry_at_seconds = started.elapsed().as_secs_f64();
    source.zones(base as f64, deadline()).await.unwrap();
    completed(&forecast, 2).await;
    let zones = source.zones(base as f64, deadline()).await.unwrap();
    assert_eq!(zones.docs().len(), 3);
    assert_eq!(zones.find_by_name("서울특별시", "종로구").len(), 1);
    tokio::time::sleep(Duration::from_millis(3100)).await;
    source.zones(base as f64, deadline()).await.unwrap();
    let starts = forecast.starts.load(SeqCst);
    let http = calls.load(SeqCst);
    assert_eq!(starts, 2);
    assert_eq!(http, 3);
    let m = metrics.snapshot();
    assert_eq!(m.funded_attempts, 3);
    assert_eq!(m.reserved_units, 3);
    let used = serde_json::from_slice::<serde_json::Value>(&wire.0.lock().unwrap()[&authority].0)
        .unwrap()["used"]
        .as_u64()
        .unwrap();
    assert_eq!(used, 3);
    drop(source);
    task.abort();
    let provider_stopped = task.await.is_err_and(|e| e.is_cancelled());
    let s3_reaped = s3.stop();
    assert!(provider_stopped && s3_reaped);
    println!("{}", serde_json::to_string(&json!({"verdict":"PASS","scope":"owned-S3-provider-real-five-minute-zone-retry",
        "acquisition_starts":starts,"failed_acquisition_http":failed_http,"http_attempts":http,"funded_attempts":m.funded_attempts,
        "logical_reserved_units":m.reserved_units,"authority_units":used,"retry_at_seconds":retry_at_seconds,
        "readable_s3_zone_documents":zones.docs().len(),"seoul_matches":zones.find_by_name("서울특별시", "종로구").len(),
        "owned_provider_stopped":provider_stopped,"owned_s3_child_reaped":s3_reaped,"clock":"fixed synthetic publication date; real monotonic five-minute memo",
        "live_provider_calls":0,"production_eligible":false})).unwrap());
}
