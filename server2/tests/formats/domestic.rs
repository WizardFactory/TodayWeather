//! AirKorea, KASI area rise/set and forecast-zone acquisition over real loopback HTTP.
use super::common::*;
use super::support::*;
use server2::domestic::airkorea::{AirKoreaOperation, AirKoreaRequest, SIDOS};
use server2::domestic::family::Service;
use server2::domestic::riseset::{AREAS, RiseSetRequest};
use server2::domestic::zone::ZoneRequest;
use server2::domestic::{Acquired, DomesticError};
use server2::providers::Disposition;
use server2::storage::{Pagination, Period, ProviderKey};

fn station(sido: &str) -> AirKoreaRequest {
    AirKoreaRequest::new(AirKoreaOperation::Station, sido).unwrap()
}
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

#[tokio::test]
async fn airkorea_station_fixture_is_one_exact_record_with_legacy_arguments() {
    let e = env().await;
    let body = local("airkorea-stations.json");
    e.stub.push(STATION, Reply::json(body.clone()));
    let a = complete(
        e.acquirer
            .acquire_airkorea(&station("서울"), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 1);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    let id = &r.envelope.identity;
    assert_eq!(
        (id.source.as_str(), id.kind.as_str()),
        ("data-go-kr", "airkorea-station")
    );
    // Newest row data time 2026-09-30 00:00 KST.
    assert_eq!(
        id.period,
        Period {
            local_date: 20260930,
            slot: "0000".into()
        }
    );
    assert_eq!(
        r.envelope.pagination,
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true
        })
    );
    let key = ProviderKey::Named {
        id: "sido-seoul".into(),
    };
    assert_eq!(
        id.key_sha256,
        server2::storage::sha256(&key.canonical_bytes().unwrap())
    );
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].path, format!("/{STATION}"));
    // Legacy airkoreaObservation.buildUrl: serviceKey, returnType=json, sidoName, pageNo,
    // numOfRows=100, ver=1.3 (no dataType).
    assert_eq!(
        sorted(pairs(&calls[0])),
        owned(&[
            ("serviceKey", KEY_A),
            ("returnType", "json"),
            ("sidoName", "서울"),
            ("pageNo", "1"),
            ("numOfRows", "100"),
            ("ver", "1.3"),
        ])
    );
}

#[tokio::test]
async fn airkorea_sido_fixture_maps_24_00_to_the_next_day() {
    let e = env().await;
    let body = local("airkorea-sido.json");
    e.stub.push(SIDO, Reply::json(body.clone()));
    let request = AirKoreaRequest::new(AirKoreaOperation::Sido, "서울").unwrap();
    let a = complete(e.acquirer.acquire_airkorea(&request, deadline()).await);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    assert_eq!(r.envelope.identity.kind, "airkorea-sido");
    assert_eq!(
        r.envelope.identity.period,
        Period {
            local_date: 20260930,
            slot: "0000".into()
        }
    );
    assert_eq!(
        sorted(pairs(&e.stub.calls()[0])),
        owned(&[
            ("serviceKey", KEY_A),
            ("returnType", "json"),
            ("sidoName", "서울"),
            ("pageNo", "1"),
            ("numOfRows", "100"),
            ("searchCondition", "HOUR"),
        ])
    );
}

#[tokio::test]
async fn airkorea_pages_become_one_ordered_group() {
    let e = env().await;
    let (one, two) = (
        airkorea_page(1, 150, 100, "부산"),
        airkorea_page(2, 150, 50, "부산"),
    );
    e.stub.push(STATION, Reply::json(one.clone()));
    e.stub.push(STATION, Reply::json(two.clone()));
    let a = complete(
        e.acquirer
            .acquire_airkorea(&station("부산"), deadline())
            .await,
    );
    assert_eq!(a.records.len(), 2);
    for (i, (r, b)) in a.records.iter().zip([&one, &two]).enumerate() {
        assert_eq!(&r.bytes[..], &b[..]);
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
}

fn not_complete(outcome: &Result<Acquired, DomesticError>) -> bool {
    !matches!(outcome, Ok(Acquired::Complete(_)))
}

#[tokio::test]
async fn airkorea_invalid_or_incomplete_sets_never_become_records() {
    let row = |name: &str, sido: &str, time: &str| serde_json::json!({"stationName": name, "sidoName": sido, "dataTime": time, "pm10Value": "20"});
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        (
            "total changed on page 2",
            vec![airkorea_page(1, 150, 100, "서울"), airkorea_page(2, 151, 51, "서울")],
        ),
        (
            "short page 2",
            vec![airkorea_page(1, 150, 100, "서울"), airkorea_page(2, 150, 49, "서울")],
        ),
        (
            "duplicate across pages",
            vec![
                airkorea_page(1, 101, 100, "서울"),
                airkorea_envelope(vec![row("측정소0", "서울", "2026-10-13 13:00")], 2, 101),
            ],
        ),
        (
            "foreign sido",
            vec![airkorea_envelope(vec![row("중구", "부산", "2026-10-13 13:00")], 1, 1)],
        ),
        (
            "bad data time",
            vec![airkorea_envelope(vec![row("중구", "서울", "2026-10-13 24:30")], 1, 1)],
        ),
        (
            "blank identity",
            vec![airkorea_envelope(vec![row(" ", "서울", "2026-10-13 13:00")], 1, 1)],
        ),
        (
            "no usable concentration",
            vec![airkorea_envelope(
                vec![serde_json::json!({"stationName": "중구", "sidoName": "서울", "dataTime": "2026-10-13 13:00", "pm10Value": "-"})],
                1,
                1,
            )],
        ),
        (
            "items.item object form",
            vec![br#"{"response":{"header":{"resultCode":"00"},"body":{"pageNo":1,"numOfRows":100,"totalCount":1,"items":{"item":{"stationName":"a","dataTime":"2026-10-13 13:00","pm10Value":"1"}}}}}"#.to_vec()],
        ),
        (
            "page echo mismatch",
            vec![airkorea_envelope(vec![row("중구", "서울", "2026-10-13 13:00")], 2, 1)],
        ),
        ("total over 2000", vec![airkorea_page(1, 2001, 100, "서울")]),
        ("provider code 05", vec![result_code("05")]),
    ];
    for (name, pages) in cases {
        let e = env().await;
        for p in &pages {
            // Each page may be retried once (invalid body); serve it twice.
            e.stub.push(STATION, Reply::json(p.clone()));
            e.stub.push(STATION, Reply::json(p.clone()));
        }
        let outcome = e
            .acquirer
            .acquire_airkorea(&station("서울"), deadline())
            .await;
        assert!(not_complete(&outcome), "{name}: {outcome:?}");
    }
}

/// S13a-R2-F01: an overflowing decimal string is not a usable concentration (legacy
/// `Number(value)` is Infinity), for station and sido operations.
#[tokio::test]
async fn airkorea_overflowing_concentration_is_not_usable() {
    let huge = "9".repeat(400);
    for (operation, path, identity) in [
        (AirKoreaOperation::Station, STATION, "stationName"),
        (AirKoreaOperation::Sido, SIDO, "cityName"),
    ] {
        let e = env().await;
        let mut row = serde_json::json!({"sidoName": "서울", "dataTime": "2026-10-13 13:00", "pm10Value": huge});
        row[identity] = "중구".into();
        let body = airkorea_envelope(vec![row], 1, 1);
        e.stub.push(path, Reply::json(body.clone()));
        e.stub.push(path, Reply::json(body));
        let request = AirKoreaRequest::new(operation, "서울").unwrap();
        let outcome = e.acquirer.acquire_airkorea(&request, deadline()).await;
        assert!(not_complete(&outcome), "{operation:?}: {outcome:?}");
    }
}

#[tokio::test]
async fn airkorea_total_zero_is_terminal_no_data_after_one_attempt() {
    let e = env().await;
    e.stub
        .push(STATION, Reply::json(airkorea_envelope(Vec::new(), 1, 0)));
    let outcome = e
        .acquirer
        .acquire_airkorea(&station("서울"), deadline())
        .await;
    assert!(matches!(outcome, Ok(Acquired::NoData)), "{outcome:?}");
    assert_eq!(e.stub.calls().len(), 1);
}

/// Legacy master (#2737) `withKeys`: start with the last configured key, skip a rejected
/// credential to the previous key. Since S13c (#2745) quota also moves to the previous key.
#[tokio::test]
async fn airkorea_rejected_key_follows_legacy_key_selection() {
    for (name, reply, expected, keys) in [
        (
            "401 text",
            Reply::with(401, "text/plain", "Unauthorized"),
            Disposition::Auth,
            vec![KEY_B, KEY_A],
        ),
        // S13c (#2745): quota moves to the next key; every key at quota fails as quota.
        (
            "quota xml",
            Reply::with(200, "text/xml", fixture_s13("gateway-quota.xml")),
            Disposition::Quota,
            vec![KEY_B, KEY_A],
        ),
        (
            "gateway 30",
            Reply::json(fixture_s13("gateway-30.json")),
            Disposition::Auth,
            vec![KEY_B, KEY_A],
        ),
    ] {
        let e = env_keys(&[(KEY_A, '5'), (KEY_B, '6')], &[(KEY_A, 'a'), (KEY_B, 'b')]).await;
        e.stub.push(STATION, reply.clone());
        e.stub.push(STATION, reply);
        let outcome = e
            .acquirer
            .acquire_airkorea(&station("서울"), deadline())
            .await;
        assert!(
            matches!(outcome, Err(DomesticError::Provider(d)) if d == expected),
            "{name}: {outcome:?}"
        );
        let used: Vec<String> = e
            .stub
            .calls()
            .iter()
            .map(|c| c.get("serviceKey").unwrap().to_owned())
            .collect();
        assert_eq!(used, keys, "{name}");
        // Only a success is remembered.
        assert_eq!(
            e.acquirer.ring(Service::AirKorea).unwrap().preferred(),
            None,
            "{name}"
        );
    }
}

fn fixture_s13(name: &str) -> Vec<u8> {
    super::support::fixture(name)
}

#[test]
fn request_targets_follow_the_legacy_lists() {
    assert_eq!(SIDOS.len(), 17);
    assert_eq!(AREAS.len(), 102);
    assert!(AirKoreaRequest::new(AirKoreaOperation::Station, "서울특별시").is_err());
    assert!(RiseSetRequest::new("서울", 20261013).is_ok());
    assert!(RiseSetRequest::new("고성(강원)", 20261013).is_ok());
    assert!(RiseSetRequest::new("Seoul", 20261013).is_err());
    assert!(RiseSetRequest::new("서울", 20261332).is_err());
}

#[tokio::test]
async fn rise_set_rotates_a_rejected_key_and_stores_the_exact_item() {
    let e = env().await;
    e.stub.push(
        KASI,
        Reply::with(401, "application/json", fixture_s13("gateway-30.json")),
    );
    let body = local("kasi-area-seoul.json");
    e.stub.push(KASI, Reply::json(body.clone()));
    let request = RiseSetRequest::new("서울", 20261013).unwrap();
    let a = complete(e.acquirer.acquire_rise_set(&request, deadline()).await);
    assert_eq!(a.records.len(), 1);
    let r = &a.records[0];
    assert_eq!(&r.bytes[..], &body[..]);
    let id = &r.envelope.identity;
    assert_eq!(id.kind, "kasi-area-rise-set");
    assert_eq!(id.period.local_date, 20261013);
    let key = ProviderKey::Named {
        id: format!(
            "area-{}",
            "서울"
                .bytes()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        ),
    };
    assert_eq!(
        id.key_sha256,
        server2::storage::sha256(&key.canonical_bytes().unwrap())
    );
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 2);
    // Legacy _makeAreaApiUrl: location, locdate, _type=json, ServiceKey.
    assert_eq!(
        sorted(pairs(&calls[1])),
        owned(&[
            ("location", "서울"),
            ("locdate", "20261013"),
            ("_type", "json"),
            ("ServiceKey", KEY_B),
        ])
    );
    assert_eq!(calls[0].get("ServiceKey"), Some(KEY_A));
    assert!(
        calls
            .iter()
            .all(|c| c.get("serviceKey").is_none() && c.get("dataType").is_none())
    );
    assert_eq!(e.acquirer.ring(Service::RiseSet).unwrap().current(), 1);
}

#[tokio::test]
async fn rise_set_rejects_wrong_echoes_and_missing_fields() {
    let base: serde_json::Value = serde_json::from_slice(&local("kasi-area-seoul.json")).unwrap();
    let edit = |f: &dyn Fn(&mut serde_json::Value)| {
        let mut v = base.clone();
        f(&mut v);
        serde_json::to_vec(&v).unwrap()
    };
    let cases = vec![
        (
            "other area",
            edit(&|v| v["response"]["body"]["items"]["item"]["location"] = "부산".into()),
        ),
        (
            "other day",
            edit(&|v| v["response"]["body"]["items"]["item"]["locdate"] = 20261014.into()),
        ),
        (
            "missing sunset",
            edit(&|v| {
                v["response"]["body"]["items"]["item"]
                    .as_object_mut()
                    .unwrap()
                    .remove("sunset");
            }),
        ),
        (
            "null field",
            edit(&|v| v["response"]["body"]["items"]["item"]["moonset"] = serde_json::Value::Null),
        ),
        (
            "two items",
            edit(&|v| v["response"]["body"]["items"]["item"] = serde_json::json!([{}, {}])),
        ),
        (
            "result 99",
            edit(&|v| v["response"]["header"]["resultCode"] = "99".into()),
        ),
        (
            "no items",
            edit(&|v| v["response"]["body"]["items"] = "".into()),
        ),
    ];
    for (name, body) in cases {
        let e = env().await;
        e.stub.push(KASI, Reply::json(body.clone()));
        e.stub.push(KASI, Reply::json(body));
        let request = RiseSetRequest::new("서울", 20261013).unwrap();
        let outcome = e.acquirer.acquire_rise_set(&request, deadline()).await;
        assert!(not_complete(&outcome), "{name}: {outcome:?}");
    }
}

#[tokio::test]
async fn gateway_and_quota_bodies_never_become_records_for_any_new_family() {
    for (name, reply) in [
        (
            "quota xml",
            Reply::with(200, "text/xml", fixture_s13("gateway-quota.xml")),
        ),
        ("auth json", Reply::json(fixture_s13("gateway-30.json"))),
        ("429", Reply::with(429, "text/plain", "Too Many Requests")),
        (
            "html",
            Reply::with(200, "text/html", "<html><body>error</body></html>"),
        ),
    ] {
        let e = env().await;
        for path in [STATION, KASI, ZONE] {
            for _ in 0..2 {
                e.stub.push(path, reply.clone());
            }
        }
        let a = e
            .acquirer
            .acquire_airkorea(&station("서울"), deadline())
            .await;
        let k = e
            .acquirer
            .acquire_rise_set(&RiseSetRequest::new("서울", 20261013).unwrap(), deadline())
            .await;
        let z = e
            .acquirer
            .acquire_zones(&ZoneRequest::new(), deadline())
            .await;
        for (family, outcome) in [("airkorea", &a), ("kasi", &k), ("zone", &z)] {
            assert!(not_complete(outcome), "{name} {family}: {outcome:?}");
        }
    }
}
