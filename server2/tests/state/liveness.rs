//! Public availability after the owning writer actually exits; no delivery worker runs.
use super::common::*;
use axum::{body::Body, extract::Request};
use server2::push::{OidSource, PushService, routes::STORAGE_FAILURE, store::Oid};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

pub(super) struct PanicIds(pub(super) Arc<AtomicBool>);
impl OidSource for PanicIds {
    fn next(&mut self, _: f64) -> Oid {
        self.0.store(true, Ordering::Release);
        panic!("owned writer panic for availability regression");
    }
}

#[tokio::test]
async fn joined_writer_is_no_longer_ready() {
    let s3 = MemS3::new();
    let service = start(
        &s3,
        FixedClock::at("2026-10-15T03:00:00.000Z"),
        fast_config(),
    )
    .await;
    assert!(service.ready());
    // A true drain is a confirmed normal join, not merely an abort request.
    let joined = service.drain(Instant::now() + Duration::from_secs(2)).await;
    assert!(joined);
    assert!(!service.ready(), "joined writer must not remain ready");
}

#[tokio::test]
async fn panicked_writer_is_no_longer_ready_and_never_acknowledges_the_mutation() {
    let s3 = MemS3::new();
    let panicked = Arc::new(AtomicBool::new(false));
    let service = PushService::start(
        Arc::new(s3.clone()),
        FixedClock::at("2026-10-15T03:00:00.000Z"),
        Box::new(PanicIds(panicked.clone())),
        fast_config(),
    );
    for _ in 0..200 {
        if service.ready() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(service.ready(), "restore setup must succeed before fault");
    let payload = serde_json::to_vec(&serde_json::json!([{
        "type":"android", "fcmToken":"synthetic-writer-panic", "cityIndex":0,
        "id":0, "location":{"lat":37.5,"long":127.1}, "source":"KMA"
    }]))
    .unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("/v000902/push-list")
        .header("content-type", "application/json")
        .header("content-length", payload.len())
        .body(Body::from(payload))
        .unwrap();
    let response = service.handle(request).await.unwrap();
    let status = response.status().as_u16();
    let body = String::from_utf8(super::common::body(response).await).unwrap();
    let ready_after_panic = service.ready();
    // List storage failures keep legacy per-item nulls; token update has the 500 contract.
    let update = serde_json::to_vec(&serde_json::json!({
        "newToken":"synthetic-writer-new", "oldToken":"synthetic-writer-panic"
    }))
    .unwrap();
    let response = service
        .handle(
            Request::builder()
                .method("PUT")
                .uri("/v000902/push")
                .header("content-type", "application/json")
                .header("content-length", update.len())
                .body(Body::from(update))
                .unwrap(),
        )
        .await
        .unwrap();
    let update_status = response.status().as_u16();
    let update_body = String::from_utf8(super::common::body(response).await).unwrap();
    // Reap the faulted task before asserting the regression. False is a failed drain,
    // not a healthy join or a claim that a timeout/abort request completed.
    let drained = service.drain(Instant::now() + Duration::from_secs(2)).await;
    assert!(panicked.load(Ordering::Acquire), "fault was not exercised");
    assert!(!drained, "panicked writer cannot report a healthy drain");
    assert_eq!((status, body.as_str()), (200, "[null]"));
    assert_eq!(
        (update_status, update_body.as_str()),
        (500, STORAGE_FAILURE)
    );
    assert!(s3.keys("index/v2/push/state/journal/").is_empty());
    assert_eq!(service.state().read().unwrap().seq, 0);
    assert!(!ready_after_panic, "panicked writer must not remain ready");
    assert!(!service.ready());
}
