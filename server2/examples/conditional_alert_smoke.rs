//! Local functional smoke: real HTTP weather + OAuth/FCM peers, durable state and restart.
//! Test-owned synthetic registrations only. No .env or external provider access.
#[path = "../tests/delivery/common.rs"]
mod common;
#[path = "../tests/state/common.rs"]
mod state_common;
use common::*;
use server2::{
    push::{
        Coll, Record,
        deliver::{HttpFetch, Servers, alerts::AlertWorker},
    },
    world::js::{Obj, Val},
};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let at = "2026-10-16T00:07:00Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let mut doc = Obj::new();
    for (k, v) in [
        ("type", "ios"),
        ("fcmToken", "synthetic-only"),
        ("source", "KMA"),
        ("lang", "en"),
        ("package", "todayWeather"),
    ] {
        doc.set(k, v);
    }
    doc.set("cityIndex", 1.);
    doc.set("id", 1.);
    doc.set("enable", true);
    doc.set("reverseTime", false);
    doc.set("startTime", 0.);
    doc.set("endTime", 86399.);
    doc.set("geo", Val::Arr(vec![Val::Num(127.), Val::Num(37.)]));
    doc.set("airAlertsBreakPoint", 3.);
    let rig = rig(
        "conditional-functional-smoke",
        at,
        &[(
            Coll::Alert,
            Record {
                oid: [0x77; 12],
                doc,
            },
        )],
        None,
    )
    .await;
    let body = r#"{"source":"KMA","name":"Synthetic city","current":{"pty":1,"rns":true,"dateObj":"2026.10.16 09:00"}}"#;
    let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = hits.clone();
    let app = axum::Router::new().fallback(move || {
        let c = counted.clone();
        async move {
            c.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            ([("content-type", "application/json")], body)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let servers = Servers {
        service: root.clone(),
        api: root,
    };
    let provider = Arc::new(fcm(
        &rig.google,
        &temp_dir("conditional-functional-smoke-fcm"),
    ));
    let worker = AlertWorker::new(
        rig.push.clone(),
        Arc::new(rig.s3.clone()),
        Arc::new(HttpFetch::new().unwrap()),
        provider.clone(),
        servers.clone(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    let first = worker.run_minute(now).await;
    assert!(first.claimed);
    assert_eq!(first.deliveries[0].1, "accepted");
    let push2 = state_common::start(&rig.s3, rig.clock.clone(), state_common::fast_config()).await;
    let restarted = AlertWorker::new(
        push2,
        Arc::new(rig.s3.clone()),
        Arc::new(HttpFetch::new().unwrap()),
        provider,
        servers,
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert!(!restarted.run_minute(now).await.claimed);
    let weather_gets = hits.load(std::sync::atomic::Ordering::Relaxed);
    let provider_submissions = rig.google.sends().len();
    assert_eq!((weather_gets, provider_submissions), (1, 1));
    println!(
        "{}",
        serde_json::json!({"scenario":"conditional-alert-and-restart","clock":at,"weather_http_gets":weather_gets,"local_fcm_submissions":provider_submissions,"alert_journal_durable":true,"restart_resends":0,"external_calls":0,"outcome":"PASS"})
    );
    server.abort();
}
