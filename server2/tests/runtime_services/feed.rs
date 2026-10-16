#[tokio::test]
async fn construction_exposes_shared_durable_feed_without_precollection() {
    let peer = super::common::Peer::new();
    let s = peer.services("push");
    super::common::ready(&s).await;
    assert!(s.warning_store.is_some());
    assert!(s.warning_feed.is_some());
    assert_eq!(s.s3.as_ref().unwrap().limit(), 12);
    // Constructor alone must not publish warnings or initialize a delivery ledger.
    let counts: serde_json::Value = serde_json::from_slice(
        &reqwest::get(format!("{}__catalog/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        counts
            .as_object()
            .unwrap()
            .keys()
            .all(|k| !k.contains("warning-feed")
                && !k.contains("warnings")
                && !k.contains("delivery"))
    );
}

#[tokio::test]
async fn production_request_acquirer_publishes_to_shared_feed_after_storage_and_recovers() {
    use server2::{domestic::kma::source::fetch::ForecastRequest, storage::CatalogTransport};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let peer = super::common::Peer::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let changed = Arc::new(AtomicBool::new(false));
    let c = changed.clone();
    let app=axum::Router::new().fallback(move|uri:axum::http::Uri| {let c=c.clone();async move {
  let rows=if uri.path().ends_with("getPwnCd") {serde_json::json!([{"areaCode":"L1082700","areaName":"Synthetic","cancel":"0","command":"1","stnId":"108","tmFc":202610162100_i64,"tmSeq":if c.load(Ordering::SeqCst){2}else{1},"warnVar":1,"warnStress":0,"startTime":202610162100_i64,"endTime":0,"allEndTime":0}])}else{serde_json::json!([])};
  axum::Json(serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":rows},"totalCount":rows.as_array().unwrap().len(),"pageNo":1,"numOfRows":10000}}}))
 }});
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut builtins = peer.builtins();
    builtins.data_go_kr = format!("http://{addr}/");
    let s = server2::runtime_services::RuntimeServices::from_vars_at(&peer.vars("push"), &builtins)
        .unwrap();
    super::common::ready(&s).await;
    let feed = s.warning_feed.as_ref().unwrap();
    assert!(feed.read().await.unwrap().is_empty());
    let acquire = s.warning_acquire.as_ref().unwrap();
    acquire.acquire(ForecastRequest::Warnings).await.unwrap();
    assert!(
        feed.read().await.unwrap().is_empty(),
        "initial feed baseline is silent"
    );
    changed.store(true, Ordering::SeqCst);
    peer.fault("reject", "index/v2/push/warning-feed/head.json")
        .await;
    assert!(acquire.acquire(ForecastRequest::Warnings).await.is_err());
    assert!(
        feed.read().await.unwrap().is_empty(),
        "orphan event cannot be read before head"
    );
    peer.fault("clear", "index/v2/push/warning-feed/head.json")
        .await;
    acquire.acquire(ForecastRequest::Warnings).await.unwrap();
    let items = feed.read().await.unwrap();
    assert_eq!(items.len(), 1);
    let restarted = peer.services("push");
    assert_eq!(
        restarted
            .warning_feed
            .as_ref()
            .unwrap()
            .read()
            .await
            .unwrap(),
        items
    );
    let counts: serde_json::Value = serde_json::from_slice(
        &reqwest::get(format!("{}__catalog/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        counts
            .as_object()
            .unwrap()
            .keys()
            .any(|k| k.starts_with("PUT raw/") && k.contains("pwn-cd")),
        "durable source records precede feed"
    );
    assert!(
        s.s3.as_ref()
            .unwrap()
            .get_control("index/v2/push/warning-feed/head.json", 1 << 20)
            .await
            .is_ok()
    );
    task.abort();
}
