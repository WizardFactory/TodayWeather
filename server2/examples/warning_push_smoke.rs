//! Actual loopback S3, geocode and OAuth/FCM HTTP smoke. Synthetic account/device only;
//! no .env, real credentials, provider or device calls. Push registration journal is MemS3.
#[path = "../tests/delivery/common.rs"]
mod common;
#[path = "../tests/state/common.rs"]
mod state_common;
#[path = "../tests/warnings/common.rs"]
mod warning_common;
use common::*;
use server2::{
    push::{
        Coll, Record,
        deliver::{
            HttpFetch, Servers,
            warning_feed::WarningFeed,
            warnings::{ApiLocations, WarningWorker},
        },
    },
    storage::CatalogTransport,
    warnings::{
        provider::{Operation, Page},
        records::{ZONE_KIND, members_from_pages},
    },
    world::js::{Obj, Val},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
#[tokio::main]
async fn main() {
    let at = "2026-10-16T01:02:00Z";
    let now = server2::warnings::js::parse_iso(at).unwrap();
    let mut doc = Obj::new();
    for (k, v) in [
        ("type", "ios"),
        ("fcmToken", "synthetic-warning-smoke"),
        ("lang", "ko"),
        ("package", "todayWeather"),
    ] {
        doc.set(k, v)
    }
    doc.set("cityIndex", 1.);
    doc.set("id", 1.);
    doc.set("enable", true);
    doc.set("startTime", 0.);
    doc.set("endTime", 86399.);
    doc.set("geo", Val::Arr(vec![Val::Num(127.), Val::Num(37.)]));
    let rig = rig(
        "warning-functional-smoke",
        at,
        &[(
            Coll::Alert,
            Record {
                oid: [0x78; 12],
                doc,
            },
        )],
        None,
    )
    .await;
    let hits = Arc::new(AtomicUsize::new(0));
    let counted = hits.clone();
    let app=axum::Router::new().fallback(move||{let hits=counted.clone();async move{hits.fetch_add(1,Ordering::Relaxed);([( "content-type","application/json")],r#"{"country":"KR","kmaAddress":{"name1":"서울특별시","name2":"종로구","name3":"청운효자동"}}"#)}});
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let peer = warning_common::Peer::new();
    let transport = Arc::new(peer.transport());
    let store = peer.store();
    let feed = Arc::new(WarningFeed::new(transport.clone(), rig.clock.clone()));
    feed.publish(&[]).await.unwrap();
    let providers = Arc::new(fcm(
        &rig.google,
        &temp_dir("warning-functional-smoke-account"),
    ));
    let locations = Arc::new(ApiLocations::new(
        Arc::new(HttpFetch::new().unwrap()),
        Servers {
            api: root.clone(),
            service: root.clone(),
        },
    ));
    let worker = WarningWorker::new(
        rig.push.clone(),
        transport.clone(),
        feed.clone(),
        store.clone(),
        locations.clone(),
        providers.clone(),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert_eq!(worker.poll().await.unwrap().attempted, 0);
    let rows = vec![
        serde_json::json!({"areaCode":"L1100000","areaName":"서울","warnVar":2,"warnStress":0,"command":"1","cancel":"0","tmFc":202610161000_i64,"tmSeq":1,"endTime":0,"allEndTime":0}),
    ];
    let body=serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":rows}}}})).unwrap();
    let page = Page {
        operation: Operation::PwnCd,
        body: body.into(),
        fetched_at_ms: now as u64,
        items: rows.clone(),
    };
    store
        .publish(
            ZONE_KIND,
            20261016,
            members_from_pages(&[page]),
            tokio::time::Instant::now() + Duration::from_secs(9),
        )
        .await
        .unwrap();
    feed.publish(&rows).await.unwrap();
    let first = worker.poll().await.unwrap();
    assert_eq!(first.accepted, 1);
    assert_eq!(worker.poll().await.unwrap().attempted, 0);
    let restored =
        state_common::start(&rig.s3, rig.clock.clone(), state_common::fast_config()).await;
    let replacement = WarningWorker::new(
        restored,
        transport.clone(),
        Arc::new(WarningFeed::new(transport.clone(), rig.clock.clone())),
        peer.store(),
        locations,
        providers,
        rig.clock.clone(),
        rig.diagnostics.clone(),
    );
    assert_eq!(replacement.poll().await.unwrap().attempted, 0);
    assert_eq!(replacement.poll().await.unwrap().attempted, 0);
    assert_eq!(rig.google.sends().len(), 1);
    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "shared region lookup survives open-campaign polls"
    );
    assert!(
        transport
            .get_control("index/v2/push/warning-feed/head.json", 8 * 1024 * 1024)
            .await
            .is_ok()
    );
    println!(
        "{}",
        serde_json::json!({"scenario":"warning-feed-and-restart","clock":at,"s3_http_feed_and_claims":true,"s12_raw_catalog_http":true,"geocode_http_gets":hits.load(Ordering::Relaxed),"local_fcm_submissions":rig.google.sends().len(),"restart_resends":0,"external_calls":0,"outcome":"PASS"})
    );
    server.abort();
}
