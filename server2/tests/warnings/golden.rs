//! S02 golden byte parity for `/v000903/kma/special` and `specialInfo`, served from S3 seeds.
use super::common::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use server2::{
    gateway::OrderedJson,
    warnings::{Town, seed, service::special_info_json},
};

/// Headers compared with the recorded legacy response. `date`/`connection` are transport
/// values and `set-cookie` comes from the application-wide Express session middleware.
const IGNORED: [&str; 3] = ["date", "connection", "set-cookie"];

async fn assert_case(
    service: &server2::warnings::WarningService<server2::storage::HttpS3Transport>,
    clock: &FixedClock,
    id: &str,
) {
    let case = golden(id);
    clock.set(case["clock"].as_str().unwrap());
    let mut headers = Vec::new();
    for (k, v) in case["request"]["headers"].as_object().unwrap() {
        headers.push((k.as_str(), v.as_str().unwrap()));
    }
    let response = get(service, &headers).await;
    assert_eq!(
        response.status().as_u16() as u64,
        case["status"].as_u64().unwrap(),
        "{id}"
    );
    let got_headers = response.headers().clone();
    let expected_body = STANDARD
        .decode(case["body_base64"].as_str().unwrap())
        .unwrap();
    assert_eq!(body(response).await, expected_body, "{id} body");
    let mut compared = 0;
    for pair in case["headers"].as_array().unwrap() {
        let k = pair[0].as_str().unwrap();
        if IGNORED.contains(&k) {
            continue;
        }
        assert_eq!(
            got_headers.get(k).and_then(|v| v.to_str().ok()),
            pair[1].as_str(),
            "{id} header {k}"
        );
        compared += 1;
    }
    assert_eq!(got_headers.len(), compared, "{id} has no extra headers");
}
#[tokio::test]
async fn special_goldens_from_s3_seeds_with_empty_memory() {
    let peer = Peer::new();
    let store = peer.store();
    let file = seed_file(golden_seed_docs(), None, "2026-09-27T12:00:00.000Z");
    let parsed = seed::parse(&file).unwrap();
    assert_eq!(seed::import(&store, &parsed, deadline()).await.unwrap(), 4);
    for id in [
        "warning-plus10h",
        "warning-plus19h",
        "warning-plus19h-1ms",
        "warning-week-old",
        "warning-week-old-304",
    ] {
        // Every case starts from a replaced process: empty memory, no provider.
        let clock = FixedClock::at("2026-09-27T00:00:00.000Z");
        let service = peer.service(clock.clone());
        assert_case(&service, &clock, id).await;
    }
}
#[tokio::test]
async fn special_info_golden_from_zone_seed() {
    let peer = Peer::new();
    let store = peer.store();
    let zone = serde_json::json!([
        {"areaCode": "L1100100", "areaName": "fixed provider area label", "active": true, "warnVar": 3, "warnStress": 1},
        {"areaCode": "_sync", "warnVar": -1, "lastSyncAt": "2026-09-24T00:00:00.000Z"}
    ]);
    let zone = OrderedJson::parse(&serde_json::to_vec(&zone).unwrap()).unwrap();
    let file = seed_file(vec![], Some(zone), "2026-09-24T00:00:00.000Z");
    seed::import(&store, &seed::parse(&file).unwrap(), deadline())
        .await
        .unwrap();
    let case = golden("domestic-special-info");
    let clock = FixedClock::at(case["clock"].as_str().unwrap());
    let service = peer.service(clock);
    let town = Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: "청운효자동".into(),
    };
    let list = service.special_info(&town).await.unwrap();
    let recorded = OrderedJson::parse(
        &STANDARD
            .decode(case["body_base64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    let expected = recorded.get("current").unwrap().get("specialInfo").unwrap();
    assert_eq!(special_info_json(&list).to_bytes(), expected.to_bytes());
    assert_eq!(
        server2::warnings::zones::ZoneTable::shared(0).zones_for_town(&town),
        serde_json::from_value::<Vec<String>>(case["dependency_trace"]["zones"].clone()).unwrap()
    );
    // A town without zones keeps the legacy empty result (S15 omits the field).
    let none = Town {
        first: "없는도".into(),
        ..Town::default()
    };
    assert!(service.special_info(&none).await.unwrap().is_empty());
}
