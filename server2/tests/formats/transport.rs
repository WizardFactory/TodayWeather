//! Shared S08 transport: per-request response format, credential spelling and success codes.
use super::support::*;
use server2::budget::{BudgetStore, Provider};
use server2::providers::{
    AcquisitionError, AcquisitionOutcome, CallReport, Candidate, Disposition, FundedExecutor,
    HttpProviderTransport, ProviderKey, ResponseFormat, classify, classify_format,
};
use std::sync::Arc;

fn executor() -> FundedExecutor<HttpProviderTransport, fn(&serde_json::Value) -> bool> {
    fn valid(json: &serde_json::Value) -> bool {
        json.get("ok").is_some()
    }
    FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(1024 * 1024).unwrap()),
        Arc::new(valid as fn(&serde_json::Value) -> bool),
    )
    .unwrap()
}
fn candidate(wire: Arc<Memory>) -> Vec<Candidate<Memory>> {
    vec![Candidate {
        budget: Arc::new(BudgetStore::new(wire, policy('a', 100), clock(10)).unwrap()),
        key: ProviderKey::new(KEY_A.into()).unwrap(),
    }]
}
async fn call(
    stub: &Stub,
    endpoint: &str,
    format: ResponseFormat,
) -> Result<AcquisitionOutcome, AcquisitionError> {
    let mut report = CallReport::default();
    executor()
        .execute_formatted(
            stub.url(endpoint),
            format,
            candidate(Arc::new(Memory::default())),
            deadline(),
            Arc::new(|j: &serde_json::Value| j.get("ok").is_some()),
            &mut report,
        )
        .await
}

#[tokio::test]
async fn each_format_appends_its_legacy_parameters_in_legacy_order() {
    let stub = Stub::start().await;
    let cases = [
        (
            ResponseFormat::DataType,
            "serviceKey",
            ("dataType", "JSON"),
            true,
        ),
        (
            ResponseFormat::ReturnType,
            "serviceKey",
            ("returnType", "json"),
            true,
        ),
        (
            ResponseFormat::UnderscoreType,
            "ServiceKey",
            ("_type", "json"),
            false,
        ),
        (ResponseFormat::Type, "ServiceKey", ("type", "json"), false),
    ];
    for (format, key, (name, value), key_first) in cases {
        stub.push("op", Reply::json(r#"{"ok":1}"#));
        let outcome = call(&stub, "op?a=1", format).await;
        assert!(
            matches!(outcome, Ok(AcquisitionOutcome::Data(_))),
            "{format:?}"
        );
        let c = stub.calls().pop().unwrap();
        let names: Vec<&str> = c.query.iter().map(|(k, _)| k.as_str()).collect();
        let expected = if key_first {
            vec!["a", key, name]
        } else {
            vec!["a", name, key]
        };
        assert_eq!(names, expected, "{format:?}");
        assert_eq!(c.get(key), Some(KEY_A));
        assert_eq!(c.get(name), Some(value));
        assert_eq!(format.key_param(), key);
        assert_eq!(format.format_param(), (name, value));
    }
}

#[tokio::test]
async fn a_family_query_cannot_carry_credentials_or_format_parameters() {
    let stub = Stub::start().await;
    for (endpoint, format) in [
        ("op?returnType=xml", ResponseFormat::ReturnType),
        ("op?_type=xml", ResponseFormat::UnderscoreType),
        ("op?type=xml", ResponseFormat::Type),
        ("op?ServiceKey=x", ResponseFormat::Type),
        ("op?SERVICEKEY=x", ResponseFormat::UnderscoreType),
        ("op?dataType=XML", ResponseFormat::ReturnType),
    ] {
        let outcome = call(&stub, endpoint, format).await;
        assert!(
            matches!(
                outcome,
                Err(AcquisitionError::Provider(_)
                    | AcquisitionError::Invalid
                    | AcquisitionError::Transport)
            ),
            "{endpoint}"
        );
    }
    assert!(stub.calls().is_empty(), "no HTTP for a smuggled parameter");
}

#[test]
fn success_codes_are_per_format_and_classify_is_unchanged() {
    let ok = |code: &str| {
        format!(r#"{{"response":{{"header":{{"resultCode":"{code}","resultMsg":"OK"}}}}}}"#)
    };
    // newsky2 answers 0000; only the Type format accepts it.
    assert_eq!(
        classify_format(200, ok("0000").as_bytes(), true, true, ResponseFormat::Type),
        Disposition::Data
    );
    for f in [
        ResponseFormat::DataType,
        ResponseFormat::ReturnType,
        ResponseFormat::UnderscoreType,
    ] {
        assert_eq!(
            classify_format(200, ok("0000").as_bytes(), true, true, f),
            Disposition::Retryable
        );
        assert_eq!(
            classify_format(200, ok("00").as_bytes(), true, true, f),
            Disposition::Data
        );
    }
    assert_eq!(
        classify(200, ok("0000").as_bytes(), true, true),
        Disposition::Retryable
    );
    // Quota/auth precedence is the same for every format.
    for f in [ResponseFormat::Type, ResponseFormat::ReturnType] {
        assert_eq!(
            classify_format(200, fixture("gateway-30.json").as_slice(), true, true, f),
            Disposition::Auth
        );
        assert_eq!(
            classify_format(200, fixture("gateway-quota.xml").as_slice(), true, true, f),
            Disposition::Quota
        );
    }
}

#[test]
fn air_provider_identities_have_distinct_budget_paths() {
    assert_eq!(Provider::GoogleAirQuality.path(), "google_air_quality");
    assert_eq!(Provider::OpenWeather.path(), "openweather");
    assert_eq!(Provider::Waqi.path(), "waqi");
    assert_ne!(Provider::GoogleAirQuality.path(), Provider::Google.path());
    // The shared funded executor serves data.go.kr and Visual Crossing only.
    for p in [
        Provider::GoogleAirQuality,
        Provider::OpenWeather,
        Provider::Waqi,
    ] {
        assert!(
            FundedExecutor::new(
                p,
                1,
                Arc::new(HttpProviderTransport::new(1024).unwrap()),
                Arc::new(|_: &serde_json::Value| true),
            )
            .is_err()
        );
    }
}
