//! D02 delivery guarantees: one provider request per delivery, no resend after a failure, an
//! unknown outcome or a restart, a later minute still delivers, and diagnostics and the
//! ledger carry no token, coordinate or name.
use super::common::*;
use super::state_common::{Fault, start};
use server2::{
    gateway::OrderedJson,
    push::{
        Coll, PushService,
        deliver::{AlarmWorker, Delivery},
    },
    world::js::Val,
};
use std::{sync::Arc, time::Duration};

const AT: &str = "2026-10-15T22:00:00.000Z";
const NOW: i64 = 1_792_101_600_000;

fn alarm(n: u8, token: &str, push_time: u32, extra: &str) -> (Coll, server2::push::Record) {
    let json = format!(
        r#"{{"type":"ios","fcmToken":"{token}","cityIndex":{n},"id":{n},"geo":[126.97,37.56],"source":"KMA","name":"집","lang":"ko","package":"todayWeather","pushTime":{push_time},"updatedAt":"2026-10-10T00:00:00.000Z"{extra}}}"#
    );
    (
        Coll::Alarm,
        alarm_record(n, &OrderedJson::parse(json.as_bytes()).unwrap()),
    )
}
fn kma_weather() -> OrderedJson {
    let o = oracle_ordered();
    let first = &items(o.get("cases").unwrap())[0];
    let kma = first.get("weather").unwrap().get("kma").unwrap().to_bytes();
    OrderedJson::parse(format!(r#"{{"kma":{}}}"#, String::from_utf8(kma).unwrap()).as_bytes())
        .unwrap()
}

#[test]
fn now_constant_matches() {
    assert_eq!(server2::warnings::js::parse_iso(AT).unwrap(), NOW);
}

#[tokio::test]
async fn a_send_is_made_once_and_failures_or_unknown_outcomes_are_not_retried() {
    let records = [
        alarm(1, "t-503", 79200, ""),
        alarm(2, "t-hang", 79200, ""),
        alarm(3, "t-reset", 79200, ""),
    ];
    let rig = rig("once", AT, &records, Some(Duration::from_millis(300))).await;
    rig.weather.set(&kma_weather());
    // Scripted per request in send order is not deterministic under concurrency: give every
    // send the same failing answer per run instead.
    for (answer, token) in [
        (
            Answer::Json(
                503,
                r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
            ),
            "t-503",
        ),
        (Answer::Hang, "t-hang"),
        (Answer::Reset, "t-reset"),
    ] {
        let mut info = records
            .iter()
            .find(|(_, r)| r.token("fcmToken") == Some(token))
            .unwrap()
            .1
            .doc
            .clone();
        rig.google.clear();
        rig.google.state.fcm.lock().unwrap().push_back(answer);
        let outcome = rig.worker.deliver(&mut info, NOW).await;
        assert_eq!(rig.google.sends().len(), 1, "{token}: exactly one request");
        match token {
            "t-503" => assert!(matches!(outcome, Delivery::Rejected { status: 503, .. })),
            "t-hang" => assert_eq!(outcome, Delivery::Unknown { reason: "timeout" }),
            _ => assert_eq!(
                outcome,
                Delivery::Unknown {
                    reason: "transport"
                }
            ),
        }
        // Nothing is sent again later for the same delivery.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(rig.google.sends().len(), 1, "{token}: no hidden retry");
    }
}

#[tokio::test]
async fn a_restarted_process_never_resends_a_claimed_minute_and_a_later_minute_still_delivers() {
    let records = [alarm(1, "m-1", 79200, ""), alarm(2, "m-2", 79260, "")];
    let rig = rig("restart", AT, &records, None).await;
    rig.weather.set(&kma_weather());
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
        503,
        r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
    ));
    let first = rig.worker.run_minute(NOW).await;
    assert!(first.claimed);
    assert_eq!(first.deliveries[0].1, "rejected");
    assert_eq!(rig.google.sends().len(), 1);
    // A replacement process (new state, new worker, same S3) at the same minute.
    let push2 = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let worker2 = worker_on(&rig, push2.clone());
    let again = worker2.run_minute(NOW + 5_000).await;
    assert!(!again.claimed);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "the failed delivery is not resent"
    );
    // The next minute is a separate delivery and runs.
    rig.clock.set("2026-10-15T22:01:00.000Z");
    let next = worker2.run_minute(NOW + 60_000).await;
    assert!(next.claimed);
    assert_eq!(next.deliveries.len(), 1);
    assert_eq!(next.deliveries[0].1, "accepted");
    assert_eq!(rig.google.sends().len(), 2);
}

fn worker_on(rig: &Rig, push: Arc<PushService>) -> AlarmWorker<super::state_common::MemS3> {
    let fcm = fcm(&rig.google, &temp_dir("restart-2"));
    AlarmWorker::new(
        push,
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    )
}

#[tokio::test]
async fn without_a_durable_claim_nothing_is_sent() {
    let rig = rig("claim", AT, &[alarm(1, "c-1", 79200, "")], None).await;
    rig.weather.set(&kma_weather());
    rig.s3
        .fault_put("index/v2/push/delivery/", Fault::Reject(503));
    rig.s3.fault_gets("index/v2/push/delivery/", 1);
    let report = rig.worker.run_minute(NOW).await;
    assert!(!report.claimed);
    assert!(rig.google.sends().is_empty());
    assert!(rig.diagnostics.minutes.lock().unwrap()[0].contains("ledger unavailable"));
}

#[tokio::test]
async fn an_unrestored_state_neither_claims_nor_sends_the_minute() {
    let rig = rig("unready", AT, &[alarm(1, "u-1", 79200, "")], None).await;
    rig.weather.set(&kma_weather());
    let broken_s3 = super::state_common::MemS3::new();
    broken_s3.insert("index/v2/push/state/head.json", b"not json");
    let broken = PushService::start(
        Arc::new(broken_s3.clone()),
        rig.clock.clone(),
        Box::new(super::state_common::OracleIds(0)),
        super::state_common::fast_config(),
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!broken.ready());
    let worker = AlarmWorker::new(
        broken,
        Arc::new(broken_s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("unready-2"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(NOW).await;
    assert!(!report.claimed);
    assert!(
        broken_s3.keys("index/v2/push/delivery/").is_empty(),
        "no claim"
    );
    assert!(rig.google.sends().is_empty());
    assert!(rig.diagnostics.minutes.lock().unwrap()[0].contains("not ready"));
    // A process whose state is restored still owns the unclaimed minute.
    assert!(rig.worker.run_minute(NOW).await.claimed);
    assert_eq!(rig.google.sends().len(), 1);
}

const UNREGISTERED: &str = r#"{"error":{"code":404,"status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}"#;

fn enabled_after_restore(state: &server2::push::State) -> Vec<(String, Val)> {
    state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| {
            (
                r.token("fcmToken").unwrap().to_owned(),
                r.doc.get("enable").clone(),
            )
        })
        .collect()
}

#[tokio::test]
async fn an_unregistered_token_disables_its_alarms_durably() {
    // `fresh` has no updatedAt and `enable: true`: the worker's stamp must not re-enable it.
    // `old` is older than 60 days: removed in the same minute, as legacy did.
    let mut fresh = alarm(4, "fresh", 79200, r#","enable":true"#);
    fresh.1.doc.remove("updatedAt");
    let mut old = alarm(5, "old", 79200, "");
    old.1.doc.set("updatedAt", Val::Date(1_700_000_000_000.));
    let records = [
        alarm(1, "gone", 79200, ""),
        alarm(2, "gone", 0, ""),
        alarm(3, "kept", 0, ""),
        fresh,
        old,
    ];
    let rig = rig("unregistered", AT, &records, None).await;
    rig.weather.set(&kma_weather());
    for _ in 0..3 {
        rig.google
            .state
            .fcm
            .lock()
            .unwrap()
            .push_back(Answer::Json(404, UNREGISTERED.into()));
    }
    let report = rig.worker.run_minute(NOW).await;
    let classes: Vec<(&str, &str)> = report
        .deliveries
        .iter()
        .map(|(_, o, c)| (o.as_str(), c.as_str()))
        .collect();
    assert_eq!(
        classes,
        [(
            "unregistered",
            "messaging/registration-token-not-registered"
        ); 3]
    );
    // The disable was durable before the outcome was reported: an empty-memory restore sees it.
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    assert_eq!(
        enabled_after_restore(&state),
        [
            ("gone".to_owned(), Val::Bool(false)),
            ("gone".to_owned(), Val::Bool(false)),
            ("kept".to_owned(), Val::Undef),
            ("fresh".to_owned(), Val::Bool(false)),
        ]
    );
}

/// Weather double that first applies a user update through the push routes, so the update
/// lands between the minute's selection and the send.
struct UpdatingFetch {
    inner: Arc<WeatherDouble>,
    push: Arc<PushService>,
    body: serde_json::Value,
}
impl server2::push::deliver::Fetch for UpdatingFetch {
    fn get(
        &self,
        url: String,
        lang: Option<String>,
    ) -> server2::gateway::BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        Box::pin(async move {
            let bytes = serde_json::to_vec(&self.body).unwrap();
            let request = axum::extract::Request::builder()
                .method("POST")
                .uri("/v000705/push")
                .header("content-type", "application/json")
                .header("content-length", bytes.len())
                .body(axum::body::Body::from(bytes))
                .unwrap();
            let response = self.push.handle(request).await.unwrap();
            assert_eq!(response.status().as_u16(), 200);
            self.inner.get(url, lang).await
        })
    }
}

#[tokio::test]
async fn a_user_update_during_the_minute_survives_the_stale_cleanup() {
    // Selected as stale (updated > 60 days ago); the user updates it during the minute; FCM
    // would answer unregistered, but final selection rejects the changed subscription.
    // The cleanup keeps the user's record and no provider POST occurs.
    let mut stale = alarm(1, "stale", 79200, "");
    stale.1.doc.set("updatedAt", Val::Date(1_700_000_000_000.));
    let rig = rig_named("user-update", &[stale]).await;
    rig.google
        .state
        .fcm
        .lock()
        .unwrap()
        .push_back(Answer::Json(404, UNREGISTERED.into()));
    let fetch = Arc::new(UpdatingFetch {
        inner: rig.weather.clone(),
        push: rig.push.clone(),
        body: serde_json::json!({"type": "ios", "fcmToken": "stale", "cityIndex": 1, "id": 1,
            "location": {"lat": 37.56, "long": 126.97}, "source": "KMA", "name": "새집",
            "pushTime": 79200}),
    });
    let worker = AlarmWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        fetch,
        Arc::new(fcm(&rig.google, &temp_dir("user-update-2"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(NOW).await;
    assert_eq!(report.deliveries[0].1, "failed");
    assert_eq!(report.deliveries[0].2, "alarm-admission");
    assert!(rig.google.sends().is_empty());
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let records: Vec<(Val, Val)> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| (r.doc.get("name").clone(), r.doc.get("enable").clone()))
        .collect();
    assert_eq!(records, [(Val::Str("새집".into()), Val::Undef)]);
}

#[tokio::test]
async fn a_same_settings_user_update_during_the_minute_survives_the_stale_cleanup() {
    // The record is created through the API 90 days ago; during the minute the user sends the
    // same registration again (only `updatedAt`/`updatedBy` change), then FCM answers
    // unregistered. The record must be kept (disabled), not removed as stale.
    let rig = rig_named("same-update", &[]).await;
    let body = serde_json::json!({"type": "ios", "fcmToken": "same", "cityIndex": 1, "id": 1,
        "location": {"lat": 37.56, "long": 126.97}, "source": "KMA", "name": "집",
        "pushTime": 79200});
    rig.clock.set("2026-07-17T00:00:00.000Z");
    let fetch = Arc::new(UpdatingFetch {
        inner: rig.weather.clone(),
        push: rig.push.clone(),
        body: body.clone(),
    });
    // Create it once (old clock) through the same route.
    server2::push::deliver::Fetch::get(&*fetch, "http://unrouted.test/".into(), None)
        .await
        .ok();
    rig.clock.set(AT);
    rig.google
        .state
        .fcm
        .lock()
        .unwrap()
        .push_back(Answer::Json(404, UNREGISTERED.into()));
    let worker = AlarmWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        fetch,
        Arc::new(fcm(&rig.google, &temp_dir("same-update-2"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(NOW).await;
    assert_eq!(report.deliveries[0].1, "unregistered");
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let records: Vec<(Val, Val)> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| (r.doc.get("enable").clone(), r.doc.get("updatedBy").clone()))
        .collect();
    assert_eq!(
        records,
        [(Val::Bool(false), Val::Str("push".into()))],
        "kept and disabled"
    );
}

#[tokio::test]
async fn an_undecidable_claim_is_never_sent_and_the_next_minute_is() {
    // The claim is stored but its answer is lost and the read-back fails: nothing is sent.
    // A replacement process finds the claim; the next minute is delivered.
    let rig = rig_named(
        "claim-undecided",
        &[alarm(1, "u-1", 79200, ""), alarm(2, "u-2", 79260, "")],
    )
    .await;
    rig.s3
        .fault_put("index/v2/push/delivery/", Fault::CommitLostUnreadable);
    let first = rig.worker.run_minute(NOW).await;
    assert!(!first.claimed);
    assert!(rig.google.sends().is_empty());
    let push2 = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let worker2 = worker_on(&rig, push2);
    assert!(!worker2.run_minute(NOW + 2_000).await.claimed);
    assert!(rig.google.sends().is_empty());
    rig.clock.set("2026-10-15T22:01:00.000Z");
    let next = worker2.run_minute(NOW + 60_000).await;
    assert!(next.claimed);
    assert_eq!(rig.google.sends().len(), 1);
}

#[tokio::test]
async fn the_minute_selects_like_get_alarms_by_time_and_the_weekday_filter() {
    // 2026-10-15T22:00Z is Thursday (4) in UTC and Friday (5) at UTC+9.
    let records = [
        alarm(1, "due", 79200, ""),
        alarm(2, "other-minute", 79260, ""),
        alarm(3, "disabled", 79200, r#","enable":false"#),
        alarm(4, "enabled", 79200, r#","enable":true"#),
        alarm(
            5,
            "local-friday",
            79200,
            r#","timezoneOffset":540,"dayOfWeek":[true,true,true,true,false,true,true]"#,
        ),
        alarm(
            6,
            "not-local-friday",
            79200,
            r#","timezoneOffset":540,"dayOfWeek":[true,true,true,true,true,false,true]"#,
        ),
        alarm(
            7,
            "no-offset",
            79200,
            r#","dayOfWeek":[true,true,true,true,true,true,true]"#,
        ),
        alarm(8, "empty-days", 79200, r#","dayOfWeek":[]"#),
    ];
    let rig = rig_named("selection", &records).await;
    let report = rig.worker.run_minute(NOW).await;
    assert!(report.claimed);
    let mut tokens: Vec<String> = rig
        .google
        .sends()
        .iter()
        .map(|r| {
            let v: serde_json::Value = serde_json::from_str(&r.body).unwrap();
            v["message"]["token"].as_str().unwrap().to_owned()
        })
        .collect();
    tokens.sort();
    assert_eq!(tokens, ["due", "empty-days", "enabled", "local-friday"]);
}

#[tokio::test]
async fn the_stale_cleanup_removes_only_stale_records_of_the_selector() {
    // Three records match the selected record's `makeRemoveSelector` filter (fcmToken,
    // cityIndex, id): the selected stale one and another stale one are removed (as legacy
    // `removeAlarms` did); a recently updated one is kept.
    let old = Val::Date(1_700_000_000_000.);
    let mut selected = alarm(1, "shared", 79200, "");
    selected.1.doc.set("updatedAt", old.clone());
    let mut other_stale = alarm(1, "shared", 0, "");
    other_stale.1.doc.set("type", "android");
    other_stale.1.doc.set("updatedAt", old);
    other_stale.1.oid[10] = 2;
    let mut fresh = alarm(1, "shared", 0, "");
    fresh.1.doc.set("type", "web");
    fresh.1.oid[10] = 3;
    let rig = rig_named("selector", &[selected, other_stale, fresh]).await;
    let report = rig.worker.run_minute(NOW).await;
    assert_eq!(report.deliveries.len(), 1);
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let kinds: Vec<Val> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| r.doc.get("type").clone())
        .collect();
    assert_eq!(kinds, [Val::Str("web".into())]);
}

#[tokio::test]
async fn the_oauth_token_follows_the_send_time_not_the_minute_start() {
    let rig = rig_named("token-time", &[alarm(1, "t-1", 79200, "")]).await;
    let mut info = alarm(1, "t-1", 79200, "").1.doc;
    assert_eq!(
        rig.worker.deliver(&mut info.clone(), NOW).await,
        Delivery::Accepted
    );
    assert_eq!(rig.google.tokens().len(), 1);
    // The same minute's start, but the send happens after the cached token expired.
    rig.clock.set("2026-10-15T23:00:00.000Z");
    assert_eq!(rig.worker.deliver(&mut info, NOW).await, Delivery::Accepted);
    let tokens = rig.google.tokens();
    assert_eq!(tokens.len(), 2, "refreshed at send time");
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let assertion = tokens[1].body.split("&assertion=").nth(1).unwrap();
    let claims: serde_json::Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(assertion.split('.').nth(1).unwrap())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(claims["iat"], (NOW + 3_600_000) / 1000);
}

#[tokio::test]
async fn an_unrecorded_result_is_reported_and_nothing_is_resent() {
    let rig = rig_named("result-failed", &[alarm(1, "r-1", 79200, "")]).await;
    rig.s3.fault_put(
        "index/v2/push/delivery/alarm/20261015/2200.result.json",
        Fault::Reject(403),
    );
    let report = rig.worker.run_minute(NOW).await;
    assert!(report.claimed);
    assert_eq!(rig.google.sends().len(), 1);
    assert!(
        rig.diagnostics.minutes.lock().unwrap()[0].contains("result not recorded"),
        "{:?}",
        rig.diagnostics.minutes.lock().unwrap()
    );
    assert!(!rig.worker.run_minute(NOW + 1_000).await.claimed);
    assert_eq!(rig.google.sends().len(), 1);
}

#[tokio::test]
async fn a_result_with_a_lost_answer_is_read_back() {
    const RESULT: &str = "index/v2/push/delivery/alarm/20261015/2200.result.json";
    // Stored, answer lost: read back as recorded, no note.
    let rig = rig_named("result-lost", &[alarm(1, "r-1", 79200, "")]).await;
    rig.s3.fault_put(RESULT, Fault::CommitLost);
    assert!(rig.worker.run_minute(NOW).await.claimed);
    assert!(rig.s3.body(RESULT).is_some());
    assert!(rig.diagnostics.minutes.lock().unwrap().is_empty());
    // Answer lost and unreadable: reported as unknown, not as unrecorded.
    let rig = rig_named("result-unknown", &[alarm(1, "r-1", 79200, "")]).await;
    rig.s3.fault_put(RESULT, Fault::LostUnreadable);
    assert!(rig.worker.run_minute(NOW).await.claimed);
    assert!(
        rig.diagnostics.minutes.lock().unwrap()[0].contains("result write outcome unknown"),
        "{:?}",
        rig.diagnostics.minutes.lock().unwrap()
    );
}

#[tokio::test]
async fn an_unregistered_stale_record_is_removed_with_the_disable_in_one_entry() {
    // The selected record is stale; another record of the same token is not. The disable and
    // the stale removal are one journal entry, so no restart or later failure can leave the
    // stale record enabled.
    let mut stale = alarm(1, "gone", 79200, "");
    stale.1.doc.set("updatedAt", Val::Date(1_700_000_000_000.));
    let other = alarm(2, "gone", 0, "");
    let rig = rig_named("atomic", &[stale, other]).await;
    rig.google
        .state
        .fcm
        .lock()
        .unwrap()
        .push_back(Answer::Json(404, UNREGISTERED.into()));
    let before = rig.s3.put_count("index/v2/push/state/journal/");
    let report = rig.worker.run_minute(NOW).await;
    assert_eq!(report.deliveries[0].1, "unregistered");
    assert_eq!(
        rig.s3.put_count("index/v2/push/state/journal/") - before,
        1,
        "one journal entry for the disable and the removal"
    );
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let records: Vec<(Val, Val)> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| (r.doc.get("cityIndex").clone(), r.doc.get("enable").clone()))
        .collect();
    assert_eq!(records, [(Val::Num(2.), Val::Bool(false))]);
}

#[tokio::test]
async fn stale_selections_sharing_a_token_are_all_removed() {
    // Two stale alarms of one token with different selectors (cityIndex/id) in one minute, both
    // answered unregistered: the first disable must not make the second look recent.
    let old = Val::Date(1_700_000_000_000.);
    let mut a = alarm(1, "gone", 79200, "");
    a.1.doc.set("updatedAt", old.clone());
    let mut b = alarm(2, "gone", 79200, "");
    b.1.doc.set("updatedAt", old);
    let other = alarm(3, "gone", 0, "");
    let rig = rig_named("shared-token", &[a, b, other]).await;
    for _ in 0..2 {
        rig.google
            .state
            .fcm
            .lock()
            .unwrap()
            .push_back(Answer::Json(404, UNREGISTERED.into()));
    }
    let report = rig.worker.run_minute(NOW).await;
    assert_eq!(report.deliveries.len(), 2);
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let records: Vec<(Val, Val)> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| (r.doc.get("cityIndex").clone(), r.doc.get("enable").clone()))
        .collect();
    assert_eq!(records, [(Val::Num(3.), Val::Bool(false))]);
}

#[tokio::test]
async fn a_failed_disable_is_reported_and_nothing_is_resent() {
    let rig = rig("disable-failed", AT, &[alarm(1, "gone", 79200, "")], None).await;
    rig.weather.set(&kma_weather());
    rig.google
        .state
        .fcm
        .lock()
        .unwrap()
        .push_back(Answer::Json(404, UNREGISTERED.into()));
    rig.s3
        .fault_put("index/v2/push/state/journal/", Fault::Reject(403));
    let report = rig.worker.run_minute(NOW).await;
    assert_eq!(
        report.deliveries[0].2,
        "messaging/registration-token-not-registered;disable-failed"
    );
    assert_eq!(rig.google.sends().len(), 1);
    assert!(!rig.worker.run_minute(NOW + 1_000).await.claimed);
    assert_eq!(rig.google.sends().len(), 1);
}

#[tokio::test]
async fn a_claim_with_a_lost_answer_is_read_back() {
    // Stored but the answer was lost: the read-back finds our own claim and delivers once.
    let rig = rig("claim-lost", AT, &[alarm(1, "c-1", 79200, "")], None).await;
    rig.weather.set(&kma_weather());
    rig.s3
        .fault_put("index/v2/push/delivery/", Fault::CommitLost);
    let report = rig.worker.run_minute(NOW).await;
    assert!(report.claimed);
    assert_eq!(rig.google.sends().len(), 1);
    // Not stored and the answer lost, while another process's claim is there: taken.
    let rig = rig_named("claim-other", &[alarm(1, "c-1", 79200, "")]).await;
    rig.s3.insert(
        "index/v2/push/delivery/alarm/20261015/2200.json",
        br#"{"schema":1,"kind":"alarm","claim":"other"}"#,
    );
    rig.s3.fault_put("index/v2/push/delivery/", Fault::Lost);
    let report = rig.worker.run_minute(NOW).await;
    assert!(!report.claimed);
    assert!(rig.google.sends().is_empty());
}

async fn rig_named(name: &str, records: &[(Coll, server2::push::Record)]) -> Rig {
    let rig = rig(name, AT, records, None).await;
    rig.weather.set(&kma_weather());
    rig
}

#[tokio::test]
async fn concurrent_claims_of_one_minute_deliver_once() {
    let rig = rig_named(
        "race",
        &[alarm(1, "r-1", 79200, ""), alarm(2, "r-2", 79200, "")],
    )
    .await;
    let push2 = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let worker2 = worker_on(&rig, push2);
    let (a, b) = tokio::join!(rig.worker.run_minute(NOW), worker2.run_minute(NOW + 1));
    assert!(a.claimed ^ b.claimed, "exactly one owner");
    let mut tokens: Vec<String> = rig
        .google
        .sends()
        .iter()
        .map(|r| {
            let v: serde_json::Value = serde_json::from_str(&r.body).unwrap();
            v["message"]["token"].as_str().unwrap().to_owned()
        })
        .collect();
    tokens.sort();
    assert_eq!(tokens, ["r-1", "r-2"]);
}

#[test]
fn classification_follows_firebase_admin_5_13_1() {
    use server2::push::deliver::{SendOutcome, fcm::classify};
    let json = |status: u16, body: &str| {
        classify(status, "application/json; charset=UTF-8", body.as_bytes())
    };
    let rejected = |status: u16, code: &str| SendOutcome::Rejected {
        status,
        code: code.into(),
    };
    // firebase-admin 5.13.1 reads the `FcmErrorCode` detail first ...
    assert_eq!(
        json(
            400,
            r#"{"error":{"status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmErrorCode","errorCode":"NOT_FOUND"}]}}"#
        ),
        SendOutcome::Unregistered { status: 400 }
    );
    // ... and current FCM's `FcmError` detail is not that type, so the status decides (the
    // documented UNREGISTERED, QUOTA_EXCEEDED, SENDER_ID_MISMATCH and THIRD_PARTY_AUTH_ERROR
    // statuses map to the same client codes).
    let fcm_error = |status: u16, grpc: &str, code: &str| {
        json(
            status,
            &format!(
                r#"{{"error":{{"code":{status},"status":"{grpc}","details":[{{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"{code}"}}]}}}}"#
            ),
        )
    };
    assert_eq!(
        fcm_error(404, "NOT_FOUND", "UNREGISTERED"),
        SendOutcome::Unregistered { status: 404 }
    );
    assert_eq!(
        fcm_error(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"),
        rejected(429, "messaging/message-rate-exceeded")
    );
    assert_eq!(
        fcm_error(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"),
        rejected(403, "messaging/mismatched-credential")
    );
    assert_eq!(
        fcm_error(401, "UNAUTHENTICATED", "THIRD_PARTY_AUTH_ERROR"),
        rejected(401, "messaging/invalid-apns-credentials")
    );
    assert_eq!(
        fcm_error(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"),
        rejected(400, "messaging/invalid-argument")
    );
    // A string error, a 2xx with an error, text answers and unparsable bodies.
    assert_eq!(
        json(200, r#"{"error":"NotRegistered"}"#),
        SendOutcome::Unregistered { status: 200 }
    );
    assert_eq!(
        classify(200, "text/html", b"<html>"),
        rejected(200, "messaging/unknown-error")
    );
    assert_eq!(
        classify(503, "text/plain", b"busy"),
        rejected(503, "messaging/server-unavailable")
    );
    assert_eq!(
        json(502, "not json"),
        rejected(502, "app/unable-to-parse-response")
    );
    assert_eq!(
        json(200, r#"{"name":"projects/p/messages/1"}"#),
        SendOutcome::Accepted
    );
}

#[tokio::test]
async fn duplicate_registrations_keep_the_newer_record() {
    let mut a = alarm(1, "x", 600, "");
    let mut b = alarm(2, "x", 600, "");
    for (rec, date) in [(&mut a, 1_700_000_000_000.), (&mut b, 1_790_000_000_000.)] {
        rec.1.doc.remove("fcmToken");
        rec.1.doc.set("registrationId", "reg-dup");
        rec.1.doc.set("cityIndex", 0.);
        rec.1.doc.set("id", 0.);
        rec.1.doc.set("updatedAt", Val::Date(date));
    }
    let rig = rig("duplicates", AT, &[a, b], None).await;
    // No alarm is due at this minute: duplicates are still removed, and no ledger object is
    // written for an empty minute.
    assert!(!rig.worker.run_minute(NOW).await.claimed);
    assert!(rig.s3.keys("index/v2/push/delivery/").is_empty());
    let state = rig.push.state();
    let state = state.read().unwrap();
    let left: Vec<Val> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| r.doc.get("updatedAt").clone())
        .collect();
    assert_eq!(left, [Val::Date(1_790_000_000_000.)]);
}

#[tokio::test]
async fn diagnostics_and_the_ledger_hold_no_tokens_coordinates_or_names() {
    let records = [
        alarm(1, "secret-token-A", 79200, ""),
        alarm(2, "secret-token-B", 79200, r#","type":"web""#),
    ];
    let rig = rig("privacy", AT, &records, None).await;
    rig.weather.set(&kma_weather());
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
        400,
        r#"{"error":{"code":400,"status":"INVALID_ARGUMENT"}}"#.into(),
    ));
    rig.worker.run_minute(NOW).await;
    let events = format!(
        "{:?} {:?}",
        rig.diagnostics.events.lock().unwrap(),
        rig.diagnostics.minutes.lock().unwrap()
    );
    let ledger: String = rig
        .s3
        .keys("index/v2/push/delivery/")
        .iter()
        .map(|k| String::from_utf8(rig.s3.body(k).unwrap()).unwrap())
        .collect();
    assert!(ledger.contains("\"outcome\""), "{ledger}");
    for text in [&events, &ledger] {
        for secret in ["secret-token", "126.97", "37.56", "집"] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
    }
    assert_eq!(rig.diagnostics.events.lock().unwrap().len(), 2);
}

struct SchedulerJumpClock(std::sync::atomic::AtomicUsize);
impl server2::budget::Clock for SchedulerJumpClock {
    fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
        let at = if self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
            "2026-10-16T00:06:59.999Z"
        } else {
            "2026-10-16T00:35:00Z"
        };
        Ok(server2::warnings::js::parse_iso(at).unwrap())
    }
}

#[tokio::test]
async fn scheduler_does_not_send_a_missed_alarm_after_a_clock_jump() {
    let records = [
        alarm(1, "missed-alarm", 7 * 60, ""),
        alarm(2, "current-alarm", 35 * 60, ""),
    ];
    let rig = rig("alarm-clock-jump", "2026-10-16T00:35:00Z", &records, None).await;
    rig.weather.set(&kma_weather());
    let worker = Arc::new(AlarmWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("alarm-clock-jump-provider"))),
        servers(),
        Arc::new(SchedulerJumpClock(std::sync::atomic::AtomicUsize::new(0))),
        rig.diagnostics.clone(),
    ));
    let scheduler = tokio::spawn(worker.run());
    let sent = tokio::time::timeout(Duration::from_secs(2), async {
        while rig.google.sends().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await;
    scheduler.abort();
    sent.unwrap();
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alarm/20261016/0035.json")
            .is_some(),
        "claim the actual wake minute"
    );
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alarm/20261016/0007.json")
            .is_none(),
        "do not claim or send the missed minute"
    );
    assert_eq!(rig.google.sends().len(), 1);
    assert!(rig.google.sends()[0].body.contains("current-alarm"));
    assert!(!rig.google.sends()[0].body.contains("missed-alarm"));
}
