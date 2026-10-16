use super::common::*;
use server2::{notice::store::Mutation, runtime_services::RuntimeServices};
#[tokio::test]
async fn selected_native_services_do_not_require_legacy_url() {
    let peer = Peer::new();
    let s = peer.services("notice");
    assert!(s.gateway.is_some());
    assert!(s.notices.is_some());
    assert!(s.push.is_none());
    let h = Http::new(s).await;
    let c = reqwest::Client::new();
    let r = c
        .get(format!("{}/v000903/notice/latest", h.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["cache-control"], "public, max-age=300");
    assert_eq!(r.headers()["vary"], "Accept-Language");
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    assert_eq!(r.text().await.unwrap(), r#"{"notice":null}"#);
    assert_eq!(
        c.post(format!("{}/v000903/notice/latest", h.base))
            .send()
            .await
            .unwrap()
            .status(),
        405
    );
    assert_eq!(
        c.get(format!("{}/health", h.base))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "OK"
    );
}
#[test]
fn native_only_lifetime_outlives_nine_second_deadline() {
    let var = |n: &str| (n == "SERVER2_NATIVE_FAMILIES").then(|| "notice".to_owned());
    assert_eq!(
        server2::Config::from_vars(&var).unwrap().connection_seconds,
        12
    );
    assert_eq!(
        server2::Config::from_vars(&|_| None)
            .unwrap()
            .connection_seconds,
        server2::Config::default().connection_seconds
    );
    assert!(
        server2::Config::from_vars(&|n| (n == "SERVER2_NATIVE_FAMILIES").then(|| "bad".into()))
            .is_err()
    );
}
#[tokio::test]
async fn notice_latest_language_head_and_cold_storage_errors() {
    let peer = Peer::new();
    let s = peer.services("notice");
    let store = s.notices.clone().unwrap();
    let id=store.apply(&"a".repeat(64),Mutation::Add(serde_json::json!({"texts":{"en":{"title":"English","body":"Body"},"ko":{"title":"Korean","body":"Body"}},"startsAt":"2020-01-01T00:00:00Z"})),0).await.unwrap();
    let h = Http::new(s).await;
    let c = reqwest::Client::new();
    let r = c
        .get(format!("{}/v000903/notice/latest?lang=ko", h.base))
        .header("accept-language", "en")
        .send()
        .await
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&r.bytes().await.unwrap()).unwrap();
    assert_eq!(v["notice"]["id"], id);
    assert_eq!(v["notice"]["title"], "Korean");
    let r = c
        .head(format!("{}/v000903/notice/latest", h.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["vary"], "Accept-Language");
    assert!(r.bytes().await.unwrap().is_empty());
    peer.fault("corrupt", server2::notice::store::KEY).await;
    let cold = Http::new(peer.services("notice")).await;
    let r = c
        .get(format!("{}/v000903/notice/latest", cold.base))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 503);
    assert_eq!(r.headers()["cache-control"], "no-store");
}
#[tokio::test]
async fn public_registration_is_durable_and_recovers_after_reconstruction() {
    let peer = Peer::new();
    let s = peer.services("push,notice");
    ready(&s).await;
    let h = Http::new(s).await;
    let c = reqwest::Client::new();
    let r=c.post(format!("{}/v000902/push-list",h.base)).header("content-type","application/json").body(serde_json::json!([{"type":"android","fcmToken":"synthetic-token","cityIndex":0,"id":1,"location":{"lat":37.5,"long":127.1},"source":"KMA"}]).to_string()).send().await.unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    assert!(r.text().await.unwrap().contains("upserted"));
    let r = c
        .put(format!("{}/v000902/push", h.base))
        .header("content-type", "application/json")
        .body(
            serde_json::json!({"oldToken":"synthetic-token","newToken":"synthetic-new"})
                .to_string(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    drop(h);
    let restored = peer.services("push,notice");
    ready(&restored).await;
    let state = restored.push.as_ref().unwrap().state();
    assert_eq!(state.read().unwrap().seq, 2);
    assert!(
        state
            .read()
            .unwrap()
            .coll(server2::push::Coll::Alarm)
            .iter()
            .any(|(_, r)| r.token("fcmToken") == Some("synthetic-new"))
    );
    let h = Http::new(restored).await;
    let r = c
        .request(reqwest::Method::OPTIONS, format!("{}/v000902/push", h.base))
        .header("access-control-request-headers", "content-type")
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success());
    let r = c
        .put(format!("{}/v000902/push", h.base))
        .header("content-type", "application/json")
        .body("{")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    let r = c
        .put(format!("{}/v000902/push", h.base))
        .header("content-type", "application/json")
        .body(" ".repeat(102401))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 413);
}
#[tokio::test]
async fn no_selection_is_foundation_and_explicit_legacy_remains_optional() {
    assert!(
        RuntimeServices::from_vars(&|_| None)
            .unwrap()
            .gateway
            .is_none()
    );
    let legacy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = legacy.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(
            legacy,
            axum::Router::new().fallback(|| async {
                axum::Json(serde_json::json!({"country":"US","location":{"lat":10,"long":20}}))
            }),
        )
        .await
        .unwrap();
    });
    let s = RuntimeServices::from_vars(&|n| {
        (n == "SERVER2_GATEWAY_LEGACY_URL").then(|| format!("http://{addr}"))
    })
    .unwrap();
    let h = Http::new(s).await;
    assert_eq!(
        reqwest::get(format!("{}/geocode/v000903/coord/10,20", h.base))
            .await
            .unwrap()
            .status(),
        200
    );
    task.abort();
}
