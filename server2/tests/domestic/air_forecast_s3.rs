//! S15b-3c AIR FORECAST S3: the AirKorea image forecast read back from the S06 loopback S3 test
//! peer answers `air_forecast('airkorea')` as the legacy fold of the oracle GIFs; a `kaq` request
//! gets the legacy KAQ rejection from the store and the AK-approved mapping to the AirKorea
//! forecast in the response; a missing announcement's images are acquired once through a
//! loopback stub (the dust forecast's `imageUrl[6]`/`[7]`), published before use, and a request
//! that cannot wait gets the legacy answer for missing data. TEST ONLY: no provider or AWS is
//! reached.
use super::air_forecast::{decoded, set_gifs, stations};
use super::source::same;
use super::source_s3::{NOW, Peer, deadline, request, seed};
use super::support::{clock_ms, oracle_config, replay, scenarios};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::{Value, json};
use server2::domestic::kma::backend::{KmaSource, SourceAnswer, parse_path};
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::air_forecast::{HourlyForecasts, Processed};
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
use super::source_s3::{S3_PEERS as SERIAL, TEST_PERMITS};

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
/// The legacy fold after one stored run of oracle set 0 for `announcement`, at `fetched`, read
/// at `cut`.
fn expected_fold(announcement: &str, fetched: f64, cut: f64) -> HourlyForecasts {
    let mut fold = HourlyForecasts::default();
    fold.apply(&Processed {
        pub_date: pub_date(announcement),
        now: fetched,
        stations: &stations(),
        values: decoded(0),
    });
    fold.remove_old(cut);
    fold
}
fn images(set: usize) -> Vec<(Vec<u8>, &'static str)> {
    let [pm10, pm25] = set_gifs(set);
    vec![(pm10, "image/gif"), (pm25, "image/gif")]
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
    let _serial = SERIAL.lock().await;
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
        &images(0),
    )
    .await;
    let expected = expected_fold("2026-09-24 05시 발표", fetched, NOW);
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
                SourceAnswer::Forward(r) => panic!("forwarded: {r}"),
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
        Outcome::Legacy(reason) => panic!("forwarded: {reason}"),
    }
}

/// AK 2026-10-15: a `kaq` request when no KAQ forecast exists is answered with the AirKorea
/// forecast as legacy `_insertForecastPollutants` shapes it for `airkorea` (hourly rows and the
/// hourly AQI; the per-day summary is KAQ-only) and `forecastSource: "airkorea"`. With KAQ rows
/// the legacy KAQ answer stays (the `air-kaq-forecast` parity recording, byte for byte).
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
    /// The origin the dust forecast's image URLs name (default: this stub).
    image_base: Mutex<Option<String>>,
    gifs: AtomicUsize,
    dust: AtomicUsize,
    delay_ms: AtomicUsize,
}
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}
async fn handle(State(state): State<Arc<StubState>>, uri: Uri) -> axum::response::Response {
    let path = uri.path().to_owned();
    if let Some(name) = path.strip_prefix("/dustImage/") {
        state.gifs.fetch_add(1, Ordering::SeqCst);
        let delay = state.delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        }
        let [pm10, pm25] = set_gifs(0);
        let gif = match name {
            "pm10.gif" => pm10,
            "pm25.gif" => pm25,
            _ => return (axum::http::StatusCode::NOT_FOUND, "").into_response(),
        };
        return ([("content-type", "image/gif")], gif).into_response();
    }
    let body = if path.ends_with("/getMsrstnList") {
        String::from_utf8(station_page()).unwrap()
    } else if path.ends_with("/getMinuDustFrcstDspth") {
        state.dust.fetch_add(1, Ordering::SeqCst);
        let base = state
            .image_base
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| state.base.lock().unwrap().clone());
        let data_time = expected_announcement(now_ms()).unwrap();
        let item = |code: &str| {
            let mut o = json!({"dataTime": data_time, "informCode": code,
                "informData": &data_time[..10], "informGrade": "서울 : 보통",
                "informCause": "c", "informOverall": "o", "actionKnack": null});
            // `imageUrl7` is the PM10 image and `imageUrl8` the PM2.5 image (`imageUrl[6]`/`[7]`).
            for i in 1..=9 {
                let file = match i {
                    7 => "pm10.gif".to_owned(),
                    8 => "pm25.gif".to_owned(),
                    _ => format!("other{i}.gif"),
                };
                o[format!("imageUrl{i}")] = json!(format!("{base}dustImage/{file}"));
            }
            o
        };
        let items = vec![item("PM10"), item("PM25")];
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
/// The live acquirer with test-built roots: data.go.kr and the image origin are the stub.
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
        Arc::new(peer.transport()),
        store,
        Arc::new(server2::budget::SystemClock),
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
async fn until<T, F, Fut>(mut load: F, ready: impl Fn(&T) -> bool) -> T
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
        assert!(started.elapsed() < Duration::from_secs(600), "never ready");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
fn has_rows(answer: &OrderedJson) -> bool {
    matches!(answer, OrderedJson::Array(r) if !r.is_empty())
}
/// The fold one acquisition between `before` and `after` gives (a KST day change between them
/// is the only way they differ).
fn acquired(before: f64, after: f64, answer: &OrderedJson, name: &str) {
    let announcement = expected_announcement(before).unwrap();
    let candidates = [
        expected_fold(&announcement, before, before).by_station(name),
        expected_fold(&announcement, after, after).by_station(name),
    ];
    assert!(
        candidates.iter().any(|c| c == answer),
        "{name}: {}",
        String::from_utf8_lossy(&answer.to_bytes())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_missing_image_forecast_is_acquired_once_and_published_before_use() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let seoul = town(37.5665, 126.978);
    let busan = town(35.1796, 129.0756);
    let three = || Instant::now() + Duration::from_secs(3);
    // The station list and the dust forecast (whose documents name the images) are acquired
    // first, by requests that do not read the image forecast.
    let warm = until(
        || inputs.load(&seoul, "서울특별시", "중구", true, false, now_ms(), three()),
        |a| matches!(&a.dust, Some((_, Ok(_)))) && a.arpltn.is_ok(),
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
        |a| has_rows(&rows(a, "중구")),
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
            acquired(before, after, &rows(answer, &name), &name);
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
    let cold = AirInputs::new(transport.clone(), store.clone());
    let restored = until(
        || cold.load(&seoul, "서울특별시", "중구", false, true, now_ms(), three()),
        |a| has_rows(&rows(a, "중구")),
    )
    .await;
    for (name, _, _) in stations() {
        same(
            &rows(&restored, &name),
            &rows(&settled, &name),
            &format!("{name} from S3"),
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
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
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
        |a| has_rows(&rows(a, "중구")),
    )
    .await;
    acquired(before, now_ms(), &rows(&next, "중구"), "중구");
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 2, "one acquisition");
    assert_eq!(transport.available(), TEST_PERMITS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_image_off_the_builtin_origin_is_never_fetched() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let other = stub().await;
    let stub = stub().await;
    // The images are named on another loopback server (another origin than the built-in root).
    *stub.state.image_base.lock().unwrap() = Some(other.base.clone());
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let seoul = town(37.5665, 126.978);
    let three = || Instant::now() + Duration::from_secs(3);
    // The station list and the dust forecast naming the images are stored first.
    until(
        || inputs.load(&seoul, "서울특별시", "중구", true, false, now_ms(), three()),
        |a| matches!(&a.dust, Some((_, Ok(_)))) && a.arpltn.is_ok(),
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
    assert!(answer.hourly.is_some(), "the image forecast was read");
    same(
        &rows(&answer, "중구"),
        &OrderedJson::Array(Vec::new()),
        "no forecast",
    );
    assert_eq!(stub.state.dust.load(Ordering::SeqCst), 1);
    assert_eq!(other.state.gifs.load(Ordering::SeqCst), 0);
    assert_eq!(stub.state.gifs.load(Ordering::SeqCst), 0);
}

#[test]
fn the_production_image_origin_is_https_airkorea_only() {
    let endpoints = server2::gateway::runtime::Builtins::production()
        .kma_endpoints()
        .unwrap();
    let allowed = |u: &str| endpoints.image_allowed(&u.parse().unwrap());
    assert!(allowed(
        "https://www.airkorea.or.kr/dustImage/2026/10/15/AQF.20261015.NIER_09_01.PM10.1hsp.2026101511.gif"
    ));
    for u in [
        "http://www.airkorea.or.kr/dustImage/a.gif",
        "https://www.airkorea.or.kr:8443/dustImage/a.gif",
        "https://airkorea.or.kr/dustImage/a.gif",
        "https://evil.example/dustImage/a.gif",
        "http://127.0.0.1:8080/dustImage/a.gif",
    ] {
        assert!(!allowed(u), "{u}");
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

/// A process that holds a fold reads only the acquisitions completed since (latest first, up to
/// the first one it knows) and folds them after the known ones, as legacy `do` runs in
/// completion order; a new station list decodes every acquisition again. Both equal a cold
/// reader of the same S3 records.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn later_acquisitions_are_read_incrementally_and_a_new_station_list_rereads_all() {
    use server2::domestic::kma::source::air_forecast::Calibration;
    use server2::domestic::kma::source::forecast_input::ImageForecasts;
    use server2::domestic::kma::source::live::Flights;
    use std::sync::atomic::AtomicU64;
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let key = || ProviderKey::Named {
        id: "national".into(),
    };
    let kind = ("airkorea-image", "airkorea-forecast-image");
    let (a_at, b_at) = (NOW - 4. * 3_600_000., NOW + 20. * 60_000.);
    let at05 = Publication::new(20260924, 500).unwrap();
    publish(
        &store,
        kind,
        key(),
        at05.period(),
        "20260924",
        a_at,
        &images(0),
    )
    .await;
    let all = station_fold(&[]);
    let names: Vec<String> = stations().into_iter().map(|s| s.0).collect();
    let flights = Flights::new(Duration::from_secs(600));
    let generation = Arc::new(AtomicU64::new(0));
    let reader = || ImageForecasts::new(transport.clone(), store.clone(), Calibration::deployed());
    let warm = reader();
    let first = until(
        || image_load(&warm, NOW, &all, &flights, &generation),
        |f| has_rows(&f.by_station("중구")),
    )
    .await;
    let expected_a = expected_fold("2026-09-24 05시 발표", a_at, NOW);
    for n in &names {
        same(&first.by_station(n), &expected_a.by_station(n), n);
    }
    // Another host acquires the 11시 announcement (oracle set 1); this process learns of it at
    // its next refresh (here forced by a publication count change).
    let at11 = Publication::new(20260924, 1100).unwrap();
    publish(
        &store,
        kind,
        key(),
        at11.period(),
        "20260924",
        b_at,
        &images(1),
    )
    .await;
    let later = NOW + 30. * 60_000.;
    generation.fetch_add(1, Ordering::AcqRel);
    let second = until(
        || image_load(&warm, later, &all, &flights, &generation),
        |f| f.has("2026-09-24 11:00"),
    )
    .await;
    let mut expected_ab = expected_fold("2026-09-24 05시 발표", a_at, a_at);
    expected_ab.apply(&Processed {
        pub_date: "2026-09-24 11:00".into(),
        now: b_at,
        stations: &stations(),
        values: decoded(1),
    });
    expected_ab.remove_old(later);
    let fresh = reader();
    let cold = until(
        || image_load(&fresh, later, &all, &flights, &generation),
        |f| f.has("2026-09-24 11:00"),
    )
    .await;
    for n in &names {
        same(
            &second.by_station(n),
            &expected_ab.by_station(n),
            &format!("incremental {n}"),
        );
        same(
            &cold.by_station(n),
            &expected_ab.by_station(n),
            &format!("cold {n}"),
        );
    }
    // A process that decoded one station only decodes everything again for a new list.
    let partial = reader();
    let seoul_only = station_fold(&["중구"]);
    let seoul = until(
        || image_load(&partial, NOW, &seoul_only, &flights, &generation),
        |f| has_rows(&f.by_station("중구")),
    )
    .await;
    assert!(!has_rows(&seoul.by_station("대전")));
    generation.fetch_add(1, Ordering::AcqRel);
    let full = until(
        || image_load(&partial, later, &all, &flights, &generation),
        |f| has_rows(&f.by_station("대전")),
    )
    .await;
    for n in &names {
        same(
            &full.by_station(n),
            &expected_ab.by_station(n),
            &format!("new list {n}"),
        );
    }
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
/// The dust forecast documents of announcements (`YYYY-MM-DD HH시 발표`), each naming its images.
fn dust_documents(announcements: &[&str]) -> server2::domestic::kma::source::airkorea::Forecasts {
    let mut f = server2::domestic::kma::source::airkorea::Forecasts::default();
    for (i, text) in announcements.iter().enumerate() {
        let item = |code: &str| {
            let mut o = json!({"dataTime": text, "informCode": code,
                "informData": format!("2026-09-2{}", 4 + i), "informGrade": "서울 : 보통"});
            for n in 1..=9 {
                o[format!("imageUrl{n}")] = json!(format!(
                    "https://www.airkorea.or.kr/dustImage/{i}/{code}{n}.gif"
                ));
            }
            o
        };
        f.apply(text, &[item("PM10"), item("PM25")]);
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
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = store_for(&transport);
    let all = station_fold(&[]);
    // 11:20 KST: the 11시 announcement is expected.
    let now = NOW + 30. * 60_000.;
    let cases: [(&[&str], Option<u16>); 3] = [
        (
            &["2026-09-24 05시 발표", "2026-09-24 11시 발표"],
            Some(1100),
        ),
        (&["2026-09-24 05시 발표"], Some(500)),
        (&["2026-09-23 23시 발표"], None),
    ];
    for (announcements, expected) in cases {
        let recorder = Arc::new(Recorder::default());
        let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::deployed());
        let documents = dust_documents(announcements);
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
        &images(0),
    )
    .await;
    let recorder = Arc::new(Recorder::default());
    let images = ImageForecasts::new(transport.clone(), store.clone(), Calibration::deployed());
    let documents = dust_documents(&["2026-09-24 05시 발표"]);
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
