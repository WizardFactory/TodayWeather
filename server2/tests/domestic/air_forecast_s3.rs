//! S15b-3c AIR FORECAST S3: the AirKorea image forecast read back from the S06 loopback S3 test
//! peer answers `air_forecast('airkorea')` as the legacy fold of the oracle GIFs; a `kaq` request
//! gets the legacy KAQ rejection from the store and the AK-approved mapping to the AirKorea
//! forecast in the response; a missing announcement's images are acquired once through a
//! loopback stub (the dust forecast's `imageUrl[6]`/`[7]`), published before use, and a request
//! that cannot wait gets the legacy answer for missing data. TEST ONLY: no provider or AWS is
//! reached.
use super::air_forecast::{decoded, image_at, image_url, stations};
use super::source::same;
use super::source_s3::{NOW, Peer, deadline, request, seed};
use super::support::{
    FIXED_NOW, KST_BOUNDARIES, TestClock, TestInstant, clock_ms, fixed_now, oracle_config, replay,
    scenarios,
};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::{Value, json};
use server2::domestic::kma::backend::{KmaSource, SourceAnswer, parse_path};
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::air_forecast::{
    HourlyForecasts, Processed, StationValues, frame_start,
};
use server2::domestic::kma::source::air_input::AirInputs;
use server2::domestic::kma::source::airkorea::expected_announcement;
use server2::domestic::kma::source::forecast_input::pub_date;
use server2::domestic::kma::source::live::{AirKoreaAcquire, AirKoreaSettings, LiveAirKorea};
use server2::domestic::kma::source::{Doc, Val};
use server2::domestic::kma::{
    DbVersion, KmaStore, MidModel, NO_KAQ_FORECAST, Outcome, StoreError, StoreResult, TownModel,
    assemble,
};
use server2::domestic::publication::Publication;
use server2::gateway::OrderedJson;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    Pagination, Period, ProviderKey, RawRecord,
};
use server2::world::BoundedS3;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::time::Instant;

type Store = CatalogStore<BoundedS3<HttpS3Transport>>;
use super::source_s3::TEST_PERMITS;

/// The S3 store of these tests: the S06 per-operation bound at its 9 s maximum, so the image
/// groups written and read on a loaded test machine do not time out (production keeps 3 s).
fn store_for(transport: &BoundedS3<HttpS3Transport>) -> Arc<Store> {
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        raw: server2::storage::Limits {
            deadline: Duration::from_secs(9),
            ..Default::default()
        },
        ..Default::default()
    };
    Arc::new(CatalogStore::new(transport.clone(), limits).unwrap())
}
/// Publish a JSON acquisition (`data-go-kr`) as the S13b acquirer does.
async fn publish_json(
    store: &Store,
    kind: &str,
    key: &str,
    period: Period,
    partition: &str,
    fetched_at: f64,
    page: Vec<u8>,
) {
    publish(
        store,
        ("data-go-kr", kind),
        ProviderKey::Named { id: key.into() },
        period,
        partition,
        fetched_at,
        &[(page, "application/json")],
    )
    .await;
}
async fn publish(
    store: &Store,
    (source, kind): (&str, &str),
    key: ProviderKey,
    period: Period,
    partition: &str,
    fetched_at: f64,
    pages: &[(Vec<u8>, &str)],
) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, (page, content)) in pages.iter().enumerate() {
        let record = RawRecord::new(
            source,
            kind,
            &key,
            period.clone(),
            fetched_at as u64,
            200,
            content,
            Some(Pagination {
                page: i as u32 + 1,
                pages: n,
                complete: true,
            }),
            page.clone().into(),
            &limits.raw,
        )
        .unwrap();
        members.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, partition).unwrap()],
        });
        records.push(record);
    }
    let declaration = GroupDeclaration::new(members, &limits).unwrap();
    store
        .publish(declaration, records, deadline())
        .await
        .unwrap();
}
/// The oracle stations as a `getMsrstnList` page (`dmX` latitude, `dmY` longitude).
fn station_page() -> Vec<u8> {
    let items: Vec<Value> = stations()
        .iter()
        .map(|(name, lat, lon)| {
            json!({"stationName": name, "dmX": lat.to_string(), "dmY": lon.to_string(),
                   "addr": name, "item": "PM10, PM2.5", "mangName": "도시대기", "year": "2000"})
        })
        .collect();
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
        "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}}),
    )
    .unwrap()
}
/// The oracle's 23-cycle image URLs of set `A` (2026/10/14) or `B` (2026/10/15).
fn fixture_urls(set: char) -> [String; 2] {
    let day = if set == 'A' {
        "2026/10/14"
    } else {
        "2026/10/15"
    };
    [image_url("pm10", day), image_url("pm25", day)]
}
/// Image URLs of a cycle (`YYYY/MM/DD`, `HH`).
fn cycle_urls(day: &str, cycle: &str) -> [String; 2] {
    ["PM10", "PM2P5"].map(|kind| {
        format!(
            "https://www.airkorea.or.kr/dustImage/{day}/{cycle}/09km/AQF.{}.NIER_09_01.{kind}.2days.ani.gif",
            day.replace('/', "")
        )
    })
}
/// The URLs a 2026-09-24 05시 or 11시 announcement names: the previous day's 23-cycle (frames from
/// 09-24 00:00 KST).
fn near_urls() -> [String; 2] {
    cycle_urls("2026/09/23", "23")
}
/// The pages of one image acquisition: the GIFs of fixture set `set` and the manifest naming
/// `urls` (their path dates the frames).
fn image_pages(set: char, urls: &[String; 2]) -> Vec<(Vec<u8>, &'static str)> {
    let f = fixture_urls(set);
    vec![
        (image_at(&f[0]).unwrap().to_vec(), "image/gif"),
        (image_at(&f[1]).unwrap().to_vec(), "image/gif"),
        (
            serde_json::to_vec(&json!({"pm10": urls[0], "pm25": urls[1]})).unwrap(),
            "application/json",
        ),
    ]
}
/// The decoded values of fixture set `set`, dated by `urls`.
fn values(set: char, urls: &[String; 2]) -> Vec<(&'static str, f64, StationValues)> {
    let f = fixture_urls(set);
    decoded(&f[0], &f[1])
        .unwrap()
        .into_iter()
        .zip(urls)
        .zip(["PM10", "PM25"])
        .map(|(((code, _, v), url), kind)| (code, frame_start(url, kind).unwrap(), v))
        .collect()
}
/// One stored acquisition: `pubDate`, completion, fixture set, URLs.
type Run<'a> = (&'a str, f64, char, &'a [String; 2]);
/// The legacy fold after `runs` in completion order, read at `cut`.
fn expected_fold(runs: &[Run], cut: f64) -> HourlyForecasts {
    let mut fold = HourlyForecasts::default();
    for (pub_date, at, set, urls) in runs {
        if fold.has(pub_date) {
            fold.remove_old(*at);
        } else {
            fold.apply(&Processed {
                pub_date: (*pub_date).into(),
                now: *at,
                stations: &stations(),
                values: values(*set, urls),
            });
        }
    }
    fold.remove_old(cut);
    fold
}
fn town(lat: f64, lon: f64) -> Doc {
    Doc::new().with(
        "gCoord",
        Val::Doc(
            Doc::new()
                .with("lat", Val::Num(lat))
                .with("lon", Val::Num(lon)),
        ),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_snapshot_answers_the_stored_image_forecast_and_rejects_kaq() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    seed(&store, &[]).await;
    publish_json(
        &store,
        "airkorea-station-list",
        "stations",
        Period {
            local_date: 20260923,
            slot: "0000".into(),
        },
        "20260923",
        NOW - 86_400_000.,
        station_page(),
    )
    .await;
    // The 05시 announcement (expected at 10:50 KST) acquired at 06:50 KST.
    let announcement = Publication::new(20260924, 500).unwrap();
    let fetched = NOW - 4. * 3_600_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        announcement.period(),
        "20260924",
        fetched,
        &image_pages('A', &near_urls()),
    )
    .await;
    let urls = near_urls();
    let expected = expected_fold(&[("2026-09-24 05:00", fetched, 'A', &urls)], NOW);
    let s3 = S3Source::new(
        transport.clone(),
        Arc::new(|| NOW),
        Arc::new(super::source_s3::Unreachable),
        Arc::new(super::source_s3::Unreachable),
    )
    .unwrap()
    .with_air(None, None);
    let snapshot_of = |query: &str| {
        let path = format!("{}{query}", request().original_url);
        let s3 = &s3;
        async move {
            match s3
                .snapshot(&parse_path(&path, "ko").unwrap(), deadline())
                .await
            {
                SourceAnswer::Snapshot(s) => s,
                SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("forwarded: {r}"),
            }
        }
    };
    // A cold process: a request waits for the owned read and decoding at most three seconds
    // (the legacy answer for missing data until then); a later request gets the fold.
    let started = std::time::Instant::now();
    loop {
        let snapshot = snapshot_of("").await;
        if snapshot.air_forecast("airkorea", &json!("중구")).unwrap()
            != OrderedJson::Array(Vec::new())
        {
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(600),
            "never decoded"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    for query in ["?airForecastSource=airkorea", "?airForecastSource=kaq", ""] {
        let snapshot = snapshot_of(query).await;
        for (name, _, _) in stations() {
            let got = snapshot.air_forecast("airkorea", &json!(name)).unwrap();
            same(
                &got,
                &expected.by_station(&name),
                &format!("{name} {query}"),
            );
        }
        let rows = |name: &str| match snapshot.air_forecast("airkorea", &json!(name)).unwrap() {
            OrderedJson::Array(a) => a.len(),
            other => panic!("{other:?}"),
        };
        assert!(rows("중구") > 40, "decoded hours stored");
        assert_eq!(rows("울릉도"), 0, "outside the map box: no rows");
        // KAQ has no forecast: the legacy `getForecast` rejection.
        let kaq = snapshot.air_forecast("kaq", &json!("중구")).unwrap_err();
        assert_eq!(kaq.0, NO_KAQ_FORECAST);
        assert_eq!(kaq.0, "Fail to get map case");
    }
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// The replay store of one recording with KAQ rows hidden: `kaq` is the legacy rejection when no
/// KAQ forecast exists, and `airkorea` answers the recorded rows.
struct WithoutKaq(super::support::RecordedStore);
impl KmaStore for WithoutKaq {
    fn db_version(&self) -> DbVersion {
        self.0.db_version()
    }
    fn towns(&self) -> StoreResult {
        self.0.towns()
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.0.town(a, b, c)
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        self.0.region_code(region, city)
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        self.0.town_model(model, mx, my)
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        self.0.mid_model(model, reg_id)
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        self.0.forecast_zone(region, city)
    }
    fn stn_hourly_and_min_rns(
        &self,
        town: &Value,
        date_time: &str,
        current: &Value,
    ) -> StoreResult {
        self.0.stn_hourly_and_min_rns(town, date_time, current)
    }
    fn city_hourly(&self, town: &Value) -> StoreResult {
        self.0.city_hourly(town)
    }
    fn history(&self, town: &Value) -> StoreResult {
        self.0.history(town)
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.0.area_no(a, b, c)
    }
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        self.0.area_no_near(lon_lat)
    }
    fn life_index(&self, area_no: f64) -> StoreResult {
        self.0.life_index(area_no)
    }
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        self.0.food_poisoning(sd, sgg, start, end)
    }
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
        self.0.arpltn(town, now_ms)
    }
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        self.0.dust_forecast(region, city, date)
    }
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
        self.0.air_fallback(g_coord, now_ms)
    }
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        match source {
            "kaq" => Err(StoreError(NO_KAQ_FORECAST.into())),
            // The recorded KAQ rows stand in for AirKorea rows (the same row shape).
            "airkorea" => self.0.air_forecast("kaq", station),
            other => panic!("{other}"),
        }
    }
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        self.0.rise_set(geocode, dates)
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        self.0.special_zones(area_codes)
    }
    fn as_of_ms(&self) -> Option<f64> {
        self.0.as_of_ms()
    }
    fn unconsumed(&self) -> Option<String> {
        self.0.unconsumed()
    }
}
fn body(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Json(json) => serde_json::from_slice(&json.to_bytes()).unwrap(),
        Outcome::Status(code, text) => panic!("{code} {text}"),
        // S17b: `res.json(undefined)` exists only on the v000705 town route.
        Outcome::Undefined => panic!("res.json(undefined)"),
        Outcome::Legacy(reason) => panic!("forwarded: {reason}"),
        Outcome::Defect(reason) => panic!("defect: {reason}"),
    }
}

/// Legacy #2771 (S15b-3e; it replaced the S15b-3c AK-approved difference): a `kaq` request when no
/// KAQ forecast exists, as on server2 whose KAQ source is gone, is answered with the stored
/// AirKorea forecast as `_insertForecastPollutants` shapes it for `airkorea` (hourly rows and the
/// hourly AQI; the per-day summary is KAQ-only) and `forecastSource: "airkorea"`. With usable KAQ
/// rows the KAQ answer stays. The `air-kaq-*` and `air-airkorea-*` parity recordings cover the
/// legacy cases byte for byte.
#[test]
fn a_kaq_request_without_kaq_forecasts_gets_the_airkorea_forecast() {
    let sc = scenarios()
        .iter()
        .find(|s| s["id"] == "air-kaq-forecast")
        .unwrap();
    let legacy: Value = serde_json::from_str(sc["body"].as_str().unwrap()).unwrap();
    // kaq with KAQ rows: the legacy bytes.
    let store = replay(sc);
    let outcome = assemble(
        &super::support::request(sc),
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    );
    assert_eq!(body(outcome), legacy);
    assert_eq!(legacy["airInfoList"][0]["forecastSource"], "kaq");
    // kaq without any KAQ forecast: the same rows labelled AirKorea, without the KAQ-only days.
    let store = WithoutKaq(replay(sc));
    let mapped = body(assemble(
        &super::support::request(sc),
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    ));
    assert!(store.unconsumed().is_none());
    let mut expected = legacy.clone();
    let info = &mut expected["airInfoList"][0];
    info["forecastSource"] = json!("airkorea");
    for (_, pollutant) in info["pollutants"].as_object_mut().unwrap() {
        pollutant.as_object_mut().unwrap().remove("daily");
    }
    assert_eq!(mapped, expected);
    let aqi = &mapped["airInfoList"][0]["pollutants"]["aqi"];
    assert_eq!(
        aqi["hourly"],
        legacy["airInfoList"][0]["pollutants"]["aqi"]["hourly"]
    );
    assert!(aqi["hourly"].as_array().unwrap().len() > 24);
    assert_eq!(
        mapped["airInfoList"][0]["forecastPubDate"],
        "2026-09-24 05:00"
    );
}

// ---- request-time image acquisition ----

#[derive(Default)]
struct StubState {
    base: Mutex<String>,
    /// The host the dust forecast's image URLs name (default `https://www.airkorea.or.kr`).
    image_host: Mutex<Option<String>>,
    /// The image cycle the URLs name (default `23`, the characterized one).
    cycle: Mutex<Option<String>>,
    gifs: AtomicUsize,
    dust: AtomicUsize,
    delay_ms: AtomicUsize,
    /// The PM2.5 document names no image (`imageUrl8` absent).
    pm25_absent: std::sync::atomic::AtomicBool,
    /// The PM10 image answers 404 (a failed download).
    pm10_missing: std::sync::atomic::AtomicBool,
    /// The image URLs the last dust-forecast answer named.
    served: Mutex<Option<[String; 2]>>,
}
/// This module's fixed test instant (S15b-3d).
static INSTANT: TestInstant = TestInstant::new();
fn now_ms() -> f64 {
    INSTANT.get()
}
/// The inputs' and acquirers' wall clock: the fixed test instant.
fn test_clock() -> Arc<TestClock> {
    Arc::new(TestClock(&INSTANT))
}
/// The image URLs the documents name at `now`: the previous KST day's animation (its frames
/// start today 00:00 KST, as the live `11시 발표` documents of 2026-10-15 named the 10-14 one).
fn served_urls(host: &str, cycle: &str, now: f64) -> [String; 2] {
    let p = server2::world::js::parts(now + 9. * 3_600_000. - 86_400_000.).unwrap();
    let day = format!("{:04}/{:02}/{:02}", p.year, p.month, p.day);
    ["PM10", "PM2P5"].map(|kind| {
        format!(
            "{host}/dustImage/{day}/{cycle}/09km/AQF.{}.NIER_09_01.{kind}.2days.ani.gif",
            day.replace('/', "")
        )
    })
}
async fn handle(State(state): State<Arc<StubState>>, uri: Uri) -> axum::response::Response {
    let path = uri.path().to_owned();
    if path.starts_with("/dustImage/") {
        state.gifs.fetch_add(1, Ordering::SeqCst);
        let delay = state.delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        }
        // Fixture set A for any date (the documents name the current one).
        let [pm10, pm25] = fixture_urls('A');
        let gif = if path.contains(".PM2P5.") {
            image_at(&pm25).unwrap()
        } else if state.pm10_missing.load(Ordering::SeqCst) {
            return (axum::http::StatusCode::NOT_FOUND, "").into_response();
        } else {
            image_at(&pm10).unwrap()
        };
        return ([("content-type", "image/gif")], gif.to_vec()).into_response();
    }
    let body = if path.ends_with("/getMsrstnList") {
        String::from_utf8(station_page()).unwrap()
    } else if path.ends_with("/getMinuDustFrcstDspth") {
        state.dust.fetch_add(1, Ordering::SeqCst);
        let host = state
            .image_host
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "https://www.airkorea.or.kr".into());
        let cycle = state
            .cycle
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "23".into());
        let urls = served_urls(&host, &cycle, now_ms());
        *state.served.lock().unwrap() = Some(urls.clone());
        let data_time = expected_announcement(now_ms()).unwrap();
        // Like the provider's, the announcement's documents cover its day and the next (and the
        // day after from the 17시 one): at 00:00-04:59 KST the expected announcement is the
        // previous day's 23시, whose documents still answer today (`informData >= today`).
        let announced =
            server2::domestic::publication::dust_forecast_announcement(now_ms() as i64).unwrap();
        let days: Vec<String> = (0..if announced.hour() >= 17 { 3 } else { 2 })
            .map(|i| {
                let d = announced.add_hours(24 * i).unwrap().base_date();
                format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..])
            })
            .collect();
        let item = |code: &str, day: &str| {
            let mut o = json!({"dataTime": data_time, "informCode": code,
                "informData": day, "informGrade": "서울 : 보통",
                "informCause": "c", "informOverall": "o", "actionKnack": null});
            // `imageUrl7` is the PM10 image and `imageUrl8` the PM2.5 image (`imageUrl[6]`/`[7]`).
            for i in 1..=9 {
                if code == "PM25" && i == 8 && state.pm25_absent.load(Ordering::SeqCst) {
                    continue;
                }
                o[format!("imageUrl{i}")] = match i {
                    7 => json!(urls[0]),
                    8 => json!(urls[1]),
                    _ => json!(format!("{host}/dustImage/other{i}.gif")),
                };
            }
            o
        };
        let items: Vec<Value> = ["PM10", "PM25"]
            .iter()
            .flat_map(|code| days.iter().map(|day| item(code, day)))
            .collect();
        json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
            "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}})
        .to_string()
    } else {
        json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}}).to_string()
    };
    ([("content-type", "application/json")], body).into_response()
}
struct Stub {
    base: String,
    state: Arc<StubState>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Stub {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn stub() -> Stub {
    // Parse the oracle fixture and decode the served pair before anything runs (S15b3d-R1). The
    // first parse takes seconds in a test build; done inside the stub's handler it held a runtime
    // worker while an S3 publication waited on it, so the publication passed the 3 s S06 client
    // timeout (`Transport`) and the acquisition was retried only after 10 minutes.
    let [pm10, pm25] = fixture_urls('A');
    tokio::task::spawn_blocking(move || {
        stations();
        image_at(&pm10).unwrap();
        decoded(&pm10, &pm25).unwrap();
    })
    .await
    .unwrap();
    let state = Arc::new(StubState::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap());
    *state.base.lock().unwrap() = base.clone();
    let router = Router::new()
        .fallback(any(handle))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Stub { base, state, task }
}
/// The live acquirer with test-built roots: data.go.kr and the image root are the stub.
fn live(peer: &Peer, store: Arc<Store>, base: &str) -> Arc<dyn AirKoreaAcquire> {
    let vars = |name: &str| -> Option<String> {
        match name {
            "AIRKOREA_SECRET_KEYS" => Some(r#"["S15B3_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/="]"#.into()),
            _ => None,
        }
    };
    let endpoints = server2::gateway::runtime::Builtins {
        data_go_kr: base.into(),
        airkorea_images: base.into(),
        ..server2::gateway::runtime::Builtins::production()
    }
    .kma_endpoints()
    .unwrap();
    let settings = AirKoreaSettings::from_vars(&vars, endpoints)
        .unwrap()
        .unwrap();
    Arc::new(LiveAirKorea::new(
        settings,
        Arc::new(server2::domestic::kma::source::live::airkorea_transport().unwrap()),
        Arc::new(server2::providers::HttpPublicTransport::new(8 << 20).unwrap()),
        Arc::new(peer.transport_limited(super::source_s3::ACQUIRER_PERMITS)),
        store,
        test_clock(),
    ))
}
fn rows(
    answers: &server2::domestic::kma::source::air_input::AirAnswers,
    name: &str,
) -> OrderedJson {
    // No fold: the station list was not read yet (legacy answers no forecast either).
    answers
        .hourly
        .as_ref()
        .map_or(OrderedJson::Array(Vec::new()), |h| h.by_station(name))
}
/// Repeat a request until `ready` holds: a cold read with decoding may outlast one request's
/// wait (that request gets the legacy answer for missing data and the owned read continues).
/// Decoding a 48-frame 820x820 GIF takes seconds in an unoptimized test build.
async fn until<T, F, Fut>(load: F, ready: impl Fn(&T) -> bool) -> T
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    until_for(Duration::from_secs(600), load, ready).await
}
/// [`until`] within `cap`.
async fn until_for<T, F, Fut>(cap: Duration, mut load: F, ready: impl Fn(&T) -> bool) -> T
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let started = std::time::Instant::now();
    loop {
        let answer = load().await;
        if ready(&answer) {
            return answer;
        }
        assert!(
            started.elapsed() < cap,
            "never ready: {}",
            WAITING.lock().unwrap_or_else(|e| e.into_inner())
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
/// Why the last readiness check of [`until`] failed (S15b3d-R1: a stall names the missing input
/// and its error instead of only "never ready").
static WAITING: Mutex<String> = Mutex::new(String::new());
fn waiting(ready: bool, why: impl FnOnce() -> String) -> bool {
    if !ready {
        *WAITING.lock().unwrap_or_else(|e| e.into_inner()) = why();
    }
    ready
}
/// The station list, the observations and the dust forecast are in (`state`: the stub's
/// provider calls so far).
fn warmed(a: &server2::domestic::kma::source::air_input::AirAnswers, state: &StubState) -> bool {
    waiting(
        matches!(&a.dust, Some((_, Ok(_)))) && a.arpltn.is_ok(),
        || {
            format!(
                "dust {:?}, arpltn {:?}, dust-forecast calls {}",
                a.dust.as_ref().map(|d| d.1.as_ref().err()),
                a.arpltn.as_ref().err(),
                state.dust.load(Ordering::SeqCst)
            )
        },
    )
}
/// The image forecast answers 중구.
fn served(a: &server2::domestic::kma::source::air_input::AirAnswers) -> bool {
    waiting(has_rows(&rows(a, "중구")), || {
        format!("no image rows for 중구 (fold read: {})", a.hourly.is_some())
    })
}
fn has_rows(answer: &OrderedJson) -> bool {
    matches!(answer, OrderedJson::Array(r) if !r.is_empty())
}
/// The fold one acquisition of the images the stub served (`state`) between `before` and `after`
/// gives: a KST day change between them changes the one-day row cut (read on either side). The
/// documents naming the images were fetched earlier, possibly on the other side of the change.
fn acquired(before: f64, after: f64, state: &StubState, answer: &OrderedJson, name: &str) {
    let announcement = expected_announcement(before).unwrap();
    let urls = state
        .served
        .lock()
        .unwrap()
        .clone()
        .expect("documents served");
    let candidates = [before, after].map(|at| {
        expected_fold(&[(&pub_date(&announcement), at, 'A', &urls)], at).by_station(name)
    });
    assert!(
        candidates.iter().any(|c| c == answer),
        "{name}: {}",
        String::from_utf8_lossy(&answer.to_bytes())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_missing_image_forecast_is_acquired_once_and_published_before_use() {
    missing_image_forecast_at(FIXED_NOW).await;
}
/// S15b-3d: the request-time image tests at fixed instants around the KST boundaries (slow:
/// `--ignored across_kst_boundaries`).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "slow sweep; run with --ignored"]
async fn image_acquisition_across_kst_boundaries() {
    for at in KST_BOUNDARIES {
        eprintln!("image acquisition at {at}");
        missing_image_forecast_at(at).await;
        rejected_image_paths_at(at).await;
    }
}
async fn missing_image_forecast_at(at: &str) {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, at).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)));
    let seoul = town(37.5665, 126.978);
    let busan = town(35.1796, 129.0756);
    let three = || Instant::now() + Duration::from_secs(3);
    // The station list and the dust forecast (whose documents name the images) are acquired
    // first, by requests that do not read the image forecast.
    let warm = until(
        || inputs.load(&seoul, "서울특별시", "중구", true, false, now_ms(), three()),
        |a| warmed(a, &stub.state),
    )
    .await;
    assert!(warm.hourly.is_none());
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 0);
    // Two concurrent requests find the announcement's images missing.
    let before = now_ms();
    let (a, b) = tokio::join!(
        inputs.load(&seoul, "서울특별시", "중구", false, true, before, three()),
        inputs.load(
            &busan,
            "부산광역시",
            "부산진구",
            false,
            true,
            before,
            three()
        ),
    );
    // Each answers the published forecast, or the legacy answer for missing data when the
    // acquisition and decoding outlasted its wait; a later request has it.
    let settled = until(
        || inputs.load(&seoul, "서울특별시", "중구", false, true, now_ms(), three()),
        served,
    )
    .await;
    let after = now_ms();
    for answer in [&a, &b, &settled] {
        assert!(
            answer.dust.is_none(),
            "the dust forecast answer was not asked for"
        );
        if !has_rows(&rows(answer, "중구")) {
            continue;
        }
        for (name, _, _) in stations() {
            acquired(before, after, &stub.state, &rows(answer, &name), &name);
        }
    }
    assert!(matches!(rows(&settled, "중구"), OrderedJson::Array(r) if r.len() > 40));
    // The two requests (and the later ones) shared one acquisition.
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 2, "one acquisition");
    assert_eq!(stub.state.dust.load(Ordering::SeqCst), 1);
    // Later requests are served from memory: no further image call.
    let again = inputs
        .load(&seoul, "서울특별시", "중구", false, true, now_ms(), three())
        .await;
    same(
        &rows(&again, "중구"),
        &rows(&settled, "중구"),
        "served again",
    );
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 2, "one acquisition");
    // A cold reader without an acquirer restores the published images from S3.
    let cold = AirInputs::new(transport.clone(), store.clone()).with_clock(test_clock());
    let restored = until(
        || cold.load(&seoul, "서울특별시", "중구", false, true, now_ms(), three()),
        served,
    )
    .await;
    // The same acquisition, read now (rows older than a day are cut at the read).
    let restored_at = now_ms();
    for (name, _, _) in stations() {
        acquired(
            before,
            restored_at,
            &stub.state,
            &rows(&restored, &name),
            &name,
        );
    }
    // A request that does not read the image forecast does not load it.
    let none = cold
        .load(
            &seoul,
            "서울특별시",
            "중구",
            true,
            false,
            now_ms(),
            deadline(),
        )
        .await;
    assert!(none.hourly.is_none());
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 2);
    assert_eq!(transport.available(), TEST_PERMITS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_image_acquisition_releases_the_request_and_serves_the_next_one() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)));
    let seoul = town(37.5665, 126.978);
    // The station list and the dust forecast (with its image URLs) are acquired first.
    let warm = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            true,
            false,
            now_ms(),
            deadline(),
        )
        .await;
    assert!(warm.hourly.is_none());
    assert_eq!(stub.state.dust.load(Ordering::SeqCst), 1);
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 0);
    // Each image now takes two seconds: the acquisition outlasts the request.
    stub.state.delay_ms.store(2_000, Ordering::SeqCst);
    let before = now_ms();
    let started = std::time::Instant::now();
    let first = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            true,
            before,
            Instant::now() + Duration::from_secs(3),
        )
        .await;
    assert!(
        started.elapsed() < Duration::from_millis(3_500),
        "{:?}",
        started.elapsed()
    );
    // The legacy answer for missing data: no rows (`Fail to get forecast` in the response).
    same(
        &rows(&first, "중구"),
        &OrderedJson::Array(Vec::new()),
        "missing",
    );
    // The owned acquisition finishes and publishes; a later request reads it.
    let next = until(
        || {
            inputs.load(
                &seoul,
                "서울특별시",
                "중구",
                false,
                true,
                now_ms(),
                Instant::now() + Duration::from_secs(3),
            )
        },
        served,
    )
    .await;
    acquired(before, now_ms(), &stub.state, &rows(&next, "중구"), "중구");
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 2, "one acquisition");
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// Documents naming images the legacy layout rejects (another host, a non-characterized cycle,
/// a missing PM2.5 path) start no download; a failed download stores nothing (legacy master
/// `getDustImage` requires both characterized paths and both images).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rejected_image_paths_are_never_fetched_and_a_failed_download_stores_nothing() {
    rejected_image_paths_at(FIXED_NOW).await;
}
async fn rejected_image_paths_at(at: &str) {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, at).await;
    let seoul = town(37.5665, 126.978);
    let three = || Instant::now() + Duration::from_secs(3);
    for case in ["another host", "12 cycle", "no PM2.5 path", "PM10 404"] {
        let peer = Peer::new();
        let transport = peer.transport();
        let store = store_for(&transport);
        let stub = stub().await;
        match case {
            "another host" => {
                *stub.state.image_host.lock().unwrap() = Some("https://evil.example".into())
            }
            "12 cycle" => *stub.state.cycle.lock().unwrap() = Some("12".into()),
            "no PM2.5 path" => stub.state.pm25_absent.store(true, Ordering::SeqCst),
            _ => stub.state.pm10_missing.store(true, Ordering::SeqCst),
        }
        let inputs = AirInputs::new(transport.clone(), store.clone())
            .with_clock(test_clock())
            .with_acquire(Some(live(&peer, store.clone(), &stub.base)));
        // The station list and the dust forecast naming the images are stored first.
        until(
            || inputs.load(&seoul, "서울특별시", "중구", true, false, now_ms(), three()),
            |a| warmed(a, &stub.state),
        )
        .await;
        let answer = inputs
            .load(
                &seoul,
                "서울특별시",
                "중구",
                false,
                true,
                now_ms(),
                deadline(),
            )
            .await;
        assert!(
            answer.hourly.is_some(),
            "{case}: the image forecast was read"
        );
        same(
            &rows(&answer, "중구"),
            &OrderedJson::Array(Vec::new()),
            case,
        );
        let fetched = stub.state.gifs.load(Ordering::SeqCst);
        if case == "PM10 404" {
            assert!(fetched >= 1, "{case}");
        } else {
            assert_eq!(fetched, 0, "{case}: never fetched");
        }
        // Nothing was published.
        let cold = AirInputs::new(transport.clone(), store.clone()).with_clock(test_clock());
        let answer = cold
            .load(
                &seoul,
                "서울특별시",
                "중구",
                false,
                true,
                now_ms(),
                deadline(),
            )
            .await;
        same(
            &rows(&answer, "중구"),
            &OrderedJson::Array(Vec::new()),
            case,
        );
    }
}

/// An image path is fetched on the built-in image root only (a provider URL is never fetched as
/// given).
#[test]
fn image_paths_are_fetched_on_the_builtin_root() {
    let endpoints = server2::gateway::runtime::Builtins::production()
        .kma_endpoints()
        .unwrap();
    let path = "/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM10.2days.ani.gif";
    assert_eq!(
        endpoints.image_url(path).unwrap().as_str(),
        format!("https://www.airkorea.or.kr{path}")
    );
    assert!(endpoints.image_url("dustImage/a.gif").is_err());
    // The request keeps only the path of a characterized URL, http or https.
    let request = server2::domestic::airkorea_image::AirKoreaImageRequest::new(
        Publication::new(20261015, 1100).unwrap(),
        &format!("http://www.airkorea.or.kr{path}"),
        &image_url("pm25", "2026/10/14"),
        server2::domestic::kma::source::air_forecast::Calibration::defaults(),
    )
    .unwrap();
    assert_eq!(request.paths()[0], path);
    for (pm10, pm25) in [
        (
            format!("https://evil.example{path}"),
            image_url("pm25", "2026/10/14"),
        ),
        (
            image_url("pm25", "2026/10/14"),
            image_url("pm25", "2026/10/14"),
        ),
        (
            path.replace("/23/", "/12/"),
            image_url("pm25", "2026/10/14"),
        ),
    ] {
        assert!(
            server2::domestic::airkorea_image::AirKoreaImageRequest::new(
                Publication::new(20261015, 1100).unwrap(),
                &pm10,
                &pm25,
                server2::domestic::kma::source::air_forecast::Calibration::defaults(),
            )
            .is_err(),
            "{pm10}"
        );
    }
}

fn station_fold(names: &[&str]) -> Arc<server2::domestic::kma::source::airkorea::Stations> {
    let page: Value = serde_json::from_slice(&station_page()).unwrap();
    let items: Vec<Value> = page["response"]["body"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| names.is_empty() || names.contains(&i["stationName"].as_str().unwrap()))
        .cloned()
        .collect();
    let mut stations = server2::domestic::kma::source::airkorea::Stations::default();
    stations.apply(&items);
    Arc::new(stations)
}

/// One request's image forecast fold from `ImageForecasts` (three-second wait, no acquirer).
async fn image_load(
    images: &server2::domestic::kma::source::forecast_input::ImageForecasts<
        BoundedS3<HttpS3Transport>,
    >,
    now: f64,
    stations: &Arc<server2::domestic::kma::source::airkorea::Stations>,
    flights: &server2::domestic::kma::source::live::Flights,
    generation: &Arc<std::sync::atomic::AtomicU64>,
) -> Arc<HourlyForecasts> {
    images
        .load(
            now,
            stations.clone(),
            None,
            None,
            flights,
            generation,
            Instant::now() + Duration::from_secs(3),
        )
        .await
}

/// A process that holds a fold lists the day catalogs at each refresh and reads only the
/// acquisitions it does not know, also when it holds the expected announcement and when a late
/// acquisition of an earlier announcement and day appears (review S15b3c-R3); the fold replays
/// them in completion order, as a cold reader does. No publication count changes here: the
/// acquisitions come from another host.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn other_hosts_acquisitions_are_read_in_completion_order_across_days() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let key = || ProviderKey::Named {
        id: "national".into(),
    };
    let kind = ("airkorea-image", "airkorea-forecast-image");
    // 05시 at 06:50 KST; the previous day's 23시 completed at 07:50 but published late; 11시 at
    // 11:10.
    let (a_at, c_at, b_at) = (
        NOW - 4. * 3_600_000.,
        NOW - 3. * 3_600_000.,
        NOW + 20. * 60_000.,
    );
    let at05 = Publication::new(20260924, 500).unwrap();
    publish(
        &store,
        kind,
        key(),
        at05.period(),
        "20260924",
        a_at,
        &image_pages('A', &near_urls()),
    )
    .await;
    let all = station_fold(&[]);
    let names: Vec<String> = stations().into_iter().map(|s| s.0).collect();
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let reader = || {
        ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults())
            .with_refresh_interval(Duration::ZERO)
    };
    let warm = reader();
    let first = until(
        || image_load(&warm, NOW, &all, &flights, &generation),
        |f| has_rows(&f.by_station("중구")),
    )
    .await;
    let expected_a = expected_fold(&[("2026-09-24 05:00", a_at, 'A', &near_urls())], NOW);
    for n in &names {
        same(&first.by_station(n), &expected_a.by_station(n), n);
    }
    // Another host publishes the 11시 announcement (oracle set 1).
    let at11 = Publication::new(20260924, 1100).unwrap();
    publish(
        &store,
        kind,
        key(),
        at11.period(),
        "20260924",
        b_at,
        &image_pages('B', &cycle_urls("2026/09/24", "05")),
    )
    .await;
    let later = NOW + 30. * 60_000.;
    until(
        || image_load(&warm, later, &all, &flights, &generation),
        |f| f.has("2026-09-24 11:00"),
    )
    .await;
    // While the fold holds the expected 11시 announcement, a late acquisition of the previous
    // day's 23시 announcement (set 1, partition 20260923) appears; it completed before 11시.
    let at23 = Publication::new(20260923, 2300).unwrap();
    publish(
        &store,
        kind,
        key(),
        at23.period(),
        "20260923",
        c_at,
        &image_pages('B', &near_urls()),
    )
    .await;
    let (urls_a, urls_b) = (near_urls(), cycle_urls("2026/09/24", "05"));
    let expected = expected_fold(
        &[
            ("2026-09-24 05:00", a_at, 'A', &urls_a),
            ("2026-09-23 23:00", c_at, 'B', &urls_a),
            ("2026-09-24 11:00", b_at, 'B', &urls_b),
        ],
        later,
    );
    let warm_fold = until(
        || image_load(&warm, later, &all, &flights, &generation),
        |f| f.json() == expected.json(),
    )
    .await;
    let fresh = reader();
    let cold = until(
        || image_load(&fresh, later, &all, &flights, &generation),
        |f| f.has("2026-09-24 11:00"),
    )
    .await;
    for n in &names {
        same(
            &warm_fold.by_station(n),
            &expected.by_station(n),
            &format!("warm {n}"),
        );
        same(
            &cold.by_station(n),
            &expected.by_station(n),
            &format!("cold {n}"),
        );
    }
    assert_eq!(generation.load(Ordering::SeqCst), 0);
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// A new station list is decoded at once, without a publication count change and within the
/// refresh interval, also when requests with the old and the new list overlap (review
/// S15b3c-R4).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_new_station_list_decodes_everything_again_at_once() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let a_at = NOW - 4. * 3_600_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        Publication::new(20260924, 500).unwrap().period(),
        "20260924",
        a_at,
        &image_pages('A', &near_urls()),
    )
    .await;
    let expected = expected_fold(&[("2026-09-24 05:00", a_at, 'A', &near_urls())], NOW);
    let names: Vec<String> = stations().into_iter().map(|s| s.0).collect();
    let (seoul_only, all) = (station_fold(&["중구"]), station_fold(&[]));
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    // Without a station-list change nothing would refresh within the test.
    let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults())
        .with_refresh_interval(Duration::from_secs(3600));
    let seoul = until(
        || image_load(&images, NOW, &seoul_only, &flights, &generation),
        |f| has_rows(&f.by_station("중구")),
    )
    .await;
    assert!(!has_rows(&seoul.by_station("대전")));
    // Overlapping requests with the old and the new list, then the new list.
    let _ = tokio::join!(
        image_load(&images, NOW, &seoul_only, &flights, &generation),
        image_load(&images, NOW, &all, &flights, &generation),
    );
    let full = until_for(
        Duration::from_secs(240),
        || image_load(&images, NOW, &all, &flights, &generation),
        |f| has_rows(&f.by_station("대전")),
    )
    .await;
    for n in &names {
        same(
            &full.by_station(n),
            &expected.by_station(n),
            &format!("new list {n}"),
        );
    }
    assert_eq!(generation.load(Ordering::SeqCst), 0);
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// Records the image acquisitions asked for (and publishes nothing).
#[derive(Default)]
struct Recorder(Mutex<Vec<Period>>);
impl AirKoreaAcquire for Recorder {
    fn acquire(
        &self,
        _: server2::domestic::airkorea::AirKoreaRequest,
    ) -> server2::gateway::BoxFuture<'static, Result<Option<Period>, String>> {
        Box::pin(async { Ok(None) })
    }
    fn acquire_images(
        &self,
        request: server2::domestic::airkorea_image::AirKoreaImageRequest,
    ) -> server2::gateway::BoxFuture<'static, Result<Option<Period>, String>> {
        self.0.lock().unwrap().push(request.period());
        Box::pin(async { Ok(None) })
    }
}
/// The dust forecast documents of announcements (`YYYY-MM-DD HH시 발표`) naming image URLs
/// (None: the document names no image).
fn dust_documents(
    announcements: &[(&str, Option<String>, Option<String>)],
) -> server2::domestic::kma::source::airkorea::Forecasts {
    let mut f = server2::domestic::kma::source::airkorea::Forecasts::default();
    for (i, (text, pm10, pm25)) in announcements.iter().enumerate() {
        let item = |code: &str, at: usize, url: &Option<String>| {
            let mut o = json!({"dataTime": text, "informCode": code,
                "informData": format!("2026-09-2{}", 4 + i), "informGrade": "서울 : 보통"});
            for n in 1..=9 {
                o[format!("imageUrl{n}")] = json!(format!("https://www.airkorea.or.kr/u{n}.gif"));
            }
            match url {
                Some(u) => o[format!("imageUrl{at}")] = json!(u),
                None => {
                    o.as_object_mut().unwrap().remove(&format!("imageUrl{at}"));
                }
            }
            o
        };
        f.apply(text, &[item("PM10", 7, pm10), item("PM25", 8, pm25)]);
    }
    f
}

/// The images of the announcement expected now are acquired; while its dust forecast documents
/// are not published yet, those of the previous announcement (legacy ran `do` for it when it was
/// expected), unless the fold holds that one already.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_expected_announcement_or_else_the_previous_one_is_acquired() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let all = station_fold(&[]);
    // 11:20 KST: the 11시 announcement is expected.
    let now = NOW + 30. * 60_000.;
    let [pm10, pm25] = near_urls().map(Some);
    let cycle12 = || near_urls().map(|u| Some(u.replace("/2026/09/23/23/", "/2026/09/23/12/")));
    let docs = |text: &'static str, urls: [Option<String>; 2]| {
        let [a, b] = urls;
        (text, a, b)
    };
    type Documents<'a> = Vec<(&'a str, Option<String>, Option<String>)>;
    let cases: Vec<(Documents, Option<u16>)> = vec![
        (
            vec![
                docs("2026-09-24 05시 발표", [pm10.clone(), pm25.clone()]),
                docs("2026-09-24 11시 발표", [pm10.clone(), pm25.clone()]),
            ],
            Some(1100),
        ),
        (
            vec![docs("2026-09-24 05시 발표", [pm10.clone(), pm25.clone()])],
            Some(500),
        ),
        (
            vec![docs("2026-09-23 23시 발표", [pm10.clone(), pm25.clone()])],
            None,
        ),
        // The expected documents name a 12 cycle (not a six-hour cycle) or no PM2.5 image: the
        // previous.
        (
            vec![
                docs("2026-09-24 05시 발표", [pm10.clone(), pm25.clone()]),
                docs("2026-09-24 11시 발표", cycle12()),
            ],
            Some(500),
        ),
        (
            vec![
                docs("2026-09-24 05시 발표", [pm10.clone(), pm25.clone()]),
                docs("2026-09-24 11시 발표", [pm10.clone(), None]),
            ],
            Some(500),
        ),
    ];
    for (announcements, expected) in cases {
        let recorder = Arc::new(Recorder::default());
        let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults());
        let documents = dust_documents(&announcements);
        let generation = Arc::new(AtomicU64::new(0));
        images
            .load(
                now,
                all.clone(),
                Some(&documents),
                Some(recorder.clone()),
                &Flights::new(Duration::from_secs(600)),
                &generation,
                deadline(),
            )
            .await;
        let asked: Vec<Period> = recorder.0.lock().unwrap().clone();
        let want: Vec<Period> = expected
            .map(|t| Publication::new(20260924, t).unwrap().period())
            .into_iter()
            .collect();
        assert_eq!(asked, want, "{announcements:?}");
    }
    // A fold holding the previous announcement asks nothing while the expected one is missing.
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        Publication::new(20260924, 500).unwrap().period(),
        "20260924",
        NOW - 4. * 3_600_000.,
        &image_pages('A', &near_urls()),
    )
    .await;
    let recorder = Arc::new(Recorder::default());
    let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults());
    let documents = dust_documents(&[("2026-09-24 05시 발표", pm10, pm25)]);
    let generation = Arc::new(AtomicU64::new(0));
    let flights = Flights::new(Duration::from_secs(600));
    // The fold is read first (decoding may outlast one request's wait).
    until(
        || image_load(&images, now, &all, &flights, &generation),
        |f| f.has("2026-09-24 05:00"),
    )
    .await;
    images
        .load(
            now,
            all.clone(),
            Some(&documents),
            Some(recorder.clone()),
            &flights,
            &generation,
            deadline(),
        )
        .await;
    assert!(
        recorder.0.lock().unwrap().is_empty(),
        "{:?}",
        recorder.0.lock().unwrap()
    );
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// The 23-cycle image URLs of a day (`YYYY/MM/DD`).
fn urls_for(day: &str) -> [String; 2] {
    [image_url("pm10", day), image_url("pm25", day)]
}

/// A 23시 announcement's rows outlive three calendar days: its partition is still read on the
/// fourth (review S15b3c-R7), by a warm and a cold reader alike.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_announcement_stays_until_its_rows_expire() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    // 09-24 23시 over the 09/24/23 animation: rows 09-25 00:00 .. 09-26 23:00 KST.
    let urls = urls_for("2026/09/24");
    let at = NOW + 12. * 3_600_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        Publication::new(20260924, 2300).unwrap().period(),
        "20260924",
        at,
        &image_pages('A', &urls),
    )
    .await;
    let all = station_fold(&[]);
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let reader = || {
        ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults())
            .with_refresh_interval(Duration::ZERO)
    };
    let warm = reader();
    until(
        || image_load(&warm, at, &all, &flights, &generation),
        |f| f.has("2026-09-24 23:00"),
    )
    .await;
    // 09-27 10:50 KST: the 09-26 rows from 11:00 KST are still kept.
    let later = NOW + 3. * 86_400_000.;
    let expected = expected_fold(&[("2026-09-24 23:00", at, 'A', &urls)], later);
    assert!(has_rows(&expected.by_station("중구")));
    let fresh = reader();
    for (name, images) in [("warm", &warm), ("cold", &fresh)] {
        let fold = until(
            || image_load(images, later, &all, &flights, &generation),
            |f| f.json() == expected.json(),
        )
        .await;
        assert!(has_rows(&fold.by_station("중구")), "{name}");
    }
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// Two acquisitions completed in the same millisecond of one day are both folded, also when the
/// second appears after the first was read (review S15b3c-R9).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn acquisitions_completed_in_the_same_millisecond_are_both_read() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let key = || ProviderKey::Named {
        id: "national".into(),
    };
    let kind = ("airkorea-image", "airkorea-forecast-image");
    let at = NOW - 4. * 3_600_000.;
    // Non-overlapping dates, so the order of the two does not matter.
    let (first, second) = (urls_for("2026/09/21"), urls_for("2026/09/24"));
    publish(
        &store,
        kind,
        key(),
        Publication::new(20260924, 500).unwrap().period(),
        "20260924",
        at,
        &image_pages('A', &first),
    )
    .await;
    let all = station_fold(&[]);
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let reader = || {
        ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults())
            .with_refresh_interval(Duration::ZERO)
    };
    let warm = reader();
    until(
        || image_load(&warm, NOW, &all, &flights, &generation),
        |f| f.has("2026-09-24 05:00"),
    )
    .await;
    publish(
        &store,
        kind,
        key(),
        Publication::new(20260924, 1100).unwrap().period(),
        "20260924",
        at,
        &image_pages('B', &second),
    )
    .await;
    let mut expected = expected_fold(&[("2026-09-24 05:00", at, 'A', &first)], NOW);
    expected.apply(&Processed {
        pub_date: "2026-09-24 11:00".into(),
        now: at,
        stations: &stations(),
        values: values('B', &second),
    });
    expected.remove_old(NOW);
    let fresh = reader();
    for images in [&warm, &fresh] {
        let fold = until(
            || image_load(images, NOW, &all, &flights, &generation),
            |f| f.has("2026-09-24 11:00"),
        )
        .await;
        for (n, _, _) in stations() {
            same(&fold.by_station(&n), &expected.by_station(&n), &n);
        }
    }
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// A longer animation keeps an older announcement's rows alive for longer: a 96-frame 23-cycle
/// image of 09-24 runs to 09-28 23:00 KST, so on 09-29 its partition is still read, by a warm and
/// a cold reader alike (review S15b3c-R7, reopened for #2762's variable frame counts).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_long_animation_is_read_until_its_last_rows_expire() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    // The oracle's 96-frame pair, dated by the 09/24/23 path.
    let long = urls_for("2026/10/18");
    let urls = urls_for("2026/09/24");
    let pages = vec![
        (image_at(&long[0]).unwrap().to_vec(), "image/gif"),
        (image_at(&long[1]).unwrap().to_vec(), "image/gif"),
        (
            serde_json::to_vec(&json!({"pm10": urls[0], "pm25": urls[1]})).unwrap(),
            "application/json",
        ),
    ];
    let at = NOW + 12. * 3_600_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        Publication::new(20260924, 2300).unwrap().period(),
        "20260924",
        at,
        &pages,
    )
    .await;
    let points: Vec<(f64, f64)> = stations().iter().map(|(_, a, b)| (*a, *b)).collect();
    let values: Vec<(&'static str, f64, StationValues)> =
        server2::domestic::kma::source::air_forecast::CODES
            .iter()
            .zip(&long)
            .zip(&urls)
            .map(|((&(code, kind, _), image), url)| {
                let v = server2::domestic::kma::source::air_forecast::decode_gif(
                    image_at(image).unwrap(),
                    &Calibration::defaults(),
                    kind,
                    &points,
                )
                .unwrap();
                assert_eq!(v.iter().flatten().next().unwrap().len(), 96);
                (code, frame_start(url, kind).unwrap(), v)
            })
            .collect();
    // 09-29 10:50 KST: the 09-28 rows from 11:00 KST are still kept.
    let later = NOW + 5. * 86_400_000.;
    let mut expected = HourlyForecasts::default();
    expected.apply(&Processed {
        pub_date: "2026-09-24 23:00".into(),
        now: at,
        stations: &stations(),
        values,
    });
    expected.remove_old(later);
    assert!(has_rows(&expected.by_station("중구")));
    let all = station_fold(&[]);
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let reader = || {
        ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults())
            .with_refresh_interval(Duration::ZERO)
    };
    let warm = reader();
    until(
        || image_load(&warm, at, &all, &flights, &generation),
        |f| f.has("2026-09-24 23:00"),
    )
    .await;
    let fresh = reader();
    for images in [&warm, &fresh] {
        until(
            || image_load(images, later, &all, &flights, &generation),
            |f| f.json() == expected.json(),
        )
        .await;
    }
    assert_eq!(transport.available(), TEST_PERMITS);
}

/// An announcement cannot name a later cycle: an image starting after the announcement's next
/// day 00:00 KST is neither acquired nor folded (server2 safety bound; the read window relies on
/// it, review S15b3c-R7).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_image_dated_after_its_announcement_is_not_used() {
    use server2::domestic::airkorea_image::{AirKoreaImageRequest, start_allowed};
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let at05 = Publication::new(20260924, 500).unwrap();
    let later = urls_for("2026/09/25");
    for (urls, allowed) in [
        (near_urls(), true),
        (urls_for("2026/09/24"), true),
        (later.clone(), false),
    ] {
        assert_eq!(
            AirKoreaImageRequest::new(at05, &urls[0], &urls[1], Calibration::defaults()).is_ok(),
            allowed,
            "{urls:?}"
        );
        assert_eq!(
            start_allowed(frame_start(&urls[0], "PM10").unwrap(), 20260924),
            allowed
        );
    }
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let at = NOW - 4. * 3_600_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        at05.period(),
        "20260924",
        at,
        &image_pages('A', &later),
    )
    .await;
    // An allowed 11시 acquisition completes later; once it is folded, the rejected one is absent.
    let b_at = NOW + 20. * 60_000.;
    publish(
        &store,
        ("airkorea-image", "airkorea-forecast-image"),
        ProviderKey::Named {
            id: "national".into(),
        },
        Publication::new(20260924, 1100).unwrap().period(),
        "20260924",
        b_at,
        &image_pages('B', &near_urls()),
    )
    .await;
    let later = NOW + 30. * 60_000.;
    let expected = expected_fold(&[("2026-09-24 11:00", b_at, 'B', &near_urls())], later);
    let all = station_fold(&[]);
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::defaults());
    let fold = until(
        || image_load(&images, later, &all, &flights, &generation),
        |f| f.has("2026-09-24 11:00"),
    )
    .await;
    assert!(!fold.has("2026-09-24 05:00"));
    assert_eq!(fold.json(), expected.json());
    assert_eq!(transport.available(), TEST_PERMITS);
}
