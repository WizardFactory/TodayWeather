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

#[tokio::test]
async fn an_unregistered_token_disables_its_alarms_durably() {
    let records = [
        alarm(1, "gone", 79200, ""),
        alarm(2, "gone", 0, ""),
        alarm(3, "kept", 0, ""),
    ];
    let rig = rig("unregistered", AT, &records, None).await;
    rig.weather.set(&kma_weather());
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
        404,
        r#"{"error":{"code":404,"status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}"#.into(),
    ));
    let report = rig.worker.run_minute(NOW).await;
    assert_eq!(report.deliveries[0].1, "unregistered");
    tokio::time::sleep(Duration::from_millis(100)).await;
    let restored = start(
        &rig.s3,
        rig.clock.clone(),
        super::state_common::fast_config(),
    )
    .await;
    let state = restored.state();
    let state = state.read().unwrap();
    let enabled: Vec<(String, Val)> = state
        .coll(Coll::Alarm)
        .iter()
        .map(|(_, r)| {
            (
                r.token("fcmToken").unwrap().to_owned(),
                r.doc.get("enable").clone(),
            )
        })
        .collect();
    assert_eq!(
        enabled,
        [
            ("gone".to_owned(), Val::Bool(false)),
            ("gone".to_owned(), Val::Bool(false)),
            ("kept".to_owned(), Val::Undef)
        ]
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
