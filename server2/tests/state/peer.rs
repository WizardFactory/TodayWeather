//! The push state over the real S3 HTTP transport against the owned loopback S3 peer:
//! conditional journal writes, a commit whose answer is a 500, a dropped connection after the
//! commit, an injected 409 conflict, and an empty-memory restore.
use super::common::*;
use axum::{body::Body as HttpBody, extract::Request};
use rusty_s3::Credentials;
use server2::{
    push::{Coll, PushService, durable::journal_key},
    storage::HttpS3Transport,
};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};

struct Peer {
    child: Child,
    endpoint: String,
}
impl Peer {
    fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(
            line.starts_with("http://127.0.0.1:"),
            "peer startup: {line}"
        );
        Self {
            child,
            endpoint: line.trim().to_owned(),
        }
    }
    fn transport(&self) -> Arc<HttpS3Transport> {
        Arc::new(
            HttpS3Transport::new(
                &self.endpoint,
                "server2-local",
                "ap-northeast-2",
                Credentials::new("server2-local", "server2-local-secret"),
            )
            .unwrap(),
        )
    }
    async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.endpoint).parse().unwrap();
        url.query_pairs_mut()
            .append_pair("mode", mode)
            .append_pair("key", key);
        let r = reqwest::Client::new()
            .post(url)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status().as_u16(), 204, "fault {mode} {key}");
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

async fn started(peer: &Peer) -> Arc<PushService> {
    let config = fast_config();
    let service = PushService::start(
        peer.transport(),
        FixedClock::at("2026-10-15T03:00:00.000Z"),
        Box::new(OracleIds(0)),
        config,
    );
    for _ in 0..400 {
        if service.ready() {
            return service;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("restore over the peer");
}

async fn post(service: &PushService, token: &str, city: u32) -> (u16, String) {
    let body = serde_json::to_vec(&serde_json::json!([{"type": "android", "fcmToken": token,
        "cityIndex": city, "id": city, "location": {"lat": 37.5, "long": 127.1}, "source": "KMA"}]))
    .unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("/v000902/push-list")
        .header("content-type", "application/json")
        .header("content-length", body.len())
        .body(HttpBody::from(body))
        .unwrap();
    let response = service.handle(request).await.unwrap();
    let status = response.status().as_u16();
    (
        status,
        String::from_utf8(super::common::body(response).await).unwrap(),
    )
}

#[tokio::test]
async fn journal_over_the_s3_transport_reconciles_and_restores() {
    let peer = Peer::new();
    let service = started(&peer).await;
    assert_eq!(post(&service, "p1", 0).await.0, 200);
    // The commit succeeds but S3 answers 500: read back, it is ours, so it is acknowledged.
    peer.fault("commit500", &journal_key(2)).await;
    let (status, body) = post(&service, "p2", 1).await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("upserted"));
    // The connection drops after the commit: the same reconciliation.
    peer.fault("drop-commit", &journal_key(3)).await;
    assert_eq!(post(&service, "p3", 2).await.0, 200);
    // An injected 409 is a conflict: catch up (nothing new) and commit again.
    peer.fault("conflict409", &journal_key(4)).await;
    assert_eq!(post(&service, "p4", 3).await.0, 200);
    let restored = started(&peer).await;
    let state = restored.state();
    let state = state.read().unwrap();
    assert_eq!(state.seq, 4);
    let tokens: Vec<String> = state
        .coll(Coll::Alarm)
        .iter()
        .map(Result::unwrap)
        .map(|(_, r)| r.token("fcmToken").unwrap().to_owned())
        .collect();
    assert_eq!(tokens, ["p1", "p2", "p3", "p4"]);
}
