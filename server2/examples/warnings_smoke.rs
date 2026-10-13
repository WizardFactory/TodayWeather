//! S12 release smoke: owned loopback S3 peer plus a loopback data.go.kr stub serving
//! recorded bodies. Seeds, funded collection, empty-memory HTTP serving, a rejected
//! publication and the weather flash boundary. No live provider or AWS access.
//!
//! Run: python3 tests/storage/catalog_peer.py --smoke target/release/examples/warnings_smoke
use server2::{
    budget::{BudgetError, BudgetPolicy, BudgetStore, Clock, Provider, SystemClock},
    providers::HttpProviderTransport,
    storage::{CatalogLimits, HttpS3Transport},
    warnings::{
        FundedSource, Operation, ServiceConfig, StoreConfig, WarningCollector, WarningService,
        WarningStore,
        records::{self, Member},
        seed, service,
    },
};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

const FIXTURES: [(&str, &str); 6] = [
    (
        "getPwnStatus",
        include_str!("../tests/warnings/fixtures/pwn-status.json"),
    ),
    (
        "getWthrWrnMsg",
        include_str!("../tests/warnings/fixtures/wrn-msg-0926.json"),
    ),
    (
        "getPwnCd",
        include_str!("../tests/warnings/fixtures/pwn-cd-0921-0927.json"),
    ),
    (
        "getWthrPwn",
        include_str!("../tests/warnings/fixtures/wthr-pwn.json"),
    ),
    (
        "getWthrInfo",
        include_str!("../tests/warnings/fixtures/wthr-info.json"),
    ),
    (
        "getWthrBrkNews",
        include_str!("../tests/warnings/fixtures/brk-news.json"),
    ),
];
const SEED: &str = r#"{"schema":1,"exportedAt":"2026-09-21T00:00:00.000Z","special":[
{"type":1,"announcement":"2026-09-20T09:10:00.000Z","situationList":[],"comment":"o 없음"},
{"type":2,"announcement":"2026-09-20T09:10:00.000Z","situationList":[],"comment":"seed"},
{"type":3,"announcement":"2026-09-20T09:10:00.000Z","situationList":[],"comment":"seed"},
{"type":4,"announcement":"2026-09-20T09:10:00.000Z","situationList":[],"comment":"seed"}],
"zones":[{"areaCode":"L1100100","areaName":"label","active":true,"warnVar":3,"warnStress":1}]}"#;

struct Fixed(AtomicI64);
impl Clock for Fixed {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
fn ms(iso: &str) -> i64 {
    server2::warnings::js::parse_iso(iso).unwrap()
}
fn transport(endpoint: &str) -> HttpS3Transport {
    HttpS3Transport::new(
        endpoint,
        "server2-local",
        "ap-northeast-2",
        rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap()
}
fn store(endpoint: &str) -> Arc<WarningStore<HttpS3Transport>> {
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    Arc::new(WarningStore::new(transport(endpoint), limits, StoreConfig::default()).unwrap())
}
async fn provider_stub() -> (String, Arc<std::sync::Mutex<usize>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let bodies: Arc<HashMap<&str, &str>> = Arc::new(FIXTURES.into_iter().collect());
    let calls = Arc::new(std::sync::Mutex::new(0));
    let seen = calls.clone();
    let app = axum::Router::new().fallback(move |uri: axum::http::Uri| {
        let bodies = bodies.clone();
        let seen = seen.clone();
        async move {
            *seen.lock().unwrap() += 1;
            let op = uri.path().rsplit('/').next().unwrap_or("").to_owned();
            let body = bodies.get(op.as_str()).copied().unwrap_or("");
            axum::response::Response::builder()
                .status(if body.is_empty() { 404 } else { 200 })
                .header("content-type", "application/json;charset=UTF-8")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
    });
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        format!("http://{address}/1360000/WthrWrnInfoService/"),
        calls,
    )
}
async fn serve(svc: Arc<WarningService<HttpS3Transport>>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, service::router(svc)).await.unwrap() });
    format!("http://{address}")
}
fn kinds(body: &[u8]) -> Vec<u64> {
    let v: serde_json::Value = serde_json::from_slice(body).unwrap();
    v.as_array()
        .unwrap()
        .iter()
        .map(|i| i["type"].as_u64().unwrap())
        .collect()
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 2, "usage: warnings_smoke LOOPBACK_S3/");
    let s3 = &args[1];
    let deadline = || Instant::now() + Duration::from_secs(30);
    let clock = Arc::new(Fixed(AtomicI64::new(ms("2026-09-26T03:05:00.000Z"))));

    // 1. Legacy seeds through the importer path.
    let parsed = seed::parse(SEED.as_bytes()).unwrap();
    let imported = seed::import(&store(s3), &parsed, deadline()).await.unwrap();
    assert_eq!(imported, 5);

    // 2. Funded collection: S08 budgets in the S3 peer, recorded bodies over loopback HTTP.
    let (base, provider_calls) = provider_stub().await;
    let now = SystemClock.now_ms().unwrap();
    let policy = BudgetPolicy {
        provider: Provider::DataGoKr,
        quota_id: "5".repeat(64),
        window_id: "s12_smoke".into(),
        starts_at_ms: now - 1000,
        ends_at_ms: now + 600_000,
        limit: 200,
        block_units: 2,
    };
    let budget =
        Arc::new(BudgetStore::new(Arc::new(transport(s3)), policy, Arc::new(SystemClock)).unwrap());
    let source = Arc::new(
        FundedSource::new(
            Arc::new(HttpProviderTransport::new(1 << 20).unwrap()),
            &base,
            vec![(budget, "local-smoke-key".into())],
            clock.clone(),
        )
        .unwrap(),
    );
    let collector = WarningCollector::new(source, store(s3), clock.clone());
    let report = collector.gather().await;
    assert!(report.errors.is_empty(), "{report:?}");
    assert_eq!(report.stored, 4);
    let collected_calls = *provider_calls.lock().unwrap();

    // 3. Replaced process: empty memory, no provider source, real HTTP listener.
    clock
        .0
        .store(ms("2026-09-27T10:10:00.000Z"), Ordering::SeqCst);
    let svc = Arc::new(WarningService::new(
        store(s3),
        clock.clone(),
        ServiceConfig {
            refresh: Duration::ZERO,
            deadline: Duration::from_secs(9),
            ..ServiceConfig::default()
        },
    ));
    let url = serve(svc.clone()).await;
    let http = reqwest::Client::new();
    let r = http
        .get(format!("{url}/v000903/kma/special"))
        .header("accept-language", "ko")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(r.headers()["cache-control"], "max-age=300");
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    let etag = r.headers()["etag"].to_str().unwrap().to_owned();
    let body = r.bytes().await.unwrap();
    assert_eq!(kinds(&body), vec![4, 1, 2, 3]);
    let not_modified = http
        .get(format!("{url}/V000903/KMA/SPECIAL/"))
        .header("accept-language", "ko")
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(not_modified.status().as_u16(), 304);
    let head = http
        .head(format!("{url}/v000903/kma/special"))
        .send()
        .await
        .unwrap();
    assert_eq!(head.status().as_u16(), 200);
    assert_eq!(
        http.post(format!("{url}/v000903/kma/special"))
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        404
    );
    let town = server2::warnings::Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: "청운효자동".into(),
    };
    let info = svc.special_info(&town).await.unwrap();
    assert_eq!(info.len(), 1);

    // 4. A rejected catalog commit is not acknowledged; the acknowledged latest stays served.
    let newer = vec![Member {
        role: Operation::WthrPwn.role().into(),
        bytes: r#"{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"tmFc":202609271000,"tmSeq":1,"pwn":"o 없음","rem":"newer"}]}}}}"#.as_bytes().to_vec().into(),
        fetched_at_ms: ms("2026-09-27T01:01:00.000Z") as u64,
    }];
    let catalog_key = records::catalog("bulletin-2", 20260927).unwrap().key();
    let control = reqwest::Url::parse_with_params(
        &format!("{s3}__catalog"),
        [("mode", "reject"), ("key", catalog_key.as_str())],
    )
    .unwrap();
    let fault = http
        .post(control)
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(fault.status().as_u16(), 204);
    assert!(
        store(s3)
            .publish("bulletin-2", 20260927, newer, deadline())
            .await
            .is_err()
    );
    let body = http
        .get(format!("{url}/v000903/kma/special"))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let type2 = list
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["type"] == 2)
        .unwrap();
    assert_eq!(type2["announcement"], "2026-09-25T21:00:00.000Z");
    assert_eq!(type2["name"], "Preliminary Special weather");

    // 5. Weather flash boundary: actual + 19 h kept, + 1 ms omitted.
    clock
        .0
        .store(ms("2026-09-27T19:10:00.000Z"), Ordering::SeqCst);
    let at_19 = http
        .get(format!("{url}/v000903/kma/special"))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    clock
        .0
        .store(ms("2026-09-27T19:10:00.001Z"), Ordering::SeqCst);
    let after = http
        .get(format!("{url}/v000903/kma/special"))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(kinds(&at_19), vec![4, 1, 2, 3]);
    assert_eq!(kinds(&after), vec![1, 2, 3]);
    let c = &svc.store().counters;
    println!(
        "{}",
        serde_json::json!({
            "result": "pass",
            "seed_acquisitions": imported,
            "collected": report.stored,
            "zone_days": report.zone_days,
            "provider_stub_requests": collected_calls,
            "served_types_at_plus10h": kinds(&body),
            "served_types_at_plus19h": kinds(&at_19),
            "served_types_after_plus19h": kinds(&after),
            "special_info_items": info.len(),
            "day_lookups": c.day_lookups.load(Ordering::Relaxed),
            "repairs": c.repairs.load(Ordering::Relaxed),
            "incomplete_days": c.incomplete_days.load(Ordering::Relaxed),
        })
    );
}
