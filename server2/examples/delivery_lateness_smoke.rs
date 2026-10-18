//! Owned-loopback rehearsal only: synthetic credentials/tokens, recorded weather, memory journal.
#![allow(dead_code)]
#[path = "../tests/delivery/common.rs"]
mod common;
#[path = "../tests/delivery/lateness_support.rs"]
mod lateness_support;
#[path = "../tests/state/common.rs"]
mod state_common;
use common::*;
use lateness_support::CrossingFetch;
use server2::{
    gateway::OrderedJson,
    push::{
        Coll, Record,
        deliver::{AlarmWorker, alerts::AlertWorker},
    },
    world::js::{Obj, Val},
};
use state_common::{fast_config, start};
use std::{io::Read, sync::Arc, time::Duration};

fn alarm(n: u8) -> (Coll, Record) {
    let body = format!(
        r#"{{"type":"ios","fcmToken":"synthetic-cli-alarm-{n}","cityIndex":{n},"id":{n},"geo":[126.97,37.56],"source":"KMA","name":"Synthetic town","lang":"ko","package":"todayWeather","pushTime":79200,"updatedAt":"2026-10-10T00:00:00.000Z"}}"#
    );
    (
        Coll::Alarm,
        alarm_record(n, &OrderedJson::parse(body.as_bytes()).unwrap()),
    )
}
fn wet_case() -> (Obj, OrderedJson) {
    let mut text = String::new();
    flate2::read::GzDecoder::new(
        &include_bytes!("../tests/delivery/fixtures/alerts-oracle.json.gz")[..],
    )
    .read_to_string(&mut text)
    .unwrap();
    let o = OrderedJson::parse(text.as_bytes()).unwrap();
    let c = items(o.get("cases").unwrap())
        .iter()
        .find(|c| c.get("id").unwrap().string().as_deref() == Some("current-ko-1"))
        .unwrap();
    let Val::Obj(doc) = Val::from_ordered(c.get("record").unwrap()) else {
        panic!("record");
    };
    (doc, c.get("body").unwrap().clone())
}
fn reject_each(rig: &Rig, members: usize) {
    for _ in 0..members {
        rig.google.state.fcm.lock().unwrap().push_back(Answer::Json(
            503,
            r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
        ));
    }
}

#[tokio::main]
async fn main() {
    const MEMBERS: u8 = 13;
    let at = "2026-10-15T22:00:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let records = (1..=MEMBERS).map(alarm).collect::<Vec<_>>();
    let rig = rig("lateness-cli-alarm", at, &records, None).await;
    let o = oracle_ordered();
    let kma = items(o.get("cases").unwrap())[0]
        .get("weather")
        .unwrap()
        .get("kma")
        .unwrap()
        .to_bytes();
    rig.weather.set(
        &OrderedJson::parse(format!(r#"{{"kma":{}}}"#, String::from_utf8(kma).unwrap()).as_bytes())
            .unwrap(),
    );
    reject_each(&rig, MEMBERS as usize);
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
        Arc::new(fcm(&rig.google, &temp_dir("lateness-cli-alarm-fcm"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = tokio::time::timeout(Duration::from_secs(10), worker.run_minute(now))
        .await
        .expect("owned alarm cohort settles");
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), MEMBERS as usize);
    assert!(
        report
            .deliveries
            .iter()
            .all(|(_, outcome, _)| outcome == "rejected")
    );
    assert_eq!(rig.google.sends().len(), MEMBERS as usize);
    assert_eq!(rig.google.tokens().len(), 1);
    assert_eq!(fetch.peak(), 6);
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alarm/20261015/2200.json")
            .is_some()
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let worker = AlarmWorker::new(
        restored,
        Arc::new(rig.s3.clone()),
        fetch.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-cli-alarm-restored"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert!(!worker.run_minute(now).await.claimed);
    assert_eq!(
        rig.google.sends().len(),
        MEMBERS as usize,
        "no replay/retry of rejected sends"
    );
    let alarm_result = serde_json::json!({"kind":"alarm","claimed_members":MEMBERS,"owned_fcm_posts":rig.google.sends().len(),"outcome":"rejected","oauth_posts":rig.google.tokens().len(),"peak_active_weather_fetches":fetch.peak(),"claim_retained":true,"restored_extra_posts":0,"owned_peer":rig.google.root});
    drop(worker);
    drop(rig);

    let at = "2026-10-16T00:07:00.000Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let (template, body) = wet_case();
    let records = (1..=MEMBERS)
        .map(|n| {
            let mut doc = template.clone();
            doc.set("fcmToken", Val::Str(format!("synthetic-cli-alert-{n}")));
            doc.set("id", Val::Num(n as f64));
            doc.set("cityIndex", Val::Num(n as f64));
            let mut oid = [0x6au8; 12];
            oid[11] = n;
            (Coll::Alert, Record { oid, doc })
        })
        .collect::<Vec<_>>();
    let rig = common::rig("lateness-cli-alert", at, &records, None).await;
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
    reject_each(&rig, MEMBERS as usize);
    let fetch = Arc::new(CrossingFetch::new(
        rig.weather.clone(),
        rig.clock.clone(),
        "2026-10-16T00:08:00.000Z",
        6,
    ));
    let worker = AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        fetch.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-cli-alert-fcm"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let report = tokio::time::timeout(Duration::from_secs(10), worker.run_minute(now))
        .await
        .expect("owned alert cohort settles");
    assert!(report.claimed);
    assert_eq!(report.deliveries.len(), MEMBERS as usize);
    assert!(
        report
            .deliveries
            .iter()
            .all(|(_, outcome, _)| outcome == "rejected")
    );
    assert_eq!(rig.google.sends().len(), MEMBERS as usize);
    assert_eq!(rig.google.tokens().len(), 1);
    assert_eq!(fetch.peak(), 6);
    assert!(
        rig.s3
            .body("index/v2/push/delivery/alert/20261016/0007.json")
            .is_some()
    );
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let worker = AlertWorker::new(
        restored,
        Arc::new(rig.s3.clone()),
        fetch.clone(),
        Arc::new(fcm(&rig.google, &temp_dir("lateness-cli-alert-restored"))),
        servers(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert!(!worker.run_minute(now).await.claimed);
    assert_eq!(
        rig.google.sends().len(),
        MEMBERS as usize,
        "no replay/retry of rejected sends"
    );
    let alert_result = serde_json::json!({"kind":"alert","claimed_members":MEMBERS,"owned_fcm_posts":rig.google.sends().len(),"outcome":"rejected","oauth_posts":rig.google.tokens().len(),"peak_active_weather_fetches":fetch.peak(),"claim_retained":true,"restored_extra_posts":0,"owned_peer":rig.google.root});
    drop(worker);
    drop(rig);
    println!(
        "{}",
        serde_json::json!({"verdict":"PASS","cases":[alarm_result,alert_result],"live_provider_calls":0,"device_sends":0,"production_eligible":false,"limitations":["Injected clocks, recorded in-process weather Fetch, in-memory conditional-write journal; real OAuth/FCM HTTP only to owned loopback peers","Peak is weather-fetch concurrency per cohort, not measured global provider/host capacity","Parent runner must await process exit and check owned peer listeners closed","Zero device/live sends follows forced loopback and synthetic configuration; no actual-device telemetry counter","No no-POST compensation, cadence, live provider, AWS S3, production latency or eligible previous full bundle qualification"]})
    );
}
