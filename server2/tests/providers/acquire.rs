//! Funded/keyless acquisition over real loopback HTTP with a volatile budget peer.
use super::support::*;
use server2::budget::BudgetError;
use server2::domestic::family::{
    DataGoKrFamily as F, DataGoKrRequest, Endpoints, Service, Target, WebRequest,
};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticAcquirer, DomesticError, KeyRing};
use server2::providers::{Disposition, HttpProviderTransport, HttpPublicTransport};
use server2::resolver::Acquisition;
use server2::storage::{CatalogLimits, Pagination, Period, ProviderKey};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::time::Instant;

const VILAGE: &str = "1360000/VilageFcstInfoService_2.0/getVilageFcst";
const SHORTEST: &str = "1360000/VilageFcstInfoService_2.0/getUltraSrtFcst";
const UV: &str = "1360000/LivingWthrIdxServiceV5/getUVIdxV5";
const RSS: &str = "wid/queryDFS.jsp";
const AWS: &str = "cgi-bin/aws/nph-aws_txt_min";
const CITY: &str = "weather/observation/currentweather.jsp";
const NOW_MS: i64 = 1_791_000_000_000;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
struct Env {
    stub: Stub,
    acquirer: DomesticAcquirer<HttpProviderTransport, HttpPublicTransport, Memory>,
    metrics: Arc<DomesticMetrics>,
}
async fn env_with(keys: &[(&str, char)], limit_a: Option<u64>) -> Env {
    let stub = Stub::start().await;
    let wire = Arc::new(Memory::default());
    let clk = clock(NOW_MS);
    let mut rings = BTreeMap::new();
    let owners = [
        (Service::VilageFcst, ['a', 'b']),
        (Service::MidFcst, ['c', 'd']),
        (Service::LivingWthrIdx, ['1', '2']),
        (Service::HealthWthrIdx, ['3', '4']),
    ];
    for (service, owner) in owners {
        let entries: Vec<(&str, char)> = keys
            .iter()
            .enumerate()
            .map(|(i, (k, _))| (*k, owner[i]))
            .collect();
        rings.insert(service, ring(wire.clone(), clk.clone(), &entries));
    }
    if let Some(limit) = limit_a {
        let mut tight = policy('e', limit);
        tight.block_units = limit;
        let store = server2::budget::BudgetStore::new(wire.clone(), tight, clk.clone()).unwrap();
        rings.insert(
            Service::VilageFcst,
            KeyRing::new(vec![(
                server2::providers::ProviderKey::new(KEY_A.into()).unwrap(),
                Arc::new(store),
            )])
            .unwrap(),
        );
    }
    let metrics = Arc::new(DomesticMetrics::default());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
        clk,
        metrics.clone(),
        CatalogLimits::default(),
    )
    .unwrap();
    Env {
        stub,
        acquirer,
        metrics,
    }
}
async fn env() -> Env {
    env_with(&[(KEY_A, 'a'), (KEY_B, 'b')], None).await
}
fn vilage() -> DataGoKrRequest {
    DataGoKrRequest::new(
        F::VilageFcst,
        Target::Grid { nx: 60, ny: 127 },
        p(20261013, 1400),
    )
    .unwrap()
}
fn complete(outcome: Result<Acquired, DomesticError>) -> Acquisition {
    match outcome {
        Ok(Acquired::Complete(a)) => a,
        other => panic!("expected complete acquisition, got {other:?}"),
    }
}
fn page(n: u32, total: u32) -> Vec<u8> {
    vilage_page(n, total, 999, ("20261013", "1400"), (60, 127))
}

#[tokio::test]
async fn paged_short_forecast_becomes_one_complete_ordered_group() {
    let e = env().await;
    let (one, two) = (page(1, 1068), page(2, 1068));
    e.stub.push(VILAGE, Reply::json(one.clone()));
    e.stub.push(VILAGE, Reply::json(two.clone()));
    let a = complete(e.acquirer.acquire(&vilage(), deadline()).await);
    assert_eq!(a.records.len(), 2);
    for (i, (record, bytes)) in a.records.iter().zip([&one, &two]).enumerate() {
        assert_eq!(&record.bytes[..], &bytes[..]);
        let env = &record.envelope;
        assert_eq!(
            env.pagination,
            Some(Pagination {
                page: i as u32 + 1,
                pages: 2,
                complete: true
            })
        );
        assert_eq!(
            (env.identity.source.as_str(), env.identity.kind.as_str()),
            ("data-go-kr", "vilage-fcst")
        );
        assert_eq!(
            env.identity.period,
            Period {
                local_date: 20261013,
                slot: "1400".into()
            }
        );
        assert_eq!(env.identity.fetched_at_ms, NOW_MS as u64);
        assert_eq!(env.content_type, "application/json;charset=UTF-8");
        assert_eq!(env.status, 200);
    }
    assert_eq!(a.declaration.partitions.len(), 1);
    assert_eq!(a.declaration.partitions[0].partition, "20261013-1400");
    a.declaration.validate(&CatalogLimits::default()).unwrap();
    let key = server2::storage::sha256(
        &ProviderKey::Grid { nx: 60, ny: 127 }
            .canonical_bytes()
            .unwrap(),
    );
    assert_eq!(a.declaration.partitions[0].key_sha256, key);
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 2);
    for (i, call) in calls.iter().enumerate() {
        assert_eq!(call.path, format!("/{VILAGE}"));
        assert_eq!(call.get("pageNo"), Some(if i == 0 { "1" } else { "2" }));
        assert_eq!(call.get("numOfRows"), Some("999"));
        assert_eq!(call.get("dataType"), Some("JSON"));
        assert_eq!(call.get("serviceKey"), Some(KEY_A));
        assert_eq!(
            (call.get("base_date"), call.get("base_time")),
            (Some("20261013"), Some("1400"))
        );
    }
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.funded_calls, m.funded_attempts, m.attempts_data),
        (2, 2, 2)
    );
    // Each page call pre-funds two units on the current key and one on the rotation key.
    assert_eq!(m.reserved_units, 6);
    assert_eq!((m.groups_complete, m.groups_incomplete), (1, 0));
    assert!(
        e.metrics
            .render()
            .contains("server2_domestic_funded_attempts_total 2\n")
    );
}

#[tokio::test]
async fn single_page_is_complete_with_one_of_one() {
    let e = env().await;
    e.stub.push(VILAGE, Reply::json(page(1, 50)));
    let a = complete(e.acquirer.acquire(&vilage(), deadline()).await);
    assert_eq!(a.records.len(), 1);
    assert_eq!(
        a.records[0].envelope.pagination,
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true
        })
    );
}

#[tokio::test]
async fn incomplete_page_sets_never_produce_records() {
    // Short second page: invalid twice (one funded retry), then the whole set is discarded.
    let e = env().await;
    let mut short = serde_json::from_slice::<serde_json::Value>(&page(2, 1068)).unwrap();
    short["response"]["body"]["items"]["item"]
        .as_array_mut()
        .unwrap()
        .truncate(60);
    e.stub.push(VILAGE, Reply::json(page(1, 1068)));
    e.stub
        .push(VILAGE, Reply::json(serde_json::to_vec(&short).unwrap()));
    e.stub
        .push(VILAGE, Reply::json(serde_json::to_vec(&short).unwrap()));
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Retryable))),
        "{r:?}"
    );
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.funded_attempts, m.groups_complete, m.groups_incomplete),
        (3, 0, 1)
    );

    // Duplicate rows across individually valid pages.
    let e = env().await;
    let one = page(1, 1068);
    let mut dup = serde_json::from_slice::<serde_json::Value>(&page(2, 1068)).unwrap();
    let first: serde_json::Value = serde_json::from_slice(&one).unwrap();
    let rows = dup["response"]["body"]["items"]["item"]
        .as_array_mut()
        .unwrap();
    rows[0] = first["response"]["body"]["items"]["item"][0].clone();
    e.stub.push(VILAGE, Reply::json(one));
    e.stub
        .push(VILAGE, Reply::json(serde_json::to_vec(&dup).unwrap()));
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(matches!(r, Err(DomesticError::Incomplete(_))), "{r:?}");
    assert_eq!(e.stub.calls().len(), 2);

    // No data after the first page.
    let e = env().await;
    e.stub.push(VILAGE, Reply::json(page(1, 1068)));
    e.stub.push(VILAGE, Reply::json(result_code("03")));
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(matches!(r, Err(DomesticError::Incomplete(_))), "{r:?}");

    // More pages than the family allows: rejected after the first page, no page 2 request.
    let e = env().await;
    e.stub.push(VILAGE, Reply::json(page(1, 999 * 5 + 1)));
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(matches!(r, Err(DomesticError::Incomplete(_))), "{r:?}");
    assert_eq!(e.stub.calls().len(), 1);
    assert_eq!(e.metrics.snapshot().groups_incomplete, 1);
}

#[tokio::test]
async fn gateway_quota_rotates_and_the_ring_stays_on_the_working_key() {
    let e = env().await;
    let json_quota =
        br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"22"}}}"#.to_vec();
    e.stub.push(VILAGE, Reply::json(json_quota));
    e.stub.push(VILAGE, Reply::json(page(1, 50)));
    complete(e.acquirer.acquire(&vilage(), deadline()).await);
    assert_eq!(e.stub.keys(), vec![KEY_A, KEY_B]);
    // #2604 stickiness: the next call starts with the key that worked.
    e.stub.push(
        VILAGE,
        Reply::with(200, "text/xml", fixture("gateway-quota.xml")),
    );
    e.stub.push(VILAGE, Reply::json(page(1, 50)));
    complete(e.acquirer.acquire(&vilage(), deadline()).await);
    assert_eq!(e.stub.keys(), vec![KEY_A, KEY_B, KEY_B, KEY_A]);
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.attempts_quota, m.attempts_data, m.funded_attempts),
        (2, 2, 4)
    );
    // Other services keep their own position.
    e.stub.push(UV, Reply::json(result_code("99")));
    let uv = DataGoKrRequest::new(F::UvIdxV5, Target::AllAreas, p(20261013, 1200)).unwrap();
    assert!(matches!(
        e.acquirer.acquire(&uv, deadline()).await,
        Ok(Acquired::NoData)
    ));
    assert_eq!(e.stub.keys().last().map(String::as_str), Some(KEY_A));
}

#[tokio::test]
async fn auth_on_every_key_is_terminal_and_stores_nothing() {
    let e = env().await;
    e.stub.push(VILAGE, Reply::json(fixture("gateway-30.json")));
    e.stub.push(
        VILAGE,
        Reply::with(401, "text/xml", fixture("gateway-quota.xml")),
    );
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Quota))),
        "{r:?}"
    );
    assert_eq!(e.stub.keys(), vec![KEY_A, KEY_B]);
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.attempts_auth, m.attempts_quota, m.groups_complete),
        (1, 1, 0)
    );

    let single = env_with(&[(KEY_A, 'a')], None).await;
    single
        .stub
        .push(VILAGE, Reply::json(fixture("gateway-30.json")));
    let r = single.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Auth))),
        "{r:?}"
    );
    assert_eq!(single.stub.calls().len(), 1);
    assert_eq!(single.metrics.snapshot().reserved_units, 2);
}

#[tokio::test]
async fn late_publication_uses_one_funded_attempt_and_is_not_stored() {
    for (body, expected) in [
        (result_code("03"), "not-published"),
        (empty_items(), "not-published"),
        (
            vilage_page(1, 50, 999, ("20261013", "1100"), (60, 127)),
            "stale",
        ),
    ] {
        let e = env().await;
        e.stub.push(VILAGE, Reply::json(body));
        let r = e.acquirer.acquire(&vilage(), deadline()).await;
        match (expected, &r) {
            ("not-published", Ok(Acquired::NotPublished)) => {}
            ("stale", Ok(Acquired::Stale(found))) => assert_eq!(*found, p(20261013, 1100)),
            _ => panic!("{expected}: {r:?}"),
        }
        assert_eq!(e.stub.calls().len(), 1);
        let m = e.metrics.snapshot();
        assert_eq!(
            (m.funded_attempts, m.attempts_no_data, m.groups_complete),
            (1, 1, 0)
        );
    }
    // Ultra-short HH30 request answered with HH00 is canonical data, not late.
    let e = env().await;
    e.stub.push(
        SHORTEST,
        Reply::json(vilage_page(1, 60, 999, ("20261013", "1400"), (60, 127))),
    );
    let r = DataGoKrRequest::new(
        F::UltraSrtFcst,
        Target::Grid { nx: 60, ny: 127 },
        p(20261013, 1430),
    )
    .unwrap();
    let a = complete(e.acquirer.acquire(&r, deadline()).await);
    assert_eq!(a.records[0].envelope.identity.period.slot, "1400");
    assert_eq!(e.stub.calls()[0].get("base_time"), Some("1430"));
}

#[tokio::test]
async fn deterministic_rejections_retries_deadline_and_funding() {
    let e = env().await;
    e.stub.push(
        VILAGE,
        Reply::json(
            br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"12"}}}"#.to_vec(),
        ),
    );
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Rejected))),
        "{r:?}"
    );
    assert_eq!(e.stub.calls().len(), 1);

    // XML error with a successful status: retried once (funded), then terminal, never data.
    let e = env().await;
    let xml = b"<response><header><resultCode>99</resultCode><resultMsg>x</resultMsg></header></response>".to_vec();
    e.stub
        .push(VILAGE, Reply::with(200, "text/xml", xml.clone()));
    e.stub.push(VILAGE, Reply::with(200, "text/xml", xml));
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Retryable))),
        "{r:?}"
    );
    assert_eq!(e.metrics.snapshot().attempts_retryable, 2);

    let e = env().await;
    e.stub.push(VILAGE, Reply::json(page(1, 50)).delayed(600));
    let r = e
        .acquirer
        .acquire(&vilage(), Instant::now() + Duration::from_millis(200))
        .await;
    assert!(matches!(r, Err(DomesticError::Deadline)), "{r:?}");
    assert_eq!(e.metrics.snapshot().attempts_deadline, 1);

    // Exhausted funding sends no HTTP and is counted separately from provider outcomes.
    let e = env_with(&[(KEY_A, 'a')], Some(1)).await;
    let r = e.acquirer.acquire(&vilage(), deadline()).await;
    assert!(
        matches!(
            r,
            Err(DomesticError::Funding(
                BudgetError::Invalid(_) | BudgetError::Exhausted
            ))
        ),
        "{r:?}"
    );
    assert!(e.stub.calls().is_empty());
    let m = e.metrics.snapshot();
    assert_eq!(
        (m.funding_denied, m.funded_attempts, m.reserved_units),
        (1, 0, 0)
    );
}

#[tokio::test]
async fn kma_web_bodies_are_stored_byte_for_byte() {
    let e = env().await;
    let rss = fixture("town-rss.xml");
    e.stub.push(RSS, Reply::with(503, "text/html", "busy"));
    e.stub.push(
        RSS,
        Reply::with(200, "text/xml; charset=UTF-8", rss.clone()),
    );
    let a = complete(
        e.acquirer
            .acquire_web(&WebRequest::town_rss(60, 127).unwrap(), deadline())
            .await,
    );
    let record = &a.records[0];
    assert_eq!(&record.bytes[..], &rss[..]);
    assert_eq!(
        (
            record.envelope.identity.source.as_str(),
            record.envelope.identity.kind.as_str()
        ),
        ("kma-web", "town-rss")
    );
    assert_eq!(
        record.envelope.identity.period,
        Period {
            local_date: 20261013,
            slot: "1400".into()
        }
    );
    assert_eq!(record.envelope.content_type, "text/xml; charset=UTF-8");
    assert_eq!(record.envelope.pagination, None);
    assert_eq!(a.declaration.partitions[0].partition, "20261013-1400");
    let calls = e.stub.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        (calls[1].get("gridx"), calls[1].get("gridy")),
        (Some("60"), Some("127"))
    );
    assert!(
        calls
            .iter()
            .all(|c| c.get("serviceKey").is_none() && c.get("dataType").is_none())
    );
    assert_eq!(e.metrics.snapshot().public_attempts, 2);
    assert_eq!(e.metrics.snapshot().funded_attempts, 0);

    let aws = fixture("aws-minute-euckr.html");
    e.stub.push(AWS, Reply::with(200, "text/html", aws.clone()));
    let a = complete(
        e.acquirer
            .acquire_web(&WebRequest::aws_minute(None), deadline())
            .await,
    );
    assert_eq!(&a.records[0].bytes[..], &aws[..]);
    assert_eq!(a.records[0].envelope.identity.kind, "aws-minute");
    assert_eq!(
        a.records[0].envelope.identity.period,
        Period {
            local_date: 20261013,
            slot: "1432".into()
        }
    );

    e.stub.push(AWS, Reply::with(200, "text/html", aws));
    let hourly = WebRequest::aws_hourly(p(20261013, 1500)).unwrap();
    assert!(
        matches!(e.acquirer.acquire_web(&hourly, deadline()).await, Ok(Acquired::Stale(found)) if found == p(20261013, 1432))
    );
    assert_eq!(
        e.stub.calls().last().unwrap().raw_query,
        "202610131500&0&MINDB_60M&0&m"
    );
}

#[tokio::test]
async fn kma_web_redirects_errors_and_invalid_bodies() {
    let e = env().await;
    let city = fixture("city-obs-2026-09-25.html");
    e.stub.push(
        CITY,
        Reply::redirect(e.stub.url("w/weather/land/city-obs.do").to_string()),
    );
    e.stub.push(
        "w/weather/land/city-obs.do",
        Reply::with(200, "text/html;charset=UTF-8", city.clone()),
    );
    let request = WebRequest::city(p(20260925, 1900)).unwrap();
    let a = complete(e.acquirer.acquire_web(&request, deadline()).await);
    assert_eq!(&a.records[0].bytes[..], &city[..]);
    assert_eq!(e.stub.calls()[0].raw_query, "tm=2026.09.25.19:00");

    // A redirect to another host is not followed and is not data.
    let other = e.stub.base.replace("127.0.0.1", "localhost");
    e.stub.push(
        CITY,
        Reply::redirect(format!("{other}w/weather/land/city-obs.do")),
    );
    let r = e.acquirer.acquire_web(&request, deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Rejected))),
        "{r:?}"
    );

    e.stub.push(RSS, Reply::with(404, "text/html", "missing"));
    let r = e
        .acquirer
        .acquire_web(&WebRequest::town_rss(60, 127).unwrap(), deadline())
        .await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Rejected))),
        "{r:?}"
    );

    e.stub.push(
        RSS,
        Reply::with(200, "text/html", "<html><body>error</body></html>"),
    );
    let r = e
        .acquirer
        .acquire_web(&WebRequest::town_rss(60, 127).unwrap(), deadline())
        .await;
    assert!(matches!(r, Err(DomesticError::Invalid(_))), "{r:?}");
    let m = e.metrics.snapshot();
    assert_eq!((m.public_attempts, m.groups_complete), (4, 1));
}

#[tokio::test]
async fn mid_range_and_multi_page_life_index_families() {
    let e = env().await;
    let ta = serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": [{"regId": "11B10101", "taMin4": 12, "taMax4": 21}]},
                 "pageNo": 1, "numOfRows": 999, "totalCount": 1}}}))
    .unwrap();
    let path = "1360000/MidFcstInfoService/getMidTa";
    e.stub.push(path, Reply::json(ta.clone()));
    let mid = DataGoKrRequest::new(
        F::MidTa,
        Target::Region("11B10101".into()),
        p(20261013, 600),
    )
    .unwrap();
    let a = complete(e.acquirer.acquire(&mid, deadline()).await);
    assert_eq!(&a.records[0].bytes[..], &ta[..]);
    assert_eq!(a.records[0].envelope.identity.kind, "mid-ta");
    assert_eq!(a.declaration.partitions[0].partition, "20261013-0600");
    let call = &e.stub.calls()[0];
    assert_eq!(
        (call.get("regId"), call.get("tmFc")),
        (Some("11B10101"), Some("202610130600"))
    );
    // A row for another region is not this request's data.
    let other = String::from_utf8(ta)
        .unwrap()
        .replace("11B10101", "11B20000");
    e.stub.push(path, Reply::json(other.clone()));
    e.stub.push(path, Reply::json(other));
    let r = e.acquirer.acquire(&mid, deadline()).await;
    assert!(
        matches!(r, Err(DomesticError::Provider(Disposition::Retryable))),
        "{r:?}"
    );

    // UV: 1,500 areas in two ordered pages; the period is the issuance carried by the rows.
    let pages = [
        life_page(1, 1500, 1000, "2026101312"),
        life_page(2, 1500, 1000, "2026101312"),
    ];
    for page in &pages {
        e.stub.push(UV, Reply::json(page.clone()));
    }
    let uv = DataGoKrRequest::new(F::UvIdxV5, Target::AllAreas, p(20261013, 1200)).unwrap();
    let a = complete(e.acquirer.acquire(&uv, deadline()).await);
    assert_eq!(a.records.len(), 2);
    assert_eq!(&a.records[1].bytes[..], &pages[1][..]);
    assert_eq!(
        a.records[1].envelope.pagination,
        Some(Pagination {
            page: 2,
            pages: 2,
            complete: true
        })
    );
    assert_eq!(
        a.records[0].envelope.identity.period,
        Period {
            local_date: 20261013,
            slot: "1200".into()
        }
    );
    let calls = e.stub.calls();
    let last = &calls[calls.len() - 1];
    assert_eq!(
        (
            last.get("pageNo"),
            last.get("numOfRows"),
            last.get("areaNo"),
            last.get("time")
        ),
        (Some("2"), Some("1000"), Some(""), Some("2026101312"))
    );
    // A different issuance on page 2 makes the set inconsistent.
    e.stub
        .push(UV, Reply::json(life_page(1, 1500, 1000, "2026101312")));
    e.stub
        .push(UV, Reply::json(life_page(2, 1500, 1000, "2026101309")));
    let r = e.acquirer.acquire(&uv, deadline()).await;
    assert!(matches!(r, Err(DomesticError::Incomplete(_))), "{r:?}");
}
