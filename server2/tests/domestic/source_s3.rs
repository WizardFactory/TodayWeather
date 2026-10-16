//! S15b-1 SNAPSHOT: the S3 source reads published raw records from the S06 loopback S3 test peer
//! with empty memory, answers the store calls it sources with the same documents as the rebuild
//! functions, and ends the assembly with a named temporary forward for every input that is not
//! sourced yet. TEST ONLY: no provider or AWS is reached.
use super::source::{docs_json, same};
use rusty_s3::Credentials;
use serde_json::json;
use server2::domestic::kma::source::observe::{Acquire, Locate};
use server2::domestic::kma::{
    AssemblyConfig, MidModel, Outcome, TownModel, assemble,
    backend::{KmaSource, SourceAnswer, parse_path},
    source::{
        Coord, Family, Fetched, S3Source, find_town, grid_documents, mid_documents, rss_documents,
        towns, zone_documents,
    },
};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::OrderedJson;
use server2::history::Grid;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    Pagination, Period, ProviderKey, RawRecord,
};
use server2::world::BoundedS3;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::time::Instant;

/// The owned S06 loopback S3 fault peer (`tests/storage/catalog_peer.py`).
/// The domestic tests that own an S3 test peer run one at a time, so small CI runners serve one
/// peer at a time (the peer admits 16 connections and bounds each to 2 s).
pub static S3_PEERS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// S3 requests in flight per test transport: below the production 12, leaving peer slots for
/// connections whose handler thread has not released its slot yet.
pub const TEST_PERMITS: usize = 8;
/// S3 requests in flight for a test's live acquirer, which has its own transport beside the
/// inputs' (S15b3d-R1): together at most 12 reach the peer at once. With 8 more, a burst of
/// reads and publications could pass the peer's 16 connections, and a refused connection is a
/// `Transport` error that fails the acquisition (retried only after 10 minutes, so the test
/// stalled).
pub const ACQUIRER_PERMITS: usize = 4;
pub struct Peer {
    child: Child,
    endpoint: String,
}
impl Peer {
    pub fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line);
            let _ = tx.send(result.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(endpoint)) if endpoint.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: endpoint.trim().to_owned(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("peer startup failure: {other:?}");
            }
        }
    }
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub fn transport(&self) -> BoundedS3<HttpS3Transport> {
        self.transport_limited(TEST_PERMITS)
    }
    /// A transport admitting at most `limit` requests at once (tests that run many reads
    /// concurrently stay well below the peer's connection limit on CI runners).
    pub fn transport_limited(&self, limit: usize) -> BoundedS3<HttpS3Transport> {
        BoundedS3::new(
            HttpS3Transport::new(
                &self.endpoint,
                "server2-local",
                "ap-northeast-2",
                Credentials::new("server2-local", "server2-local-secret"),
            )
            .unwrap(),
            limit,
        )
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(20)
}
const HOUR: f64 = 3_600_000.;
/// 2026-09-24 10:50 KST.
pub const NOW: f64 = 1_790_214_600_000.;
fn kst_ms(date: u32, time: u16) -> f64 {
    server2::history::schedule::to_ms(Publication::new(date, time).unwrap()) as f64
}

/// Publish one acquisition (pages in order) as S13/S13b record groups are published.
#[allow(clippy::too_many_arguments)]
async fn publish(
    store: &CatalogStore<BoundedS3<HttpS3Transport>>,
    source: &str,
    kind: &str,
    key: &ProviderKey,
    period: Period,
    partition: &str,
    fetched_at: f64,
    pages: &[Vec<u8>],
    content_type: &str,
) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let record = RawRecord::new(
            source,
            kind,
            key,
            period.clone(),
            fetched_at as u64,
            200,
            content_type,
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
fn envelope(items: Vec<serde_json::Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": items.len()}}}))
    .unwrap()
}
fn current_page(date: &str, time: &str, t1h: &str) -> Vec<u8> {
    let values = [
        ("PTY", "0"),
        ("REH", "60"),
        ("RN1", "0"),
        ("T1H", t1h),
        ("UUU", "1.2"),
        ("VEC", "200"),
        ("VVV", "-0.5"),
        ("WSD", "2.1"),
    ];
    envelope(
        values
            .iter()
            .map(|(c, v)| {
                json!({"baseDate": date, "baseTime": time, "category": c, "nx": 60, "ny": 127,
                       "obsrValue": v})
            })
            .collect(),
    )
}
/// (date, HH00) slots `hours` after `start` (KST wall clock).
fn slots(start_date: u32, start_time: u16, hours: &[i64]) -> Vec<(String, String)> {
    let base = Publication::new(start_date, start_time).unwrap();
    hours
        .iter()
        .map(|h| {
            let p = base.add_hours(*h).unwrap();
            (format!("{:08}", p.date()), format!("{:04}", p.time()))
        })
        .collect()
}
/// Category values of one forecast slot (date, time).
type Values = dyn Fn(&str, &str) -> Vec<(&'static str, String)>;
fn forecast_items(
    base: (&str, &str),
    at: &[(String, String)],
    values: &Values,
) -> Vec<serde_json::Value> {
    let mut items = Vec::new();
    for (date, time) in at {
        for (c, v) in values(date, time) {
            items.push(
                json!({"baseDate": base.0, "baseTime": base.1, "category": c,
                "fcstDate": date, "fcstTime": time, "fcstValue": v, "nx": 60, "ny": 127}),
            );
        }
    }
    items
}
fn shortest_page() -> Vec<u8> {
    let at = slots(20260924, 1000, &[1, 2, 3, 4, 5, 6]);
    envelope(forecast_items(("20260924", "1030"), &at, &|_, time| {
        let t = (18 + time[..2].parse::<u32>().unwrap() % 5).to_string();
        vec![
            ("LGT", "0".into()),
            ("PTY", "0".into()),
            ("RN1", "강수없음".into()),
            ("SKY", "3".into()),
            ("T1H", t),
            ("REH", "65".into()),
            ("UUU", "0.4".into()),
            ("VVV", "-1.1".into()),
            ("VEC", "250".into()),
            ("WSD", "3".into()),
            ("POP", "20".into()),
        ]
    }))
}
fn short_page() -> Vec<u8> {
    // Base 0800: hourly to the third midnight, then three-hourly for one day.
    let mut hours: Vec<i64> = (1..=63).collect();
    hours.extend((0..8).map(|i| 64 + i * 3));
    let at = slots(20260924, 800, &hours);
    envelope(forecast_items(("20260924", "0800"), &at, &|date, time| {
        let mut v: Vec<(&'static str, String)> = vec![
            ("TMP", "17".into()),
            ("UUU", "1.1".into()),
            ("VVV", "-0.4".into()),
            ("VEC", "180".into()),
            ("WSD", "2.5".into()),
            ("SKY", "1".into()),
            ("PTY", "0".into()),
            ("POP", "10".into()),
            ("PCP", "강수없음".into()),
            ("REH", "70".into()),
            ("SNO", "적설없음".into()),
        ];
        if time == "0600" && date != "20260924" {
            v.push(("TMN", "12".into()));
        }
        if time == "1500" {
            v.push(("TMX", "24".into()));
        }
        v
    }))
}
/// A `queryDFS.jsp` document (one line; raw literals keep the placement gate's plain-text rule).
fn rss_xml() -> Vec<u8> {
    let mut rows = String::new();
    for i in 0..8 {
        let h = 12 + i * 3;
        rows.push_str(&format!(
            r#"<data seq="{i}"><hour>{}</hour><day>{}</day><temp>{}.0</temp><tmx>-999.0</tmx><tmn>-999.0</tmn><sky>1</sky><pty>0</pty><wfKor>맑음</wfKor><wfEn>Clear</wfEn><pop>0</pop><r12>0.0</r12><s12>0.0</s12><ws>1.8</ws><wd>6</wd><wdKor>서</wdKor><wdEn>W</wdEn><reh>55</reh><r06>0.0</r06><s06>0.0</s06></data>"#,
            h % 24,
            h / 24,
            15 + i
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" ?><wid><header><tm>202609240800</tm><ts>3</ts><x>60</x><y>127</y></header><body>{rows}</body></wid>"#
    )
    .into_bytes()
}
fn mid_page(items: Vec<serde_json::Value>) -> Vec<u8> {
    envelope(items)
}
fn land_item() -> serde_json::Value {
    let mut o = serde_json::Map::new();
    o.insert("regId".into(), json!("11B00000"));
    for d in 3..=10 {
        let halves: &[&str] = if d <= 7 { &["Am", "Pm"] } else { &[""] };
        for h in halves {
            o.insert(format!("rnSt{d}{h}"), json!(20));
            o.insert(format!("wf{d}{h}"), json!("구름많음"));
        }
    }
    serde_json::Value::Object(o)
}
fn temp_item() -> serde_json::Value {
    let mut o = serde_json::Map::new();
    o.insert("regId".into(), json!("11B10101"));
    for d in 3..=10 {
        o.insert(format!("taMin{d}"), json!(12));
        o.insert(format!("taMax{d}"), json!(24));
    }
    serde_json::Value::Object(o)
}
fn zone_page() -> Vec<u8> {
    let zone = |id: &str, name: &str, sp: &str| {
        json!({"regId": id, "tmSt": "201601010000", "tmEd": "210012310000", "regSp": sp,
               "regName": name, "regEn": name, "regUp": "11B10000", "lat": "37.57", "lon": "126.97"})
    };
    let items = vec![
        zone("11B10101", "서울", "C"),
        zone("11B20201", "인천", "C"),
        zone("11B00000", "서울.인천.경기도", "A"),
    ];
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": 3}}}))
    .unwrap()
}

pub struct Data {
    current: Vec<Fetched>,
    shortest: Vec<Fetched>,
    short: Vec<Fetched>,
    rss: Vec<Fetched>,
    forecast: Vec<Fetched>,
    land: Vec<Fetched>,
    temp: Vec<Fetched>,
    zones: Vec<Fetched>,
}
fn fetched(at: f64, partition: &str, page: Vec<u8>) -> Fetched {
    Fetched {
        fetched_at_ms: at as u64,
        partition: partition.into(),
        pages: vec![Arc::from(page)],
    }
}
/// Publish a complete input set at NOW, leaving out the families in `skip`.
pub async fn seed(store: &CatalogStore<BoundedS3<HttpS3Transport>>, skip: &[&str]) -> Data {
    let grid = Grid::new(60, 127).unwrap().provider_key();
    let p = |d, t| Publication::new(d, t).unwrap();
    let mut data = Data {
        current: vec![],
        shortest: vec![],
        short: vec![],
        rss: vec![],
        forecast: vec![],
        land: vec![],
        temp: vec![],
        zones: vec![],
    };
    let put = async |source: &str,
                     kind: &str,
                     key: &ProviderKey,
                     publication: Publication,
                     at: f64,
                     page: Vec<u8>,
                     ct: &str|
           -> Fetched {
        publish(
            store,
            source,
            kind,
            key,
            publication.period(),
            &publication.partition(),
            at,
            std::slice::from_ref(&page),
            ct,
        )
        .await;
        fetched(at, &publication.partition(), page)
    };
    let json_ct = "application/json";
    if !skip.contains(&"current") {
        for (t, t1h) in [(900u16, "20.5"), (1000, "21.5")] {
            let f = put(
                "data-go-kr",
                "ultra-srt-ncst",
                &grid,
                p(20260924, t),
                kst_ms(20260924, t) + 40. * 60_000.,
                current_page("20260924", &format!("{t:04}"), t1h),
                json_ct,
            )
            .await;
            data.current.push(f);
        }
    }
    if !skip.contains(&"shortest") {
        let f = put(
            "data-go-kr",
            "ultra-srt-fcst",
            &grid,
            p(20260924, 1000),
            kst_ms(20260924, 1045),
            shortest_page(),
            json_ct,
        )
        .await;
        data.shortest.push(f);
    }
    if !skip.contains(&"short") {
        let f = put(
            "data-go-kr",
            "vilage-fcst",
            &grid,
            p(20260924, 800),
            kst_ms(20260924, 812),
            short_page(),
            json_ct,
        )
        .await;
        data.short.push(f);
    }
    if !skip.contains(&"rss") {
        let f = put(
            "kma-web",
            "town-rss",
            &grid,
            p(20260924, 800),
            kst_ms(20260924, 1002),
            rss_xml(),
            "application/xml",
        )
        .await;
        data.rss.push(f);
    }
    if !skip.contains(&"mid") {
        let tmfc = p(20260924, 600);
        let named = |id: &str| ProviderKey::Named { id: id.into() };
        data.forecast.push(
            put(
                "data-go-kr",
                "mid-fcst",
                &named("stn-109"),
                tmfc,
                kst_ms(20260924, 802),
                mid_page(vec![json!({"wfSv": "맑겠습니다."})]),
                json_ct,
            )
            .await,
        );
        data.land.push(
            put(
                "data-go-kr",
                "mid-land-fcst",
                &named("reg-11b00000"),
                tmfc,
                kst_ms(20260924, 802),
                mid_page(vec![land_item()]),
                json_ct,
            )
            .await,
        );
        data.temp.push(
            put(
                "data-go-kr",
                "mid-ta",
                &named("reg-11b10101"),
                tmfc,
                kst_ms(20260924, 802),
                mid_page(vec![temp_item()]),
                json_ct,
            )
            .await,
        );
    }
    if !skip.contains(&"zone") {
        let at = NOW - 2. * HOUR;
        let page = zone_page();
        publish(
            store,
            "data-go-kr",
            "forecast-zone",
            &ProviderKey::Named {
                id: "forecast-zones".into(),
            },
            Period {
                local_date: 20260924,
                slot: "0000".into(),
            },
            "20260924",
            at,
            std::slice::from_ref(&page),
            json_ct,
        )
        .await;
        data.zones.push(fetched(at, "20260924", page));
    }
    data
}
pub fn request() -> server2::domestic::kma::KmaRequest {
    parse_path(
        "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99",
        "ko",
    )
    .unwrap()
}
fn source(peer: &Peer) -> S3Source<BoundedS3<HttpS3Transport>> {
    // The source also starts its station loads (S15b-2): stay well below the Python S3 peer's
    // connection limit, which drops connections under concurrency on Linux CI runners.
    S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
}
/// Request-time acquisition and geocoding doubles that never reach a provider.
pub struct Unreachable;
impl Acquire for Unreachable {
    fn web(
        &self,
        _: server2::domestic::family::WebRequest,
        _: Instant,
    ) -> server2::gateway::BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(
        &self,
        _: server2::domestic::asos::AsosRequest,
        _: Instant,
    ) -> server2::gateway::BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
}
impl Locate for Unreachable {
    fn locate(&self, _: String) -> server2::gateway::BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { None })
    }
}
const SEOUL: Coord = Coord { mx: 60., my: 127. };

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_answers_sourced_calls_from_s3_raw_records() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let transport = peer.transport();
    let store = CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap();
    let data = seed(&store, &[]).await;
    let s3 = source(&peer);
    let snapshot = match s3.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(reason) => panic!("forwarded: {reason}"),
    };
    assert_eq!(snapshot.as_of_ms(), Some(NOW));
    let town = find_town(
        towns(),
        Some("서울특별시"),
        Some("종로구"),
        Some("청운효자동"),
    )
    .unwrap();
    same(
        &snapshot.towns().unwrap(),
        &docs_json(std::slice::from_ref(town)),
        "towns",
    );
    let (mx, my) = (json!(60), json!(127));
    for (model, family, input) in [
        (TownModel::Current, Family::Current, &data.current),
        (TownModel::Shortest, Family::Shortest, &data.shortest),
        (TownModel::Short, Family::Short, &data.short),
    ] {
        let expected = grid_documents(family, SEOUL, input, NOW);
        assert!(!expected.is_empty(), "{model:?} documents");
        same(
            &snapshot.town_model(model, &mx, &my).unwrap(),
            &docs_json(&expected),
            &format!("{model:?}"),
        );
    }
    let rss = rss_documents(SEOUL, &data.rss, NOW);
    assert_eq!(rss.len(), 8);
    same(
        &snapshot.town_model(TownModel::ShortRss, &mx, &my).unwrap(),
        &docs_json(&rss),
        "rss",
    );
    for (model, id, input) in [
        (MidModel::Forecast, "109", &data.forecast),
        (MidModel::Land, "11B00000", &data.land),
        (MidModel::Temp, "11B10101", &data.temp),
    ] {
        let expected = mid_documents(model, id, input, NOW);
        assert_eq!(expected.len(), 1, "{model:?}");
        same(
            &snapshot.mid_model(model, &json!(id)).unwrap(),
            &docs_json(&expected),
            &format!("{model:?}"),
        );
    }
    let zones = zone_documents(&data.zones, NOW).unwrap();
    same(
        &snapshot.forecast_zone("서울특별시", "종로구").unwrap(),
        &docs_json(&zones.find_by_name("서울특별시", "종로구")),
        "forecast zone",
    );
    let region = snapshot.region_code("서울특별시", "종로구").unwrap();
    assert_eq!(
        region
            .get("cityCode")
            .and_then(OrderedJson::string)
            .as_deref(),
        Some("11B10101")
    );
    same(
        &snapshot.special_zones(&["L1100100".into()]).unwrap(),
        &OrderedJson::Array(vec![]),
        "no warning records: no active zones",
    );
    assert_eq!(
        transport.available(),
        TEST_PERMITS,
        "every S3 permit returned"
    );
    // Station and ASOS inputs (S15b-2) and the air and life inputs (S15b-3a/3b) are sourced,
    // here over empty collections: the assembly answers natively (no AirKorea station, so the
    // image forecasts of S15b-3c are not asked).
    let outcome = assemble(
        &request(),
        snapshot.as_ref(),
        NOW,
        AssemblyConfig::default(),
    );
    match outcome {
        Outcome::Json(body) => {
            for key in ["regionName", "cityName", "townName", "short", "midData"] {
                assert!(body.get(key).is_some(), "{key}");
            }
        }
        Outcome::Legacy(reason) => panic!("forwarded: {reason}"),
        other => panic!("unexpected: {:?}", std::mem::discriminant(&other)),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_inputs_are_acquired_at_request_time_and_never_forwarded() {
    use server2::domestic::family::DataGoKrFamily;
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    /// Serves the 10:00 current publication (publishing it like S13 + S06); every other
    /// acquisition answers "nothing new". Every request is logged.
    struct Provider {
        store: Arc<CatalogStore<BoundedS3<HttpS3Transport>>>,
        log: std::sync::Mutex<Vec<String>>,
    }
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> server2::gateway::BoxFuture<'static, Result<Published, String>> {
            let label = match &request {
                ForecastRequest::DataGoKr(r) => {
                    format!("{} {}", r.family().kind(), r.publication().partition())
                }
                ForecastRequest::Rss(_) => "town-rss".into(),
                ForecastRequest::Zones => "zones".into(),
                ForecastRequest::Warnings => "warnings".into(),
            };
            self.log.lock().unwrap().push(label);
            let store = self.store.clone();
            Box::pin(async move {
                let ForecastRequest::DataGoKr(r) = request else {
                    return Ok(None);
                };
                if r.family() != DataGoKrFamily::UltraSrtNcst {
                    return Ok(None);
                }
                let limits = CatalogLimits::default();
                let p = r.publication();
                let record = RawRecord::new(
                    "data-go-kr",
                    "ultra-srt-ncst",
                    &Grid::new(60, 127).unwrap().provider_key(),
                    p.period(),
                    kst_ms(20260924, 1040) as u64,
                    200,
                    "application/json",
                    Some(Pagination {
                        page: 1,
                        pages: 1,
                        complete: true,
                    }),
                    current_page("20260924", "1000", "21.5").into(),
                    &limits.raw,
                )
                .unwrap();
                let member = GroupMember {
                    envelope: record.envelope.clone(),
                    catalogs: vec![
                        CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap(),
                    ],
                };
                store
                    .publish(
                        GroupDeclaration::new(vec![member], &limits).unwrap(),
                        vec![record.clone()],
                        deadline(),
                    )
                    .await
                    .unwrap();
                Ok(Some(vec![record]))
            })
        }
    }
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    seed(
        &store,
        &["current", "shortest", "short", "rss", "mid", "zone"],
    )
    .await;
    let provider = Arc::new(Provider {
        store: store.clone(),
        log: std::sync::Mutex::new(Vec::new()),
    });
    let s3 = source(&peer).with_forecast(Some(provider.clone()));
    let snapshot = match s3.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(reason) => panic!("forwarded: {reason}"),
    };
    // The acquired 10:00 current publication is used by the same request.
    let current = snapshot
        .town_model(TownModel::Current, &json!(60), &json!(127))
        .unwrap();
    let text = String::from_utf8(current.to_bytes()).unwrap();
    assert!(text.contains("21.5"), "{text}");
    // Nothing else is stored: legacy's answers for empty collections.
    for model in [TownModel::Shortest, TownModel::Short, TownModel::ShortRss] {
        assert_eq!(
            snapshot
                .town_model(model, &json!(60), &json!(127))
                .unwrap()
                .to_bytes(),
            b"[]"
        );
    }
    assert_eq!(
        snapshot
            .forecast_zone("서울특별시", "종로구")
            .unwrap()
            .to_bytes(),
        b"[]"
    );
    let log = provider.log.lock().unwrap().clone();
    for wanted in [
        "ultra-srt-ncst 20260924-1000",
        "ultra-srt-fcst 20260924-1030",
        "vilage-fcst 20260924-0800",
        "town-rss",
        "zones",
        "warnings",
        "mid-fcst 20260924-0600",
        "mid-land-fcst 20260924-0600",
    ] {
        assert!(log.iter().any(|l| l == wanted), "{wanted}: {log:?}");
    }
    // The assembly answers without a legacy forward.
    let outcome = assemble(
        &request(),
        snapshot.as_ref(),
        NOW,
        AssemblyConfig::default(),
    );
    assert!(!matches!(outcome, Outcome::Legacy(_)), "forwarded");
    // A second request does not repeat the acquisitions (retry bounds), and the backfill pass
    // asked for the earlier current hours once.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = s3.snapshot(&request(), deadline()).await;
    let log = provider.log.lock().unwrap().clone();
    let count = |w: &str| log.iter().filter(|l| *l == w).count();
    assert_eq!(count("ultra-srt-ncst 20260924-1000"), 1, "{log:?}");
    assert_eq!(count("zones"), 1, "{log:?}");
    assert_eq!(count("ultra-srt-ncst 20260924-0900"), 1, "{log:?}");
    assert_eq!(
        log.iter()
            .filter(|l| l.starts_with("ultra-srt-ncst "))
            .count(),
        24,
        "latest + 23 backfill hours: {log:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_waits_for_late_acquisitions_once_within_three_seconds() {
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    /// Every acquisition takes 6 s and then has nothing new.
    struct Slow;
    impl ForecastAcquire for Slow {
        fn acquire(
            &self,
            _: ForecastRequest,
        ) -> server2::gateway::BoxFuture<'static, Result<Published, String>> {
            Box::pin(async {
                tokio::time::sleep(Duration::from_secs(6)).await;
                Ok(None)
            })
        }
    }
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let s3 = source(&peer).with_forecast(Some(Arc::new(Slow)));
    let started = Instant::now();
    // The grid, RSS, three mid and warning waits share one 3-second bound instead of adding up.
    let snapshot = match s3.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(reason) => panic!("forwarded: {reason}"),
    };
    let waited = started.elapsed();
    assert!(waited < Duration::from_millis(4500), "waited {waited:?}");
    // The late sections are legacy's answers for absent data.
    assert_eq!(
        snapshot
            .town_model(TownModel::Current, &json!(60), &json!(127))
            .unwrap()
            .to_bytes(),
        b"[]"
    );
}

/// Every forecast, life and AirKorea acquisition takes 6 s and then fails.
struct SlowEverything;
impl server2::domestic::kma::source::fetch::ForecastAcquire for SlowEverything {
    fn acquire(
        &self,
        _: server2::domestic::kma::source::fetch::ForecastRequest,
    ) -> server2::gateway::BoxFuture<
        'static,
        Result<server2::domestic::kma::source::fetch::Published, String>,
    > {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(6)).await;
            Err("slow".into())
        })
    }
}
impl server2::domestic::kma::source::life_live::LifeAcquire for SlowEverything {
    fn acquire(
        &self,
        _: server2::domestic::kma::source::life_live::LifeRequest,
    ) -> server2::gateway::BoxFuture<
        'static,
        Result<server2::domestic::kma::source::life_live::LifeOutcome, String>,
    > {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(6)).await;
            Err("slow".into())
        })
    }
}
impl server2::domestic::kma::source::live::AirKoreaAcquire for SlowEverything {
    fn acquire(
        &self,
        _: server2::domestic::airkorea::AirKoreaRequest,
    ) -> server2::gateway::BoxFuture<'static, Result<Option<Period>, String>> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(6)).await;
            Err("slow".into())
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_answers_within_the_gateway_attempt_while_every_acquisition_is_slow() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let slow = Arc::new(SlowEverything);
    let s3 = source(&peer)
        .with_forecast(Some(slow.clone()))
        .with_life(Some(slow.clone()))
        .with_air(Some(slow), None);
    // The gateway's native attempt (`gateway::backend`: at most 3 s): forecast, mid, warning,
    // station, air and life waits all end before it, leaving time for the assembly.
    let started = Instant::now();
    let attempt = started + Duration::from_secs(3);
    let snapshot = match s3.snapshot(&request(), attempt).await {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(reason) => panic!("forwarded: {reason}"),
    };
    let waited = started.elapsed();
    assert!(waited < Duration::from_millis(2_900), "waited {waited:?}");
    let outcome = assemble(
        &request(),
        snapshot.as_ref(),
        NOW,
        AssemblyConfig::default(),
    );
    assert!(!matches!(outcome, Outcome::Legacy(_)), "forwarded");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_first_requests_share_one_acquisition_per_publication() {
    use server2::domestic::family::DataGoKrFamily;
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    /// Publishes the 10:00 current publication after 300 ms; counts every request.
    struct Provider {
        store: Arc<CatalogStore<BoundedS3<HttpS3Transport>>>,
        current: std::sync::atomic::AtomicUsize,
    }
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> server2::gateway::BoxFuture<'static, Result<Published, String>> {
            let store = self.store.clone();
            let ForecastRequest::DataGoKr(r) = request else {
                return Box::pin(async { Ok(None) });
            };
            if r.family() != DataGoKrFamily::UltraSrtNcst
                || r.publication().partition() != "20260924-1000"
            {
                return Box::pin(async { Ok(None) });
            }
            self.current
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let limits = CatalogLimits::default();
                let p = r.publication();
                let record = RawRecord::new(
                    "data-go-kr",
                    "ultra-srt-ncst",
                    &Grid::new(60, 127).unwrap().provider_key(),
                    p.period(),
                    kst_ms(20260924, 1040) as u64,
                    200,
                    "application/json",
                    Some(Pagination {
                        page: 1,
                        pages: 1,
                        complete: true,
                    }),
                    current_page("20260924", "1000", "21.5").into(),
                    &limits.raw,
                )
                .unwrap();
                let member = GroupMember {
                    envelope: record.envelope.clone(),
                    catalogs: vec![
                        CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap(),
                    ],
                };
                store
                    .publish(
                        GroupDeclaration::new(vec![member], &limits).unwrap(),
                        vec![record.clone()],
                        deadline(),
                    )
                    .await
                    .unwrap();
                Ok(Some(vec![record]))
            })
        }
    }
    let peer = Peer::new();
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    seed(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let provider = Arc::new(Provider {
        store: store.clone(),
        current: std::sync::atomic::AtomicUsize::new(0),
    });
    let s3 = Arc::new(source(&peer).with_forecast(Some(provider.clone())));
    // Six requests at once: whoever creates the flight claims the retry bound, the others join
    // that flight and get its records.
    let requests: Vec<_> = (0..6)
        .map(|_| {
            let s3 = s3.clone();
            tokio::spawn(async move {
                match s3.snapshot(&request(), deadline()).await {
                    SourceAnswer::Snapshot(s) => {
                        let current = s
                            .town_model(TownModel::Current, &json!(60), &json!(127))
                            .unwrap();
                        String::from_utf8(current.to_bytes()).unwrap()
                    }
                    SourceAnswer::Forward(reason) => panic!("forwarded: {reason}"),
                }
            })
        })
        .collect();
    for r in requests {
        let text = r.await.unwrap();
        assert!(text.contains("21.5"), "{text}");
    }
    assert_eq!(
        provider.current.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn warning_requests_rotate_through_every_key_and_keep_the_one_that_answered() {
    use axum::{Router, extract::State, http::Uri, response::IntoResponse, routing::any};
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, LiveForecast};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    /// Keys A and B are not registered; key C answers "no data". Every key used is logged.
    async fn handle(
        State(keys): State<Arc<std::sync::Mutex<Vec<char>>>>,
        uri: Uri,
    ) -> impl IntoResponse {
        let query: reqwest::Url = format!("http://127.0.0.1/?{}", uri.query().unwrap_or(""))
            .parse()
            .unwrap();
        let key = query
            .query_pairs()
            .find(|(k, _)| k == "serviceKey")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        let which = key
            .split("_KEY_")
            .nth(1)
            .and_then(|s| s.chars().next())
            .unwrap_or('?');
        keys.lock().unwrap().push(which);
        let body = if which == 'C' {
            json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}})
        } else {
            json!({"response": {"header": {"resultCode": "30",
                "resultMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}})
        };
        (
            axum::http::StatusCode::OK,
            [("content-type", "application/json")],
            body.to_string(),
        )
    }
    let keys = Arc::new(std::sync::Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap());
    let router = Router::new().fallback(any(handle)).with_state(keys.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let peer = Peer::new();
    let daily = server2::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(server2::providers::HttpProviderTransport::new(2 << 20).unwrap()),
        Arc::new(server2::providers::HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(peer.transport()),
        ["A", "B", "C"]
            .iter()
            .map(|k| format!("S15B4A_LOCAL_KEY_{k}+aaaaaaaaaaaaaaaa/="))
            .collect(),
        5000,
        server2::domestic::family::Endpoints::new(&base, &base, &base).unwrap(),
        Arc::new(server2::budget::SystemClock),
        Arc::new(server2::domestic::metrics::DomesticMetrics::default()),
    )
    .unwrap();
    let limits = CatalogLimits::default();
    let live = LiveForecast::new(
        Arc::new(daily),
        Arc::new(CatalogStore::new(peer.transport(), limits.clone()).unwrap()),
        Arc::new(
            server2::warnings::store::WarningStore::new(
                peer.transport(),
                limits,
                server2::warnings::store::StoreConfig::default(),
            )
            .unwrap(),
        ),
        &base,
    );
    let _ = live.acquire(ForecastRequest::Warnings).await;
    let used = keys.lock().unwrap().clone();
    server.abort();
    // Legacy `get`: the first request goes once around the list to the key that answers…
    assert_eq!(used.get(..3), Some(&['A', 'B', 'C'][..]), "{used:?}");
    // …and every later request starts with that key.
    assert!(used.len() > 3, "{used:?}");
    assert!(used[3..].iter().all(|k| *k == 'C'), "{used:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_kma_backend_serves_within_the_gateway_attempt_while_every_acquisition_is_slow() {
    use server2::domestic::kma::backend::KmaBackend;
    use server2::gateway::BackendHandler;
    use server2::gateway::backend::Native;
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let slow = Arc::new(SlowEverything);
    let s3 = source(&peer)
        .with_forecast(Some(slow.clone()))
        .with_life(Some(slow.clone()))
        .with_air(Some(slow), None);
    let backend = KmaBackend::new(Arc::new(s3), Arc::new(|| NOW), AssemblyConfig::default());
    // `gateway::backend` gives the native attempt at most 3 s and drops it at that instant: the
    // waits (forecast, mid, warning cycle and state, station, air, life) and the assembly must
    // all fit.
    let attempt = Instant::now() + Duration::from_secs(3);
    let path = "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99".to_owned();
    let served = tokio::time::timeout_at(
        attempt,
        backend.fetch_or_forward(path, "ko".into(), attempt),
    )
    .await
    .expect("the native attempt outlived the gateway deadline")
    .unwrap();
    assert!(matches!(served, Native::Served(_)), "forwarded");
}

/// The R9 boundary: at 10:50 every backfill hour of the current family is stored and only the
/// latest publication (10:00) is acquired; at 11:50 the new pass holds 10:00 as backfill. `slow`:
/// 10:00 is still being acquired (4 s); otherwise it failed at once. Returns the current
/// publications asked for.
async fn backfill_boundary(slow: bool) -> Vec<String> {
    use server2::domestic::family::DataGoKrFamily;
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    use std::sync::atomic::{AtomicU64, Ordering::SeqCst};
    struct Provider {
        slow: bool,
        log: std::sync::Mutex<Vec<String>>,
    }
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> server2::gateway::BoxFuture<'static, Result<Published, String>> {
            let ForecastRequest::DataGoKr(r) = request else {
                return Box::pin(async { Ok(None) });
            };
            if r.family() != DataGoKrFamily::UltraSrtNcst {
                return Box::pin(async { Ok(None) });
            }
            let partition = r.publication().partition();
            self.log.lock().unwrap().push(partition.clone());
            let slow = self.slow;
            Box::pin(async move {
                if partition != "20260924-1000" {
                    return Ok(None);
                }
                if slow {
                    tokio::time::sleep(Duration::from_secs(4)).await;
                    Ok(None)
                } else {
                    Err("provider failure".into())
                }
            })
        }
    }
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(
        &store,
        &["current", "shortest", "short", "rss", "mid", "zone"],
    )
    .await;
    let grid = Grid::new(60, 127).unwrap().provider_key();
    for back in 1..=23 {
        let p = Publication::new(20260924, 1000)
            .unwrap()
            .add_hours(-back)
            .unwrap();
        publish(
            &store,
            "data-go-kr",
            "ultra-srt-ncst",
            &grid,
            p.period(),
            &p.partition(),
            kst_ms(p.date(), p.time()) + 40. * 60_000.,
            &[current_page(
                &format!("{:08}", p.date()),
                &format!("{:04}", p.time()),
                "20.0",
            )],
            "application/json",
        )
        .await;
    }
    let provider = Arc::new(Provider {
        slow,
        log: std::sync::Mutex::new(Vec::new()),
    });
    let clock = Arc::new(AtomicU64::new(NOW.to_bits()));
    let read = clock.clone();
    let s3 = S3Source::new(
        peer.transport_limited(4),
        Arc::new(move || f64::from_bits(read.load(SeqCst))),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_forecast(Some(provider.clone()));
    let _ = s3.snapshot(&request(), deadline()).await;
    clock.store((NOW + HOUR).to_bits(), SeqCst);
    let _ = s3.snapshot(&request(), deadline()).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    provider.log.lock().unwrap().clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_backfill_pass_joins_a_publication_a_latest_acquisition_is_still_asking() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let log = backfill_boundary(true).await;
    let count = |w: &str| log.iter().filter(|l| *l == w).count();
    assert_eq!(count("20260924-1100"), 1, "{log:?}");
    assert_eq!(
        count("20260924-1000"),
        1,
        "the running flight is joined: {log:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_backfill_pass_skips_a_publication_a_latest_acquisition_just_failed() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let log = backfill_boundary(false).await;
    let count = |w: &str| log.iter().filter(|l| *l == w).count();
    assert_eq!(count("20260924-1100"), 1, "{log:?}");
    assert_eq!(count("20260924-1000"), 1, "within the retry bound: {log:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stored_acquisitions_legacy_would_not_keep_are_acquired_again() {
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = super::source_s3::S3_PEERS.lock().await;
    struct Provider {
        log: std::sync::Mutex<Vec<String>>,
    }
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> server2::gateway::BoxFuture<'static, Result<Published, String>> {
            if let ForecastRequest::DataGoKr(r) = &request {
                self.log.lock().unwrap().push(format!(
                    "{} {}",
                    r.family().kind(),
                    r.publication().partition()
                ));
            }
            Box::pin(async { Ok(None) })
        }
    }
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(
        &store,
        &["current", "shortest", "short", "rss", "mid", "zone"],
    )
    .await;
    let grid = Grid::new(60, 127).unwrap().provider_key();
    // Current 10:00 (latest) and 09:00 carry legacy's recovery sentinel `t1h` -50; the other
    // backfill hours are valid.
    for back in 0..=23 {
        let p = Publication::new(20260924, 1000)
            .unwrap()
            .add_hours(-back)
            .unwrap();
        let t1h = if back <= 1 { "-50" } else { "20.0" };
        publish(
            &store,
            "data-go-kr",
            "ultra-srt-ncst",
            &grid,
            p.period(),
            &p.partition(),
            kst_ms(p.date(), p.time()) + 40. * 60_000.,
            &[current_page(
                &format!("{:08}", p.date()),
                &format!("{:04}", p.time()),
                t1h,
            )],
            "application/json",
        )
        .await;
    }
    // The latest short publication (08:00) is stored incomplete: legacy's `invalidForecast`.
    let short = Publication::new(20260924, 800).unwrap();
    publish(
        &store,
        "data-go-kr",
        "vilage-fcst",
        &grid,
        short.period(),
        &short.partition(),
        kst_ms(20260924, 810),
        &[envelope(vec![
            json!({"baseDate": "20260924", "baseTime": "0800",
            "category": "TMP", "fcstDate": "20260924", "fcstTime": "0900", "fcstValue": "20",
            "nx": 60, "ny": 127}),
        ])],
        "application/json",
    )
    .await;
    let provider = Arc::new(Provider {
        log: std::sync::Mutex::new(Vec::new()),
    });
    let s3 = source(&peer).with_forecast(Some(provider.clone()));
    let _ = s3.snapshot(&request(), deadline()).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let log = provider.log.lock().unwrap().clone();
    let count = |w: &str| log.iter().filter(|l| *l == w).count();
    assert_eq!(count("ultra-srt-ncst 20260924-1000"), 1, "latest: {log:?}");
    assert_eq!(
        count("ultra-srt-ncst 20260924-0900"),
        1,
        "backfill: {log:?}"
    );
    assert_eq!(count("ultra-srt-ncst 20260924-0800"), 0, "valid: {log:?}");
    assert_eq!(
        count("vilage-fcst 20260924-0800"),
        1,
        "invalid forecast: {log:?}"
    );
}
