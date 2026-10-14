//! S15b-2 REQUEST-TIME OBSERVATIONS: the S3 source acquires the nationwide KMA pages once per
//! publication and the ASOS ranges of the mapped station, publishes them to the S06 loopback S3
//! test peer, answers the station and history calls from them, waits at most 3 s for late data
//! (answering as legacy does without it) and serves a new process from S3 alone. The acquirer is
//! a scripted double (no provider is reached).
use super::source_s3::{NOW, Peer, Unreachable, deadline, request, seed};
use server2::domestic::asos::{AsosKind, AsosRequest};
use server2::domestic::family::{WebFamily, WebRequest};
use server2::domestic::kma::backend::{KmaSource, SourceAnswer};
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::observe::{Acquire, Locate};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::{BoxFuture, OrderedJson};
use server2::resolver::Acquisition;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, RawRecord,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn row(id: &str, name: &str, rain: bool, addr: &str) -> Vec<String> {
    let mark = if rain {
        "<font color=blue>●</font>"
    } else {
        "<font color=red>○</font>"
    };
    [
        id, name, "12m", mark, "0", "0.5", "0", "0", "0", "0", "18.4", "270.1", "W", "1.2",
        "265.0", "WSW", "1.4", "61", "1013.2", addr,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}
fn aws_page(publication: &str, rain_410: bool) -> Vec<u8> {
    let rows = [
        row("108", "서울", false, "서울특별시 종로구 송월동"),
        row("400", "강남", false, "서울특별시 강남구 일원동"),
        row("410", "중구", rain_410, "서울특별시 중구 명동"),
    ];
    let mut html = String::from(
        r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
    );
    html += "\n";
    html += &format!(r"<span class=ehead>[ 매분관측자료 ] {publication}</span>");
    html += "\n";
    html += "<table border=0 cellspacing=0 cellpadding=0>\n<tr><td bgcolor=#999999>\n<table border=0 cellspacing=1 cellpadding=1>\n";
    html += r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#;
    html += "\n";
    for r in rows {
        html += "<tr align=center class=text>";
        for c in r {
            html += &format!(r"<td>{c}</td>");
        }
        html += r#"</tr>"#;
        html += "\n";
    }
    for part in [r"</table>", r"</td></tr></table>", r"</BODY></HTML>"] {
        html += part;
        html += "\n";
    }
    encoding_rs::EUC_KR.encode(&html).0.into_owned()
}
fn city_page(publication: &str) -> Vec<u8> {
    format!(
        r#"<html><head><meta charset="utf-8"></head><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>{publication}</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>운량<br/>1/10</th><th>현재<br/>기온</th><th>습도<br/>%</th><th>풍향</th><th>풍속</th></tr></thead><tbody><tr><td><a href="city-obs.do?stn=108">서울</a></td><td>맑음</td><td>3</td><td>18.0</td><td>60</td><td>남서</td><td>2.0</td></tr></tbody></table></body></html>"#
    )
    .into_bytes()
}
fn asos_body(items: Vec<serde_json::Value>) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": items.len()}}}))
    .unwrap()
}
fn asos_hourly() -> Vec<u8> {
    let mut items = Vec::new();
    for d in 17..=23 {
        for h in 0..24 {
            items.push(
                serde_json::json!({"tm": format!("2026-09-{d} {h:02}:00"), "stnId": "108",
                "ta": "15.5", "taQcflg": "", "hm": "70", "hmQcflg": "", "rn": "", "ws": "1.0",
                "wd": "90", "dc10Tca": "5"}),
            );
        }
    }
    asos_body(items)
}
fn asos_daily() -> Vec<u8> {
    asos_body(
        (17..=23)
            .map(|d| {
                serde_json::json!({"tm": format!("2026-09-{d}"), "stnId": "108",
                "minTa": "11.0", "maxTa": "22.0", "avgTa": "16.0", "avgRhm": "60", "sumRn": "",
                "avgWs": "1.5"})
            })
            .collect(),
    )
}

/// Scripted S13 double: pages by family and publication, optional delay, every call logged.
struct Scripted {
    delay: Duration,
    calls: Mutex<Vec<String>>,
    hourly: HashMap<Publication, Vec<u8>>,
}
impl Scripted {
    fn new(delay: Duration) -> Self {
        // Two ongoing hours and one backfilled history hour inside the ASOS window.
        let hourly = [
            (p(20260924, 1000), "2026.09.24.10:00"),
            (p(20260924, 900), "2026.09.24.09:00"),
            (p(20260920, 1200), "2026.09.20.12:00"),
        ]
        .into_iter()
        .map(|(h, s)| (h, aws_page(s, false)))
        .collect();
        Self {
            delay,
            calls: Mutex::new(Vec::new()),
            hourly,
        }
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}
fn acquisition(
    source: &str,
    kind: &str,
    key: &server2::storage::ProviderKey,
    period: Publication,
    partition: &str,
    body: Vec<u8>,
    content_type: &str,
) -> Acquisition {
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        source,
        kind,
        key,
        period.period(),
        NOW as u64 - 60_000,
        200,
        content_type,
        None,
        body.into(),
        &limits.raw,
    )
    .unwrap();
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![CatalogId::for_record(&record.envelope.identity, partition).unwrap()],
    };
    Acquisition {
        declaration: GroupDeclaration::new(vec![member], &limits).unwrap(),
        records: vec![record],
    }
}
impl Acquire for Scripted {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            let key = request.provider_key();
            let (kind, publication, body, ct) = match request.family() {
                WebFamily::AwsMinute => (
                    "aws-minute",
                    p(20260924, 1049),
                    aws_page("2026.09.24.10:49", true),
                    "text/html",
                ),
                WebFamily::AwsHourly => {
                    let h = request.publication().unwrap();
                    self.calls
                        .lock()
                        .unwrap()
                        .push(format!("aws-hourly {}", h.compact()));
                    match self.hourly.get(&h) {
                        Some(b) => ("aws-hourly", h, b.clone(), "text/html"),
                        None => return Err(DomesticError::Transport),
                    }
                }
                WebFamily::CityObservation => {
                    let h = request.publication().unwrap();
                    self.calls
                        .lock()
                        .unwrap()
                        .push(format!("city {}", h.compact()));
                    if h != p(20260924, 1000) {
                        return Ok(Acquired::Stale(p(20260924, 1000)));
                    }
                    (
                        "city-obs",
                        h,
                        city_page("2026.09.24.10:00"),
                        "text/html;charset=UTF-8",
                    )
                }
                WebFamily::TownRss => return Err(DomesticError::Transport),
            };
            if kind == "aws-minute" {
                self.calls.lock().unwrap().push("aws-minute".into());
            }
            Ok(Acquired::Complete(acquisition(
                "kma-web",
                kind,
                &key,
                publication,
                &publication.base_date(),
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
            tokio::time::sleep(self.delay).await;
            self.calls.lock().unwrap().push(format!(
                "{} {}-{}",
                request.asos_kind().kind(),
                request.start(),
                request.end()
            ));
            let body = match request.asos_kind() {
                AsosKind::Hourly => asos_hourly(),
                AsosKind::Daily => asos_daily(),
            };
            let start = request.start();
            let period = p(
                start[..8].parse().unwrap(),
                if start.len() == 12 {
                    start[8..10].parse::<u16>().unwrap() * 100
                } else {
                    0
                },
            );
            Ok(Acquired::Complete(acquisition(
                "data-go-kr",
                request.asos_kind().kind(),
                &AsosRequest::record_key(request.station()),
                period,
                &request.range_partition(),
                body,
                "application/json",
            )))
        })
    }
}
/// Geocoding table of the page addresses (`(산간)` removed, spaces kept as parsed).
struct Table(Mutex<usize>);
impl Locate for Table {
    fn locate(&self, address: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        *self.0.lock().unwrap() += 1;
        Box::pin(async move {
            match address.as_str() {
                "서울특별시종로구송월동" => Some((126.9658, 37.5714)),
                "서울특별시강남구일원동" => Some((127.087, 37.4932)),
                "서울특별시중구명동" => Some((126.985, 37.5636)),
                _ => None,
            }
        })
    }
}
fn source(
    peer: &Peer,
    acquire: Arc<dyn Acquire>,
    locate: Arc<dyn Locate>,
) -> S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>> {
    S3Source::new(peer.transport(), Arc::new(|| NOW), acquire, locate).unwrap()
}
async fn snapshot(
    s: &S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>>,
) -> Box<dyn server2::domestic::kma::KmaStore + Send> {
    match s
        .snapshot(&request(), deadline() + Duration::from_secs(10))
        .await
    {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(r) => panic!("forwarded: {r}"),
    }
}
fn get<'a>(j: &'a OrderedJson, k: &str) -> &'a OrderedJson {
    j.get(k)
        .unwrap_or_else(|| panic!("{k} in {}", String::from_utf8_lossy(&j.to_bytes())))
}
fn len(j: &OrderedJson) -> usize {
    match j {
        OrderedJson::Array(a) => a.len(),
        _ => panic!("array"),
    }
}
fn town(snapshot: &dyn server2::domestic::kma::KmaStore) -> serde_json::Value {
    let towns = snapshot.towns().unwrap();
    let OrderedJson::Array(list) = towns else {
        panic!()
    };
    serde_json::from_slice(&list[0].to_bytes()).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn station_and_history_inputs_are_acquired_once_published_and_answered() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &[]).await;
    let scripted = Arc::new(Scripted::new(Duration::ZERO));
    let locate = Arc::new(Table(Mutex::new(0)));
    let s3 = source(&peer, scripted.clone(), locate.clone());
    // Two concurrent requests share every acquisition (single-flight by dataset and publication).
    let (a, b) = tokio::join!(snapshot(&s3), snapshot(&s3));
    let town = town(a.as_ref());
    let stn = a
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap();
    assert_eq!(get(&stn, "stnId").number(), Some(108.));
    assert_eq!(
        get(&stn, "stnDateTime").string().as_deref(),
        Some("2026.09.24.10:49")
    );
    assert!(stn.get("cityHourAws").is_some(), "the 10:00 hourly row");
    assert_eq!(
        get(&stn, "weather").string().as_deref(),
        Some("맑음"),
        "the city page of 10:00"
    );
    // 중구 rains on the minute page; one rain station is not a local rain answer.
    assert_eq!(get(&stn, "nearStnId").string().as_deref(), Some("108"));
    assert!(stn.get("localMinAws").is_none());
    let city = a.city_hourly(&town).unwrap();
    assert_eq!(
        len(&city),
        3,
        "09-20 12:00, 09:00 and 10:00 rows of station 108"
    );
    let history = a.history(&town).unwrap();
    assert_eq!(
        get(get(&history, "mapping"), "stationId")
            .string()
            .as_deref(),
        Some("108")
    );
    assert_eq!(len(get(&history, "hourly")), 168);
    // A backfilled history page never stands for ASOS hours: the range is still requested and
    // every window row comes from it.
    assert!(
        !String::from_utf8(get(&history, "hourly").to_bytes())
            .unwrap()
            .contains("origin")
    );
    assert_eq!(len(get(&history, "daily")), 7);
    assert!(history.get("reason").is_none());
    assert_eq!(b.history(&town).unwrap().to_bytes(), history.to_bytes());
    let calls = scripted.calls();
    for once in [
        "aws-minute",
        "aws-hourly 202609241000",
        "aws-hourly 202609240900",
        "city 202609241000",
        "asos-hourly 202609170000-202609232300",
        "asos-daily 20260917-20260923",
    ] {
        assert_eq!(
            calls.iter().filter(|c| *c == once).count(),
            1,
            "{once}: {calls:?}"
        );
    }
    assert_eq!(
        *locate.0.lock().unwrap(),
        3,
        "each station address geocoded once"
    );
    // A new process (empty memory) answers from the published records alone.
    let fresh = Arc::new(Scripted::new(Duration::ZERO));
    let s3b = source(&peer, fresh.clone(), Arc::new(Table(Mutex::new(0))));
    let c = snapshot(&s3b).await;
    assert_eq!(c.history(&town).unwrap().to_bytes(), history.to_bytes());
    assert_eq!(
        c.stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
            .unwrap()
            .to_bytes(),
        stn.to_bytes()
    );
    let again = fresh.calls();
    assert!(
        !again
            .iter()
            .any(|c| c.starts_with("asos") || c.ends_with("202609241000") || c == "aws-minute"),
        "{again:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn late_acquisitions_answer_as_absent_data_and_complete_for_the_next_request() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &[]).await;
    let slow = Arc::new(Scripted::new(Duration::from_secs(5)));
    let s3 = source(&peer, slow.clone(), Arc::new(Table(Mutex::new(0))));
    let started = std::time::Instant::now();
    let first = snapshot(&s3).await;
    assert!(
        started.elapsed() < Duration::from_millis(4500),
        "{:?}",
        started.elapsed()
    );
    let town = town(first.as_ref());
    // No station pages within the wait: legacy's answers for an empty station collection and
    // an expired history read.
    let err = first
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap_err();
    assert!(err.0.starts_with("Fail to find stn coords"), "{}", err.0);
    assert_eq!(
        get(&first.history(&town).unwrap(), "reason")
            .string()
            .as_deref(),
        Some("cache-read-timeout")
    );
    // The owned acquisitions finish and publish; the next request uses them.
    tokio::time::sleep(Duration::from_secs(6)).await;
    let second = snapshot(&s3).await;
    let stn = second
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap();
    assert_eq!(get(&stn, "stnId").number(), Some(108.));
    tokio::time::sleep(Duration::from_secs(6)).await;
    let third = snapshot(&s3).await;
    assert_eq!(len(get(&third.history(&town).unwrap(), "hourly")), 168);
    let _ = Unreachable;
}

fn convert_seed(input: &std::path::Path, out: &std::path::Path) -> std::process::Output {
    std::process::Command::new("python3")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .arg("tools/migration/export_station_seeds.py")
        .args(["--exported-at", "2026-09-24T01:00:00.000Z", "--input"])
        .arg(input)
        .arg("--output")
        .arg(out)
        .output()
        .unwrap()
}
const SEED_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/kmastninfos.jsonl"
);

#[test]
fn station_seed_converter_keeps_export_lines_and_rejects_other_fields() {
    let dir = std::env::temp_dir().join(format!("s15b2-seed-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("seed.jsonl");
    let o = convert_seed(std::path::Path::new(SEED_FIXTURE), &out);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let bytes = std::fs::read(&out).unwrap();
    let text = String::from_utf8(bytes.clone()).unwrap();
    let input = std::fs::read_to_string(SEED_FIXTURE).unwrap();
    assert_eq!(
        text.lines().skip(1).collect::<Vec<_>>(),
        input.lines().collect::<Vec<_>>()
    );
    let seed = server2::domestic::kma::source::seed::parse(&bytes).unwrap();
    assert_eq!(seed.docs.len(), 3);
    let first = String::from_utf8(seed.docs[0].json().to_bytes()).unwrap();
    assert_eq!(
        first,
        r#"{"stnId":"108","stnName":"서울","addr":"서울특별시종로구송월동","isCityWeather":true,"altitude":86,"geo":[126.9658,37.5714],"__v":0,"rnsCount":12,"rnsHit":10,"isMountain":false}"#
    );
    for (name, body) in [
        (
            "unknown field",
            input.replacen("\"isMountain\":false", "\"isMountain\":false,\"x\":1", 1),
        ),
        (
            "repeated stnId",
            input.replacen("\"stnId\":\"400\"", "\"stnId\":\"108\"", 1),
        ),
        ("json array", format!("[{}]", input.lines().next().unwrap())),
        (
            "geo shape",
            input.replacen("[126.9658,37.5714]", "[126.9658]", 1),
        ),
        (
            "boolean",
            input.replacen("\"isMountain\":false", "\"isMountain\":\"false\"", 1),
        ),
    ] {
        let path = dir.join("bad.jsonl");
        std::fs::write(&path, body).unwrap();
        let o = convert_seed(&path, &dir.join("bad-seed.jsonl"));
        assert!(!o.status.success(), "{name}");
    }
    // The importer side rejects a tampered seed independently.
    let tampered = text.replacen("\"rnsHit\":1}", "\"rnsHit\":1,\"extra\":true}", 1);
    assert!(server2::domestic::kma::source::seed::parse(tampered.as_bytes()).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_registry_starts_from_the_imported_legacy_seed() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &[]).await;
    let dir = std::env::temp_dir().join(format!("s15b2-import-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("seed.jsonl");
    assert!(
        convert_seed(std::path::Path::new(SEED_FIXTURE), &out)
            .status
            .success()
    );
    let bytes = std::fs::read(&out).unwrap();
    let a = server2::domestic::kma::source::seed::acquisition(&bytes).unwrap();
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
    std::fs::remove_dir_all(&dir).ok();
    // No geocoder at all: seeded stations need none.
    let s3 = source(
        &peer,
        Arc::new(Scripted::new(Duration::ZERO)),
        Arc::new(Unreachable),
    );
    let snap = snapshot(&s3).await;
    let town = town(snap.as_ref());
    let stn = snap
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap();
    // Seeded legacy fields reach the answer the way legacy copies the station document.
    assert_eq!(get(&stn, "rnsHit").number(), Some(10.));
    assert_eq!(get(&stn, "rnsCount").number(), Some(12.));
    assert_eq!(get(&stn, "isMountain"), &OrderedJson::Bool(false));
    assert_eq!(get(&stn, "altitude").number(), Some(86.));
}

#[test]
fn asos_acquisitions_outside_the_window_are_dropped() {
    use server2::domestic::kma::source::asos::AsosFetched;
    let f = |end: &str| AsosFetched {
        kind: AsosKind::Hourly,
        start: "202609100000".into(),
        end: end.into(),
        fetched_at_ms: 0.,
        pages: Vec::new(),
    };
    let mut list = vec![f("202609162300"), f("202609170000"), f("202609232300")];
    server2::domestic::kma::source::observe::retain_window(&mut list, "20260917");
    let ends: Vec<&str> = list.iter().map(|x| x.end.as_str()).collect();
    assert_eq!(ends, ["202609170000", "202609232300"]);
}
