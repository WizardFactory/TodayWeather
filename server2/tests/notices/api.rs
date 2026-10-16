use super::common::Memory;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use server2::notice::{
    api,
    store::{Mutation, NoticeStore},
};
use std::sync::Arc;
use tower::ServiceExt;
#[tokio::test]
async fn api_has_read_only_contract_headers_and_distinguishes_absent_from_cold_failure() {
    let m = Memory::default();
    let s = Arc::new(NoticeStore::new(m.clone()));
    let app = api::router_with_clock(s.clone(), Arc::new(|| 1000));
    let response = app
        .clone()
        .oneshot(
            Request::get("/v000903/notice/latest?lang=fr-FR")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "public, max-age=300");
    assert_eq!(response.headers()["vary"], "Accept-Language");
    assert_eq!(
        to_bytes(response.into_body(), 1024).await.unwrap(),
        "{\"notice\":null}"
    );
    let bad = Memory::default();
    bad.0.lock().unwrap().read_error = true;
    let app = api::router_with_clock(Arc::new(NoticeStore::new(bad)), Arc::new(|| 1000));
    let response = app
        .clone()
        .oneshot(
            Request::get("/v000903/notice/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let response = app
        .oneshot(
            Request::post("/v000903/notice/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 405);
}
#[tokio::test]
async fn api_reads_new_publication_and_withdrawal_without_restart() {
    let m = Memory::default();
    let s = Arc::new(NoticeStore::new(m));
    let app = api::router_with_clock(s.clone(), Arc::new(|| 1000));
    let id=s.apply(&"a".repeat(64),Mutation::Add(serde_json::json!({"texts":{"en":{"title":"Title","body":"Body"}},"startsAt":"1970-01-01T00:00:00Z"})),0).await.unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::get("/v000903/notice/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let v: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(v["notice"]["id"], id);
    s.apply(&"b".repeat(64), Mutation::Withdraw(id), 1000)
        .await
        .unwrap();
    let response = app
        .oneshot(
            Request::get("/v000903/notice/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        to_bytes(response.into_body(), 1024).await.unwrap(),
        "{\"notice\":null}"
    );
}
