//! S15b-3b LIFE S3: the life-index, MFDS and KASI inputs read back from the S06 loopback S3 test
//! peer with empty memory equal the oracle answers; missing national datasets are acquired
//! through loopback provider stubs (single-flight, published before use) and a request that cannot
//! wait gets the legacy answer for missing data while the acquisition serves the next request.
//! TEST ONLY: no provider or AWS is reached.
use super::life::{life_runs, oracle, value};
use super::source::{at, items_of, number, same, text};
use super::source_s3::{Peer, S3_PEERS as SERIAL, deadline};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::json;
use server2::domestic::kma::source::life_input::LifeInputs;
use server2::domestic::kma::source::life_live::{LifeAcquire, LifeSettings, LiveLife};
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
const HOUR: f64 = 3_600_000.;
const DAY: f64 = 86_400_000.;

/// Publish one acquisition group as the S13 acquirers do.
#[allow(clippy::too_many_arguments)]
async fn publish(
    store: &Store,
    source: &str,
    kind: &str,
    key: ProviderKey,
    period: Period,
    partition: &str,
    fetched_at: f64,
    pages: &[Vec<u8>],
) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let record = RawRecord::new(
            source,
            kind,
            &key,
            period.clone(),
            fetched_at as u64,
            200,
            "application/json",
            (source == "data-go-kr").then_some(Pagination {
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
fn named(id: &str) -> ProviderKey {
    ProviderKey::Named { id: id.into() }
}
fn kma_page(items: serde_json::Value) -> Vec<u8> {
    let n = items.as_array().map_or(1, Vec::len);
    json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": n}}})
    .to_string()
    .into_bytes()
}
fn life_kind(kind: &str) -> &'static str {
    match kind {
        "ultrv" => "uv-idx-v5",
        "flowerWoody" => "oak-pollen-v3",
        "flowerPine" => "pine-pollen-v3",
        _ => "weeds-pollen-v3",
    }
}
fn area_key(area: &str) -> ProviderKey {
    named(&format!(
        "area-{}",
        area.bytes().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
/// Publish the oracle's life-index, KASI and MFDS acquisitions.
async fn seed_oracle(store: &Store) {
    for (kind, fetched, items) in life_runs() {
        let issued: String = items[0]["date"].as_str().unwrap().into();
        let p = Publication::parse_compact(&format!("{issued}00")).unwrap();
        publish(
            store,
            "data-go-kr",
            life_kind(&kind),
            named("all-areas"),
            p.period(),
            &p.partition(),
            fetched,
            &[kma_page(serde_json::Value::Array(items))],
        )
        .await;
    }
    // KASI: one acquisition per area and day in run order (a repeated day completes later).
    for (i, run) in items_of(at(oracle(), &["kasi", "runs"])).iter().enumerate() {
        let (area, day) = (text(at(run, &["area"])), text(at(run, &["day"])));
        let p = Publication::new(day.parse().unwrap(), 0).unwrap();
        publish(
            store,
            "data-go-kr",
            "kasi-area-rise-set",
            area_key(&area),
            p.period(),
            &day,
            1_791_000_000_000. + i as f64 * 1000.,
            &[kma_page(value(at(run, &["raw"])))],
        )
        .await;
    }
    for run in items_of(at(oracle(), &["mfds", "runs"])) {
        let now = number(at(run, &["now"]));
        let slot = server2::domestic::mfds::slot_at(now).unwrap();
        publish(
            store,
            "mfds",
            "mfds-food-poisoning",
            named("nation"),
            slot.period(),
            &slot.base_date(),
            now,
            &[at(run, &["body"]).to_bytes()],
        )
        .await;
    }
}
/// Documents ordered by location (stable).
fn by_location(docs: &OrderedJson) -> OrderedJson {
    let mut list: Vec<(String, usize, OrderedJson)> = items_of(docs)
        .iter()
        .enumerate()
        .map(|(i, d)| (text(at(d, &["location"])), i, d.clone()))
        .collect();
    list.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    OrderedJson::Array(list.into_iter().map(|(_, _, d)| d).collect())
}
/// After the last KASI run day: the capture window D-8..D+9 holds 10-08..10-25.
const KASI_NOW: f64 = 1_792_152_000_000.; // 2026-10-16T12:00:00Z

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn life_inputs_restore_oracle_answers_from_s3_with_empty_memory() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    // Life index: one cold reader per query instant (it sees the acquisitions completed by it).
    let life = at(oracle(), &["life"]);
    for q in items_of(at(life, &["queries"])) {
        let now = number(at(q, &["now"]));
        let inputs =
            LifeInputs::new(transport.clone(), store.clone()).with_kasi_schedule(HOLD, HOLD);
        let answers = inputs.load(now, deadline()).await;
        let area: f64 = text(at(q, &["areaNo"])).parse().unwrap();
        let expected = match at(q, &["error"]).string() {
            Some(_) => OrderedJson::Array(vec![]),
            None => at(q, &["result"]).clone(),
        };
        same(
            &answers.life.by_area(area),
            &expected,
            &format!("areaNo {area} at {now}"),
        );
    }
    // MFDS after the last run: rows of earlier dates expired (TTL); the reader asks from today.
    let m = at(oracle(), &["mfds"]);
    let last = items_of(at(m, &["runs"]))
        .iter()
        .map(|r| number(at(r, &["now"])))
        .fold(0., f64::max);
    let inputs = LifeInputs::new(transport.clone(), store.clone()).with_kasi_schedule(HOLD, HOLD);
    let answers = inputs.load(last + 60_000., deadline()).await;
    let today = "20261014";
    let mut compared = 0;
    for q in items_of(at(m, &["queries"])) {
        let a: Vec<String> = items_of(at(q, &["args"])).iter().map(text).collect();
        if a[2].as_str() < today {
            continue;
        }
        same(
            &answers.mfds.find(&a[0], &a[1], &a[2], &a[3]),
            at(q, &["result"]),
            &format!("find {a:?}"),
        );
        compared += 1;
    }
    assert_eq!(compared, 5);
    // KASI: the first capture pass reads every area's stored days (no acquirer: read only).
    let inputs = LifeInputs::new(transport.clone(), store.clone());
    assert!(
        inputs.load(KASI_NOW, deadline()).await.kasi.is_none(),
        "not read yet"
    );
    inputs.kasi_pass(KASI_NOW).await.unwrap();
    let kasi = inputs.load(KASI_NOW, deadline()).await.kasi.expect("read");
    let k = at(oracle(), &["kasi"]);
    // The capture reads areas in `getAreaList` order: the same documents, another natural order
    // (it decides only `$near` ties between areas at one distance).
    same(
        &by_location(&kasi.json()),
        &by_location(at(k, &["docs"])),
        "kasiRiseSet from S3",
    );
    for q in items_of(at(k, &["queries"])) {
        let dates: Vec<String> = items_of(at(q, &["dates"])).iter().map(text).collect();
        same(
            &kasi.answer(&value(at(q, &["geocode"])), &dates),
            at(q, &["result"]),
            "getRiseSetList from S3",
        );
    }
}

// ---- request-time acquisition ----

#[derive(Default)]
struct StubState {
    uv: AtomicUsize,
    oak: AtomicUsize,
    pine: AtomicUsize,
    weeds: AtomicUsize,
    kasi: AtomicUsize,
    mfds: AtomicUsize,
    uv_delay_ms: AtomicUsize,
    mfds_status: AtomicUsize,
    queries: Mutex<Vec<String>>,
}
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}
fn kst(ms: f64) -> Publication {
    server2::history::schedule::from_ms(ms as i64)
}
const AREAS: [&str; 3] = ["1100000000", "1111051500", "2611051000"];
/// The pollen issuance the provider answers for a query hour `YYYYMMDDHH`.
fn pollen_issued(time: &str) -> String {
    let hour: u32 = time[8..10].parse().unwrap();
    let date = &time[..8];
    match hour {
        0..=5 => {
            let p = Publication::new(date.parse().unwrap(), 0).unwrap();
            format!("{:08}18", p.add_hours(-24).unwrap().date())
        }
        6..=17 => format!("{date}06"),
        _ => format!("{date}18"),
    }
}
async fn handle(State(state): State<Arc<StubState>>, uri: Uri) -> impl IntoResponse {
    let query = uri.query().unwrap_or("").to_owned();
    let pairs: Vec<(String, String)> = {
        let parsed: reqwest::Url = format!("http://127.0.0.1/?{query}").parse().unwrap();
        parsed
            .query_pairs()
            .map(|(a, b)| (a.into_owned(), b.into_owned()))
            .collect()
    };
    let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    state.queries.lock().unwrap().push(uri.path().to_owned());
    let path = uri.path();
    let no_data = || {
        json!({"response": {"header": {"resultCode": "99",
            "resultMsg": "해당지수자료 제공기간이 아닙니다! [자료제공기간 3월 ~ 6월]"}}})
    };
    let body = if path.ends_with("/getUVIdxV5") {
        state.uv.fetch_add(1, Ordering::SeqCst);
        let delay = state.uv_delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        }
        let time = get("time").unwrap();
        let items: Vec<serde_json::Value> = AREAS
            .iter()
            .map(|a| {
                let mut it = json!({"code": "A07_2", "areaNo": a, "date": time});
                for n in (0..=75).step_by(3) {
                    it[format!("h{n}")] = json!(format!("{}", n % 11));
                }
                it
            })
            .collect();
        serde_json::from_slice(&kma_page(serde_json::Value::Array(items))).unwrap()
    } else if path.ends_with("/getOakPollenRiskIdxV3") {
        state.oak.fetch_add(1, Ordering::SeqCst);
        no_data()
    } else if path.ends_with("/getPinePollenRiskIdxV3") {
        state.pine.fetch_add(1, Ordering::SeqCst);
        no_data()
    } else if path.ends_with("/getWeedsPollenRiskndxV3") {
        state.weeds.fetch_add(1, Ordering::SeqCst);
        let issued = pollen_issued(&get("time").unwrap());
        let items: Vec<serde_json::Value> = AREAS
            .iter()
            .map(|a| {
                json!({"code": "D07", "areaNo": a, "date": issued, "today": "1", "tomorrow": "2",
                       "dayaftertomorrow": "0", "twodaysaftertomorrow": "3"})
            })
            .collect();
        serde_json::from_slice(&kma_page(serde_json::Value::Array(items))).unwrap()
    } else if path.ends_with("/getAreaRiseSetInfo") {
        state.kasi.fetch_add(1, Ordering::SeqCst);
        let location = get("location").unwrap();
        if location != "서울" && location != "부산" {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                [("content-type", "application/json")],
                "{}".to_owned(),
            );
        }
        let locdate: u64 = get("locdate").unwrap().parse().unwrap();
        let (lat, lon) = if location == "서울" {
            ("37.5666660", "126.9833330")
        } else {
            ("35.1000000", "129.0333330")
        };
        json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {"items": {"item": {"aste": "1949  ", "astm": "0454  ", "civile": "1848  ",
                "civilm": "0555  ", "latitude": "3734", "latitudeNum": lat, "location": location,
                "locdate": locdate, "longitude": "12659", "longitudeNum": lon,
                "moonrise": "------", "moonset": "0512  ", "moontransit": "2330  ",
                "naute": "1918  ", "nautm": "0525  ", "sunrise": "0640  ", "sunset": "1802  ",
                "suntransit": "1221  "}}, "numOfRows": 10, "pageNo": 1, "totalCount": 1}}})
    } else if path.ends_with("/api/risk.do") {
        state.mfds.fetch_add(1, Ordering::SeqCst);
        let status = state.mfds_status.load(Ordering::SeqCst);
        if status != 0 {
            return (
                axum::http::StatusCode::from_u16(status as u16).unwrap(),
                [("content-type", "application/json")],
                "{}".to_owned(),
            );
        }
        // Today's KST table published at 00:00 (always before the reception instant).
        let p = kst(now_ms());
        let base = p.base_date();
        let reg = format!("{}-{}-{}0000", &base[..4], &base[4..6], &base[6..]);
        json!({"success": true, "data": [
            {"locationId": 1, "sd": "서울특별시", "sgg": null, "todayRisk": 0.2, "tomorrowRisk": 0.6,
             "afterTomorrowRisk": 0.8, "baseDate": base, "regDatetime": reg},
            {"locationId": 2, "sd": "서울특별시", "sgg": "종로구", "todayRisk": 0.4, "tomorrowRisk": null,
             "afterTomorrowRisk": 0.1, "baseDate": base, "regDatetime": reg}]})
    } else {
        json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}})
    };
    (
        axum::http::StatusCode::OK,
        [("content-type", "application/json")],
        body.to_string(),
    )
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
    let router = Router::new()
        .fallback(any(handle))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Stub { base, state, task }
}
/// The life acquirer on the KMA source's data.go.kr acquirer (S15b-2), against the stub.
fn live(peer: &Peer, store: Arc<Store>, base: &str) -> Arc<dyn LifeAcquire> {
    let vars =
        |name: &str| -> Option<String> { (name == "SERVER2_MFDS_BASE_URL").then(|| base.into()) };
    let daily = server2::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(server2::providers::HttpProviderTransport::new(2 << 20).unwrap()),
        Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(peer.transport()),
        vec!["S15B3B_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/=".into()],
        5000,
        server2::domestic::family::Endpoints::new(base, base, base).unwrap(),
        Arc::new(server2::budget::SystemClock),
        Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
    )
    .unwrap();
    Arc::new(LiveLife::new(
        LifeSettings::from_vars(&vars).unwrap(),
        Arc::new(daily),
        store,
    ))
}
/// A request instant at or after an MFDS slot of today (or yesterday's last slot).
fn request_now() -> f64 {
    let now = now_ms();
    if server2::domestic::mfds::slot_at(now).is_some() {
        now
    } else {
        // Before 08:20 KST: yesterday 17:21 KST.
        let p = kst(now - DAY);
        server2::history::schedule::to_ms(Publication::new(p.date(), 1721).unwrap()) as f64
    }
}
/// Keeps the automatic KASI capture out of a test (it runs `kasi_pass` itself).
const HOLD: Duration = Duration::from_secs(3600);
fn short_deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn missing_national_datasets_are_acquired_once_and_published_before_use() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = Arc::new(
        LifeInputs::new(transport.clone(), store.clone())
            .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
            .with_kasi_schedule(HOLD, HOLD),
    );
    let now = request_now();
    // Two concurrent requests share every acquisition.
    let (a, b) = tokio::join!(inputs.load(now, deadline()), inputs.load(now, deadline()));
    let s = &stub.state;
    assert_eq!(s.uv.load(Ordering::SeqCst), 1, "one UV acquisition");
    assert_eq!(s.weeds.load(Ordering::SeqCst), 1, "one weeds acquisition");
    assert_eq!(s.mfds.load(Ordering::SeqCst), 1, "one MFDS acquisition");
    for answers in [&a, &b] {
        let uv = serde_json::from_slice::<serde_json::Value>(
            &answers.life.by_area(1_100_000_000.).to_bytes(),
        )
        .unwrap();
        let kinds: std::collections::BTreeSet<&str> = uv
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["indexType"].as_str().unwrap())
            .collect();
        assert!(kinds.contains("ultrv"), "UV saved: {kinds:?}");
        assert!(kinds.contains("flowerWeeds"), "weeds saved: {kinds:?}");
        assert!(!answers.mfds.is_empty(), "MFDS rows");
    }
    // Pollen day+3 is kept in server2 data.
    assert_eq!(a.life.pollen_day3(1_100_000_000.).len(), 1);
    // Out of season (`99`): oak and pine are asked once for their issuance and settled.
    assert_eq!(s.oak.load(Ordering::SeqCst), 1);
    assert_eq!(s.pine.load(Ordering::SeqCst), 1);
    // A later request is fresh: no new call; a cold reader reads the published records.
    inputs.load(now, short_deadline()).await;
    for (name, n) in [
        ("uv", &s.uv),
        ("oak", &s.oak),
        ("pine", &s.pine),
        ("weeds", &s.weeds),
        ("mfds", &s.mfds),
    ] {
        assert_eq!(n.load(Ordering::SeqCst), 1, "{name} not asked again");
    }
    // A cold reader of a later request sees the published records (they completed after `now`).
    let cold = LifeInputs::new(transport.clone(), store.clone())
        .with_kasi_schedule(HOLD, HOLD)
        .load(now_ms(), deadline())
        .await;
    same(
        &cold.life.by_area(1_100_000_000.),
        &a.life.by_area(1_100_000_000.),
        "published before use",
    );
    assert_eq!(transport.available(), super::source_s3::TEST_PERMITS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_acquisition_releases_the_request_and_serves_the_next_one() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.uv_delay_ms.store(4_000, Ordering::SeqCst);
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    let now = request_now();
    let started = std::time::Instant::now();
    let first = inputs.load(now, short_deadline()).await;
    assert!(
        started.elapsed() < Duration::from_millis(3_000),
        "{:?}",
        started.elapsed()
    );
    let uv_rows = |a: &server2::domestic::kma::source::life_input::LifeAnswers| {
        serde_json::from_slice::<serde_json::Value>(&a.life.by_area(1_100_000_000.).to_bytes())
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["indexType"] == "ultrv")
            .count()
    };
    assert_eq!(uv_rows(&first), 0, "the legacy answer for missing data");
    tokio::time::sleep(Duration::from_millis(3_000)).await;
    let next = inputs.load(now, short_deadline()).await;
    assert!(
        uv_rows(&next) > 0,
        "the owned acquisition finished and serves the next request"
    );
    assert_eq!(stub.state.uv.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_mfds_slot_is_asked_once_even_when_it_fails() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.mfds_status.store(503, Ordering::SeqCst);
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    let now = request_now();
    let first = inputs.load(now, short_deadline()).await;
    assert!(first.mfds.is_empty());
    inputs.load(now, short_deadline()).await;
    assert_eq!(stub.state.mfds.load(Ordering::SeqCst), 1, "legacy lastSlot");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_kasi_capture_acquires_missing_days_and_a_failing_area_does_not_stop_others() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    let now = now_ms();
    inputs.kasi_pass(now).await.unwrap();
    // 서울 and 부산 succeed for all 18 days; every other area fails once (two attempts) and is
    // not asked again in this pass (legacy `mapSeries` stops an area at its first error).
    let calls = stub.state.kasi.load(Ordering::SeqCst);
    assert_eq!(calls, 2 * 18 + 100 * 2, "{calls}");
    let kasi = inputs.load(now, deadline()).await.kasi.expect("loaded");
    assert_eq!(kasi.len(), 36);
    let today = server2::world::js::iso(now).unwrap()[..10].replace('-', "");
    let answer = serde_json::from_slice::<serde_json::Value>(
        &kasi
            .answer(
                &json!({"lat": 37.57, "lon": 126.98}),
                std::slice::from_ref(&today),
            )
            .to_bytes(),
    )
    .unwrap();
    assert_eq!(answer[0]["locationName"], "서울");
    assert_eq!(answer[0]["date"], today.as_str());
    // A second pass asks only what is still missing (the failing areas).
    inputs.kasi_pass(now).await.unwrap();
    assert_eq!(stub.state.kasi.load(Ordering::SeqCst), calls + 100 * 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_snapshot_answers_the_life_store_calls() {
    let _serial = SERIAL.lock().await;
    use super::source_s3::{NOW, request, seed};
    use server2::domestic::kma::backend::{KmaSource, SourceAnswer};
    use server2::domestic::kma::source::S3Source;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed(&store, &[]).await;
    // A UV issuance and an MFDS table before NOW (2026-09-24 10:50 KST).
    let issued = "2026092409";
    let mut item = json!({"code": "A07_2", "areaNo": "1111051500", "date": issued});
    for n in (0..=75).step_by(3) {
        item[format!("h{n}")] = json!("5");
    }
    let p = Publication::parse_compact(&format!("{issued}00")).unwrap();
    publish(
        &store,
        "data-go-kr",
        "uv-idx-v5",
        named("all-areas"),
        p.period(),
        &p.partition(),
        NOW - HOUR,
        &[kma_page(json!([item]))],
    )
    .await;
    let body = json!({"success": true, "data": [{"locationId": 1, "sd": "서울특별시", "sgg": "종로구",
        "todayRisk": 0.5, "tomorrowRisk": 0.7, "afterTomorrowRisk": 0.9, "baseDate": "20260924",
        "regDatetime": "2026-09-240700"}]});
    let slot = Publication::new(20260924, 820).unwrap();
    publish(
        &store,
        "mfds",
        "mfds-food-poisoning",
        named("nation"),
        slot.period(),
        "20260924",
        NOW - 2. * HOUR,
        &[body.to_string().into_bytes()],
    )
    .await;
    let s3 = S3Source::new(
        transport.clone(),
        Arc::new(|| NOW),
        Arc::new(super::source_s3::Unreachable),
        Arc::new(super::source_s3::Unreachable),
    )
    .unwrap();
    let snapshot = match s3.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(r) => panic!("forwarded: {r}"),
    };
    let area = snapshot
        .area_no("서울특별시", "종로구", "청운효자동")
        .unwrap();
    let area = serde_json::from_slice::<serde_json::Value>(&area.to_bytes()).unwrap();
    assert_eq!(area[0]["areaNo"], 1111051500.);
    let near = snapshot.area_no_near(&json!([126.97, 37.58])).unwrap();
    assert_eq!(items_of(&near).len(), 3);
    assert!(snapshot.area_no_near(&json!(["x", 37.58])).is_err());
    let life = snapshot.life_index(1_111_051_500.).unwrap();
    assert!(!items_of(&life).is_empty());
    let fsn = snapshot
        .food_poisoning("서울특별시", "종로구", "20260924", "20260926")
        .unwrap();
    assert_eq!(items_of(&fsn).len(), 3);
    // KASI is not read yet in a fresh process: `[]` (legacy computes rise/set).
    let rs = snapshot
        .rise_set(&json!({"lat": 37.5, "lon": 127.0}), &["20260924".into()])
        .unwrap();
    assert!(items_of(&rs).is_empty());
}

#[test]
fn life_settings_fail_closed() {
    let root =
        |v: &'static str| move |name: &str| (name == "SERVER2_MFDS_BASE_URL").then(|| v.to_owned());
    let default = LifeSettings::from_vars(&|_: &str| None).unwrap();
    assert_eq!(default.mfds_root.as_str(), "https://poisonmap.mfds.go.kr/");
    for bad in [
        "http://poisonmap.example.test/",
        "https://poisonmap.example.test/api",
        "https://poisonmap.example.test/?q=1",
        "not a url",
    ] {
        assert!(LifeSettings::from_vars(&root(bad)).is_err(), "{bad}");
    }
    assert!(LifeSettings::from_vars(&root("http://127.0.0.1:9/")).is_ok());
}
