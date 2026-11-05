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
async fn peer_status(endpoint: &str) -> serde_json::Value {
    let bytes = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!(
            "{}/__catalog/status",
            endpoint.trim_end_matches('/')
        ))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
/// S3 requests the peer served, as (`LIST`/`GET`, kind) and how many times.
async fn s3_requests(peer: &Peer) -> std::collections::BTreeMap<(String, String), u64> {
    let status = peer_status(peer.endpoint()).await;
    let mut out = std::collections::BTreeMap::new();
    for (key, count) in status.as_object().unwrap() {
        let Some((op, path)) = key.strip_prefix("OP ").and_then(|k| k.split_once(' ')) else {
            continue;
        };
        if let Some(kind) = path.split('/').nth(3) {
            *out.entry((op.to_owned(), kind.to_owned())).or_default() += count.as_u64().unwrap();
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_empty_store_answers_each_existence_question_once() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        })))
        .with_raw_writer(writer.clone());
    let gateway = build_gateway(Arc::new(source), None);
    let response = gateway.handle(http_request()).await;
    assert_eq!(response.status(), 200);
    let requests = s3_requests(&peer).await;
    let of = |op: &str, kind: &str| {
        requests
            .get(&(op.to_owned(), kind.to_owned()))
            .copied()
            .unwrap_or(0)
    };
    for kind in [
        "forecast-zone",
        "mid-ta",
        "kma-stn-info",
        "airkorea-station-list",
        "kasi-area-rise-set",
        "pwn-cd",
    ] {
        assert_eq!(of("LIST", kind), 1, "{kind}: {requests:?}");
    }
    assert_eq!(of("GET", "pwn-cd"), 0, "{requests:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_first_response_of_an_empty_store_carries_the_whole_forecast() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        })))
        .with_raw_writer(writer.clone());
    let gateway = build_gateway(Arc::new(source), None);
    let response = gateway.handle(http_request()).await;
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), 6 * 1024 * 1024)
        .await
        .unwrap();
    let weather: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let mid = &weather["midData"];
    assert_eq!(
        mid["dailyStatus"]["healthy"],
        json!(true),
        "{}",
        mid["dailyStatus"]
    );
    assert_eq!(mid["dailyStatus"]["unavailableDates"], json!([]));
    assert_eq!(mid["dailyData"].as_array().unwrap().len(), 18);
    let last = mid["dailyData"].as_array().unwrap().last().unwrap();
    assert_eq!(last["date"], json!("20261004"));
    assert_eq!(
        (last["tmn"].clone(), last["tmx"].clone()),
        (json!(12), json!(24))
    );
}

/// Publish `publications` of the test cell, as earlier requests would have.
async fn store_grid(peer: &Peer, family: F, publications: &[Publication]) {
    use server2::domestic::family::{DataGoKrRequest, Target};
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap());
    for chunk in publications.chunks(4) {
        let writer = Writer::new(store.clone(), Config::default()).unwrap();
        let forecasts = Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let mut waits = Vec::new();
        for p in chunk {
            let request =
                DataGoKrRequest::new(family, Target::Grid { nx: 60, ny: 127 }, *p).unwrap();
            waits.push(forecasts.acquire(ForecastRequest::DataGoKr(request)));
        }
        for done in futures_util::future::join_all(waits).await {
            done.unwrap();
        }
        assert!(writer.drain(Instant::now() + Duration::from_secs(30)).await);
    }
}
/// How many times the peer served each key by GET.
async fn s3_gets(peer: &Peer) -> std::collections::BTreeMap<String, u64> {
    let status = peer_status(peer.endpoint()).await;
    status
        .as_object()
        .unwrap()
        .iter()
        .filter_map(|(k, n)| {
            k.strip_prefix("OP GET ")
                .map(|k| (k.to_owned(), n.as_u64().unwrap()))
        })
        .collect()
}
/// The keys of `kind` read since `before`.
async fn read_since(
    peer: &Peer,
    before: &std::collections::BTreeMap<String, u64>,
    kind: &str,
) -> Vec<String> {
    s3_gets(peer)
        .await
        .into_iter()
        .filter(|(k, n)| k.contains(kind) && before.get(k) != Some(n))
        .map(|(k, _)| k)
        .collect()
}
/// Records how many stored reads had finished when the latest publication was requested.
struct Watching {
    inner: Forecasts,
    endpoint: String,
    reads_at_call: Arc<std::sync::Mutex<Option<usize>>>,
    watched: fn(&ForecastRequest) -> bool,
    raw: &'static str,
}
fn latest_short(request: &ForecastRequest) -> bool {
    matches!(request, ForecastRequest::DataGoKr(r) if r.family() == F::VilageFcst)
}
fn latest_rss(request: &ForecastRequest) -> bool {
    matches!(request, ForecastRequest::Rss(_))
}
impl ForecastAcquire for Watching {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let forward = self.inner.acquire(request.clone());
        let (endpoint, seen) = (self.endpoint.clone(), self.reads_at_call.clone());
        let (watched, raw) = (self.watched, self.raw);
        Box::pin(async move {
            if watched(&request) {
                let status = peer_status(&endpoint).await;
                let reads = status
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(k, _)| {
                        k.strip_prefix("OP GET ")
                            .is_some_and(|k| k.starts_with(raw))
                    })
                    .map(|(_, n)| n.as_u64().unwrap() as usize)
                    .sum();
                seen.lock().unwrap().get_or_insert(reads);
            }
            forward.await
        })
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.inner.cached(request)
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_absent_latest_short_is_requested_without_waiting_for_stored_reads() {
    use server2::history::schedule::Family as Sf;
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let latest = Sf::Short.latest(NOW as i64).unwrap();
    let mut stored = Vec::new();
    let mut p = latest;
    for _ in 0..12 {
        p = p.add_hours(-3).unwrap();
        stored.push(p);
    }
    store_grid(&peer, F::VilageFcst, &stored).await;
    // Publication itself reads each raw object back.
    let published: u64 = s3_gets(&peer)
        .await
        .iter()
        .filter(|(k, _)| k.starts_with("raw/v2/data-go-kr/vilage-fcst/"))
        .map(|(_, n)| *n)
        .sum();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let slow = client
        .post(format!(
            "{}/__catalog?mode=slow-all&key=x",
            peer.endpoint().trim_end_matches('/')
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(slow.status(), 204);
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let reads_at_call = Arc::new(std::sync::Mutex::new(None));
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Watching {
            inner: Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            },
            endpoint: peer.endpoint().to_owned(),
            reads_at_call: reads_at_call.clone(),
            watched: latest_short,
            raw: "raw/v2/data-go-kr/vilage-fcst/",
        })))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    let reads = reads_at_call
        .lock()
        .unwrap()
        .expect("latest short requested")
        - published as usize;
    assert!(
        reads < stored.len(),
        "{reads} of {} stored reads done",
        stored.len()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_absent_latest_rss_is_requested_without_waiting_for_stored_reads() {
    use server2::domestic::{family::WebRequest, publication::rss_latest};
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let key = WebRequest::town_rss(60, 127).unwrap().provider_key();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let mut p = rss_latest(NOW as i64).unwrap();
    let mut stored = 0;
    for _ in 0..12 {
        p = p.add_hours(-3).unwrap();
        let a = acquisition(
            "kma-web",
            "town-rss",
            &key,
            p,
            &p.partition(),
            rss_xml(),
            "application/xml",
        );
        store
            .publish(
                a.declaration,
                a.records,
                Instant::now() + Duration::from_secs(10),
            )
            .await
            .unwrap();
        stored += 1;
    }
    let published: u64 = s3_gets(&peer)
        .await
        .iter()
        .filter(|(k, _)| k.starts_with("raw/v2/kma-web/town-rss/"))
        .map(|(_, n)| *n)
        .sum();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let slow = client
        .post(format!(
            "{}/__catalog?mode=slow-all&key=x",
            peer.endpoint().trim_end_matches('/')
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(slow.status(), 204);
    let writer = Writer::new(store, Config::default()).unwrap();
    let reads_at_call = Arc::new(std::sync::Mutex::new(None));
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Watching {
            inner: Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            },
            endpoint: peer.endpoint().to_owned(),
            reads_at_call: reads_at_call.clone(),
            watched: latest_rss,
            raw: "raw/v2/kma-web/town-rss/",
        })))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    let reads = reads_at_call.lock().unwrap().expect("latest rss requested") - published as usize;
    assert!(reads < stored, "{reads} of {stored} stored reads done");
}

/// A listed publication whose body organizes nothing is still eligible once it has been read.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_listed_publication_that_proves_unusable_is_requested_after_the_read() {
    use server2::{
        domestic::family::{DataGoKrRequest, Target},
        history::schedule::Family as Sf,
    };
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let latest = Sf::Short.latest(NOW as i64).unwrap();
    let key = DataGoKrRequest::new(F::VilageFcst, Target::Grid { nx: 60, ny: 127 }, latest)
        .unwrap()
        .provider_key();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap());
    let a = acquisition(
        "data-go-kr",
        F::VilageFcst.kind(),
        &key,
        latest,
        &latest.partition(),
        envelope(Vec::new()),
        "application/json",
    );
    store
        .publish(
            a.declaration,
            a.records,
            Instant::now() + Duration::from_secs(10),
        )
        .await
        .unwrap();
    let writer = Writer::new(store, Config::default()).unwrap();
    let reads_at_call = Arc::new(std::sync::Mutex::new(None));
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Watching {
            inner: Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            },
            endpoint: peer.endpoint().to_owned(),
            reads_at_call: reads_at_call.clone(),
            watched: latest_short,
            raw: "raw/v2/data-go-kr/vilage-fcst/",
        })))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    assert!(
        reads_at_call.lock().unwrap().expect("requested again") > 1,
        "read back at publication, then by the request"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stored_publications_before_the_response_window_are_not_read() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let old: Vec<Publication> = (0..4).map(|h| publication(20260919, h * 100)).collect();
    let recent: Vec<Publication> = (0..4).map(|h| publication(20260923, h * 100)).collect();
    store_grid(&peer, F::UltraSrtNcst, &old).await;
    store_grid(&peer, F::UltraSrtNcst, &recent).await;
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let before = s3_gets(&peer).await;
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        })))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    let requested = read_since(&peer, &before, "ultra-srt-ncst").await;
    assert!(
        requested
            .iter()
            .any(|k| k.contains("/2026/09/23/") || k.contains("/20260923")),
        "{requested:?}"
    );
    assert!(
        !requested
            .iter()
            .any(|k| k.contains("/2026/09/19/") || k.contains("/20260919")),
        "{requested:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn only_the_newest_mid_publication_of_a_region_is_read() {
    use server2::domestic::family::{DataGoKrRequest, Target};
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    // Twice a day through this month, then the publication the clock asks for.
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let forecasts = Forecasts {
        writer: writer.clone(),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    for (date, time) in [
        (20260921, 600),
        (20260922, 600),
        (20260923, 600),
        (20260924, 600),
    ] {
        let request = DataGoKrRequest::new(
            F::MidLandFcst,
            Target::Region("11B00000".into()),
            publication(date, time),
        )
        .unwrap();
        forecasts
            .acquire(ForecastRequest::DataGoKr(request))
            .await
            .unwrap();
    }
    assert!(writer.drain(Instant::now() + Duration::from_secs(30)).await);
    let before = s3_gets(&peer).await;
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        })))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), 6 * 1024 * 1024)
        .await
        .unwrap();
    let weather: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        weather["midData"]["landPubDate"],
        json!("2026-09-23T21:00:00.000Z"),
        "{}",
        weather["midData"]["landPubDate"]
    );
    let requested = read_since(&peer, &before, "mid-land-fcst").await;
    assert!(
        !requested
            .iter()
            .any(|k| k.contains("20260923") || k.contains("/2026/09/23/")),
        "{requested:?}"
    );
}

/// A warning cycle that never ends; it offers the zone state first when asked to.
struct HeldWarnings {
    inner: Forecasts,
    store: Arc<WarningStore<server2::world::BoundedS3<server2::storage::HttpS3Transport>>>,
    offers: bool,
}
impl ForecastAcquire for HeldWarnings {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        if request == ForecastRequest::Warnings {
            let (store, offers) = (self.store.clone(), self.offers);
            return Box::pin(async move {
                if offers {
                    store.offer_zone_state(Default::default());
                }
                tokio::time::sleep(Duration::from_secs(20)).await;
                Ok(None)
            });
        }
        self.inner.acquire(request)
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.inner.cached(request)
    }
}
async fn served_with_held_warnings(offers: bool) -> Duration {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let warning = Arc::new(
        WarningStore::new(
            peer.transport_limited(2),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let source = S3Source::new_observed_with_warning_store(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        Arc::new(Providers::default()),
        Arc::new(Unreachable),
        warning.clone(),
    )
    .unwrap()
    .with_forecast(Some(Arc::new(HeldWarnings {
        inner: Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        },
        store: warning,
        offers,
    })))
    .with_raw_writer(writer.clone());
    let started = Instant::now();
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    started.elapsed()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_response_does_not_wait_for_a_warning_cycle_that_offered_its_state() {
    let held = served_with_held_warnings(true).await;
    assert!(held < Duration::from_secs(2), "{held:?}");
}

/// The request waits at most 2.5 s for what it has started, whatever is still running.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_warning_cycle_that_never_ends_does_not_hold_the_response_past_the_bound() {
    let held = served_with_held_warnings(false).await;
    assert!(held >= Duration::from_millis(2400), "{held:?}");
    assert!(held < Duration::from_secs(3), "{held:?}");
}

/// A failed or late ultra-short forecast leaves the rest of the response in its client format.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_missing_ultra_short_forecast_keeps_the_client_format() {
    struct NoShortest(Forecasts);
    impl ForecastAcquire for NoShortest {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> BoxFuture<'static, Result<Published, String>> {
            if matches!(&request, ForecastRequest::DataGoKr(r) if r.family() == F::UltraSrtFcst) {
                return Box::pin(async { Err("late".to_owned()) });
            }
            self.0.acquire(request)
        }
        fn cached(&self, request: &ForecastRequest) -> Published {
            self.0.cached(request)
        }
    }
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(NoShortest(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        }))))
        .with_raw_writer(writer.clone());
    let response = build_gateway(Arc::new(source), None)
        .handle(http_request())
        .await;
    assert_eq!(response.status(), 200);
    let body = to_bytes(response.into_body(), 6 * 1024 * 1024)
        .await
        .unwrap();
    let weather: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        weather["short"][0]["time"].is_number(),
        "{}",
        weather["short"][0]
    );
    assert!(weather["midData"]["dailyData"][0]["skyAm"].is_string());
}

/// A reader that never answers.
struct HeldNarrative;
impl server2::narrative::Read for HeldNarrative {
    fn read(
        &self,
        _station: u16,
        _deadline: Instant,
    ) -> BoxFuture<'_, Option<server2::narrative::Narrative>> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(20)).await;
            None
        })
    }
}
/// A source whose warning cycle never ends, with no offer.
fn held_source(
    peer: &Peer,
) -> Arc<S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>>> {
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let warning = Arc::new(
        WarningStore::new(
            peer.transport_limited(2),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    Arc::new(
        S3Source::new_observed_with_warning_store(
            peer.transport_limited(4),
            Arc::new(|| NOW),
            Arc::new(Providers::default()),
            Arc::new(Unreachable),
            warning.clone(),
        )
        .unwrap()
        .with_forecast(Some(Arc::new(HeldWarnings {
            inner: Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            },
            store: warning,
            offers: false,
        })))
        .with_raw_writer(writer),
    )
}

/// The narrative is added after the assembly, and it shares the request's bound too.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_narrative_that_never_ends_does_not_hold_the_response_past_the_bound() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    let backend = Arc::new(
        KmaBackend::new(
            held_source(&peer),
            Arc::new(|| NOW),
            AssemblyConfig::default(),
        )
        .with_narrative(Some(Arc::new(HeldNarrative))),
    );
    backend.register(&backends);
    KmaBackend::select(&backends, BackendMode::Native).unwrap();
    let gateway = Gateway::new(Arc::new(FixedGeo), backends)
        .with_weather_geocoder(Arc::new(FixedGeo), vec![Version::V000903]);
    let started = Instant::now();
    let response = gateway.handle(http_request()).await;
    assert_eq!(response.status(), 200);
    let held = started.elapsed();
    assert!(held < Duration::from_millis(3300), "{held:?}");
}

/// What ran before the source used up part of the wait: here all but half a second of it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_wait_ends_at_one_instant_counted_from_the_start_of_the_request() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let source = held_source(&peer);
    let backend = KmaBackend::new(source, Arc::new(|| NOW), AssemblyConfig::default());
    let started = Instant::now();
    let outcome = backend
        .outcome(
            super::source_s3::request(),
            Instant::now() + Duration::from_secs(6),
        )
        .await;
    assert!(outcome.is_ok());
    let held = started.elapsed();
    assert!(held < Duration::from_millis(1500), "{held:?}");
}

/// However late the request got to the narrative, it does not reopen the wait.
#[tokio::test]
async fn the_narrative_stops_at_one_instant_from_the_start_of_the_request() {
    use server2::domestic::kma::backend::KmaSource;
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let source = held_source(&peer);
    let now = Instant::now();
    assert_eq!(
        source.narrative_by(now + Duration::from_secs(8)),
        now + Duration::from_millis(2900)
    );
    let late = now + Duration::from_millis(5050);
    assert!(source.narrative_by(late) < Instant::now());
}

/// Places a town the list does not hold.
struct Located;
impl server2::geocode::town::Acquire for Located {
    fn address(
        &self,
        _: server2::geocode::town::Operation,
        _: String,
    ) -> BoxFuture<'_, Result<serde_json::Value, server2::geocode::GeocodeError>> {
        Box::pin(async { Ok(json!({"provider":"kakao","lat":"37.566","lon":"126.978"})) })
    }
}

/// The lookup is quick, so the forecast must not wait behind a warning cycle that never ends.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_town_outside_the_list_gets_its_forecast_within_the_bound() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let source = held_source(&peer);
    let source = Arc::into_inner(source)
        .unwrap()
        .with_town_geocoder(Some(Arc::new(Located)));
    let backend = KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    );
    let mut request = super::source_s3::request();
    request.town = Some("새동".into());
    let started = Instant::now();
    let outcome = backend
        .outcome(request, Instant::now() + Duration::from_secs(8))
        .await
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(3));
    let server2::domestic::kma::Outcome::Json(body) = outcome else {
        panic!("{outcome:?}")
    };
    let body: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    assert!(
        !body["short"].as_array().unwrap().is_empty(),
        "a forecast, not the answer for a town with none"
    );
}

/// The geocoder's name for the province must reach the listed town and its mid forecast.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_province_under_its_new_name_finds_its_town_and_mid_forecast() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_forecast(Some(Arc::new(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        })))
        .with_raw_writer(writer.clone());
    let backend = KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    );
    let request =
        server2::domestic::kma::backend::parse_path("/v000903/kma/addr/%EA%B0%95%EC%9B%90%ED%8A%B9%EB%B3%84%EC%9E%90%EC%B9%98%EB%8F%84/%EA%B0%95%EB%A6%89%EC%8B%9C/%ED%99%8D%EC%A0%9C%EB%8F%99", "ko")
            .unwrap();
    let outcome = backend
        .outcome(request, Instant::now() + Duration::from_secs(8))
        .await
        .unwrap();
    let server2::domestic::kma::Outcome::Json(body) = outcome else {
        panic!("{outcome:?}")
    };
    let body: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    assert!(
        !body["short"].as_array().unwrap().is_empty(),
        "the listed town"
    );
    let status = &body["midData"]["dailyStatus"];
    for reason in status["reasons"].as_array().unwrap() {
        assert!(
            ![
                "land-unavailable",
                "temperature-unavailable",
                "future-mid-unavailable"
            ]
            .contains(&reason.as_str().unwrap()),
            "{status}"
        );
    }
    let daily = body["midData"]["dailyData"].as_array().unwrap();
    assert_eq!(daily.last().unwrap()["date"], json!("20261004"));
}
