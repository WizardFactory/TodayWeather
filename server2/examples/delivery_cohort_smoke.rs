//! Standalone owned-HTTP C2 rehearsal. Synthetic credentials, recorded weather, memory journal.
#![allow(dead_code)]
#[path = "../tests/delivery/common.rs"]
mod common;
#[path = "../tests/state/common.rs"]
mod state_common;
use common::*;
use server2::{
    gateway::OrderedJson,
    push::{
        Coll, PushService, Record,
        deliver::{alerts::AlertWorker, fcm::Fcm},
    },
    world::js::{Obj, Val},
};
use state_common::{MemS3, fast_config, start};
use std::{io::Read, sync::Arc, time::Duration};

#[derive(Clone, Copy)]
enum Case {
    Oauth,
    Metadata,
    Rejected,
    Unknown,
}
impl Case {
    fn id(self) -> &'static str {
        match self {
            Self::Oauth => "oauth-refusal",
            Self::Metadata => "metadata-edit",
            Self::Rejected => "actual-rejected",
            Self::Unknown => "actual-unknown",
        }
    }
    fn no_post(self) -> bool {
        matches!(self, Self::Oauth | Self::Metadata)
    }
}
fn record() -> (Record, OrderedJson) {
    let mut text = String::new();
    flate2::read::GzDecoder::new(
        &include_bytes!("../tests/delivery/fixtures/alerts-oracle.json.gz")[..],
    )
    .read_to_string(&mut text)
    .unwrap();
    let oracle = OrderedJson::parse(text.as_bytes()).unwrap();
    let case = items(oracle.get("cases").unwrap())
        .iter()
        .find(|c| c.get("id").unwrap().string().as_deref() == Some("current-ko-1"))
        .unwrap();
    let Val::Obj(mut doc) = Val::from_ordered(case.get("record").unwrap()) else {
        panic!("record")
    };
    doc.set("fcmToken", Val::Str("synthetic-cli-original".into()));
    (
        Record {
            oid: [0x75; 12],
            doc,
        },
        case.get("body").unwrap().clone(),
    )
}
fn snapshot(push: &PushService) -> Obj {
    push.state()
        .read()
        .unwrap()
        .coll(Coll::Alert)
        .get(0)
        .unwrap()
        .doc
}
fn worker(rig: &Rig, push: Arc<PushService>, provider: Arc<Fcm>) -> AlertWorker<MemS3> {
    AlertWorker::new(
        push,
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        provider,
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    )
}
async fn edit_with_other_writer(rig: &Rig) {
    use server2::push::{Counters, Durable, durable::Commit, store::Change};
    let mut other = Durable::new(
        Arc::new(rig.s3.clone()),
        fast_config().durable,
        Arc::new(Counters::default()),
    );
    let state = other.restore().await.unwrap();
    let mut record = state.coll(Coll::Alert).get(0).unwrap();
    record
        .doc
        .set("name", Val::Str("Synthetic edited town".into()));
    record
        .doc
        .set("fcmToken", Val::Str("synthetic-cli-rotated".into()));
    let change = Change {
        coll: Coll::Alert,
        n: 0,
        oid: record.oid,
        record: Some(record),
        imported: None,
    };
    assert!(matches!(
        other.commit(state.seq + 1, &[change], state.next_n).await,
        Commit::Committed
    ));
}
async fn run(case: Case) -> serde_json::Value {
    let at = "2026-10-16T00:07:00Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let (record, body) = record();
    let rig = rig(
        &format!("cohort-cli-{}", case.id()),
        at,
        &[(Coll::Alert, record)],
        None,
    )
    .await;
    rig.weather.set(
        &OrderedJson::parse(
            format!(
                r#"{{"kma":{{"status":200,"body":{}}}}}"#,
                String::from_utf8(body.to_bytes()).unwrap()
            )
            .as_bytes(),
        )
        .unwrap(),
    );
    let provider = Arc::new(fcm(
        &rig.google,
        &temp_dir(&format!(
            "cohort-cli-client-{}",
            rig.google.root.replace([':', '/'], "_")
        )),
    ));
    let initial = snapshot(&rig.push);
    let first = worker(&rig, rig.push.clone(), provider.clone());
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    match case {
        Case::Oauth => rig
            .google
            .state
            .token
            .lock()
            .unwrap()
            .push_back(Answer::Json(503, r#"{"error":"temporary"}"#.into())),
        Case::Metadata => rig
            .google
            .state
            .token
            .lock()
            .unwrap()
            .push_back(Answer::Held(
                started.clone(),
                release.clone(),
                DEFAULT_TOKEN.into(),
            )),
        Case::Rejected => rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
            503,
            r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
        )),
        Case::Unknown => rig
            .google
            .state
            .fcm
            .lock()
            .unwrap()
            .push_back(Answer::Reset),
    }
    let report = if matches!(case, Case::Metadata) {
        let task = tokio::spawn(async move { first.run_minute(now).await });
        tokio::time::timeout(Duration::from_secs(10), started.notified())
            .await
            .unwrap();
        edit_with_other_writer(&rig).await;
        release.notify_one();
        task.await.unwrap()
    } else {
        first.run_minute(now).await
    };
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), 1);
    let outcome = report.deliveries[0].1.to_owned();
    let first_posts = rig.google.sends().len();
    let claim = "index/v2/push/delivery/alert/20261016/0007.json";
    assert!(rig.s3.body(claim).is_some());
    if case.no_post() {
        assert_eq!(first_posts, 0);
        assert_eq!(
            snapshot(&rig.push).get("precipAlerts"),
            initial.get("precipAlerts")
        );
        assert_eq!(outcome, "failed");
        if matches!(case, Case::Metadata) {
            let current = snapshot(&rig.push);
            assert_eq!(
                current.get("fcmToken"),
                &Val::Str("synthetic-cli-rotated".into())
            );
            assert_eq!(
                current.get("name"),
                &Val::Str("Synthetic edited town".into())
            );
        }
    } else {
        assert_eq!(first_posts, 1);
        assert_eq!(
            snapshot(&rig.push).get("precipAlerts").get("lastState"),
            &Val::Num(1.)
        );
        assert_eq!(
            snapshot(&rig.push).get("precipAlerts").get("pushTime"),
            &Val::Date(now as f64)
        );
        assert_eq!(
            outcome,
            if matches!(case, Case::Rejected) {
                "rejected"
            } else {
                "unknown"
            }
        );
    }
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    if case.no_post() {
        // The state equals the still-eligible original trigger, so the durable claim alone
        // must block repeating minute0007 before the later successful send adds cooldown.
        assert_eq!(
            snapshot(&restored).get("precipAlerts"),
            initial.get("precipAlerts")
        );
    }
    let restored_worker = worker(&rig, restored.clone(), provider.clone());
    assert!(!restored_worker.run_minute(now).await.claimed);
    assert_eq!(rig.google.sends().len(), first_posts);
    rig.clock.set("2026-10-16T00:17:00Z");
    let later = restored_worker.run_minute(now + 600_000).await;
    if case.no_post() {
        assert!(later.claimed);
        assert!(
            later
                .deliveries
                .iter()
                .any(|(_, outcome, _)| outcome == "accepted")
        );
        assert_eq!(rig.google.sends().len(), 1);
        let sent = rig.google.sends();
        let payload: serde_json::Value = serde_json::from_str(&sent[0].body).unwrap();
        assert_eq!(
            payload["message"]["token"],
            if matches!(case, Case::Metadata) {
                "synthetic-cli-rotated"
            } else {
                "synthetic-cli-original"
            }
        );
        assert!(
            rig.s3
                .body("index/v2/push/delivery/alert/20261016/0017.json")
                .is_some()
        );
    } else {
        assert!(!later.claimed);
        assert_eq!(rig.google.sends().len(), 1);
    }
    let final_state = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let final_worker = worker(&rig, final_state, provider);
    assert!(!final_worker.run_minute(now).await.claimed);
    assert!(!final_worker.run_minute(now + 600_000).await.claimed);
    assert_eq!(rig.google.sends().len(), 1);
    serde_json::json!({"case":case.id(),"first_outcome":outcome,"first_owned_fcm_posts":first_posts,"total_owned_fcm_posts":rig.google.sends().len(),"owned_oauth_posts":rig.google.tokens().len(),"first_claim_retained":rig.s3.body(claim).is_some(),"later_cycle_claimed":later.claimed,"selected_state_restored_after_no_post":case.no_post(),"first_actual_post_kept_state":!case.no_post(),"reconstruction_added_no_posts_before_later_cycle":true,"original_claim_probed_while_trigger_restored":case.no_post(),"extra_posts_after_final_reconstruction":0,"latest_token_checked":case.no_post(),"owned_peer":rig.google.root})
}
#[tokio::main]
async fn main() {
    let mut rows = Vec::new();
    for case in [Case::Oauth, Case::Metadata, Case::Rejected, Case::Unknown] {
        rows.push(
            tokio::time::timeout(Duration::from_secs(15), run(case))
                .await
                .expect("owned rehearsal case must settle"),
        );
    }
    println!(
        "{}",
        serde_json::json!({"verdict":"PASS","cases":rows,"live_provider_calls":0,"device_sends":0,"production_eligible":false,"limitations":["Real OAuth/FCM HTTP only to owned loopback; synthetic account and tokens, recorded in-process weather, MemS3 journal","Other writer and restored service are in this process, not separate hosts/OS processes or actual AWS","Original no-POST minute is retried while its trigger is still eligible, before any later accepted-send cooldown; the retained claim blocks it","Initial lost acknowledgement/storage ambiguity can retain suppression: explicit uncertainty is not an undo receipt or unconditional retryability guarantee","Only new typed queue admission/answer is bounded; unchanged bool preselection operations do not establish a whole-worker completion bound","Parent runner must await process exit and check every reported loopback listener closed","No live sends/device telemetry, host/production capacity, shadow or eligible previous full bundle qualification"]})
    );
}
