//! Parity with the pinned legacy alarm-worker oracle (`ControllerPush` with firebase-admin
//! 5.13.1 over an HTTPS double): weather requests, OAuth assertions, FCM request bodies and
//! outcomes per case, and one scheduled minute (selection, weekday filter, sends, cleanup).
use super::common::*;
use server2::{
    push::{Coll, deliver::Delivery},
    world::js::Val,
};

fn http_calls(case: &serde_json::Value) -> Vec<(String, Option<String>)> {
    case["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] == "http")
        .map(|c| {
            (
                c["url"].as_str().unwrap().to_owned(),
                c["headers"]["Accept-Language"].as_str().map(str::to_owned),
            )
        })
        .collect()
}
fn https(case: &serde_json::Value, host: &str) -> Vec<serde_json::Value> {
    case["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] == "https" && c["host"] == host)
        .cloned()
        .collect()
}

/// The oracle's token request body with the assertion audience replaced by the endpoint Google
/// documents (`https://oauth2.googleapis.com/token`; firebase-admin 5.13.1 used
/// `https://accounts.google.com/o/oauth2/token`) and re-signed with the RFC 7515 A.2 key. The
/// oracle's own signature is first reproduced, so the signing primitive matches byte for byte.
fn with_documented_audience(body: &str) -> String {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
    let (prefix, assertion) = body.split_once("&assertion=").unwrap();
    let mut parts = assertion.split('.');
    let (header, claims, signature) = (
        parts.next().unwrap(),
        parts.next().unwrap(),
        parts.next().unwrap(),
    );
    let der = base64::engine::general_purpose::STANDARD
        .decode(include_str!("fixtures/rfc7515-a2-key.pkcs8.b64").trim())
        .unwrap();
    let key = ring::signature::RsaKeyPair::from_pkcs8(&der).unwrap();
    let sign = |input: &str| {
        let mut sig = vec![0u8; key.public().modulus_len()];
        key.sign(
            &ring::signature::RSA_PKCS1_SHA256,
            &ring::rand::SystemRandom::new(),
            input.as_bytes(),
            &mut sig,
        )
        .unwrap();
        B64.encode(sig)
    };
    assert_eq!(
        sign(&format!("{header}.{claims}")),
        signature,
        "oracle signature"
    );
    let text = String::from_utf8(B64.decode(claims).unwrap()).unwrap();
    let old = r#""aud":"https://accounts.google.com/o/oauth2/token""#;
    assert_eq!(text.matches(old).count(), 1, "{text}");
    let claims = B64.encode(text.replace(old, r#""aud":"https://oauth2.googleapis.com/token""#));
    let input = format!("{header}.{claims}");
    format!("{prefix}&assertion={input}.{}", sign(&input))
}

/// The expected server2 outcome of each oracle case. Legacy retried a send once after a
/// network error (`fcm-reset-*`); server2 sends once and records an unknown outcome (D02).
fn expected(id: &str) -> Delivery {
    let rejected = |status: u16, code: &str| Delivery::Rejected {
        status,
        code: code.into(),
    };
    let failed = |class: &'static str| Delivery::Failed { class };
    match id {
        "kma-missing-target" | "kma-missing-wf" | "geo-invalid" | "invalid" | "dsf-ta-noair" => {
            failed("build")
        }
        "geo-500" => failed("geocode-request"),
        "weather-500" | "weather-transport" => failed("weather-request"),
        "fcm-not-found" => Delivery::Unregistered {
            status: 404,
            disabled: true,
        },
        "fcm-invalid-argument" => rejected(400, "messaging/invalid-argument"),
        "fcm-quota" => rejected(429, "messaging/message-rate-exceeded"),
        "fcm-unavailable" => rejected(503, "messaging/server-unavailable"),
        "fcm-html-500" => rejected(500, "messaging/internal-error"),
        "fcm-reset-then-ok" | "fcm-reset-twice" => Delivery::Unknown {
            reason: "transport",
        },
        "token-error" => failed("fcm-oauth"),
        "ios-no-fcm" => failed("ios-without-fcm-token"),
        "android-gcm" => failed("gcm-retired"),
        "android-no-reg" => failed("gcm-without-registration-id"),
        "unknown-type" => failed("unknown-type"),
        _ => Delivery::Accepted,
    }
}

#[tokio::test]
async fn alarm_cases_match_the_legacy_worker() {
    let oracle = oracle();
    let ordered = oracle_ordered();
    let ordered_cases = items(ordered.get("cases").unwrap());
    let cases = oracle["cases"].as_array().unwrap();
    let rig = rig("parity", cases[0]["at"].as_str().unwrap(), &[], None).await;
    let mut checked = 0;
    for (case, ordered_case) in cases.iter().zip(ordered_cases) {
        let id = case["id"].as_str().unwrap();
        rig.clock.set(case["at"].as_str().unwrap());
        rig.weather.set(ordered_case.get("weather").unwrap());
        rig.weather.calls.lock().unwrap().clear();
        rig.google.clear();
        rig.google.state.token.lock().unwrap().clear();
        rig.google.state.fcm.lock().unwrap().clear();
        if !case["token"].is_null() {
            rig.google
                .state
                .token
                .lock()
                .unwrap()
                .push_back(answer_of(&case["token"]));
        }
        if let Some(list) = case["fcm"].as_array() {
            let mut q = rig.google.state.fcm.lock().unwrap();
            for a in list {
                q.push_back(answer_of(a));
            }
        }
        let record = alarm_record(1, ordered_case.get("pushInfo").unwrap());
        let now = server2::warnings::js::parse_iso(case["at"].as_str().unwrap()).unwrap();
        let mut info = record.doc.clone();
        let outcome = rig.worker.deliver(&mut info, now).await;
        assert_eq!(outcome, expected(id), "{id} outcome");
        // Weather and geocode requests, in order, with Accept-Language.
        assert_eq!(
            *rig.weather.calls.lock().unwrap(),
            http_calls(case),
            "{id} weather requests"
        );
        // OAuth: the legacy assertion bytes with Google's documented audience (deterministic
        // RS256 with the test key).
        let want_tokens: Vec<String> = https(case, "accounts.google.com")
            .iter()
            .map(|c| with_documented_audience(c["body"].as_str().unwrap()))
            .collect();
        let got_tokens: Vec<String> = rig.google.tokens().iter().map(|r| r.body.clone()).collect();
        assert_eq!(got_tokens, want_tokens, "{id} token requests");
        // FCM: identical bodies and paths; at most one request per delivery.
        let want: Vec<(String, String, String)> = https(case, "fcm.googleapis.com")
            .iter()
            .map(|c| {
                (
                    c["path"].as_str().unwrap().to_owned(),
                    c["headers"]["Authorization"].as_str().unwrap().to_owned(),
                    c["body"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let got: Vec<(String, String, String)> = rig
            .google
            .sends()
            .into_iter()
            .map(|r| (r.path, r.authorization.unwrap_or_default(), r.body))
            .collect();
        let want_once = if id.starts_with("fcm-reset") {
            want[..1].to_vec()
        } else {
            want
        };
        assert_eq!(got, want_once, "{id} FCM requests");
        checked += 1;
    }
    assert_eq!(checked, cases.len());
}

#[tokio::test]
async fn a_scheduled_minute_matches_the_legacy_worker_and_never_repeats() {
    let oracle = oracle();
    let ordered = oracle_ordered();
    let schedule = &oracle["schedule"];
    let records: Vec<_> = items(ordered.get("schedule").unwrap().get("records").unwrap())
        .iter()
        .enumerate()
        .map(|(i, r)| (Coll::Alarm, alarm_record(i as u8, r)))
        .collect();
    let at = schedule["at"].as_str().unwrap();
    let rig = rig("schedule", at, &records, None).await;
    let kma = ordered
        .get("schedule")
        .unwrap()
        .get("weather")
        .unwrap()
        .get("kma")
        .unwrap()
        .to_bytes();
    let routes = format!(
        r#"{{"kma":{},"geo":{{"status":200,"body":{{"country":"KR","kmaAddress":{{"name1":"서울특별시","name2":"중구"}},"location":{{"lat":37.56,"long":126.98}}}}}}}}"#,
        String::from_utf8(kma).unwrap()
    );
    rig.weather
        .set(&server2::gateway::OrderedJson::parse(routes.as_bytes()).unwrap());
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let report = rig.worker.run_minute(now).await;
    assert!(report.claimed);
    // The same FCM bodies as legacy (order may differ under concurrency).
    let mut want: Vec<String> = schedule["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] == "https" && c["host"] == "fcm.googleapis.com")
        .map(|c| c["body"].as_str().unwrap().to_owned())
        .collect();
    let mut got: Vec<String> = rig.google.sends().into_iter().map(|r| r.body).collect();
    want.sort();
    got.sort();
    assert_eq!(got, want);
    // Weather requests match as a multiset.
    let mut want_http = http_calls(schedule);
    let mut got_http = rig.weather.calls.lock().unwrap().clone();
    want_http.sort();
    got_http.sort();
    assert_eq!(got_http, want_http);
    // Cleanup: the 60-day records are removed and the record without updatedAt is stamped with
    // the worker's defaults, as legacy removeAlarms/upsertAlarm did.
    let (tokens, stamped) = {
        let state = rig.push.state();
        let state = state.read().unwrap();
        let tokens: Vec<String> = state
            .coll(Coll::Alarm)
            .iter()
            .map(|(_, r)| r.token("fcmToken").unwrap().to_owned())
            .collect();
        let stamped = state
            .coll(Coll::Alarm)
            .iter()
            .find(|(_, r)| r.token("fcmToken") == Some("s-6"))
            .unwrap()
            .1;
        (tokens, stamped)
    };
    assert_eq!(tokens, ["s-1", "s-2", "s-3", "s-4", "s-6"]);
    let upsert = schedule["calls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["method"] == "upsertAlarm")
        .unwrap();
    assert_eq!(stamped.doc.get("updatedAt"), &Val::Date(now as f64));
    assert_eq!(stamped.doc.get("updatedBy"), &Val::Str("user".into()));
    assert_eq!(
        stamped.doc.get("lang"),
        &Val::Str(upsert["args"][0]["lang"].as_str().unwrap().into())
    );
    // A restart (or a second tick) in the same minute finds the claim and sends nothing.
    let sends = rig.google.sends().len();
    let again = rig.worker.run_minute(now + 30_000).await;
    assert!(!again.claimed);
    assert_eq!(rig.google.sends().len(), sends, "no resend");
}
