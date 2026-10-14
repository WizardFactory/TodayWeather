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
        ("op?ServiceKey=x", ResponseFormat::ReturnType),
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
    // S13b removed the newsky2-only format: no format accepts 0000.
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
    for f in [ResponseFormat::UnderscoreType, ResponseFormat::ReturnType] {
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

/// S13B-R1-03: AirKorea reads the legacy gateway markers of a 200 body that is not JSON or is
/// the JSON gateway envelope; a regular envelope is not reinterpreted.
#[test]
fn airkorea_200_gateway_markers_follow_legacy_gateway_code() {
    let r = ResponseFormat::ReturnType;
    for (body, expected) in [
        ("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", Disposition::Auth),
        ("<html>DEADLINE_HAS_EXPIRED_ERROR</html>", Disposition::Auth),
        (
            r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnAuthMsg":"LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"}}}"#,
            Disposition::Quota,
        ),
        (
            r#"{"response":{"header":{"resultMsg":"DEADLINE_HAS_EXPIRED_ERROR"}}}"#,
            Disposition::Retryable,
        ),
        // S13B-R2: an empty, nonnumeric or `00` reason code does not hide the markers.
        (
            r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnAuthMsg":"DEADLINE_HAS_EXPIRED_ERROR","returnReasonCode":""}}}"#,
            Disposition::Auth,
        ),
        (
            r#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnAuthMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnReasonCode":"00"}}}"#,
            Disposition::Auth,
        ),
        (
            "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>x</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
            Disposition::Quota,
        ),
    ] {
        assert_eq!(
            classify_format(200, body.as_bytes(), true, false, r),
            expected,
            "{body}"
        );
        // Other formats keep the S13 rule.
        assert_eq!(
            classify_format(200, body.as_bytes(), true, false, ResponseFormat::DataType),
            Disposition::Retryable
        );
    }
}

/// S13b (legacy #2737 `rejectionCode`): an AirKorea 401/403 keeps an explicit body code, so
/// only a credential code or a body without a code rejects the key; quota still wins.
#[test]
fn airkorea_401_403_keep_an_explicit_body_code() {
    let envelope = |code: &str| {
        format!(r#"{{"response":{{"header":{{"resultCode":"{code}","resultMsg":"synthetic"}}}}}}"#)
    };
    let gateway = |code: &str| {
        format!(
            r#"{{"OpenAPI_ServiceResponse":{{"cmmMsgHeader":{{"errMsg":"SERVICE ERROR","returnAuthMsg":"x","returnReasonCode":"{code}"}}}}}}"#
        )
    };
    let xml = |code: &str| {
        format!("<response><header><resultCode>{code}</resultCode></header></response>")
    };
    let r = ResponseFormat::ReturnType;
    for status in [401, 403] {
        for body in [
            envelope("99"),
            gateway("99"),
            gateway("77"),
            xml("99"),
            envelope("00"),
        ] {
            assert_eq!(
                classify_format(status, body.as_bytes(), true, false, r),
                Disposition::Rejected,
                "{status} {body}"
            );
            // Other formats keep the S13 rule: any 401/403 is a key rejection.
            assert_eq!(
                classify_format(
                    status,
                    body.as_bytes(),
                    true,
                    false,
                    ResponseFormat::DataType
                ),
                Disposition::Auth
            );
        }
        for code in ["20", "30", "31", "32"] {
            for body in [envelope(code), gateway(code), xml(code)] {
                assert_eq!(
                    classify_format(status, body.as_bytes(), true, false, r),
                    Disposition::Auth
                );
            }
        }
        for body in [envelope("22"), gateway("22"), xml("22")] {
            assert_eq!(
                classify_format(status, body.as_bytes(), true, false, r),
                Disposition::Quota
            );
        }
        for body in ["", "Unauthorized", "<html>denied</html>"] {
            assert_eq!(
                classify_format(status, body.as_bytes(), true, false, r),
                Disposition::Auth
            );
        }
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
