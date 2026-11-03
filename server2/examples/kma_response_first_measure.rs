//! Bounded response-first prototype: native providers/folds/assembly/catalog, isolated S3.
//! Not a production runtime switch. One test-owned HTTP client and pending batch per trial.
#[path = "kma_response_first_measure/pending.rs"]
mod pending;
#[allow(dead_code)]
#[path = "kma_cold_measure/scope.rs"]
mod scope;
#[path = "kma_response_first_measure/source.rs"]
mod source;
use futures_util::{Stream, StreamExt, stream};
use pending::{Captured, Pending, Validated};
use serde_json::{Value, json};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    budget::SystemClock,
    domestic::{
        Acquired, DomesticError,
        asos::AsosRequest,
        family::{DataGoKrFamily as Family, DataGoKrRequest, Target, WebRequest},
        kma::{
            AssemblyConfig,
            backend::{KmaBackend, KmaSource},
            source::{
                S3Source,
                observe::{Acquire, DailyAcquirer, Locate},
            },
        },
        publication,
    },
    gateway::{BackendDispatcher, BoxFuture, Gateway, GatewayError, Geocoder},
    geocode::GeoClient,
    storage::{CatalogLimits, CatalogStore, HttpS3Transport},
    world::BoundedS3,
};
use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::Instant;
type Io = BoundedS3<scope::Scoped>;

#[derive(Default)]
struct Disabled {
    attempts: AtomicUsize,
}
impl Acquire for Disabled {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.attempts.fetch_add(1, Ordering::Relaxed);
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.attempts.fetch_add(1, Ordering::Relaxed);
        Box::pin(async { Err(DomesticError::Transport) })
    }
}
impl Locate for Disabled {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { None })
    }
}
impl Geocoder for Disabled {
    fn coord(&self, _: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async { Err(GatewayError::Provider) })
    }
    fn addr(&self, _: String, _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async { Err(GatewayError::Provider) })
    }
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
fn empty(now: f64) -> Result<S3Source<source::Empty>, server2::storage::Error> {
    let off = Arc::new(Disabled::default());
    S3Source::new(source::Empty, Arc::new(move || now), off.clone(), off)
}
struct Abort(tokio::task::JoinHandle<()>);
impl Drop for Abort {
    fn drop(&mut self) {
        self.0.abort();
    }
}

struct BodyTerminal {
    stream: axum::body::BodyDataStream,
    log: pending::Timeline,
    start: Instant,
    terminal: bool,
}
impl Stream for BodyTerminal {
    type Item = Result<axum::body::Bytes, axum::Error>;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let result = Pin::new(&mut self.stream).poll_next(cx);
        if matches!(result, Poll::Ready(None)) && !self.terminal {
            self.terminal = true;
            pending::event(&self.log, self.start, "server_body_polled_to_end");
        }
        result
    }
}
impl Drop for BodyTerminal {
    fn drop(&mut self) {
        if !self.terminal {
            pending::event(&self.log, self.start, "server_body_dropped");
        }
    }
}
async fn api(
    source: Arc<dyn KmaSource>,
    now: f64,
    log: pending::Timeline,
    start: Instant,
) -> Result<(String, Abort), Box<dyn std::error::Error>> {
    let off = Arc::new(Disabled::default());
    let reject = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let dispatcher = BackendDispatcher::legacy(&format!("http://{}/", reject.local_addr()?))?;
    let reject_task = tokio::spawn(async move {
        let _ = axum::serve(
            reject,
            axum::Router::new().fallback(|| async { axum::http::StatusCode::BAD_GATEWAY }),
        )
        .await;
    });
    let backend = Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        AssemblyConfig::default(),
    ));
    let gateway = Gateway::new(off, dispatcher.clone()).with_direct(Arc::new(DirectRoutes::new(
        backend,
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: false,
            town: false,
        },
        dispatcher,
    )));
    let middleware = axum::middleware::from_fn(move |req, next: axum::middleware::Next| {
        let log = log.clone();
        async move {
            let response = next.run(req).await;
            let (parts, body) = response.into_parts();
            axum::response::Response::from_parts(
                parts,
                axum::body::Body::from_stream(BodyTerminal {
                    stream: body.into_data_stream(),
                    log,
                    start,
                    terminal: false,
                }),
            )
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("http://{}", listener.local_addr()?);
    let task = tokio::spawn(async move {
        let _reject = Abort(reject_task);
        let _ = axum::serve(listener, gateway.router().layer(middleware)).await;
    });
    Ok((url, Abort(task)))
}

enum Need {
    Point(DataGoKrRequest),
    Web(WebRequest),
}
fn jobs(at: i64) -> Result<Vec<(String, Need)>, Box<dyn std::error::Error>> {
    let mut jobs = vec![];
    for (name, family, p) in [
        (
            "current",
            Family::UltraSrtNcst,
            publication::current_base(at),
        ),
        (
            "shortest",
            Family::UltraSrtFcst,
            publication::ultra_short_base(at),
        ),
        ("short", Family::VilageFcst, publication::short_base(at)),
    ] {
        jobs.push((
            name.into(),
            Need::Point(DataGoKrRequest::new(
                family,
                Target::Grid { nx: 60, ny: 127 },
                p.ok_or("clock")?,
            )?),
        ));
    }
    let p = publication::mid_tm_fc(at).ok_or("clock")?;
    for (name, family, target) in [
        (
            "mid-forecast",
            Family::MidFcst,
            Target::Station("108".into()),
        ),
        (
            "mid-land",
            Family::MidLandFcst,
            Target::Region("11B00000".into()),
        ),
        (
            "mid-temperature",
            Family::MidTa,
            Target::Region("11B10101".into()),
        ),
    ] {
        jobs.push((
            name.into(),
            Need::Point(DataGoKrRequest::new(family, target, p)?),
        ));
    }
    jobs.push(("rss".into(), Need::Web(WebRequest::town_rss(60, 127)?)));
    Ok(jobs)
}
fn work(
    jobs: Vec<(String, Need)>,
    daily: Arc<DailyAcquirer<scope::Funded, scope::Public, Io>>,
) -> pending::Work {
    Box::pin(async move {
        let mut results=stream::iter(jobs).map(|(name,need)|{
            let daily=daily.clone();async move {
                let t=Instant::now();let deadline=t+Duration::from_secs(30);
                let result=match need {
                    Need::Point(r)=>match daily.today().await{Ok(a)=>a.acquire(&r,deadline).await,Err(e)=>Err(e)},
                    Need::Web(r)=>daily.web(r,deadline).await,
                };
                let result=match result {
                    Ok(Acquired::Complete(a))=>Validated::new(name.clone(),a).map_err(|_|"pure_validation_error".to_owned()),
                    Ok(other)=>Err(format!("{other:?}")),Err(e)=>Err(e.to_string()),
                };
                let row=json!({"name":name,"ms":t.elapsed().as_secs_f64()*1000.,"complete":result.is_ok(),
                    "error":result.as_ref().err(),"raw_ids":result.as_ref().ok().map(|g|g.records().iter().map(|r|&r.envelope.identity).collect::<Vec<_>>()),
                    "raw_bytes":result.as_ref().ok().map(|g|g.records().iter().map(|r|r.bytes.len()).sum::<usize>())});
                (result.ok(),row)
            }
        }).buffer_unordered(4).collect::<Vec<_>>().await;
        results.sort_by(|a, b| a.1["name"].as_str().cmp(&b.1["name"].as_str()));
        let (mut groups, mut jobs) = (vec![], vec![]);
        for (g, row) in results {
            if let Some(g) = g {
                groups.push(g)
            }
            jobs.push(row)
        }
        Captured { groups, jobs }
    })
}

async fn http(
    base: &str,
    path: &str,
    body_path: &std::path::Path,
) -> Result<Value, Box<dyn std::error::Error>> {
    // Each trial has a new HTTP pool. Application caches and the source are also fresh.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(12))
        .build()?;
    let t = Instant::now();
    let result = match client
        .get(format!("{base}{path}"))
        .header("accept-language", "ko")
        .send()
        .await
    {
        Ok(r) => {
            let status = r.status().as_u16();
            let headers: std::collections::BTreeMap<_, _> =
                ["content-type", "content-encoding", "cache-control", "vary"]
                    .iter()
                    .filter_map(|k| {
                        r.headers()
                            .get(*k)
                            .and_then(|v| v.to_str().ok())
                            .map(|v| ((*k).to_owned(), v.to_owned()))
                    })
                    .collect();
            match r.bytes().await {
                Ok(body) => {
                    let ms = t.elapsed().as_secs_f64() * 1000.;
                    let hash = server2::storage::sha256(&body);
                    std::fs::write(body_path, &body)?;
                    json!({"status":status,"elapsed_ms":ms,"body_bytes":body.len(),"body_sha256":hash,"functional_headers":headers,"full_body_received":true})
                }
                Err(_) => {
                    json!({"status":status,"elapsed_ms":t.elapsed().as_secs_f64()*1000.,"full_body_received":false,"error":"body_error"})
                }
            }
        }
        Err(e) => {
            json!({"elapsed_ms":t.elapsed().as_secs_f64()*1000.,"full_body_received":false,"error":if e.is_timeout(){"timeout"}else{"http_error"}})
        }
    };
    Ok(result)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ledger = scope::Ledger::new();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(campaign(ledger.clone()));
    // Native S3Source owns detached discovery work. Drop the runtime before the
    // final ledger snapshot, including cancellation charges and late admissions.
    drop(runtime);
    if let Some(path) = std::env::args().nth(2)
        && std::path::Path::new(&path).is_file()
    {
        let mut report: Value = serde_json::from_slice(&std::fs::read(&path)?)?;
        report["metrics"] = ledger.snapshot();
        report["runtime_shutdown_settled"] = json!(true);
        std::fs::write(path, serde_json::to_vec_pretty(&report)?)?;
    }
    result
}
async fn campaign(ledger: Arc<scope::Ledger>) -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("config and report paths required".into());
    }
    let cfg: Value = serde_json::from_slice(&std::fs::read(&args[0])?)?;
    let prefix = cfg["prefix"]
        .as_str()
        .filter(|p| scope::valid_prefix(p))
        .ok_or("owned prefix")?;
    if cfg["bucket"] != "tw-server2-141248341265-apne2" || cfg["provider_cases"] != 3 {
        return Err("fixed campaign profile".into());
    }
    let path = cfg["request_path"]
        .as_str()
        .filter(|p| p.starts_with("/v000903/kma/addr/") && !p.contains('?'))
        .ok_or("KMA route")?;
    let out = std::path::Path::new(&args[1]);
    let dir = out.parent().ok_or("report directory")?;
    let key = std::env::var("KMA_MEASURE_AWS_KEY")?;
    let secret = std::env::var("KMA_MEASURE_AWS_SECRET")?;
    let credentials = match std::env::var("KMA_MEASURE_AWS_TOKEN") {
        Ok(t) if !t.is_empty() => rusty_s3::Credentials::new_with_token(key, secret, t),
        _ => rusty_s3::Credentials::new(key, secret),
    };
    let raw_capacity = pending::capacity();
    let make_io = |sub: &str, read_only: bool| -> Result<Io, server2::storage::Error> {
        let scoped = scope::Scoped::new(
            HttpS3Transport::new(
                "https://s3.ap-northeast-2.amazonaws.com/",
                "tw-server2-141248341265-apne2",
                "ap-northeast-2",
                credentials.clone(),
            )?,
            format!("{prefix}{sub}/"),
            ledger.clone(),
            "tw-server2-141248341265-apne2",
            credentials.clone(),
        )?;
        Ok(BoundedS3::new(
            if read_only {
                scoped.read_only()
            } else {
                scoped
            },
            4,
        ))
    };
    let mut report = json!({"schema":1,"prefix":prefix,"profile":"latest-only Seoul7; targeted canonical restore; not production writer/history qualification","history_complete":false,"cases":[],"http":[]});
    let mut http_rows = vec![];
    let mut cases = vec![];
    let mut discovery_control = None;
    for trial in 0..4 {
        let control = trial == 3;
        let name = if control {
            "a0".into()
        } else {
            format!("p1-{trial}")
        };
        let io = make_io(&name, false)?;
        let clock = now_ms() as f64;
        let daily = Arc::new(DailyAcquirer::new(
            Arc::new(scope::Funded {
                inner: server2::providers::HttpProviderTransport::new(scope::RESPONSE)
                    .map_err(|_| "provider config")?,
                ledger: ledger.clone(),
            }),
            Arc::new(scope::Public {
                inner: server2::providers::HttpPublicTransport::new(scope::RESPONSE)
                    .map_err(|_| "public config")?,
                ledger: ledger.clone(),
            }),
            Arc::new(io.clone()),
            server2::domestic::keys::parse_keys(&std::env::var("DONGNAE_SECRET_KEYS")?),
            server2::domestic::quota::DataGoKrApi::daily_units,
            server2::gateway::runtime::Builtins::production().kma_endpoints()?,
            Arc::new(SystemClock),
            Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
        )?);
        let owner = Pending::new(
            work(jobs(clock as i64)?, daily),
            control,
            raw_capacity.clone(),
        )?;
        let src = Arc::new(source::Provider {
            base: empty(clock)?,
            pending: owner.clone(),
            store: Arc::new(CatalogStore::new(io, CatalogLimits::default())?),
        });
        let (url, server) = api(src.clone(), clock, owner.log.clone(), owner.start).await?;
        let before = ledger.snapshot();
        let result = http(&url, path, &dir.join(format!("{name}-body.json"))).await?;
        // The test client, not the production server, can observe this receipt.
        pending::event(&owner.log, owner.start, "test_client_terminal");
        let at_response = ledger.snapshot();
        owner.release();
        let tail = Instant::now();
        let writer = owner.drain().await;
        let after_tail_ms = tail.elapsed().as_secs_f64() * 1000.;
        let groups = owner.ready().await.unwrap_or_default();
        let targets = source::targets(&groups);
        let row = json!({"profile":if control{"A0_durable_first_control"}else{"P1_provider_response_first"},"trial":trial,"case":name,"request_as_of_ms":clock,
            "result":result,"before":before["admitted"],"at_client_terminal":at_response["admitted"],
            "writer_drain_after_client_ms":after_tail_ms,"writer":writer,"timeline":owner.log.lock().unwrap().clone(),"targets":targets});
        http_rows.push(row.clone());
        cases.push(row);
        let original_hash = result["body_sha256"].clone();
        let original_headers = result["functional_headers"].clone();
        // Drop every provider/raw owner before restoration; only CatalogId metadata remains.
        drop(server);
        drop(src);
        drop(groups);
        drop(owner);
        if !control {
            let now = now_ms() as f64;
            let io = make_io(&name, true)?;
            let src = Arc::new(source::Restore {
                base: empty(now)?,
                store: Arc::new(CatalogStore::new(io, CatalogLimits::default())?),
                targets,
            });
            let log = Arc::new(std::sync::Mutex::new(vec![]));
            let t = Instant::now();
            let (url, server) = api(src.clone(), now, log.clone(), t).await?;
            let before = ledger.snapshot();
            let r = http(&url, path, &dir.join(format!("s1-{trial}-body.json"))).await?;
            http_rows.push(json!({"profile":"S1_targeted_canonical_restore","trial":trial,"case":name,"request_as_of_ms":now,"result":r,
                "body_equal_to_provider":r["body_sha256"]==original_hash,"functional_headers_equal":r["functional_headers"]==original_headers,
                "before":before["admitted"],"after":ledger.snapshot()["admitted"],"timeline":log.lock().unwrap().clone()}));
            drop(server);
            drop(src);
            if trial == 0 {
                discovery_control = Some((name.clone(), original_hash, original_headers));
            }
        }
        report["cases"] = json!(cases);
        report["http"] = json!(http_rows);
        report["metrics"] = ledger.snapshot();
        std::fs::write(out, serde_json::to_vec_pretty(&report)?)?;
        if ledger.snapshot()["denied"].as_u64().unwrap_or(0) > 0 {
            break;
        }
    }
    // Run the unmodified source last: its request cancellation does not cancel
    // all its native background work. Never let it contaminate P1/S1/A0 trials.
    if ledger.snapshot()["denied"].as_u64() == Some(0)
        && let Some((name, original_hash, original_headers)) = discovery_control
    {
        let now = now_ms() as f64;
        let off = Arc::new(Disabled::default());
        let src = Arc::new(S3Source::new(
            make_io(&name, true)?,
            Arc::new(move || now),
            off.clone(),
            off.clone(),
        )?);
        let log = Arc::new(std::sync::Mutex::new(vec![]));
        let (url, server) = api(src.clone(), now, log.clone(), Instant::now()).await?;
        let before = ledger.snapshot();
        let r = http(&url, path, &dir.join("s0-body.json")).await?;
        http_rows.push(json!({"profile":"S0_unmodified_native_discovery","trial":0,"case":name,"result":r,
            "body_equal_to_provider":r["body_sha256"]==original_hash,"functional_headers_equal":r["functional_headers"]==original_headers,
            "before":before["admitted"],"after":ledger.snapshot()["admitted"],"disabled_acquire_attempts":off.attempts.load(Ordering::Relaxed),"timeline":log.lock().unwrap().clone()}));
        drop(server);
        drop(src);
        report["http"] = json!(http_rows);
        report["discovery_control_last"] = json!(true);
        std::fs::write(out, serde_json::to_vec_pretty(&report)?)?;
    }
    println!(
        "Recorded {} continuous full-body HTTP attempts; full history remains unqualified",
        http_rows.len()
    );
    Ok(())
}
