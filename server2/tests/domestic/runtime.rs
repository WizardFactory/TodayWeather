//! RUNTIME: the opt-in local KMA mode is loopback-only, and the recorded-store source used by
//! the release smoke serves the recorded legacy bytes at the recording's request instant.
use super::support::*;
use server2::{
    domestic::kma::{
        AssemblyConfig,
        backend::{KmaBackend, system_clock},
        recorded::RecordedSource,
        runtime::from_vars,
    },
    gateway::{BackendHandler, GatewayError, backend::Native},
};
use std::sync::Arc;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/oracle.json.gz"
);
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
