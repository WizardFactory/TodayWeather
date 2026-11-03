//! Owned-peer verification entrypoint. Production has no root override or refresh command.
//! Weather assembly uses a recorded native KMA snapshot; prose uses actual funded HTTP/S3.
use server2::{
    gateway::{BoxFuture, OrderedJson},
    narrative::{
        self, Read,
        provider::{Error, Page, Source},
    },
    runtime_services::RuntimeServices,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
#[path = "../tests/legacy_versions/support.rs"]
mod fixture;
struct Snapshot {
    source: fixture::RecordedSource,
    id: String,
}
impl server2::domestic::kma::backend::KmaSource for Snapshot {
    fn snapshot(
        &self,
        _: &server2::domestic::kma::KmaRequest,
        _: Instant,
    ) -> BoxFuture<'_, server2::domestic::kma::backend::SourceAnswer> {
        Box::pin(async move {
            server2::domestic::kma::backend::SourceAnswer::Snapshot(Box::new(
                self.source.store_for(&self.id).expect("selected fixture"),
            ))
        })
    }
}
struct Disabled(Arc<AtomicUsize>);
impl Source for Disabled {
    fn fetch(&self, _: u16, _: Instant) -> BoxFuture<'_, Result<Option<Page>, Error>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(Error::Transport) })
    }
}
struct Cities;
impl server2::nation::CitySource for Cities {
    fn weather(
        &self,
        _: server2::domestic::kma::KmaRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<server2::domestic::kma::Outcome, server2::gateway::GatewayError>>
    {
        Box::pin(async {
            Ok(server2::domestic::kma::Outcome::Json(OrderedJson::parse(br#"{"current":{"t1h":20},"forecastNarrative":{"text":"child must be stripped"}}"#).unwrap()))
        })
    }
}
struct Air;
impl server2::nation::NationSource for Air {
    fn nation_air(&self, _: f64, _: Instant) -> BoxFuture<'_, server2::nation::NationAir> {
        Box::pin(async {
            server2::nation::NationAir {
                rows: vec![],
                status: OrderedJson::Null,
            }
        })
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let [mode, root] = args.as_slice() else {
        return Err("usage: narrative_smoke acquire|serve LOOPBACK_ROOT".into());
    };
    let url: reqwest::Url = root.parse()?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("owned loopback root required".into());
    }
    let dead = "http://127.0.0.1:9/".to_owned();
    let builtins = server2::gateway::runtime::Builtins {
        s3: Some(root.clone()),
        data_go_kr: root.clone(),
        instance_metadata: Some(dead.clone()),
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
        ..Default::default()
    };
    let var = |n: &str| match n {
        "SERVER2_NATIVE_FAMILIES" => Some("kma-v000901".into()),
        "SERVER2_S3_BUCKET" | "AWS_ACCESS_KEY" => Some("server2-local".into()),
        "AWS_SECRET_KEY" => Some("server2-local-secret".into()),
        "SERVER2_S3_REGION" => Some("ap-northeast-2".into()),
        "DONGNAE_SECRET_KEYS" => Some(r#"["S20E_SMOKE_KEY_C+aaaaaaaaaaaaaaaa/="]"#.into()),
        _ => None,
    };
    let services = RuntimeServices::from_vars_at(&var, &builtins)?;
    if mode == "acquire" {
        tokio::time::timeout(
            Duration::from_secs(30),
            services
                .narrative_acquire
                .as_ref()
                .ok_or("missing native owner")?
                .refresh(),
        )
        .await?;
        println!(
            "{}",
            serde_json::json!({"mode":"acquire","completed":true,"production_eligible":false})
        );
        return Ok(());
    }
    if mode != "serve" {
        return Err("unsupported mode".into());
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let reader: Arc<dyn Read> = Arc::new(narrative::store::Service::new(
        services.s3.clone().ok_or("missing s3")?,
        Arc::new(Disabled(calls.clone())),
    )?);
    let case = fixture::KMA
        .scenarios()
        .iter()
        .find(|c| {
            c["status"] == 200
                && c["body"].as_str().is_some_and(|s| {
                    serde_json::from_str::<serde_json::Value>(s)
                        .ok()
                        .is_some_and(|v| v["source"] == "KMA" && v["regionName"] == "서울특별시")
                })
        })
        .ok_or("missing recorded KMA scenario")?;
    // Whole ordered-corpus parsing belongs to the parity suite, outside HTTP timing.
    let source = fixture::RecordedSource::parse(&serde_json::to_vec(
        &serde_json::json!({"scenarios":[case]}),
    )?)
    .map_err(|_| "selected recorded KMA source")?;
    let clock = fixture::clock_ms(case["clock"].as_str().ok_or("fixture clock")?);
    let backend = Arc::new(
        server2::domestic::kma::backend::KmaBackend::new(
            Arc::new(Snapshot {
                source,
                id: case["id"].as_str().ok_or("fixture id")?.into(),
            }),
            Arc::new(move || clock),
            fixture::oracle_config(),
        )
        .with_narrative(Some(reader.clone())),
    );
    let routes = Arc::new(
        server2::api::DirectRoutes::new(
            backend,
            server2::api::DirectFamilies {
                kma_v000901: true,
                kma_v000903: true,
                town: false,
            },
            server2::gateway::BackendDispatcher::legacy("http://127.0.0.1:9")?,
        )
        .with_nation(Arc::new(
            server2::nation::NationBackend::new(
                Arc::new(Cities),
                Arc::new(Air),
                Arc::new(move || clock),
            )
            .with_narrative(Some(reader)),
        )),
    );
    let app = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let routes = routes.clone();
        async move { routes.handle(request).await }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!(
        "{}",
        serde_json::json!({"public":format!("http://{}",listener.local_addr()?),"path":fixture::path(case),"expected_base":case["body"],"layer":"recorded KMA snapshot and nation city/air doubles; actual narrative HTTP/S3","production_eligible":false})
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    tokio::task::spawn_blocking(|| {
        use std::io::Read;
        let mut s = String::new();
        std::io::stdin().read_to_string(&mut s)
    })
    .await??;
    server.abort();
    let _ = server.await;
    println!(
        "{}",
        serde_json::json!({"read_provider_calls":calls.load(Ordering::SeqCst),"stopped":true})
    );
    Ok(())
}
