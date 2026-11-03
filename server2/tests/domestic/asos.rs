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

#[test]
fn observed_asos_phenomena_becomes_precipitation_type() {
    let row = serde_json::json!({"stnId":"108","tm":"2026-10-13 03:00",
        "ta":"12.3","hm":"85","dc10Tca":"8","rn":"0.5","dmstMtphNo":"1904"});
    let allowed = ["202610130300".to_owned()].into_iter().collect();
    let (_, values) =
        server2::domestic::kma::source::asos::normalize(AsosKind::Hourly, &row, "108", &allowed)
            .unwrap();
    // The existing hourly aggregation uses rain/mixed/snow codes 1/2/3.
    assert_eq!(values.get("pty").and_then(|v| v.as_num()), Some(1.));
    assert_eq!(values.get("sky").and_then(|v| v.as_num()), Some(3.));
}

#[test]
fn observed_asos_preserves_unknown_codes_missing_rows_and_bad_quality() {
    let allowed = ["202610130300".to_owned()].into_iter().collect();
    let base = serde_json::json!({"stnId":"108","tm":"2026-10-13 03:00",
        "ta":"12.3","hm":"85","dc10Tca":"8","rn":"0.0"});
    let normalized = |row: &serde_json::Value| {
        server2::domestic::kma::source::asos::normalize(AsosKind::Hourly, row, "108", &allowed)
            .unwrap()
            .1
    };
    assert!(
        !normalized(&base).has("pty"),
        "missing phenomenon field is unknown"
    );
    for raw in ["14", "101101", "9999"] {
        let mut row = base.clone();
        row["dmstMtphNo"] = raw.into();
        assert!(!normalized(&row).has("pty"), "{raw}");
    }
    let mut wet = base.clone();
    wet["rn"] = "1.5".into();
    wet["dmstMtphNo"] = "40".into();
    assert!(
        !normalized(&wet).has("pty"),
        "positive rain contradicts no-precipitation code"
    );
}

#[test]
fn observed_asos_distinguishes_dry_blanks_from_trace_zero_and_missing_values() {
    use server2::domestic::kma::source::asos::normalize;
    let allowed = ["202610130300".to_owned()].into_iter().collect();
    let base = serde_json::json!({"stnId":"108","tm":"2026-10-13 03:00",
        "ta":"12.3","rn":"","rnQcflg":"","dmstMtphNo":""});
    let normalized =
        |row: &serde_json::Value| normalize(AsosKind::Hourly, row, "108", &allowed).unwrap().1;
    let dry = normalized(&base);
    assert_eq!(dry.get("rn1").and_then(|v| v.as_num()), Some(0.));
    assert_eq!(dry.get("pty").and_then(|v| v.as_num()), Some(0.));
    let mut empty = base.clone();
    empty.as_object_mut().unwrap().remove("ta");
    assert!(normalize(AsosKind::Hourly, &empty, "108", &allowed).is_none());
    for (code, pty) in [("01", Some(1.)), ("14", None), ("9999", None)] {
        let mut row = base.clone();
        row["dmstMtphNo"] = code.into();
        let v = normalized(&row);
        assert!(!v.has("rn1"), "blank rain contradicts code {code}");
        assert_eq!(v.get("pty").and_then(|v| v.as_num()), pty, "{code}");
    }
    let mut trace = base.clone();
    trace["rn"] = "0.0".into();
    let v = normalized(&trace);
    assert_eq!(v.get("rn1").and_then(|v| v.as_num()), Some(0.));
    assert!(
        !v.has("pty"),
        "trace quantity alone cannot classify rain versus snow"
    );
    trace["dmstMtphNo"] = "01".into();
    assert_eq!(
        normalized(&trace).get("pty").and_then(|v| v.as_num()),
        Some(1.)
    );

    // Retain another measurement so missing-rain cases still produce a row.
    let mut row = base.clone();
    row["ta"] = "12.3".into();
    for rain in [
        serde_json::Value::Null,
        serde_json::json!("-9"),
        serde_json::json!("bad"),
    ] {
        row["rn"] = rain;
        let v = normalized(&row);
        assert!(!v.has("rn1") && !v.has("pty"), "{row}");
    }
    row.as_object_mut().unwrap().remove("rn");
    let v = normalized(&row);
    assert!(!v.has("rn1") && !v.has("pty"));
    for flag in ["1", "9"] {
        row["rn"] = "".into();
        row["rnQcflg"] = flag.into();
        let v = normalized(&row);
        assert!(!v.has("rn1") && !v.has("pty"), "QC{flag}");
    }
}

#[test]
fn observed_asos_trace_without_a_type_is_not_no_precipitation() {
    let allowed = ["202610130300".to_owned()].into_iter().collect();
    let row = serde_json::json!({"stnId":"108","tm":"2026-10-13 03:00",
        "rn":"0.0","dmstMtphNo":""});
    let (_, values) =
        server2::domestic::kma::source::asos::normalize(AsosKind::Hourly, &row, "108", &allowed)
            .unwrap();
    assert_eq!(values.get("rn1").and_then(|v| v.as_num()), Some(0.));
    assert!(
        !values.has("pty"),
        "zero amount is not proof of no precipitation"
    );
}

#[test]
fn observed_trace_rain_cannot_become_a_no_precipitation_code() {
    for (date, key) in [
        ("2026-10-13", "202610130300"),
        ("2026-01-13", "202601130300"),
    ] {
        let allowed = [key.to_owned()].into_iter().collect();
        let row = serde_json::json!({"stnId":"108","tm":format!("{date} 03:00"),
            "ta":"1.2","rn":"0.0","rnQcflg":"","dmstMtphNo":"40"});
        let (_, values) = server2::domestic::kma::source::asos::normalize(
            AsosKind::Hourly,
            &row,
            "108",
            &allowed,
        )
        .unwrap();
        let amount = values
            .get("rn1")
            .or_else(|| values.get("rn3h"))
            .and_then(|v| v.as_num());
        assert_eq!(amount, Some(0.));
        assert!(
            !values.has("pty"),
            "{key}: trace proves precipitation occurred"
        );
    }
}

#[test]
fn observed_asos_daily_dry_blanks_and_winter_reporting_periods_are_distinct() {
    use server2::domestic::kma::source::asos::normalize;
    let allowed = ["20261013".to_owned()].into_iter().collect();
    let daily = serde_json::json!({"stnId":"108","tm":"2026-10-13",
        "minTa":"7","maxTa":"17","sumRn":"","sumRnDur":"","iscs":""});
    let (_, values) = normalize(AsosKind::Daily, &daily, "108", &allowed).unwrap();
    assert_eq!(values.get("rn1").and_then(|v| v.as_num()), Some(0.));
    for change in [
        serde_json::json!({"iscs":null}),
        serde_json::json!({"iscs":"{비}0100-0200."}),
        serde_json::json!({"sumRnDur":"1.0"}),
        serde_json::json!({"sumRnDur":"bad"}),
    ] {
        let mut row = daily.clone();
        row.as_object_mut()
            .unwrap()
            .extend(change.as_object().unwrap().clone());
        let (_, values) = normalize(AsosKind::Daily, &row, "108", &allowed).unwrap();
        assert!(!values.has("rn1"), "{row}");
    }
    for hour in [1, 3] {
        let key = format!("20260113{hour:02}00");
        let allowed = [key].into_iter().collect();
        let row = serde_json::json!({"stnId":"108","tm":format!("2026-01-13 {hour:02}:00"),
            "ta":"-1.2","rn":"","rnQcflg":"","dmstMtphNo":""});
        let (_, values) = normalize(AsosKind::Hourly, &row, "108", &allowed).unwrap();
        assert!(
            !values.has("rn1"),
            "winter rain remains a three-hour quantity"
        );
        assert_eq!(
            values.get("rn3h").and_then(|v| v.as_num()),
            (hour == 3).then_some(0.)
        );
        assert_eq!(
            values.get("pty").and_then(|v| v.as_num()),
            (hour == 3).then_some(0.)
        );
    }
}

#[test]
fn observed_winter_positive_three_hour_rain_rejects_no_precipitation_code() {
    let allowed = ["202601130300".to_owned()].into_iter().collect();
    let row = serde_json::json!({"stnId":"108","tm":"2026-01-13 03:00",
        "ta":"-1.2","rn":"1.5","rnQcflg":"","dmstMtphNo":"40"});
    let (_, values) =
        server2::domestic::kma::source::asos::normalize(AsosKind::Hourly, &row, "108", &allowed)
            .unwrap();
    assert_eq!(values.get("rn3h").and_then(|v| v.as_num()), Some(1.5));
    assert!(
        !values.has("pty"),
        "positive three-hour rain contradicts PTY0"
    );
}

#[test]
fn observed_store_does_not_stop_at_temperature_and_humidity() {
    let make = |at, code: Option<&str>| {
        let mut row = serde_json::json!({"stnId":"108","tm":"2026-10-13 03:00",
            "ta":"12.3","hm":"85","dc10Tca":"8","rn":"0.5"});
        if let Some(c) = code {
            row["dmstMtphNo"] = c.into();
        }
        let body = serde_json::json!({"response":{"body":{"items":{"item":[row]}}}});
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Hourly,
            start: "202610130300".into(),
            end: "202610130300".into(),
            fetched_at_ms: at,
            pages: vec![Arc::from(serde_json::to_vec(&body).unwrap())],
        }
    };
    let mut observed = AsosStore::observed();
    observed.apply("108", &make(1., None));
    assert_eq!(
        observed
            .missing(AsosKind::Hourly, "108", &["202610130300".into()])
            .len(),
        1
    );
    observed.apply("108", &make(2., Some("01")));
    assert!(
        observed
            .missing(AsosKind::Hourly, "108", &["202610130300".into()])
            .is_empty()
    );
    let mut legacy = AsosStore::default();
    legacy.apply("108", &make(1., None));
    assert!(
        legacy
            .missing(AsosKind::Hourly, "108", &["202610130300".into()])
            .is_empty()
    );
}

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
                        raw_ids: Vec::new(),
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
        // S15b2-R13: a zero total with items is a truncated page, not absent data.
        (
            "zero total with items",
            vec![hourly_page(&items[..1], 1, 0)],
        ),
        // S15b2-R14: U+0085 is not JavaScript whitespace; `policy.number` rejects the total.
        (
            "U+0085 total",
            vec![
                serde_json::to_vec(&serde_json::json!({"response": {
                    "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
                    "body": {"items": "", "pageNo": 1, "numOfRows": 999, "totalCount": "\u{85}0\u{85}"}}}))
                .unwrap(),
            ],
        ),
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
        // A rejection is an error: neither records nor terminal no-data.
        assert!(
            !matches!(outcome, Ok(Acquired::Complete(_)) | Ok(Acquired::NoData)),
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
        raw_ids: Vec::new(),
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

/// S15b2-R14: observation values are trimmed as JavaScript trims (NBSP and BOM are whitespace,
/// U+0085 is not), so a padded temperature is dropped as legacy drops it.
#[test]
fn asos_values_trim_like_javascript() {
    use server2::domestic::kma::source::asos::normalize;
    let allowed: std::collections::BTreeSet<String> = ["202610071000".to_owned()].into();
    let item = |ta: &str| serde_json::json!({"tm": "2026-10-07 10:00", "stnId": "108", "ta": ta, "hm": "70"});
    let values = |ta: &str| {
        normalize(AsosKind::Hourly, &item(ta), "108", &allowed)
            .map(|(_, v)| String::from_utf8(v.json().to_bytes()).unwrap())
    };
    assert_eq!(values("\u{85}10\u{85}").as_deref(), Some(r#"{"reh":70}"#));
    assert_eq!(
        values("\u{a0}10\u{feff}").as_deref(),
        Some(r#"{"t1h":10,"reh":70}"#)
    );
}

#[test]
fn observed_winter_rain_keeps_its_three_hour_period() {
    let row = serde_json::json!({"stnId":"108","tm":"2026-01-13 03:00","ta":"-1.2","hm":"85","dc10Tca":"10","rn":"1.5","rnQcflg":"","dmstMtphNo":"05"});
    let allowed = ["202601130300".to_owned()].into_iter().collect();
    let (_, values) =
        server2::domestic::kma::source::asos::normalize(AsosKind::Hourly, &row, "108", &allowed)
            .unwrap();
    assert_eq!(values.get("rn3h").and_then(|v| v.as_num()), Some(1.5));
    assert!(
        !values.has("rn1"),
        "never call a winter three-hour total hourly rain"
    );
}

#[test]
fn acquired_missing_values_do_not_trigger_endless_refetch_or_claim_value_completeness() {
    let mut store = AsosStore::observed();
    let rows=(0..24).map(|h|serde_json::json!({"stnId":"108","tm":format!("2026-10-13 {h:02}:00"),"ta":"17","hm":"60","dc10Tca":"5","rn":null,"dmstMtphNo":""})).collect::<Vec<_>>();
    for (kind, rows, start, end) in [
        (AsosKind::Hourly, rows, "202610130000", "202610132300"),
        (
            AsosKind::Daily,
            vec![
                serde_json::json!({"stnId":"108","tm":"2026-10-13","minTa":"10","maxTa":"20","sumRn":null}),
            ],
            "20261013",
            "20261013",
        ),
    ] {
        let body = serde_json::json!({"response":{"body":{"items":{"item":rows}}}});
        store.apply(
            "108",
            &AsosFetched {
                raw_ids: Vec::new(),
                kind,
                start: start.into(),
                end: end.into(),
                fetched_at_ms: 1.,
                pages: vec![Arc::from(serde_json::to_vec(&body).unwrap())],
            },
        );
    }
    assert_eq!(
        store
            .missing(
                AsosKind::Hourly,
                "108",
                &server2::domestic::kma::source::asos::range(
                    AsosKind::Hourly,
                    "20261013",
                    "20261013"
                )
            )
            .len(),
        24
    );
    assert!(
        store.plan("108", "20261013", "20261013").is_empty(),
        "these rows were acquired; unknown optional fields need another source, not an identical full-range refetch"
    );
    assert!(
        !store.docs()[0]
            .get("values")
            .unwrap()
            .as_doc()
            .unwrap()
            .has("pty")
    );
}

#[test]
fn asos_reload_deduplicates_full_originals_instead_of_the_request_start() {
    let a = AsosFetched {
        raw_ids: vec!["raw/original-a".into()],
        kind: AsosKind::Hourly,
        start: "202610180000".into(),
        end: "202610242300".into(),
        fetched_at_ms: 1.,
        pages: vec![Arc::from(&b"a"[..])],
    };
    assert!(a.same_original(&a.clone()));
    let mut b = a.clone();
    b.raw_ids = vec!["raw/original-b".into()];
    assert!(
        !a.same_original(&b),
        "one start and acquisition millisecond do not identify a raw revision"
    );
    let mut c = a.clone();
    c.raw_ids.clear();
    c.pages = vec![Arc::from(&b"c"[..])];
    assert!(
        !a.same_original(&c),
        "fixtures compare bodies as well as times"
    );
}

#[test]
fn recorded_seoul_dry_blanks_follow_asos_rules_while_qc9_stays_missing() {
    let mut store = AsosStore::observed();
    for (kind, body, start, end, hash) in [
        (
            AsosKind::Hourly,
            include_bytes!("fixtures/asos-hourly-108-20261018-20261024.json").as_slice(),
            "202610180000",
            "202610242300",
            "0f632a75700f91e629793cc742624f28ce7d325b01b26a575ccf1688772fa0c0",
        ),
        (
            AsosKind::Daily,
            include_bytes!("fixtures/asos-daily-108-20261018-20261024.json").as_slice(),
            "20261018",
            "20261024",
            "7837028411118dfc528f78ecb3c28a6f86cff4e1c77852a7c42f32eeb84ddc3f",
        ),
    ] {
        assert_eq!(server2::storage::sha256(body), hash);
        store.apply(
            "108",
            &AsosFetched {
                raw_ids: Vec::new(),
                kind,
                start: start.into(),
                end: end.into(),
                fetched_at_ms: 1.,
                pages: vec![Arc::from(body)],
            },
        );
    }
    assert!(
        store.plan("108", "20261018", "20261024").is_empty(),
        "both real ranges were acquired"
    );
    let hourly = store.read(AsosKind::Hourly, "108", "202610180000", "202610242300");
    let daily = store.read(AsosKind::Daily, "108", "20261018", "20261024");
    assert_eq!((hourly.len(), daily.len()), (168, 7));
    let raw: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/asos-hourly-108-20261018-20261024.json"
    ))
    .unwrap();
    for original in raw["response"]["body"]["items"]["item"].as_array().unwrap() {
        let key: String = original["tm"]
            .as_str()
            .unwrap()
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        let row = hourly
            .iter()
            .find(|r| r.get("key").and_then(|v| v.as_str()) == Some(key.as_str()))
            .unwrap();
        let values = row.get("values").and_then(|v| v.as_doc()).unwrap();
        let rain = values.get("rn1").and_then(|v| v.as_num());
        let pty = values.get("pty").and_then(|v| v.as_num());
        if original["rnQcflg"] == "9" {
            assert_eq!((rain, pty), (None, None), "{key}: explicit missing quality");
        } else if original["rn"] == "" {
            assert_eq!((rain, pty), (Some(0.), Some(0.)), "{key}: reported dry");
        } else {
            assert_eq!(
                rain,
                original["rn"].as_str().unwrap().parse::<f64>().ok(),
                "{key}"
            );
            assert_eq!(pty, Some(1.), "{key}: retain rain, including measured zero");
        }
    }
    assert_eq!(
        hourly
            .iter()
            .filter(|r| r
                .get("values")
                .and_then(|v| v.as_doc())
                .is_some_and(|v| v.has("pty")))
            .count(),
        124
    );
    assert_eq!(
        daily
            .iter()
            .filter(|r| r
                .get("values")
                .and_then(|v| v.as_doc())
                .is_some_and(|v| v.has("rn1")))
            .count(),
        7
    );
    assert_eq!(
        store
            .missing(
                AsosKind::Hourly,
                "108",
                &server2::domestic::kma::source::asos::range(
                    AsosKind::Hourly,
                    "20261018",
                    "20261024"
                )
            )
            .len(),
        44
    );
}

#[test]
fn recorded_winter_three_hour_totals_match_daily_values_at_the_kst_boundary() {
    let hourly_body = include_bytes!("fixtures/asos-hourly-108-20241126-20241128.json");
    let daily_body = include_bytes!("fixtures/asos-daily-108-20241126-20241128.json");
    let mut store = AsosStore::observed();
    for (kind, body, start, end, hash) in [
        (
            AsosKind::Hourly,
            hourly_body.as_slice(),
            "202411260000",
            "202411282300",
            "f8a16e10086139fd2f7b849b5929a9d70cd40c12ce6c9ce2694a5c3f402422a1",
        ),
        (
            AsosKind::Daily,
            daily_body.as_slice(),
            "20241126",
            "20241128",
            "1be9f51a966912f165291b254fa5c6d2fdcd85d0026ee71cb6f755d853979a25",
        ),
    ] {
        assert_eq!(server2::storage::sha256(body), hash);
        store.apply(
            "108",
            &AsosFetched {
                raw_ids: Vec::new(),
                kind,
                start: start.into(),
                end: end.into(),
                fetched_at_ms: 1.,
                pages: vec![Arc::from(body)],
            },
        );
    }
    let hourly = store.read(AsosKind::Hourly, "108", "202411260000", "202411282300");
    let daily = store.read(AsosKind::Daily, "108", "20241126", "20241128");
    assert_eq!((hourly.len(), daily.len()), (72, 3));
    let value = |key: &str, field: &str| {
        hourly
            .iter()
            .find(|r| r.get("key").and_then(|v| v.as_str()) == Some(key))
            .and_then(|r| r.get("values"))
            .and_then(|v| v.as_doc())
            .and_then(|v| v.get(field))
            .and_then(|v| v.as_num())
    };
    let original: serde_json::Value = serde_json::from_slice(hourly_body).unwrap();
    let mut reported = 0;
    for row in original["response"]["body"]["items"]["item"]
        .as_array()
        .unwrap()
    {
        let key: String = row["tm"]
            .as_str()
            .unwrap()
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        assert_eq!(value(&key, "rn1"), None, "{key}: not hourly amounts");
        if let Ok(amount) = row["rn"].as_str().unwrap().parse::<f64>() {
            reported += 1;
            assert_eq!(key[8..10].parse::<u32>().unwrap() % 3, 0);
            assert_eq!(value(&key, "rn3h"), Some(amount), "{key}");
        } else {
            assert_eq!(row["rnQcflg"], "9");
            assert_eq!(value(&key, "rn3h"), None, "{key}: keep QC9 unknown");
        }
    }
    assert_eq!(reported, 20);
    assert_eq!(value("202411262100", "pty"), Some(2.), "190601: sleet/rain");
    assert_eq!(value("202411270000", "pty"), Some(2.), "190605: sleet/snow");
    assert_eq!(value("202411270300", "pty"), Some(3.), "05: snow");
    assert_eq!(value("202411271800", "rn3h"), Some(0.));
    assert_eq!(value("202411271800", "pty"), None, "trace without a type");
    assert_eq!(value("202411272100", "pty"), Some(3.), "typed trace snow");

    // The following midnight belongs to the completed day's 01:00..24:00
    // precipitation window. Calendar-date 00:00..23:00 gives different totals.
    for (date, start, end, expected) in [
        ("20241126", "202411260100", "202411270000", 26.),
        ("20241127", "202411270100", "202411280000", 22.4),
    ] {
        let amounts: Vec<_> = hourly
            .iter()
            .filter_map(|row| {
                let key = row.get("key")?.as_str()?;
                if key < start || key > end {
                    return None;
                }
                value(key, "rn3h")
            })
            .collect();
        assert_eq!(amounts.len(), 8);
        assert!((amounts.iter().sum::<f64>() - expected).abs() < 1e-9);
        let official = daily
            .iter()
            .find(|r| r.get("key").and_then(|v| v.as_str()) == Some(date))
            .and_then(|r| r.get("values"))
            .and_then(|v| v.as_doc())
            .and_then(|v| v.get("rn1"))
            .and_then(|v| v.as_num());
        assert_eq!(official, Some(expected));
    }
}

/// One observation day (01:00..24:00 KST) of hourly items plus its daily row, replayed with
/// the observed policy. `hour` edits an item by hour 1..=24; `daily` edits the daily row.
fn closure_day(
    date: &str,
    hour: impl Fn(u32, &mut serde_json::Value),
    daily: impl Fn(&mut serde_json::Value),
) -> AsosStore {
    let (y, m, d): (u32, u32, u32) = (
        date[..4].parse().unwrap(),
        date[4..6].parse().unwrap(),
        date[6..].parse().unwrap(),
    );
    let mut items = Vec::new();
    for h in 1..=24 {
        let tm = if h == 24 {
            format!("{y:04}-{m:02}-{:02} 00:00", d + 1)
        } else {
            format!("{y:04}-{m:02}-{d:02} {h:02}:00")
        };
        let mut item = serde_json::json!({"stnId":"108","tm":tm,"ta":"12.0","hm":"80",
            "dc10Tca":"5","rn":"","rnQcflg":"","dmstMtphNo":""});
        hour(h, &mut item);
        items.push(item);
    }
    let mut day = serde_json::json!({"stnId":"108","tm":format!("{y:04}-{m:02}-{d:02}"),
        "minTa":"8","maxTa":"16","sumRn":"","sumRnDur":"","iscs":""});
    daily(&mut day);
    let page = |items: &[serde_json::Value]| -> Arc<[u8]> {
        Arc::from(
            serde_json::to_vec(
                &serde_json::json!({"response":{"header":{"resultCode":"00"},
                "body":{"items":{"item":items},"totalCount":items.len()}}}),
            )
            .unwrap(),
        )
    };
    let fetched = [
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Hourly,
            start: format!("{date}0100"),
            end: format!("{y:04}{m:02}{:02}0000", d + 1),
            fetched_at_ms: 1.,
            pages: vec![page(&items)],
        },
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Daily,
            start: date.into(),
            end: date.into(),
            fetched_at_ms: 2.,
            pages: vec![page(&[day])],
        },
    ];
    server2::domestic::kma::source::asos::replay_observed("108", &fetched, &[])
}
fn hour_docs(store: &AsosStore, key: &str, doc: &str) -> (Option<f64>, Option<f64>) {
    let rows = store.read(AsosKind::Hourly, "108", key, key);
    let values = rows[0].get(doc).and_then(|v| v.as_doc());
    let num = |f: &str| values.and_then(|v| v.get(f)).and_then(|v| v.as_num());
    (num("rn1"), num("pty"))
}
/// What the hour contributes: measured values, then rule-derived values for what is absent.
fn hour_values(store: &AsosStore, key: &str) -> (Option<f64>, Option<f64>) {
    let (measured, derived) = (
        hour_docs(store, key, "values"),
        hour_docs(store, key, "inferred"),
    );
    (measured.0.or(derived.0), measured.1.or(derived.1))
}
fn day_rain(store: &AsosStore, date: &str) -> Option<f64> {
    let rows = store.read(AsosKind::Daily, "108", date, date);
    rows[0]
        .get("values")
        .and_then(|v| v.as_doc())
        .and_then(|v| v.get("rn1"))
        .and_then(|v| v.as_num())
}
fn qc9(item: &mut serde_json::Value) {
    item["rnQcflg"] = "9".into();
}

#[test]
fn qc9_hours_without_a_precipitation_code_read_dry_when_the_daily_total_closes() {
    // R1b (kma-history.v1, held-out validation 2026-10-31): April-October only.
    let rainy = |h: u32, item: &mut serde_json::Value| match h {
        5 => {
            item["rn"] = "1.5".into();
            item["dmstMtphNo"] = "01".into();
        }
        6 => item["rn"] = "0.5".into(),
        10 | 20 => qc9(item),
        11 => {
            qc9(item);
            item["dmstMtphNo"] = "01".into();
        }
        12 => {
            qc9(item);
            item["dmstMtphNo"] = "14".into();
        }
        _ => (),
    };
    let store = closure_day("20261013", rainy, |d| d["sumRn"] = "2.0".into());
    assert_eq!(hour_values(&store, "202610131000"), (Some(0.), Some(0.)));
    assert_eq!(hour_values(&store, "202610132000"), (Some(0.), Some(0.)));
    assert_eq!(
        hour_values(&store, "202610131100"),
        (None, Some(1.)),
        "coded rain stays rain"
    );
    assert_eq!(
        hour_values(&store, "202610131200"),
        (None, None),
        "unsupported code stays unknown"
    );
    assert_eq!(hour_values(&store, "202610130500"), (Some(1.5), Some(1.)));
    assert_eq!(
        hour_values(&store, "202610130100"),
        (Some(0.), Some(0.)),
        "normal dry blank"
    );

    // No closure, a missing hour or a winter day leaves QC9 unknown.
    let open = closure_day("20261013", rainy, |d| d["sumRn"] = "2.5".into());
    assert_eq!(hour_values(&open, "202610131000"), (None, None));
    let unmeasured = closure_day("20261013", rainy, |d| d["sumRn"] = "".into());
    assert_eq!(hour_values(&unmeasured, "202610131000"), (None, None));
    let partial = closure_day(
        "20261013",
        |h, item| {
            rainy(h, item);
            if h == 23 {
                item["stnId"] = "109".into();
            }
        },
        |d| d["sumRn"] = "2.0".into(),
    );
    assert_eq!(hour_values(&partial, "202610131000"), (None, None));
    let winter = closure_day(
        "20260313",
        |h, item| {
            if h == 10 {
                qc9(item)
            }
        },
        |_| (),
    );
    assert_eq!(
        hour_values(&winter, "202603131000"),
        (None, None),
        "W1 is not approved"
    );

    // A blank daily total closes only a day without numeric hourly rain.
    let dry = closure_day(
        "20261013",
        |h, item| {
            if (2..=8).contains(&h) {
                qc9(item)
            }
        },
        |_| (),
    );
    for h in 2..=8 {
        assert_eq!(
            hour_values(&dry, &format!("20261013{h:02}00")),
            (Some(0.), Some(0.))
        );
    }
}

/// Hourly acquisitions in fetch order, without a daily row.
fn hours_only(acquisitions: &[Vec<serde_json::Value>]) -> AsosStore {
    let fetched: Vec<AsosFetched> = acquisitions
        .iter()
        .enumerate()
        .map(|(i, items)| {
            let key = |item: &serde_json::Value| -> String {
                item["tm"]
                    .as_str()
                    .unwrap()
                    .chars()
                    .filter(char::is_ascii_digit)
                    .collect()
            };
            AsosFetched {
                raw_ids: Vec::new(),
                kind: AsosKind::Hourly,
                start: key(&items[0]),
                end: key(&items[items.len() - 1]),
                fetched_at_ms: i as f64 + 1.,
                pages: vec![Arc::from(
                    serde_json::to_vec(
                        &serde_json::json!({"response":{"header":{"resultCode":"00"},
                        "body":{"items":{"item":items},"totalCount":items.len()}}}),
                    )
                    .unwrap(),
                )],
            }
        })
        .collect();
    server2::domestic::kma::source::asos::replay_observed("108", &fetched, &[])
}
fn wet_hour(tm: &str, ta: &str, hm: &str, code: &str) -> serde_json::Value {
    serde_json::json!({"stnId":"108","tm":tm,"ta":ta,"hm":hm,"dc10Tca":"10",
        "rn":"0.5","rnQcflg":"","dmstMtphNo":code})
}
fn pty(store: &AsosStore, key: &str) -> Option<f64> {
    hour_values(store, key).1
}

#[test]
fn an_uncoded_warm_season_amount_at_wet_bulb_five_or_more_is_rain() {
    // R2s (kma-history.v1, fourth held-out sample): temperatures are recorded originals.
    let tm = "2026-10-13 10:00";
    let key = "202610131000";
    for (ta, hm, expected, name) in [
        ("6.4", "86", Some(1.), "wet-bulb 5.01"),
        (
            "8.8",
            "54",
            None,
            "wet-bulb 4.42, recorded mixed precipitation",
        ),
        ("5.4", "87", None, "wet-bulb 4.12, recorded snow"),
        ("25", "100", Some(1.), "humidity clamps to 99"),
        ("25", "4", None, "humidity below 5"),
        ("", "80", None, "no temperature"),
        ("12", "", None, "no humidity"),
    ] {
        let store = hours_only(&[vec![wet_hour(tm, ta, hm, "")]]);
        assert_eq!(pty(&store, key), expected, "{name}");
        assert_eq!(
            hour_docs(&store, key, "values").1,
            None,
            "{name}: stays derived"
        );
    }
    let trace = serde_json::json!({"stnId":"108","tm":tm,"ta":"12","hm":"80","rn":"0.0",
        "rnQcflg":""});
    assert_eq!(
        pty(&hours_only(&[vec![trace]]), key),
        Some(1.),
        "no code field, trace amount"
    );

    // A code decides, whatever the wet-bulb temperature.
    for (code, expected) in [
        ("05", Some(3.)),
        ("01", Some(1.)),
        ("40", None),
        ("14", None),
    ] {
        assert_eq!(
            pty(&hours_only(&[vec![wet_hour(tm, "20", "90", code)]]), key),
            expected,
            "{code}"
        );
    }
    // Flagged inputs and a blank or QC9 amount are not eligible.
    for change in [
        serde_json::json!({"rnQcflg":"1"}),
        serde_json::json!({"taQcflg":"9"}),
        serde_json::json!({"hmQcflg":"1"}),
        serde_json::json!({"rn":"","rnQcflg":"9"}),
    ] {
        let mut item = wet_hour(tm, "20", "90", "");
        item.as_object_mut()
            .unwrap()
            .extend(change.as_object().unwrap().clone());
        assert_eq!(pty(&hours_only(&[vec![item.clone()]]), key), None, "{item}");
    }
    // The season follows each hour's own key.
    for (tm, key, expected) in [
        ("2026-03-31 23:00", "202603312300", None),
        ("2026-04-01 00:00", "202604010000", Some(1.)),
        ("2026-10-31 23:00", "202610312300", Some(1.)),
        ("2026-11-01 00:00", "202611010000", None),
    ] {
        assert_eq!(
            pty(&hours_only(&[vec![wet_hour(tm, "20", "90", "")]]), key),
            expected,
            "{tm}"
        );
    }
}

#[test]
fn a_recorded_code_outranks_the_wet_bulb_rule_in_any_fetch_order() {
    let (tm, key) = ("2026-10-13 10:00", "202610131000");
    let (uncoded, snow) = (wet_hour(tm, "20", "90", ""), wet_hour(tm, "20", "90", "05"));
    let later = hours_only(&[vec![uncoded.clone()], vec![snow.clone()]]);
    assert_eq!(pty(&later, key), Some(3.));
    assert_eq!(hour_docs(&later, key, "inferred").1, None);
    let earlier = hours_only(&[vec![snow], vec![uncoded]]);
    assert_eq!(pty(&earlier, key), Some(3.));
    assert_eq!(hour_docs(&earlier, key, "inferred").1, None);
}

#[test]
fn qc9_dry_hours_stay_derived_so_other_sources_can_precede_them() {
    let store = closure_day(
        "20261013",
        |h, item| {
            if h == 10 {
                qc9(item)
            }
        },
        |_| (),
    );
    assert_eq!(hour_docs(&store, "202610131000", "values"), (None, None));
    assert_eq!(
        hour_docs(&store, "202610131000", "inferred"),
        (Some(0.), Some(0.))
    );
}

#[test]
fn a_cape_station_keeps_its_measurements_but_not_its_wind() {
    let replay = |station: &str| {
        let hour = serde_json::json!({"stnId":station,"tm":"2026-10-13 10:00","ta":"12","hm":"80",
            "ws":"9.5","wd":"270","rn":"","rnQcflg":"","dmstMtphNo":""});
        let day = serde_json::json!({"stnId":station,"tm":"2026-10-13","minTa":"8","maxTa":"16",
            "avgWs":"7.5","sumRn":"","sumRnDur":"","iscs":""});
        let page = |item: serde_json::Value| -> Arc<[u8]> {
            Arc::from(
                serde_json::to_vec(
                    &serde_json::json!({"response":{"header":{"resultCode":"00"},
                    "body":{"items":{"item":[item]},"totalCount":1}}}),
                )
                .unwrap(),
            )
        };
        server2::domestic::kma::source::asos::replay_observed(
            station,
            &[
                AsosFetched {
                    raw_ids: Vec::new(),
                    kind: AsosKind::Hourly,
                    start: "202610131000".into(),
                    end: "202610131000".into(),
                    fetched_at_ms: 1.,
                    pages: vec![page(hour)],
                },
                AsosFetched {
                    raw_ids: Vec::new(),
                    kind: AsosKind::Daily,
                    start: "20261013".into(),
                    end: "20261013".into(),
                    fetched_at_ms: 2.,
                    pages: vec![page(day)],
                },
            ],
            &[],
        )
    };
    let values = |store: &AsosStore, station: &str, kind, key: &str, field: &str| {
        store.read(kind, station, key, key)[0]
            .get("values")
            .and_then(|v| v.as_doc())
            .and_then(|v| v.get(field))
            .and_then(|v| v.as_num())
    };
    let cape = replay("185");
    assert_eq!(
        values(&cape, "185", AsosKind::Hourly, "202610131000", "wsd"),
        None
    );
    assert_eq!(
        values(&cape, "185", AsosKind::Hourly, "202610131000", "vec"),
        None
    );
    assert_eq!(
        values(&cape, "185", AsosKind::Daily, "20261013", "wsd"),
        None
    );
    assert_eq!(
        values(&cape, "185", AsosKind::Hourly, "202610131000", "t1h"),
        Some(12.)
    );
    let inland = replay("108");
    assert_eq!(
        values(&inland, "108", AsosKind::Hourly, "202610131000", "wsd"),
        Some(9.5)
    );
    assert_eq!(
        values(&inland, "108", AsosKind::Daily, "20261013", "wsd"),
        Some(7.5)
    );
}

#[test]
fn qc9_closure_skips_a_day_whose_stored_values_differ_from_the_latest_original() {
    // An earlier acquisition measured 1.0 mm at 10:00; the later full day reports QC9 there.
    let page = |items: Vec<serde_json::Value>| -> Arc<[u8]> {
        Arc::from(
            serde_json::to_vec(
                &serde_json::json!({"response":{"header":{"resultCode":"00"},
                "body":{"items":{"item":items},"totalCount":1}}}),
            )
            .unwrap(),
        )
    };
    let item = |tm: &str, rn: &str, flag: &str| {
        serde_json::json!({"stnId":"108","tm":tm,"ta":"12.0","hm":"80","dc10Tca":"5",
            "rn":rn,"rnQcflg":flag,"dmstMtphNo":""})
    };
    let day: Vec<_> = (1..=24)
        .map(|h| match h {
            24 => item("2026-10-14 00:00", "", ""),
            10 => item("2026-10-13 10:00", "", "9"),
            _ => item(&format!("2026-10-13 {h:02}:00"), "", ""),
        })
        .collect();
    let hourly = |at: f64, start: &str, end: &str, items: Vec<serde_json::Value>| AsosFetched {
        raw_ids: Vec::new(),
        kind: AsosKind::Hourly,
        start: start.into(),
        end: end.into(),
        fetched_at_ms: at,
        pages: vec![page(items)],
    };
    let fetched = [
        hourly(
            1.,
            "202610131000",
            "202610131000",
            vec![item("2026-10-13 10:00", "1.0", "")],
        ),
        hourly(2., "202610130100", "202610140000", day),
        AsosFetched {
            raw_ids: Vec::new(),
            kind: AsosKind::Daily,
            start: "20261013".into(),
            end: "20261013".into(),
            fetched_at_ms: 3.,
            pages: vec![page(vec![
                serde_json::json!({"stnId":"108","tm":"2026-10-13",
                "minTa":"8","maxTa":"16","sumRn":"","sumRnDur":"","iscs":"{박무}0100-0200."}),
            ])],
        },
    ];
    let store = server2::domestic::kma::source::asos::replay_observed("108", &fetched, &[]);
    assert_eq!(hour_values(&store, "202610131000"), (Some(1.), None));
    assert_eq!(day_rain(&store, "20261013"), None, "D1 skips the same day");
}

#[test]
fn a_blank_daily_total_is_dry_when_no_hour_measured_or_coded_precipitation() {
    // D1: non-precipitation journal entries no longer block the dry total.
    let mist = |d: &mut serde_json::Value| d["iscs"] = "{박무}0100-0730.".into();
    assert_eq!(
        day_rain(&closure_day("20261013", |_, _| (), mist), "20261013"),
        Some(0.)
    );
    assert_eq!(
        day_rain(
            &closure_day(
                "20260113",
                |h, item| if h == 3 {
                    qc9(item)
                },
                mist
            ),
            "20260113"
        ),
        Some(0.),
        "winter days too"
    );
    for (name, hour) in [
        (
            "numeric trace",
            (|h: u32, item: &mut serde_json::Value| {
                if h == 4 {
                    item["rn"] = "0.0".into()
                }
            }) as fn(u32, &mut serde_json::Value),
        ),
        ("precipitation code", |h, item| {
            if h == 4 {
                item["dmstMtphNo"] = "01".into()
            }
        }),
        ("unsupported code", |h, item| {
            if h == 4 {
                item["dmstMtphNo"] = "14".into()
            }
        }),
    ] {
        assert_eq!(
            day_rain(&closure_day("20261013", hour, mist), "20261013"),
            None,
            "{name}"
        );
    }
    let lasting = |d: &mut serde_json::Value| {
        d["iscs"] = "{박무}0100-0730.".into();
        d["sumRnDur"] = "1.5".into();
    };
    assert_eq!(
        day_rain(&closure_day("20261013", |_, _| (), lasting), "20261013"),
        None
    );
    let partial = closure_day(
        "20261013",
        |h, item| {
            if h == 7 {
                item["stnId"] = "109".into()
            }
        },
        mist,
    );
    assert_eq!(
        day_rain(&partial, "20261013"),
        None,
        "all 24 hours are required"
    );
}
