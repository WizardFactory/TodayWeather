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
    /// Every request: the page family and hour, or the ASOS kind and range.
    log: std::sync::Mutex<Vec<String>>,
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
            self.log.lock().unwrap().push(format!(
                "{:?} {}",
                request.family(),
                request
                    .publication()
                    .map(|p| p.compact())
                    .unwrap_or_default()
            ));
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
            self.log.lock().unwrap().push(format!(
                "{} {}-{}",
                request.asos_kind().kind(),
                request.start(),
                request.end()
            ));
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
                                    land_zone_page(),
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
/// The forecast-zone list the double answers: like the provider's, it holds every land zone the
/// release carries (`Zones::packaged`, the city zones of `getMidTa`) besides the Seoul region of
/// [`zone_page`]. A request reads this list when it is stored before its zone read and the
/// release's land zones otherwise, so a test of a town outside Seoul answers the same either way
/// (a Seoul-only list left the mid temperatures of such towns uncollected whenever it was stored
/// first).
fn land_zone_page() -> Vec<u8> {
    use server2::domestic::kma::source::{Val, Zones};
    let seoul: serde_json::Value = serde_json::from_slice(&zone_page()).unwrap();
    let mut items: Vec<serde_json::Value> = seoul["response"]["body"]["items"]["item"]
        .as_array()
        .unwrap()
        .clone();
    for zone in Zones::packaged().docs() {
        let text = |k: &str| zone.get(k).and_then(Val::as_str).unwrap().to_owned();
        let id = text("regId");
        if items.iter().any(|item| item["regId"] == id.as_str()) {
            continue;
        }
        items.push(json!({
            "regId": id,
            "tmSt": "201601010000",
            "tmEd": "210012310000",
            "regSp": text("regSp"),
            "regName": text("regName"),
        }));
    }
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": items.len()}}}))
    .unwrap()
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
struct HeldWarnings<T = server2::world::BoundedS3<server2::storage::HttpS3Transport>> {
    inner: Forecasts,
    store: Arc<WarningStore<T>>,
    offers: bool,
}
impl<T: server2::storage::CatalogTransport + Send + Sync + 'static> ForecastAcquire
    for HeldWarnings<T>
{
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

/// A warning cycle that never ends does not hold the response: the request reads the warning
/// state from S3 beside it (KMA-RESTART-RACE), so the answer does not wait for the cycle at all.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_warning_cycle_that_never_ends_does_not_hold_the_response_past_the_bound() {
    let held = served_with_held_warnings(false).await;
    assert!(held < Duration::from_millis(2400), "{held:?}");
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

/// The test double's forecast-zone request held until [`HeldZones::release`]; every other request
/// goes straight to [`Forecasts`].
struct HeldZones {
    inner: Forecasts,
    open: tokio::sync::watch::Sender<bool>,
}
impl HeldZones {
    fn release(&self) {
        self.open.send_replace(true);
    }
}
impl ForecastAcquire for HeldZones {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let mut open = self.open.subscribe();
        let zones = request == ForecastRequest::Zones;
        let acquired = self.inner.acquire(request);
        Box::pin(async move {
            if zones {
                let _ = open.wait_for(|open| *open).await;
            }
            acquired.await
        })
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.inner.cached(request)
    }
}
/// The forecast-zone lists S3 holds now.
async fn stored_zone_lists(peer: &Peer) -> usize {
    server2::history::IndexListing::list_index(
        &peer.transport_limited(2),
        "index/v2/data-go-kr/forecast-zone/",
        None,
    )
    .await
    .unwrap()
    .keys
    .len()
}

/// The geocoder's name for the province must reach the listed town and its mid forecast.
///
/// The request starts the process's forecast-zone acquisition without waiting for it, and its
/// zone read then uses the stored list when there is one, the release's land zones otherwise.
/// Each town is asked both ways: with the list stored before the request, and with the zone
/// request held until the answer is checked, so that no list is stored before it and the land
/// zones answer (TC-force-fallback-order).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_province_under_its_new_name_finds_its_town_and_mid_forecast() {
    let _peers = S3_PEERS.lock().await;
    for ((region, city, town), stored_first) in [
        ("강원특별자치도", "강릉시", "홍제동"),
        ("전북특별자치도", "군산시", "조촌동"),
        ("전남광주통합특별시", "여수시", "쌍봉동"),
        ("전남광주통합특별시", "광산구", "송정2동"),
    ]
    .into_iter()
    .flat_map(|town| [(town, true), (town, false)])
    {
        let peer = Peer::persistent();
        let store = Arc::new(
            CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap(),
        );
        let writer = Writer::new(store, Config::default()).unwrap();
        if stored_first {
            Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            }
            .acquire(ForecastRequest::Zones)
            .await
            .unwrap()
            .expect("the forecast-zone list is stored");
        }
        let zones = Arc::new(HeldZones {
            inner: Forecasts {
                writer: writer.clone(),
                calls: Arc::new(AtomicUsize::new(0)),
            },
            open: tokio::sync::watch::channel(stored_first).0,
        });
        let source = build_source(&peer, Arc::new(Providers::default()))
            .with_forecast(Some(zones.clone()))
            .with_raw_writer(writer.clone());
        let backend = KmaBackend::new(
            Arc::new(source),
            Arc::new(|| NOW),
            AssemblyConfig::default(),
        );
        let mut request = super::source_s3::request();
        request.region = Some(region.into());
        request.city = Some(city.into());
        request.town = Some(town.into());
        let outcome = backend
            .outcome(request, Instant::now() + Duration::from_secs(8))
            .await
            .unwrap();
        // The lists the answer could read: the held request stored none before it.
        assert_eq!(
            stored_zone_lists(&peer).await,
            usize::from(stored_first),
            "{region} {city}: zone lists stored at the answer (stored first: {stored_first})"
        );
        let server2::domestic::kma::Outcome::Json(body) = outcome else {
            panic!("{outcome:?}")
        };
        let body: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
        assert!(
            !body["short"].as_array().unwrap().is_empty(),
            "{region} {city}: the listed town"
        );
        assert_eq!(body["regionName"], json!(region), "the name requested");
        let status = &body["midData"]["dailyStatus"];
        for reason in status["reasons"].as_array().unwrap() {
            assert!(
                ![
                    "land-unavailable",
                    "temperature-unavailable",
                    "future-mid-unavailable"
                ]
                .contains(&reason.as_str().unwrap()),
                "{region} {city} (zone list stored first: {stored_first}): {status}"
            );
        }
        let daily = body["midData"]["dailyData"].as_array().unwrap();
        assert_eq!(daily.last().unwrap()["date"], json!("20261004"));
        // The held request then stores its list.
        zones.release();
        for _ in 0..100 {
            if stored_zone_lists(&peer).await == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(
            stored_zone_lists(&peer).await,
            1,
            "{region} {city}: the list"
        );
    }
}

/// Only those names move. Gunwi stays in Daegu: its air and food-poisoning regions are Daegu's.
#[tokio::test]
async fn the_listed_province_depends_on_the_new_name_and_its_city() {
    use server2::domestic::kma::backend::KmaSource;
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let source = build_source(&peer, Arc::new(Providers::default()));
    for (region, city, listed) in [
        ("강원특별자치도", "강릉시", "강원도"),
        ("전북특별자치도", "군산시", "전라북도"),
        ("전남광주통합특별시", "여수시", "전라남도"),
        ("전남광주통합특별시", "광산구", "광주광역시"),
        ("대구광역시", "군위군", "대구광역시"),
        ("서울특별시", "중구", "서울특별시"),
    ] {
        let mut request = super::source_s3::request();
        request.region = Some(region.into());
        request.city = Some(city.into());
        let prepared = source
            .prepare(request, Instant::now() + Duration::from_secs(8))
            .await
            .unwrap();
        assert_eq!(prepared.region.as_deref(), Some(listed), "{region} {city}");
        let requested = (listed != region).then_some(region);
        assert_eq!(
            prepared.requested_region.as_deref(),
            requested,
            "{region} {city}"
        );
    }
}

/// A mid forecast that never ends must not hold the forecast of a town outside the list.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_late_mid_does_not_hold_the_forecast_of_a_town_outside_the_list() {
    struct HeldMid(Forecasts);
    impl ForecastAcquire for HeldMid {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> BoxFuture<'static, Result<Published, String>> {
            if matches!(&request, ForecastRequest::DataGoKr(r) if r.family() == F::MidLandFcst) {
                return Box::pin(async {
                    tokio::time::sleep(Duration::from_secs(20)).await;
                    Ok(None)
                });
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
        .with_forecast(Some(Arc::new(HeldMid(Forecasts {
            writer: writer.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
        }))))
        .with_raw_writer(writer.clone())
        .with_town_geocoder(Some(Arc::new(Located)));
    let backend = KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    );
    let mut request = super::source_s3::request();
    request.town = Some("새동".into());
    let outcome = backend
        .outcome(request, Instant::now() + Duration::from_secs(8))
        .await
        .unwrap();
    let server2::domestic::kma::Outcome::Json(body) = outcome else {
        panic!("{outcome:?}")
    };
    let body: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    assert!(!body["short"].as_array().unwrap().is_empty());
}

/// A KR request's address can name the province by its new name too.
#[tokio::test]
async fn a_kr_remap_to_a_new_province_name_finds_the_listed_name() {
    use server2::domestic::kma::backend::KmaSource;
    struct Remapped;
    impl server2::geocode::town::Acquire for Remapped {
        fn address(
            &self,
            _: server2::geocode::town::Operation,
            _: String,
        ) -> BoxFuture<'_, Result<serde_json::Value, server2::geocode::GeocodeError>> {
            Box::pin(async {
                Ok(json!({"provider":"google","address":"대한민국 강원특별자치도 강릉시 홍제동"}))
            })
        }
    }
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let source = build_source(&peer, Arc::new(Providers::default()))
        .with_town_geocoder(Some(Arc::new(Remapped)));
    let request = server2::domestic::kma::backend::parse_path(
        "/v000903/kma/addr/%EA%B0%95%EB%A6%89%EC%8B%9C/KR",
        "ko",
    )
    .unwrap();
    let prepared = source
        .prepare(request, Instant::now() + Duration::from_secs(8))
        .await
        .unwrap();
    assert_eq!(prepared.region.as_deref(), Some("강원도"));
    assert_eq!(prepared.city.as_deref(), Some("강릉시"));
    assert_eq!(prepared.requested_region.as_deref(), Some("강원특별자치도"));
}

/// A lookup that outlasts the wait leaves the mid forecast the time it had from the start.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_late_town_lookup_keeps_the_mid_forecast_of_its_region() {
    struct NeverLocated;
    impl server2::geocode::town::Acquire for NeverLocated {
        fn address(
            &self,
            _: server2::geocode::town::Operation,
            _: String,
        ) -> BoxFuture<'_, Result<serde_json::Value, server2::geocode::GeocodeError>> {
            Box::pin(async {
                tokio::time::sleep(Duration::from_secs(20)).await;
                Err(server2::geocode::GeocodeError::Provider)
            })
        }
    }
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
        .with_raw_writer(writer.clone())
        .with_town_geocoder(Some(Arc::new(NeverLocated)));
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
        !body["midData"]["forecast"].is_null(),
        "{}",
        body["midData"]
    );
}

// ---- KMA-RESTART-RACE: the narrative and the warning state start with the request ----

use super::observe::{Counted, STATION_RAW};
use server2::domestic::kma::source::life_live::{LifeAcquire, LifeOutcome, LifeRequest};
use server2::narrative::{
    Read as _,
    provider::{Page, Source},
    store::{Service, Store},
};
use server2::warnings::zones::{Entry, Town, ZoneState, ZoneTable};

/// A KST hour (`YYYYMMDDHHMM`) `back` hours before the current one: a narrative published then
/// is fresh on the wall clock.
fn hour_before(back: i64) -> String {
    let now = server2::narrative::now_ms();
    server2::history::schedule::from_ms(now - back * 3_600_000)
        .hour_start()
        .compact()
}
/// The forecast office 109's narrative published at `tm`.
fn narrative_page(tm: &str, text: &str) -> Page {
    let body = json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": [{"stnId": 109, "tmFc": tm, "wfSv1": text}]},
                 "pageNo": 1, "numOfRows": 10, "totalCount": 1}}});
    Page {
        body: serde_json::to_vec(&body).unwrap().into(),
        fetched_at_ms: server2::narrative::now_ms() as u64,
        content_type: "application/json".into(),
    }
}
/// The narrative provider of the forecast offices: answers office 109 with the current hour's
/// "acquired" narrative; every fetch counted.
#[derive(Default)]
struct Office {
    fetched: AtomicUsize,
}
impl Source for Office {
    fn fetch(
        &self,
        station: u16,
        _: Instant,
    ) -> BoxFuture<'_, Result<Option<Page>, server2::providers::AcquisitionError>> {
        self.fetched.fetch_add(1, SeqCst);
        let page = (station == 109).then(|| narrative_page(&hour_before(0), "acquired"));
        Box::pin(async move { Ok(page) })
    }
}
/// The narrative office 109 published an hour ago, as stored by an earlier process.
async fn store_narrative(peer: &Peer) {
    Store::new(peer.transport_limited(2))
        .unwrap()
        .publish(109, narrative_page(&hour_before(1), "stored"), deadline())
        .await
        .unwrap()
        .expect("a fresh narrative");
}
/// The observed source of a process reading through `counted`; its warning store is on the bulk
/// lane, as the process wiring builds it.
fn observed_on(counted: &Counted, acquire: Arc<dyn Acquire>) -> S3Source<Counted> {
    let warnings = Arc::new(
        WarningStore::new(
            counted.bulk(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    S3Source::new_observed_with_warning_store(
        counted.clone(),
        Arc::new(|| NOW),
        acquire,
        Arc::new(Unreachable),
        warnings,
    )
    .unwrap()
}
/// One answer of `backend` for the Seoul town with the production budget, and how long it took.
async fn answer_of(backend: &KmaBackend) -> (serde_json::Value, Duration) {
    let started = Instant::now();
    let outcome = backend
        .outcome(
            super::source_s3::request(),
            Instant::now() + Duration::from_secs(8),
        )
        .await
        .unwrap();
    let server2::domestic::kma::Outcome::Json(body) = outcome else {
        panic!("no body");
    };
    (
        serde_json::from_slice(&body.to_bytes()).unwrap(),
        started.elapsed(),
    )
}
fn narrative_backend(source: S3Source<Counted>, service: Arc<Service<Counted>>) -> KmaBackend {
    KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    )
    .with_narrative(Some(service))
}

/// NARRATIVE: the stored read starts with the request, beside the snapshot. Here the snapshot
/// takes until its wait ends (its warning state read is held), and a read started after it
/// would end past the narrative's bound.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_narrative_is_read_while_the_snapshot_runs() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    let gate = counted.hold(&["raw/v2/kma-warning/"]);
    counted.delay_gets(
        "raw/v2/kma-forecast-narrative/",
        0,
        Duration::from_millis(400),
    );
    let office = Arc::new(Office::default());
    let service = Arc::new(Service::new(counted.clone(), office.clone()).unwrap());
    let backend = narrative_backend(observed_on(&counted, Arc::new(Unreachable)), service);
    let (body, took) = answer_of(&backend).await;
    gate.open();
    assert!(gate.was_reached(), "the warning state read is held");
    assert!(took >= Duration::from_millis(2400), "{took:?}");
    assert!(
        body["forecastNarrative"]["text"].is_string(),
        "{}",
        body["forecastNarrative"]
    );
}

/// NARRATIVE: a stored read slower than one waiter goes on, and the next request answers from it
/// (no error gate hides it).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_waiter_timeout_keeps_the_next_narrative() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    counted.delay_gets("raw/v2/kma-forecast-narrative/", 0, Duration::from_secs(1));
    let office = Arc::new(Office::default());
    let service = Service::new(counted.clone(), office.clone()).unwrap();
    let first = service
        .read(109, Instant::now() + Duration::from_millis(300))
        .await;
    assert!(first.is_none(), "the waiter stops waiting");
    let next = service
        .read(109, Instant::now() + Duration::from_secs(3))
        .await;
    assert_eq!(next.map(|n| n.text), Some("stored".to_owned()));
    assert_eq!(office.fetched.load(SeqCst), 0);
}

/// RACE and NARRATIVE: an office whose stored read has no answer at the head start is acquired
/// once, whatever the number of requests, and the requests answer with the acquired narrative.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_office_read_fetches_that_office_once() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative(&peer).await;
    let counted = Counted::new(peer.transport_limited(8));
    let gate = counted.hold(&["raw/v2/kma-forecast-narrative/"]);
    let office = Arc::new(Office::default());
    let service = Arc::new(Service::new(counted.clone(), office.clone()).unwrap());
    let backend = narrative_backend(observed_on(&counted, Arc::new(Unreachable)), service);
    let (a, b, c) = tokio::join!(
        answer_of(&backend),
        answer_of(&backend),
        answer_of(&backend)
    );
    gate.open();
    assert!(gate.was_reached(), "the office's stored read is held");
    for (body, _) in [a, b, c] {
        assert_eq!(
            body["forecastNarrative"]["text"], "acquired",
            "{}",
            body["forecastNarrative"]
        );
    }
    assert_eq!(
        office.fetched.load(SeqCst),
        1,
        "one acquisition of the office"
    );
}

/// The narrative provider with a held fetch of office 109: it answers that office's narrative
/// published at `tm` once the test releases it (the other offices: none); fetches of 109 counted.
struct HeldOffice {
    tm: String,
    started: tokio::sync::watch::Sender<usize>,
    release: tokio::sync::watch::Sender<bool>,
}
impl HeldOffice {
    fn new(tm: String) -> Self {
        Self {
            tm,
            started: tokio::sync::watch::channel(0).0,
            release: tokio::sync::watch::channel(false).0,
        }
    }
    /// Fetches of office 109 so far.
    fn fetched(&self) -> usize {
        *self.started.borrow()
    }
    /// Wait until `n` fetches of office 109 started.
    async fn started(&self, n: usize) {
        let _ = self.started.subscribe().wait_for(|s| *s >= n).await;
    }
    fn release(&self) {
        self.release.send_replace(true);
    }
}
impl Source for HeldOffice {
    fn fetch(
        &self,
        station: u16,
        _: Instant,
    ) -> BoxFuture<'_, Result<Option<Page>, server2::providers::AcquisitionError>> {
        Box::pin(async move {
            if station != 109 {
                return Ok(None);
            }
            self.started.send_modify(|n| *n += 1);
            let _ = self.release.subscribe().wait_for(|r| *r).await;
            Ok(Some(narrative_page(&self.tm, "acquired")))
        })
    }
}
/// Publish office 109's narrative of `tm` as an earlier process stored it.
async fn store_narrative_of(peer: &Peer, tm: &str) {
    Store::new(peer.transport_limited(2))
        .unwrap()
        .publish(109, narrative_page(tm, "stored"), deadline())
        .await
        .unwrap()
        .expect("a fresh narrative");
}
/// What office 109 answers now (a stored read may start).
async fn office_text(service: &Service<Counted>) -> Option<String> {
    service
        .read(109, Instant::now() + Duration::from_secs(3))
        .await
        .map(|n| n.text)
}

/// RACE and NARRATIVE (RR2-narrative-regression): an acquisition raced at the head start that ends
/// after the stored read answered with a newer publication does not replace it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_late_raced_acquisition_keeps_the_newer_stored_narrative() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative_of(&peer, &hour_before(0)).await;
    let counted = Counted::new(peer.transport_limited(4));
    let gate = counted.hold(&["raw/v2/kma-forecast-narrative/"]);
    // The provider answers the narrative of the hour before.
    let office = Arc::new(HeldOffice::new(hour_before(1)));
    let service = Service::new(counted.clone(), office.clone()).unwrap();
    service.prefetch(109, Instant::now());
    office.started(1).await;
    gate.open();
    assert_eq!(office_text(&service).await.as_deref(), Some("stored"));
    office.release();
    // Its publication is written, and the newer stored narrative still answers.
    let published = "PUT index/v2/kma-forecast-narrative/overview";
    for _ in 0..100 {
        if counted.get(published) > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(counted.get(published) > 0, "{:?}", counted.counts());
    for _ in 0..10 {
        assert_eq!(
            office_text(&service).await.as_deref(),
            Some("stored"),
            "the newer publication answers"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(office.fetched(), 1);
}

/// NARRATIVE (RR2-narrative-singleflight): a request's race for an office the periodic refresh is
/// fetching joins that fetch and its publication: one provider call.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_race_joins_the_refresh_fetch_of_the_office() {
    use server2::narrative::Acquire as _;
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative_of(&peer, &hour_before(1)).await;
    let counted = Counted::new(peer.transport_limited(4));
    let gate = counted.hold(&["raw/v2/kma-forecast-narrative/"]);
    let office = Arc::new(HeldOffice::new(hour_before(0)));
    let service = Arc::new(Service::new(counted.clone(), office.clone()).unwrap());
    let refresh = tokio::spawn({
        let service = service.clone();
        async move { service.refresh().await }
    });
    office.started(1).await;
    // The request's stored read is held, so its race starts at once.
    service.prefetch(109, Instant::now());
    let again = tokio::time::timeout(Duration::from_secs(1), office.started(2)).await;
    office.release();
    refresh.await.unwrap();
    gate.open();
    assert!(again.is_err(), "the race fetched the office again");
    assert_eq!(office.fetched(), 1, "one fetch of the office");
    assert_eq!(office_text(&service).await.as_deref(), Some("acquired"));
}

/// FAST (narrative): a stored read done before the head start acquires nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fast_office_read_fetches_nothing() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_narrative(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    let office = Arc::new(Office::default());
    let service = Arc::new(Service::new(counted.clone(), office.clone()).unwrap());
    let backend = narrative_backend(observed_on(&counted, Arc::new(Unreachable)), service);
    let (body, _) = answer_of(&backend).await;
    assert_eq!(body["forecastNarrative"]["text"], "stored");
    assert_eq!(office.fetched.load(SeqCst), 0);
}

/// The Seoul town's warning zones (서울특별시 종로구 청운효자동).
fn town_zones() -> Vec<String> {
    ZoneTable::shared(NOW as i64).zones_for_town(&Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: "청운효자동".into(),
    })
}
/// A zone state with one active warning (warnVar 1, a watch) in the Seoul town's first zone.
fn warned_state() -> ZoneState {
    let mut state = ZoneState::on_seed(None);
    state.insert(Entry {
        area_code: town_zones()[0].clone(),
        area_name: "서울".into(),
        warn_var: 1.,
        warn_stress: 0.,
        active: true,
        command: "1".into(),
        event_tm_fc: 202609240900.,
        event_tm_seq: 1.,
        event_rank: 1.,
    });
    state
}
/// Store the warned zone state as the warning collector stores it, synced an hour before NOW.
async fn store_warned_state(peer: &Peer) {
    let store = WarningStore::new(
        peer.transport_limited(2),
        CatalogLimits::default(),
        StoreConfig::default(),
    )
    .unwrap();
    let synced = NOW as i64 - 3_600_000;
    let oldest = server2::warnings::provider::kst_date(synced, -59);
    store
        .publish_zone_snapshot(&warned_state(), synced, oldest, NOW as i64, deadline())
        .await
        .unwrap();
}

/// LANES and warnings: the request reads the warning state from the request's start on the request
/// lane, beside a warning cycle that never ends: a full bulk lane (the collector's replay) holds
/// neither, and the active warning is in the first answer within the bound.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_zone_state_read_starts_with_the_request() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    store_warned_state(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let warning = Arc::new(
        WarningStore::new(
            counted.bulk(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let source = S3Source::new_observed_with_warning_store(
        counted.clone(),
        Arc::new(|| NOW),
        Arc::new(Unreachable),
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
    })));
    counted.close_bulk();
    let backend = KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    );
    let (body, took) = answer_of(&backend).await;
    counted.open_bulk();
    assert!(took < Duration::from_millis(2400), "{took:?}");
    let special = &body["current"]["specialInfo"];
    assert_eq!(special.as_array().map_or(0, Vec::len), 1, "{special}");
    assert!(counted.get("LIST raw/v2/kma-warning/zone-state") > 0);
    assert_eq!(counted.get("bulk LIST raw/v2/kma-warning/zone-state"), 0);
}

// ---- KMA-RESTART-RACE: the whole first answer after a restart ----

/// The Seoul town's life area (`modelAreaNo` of 청운효자동).
const SEOUL_AREA: &str = "1111051500";
fn life_page(items: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": 1}}}),
    )
    .unwrap()
}
/// The life acquisition of `kind` for `period` (UV `YYYYMMDDHH`, pollen issuance, MFDS slot), as
/// the acquirer publishes it.
fn life_acquisition(kind: &str, p: Publication) -> server2::resolver::Acquisition {
    let all_areas = ProviderKey::Named {
        id: "all-areas".into(),
    };
    match kind {
        "uv-idx-v5" => {
            let mut item = json!({"code": "A07_2", "areaNo": SEOUL_AREA,
                "date": &p.compact()[..10]});
            for n in (0..=75).step_by(3) {
                item[format!("h{n}")] = json!("5");
            }
            acquisition(
                "data-go-kr",
                kind,
                &all_areas,
                p,
                &p.partition(),
                life_page(json!([item])),
                "application/json",
            )
        }
        "mfds-food-poisoning" => acquisition(
            "mfds",
            kind,
            &ProviderKey::Named {
                id: "nation".into(),
            },
            p,
            &p.base_date(),
            json!({"success": true, "data": [{"locationId": 1, "sd": "서울특별시", "sgg": "종로구",
                "todayRisk": 0.5, "tomorrowRisk": 0.7, "afterTomorrowRisk": 0.9,
                "baseDate": "20260924", "regDatetime": "2026-09-240700"}]})
            .to_string()
            .into_bytes(),
            "application/json",
        ),
        // Pollen of the 06 KST issuance, asked at `p`.
        _ => acquisition(
            "data-go-kr",
            kind,
            &all_areas,
            p,
            &p.partition(),
            life_page(
                json!([{"code": "D07", "areaNo": SEOUL_AREA, "date": "2026092406",
                "today": "1", "tomorrow": "2", "dayaftertomorrow": "0",
                "twodaysaftertomorrow": "3"}]),
            ),
            "application/json",
        ),
    }
}
const POLLEN: [&str; 3] = ["oak-pollen-v3", "pine-pollen-v3", "weeds-pollen-v3"];
/// What the life providers answer now, published as the acquirer publishes; every request but
/// the KASI capture's logged (rise/set fails at once, ending the capture's areas).
struct LifeNow {
    store: Arc<CatalogStore<server2::world::BoundedS3<server2::storage::HttpS3Transport>>>,
    log: std::sync::Mutex<Vec<String>>,
}
impl LifeAcquire for LifeNow {
    fn acquire(
        &self,
        request: LifeRequest,
        _: Instant,
    ) -> BoxFuture<'static, Result<LifeOutcome, String>> {
        let (kind, p) = match &request {
            LifeRequest::Index(r) => (r.family().kind(), r.publication()),
            LifeRequest::Mfds(slot) => ("mfds-food-poisoning", *slot),
            LifeRequest::RiseSet(_) => return Box::pin(async { Err("no rise/set".into()) }),
        };
        self.log
            .lock()
            .unwrap()
            .push(format!("{kind} {}", p.compact()));
        let store = self.store.clone();
        Box::pin(async move {
            let a = life_acquisition(kind, p);
            let records = a.records.clone();
            store
                .publish(a.declaration, a.records, deadline())
                .await
                .map_err(|e| e.to_string())?;
            Ok(LifeOutcome::Published(records))
        })
    }
}
/// Store what an earlier process left of the life datasets, the narrative and the warning state.
async fn store_earlier_families(peer: &Peer) {
    let store = CatalogStore::new(peer.transport_limited(2), CatalogLimits::default()).unwrap();
    let mut stored = vec![
        life_acquisition("uv-idx-v5", publication(20260924, 900)),
        life_acquisition("mfds-food-poisoning", publication(20260924, 820)),
    ];
    for kind in POLLEN {
        stored.push(life_acquisition(kind, publication(20260924, 1000)));
    }
    for a in stored {
        store
            .publish(a.declaration, a.records, deadline())
            .await
            .unwrap();
    }
    store_narrative(peer).await;
    store_warned_state(peer).await;
}
/// A warning cycle that offers the warned zone state, as the collector does once it fetched.
struct Offering {
    inner: Forecasts,
    store: Arc<WarningStore<Counted>>,
}
impl ForecastAcquire for Offering {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        if request == ForecastRequest::Warnings {
            self.store.offer_zone_state(warned_state());
            return Box::pin(async { Ok(None) });
        }
        self.inner.acquire(request)
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.inner.cached(request)
    }
}
/// The doubles of one process's providers.
struct Doubles {
    pages: Arc<Providers>,
    life: Arc<LifeNow>,
    office: Arc<Office>,
}
impl Doubles {
    fn new(peer: &Peer) -> Self {
        Self {
            pages: Arc::new(Providers::default()),
            life: Arc::new(LifeNow {
                store: Arc::new(
                    CatalogStore::new(peer.transport_limited(2), CatalogLimits::default()).unwrap(),
                ),
                log: Default::default(),
            }),
            office: Arc::new(Office::default()),
        }
    }
}
/// A source with a 12 s request budget: its head start (4.7 s) and waits move later by as much.
struct Longer(Arc<dyn server2::domestic::kma::backend::KmaSource>);
impl server2::domestic::kma::backend::KmaSource for Longer {
    fn request_budget(&self) -> Duration {
        Duration::from_secs(12)
    }
    fn prepare(
        &self,
        request: server2::domestic::kma::KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<server2::domestic::kma::KmaRequest, server2::domestic::kma::Outcome>>
    {
        self.0.prepare(request, deadline)
    }
    fn snapshot(
        &self,
        request: &server2::domestic::kma::KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, server2::domestic::kma::backend::SourceAnswer> {
        self.0.snapshot(request, deadline)
    }
    fn narrative_by(&self, deadline: Instant) -> Instant {
        self.0.narrative_by(deadline)
    }
    fn narrative_race(&self, deadline: Instant) -> Option<Instant> {
        self.0.narrative_race(deadline)
    }
}
/// A process of the observed source reading through `counted` with `doubles` for its providers
/// (`forecasts`: its forecast and warning acquirer, if any; `longer`: a 12 s budget).
fn process_on(
    counted: &Counted,
    doubles: &Doubles,
    forecasts: Option<(Arc<Writer>, bool)>,
    longer: bool,
) -> KmaBackend {
    let warning = Arc::new(
        WarningStore::new(
            counted.bulk(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let mut source = S3Source::new_observed_with_warning_store(
        counted.clone(),
        Arc::new(|| NOW),
        doubles.pages.clone(),
        Arc::new(Unreachable),
        warning.clone(),
    )
    .unwrap()
    .with_life(Some(doubles.life.clone()));
    if let Some((writer, offers)) = forecasts {
        let inner = Forecasts {
            writer,
            calls: Arc::new(AtomicUsize::new(0)),
        };
        source = if offers {
            source.with_forecast(Some(Arc::new(Offering {
                inner,
                store: warning,
            })))
        } else {
            source.with_forecast(Some(Arc::new(inner)))
        };
    }
    let service = Arc::new(Service::new(counted.clone(), doubles.office.clone()).unwrap());
    let source: Arc<dyn server2::domestic::kma::backend::KmaSource> = Arc::new(source);
    let source: Arc<dyn server2::domestic::kma::backend::KmaSource> = if longer {
        Arc::new(Longer(source))
    } else {
        source
    };
    KmaBackend::new(source, Arc::new(|| NOW), AssemblyConfig::default())
        .with_narrative(Some(service))
}
/// The producing process: every family stored, and its first answer.
async fn produced_answer(peer: &Peer) -> serde_json::Value {
    store_earlier_families(peer).await;
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let doubles = Doubles::new(peer);
    let backend = process_on(
        &Counted::new(peer.transport_limited(4)),
        &doubles,
        Some((writer.clone(), false)),
        false,
    );
    let (body, _) = answer_of(&backend).await;
    assert!(writer.drain(Instant::now() + Duration::from_secs(30)).await);
    body
}

/// RACE (the whole answer): a restarted process whose stored reads of the station pages, the ASOS
/// history, the life datasets, the narrative and the warning state all end after the request
/// bound answers each of them on its first request from its providers, asking each dataset key
/// once. Of the life datasets only food poisoning races: no UV or pollen acquisition starts while
/// the process's first life read runs (KMA-LIFE-FIRST-READ), so the first answer has no UV.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_restart_answers_every_stored_family_first() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let produced = produced_answer(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    let gate = counted.hold(
        &[
            &STATION_RAW[..],
            &[
                "raw/v2/data-go-kr/asos-",
                "raw/v2/data-go-kr/uv-idx-v5/",
                "raw/v2/data-go-kr/oak-pollen-v3/",
                "raw/v2/data-go-kr/pine-pollen-v3/",
                "raw/v2/data-go-kr/weeds-pollen-v3/",
                "raw/v2/mfds/",
                "raw/v2/kma-forecast-narrative/",
                "raw/v2/kma-warning/",
            ],
        ]
        .concat(),
    );
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let doubles = Doubles::new(&peer);
    let backend = process_on(&counted, &doubles, Some((writer, true)), false);
    let (body, took) = answer_of(&backend).await;
    gate.open();
    assert!(
        gate.was_reached(),
        "the stored families are read during the request"
    );
    assert!(took < Duration::from_millis(3300), "{took:?}");
    // Current station observations, the ASOS history (past days), the narrative and the active
    // warning; no UV yet.
    assert_eq!(body["current"]["stnDateTime"], "2026.09.24.10:49");
    for day in 17..=23 {
        let date = format!("202609{day}");
        let row = body["midData"]["dailyData"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["date"] == date)
            .unwrap();
        assert_eq!(
            (&row["tmn"], &row["tmx"]),
            (&json!(7), &json!(27)),
            "{date}"
        );
    }
    assert_eq!(body["historyStatus"], produced["historyStatus"]);
    assert!(produced["current"]["ultrv"].is_number());
    assert!(
        body["current"]["ultrv"].is_null(),
        "no UV before the first life read ends: {}",
        body["current"]["ultrv"]
    );
    assert_eq!(body["forecastNarrative"]["text"], "acquired");
    assert_eq!(
        body["current"]["specialInfo"],
        produced["current"]["specialInfo"]
    );
    assert!(body["current"]["specialInfo"].is_array());
    // One acquisition per dataset key.
    let pages = doubles.pages.log.lock().unwrap().clone();
    let unique: std::collections::BTreeSet<&String> = pages.iter().collect();
    assert_eq!(unique.len(), pages.len(), "{pages:?}");
    for asked in [
        "AwsMinute ",
        "AwsHourly 202609241000",
        "AwsHourly 202609240900",
        "CityObservation 202609241000",
        "asos-hourly 202609170000-202609232300",
        "asos-daily 20260917-20260923",
    ] {
        assert!(pages.iter().any(|p| p == asked), "{asked}: {pages:?}");
    }
    let life = doubles.life.log.lock().unwrap().clone();
    let kinds: Vec<&str> = life.iter().map(|l| l.split(' ').next().unwrap()).collect();
    assert_eq!(
        kinds,
        ["mfds-food-poisoning"],
        "only food poisoning races the first life read: {life:?}"
    );
    assert_eq!(doubles.office.fetched.load(SeqCst), 1);
}

/// FAST (the whole answer): a restart whose stored reads end before the head start asks none of
/// these providers and answers as the producing process. (A 12 s budget moves its head start to
/// 4.7 s, so the prompt restore stays ahead of it on a slow runner.)
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fast_restart_asks_no_provider() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let produced = produced_answer(&peer).await;
    let doubles = Doubles::new(&peer);
    let backend = process_on(
        &Counted::new(peer.transport_limited(4)),
        &doubles,
        None,
        true,
    );
    let started = Instant::now();
    let outcome = backend
        .outcome(
            super::source_s3::request(),
            Instant::now() + Duration::from_secs(12),
        )
        .await
        .unwrap();
    let server2::domestic::kma::Outcome::Json(body) = outcome else {
        panic!("no body");
    };
    let body: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    assert!(started.elapsed() < Duration::from_secs(8));
    assert_eq!(
        doubles.pages.calls.load(SeqCst),
        0,
        "no station page or range"
    );
    assert_eq!(
        doubles.life.log.lock().unwrap().clone(),
        Vec::<String>::new(),
        "no life dataset"
    );
    assert_eq!(doubles.office.fetched.load(SeqCst), 0, "no narrative");
    assert_eq!(body, produced, "the producing process's answer");
}

/// The fixed Seoul geocode of [`FixedGeo`], answered after 300 ms.
struct SlowGeo;
impl Geocoder for SlowGeo {
    fn coord(&self, loc: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            FixedGeo.coord(loc, lang).await
        })
    }
    fn addr(&self, _: String, lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        self.coord([0., 0.], lang)
    }
}
/// Station page and ASOS providers that never answer.
struct Silent;
impl Acquire for Silent {
    fn web(
        &self,
        _: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<server2::domestic::Acquired, DomesticError>> {
        Box::pin(std::future::pending())
    }
    fn asos(
        &self,
        _: AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<server2::domestic::Acquired, DomesticError>> {
        Box::pin(std::future::pending())
    }
}

/// ACCEPT-CLOCK (KMA-RESTART-BOUND): the observed request's waits count from the HTTP accept of
/// the request, not from the KMA dispatch after geocoding. With a geocoder that takes 300 ms and
/// station providers that never answer (an empty in-memory store, a paused clock), the wait for
/// the station pages still ends 2.5 s after the accept, and the answer is sent then.
#[tokio::test(start_paused = true)]
async fn the_observed_wait_counts_from_the_accept_of_the_request() {
    let mem = super::life_s3::MemS3::default();
    let warning = Arc::new(
        WarningStore::new(
            mem.clone(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let source = S3Source::new_observed_with_warning_store(
        mem,
        Arc::new(|| NOW),
        Arc::new(Silent),
        Arc::new(Unreachable),
        warning,
    )
    .unwrap();
    let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
    let backend = Arc::new(KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    ));
    backend.register(&backends);
    KmaBackend::select(&backends, BackendMode::Native).unwrap();
    let gateway = Gateway::new(Arc::new(SlowGeo), backends)
        .with_weather_geocoder(Arc::new(SlowGeo), vec![Version::V000903]);
    let accepted = Instant::now();
    let response = gateway.handle(http_request()).await;
    let took = accepted.elapsed();
    assert_eq!(response.status(), 200);
    assert_eq!(
        took,
        Duration::from_millis(2500),
        "answered at the bound from the accept"
    );
}

/// ACCEPT-CLOCK on every weather path that reaches the observed source: v000903, v000901 and the
/// unversioned path (v000901 by default, most product traffic). Each answers 2.5 s after the
/// accept with a 300 ms geocoder. With a gateway deadline shorter than the native budget the
/// answer still comes by that deadline, counted from the accept.
#[tokio::test(start_paused = true)]
async fn the_observed_wait_counts_from_the_accept_on_every_weather_path() {
    let gateway = |deadline: Option<Duration>| {
        let mem = super::life_s3::MemS3::default();
        let warning = Arc::new(
            WarningStore::new(
                mem.clone(),
                CatalogLimits::default(),
                StoreConfig::default(),
            )
            .unwrap(),
        );
        let source = S3Source::new_observed_with_warning_store(
            mem,
            Arc::new(|| NOW),
            Arc::new(Silent),
            Arc::new(Unreachable),
            warning,
        )
        .unwrap();
        let backends = BackendDispatcher::legacy("http://127.0.0.1:9").unwrap();
        server2::domestic::kma::backend::select_native_versions(
            &backends,
            Arc::new(source),
            &[Version::V000901, Version::V000903],
        )
        .unwrap();
        let gateway = match deadline {
            Some(d) => Gateway::with_limits(Arc::new(SlowGeo), backends, 10, d).unwrap(),
            None => Gateway::new(Arc::new(SlowGeo), backends),
        };
        gateway.with_weather_geocoder(Arc::new(SlowGeo), vec![Version::V000901, Version::V000903])
    };
    for uri in [
        "/weather/v000903/coord/37.58,126.97",
        "/weather/v000901/coord/37.58,126.97",
        "/weather/coord/37.58,126.97",
    ] {
        let gateway = gateway(None);
        let request = Request::builder().uri(uri).body(Body::empty()).unwrap();
        let accepted = Instant::now();
        let response = gateway.handle(request).await;
        assert_eq!(response.status(), 200, "{uri}");
        assert_eq!(accepted.elapsed(), Duration::from_millis(2500), "{uri}");
    }
    let gateway = gateway(Some(Duration::from_secs(2)));
    let request = Request::builder()
        .uri("/weather/v000903/coord/37.58,126.97")
        .body(Body::empty())
        .unwrap();
    let accepted = Instant::now();
    let _ = gateway.handle(request).await;
    assert!(
        accepted.elapsed() <= Duration::from_secs(2),
        "{:?}",
        accepted.elapsed()
    );
}
