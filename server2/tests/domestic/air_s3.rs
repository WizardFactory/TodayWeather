//! S15b-3 AIR S3: the AirKorea inputs read back from the S06 loopback S3 test peer with empty
//! memory equal the oracle answers; a missing national dataset is acquired once (single-flight)
//! through a loopback AirKorea stub, published before use, and a request that cannot wait for it
//! gets the legacy answer for missing data while the acquisition finishes and serves the next
//! request. TEST ONLY: no provider or AWS is reached.
use super::air::{acquisitions, oracle};
use super::source::{at, items_of, number, same, text};
use super::source_s3::{Peer, deadline};
use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
use serde_json::json;
use server2::domestic::airkorea::AirKoreaRequest;
use server2::domestic::kma::source::Doc;
use server2::domestic::kma::source::Val;
use server2::domestic::kma::source::air_input::{AirInputs, kst_date};
use server2::domestic::kma::source::airkorea::{Observations, Stations, arpltn_answer};
use server2::domestic::kma::source::live::{AirKoreaAcquire, AirKoreaSettings, LiveAirKorea};
use server2::domestic::publication::Publication;
use server2::gateway::{BoxFuture, OrderedJson};
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    Pagination, Period, ProviderKey, RawRecord,
};
use server2::world::BoundedS3;
use server2::world::air::{AirOutcome, AirSource, Observation};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::time::Instant;

type Store = CatalogStore<BoundedS3<HttpS3Transport>>;
/// The S3-peer tests run one at a time with the other domestic S3-peer tests (see
/// [`super::source_s3::S3_PEERS`]).
use super::source_s3::{S3_PEERS as SERIAL, TEST_PERMITS};

/// Publish one acquisition group as the S13b acquirer does.
async fn publish(
    store: &Store,
    kind: &str,
    key: &str,
    period: Period,
    partition: &str,
    fetched_at: f64,
    pages: &[Vec<u8>],
) {
    let limits = CatalogLimits::default();
    let key = ProviderKey::Named { id: key.into() };
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let record = RawRecord::new(
            "data-go-kr",
            kind,
            &key,
            period.clone(),
            fetched_at as u64,
            200,
            "application/json",
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
fn kst(ms: f64) -> Publication {
    server2::history::schedule::from_ms(ms as i64)
}
/// The most common KST data hour of a nationwide page (the S15b-3 dataset period).
fn mode_hour(items: &[serde_json::Value]) -> Publication {
    let mut hours: std::collections::BTreeMap<Publication, usize> = Default::default();
    for i in items {
        if let Some(t) = i.get("dataTime").and_then(|v| v.as_str()) {
            let ms = server2::domestic::kma::source::airkorea::kst_instant(t);
            if ms.is_finite() {
                *hours.entry(kst(ms)).or_default() += 1;
            }
        }
    }
    *hours
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then(a.0.cmp(b.0)))
        .unwrap()
        .0
}
/// Publish the oracle's station lists, nationwide observations and dust forecasts.
async fn seed_oracle(store: &Store) {
    for (fetched, _, pages) in acquisitions(&["stations", "acquisitions"]) {
        let day = kst(fetched).date();
        let period = Period {
            local_date: day,
            slot: "0000".into(),
        };
        publish(
            store,
            "airkorea-station-list",
            "stations",
            period,
            &format!("{day:08}"),
            fetched,
            &pages,
        )
        .await;
    }
    for (fetched, items, pages) in acquisitions(&["observations", "acquisitions"]) {
        let hour = mode_hour(&items);
        publish(
            store,
            "airkorea-station",
            "sido-nationwide",
            hour.period(),
            &hour.partition(),
            fetched,
            &pages,
        )
        .await;
    }
    let dust = items_of(at(oracle(), &["dust", "acquisitions"]));
    let runs = items_of(at(oracle(), &["dust", "runs"]));
    for ((a, run), (fetched, _, pages)) in dust
        .iter()
        .zip(runs)
        .zip(acquisitions(&["dust", "acquisitions"]))
    {
        let search = text(at(a, &["search"])).replace('-', "");
        // The record period is the announcement chosen before the call (`YYYY-MM-DD HH시 발표`).
        let expected = text(at(run, &["expected"]));
        let period = Period {
            local_date: expected[..10].replace('-', "").parse().unwrap(),
            slot: format!("{}00", &expected[11..13]),
        };
        publish(
            store,
            "airkorea-dust-forecast",
            "dust-forecast",
            period,
            &search,
            fetched,
            &pages,
        )
        .await;
    }
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
async fn air_inputs_restore_oracle_answers_from_s3_with_empty_memory() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let mut readers = std::collections::HashMap::new();
    for a in items_of(at(oracle(), &["arpltn"])) {
        let now = number(at(a, &["now"]));
        // One reader per instant (its memory serves the six towns), as one process would.
        let inputs = readers
            .entry(now.to_bits())
            .or_insert_with(|| AirInputs::new(transport.clone(), store.clone()));
        let g = at(a, &["gCoord"]);
        let answers = inputs
            .load(
                &town(number(at(g, &["lat"])), number(at(g, &["lon"]))),
                "서울특별시",
                "종로구",
                false,
                false,
                now,
                deadline(),
            )
            .await;
        same(
            &answers.arpltn.unwrap(),
            at(a, &["result"]),
            &format!("{} at {now}", text(at(a, &["town"]))),
        );
        assert!(answers.dust.is_none());
    }
    // Dust forecasts: the oracle queried after its last run (10-14 23:32 KST). A request reads
    // the search dates `date-2..date` at its own KST date, so the queries for 10-14 .. 10-17 are
    // replayed at 12:00 KST of that date (after every run); 10-12 and 10-13 would need an instant
    // before later runs.
    let mut replayed = 0;
    for q in items_of(at(oracle(), &["dust", "queries"])) {
        let date = text(at(q, &["date"]));
        if date.as_str() < "20261014" {
            continue;
        }
        let day: u32 = date.parse().unwrap();
        let now = server2::history::schedule::to_ms(Publication::new(day, 1200).unwrap()) as f64;
        let now = now.max(1_791_988_320_000. + 60_000.);
        assert_eq!(kst_date(now), day);
        // One reader per date, as for the observations (fewer S3 reads for the 16-slot peer).
        let dust_reader = readers
            .entry(now.to_bits())
            .or_insert_with(|| AirInputs::new(transport.clone(), store.clone()));
        replayed += 1;
        let (region, city) = (text(at(q, &["region"])), text(at(q, &["city"])));
        let answers = dust_reader
            .load(
                &town(37.57, 126.98),
                &region,
                &city,
                true,
                false,
                now,
                deadline(),
            )
            .await;
        let (args, answer) = answers.dust.unwrap();
        assert_eq!(args, (region.clone(), city.clone(), date.clone()));
        match at(q, &["error"]).string() {
            Some(e) => assert_eq!(answer.unwrap_err(), e),
            None => same(
                &answer.unwrap(),
                at(q, &["result"]),
                &format!("{region} {city}"),
            ),
        }
    }
    assert_eq!(replayed, 4 * 14);
    assert_eq!(
        transport.available(),
        TEST_PERMITS,
        "every S3 permit returned"
    );
}

// ---- request-time acquisition ----

#[derive(Default)]
struct StubState {
    nationwide: AtomicUsize,
    station_list: AtomicUsize,
    delay_ms: AtomicUsize,
    /// Data hour of the nationwide rows, in hours before now.
    hours_ago: AtomicUsize,
    /// `hours_ago` applies to the next nationwide call only (later calls answer this hour).
    hours_ago_once: std::sync::atomic::AtomicBool,
    /// Added to every PM10 value (distinguishes a later acquisition).
    pm10_offset: AtomicUsize,
    /// 1: 1,200 rows on two pages, 1,000 of the previous hour then 200 of this hour.
    /// 2: 1,000 rows of this hour, then 7 rows without `dataTime`.
    /// 3: 1,000 rows without `dataTime`, then 200 rows of this hour.
    two_pages: AtomicUsize,
    queries: Mutex<Vec<String>>,
}
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}
fn kst_text(ms: f64) -> String {
    let p = kst(ms);
    let d = p.base_date();
    format!("{}-{}-{} {:02}:00", &d[..4], &d[4..6], &d[6..], p.hour())
}
const STATIONS: [(&str, f64, f64); 3] = [
    ("중구", 37.564263, 126.974676),
    ("종로구", 37.572016, 127.005007),
    ("용산구", 37.540033, 127.004850),
];
async fn handle(State(state): State<Arc<StubState>>, uri: Uri) -> impl IntoResponse {
    let query = uri.query().unwrap_or("").to_owned();
    state
        .queries
        .lock()
        .unwrap()
        .push(format!("{} {}", uri.path(), redact(&query)));
    let pairs: Vec<(String, String)> = url_pairs(&query);
    let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    let body = if uri.path().ends_with("/getCtprvnRltmMesureDnsty") {
        state.nationwide.fetch_add(1, Ordering::SeqCst);
        let delay = state.delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        }
        assert_eq!(get("sidoName").as_deref(), Some("전국"));
        assert_eq!(get("numOfRows").as_deref(), Some("1000"));
        assert_eq!(get("ver").as_deref(), Some("1.3"));
        assert_eq!(get("returnType").as_deref(), Some("json"));
        let ago = if state.hours_ago_once.load(Ordering::SeqCst) {
            state.hours_ago.swap(0, Ordering::SeqCst) as f64
        } else {
            state.hours_ago.load(Ordering::SeqCst) as f64
        };
        let hour = kst_text(now_ms() - ago * 3_600_000.);
        let offset = state.pm10_offset.load(Ordering::SeqCst);
        let shape = state.two_pages.load(Ordering::SeqCst);
        if shape > 0 {
            let page: usize = get("pageNo").unwrap().parse().unwrap();
            let this = serde_json::Value::String(kst_text(now_ms()));
            let previous = serde_json::Value::String(kst_text(now_ms() - 3_600_000.));
            let (range, time, total) = match (shape, page) {
                (1, 1) => (0..1000, previous, 1200),
                (1, _) => (1000..1200, this, 1200),
                (2, 1) => (0..1000, this, 1007),
                (2, _) => (1000..1007, serde_json::Value::Null, 1007),
                (_, 1) => (0..1000, serde_json::Value::Null, 1200),
                (_, _) => (1000..1200, this, 1200),
            };
            let items: Vec<serde_json::Value> = range
                .map(|i| {
                    json!({"stationName": format!("측정소{i}"), "sidoName": "서울",
                    "dataTime": time, "pm10Value": "10"})
                })
                .collect();
            let body = json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
                "body": {"totalCount": total, "items": items, "pageNo": page, "numOfRows": 1000}}});
            return ([("content-type", "application/json")], body.to_string());
        }
        let items: Vec<serde_json::Value> = STATIONS
            .iter()
            .enumerate()
            .map(|(i, (name, _, _))| {
                json!({"stationName": name, "sidoName": "서울", "mangName": "도시대기",
                       "dataTime": hour, "pm10Value": format!("{}", 20 + i + offset), "pm25Value": "9",
                       "khaiValue": "50", "khaiGrade": "1", "pm10Grade1h": "1", "pm25Grade1h": "1",
                       "so2Value": "0.003", "coValue": "0.4", "o3Value": "0.03", "no2Value": "0.02"})
            })
            .chain(std::iter::once(json!({"stationName": "점검중", "sidoName": "서울", "dataTime": null})))
            .collect();
        json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
               "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 1000}}})
    } else if uri.path().ends_with("/getMsrstnList") {
        state.station_list.fetch_add(1, Ordering::SeqCst);
        let items: Vec<serde_json::Value> = STATIONS
            .iter()
            .map(|(name, lat, lon)| {
                json!({"stationName": name, "dmX": lat.to_string(), "dmY": lon.to_string(),
                       "addr": "서울", "item": "PM10, PM2.5", "mangName": "도시대기", "year": "2000"})
            })
            .collect();
        json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
               "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}})
    } else {
        json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}})
    };
    ([("content-type", "application/json")], body.to_string())
}
fn redact(q: &str) -> String {
    q.split('&')
        .filter(|p| !p.starts_with("serviceKey="))
        .collect::<Vec<_>>()
        .join("&")
}
fn url_pairs(q: &str) -> Vec<(String, String)> {
    let parsed: reqwest::Url = format!("http://127.0.0.1/?{q}").parse().unwrap();
    parsed
        .query_pairs()
        .map(|(a, b)| (a.into_owned(), b.into_owned()))
        .collect()
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
fn live(peer: &Peer, store: Arc<Store>, base: &str) -> Arc<dyn AirKoreaAcquire> {
    live_with(
        peer,
        store,
        base,
        server2::domestic::kma::source::live::airkorea_transport().unwrap(),
    )
}
fn live_with(
    peer: &Peer,
    store: Arc<Store>,
    base: &str,
    funded: server2::providers::HttpProviderTransport,
) -> Arc<dyn AirKoreaAcquire> {
    let vars = |name: &str| -> Option<String> {
        match name {
            "AIRKOREA_SECRET_KEYS" => Some(r#"["S15B3_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/="]"#.into()),
            _ => None,
        }
    };
    // S10e: the data.go.kr root is a test-built root, not a setting.
    let endpoints = server2::gateway::runtime::Builtins {
        data_go_kr: base.into(),
        ..server2::gateway::runtime::Builtins::production()
    }
    .kma_endpoints()
    .unwrap();
    let mut settings = AirKoreaSettings::from_vars(&vars, endpoints)
        .unwrap()
        .unwrap();
    assert_eq!(
        settings.daily_units,
        server2::domestic::kma::source::live::AIRKOREA_DAILY_UNITS
    );
    // The tests' funding scenarios are sized for 100 units per key.
    settings.daily_units = 100;
    Arc::new(LiveAirKorea::new(
        settings,
        Arc::new(funded),
        Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(peer.transport_limited(super::source_s3::ACQUIRER_PERMITS)),
        store,
        Arc::new(server2::budget::SystemClock),
    ))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_missing_national_dataset_is_acquired_once_and_published_before_use() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let now = now_ms();
    let seoul = town(37.5657, 126.9769);
    // Two concurrent requests share one acquisition of each dataset.
    let jongno = town(37.57, 127.0);
    let (a, b) = tokio::join!(
        inputs.load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            now,
            Instant::now() + Duration::from_secs(3)
        ),
        inputs.load(
            &jongno,
            "서울특별시",
            "종로구",
            false,
            false,
            now,
            Instant::now() + Duration::from_secs(3)
        ),
    );
    for answer in [&a, &b] {
        let arpltn = answer.arpltn.as_ref().unwrap();
        let merged = arpltn.get("arpltn").unwrap_or_else(|| {
            panic!(
                "merged observation: {}",
                String::from_utf8_lossy(&arpltn.to_bytes())
            )
        });
        assert!(
            merged
                .get("pm10Value")
                .and_then(OrderedJson::number)
                .is_some()
        );
        assert_eq!(items_of(arpltn.get("stnList").unwrap()).len(), 3);
        assert!(answer.fallback.is_none(), "AirKorea answered: no fallback");
    }
    assert_eq!(stub.state.nationwide.load(Ordering::SeqCst), 1);
    assert_eq!(stub.state.station_list.load(Ordering::SeqCst), 1);
    let queries = stub.state.queries.lock().unwrap().clone();
    assert!(
        queries
            .iter()
            .any(|q| q.starts_with("/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"))
    );
    // A cold reader serves the published records without the provider.
    let cold = AirInputs::new(transport.clone(), store.clone());
    let again = cold
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            now_ms(),
            deadline(),
        )
        .await;
    same(
        again.arpltn.as_ref().unwrap(),
        a.arpltn.as_ref().unwrap(),
        "restored from S3",
    );
    assert_eq!(stub.state.nationwide.load(Ordering::SeqCst), 1);
    assert_eq!(transport.available(), TEST_PERMITS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_acquisition_releases_the_request_and_serves_the_next_one() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let seoul = town(37.5657, 126.9769);
    // Warm the station list first.
    let first = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            now_ms(),
            Instant::now() + Duration::from_secs(3),
        )
        .await;
    assert!(first.arpltn.unwrap().get("arpltn").is_some());
    // A new process: the station list is in S3, the observation of this hour too; drop it by
    // using a reader whose request instant is one hour later (no dataset for that hour yet).
    stub.state.delay_ms.store(2_000, Ordering::SeqCst);
    // The delayed acquisition answers other values, so the next request proves it reads them.
    stub.state.pm10_offset.store(50, Ordering::SeqCst);
    let later = now_ms() + 3_600_000.;
    let inputs2 = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let started = std::time::Instant::now();
    let answer = inputs2
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            later,
            Instant::now() + Duration::from_millis(800),
        )
        .await;
    assert!(
        started.elapsed() < Duration::from_millis(1_200),
        "{:?}",
        started.elapsed()
    );
    // The previous hour's rows are still fresh for `later`: the stored value is served.
    let arpltn = answer.arpltn.unwrap();
    assert_eq!(items_of(arpltn.get("stnList").unwrap()).len(), 3);
    let pm10 = |a: &OrderedJson| {
        a.get("arpltn")
            .and_then(|m| m.get("pm10Value"))
            .and_then(OrderedJson::number)
    };
    assert_eq!(pm10(&arpltn), Some(20.));
    assert_eq!(
        stub.state.nationwide.load(Ordering::SeqCst),
        2,
        "one owned acquisition started"
    );
    // The owned acquisition continues and publishes; the next request is served from S3
    // without a further provider call (single flight, then throttled).
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    let next = inputs2
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            later,
            Instant::now() + Duration::from_secs(3),
        )
        .await;
    assert_eq!(
        pm10(next.arpltn.as_ref().unwrap()),
        Some(70.),
        "the late acquisition's value"
    );
    assert_eq!(stub.state.nationwide.load(Ordering::SeqCst), 2);
    // A fresh reader serves the published value as well.
    let cold = AirInputs::new(transport.clone(), store.clone());
    let restored = cold
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            later,
            deadline(),
        )
        .await;
    assert_eq!(pm10(restored.arpltn.as_ref().unwrap()), Some(70.));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_two_page_nationwide_dataset_is_dated_by_its_overall_mode() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.two_pages.store(1, Ordering::SeqCst);
    let acquire = live(&peer, store.clone(), &stub.base);
    // Page 1: 1,000 rows of the previous hour; page 2: 200 rows of this hour.
    let previous = kst(now_ms() - 3_600_000.).hour_start();
    assert_eq!(
        acquire.acquire(AirKoreaRequest::nationwide()).await,
        Ok(Some(previous.period()))
    );
    assert_eq!(stub.state.nationwide.load(Ordering::SeqCst), 2, "two pages");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_read_ends_by_the_request_deadline() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    // Every S3 GET now takes 20 ms: a cold load of 26 hours of datasets cannot finish in time.
    reqwest::Client::new()
        .post(format!("{}__catalog?mode=slow-all&key=x", peer.endpoint()))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    let inputs = AirInputs::new(transport.clone(), store.clone());
    let started = std::time::Instant::now();
    let answer = inputs
        .load(
            &town(37.5657, 126.9769),
            "서울특별시",
            "중구",
            true,
            false,
            1_791_955_500_000.,
            Instant::now() + Duration::from_millis(300),
        )
        .await;
    assert!(
        started.elapsed() < Duration::from_millis(450),
        "{:?}",
        started.elapsed()
    );
    assert!(
        answer.arpltn.is_err(),
        "unread data is the legacy error answer"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_hourly_capture_acquires_the_current_hour_while_demand_lasts() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone())
        .with_acquire(Some(live(&peer, store.clone(), &stub.base)))
        .with_capture_interval(Duration::from_millis(300));
    // A request for an instant three hours ago acquires that hour; it is demand.
    // Only the request's own call answers that earlier hour; any later call (a capture check
    // that runs while the request waits, or after it) answers the current hour.
    stub.state.hours_ago.store(3, Ordering::SeqCst);
    stub.state.hours_ago_once.store(true, Ordering::SeqCst);
    let past = now_ms() - 3. * 3_600_000.;
    let answer = inputs
        .load(
            &town(37.5657, 126.9769),
            "서울특별시",
            "중구",
            false,
            false,
            past,
            deadline(),
        )
        .await;
    assert!(answer.arpltn.unwrap().get("arpltn").is_some());
    // The request acquired its hour; a capture check (300 ms apart here) may already have run
    // while it waited.
    let before = stub.state.nationwide.load(Ordering::SeqCst);
    assert!((1..=2).contains(&before), "{before}");
    // The capture then acquires the current hour once, without a request needing it. Wait
    // for the outcome (not for a runner-dependent time): the acquisition and its S3
    // publication take as long as the runner needs.
    let hour = kst(now_ms()).hour_start();
    let captured = std::time::Instant::now();
    while stub.state.nationwide.load(Ordering::SeqCst) < 2 {
        assert!(
            captured.elapsed() < Duration::from_secs(30),
            "no capture within 30 s"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // The captured hour is published and remembered: ten further capture checks (300 ms
    // apart) ask nothing more in that hour.
    while cold_answer(&transport, &store).await.is_none() {
        assert!(
            captured.elapsed() < Duration::from_secs(60),
            "the captured hour reached S3"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let captured_calls = stub.state.nationwide.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(3_000)).await;
    if kst(now_ms()).hour_start() == hour {
        assert_eq!(
            stub.state.nationwide.load(Ordering::SeqCst),
            captured_calls,
            "one capture per hour"
        );
    }
    // The captured hour serves a request of that hour from S3 (no new call).
    let calls = stub.state.nationwide.load(Ordering::SeqCst);
    assert!(cold_answer(&transport, &store).await.is_some());
    assert_eq!(stub.state.nationwide.load(Ordering::SeqCst), calls);
}
/// The merged observation a cold reader without an acquirer answers now (None: missing data).
async fn cold_answer(
    transport: &BoundedS3<HttpS3Transport>,
    store: &Arc<Store>,
) -> Option<OrderedJson> {
    let cold = AirInputs::new(transport.clone(), store.clone());
    let answer = cold
        .load(
            &town(37.5657, 126.9769),
            "서울특별시",
            "중구",
            false,
            false,
            now_ms(),
            deadline(),
        )
        .await;
    answer.arpltn.ok()?.get("arpltn").cloned()
}

/// An air source answering one fixed observation (the shared LiveAir chain in production).
struct FixedAir(Observation);
impl AirSource for FixedAir {
    fn current(&self, _: f64, _: f64, _: f64) -> BoxFuture<'_, AirOutcome> {
        let o = self.0.clone();
        Box::pin(async move { AirOutcome::Observation(o) })
    }
}
/// A source that never answers before the deadline.
struct SlowAir;
impl AirSource for SlowAir {
    fn current(&self, _: f64, _: f64, _: f64) -> BoxFuture<'_, AirOutcome> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            AirOutcome::None
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_air_fallback_answers_when_no_station_has_a_value() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let now = 1_791_955_500_000.;
    let observation = Observation {
        provider: "aqicn".into(),
        station_based: true,
        observed_at: Some("2026-10-14T05:00:00Z".into()),
        pollutants: vec![("pm10", 31.), ("pm25", 12.), ("o3", 0.021)],
        attribution: server2::world::js::Val::Str(" WAQI ".into()),
        station_name: Some("Jung-gu".into()),
        station_geo: Some([37.56, 126.97]),
    };
    let inputs = AirInputs::new(transport.clone(), store.clone())
        .with_air(Some(Arc::new(FixedAir(observation))));
    let answer = inputs
        .load(
            &town(37.5657, 126.9769),
            "서울특별시",
            "중구",
            false,
            false,
            now,
            deadline(),
        )
        .await;
    // No station list in S3 and no key: the legacy empty answer, then the fallback.
    same(
        answer.arpltn.as_ref().unwrap(),
        &OrderedJson::parse(br#"{"stnList":[]}"#).unwrap(),
        "empty AirKorea answer",
    );
    let ((lat, lon), found) = answer.fallback.unwrap();
    assert_eq!((lat, lon), (37.5657, 126.9769));
    same(
        &found.unwrap(),
        &OrderedJson::parse(
            r#"{"source":"aqicn","stationName":"Jung-gu","dataTime":"2026-10-14 14:00","attribution":"WAQI","pm10Value":31,"pm25Value":12,"o3Value":0.021}"#.as_bytes(),
        )
        .unwrap(),
        "observation.evaluate",
    );
    // A provider that is not ready before the deadline: no fallback value (its fetch continues).
    let slow = AirInputs::new(transport.clone(), store.clone()).with_air(Some(Arc::new(SlowAir)));
    let started = std::time::Instant::now();
    let answer = slow
        .load(
            &town(37.5657, 126.9769),
            "서울특별시",
            "중구",
            false,
            false,
            now,
            Instant::now() + Duration::from_millis(600),
        )
        .await;
    assert!(started.elapsed() < Duration::from_millis(1_000));
    assert_eq!(answer.fallback.unwrap().1, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_nationwide_acquisition_is_one_published_dataset_of_its_data_hour() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let acquire = live(&peer, store.clone(), &stub.base);
    let hour = kst(now_ms()).hour_start();
    assert_eq!(
        acquire.acquire(AirKoreaRequest::nationwide()).await,
        Ok(Some(hour.period()))
    );
    assert!(matches!(
        acquire.acquire(AirKoreaRequest::station_list()).await,
        Ok(Some(_))
    ));
    let queries = stub.state.queries.lock().unwrap().clone();
    assert_eq!(
        queries,
        vec![
            "/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty sidoName=%EC%A0%84%EA%B5%AD&pageNo=1&numOfRows=1000&ver=1.3&returnType=json".to_string(),
            "/B552584/MsrstnInfoInqireSvc/getMsrstnList pageNo=1&numOfRows=100&returnType=json".to_string(),
        ]
    );
    // The dataset is one record of the national key in the partition of its data hour; the row
    // without a data time is kept in the raw bytes and skipped by the reader.
    let id = CatalogId {
        source: "data-go-kr".into(),
        kind: "airkorea-station".into(),
        key_sha256: server2::storage::sha256(
            &ProviderKey::Named {
                id: "sido-nationwide".into(),
            }
            .canonical_bytes()
            .unwrap(),
        ),
        partition: hour.partition(),
    };
    match store.lookup(&id, deadline()).await.unwrap() {
        server2::storage::LookupOutcome::Ready(set) => {
            let records = set.acquisitions().last().unwrap().records();
            assert_eq!(records.len(), 1);
            let page: serde_json::Value = serde_json::from_slice(&records[0].bytes).unwrap();
            assert_eq!(
                page["response"]["body"]["items"].as_array().unwrap().len(),
                4
            );
            assert_eq!(
                Observations::parse(page["response"]["body"]["items"].as_array().unwrap()).len(),
                3
            );
        }
        other => panic!("not published: {other:?}"),
    }
}

// ---- the snapshot store calls ----

/// One nationwide page of `rows` (station, data time, pm10) for the snapshot test.
fn nationwide_page(rows: &[(&str, &str, &str)]) -> Vec<u8> {
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|(name, time, pm10)| {
            json!({"stationName": name, "sidoName": "서울", "mangName": "도시대기", "dataTime": time,
                   "pm10Value": pm10, "pm25Value": "8", "khaiValue": "40", "khaiGrade": "1",
                   "pm10Grade1h": "1", "pm25Grade1h": "1", "o3Value": "0.02", "no2Value": "0.01",
                   "coValue": "0.3", "so2Value": "0.002"})
        })
        .collect();
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
        "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 1000}}}),
    )
    .unwrap()
}
fn station_page() -> Vec<u8> {
    let items: Vec<serde_json::Value> = STATIONS
        .iter()
        .map(|(name, lat, lon)| {
            json!({"stationName": name, "dmX": lat.to_string(), "dmY": lon.to_string(),
                   "addr": "서울", "item": "PM10, PM2.5", "mangName": "도시대기", "year": "2000"})
        })
        .collect();
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
        "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}}),
    )
    .unwrap()
}
fn dust_page() -> Vec<u8> {
    let item = |code: &str, data: &str| {
        json!({"dataTime": "2026-09-24 05시 발표", "informCode": code, "informData": data,
               "informGrade": "서울 : 보통,인천 : 좋음", "informCause": "c", "informOverall": "o",
               "actionKnack": null})
    };
    let items = vec![
        item("PM10", "2026-09-24"),
        item("PM25", "2026-09-24"),
        item("PM10", "2026-09-25"),
    ];
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
        "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}}),
    )
    .unwrap()
}
fn town_value(snapshot: &dyn server2::domestic::kma::KmaStore) -> serde_json::Value {
    let towns = snapshot.towns().unwrap();
    serde_json::from_slice::<serde_json::Value>(&towns.to_bytes()).unwrap()[0].clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_snapshot_answers_the_air_store_calls_it_loaded() {
    let _serial = SERIAL.lock().await;
    use super::source_s3::{NOW, request, seed};
    use server2::domestic::kma::backend::{KmaSource, SourceAnswer, parse_path};
    use server2::domestic::kma::source::S3Source;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed(&store, &[]).await;
    let day = Period {
        local_date: 20260923,
        slot: "0000".into(),
    };
    publish(
        &store,
        "airkorea-station-list",
        "stations",
        day,
        "20260923",
        NOW - 86_400_000.,
        &[station_page()],
    )
    .await;
    let hour = Publication::new(20260924, 1000).unwrap();
    let rows = [
        ("중구", "2026-09-24 10:00", "21"),
        ("종로구", "2026-09-24 10:00", "-"),
        ("용산구", "2026-09-24 09:00", "35"),
    ];
    publish(
        &store,
        "airkorea-station",
        "sido-nationwide",
        hour.period(),
        &hour.partition(),
        NOW - 30. * 60_000.,
        &[nationwide_page(&rows)],
    )
    .await;
    let search = Period {
        local_date: 20260924,
        slot: "0500".into(),
    };
    publish(
        &store,
        "airkorea-dust-forecast",
        "dust-forecast",
        search,
        "20260924",
        NOW - 4. * 3_600_000.,
        &[dust_page()],
    )
    .await;
    let observation = Observation {
        provider: "aqicn".into(),
        station_based: false,
        observed_at: Some("2026-09-24T01:00:00Z".into()),
        pollutants: vec![("pm10", 11.)],
        attribution: server2::world::js::Val::Undef,
        station_name: None,
        station_geo: None,
    };
    let s3 = S3Source::new(
        transport.clone(),
        Arc::new(|| NOW),
        Arc::new(super::source_s3::Unreachable),
        Arc::new(super::source_s3::Unreachable),
    )
    .unwrap()
    .with_air(None, Some(Arc::new(FixedAir(observation.clone()))));
    let path = format!("{}?airForecastSource=airkorea", request().original_url);
    let snapshot = match s3
        .snapshot(&parse_path(&path, "ko").unwrap(), deadline())
        .await
    {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("forwarded: {r}"),
    };
    let town = town_value(snapshot.as_ref());
    let g = &town["gCoord"];
    let mut stations = Stations::default();
    stations.apply(
        &serde_json::from_slice::<serde_json::Value>(&station_page()).unwrap()["response"]["body"]
            ["items"]
            .as_array()
            .unwrap()
            .clone(),
    );
    let mut obs = Observations::default();
    obs.apply(
        &serde_json::from_slice::<serde_json::Value>(&nationwide_page(&rows)).unwrap()["response"]
            ["body"]["items"]
            .as_array()
            .unwrap()
            .clone(),
    );
    let expected = arpltn_answer(
        &stations,
        &obs,
        Some((g["lat"].as_f64().unwrap(), g["lon"].as_f64().unwrap())),
        NOW,
    )
    .unwrap();
    let got = snapshot.arpltn(&town, NOW).unwrap();
    same(&got, &expected, "arpltn");
    assert_eq!(items_of(got.get("stnList").unwrap()).len(), 3);
    let dust = snapshot
        .dust_forecast("서울특별시", "종로구", "20260924")
        .unwrap();
    same(
        &dust,
        &OrderedJson::parse(r#"[{"date":"20260924","dustForecast":{"sido":"서울","PM10Grade":1,"PM10Str":"보통","PM25Grade":1,"PM25Str":"보통"}},{"date":"20260925","dustForecast":{"sido":"서울","PM10Grade":1,"PM10Str":"보통"}}]"#.as_bytes()).unwrap(),
        "dust forecast",
    );
    // `airForecastSource[]=airkorea` (S15b-4b-1 R11): legacy's strict comparisons neither load
    // nor read a forecast, so the answer keeps the observation without a forecast, exactly as
    // for an unknown source; never a dependency failure.
    {
        use server2::domestic::kma::backend::KmaBackend;
        use server2::gateway::BackendHandler;
        use server2::gateway::backend::Native;
        let backend = KmaBackend::new(
            Arc::new(s3),
            Arc::new(|| NOW),
            server2::domestic::kma::AssemblyConfig::default(),
        );
        let mut bodies = Vec::new();
        for query in ["airForecastSource[]=airkorea", "airForecastSource=bogus"] {
            let path = format!("{}?{query}", request().original_url);
            match backend
                .fetch_or_forward(path, "ko".into(), deadline())
                .await
            {
                Ok(Native::Served(json)) => {
                    bodies.push(String::from_utf8(json.to_bytes()).unwrap())
                }
                other => panic!("{query}: {:?}", other.map(|n| matches!(n, Native::Forward))),
            }
        }
        let array: serde_json::Value = serde_json::from_str(&bodies[0]).unwrap();
        assert!(
            array["airInfoList"][0]["last"]["pm10Value"].is_number(),
            "{array}"
        );
        assert_eq!(bodies[0], bodies[1]);
    }
    // A request without AirKorea data: the fallback observation is loaded for the town.
    let empty = Peer::new();
    let empty_transport = empty.transport();
    let empty_store = CatalogStore::new(empty_transport.clone(), CatalogLimits::default()).unwrap();
    seed(&empty_store, &[]).await;
    let s3 = S3Source::new(
        empty_transport,
        Arc::new(|| NOW),
        Arc::new(super::source_s3::Unreachable),
        Arc::new(super::source_s3::Unreachable),
    )
    .unwrap()
    .with_air(None, Some(Arc::new(FixedAir(observation))));
    let snapshot = match s3.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("forwarded: {r}"),
    };
    let town = town_value(snapshot.as_ref());
    same(
        &snapshot.arpltn(&town, NOW).unwrap(),
        &OrderedJson::parse(br#"{"stnList":[]}"#).unwrap(),
        "no stations",
    );
    same(
        &snapshot.air_fallback(&town["gCoord"], NOW).unwrap(),
        &OrderedJson::parse(br#"{"source":"aqicn","dataTime":"2026-09-24 10:00","pm10Value":11}"#)
            .unwrap(),
        "fallback",
    );
    // No `airForecastSource`: legacy defaults it to `airkorea`, so the forecast is loaded too
    // (here the legacy error for an empty collection), never a forward.
    assert_eq!(
        snapshot
            .dust_forecast("서울특별시", "종로구", "20260924")
            .unwrap_err()
            .0,
        r#"Fail to find dust forecast {"informData":{"$gte":"2026-09-24"}}"#
    );
    assert_eq!(transport.available(), TEST_PERMITS);
}

#[test]
fn the_forecast_source_follows_legacy_query_defaults() {
    use server2::domestic::kma::source::air_input::airkorea_forecast_requested;
    let q = |pairs: &[(&str, &str)]| -> String {
        pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&")
    };
    let wanted = |query: &String| {
        let request = server2::domestic::kma::backend::parse_path(
            &format!("/v000903/kma/addr/a?{query}"),
            "ko",
        )
        .unwrap();
        airkorea_forecast_requested(&server2::domestic::kma::validated_query(&request))
    };
    assert!(wanted(&q(&[])), "absent: default airkorea");
    assert!(
        wanted(&q(&[("airForecastSource", "(null)")])),
        "(null): default"
    );
    assert!(wanted(&q(&[("airForecastSource", "airkorea")])));
    assert!(
        !wanted(&q(&[("airForecastSource", "kaq")])),
        "the app's value"
    );
    assert!(!wanted(&q(&[("airForecastSource", "")])));
    assert!(
        !wanted(&q(&[
            ("airForecastSource", "airkorea"),
            ("airForecastSource", "airkorea")
        ])),
        "a repeated key is an array"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rows_without_a_data_time_never_reject_a_nationwide_page() {
    let _serial = SERIAL.lock().await;
    for (shape, expected_ago) in [(2usize, 0.), (3, 0.)] {
        let peer = Peer::new();
        let store =
            Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
        let stub = stub().await;
        stub.state.two_pages.store(shape, Ordering::SeqCst);
        let acquire = live(&peer, store.clone(), &stub.base);
        let hour = kst(now_ms() - expected_ago * 3_600_000.).hour_start();
        assert_eq!(
            acquire.acquire(AirKoreaRequest::nationwide()).await,
            Ok(Some(hour.period())),
            "shape {shape}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_attempt_may_take_longer_than_three_seconds() {
    let _serial = SERIAL.lock().await;
    // Legacy allows 5 s per AirKorea attempt; the owned acquisition has no request deadline.
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    stub.state.delay_ms.store(4_000, Ordering::SeqCst);
    let acquire = live(&peer, store.clone(), &stub.base);
    let hour = kst(now_ms()).hour_start();
    assert_eq!(
        acquire.acquire(AirKoreaRequest::nationwide()).await,
        Ok(Some(hour.period()))
    );
    assert_eq!(
        stub.state.nationwide.load(Ordering::SeqCst),
        1,
        "one attempt"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_failed_refresh_answers_with_the_last_successful_fold() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let stub = stub().await;
    let inputs = AirInputs::new(transport.clone(), store.clone()).with_acquire(Some(live(
        &peer,
        store.clone(),
        &stub.base,
    )));
    let seoul = town(37.5657, 126.9769);
    let deadline3 = || Instant::now() + Duration::from_secs(3);
    let warm = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            now_ms(),
            deadline3(),
        )
        .await;
    let warm = warm.arpltn.unwrap();
    assert!(warm.get("arpltn").is_some());
    // S3 listings now fail. A request of a later hour acquires that hour (publication does not
    // list), which also invalidates the memory; its refresh then fails.
    reqwest::Client::new()
        .post(format!("{}__catalog?mode=bad-list&key=x", peer.endpoint()))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    let later = now_ms() + 3_600_000.;
    let _ = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            later,
            deadline3(),
        )
        .await;
    // The next request's refresh fails as well: it answers with the last successful folds.
    let answer = inputs
        .load(
            &seoul,
            "서울특별시",
            "중구",
            false,
            false,
            later,
            deadline3(),
        )
        .await;
    let arpltn = answer.arpltn.expect("last successful fold");
    assert_eq!(items_of(arpltn.get("stnList").unwrap()).len(), 3);
    assert!(arpltn.get("arpltn").is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_station_list_of_an_earlier_day_refolds_like_a_cold_reader() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let list = |names: &[(&str, f64, f64)]| -> Vec<u8> {
        let items: Vec<serde_json::Value> = names
            .iter()
            .map(|(n, lat, lon)| {
                json!({"stationName": n, "dmX": lat.to_string(), "dmY": lon.to_string(),
                       "addr": "서울", "item": "PM10", "mangName": "도시대기", "year": "2000"})
            })
            .collect();
        serde_json::to_vec(&json!({"response": {"header": {"resultCode": "00"},
            "body": {"totalCount": items.len(), "items": items, "pageNo": 1, "numOfRows": 100}}}))
        .unwrap()
    };
    let day = |d: u32| Period {
        local_date: d,
        slot: "0000".into(),
    };
    let now = 1_791_955_500_000.; // 2026-10-14 14:25 KST
    // List B of 10-14 is folded first.
    publish(
        &store,
        "airkorea-station-list",
        "stations",
        day(20261014),
        "20261014",
        now - 3_600_000.,
        &[list(&[
            ("중구", 37.564, 126.975),
            ("종로구", 37.572, 127.005),
        ])],
    )
    .await;
    let warm = AirInputs::new(transport.clone(), store.clone());
    assert_eq!(
        warm.stations(now, deadline()).await.unwrap().docs().len(),
        2
    );
    // List A was fetched on 10-13 before midnight but published only now; it has a station
    // that list B lacks.
    publish(
        &store,
        "airkorea-station-list",
        "stations",
        day(20261013),
        "20261013",
        now - 15. * 3_600_000.,
        &[list(&[
            ("용산구", 37.540, 127.004),
            ("중구", 37.564, 126.975),
        ])],
    )
    .await;
    let refreshed = warm
        .refresh_stations(now, deadline())
        .await
        .unwrap()
        .unwrap();
    let cold = AirInputs::new(transport.clone(), store.clone())
        .stations(now, deadline())
        .await
        .unwrap();
    let json = |s: &Stations| OrderedJson::Array(s.docs().iter().map(|d| d.json()).collect());
    same(
        &json(&refreshed),
        &json(&cold),
        "warm refold equals the cold fold",
    );
    assert_eq!(cold.docs().len(), 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_forecast_run_keeps_the_announcement_chosen_before_the_call() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let page = |announce: &str, date: &str| -> Vec<u8> {
        let items = vec![
            json!({"dataTime": announce, "informCode": "PM10", "informData": date,
            "informGrade": "서울 : 나쁨,인천 : 좋음", "informCause": "c", "informOverall": "o",
            "actionKnack": null}),
        ];
        serde_json::to_vec(&json!({"response": {"header": {"resultCode": "00"},
            "body": {"totalCount": 1, "items": items, "pageNo": 1, "numOfRows": 100}}}))
        .unwrap()
    };
    let kst_ms = |date: u32, time: u16| {
        server2::history::schedule::to_ms(Publication::new(date, time).unwrap()) as f64
    };
    // Started before 11:00 (the 05시 announcement expected), completed at 11:00:30.
    publish(
        &store,
        "airkorea-dust-forecast",
        "dust-forecast",
        Publication::new(20261014, 500).unwrap().period(),
        "20261014",
        kst_ms(20261014, 1100) + 30_000.,
        &[page("2026-10-14 05시 발표", "2026-10-14")],
    )
    .await;
    // Started at 04:59 on 10-15 (the 10-14 23시 announcement), completed at 05:00:20.
    publish(
        &store,
        "airkorea-dust-forecast",
        "dust-forecast",
        Publication::new(20261014, 2300).unwrap().period(),
        "20261014",
        kst_ms(20261015, 500) + 20_000.,
        &[page("2026-10-14 23시 발표", "2026-10-15")],
    )
    .await;
    let now = kst_ms(20261015, 600);
    let answer = AirInputs::new(transport.clone(), store.clone())
        .load(
            &town(37.57, 126.98),
            "서울특별시",
            "종로구",
            true,
            false,
            now,
            deadline(),
        )
        .await;
    let (_, forecast) = answer.dust.unwrap();
    same(
        &forecast.unwrap(),
        &OrderedJson::parse(r#"[{"date":"20261015","dustForecast":{"sido":"서울","PM10Grade":2,"PM10Str":"나쁨"}}]"#.as_bytes()).unwrap(),
        "the 23시 run of 10-14 is applied",
    );
    let answer = AirInputs::new(transport.clone(), store.clone())
        .load(
            &town(37.57, 126.98),
            "서울특별시",
            "종로구",
            true,
            false,
            kst_ms(20261014, 1200),
            deadline(),
        )
        .await;
    let (_, forecast) = answer.dust.unwrap();
    same(
        &forecast.unwrap(),
        &OrderedJson::parse(r#"[{"date":"20261014","dustForecast":{"sido":"서울","PM10Grade":2,"PM10Str":"나쁨"}}]"#.as_bytes()).unwrap(),
        "the 05시 run completed after 11:00 is applied",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_forecast_refresh_answers_with_the_last_successful_fold() {
    let _serial = SERIAL.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    seed_oracle(&store).await;
    let now = 1_791_988_320_000. + 60_000.;
    let inputs = AirInputs::new(transport.clone(), store.clone());
    let first = inputs
        .load(
            &town(37.57, 126.98),
            "서울특별시",
            "종로구",
            true,
            false,
            now,
            deadline(),
        )
        .await;
    let first = first.dust.unwrap().1.unwrap();
    reqwest::Client::new()
        .post(format!("{}__catalog?mode=bad-list&key=x", peer.endpoint()))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    let again = inputs
        .load(
            &town(37.57, 126.98),
            "서울특별시",
            "종로구",
            true,
            false,
            now,
            deadline(),
        )
        .await;
    same(
        &again.dust.unwrap().1.unwrap(),
        &first,
        "the last successful forecast fold",
    );
    // A new reader without a successful fold gets the error (legacy: no forecast).
    let cold = AirInputs::new(transport.clone(), store.clone())
        .load(
            &town(37.57, 126.98),
            "서울특별시",
            "종로구",
            true,
            false,
            now,
            deadline(),
        )
        .await;
    assert!(cold.dust.unwrap().1.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cpu_work_never_holds_a_request_past_its_deadline() {
    use server2::domestic::kma::source::air_input::cpu_task;
    let admission = Arc::new(tokio::sync::Semaphore::new(2));
    let started = std::time::Instant::now();
    let finished = Arc::new(AtomicUsize::new(0));
    let done = finished.clone();
    // A synchronous computation of 600 ms; the request waits only 100 ms for it.
    let outcome = tokio::time::timeout(
        Duration::from_millis(100),
        cpu_task(&admission, move || {
            let end = std::time::Instant::now() + Duration::from_millis(600);
            while std::time::Instant::now() < end {
                std::hint::spin_loop();
            }
            done.store(1, Ordering::SeqCst);
        }),
    )
    .await;
    assert!(outcome.is_err(), "the deadline ends the wait");
    assert!(
        started.elapsed() < Duration::from_millis(300),
        "{:?}",
        started.elapsed()
    );
    // The worker finishes on its own and releases its admission.
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(finished.load(Ordering::SeqCst), 1);
    assert_eq!(admission.available_permits(), 2);
}

/// A TLS peer that accepts, reads the ClientHello and stays silent for `hold`; it records how long
/// each client waited before giving up (None: the client was still waiting when the peer closed).
pub async fn silent_tls(hold: Duration) -> (String, Arc<std::sync::Mutex<Vec<Option<Duration>>>>) {
    use tokio::io::AsyncReadExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("https://{}/", listener.local_addr().unwrap());
    let waits = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = waits.clone();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let seen = seen.clone();
            tokio::spawn(async move {
                let started = std::time::Instant::now();
                let mut buf = [0u8; 4096];
                let gave_up = tokio::time::timeout(hold, async {
                    loop {
                        match socket.read(&mut buf).await {
                            Ok(0) | Err(_) => return started.elapsed(),
                            Ok(_) => {}
                        }
                    }
                })
                .await
                .ok();
                seen.lock().unwrap().push(gave_up);
            });
        }
    });
    (base, waits)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_airkorea_connection_may_take_the_whole_legacy_attempt() {
    use server2::providers::{HttpProviderTransport, attempt_timeout, legacy_timeout};
    let _serial = SERIAL.lock().await;
    // Legacy starts its 5 s timer before `https.get`, so connecting (TCP and TLS) may use it; the
    // default provider transport gives a connection 3 s.
    let (base, waits) = silent_tls(Duration::from_millis(4_500)).await;
    let endpoint: reqwest::Url = format!("{base}B552584/ArpltnInforInqireSvc/x")
        .parse()
        .unwrap();
    assert_eq!(
        attempt_timeout(server2::budget::Provider::DataGoKr, &endpoint),
        legacy_timeout::AIRKOREA
    );
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let acquire = live(&peer, store, &base);
    let _ = acquire.acquire(AirKoreaRequest::nationwide()).await;
    let first = waits
        .lock()
        .unwrap()
        .first()
        .copied()
        .expect("one connection");
    assert!(
        first.is_none(),
        "the AirKorea transport still waited when the peer closed at 4.5 s: {first:?}"
    );
    // The default transport gives up at its 3 s connect bound (the contrast).
    let (base, waits) = silent_tls(Duration::from_millis(4_500)).await;
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let default = live_with(
        &peer,
        store,
        &base,
        HttpProviderTransport::new(2 << 20).unwrap(),
    );
    let _ = default.acquire(AirKoreaRequest::nationwide()).await;
    let first = waits
        .lock()
        .unwrap()
        .first()
        .copied()
        .expect("one connection");
    let gave_up = first.expect("the default transport gave up before 4.5 s");
    assert!(
        gave_up >= Duration::from_millis(2_800) && gave_up < Duration::from_millis(4_000),
        "{gave_up:?}"
    );
}
