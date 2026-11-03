//! Public worker regressions: fixed admitted cohorts, no real notification endpoints.
use super::{
    common::*,
    lateness_support::CrossingFetch,
    state_common::{fast_config, start},
};
use server2::{
    gateway::OrderedJson,
    push::{
        Coll, Record,
        deliver::{AlarmWorker, alerts::AlertWorker},
    },
    world::js::{Obj, Val},
};
use std::{io::Read, sync::Arc, time::Duration};

fn alarm(n: u8) -> (Coll, Record) {
    let body = format!(
        r#"{{"type":"ios","fcmToken":"synthetic-late-alarm-{n}","cityIndex":{n},"id":{n},"geo":[126.97,37.56],"source":"KMA","name":"Synthetic town","lang":"ko","package":"todayWeather","pushTime":79200,"updatedAt":"2026-10-10T00:00:00.000Z"}}"#
    );
    (
        Coll::Alarm,
        alarm_record(n, &OrderedJson::parse(body.as_bytes()).unwrap()),
    )
}
fn kma_weather() -> OrderedJson {
    let o = oracle_ordered();
    let kma = items(o.get("cases").unwrap())[0]
        .get("weather")
        .unwrap()
        .get("kma")
        .unwrap()
        .to_bytes();
    OrderedJson::parse(format!(r#"{{"kma":{}}}"#, String::from_utf8(kma).unwrap()).as_bytes())
        .unwrap()
}
fn wet_case() -> (Obj, OrderedJson) {
    let mut text = String::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/alerts-oracle.json.gz")[..])
        .read_to_string(&mut text)
        .unwrap();
    let oracle = OrderedJson::parse(text.as_bytes()).unwrap();
    let case = items(oracle.get("cases").unwrap())
        .iter()
        .find(|c| c.get("id").unwrap().string().as_deref() == Some("current-ko-1"))
        .unwrap();
    let Val::Obj(doc) = Val::from_ordered(case.get("record").unwrap()) else {
        panic!("record");
    };
    (doc, case.get("body").unwrap().clone())
}
fn alert(n: u8, template: &Obj) -> (Coll, Record) {
    let mut doc = template.clone();
    doc.set("fcmToken", Val::Str(format!("synthetic-late-alert-{n}")));
    doc.set("id", Val::Num(n as f64));
    doc.set("cityIndex", Val::Num(n as f64));
    let mut oid = [0x6au8; 12];
    oid[11] = n;
    (Coll::Alert, Record { oid, doc })
}
fn set_wet(rig: &Rig, body: &OrderedJson) {
    let text = format!(
        r#"{{"kma":{{"status":200,"body":{}}}}}"#,
        String::from_utf8(body.to_bytes()).unwrap()
    );
    rig.weather
        .set(&OrderedJson::parse(text.as_bytes()).unwrap());
}
fn alert_worker(
    rig: &Rig,
    fetch: Arc<CrossingFetch>,
    push: Arc<server2::push::PushService>,
) -> AlertWorker<super::state_common::MemS3> {
    AlertWorker::new(
        push,
        Arc::new(rig.s3.clone()),
        fetch,
        Arc::new(fcm(
            &rig.google,
            &temp_dir(&format!(
                "lateness-alert-fcm-{}",
                rig.google.root.replace([':', '/'], "_")
            )),
        )),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    )
}

#[tokio::test]
async fn admitted_seven_alarms_finish_after_the_minute_and_never_replay() {
    let at = "2026-10-15T22:00:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let records = (1..=7).map(alarm).collect::<Vec<_>>();
    let rig = rig("lateness-alarm", at, &records, None).await;
    rig.weather.set(&kma_weather());
    let fetch = Arc::new(CrossingFetch::new(
        rig.weather.clone(),
        rig.clock.clone(),
        "2026-10-15T22:01:00.000Z",
        6,
    ));
    let worker = AlarmWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        fetch.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-alarm-fcm"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = tokio::time::timeout(Duration::from_secs(5), worker.run_minute(now))
        .await
        .expect("owned cohort settles");
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), 7);
    assert_eq!(fetch.peak(), 6, "six active first-wave fetches");
    assert_eq!(
        rig.google.sends().len(),
        7,
        "all seven admitted alarms must POST across the minute: {:?}",
        report.deliveries
    );
    assert!(
        report
            .deliveries
            .iter()
            .all(|(_, outcome, _)| outcome == "accepted")
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let worker = AlarmWorker::new(
        restored,
        Arc::new(rig.s3.clone()),
        fetch,
        Arc::new(fcm(&rig.google, &temp_dir("lateness-alarm-restored"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert!(!worker.run_minute(now).await.claimed);
    assert_eq!(rig.google.sends().len(), 7, "old claim is not replayed");
}

#[tokio::test]
async fn admitted_seven_alerts_finish_after_the_minute_and_never_replay() {
    let at = "2026-10-16T00:07:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let (template, body) = wet_case();
    let records = (1..=7).map(|n| alert(n, &template)).collect::<Vec<_>>();
    let rig = rig("lateness-alert", at, &records, None).await;
    set_wet(&rig, &body);
    let fetch = Arc::new(CrossingFetch::new(
        rig.weather.clone(),
        rig.clock.clone(),
        "2026-10-16T00:08:00.000Z",
        6,
    ));
    let worker = alert_worker(&rig, fetch.clone(), rig.push.clone());
    let report = tokio::time::timeout(Duration::from_secs(5), worker.run_minute(now))
        .await
        .expect("owned cohort settles");
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), 7);
    assert_eq!(fetch.peak(), 6);
    assert_eq!(
        rig.google.sends().len(),
        7,
        "all seven admitted alerts must POST across the minute: {:?}",
        report.deliveries
    );
    assert!(
        report
            .deliveries
            .iter()
            .all(|(_, outcome, _)| outcome == "accepted")
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let worker = alert_worker(&rig, fetch, restored);
    assert!(!worker.run_minute(now).await.claimed);
    assert_eq!(rig.google.sends().len(), 7, "old claim is not replayed");
}

#[tokio::test]
async fn clock_regression_inside_the_same_minute_refuses_an_alert() {
    let at = "2026-10-16T00:07:00.500Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let (template, body) = wet_case();
    let rig = rig(
        "lateness-clock-regression",
        at,
        &[alert(1, &template)],
        None,
    )
    .await;
    set_wet(&rig, &body);
    let fetch = Arc::new(CrossingFetch::new(
        rig.weather.clone(),
        rig.clock.clone(),
        "2026-10-16T00:07:00.250Z",
        1,
    ));
    let worker = alert_worker(&rig, fetch, rig.push.clone());
    let report = worker.run_minute(now).await;
    assert!(report.claimed);
    assert_eq!(
        rig.google.sends().len(),
        0,
        "clock earlier than actual admission must refuse POST"
    );
    assert_eq!(report.deliveries[0].2, "alert-admission");
}

struct AfterOAuthClock {
    peer: GoogleDouble,
    before: i64,
    after: i64,
}
impl server2::budget::Clock for AfterOAuthClock {
    fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
        let oauth_started = self
            .peer
            .state
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.path.ends_with("/o/oauth2/token"));
        Ok(if oauth_started {
            self.after
        } else {
            self.before
        })
    }
}

#[tokio::test]
async fn a_closed_alert_window_cannot_revive_in_the_next_days_window() {
    let at = "2026-10-16T00:07:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let after = server2::warnings::js::parse_iso("2026-10-17T00:07:00.000Z").unwrap();
    let (mut template, body) = wet_case();
    template.set("startTime", Val::Num(7. * 60.));
    template.set("endTime", Val::Num(17. * 60.));
    let rig = rig("lateness-next-window", at, &[alert(1, &template)], None).await;
    set_wet(&rig, &body);
    // Weather evaluation and state commit happen before the jump. The first owned
    // OAuth HTTP request then makes the final admission clock observe tomorrow.
    let clock = Arc::new(AfterOAuthClock {
        peer: GoogleDouble {
            root: rig.google.root.clone(),
            state: rig.google.state.clone(),
        },
        before: now,
        after,
    });
    let worker = AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-next-window-fcm"))),
        servers(),
        clock,
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(now).await;
    assert!(report.claimed);
    assert_eq!(
        rig.google.tokens().len(),
        1,
        "jump follows real owned OAuth HTTP"
    );
    assert_eq!(
        rig.google.sends().len(),
        0,
        "same clock-of-day tomorrow is a different configured window occurrence"
    );
    assert_eq!(report.deliveries[0].2, "alert-admission");
}

#[tokio::test]
async fn alert_windows_keep_the_inclusive_second_and_overnight_close() {
    let at = "2026-10-16T00:07:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    for (label, reverse, start_time, end_time, after, posts) in [
        (
            "end-second",
            false,
            420.,
            479.,
            "2026-10-16T00:07:59.999Z",
            1,
        ),
        ("closed", false, 420., 479., "2026-10-16T00:08:00.000Z", 0),
        (
            "overnight-end",
            true,
            23. * 3600.,
            3600.,
            "2026-10-16T01:00:00.999Z",
            1,
        ),
        (
            "overnight-closed",
            true,
            23. * 3600.,
            3600.,
            "2026-10-16T01:00:01.000Z",
            0,
        ),
    ] {
        let (mut template, body) = wet_case();
        template.set("startTime", Val::Num(start_time));
        template.set("endTime", Val::Num(end_time));
        template.set("reverseTime", Val::Bool(reverse));
        let rig = rig(
            &format!("lateness-{label}"),
            at,
            &[alert(1, &template)],
            None,
        )
        .await;
        set_wet(&rig, &body);
        let clock = Arc::new(AfterOAuthClock {
            peer: GoogleDouble {
                root: rig.google.root.clone(),
                state: rig.google.state.clone(),
            },
            before: now,
            after: server2::warnings::js::parse_iso(after).unwrap(),
        });
        let worker = AlertWorker::new(
            rig.push.clone(),
            Arc::new(rig.s3.clone()),
            rig.weather.clone(),
            Arc::new(fcm(
                &rig.google,
                &temp_dir(&format!(
                    "lateness-policy-{}",
                    rig.google.root.replace([':', '/'], "_")
                )),
            )),
            servers(),
            clock,
            rig.diagnostics.clone(),
        );
        let report = worker.run_minute(now).await;
        assert!(report.claimed, "{label}");
        assert_eq!(rig.google.tokens().len(), 1, "{label}: actual owned OAuth");
        assert_eq!(rig.google.sends().len(), posts, "{label}");
        if posts == 0 {
            assert_eq!(report.deliveries[0].2, "alert-admission", "{label}");
        } else {
            assert_eq!(report.deliveries[0].1, "accepted", "{label}");
        }
    }
}

#[tokio::test]
async fn clock_regression_inside_the_same_minute_refuses_an_alarm() {
    let at = "2026-10-15T22:00:00.500Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let rig = rig("lateness-alarm-clock", at, &[alarm(1)], None).await;
    rig.weather.set(&kma_weather());
    let clock = Arc::new(AfterOAuthClock {
        peer: GoogleDouble {
            root: rig.google.root.clone(),
            state: rig.google.state.clone(),
        },
        before: now,
        after: server2::warnings::js::parse_iso("2026-10-15T22:00:00.250Z").unwrap(),
    });
    let worker = AlarmWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        rig.weather.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-alarm-clock-fcm"))),
        servers(),
        clock,
        rig.diagnostics.clone(),
    );
    let report = worker.run_minute(now).await;
    assert!(report.claimed);
    assert_eq!(rig.google.tokens().len(), 1);
    assert_eq!(rig.google.sends().len(), 0);
    assert_eq!(report.deliveries[0].2, "alarm-admission");
}
