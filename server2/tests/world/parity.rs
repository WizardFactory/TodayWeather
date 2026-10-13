//! PARITY/CHAINS/AIR: every pinned-oracle request replays byte for byte (or in the same legacy
//! error class) with the recorded provider calls, including DST, dateline, poles, cell
//! boundaries, missing fields, provider failures, budget and air observations.
use super::common::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn all_oracle_scenarios_replay_byte_for_byte() {
    let mut errors = Vec::new();
    let mut requests = 0;
    for sc in oracle()["scenarios"].as_array().unwrap() {
        requests += sc["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["requests"].as_array().unwrap().len())
            .sum::<usize>();
        errors.extend(replay(sc, memory(), NoStep).await);
    }
    assert!(requests >= 190, "{requests}");
    assert!(
        errors.is_empty(),
        "{} mismatches:\n{}",
        errors.len(),
        errors.join("\n")
    );
}

#[test]
fn oracle_covers_the_issue_edge_classes() {
    let ids: Vec<&str> = oracle()["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    for required in [
        "santiago-negative",
        "cell-boundary",
        "cell-boundary-tokyo",
        "dateline-east",
        "dateline-west",
        "pole-north",
        "pole-south",
        "london-dst-end",
        "auckland-dst-start",
        "newyork-dst-end",
        "sydney-dst-start",
        "missing-fields",
        "missing-current-conditions",
        "provider-500-cold",
        "provider-401",
        "unusable-body",
        "stale-fallback",
        "budget",
        "air-waqi",
        "invalid-input",
    ] {
        assert!(ids.contains(&required), "{required}");
    }
    assert_eq!(oracle()["oracle"]["node"], "v16.20.2");
    assert_eq!(oracle()["oracle"]["tz"], "UTC");
}

/// The recorded Tokyo requests are the S02 world goldens: same bytes from both oracles.
#[test]
fn s02_world_goldens_equal_recorded_oracle_bodies() {
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../golden/records.json")).unwrap();
    let tokyo = scenario("tokyo-recorded")["steps"][0]["requests"]
        .as_array()
        .unwrap();
    let golden = |id: &str| {
        let case = records["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap();
        String::from_utf8(
            STANDARD
                .decode(case["body_base64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap()
    };
    for (i, id) in ["world-v000901", "world-v000902", "world-v000903"]
        .iter()
        .enumerate()
    {
        assert_eq!(tokyo[i]["body"].as_str().unwrap(), golden(id), "{id}");
    }
    for (i, locale) in ["en", "ko", "ja", "zh-CN", "de", "zh-TW"]
        .iter()
        .enumerate()
    {
        assert_eq!(
            tokyo[3 + i]["body"].as_str().unwrap(),
            golden(&format!("world-locale-{locale}")),
            "{locale}"
        );
    }
}
