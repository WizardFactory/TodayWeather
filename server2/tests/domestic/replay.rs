//! REPLAY: the recorded-store test double answers only the request it was recorded for, the
//! backend serves its recorded legacy bytes at the recording's request instant, and an exception
//! thrown in a store callback is not caught by a `try` entered before the read.
use super::support::*;
use server2::{
    domestic::kma::{
        AssemblyConfig, Outcome, assemble,
        backend::{KmaBackend, system_clock},
    },
    gateway::{BackendHandler, GatewayError, backend::Native},
};
use std::sync::Arc;

#[test]
fn deployed_current_count_is_the_default() {
    // `manager.MAX_CURRENT_COUNT` of the deployed controllerManager.js; the oracle recording
    // was made with the same value (D4), so tests replay with the runtime default.
    assert_eq!(AssemblyConfig::default().max_current_count, 192);
    assert_eq!(oracle()["oracle"]["max_current_count"], 192);
    assert_eq!(oracle_config(), AssemblyConfig::default());
}

/// A recording with one scenario's fields edited (keys of the edited copy are re-sorted, which
/// changes no outcome checked here).
fn edited(id: &str, edit: impl FnOnce(&mut serde_json::Value)) -> RecordedSource {
    let mut sc = scenario(id).clone();
    edit(&mut sc);
    let root = serde_json::json!({ "scenarios": [sc] });
    RecordedSource::parse(&serde_json::to_vec(&root).unwrap()).unwrap()
}
fn outcome(source: &RecordedSource, id: &str) -> Outcome {
    let sc = scenario(id);
    let store = source.store_for(id).unwrap();
    assemble(
        &request(sc),
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    )
}
fn forwarded(o: &Outcome, needle: &str) -> bool {
    matches!(o, Outcome::Legacy(reason) if reason.contains(needle))
}

/// A recording replays only the request it was made for: absent, reordered, re-argued or
/// unused recorded calls forward instead of assembling a reply from inputs it does not hold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recorded_store_forwards_when_the_recording_cannot_answer() {
    warm();
    let id = "domestic-v000903";
    assert!(matches!(outcome(&edited(id, |_| ()), id), Outcome::Json(_)));
    let empty = edited(id, |sc| sc["calls"] = serde_json::json!([]));
    let o = outcome(&empty, id);
    assert!(forwarded(&o, "recording has no call #0 (towns)"), "{o:?}");
    let backend = KmaBackend::new(Arc::new(empty), system_clock(), oracle_config());
    let sc = scenario(id);
    let served = backend
        .fetch_or_forward(
            format!("/v000903/kma{}", sc["path"].as_str().unwrap()),
            String::new(),
            tokio::time::Instant::now() + std::time::Duration::from_secs(3),
        )
        .await
        .unwrap();
    assert!(
        matches!(served, Native::Forward),
        "empty recording forwards"
    );
    let first_model = |sc: &serde_json::Value| {
        sc["calls"]
            .as_array()
            .unwrap()
            .iter()
            .position(|c| c["m"] == "town_model")
            .unwrap()
    };
    let other_model = edited(id, |sc| {
        let i = first_model(sc);
        sc["calls"][i]["args"][0] = "Current".into();
    });
    let o = outcome(&other_model, id);
    assert!(forwarded(&o, "town_model arguments differ"), "{o:?}");
    let other_grid = edited(id, |sc| {
        let i = first_model(sc);
        sc["calls"][i]["args"][1] = 1.into();
    });
    let o = outcome(&other_grid, id);
    assert!(forwarded(&o, "town_model arguments differ"), "{o:?}");
    let other_instant = edited(id, |sc| {
        let i = sc["calls"]
            .as_array()
            .unwrap()
            .iter()
            .position(|c| c["m"] == "arpltn")
            .unwrap();
        sc["calls"][i]["args"][1] = serde_json::json!({"$date": 0});
    });
    let o = outcome(&other_instant, id);
    assert!(forwarded(&o, "arpltn arguments differ"), "{o:?}");
    let reordered = edited(id, |sc| {
        assert_eq!(sc["calls"][1]["m"], "town_model");
        sc["calls"][1]["m"] = "mid_model".into();
    });
    let o = outcome(&reordered, id);
    assert!(
        forwarded(
            &o,
            "recorded call #1 is mid_model, assembly called town_model"
        ),
        "{o:?}"
    );
    let extra = edited(id, |sc| {
        let calls = sc["calls"].as_array_mut().unwrap();
        let last = calls.last().unwrap().clone();
        calls.push(last);
    });
    let o = outcome(&extra, id);
    assert!(forwarded(&o, "reply left recorded calls unused"), "{o:?}");
}

/// Legacy converts town rows inside the Mongo `exec` callback, outside the `try` of
/// `getAllDataFromDb`/`getShort`: a document without `shortData` throws an uncaught TypeError in
/// the deployed service (the S02 harness answers synchronously and would catch it). The native
/// assembly does not continue without the short forecast: it answers Express's 500 (S15b-4b-1;
/// the deployed process ends instead, and the gateway hop fails the same way).
#[test]
fn an_exception_in_a_store_callback_is_not_caught_by_an_earlier_try() {
    warm();
    let id = "domestic-v000903";
    let source = edited(id, |sc| {
        let i = sc["calls"]
            .as_array()
            .unwrap()
            .iter()
            .position(|c| c["m"] == "town_model" && c["args"][0] == "Short")
            .unwrap();
        let docs = sc["calls"][i]["result"].as_array_mut().unwrap();
        docs[0].as_object_mut().unwrap().remove("shortData");
    });
    let o = outcome(&source, id);
    assert_eq!(o, Outcome::Status(500, "Internal Server Error\n".into()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recorded_source_serves_recorded_bytes_and_forwards_unrecorded_requests() {
    warm();
    let source = RecordedSource::parse(&std::fs::read(FIXTURE).unwrap()).unwrap();
    assert_eq!(source.len(), scenarios().len());
    let backend = KmaBackend::new(Arc::new(source), system_clock(), oracle_config());
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    for id in [
        "gateway-v000903-domestic",
        "gateway-query-normalization",
        "domestic-v000903",
    ] {
        let sc = scenario(id);
        let mut path = format!("/v000903/kma{}", sc["path"].as_str().unwrap());
        if !sc["query"].as_str().unwrap().is_empty() {
            path.push('?');
            path.push_str(sc["query"].as_str().unwrap());
        }
        let lang = sc["lang"].as_str().unwrap_or("").to_owned();
        let Native::Served(json) = backend
            .fetch_or_forward(path, lang, deadline)
            .await
            .unwrap()
        else {
            panic!("{id} served natively");
        };
        assert_eq!(
            String::from_utf8(json.to_bytes()).unwrap(),
            sc["body"].as_str().unwrap(),
            "{id}"
        );
    }
    let unrecorded = backend
        .fetch_or_forward(
            "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C?airUnit=airnow".into(),
            "en".into(),
            deadline,
        )
        .await
        .unwrap();
    assert!(matches!(unrecorded, Native::Forward));
    // The legacy region guard is a non-200 reply: a dependency error at the gateway.
    let guard = backend
        .fetch_or_forward(
            format!(
                "/v000903/kma{}",
                scenario("region-guard")["path"].as_str().unwrap()
            ),
            "en".into(),
            deadline,
        )
        .await;
    assert_eq!(guard.err(), Some(GatewayError::Provider));
    assert!(RecordedSource::parse(b"{}").is_err());
}

/// A malformed non-ASCII publication string is rejected as legacy rejects it (`NaN`), not
/// sliced inside a character: DB 1.0 RSS `pubDate` `한글날짜` assembles and is served.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn non_ascii_publication_strings_do_not_panic() {
    warm();
    let id = "domestic-v000903-db1";
    let source = edited(id, |sc| {
        let i = sc["calls"]
            .as_array()
            .unwrap()
            .iter()
            .position(|c| c["m"] == "town_model" && c["args"][0] == "ShortRss")
            .unwrap();
        sc["calls"][i]["result"][0]["pubDate"] = "한글날짜".into();
    });
    let o = outcome(&source, id);
    assert!(matches!(o, Outcome::Json(_)), "{o:?}");
    let backend = KmaBackend::new(Arc::new(source), system_clock(), oracle_config());
    let sc = scenario(id);
    let served = backend
        .fetch_or_forward(
            format!("/v000903/kma{}", sc["path"].as_str().unwrap()),
            sc["lang"].as_str().unwrap_or("").to_owned(),
            tokio::time::Instant::now() + std::time::Duration::from_secs(3),
        )
        .await
        .unwrap();
    assert!(matches!(served, Native::Served(_)));
}

/// A Rust panic during assembly is a port defect: the backend forwards to legacy instead of
/// failing the request.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rust_panic_in_assembly_forwards_to_legacy() {
    use serde_json::Value;
    use server2::domestic::kma::{
        DbVersion, KmaRequest, KmaStore, MidModel, StoreResult, TownModel,
        backend::{KmaSource, SourceAnswer},
    };
    use server2::gateway::BoxFuture;
    struct Defect;
    impl KmaStore for Defect {
        fn db_version(&self) -> DbVersion {
            DbVersion::V2
        }
        fn towns(&self) -> StoreResult {
            panic!("simulated port defect")
        }
        fn town(&self, _: &str, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn region_code(&self, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn town_model(&self, _: TownModel, _: &Value, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn mid_model(&self, _: MidModel, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn forecast_zone(&self, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn stn_hourly_and_min_rns(&self, _: &Value, _: &str, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn city_hourly(&self, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn area_no(&self, _: &str, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn area_no_near(&self, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn life_index(&self, _: f64) -> StoreResult {
            unreachable!()
        }
        fn food_poisoning(&self, _: &str, _: &str, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn arpltn(&self, _: &Value, _: f64) -> StoreResult {
            unreachable!()
        }
        fn dust_forecast(&self, _: &str, _: &str, _: &str) -> StoreResult {
            unreachable!()
        }
        fn air_fallback(&self, _: &Value, _: f64) -> StoreResult {
            unreachable!()
        }
        fn air_forecast(&self, _: &str, _: &Value) -> StoreResult {
            unreachable!()
        }
        fn rise_set(&self, _: &Value, _: &[String]) -> StoreResult {
            unreachable!()
        }
        fn special_zones(&self, _: &[String]) -> StoreResult {
            unreachable!()
        }
    }
    struct Source;
    impl KmaSource for Source {
        fn snapshot(&self, _: &KmaRequest, _: tokio::time::Instant) -> BoxFuture<'_, SourceAnswer> {
            Box::pin(async { SourceAnswer::Snapshot(Box::new(Defect)) })
        }
    }
    let backend = KmaBackend::new(Arc::new(Source), system_clock(), oracle_config());
    let served = backend
        .fetch_or_forward(
            format!(
                "/v000903/kma{}",
                scenario("domestic-v000903")["path"].as_str().unwrap()
            ),
            "ko".into(),
            tokio::time::Instant::now() + std::time::Duration::from_secs(3),
        )
        .await
        .unwrap();
    assert!(matches!(served, Native::Forward));
}

/// A store string with an unpaired UTF-16 surrogate (kept by JavaScript, `"\ud800"` in JSON)
/// forwards instead of being replaced by U+FFFD in a native reply.
#[test]
fn an_unpaired_surrogate_in_a_store_answer_forwards() {
    warm();
    let id = "life-food-kasi";
    let mut sc = scenario(id).clone();
    let i = sc["calls"]
        .as_array()
        .unwrap()
        .iter()
        .position(|c| c["m"] == "rise_set")
        .unwrap();
    sc["calls"][i]["result"][0]["locationName"] = "SURROGATE-MARKER".into();
    let text = serde_json::to_string(&serde_json::json!({ "scenarios": [sc] }))
        .unwrap()
        .replacen("SURROGATE-MARKER", "\\ud800", 1);
    let source = RecordedSource::parse(text.as_bytes()).unwrap();
    let o = outcome(&source, id);
    assert!(forwarded(&o, "unpaired UTF-16 surrogate"), "{o:?}");
}
