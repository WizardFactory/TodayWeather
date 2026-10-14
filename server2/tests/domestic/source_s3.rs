//! S15b-1 SNAPSHOT: the S3 source reads published raw records from the S06 loopback S3 test peer
//! with empty memory, answers the store calls it sources with the same documents as the rebuild
//! functions, and ends the assembly with a named temporary forward for every input that is not
//! sourced yet. TEST ONLY: no provider or AWS is reached.
use super::source::{docs_json, same};
use rusty_s3::Credentials;
use serde_json::json;
use server2::domestic::kma::{
    AssemblyConfig, MidModel, Outcome, TownModel, assemble,
    backend::{KmaSource, SourceAnswer, parse_path},
    source::{
        Coord, Family, Fetched, S3Source, find_town, grid_documents, mid_documents, rss_documents,
        towns, zone_documents,
    },
};
use server2::domestic::publication::Publication;
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
        BoundedS3::new(
            HttpS3Transport::new(
                &self.endpoint,
                "server2-local",
                "ap-northeast-2",
                Credentials::new("server2-local", "server2-local-secret"),
            )
            .unwrap(),
            12,
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
    S3Source::new(peer.transport(), Arc::new(|| NOW)).unwrap()
}
const SEOUL: Coord = Coord { mx: 60., my: 127. };

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_answers_sourced_calls_from_s3_raw_records() {
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
    assert_eq!(transport.available(), 12, "every S3 permit returned");
    // The assembly reaches the first input S15b-2 owns and forwards with its name.
    let outcome = assemble(
        &request(),
        snapshot.as_ref(),
        NOW,
        AssemblyConfig::default(),
    );
    match outcome {
        Outcome::Legacy(reason) => assert!(
            reason.contains("city_hourly is not sourced yet (S15b-2)"),
            "{reason}"
        ),
        other => panic!("not forwarded: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_inputs_forward_with_named_reasons() {
    async fn reason(skip: &[&str], path: Option<&str>) -> String {
        let peer = Peer::new();
        let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        seed(&store, skip).await;
        let request = match path {
            Some(p) => parse_path(p, "ko").unwrap(),
            None => request(),
        };
        match source(&peer).snapshot(&request, deadline()).await {
            SourceAnswer::Forward(reason) => reason,
            SourceAnswer::Snapshot(_) => panic!("{skip:?} served"),
        }
    }
    for (skip, needle) in [
        (&["current"][..], "ultra-srt-ncst 20260924-1000 not in S3"),
        (&["shortest"][..], "ultra-srt-fcst 20260924-1000 not in S3"),
        (&["short"][..], "vilage-fcst 20260924-0800 not in S3"),
        (&["rss"][..], "town-rss 20260924-0800 not in S3"),
        (&["mid"][..], "mid-fcst 109 20260924-0600 not in S3"),
        (&["zone"][..], "no complete forecast-zone list"),
    ] {
        let r = reason(skip, None).await;
        assert!(r.contains(needle), "{skip:?}: {r}");
    }
    let r = reason(&[], Some("/v000903/kma/addr/%EC%97%86%EB%8A%94%EB%8F%84")).await;
    assert!(r.contains("town absent from the town list"), "{r}");
}
