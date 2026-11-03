//! Isolated live KMA acquisition/publication and real-S3 restore pilot.
//! No runtime modes, endpoint overrides, production keys or normalized weather store.
#[path = "kma_cold_measure/scope.rs"]
mod scope;
use futures_util::{StreamExt, stream};
use scope::{Funded, Ledger, Public, Scoped};
use serde_json::{Value, json};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    budget::SystemClock,
    domestic::{
        Acquired, DomesticError,
        asos::{AsosKind, AsosRequest},
        family::{DataGoKrFamily as Family, DataGoKrRequest, Target, WebRequest},
        kma::{
            AssemblyConfig,
            backend::KmaBackend,
            source::{
                S3Source,
                observe::{Acquire, DailyAcquirer, Locate},
            },
        },
        publication::{self},
    },
    gateway::{BackendDispatcher, BoxFuture, Gateway, GatewayError, Geocoder},
    geocode::GeoClient,
    history::IndexListing,
    storage::{CatalogLimits, CatalogStore, CatalogTransport, HttpS3Transport, decode_list},
    world::BoundedS3,
};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::Instant;

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
enum Need {
    Point(DataGoKrRequest),
    Asos(AsosRequest),
    Web(WebRequest),
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
fn summary(records: &[server2::storage::RawRecord]) -> Value {
    let mut rows = 0;
    let mut categories = std::collections::BTreeMap::<String, usize>::new();
    let mut phenomena = 0;
    let mut times = std::collections::BTreeSet::<String>::new();
    let mut cloud = 0;
    for r in records {
        if let Ok(v) = serde_json::from_slice::<Value>(&r.bytes) {
            let item = &v["response"]["body"]["items"]["item"];
            let items: Vec<&Value> = match item {
                Value::Array(a) => a.iter().collect(),
                Value::Object(_) => vec![item],
                _ => vec![],
            };
            for x in items {
                rows += 1;
                if let Some(c) = x["category"].as_str() {
                    *categories.entry(c.to_owned()).or_default() += 1;
                }
                if let Some(t) = x["tm"].as_str() {
                    times.insert(t.to_owned());
                }
                if x.get("dmstMtphNo")
                    .and_then(Value::as_str)
                    .is_some_and(|x| !x.trim().is_empty())
                {
                    phenomena += 1;
                }
                if x.get("dc10Tca")
                    .is_some_and(|x| !x.is_null() && x.as_str() != Some(""))
                {
                    cloud += 1;
                }
            }
        }
    }
    json!({"rows":rows,"categories":categories,"distinct_measured_timestamps":times.len(),
        "measured_first":times.first(),"measured_last":times.last(),"cloud_field_present":cloud,
        "phenomenon_number_nonempty":phenomena,"phenomenon_mapping_qualified":false,
        "raw_ids":records.iter().map(|r|&r.envelope.identity).collect::<Vec<_>>()})
}

async fn api(
    scope: BoundedS3<Scoped>,
    now: f64,
) -> Result<(String, tokio::task::JoinHandle<()>, Arc<Disabled>), Box<dyn std::error::Error>> {
    let disabled = Arc::new(Disabled::default());
    let source = Arc::new(S3Source::new(
        scope,
        Arc::new(move || now),
        disabled.clone(),
        disabled.clone(),
    )?);
    // No legacy selection; the direct route below owns this request. A loopback
    // rejector avoids accidentally reaching any existing service.
    let reject = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let legacy = format!("http://{}/", reject.local_addr()?);
    let reject_task = tokio::spawn(async move {
        axum::serve(
            reject,
            axum::Router::new().fallback(|| async { axum::http::StatusCode::BAD_GATEWAY }),
        )
        .await
        .unwrap()
    });
    let dispatcher = BackendDispatcher::legacy(&legacy)?;
    let backend = Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        AssemblyConfig::default(),
    ));
    let gateway = Gateway::new(disabled.clone(), dispatcher.clone()).with_direct(Arc::new(
        DirectRoutes::new(
            backend,
            DirectFamilies {
                kma_v000903: true,
                kma_v000901: false,
                town: false,
            },
            dispatcher,
        ),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    let task = tokio::spawn(async move {
        let _abort = Abort(reject_task);
        axum::serve(listener, gateway.router()).await.unwrap()
    });
    Ok((base, task, disabled))
}
struct Abort(tokio::task::JoinHandle<()>);
impl Drop for Abort {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("configuration and report paths required".into());
    }
    let cfg: Value = serde_json::from_slice(&std::fs::read(&args[0])?)?;
    let parent = if let Some(path) = cfg["restore_parent"].as_str() {
        let bytes = std::fs::read(path)?;
        if cfg["parent_sha256"].as_str() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) {
            return Err("parent report changed".into());
        }
        Some(serde_json::from_slice::<Value>(&bytes)?)
    } else {
        None
    };
    let prefix = cfg["prefix"].as_str().ok_or("prefix")?.to_owned();
    let samples = cfg["http_samples"]
        .as_u64()
        .filter(|n| (1..=100).contains(n))
        .ok_or("samples 1..100")?;
    let path = cfg["request_path"]
        .as_str()
        .filter(|p| p.starts_with("/v000903/kma/addr/") && !p.contains('?'))
        .ok_or("fixed KMA route")?;
    let bucket = cfg["bucket"]
        .as_str()
        .filter(|b| *b == "tw-server2-141248341265-apne2")
        .ok_or("measurement bucket")?;
    let key = std::env::var("KMA_MEASURE_AWS_KEY")?;
    let secret = std::env::var("KMA_MEASURE_AWS_SECRET")?;
    let credentials = match std::env::var("KMA_MEASURE_AWS_TOKEN") {
        Ok(t) if !t.is_empty() => rusty_s3::Credentials::new_with_token(key, secret, t),
        _ => rusty_s3::Credentials::new(key, secret),
    };
    if parent
        .as_ref()
        .is_some_and(|p| p["prefix"] != cfg["prefix"])
    {
        return Err("parent namespace mismatch".into());
    }
    let ledger = if let Some(p) = &parent {
        let end = cfg["campaign_deadline_ms"]
            .as_i64()
            .ok_or("campaign deadline")?;
        let remaining = end
            .checked_sub(now_ms())
            .filter(|n| *n > 0 && *n <= 1800000)
            .ok_or("campaign expired")?;
        Ledger::resume(&p["metrics"], Duration::from_millis(remaining as u64))?
    } else {
        Ledger::new()
    };
    let mut scoped = Scoped::new(
        HttpS3Transport::new(
            "https://s3.ap-northeast-2.amazonaws.com/",
            bucket,
            "ap-northeast-2",
            credentials.clone(),
        )?,
        prefix.clone(),
        ledger.clone(),
        bucket,
        credentials,
    )?;
    if parent.is_some() {
        scoped = scoped.read_only();
    }
    let io = BoundedS3::new(scoped.clone(), if parent.is_some() { 4 } else { 12 });
    let mut empty = vec![];
    for p in ["raw/v2/", "index/v2/"] {
        if parent.is_some() {
            break;
        }
        let listed = if p == "index/v2/" {
            io.list_index(p, None).await?
        } else {
            let xml = io.list_raw_document(p, None, 1, 8192).await?;
            decode_list(&xml, 1)?
        };
        if !listed.keys.is_empty() || listed.next.is_some() {
            return Err("measurement prefix was not empty".into());
        }
        empty.push(p);
    }
    let as_of = now_ms();
    let metrics = Arc::new(server2::domestic::metrics::DomesticMetrics::default());
    let daily = Arc::new(DailyAcquirer::new(
        Arc::new(Funded {
            inner: server2::providers::HttpProviderTransport::new(scope::RESPONSE)
                .map_err(|_| "provider transport configuration")?,
            ledger: ledger.clone(),
        }),
        Arc::new(Public {
            inner: server2::providers::HttpPublicTransport::new(scope::RESPONSE)
                .map_err(|_| "public transport configuration")?,
            ledger: ledger.clone(),
        }),
        Arc::new(io.clone()),
        server2::domestic::keys::parse_keys(&std::env::var("DONGNAE_SECRET_KEYS")?),
        server2::domestic::quota::DataGoKrApi::daily_units,
        server2::gateway::runtime::Builtins::production().kma_endpoints()?,
        Arc::new(SystemClock),
        metrics,
    )?);
    let store = Arc::new(CatalogStore::new(io.clone(), CatalogLimits::default())?);
    let current = publication::current_base(as_of).ok_or("current clock")?;
    let shortest = publication::ultra_short_base(as_of).ok_or("short clock")?;
    let short = publication::short_base(as_of).ok_or("short clock")?;
    let mid = publication::mid_tm_fc(as_of).ok_or("mid clock")?;
    let mut jobs = vec![];
    for (name, family, publication) in [
        ("current", Family::UltraSrtNcst, current),
        ("shortest", Family::UltraSrtFcst, shortest),
        ("short", Family::VilageFcst, short),
    ] {
        jobs.push((
            name.to_owned(),
            Need::Point(DataGoKrRequest::new(
                family,
                Target::Grid { nx: 60, ny: 127 },
                publication,
            )?),
        ));
    }
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
            Need::Point(DataGoKrRequest::new(family, target, mid)?),
        ));
    }
    // Explicit reach probes, never historical short forecasts.
    for h in [1, 6, 24, 168] {
        for (name, family, p) in [
            ("current", Family::UltraSrtNcst, current),
            ("shortest", Family::UltraSrtFcst, shortest),
        ] {
            jobs.push((
                format!("reach-{name}-{h}h"),
                Need::Point(DataGoKrRequest::new(
                    family,
                    Target::Grid { nx: 60, ny: 127 },
                    p.add_hours(-h).ok_or("probe clock")?,
                )?),
            ));
        }
    }
    let local = time::OffsetDateTime::from_unix_timestamp(as_of / 1000)?
        .to_offset(time::UtcOffset::from_hms(9, 0, 0)?);
    let d = |days: i64| {
        let x = local.date() - time::Duration::days(days);
        format!("{:04}{:02}{:02}", x.year(), u8::from(x.month()), x.day())
    };
    jobs.push((
        "asos-hourly-7-completed-dates".into(),
        Need::Asos(AsosRequest::new(
            AsosKind::Hourly,
            "108",
            &format!("{}0000", d(7)),
            &format!("{}2300", d(1)),
        )?),
    ));
    jobs.push((
        "asos-daily-7-completed-dates".into(),
        Need::Asos(AsosRequest::new(AsosKind::Daily, "108", &d(7), &d(1))?),
    ));
    jobs.push(("rss".into(), Need::Web(WebRequest::town_rss(60, 127)?)));
    if parent.is_some() {
        jobs.clear();
    }
    let cold_start = Instant::now();
    let acquisitions:Vec<Value>=stream::iter(jobs).map(|(id,need)| {
        let daily=daily.clone();let store=store.clone();
        async move {
            let start=Instant::now();let until=Instant::now()+Duration::from_secs(180);
            let result=match need {
                Need::Point(r)=>match daily.today().await {Ok(a)=>a.acquire(&r,until).await,Err(e)=>Err(e)},
                Need::Asos(r)=>daily.asos(r,until).await,
                Need::Web(r)=>daily.web(r,until).await,
            };
            let acquired_ms=start.elapsed().as_secs_f64()*1000.;
            match result {
                Ok(Acquired::Complete(a))=>{
                    let coverage=summary(&a.records);let p=Instant::now();
                    let published=store.publish(a.declaration,a.records,Instant::now()+Duration::from_secs(10)).await;
                    json!({"id":id,"outcome":if published.is_ok(){"published"}else{"publication_error"},
                        "acquire_ms":acquired_ms,"publish_ms":p.elapsed().as_secs_f64()*1000.,"elapsed_ms":start.elapsed().as_secs_f64()*1000.,
                        "coverage":coverage,"error":published.err().map(|e|e.to_string())})
                }
                Ok(other)=>json!({"id":id,"outcome":format!("{other:?}"),"elapsed_ms":acquired_ms}),
                Err(e)=>json!({"id":id,"outcome":"acquisition_error","error":e.to_string(),"elapsed_ms":acquired_ms}),
            }
        }
    }).buffer_unordered(4).collect().await;
    let capture_ms = cold_start.elapsed().as_secs_f64() * 1000.;
    let capture_metrics = ledger.snapshot();
    // Newly fetched identities must be visible to the restore cut. Freezing the
    // source at capture START would exclude every later fetched_at timestamp.
    let replay_as_of = parent
        .as_ref()
        .and_then(|p| p["replay_as_of_ms"].as_i64())
        .unwrap_or_else(now_ms);
    // Checkpoint before the independent API restore cohort, including failures.
    let mut report = json!({"schema":1,"prefix":prefix,"read_only_continuation":parent.is_some(),"s3_concurrency":if parent.is_some(){4}else{12},"capture_as_of_ms":as_of,"replay_as_of_ms":replay_as_of,"empty_prefix_checks":empty,
        "capture_ms":capture_ms,"acquisitions":acquisitions,"capture_metrics":capture_metrics,
        "http":[],"scope":"workstation direct native TLS S3/provider pilot; fixed public Seoul owner; not deployed EC2 or full seven-day parity",
        "history_complete":false,"shared_ram_closure_implemented":false,"packs_implemented":false});
    std::fs::write(&args[1], serde_json::to_vec_pretty(&report)?)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(12))
        .build()?;
    let mut http = vec![];
    let phases = if parent.is_some() {
        vec!["same_source_no_disk"]
    } else {
        vec!["fresh_source_no_disk", "same_source_no_disk"]
    };
    for phase in phases {
        let mut shared = None;
        for trial in 0..samples {
            if shared.is_none() {
                shared = Some(api(io.clone(), replay_as_of as f64).await?);
            }
            let (base, _, disabled) = shared.as_ref().unwrap();
            let before = ledger.snapshot();
            let start = Instant::now();
            let reply = client
                .get(format!("{base}{path}"))
                .header("accept-language", "ko")
                .send()
                .await;
            let record = match reply {
                Ok(r) => {
                    let status = r.status().as_u16();
                    match r.bytes().await {
                        Ok(b) => {
                            json!({"status":status,"body_bytes":b.len(),"body_sha256":format!("{:x}",Sha256::digest(&b)),
                        "json_top_keys":serde_json::from_slice::<Value>(&b).ok().and_then(|v|v.as_object().map(|o|o.keys().cloned().collect::<Vec<_>>()))})
                        }
                        Err(_) => json!({"outcome":"body_error","status":status}),
                    }
                }
                Err(e) => json!({"outcome":if e.is_timeout(){"deadline"}else{"http_error"}}),
            };
            http.push(json!({"phase":phase,"trial":trial,"elapsed_ms":start.elapsed().as_secs_f64()*1000.,"result":record,
                "before_admitted":before["admitted"],"after_admitted":ledger.snapshot()["admitted"],"disabled_provider_attempts":disabled.attempts.load(Ordering::Relaxed),"history_complete":false}));
            if phase == "fresh_source_no_disk"
                && let Some((_, task, _)) = shared.take()
            {
                task.abort();
            }
            report["http"] = json!(http);
            report["metrics"] = ledger.snapshot();
            std::fs::write(&args[1], serde_json::to_vec_pretty(&report)?)?;
            if ledger.snapshot()["denied"].as_u64().unwrap_or(0) > 0 {
                break;
            }
        }
        if let Some((_, task, _)) = shared.take() {
            task.abort();
        }
    }
    report["metrics"] = ledger.snapshot();
    std::fs::write(&args[1], serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Retained {} acquisitions and {} API attempts; history remains incomplete",
        report["acquisitions"].as_array().unwrap().len(),
        http.len()
    );
    Ok(())
}
