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
                        city_page("2026.9.24.10:00"),
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
    // Two concurrent snapshots plus their background loads: keep the peer's connections low
    // (the Python S3 peer can drop connections under concurrency on Linux CI runners).
    S3Source::new(peer.transport_limited(4), Arc::new(|| NOW), acquire, locate).unwrap()
}
async fn snapshot(
    s: &S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>>,
) -> Box<dyn server2::domestic::kma::KmaStore + Send> {
    match s
        .snapshot(&request(), deadline() + Duration::from_secs(10))
        .await
    {
        SourceAnswer::Snapshot(s) => s,
        SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("forwarded: {r}"),
    }
}
type Store = Box<dyn server2::domestic::kma::KmaStore + Send>;
/// `first`, or a later snapshot, once its station and history inputs are complete.
async fn settled(
    s3: &S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>>,
    first: Store,
    town: &serde_json::Value,
) -> Store {
    let ready = |s: &Store| {
        s.stn_hourly_and_min_rns(town, "202609241049", &serde_json::json!({}))
            .is_ok_and(|j| j.get("weather").is_some())
            && s.history(town)
                .is_ok_and(|h| h.get("hourly").is_some_and(|x| len(x) == 168))
    };
    if ready(&first) {
        return first;
    }
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let next = snapshot(s3).await;
        if ready(&next) {
            return next;
        }
    }
    panic!("station and history inputs never completed");
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
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &[]).await;
    let scripted = Arc::new(Scripted::new(Duration::ZERO));
    let locate = Arc::new(Table(Mutex::new(0)));
    let s3 = source(&peer, scripted.clone(), locate.clone());
    // Two concurrent requests share every acquisition (single-flight by dataset and publication).
    let (a, b) = tokio::join!(snapshot(&s3), snapshot(&s3));
    let town = town(a.as_ref());
    // Within the 3-second wait on a developer machine; a slower CI runner may need a later
    // request (the late-data test pins the wait itself).
    let a = settled(&s3, a, &town).await;
    let b = settled(&s3, b, &town).await;
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
    // The request waits for the latest and previous hours; the backfill pass runs on its own
    // (the 09-20 12:00 page arrives for a later request).
    let city = a.city_hourly(&town).unwrap();
    assert!(
        (2..=3).contains(&len(&city)),
        "09:00 and 10:00 rows of station 108 (and maybe 09-20 12:00)"
    );
    let mut backfilled = len(&city) == 3;
    for _ in 0..40 {
        if backfilled {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        backfilled = len(&snapshot(&s3).await.city_hourly(&town).unwrap()) == 3;
    }
    assert!(
        backfilled,
        "the backfilled 09-20 12:00 row reaches a later request"
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
    // The carried legacy seed registers these stations: nothing to geocode.
    assert_eq!(
        *locate.0.lock().unwrap(),
        0,
        "seeded stations need no geocoding"
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
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&store, &[]).await;
    let slow = Arc::new(Scripted::new(Duration::from_secs(10)));
    let s3 = source(&peer, slow.clone(), Arc::new(Table(Mutex::new(0))));
    let started = std::time::Instant::now();
    let first = snapshot(&s3).await;
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "{:?}",
        started.elapsed()
    );
    let town = town(first.as_ref());
    // No station pages within the wait: the seeded station has no minute row (legacy's error),
    // and the history read has no rows yet (the mapping, or legacy's expired read).
    let err = first
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap_err();
    assert!(
        err.0.starts_with("Fail to find stn Weather info"),
        "{}",
        err.0
    );
    let history = first.history(&town).unwrap();
    assert!(
        history.get("mapping").is_some()
            || get(&history, "reason").string().as_deref() == Some("cache-read-timeout"),
        "{}",
        String::from_utf8_lossy(&history.to_bytes())
    );
    assert_eq!(len(get(&history, "hourly")), 0);
    // The owned acquisitions finish and publish; later requests use them.
    tokio::time::sleep(Duration::from_secs(11)).await;
    let later = settled(&s3, snapshot(&s3).await, &town).await;
    let stn = later
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .unwrap();
    assert_eq!(get(&stn, "stnId").number(), Some(108.));
    assert_eq!(len(get(&later.history(&town).unwrap(), "hourly")), 168);
    let _ = Unreachable;
}

fn convert_seed(input: &std::path::Path, out: &std::path::Path) -> std::process::Output {
    convert_seed_at(input, out, "2026-09-24T01:00:00.000Z")
}
fn convert_seed_at(
    input: &std::path::Path,
    out: &std::path::Path,
    exported_at: &str,
) -> std::process::Output {
    std::process::Command::new("python3")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .arg("tools/migration/export_station_seeds.py")
        .args(["--exported-at", exported_at, "--input"])
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
    // A repeated stnId is kept, as legacy holds it (965 and 989 three times each in the 2026-10-15 export).
    let path = dir.join("repeated.jsonl");
    std::fs::write(
        &path,
        input.replacen("\"stnId\":\"400\"", "\"stnId\":\"108\"", 1),
    )
    .unwrap();
    let out = dir.join("repeated-seed.jsonl");
    assert!(convert_seed(&path, &out).status.success());
    let repeated =
        server2::domestic::kma::source::seed::parse(&std::fs::read(&out).unwrap()).unwrap();
    assert_eq!(repeated.docs.len(), 3);
    // The importer side rejects a tampered seed independently.
    let tampered = text.replacen("\"rnsHit\":1}", "\"rnsHit\":1,\"extra\":true}", 1);
    assert!(server2::domestic::kma::source::seed::parse(tampered.as_bytes()).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_newer_imported_seed_replaces_the_carried_one() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    let dir = std::env::temp_dir().join(format!("s15b2-import-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("seed.jsonl");
    assert!(
        convert_seed_at(
            std::path::Path::new(SEED_FIXTURE),
            &out,
            "2026-10-16T00:00:00.000Z"
        )
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
    // A process after the import (2026-10-17) reads it: the newer export replaces the carried
    // one; no geocoder at all, seeded stations need none.
    use server2::domestic::kma::source::Val;
    use server2::domestic::kma::source::observe::Observations;
    let obs = Arc::new(Observations::new(
        peer.transport_limited(4),
        Arc::new(store),
        Arc::new(Scripted::new(Duration::ZERO)),
        Arc::new(Unreachable),
    ));
    let now = server2::history::schedule::to_ms(p(20261017, 1000));
    let mut registry = None;
    for _ in 0..40 {
        let folded = obs
            .stations(now, Instant::now() + Duration::from_secs(3))
            .await
            .unwrap();
        if folded.registry.docs().len() == 3 {
            registry = Some(folded.registry.clone());
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let registry = registry.expect("the imported seed replaces the carried one");
    let seoul = registry
        .docs()
        .iter()
        .find(|d| d.get("stnId") == Some(&Val::str("108")))
        .unwrap();
    assert_eq!(seoul.get("rnsHit"), Some(&Val::Num(10.)));
    assert_eq!(seoul.get("rnsCount"), Some(&Val::Num(12.)));
    assert_eq!(seoul.get("isMountain"), Some(&Val::Bool(false)));
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

/// Hourly failures after a delay; every hourly request is logged (no S3 publication happens).
struct SlowFail {
    delay: Duration,
    hours: Mutex<Vec<Publication>>,
}
impl Acquire for SlowFail {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            if request.family() == WebFamily::AwsHourly {
                self.hours
                    .lock()
                    .unwrap()
                    .push(request.publication().unwrap());
            }
            tokio::time::sleep(self.delay).await;
            Err(DomesticError::Transport)
        })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
}

/// S15b2-R7: a backfill pass that reaches its owned deadline leaves the hours it did not start
/// due for the next pass instead of suppressing them for six hours.
#[tokio::test(start_paused = true)]
async fn an_expired_backfill_pass_leaves_unstarted_hours_for_the_next_pass() {
    use server2::domestic::kma::source::observe::Observations;
    // No S3: every read fails at once (closed loopback port).
    let transport = server2::world::BoundedS3::new(
        server2::storage::HttpS3Transport::new(
            "http://127.0.0.1:9",
            "server2-local",
            "ap-northeast-2",
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        12,
    );
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let slow = Arc::new(SlowFail {
        delay: Duration::from_secs(61),
        hours: Mutex::new(Vec::new()),
    });
    let obs = Arc::new(Observations::new(
        transport,
        store,
        slow.clone(),
        Arc::new(Unreachable),
    ));
    let now = NOW as i64;
    let direct = [p(20260924, 1000), p(20260924, 900)];
    let _ = obs
        .stations(now, Instant::now() + Duration::from_secs(3))
        .await;
    // The pass runs three hours per 61 s; its 600 s owned deadline ends it after about 30 hours.
    tokio::time::sleep(Duration::from_secs(700)).await;
    let first: Vec<Publication> = slow.hours.lock().unwrap().clone();
    let started = first.iter().filter(|h| !direct.contains(h)).count();
    assert!(
        started > 10 && started < 60,
        "first pass started {started} hours"
    );
    let _ = obs
        .stations(now, Instant::now() + Duration::from_secs(3))
        .await;
    tokio::time::sleep(Duration::from_secs(200)).await;
    let all: Vec<Publication> = slow.hours.lock().unwrap().clone();
    let second = &all[first.len()..];
    assert!(
        second.iter().any(|h| !direct.contains(h)),
        "the next pass resumed the backfill"
    );
    // The latest and previous hours are not backfill hours; every backfill hour is tried once.
    let backfill: Vec<&Publication> = all.iter().filter(|h| !direct.contains(h)).collect();
    let mut unique = backfill.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        backfill.len(),
        "no hour retried within six hours"
    );
    assert!(
        second
            .iter()
            .filter(|h| !direct.contains(h))
            .all(|h| !first.contains(h)),
        "the next pass starts where the expired one stopped"
    );
}

/// S15b2-R11: minute pages beyond the readers' reach are dropped whether or not a newer page was
/// acquired locally, so retained pages and rebuilt minute rows stay bounded as time advances.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn minute_pages_stay_within_the_readers_reach() {
    use server2::domestic::kma::source::observe::Observations;
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap());
    let obs = Arc::new(Observations::new(
        peer.transport_limited(4),
        store,
        Arc::new(Scripted::new(Duration::ZERO)),
        Arc::new(Table(Mutex::new(0))),
    ));
    let now = NOW as i64;
    // A slow runner may answer the first request without the page; later requests see it.
    let mut seen = false;
    for _ in 0..40 {
        let folded = obs
            .stations(now, Instant::now() + Duration::from_secs(3))
            .await;
        if folded.is_some_and(|f| !f.minute.docs().is_empty()) {
            seen = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert!(seen, "the 10:49 page");
    // Two hours later no newer minute page is stored (the minute retry bound holds the next
    // acquisition back): the 10:49 page is out of reach and dropped.
    let later = obs
        .stations(now + 2 * 3_600_000, Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
    assert!(
        later.minute.docs().is_empty(),
        "{} minute rows kept",
        later.minute.docs().len()
    );
}

/// The carried 2026-10-15 export (`data/kmastninfos.seed.jsonl`) parses with its recorded
/// counts, and an older imported export does not replace it.
#[test]
fn the_carried_station_seed_is_the_2026_10_15_export() {
    let seed = server2::domestic::kma::source::seed::embedded();
    assert_eq!(seed.docs.len(), 776);
    let flag = |k: &str| {
        seed.docs
            .iter()
            .filter(|d| d.get(k) == Some(&server2::domestic::kma::source::Val::Bool(true)))
            .count()
    };
    assert_eq!(flag("isCityWeather"), 97);
    assert_eq!(flag("isMountain"), 38);
    assert_eq!(seed.docs.iter().filter(|d| d.has("rnsHit")).count(), 695);
    assert_eq!(seed.exported_at_ms, 1_792_024_470_549);
    let mut ids: Vec<&str> = seed
        .docs
        .iter()
        .filter_map(|d| {
            d.get("stnId")
                .and_then(server2::domestic::kma::source::Val::as_str)
        })
        .collect();
    ids.sort_unstable();
    let total = ids.len();
    ids.dedup();
    assert_eq!(
        (total, ids.len()),
        (776, 772),
        "965 and 989 three times each"
    );
}

/// Publish raw seed bytes as `station_seed_import` does, without validating them (a corrupt
/// import must be survivable).
async fn publish_seed(
    store: &CatalogStore<server2::world::BoundedS3<server2::storage::HttpS3Transport>>,
    bytes: Vec<u8>,
    day: u32,
    fetched_at_ms: u64,
) {
    use server2::domestic::kma::source::seed;
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        seed::SOURCE,
        seed::KIND,
        &seed::key(),
        server2::storage::Period {
            local_date: day,
            slot: "0000".into(),
        },
        fetched_at_ms,
        200,
        "application/x-ndjson",
        None,
        bytes.into(),
        &limits.raw,
    )
    .unwrap();
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![
            CatalogId::for_record(&record.envelope.identity, &format!("{day:08}")).unwrap(),
        ],
    };
    store
        .publish(
            GroupDeclaration::new(vec![member], &limits).unwrap(),
            vec![record],
            deadline(),
        )
        .await
        .unwrap();
}
fn fixture_seed(exported_at: &str) -> Vec<u8> {
    let dir = std::env::temp_dir().join(format!(
        "s15b2s-{}-{}",
        std::process::id(),
        exported_at.replace(':', "")
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("seed.jsonl");
    assert!(
        convert_seed_at(std::path::Path::new(SEED_FIXTURE), &out, exported_at)
            .status
            .success()
    );
    let bytes = std::fs::read(&out).unwrap();
    std::fs::remove_dir_all(&dir).ok();
    bytes
}
/// The registry size a process at 2026-10-17 settles on with the S3 peer's imports.
async fn settled_registry(
    peer: &Peer,
    store: CatalogStore<server2::world::BoundedS3<server2::storage::HttpS3Transport>>,
) -> usize {
    use server2::domestic::kma::source::observe::Observations;
    let obs = Arc::new(Observations::new(
        peer.transport_limited(4),
        Arc::new(store),
        Arc::new(Scripted::new(Duration::ZERO)),
        Arc::new(Unreachable),
    ));
    let now = server2::history::schedule::to_ms(p(20261017, 1000));
    let mut size = 0;
    for _ in 0..6 {
        size = obs
            .stations(now, Instant::now() + Duration::from_secs(3))
            .await
            .unwrap()
            .registry
            .docs()
            .len();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    size
}

/// S15b2s-R1: an import replaces the carried seed only when it is newer and valid; older or
/// same-time imports keep the carried seed, and a corrupt newest import is skipped in favor of
/// the newest valid newer one.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn only_a_newer_valid_import_replaces_the_carried_seed() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let carried = server2::domestic::kma::source::seed::embedded().docs.len();
    // Older and same-time imports: the carried seed stays.
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    publish_seed(
        &store,
        fixture_seed("2026-10-01T00:00:00.000Z"),
        20261001,
        1,
    )
    .await;
    publish_seed(
        &store,
        fixture_seed("2026-10-15T00:34:30.549Z"),
        20261015,
        2,
    )
    .await;
    assert_eq!(settled_registry(&peer, store).await, carried);
    // A newer valid import, then a newer corrupt one: the valid one is used.
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    publish_seed(
        &store,
        fixture_seed("2026-10-16T00:00:00.000Z"),
        20261016,
        3,
    )
    .await;
    publish_seed(&store, b"not a seed\n".to_vec(), 20261017, 4).await;
    assert_eq!(settled_registry(&peer, store).await, 3);
    // Only a corrupt import: the carried seed stays.
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    publish_seed(&store, b"not a seed\n".to_vec(), 20261017, 5).await;
    assert_eq!(settled_registry(&peer, store).await, carried);
}
