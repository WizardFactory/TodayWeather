//! S15b-3b LIFE S3: the life-index, MFDS and KASI inputs read back from the S06 loopback S3 test
//! peer with empty memory equal the oracle answers; missing national datasets are acquired
//! through loopback provider stubs (single-flight, published before use) and a request that cannot
//! wait gets the legacy answer for missing data while the acquisition serves the next request.
//! TEST ONLY: no provider or AWS is reached.
use super::life::{life_runs, oracle, value};
use super::source::{at, items_of, number, same, text};
use super::source_s3::{Peer, deadline};
use super::support::{FIXED_NOW, MIDDAY, TestClock, TestInstant, fixed_now};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::json;
use server2::domestic::kma::source::life_input::LifeInputs;
use server2::domestic::kma::source::life_live::{LifeAcquire, LifeRequest, LifeSettings, LiveLife};
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
async fn publish<T: server2::storage::CatalogTransport>(
    store: &CatalogStore<T>,
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
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    // Life index: one cold reader per query instant (it sees the acquisitions completed by it).
    let life = at(oracle(), &["life"]);
    for q in items_of(at(life, &["queries"])) {
        let now = number(at(q, &["now"]));
        let inputs = LifeInputs::new(transport.clone(), store.clone())
            .with_clock(test_clock())
            .with_kasi_schedule(HOLD, HOLD);
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
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
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
    // KASI: the first request reads every area's stored days without a provider or warmup.
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_wait(Duration::from_secs(20));

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

/// Stored KASI is available on the first request without a capture pass or provider.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_request_restores_stored_kasi_without_acquirer_or_warmup() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let run = &items_of(at(oracle(), &["kasi", "runs"]))[0];
    let area = text(at(run, &["area"]));
    let day = text(at(run, &["day"]));
    let publication = Publication::new(day.parse().unwrap(), 0).unwrap();
    publish(
        &store,
        "data-go-kr",
        "kasi-area-rise-set",
        area_key(&area),
        publication.period(),
        &day,
        1_791_000_000_000.,
        &[kma_page(value(at(run, &["raw"])))],
    )
    .await;
    let inputs = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_wait(Duration::from_secs(20));
    // An exhausted request budget returns without waiting for the owned S3 work.
    let started = Instant::now();
    let late = inputs.load(KASI_NOW, started).await;
    assert!(started.elapsed() < Duration::from_millis(250));
    assert!(late.kasi.is_none());
    // The next request joins the same restore; no capture/warmup call is required.
    let answers = inputs
        .load(KASI_NOW, Instant::now() + Duration::from_secs(3))
        .await;
    let restored = answers
        .kasi
        .expect("first request must read canonical KASI from S3");
    assert!(
        !items_of(&restored.json()).is_empty(),
        "the S3 day must be restored"
    );
}

/// S3 GETs and LISTs of keys containing `needle` the peer has served.
async fn served(peer: &Peer, needle: &str) -> u64 {
    let bytes = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!(
            "{}/__catalog/status",
            peer.endpoint().trim_end_matches('/')
        ))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let status: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    status
        .as_object()
        .unwrap()
        .iter()
        .filter(|(k, _)| k.starts_with("OP ") && k.contains(needle))
        .map(|(_, n)| n.as_u64().unwrap())
        .sum()
}

/// A restore longer than the request's short wait continues on its own: the request answers
/// without KASI and a later one has it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_long_kasi_restore_does_not_hold_the_request() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let run = &items_of(at(oracle(), &["kasi", "runs"]))[0];
    for area in server2::domestic::riseset::AREAS.iter().take(10) {
        for day in [20261014, 20261015, 20261016, 20261017] {
            publish(
                &store,
                "data-go-kr",
                "kasi-area-rise-set",
                area_key(area),
                Publication::new(day, 0).unwrap().period(),
                &day.to_string(),
                1_791_000_000_000.,
                &[kma_page(value(at(run, &["raw"])))],
            )
            .await;
        }
    }
    let slow = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(format!(
            "{}/__catalog?mode=slow-all&key=x",
            peer.endpoint().trim_end_matches('/')
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(slow.status(), 204);
    let inputs = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_wait(Duration::from_millis(100));
    let started = Instant::now();
    let answers = inputs
        .load(KASI_NOW, Instant::now() + Duration::from_secs(3))
        .await;
    assert!(answers.kasi.is_none(), "the restore needs longer");
    assert!(started.elapsed() < Duration::from_secs(1));
    let until = Instant::now() + Duration::from_secs(30);
    loop {
        let answers = inputs
            .load(KASI_NOW, Instant::now() + Duration::from_secs(3))
            .await;
        if answers.kasi.is_some() {
            break;
        }
        assert!(Instant::now() < until, "the owned restore never finished");
    }
}

/// A capture pass stores what it folded as one object, and a new process restores from that
/// object instead of reading every area and day.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_process_restores_kasi_from_the_stored_fold() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let first = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    first.kasi_pass(KASI_NOW).await.unwrap();
    let expected = first.load(KASI_NOW, deadline()).await.kasi.expect("read");
    let (reads, lists) = (
        served(&peer, "GET index/v2/data-go-kr/kasi-area-rise-set").await,
        served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await,
    );
    let second = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    let fold_lists = served(&peer, "LIST index/v2/data-go-kr/kasi-fold").await;
    let restored = second.load(KASI_NOW, deadline()).await.kasi.expect("fold");
    same(
        &by_location(&restored.json()),
        &by_location(&expected.json()),
        "kasiRiseSet from the stored fold",
    );
    assert_eq!(
        served(&peer, "LIST index/v2/data-go-kr/kasi-fold").await,
        fold_lists + 1,
        "one existence question"
    );
    assert_eq!(
        served(&peer, "GET index/v2/data-go-kr/kasi-area-rise-set").await,
        reads,
        "no area or day is read"
    );
    assert_eq!(
        served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await,
        lists,
        "a fresh fold stands for the listing"
    );
}

/// Days stored after an older fold are read from the listing on top of it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_older_kasi_fold_is_completed_from_the_listing() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let first = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    first.kasi_pass(KASI_NOW).await.unwrap();
    let run = &items_of(at(oracle(), &["kasi", "runs"]))[0];
    let area = text(at(run, &["area"]));
    let later = KASI_NOW + 3. * DAY;
    let day = 20261019;
    let mut raw = value(at(run, &["raw"]));
    raw["locdate"] = json!(day);
    publish(
        &store,
        "data-go-kr",
        "kasi-area-rise-set",
        area_key(&area),
        Publication::new(day, 0).unwrap().period(),
        &day.to_string(),
        later - 1000.,
        &[kma_page(raw)],
    )
    .await;
    let second = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    let restored = second.load(later, deadline()).await.kasi.expect("read");
    assert!(
        restored.has(&area, &day.to_string()),
        "{}",
        restored.json().to_bytes().len()
    );
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
    /// The UV `time` answered `03` (no data).
    uv_no_data: Mutex<Option<String>>,
    mfds_status: AtomicUsize,
    mfds_delay_ms: AtomicUsize,
    /// 1: a same-origin 302 to a valid table; 2: a valid table above 1 MiB.
    mfds_shape: AtomicUsize,
    queries: Mutex<Vec<String>>,
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
        if state.uv_no_data.lock().unwrap().as_deref() == Some(time.as_str()) {
            return (
                axum::http::StatusCode::OK,
                [("content-type", "application/json")],
                json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}})
                    .to_string(),
            );
        }
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
        let delay = state.mfds_delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        }
        if uri.query() == Some("redirected=1") {
            state.mfds.fetch_add(1, Ordering::SeqCst);
        } else {
            state.mfds.fetch_add(1, Ordering::SeqCst);
            if state.mfds_shape.load(Ordering::SeqCst) == 1 {
                return (
                    axum::http::StatusCode::FOUND,
                    [("location", "/api/risk.do?redirected=1")],
                    String::new(),
                );
            }
        }
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
        let mut table = json!({"success": true, "data": [
            {"locationId": 1, "sd": "서울특별시", "sgg": null, "todayRisk": 0.2, "tomorrowRisk": 0.6,
             "afterTomorrowRisk": 0.8, "baseDate": base, "regDatetime": reg},
            {"locationId": 2, "sd": "서울특별시", "sgg": "종로구", "todayRisk": 0.4, "tomorrowRisk": null,
             "afterTomorrowRisk": 0.1, "baseDate": base, "regDatetime": reg}]});
        if state.mfds_shape.load(Ordering::SeqCst) == 2 {
            table["padding"] = json!("x".repeat(1_200_000));
        }
        table
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
    let daily = server2::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(server2::providers::HttpProviderTransport::new(2 << 20).unwrap()),
        Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(peer.transport_limited(super::source_s3::ACQUIRER_PERMITS)),
        vec!["S15B3B_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/=".into()],
        server2::domestic::quota::DataGoKrApi::daily_units,
        server2::domestic::family::Endpoints::new(base, base, base).unwrap(),
        test_clock(),
        Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
    )
    .unwrap();
    let mfds =
        server2::domestic::kma::source::life_live::mfds_acquirer::<_, BoundedS3<HttpS3Transport>>(
            Arc::new(server2::providers::HttpProviderTransport::new(1 << 20).unwrap()),
            test_clock(),
        )
        .unwrap();
    Arc::new(LiveLife::new(
        LifeSettings::with_mfds_root(base).unwrap(),
        Arc::new(daily),
        Arc::new(mfds),
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
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = Arc::new(
        LifeInputs::new(transport.clone(), store.clone())
            .with_clock(test_clock())
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
        .with_clock(test_clock())
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

/// At 00:00:30 KST (no MFDS slot yet) and at 12:30 KST (the 12:20 slot).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_acquisition_releases_the_request_and_serves_the_next_one() {
    for (at, slot) in [(FIXED_NOW, None), (MIDDAY, Some((20261016, 1220)))] {
        slow_acquisition_at(at, slot).await;
    }
}
/// The life sweep's starts (KST) with the MFDS slot (`YYYYMMDD`, `HHMM`) legacy collects by
/// then: the latest of 08:20, 12:20 and 17:20 KST of that day, none before 08:20. The test's two
/// requests are about 10 s apart and a new UV slot or MFDS slot between them is legitimately
/// asked again, so the starts before a boundary are two minutes before it (the image sweep
/// crosses the boundaries during the run).
const LIFE_BOUNDARIES: [(&str, Option<(u32, u16)>); 9] = [
    ("2026-10-15T14:58:00.000Z", Some((20261015, 1720))), // 10-15 23:58
    ("2026-10-15T15:00:00.500Z", None),                   // 10-16 00:00:00.5
    ("2026-10-15T19:58:00.000Z", None),                   // 04:58
    ("2026-10-15T20:00:00.500Z", None),                   // 05:00:00.5
    ("2026-10-15T23:18:00.000Z", None),                   // 08:18
    ("2026-10-15T23:20:00.500Z", Some((20261016, 820))),  // 08:20:00.5
    ("2026-10-16T03:00:00.000Z", Some((20261016, 820))),  // 12:00
    ("2026-10-16T08:21:00.000Z", Some((20261016, 1720))), // 17:21
    ("2026-10-16T14:00:30.000Z", Some((20261016, 1720))), // 23:00:30
];
/// S15b-3d: [`a_slow_acquisition_releases_the_request_and_serves_the_next_one`] at fixed
/// instants around the KST boundaries (slow: `--ignored across_kst_boundaries`).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "slow sweep; run with --ignored"]
async fn life_acquisition_across_kst_boundaries() {
    for (at, slot) in LIFE_BOUNDARIES {
        slow_acquisition_at(at, slot).await;
    }
}
/// `slot`: the MFDS slot expected at `at` (an explicit oracle, not `slot_at`).
async fn slow_acquisition_at(at: &str, slot: Option<(u32, u16)>) {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, at).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.uv_delay_ms.store(4_000, Ordering::SeqCst);
    stub.state.mfds_delay_ms.store(4_000, Ordering::SeqCst);
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    // MFDS is collected only from the day's first slot (08:20).
    let now = now_ms();
    assert_eq!(
        server2::domestic::mfds::slot_at(now).map(|p| (p.date(), p.time())),
        slot,
        "{at}"
    );
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
    assert!(first.mfds.is_empty());
    // The next request comes after the acquisitions ended and after their outcome stopped
    // answering joiners (3 s): their publication still invalidates the folds' memo.
    tokio::time::sleep(Duration::from_millis(9_000)).await;
    let next = inputs.load(now_ms(), short_deadline()).await;
    assert!(
        uv_rows(&next) > 0,
        "{at}: the owned acquisition finished and serves the next request"
    );
    assert_eq!(
        !next.mfds.is_empty(),
        slot.is_some(),
        "{at}: the delayed MFDS table serves it too (from the first slot on)"
    );
    assert_eq!(stub.state.uv.load(Ordering::SeqCst), 1, "{at}");
    assert_eq!(
        stub.state.mfds.load(Ordering::SeqCst),
        usize::from(slot.is_some()),
        "{at}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_mfds_slot_is_asked_once_even_when_it_fails() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.mfds_status.store(503, Ordering::SeqCst);
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
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
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
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
    // The capture stored today's column first; a multi-date answer is in day order as legacy's
    // natural order (each gather appends its new last day).
    let window: Vec<String> = (-8..10)
        .map(|i| server2::world::js::iso(now + f64::from(i) * DAY).unwrap()[..10].replace('-', ""))
        .collect();
    let answer = serde_json::from_slice::<serde_json::Value>(
        &kasi
            .answer(&json!({"lat": 37.57, "lon": 126.98}), &window)
            .to_bytes(),
    )
    .unwrap();
    let dates: Vec<&str> = answer
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["date"].as_str().unwrap())
        .collect();
    assert_eq!(dates, window.iter().map(String::as_str).collect::<Vec<_>>());
    // A second pass asks only what is still missing (the failing areas).
    inputs.kasi_pass(now).await.unwrap();
    assert_eq!(stub.state.kasi.load(Ordering::SeqCst), calls + 100 * 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_snapshot_answers_the_life_store_calls() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    use super::source_s3::{NOW, request, seed};
    use server2::domestic::kma::backend::{KmaSource, SourceAnswer};
    use server2::domestic::kma::source::S3Source;
    let peer = Peer::persistent();
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
        SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("forwarded: {r}"),
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
fn life_settings_use_the_legacy_mfds_endpoint() {
    assert_eq!(
        LifeSettings::default().mfds_root.as_str(),
        "https://poisonmap.mfds.go.kr/"
    );
    for bad in [
        "http://poisonmap.example.test/",
        "https://poisonmap.example.test/api",
        "https://poisonmap.example.test/?q=1",
        "not a url",
    ] {
        assert!(LifeSettings::with_mfds_root(bad).is_err(), "{bad}");
    }
    assert!(LifeSettings::with_mfds_root("http://127.0.0.1:9/").is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn uv_tries_earlier_slots_while_a_slot_has_no_data() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let now = request_now();
    let slots = server2::domestic::publication::uv_slots(now as i64).unwrap();
    *stub.state.uv_no_data.lock().unwrap() = Some(slots[0].compact()[..10].to_owned());
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    let answers = inputs.load(now, deadline()).await;
    // Legacy `taskUltrvV5`: the current slot has no data, the previous candidate is saved.
    assert_eq!(stub.state.uv.load(Ordering::SeqCst), 2);
    assert_eq!(
        answers.life.last_issued("ultrv"),
        Some(&slots[1].compact()[..10])
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mfds_accepts_only_a_direct_answer_within_one_mebibyte() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    for shape in [1, 2] {
        let peer = Peer::persistent();
        let transport = peer.transport();
        let store =
            Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
        let stub = stub().await;
        stub.state.mfds_shape.store(shape, Ordering::SeqCst);
        let inputs = LifeInputs::new(transport.clone(), store.clone())
            .with_clock(test_clock())
            .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
            .with_kasi_schedule(HOLD, HOLD);
        let answers = inputs.load(request_now(), deadline()).await;
        // Legacy `fetchRisk`: a redirect is a non-200 answer; a body above 1 MiB is refused.
        assert!(answers.mfds.is_empty(), "shape {shape}");
        assert_eq!(
            stub.state.mfds.load(Ordering::SeqCst),
            1,
            "shape {shape}: no redirect followed"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_old_nearest_location_still_decides_rise_set_after_a_cold_read() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let now = now_ms();
    let day =
        |offset: f64| server2::world::js::iso(now + offset * DAY).unwrap()[..10].replace('-', "");
    let item = |location: &str, locdate: &str, lat: &str, lon: &str| {
        json!({"aste": "1949  ", "astm": "0454  ", "civile": "1848  ", "civilm": "0555  ",
            "latitude": "3734", "latitudeNum": lat, "location": location,
            "locdate": locdate.parse::<u64>().unwrap(), "longitude": "12659", "longitudeNum": lon,
            "moonrise": "0611  ", "moonset": "0512  ", "moontransit": "2330  ", "naute": "1918  ",
            "nautm": "0525  ", "sunrise": "0640  ", "sunset": "1802  ", "suntransit": "1221  "})
    };
    // 서울 has only a day long before the capture window; 수원 (farther) has today.
    for (area, d, lat, lon, at) in [
        (
            "서울",
            day(-40.),
            "37.5666660",
            "126.9833330",
            now - 40. * DAY,
        ),
        ("수원", day(0.), "37.2666660", "127.0166660", now - 60_000.),
    ] {
        let p = Publication::new(d.parse().unwrap(), 0).unwrap();
        publish(
            &store,
            "data-go-kr",
            "kasi-area-rise-set",
            area_key(area),
            p.period(),
            &d,
            at,
            &[kma_page(item(area, &d, lat, lon))],
        )
        .await;
    }
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
    inputs.kasi_pass(now).await.unwrap();
    let kasi = inputs.load(now, deadline()).await.kasi.expect("read");
    assert_eq!(kasi.places(), 2, "the old location is known");
    // Legacy picks the nearest stored document (서울, only an old day) and answers [] for today.
    let answer = kasi.answer(&json!({"lat": 37.57, "lon": 126.98}), &[day(0.)]);
    same(
        &answer,
        &OrderedJson::Array(vec![]),
        "nearest location without the day",
    );
    let suwon = kasi.answer(&json!({"lat": 37.27, "lon": 127.02}), &[day(0.)]);
    assert_eq!(items_of(&suwon).len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_publication_after_a_request_instant_is_read_by_a_later_request() {
    // Its requests span a minute: a start away from the three-hour UV slot boundaries.
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.uv_delay_ms.store(4_000, Ordering::SeqCst);
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    let uv_rows = |a: &server2::domestic::kma::source::life_input::LifeAnswers| {
        serde_json::from_slice::<serde_json::Value>(&a.life.by_area(1_100_000_000.).to_bytes())
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["indexType"] == "ultrv")
            .count()
    };
    // The first request starts the UV acquisition, which publishes about 4 s later.
    let earlier = now_ms() - 60_000.;
    assert_eq!(uv_rows(&inputs.load(earlier, short_deadline()).await), 0);
    tokio::time::sleep(Duration::from_millis(9_000)).await;
    // A request whose instant precedes that publication reads after it: the records are
    // beyond its cut, so they are not in its answer, and the fold must not count them as read.
    assert_eq!(uv_rows(&inputs.load(earlier, short_deadline()).await), 0);
    // A later request (after the flight outcome expired, within the read memo) sees them.
    let later = inputs.load(now_ms(), short_deadline()).await;
    assert!(uv_rows(&later) > 0, "the completed publication is visible");
    assert_eq!(stub.state.uv.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_mfds_connection_may_take_the_legacy_ten_seconds() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    // A TLS peer that stays silent for 4.5 s after the ClientHello: legacy `fetchRisk` keeps
    // waiting (one absolute 10 s deadline); the default keyless transport gives up at 3 s.
    let (base, waits) = super::air_s3::silent_tls(Duration::from_millis(4_500)).await;
    let acquire = live(&peer, store, &base);
    let slot = server2::domestic::mfds::slot_at(request_now()).unwrap();
    let started = std::time::Instant::now();
    let result = acquire.acquire(LifeRequest::Mfds(slot)).await;
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(10));
    let first = waits
        .lock()
        .unwrap()
        .first()
        .copied()
        .expect("one connection");
    assert!(
        first.is_none(),
        "the MFDS transport still waited when the peer closed at 4.5 s: {first:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_mfds_slot_is_known_by_its_period_not_by_its_reception_time() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    // A KST date whose 12:30 is past: today, or yesterday before 12:30 KST.
    let wall = now_ms();
    let today = kst(wall);
    let date = if today.time() >= 1230 {
        today.date()
    } else {
        kst(wall - DAY).date()
    };
    let at =
        |time: u16| server2::history::schedule::to_ms(Publication::new(date, time).unwrap()) as f64;
    // The 08:20 slot's acquisition was received at 12:20:04 (after the 12:20 slot began).
    let base = format!("{date:08}");
    let reg = format!("{}-{}-{}0700", &base[..4], &base[4..6], &base[6..]);
    let body = json!({"success": true, "data": [{"locationId": 1, "sd": "서울특별시", "sgg": "종로구",
        "todayRisk": 0.5, "tomorrowRisk": 0.7, "afterTomorrowRisk": 0.9, "baseDate": base,
        "regDatetime": reg}]});
    let slot = Publication::new(date, 820).unwrap();
    publish(
        &store,
        "mfds",
        "mfds-food-poisoning",
        named("nation"),
        slot.period(),
        &base,
        at(1220) + 4_000.,
        &[body.to_string().into_bytes()],
    )
    .await;
    // A cold process at 12:30: the 12:20 slot was never collected, so it is acquired.
    let inputs = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD);
    inputs.load(at(1230), deadline()).await;
    assert_eq!(
        stub.state.mfds.load(Ordering::SeqCst),
        1,
        "the 12:20 slot is acquired"
    );
}

/// Real S3 reads finish out of area order; a failing area prevents a complete snapshot.
#[derive(Clone)]
struct OrderedKasi {
    inner: BoundedS3<HttpS3Transport>,
    failed_area: Arc<std::sync::atomic::AtomicBool>,
    done: Arc<Mutex<Vec<String>>>,
}
impl server2::storage::ObjectTransport for OrderedKasi {
    async fn put(
        &self,
        record: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put(record).await
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        self.inner.head(key).await
    }
    async fn get(
        &self,
        key: &str,
        max: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        if key.starts_with("raw/v2/data-go-kr/kasi-area-rise-set/") {
            let slow = server2::storage::sha256(&area_key("강릉").canonical_bytes().unwrap());
            let bad = server2::storage::sha256(&area_key("강화도").canonical_bytes().unwrap());
            if key.contains(&slow) {
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
            self.done.lock().unwrap().push(key.to_owned());
            if key.contains(&bad) && self.failed_area.load(Ordering::SeqCst) {
                return Err(server2::storage::Error::Transport);
            }
        }
        self.inner.get(key, max).await
    }
}
impl server2::storage::CatalogTransport for OrderedKasi {
    async fn get_control(
        &self,
        key: &str,
        max: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        self.inner.get_control(key, max).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &server2::storage::WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        keys: usize,
        bytes: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner
            .list_raw_document(prefix, token, keys, bytes)
            .await
    }
}
impl server2::history::IndexListing for OrderedKasi {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<server2::storage::ListPage, server2::storage::Error> {
        self.inner.list_index(prefix, token).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn kasi_restore_reads_areas_in_order_and_recovers_after_a_partial_read_error() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let run = &items_of(at(oracle(), &["kasi", "runs"]))[0];
    let day = text(at(run, &["day"]));
    let publication = Publication::new(day.parse().unwrap(), 0).unwrap();
    for area in ["강릉", "강화도", "거제"] {
        let mut raw = value(at(run, &["raw"]));
        raw["location"] = json!(area);
        // Equal coordinates make insertion order observable through the nearest-place query.
        raw["latitudeNum"] = json!("37.5");
        raw["longitudeNum"] = json!("127.0");
        publish(
            &store,
            "data-go-kr",
            "kasi-area-rise-set",
            area_key(area),
            publication.period(),
            &day,
            1_791_000_000_000.,
            &[kma_page(raw)],
        )
        .await;
    }
    let failed_area = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let done = Arc::new(Mutex::new(Vec::new()));
    let wrapped = OrderedKasi {
        inner: transport,
        failed_area: failed_area.clone(),
        done: done.clone(),
    };
    let store = Arc::new(CatalogStore::new(wrapped.clone(), CatalogLimits::default()).unwrap());
    let inputs = LifeInputs::new(wrapped, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
    assert!(inputs.kasi_pass(KASI_NOW).await.is_err());
    let completed = done.lock().unwrap().clone();
    assert_eq!(
        completed.len(),
        2,
        "the failed area ends the read: {completed:?}"
    );
    let first = server2::storage::sha256(&area_key("강릉").canonical_bytes().unwrap());
    let second = server2::storage::sha256(&area_key("강화도").canonical_bytes().unwrap());
    let position = |part: &str| completed.iter().position(|k| k.contains(part)).unwrap();
    assert!(
        position(&first) < position(&second),
        "one area at a time, leaving the S3 gate to requests, even when the first is slow"
    );
    failed_area.store(false, Ordering::SeqCst);
    inputs.kasi_pass(KASI_NOW).await.unwrap();
    let restored = inputs
        .load(KASI_NOW, deadline())
        .await
        .kasi
        .expect("complete after recovery");
    assert_eq!(restored.places(), 3);
    let answer = restored.answer(&json!({"lat":37.5,"lon":127.0}), &[day]);
    assert_eq!(
        text(at(&items_of(&answer)[0], &["locationName"])),
        "강릉",
        "first AREAS entry wins equal-distance tie"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_unreadable_kasi_fold_falls_back_to_the_originals() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let first = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
    first.kasi_pass(KASI_NOW).await.unwrap();
    let expected = first
        .load(KASI_NOW, deadline())
        .await
        .kasi
        .expect("originals");
    assert!(!expected.is_empty());
    let id = CatalogId {
        source: "data-go-kr".into(),
        kind: "kasi-fold".into(),
        key_sha256: server2::storage::sha256(&named("all-areas").canonical_bytes().unwrap()),
        partition: "20261016".into(),
    };
    let mut url: reqwest::Url = format!("{}/__catalog", peer.endpoint().trim_end_matches('/'))
        .parse()
        .unwrap();
    url.query_pairs_mut()
        .append_pair("mode", "corrupt")
        .append_pair("key", &id.key());
    let fault = reqwest::Client::new()
        .post(url)
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(fault.status(), 204);
    let second = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    second.kasi_pass(KASI_NOW).await.unwrap();
    let restored = second
        .load(KASI_NOW, deadline())
        .await
        .kasi
        .expect("originals");
    same(
        &by_location(&restored.json()),
        &by_location(&expected.json()),
        "fold fallback",
    );
}

/// The fold's age decides, not its date: this one is a day and an hour old on the next UTC date.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_kasi_fold_older_than_a_day_is_completed_on_the_next_date() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let first = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
    first.kasi_pass(KASI_NOW).await.unwrap();
    let lists = served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await;
    let second = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    second.load(KASI_NOW + 25. * HOUR, deadline()).await;
    assert!(served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await > lists);
}

/// A request that waited behind a capture pass finds the fold loaded and lists nothing itself.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_request_behind_a_capture_pass_does_not_list_the_kasi_kind() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let first = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD);
    first.kasi_pass(KASI_NOW).await.unwrap();
    let lists = served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await;
    let second = LifeInputs::new(transport, store)
        .with_clock(test_clock())
        .with_kasi_schedule(HOLD, HOLD)
        .with_kasi_wait(Duration::from_secs(20));
    let (pass, answers) = tokio::join!(
        second.kasi_pass(KASI_NOW),
        second.load(KASI_NOW, deadline())
    );
    pass.unwrap();
    assert!(answers.kasi.is_some());
    assert_eq!(
        served(&peer, "LIST index/v2/data-go-kr/kasi-area-rise-set").await,
        lists
    );
}

// ---- KMA-RESTART-RACE: the stored reads' head start (AK 2026-11-07, plan A) ----

use super::observe::Counted;
use server2::domestic::kma::source::life_input::LifeAnswers;
use server2::resolver::race::HEAD_START;

/// S3 requests in flight for a restarted process's inputs. The process before it keeps its
/// pooled connections until the peer closes them 2 s after they opened (the test's store and,
/// with an acquirer, its KASI capture task keep it alive), so a restarted process with the usual
/// 8 could fill the peer's 16 connections: the quota reservation of its raced acquisition was
/// then refused at the head start (`connection_reset`) and the first answer lacked what it
/// would have acquired.
const RESTARTED_PERMITS: usize = 4;
/// A restarted process's counted transport, admitting [`RESTARTED_PERMITS`] requests at once.
fn restarted_transport(peer: &Peer) -> Counted {
    Counted::new(peer.transport_limited(RESTARTED_PERMITS))
}
/// The life inputs of a process reading through `counted`, acquiring through the stub.
fn restarted(
    peer: &Peer,
    counted: &Counted,
    store: &Arc<Store>,
    stub: Option<&Stub>,
) -> LifeInputs<Counted> {
    let inputs = LifeInputs::new(
        counted.clone(),
        Arc::new(CatalogStore::new(counted.clone(), CatalogLimits::default()).unwrap()),
    )
    .with_clock(test_clock())
    .with_kasi_schedule(HOLD, HOLD);
    match stub {
        Some(stub) => inputs.with_acquire(Some(live(peer, store.clone(), &stub.base))),
        None => inputs,
    }
}
/// The request of a restarted process: the head start ends 0.7 s, the wait 2.5 s after it starts
/// (a longer `budget` moves both later by as much).
async fn first_request(inputs: &LifeInputs<Counted>, budget: Duration) -> (LifeAnswers, Duration) {
    let started = Instant::now();
    let extra = budget.saturating_sub(Duration::from_millis(2700));
    let answers = inputs
        .load_by(now_ms(), started + HEAD_START + extra, started + budget)
        .await;
    (answers, started.elapsed())
}
/// The issuances of an area's UV rows (`lastUpdateDate`).
fn uv_issued(answers: &LifeAnswers, area: f64) -> Vec<String> {
    serde_json::from_slice::<serde_json::Value>(&answers.life.by_area(area).to_bytes())
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d["indexType"] == "ultrv")
        .map(|d| d["lastUpdateDate"].as_str().unwrap().to_owned())
        .collect()
}
const LIFE_RAW: [&str; 5] = [
    "raw/v2/data-go-kr/uv-idx-v5/",
    "raw/v2/data-go-kr/oak-pollen-v3/",
    "raw/v2/data-go-kr/pine-pollen-v3/",
    "raw/v2/data-go-kr/weeds-pollen-v3/",
    "raw/v2/mfds/",
];

/// RACE (life): a restarted process whose stored life reads end after the request bound decides
/// its acquisitions at the head start and answers today's UV, pollen and food poisoning from them
/// on its first request, each asked once; once the reads end it answers as a process that read
/// S3.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_life_read_starts_uv_at_the_head_start() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    // The producing process acquires today's datasets.
    let produced = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD)
        .load(now_ms(), deadline())
        .await;
    assert!(!uv_issued(&produced, 1_100_000_000.).is_empty());
    let s = &stub.state;
    let asked = |s: &StubState| [&s.uv, &s.weeds, &s.mfds].map(|n| n.load(Ordering::SeqCst));
    assert_eq!(asked(s), [1, 1, 1]);
    // The restart: every stored life read ends after the bound.
    let counted = restarted_transport(&peer);
    let b = restarted(&peer, &counted, &store, Some(&stub));
    let gate = counted.hold(&LIFE_RAW);
    let (first, took) = first_request(&b, Duration::from_millis(2700)).await;
    gate.open();
    assert!(
        gate.was_reached(),
        "the life restore reads during the request"
    );
    assert!(took < Duration::from_millis(3000), "{took:?}");
    assert_eq!(
        uv_issued(&first, 1_100_000_000.),
        uv_issued(&produced, 1_100_000_000.),
        "today's UV from the acquisition"
    );
    assert_eq!(first.life.pollen_day3(1_100_000_000.).len(), 1, "weeds");
    assert!(!first.mfds.is_empty(), "food poisoning");
    assert_eq!(
        asked(s),
        [2, 2, 2],
        "each dataset asked once by the restart"
    );
    // The stored reads end: the answers of a process that read S3.
    let mut later = b.load(now_ms(), deadline()).await;
    for _ in 0..40 {
        if later.life.len() == produced.life.len() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        later = b.load(now_ms(), deadline()).await;
    }
    let cold = restarted(&peer, &restarted_transport(&peer), &store, None)
        .load(now_ms(), deadline())
        .await;
    same(
        &later.life.by_area(1_100_000_000.),
        &cold.life.by_area(1_100_000_000.),
        "after the restore",
    );
    assert_eq!(later.mfds.json().to_bytes(), cold.mfds.json().to_bytes());
    assert_eq!(asked(s), [2, 2, 2]);
}

/// FAST (life): a restart whose stored reads end before the head start asks the providers
/// nothing a running process would not ask, and answers as the producing process. (Pollen
/// out of season is asked again by any new process: the no-data mark is not stored.)
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_current_stored_slot_asks_no_uv() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let produced = LifeInputs::new(transport.clone(), store.clone())
        .with_clock(test_clock())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_kasi_schedule(HOLD, HOLD)
        .load(now_ms(), deadline())
        .await;
    let s = &stub.state;
    let asked = |s: &StubState| [&s.uv, &s.weeds, &s.mfds].map(|n| n.load(Ordering::SeqCst));
    assert_eq!(asked(s), [1, 1, 1]);
    let counted = restarted_transport(&peer);
    let b = restarted(&peer, &counted, &store, Some(&stub));
    // A head start of 4.7 s keeps a prompt read ahead of it on a slow runner.
    let (first, _) = first_request(&b, Duration::from_millis(6700)).await;
    assert_eq!(asked(s), [1, 1, 1], "no UV, pollen or MFDS call");
    same(
        &first.life.by_area(1_100_000_000.),
        &produced.life.by_area(1_100_000_000.),
        "the first answer",
    );
    assert_eq!(
        first.mfds.json().to_bytes(),
        produced.mfds.json().to_bytes()
    );
}

/// One UV acquisition of every area issued at `issued` (`YYYYMMDDHH`), as the stub answers.
fn uv_page(issued: &str) -> Vec<u8> {
    let items: Vec<serde_json::Value> = AREAS
        .iter()
        .map(|a| {
            let mut it = json!({"code": "A07_2", "areaNo": a, "date": issued});
            for n in (0..=75).step_by(3) {
                it[format!("h{n}")] = json!(format!("{}", n % 11));
            }
            it
        })
        .collect();
    kma_page(serde_json::Value::Array(items))
}

/// An in-memory S3 for a paused clock: raw objects, conditional control objects and index
/// listings; each LIST takes `list_delay` and each GET `get_delay` (virtual time), and the most
/// GETs in flight at once is kept.
#[derive(Clone, Default)]
pub(super) struct MemS3(Arc<Mutex<MemData>>);
#[derive(Default)]
pub(super) struct MemData {
    objects: std::collections::BTreeMap<String, server2::storage::Object>,
    controls: std::collections::BTreeMap<String, (Vec<u8>, u64)>,
    revision: u64,
    list_delay: Duration,
    get_delay: Duration,
    gets: usize,
    peak_gets: usize,
}
impl MemS3 {
    fn data(&self) -> std::sync::MutexGuard<'_, MemData> {
        self.0.lock().unwrap()
    }
    async fn get_delayed(&self) {
        let delay = {
            let mut d = self.data();
            d.gets += 1;
            d.peak_gets = d.peak_gets.max(d.gets);
            d.get_delay
        };
        tokio::time::sleep(delay).await;
        self.data().gets -= 1;
    }
}
impl server2::storage::ObjectTransport for MemS3 {
    async fn put(
        &self,
        record: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        let mut d = self.data();
        if d.objects.contains_key(&record.key) {
            return Ok(412);
        }
        let object = server2::storage::Object {
            metadata: record.metadata.clone(),
            length: record.body.len(),
            body: record.body.clone(),
        };
        d.objects.insert(record.key.clone(), object);
        Ok(200)
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        let d = self.data();
        let o = d
            .objects
            .get(key)
            .ok_or(server2::storage::Error::NotFound)?;
        Ok(server2::storage::Object {
            metadata: o.metadata.clone(),
            length: o.length,
            body: Vec::new(),
        })
    }
    async fn get(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        self.get_delayed().await;
        let o = self
            .data()
            .objects
            .get(key)
            .cloned()
            .ok_or(server2::storage::Error::NotFound)?;
        if o.length > maximum {
            return Err(server2::storage::Error::Capacity);
        }
        Ok(o)
    }
}
impl server2::storage::CatalogTransport for MemS3 {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        self.get_delayed().await;
        let (body, revision) = self
            .data()
            .controls
            .get(key)
            .cloned()
            .ok_or(server2::storage::Error::NotFound)?;
        if body.len() > maximum {
            return Err(server2::storage::Error::Capacity);
        }
        Ok(server2::storage::ControlObject {
            body,
            etag: format!("\"{revision}\""),
            version: None,
        })
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &server2::storage::WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        let mut d = self.data();
        let current = d.controls.get(key).map(|(_, r)| format!("\"{r}\""));
        let allowed = match condition {
            server2::storage::WriteCondition::Absent => current.is_none(),
            server2::storage::WriteCondition::Match(etag) => {
                current.as_deref() == Some(etag.as_str())
            }
        };
        if !allowed {
            return Ok(412);
        }
        d.revision += 1;
        let revision = d.revision;
        d.controls.insert(key.to_owned(), (body.to_vec(), revision));
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        Err(server2::storage::Error::Invalid(
            "no raw listing in this test",
        ))
    }
}
impl server2::history::IndexListing for MemS3 {
    async fn list_index(
        &self,
        prefix: &str,
        _: Option<&str>,
    ) -> Result<server2::storage::ListPage, server2::storage::Error> {
        let delay = self.data().list_delay;
        tokio::time::sleep(delay).await;
        let keys = self
            .data()
            .controls
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        Ok(server2::storage::ListPage { keys, next: None })
    }
}
/// A life provider that answers nothing and records which datasets were asked.
#[derive(Default)]
struct Asked(Mutex<Vec<String>>);
impl Asked {
    fn uv(&self) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|a| a.contains("UvIdx"))
            .count()
    }
}
impl LifeAcquire for Asked {
    fn acquire(
        &self,
        request: LifeRequest,
    ) -> server2::gateway::BoxFuture<
        'static,
        Result<server2::domestic::kma::source::life_live::LifeOutcome, String>,
    > {
        self.0.lock().unwrap().push(format!("{request:?}"));
        Box::pin(async { Ok(server2::domestic::kma::source::life_live::LifeOutcome::Nothing) })
    }
}

/// NEEDED-FIRST: the first life read lists the four families' partitions together. With every
/// LIST taking 300 ms (a paused clock), today's UV is folded before the 700 ms head start, so the
/// request starts no UV acquisition; listed one family after another, the four listings alone
/// end past it.
#[tokio::test(start_paused = true)]
async fn the_needed_first_read_lists_the_life_families_together() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let mem = MemS3::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    for time in (0..=12).step_by(3).map(|h| format!("20261016{h:02}")) {
        let p = Publication::parse_compact(&format!("{time}00")).unwrap();
        publish(
            &store,
            "data-go-kr",
            "uv-idx-v5",
            named("all-areas"),
            p.period(),
            &p.partition(),
            server2::history::schedule::to_ms(p) as f64 + 600_000.,
            &[uv_page(&time)],
        )
        .await;
    }
    mem.data().list_delay = Duration::from_millis(300);
    let asked = Arc::new(Asked::default());
    let inputs = LifeInputs::new(mem.clone(), store)
        .with_clock(test_clock())
        .with_acquire(Some(asked.clone()))
        .with_kasi_schedule(HOLD, HOLD);
    let started = Instant::now();
    let answers = inputs
        .load_by(
            now_ms(),
            started + HEAD_START,
            started + Duration::from_millis(2700),
        )
        .await;
    let today = uv_issued(&answers, 1_100_000_000.);
    assert!(today.iter().any(|i| i == "2026101612"), "{today:?}");
    assert_eq!(
        asked.uv(),
        0,
        "today's UV was folded before the head start: {:?}",
        asked.0.lock().unwrap()
    );
}

/// Page `n` of a UV acquisition: the rows of [`uv_page`] under their own page number.
fn uv_page_numbered(issued: &str, n: u32) -> Vec<u8> {
    let mut page: serde_json::Value = serde_json::from_slice(&uv_page(issued)).unwrap();
    page["response"]["body"]["pageNo"] = json!(n);
    page.to_string().into_bytes()
}

/// NEEDED-FIRST: the first life read restores today's records with several S3 reads in flight.
/// Today's UV partition holds three 4-page acquisitions, as after the EC2 restarts: read one at a
/// time, its catalog, 3 descriptors and 12 pages are 16 reads in a row, which at 170 ms each (a
/// paused clock) end past the request's life section (2.5 s). Read at most 4 at a time, today's
/// UV is on the first answer.
#[tokio::test(start_paused = true)]
async fn the_needed_first_read_restores_todays_records_together() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let mem = MemS3::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let p = Publication::parse_compact("202610161200").unwrap();
    // Acquired 10, 15 and 20 minutes after the issuance, before the request (12:30 KST).
    for minutes in [10., 15., 20.] {
        let pages: Vec<Vec<u8>> = (1..=4).map(|n| uv_page_numbered("2026101612", n)).collect();
        publish(
            &store,
            "data-go-kr",
            "uv-idx-v5",
            named("all-areas"),
            p.period(),
            &p.partition(),
            server2::history::schedule::to_ms(p) as f64 + minutes * 60_000.,
            &pages,
        )
        .await;
    }
    {
        let mut d = mem.data();
        d.get_delay = Duration::from_millis(170);
        d.peak_gets = 0;
    }
    let inputs = LifeInputs::new(mem.clone(), store)
        .with_clock(test_clock())
        .with_acquire(Some(Arc::new(Asked::default())))
        .with_kasi_schedule(HOLD, HOLD);
    let started = Instant::now();
    let answers = inputs
        .load_by(
            now_ms(),
            started + HEAD_START,
            started + Duration::from_millis(2700),
        )
        .await;
    let today = uv_issued(&answers, 1_100_000_000.);
    assert!(
        today.iter().any(|i| i == "2026101612"),
        "today's UV on the first answer: {today:?}"
    );
    let peak = mem.data().peak_gets;
    assert!(peak <= 4, "S3 reads in flight: {peak}");
}

/// NEEDED-FIRST: the first life read of a process restores today's partitions (and the latest
/// before) before the rest of its 14-day window, so with the rest delayed past the bound the first
/// answer has today's UV; the rest follows.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_life_read_restores_todays_slots_first() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, MIDDAY).await;
    let peer = Peer::persistent();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    // Noon issuances of 10-03..10-15 and today's (10-16) of 00..12 KST, each acquired 10 minutes
    // after its issuance.
    let mut issued: Vec<String> = (3..=15).map(|d| format!("202610{d:02}12")).collect();
    issued.extend((0..=12).step_by(3).map(|h| format!("20261016{h:02}")));
    for time in &issued {
        let p = Publication::parse_compact(&format!("{time}00")).unwrap();
        publish(
            &store,
            "data-go-kr",
            "uv-idx-v5",
            named("all-areas"),
            p.period(),
            &p.partition(),
            server2::history::schedule::to_ms(p) as f64 + 600_000.,
            &[uv_page(time)],
        )
        .await;
    }
    let counted = restarted_transport(&peer);
    let b = restarted(&peer, &counted, &store, None);
    let older: Vec<String> = (3..=14)
        .map(|day| format!("raw/v2/data-go-kr/uv-idx-v5/2026/10/{day:02}/"))
        .collect();
    let gate = counted.hold(&older.iter().map(String::as_str).collect::<Vec<_>>());
    let (first, took) = first_request(&b, Duration::from_millis(2700)).await;
    gate.open();
    assert!(
        gate.was_reached(),
        "the older days are read during the request"
    );
    assert!(took < Duration::from_millis(3000), "{took:?}");
    let today = uv_issued(&first, 1_100_000_000.);
    assert!(
        today.iter().any(|i| i == "2026101612"),
        "today's UV on the first answer: {today:?}"
    );
    assert!(
        today.iter().all(|i| i.as_str() >= "2026101512"),
        "the rest of the window follows: {today:?}"
    );
    let cold = restarted(&peer, &restarted_transport(&peer), &store, None)
        .load(now_ms(), deadline())
        .await;
    let mut later = b.load(now_ms(), deadline()).await;
    for _ in 0..40 {
        if later.life.len() == cold.life.len() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        later = b.load(now_ms(), deadline()).await;
    }
    same(
        &later.life.by_area(1_100_000_000.),
        &cold.life.by_area(1_100_000_000.),
        "the whole window",
    );
}

/// LANES: the KASI capture pass, which no request waits for, reads and writes on the bulk lane;
/// a request's KASI restore reads on the request lane.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_kasi_pass_uses_the_bulk_lane() {
    let _serial = fixed_now(&super::source_s3::S3_PEERS, &INSTANT, FIXED_NOW).await;
    let peer = Peer::persistent();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let kasi = |counts: std::collections::HashMap<String, usize>, bulk: bool| -> usize {
        counts
            .iter()
            .filter(|(k, _)| k.contains("kasi") && k.starts_with("bulk ") == bulk)
            .map(|(_, n)| *n)
            .sum()
    };
    let counted = restarted_transport(&peer);
    let pass = restarted(&peer, &counted, &store, None);
    pass.kasi_pass(KASI_NOW).await.unwrap();
    let all = kasi(counted.counts(), false);
    assert!(all > 0);
    assert_eq!(
        kasi(counted.counts(), true),
        all,
        "the pass on the bulk lane"
    );
    let counted = restarted_transport(&peer);
    let request = restarted(&peer, &counted, &store, None).with_kasi_wait(Duration::from_secs(20));
    assert!(request.load(KASI_NOW, deadline()).await.kasi.is_some());
    assert!(kasi(counted.counts(), false) > 0);
    assert_eq!(
        kasi(counted.counts(), true),
        0,
        "the request on the request lane"
    );
}
