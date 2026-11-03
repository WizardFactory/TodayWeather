//! Empty weather store -> scripted providers -> gateway body -> canonical raw -> fresh restore.
//! This proves native wiring and replay, not live provider coverage or latency.
use super::{
    observe::{acquisition, asos_body, aws_page, city_page},
    source_s3::*,
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::json;
use server2::{
    domestic::{
        Acquired, DomesticError,
        asos::{AsosKind, AsosRequest},
        family::{DataGoKrFamily as F, WebFamily, WebRequest},
        kma::{
            AssemblyConfig,
            backend::KmaBackend,
            source::{
                S3Source,
                fetch::{ForecastAcquire, ForecastRequest, Published},
                observe::Acquire,
            },
        },
        publication::Publication,
    },
    gateway::{
        BackendDispatcher, BackendMode, BoxFuture, Gateway, GatewayError, Geocoder, Version,
    },
    geocode::{GeoClient, KmaAddress, Location},
    storage::{
        CatalogLimits, CatalogStore, ProviderKey,
        response_first::{Batch, Config, Writer},
    },
    warnings::store::{StoreConfig, WarningStore},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::time::Instant;

#[derive(Default)]
struct Providers {
    calls: AtomicUsize,
    dry: bool,
}
fn publication(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
impl Acquire for Providers {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, SeqCst);
            let (kind, p, body, ct) = match request.family() {
                WebFamily::AwsMinute => (
                    "aws-minute",
                    publication(20260924, 1049),
                    aws_page("2026.09.24.10:49", false),
                    "text/html",
                ),
                WebFamily::AwsHourly => {
                    let p = request.publication().unwrap();
                    (
                        "aws-hourly",
                        p,
                        aws_page(
                            &format!(
                                "{}.{}.{}.{}:{:02}",
                                &p.base_date()[..4],
                                &p.base_date()[4..6],
                                &p.base_date()[6..],
                                p.time() / 100,
                                p.time() % 100
                            ),
                            false,
                        ),
                        "text/html",
                    )
                }
                WebFamily::CityObservation => (
                    "city-obs",
                    request.publication().unwrap(),
                    city_page("2026.9.24.10:00"),
                    "text/html;charset=UTF-8",
                ),
                _ => return Err(DomesticError::Transport),
            };
            Ok(Acquired::Complete(acquisition(
                "kma-web",
                kind,
                &request.provider_key(),
                p,
                &p.base_date(),
                body,
                ct,
            )))
        })
    }
    fn asos(
        &self,
        request: AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, SeqCst);
            let mut rows = Vec::new();
            for day in 17..=23 {
                match request.asos_kind() {
                    AsosKind::Hourly=>for hour in 0..24 {
                        rows.push(json!({"tm":format!("2026-09-{day} {hour:02}:00"),"stnId":"108",
                            "ta":"17","hm":"60","rn":if self.dry {""} else {"0.5"},"rnQcflg":"","dc10Tca":"10","dmstMtphNo":if self.dry {""} else {"01"},"ws":"2","wd":"180"}));
                    },
                    AsosKind::Daily=>rows.push(json!({"tm":format!("2026-09-{day}"),"stnId":"108",
                        "minTa":"7","maxTa":"27","avgTa":"17","avgRhm":"60","sumRn":if self.dry {""} else {"12"},"sumRnDur":if self.dry {""} else {"24"},"iscs":if self.dry {""} else {"{비}0000-2400."},"avgWs":"2"})),
                }
            }
            let start = request.start();
            Ok(Acquired::Complete(acquisition(
                "data-go-kr",
                request.asos_kind().kind(),
                &AsosRequest::record_key(request.station()),
                publication(start[..8].parse().unwrap(), 0),
                &request.range_partition(),
                asos_body(rows),
                "application/json",
            )))
        })
    }
}
struct Forecasts {
    writer: Arc<Writer>,
    calls: Arc<AtomicUsize>,
}
impl ForecastAcquire for Forecasts {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let writer = self.writer.clone();
        let calls = self.calls.clone();
        Box::pin(async move {
            if request == ForecastRequest::Warnings {
                return Ok(None);
            }
            let key = format!("test-forecast/{request:?}");
            let reserve = match &request {
                ForecastRequest::DataGoKr(r) => {
                    r.family().max_pages() as usize * 8 * 1024 * 1024 + 8 * 1024 * 1024
                }
                ForecastRequest::Zones => 88 * 1024 * 1024,
                _ => 16 * 1024 * 1024,
            };
            writer
                .acquire(
                    key,
                    reserve,
                    Instant::now() + Duration::from_secs(10),
                    async move {
                        calls.fetch_add(1, SeqCst);
                        let (source, kind, key, p, partition, body, ct) = match request {
                            ForecastRequest::DataGoKr(r) => {
                                let base = r.publication();
                                let (p, body) = match r.family() {
                                    F::UltraSrtNcst => (
                                        base,
                                        current_page(&base.base_date(), &base.base_time(), "21.5"),
                                    ),
                                    F::UltraSrtFcst => {
                                        let p = publication(base.date(), base.time() / 100 * 100);
                                        let at = slots(p.date(), p.time(), &[1, 2, 3, 4, 5, 6]);
                                        let body = envelope(forecast_items(
                                            (&base.base_date(), &base.base_time()),
                                            &at,
                                            &|_, _| {
                                                vec![
                                                    ("POP", "20".into()),
                                                    ("LGT", "0".into()),
                                                    ("PTY", "0".into()),
                                                    ("RN1", "강수없음".into()),
                                                    ("SKY", "3".into()),
                                                    ("T1H", "20".into()),
                                                    ("REH", "60".into()),
                                                    ("UUU", "0.4".into()),
                                                    ("VVV", "-1.1".into()),
                                                    ("WSD", "2".into()),
                                                    ("VEC", "180".into()),
                                                ]
                                            },
                                        ));
                                        (p, body)
                                    }
                                    F::VilageFcst => (base, short_page()),
                                    F::MidFcst => {
                                        (base, mid_page(vec![json!({"wfSv":"맑겠습니다."})]))
                                    }
                                    F::MidLandFcst => (base, mid_page(vec![land_item()])),
                                    F::MidTa => (base, mid_page(vec![temp_item()])),
                                    _ => panic!("unexpected family"),
                                };
                                (
                                    "data-go-kr",
                                    r.family().kind(),
                                    r.provider_key(),
                                    p,
                                    p.partition(),
                                    body,
                                    "application/json",
                                )
                            }
                            ForecastRequest::Rss(r) => {
                                let p = publication(20260924, 800);
                                (
                                    "kma-web",
                                    "town-rss",
                                    r.provider_key(),
                                    p,
                                    p.partition(),
                                    rss_xml(),
                                    "application/xml",
                                )
                            }
                            ForecastRequest::Zones => {
                                let p = publication(20260924, 0);
                                (
                                    "data-go-kr",
                                    "forecast-zone",
                                    ProviderKey::Named {
                                        id: "forecast-zones".into(),
                                    },
                                    p,
                                    p.base_date(),
                                    zone_page(),
                                    "application/json",
                                )
                            }
                            ForecastRequest::Warnings => unreachable!(),
                        };
                        let a = acquisition(source, kind, &key, p, &partition, body, ct);
                        Ok(Some(Batch {
                            declaration: a.declaration,
                            records: a.records,
                        }))
                    },
                )
                .await
                .map(|r| r.map(|r| r.records.clone()))
                .map_err(|e| format!("{e}"))
        })
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.writer
            .cached(&format!("test-forecast/{request:?}"))
            .map(|r| r.records.clone())
    }
}
struct FixedGeo;
impl Geocoder for FixedGeo {
    fn coord(&self, _: [f64; 2], _: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async {
            Ok(GeoClient {
                name: Some("청운효자동".into()),
                country: Some("KR".into()),
                address: Some("서울특별시 종로구 청운효자동".into()),
                location: Some(Location {
                    lat: 37.58,
                    long: 126.97,
                }),
                kma_address: Some(KmaAddress {
                    name1: "서울특별시".into(),
                    name2: Some("종로구".into()),
                    name3: Some("청운효자동".into()),
                }),
            })
        })
    }
    fn addr(&self, _: String, lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], lang)
    }
}
fn build_gateway(
    source: Arc<dyn server2::domestic::kma::backend::KmaSource>,
    summaries: Option<Arc<dyn server2::summary::SummarySink>>,
) -> Gateway {
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    let backend = Arc::new(
        KmaBackend::new(source, Arc::new(|| NOW), AssemblyConfig::default())
            .with_summaries(summaries),
    );
    backend.register(&backends);
    KmaBackend::select(&backends, BackendMode::Native).unwrap();
    Gateway::new(Arc::new(FixedGeo), backends)
        .with_weather_geocoder(Arc::new(FixedGeo), vec![Version::V000903])
}
fn http_request() -> Request<Body> {
    Request::builder()
        .uri("/weather/v000903/coord/37.58,126.97")
        .body(Body::empty())
        .unwrap()
}
fn build_source(
    peer: &Peer,
    providers: Arc<dyn Acquire>,
) -> S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>> {
    let warning = Arc::new(
        WarningStore::new(
            peer.transport_limited(2),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    S3Source::new_observed_with_warning_store(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        providers,
        Arc::new(Unreachable),
        warning,
    )
    .unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn empty_weather_store_serves_seven_days_before_raw_publication_and_replays_identically() {
    full_cycle(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dry_asos_blanks_serve_seven_days_before_raw_publication_and_replay_identically() {
    full_cycle(true).await;
}

async fn full_cycle(dry: bool) {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent(); // Fresh peer: no weather seeds.
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let providers = Arc::new(Providers {
        dry,
        ..Providers::default()
    });
    let forecasts = Arc::new(AtomicUsize::new(0));
    let source = build_source(&peer, providers.clone())
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: forecasts.clone(),
        })))
        .with_raw_writer(writer.clone());
    let recorder = Arc::new(server2::summary::Recorder::new(peer.transport_limited(2)));
    let gateway = build_gateway(Arc::new(source), Some(recorder.clone()));
    let response = gateway.handle(http_request()).await;
    assert_eq!(response.status(), 200);
    assert_eq!(
        writer.stats().publish_attempts,
        0,
        "no raw publication before the body terminal"
    );
    let receipt = response
        .extensions()
        .get::<server2::storage::response_first::ResponseScope>()
        .unwrap()
        .clone();
    let body = to_bytes(response.into_body(), 6 * 1024 * 1024)
        .await
        .unwrap();
    let weather: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(!weather["shortest"].as_array().unwrap().is_empty());
    assert!(weather["current"]["t1h"].is_number());
    for day in 17..=23 {
        let date = format!("202609{day}");
        let row = weather["midData"]["dailyData"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["date"] == date)
            .unwrap();
        for (field, value) in [
            ("tmn", json!(7)),
            ("tmx", json!(27)),
            ("rn1", json!(if dry { 0 } else { 12 })),
            ("wfAm", json!(if dry { "흐림" } else { "흐리고 비" })),
            ("wfPm", json!(if dry { "흐림" } else { "흐리고 비" })),
        ] {
            assert_eq!(row[field], value, "{date}/{field}: {row}");
        }
    }
    assert_eq!(
        weather["historyStatus"]["missingHourlySlots"],
        json!([]),
        "{}",
        weather["historyStatus"]
    );
    assert!(
        forecasts.load(SeqCst) >= 19,
        "all required current-day and future families acquired: {}",
        forecasts.load(SeqCst)
    );
    assert_eq!(
        providers.calls.load(SeqCst),
        6,
        "minute, latest/previous hour, city, ASOS hourly/daily"
    );
    assert!(writer.drain(Instant::now() + Duration::from_secs(30)).await);
    assert_eq!(writer.stats().served_raw_abandoned, 0);
    let terminal = receipt.terminal_at().unwrap();
    assert!(!receipt.batches().is_empty());
    for batch in receipt.batches() {
        let (released, reason) = batch.released.unwrap();
        assert_eq!(
            reason,
            server2::storage::response_first::ReleaseReason::BodyTerminal
        );
        assert!(
            batch.ram_ready <= terminal
                && terminal <= released
                && released <= batch.durable.unwrap()
        );
    }
    drop(gateway);
    drop(writer);
    assert!(
        recorder
            .idle(Instant::now() + Duration::from_secs(10))
            .await
    );
    let town = server2::summary::SummaryKey::Grid {
        town: ["서울특별시".into(), "종로구".into(), "청운효자동".into()],
    };
    assert!(
        !recorder
            .store()
            .names(&town, 20260923, deadline())
            .await
            .unwrap()
            .is_empty(),
        "first cold response must eventually retain its durable summary"
    );
    let restored = build_gateway(Arc::new(build_source(&peer, Arc::new(Unreachable))), None);
    let response = restored.handle(http_request()).await;
    assert_eq!(response.status(), 200);
    let restored = to_bytes(response.into_body(), 6 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(
        restored, body,
        "fresh process model, no provider or RAM, same raw closure"
    );
}
