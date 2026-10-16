//! Offline pinned legacy conditional-alert parity and durable worker regressions.
use super::{common::*, state_common::*};
use server2::{
    gateway::OrderedJson,
    push::deliver::alerts,
    world::js::{Obj, Val},
};
use std::io::Read;

fn oracle() -> OrderedJson {
    let mut text = String::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/alerts-oracle.json.gz")[..])
        .read_to_string(&mut text)
        .unwrap();
    OrderedJson::parse(text.as_bytes()).unwrap()
}
fn obj(v: &OrderedJson) -> Obj {
    let Val::Obj(o) = Val::from_ordered(v) else {
        panic!("object")
    };
    o
}
fn revive(mut o: Obj) -> Obj {
    for name in ["airAlerts", "precipAlerts"] {
        if let Val::Obj(mut state) = o.get(name).clone() {
            if let Val::Str(time) = state.get("pushTime") {
                let ms = server2::warnings::js::parse_iso(time).unwrap();
                state.set("pushTime", Val::Date(ms as f64));
            }
            o.set(name, Val::Obj(state));
        }
    }
    o
}
#[test]
fn conditional_cases_match_actual_legacy_controller() {
    let oracle = oracle();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    let cases = items(oracle.get("cases").unwrap());
    for case in cases {
        let id = case.get("id").unwrap().string().unwrap();
        let mut record = revive(obj(case.get("record").unwrap()));
        let body = case
            .get("body")
            .map(Val::from_ordered)
            .unwrap_or(Val::Undef);
        let want = case.get("result").unwrap();
        match alerts::parse(
            &record,
            &body,
            case.get("minute").unwrap().number().unwrap() as u32,
            now,
        ) {
            Ok(info) => {
                assert!(want.get("error").is_none(), "{id} expected error");
                assert_eq!(
                    info.to_json(),
                    Val::from_ordered(want.get("info").unwrap()).to_json(),
                    "{id} info"
                );
                let send = alerts::compare(&record, &info, now).unwrap();
                assert_eq!(
                    send.as_str(),
                    want.get("send").unwrap().string().unwrap(),
                    "{id} send"
                );
                alerts::update(&mut record, &info, send, now).unwrap();
                assert_eq!(
                    Val::Obj(record.clone()).to_json(),
                    Val::from_ordered(want.get("updated").unwrap()).to_json(),
                    "{id} state"
                );
                match alerts::message(&record, &info) {
                    Ok(m) => {
                        let mut got = Obj::new();
                        got.set("title", m.title);
                        got.set("text", m.text);
                        assert_eq!(
                            Val::Obj(got).to_json(),
                            Val::from_ordered(want.get("message").unwrap()).to_json(),
                            "{id} message"
                        );
                    }
                    Err(_) => assert!(
                        want.get("message").unwrap().get("error").is_some(),
                        "{id} unexpected message error"
                    ),
                }
            }
            Err(_) => assert!(want.get("error").is_some(), "{id} unexpected parse error"),
        }
    }
    assert_eq!(cases.len(), 133);
}

#[test]
fn conditional_urls_match_legacy_defaults_units_and_vc_route() {
    let oracle = oracle();
    for case in items(oracle.get("urls").unwrap()) {
        let mut r = obj(case.get("record").unwrap());
        let want = case.get("result").unwrap();
        match server2::push::deliver::weather::conditional_url(&mut r, &servers()) {
            Ok(url) => assert_eq!(url, want.string().unwrap()),
            Err(_) => assert!(want.get("error").is_some()),
        }
    }
}

#[test]
fn selection_windows_and_both_category_six_hour_gate_are_inclusive() {
    let oracle = oracle();
    let case = &items(oracle.get("cases").unwrap())[0];
    let mut r = obj(case.get("record").unwrap());
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    r.set("startTime", 3600.);
    r.set("endTime", 7200.);
    for (t, want) in [(3599., false), (3600., true), (7200., true), (7201., false)] {
        assert_eq!(alerts::eligible(&r, t, now), want);
    }
    r.set("reverseTime", true);
    for (t, want) in [
        (3599., true),
        (3600., true),
        (5000., true),
        (7200., true),
        (7201., true),
    ] {
        assert_eq!(alerts::eligible(&r, t, now), want);
    }
    r.set("startTime", 80000.);
    r.set("endTime", 3000.);
    assert!(!alerts::eligible(&r, 5000., now));
    assert!(alerts::eligible(&r, 80000., now));
    assert!(alerts::eligible(&r, 3000., now));
    for field in ["airAlerts", "precipAlerts"] {
        for (delta, want) in [(21600000, false), (21600001, true)] {
            let mut record = r.clone();
            let mut state = Obj::new();
            state.set("pushTime", Val::Date((now - delta) as f64));
            record.set(field, Val::Obj(state));
            assert_eq!(
                alerts::eligible(&record, 1000., now),
                want,
                "{field} {delta}"
            );
        }
    }
    r.set("enable", false);
    assert!(!alerts::eligible(&r, 1000., now));
    r.remove("enable");
    assert!(!alerts::eligible(&r, 1000., now));
}

fn wet_case() -> (Obj, OrderedJson, i64) {
    let oracle = oracle();
    let case = items(oracle.get("cases").unwrap())
        .iter()
        .find(|c| c.get("id").unwrap().string().unwrap() == "current-ko-1")
        .unwrap();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    (
        revive(obj(case.get("record").unwrap())),
        case.get("body").unwrap().clone(),
        now,
    )
}
fn alert_record(n: u8, doc: Obj) -> server2::push::Record {
    let mut oid = [0x6au8; 12];
    oid[11] = n;
    server2::push::Record { oid, doc }
}
fn alert_worker(
    rig: &Rig,
    push: std::sync::Arc<server2::push::PushService>,
) -> alerts::AlertWorker<MemS3> {
    alerts::AlertWorker::new(
        push,
        std::sync::Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        std::sync::Arc::new(fcm(
            &rig.google,
            &temp_dir(&format!(
                "conditional-worker-{}",
                rig.google.root.replace([':', '/'], "_")
            )),
        )),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    )
}
fn set_wet(rig: &Rig, body: &OrderedJson) {
    let raw = format!(
        r#"{{"kma":{{"status":200,"body":{}}}}}"#,
        String::from_utf8(body.to_bytes()).unwrap()
    );
    rig.weather
        .set(&OrderedJson::parse(raw.as_bytes()).unwrap());
}

#[tokio::test]
async fn conditional_worker_commits_state_before_send_and_restart_cannot_resend() {
    use server2::push::Coll;
    let (r, body, now) = wet_case();
    let rig = rig(
        "conditional-restart",
        "2026-10-16T00:07:00Z",
        &[(Coll::Alert, alert_record(1, r))],
        None,
    )
    .await;
    set_wet(&rig, &body);
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
        503,
        r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
    ));
    let worker = alert_worker(&rig, rig.push.clone());
    let first = worker.run_minute(now).await;
    assert!(first.claimed);
    assert_eq!(first.deliveries[0].1, "rejected");
    assert_eq!(rig.google.sends().len(), 1);
    let doc = rig
        .push
        .state()
        .read()
        .unwrap()
        .coll(Coll::Alert)
        .get(0)
        .unwrap()
        .doc;
    assert_eq!(
        doc.get("precipAlerts").get("pushTime"),
        &Val::Date(now as f64)
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let worker2 = alert_worker(&rig, restored);
    assert!(!worker2.run_minute(now).await.claimed);
    assert_eq!(rig.google.sends().len(), 1);
    rig.clock.set("2026-10-16T00:17:00Z");
    assert!(!worker2.run_minute(now + 600000).await.claimed);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "six-hour cooldown survives restart"
    );
    let diagnostic = format!("{:?}", rig.diagnostics.events.lock().unwrap());
    for secret in ["synthetic-alert", "Synthetic town", "127", "37"] {
        assert!(!diagnostic.contains(secret), "no {secret}");
    }
}

#[tokio::test]
async fn unavailable_claim_or_state_never_sends() {
    use server2::push::Coll;
    for (name, prefix) in [
        ("conditional-claim", "index/v2/push/delivery/alert/"),
        ("conditional-state", "index/v2/push/state/journal/"),
    ] {
        let (r, body, now) = wet_case();
        let rig = rig(
            name,
            "2026-10-16T00:07:00Z",
            &[(Coll::Alert, alert_record(1, r))],
            None,
        )
        .await;
        set_wet(&rig, &body);
        rig.s3.fault_put(prefix, Fault::Reject(403));
        let worker = alert_worker(&rig, rig.push.clone());
        worker.run_minute(now).await;
        assert_eq!(rig.google.sends().len(), 0, "{name}");
    }
}

#[tokio::test]
async fn unregistered_token_disables_all_alerts_without_touching_alarms() {
    use server2::push::Coll;
    let (r, body, now) = wet_case();
    let rig = rig(
        "conditional-disable",
        "2026-10-16T00:07:00Z",
        &[
            (Coll::Alert, alert_record(1, r.clone())),
            (Coll::Alert, alert_record(2, r.clone())),
            (Coll::Alarm, alert_record(3, r)),
        ],
        None,
    )
    .await;
    set_wet(&rig, &body);
    rig.google.state.fcm.lock().unwrap().extend([Answer::Json(404,r#"{"error":{"code":404,"status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}"#.into()),Answer::Json(404,r#"{"error":{"code":404,"status":"NOT_FOUND"}}"#.into())]);
    let worker = alert_worker(&rig, rig.push.clone());
    worker.run_minute(now).await;
    let state = rig.push.state();
    let state = state.read().unwrap();
    assert!(
        state
            .coll(Coll::Alert)
            .iter()
            .all(|(_, r)| r.doc.get("enable") == &Val::Bool(false))
    );
    assert_eq!(
        state
            .coll(Coll::Alarm)
            .iter()
            .next()
            .unwrap()
            .1
            .doc
            .get("enable"),
        &Val::Bool(true)
    );
}

#[tokio::test]
async fn conditional_unknown_outcomes_are_single_attempt_and_not_resent() {
    use server2::push::Coll;
    for (label, answer) in [("reset", Answer::Reset), ("hang", Answer::Hang)] {
        let (r, body, now) = wet_case();
        let rig = rig(
            &format!("conditional-{label}"),
            "2026-10-16T00:07:00Z",
            &[(Coll::Alert, alert_record(1, r))],
            None,
        )
        .await;
        set_wet(&rig, &body);
        rig.google.state.fcm.lock().unwrap().push_back(answer);
        let transport = std::sync::Arc::new(rig.s3.clone());
        let provider = fcm(
            &rig.google,
            &temp_dir(&format!("conditional-timeout-{label}")),
        )
        .with_send_timeout(std::time::Duration::from_millis(30));
        let worker = alerts::AlertWorker::new(
            rig.push.clone(),
            transport,
            rig.weather.clone(),
            std::sync::Arc::new(provider),
            servers(),
            rig.clock.clone(),
            rig.diagnostics.clone(),
        );
        let report = worker.run_minute(now).await;
        assert_eq!(report.deliveries[0].1, "unknown");
        assert_eq!(rig.google.sends().len(), 1);
        assert!(!worker.run_minute(now + 3000).await.claimed);
        assert_eq!(rig.google.sends().len(), 1);
        let state = start(&rig.s3, rig.clock.clone(), fast_config()).await;
        let worker2 = alert_worker(&rig, state);
        assert!(!worker2.run_minute(now).await.claimed);
        assert_eq!(rig.google.sends().len(), 1);
    }
}

struct UserUpdateFetch {
    push: std::sync::Arc<server2::push::PushService>,
    weather: Vec<u8>,
    registration: Vec<u8>,
}
impl server2::push::deliver::Fetch for UserUpdateFetch {
    fn get(
        &self,
        _url: String,
        _lang: Option<String>,
    ) -> server2::gateway::BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        Box::pin(async move {
            let request = axum::extract::Request::builder()
                .method("POST")
                .uri("/v000902/push-list")
                .header("content-type", "application/json")
                .header("content-length", self.registration.len().to_string())
                .body(axum::body::Body::from(self.registration.clone()))
                .unwrap();
            let reply = self.push.handle(request).await.unwrap();
            assert_eq!(reply.status(), 200);
            Ok((200, self.weather.clone()))
        })
    }
}
#[tokio::test]
async fn concurrent_user_update_during_weather_is_preserved_and_not_sent() {
    use server2::push::Coll;
    let (r, body, now) = wet_case();
    let rig = rig(
        "conditional-user-update",
        "2026-10-16T00:07:00Z",
        &[(Coll::Alert, alert_record(1, r.clone()))],
        None,
    )
    .await;
    let mut edited = r;
    edited.set("category", "alert");
    edited.set("name", "new name");
    let mut location = Obj::new();
    location.set("lat", 37.);
    location.set("long", 127.);
    edited.set("location", Val::Obj(location));
    let fetch = UserUpdateFetch {
        push: rig.push.clone(),
        weather: body.to_bytes(),
        registration: Val::Arr(vec![Val::Obj(edited)]).to_json(),
    };
    let worker = alerts::AlertWorker::new(
        rig.push.clone(),
        std::sync::Arc::new(rig.s3.clone()),
        std::sync::Arc::new(fetch),
        std::sync::Arc::new(fcm(
            &rig.google,
            &temp_dir("conditional-user-update-provider"),
        )),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(now).await;
    assert!(report.claimed);
    assert_eq!(report.deliveries[0].2, "state-not-committed");
    assert!(rig.google.sends().is_empty());
    let doc = rig
        .push
        .state()
        .read()
        .unwrap()
        .coll(Coll::Alert)
        .get(0)
        .unwrap()
        .doc;
    assert_eq!(doc.get("name"), &Val::Str("new name".into()));
    assert!(doc.get("precipAlerts").get("pushTime").is_nullish());
}

#[tokio::test]
async fn no_change_still_updates_alert_state_without_a_provider_call() {
    use server2::push::Coll;
    let (mut r, mut body, now) = wet_case();
    r.set("precipAlerts", Val::Obj(Obj::new()));
    let mut json: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    json["current"]["pty"] = serde_json::json!(0);
    body = OrderedJson::parse(&serde_json::to_vec(&json).unwrap()).unwrap();
    let rig = rig(
        "conditional-no-change",
        "2026-10-16T00:07:00Z",
        &[(Coll::Alert, alert_record(1, r))],
        None,
    )
    .await;
    set_wet(&rig, &body);
    let worker = alert_worker(&rig, rig.push.clone());
    let report = worker.run_minute(now).await;
    assert_eq!(report.deliveries[0].1, "not-needed");
    assert!(rig.google.sends().is_empty());
    let doc = rig
        .push
        .state()
        .read()
        .unwrap()
        .coll(Coll::Alert)
        .get(0)
        .unwrap()
        .doc;
    assert_eq!(doc.get("precipAlerts").get("lastState"), &Val::Num(0.));
    assert!(
        !worker.run_minute(now + 60000).await.claimed,
        "not a scheduler minute"
    );
}

struct JumpClock(std::sync::atomic::AtomicUsize);
impl server2::budget::Clock for JumpClock {
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
async fn scheduler_evaluates_the_current_minute_after_a_clock_jump_not_the_missed_one() {
    use server2::push::Coll;
    let (r, body, _) = wet_case();
    let rig = rig(
        "conditional-clock-jump",
        "2026-10-16T00:35:00Z",
        &[(Coll::Alert, alert_record(1, r))],
        None,
    )
    .await;
    set_wet(&rig, &body);
    let worker = std::sync::Arc::new(alerts::AlertWorker::new(
        rig.push.clone(),
        std::sync::Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        std::sync::Arc::new(fcm(
            &rig.google,
            &temp_dir("conditional-clock-jump-provider"),
        )),
        servers(),
        std::sync::Arc::new(JumpClock(std::sync::atomic::AtomicUsize::new(0))),
        rig.diagnostics.clone(),
    ));
    let scheduler = tokio::spawn(worker.run());
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if !rig.google.sends().is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    scheduler.abort();
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0035.json")
            .is_some(),
        "the current cycle is claimed"
    );
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_none(),
        "missed cycles are not caught up"
    );
}

fn malformed_oracle() -> OrderedJson {
    let mut raw = String::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/alerts-malformed.json.gz")[..])
        .read_to_string(&mut raw)
        .unwrap();
    OrderedJson::parse(raw.as_bytes()).unwrap()
}
#[test]
fn malformed_forecast_searches_match_legacy_errors_and_first_match_short_circuit() {
    let oracle = malformed_oracle();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    let cases = items(oracle.get("cases").unwrap());
    for case in cases {
        let id = case.get("id").unwrap().string().unwrap();
        let r = obj(case.get("record").unwrap());
        let input = Val::from_ordered(case.get("body").unwrap());
        let want = case.get("result").unwrap();
        let parsed = alerts::parse(&r, &input, 7, now);
        if let Some(error) = want.get("error") {
            assert_eq!(
                parsed.unwrap_err(),
                error.string().unwrap(),
                "{id}: legacy stops at malformed row"
            );
        } else {
            let parsed = parsed.unwrap();
            assert_eq!(
                parsed.to_json(),
                Val::from_ordered(want.get("info").unwrap()).to_json(),
                "{id} parsed"
            );
            assert_eq!(
                alerts::compare(&r, &parsed, now).unwrap().as_str(),
                want.get("send").unwrap().string().unwrap(),
                "{id} decision"
            );
        }
    }
    assert_eq!(cases.len(), 11);
}
#[tokio::test]
async fn malformed_forecast_searches_never_submit_where_legacy_stops() {
    use server2::push::Coll;
    let oracle = malformed_oracle();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    for case in items(oracle.get("cases").unwrap()) {
        let id = case.get("id").unwrap().string().unwrap();
        let record = obj(case.get("record").unwrap());
        let rig = rig(
            &format!("conditional-malformed-{id}"),
            "2026-10-16T00:07:00Z",
            &[(Coll::Alert, alert_record(1, record))],
            None,
        )
        .await;
        set_wet(&rig, case.get("body").unwrap());
        let worker = alert_worker(&rig, rig.push.clone());
        let report = worker.run_minute(now).await;
        let expected = items(case.get("notifications").unwrap());
        assert_eq!(
            rig.google.sends().len(),
            expected.len(),
            "{id}: actual legacy submission count"
        );
        if case.get("result").unwrap().get("error").is_some() {
            assert_eq!(report.deliveries[0].2, "parse", "{id}");
        }
        if let Some(want) = expected.first() {
            let body: serde_json::Value =
                serde_json::from_str(&rig.google.sends()[0].body).unwrap();
            assert_eq!(
                body["message"]["notification"]["title"],
                want.get("title").unwrap().string().unwrap(),
                "{id} title"
            );
            assert_eq!(
                body["message"]["notification"]["body"],
                want.get("text").unwrap().string().unwrap(),
                "{id} text"
            );
        }
    }
}

fn air_filter_oracle() -> OrderedJson {
    let mut raw = String::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/alerts-air-filter.json.gz")[..])
        .read_to_string(&mut raw)
        .unwrap();
    OrderedJson::parse(raw.as_bytes()).unwrap()
}
#[test]
fn air_filter_traverses_all_rows_before_find_as_actual_legacy_does() {
    let oracle = air_filter_oracle();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    let cases = items(oracle.get("cases").unwrap());
    for case in cases {
        let id = case.get("id").unwrap().string().unwrap();
        let r = obj(case.get("record").unwrap());
        let input = Val::from_ordered(case.get("body").unwrap());
        let want = case.get("result").unwrap();
        let minute = case.get("minute").unwrap().number().unwrap() as u32;
        let parsed = alerts::parse(&r, &input, minute, now);
        if let Some(error) = want.get("error") {
            assert_eq!(
                parsed.unwrap_err(),
                error.string().unwrap(),
                "{id}: whole-array filter must complete"
            );
        } else {
            let parsed = parsed.unwrap();
            assert_eq!(
                parsed.to_json(),
                Val::from_ordered(want.get("info").unwrap()).to_json(),
                "{id} parsed"
            );
            assert_eq!(
                alerts::compare(&r, &parsed, now).unwrap().as_str(),
                want.get("send").unwrap().string().unwrap(),
                "{id} decision"
            );
        }
    }
    assert_eq!(cases.len(), 12);
}
#[tokio::test]
async fn air_filter_failure_prevents_precipitation_submission_as_actual_legacy_does() {
    use server2::push::Coll;
    let oracle = air_filter_oracle();
    let now =
        server2::warnings::js::parse_iso(&oracle.get("at").unwrap().string().unwrap()).unwrap();
    for case in items(oracle.get("cases").unwrap()) {
        let id = case.get("id").unwrap().string().unwrap();
        let record = obj(case.get("record").unwrap());
        let minute = case.get("minute").unwrap().number().unwrap() as i64;
        let rig = rig(
            &format!("conditional-filter-{id}"),
            "2026-10-16T00:35:00Z",
            &[(Coll::Alert, alert_record(1, record))],
            None,
        )
        .await;
        set_wet(&rig, case.get("body").unwrap());
        let worker = alert_worker(&rig, rig.push.clone());
        let report = worker.run_minute(now + (minute - 35) * 60000).await;
        let expected = items(case.get("notifications").unwrap());
        assert_eq!(
            rig.google.sends().len(),
            expected.len(),
            "{id}: actual legacy submission count"
        );
        if case.get("result").unwrap().get("error").is_some() {
            assert_eq!(report.deliveries[0].2, "parse", "{id}");
        }
        if let Some(want) = expected.first() {
            let body: serde_json::Value =
                serde_json::from_str(&rig.google.sends()[0].body).unwrap();
            assert_eq!(
                body["message"]["notification"]["title"],
                want.get("title").unwrap().string().unwrap(),
                "{id} title"
            );
            assert_eq!(
                body["message"]["notification"]["body"],
                want.get("text").unwrap().string().unwrap(),
                "{id} text"
            );
        }
    }
}
