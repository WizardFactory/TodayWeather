//! Acknowledgment, fault, ordering and restore behavior of the push state writer.
use super::common::*;
use axum::{body::Body as HttpBody, extract::Request};
use server2::push::{
    Coll, PushConfig,
    durable::{DurableConfig, journal_key},
    routes::STORAGE_FAILURE,
};
use std::{sync::Arc, time::Duration};

const T0: &str = "2026-10-15T01:00:00.000Z";

fn json_request(method: &str, path: &str, body: &serde_json::Value) -> Request {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("content-length", serde_json::to_vec(body).unwrap().len())
        .header("accept-language", "ko-KR")
        .body(HttpBody::from(serde_json::to_vec(body).unwrap()))
        .unwrap()
}
async fn call(
    service: &server2::push::PushService,
    method: &str,
    path: &str,
    body: serde_json::Value,
) -> (u16, String) {
    let response = service
        .handle(json_request(method, path, &body))
        .await
        .unwrap();
    let status = response.status().as_u16();
    (
        status,
        String::from_utf8(super::common::body(response).await).unwrap(),
    )
}
fn alarm(token: &str, city: u32) -> serde_json::Value {
    serde_json::json!({"type": "ios", "fcmToken": token, "cityIndex": city, "id": city + 1,
        "category": "alarm", "location": {"lat": 37.5, "long": 127.1}, "source": "KMA",
        "pushTime": 79200, "timezoneOffset": 540, "dayOfWeek": [true, true, true, true, true, true, true]})
}
fn alert(token: &str, city: u32) -> serde_json::Value {
    serde_json::json!({"type": "ios", "fcmToken": token, "cityIndex": city, "id": 0,
        "category": "alert", "location": {"lat": 37.5, "long": 127.1}, "source": "KMA",
        "startTime": 0, "endTime": 3600, "airAlertsBreakPoint": 3})
}
fn tokens(state: &server2::push::State, c: Coll) -> Vec<String> {
    state
        .coll(c)
        .iter()
        .map(|(_, r)| r.token("fcmToken").unwrap_or_default().to_owned())
        .collect()
}

#[tokio::test]
async fn success_answer_follows_the_durable_journal_entry() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    let (status, body) = call(
        &service,
        "POST",
        "/v000902/push-list",
        serde_json::json!([alarm("t1", 0)]),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("\"upserted\""));
    let entry = s3
        .body(&journal_key(1))
        .expect("journal entry 1 written before the answer");
    assert!(String::from_utf8_lossy(&entry).contains("\"fcmToken\":\"t1\""));
    // A request that changes nothing writes nothing and still answers.
    let (status, body) = call(
        &service,
        "PUT",
        "/v000902/push",
        serde_json::json!({"newToken": "x", "oldToken": "none"}),
    )
    .await;
    assert_eq!(
        (status, body.as_str()),
        (
            200,
            r#"[{"n":0,"nModified":0,"ok":1},{"n":0,"nModified":0,"ok":1}]"#
        )
    );
    assert!(s3.body(&journal_key(2)).is_none());
}

#[tokio::test]
async fn rejected_or_lost_writes_are_not_acknowledged_and_roll_back() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    call(
        &service,
        "POST",
        "/v000902/push-list",
        serde_json::json!([alarm("t1", 0), alert("t1", 0)]),
    )
    .await;
    // S3 refuses the entry (403): PUT answers the legacy store error, state is unchanged.
    s3.fault_put("index/v2/push/state/journal/", Fault::Reject(403));
    let (status, body) = call(
        &service,
        "PUT",
        "/v000902/push",
        serde_json::json!({"newToken": "t2", "oldToken": "t1"}),
    )
    .await;
    assert_eq!((status, body.as_str()), (500, STORAGE_FAILURE));
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alarm),
        ["t1"]
    );
    // The write is lost (not stored, outcome unknown): reconciled by reading it back, voided.
    s3.fault_put("index/v2/push/state/journal/", Fault::Lost);
    let (status, body) = call(
        &service,
        "DELETE",
        "/v000902/push",
        serde_json::json!({"fcmToken": "t1"}),
    )
    .await;
    assert_eq!((status, body.as_str()), (501, STORAGE_FAILURE));
    let void = String::from_utf8(s3.body(&journal_key(2)).unwrap()).unwrap();
    assert!(void.contains("\"void\":true"), "{void}");
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alert),
        ["t1"]
    );
    // push-list keeps the legacy per-item store-error result (null) with status 200.
    s3.fault_put("index/v2/push/state/journal/", Fault::Reject(403));
    let (status, body) = call(
        &service,
        "POST",
        "/v000902/push-list",
        serde_json::json!([alarm("t9", 1)]),
    )
    .await;
    assert_eq!((status, body.as_str()), (200, "[null]"));
    // The next request continues after the void entry and is acknowledged.
    let (status, _) = call(
        &service,
        "PUT",
        "/v000902/push",
        serde_json::json!({"newToken": "t2", "oldToken": "t1"}),
    )
    .await;
    assert_eq!(status, 200);
    assert!(s3.body(&journal_key(3)).is_some());
    let restored = start(&s3, FixedClock::at(T0), fast_config()).await;
    assert_eq!(
        tokens(&restored.state().read().unwrap(), Coll::Alarm),
        ["t2"]
    );
    assert_eq!(
        tokens(&restored.state().read().unwrap(), Coll::Alert),
        ["t2"]
    );
}

#[tokio::test]
async fn a_committed_write_with_a_lost_answer_is_reconciled_as_committed() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    s3.fault_put("index/v2/push/state/journal/", Fault::CommitLost);
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t1", 0)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        service
            .counters
            .reconciled_committed
            .load(std::sync::atomic::Ordering::Relaxed),
        1
    );
    let restored = start(&s3, FixedClock::at(T0), fast_config()).await;
    assert_eq!(
        tokens(&restored.state().read().unwrap(), Coll::Alarm),
        ["t1"]
    );
}

#[tokio::test]
async fn an_unsettled_write_is_voided_before_the_next_change() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    // Lost write and the read-back fails too: the sequence stays unsettled.
    s3.fault_put("index/v2/push/state/journal/", Fault::LostUnreadable);
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t1", 0)).await;
    assert_eq!((status, body.as_str()), (500, STORAGE_FAILURE));
    // The next request first settles sequence 1: absent, so it is voided; then it commits.
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t2", 0)).await;
    assert_eq!(status, 200, "{body}");
    let first = String::from_utf8(s3.body(&journal_key(1)).unwrap()).unwrap();
    assert!(first.contains("\"void\":true"), "{first}");
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alarm),
        ["t2"]
    );
}

#[tokio::test]
async fn an_unacknowledged_write_that_committed_is_kept_when_settled() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    // S3 stored the entry, the answer was lost and the read-back failed: unknown outcome.
    s3.fault_put("index/v2/push/state/journal/", Fault::CommitLostUnreadable);
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t1", 0)).await;
    assert_eq!((status, body.as_str()), (500, STORAGE_FAILURE));
    // Settling finds the entry: it is applied (durable, though never acknowledged), in order.
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t2", 0)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alarm),
        ["t1", "t2"]
    );
    let restored = start(&s3, FixedClock::at(T0), fast_config()).await;
    assert_eq!(
        tokens(&restored.state().read().unwrap(), Coll::Alarm),
        ["t1", "t2"]
    );
}

#[tokio::test]
async fn a_concurrent_writer_entry_is_caught_up_before_planning_again() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    call(
        &service,
        "POST",
        "/v000902/push-list",
        serde_json::json!([alarm("a", 0)]),
    )
    .await;
    // Another process (an importer) commits sequence 2 first.
    let other = start(&s3, FixedClock::at(T0), fast_config()).await;
    call(
        &other,
        "POST",
        "/v000902/push-list",
        serde_json::json!([alarm("b", 0)]),
    )
    .await;
    // This writer plans at sequence 2, gets 412, catches up and commits at sequence 3.
    let (status, body) = call(
        &service,
        "PUT",
        "/v000902/push",
        serde_json::json!({"newToken": "c", "oldToken": "b"}),
    )
    .await;
    assert_eq!(
        (status, body.as_str()),
        (
            200,
            r#"[{"n":1,"nModified":1,"ok":1},{"n":0,"nModified":0,"ok":1}]"#
        )
    );
    assert!(s3.body(&journal_key(3)).is_some());
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alarm),
        ["a", "c"]
    );
}

#[tokio::test]
async fn concurrent_requests_are_ordered_and_every_acknowledged_change_survives() {
    let s3 = MemS3::new();
    let service = start(&s3, FixedClock::at(T0), fast_config()).await;
    let mut tasks = Vec::new();
    for i in 0..24u32 {
        let service = service.clone();
        tasks.push(tokio::spawn(async move {
            let token = format!("tok-{}", i % 6);
            call(
                &service,
                "POST",
                "/v000902/push-list",
                serde_json::json!([alarm(&token, i), alert(&token, i)]),
            )
            .await
        }));
    }
    for t in tasks {
        assert_eq!(t.await.unwrap().0, 200);
    }
    let seq = service.state().read().unwrap().seq;
    assert_eq!(seq, 24, "one journal entry per request, contiguous");
    for s in 1..=seq {
        assert!(s3.body(&journal_key(s)).is_some());
    }
    let restored = start(&s3, FixedClock::at(T0), fast_config()).await;
    let a = service.state();
    let b = restored.state();
    let (a, b) = (a.read().unwrap(), b.read().unwrap());
    for c in [Coll::Alarm, Coll::Alert] {
        assert_eq!(records(&a, c), records(&b, c));
        assert_eq!(a.coll(c).len(), 24);
    }
}

#[tokio::test]
async fn snapshots_bound_restore_and_keep_the_journal_authoritative() {
    let s3 = MemS3::new();
    let mut config = fast_config();
    config.durable = DurableConfig {
        compact_every: 3,
        part_bytes: 600,
        ..config.durable
    };
    let service = start(&s3, FixedClock::at(T0), config.clone()).await;
    for i in 0..7u32 {
        let (status, _) = call(
            &service,
            "POST",
            "/v000902/push-list",
            serde_json::json!([alarm(&format!("s{i}"), i)]),
        )
        .await;
        assert_eq!(status, 200);
    }
    let parts = s3.keys("index/v2/push/state/snapshot/");
    assert!(parts.len() > 2, "multi-part snapshots: {parts:?}");
    assert!(s3.body("index/v2/push/state/head.json").is_some());
    let before = s3.gets.load(std::sync::atomic::Ordering::SeqCst);
    let restored = start(&s3, FixedClock::at(T0), config).await;
    let reads = s3.gets.load(std::sync::atomic::Ordering::SeqCst) - before;
    assert!(
        reads < 7 + 8 + 20,
        "restore reads the snapshot, not every entry: {reads}"
    );
    assert_eq!(
        records(&restored.state().read().unwrap(), Coll::Alarm),
        records(&service.state().read().unwrap(), Coll::Alarm)
    );
}

#[tokio::test]
async fn a_corrupt_snapshot_keeps_the_service_unready_and_answers_store_errors() {
    let s3 = MemS3::new();
    let mut config = fast_config();
    config.durable.compact_every = 1;
    let service = start(&s3, FixedClock::at(T0), config.clone()).await;
    call(&service, "POST", "/v000705/push", alarm("t1", 0)).await;
    let part = s3.keys("index/v2/push/state/snapshot/").pop().unwrap();
    s3.insert(&part, b"{\"schema\":1,\"records\":[]}");
    let broken = server2::push::PushService::start(
        Arc::new(s3.clone()),
        FixedClock::at(T0),
        Box::new(OracleIds(0)),
        config,
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!broken.ready());
    let (status, body) = call(
        &broken,
        "PUT",
        "/v000902/push",
        serde_json::json!({"newToken": "t2", "oldToken": "t1"}),
    )
    .await;
    assert_eq!((status, body.as_str()), (500, STORAGE_FAILURE));
    // Validation answers do not depend on the state.
    let (status, body) = call(&broken, "PUT", "/v000902/push", serde_json::json!({})).await;
    assert_eq!((status, body.as_str()), (403, "invalid body"));
}

#[tokio::test]
async fn a_slow_store_answers_within_the_wait_and_never_acknowledges_late() {
    let s3 = MemS3::new();
    let config = PushConfig {
        wait: Duration::from_millis(400),
        ..fast_config()
    };
    let service = start(&s3, FixedClock::at(T0), config).await;
    s3.fault_put("index/v2/push/state/journal/", Fault::Hang);
    let started = std::time::Instant::now();
    let (status, body) = call(&service, "POST", "/v000705/push", alarm("t1", 0)).await;
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!((status, body.as_str()), (500, STORAGE_FAILURE));
    // The writer reconciles the unknown write (absent -> void) and continues.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let (status, _) = call(&service, "POST", "/v000705/push", alarm("t2", 0)).await;
    assert_eq!(status, 200);
    assert_eq!(
        tokens(&service.state().read().unwrap(), Coll::Alarm),
        ["t2"]
    );
}
