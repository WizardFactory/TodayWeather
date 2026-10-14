//! S15b-2 ASOS: per-station range acquisition checked like the legacy history provider, and the
//! `asos_history` collection rebuilt from acquisitions like legacy `Recovery.run` (oracle:
//! `fixtures/stations.json.gz` `asos`, legacy `lib/history` over the live 2026-10-14 station-108
//! bodies with edits; see `fixtures/STATIONS-PROVENANCE.md`).
use super::source::{at, items_of, same, text};
use super::stations::oracle;
use super::stub::*;
use server2::domestic::asos::{AsosKind, AsosRequest};
use server2::domestic::family::{Endpoints, Service};
use server2::domestic::kma::source::Doc;
use server2::domestic::kma::source::asos::{AsosFetched, AsosStore};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::{Acquired, DomesticAcquirer};
use server2::gateway::OrderedJson;
use server2::providers::{HttpProviderTransport, HttpPublicTransport};
use server2::storage::CatalogLimits;
use std::{collections::BTreeMap, sync::Arc};

const HOURLY: &str = "1360000/AsosHourlyInfoService/getWthrDataList";
const DAILY: &str = "1360000/AsosDalyInfoService/getWthrDataList";

fn docs_json(docs: &[Doc]) -> OrderedJson {
    OrderedJson::Array(docs.iter().map(Doc::json).collect())
}
fn query(request: &OrderedJson, name: &str) -> Option<String> {
    request
        .get("query")
        .and_then(|q| q.get(name))
        .and_then(OrderedJson::string)
}
/// (kind, start key, end key) of a recorded provider request.
fn requested(request: &OrderedJson) -> (AsosKind, String, String) {
    let kind = if text(at(request, &["kind"])) == "hourly" {
        AsosKind::Hourly
    } else {
        AsosKind::Daily
    };
    let date = |n: &str| query(request, n).unwrap();
    match kind {
        AsosKind::Hourly => (
            kind,
            format!("{}{}00", date("startDt"), date("startHh")),
            format!("{}{}00", date("endDt"), date("endHh")),
        ),
        AsosKind::Daily => (kind, date("startDt"), date("endDt")),
    }
}
fn accepted(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .is_ok_and(|j| j["response"]["header"]["resultCode"] == "00")
}

#[test]
fn asos_history_store_rebuilds_like_legacy_recovery() {
    for case in items_of(at(oracle(), &["asos"])) {
        let id = text(at(case, &["id"]));
        let station = text(at(case, &["station"]));
        let mut store = AsosStore::default();
        for (n, run) in items_of(at(case, &["runs"])).iter().enumerate() {
            let now = at(run, &["now"]).number().unwrap();
            let (start, end) = (
                text(at(run, &["window", "start"])),
                text(at(run, &["window", "end"])),
            );
            let requests = items_of(at(run, &["requests"]));
            let plan = store.plan(&station, &start, &end);
            let recorded: Vec<_> = requests.iter().map(requested).collect();
            assert_eq!(plan, recorded, "{id} run {n} plan");
            for r in requests {
                let body = text(at(r, &["body"]));
                if !accepted(&body) {
                    continue;
                }
                let (kind, start, end) = requested(r);
                store.apply(
                    &station,
                    &AsosFetched {
                        kind,
                        start,
                        end,
                        fetched_at_ms: now,
                        pages: vec![Arc::from(body.into_bytes())],
                    },
                );
            }
            same(
                &docs_json(&store.docs()),
                at(run, &["store"]),
                &format!("{id} run {n} store"),
            );
            same(
                &docs_json(&store.read(
                    AsosKind::Hourly,
                    &station,
                    &format!("{start}0000"),
                    &format!("{end}2300"),
                )),
                at(run, &["read", "hourly"]),
                &format!("{id} run {n} hourly read"),
            );
            same(
                &docs_json(&store.read(AsosKind::Daily, &station, &start, &end)),
                at(run, &["read", "daily"]),
                &format!("{id} run {n} daily read"),
            );
        }
    }
}

#[test]
fn asos_requests_accept_only_legacy_station_ranges() {
    let ok = |k, s: &str, a: &str, b: &str| AsosRequest::new(k, s, a, b).is_ok();
    assert!(ok(AsosKind::Hourly, "108", "202610070000", "202610132300"));
    assert!(ok(AsosKind::Daily, "90", "20261007", "20261013"));
    assert!(!ok(AsosKind::Daily, "090", "20261007", "20261013"));
    assert!(!ok(AsosKind::Daily, "1080", "20261007", "20261013"));
    assert!(
        !ok(AsosKind::Daily, "108", "20261006", "20261013"),
        "eight days"
    );
    assert!(!ok(AsosKind::Daily, "108", "20261013", "20261007"));
    assert!(!ok(AsosKind::Hourly, "108", "202610070030", "202610132300"));
    assert!(!ok(AsosKind::Hourly, "108", "202610072400", "202610132300"));
    let r = AsosRequest::new(AsosKind::Hourly, "108", "202610070000", "202610132300").unwrap();
    assert_eq!(r.range_partition(), "2026100700-2026101323");
    assert_eq!(
        AsosRequest::parse_partition(AsosKind::Hourly, "2026100700-2026101323"),
        Some(("202610070000".into(), "202610132300".into()))
    );
}

async fn env() -> (
    Stub,
    DomesticAcquirer<HttpProviderTransport, HttpPublicTransport, Memory>,
) {
    let stub = Stub::start().await;
    let wire = Arc::new(Memory::default());
    let clk = clock(kst(2026, 10, 14, 10, 0));
    let mut rings = BTreeMap::new();
    rings.insert(
        Service::Asos,
        ring(wire, clk.clone(), &[(KEY_A, 'a'), (KEY_B, 'b')]),
    );
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
        clk,
        Arc::new(DomesticMetrics::default()),
        CatalogLimits::default(),
    )
    .unwrap();
    (stub, acquirer)
}
fn hourly_page(items: &[serde_json::Value], page: u32, total: usize) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": page, "numOfRows": 999, "totalCount": total}}}))
    .unwrap()
}
fn item(i: usize) -> serde_json::Value {
    serde_json::json!({"tm": format!("2026-10-07 {:02}:00", i % 24), "stnId": "108", "ta": "10.0", "hm": "50", "rnum": i.to_string()})
}

#[tokio::test]
async fn asos_acquisition_checks_pages_like_the_legacy_provider() {
    let first_run = &items_of(at(&items_of(at(oracle(), &["asos"]))[0], &["runs"]))[0];
    let live = text(at(&items_of(at(first_run, &["requests"]))[0], &["body"]));
    let request =
        AsosRequest::new(AsosKind::Hourly, "108", "202610070000", "202610132300").unwrap();
    // The recorded station-108 range: one page, legacy query order, one raw record.
    let (stub, acquirer) = env().await;
    stub.push(HOURLY, Reply::json(live.clone().into_bytes()));
    match acquirer.acquire_asos(&request, deadline()).await {
        Ok(Acquired::Complete(a)) => {
            assert_eq!(a.records.len(), 1);
            let r = &a.records[0];
            assert_eq!(r.envelope.identity.kind, "asos-hourly");
            assert_eq!(&r.bytes[..], live.as_bytes());
        }
        other => panic!("{other:?}"),
    }
    let call = &stub.calls()[0];
    let names: Vec<&str> = call.query.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        names
            .iter()
            .filter(|n| !matches!(**n, "serviceKey" | "dataType"))
            .copied()
            .collect::<Vec<_>>(),
        [
            "dataCd",
            "dateCd",
            "stnIds",
            "startDt",
            "endDt",
            "pageNo",
            "numOfRows",
            "startHh",
            "endHh"
        ]
    );
    assert_eq!(call.get("dateCd"), Some("HR"));
    assert_eq!(call.get("startHh"), Some("00"));
    assert_eq!(call.get("endHh"), Some("23"));
    assert_eq!(call.get("dataType"), Some("JSON"));

    // Two pages (999 + 201 rows) are one ordered group.
    let items: Vec<_> = (0..1200).map(item).collect();
    let (stub, acquirer) = env().await;
    stub.push(HOURLY, Reply::json(hourly_page(&items[..999], 1, 1200)));
    stub.push(HOURLY, Reply::json(hourly_page(&items[999..], 2, 1200)));
    match acquirer.acquire_asos(&request, deadline()).await {
        Ok(Acquired::Complete(a)) => assert_eq!(a.records.len(), 2),
        other => panic!("{other:?}"),
    }
    // `03` on the first page and a zero total store nothing.
    for body in [
        br#"{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}"#.to_vec(),
        hourly_page(&[], 1, 0),
    ] {
        let (stub, acquirer) = env().await;
        stub.push(HOURLY, Reply::json(body));
        assert!(matches!(
            acquirer.acquire_asos(&request, deadline()).await,
            Ok(Acquired::NoData)
        ));
    }
    // Legacy rejections never become records: other result codes, a truncated or repeated
    // page, a changed total, a wrong page echo and a non-JSON body.
    let repeated = hourly_page(&items[..999], 2, 1998);
    for (name, pages) in [
        (
            "quota",
            vec![br#"{"response":{"header":{"resultCode":"22","resultMsg":"LIMITED"}}}"#.to_vec()],
        ),
        ("truncated", vec![hourly_page(&items[..10], 1, 12)]),
        (
            "repeated",
            vec![hourly_page(&items[..999], 1, 1998), repeated],
        ),
        (
            "total",
            vec![
                hourly_page(&items[..999], 1, 1200),
                hourly_page(&items[999..], 2, 1201),
            ],
        ),
        ("echo", vec![hourly_page(&items[..10], 2, 10)]),
        (
            "xml",
            vec![b"<OpenAPI_ServiceResponse></OpenAPI_ServiceResponse>".to_vec()],
        ),
    ] {
        let (stub, acquirer) = env().await;
        for _ in 0..2 {
            for p in &pages {
                stub.push(HOURLY, Reply::json(p.clone()));
            }
        }
        let outcome = acquirer.acquire_asos(&request, deadline()).await;
        assert!(
            !matches!(outcome, Ok(Acquired::Complete(_))),
            "{name}: {outcome:?}"
        );
    }
    // The daily form has no hours.
    let daily = AsosRequest::new(AsosKind::Daily, "108", "20261007", "20261013").unwrap();
    let (stub, acquirer) = env().await;
    stub.push(
        DAILY,
        Reply::json(hourly_page(
            &[serde_json::json!({"tm": "2026-10-07", "stnId": "108", "minTa": "1", "maxTa": "2"})],
            1,
            1,
        )),
    );
    assert!(matches!(
        acquirer.acquire_asos(&daily, deadline()).await,
        Ok(Acquired::Complete(_))
    ));
    let call = &stub.calls()[0];
    assert_eq!(call.get("dateCd"), Some("DAY"));
    assert_eq!(call.get("startHh"), None);
}

/// S15b2-R2: an ongoing-hour AWS page row that completes a D-1 hour between a run's plan and its
/// range completion does not drop the range's item: the range still adds the fields the page row
/// lacks, and replay gives the same rows in a fresh process (it depends only on the records).
#[test]
fn a_range_planned_before_an_ongoing_page_still_adds_its_missing_fields() {
    use server2::domestic::kma::source::asos::replay;
    use server2::domestic::kma::source::{Doc, Val};
    let key_ms = |key: &str| {
        // KST wall clock in UTC fields, as station rows store it.
        let (y, m, d, h) = (
            key[..4].parse::<i32>().unwrap(),
            key[4..6].parse::<u8>().unwrap(),
            key[6..8].parse::<u8>().unwrap(),
            key[8..10].parse::<u8>().unwrap(),
        );
        time::PrimitiveDateTime::new(
            time::Date::from_calendar_date(y, time::Month::try_from(m).unwrap(), d).unwrap(),
            time::Time::from_hms(h, 0, 0).unwrap(),
        )
        .assume_utc()
        .unix_timestamp() as f64
            * 1000.
    };
    let row = Doc::new()
        .with("date", Val::Date(key_ms("2026101323")))
        .with("stnId", Val::str("108"))
        .with("t1h", Val::Num(12.5))
        .with("reh", Val::Num(70.))
        .with("vec", Val::Num(90.));
    let range = AsosFetched {
        kind: AsosKind::Hourly,
        start: "202610132300".into(),
        end: "202610132300".into(),
        fetched_at_ms: 2_000.,
        pages: vec![std::sync::Arc::from(hourly_page(
            &[
                serde_json::json!({"tm": "2026-10-13 23:00", "stnId": "108", "ta": "13.0", "hm": "75", "ws": "1.0", "dc10Tca": "9"}),
            ],
            1,
            1,
        ))],
    };
    let page_first = replay(
        "108",
        std::slice::from_ref(&range),
        &[(1_000., row.clone())],
    );
    let docs = page_first.read(AsosKind::Hourly, "108", "202610132300", "202610132300");
    let values = String::from_utf8(docs[0].json().to_bytes()).unwrap();
    // The page's values came first; the range adds `wsd` and `sky`.
    assert!(
        values.contains(r#""values":{"t1h":12.5,"reh":70,"vec":90,"wsd":1,"sky":4}"#),
        "{values}"
    );
    assert_eq!(
        replay(
            "108",
            std::slice::from_ref(&range),
            &[(1_000., row.clone())]
        )
        .docs()
        .iter()
        .map(|d| d.json().to_bytes())
        .collect::<Vec<_>>(),
        page_first
            .docs()
            .iter()
            .map(|d| d.json().to_bytes())
            .collect::<Vec<_>>()
    );
    // Range first: the hour is complete, so the later page row adds nothing.
    let range_first = replay("108", std::slice::from_ref(&range), &[(3_000., row)]);
    let docs = range_first.read(AsosKind::Hourly, "108", "202610132300", "202610132300");
    let values = String::from_utf8(docs[0].json().to_bytes()).unwrap();
    assert!(
        values.contains(r#""values":{"t1h":13,"reh":75,"wsd":1,"sky":4}"#),
        "{values}"
    );
    assert!(!values.contains("origin"));
}
