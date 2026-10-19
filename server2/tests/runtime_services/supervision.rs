#[path = "../delivery/common.rs"]
mod delivery_common;
#[path = "../state/common.rs"]
mod state_common;
use delivery_common::*;
use server2::{
    gateway::OrderedJson,
    push::{Coll, service::InternalOp},
};
use std::sync::Arc;

#[tokio::test]
async fn alarm_rechecks_subscription_after_oauth_before_post() {
    for material_edit in [false, true] {
        let at = "2026-10-15T22:00:00.000Z";
        let now = 1_792_101_600_000;
        let doc = OrderedJson::parse(br#"{"type":"ios","fcmToken":"synthetic-final-guard","cityIndex":1,"id":1,"geo":[126.97,37.56],"source":"KMA","lang":"ko","package":"todayWeather","pushTime":79200,"updatedAt":"2026-10-10T00:00:00.000Z"}"#).unwrap();
        let rig = rig(
            if material_edit {
                "s20b-material-guard"
            } else {
                "s20b-final-guard"
            },
            at,
            &[(Coll::Alarm, alarm_record(1, &doc))],
            None,
        )
        .await;
        let oracle = oracle_ordered();
        rig.weather.set(
            items(oracle.get("cases").unwrap())[0]
                .get("weather")
                .unwrap(),
        );
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        rig.google
            .state
            .token
            .lock()
            .unwrap()
            .push_back(Answer::Held(
                started.clone(),
                release.clone(),
                r#"{"access_token":"synthetic","expires_in":3600}"#.into(),
            ));
        let worker = rig.worker;
        let job = tokio::spawn(async move { worker.run_minute(now).await });
        tokio::time::timeout(std::time::Duration::from_secs(3), started.notified())
            .await
            .unwrap();
        if material_edit {
            let body = serde_json::json!({"type":"ios","fcmToken":"synthetic-final-guard","cityIndex":1,"id":1,"location":{"lat":37.56,"long":126.97},"source":"KMA","name":"edited-during-oauth","pushTime":79200}).to_string();
            let request = axum::extract::Request::builder()
                .method("POST")
                .uri("/v000705/push")
                .header("content-type", "application/json")
                .header("content-length", body.len())
                .body(axum::body::Body::from(body))
                .unwrap();
            assert_eq!(rig.push.handle(request).await.unwrap().status(), 200);
        } else {
            assert!(
                rig.push
                    .internal(InternalOp::DisableAlarmsByFcm {
                        token: "synthetic-final-guard".into(),
                        spare: vec![]
                    })
                    .await
            );
        }
        release.notify_one();
        let report = job.await.unwrap();
        assert!(report.claimed);
        assert_eq!(
            rig.google.sends().len(),
            0,
            "subscription disabled during OAuth must prevent final POST"
        );
    }
}

#[tokio::test]
async fn stop_after_oauth_and_after_async_guard_is_not_sent_but_inflight_reset_is_unknown() {
    use server2::push::deliver::{Product, SendOutcome};
    let google = GoogleDouble::start().await;
    let fcm = Arc::new(fcm(&google, &temp_dir("s20b-stop-oauth")));
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    google.state.token.lock().unwrap().push_back(Answer::Held(
        started.clone(),
        release.clone(),
        r#"{"access_token":"synthetic","expires_in":3600}"#.into(),
    ));
    let sender = fcm.clone();
    let job = tokio::spawn(async move {
        sender
            .send(Product::TodayWeather, b"{}".to_vec(), 1_792_101_600_000)
            .await
    });
    started.notified().await;
    fcm.quiesce();
    release.notify_one();
    assert_eq!(
        job.await.unwrap(),
        SendOutcome::NotSent { reason: "shutdown" }
    );
    assert!(google.sends().is_empty());

    let fcm = Arc::new(delivery_common::fcm(&google, &temp_dir("s20b-stop-guard")));
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let sender = fcm.clone();
    let signal = started.clone();
    let resume = release.clone();
    let job = tokio::spawn(async move {
        sender
            .send_guarded(Product::TodayWeather, 1_792_101_600_000, || async {
                signal.notify_one();
                resume.notified().await;
                Some(b"{}".to_vec())
            })
            .await
    });
    started.notified().await;
    fcm.quiesce();
    release.notify_one();
    assert_eq!(
        job.await.unwrap(),
        SendOutcome::NotSent { reason: "shutdown" }
    );
    assert!(google.sends().is_empty());

    let fcm = delivery_common::fcm(&google, &temp_dir("s20b-inflight-unknown"));
    google.state.fcm.lock().unwrap().push_back(Answer::Reset);
    assert_eq!(
        fcm.send(Product::TodayWeather, b"{}".to_vec(), 1_792_101_600_000)
            .await,
        SendOutcome::Unknown {
            reason: "transport"
        }
    );
    assert_eq!(google.sends().len(), 1);
}

#[tokio::test]
async fn writer_quiesce_rejects_new_http_and_joins_idle_writer() {
    let peer = super::common::Peer::new();
    let services = peer.services("push");
    super::common::ready(&services).await;
    let push = services.push.unwrap();
    push.quiesce();
    let body = server2::push::routes::Body { value: server2::world::js::Val::from_ordered(&OrderedJson::parse(br#"[{"type":"ios","fcmToken":"synthetic-quiesced","cityIndex":1,"id":1,"location":{"lat":37.5,"long":127.1},"source":"KMA"}]"#).unwrap()), form: false };
    let reply = push
        .submit(server2::push::routes::Route::List, body, None)
        .await;
    // Specific legacy route error shape is already covered by registration regressions.
    assert!(
        matches!(reply, server2::push::routes::Reply::Json(bytes) if String::from_utf8_lossy(&bytes).contains("null"))
    );
    assert!(
        push.drain(tokio::time::Instant::now() + std::time::Duration::from_secs(1))
            .await
    );
}

#[tokio::test]
async fn user_edit_after_post_admission_survives_unregistered_response_and_stale_cleanup() {
    use server2::world::js::Val;
    let at = "2026-10-15T22:00:00.000Z";
    let now = 1_792_101_600_000;
    let doc = OrderedJson::parse(br#"{"type":"ios","fcmToken":"synthetic-post-race","cityIndex":1,"id":1,"geo":[126.97,37.56],"source":"KMA","lang":"ko","package":"todayWeather","pushTime":79200,"updatedAt":"2026-07-01T00:00:00.000Z"}"#).unwrap();
    let rig = rig(
        "s20b-post-race",
        at,
        &[(Coll::Alarm, alarm_record(1, &doc))],
        None,
    )
    .await;
    let oracle = oracle_ordered();
    rig.weather.set(
        items(oracle.get("cases").unwrap())[0]
            .get("weather")
            .unwrap(),
    );
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Held(
        started.clone(),
        release.clone(),
        r#"{"error":{"code":404,"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#
            .into(),
    ));
    // Held returns HTTP 200 in the existing double; embed an error classified unregistered.
    let worker = rig.worker;
    let job = tokio::spawn(async move { worker.run_minute(now).await });
    tokio::time::timeout(std::time::Duration::from_secs(3), started.notified())
        .await
        .unwrap();
    assert_eq!(rig.google.sends().len(), 1, "POST already admitted");
    let body = serde_json::json!({"type":"ios","fcmToken":"synthetic-post-race","cityIndex":1,"id":1,"location":{"lat":37.56,"long":126.97},"source":"KMA","name":"edited-after-post","pushTime":79200}).to_string();
    let request = axum::extract::Request::builder()
        .method("POST")
        .uri("/v000705/push")
        .header("content-type", "application/json")
        .header("content-length", body.len())
        .body(axum::body::Body::from(body))
        .unwrap();
    assert_eq!(rig.push.handle(request).await.unwrap().status(), 200);
    release.notify_one();
    let report = job.await.unwrap();
    assert!(report.claimed);
    assert_eq!(report.deliveries[0].1, "unregistered");
    let state = rig.push.state();
    let state = state.read().unwrap();
    let record = state.coll(Coll::Alarm).get(0).unwrap().unwrap();
    assert_eq!(
        record.doc.get("name"),
        &Val::Str("edited-after-post".into())
    );
    assert_eq!(record.doc.get("enable"), &Val::Bool(false));
    assert_ne!(record.doc.get("updatedAt"), &Val::Date(1_751_328_000_000.));
    assert_eq!(
        state.coll(Coll::Alarm).iter().map(Result::unwrap).count(),
        1,
        "refreshed selected record not removed by stale cleanup"
    );
    assert_eq!(
        rig.google.sends().len(),
        1,
        "no duplicate after response/cleanup"
    );
}

#[tokio::test]
async fn writer_deadline_cancels_pending_commit_without_acknowledging_or_detaching() {
    use state_common::*;
    let store = MemS3::new();
    seed(&store, &[]).await;
    let clock = FixedClock::at("2026-10-16T00:07:00Z");
    let push = start(&store, clock, fast_config()).await;
    store.fault_put("index/v2/push/state/journal/", Fault::Hang);
    let payload = r#"[{"type":"ios","fcmToken":"synthetic-pending","cityIndex":1,"id":1,"town":{"first":"Seoul"},"source":"KMA"}]"#;
    let request = axum::extract::Request::builder()
        .method("POST")
        .uri("/v000902/push-list")
        .header("content-type", "application/json")
        .header("content-length", payload.len())
        .body(axum::body::Body::from(payload))
        .unwrap();
    let p = push.clone();
    let request = tokio::spawn(async move { p.handle(request).await.unwrap() });
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while store.put_count("index/v2/push/state/journal/") == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        !push
            .drain(tokio::time::Instant::now() + std::time::Duration::from_millis(5))
            .await
    );
    let response = request.await.unwrap();
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&body).contains("upserted"));
    assert_eq!(push.state().read().unwrap().seq, 0);
    assert_eq!(
        push.counters
            .committed
            .load(std::sync::atomic::Ordering::Relaxed),
        0
    );
}

#[tokio::test]
async fn conditional_final_time_guard_rejects_clock_rollover_during_oauth() {
    use server2::{push::deliver::alerts::AlertWorker, world::js::Val};
    use std::io::Read;
    for changed_time in ["2026-10-16T00:08:00Z", "2026-10-16T00:06:00Z"] {
        let mut bytes = Vec::new();
        flate2::read::GzDecoder::new(
            &include_bytes!("../delivery/fixtures/alerts-oracle.json.gz")[..],
        )
        .read_to_end(&mut bytes)
        .unwrap();
        let oracle = OrderedJson::parse(&bytes).unwrap();
        let wet = items(oracle.get("cases").unwrap())
            .iter()
            .find(|c| c.get("id").unwrap().string().unwrap() == "current-ko-1")
            .unwrap();
        let Val::Obj(doc) = Val::from_ordered(wet.get("record").unwrap()) else {
            panic!("record");
        };
        let record = server2::push::Record { oid: [42; 12], doc };
        let rig = rig(
            "s20b-conditional-time",
            "2026-10-16T00:07:00Z",
            &[(Coll::Alert, record)],
            None,
        )
        .await;
        *rig.weather.kma.lock().unwrap() =
            Some(Weather::Ok(200, wet.get("body").unwrap().to_bytes()));
        let began = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        rig.google
            .state
            .token
            .lock()
            .unwrap()
            .push_back(Answer::Held(
                began.clone(),
                release.clone(),
                r#"{"access_token":"synthetic","expires_in":3600}"#.into(),
            ));
        let worker = AlertWorker::new(
            rig.push.clone(),
            Arc::new(rig.s3.clone()),
            rig.weather.clone(),
            Arc::new(fcm(&rig.google, &temp_dir("s20b-conditional-time-fcm"))),
            servers(),
            rig.clock.clone(),
            rig.diagnostics.clone(),
        );
        let now = server2::warnings::js::parse_iso("2026-10-16T00:07:00Z").unwrap();
        let job = tokio::spawn(async move { worker.run_minute(now).await });
        tokio::time::timeout(std::time::Duration::from_secs(2), began.notified())
            .await
            .unwrap();
        rig.clock.set(changed_time);
        release.notify_one();
        assert!(job.await.unwrap().claimed);
        assert!(rig.google.sends().is_empty());
    }
}

struct QueuedClock {
    calls: std::sync::atomic::AtomicUsize,
    changed: i64,
}
impl server2::budget::Clock for QueuedClock {
    fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
        let call = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(match call {
            0 | 1 => 1_792_109_219_999,
            2 => 1_792_109_220_000,
            _ => self.changed,
        })
    }
}
#[tokio::test]
async fn supervised_queued_ticks_changed_forward_or_backward_never_enter_claim_work() {
    for changed in [1_792_109_280_000, 1_792_109_160_000] {
        let peer = super::common::Peer::new();
        let clock = Arc::new(QueuedClock {
            calls: std::sync::atomic::AtomicUsize::new(0),
            changed,
        });
        let services = server2::runtime_services::RuntimeServices::from_vars_with_delivery(
            &peer.vars("push"),
            &peer.builtins(),
            server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
            clock.clone(),
            None,
        )
        .unwrap();
        super::common::ready(&services).await;
        let push = services.push.as_ref().unwrap();
        let request=axum::extract::Request::builder().method("POST").uri("/v000902/push-list").header("content-type","application/json").header("content-length",154).body(axum::body::Body::from(r#"[{"type":"ios","fcmToken":"synthetic-queued-tick","cityIndex":1,"id":1,"town":{"first":"Seoul"},"source":"KMA","pushTime":420}]"#)).unwrap();
        assert_eq!(push.handle(request).await.unwrap().status(), 200);
        let workers = services.delivery.unwrap();
        tokio::time::pause();
        let supervisor = workers.clone().start();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(clock.calls.load(std::sync::atomic::Ordering::SeqCst) >= 5);
        assert_eq!(
            workers
                .alarm
                .counters
                .minutes
                .load(std::sync::atomic::Ordering::Relaxed),
            0,
            "stale queued tick rejected before run_minute/claim"
        );
        drop(supervisor);
        tokio::time::resume();
    }
}
