//! RUNTIME: the opt-in local KMA mode is loopback-only, and the recorded-store source used by
//! the release smoke serves the recorded legacy bytes at the recording's request instant.
use super::support::*;
use server2::{
    domestic::kma::{
        AssemblyConfig, Outcome, assemble,
        backend::{KmaBackend, system_clock},
        recorded::RecordedSource,
        runtime::from_vars,
    },
    gateway::{BackendHandler, GatewayError, backend::Native},
};
use std::sync::Arc;

fn vars(pairs: Vec<(&'static str, String)>) -> impl Fn(&str) -> Option<String> {
    move |name: &str| {
        pairs
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.clone())
    }
}

#[test]
fn runtime_option_is_opt_in_and_loopback_only() {
    let local = "http://127.0.0.1:9/";
    assert!(
        from_vars(&vars(vec![]), local).unwrap().is_none(),
        "unset keeps legacy"
    );
    let recorded = || {
        vec![
            ("SERVER2_KMA_MODE", "recorded-local".to_owned()),
            ("SERVER2_KMA_RECORDED", FIXTURE.to_owned()),
        ]
    };
    assert!(from_vars(&vars(recorded()), local).unwrap().is_some());
    assert_eq!(
        from_vars(&vars(recorded()), "https://legacy.example.com/").err(),
        Some(GatewayError::InvalidConfiguration),
        "a non-loopback legacy origin is refused"
    );
    assert!(from_vars(&vars(vec![("SERVER2_KMA_MODE", "native".into())]), local).is_err());
    assert!(
        from_vars(
            &vars(vec![("SERVER2_KMA_MODE", "recorded-local".into())]),
            local
        )
        .is_err(),
        "recorded-local needs a recording"
    );
    assert!(
        from_vars(
            &vars(vec![
                ("SERVER2_KMA_MODE", "recorded-local".into()),
                ("SERVER2_KMA_RECORDED", "/nonexistent/recording.json".into()),
            ]),
            local
        )
        .is_err()
    );
    let mut bad = recorded();
    bad.push(("SERVER2_KMA_MAX_CURRENT_COUNT", "many".into()));
    assert!(from_vars(&vars(bad), local).is_err());
    assert!(
        from_vars(
            &vars(vec![("SERVER2_KMA_MODE", "forward-local".into())]),
            local
        )
        .unwrap()
        .is_some()
    );
    assert_eq!(AssemblyConfig::default().max_current_count, 192);
    // The public listener must be loopback too: a recorded snapshot is never served remotely.
    for bind in [
        "0.0.0.0:3002",
        "[::]:3002",
        "192.0.2.10:3002",
        "not-an-address",
    ] {
        let mut env = recorded();
        env.push(("SERVER2_BIND", bind.into()));
        assert_eq!(
            from_vars(&vars(env), local).err(),
            Some(GatewayError::InvalidConfiguration),
            "{bind}"
        );
        let env = vec![
            ("SERVER2_KMA_MODE", "forward-local".to_owned()),
            ("SERVER2_BIND", bind.to_owned()),
        ];
        assert!(from_vars(&vars(env), local).is_err(), "{bind}");
    }
    for bind in ["127.0.0.1:0", "[::1]:3002"] {
        let mut env = recorded();
        env.push(("SERVER2_BIND", bind.into()));
        assert!(from_vars(&vars(env), local).unwrap().is_some(), "{bind}");
    }
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
/// assembly forwards instead of continuing without the short forecast.
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
    assert!(forwarded(&o, "getAllDataFromDb: uncaught"), "{o:?}");
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
