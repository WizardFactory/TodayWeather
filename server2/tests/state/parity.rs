//! Wire and state parity with the pinned legacy oracle: every recorded request is replayed
//! through the server2 push service (writer, journal, in-memory S3 double). Status, body bytes,
//! headers (except transport/session headers) and the stored documents after every step must
//! match; the final state must also survive an empty-memory restore.
use super::common::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use server2::push::Coll;

/// Transport (`date`, `connection`, `keep-alive`, `transfer-encoding`) and the application-wide
/// Express session cookie, as in the S12 golden comparison.
const IGNORED: [&str; 5] = [
    "date",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "set-cookie",
];

fn check_state(state: &server2::push::State, expected: &serde_json::Value, label: &str) {
    for (name, c) in [("pushes", Coll::Alarm), ("alertpushes", Coll::Alert)] {
        let ours = records(state, c);
        let theirs: Vec<_> = expected[name]
            .as_array()
            .unwrap()
            .iter()
            .map(record)
            .collect();
        assert_eq!(ours.len(), theirs.len(), "{label} {name} count");
        for (i, (a, b)) in ours.iter().zip(&theirs).enumerate() {
            assert_eq!(a.oid, b.oid, "{label} {name}[{i}] _id");
            assert!(
                same_fields(&a.doc, &b.doc),
                "{label} {name}[{i}] document\n ours: {}\n legacy: {}",
                String::from_utf8_lossy(&server2::world::js::Val::Obj(a.doc.clone()).to_json()),
                String::from_utf8_lossy(&server2::world::js::Val::Obj(b.doc.clone()).to_json())
            );
        }
    }
}

#[tokio::test]
async fn oracle_scenarios_match_wire_and_state() {
    let oracle = oracle();
    let mut steps_checked = 0;
    for scenario in oracle["scenarios"].as_array().unwrap() {
        let id = scenario["id"].as_str().unwrap();
        let s3 = MemS3::new();
        let mut seeds = Vec::new();
        for (name, c) in [("pushes", Coll::Alarm), ("alertpushes", Coll::Alert)] {
            if let Some(docs) = scenario["seed"][name].as_array() {
                seeds.extend(docs.iter().map(|d| (c, record(d))));
            }
        }
        seed(&s3, &seeds).await;
        let steps = scenario["steps"].as_array().unwrap();
        let clock = FixedClock::at(steps[0]["at"].as_str().unwrap());
        let service = start(&s3, clock.clone(), fast_config()).await;
        for (i, step) in steps.iter().enumerate() {
            let label = format!(
                "{id} step {i} {} {}",
                step["request"]["method"], step["request"]["path"]
            );
            clock.set(step["at"].as_str().unwrap());
            let response = service
                .handle(request(step))
                .await
                .unwrap_or_else(|| panic!("{label}: not a push route"));
            assert_eq!(
                u64::from(response.status().as_u16()),
                step["status"].as_u64().unwrap(),
                "{label} status"
            );
            let headers = response.headers().clone();
            let got = body(response).await;
            let want = STANDARD
                .decode(step["body_base64"].as_str().unwrap())
                .unwrap();
            assert_eq!(
                String::from_utf8_lossy(&got),
                String::from_utf8_lossy(&want),
                "{label} body"
            );
            let mut compared = 0;
            for pair in step["headers"].as_array().unwrap() {
                let k = pair[0].as_str().unwrap();
                if IGNORED.contains(&k) {
                    continue;
                }
                assert_eq!(
                    headers.get(k).and_then(|v| v.to_str().ok()),
                    pair[1].as_str(),
                    "{label} header {k}"
                );
                compared += 1;
            }
            let ours = headers
                .keys()
                .filter(|k| !IGNORED.contains(&k.as_str()))
                .count();
            assert_eq!(ours, compared, "{label}: no extra headers");
            let state = service.state();
            let state = state.read().unwrap();
            check_state(&state, &step["collections"], &label);
            steps_checked += 1;
        }
        // Memory loss: a new process restores the acknowledged state from S3 alone.
        let restored = start(&s3, clock.clone(), fast_config()).await;
        let last = &steps.last().unwrap()["collections"];
        check_state(
            &restored.state().read().unwrap(),
            last,
            &format!("{id} restored"),
        );
    }
    assert!(
        steps_checked >= 100,
        "oracle coverage: {steps_checked} steps"
    );
}
