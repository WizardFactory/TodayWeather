//! Actual Node16 warning feed oracle and synthetic-only delivery/failure checks.
use super::state_common::*;
use server2::push::deliver::warning_feed::WarningFeed;
use std::{io::Read, sync::Arc};
fn oracle() -> serde_json::Value {
    let mut bytes = Vec::new();
    flate2::read::GzDecoder::new(&include_bytes!("fixtures/warnings-oracle.json.gz")[..])
        .read_to_end(&mut bytes)
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
#[tokio::test]
async fn warning_feed_matches_actual_legacy_publications_and_silent_baseline() {
    let data = oracle();
    for case in data["feed"].as_array().unwrap() {
        let s3 = MemS3::new();
        let clock = FixedClock::at("2026-10-16T01:02:00Z");
        let feed = WarningFeed::new(Arc::new(s3), clock);
        for (rows, expected) in case["publications"]
            .as_array()
            .unwrap()
            .iter()
            .zip(case["states"].as_array().unwrap())
        {
            let head = feed.publish(rows.as_array().unwrap()).await.unwrap();
            assert_eq!(head, expected["head"], "head {}", case["name"]);
            assert_eq!(
                serde_json::to_value(feed.read().await.unwrap()).unwrap(),
                expected["items"],
                "items {}",
                case["name"]
            );
        }
    }
}

#[test]
fn warning_publication_dates_match_javascript_date_utc() {
    let data = oracle();
    for case in data["dates"].as_array().unwrap() {
        assert_eq!(
            server2::push::deliver::warning_feed::published_at(&case["input"]),
            case["output"].as_i64(),
            "input={}",
            case["input"]
        );
    }
}
#[tokio::test]
async fn an_event_written_without_its_head_never_becomes_visible() {
    let data = oracle();
    let s3 = MemS3::new();
    let feed = WarningFeed::new(Arc::new(s3.clone()), FixedClock::at("2026-10-16T01:02:00Z"));
    feed.publish(&[]).await.unwrap();
    s3.fault_put("index/v2/push/warning-feed/head.json", Fault::Reject(503));
    let rows = data["feed"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "fresh-issue")
        .unwrap()["publications"][1]
        .as_array()
        .unwrap()
        .clone();
    assert!(
        feed.publish(&rows).await.is_err(),
        "a refused head is not acknowledged"
    );
    assert!(
        feed.read().await.unwrap().is_empty(),
        "orphan event must be invisible"
    );
    assert_eq!(
        s3.keys("index/v2/push/warning-feed/events/").len(),
        1,
        "first event persisted before head failure"
    );
    feed.publish(&rows).await.unwrap();
    assert_eq!(
        feed.read().await.unwrap().len(),
        1,
        "next source collection can complete the publication without duplicate event"
    );
}
fn obj(value: &serde_json::Value) -> server2::world::js::Obj {
    let ordered =
        server2::gateway::OrderedJson::parse(&serde_json::to_vec(value).unwrap()).unwrap();
    let server2::world::js::Val::Obj(o) = server2::world::js::Val::from_ordered(&ordered) else {
        panic!("object")
    };
    o
}
#[test]
fn warning_messages_groups_windows_and_payload_match_actual_legacy() {
    use server2::{
        push::deliver::{
            warning_feed::{Item, event_value},
            warnings::{self, Group},
        },
        warnings::zones::{Entry, ZoneState, prepare_events},
        world::js::Val,
    };
    let data = oracle();
    let now = data["now"].as_i64().unwrap();
    for case in data["messages"].as_array().unwrap() {
        let event = prepare_events(&[case["event"].clone()]).remove(0);
        let group = Group {
            id: String::new(),
            event,
            zones: vec!["L1010100".into()],
            observed_at: now,
        };
        let msg = warnings::message(
            &group,
            &group.zones,
            &Val::Str(case["record"]["lang"].as_str().unwrap().into()),
            now,
        );
        assert_eq!(
            msg.title,
            Val::Str(case["message"]["title"].as_str().unwrap().into())
        );
        assert_eq!(
            msg.text,
            Val::Str(case["message"]["text"].as_str().unwrap().into())
        );
    }
    for case in data["grouped"].as_array().unwrap() {
        let items: Vec<Item> = serde_json::from_value(case["items"].clone()).unwrap();
        let groups = warnings::groups(&items, now).unwrap();
        let projected = groups
            .iter()
            .map(|g| {
                let mut event = event_value(&g.event);
                event["zones"] = serde_json::json!(g.zones);
                serde_json::json!({"id":g.id,"event":event,"at":g.observed_at})
            })
            .collect::<Vec<_>>();
        let expected = case["result"]["created"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| serde_json::json!({"id":g["id"],"event":g["event"],"at":g["at"]}))
            .collect::<Vec<_>>();
        assert_eq!(projected, expected, "group {}", case["name"]);
    }
    for case in data["eligible"].as_array().unwrap() {
        let event = prepare_events(&[case["event"].clone()]).remove(0);
        let group = Group {
            id: String::new(),
            event,
            zones: vec!["L1010100".into()],
            observed_at: now,
        };
        let mut zones = ZoneState::default();
        for e in case["activeZones"].as_object().unwrap().values() {
            zones.insert(Entry::from_legacy(e).unwrap());
        }
        let yes = case["record"]["category"] == "alert"
            && warnings::inside(&obj(&case["record"]), now)
            && warnings::active(&group, &group.zones, &zones, now);
        assert_eq!(
            yes,
            case["result"].as_bool().unwrap(),
            "window {}",
            case["record"]
        );
    }
    let info = obj(&serde_json::json!({"cityIndex":0,"fcmToken":"synthetic-warning-token"}));
    let msg = server2::push::deliver::text::Message {
        title: Val::Str("Heavy rain advisory".into()),
        text: Val::Str("Synthetic zone".into()),
    };
    let got: serde_json::Value =
        serde_json::from_slice(&warnings::payload(&msg, &info, "synthetic-event", now)).unwrap();
    assert_eq!(got, data["payload"]);
}

use super::common::{Answer, DEFAULT_TOKEN, Rig, fcm, rig, temp_dir};
use server2::{
    gateway::BoxFuture,
    push::{
        Coll, PushService, Record,
        deliver::warnings::{CurrentZones, Locations, WarningWorker},
    },
    storage::Error,
    warnings::zones::{ZoneState, prepare_events},
    world::js::{Obj, Val},
};
use std::sync::Mutex;
#[derive(Default)]
struct Zones(Mutex<Vec<serde_json::Value>>);
impl CurrentZones for Zones {
    fn current(&self, _now: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            let mut state = ZoneState::default();
            state.apply(&prepare_events(&self.0.lock().unwrap()));
            Ok(state)
        })
    }
}
struct FixedLocations;
impl Locations for FixedLocations {
    fn zones<'a>(
        &'a self,
        _info: &'a Obj,
        _now: i64,
    ) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        Box::pin(async { Ok(vec!["L1010100".into()]) })
    }
}
fn registration(n: u8) -> Record {
    let mut doc = Obj::new();
    for (k, v) in [
        ("fcmToken", "synthetic-warning-token"),
        ("type", "ios"),
        ("package", "todayWeather"),
        ("lang", "ko"),
        ("name", "Synthetic warning place"),
    ] {
        doc.set(k, v);
    }
    doc.set("cityIndex", f64::from(n));
    doc.set("id", 1.);
    doc.set("enable", true);
    doc.set("startTime", 0.);
    doc.set("endTime", 86399.);
    doc.set("reverseTime", false);
    let mut precip = Obj::new();
    precip.set("pushTime", Val::Date(ms("2026-10-16T01:01:00Z") as f64));
    doc.set("precipAlerts", Val::Obj(precip));
    Record { oid: [n; 12], doc }
}
fn rows() -> Vec<serde_json::Value> {
    let data = oracle();
    data["feed"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "fresh-issue")
        .unwrap()["publications"][1]
        .as_array()
        .unwrap()
        .clone()
}
fn worker(
    rig: &Rig,
    push: Arc<PushService>,
    feed: Arc<WarningFeed<MemS3>>,
    zones: Arc<dyn CurrentZones>,
    locations: Arc<dyn Locations>,
) -> Arc<WarningWorker<MemS3>> {
    let directory = temp_dir(&format!("warning-fcm-{:p}", Arc::as_ptr(&push)));
    Arc::new(WarningWorker::new(
        push,
        Arc::new(rig.s3.clone()),
        feed,
        zones,
        locations,
        Arc::new(fcm(&rig.google, &directory)),
        rig.clock.clone(),
        rig.diagnostics.clone(),
    ))
}
async fn setup(
    name: &str,
) -> (
    Rig,
    Arc<WarningFeed<MemS3>>,
    Arc<Zones>,
    Arc<WarningWorker<MemS3>>,
) {
    let rig = rig(
        name,
        "2026-10-16T01:02:00Z",
        &[
            (Coll::Alert, registration(1)),
            (Coll::Alert, registration(2)),
        ],
        None,
    )
    .await;
    let feed = Arc::new(WarningFeed::new(
        Arc::new(rig.s3.clone()),
        rig.clock.clone(),
    ));
    feed.publish(&[]).await.unwrap();
    let zones = Arc::new(Zones::default());
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
    );
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    (rig, feed, zones, w)
}
async fn publish(feed: &WarningFeed<MemS3>, zones: &Zones, rows: Vec<serde_json::Value>) {
    *zones.0.lock().unwrap() = rows.clone();
    feed.publish(&rows).await.unwrap();
}
#[tokio::test]
async fn concurrent_workers_claim_one_endpoint_and_restart_never_resumes() {
    let (rig, feed, zones, w) = setup("warning-concurrency").await;
    let w2 = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
    );
    w2.poll().await.unwrap();
    publish(&feed, &zones, rows()).await;
    let (a, b) = tokio::join!(w.poll(), w2.poll());
    assert_eq!(a.unwrap().accepted + b.unwrap().accepted, 1);
    assert_eq!(
        rig.google.sends().len(),
        1,
        "two registrations of same endpoint deduplicate"
    );
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert_eq!(w2.poll().await.unwrap().attempted, 0);
    let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
    let replacement = worker(
        &rig,
        restored,
        feed.clone(),
        zones,
        Arc::new(FixedLocations),
    );
    assert_eq!(replacement.poll().await.unwrap().attempted, 0);
    assert_eq!(replacement.poll().await.unwrap().attempted, 0);
    assert_eq!(rig.google.sends().len(), 1);
    let diagnostic = format!("{:?}", rig.diagnostics.events.lock().unwrap());
    for secret in ["synthetic-warning-token", "Synthetic warning place"] {
        assert!(!diagnostic.contains(secret));
    }
    for key in rig.s3.keys("index/v2/push/delivery/warning/") {
        let body = String::from_utf8(rig.s3.body(&key).unwrap()).unwrap();
        assert!(!body.contains("synthetic-warning-token"));
        assert!(!body.contains("Synthetic warning place"));
    }
}
#[tokio::test]
async fn failed_or_unknown_warning_submission_is_not_retried() {
    for (name, answer) in [
        (
            "warning-rejected",
            Answer::Json(
                503,
                r#"{"error":{"code":503,"status":"UNAVAILABLE"}}"#.into(),
            ),
        ),
        ("warning-unknown", Answer::Reset),
    ] {
        let (rig, feed, zones, w) = setup(name).await;
        rig.google.state.fcm.lock().unwrap().push_back(answer);
        publish(&feed, &zones, rows()).await;
        assert_eq!(w.poll().await.unwrap().accepted, 0);
        assert_eq!(rig.google.sends().len(), 1);
        assert_eq!(w.poll().await.unwrap().attempted, 0);
        assert_eq!(rig.google.sends().len(), 1);
        let mut next = rows();
        next[0]["tmSeq"] = serde_json::json!(2);
        publish(&feed, &zones, next).await;
        assert_eq!(
            w.poll().await.unwrap().accepted,
            1,
            "a distinct later warning may submit"
        );
        assert_eq!(rig.google.sends().len(), 2);
    }
}
#[tokio::test]
async fn unknown_committed_claim_never_authorizes_an_attempt() {
    let (rig, feed, zones, w) = setup("warning-claim-unknown").await;
    publish(&feed, &zones, rows()).await;
    rig.s3.fault_put(
        "index/v2/push/delivery/warning/",
        Fault::CommitLostUnreadable,
    );
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert!(rig.google.sends().is_empty());
    assert_eq!(rig.s3.keys("index/v2/push/delivery/warning/").len(), 1);
}
#[tokio::test]
async fn cancellation_during_submission_does_not_release_the_claim() {
    let (rig, feed, zones, w) = setup("warning-cancel").await;
    let w2 = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        Arc::new(FixedLocations),
    );
    w2.poll().await.unwrap();
    rig.google.state.fcm.lock().unwrap().push_back(Answer::Hang);
    publish(&feed, &zones, rows()).await;
    let pending = tokio::spawn(async move { w.poll().await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while rig.google.sends().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    pending.abort();
    assert!(pending.await.unwrap_err().is_cancelled());
    assert_eq!(w2.poll().await.unwrap().attempted, 0);
    assert_eq!(rig.google.sends().len(), 1);
}
#[tokio::test]
async fn released_or_expired_warning_does_not_submit() {
    for name in ["released", "expired"] {
        let (rig, feed, zones, w) = setup(name).await;
        let mut items = rows();
        if name == "expired" {
            items[0]["endTime"] = serde_json::json!(202610161002_i64)
        }
        publish(&feed, &zones, items.clone()).await;
        if name == "released" {
            let mut release = items[0].clone();
            release["command"] = serde_json::json!("2");
            release["tmSeq"] = serde_json::json!(2);
            items.push(release);
            publish(&feed, &zones, items).await;
        }
        assert_eq!(w.poll().await.unwrap().attempted, 0);
        assert!(rig.google.sends().is_empty());
    }
}
#[tokio::test]
async fn refused_head_preserves_prior_visible_feed() {
    let s3 = MemS3::new();
    let feed = WarningFeed::new(Arc::new(s3.clone()), FixedClock::at("2026-10-16T01:02:00Z"));
    feed.publish(&[]).await.unwrap();
    feed.publish(&rows()).await.unwrap();
    let before = feed.read().await.unwrap();
    let mut changed = rows();
    changed[0]["tmSeq"] = serde_json::json!(2);
    s3.fault_put("index/v2/push/warning-feed/head.json", Fault::Reject(503));
    assert!(feed.publish(&changed).await.is_err());
    assert_eq!(feed.read().await.unwrap(), before);
    feed.publish(&changed).await.unwrap();
    assert_eq!(feed.read().await.unwrap().len(), 2);
}

#[tokio::test]
async fn concurrent_feed_publishers_keep_both_successful_event_chains() {
    let s3 = Arc::new(MemS3::new());
    let clock = FixedClock::at("2026-10-16T01:02:00Z");
    let a = WarningFeed::new(s3.clone(), clock.clone());
    a.publish(&[]).await.unwrap();
    let b = WarningFeed::new(s3, clock);
    let first = rows();
    let mut second = rows();
    second[0]["areaCode"] = serde_json::json!("L1010200");
    let (x, y) = tokio::join!(a.publish(&first), b.publish(&second));
    x.unwrap();
    y.unwrap();
    let items = a.read().await.unwrap();
    assert_eq!(items.len(), 2);
    let ids = items
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), 2);
}
#[tokio::test]
async fn durable_silent_baseline_survives_an_unknown_publication_and_memory_loss() {
    let s3 = Arc::new(MemS3::new());
    let clock = FixedClock::at("2026-10-16T01:02:00Z");
    let a = WarningFeed::new(s3.clone(), clock.clone());
    s3.fault_put(
        "index/v2/push/warning-feed/head.json",
        Fault::CommitLostUnreadable,
    );
    assert!(a.publish(&rows()).await.is_err());
    let restored = WarningFeed::new(s3, clock);
    restored.publish(&rows()).await.unwrap();
    assert!(
        restored.read().await.unwrap().is_empty(),
        "acknowledged baseline never broadcasts after lost response"
    );
    let mut next = rows();
    next[0]["tmSeq"] = serde_json::json!(2);
    restored.publish(&next).await.unwrap();
    assert_eq!(restored.read().await.unwrap().len(), 1);
}
async fn save(push: &PushService, mut record: Record) {
    record.doc.set("category", "alert");
    let mut location = Obj::new();
    location.set("lat", 37.);
    location.set("long", 127.);
    record.doc.set("location", Val::Obj(location));
    let body = Val::Arr(vec![Val::Obj(record.doc)]).to_json();
    let req = axum::extract::Request::builder()
        .method("POST")
        .uri("/v000902/push-list")
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(axum::body::Body::from(body))
        .unwrap();
    let reply = push.handle(req).await.unwrap();
    assert_eq!(reply.status(), 200);
    let body = super::state_common::body(reply).await;
    let results: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        results.as_array().unwrap().iter().all(|r| !r.is_null()),
        "registration acknowledged"
    );
}
#[tokio::test]
async fn a_fresh_open_warning_admits_a_new_endpoint_without_resending_old_ones() {
    let (rig, feed, zones, w) = setup("warning-new-endpoint").await;
    publish(&feed, &zones, rows()).await;
    assert_eq!(w.poll().await.unwrap().accepted, 1);
    let mut new = registration(3);
    new.doc.set("fcmToken", "synthetic-second-warning-token");
    save(&rig.push, new).await;
    assert_eq!(w.poll().await.unwrap().accepted, 1);
    assert_eq!(rig.google.sends().len(), 2);
    assert_eq!(w.poll().await.unwrap().attempted, 0);
}
struct ChangingLocation {
    push: Arc<PushService>,
    changed: std::sync::atomic::AtomicBool,
}
impl Locations for ChangingLocation {
    fn zones<'a>(
        &'a self,
        _info: &'a Obj,
        _now: i64,
    ) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        Box::pin(async move {
            if !self.changed.swap(true, std::sync::atomic::Ordering::SeqCst) {
                let mut edited = registration(1);
                edited.doc.set("enable", false);
                edited.doc.set("name", "changed-by-user");
                save(&self.push, edited).await;
            }
            Ok(vec!["L1010100".into()])
        })
    }
}
#[tokio::test]
async fn a_user_edit_during_region_resolution_is_not_overwritten_or_sent() {
    let rig = rig(
        "warning-user-edit",
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
    let zones = Arc::new(Zones::default());
    let location = Arc::new(ChangingLocation {
        push: rig.push.clone(),
        changed: std::sync::atomic::AtomicBool::new(false),
    });
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        location,
    );
    w.poll().await.unwrap();
    publish(&feed, &zones, rows()).await;
    assert_eq!(w.poll().await.unwrap().attempted, 0);
    assert!(rig.google.sends().is_empty());
    let state = rig.push.state();
    let state = state.read().unwrap();
    let doc = state.coll(Coll::Alert).iter().next().unwrap().1.doc;
    assert_eq!(doc.get("enable"), &Val::Bool(false));
    assert_eq!(doc.get("name"), &Val::Str("changed-by-user".into()));
}
struct CountingLocations(std::sync::atomic::AtomicUsize);
impl Locations for CountingLocations {
    fn zones<'a>(&'a self, _: &'a Obj, _: i64) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        Box::pin(async move {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(vec!["L1010100".into()])
        })
    }
}
#[tokio::test]
async fn registrations_sharing_a_location_resolve_once_for_the_open_warning() {
    let (rig, feed, zones, _) = setup("warning-shared-region").await;
    let locations = Arc::new(CountingLocations(std::sync::atomic::AtomicUsize::new(0)));
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        zones.clone(),
        locations.clone(),
    );
    w.poll().await.unwrap();
    publish(&feed, &zones, rows()).await;
    assert_eq!(w.poll().await.unwrap().accepted, 1);
    assert_eq!(
        locations.0.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "legacy registry resolves the shared location once"
    );
    w.poll().await.unwrap();
    assert_eq!(
        locations.0.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "open-campaign polls reuse the ephemeral region result"
    );
}

struct RacingStore {
    inner: MemS3,
    reads: std::sync::atomic::AtomicUsize,
    conflicts: std::sync::atomic::AtomicUsize,
    barrier: tokio::sync::Barrier,
}
impl server2::storage::ObjectTransport for RacingStore {
    async fn put(&self, r: &server2::storage::PreparedRecord) -> Result<u16, Error> {
        server2::storage::ObjectTransport::put(&self.inner, r).await
    }
    async fn head(&self, k: &str) -> Result<server2::storage::Object, Error> {
        server2::storage::ObjectTransport::head(&self.inner, k).await
    }
    async fn get(&self, k: &str, m: usize) -> Result<server2::storage::Object, Error> {
        server2::storage::ObjectTransport::get(&self.inner, k, m).await
    }
}
impl server2::storage::CatalogTransport for RacingStore {
    async fn get_control(
        &self,
        k: &str,
        m: usize,
    ) -> Result<server2::storage::ControlObject, Error> {
        let result = server2::storage::CatalogTransport::get_control(&self.inner, k, m).await;
        if k == "index/v2/push/warning-feed/head.json"
            && self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 2
        {
            self.barrier.wait().await;
        }
        result
    }
    async fn put_control(
        &self,
        k: &str,
        b: &[u8],
        c: &server2::storage::WriteCondition,
    ) -> Result<u16, Error> {
        let result = server2::storage::CatalogTransport::put_control(&self.inner, k, b, c).await;
        if matches!(result, Ok(409 | 412)) {
            self.conflicts
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        result
    }
    async fn list_raw_document(
        &self,
        p: &str,
        t: Option<&str>,
        n: usize,
        m: usize,
    ) -> Result<Vec<u8>, Error> {
        server2::storage::CatalogTransport::list_raw_document(&self.inner, p, t, n, m).await
    }
}
#[tokio::test]
async fn forced_feed_head_cas_conflict_preserves_both_events_without_duplicates() {
    let inner = MemS3::new();
    let clock = FixedClock::at("2026-10-16T01:02:00Z");
    WarningFeed::new(Arc::new(inner.clone()), clock.clone())
        .publish(&[])
        .await
        .unwrap();
    let shared = Arc::new(RacingStore {
        inner,
        reads: std::sync::atomic::AtomicUsize::new(0),
        conflicts: std::sync::atomic::AtomicUsize::new(0),
        barrier: tokio::sync::Barrier::new(2),
    });
    let a = WarningFeed::new(shared.clone(), clock.clone());
    let b = WarningFeed::new(shared.clone(), clock);
    let first = rows();
    let mut second = rows();
    second[0]["areaCode"] = serde_json::json!("L1010200");
    let (x, y) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(a.publish(&first), b.publish(&second))
    })
    .await
    .unwrap();
    x.unwrap();
    y.unwrap();
    assert!(
        shared.conflicts.load(std::sync::atomic::Ordering::SeqCst) > 0,
        "force both publishers to write from the same prior ETag"
    );
    assert_eq!(a.read().await.unwrap().len(), 2);
    a.publish(&first).await.unwrap();
    b.publish(&second).await.unwrap();
    assert_eq!(b.read().await.unwrap().len(), 2);
}

#[tokio::test]
async fn auth_preparation_changes_never_reach_fcm_and_claims_remain_terminal() {
    for case in [
        "other-process-disable",
        "release",
        "deadline",
        "journal-unavailable",
    ] {
        let (rig, feed, zones, w) = setup(&format!("warning-auth-{case}")).await;
        publish(&feed, &zones, rows()).await;
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
                DEFAULT_TOKEN.into(),
            ));
        let running = tokio::spawn({
            let w = w.clone();
            async move { w.poll().await }
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
            .await
            .unwrap();
        match case {
            "other-process-disable" => {
                let other = start(&rig.s3, rig.clock.clone(), fast_config()).await;
                assert!(
                    other
                        .internal(server2::push::service::InternalOp::DisableAlertsByFcm {
                            token: "synthetic-warning-token".into()
                        })
                        .await
                );
                assert_eq!(
                    rig.push
                        .state()
                        .read()
                        .unwrap()
                        .coll(Coll::Alert)
                        .iter()
                        .next()
                        .unwrap()
                        .1
                        .doc
                        .get("enable"),
                    &Val::Bool(true),
                    "the first service's RAM is deliberately stale"
                );
            }
            "release" => {
                let mut released = rows();
                released[0]["command"] = serde_json::json!("2");
                released[0]["tmSeq"] = serde_json::json!(2);
                zones.0.lock().unwrap().extend(released);
            }
            "deadline" => rig.clock.set("2026-10-16T01:07:00Z"),
            _ => rig.s3.fault_gets("index/v2/push/state/journal/", 1),
        }
        release.notify_one();
        let report = tokio::time::timeout(std::time::Duration::from_secs(5), running)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(report.accepted, 0, "{case}");
        assert!(
            rig.google.sends().is_empty(),
            "{case}: recheck after OAuth, before POST"
        );
        assert_eq!(
            w.poll().await.unwrap().attempted,
            0,
            "{case}: claimed delivery never retries"
        );
        assert_eq!(rig.google.tokens().len(), 1);
    }
}

#[tokio::test]
async fn auth_preparation_success_uses_the_final_submission_time_for_apns_expiration() {
    let (rig, feed, zones, w) = setup("warning-final-expiry").await;
    publish(&feed, &zones, rows()).await;
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
            DEFAULT_TOKEN.into(),
        ));
    let running = tokio::spawn({
        let w = w.clone();
        async move { w.poll().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), started.notified())
        .await
        .unwrap();
    rig.clock.set("2026-10-16T01:02:10Z");
    release.notify_one();
    assert_eq!(running.await.unwrap().unwrap().accepted, 1);
    let sent: serde_json::Value = serde_json::from_str(&rig.google.sends()[0].body).unwrap();
    assert_eq!(
        sent["message"]["apns"]["headers"]["apns-expiration"],
        (ms("2026-10-16T01:07:10Z") / 1000).to_string()
    );
}

async fn publish_s12(
    store: &server2::warnings::WarningStore<server2::storage::HttpS3Transport>,
    rows: Vec<serde_json::Value>,
    fetched: u64,
) {
    use server2::warnings::{
        provider::{Operation, Page},
        records::{ZONE_KIND, members_from_pages},
    };
    let body=serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":rows}}}})).unwrap();
    let page = Page {
        operation: Operation::PwnCd,
        body: body.into(),
        fetched_at_ms: fetched,
        items: rows,
    };
    store
        .publish(
            ZONE_KIND,
            20261016,
            members_from_pages(&[page]),
            tokio::time::Instant::now() + std::time::Duration::from_secs(9),
        )
        .await
        .unwrap();
}
#[tokio::test]
async fn auth_preparation_observes_release_published_by_a_different_s12_store() {
    let (rig, feed, _fake, _) = setup("warning-durable-release").await;
    let peer = super::warning_common::Peer::new();
    let reader = peer.store();
    let other = peer.store();
    let initial = rows();
    publish_s12(&other, initial.clone(), ms("2026-10-16T01:02:00Z") as u64).await;
    let w = worker(
        &rig,
        rig.push.clone(),
        feed.clone(),
        reader,
        Arc::new(FixedLocations),
    );
    w.poll().await.unwrap();
    feed.publish(&initial).await.unwrap();
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
            DEFAULT_TOKEN.into(),
        ));
    let running = tokio::spawn({
        let w = w.clone();
        async move { w.poll().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(9), started.notified())
        .await
        .unwrap();
    let mut released = initial;
    released[0]["command"] = serde_json::json!("2");
    released[0]["tmSeq"] = serde_json::json!(2);
    publish_s12(&other, released, ms("2026-10-16T01:02:01Z") as u64).await;
    release.notify_one();
    assert_eq!(running.await.unwrap().unwrap().accepted, 0);
    assert!(
        rig.google.sends().is_empty(),
        "fresh S3 state, not the worker's campaign snapshot"
    );
    assert_eq!(
        w.poll().await.unwrap().attempted,
        0,
        "release never releases the claim"
    );
}

struct GuardUnavailable {
    rows: Vec<serde_json::Value>,
    calls: std::sync::atomic::AtomicUsize,
    hang: bool,
}
impl CurrentZones for GuardUnavailable {
    fn current(&self, _: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            let call = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if call >= 2 {
                if self.hang && call == 2 {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
                return Err(Error::Transport);
            }
            let mut z = ZoneState::default();
            z.apply(&prepare_events(&self.rows));
            Ok(z)
        })
    }
}
#[tokio::test]
async fn final_guard_error_or_timeout_never_posts_or_retries() {
    for hang in [false, true] {
        let (rig, feed, _, _) = setup(&format!("warning-guard-unavailable-{hang}")).await;
        let zones = Arc::new(GuardUnavailable {
            rows: rows(),
            calls: std::sync::atomic::AtomicUsize::new(0),
            hang,
        });
        let w = worker(
            &rig,
            rig.push.clone(),
            feed.clone(),
            zones,
            Arc::new(FixedLocations),
        );
        w.poll().await.unwrap();
        feed.publish(&rows()).await.unwrap();
        let report = tokio::time::timeout(std::time::Duration::from_secs(6), w.poll())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(report.accepted, 0);
        assert_eq!(report.failed, 1);
        assert_eq!(rig.google.tokens().len(), 1);
        assert!(rig.google.sends().is_empty());
        assert_eq!(w.poll().await.unwrap().attempted, 0);
    }
}

struct PostClaimUnavailable(std::sync::atomic::AtomicUsize, bool);
impl CurrentZones for PostClaimUnavailable {
    fn current(&self, _: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(async move {
            if self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
                return Err(if self.1 {
                    Error::Timeout
                } else {
                    Error::Transport
                });
            }
            let mut z = ZoneState::default();
            z.apply(&prepare_events(&rows()));
            Ok(z)
        })
    }
}
#[tokio::test]
async fn an_s12_error_immediately_after_claim_records_a_terminal_failure_without_submission() {
    for timeout in [false, true] {
        let (rig, feed, _, _) = setup("warning-postclaim-error").await;
        let zones = Arc::new(PostClaimUnavailable(
            std::sync::atomic::AtomicUsize::new(0),
            timeout,
        ));
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
        assert_eq!(first.failed, 1);
        assert!(rig.google.sends().is_empty());
        assert!(rig.google.tokens().is_empty());
        let results = rig
            .s3
            .keys("index/v2/push/delivery/warning/")
            .into_iter()
            .filter(|k| k.ends_with("result.json"))
            .collect::<Vec<_>>();
        assert_eq!(
            results.len(),
            1,
            "GROK-HIGH-1: failure after owned claim is observable"
        );
        let result: serde_json::Value =
            serde_json::from_slice(&rig.s3.body(&results[0]).unwrap()).unwrap();
        assert_eq!(result["class"], "warning-state");
        assert_eq!(w.poll().await.unwrap().attempted, 0);
        assert!(rig.google.sends().is_empty());
        let restored = start(&rig.s3, rig.clock.clone(), fast_config()).await;
        let replacement = worker(&rig, restored, feed, zones, Arc::new(FixedLocations));
        assert_eq!(replacement.poll().await.unwrap().attempted, 0);
        assert!(rig.google.sends().is_empty());
    }
}
