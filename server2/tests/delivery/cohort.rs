//! Definite pre-POST refusal must not consume the conditional alert's transition.
use super::{
    common::*,
    state_common::{MemS3, fast_config, start},
};
use server2::{
    gateway::OrderedJson,
    push::{Coll, Record, deliver::alerts::AlertWorker},
    world::js::{Obj, Val},
};
use std::{io::Read, sync::Arc};

fn stored(rig: &Rig) -> Obj {
    rig.push
        .state()
        .read()
        .unwrap()
        .coll(Coll::Alert)
        .get(0)
        .unwrap()
        .doc
        .clone()
}
async fn setup(
    name: &str,
    case_id: &str,
    answer: Option<Answer>,
) -> (
    Rig,
    Arc<AlertWorker<MemS3>>,
    Arc<server2::push::deliver::fcm::Fcm>,
    Obj,
    i64,
) {
    let mut text = String::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/alerts-oracle.json.gz")[..])
        .read_to_string(&mut text)
        .unwrap();
    let oracle = OrderedJson::parse(text.as_bytes()).unwrap();
    let case = items(oracle.get("cases").unwrap())
        .iter()
        .find(|c| c.get("id").unwrap().string().as_deref() == Some(case_id))
        .unwrap();
    let Val::Obj(doc) = Val::from_ordered(case.get("record").unwrap()) else {
        panic!("record")
    };
    let record = Record {
        oid: [0x74; 12],
        doc,
    };
    let at = "2026-10-16T00:07:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let rig = rig(name, at, &[(Coll::Alert, record)], None).await;
    let body = case.get("body").unwrap().to_bytes();
    rig.weather.set(
        &OrderedJson::parse(
            format!(
                r#"{{"kma":{{"status":200,"body":{}}}}}"#,
                String::from_utf8(body).unwrap()
            )
            .as_bytes(),
        )
        .unwrap(),
    );
    if let Some(answer) = answer {
        rig.google.state.token.lock().unwrap().push_back(answer);
    }
    let client = Arc::new(fcm(
        &rig.google,
        &temp_dir(&format!(
            "cohort-fcm-{}",
            rig.google.root.replace([':', '/'], "_")
        )),
    ));
    let worker = Arc::new(AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        client.clone(),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    ));
    let before = stored(&rig);
    (rig, worker, client, before, now)
}
async fn refused() -> (Rig, Arc<AlertWorker<MemS3>>, Obj, i64) {
    let (rig, worker, _client, before, now) = setup(
        "cohort-oauth-refusal",
        "current-ko-1",
        Some(Answer::Json(
            503,
            r#"{"error":"temporarily_unavailable"}"#.into(),
        )),
    )
    .await;
    let report = worker.run_minute(now).await;
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), 1);
    assert_eq!(report.deliveries[0].1, "failed");
    assert_eq!(report.deliveries[0].2, "fcm-oauth");
    assert_eq!(rig.google.tokens().len(), 1);
    assert!(
        rig.google.sends().is_empty(),
        "no FCM POST after OAuth refusal"
    );
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some(),
        "retain first minute claim"
    );
    (rig, worker, before, now)
}

#[tokio::test]
async fn definite_oauth_refusal_restores_owned_sent_state_without_releasing_claim() {
    let (rig, _worker, before, _now) = refused().await;
    let after = stored(&rig);
    assert_eq!(
        after.get("precipAlerts"),
        before.get("precipAlerts"),
        "a definite no-POST must not consume the unsent transition or save pushTime"
    );
    assert_eq!(
        after.get("airAlerts"),
        before.get("airAlerts"),
        "preserve other category observations"
    );
}

#[tokio::test]
async fn fresh_scheduled_evaluation_after_oauth_refusal_can_send_once() {
    let (rig, worker, _before, now) = refused().await;
    rig.clock.set("2026-10-16T00:17:00.000Z");
    let next = now + 10 * 60_000;
    let report = worker.run_minute(next).await;
    assert!(report.claimed);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "a later fresh evaluation must not be suppressed by the earlier unsent attempt"
    );
    assert!(
        report
            .deliveries
            .iter()
            .any(|(_, outcome, _)| outcome == "accepted")
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let restored_worker = AlertWorker::new(
        restored,
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm(
            &rig.google,
            &temp_dir(&format!(
                "cohort-restored-{}",
                rig.google.root.replace([':', '/'], "_")
            )),
        )),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert!(!restored_worker.run_minute(now).await.claimed);
    assert!(!restored_worker.run_minute(next).await.claimed);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "never replay either claimed minute"
    );
}

async fn local_fields(rig: &Rig, after: &Obj) {
    assert!(
        rig.push
            .internal(server2::push::service::InternalOp::UpdateAlertState {
                n: 0,
                oid: [0x74; 12],
                selected: stored(rig),
                precip: after.get("precipAlerts").clone(),
                air: after.get("airAlerts").clone(),
            })
            .await
    );
}
async fn remote_record(rig: &Rig, doc: Obj) {
    use server2::push::{Counters, Durable, durable::Commit, store::Change};
    let mut durable = Durable::new(
        Arc::new(rig.s3.clone()),
        fast_config().durable,
        Arc::new(Counters::default()),
    );
    let state = durable.restore().await.unwrap();
    let record = Record {
        oid: [0x74; 12],
        doc,
    };
    let change = Change {
        coll: Coll::Alert,
        n: 0,
        oid: record.oid,
        record: Some(record),
        imported: None,
    };
    assert!(matches!(
        durable.commit(state.seq + 1, &[change], state.next_n).await,
        Commit::Committed
    ));
}
fn replace_precip(doc: &mut Obj, last_state: f64, time: Option<Val>) {
    let mut p = Obj::new();
    p.set("lastState", Val::Num(last_state));
    if let Some(v) = time {
        p.set("pushTime", v);
    }
    doc.set("precipAlerts", Val::Obj(p));
}
async fn ownership_case(mode: &str) {
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (rig, worker, _client, before, now) = setup(
        &format!("cohort-{mode}"),
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            DEFAULT_TOKEN.into(),
        )),
    )
    .await;
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let candidate = stored(&rig);
    assert_eq!(
        candidate.get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64)
    );
    match mode {
        "remote-metadata" => {
            let mut edited = candidate.clone();
            edited.set("name", Val::Str("renamed".into()));
            edited.set("fcmToken", Val::Str("rotated".into()));
            remote_record(&rig, edited).await;
        }
        "http-metadata" => {
            let mut edited = candidate.clone();
            edited.set("category", Val::Str("alert".into()));
            edited.set("name", Val::Str("renamed".into()));
            let mut location = Obj::new();
            location.set("lat", Val::Num(37.));
            location.set("long", Val::Num(127.));
            edited.set("location", Val::Obj(location));
            let bytes = Val::Arr(vec![Val::Obj(edited)]).to_json();
            let request = axum::extract::Request::builder()
                .method("POST")
                .uri("/v000902/push-list")
                .header("content-type", "application/json")
                .header("content-length", bytes.len().to_string())
                .body(axum::body::Body::from(bytes))
                .unwrap();
            assert_eq!(rig.push.handle(request).await.unwrap().status(), 200);
        }
        "remote-partial" => {
            let mut edited = candidate.clone();
            replace_precip(&mut edited, 9., Some(Val::Date(now as f64)));
            remote_record(&rig, edited).await;
        }
        "local-aba" | "remote-aba" => {
            let mut edited = candidate.clone();
            replace_precip(&mut edited, 9., Some(Val::Date((now + 1) as f64)));
            if mode == "local-aba" {
                local_fields(&rig, &edited).await;
                local_fields(&rig, &candidate).await;
            } else {
                remote_record(&rig, edited).await;
                remote_record(&rig, candidate.clone()).await;
            }
        }
        "other-category" => {
            let mut edited = candidate.clone();
            let mut air = Obj::new();
            air.set("lastGrade", Val::Num(4.));
            air.set("pushTime", Val::Date(77.));
            edited.set("airAlerts", Val::Obj(air));
            local_fields(&rig, &edited).await;
        }
        _ => panic!("unknown case"),
    }
    release.notify_one();
    let report = task.await.unwrap();
    assert!(report.claimed);
    assert!(
        rig.google.sends().is_empty(),
        "no stale selected attempt may POST"
    );
    assert_eq!(report.deliveries[0].2, "alert-admission");
    let after = stored(&rig);
    match mode {
        "local-aba" | "remote-aba" => assert_eq!(
            after.get("precipAlerts"),
            candidate.get("precipAlerts"),
            "preserve later actual transition after A-B-A"
        ),
        "remote-partial" => {
            assert_eq!(after.get("precipAlerts").get("lastState"), &Val::Num(9.));
            assert!(matches!(
                after.get("precipAlerts").get("pushTime"),
                Val::Undef
            ));
        }
        _ => assert_eq!(after.get("precipAlerts"), before.get("precipAlerts")),
    }
    if mode.contains("metadata") {
        assert_eq!(after.get("name"), &Val::Str("renamed".into()));
    }
    if mode == "remote-metadata" {
        assert_eq!(after.get("fcmToken"), &Val::Str("rotated".into()));
    }
    if mode == "other-category" {
        assert_eq!(after.get("airAlerts").get("lastGrade"), &Val::Num(4.));
        assert_eq!(after.get("airAlerts").get("pushTime"), &Val::Date(77.));
    }
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
}
#[tokio::test]
async fn compensation_preserves_a_caught_up_token_and_name_edit() {
    ownership_case("remote-metadata").await;
}
#[tokio::test]
async fn compensation_preserves_a_local_http_registration_edit() {
    ownership_case("http-metadata").await;
}
#[tokio::test]
async fn a_caught_up_newer_leaf_keeps_only_its_own_state() {
    ownership_case("remote-partial").await;
}
#[tokio::test]
async fn local_writer_aba_refuses_post_and_does_not_rewind_newer_state() {
    ownership_case("local-aba").await;
}
#[tokio::test]
async fn intermediate_caught_up_aba_refuses_post_and_does_not_rewind_newer_state() {
    ownership_case("remote-aba").await;
}
#[tokio::test]
async fn compensation_preserves_a_non_sending_category_update() {
    ownership_case("other-category").await;
}

#[tokio::test]
async fn observation_only_cycles_keep_their_derived_updates_without_fcm_work() {
    for case in ["air-forecast-discarded-7", "rns-false"] {
        let (rig, worker, _client, _before, now) =
            setup(&format!("cohort-observation-{case}"), case, None).await;
        let report = worker.run_minute(now).await;
        assert!(report.claimed);
        assert_eq!(report.deliveries[0].1, "not-needed");
        let doc = stored(&rig);
        if case == "rns-false" {
            assert_eq!(doc.get("precipAlerts").get("lastState"), &Val::Num(1.));
        } else {
            assert_eq!(
                doc.get("airAlerts").get("lastCode"),
                &Val::Str("pm10".into())
            );
        }
        assert!(rig.google.tokens().is_empty());
        assert!(rig.google.sends().is_empty());
    }
}
#[tokio::test]
async fn actual_rejected_and_unknown_posts_keep_sent_state_and_are_never_retried() {
    for (label, answer, outcome) in [
        (
            "rejected",
            Answer::Json(
                503,
                r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
            ),
            "rejected",
        ),
        ("unknown", Answer::Reset, "unknown"),
    ] {
        let (rig, worker, _client, _before, now) =
            setup(&format!("cohort-actual-{label}"), "current-ko-1", None).await;
        rig.google.state.fcm.lock().unwrap().push_back(answer);
        let report = worker.run_minute(now).await;
        assert_eq!(report.deliveries[0].1, outcome);
        assert_eq!(rig.google.sends().len(), 1);
        let after = stored(&rig);
        assert_eq!(after.get("precipAlerts").get("lastState"), &Val::Num(1.));
        assert_eq!(
            after.get("precipAlerts").get("pushTime"),
            &Val::Date(now as f64)
        );
        rig.clock.set("2026-10-16T00:17:00Z");
        assert!(!worker.run_minute(now + 600_000).await.claimed);
        assert_eq!(rig.google.sends().len(), 1);
    }
}
#[tokio::test]
async fn shutdown_after_oauth_restores_owned_state_without_post_or_replay() {
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (rig, worker, client, before, now) = setup(
        "cohort-shutdown",
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            DEFAULT_TOKEN.into(),
        )),
    )
    .await;
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    client.quiesce();
    release.notify_one();
    let report = task.await.unwrap();
    assert_eq!(report.deliveries[0].2, "shutdown-before-post");
    assert!(rig.google.sends().is_empty());
    assert_eq!(stored(&rig).get("precipAlerts"), before.get("precipAlerts"));
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
}
#[tokio::test]
async fn missing_fcm_credentials_do_not_leave_a_selected_sent_transition() {
    let (rig, _worker, _client, before, now) =
        setup("cohort-credentials", "current-ko-1", None).await;
    let provider = server2::push::deliver::fcm::Fcm::from_vars(
        &|_| None,
        server2::push::deliver::fcm::Endpoints::loopback(&rig.google.root),
    )
    .unwrap();
    let worker = AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(provider),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(now).await;
    assert_eq!(report.deliveries[0].2, "fcm-credentials");
    assert!(rig.google.tokens().is_empty());
    assert!(rig.google.sends().is_empty());
    assert_eq!(stored(&rig).get("precipAlerts"), before.get("precipAlerts"));
}

const JOURNAL: &str = "index/v2/push/state/journal/";
fn next_key(rig: &Rig) -> String {
    server2::push::durable::journal_key(rig.push.state().read().unwrap().seq + 1)
}
#[tokio::test]
async fn unknown_initial_state_write_never_authorizes_post_or_fabricates_a_receipt() {
    use super::state_common::Fault;
    let (rig, worker, _client, before, now) =
        setup("cohort-initial-unknown", "current-ko-1", None).await;
    rig.s3
        .fault_put(&next_key(&rig), Fault::CommitLostUnreadable);
    let report = worker.run_minute(now).await;
    assert_eq!(report.deliveries[0].2, "state-commit-uncertain");
    assert!(rig.google.tokens().is_empty());
    assert!(rig.google.sends().is_empty());
    // The next ordinary guard settles the stored but unacknowledged journal entry.
    assert!(
        !rig.push
            .internal(server2::push::service::InternalOp::CheckAlertSelection {
                n: 0,
                oid: [0x74; 12],
                selected: before
            })
            .await
    );
    assert_eq!(
        stored(&rig).get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64)
    );
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
    assert!(
        rig.google.sends().is_empty(),
        "uncertain commit is not a send or undo receipt"
    );
}

async fn failed_restore_case(unknown: bool) {
    use super::state_common::Fault;
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (rig, worker, _client, before, now) = setup(
        if unknown {
            "cohort-undo-unknown"
        } else {
            "cohort-undo-refused"
        },
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            r#"{"error":"temporary"}"#.into(),
        )),
    )
    .await;
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let key = next_key(&rig);
    let puts = rig.s3.put_count(JOURNAL);
    rig.s3.fault_put(
        &key,
        if unknown {
            Fault::CommitLostUnreadable
        } else {
            Fault::Reject(403)
        },
    );
    release.notify_one();
    let report = task.await.unwrap();
    assert_eq!(report.deliveries[0].2, "unsent-state-unresolved");
    assert_eq!(
        rig.s3.put_count(JOURNAL) - puts,
        1,
        "one bounded restore operation, no background retry"
    );
    assert!(rig.google.sends().is_empty());
    assert_eq!(
        stored(&rig).get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64),
        "do not pretend unacknowledged repair was applied in memory"
    );
    if unknown {
        assert!(
            rig.push
                .internal(server2::push::service::InternalOp::CheckAlertSelection {
                    n: 0,
                    oid: [0x74; 12],
                    selected: before.clone()
                })
                .await
        );
        assert_eq!(
            stored(&rig).get("precipAlerts"),
            before.get("precipAlerts"),
            "later ordinary settlement can observe an already-stored repair"
        );
    }
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
    assert!(rig.google.sends().is_empty());
}
#[tokio::test]
async fn refused_compensation_reports_unresolved_without_a_send_or_repair_retry() {
    failed_restore_case(false).await;
}
#[tokio::test]
async fn unacknowledged_compensation_is_not_a_success_and_settles_without_a_send() {
    failed_restore_case(true).await;
}

#[tokio::test]
async fn intermediate_aba_in_pending_write_settlement_revokes_the_live_receipt() {
    use super::state_common::Fault;
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (rig, worker, _client, _before, now) = setup(
        "cohort-settle-aba",
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            DEFAULT_TOKEN.into(),
        )),
    )
    .await;
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let candidate = stored(&rig);
    let mut newer = candidate.clone();
    replace_precip(&mut newer, 9., Some(Val::Date((now + 1) as f64)));
    rig.s3
        .fault_put(&next_key(&rig), Fault::CommitLostUnreadable);
    assert!(
        !rig.push
            .internal(server2::push::service::InternalOp::UpdateAlertState {
                n: 0,
                oid: [0x74; 12],
                selected: candidate.clone(),
                precip: newer.get("precipAlerts").clone(),
                air: newer.get("airAlerts").clone()
            })
            .await
    );
    assert_eq!(
        stored(&rig),
        candidate,
        "unknown local write is pending, not applied yet"
    );
    remote_record(&rig, candidate.clone()).await;
    release.notify_one();
    let report = task.await.unwrap();
    assert_eq!(report.deliveries[0].2, "alert-admission");
    assert!(rig.google.sends().is_empty());
    assert_eq!(
        stored(&rig),
        candidate,
        "settlement observes B then A without reclaiming the old lease"
    );
    assert!(
        rig.push
            .counters
            .reconciled_committed
            .load(std::sync::atomic::Ordering::SeqCst)
            >= 1
    );
}

// Test-only conditional-write interleavings; no runtime switch or alternate production mode.
enum PutScript {
    Inject(Vec<(String, Vec<u8>)>),
    Hold(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>),
}
struct ScriptedState {
    store: MemS3,
    script: std::sync::Mutex<Option<(String, PutScript)>>,
    conflicts: std::sync::atomic::AtomicUsize,
}
impl ScriptedState {
    fn new(store: MemS3) -> Arc<Self> {
        Arc::new(Self {
            store,
            script: std::sync::Mutex::new(None),
            conflicts: std::sync::atomic::AtomicUsize::new(0),
        })
    }
    fn arm(&self, key: String, script: PutScript) {
        let mut p = self.script.lock().unwrap();
        assert!(p.is_none());
        *p = Some((key, script));
    }
}
impl server2::storage::ObjectTransport for ScriptedState {
    async fn put(
        &self,
        value: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        server2::storage::ObjectTransport::put(&self.store, value).await
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::head(&self.store, key).await
    }
    async fn get(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::get(&self.store, key, maximum).await
    }
}
impl server2::storage::CatalogTransport for ScriptedState {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        server2::storage::CatalogTransport::get_control(&self.store, key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &server2::storage::WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        let script = {
            let mut script = self.script.lock().unwrap();
            if script.as_ref().is_some_and(|(k, _)| k == key) {
                script.take().map(|(_, s)| s)
            } else {
                None
            }
        };
        match script {
            Some(PutScript::Inject(objects)) => {
                for (k, bytes) in objects {
                    self.store.insert(&k, &bytes);
                }
                let status = server2::storage::CatalogTransport::put_control(
                    &self.store,
                    key,
                    body,
                    condition,
                )
                .await?;
                assert_eq!(
                    status, 412,
                    "the staged foreign write wins the real conditional key"
                );
                self.conflicts
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(status)
            }
            Some(PutScript::Hold(started, release)) => {
                let result = server2::storage::CatalogTransport::put_control(
                    &self.store,
                    key,
                    body,
                    condition,
                )
                .await;
                started.notify_one();
                release.notified().await;
                result
            }
            None => {
                server2::storage::CatalogTransport::put_control(&self.store, key, body, condition)
                    .await
            }
        }
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        continuation: Option<&str>,
        keys: usize,
        bytes: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        server2::storage::CatalogTransport::list_raw_document(
            &self.store,
            prefix,
            continuation,
            keys,
            bytes,
        )
        .await
    }
}
async fn scripted_worker(
    rig: &mut Rig,
    store: Arc<ScriptedState>,
    provider: Arc<server2::push::deliver::fcm::Fcm>,
    config: server2::push::PushConfig,
) -> Arc<AlertWorker<ScriptedState>> {
    rig.push = server2::push::PushService::start(
        store.clone(),
        rig.clock.clone(),
        Box::new(server2::push::ObjectIds::new()),
        config,
    );
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !rig.push.ready() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    Arc::new(AlertWorker::new(
        rig.push.clone(),
        store,
        rig.weather.clone(),
        provider,
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    ))
}
async fn append_document(store: &MemS3, doc: Obj) {
    use server2::push::{Counters, Durable, durable::Commit, store::Change};
    let mut durable = Durable::new(
        Arc::new(store.clone()),
        fast_config().durable,
        Arc::new(Counters::default()),
    );
    let state = durable.restore().await.unwrap();
    let record = Record {
        oid: [0x74; 12],
        doc,
    };
    let change = Change {
        coll: Coll::Alert,
        n: 0,
        oid: record.oid,
        record: Some(record),
        imported: None,
    };
    assert!(matches!(
        durable.commit(state.seq + 1, &[change], state.next_n).await,
        Commit::Committed
    ));
}
#[tokio::test]
async fn a_real_conditional_conflict_catches_up_both_aba_entries_before_replanning() {
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (mut rig, _old_worker, provider, _before, now) = setup(
        "cohort-conflict-aba",
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            DEFAULT_TOKEN.into(),
        )),
    )
    .await;
    let store = ScriptedState::new(rig.s3.clone());
    let worker = scripted_worker(&mut rig, store.clone(), provider, fast_config()).await;
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let candidate = stored(&rig);
    let scratch = MemS3::new();
    for key in rig.s3.keys("") {
        scratch.insert(&key, &rig.s3.body(&key).unwrap());
    }
    let mut newer = candidate.clone();
    replace_precip(&mut newer, 9., Some(Val::Date((now + 1) as f64)));
    append_document(&scratch, newer).await;
    append_document(&scratch, candidate.clone()).await;
    let objects = scratch
        .keys("")
        .into_iter()
        .filter_map(|key| {
            let bytes = scratch.body(&key).unwrap();
            (rig.s3.body(&key).as_ref() != Some(&bytes)).then_some((key, bytes))
        })
        .collect::<Vec<_>>();
    assert!(objects.len() >= 2);
    store.arm(next_key(&rig), PutScript::Inject(objects));
    let mut observation = candidate.clone();
    let mut air = Obj::new();
    air.set("lastGrade", Val::Num(2.));
    observation.set("airAlerts", Val::Obj(air));
    local_fields(&rig, &observation).await;
    local_fields(&rig, &candidate).await;
    assert_eq!(store.conflicts.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        stored(&rig),
        candidate,
        "final body equality alone cannot establish ownership"
    );
    release.notify_one();
    let report = task.await.unwrap();
    assert_eq!(report.deliveries[0].2, "alert-admission");
    assert!(rig.google.sends().is_empty());
    assert_eq!(stored(&rig), candidate);
}

async fn lost_ack_case() {
    let (mut rig, _old_worker, provider, before, now) =
        setup("cohort-ack-lost", "current-ko-1", None).await;
    let store = ScriptedState::new(rig.s3.clone());
    let mut config = fast_config();
    config.wait = std::time::Duration::from_millis(50);
    config.queue = 1;
    config.durable.op_deadline = std::time::Duration::from_secs(2);
    let worker = scripted_worker(&mut rig, store.clone(), provider, config).await;
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    store.arm(
        next_key(&rig),
        PutScript::Hold(started.clone(), release.clone()),
    );
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    let report = tokio::time::timeout(std::time::Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(report.deliveries[0].2, "state-commit-uncertain");
    assert_eq!(stored(&rig), before);
    assert!(rig.google.tokens().is_empty());
    assert!(rig.google.sends().is_empty());
    release.notify_one();
    assert!(
        !rig.push
            .internal(server2::push::service::InternalOp::CheckAlertSelection {
                n: 0,
                oid: [0x74; 12],
                selected: before
            })
            .await
    );
    assert_eq!(
        stored(&rig).get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64)
    );
    assert!(
        rig.google.sends().is_empty(),
        "lost initial acknowledgement never authorizes an external POST or invented undo receipt"
    );
}
#[tokio::test]
async fn a_lost_initial_acknowledgement_is_explicit_uncertainty_not_a_false_receipt() {
    lost_ack_case().await;
}

/// The worker and writer use the same failing clock, as they do in production.
#[tokio::test]
async fn shared_clock_failure_after_oauth_restores_known_owned_state_without_post() {
    use server2::budget::{BudgetError, Clock};
    use std::sync::atomic::{AtomicBool, Ordering};
    struct FailingClock {
        now: i64,
        failed: AtomicBool,
    }
    impl Clock for FailingClock {
        fn now_ms(&self) -> Result<i64, BudgetError> {
            if self.failed.load(Ordering::SeqCst) {
                Err(BudgetError::Clock)
            } else {
                Ok(self.now)
            }
        }
    }
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (mut rig, _worker, client, before, now) = setup(
        "cohort-shared-clock",
        "current-ko-1",
        Some(Answer::Held(
            started.clone(),
            release.clone(),
            DEFAULT_TOKEN.into(),
        )),
    )
    .await;
    assert!(
        rig.push
            .drain(tokio::time::Instant::now() + std::time::Duration::from_secs(2))
            .await
    );
    let clock = Arc::new(FailingClock {
        now,
        failed: AtomicBool::new(false),
    });
    rig.push = server2::push::PushService::start(
        Arc::new(rig.s3.clone()),
        clock.clone(),
        Box::new(super::state_common::OracleIds(0)),
        fast_config(),
    );
    for _ in 0..200 {
        if rig.push.ready() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(rig.push.ready());
    let worker = AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        client,
        servers(),
        clock.clone(),
        rig.diagnostics.clone(),
    );
    let task = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    assert_eq!(
        stored(&rig).get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64)
    );
    clock.failed.store(true, Ordering::SeqCst);
    release.notify_one();
    let report = tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap();
    assert!(report.claimed);
    assert!(
        rig.google.sends().is_empty(),
        "clock failure must refuse the actual POST"
    );
    assert_eq!(rig.google.tokens().len(), 1);
    assert_eq!(
        stored(&rig).get("precipAlerts"),
        before.get("precipAlerts"),
        "known owned no-POST state must be restored even when the shared clock fails"
    );
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
    assert!(
        rig.push
            .drain(tokio::time::Instant::now() + std::time::Duration::from_secs(2))
            .await
    );
}
