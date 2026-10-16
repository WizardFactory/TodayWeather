//! Canonical rich fixture preparation through production acquisition validators.
//! Scripted in-process provider transports never open a network connection.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use server2::{
    budget::{BudgetError, BudgetPolicy, BudgetStore, Clock, Provider},
    domestic::{
        Acquired, DomesticAcquirer, KeyRing,
        airkorea::AirKoreaRequest,
        airkorea_image::AirKoreaImageRequest,
        asos::{AsosKind, AsosRequest},
        family::{DataGoKrFamily, DataGoKrRequest, Endpoints, Service, Target, WebRequest},
        kma::source::air_forecast::Calibration,
        metrics::DomesticMetrics,
        mfds::MfdsRequest,
        publication::Publication,
        riseset::RiseSetRequest,
    },
    providers::{
        ProviderKey, ProviderResponse, ProviderTransport, ProviderTransportError, PublicRequest,
        PublicTransport, Request,
    },
    storage::{CatalogLimits, CatalogStore},
    world::BoundedS3,
};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::Instant;
struct Fixed(i64);
impl Clock for Fixed {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0)
    }
}
struct Script(Mutex<VecDeque<(String, Vec<u8>)>>);
impl Script {
    fn take(&self) -> Result<ProviderResponse, ProviderTransportError> {
        let (content_type, body) = self
            .0
            .lock()
            .unwrap()
            .pop_front()
            .ok_or(ProviderTransportError::Transport)?;
        Ok(ProviderResponse {
            status: 200,
            content_type,
            body,
        })
    }
}
impl ProviderTransport for Script {
    async fn send(&self, _: &Request) -> Result<ProviderResponse, ProviderTransportError> {
        self.take()
    }
}
impl PublicTransport for Script {
    async fn fetch(&self, _: &PublicRequest) -> Result<ProviderResponse, ProviderTransportError> {
        self.take()
    }
}
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().expect("rich fixture text")
}
fn publication(v: &str) -> Publication {
    let compact = v.chars().filter(char::is_ascii_digit).collect::<String>();
    Publication::new(
        compact[..8].parse().unwrap(),
        compact[8..10].parse::<u16>().unwrap() * 100,
    )
    .unwrap()
}
pub async fn seed(endpoint: &str, fixture: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let Some(raw) = fixture.get("rich_raw").and_then(Value::as_array) else {
        return Ok(());
    };
    let limits = CatalogLimits::default();
    let transport = BoundedS3::new(super::settings(endpoint, None).transport()?, 4);
    let store = CatalogStore::new(transport.clone(), limits.clone())?;
    let mut total_records = 0;
    for (index, run) in raw.iter().enumerate() {
        let fetched = run["fetched_at"].as_i64().ok_or("rich fetched clock")?;
        let pages = run["pages"].as_array().ok_or("rich pages")?;
        let queue = pages
            .iter()
            .map(|p| {
                if let Some(s) = p.as_str() {
                    ("application/json".into(), s.as_bytes().to_vec())
                } else {
                    (
                        text(p, "content_type").into(),
                        STANDARD.decode(text(p, "base64")).unwrap(),
                    )
                }
            })
            .collect();
        let script = Arc::new(Script(Mutex::new(queue)));
        let clock: Arc<dyn Clock> = Arc::new(Fixed(fetched));
        let family = text(run, "family");
        let service = match family {
            "air-stations" | "air-observations" | "air-dust" => Service::AirKorea,
            "kasi" => Service::RiseSet,
            "asos-hourly" | "asos-daily" => Service::Asos,
            "life-ultrv" => Service::LivingWthrIdx,
            _ => Service::HealthWthrIdx,
        };
        let budget = Arc::new(BudgetStore::new(
            Arc::new(transport.clone()),
            BudgetPolicy {
                provider: Provider::DataGoKr,
                quota_id: format!("{index:064x}"),
                window_id: "offline-rich-seed".into(),
                starts_at_ms: fetched - 1,
                ends_at_ms: fetched + 86_400_000,
                limit: 10000,
                block_units: 512,
            },
            clock.clone(),
        )?);
        let ring = KeyRing::new(vec![(
            ProviderKey::new("synthetic-offline-key".into()).expect("valid synthetic fixture key"),
            budget,
        )])?;
        let acquire = DomesticAcquirer::new(
            script.clone(),
            script.clone(),
            BTreeMap::from([(service, ring)]),
            Endpoints::default(),
            clock,
            Arc::new(DomesticMetrics::default()),
            limits.clone(),
        )?;
        let deadline = Instant::now() + Duration::from_secs(20);
        let acquired = match family {
            "air-stations" => {
                acquire
                    .acquire_airkorea(&AirKoreaRequest::station_list(), deadline)
                    .await?
            }
            "air-observations" => {
                acquire
                    .acquire_airkorea(&AirKoreaRequest::nationwide(), deadline)
                    .await?
            }
            "air-dust" => {
                acquire
                    .acquire_airkorea(
                        &AirKoreaRequest::dust_forecast_for(publication(text(run, "announcement"))),
                        deadline,
                    )
                    .await?
            }
            "kasi" => {
                acquire
                    .acquire_rise_set(
                        &RiseSetRequest::new(text(run, "area"), text(run, "day").parse()?)?,
                        deadline,
                    )
                    .await?
            }
            "asos-hourly" | "asos-daily" => {
                let q = &run["query"];
                let kind = if family == "asos-hourly" {
                    AsosKind::Hourly
                } else {
                    AsosKind::Daily
                };
                let (start, end) = if kind == AsosKind::Hourly {
                    (
                        format!("{}{}00", text(q, "startDt"), text(q, "startHh")),
                        format!("{}{}00", text(q, "endDt"), text(q, "endHh")),
                    )
                } else {
                    (text(q, "startDt").into(), text(q, "endDt").into())
                };
                acquire
                    .acquire_asos(
                        &AsosRequest::new(kind, text(run, "station"), &start, &end)?,
                        deadline,
                    )
                    .await?
            }
            "aws-minute" => {
                acquire
                    .acquire_web(&WebRequest::aws_minute(None), deadline)
                    .await?
            }
            "aws-hourly" | "city-observation" => {
                let p = publication(text(run, "requested"));
                let request = if family == "aws-hourly" {
                    WebRequest::aws_hourly(p)?
                } else {
                    WebRequest::city(p)?
                };
                acquire.acquire_web(&request, deadline).await?
            }
            "mfds" => {
                let slot = server2::domestic::mfds::slot_at(fetched as f64).ok_or("MFDS slot")?;
                let request =
                    MfdsRequest::new(&server2::domestic::mfds::DEFAULT_ROOT.parse()?, slot)?;
                acquire.acquire_mfds(&request, deadline).await?
            }
            "air-images" => {
                let urls = run["urls"].as_array().ok_or("image URLs")?;
                let request = AirKoreaImageRequest::new(
                    publication(text(run, "announcement")),
                    urls[0].as_str().unwrap(),
                    urls[1].as_str().unwrap(),
                    Calibration::defaults(),
                )?;
                acquire.acquire_airkorea_images(&request, deadline).await?
            }
            "life-ultrv" | "life-flowerWoody" | "life-flowerPine" | "life-flowerWeeds" => {
                let family = match family {
                    "life-ultrv" => DataGoKrFamily::UvIdxV5,
                    "life-flowerWoody" => DataGoKrFamily::OakPollenV3,
                    "life-flowerPine" => DataGoKrFamily::PinePollenV3,
                    _ => DataGoKrFamily::WeedsPollenV3,
                };
                let issued = text(run, "issued");
                let p = Publication::new(issued[..8].parse()?, issued[8..10].parse::<u16>()? * 100)
                    .ok_or("life issuance")?;
                acquire
                    .acquire(
                        &DataGoKrRequest::new(family, Target::AllAreas, p)?,
                        deadline,
                    )
                    .await?
            }
            _ => return Err("unknown rich seed family".into()),
        };
        let Acquired::Complete(group) = acquired else {
            return Err(format!("rich acquisition not complete: {family} {index}").into());
        };
        if !script.0.lock().unwrap().is_empty() {
            return Err("unconsumed rich provider pages".into());
        }
        total_records += group.records.len();
        store
            .publish(
                group.declaration,
                group.records,
                Instant::now() + Duration::from_secs(20),
            )
            .await?;
    }
    if let Some(raw) = fixture.get("air_fallback_raw") {
        use server2::world::{AirCell, AirRecord, AirStore, CatalogAirStore};
        let store = CatalogAirStore::new(transport, CatalogLimits::default())?;
        store
            .publish(
                AirCell::of(
                    raw["lat"].as_f64().ok_or("air lat")?,
                    raw["lon"].as_f64().ok_or("air lon")?,
                )
                .ok_or("air cell")?,
                AirRecord {
                    provider: server2::world::air::AirProvider::Google,
                    fetched_at_ms: raw["fetched_at"].as_u64().ok_or("air fetched")?,
                    content_type: "application/json".into(),
                    body: raw["body"]
                        .as_str()
                        .ok_or("air body")?
                        .as_bytes()
                        .to_vec()
                        .into(),
                },
                Instant::now() + Duration::from_secs(20),
            )
            .await
            .map_err(|e| format!("canonical fallback publication: {e:?}"))?;
    }
    eprintln!(
        "canonical rich acquisitions={} records={total_records}",
        raw.len()
    );
    Ok(())
}

/// Cold reverse geocoding is separate from S3 weather recovery: exact request coordinates
/// stay in the geocoder's ephemeral memory and one owned loopback provider call is counted.
pub async fn coord_geocoder(
    fixture: &Value,
    transport: BoundedS3<server2::storage::HttpS3Transport>,
) -> Result<
    (
        Arc<dyn server2::gateway::Geocoder>,
        tokio::task::JoinHandle<()>,
        Arc<std::sync::atomic::AtomicUsize>,
    ),
    Box<dyn std::error::Error>,
> {
    use axum::{Router, extract::State, routing::any};
    use std::sync::atomic::{AtomicUsize, Ordering};
    let count = Arc::new(AtomicUsize::new(0));
    async fn reply(State((count, body)): State<(Arc<AtomicUsize>, Value)>) -> axum::Json<Value> {
        count.fetch_add(1, Ordering::Relaxed);
        axum::Json(body)
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let root = format!("http://{}", listener.local_addr()?);
    let app = Router::new()
        .fallback(any(reply))
        .with_state((count.clone(), fixture["coord_provider_raw"].clone()));
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let vars = BTreeMap::from([(
        "GEOCODER_KAKAO_KEYS",
        r#"["synthetic-rich-kakao"]"#.to_owned(),
    )]);
    let builtins = server2::gateway::runtime::Builtins {
        kakao: root.clone(),
        google: root,
        geocoder_daily_units: [10000, 10000],
        ..server2::gateway::runtime::Builtins::production()
    };
    let geocoder = server2::gateway::runtime::native_geocoder(
        &|key| vars.get(key).cloned(),
        transport,
        &builtins,
    )?;
    Ok((Arc::new(geocoder), task, count))
}

struct NoAirHttp;
impl server2::world::AirTransport for NoAirHttp {
    fn send(
        &self,
        _: server2::world::AirHttpRequest,
        _: Instant,
    ) -> server2::gateway::BoxFuture<
        '_,
        Result<server2::world::AirHttpResponse, server2::world::AirHttpError>,
    > {
        Box::pin(async { Err(server2::world::AirHttpError::Transport) })
    }
}
/// The ordinary configured chain restores its provider body from canonical S3. No alternate
/// execution mode is used; the test transport refuses any unexpected reacquisition.
pub fn restored_air(
    fixture: &Value,
    transport: BoundedS3<server2::storage::HttpS3Transport>,
    now: f64,
) -> Result<Option<Arc<dyn server2::world::AirSource>>, Box<dyn std::error::Error>> {
    use server2::world::{
        AirConfig, AirFunding, AirProviderConfig, CatalogAirStore, FixedClock, LiveAir,
    };
    if fixture.get("air_fallback_raw").is_none() {
        return Ok(None);
    }
    let store = Arc::new(CatalogAirStore::new(
        transport.clone(),
        CatalogLimits::default(),
    )?);
    let config = AirConfig {
        google: Some(AirProviderConfig {
            base_url: "https://airquality.googleapis.com/".into(),
            key: "synthetic-rich-google-key".into(),
            quota_id: "d".repeat(64),
            monthly_units: 100,
            block_units: 10,
        }),
        ..AirConfig::default()
    };
    let air = LiveAir::new(
        config,
        store,
        Arc::new(NoAirHttp),
        AirFunding {
            transport: Arc::new(transport),
            clock: Arc::new(Fixed(now as i64)),
        },
        Arc::new(FixedClock::new(now)),
    )
    .map_err(|e| format!("air configuration: {e:?}"))?;
    Ok(Some(Arc::new(air)))
}
