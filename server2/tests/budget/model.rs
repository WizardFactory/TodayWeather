use server2::budget::*;
pub fn policy(limit: u64, block: u64) -> BudgetPolicy {
    BudgetPolicy {
        provider: Provider::DataGoKr,
        quota_id: "a".repeat(64),
        window_id: "test_20261008".into(),
        starts_at_ms: 1,
        ends_at_ms: 100000,
        limit,
        block_units: block,
    }
}
#[test]
fn grant_enforces_exact_global_ceiling() {
    let p = policy(10, 4);
    assert_eq!(grant(&p, 4, 2), Ok(8));
    assert_eq!(grant(&p, 8, 2), Ok(10));
    assert_eq!(grant(&p, 9, 2), Err(BudgetError::Exhausted));
    assert!(grant(&p, u64::MAX, 1).is_err());
}
#[test]
fn policy_and_schema_are_strict() {
    let mut p = policy(10, 4);
    p.quota_id = "secret".into();
    assert!(p.validate().is_err());
    p = policy(10, 4);
    p.ends_at_ms = 1;
    assert!(p.validate().is_err());
    p = policy(u64::MAX, 4);
    assert_eq!(grant(&p, u64::MAX - 1, 1), Ok(u64::MAX));
    let bytes = serde_json::to_vec(&Authority {
        version: 2,
        policy: p.clone(),
        used: 0,
    })
    .unwrap();
    let mut v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    v["secret"] = true.into();
    assert!(serde_json::from_value::<Authority>(v).is_err());
}
#[test]
fn status_and_body_matrix() {
    use server2::providers::*;
    for status in [200, 403, 500] {
        assert_eq!(classify(status,b"<OpenAPI_ServiceResponse><returnReasonCode>22</returnReasonCode></OpenAPI_ServiceResponse>",true,false),Disposition::Quota);
    }
    for code in ["20", "30", "31", "32"] {
        let xml = format!("<resultCode>{code}</resultCode>");
        assert_eq!(
            classify(200, xml.as_bytes(), true, false),
            Disposition::Auth
        );
        let json = format!(r#"{{"response":{{"header":{{"resultCode":"{code}"}}}}}}"#);
        assert_eq!(
            classify(200, json.as_bytes(), true, true),
            Disposition::Auth
        );
    }
    assert_eq!(
        classify(
            200,
            br#"{"response":{"header":{"resultCode":"22"}}}"#,
            true,
            true
        ),
        Disposition::Quota
    );
    for status in [429, 401, 403, 404, 302, 500] {
        let expected = match status {
            429 => Disposition::Quota,
            401 | 403 => Disposition::Auth,
            404 => Disposition::Rejected,
            _ => Disposition::Retryable,
        };
        assert_eq!(classify(status, b"{}", true, true), expected);
    }
    for body in [b"".as_slice(), b"invalid", b"<OpenAPI_ServiceResponse/>"] {
        assert_eq!(classify(200, body, true, false), Disposition::Retryable);
    }
    assert_eq!(
        classify(
            200,
            br#"{"response":{"header":{"resultCode":"00"},"body":{"items":[]}}}"#,
            true,
            true
        ),
        Disposition::Data
    );
}
