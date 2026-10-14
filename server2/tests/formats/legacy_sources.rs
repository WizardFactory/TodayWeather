//! S13b: AirKorea dust forecast and station list (legacy #2737) and the data.go.kr
//! forecast-zone list (legacy #2740) over real loopback HTTP.
use super::common::*;
use super::support::*;
use serde_json::{Value, json};
use server2::domestic::airkorea::{AirKoreaOperation, AirKoreaRequest};
use server2::domestic::family::Service;
use server2::domestic::publication::{Publication, dust_forecast_announcement};
use server2::domestic::zone::ZoneRequest;
use server2::domestic::{Acquired, DomesticError};
use server2::providers::Disposition;
use server2::storage::{Pagination, Period, ProviderKey};

fn sorted(mut v: Vec<(String, String)>) -> Vec<(String, String)> {
    v.sort();
    v
}
fn owned(v: &[(&str, &str)]) -> Vec<(String, String)> {
    sorted(
        v.iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect(),
    )
}
fn not_complete(outcome: &Result<Acquired, DomesticError>) -> bool {
    !matches!(outcome, Ok(Acquired::Complete(_)))
}
fn forecast() -> AirKoreaRequest {
    AirKoreaRequest::dust_forecast(20261013).unwrap()
}
fn key_hash(id: &str) -> String {
    let key = ProviderKey::Named { id: id.into() };
    server2::storage::sha256(&key.canonical_bytes().unwrap())
}
fn json_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}
/// AirKorea envelope with every paging field (legacy `envelope`).
fn airkorea(items: Vec<Value>, page: u32, size: u32, total: u32) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "response": {
            "body": {"totalCount": total, "items": items, "pageNo": page, "numOfRows": size},
            "header": {"resultMsg": "NORMAL_CODE", "resultCode": "00"}
        }
    }))
    .unwrap()
}
fn forecast_items() -> Vec<Value> {
    json_of(&local("airkorea-forecast.json"))["response"]["body"]["items"]
        .as_array()
        .unwrap()
        .clone()
}
fn station_items() -> Vec<Value> {
    json_of(&local("airkorea-station-list.json"))["response"]["body"]["items"]
        .as_array()
        .unwrap()
        .clone()
}
/// `n` distinct stations in the legacy list shape.
fn stations(from: u32, n: u32) -> Vec<Value> {
    (from..from + n)
        .map(|i| {
            let mut item = station_items()[0].clone();
            item["stationName"] = format!("측정소{i}").into();
            item
        })
        .collect()
}
fn keys_used(e: &Env) -> Vec<String> {
    e.stub
        .calls()
        .iter()
        .map(|c| c.get("serviceKey").unwrap_or("").to_owned())
        .collect()
}
fn gateway(code: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"OpenAPI_ServiceResponse": {"cmmMsgHeader": {
        "errMsg": "SERVICE ERROR", "returnAuthMsg": "synthetic", "returnReasonCode": code}}}))
    .unwrap()
}
fn envelope_code(code: &str) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": code, "resultMsg": "synthetic"}}}),
    )
    .unwrap()
}

#[tokio::test]
async fn dust_forecast_fixture_is_one_exact_record_with_legacy_arguments() {
    let e = env().await;
    let body = local("airkorea-forecast.json");
    e.stub.push(FORECAST, Reply::json(body.clone()));
    let a = complete(e.acquirer.acquire_airkorea(&forecast(), deadline()).await);
    assert_eq!(a.records.len(), 1);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    let id = &r.envelope.identity;
    assert_eq!(
        (id.source.as_str(), id.kind.as_str()),
        ("data-go-kr", "airkorea-dust-forecast")
    );
    // Newest announcement on the search date: 2026-10-13 23시 발표.
    assert_eq!(
        id.period,
        Period {
            local_date: 20261013,
            slot: "2300".into()
        }
    );
    assert_eq!(id.key_sha256, key_hash("dust-forecast"));
    assert_eq!(a.declaration.partitions[0].partition, "20261013");
    assert_eq!(
        r.envelope.pagination,
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true
        })
    );
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].path, format!("/{FORECAST}"));
    // Legacy operationUrl(FORECAST, key, {searchDate, pageNo, numOfRows}) + ver=1.1.
    assert_eq!(
        sorted(calls[0].query.clone()),
        owned(&[
            ("serviceKey", KEY_A),
            ("returnType", "json"),
            ("searchDate", "2026-10-13"),
            ("pageNo", "1"),
            ("numOfRows", "100"),
            ("ver", "1.1"),
        ])
    );
}

#[tokio::test]
async fn dust_forecast_pages_become_one_ordered_group() {
    let e = env().await;
    let template = forecast_items()[0].clone();
    let items: Vec<Value> = (0..130)
        .map(|i| {
            let mut item = template.clone();
            item["informCode"] = format!("CODE{i}").into();
            item
        })
        .collect();
    let pages = [
        airkorea(items[..100].to_vec(), 1, 100, 130),
        airkorea(items[100..].to_vec(), 2, 100, 130),
    ];
    for p in &pages {
        e.stub.push(FORECAST, Reply::json(p.clone()));
    }
    let a = complete(e.acquirer.acquire_airkorea(&forecast(), deadline()).await);
    assert_eq!(a.records.len(), 2);
    for (i, (r, p)) in a.records.iter().zip(&pages).enumerate() {
        assert_eq!(&r.bytes[..], &p[..]);
        assert_eq!(r.envelope.pagination.as_ref().unwrap().page, i as u32 + 1);
        assert_eq!(r.envelope.pagination.as_ref().unwrap().pages, 2);
    }
    let pages: Vec<_> = e
        .stub
        .calls()
        .iter()
        .map(|c| c.get("pageNo").unwrap().to_owned())
        .collect();
    assert_eq!(pages, ["1", "2"]);
}

#[tokio::test]
async fn dust_forecast_invalid_or_incomplete_pages_never_become_records() {
    let items = forecast_items();
    let edit = |f: &dyn Fn(&mut Value)| {
        let mut v = items.clone();
        f(&mut v[0]);
        airkorea(v, 1, 100, 4)
    };
    let cases: Vec<(&str, Vec<u8>)> = vec![
        // Observed 2026-10-13: 10 of 28 items without numOfRows.
        (
            "provider default paging",
            airkorea(items.clone(), 1, 10, 28),
        ),
        (
            "missing informGrade",
            edit(&|i| {
                i.as_object_mut().unwrap().remove("informGrade");
            }),
        ),
        (
            "numeric informGrade",
            edit(&|i| i["informGrade"] = 3.into()),
        ),
        ("blank informCode", edit(&|i| i["informCode"] = " ".into())),
        (
            "missing informData",
            edit(&|i| {
                i.as_object_mut().unwrap().remove("informData");
            }),
        ),
        ("null item", edit(&|i| *i = Value::Null)),
        ("array item", edit(&|i| *i = json!([]))),
        (
            "credential echo",
            edit(&|i| i["serviceKey"] = "echoed-secret".into()),
        ),
        ("no announcement on the search date", {
            let v: Vec<Value> = items
                .iter()
                .map(|i| {
                    let mut i = i.clone();
                    i["dataTime"] = "2026-10-12 23시 발표".into();
                    i
                })
                .collect();
            airkorea(v, 1, 100, 4)
        }),
        ("items object form", {
            let mut v = json_of(&local("airkorea-forecast.json"));
            v["response"]["body"]["items"] = json!({"item": items.clone()});
            serde_json::to_vec(&v).unwrap()
        }),
        ("provider error code", envelope_code("05")),
    ];
    for (name, body) in cases {
        let e = env().await;
        e.stub.push(FORECAST, Reply::json(body.clone()));
        e.stub.push(FORECAST, Reply::json(body));
        let outcome = e.acquirer.acquire_airkorea(&forecast(), deadline()).await;
        assert!(not_complete(&outcome), "{name}: {outcome:?}");
    }
    // 03 and an empty list are terminal no data after one attempt.
    for body in [envelope_code("03"), airkorea(Vec::new(), 1, 100, 0)] {
        let e = env().await;
        e.stub.push(FORECAST, Reply::json(body));
        let outcome = e.acquirer.acquire_airkorea(&forecast(), deadline()).await;
        assert!(matches!(outcome, Ok(Acquired::NoData)), "{outcome:?}");
        assert_eq!(e.stub.calls().len(), 1);
    }
    // A blank serviceKey echo (the old sample shape) is not a credential.
    let e = env().await;
    let mut v = items.clone();
    v[0]["serviceKey"] = "".into();
    e.stub.push(FORECAST, Reply::json(airkorea(v, 1, 100, 4)));
    complete(e.acquirer.acquire_airkorea(&forecast(), deadline()).await);
}

#[test]
fn dust_forecast_announcement_follows_check_data_time() {
    for ((d, h, m), want) in [
        ((14, 0, 0), (20261013, 2300)),
        ((14, 4, 59), (20261013, 2300)),
        ((14, 5, 0), (20261014, 500)),
        ((14, 10, 59), (20261014, 500)),
        ((14, 11, 0), (20261014, 1100)),
        ((14, 16, 59), (20261014, 1100)),
        ((14, 17, 0), (20261014, 1700)),
        ((14, 22, 59), (20261014, 1700)),
        ((14, 23, 0), (20261014, 2300)),
    ] {
        assert_eq!(
            dust_forecast_announcement(kst(2026, 10, d, h, m)),
            Publication::new(want.0, want.1),
            "{d} {h}:{m}"
        );
    }
    assert!(AirKoreaRequest::dust_forecast(20261332).is_err());
    assert_eq!(
        AirKoreaRequest::dust_forecast(20261013)
            .unwrap()
            .operation(),
        AirKoreaOperation::DustForecast
    );
    assert_eq!(
        AirKoreaRequest::station_list().operation(),
        AirKoreaOperation::StationList
    );
}

#[tokio::test]
async fn station_list_fixture_is_one_exact_record_without_ver() {
    let e = env().await;
    let body = local("airkorea-station-list.json");
    e.stub.push(STATION_LIST, Reply::json(body.clone()));
    let a = complete(
        e.acquirer
            .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 1);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    let id = &r.envelope.identity;
    assert_eq!(
        (id.source.as_str(), id.kind.as_str()),
        ("data-go-kr", "airkorea-station-list")
    );
    // KST fetch day.
    assert_eq!(
        id.period,
        Period {
            local_date: 20261013,
            slot: "0000".into()
        }
    );
    assert_eq!(id.key_sha256, key_hash("stations"));
    assert_eq!(a.declaration.partitions[0].partition, "20261013");
    let calls = e.stub.calls();
    assert_eq!(calls[0].path, format!("/{STATION_LIST}"));
    // No `ver`: dmX stays latitude and dmY longitude (legacy parseMsrstnList).
    assert_eq!(
        sorted(calls[0].query.clone()),
        owned(&[
            ("serviceKey", KEY_A),
            ("returnType", "json"),
            ("pageNo", "1"),
            ("numOfRows", "100"),
        ])
    );
}

#[tokio::test]
async fn station_list_pages_and_item_rules_follow_legacy() {
    // Two complete pages; numeric coordinates, empty coordinates and a null address pass.
    let e = env().await;
    let mut first = stations(0, 100);
    first[0]["dmX"] = 37.5.into();
    first[0]["dmY"] = 127.into();
    first[1]["dmX"] = "".into();
    first[1]["dmY"] = "".into();
    first[2]["addr"] = Value::Null;
    first[3].as_object_mut().unwrap().remove("addr");
    let pages = [
        airkorea(first, 1, 100, 120),
        airkorea(stations(100, 20), 2, 100, 120),
    ];
    for p in &pages {
        e.stub.push(STATION_LIST, Reply::json(p.clone()));
    }
    let a = complete(
        e.acquirer
            .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 2);
    for (r, p) in a.records.iter().zip(&pages) {
        assert_eq!(&r.bytes[..], &p[..]);
    }

    let one = |f: &dyn Fn(&mut Value)| {
        let mut v = station_items();
        f(&mut v[0]);
        vec![airkorea(v, 1, 100, 3)]
    };
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        ("blank stationName", one(&|i| i["stationName"] = "".into())),
        ("object dmX", one(&|i| i["dmX"] = json!({}))),
        (
            "missing dmY",
            one(&|i| {
                i.as_object_mut().unwrap().remove("dmY");
            }),
        ),
        ("numeric addr", one(&|i| i["addr"] = 123.into())),
        (
            "credential echo",
            one(&|i| i["serviceKey"] = "echoed-secret".into()),
        ),
        ("null item", one(&|i| *i = Value::Null)),
        (
            "repeated item across pages",
            vec![
                airkorea(stations(0, 100), 1, 100, 101),
                airkorea(stations(0, 1), 2, 100, 101),
            ],
        ),
        (
            "changed total",
            vec![
                airkorea(stations(0, 100), 1, 100, 150),
                airkorea(stations(100, 51), 2, 100, 151),
            ],
        ),
        (
            "total over 2000",
            vec![airkorea(stations(0, 100), 1, 100, 2001)],
        ),
    ];
    for (name, pages) in cases {
        let e = env().await;
        // Pages in order; the last one again for the retry of an invalid page.
        for p in pages.iter().chain(pages.last()) {
            e.stub.push(STATION_LIST, Reply::json(p.clone()));
        }
        let outcome = e
            .acquirer
            .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
            .await;
        assert!(not_complete(&outcome), "{name}: {outcome:?}");
    }
}

/// Legacy master `withKeys` for every AirKorea operation: the last key first, a rejected
/// credential moves to the previous key and restarts page 1, success is remembered and shared.
#[tokio::test]
async fn airkorea_keys_follow_legacy_with_keys() {
    let three = [(KEY_A, '5'), (KEY_B, '6'), (KEY_C, '7')];
    let others = [(KEY_A, 'a'), (KEY_B, 'b')];
    let list = AirKoreaRequest::station_list;

    // The last key is expired (401/31): the previous key answers and is remembered.
    let e = env_keys(&three, &others).await;
    e.stub.push(
        STATION_LIST,
        Reply::with(401, "application/json", gateway("31")),
    );
    e.stub.push(
        STATION_LIST,
        Reply::json(local("airkorea-station-list.json")),
    );
    complete(e.acquirer.acquire_airkorea(&list(), deadline()).await);
    assert_eq!(keys_used(&e), [KEY_C, KEY_B]);
    let ring = e.acquirer.ring(Service::AirKorea).unwrap();
    assert_eq!(ring.preferred(), Some(1));
    // The remembered key serves the next call of any AirKorea operation.
    e.stub
        .push(FORECAST, Reply::json(local("airkorea-forecast.json")));
    complete(e.acquirer.acquire_airkorea(&forecast(), deadline()).await);
    assert_eq!(keys_used(&e)[2], KEY_B);
    // A non-credential failure keeps the key.
    e.stub
        .push(FORECAST, Reply::with(500, "text/plain", "busy"));
    e.stub
        .push(FORECAST, Reply::with(500, "text/plain", "busy"));
    let outcome = e.acquirer.acquire_airkorea(&forecast(), deadline()).await;
    assert!(
        matches!(
            outcome,
            Err(DomesticError::Provider(Disposition::Retryable))
        ),
        "{outcome:?}"
    );
    assert_eq!(&keys_used(&e)[3..], [KEY_B, KEY_B]);
    assert_eq!(ring.preferred(), Some(1));

    // A rejection on page 2 restarts the operation from page 1 with the previous key.
    let e = env_keys(&three, &others).await;
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)),
    );
    e.stub.push(STATION_LIST, Reply::json(envelope_code("30")));
    let pages = [
        airkorea(stations(0, 100), 1, 100, 120),
        airkorea(stations(100, 20), 2, 100, 120),
    ];
    for p in &pages {
        e.stub.push(STATION_LIST, Reply::json(p.clone()));
    }
    let a = complete(e.acquirer.acquire_airkorea(&list(), deadline()).await);
    assert_eq!(a.records.len(), 2);
    let calls: Vec<(String, String)> = e
        .stub
        .calls()
        .iter()
        .map(|c| {
            (
                c.get("serviceKey").unwrap().to_owned(),
                c.get("pageNo").unwrap().to_owned(),
            )
        })
        .collect();
    let want: Vec<(String, String)> = [(KEY_C, "1"), (KEY_C, "2"), (KEY_B, "1"), (KEY_B, "2")]
        .iter()
        .map(|(k, p)| (k.to_string(), p.to_string()))
        .collect();
    assert_eq!(calls, want);

    // Every key rejected: Auth after one call per key, nothing remembered.
    let e = env_keys(&three, &others).await;
    for _ in 0..3 {
        e.stub.push(
            STATION_LIST,
            Reply::with(403, "application/json", gateway("30")),
        );
    }
    let outcome = e.acquirer.acquire_airkorea(&list(), deadline()).await;
    assert!(
        matches!(outcome, Err(DomesticError::Provider(Disposition::Auth))),
        "{outcome:?}"
    );
    assert_eq!(keys_used(&e), [KEY_C, KEY_B, KEY_A]);
    assert_eq!(
        e.acquirer.ring(Service::AirKorea).unwrap().preferred(),
        None
    );

    // Quota (also with 401/403) tries each key once (S13c); other explicit codes stop on the first key.
    for (reply, expected, keys) in [
        (
            Reply::json(envelope_code("22")),
            Disposition::Quota,
            vec![KEY_C, KEY_B, KEY_A],
        ),
        (
            Reply::with(401, "application/json", envelope_code("22")),
            Disposition::Quota,
            vec![KEY_C, KEY_B, KEY_A],
        ),
        (
            Reply::with(403, "application/json", gateway("22")),
            Disposition::Quota,
            vec![KEY_C, KEY_B, KEY_A],
        ),
        (
            Reply::with(401, "application/json", envelope_code("99")),
            Disposition::Rejected,
            vec![KEY_C],
        ),
        (
            Reply::with(429, "text/plain", "Too Many Requests"),
            Disposition::Quota,
            vec![KEY_C, KEY_B, KEY_A],
        ),
    ] {
        let e = env_keys(&three, &others).await;
        for _ in 0..3 {
            e.stub.push(STATION_LIST, reply.clone());
        }
        let outcome = e.acquirer.acquire_airkorea(&list(), deadline()).await;
        assert!(
            matches!(outcome, Err(DomesticError::Provider(d)) if d == expected),
            "{outcome:?}"
        );
        assert_eq!(keys_used(&e), keys);
    }

    // Station and sido operations use the same rule.
    let e = env_keys(&three, &others).await;
    e.stub
        .push(STATION, Reply::with(401, "application/json", gateway("31")));
    e.stub
        .push(STATION, Reply::json(local("airkorea-stations.json")));
    let station = AirKoreaRequest::new(AirKoreaOperation::Station, "서울").unwrap();
    complete(e.acquirer.acquire_airkorea(&station, deadline()).await);
    assert_eq!(keys_used(&e), [KEY_C, KEY_B]);
}

/// Synthetic getFcstZoneCd page (per-page `totalCount`, legacy test helper shape).
fn zone_page(ids: &[String], page: u32) -> Vec<u8> {
    let items: Vec<Value> = ids
        .iter()
        .map(|id| {
            json!({"regId": id, "lat": 37.5, "lon": 127.0, "regEn": "", "regName": format!("Z{id}"),
                "regSp": "C", "regUp": "11B00000", "seq": 1, "stnF3": 0,
                "tmEd": 210012310000u64, "tmSt": 199001010000u64})
        })
        .collect();
    zone_items(items, page)
}
fn zone_items(items: Vec<Value>, page: u32) -> Vec<u8> {
    let total = items.len();
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": page,
            "numOfRows": 1000, "totalCount": total}}}))
    .unwrap()
}
fn ids(prefix: &str, n: usize) -> Vec<String> {
    (0..n).map(|i| format!("{prefix}{i:04}")).collect()
}

#[tokio::test]
async fn forecast_zone_list_is_one_exact_record_with_data_go_kr_arguments() {
    let e = env().await;
    let body = local("forecast-zone.json");
    e.stub.push(ZONE, Reply::json(body.clone()));
    let a = complete(
        e.acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 1);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    let id = &r.envelope.identity;
    assert_eq!(
        (id.source.as_str(), id.kind.as_str()),
        ("data-go-kr", "forecast-zone")
    );
    assert_eq!(
        id.period,
        Period {
            local_date: 20261013,
            slot: "0000".into()
        }
    );
    assert_eq!(id.key_sha256, key_hash("forecast-zones"));
    assert_eq!(a.declaration.partitions[0].partition, "20261013");
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].path, format!("/{ZONE}"));
    // Legacy _getKmaApiUrl: serviceKey, numOfRows=1000, pageNo, dataType=JSON.
    assert_eq!(
        sorted(calls[0].query.clone()),
        owned(&[
            ("serviceKey", KEY_A),
            ("numOfRows", "1000"),
            ("pageNo", "1"),
            ("dataType", "JSON"),
        ])
    );
}

#[tokio::test]
async fn forecast_zone_full_pages_continue_until_a_short_page_or_03() {
    // 1000 + 5 items.
    let e = env().await;
    let all = ids("11Z", 1005);
    let pages = [zone_page(&all[..1000], 1), zone_page(&all[1000..], 2)];
    for p in &pages {
        e.stub.push(ZONE, Reply::json(p.clone()));
    }
    let a = complete(
        e.acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 2);
    for (i, (r, p)) in a.records.iter().zip(&pages).enumerate() {
        assert_eq!(&r.bytes[..], &p[..]);
        assert_eq!(
            r.envelope.pagination,
            Some(Pagination {
                page: i as u32 + 1,
                pages: 2,
                complete: true
            })
        );
    }
    let pages: Vec<_> = e
        .stub
        .calls()
        .iter()
        .map(|c| c.get("pageNo").unwrap().to_owned())
        .collect();
    assert_eq!(pages, ["1", "2"]);

    // 1000 + 03: the 03 page ends the list and is not a record.
    let e = env().await;
    let first = zone_page(&ids("11Y", 1000), 1);
    e.stub.push(ZONE, Reply::json(first.clone()));
    e.stub.push(ZONE, Reply::json(envelope_code("03")));
    let a = complete(
        e.acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 1);
    assert_eq!(&a.records[0].bytes[..], &first[..]);
    assert_eq!(
        a.records[0].envelope.pagination,
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true
        })
    );
    assert_eq!(e.stub.calls().len(), 2);
}

#[tokio::test]
async fn forecast_zone_invalid_or_incomplete_lists_never_become_records() {
    let base = json_of(&local("forecast-zone.json"));
    let edit = |f: &dyn Fn(&mut Value)| {
        let mut v = base.clone();
        f(&mut v);
        vec![serde_json::to_vec(&v).unwrap()]
    };
    let item =
        |f: &dyn Fn(&mut Value)| edit(&|v| f(&mut v["response"]["body"]["items"]["item"][0]));
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        (
            "pageNo echo",
            edit(&|v| v["response"]["body"]["pageNo"] = 2.into()),
        ),
        (
            "missing pageNo",
            edit(&|v| {
                v["response"]["body"]
                    .as_object_mut()
                    .unwrap()
                    .remove("pageNo");
            }),
        ),
        (
            "numOfRows echo",
            edit(&|v| v["response"]["body"]["numOfRows"] = 999.into()),
        ),
        (
            "totalCount",
            edit(&|v| v["response"]["body"]["totalCount"] = 755.into()),
        ),
        (
            "result code",
            edit(&|v| v["response"]["header"]["resultCode"] = "01".into()),
        ),
        (
            "numeric result code",
            edit(&|v| v["response"]["header"]["resultCode"] = 0.into()),
        ),
        (
            "object item",
            edit(&|v| {
                v["response"]["body"]["items"]["item"] =
                    json!({"regId": "11B10101", "regName": "서울", "regSp": "C"})
            }),
        ),
        (
            "empty list",
            edit(&|v| {
                v["response"]["body"]["items"]["item"] = json!([]);
                v["response"]["body"]["totalCount"] = 0.into();
            }),
        ),
        (
            "duplicate regId",
            edit(&|v| {
                let first = v["response"]["body"]["items"]["item"][0].clone();
                v["response"]["body"]["items"]["item"][1] = first;
            }),
        ),
        ("blank regId", item(&|i| i["regId"] = "".into())),
        (
            "missing regName",
            item(&|i| {
                i.as_object_mut().unwrap().remove("regName");
            }),
        ),
        ("numeric regSp", item(&|i| i["regSp"] = 1.into())),
        ("object text field", item(&|i| i["regEn"] = json!({}))),
        ("tmEd text", item(&|i| i["tmEd"] = "abc".into())),
        ("tmSt negative", item(&|i| i["tmSt"] = (-1).into())),
        ("tmEd fraction", item(&|i| i["tmEd"] = 1.5.into())),
        ("seq text", item(&|i| i["seq"] = "bad number".into())),
        ("ht overflow", item(&|i| i["ht"] = "9".repeat(400).into())),
        ("longitude range", item(&|i| i["lon"] = 200.into())),
        ("latitude range", item(&|i| i["lat"] = (-91).into())),
        ("lat text", item(&|i| i["lat"] = "north".into())),
        (
            "duplicate across pages",
            vec![
                zone_page(&ids("11X", 1000), 1),
                zone_page(&ids("11X", 1), 2),
            ],
        ),
        (
            "eleventh page",
            (1..=10)
                .map(|p| zone_page(&ids(&format!("{p:02}P"), 1000), p))
                .collect(),
        ),
    ];
    for (name, pages) in cases {
        let e = env().await;
        // Pages in order; the last one again for the retry of an invalid page.
        for p in pages.iter().chain(pages.last()) {
            e.stub.push(ZONE, Reply::json(p.clone()));
        }
        let outcome = e
            .acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await;
        assert!(not_complete(&outcome), "{name}: {outcome:?}");
    }
    // Accepted legacy values: digit strings, numbers as text fields, absent or zero coordinates.
    let e = env().await;
    let mut v = base.clone();
    let i = &mut v["response"]["body"]["items"]["item"][0];
    i["tmEd"] = "210012310000".into();
    i["seq"] = "-1.5".into();
    i["regUp"] = 11.into();
    i["ht"] = Value::Null;
    i.as_object_mut().unwrap().remove("lat");
    e.stub
        .push(ZONE, Reply::json(serde_json::to_vec(&v).unwrap()));
    complete(
        e.acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    // 03 on page 1 is terminal no data.
    let e = env().await;
    e.stub.push(ZONE, Reply::json(envelope_code("03")));
    let outcome = e
        .acquirer
        .acquire_zones(&ZoneRequest::new(), deadline())
        .await;
    assert!(matches!(outcome, Ok(Acquired::NoData)), "{outcome:?}");
}

#[tokio::test]
async fn forecast_zone_rotates_a_rejected_key_like_2604() {
    let e = env().await;
    e.stub
        .push(ZONE, Reply::with(403, "application/json", gateway("30")));
    let body = local("forecast-zone.json");
    e.stub.push(ZONE, Reply::json(body.clone()));
    let a = complete(
        e.acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await,
    );
    assert_eq!(&a.records[0].bytes[..], &body[..]);
    assert_eq!(keys_used(&e), [KEY_A, KEY_B]);
    assert_eq!(e.acquirer.ring(Service::ForecastZone).unwrap().current(), 1);
    assert!(
        e.stub
            .calls()
            .iter()
            .all(|c| c.get("ServiceKey").is_none() && c.get("type").is_none())
    );
}

/// S13B-R1-01: only a regular JSON `response.header.resultCode "03"` ends the zone list; a
/// gateway or XML `03` after a full page fails the whole list.
#[tokio::test]
async fn forecast_zone_list_end_must_be_the_regular_03_envelope() {
    for (name, end) in [
        ("gateway 03", Reply::json(gateway("03"))),
        (
            "xml 03",
            Reply::with(
                200,
                "text/xml",
                "<response><header><resultCode>03</resultCode></header></response>",
            ),
        ),
    ] {
        let e = env().await;
        e.stub
            .push(ZONE, Reply::json(zone_page(&ids("11W", 1000), 1)));
        e.stub.push(ZONE, end);
        let outcome = e
            .acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await;
        assert!(
            matches!(outcome, Err(DomesticError::Incomplete(_))),
            "{name}: {outcome:?}"
        );
    }
}

/// S13B-R1-02/03: an unread 401/403 body is a retryable download failure that keeps the key;
/// a 200 gateway body with only the legacy expired/unregistered marker rejects the key.
#[tokio::test]
async fn airkorea_unread_rejections_keep_and_markers_move_the_key() {
    let three = [(KEY_A, '5'), (KEY_B, '6'), (KEY_C, '7')];
    let others = [(KEY_A, 'a'), (KEY_B, 'b')];
    // A content type over the S08 bound makes the transport drop the body.
    let unread = Reply::with(401, &"x".repeat(600), gateway("31"));
    let e = env_keys(&three, &others).await;
    e.stub.push(STATION_LIST, unread.clone());
    e.stub.push(STATION_LIST, unread);
    let outcome = e
        .acquirer
        .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
        .await;
    assert!(
        matches!(
            outcome,
            Err(DomesticError::Provider(Disposition::Retryable))
        ),
        "{outcome:?}"
    );
    assert_eq!(keys_used(&e), [KEY_C, KEY_C]);
    assert_eq!(
        e.acquirer.ring(Service::AirKorea).unwrap().preferred(),
        None
    );

    for marker in [
        Reply::with(200, "text/plain", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"),
        Reply::json(
            r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE ERROR","returnAuthMsg":"DEADLINE_HAS_EXPIRED_ERROR"}}}"#,
        ),
    ] {
        let e = env_keys(&three, &others).await;
        e.stub.push(STATION_LIST, marker);
        e.stub.push(
            STATION_LIST,
            Reply::json(local("airkorea-station-list.json")),
        );
        complete(
            e.acquirer
                .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
                .await,
        );
        assert_eq!(keys_used(&e), [KEY_C, KEY_B]);
    }
}

/// 2026-10-14 00:00 KST, the end of the KST day of `NOW_MS`.
const KST_MIDNIGHT: i64 = 1_791_903_600_000;
const THREE: [(&str, char); 3] = [(KEY_A, '5'), (KEY_B, '6'), (KEY_C, '7')];
const OTHERS: [(&str, char); 2] = [(KEY_A, 'a'), (KEY_B, 'b')];
fn seoul() -> AirKoreaRequest {
    AirKoreaRequest::new(AirKoreaOperation::Station, "서울").unwrap()
}
/// The provider's answer for a key at its daily limit, recorded live on 2026-10-14 (S13c).
fn live_quota() -> Reply {
    Reply::with(429, "application/json", local("airkorea-quota-429.json"))
}

/// S13c (#2745): a key at its daily quota is skipped until the end of its KST day and the same
/// request continues with the next key in the legacy order; the working key is remembered.
#[tokio::test]
async fn airkorea_quota_moves_to_the_next_key_and_is_remembered() {
    let e = env_keys(&THREE, &OTHERS).await;
    e.stub.push(STATION, live_quota());
    e.stub
        .push(STATION, Reply::json(local("airkorea-stations.json")));
    complete(e.acquirer.acquire_airkorea(&seoul(), deadline()).await);
    assert_eq!(keys_used(&e), [KEY_C, KEY_B]);
    let ring = e.acquirer.ring(Service::AirKorea).unwrap();
    assert_eq!(ring.preferred(), Some(1));
    assert!(ring.exhausted(2, KST_MIDNIGHT - 1));
    assert!(!ring.exhausted(2, KST_MIDNIGHT));
    // Every attempt was funded before HTTP: one call per key, two units reserved per call.
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.funded_calls, m.funded_attempts, m.attempts_quota),
        (2, 2, 1)
    );
    assert_eq!(m.reserved_units, 4);

    // The remembered key serves the next operation first.
    e.stub
        .push(FORECAST, Reply::json(local("airkorea-forecast.json")));
    complete(e.acquirer.acquire_airkorea(&forecast(), deadline()).await);
    assert_eq!(keys_used(&e)[2], KEY_B);

    // A later credential failure skips the exhausted key without a call and reports quota.
    e.stub
        .push(STATION, Reply::with(401, "application/json", gateway("31")));
    e.stub
        .push(STATION, Reply::with(403, "application/json", gateway("30")));
    let outcome = e.acquirer.acquire_airkorea(&seoul(), deadline()).await;
    assert!(
        matches!(outcome, Err(DomesticError::Provider(Disposition::Quota))),
        "{outcome:?}"
    );
    assert_eq!(&keys_used(&e)[3..], [KEY_B, KEY_A]);
}

#[tokio::test]
async fn airkorea_every_quota_form_moves_to_the_next_key() {
    for (name, reply) in [
        ("live 429 gateway json", live_quota()),
        (
            "429 text",
            Reply::with(429, "text/plain", "Too Many Requests"),
        ),
        ("200 envelope 22", Reply::json(envelope_code("22"))),
        (
            "401 envelope 22",
            Reply::with(401, "application/json", envelope_code("22")),
        ),
        (
            "403 gateway 22",
            Reply::with(403, "application/json", gateway("22")),
        ),
        (
            "200 gateway xml",
            Reply::with(200, "text/xml", fixture("gateway-quota.xml")),
        ),
    ] {
        let e = env_keys(&THREE, &OTHERS).await;
        e.stub.push(STATION, reply);
        e.stub
            .push(STATION, Reply::json(local("airkorea-stations.json")));
        complete(e.acquirer.acquire_airkorea(&seoul(), deadline()).await);
        assert_eq!(keys_used(&e), [KEY_C, KEY_B], "{name}");
    }
    // The per-second limit (23) is not a daily quota: it stops on the first key.
    let e = env_keys(&THREE, &OTHERS).await;
    for _ in 0..3 {
        e.stub.push(STATION, Reply::json(envelope_code("23")));
    }
    let outcome = e.acquirer.acquire_airkorea(&seoul(), deadline()).await;
    assert!(not_complete(&outcome), "{outcome:?}");
    assert_eq!(keys_used(&e)[0], KEY_C);
    assert!(keys_used(&e).iter().all(|k| k == KEY_C));
}

/// Every key at quota: one call per key and `Provider(Quota)`; no HTTP or funding for the rest
/// of the KST day; the next KST day probes again.
#[tokio::test]
async fn airkorea_all_keys_at_quota_wait_for_the_next_kst_day() {
    let e = env_keys(&THREE, &OTHERS).await;
    for _ in 0..3 {
        e.stub.push(STATION, live_quota());
    }
    let outcome = e.acquirer.acquire_airkorea(&seoul(), deadline()).await;
    assert!(
        matches!(outcome, Err(DomesticError::Provider(Disposition::Quota))),
        "{outcome:?}"
    );
    assert_eq!(keys_used(&e), [KEY_C, KEY_B, KEY_A]);
    let ring = e.acquirer.ring(Service::AirKorea).unwrap();
    assert_eq!(ring.preferred(), None);
    let funded = e.metrics.snapshot().reserved_units;

    e.clock
        .0
        .store(KST_MIDNIGHT - 1, std::sync::atomic::Ordering::SeqCst);
    for request in [seoul(), forecast(), AirKoreaRequest::station_list()] {
        let outcome = e.acquirer.acquire_airkorea(&request, deadline()).await;
        assert!(
            matches!(outcome, Err(DomesticError::Provider(Disposition::Quota))),
            "{outcome:?}"
        );
    }
    assert_eq!(e.stub.calls().len(), 3);
    assert_eq!(e.metrics.snapshot().reserved_units, funded);

    e.clock
        .0
        .store(KST_MIDNIGHT, std::sync::atomic::Ordering::SeqCst);
    e.stub
        .push(STATION, Reply::json(local("airkorea-stations.json")));
    complete(e.acquirer.acquire_airkorea(&seoul(), deadline()).await);
    assert_eq!(keys_used(&e)[3..], [KEY_C]);
}

/// Quota on page 2 restarts the operation with the next key; no key repeats a page.
#[tokio::test]
async fn airkorea_quota_on_a_later_page_restarts_with_the_next_key() {
    let e = env_keys(&THREE, &OTHERS).await;
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)),
    );
    e.stub.push(STATION_LIST, live_quota());
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)),
    );
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(100, 20), 2, 100, 120)),
    );
    let a = complete(
        e.acquirer
            .acquire_airkorea(&AirKoreaRequest::station_list(), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 2);
    let calls: Vec<String> = e
        .stub
        .calls()
        .iter()
        .map(|c| {
            format!(
                "{}@{}",
                c.get("serviceKey").unwrap(),
                c.get("pageNo").unwrap()
            )
        })
        .collect();
    assert_eq!(
        calls,
        [
            format!("{KEY_C}@1"),
            format!("{KEY_C}@2"),
            format!("{KEY_B}@1"),
            format!("{KEY_B}@2")
        ]
    );
}

/// Wall clock that replays scripted readings once armed, then keeps the last one.
struct ScriptedClock {
    now: std::sync::atomic::AtomicI64,
    script: std::sync::Mutex<std::collections::VecDeque<i64>>,
}
impl server2::budget::Clock for ScriptedClock {
    fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
        use std::sync::atomic::Ordering::SeqCst;
        if let Some(v) = self.script.lock().unwrap().pop_front() {
            self.now.store(v, SeqCst);
        }
        Ok(self.now.load(SeqCst))
    }
}

/// Review S13C-R1: a page recheck that finds the key already exhausted by a parallel call must not
/// re-mark it. Scripted readings put the recheck one millisecond before KST midnight and the next
/// reading at midnight, where a re-mark would extend the exhaustion by a whole day.
#[tokio::test]
async fn airkorea_recheck_skip_never_extends_an_exhaustion_across_kst_midnight() {
    use server2::budget::BudgetStore;
    use server2::domestic::family::Endpoints;
    use server2::domestic::metrics::DomesticMetrics;
    use server2::domestic::{DomesticAcquirer, KeyRing};
    use server2::providers::{HttpProviderTransport, HttpPublicTransport};
    use std::sync::Arc;
    let stub = Stub::start().await;
    let clk = Arc::new(ScriptedClock {
        now: std::sync::atomic::AtomicI64::new(NOW_MS),
        script: Default::default(),
    });
    let wire = Arc::new(Memory::default());
    let entries = THREE
        .iter()
        .map(|(k, owner)| {
            (
                server2::providers::ProviderKey::new((*k).into()).unwrap(),
                Arc::new(
                    BudgetStore::new(wire.clone(), policy(*owner, 1000), clk.clone()).unwrap(),
                ),
            )
        })
        .collect();
    let mut rings = std::collections::BTreeMap::new();
    rings.insert(Service::AirKorea, KeyRing::new(entries).unwrap());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
        clk.clone(),
        Arc::new(DomesticMetrics::default()),
        server2::storage::CatalogLimits::default(),
    )
    .unwrap();
    stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)).delayed(300),
    );
    stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)),
    );
    stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(100, 20), 2, 100, 120)),
    );
    stub.push(FORECAST, live_quota());
    stub.push(FORECAST, Reply::json(local("airkorea-forecast.json")));
    let list = AirKoreaRequest::station_list();
    let parallel = async {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // Exhausts the last key at NOW_MS: until KST midnight.
        complete(acquirer.acquire_airkorea(&forecast(), deadline()).await);
        // The station list then reads the clock for its first page's fetch time, for the page 2
        // recheck and, if the key were re-marked, once more.
        clk.script
            .lock()
            .unwrap()
            .extend([KST_MIDNIGHT - 2, KST_MIDNIGHT - 1, KST_MIDNIGHT]);
    };
    let (stations, ()) = tokio::join!(acquirer.acquire_airkorea(&list, deadline()), parallel);
    complete(stations);
    let ring = acquirer.ring(Service::AirKorea).unwrap();
    assert!(ring.exhausted(2, KST_MIDNIGHT - 1));
    assert!(
        !ring.exhausted(2, KST_MIDNIGHT),
        "the exhaustion must still end at KST midnight"
    );
}

/// An acquisition that is paging with a key stops using it once a parallel acquisition marks it
/// exhausted, and restarts with the next key (legacy #2745 review R-1).
#[tokio::test]
async fn airkorea_key_exhausted_by_a_parallel_call_is_not_used_for_later_pages() {
    let e = env_keys(&THREE, &OTHERS).await;
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)).delayed(300),
    );
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(0, 100), 1, 100, 120)),
    );
    e.stub.push(
        STATION_LIST,
        Reply::json(airkorea(stations(100, 20), 2, 100, 120)),
    );
    e.stub.push(FORECAST, live_quota());
    e.stub
        .push(FORECAST, Reply::json(local("airkorea-forecast.json")));
    let list = AirKoreaRequest::station_list();
    let late = async {
        // Let the station list send its first page before the forecast sees quota.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        e.acquirer.acquire_airkorea(&forecast(), deadline()).await
    };
    let (stations, forecast) = tokio::join!(e.acquirer.acquire_airkorea(&list, deadline()), late);
    complete(forecast);
    assert_eq!(complete(stations).records.len(), 2);
    let pages: Vec<String> = e
        .stub
        .calls()
        .iter()
        .filter(|c| c.path.ends_with("getMsrstnList"))
        .map(|c| {
            format!(
                "{}@{}",
                c.get("serviceKey").unwrap(),
                c.get("pageNo").unwrap()
            )
        })
        .collect();
    assert_eq!(
        pages,
        [
            format!("{KEY_C}@1"),
            format!("{KEY_B}@1"),
            format!("{KEY_B}@2")
        ]
    );
}
