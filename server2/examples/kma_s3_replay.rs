//! Offline canonical S3 whole-response verifier; no dotenv or production provider roots.
//! Arguments: task-owned S3 loopback endpoint, gzip oracle fixture, disposable cache directory.
use axum::{Router, routing::any};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::{
        Acquired, DomesticError,
        asos::AsosRequest,
        family::{DataGoKrFamily, DataGoKrRequest, Target, WebRequest},
        format::{Expect, PageVerdict, WebVerdict, inspect_page, inspect_web},
        kma::{
            AssemblyConfig,
            backend::KmaBackend,
            source::{
                S3Source,
                observe::{Acquire, Locate},
            },
        },
        publication::Publication,
    },
    gateway::{BackendDispatcher, BoxFuture, Gateway, GatewayError, Geocoder},
    geocode::GeoClient,
    storage::{
        CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, ObjectTransport,
        Pagination, RawRecord, S3Settings,
    },
    world::BoundedS3,
};
use std::{
    collections::BTreeMap,
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
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
fn settings(endpoint: &str, cache: Option<&Path>) -> S3Settings {
    let mut vars = BTreeMap::from([
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("AWS_ACCESS_KEY", "server2-local".to_owned()),
        ("AWS_SECRET_KEY", "server2-local-secret".to_owned()),
    ]);
    if let Some(p) = cache {
        vars.insert("SERVER2_LOCAL_CACHE_DIR", p.to_str().unwrap().into());
        vars.insert(
            "SERVER2_LOCAL_CACHE_MAX_BYTES",
            (16 * 1024 * 1024).to_string(),
        );
    }
    S3Settings::from_vars_at(&|k| vars.get(k).cloned(), Some(endpoint)).unwrap()
}
async fn seed(endpoint: &str, fixture: &Value) {
    let limits = CatalogLimits::default();
    let store = CatalogStore::new(
        BoundedS3::new(settings(endpoint, None).transport().unwrap(), 4),
        limits.clone(),
    )
    .unwrap();
    for run in fixture["raw"].as_array().unwrap() {
        if run["family"] == "rss" {
            let request = WebRequest::town_rss(60, 127).unwrap();
            let body = run["xml"].as_str().unwrap().as_bytes();
            let WebVerdict::Valid(publication) = inspect_web(&request, "application/xml", body)
            else {
                panic!("S13 RSS validator rejected input")
            };
            let row = RawRecord::new(
                "kma-web",
                request.family().kind(),
                &request.provider_key(),
                publication.period(),
                run["fetched_at"].as_u64().unwrap(),
                200,
                "application/xml",
                Some(Pagination {
                    page: 1,
                    pages: 1,
                    complete: true,
                }),
                body.to_vec().into(),
                &limits.raw,
            )
            .unwrap();
            let member = GroupMember {
                envelope: row.envelope.clone(),
                catalogs: vec![
                    CatalogId::for_record(&row.envelope.identity, &publication.partition())
                        .unwrap(),
                ],
            };
            store
                .publish(
                    GroupDeclaration::new(vec![member], &limits).unwrap(),
                    vec![row],
                    Instant::now() + Duration::from_secs(20),
                )
                .await
                .unwrap();
            continue;
        }
        let family = match run["family"].as_str().unwrap() {
            "current" => DataGoKrFamily::UltraSrtNcst,
            "shortest" => DataGoKrFamily::UltraSrtFcst,
            "short" => DataGoKrFamily::VilageFcst,
            "mid-forecast" => DataGoKrFamily::MidFcst,
            "mid-land" => DataGoKrFamily::MidLandFcst,
            "mid-temp" => DataGoKrFamily::MidTa,
            _ => panic!("unsupported seed family"),
        };
        let slot = &run["slot"];
        let publication = Publication::new(
            slot["date"].as_str().unwrap().parse().unwrap(),
            slot["time"].as_str().unwrap().parse().unwrap(),
        )
        .unwrap();
        let target = match family {
            DataGoKrFamily::MidFcst => Target::Station(run["code"].as_str().unwrap().into()),
            DataGoKrFamily::MidLandFcst | DataGoKrFamily::MidTa => {
                Target::Region(run["code"].as_str().unwrap().into())
            }
            _ => Target::Grid { nx: 60, ny: 127 },
        };
        let request = DataGoKrRequest::new(family, target, publication).unwrap();
        let pages = run["pages"].as_array().unwrap();
        let mut expect = None;
        let mut row_keys = std::collections::BTreeSet::new();
        let mut expected_pages = None;
        let mut records = vec![];
        let mut members = vec![];
        for (i, page) in pages.iter().enumerate() {
            let body = page.as_str().unwrap().as_bytes();
            let parsed = serde_json::from_slice(body).unwrap();
            let PageVerdict::Valid(report) = inspect_page(&request, i as u32 + 1, expect, &parsed)
            else {
                panic!(
                    "S13 validator rejected {} {} page{}",
                    run["family"],
                    run["period"],
                    i + 1
                )
            };
            if expected_pages.is_none() {
                expected_pages = Some(if report.rows == report.total {
                    1
                } else {
                    report.total.div_ceil(family.rows())
                });
            }
            assert_eq!(
                pages.len() as u32,
                expected_pages.unwrap(),
                "complete S13 page count"
            );
            assert!(pages.len() as u32 <= family.max_pages(), "S13 max pages");
            for key in &report.row_keys {
                assert!(
                    row_keys.insert(key.clone()),
                    "S13 duplicate row across pages"
                );
            }
            expect = Some(Expect {
                total: report.total,
            });
            let row = RawRecord::new(
                "data-go-kr",
                family.kind(),
                &request.provider_key(),
                report.publication.period(),
                run["fetched_at"].as_u64().unwrap(),
                200,
                "application/json",
                Some(Pagination {
                    page: i as u32 + 1,
                    pages: pages.len() as u32,
                    complete: true,
                }),
                body.to_vec().into(),
                &limits.raw,
            )
            .unwrap();
            members.push(GroupMember {
                envelope: row.envelope.clone(),
                catalogs: vec![
                    CatalogId::for_record(&row.envelope.identity, &report.publication.partition())
                        .unwrap(),
                ],
            });
            records.push(row);
        }
        store
            .publish(
                GroupDeclaration::new(members, &limits).unwrap(),
                records,
                Instant::now() + Duration::from_secs(20),
            )
            .await
            .unwrap();
    }
}
async fn response(
    endpoint: &str,
    cache_root: &Path,
    legacy_url: &str,
    now: f64,
    case: &Value,
    phase: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    let disabled = Arc::new(Disabled::default());
    let transport = Arc::new(BoundedS3::new(
        settings(endpoint, Some(cache_root)).transport()?,
        4,
    ));
    let cache = transport.raw_cache();
    let source = Arc::new(S3Source::new(
        (*transport).clone(),
        Arc::new(move || now),
        disabled.clone(),
        disabled.clone(),
    )?);
    let dispatcher = BackendDispatcher::legacy(legacy_url)?;
    let kma = Arc::new(KmaBackend::new(
        source,
        Arc::new(move || now),
        AssemblyConfig::default(),
    ));
    let gateway = Gateway::new(disabled.clone(), dispatcher.clone()).with_direct(Arc::new(
        DirectRoutes::new(
            kma,
            DirectFamilies {
                kma_v000903: true,
                kma_v000901: true,
                town: true,
            },
            dispatcher,
        ),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    // Use production routing. Wrapping this in routing::any would strip HEAD's
    // body again and replace its intentionally unknown size with an exact zero.
    let task = tokio::spawn(async move { axum::serve(listener, gateway.router()).await.unwrap() });
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(15))
        .build()?;
    let start = Instant::now();
    let mut request = client
        .request(
            reqwest::Method::from_bytes(
                case.get("method")
                    .and_then(Value::as_str)
                    .unwrap_or("GET")
                    .as_bytes(),
            )?,
            format!("{base}{}", case["path"].as_str().ok_or("casepath")?),
        )
        .header(
            "accept-language",
            case["lang"].as_str().ok_or("caselanguage")?,
        );
    if let Some(tag) = case.get("if_none_match").and_then(Value::as_str) {
        request = request.header("if-none-match", tag);
    }
    let reply = request.send().await?;
    let status = reply.status().as_u16();
    let headers: BTreeMap<_, _> = reply
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_owned(),
                v.to_str().unwrap_or("<nontext>").to_owned(),
            )
        })
        .collect();
    let body = reply.bytes().await?;
    let elapsed = start.elapsed().as_secs_f64() * 1000.;
    let cache_metrics = if let Some(cache) = cache {
        if !cache.idle(Instant::now() + Duration::from_secs(3)).await {
            return Err("cachefilldidnotsettle".into());
        }
        Some(cache.metrics())
    } else {
        None
    };
    eprintln!(
        "replay {} {} status={} body_bytes={}",
        phase,
        case["id"].as_str().unwrap_or("invalid"),
        status,
        body.len()
    );
    task.abort();
    Ok(
        json!({"id":case["id"],"pass":phase,"status":status,"headers":headers,"body_base64":STANDARD.encode(&body),"elapsed_ms":elapsed,"cache":cache_metrics,"disabled_acquisition_attempts":disabled.attempts.load(Ordering::Relaxed)}),
    )
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err(
            "owned S3 endpoint, gzip oracle and disposable cache directory required".into(),
        );
    }
    let endpoint = reqwest::Url::parse(&args[0])?;
    if endpoint.scheme() != "http"
        || endpoint.host_str() != Some("127.0.0.1")
        || endpoint.port().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.path() != "/"
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("owned literal IPv4 S3 root required".into());
    }
    let mut text = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(&args[1])?)
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut text)?;
    if text.len() > 32 * 1024 * 1024 {
        return Err("oraclefixture exceeds32MiB".into());
    }
    let fixture: Value = serde_json::from_str(&text)?;
    seed(&args[0], &fixture).await;
    let now = server2::history::legacy::parse_iso(fixture["clock"].as_str().unwrap())
        .ok_or("oracle clock")? as f64;
    let legacy_count = Arc::new(AtomicUsize::new(0));
    let n = legacy_count.clone();
    let legacy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let legacy_url = format!("http://{}/", legacy_listener.local_addr()?);
    let legacy_task = tokio::spawn(async move {
        axum::serve(
            legacy_listener,
            Router::new().fallback(any(move || {
                let n = n.clone();
                async move {
                    n.fetch_add(1, Ordering::Relaxed);
                    (
                        axum::http::StatusCode::BAD_GATEWAY,
                        "legacy must not be called",
                    )
                }
            })),
        )
        .await
        .unwrap()
    });
    let cache_root = Path::new(&args[2]);
    if cache_root.exists() && std::fs::read_dir(cache_root)?.next().is_some() {
        return Err("disposable cache root must be empty".into());
    }
    let mut records = vec![];
    let mut ids = std::collections::BTreeSet::new();
    for case in fixture["requests"].as_array().ok_or("cases")? {
        let id = case["id"].as_str().ok_or("caseid")?;
        if id.is_empty()
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !ids.insert(id)
        {
            return Err("invalid or duplicate caseid".into());
        }
    }
    for phase in [
        "cold-empty-ram-and-disk",
        "warm-disk-empty-ram",
        "corrupt-disk-empty-ram",
        "lost-disk-empty-ram",
    ] {
        for case in fixture["requests"].as_array().unwrap() {
            let dir = cache_root.join(case["id"].as_str().unwrap());
            if phase == "lost-disk-empty-ram" && dir.exists() {
                std::fs::remove_dir_all(&dir)?;
            }
            if phase == "corrupt-disk-empty-ram" && dir.exists() {
                for ns in std::fs::read_dir(&dir)?.flatten() {
                    if ns.file_type()?.is_dir() {
                        for file in std::fs::read_dir(ns.path())?.flatten() {
                            if file.path().extension().is_some_and(|e| e == "raw") {
                                std::fs::write(file.path(), b"truncated")?;
                            }
                        }
                    }
                }
            }
            records.push(response(&args[0], &dir, &legacy_url, now, case, phase).await?);
        }
    }
    legacy_task.abort();
    println!(
        "{}",
        serde_json::to_string(
            &json!({"records":records,"legacy_requests":legacy_count.load(Ordering::Relaxed),"provider_requests":0,"profile":if cfg!(debug_assertions){"debug"}else{"release"},"scope":"owned loopback library HTTP example with injected clock; canonical CatalogStore seed + fresh S3Source; not production startup/AWS/latency proof"})
        )?
    );
    Ok(())
}
