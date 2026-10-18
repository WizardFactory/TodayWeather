//! Public, actual HTTP Reds first; optimization must preserve every accepted outcome.
#[tokio::test]
async fn known_terminal_warning_poll_has_no_endpoint_s3_work() {
    let r = super::warning_fanout_common::run(12).await;
    for key in ["s12.requests", "ledger.requests", "journal.requests"] {
        assert_eq!(
            r["repeated_transport"][key].as_u64().unwrap_or(0),
            0,
            "known-terminal {key}: {r}"
        );
    }
}
#[tokio::test]
async fn warning_fanout_first_pass_s12_work_is_bounded() {
    let r = super::warning_fanout_common::run(12).await;
    let per = r["single_zone_acquisition"]["s12.requests"]
        .as_u64()
        .expect("measured S12 sample");
    let untouched_bound = 3 * 12 * per;
    let limit = untouched_bound * 70 / 100;
    assert!(
        r["first_transport"]["s12.requests"].as_u64().unwrap() <= limit,
        "predeclared70%physicalS12bound {limit}: {r}"
    );
}

use super::{
    common::{Answer, DEFAULT_TOKEN, fcm, rig, temp_dir},
    state_common::{fast_config, ms, start},
    warnings::{FixedLocations, publish, publish_s12, registration, rows, setup, worker},
};
use server2::{
    gateway::BoxFuture,
    push::{
        Coll,
        deliver::{
            warning_feed::WarningFeed,
            warnings::{CurrentZones, Locations, WarningWorker},
        },
    },
    storage::Error,
    warnings::zones::{ZoneState, prepare_events},
    world::js::Obj,
};
use std::sync::Arc;

struct LateAdmissionZones {
    inner: Arc<server2::warnings::WarningStore<server2::storage::HttpS3Transport>>,
    google: Arc<super::common::GoogleState>,
    held: std::sync::atomic::AtomicBool,
    old_started: tokio::sync::Notify,
    release_old: tokio::sync::Notify,
    late_finished: tokio::sync::Notify,
    late_active: std::sync::atomic::AtomicBool,
}
impl CurrentZones for LateAdmissionZones {
    fn current(&self, now: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            let state = self.inner.current(now).await?;
            let prepared = self
                .google
                .requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.path.ends_with("/o/oauth2/token"))
                .count()
                >= 2;
            if prepared && !self.held.swap(true, std::sync::atomic::Ordering::SeqCst) {
                // The other product's FIRST OAuth is held. This second product's
                // final read has completed but its result has not been returned.
                self.old_started.notify_one();
                self.release_old.notified().await;
            } else if prepared && self.held.load(std::sync::atomic::Ordering::SeqCst) {
                self.late_active.store(
                    state.entries().any(|s| s.active),
                    std::sync::atomic::Ordering::SeqCst,
                );
                self.late_finished.notify_one();
            }
            Ok(state)
        })
    }
}
#[tokio::test]
async fn late_oauth_ready_caller_does_not_join_an_older_held_s12_read() {
    let mut a = registration(1);
    a.doc.set("fcmToken", "synthetic-cohort-one");
    let mut b = registration(2);
    b.doc.set("fcmToken", "synthetic-cohort-two");
    b.doc.set("package", "todayAir");
    let rig = rig(
        "warning-late-ready",
        "2026-10-16T01:02:00Z",
        &[(Coll::Alert, a), (Coll::Alert, b)],
        None,
    )
    .await;
    let feed = Arc::new(WarningFeed::new(
        Arc::new(rig.s3.clone()),
        rig.clock.clone(),
    ));
    feed.publish(&[]).await.unwrap();
    let peer = super::warning_common::Peer::new();
    let reader = peer.store();
    let other = peer.store();
    publish_s12(&other, rows(), ms("2026-10-16T01:02:00Z") as u64).await;
    let zones = Arc::new(LateAdmissionZones {
        inner: reader,
        google: rig.google.state.clone(),
        held: std::sync::atomic::AtomicBool::new(false),
        old_started: tokio::sync::Notify::new(),
        release_old: tokio::sync::Notify::new(),
        late_finished: tokio::sync::Notify::new(),
        late_active: std::sync::atomic::AtomicBool::new(true),
    });
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
    );
    w.poll().await.unwrap();
    feed.publish(&rows()).await.unwrap();
    let oauth_started = Arc::new(tokio::sync::Notify::new());
    let oauth_resume = Arc::new(tokio::sync::Notify::new());
    rig.google
        .state
        .token
        .lock()
        .unwrap()
        .push_back(Answer::Held(
            oauth_started.clone(),
            oauth_resume.clone(),
            DEFAULT_TOKEN.into(),
        ));
    let running = tokio::spawn({
        let w = w.clone();
        async move { w.poll().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(3), oauth_started.notified())
        .await
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        zones.old_started.notified(),
    )
    .await
    .unwrap();
    let mut released = rows();
    released[0]["command"] = serde_json::json!("2");
    released[0]["tmSeq"] = serde_json::json!(2);
    publish_s12(&other, released, ms("2026-10-16T01:02:01Z") as u64).await;
    oauth_resume.notify_one();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        zones.late_finished.notified(),
    )
    .await
    .expect("late ready caller must start a fresh read while old result is still held");
    assert!(
        !zones.late_active.load(std::sync::atomic::Ordering::SeqCst),
        "late query must observe externally published release"
    );
    zones.release_old.notify_one();
    let report = running.await.unwrap().unwrap();
    assert_eq!(report.accepted, 1);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "only the already-read first caller may use its old result; existing read-to-POST gap is not global linearizability"
    );
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert_eq!(rig.google.sends().len(), 1);
}
struct FailAfterPrefilter(std::sync::atomic::AtomicUsize);
impl CurrentZones for FailAfterPrefilter {
    fn current(&self, _: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            if self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst) > 0 {
                return Err(Error::Transport);
            }
            let mut state = ZoneState::default();
            state.apply(&prepare_events(&rows()));
            Ok(state)
        })
    }
}
#[tokio::test]
async fn independent_postclaim_source_errors_keep_each_claim_and_make_no_oauth_call() {
    let records = (1..=6)
        .map(|n| {
            let mut r = registration(n);
            r.doc.set("fcmToken", format!("synthetic-error-{n}"));
            (Coll::Alert, r)
        })
        .collect::<Vec<_>>();
    let rig = rig("warning-six-error", "2026-10-16T01:02:00Z", &records, None).await;
    let feed = Arc::new(WarningFeed::new(
        Arc::new(rig.s3.clone()),
        rig.clock.clone(),
    ));
    feed.publish(&[]).await.unwrap();
    let zones = Arc::new(FailAfterPrefilter(std::sync::atomic::AtomicUsize::new(0)));
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
    );
    w.poll().await.unwrap();
    feed.publish(&rows()).await.unwrap();
    let report = w.poll().await.unwrap();
    assert_eq!(report.failed, 6);
    assert_eq!(
        zones.0.load(std::sync::atomic::Ordering::SeqCst),
        7,
        "one advisory and six independent strict error reads"
    );
    assert!(rig.google.tokens().is_empty());
    assert!(rig.google.sends().is_empty());
    let results = rig
        .s3
        .keys("index/v2/push/delivery/warning/")
        .into_iter()
        .filter(|k| k.ends_with(".result.json"))
        .collect::<Vec<_>>();
    assert_eq!(results.len(), 6);
    for key in results {
        let body: serde_json::Value = serde_json::from_slice(&rig.s3.body(&key).unwrap()).unwrap();
        assert_eq!(body["class"], "warning-state");
    }
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert_eq!(zones.0.load(std::sync::atomic::Ordering::SeqCst), 7);
    assert!((1..=6).contains(&w.fanout_stats().peak_live_jobs));
    assert!(w.fanout_stats().peak_live_reads <= 6);
}
struct HeldFinalRead {
    calls: std::sync::atomic::AtomicUsize,
    started: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}
impl CurrentZones for HeldFinalRead {
    fn current(&self, _: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            let call = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if call == 2 {
                self.started.notify_one();
                self.resume.notified().await;
            }
            let mut state = ZoneState::default();
            state.apply(&prepare_events(&rows()));
            Ok(state)
        })
    }
}
#[tokio::test]
async fn quiesce_while_final_read_is_held_prevents_the_post() {
    let rig = rig(
        "warning-stop-read",
        "2026-10-16T01:02:00Z",
        &[(Coll::Alert, registration(1))],
        None,
    )
    .await;
    let feed = Arc::new(WarningFeed::new(
        Arc::new(rig.s3.clone()),
        rig.clock.clone(),
    ));
    feed.publish(&[]).await.unwrap();
    let zones = Arc::new(HeldFinalRead {
        calls: std::sync::atomic::AtomicUsize::new(0),
        started: tokio::sync::Notify::new(),
        resume: tokio::sync::Notify::new(),
    });
    let sender = Arc::new(fcm(&rig.google, &temp_dir("warning-stop-cohort")));
    let w = Arc::new(WarningWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
        sender.clone(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    ));
    w.poll().await.unwrap();
    feed.publish(&rows()).await.unwrap();
    let running = tokio::spawn({
        let w = w.clone();
        async move { w.poll().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), zones.started.notified())
        .await
        .unwrap();
    sender.quiesce();
    zones.resume.notify_one();
    assert_eq!(running.await.unwrap().unwrap().accepted, 0);
    assert!(rig.google.sends().is_empty());
    assert_eq!(
        rig.diagnostics.events.lock().unwrap().last().unwrap().class,
        "shutdown-before-post"
    );
    assert_eq!(w.poll().await.unwrap().attempted, 0);
}

#[tokio::test]
async fn seed_absent_strict_warning_read_records_a_bounded_actual_transport_scan() {
    let peer = super::warning_common::Peer::new();
    let store = peer.store();
    publish_s12(&store, rows(), ms("2026-10-16T01:02:00Z") as u64).await;
    let before = peer.counts().await;
    let state = store.current(ms("2026-10-16T01:02:00Z")).await.unwrap();
    assert!(
        state
            .entries()
            .any(|s| s.area_code == "L1010100" && s.active)
    );
    let after = peer.counts().await;
    let sum = |prefix: &str| {
        after
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(prefix))
            .map(|(k, v)| {
                v.as_u64().unwrap()
                    - before
                        .get(k)
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0)
            })
            .sum::<u64>()
    };
    let requests = sum("OP ");
    let consumed = sum("BODYIN ");
    let written = sum("BODYOUT ");
    assert!(
        requests > 60 && requests <= 512,
        "predeclared512HTTPsingle-readbound, actual {requests}"
    );
    assert!(written > 0);
    println!(
        "seed-absent strict4s source: {requests} actualHTTP, {consumed} consumed request-body bytes, {written} written response-body bytes; small synthetic fixture only"
    );
}

struct BothLocations;
impl Locations for BothLocations {
    fn zones<'a>(&'a self, _: &'a Obj, _: i64) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        Box::pin(async { Ok(vec!["L1010100".into(), "L1010200".into()]) })
    }
}
#[tokio::test]
async fn reconstructed_worker_observes_durable_taken_after_its_silent_baseline() {
    let (rig, feed, zones, _) = setup("warning-reconstruct-taken").await;
    let first = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(BothLocations),
    );
    first.poll().await.unwrap();
    publish(&feed, &zones, rows()).await;
    assert_eq!(first.poll().await.unwrap().accepted, 1);
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let replacement = worker(
        &rig,
        restored,
        feed.clone(),
        zones.clone(),
        Arc::new(BothLocations),
    );
    replacement.poll().await.unwrap();
    assert_eq!(replacement.fanout_stats().memo_entries, 0);
    // A new area is a new feed event but the SAME campaign/endpoint claim. This
    // makes it selected after startup, so silence cannot masquerade as Taken.
    let mut new = rows();
    new[0]["areaCode"] = serde_json::json!("L1010200");
    let mut all = rows();
    all.extend(new.clone());
    *zones.0.lock().unwrap() = all;
    feed.publish(&new).await.unwrap();
    let before = rig.s3.put_count("index/v2/push/delivery/warning/");
    let report = replacement.poll().await.unwrap();
    assert_eq!(report.selected, 1);
    assert_eq!(report.attempted, 0);
    assert_eq!(
        rig.s3.put_count("index/v2/push/delivery/warning/"),
        before + 1
    );
    assert_eq!(replacement.fanout_stats().memo_entries, 1);
    assert_eq!(rig.google.sends().len(), 1);
    assert_eq!(replacement.poll().await.unwrap().attempted, 0);
    assert_eq!(
        rig.s3.put_count("index/v2/push/delivery/warning/"),
        before + 1
    );
    assert_eq!(replacement.fanout_stats().known_terminal_skips, 1);
}

struct RecoveringAdvisory {
    ready: std::sync::atomic::AtomicBool,
    error: bool,
}
impl CurrentZones for RecoveringAdvisory {
    fn current(&self, _: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            if !self.ready.load(std::sync::atomic::Ordering::SeqCst) {
                return if self.error {
                    Err(Error::Transport)
                } else {
                    Ok(ZoneState::default())
                };
            }
            let mut state = ZoneState::default();
            state.apply(&prepare_events(&rows()));
            Ok(state)
        })
    }
}
#[tokio::test]
async fn advisory_error_or_inactive_view_leaves_work_unclaimed_for_the_next_poll() {
    for error in [false, true] {
        let (rig, feed, _, _) = setup(&format!("warning-advisory-recovery-{error}")).await;
        let zones = Arc::new(RecoveringAdvisory {
            ready: std::sync::atomic::AtomicBool::new(false),
            error,
        });
        let w = worker(
            &rig,
            rig.push.clone(),
            feed.clone(),
            zones.clone(),
            Arc::new(FixedLocations),
        );
        w.poll().await.unwrap();
        feed.publish(&rows()).await.unwrap();
        let first = w.poll().await.unwrap();
        assert_eq!(first.selected, 1);
        assert_eq!(first.attempted, 0);
        assert_eq!(first.failed, usize::from(error));
        assert_eq!(w.fanout_stats().memo_entries, 0);
        assert!(rig.s3.keys("index/v2/push/delivery/warning/").is_empty());
        assert!(rig.google.tokens().is_empty());
        zones.ready.store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            w.poll().await.unwrap().accepted,
            1,
            "poll-local negative/error view cannot suppress a later healthy poll"
        );
        assert_eq!(rig.google.sends().len(), 1);
    }
}
