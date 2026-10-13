//! #2604 classification of recorded gateway envelopes (JSON and XML forms).
use super::support::fixture;
use server2::providers::{Disposition, classify};

#[test]
fn recorded_json_gateway_auth_envelope_is_auth_not_retryable() {
    // kmaWarningRequester.classify / parseUvIdxV5 treat this JSON envelope as a key rejection.
    let body = fixture("gateway-30.json");
    for status in [200, 500] {
        assert_eq!(classify(status, &body, true, false), Disposition::Auth);
    }
}

#[test]
fn json_gateway_quota_and_deterministic_codes() {
    let quota = br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE ERROR","returnAuthMsg":"LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR","returnReasonCode":"22"}}}"#;
    assert_eq!(classify(200, quota, true, false), Disposition::Quota);
    let numeric = br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":31}}}"#;
    assert_eq!(classify(200, numeric, true, false), Disposition::Auth);
    let missing = br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"NO_OPENAPI_SERVICE_ERROR","returnReasonCode":"12"}}}"#;
    assert_eq!(classify(200, missing, true, false), Disposition::Rejected);
    let unknown = br#"{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"99"}}}"#;
    assert_eq!(classify(200, unknown, true, false), Disposition::Retryable);
    // Not a data.go.kr call: no provider code interpretation.
    assert_eq!(classify(200, quota, false, false), Disposition::Retryable);
}

#[test]
fn recorded_xml_gateway_quota_keeps_precedence() {
    let body = fixture("gateway-quota.xml");
    for status in [200, 401, 500] {
        assert_eq!(classify(status, &body, true, false), Disposition::Quota);
    }
}
