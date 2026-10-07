//! Synthetic protocol fixtures only. Real loopback HTTP, no AWS or provider parity claim.
use super::model::policy;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request as AxumRequest, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use server2::{budget::*, providers::*, storage::HttpS3Transport};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
#[derive(Default)]
struct Data {
    objects: BTreeMap<String, (Vec<u8>, String)>,
    events: Vec<String>,
    responses: VecDeque<(u16, Vec<u8>)>,
    calls: Vec<String>,
    fault: Option<(String, u16, u64)>,
    serial: u64,
    provider_delay: u64,
    active: usize,
    peak: usize,
    before_apply: Option<Arc<tokio::sync::Notify>>,
    before_entered: bool,
    late_status: Option<u16>,
    conflict: bool,
}
#[derive(Default)]
struct Peer {
    data: Mutex<Data>,
}
struct Running {
    endpoint: String,
    peer: Arc<Peer>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Running {
    async fn new() -> Self {
        let peer = Arc::new(Peer::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new().fallback(any(handle)).with_state(peer.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            endpoint,
            peer,
            task,
        }
    }
    fn transport(&self) -> Arc<HttpS3Transport> {
        Arc::new(
            HttpS3Transport::new(
                &self.endpoint,
                "server2-s08",
                "ap-northeast-2",
                rusty_s3::Credentials::new("dummy", "dummy-secret"),
            )
            .unwrap(),
        )
    }
    fn used(&self, p: &BudgetPolicy) -> u64 {
        let d = self.peer.data.lock().unwrap();
        let v = &d.objects[&format!("/server2-s08/{}", p.authority_key())].0;
        serde_json::from_slice::<Authority>(v).unwrap().used
    }
    fn calls(&self) -> usize {
        self.peer.data.lock().unwrap().calls.len()
    }
    fn responses(&self, items: &[(u16, &[u8])]) {
        self.peer.data.lock().unwrap().responses =
            items.iter().map(|(s, b)| (*s, b.to_vec())).collect();
    }
}
async fn handle(State(peer): State<Arc<Peer>>, request: AxumRequest) -> Response {
    let path = request.uri().path().to_owned();
    let method = request.method().clone();
    let query = request.uri().query().unwrap_or("").to_owned();
    let headers = request.headers().clone();
    let bytes = match to_bytes(request.into_body(), 4096).await {
        Ok(v) => v.to_vec(),
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    if path == "/provider" {
        let query: reqwest::Url = format!("http://127.0.0.1?{query}").parse().unwrap();
        let fields: BTreeMap<String, String> = query
            .query_pairs()
            .map(|(a, b)| (a.into(), b.into()))
            .collect();
        if fields.contains_key("serviceKey") {
            assert_eq!(fields.get("dataType").map(String::as_str), Some("JSON"));
        }
        let (status, body, delay) = {
            let mut data = peer.data.lock().unwrap();
            data.calls.push(
                fields
                    .get("serviceKey")
                    .or_else(|| fields.get("key"))
                    .unwrap()
                    .clone(),
            );
            data.active += 1;
            data.peak = data.peak.max(data.active);
            let (status, body) = data
                .responses
                .pop_front()
                .unwrap_or((200, br#"{"ok":true}"#.to_vec()));
            (status, body, data.provider_delay)
        };
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
        peer.data.lock().unwrap().active -= 1;
        return (
            StatusCode::from_u16(status).unwrap(),
            [("content-type", "application/json")],
            body,
        )
            .into_response();
    }
    if !path.starts_with("/server2-s08/budgets/v2/") {
        return StatusCode::FORBIDDEN.into_response();
    }
    assert!(query.contains("X-Amz-Signature="));
    if method == axum::http::Method::GET {
        let mut data = peer.data.lock().unwrap();
        data.events.push(format!("GET {path}"));
        return match data.objects.get(&path) {
            None => StatusCode::NOT_FOUND.into_response(),
            Some((body, etag)) => (
                [
                    ("content-type", "application/json"),
                    ("etag", etag.as_str()),
                ],
                body.clone(),
            )
                .into_response(),
        };
    }
    if method != axum::http::Method::PUT {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if headers.get("content-md5").and_then(|v| v.to_str().ok())
        != Some(STANDARD.encode(Md5::digest(&bytes)).as_str())
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let gate = {
        let mut data = peer.data.lock().unwrap();
        if path.ends_with("authority.json") && data.before_apply.is_some() {
            data.before_entered = true;
            data.before_apply.take()
        } else {
            None
        }
    };
    if let Some(gate) = gate {
        // Accepted remote operation outlives the caller connection, like a delayed
        // S3 write. Evaluate the conditional predicate only after the test barrier.
        let remote = peer.clone();
        let task = tokio::spawn(async move {
            gate.notified().await;
            let response = apply_put(remote.clone(), path, headers, bytes).await;
            remote.data.lock().unwrap().late_status = Some(response.status().as_u16());
            response
        });
        return task.await.unwrap();
    }
    apply_put(peer, path, headers, bytes).await
}
async fn apply_put(peer: Arc<Peer>, path: String, headers: HeaderMap, bytes: Vec<u8>) -> Response {
    let (status, delay) = {
        let mut data = peer.data.lock().unwrap();
        data.events.push(format!("PUT {path}"));
        if data.conflict && path.ends_with("authority.json") {
            return StatusCode::PRECONDITION_FAILED.into_response();
        }
        let old = data.objects.get(&path);
        if (headers.get("if-none-match").is_some() && old.is_some())
            || headers
                .get("if-match")
                .is_some_and(|v| old.is_none_or(|(_, etag)| etag != v.to_str().unwrap()))
        {
            return StatusCode::PRECONDITION_FAILED.into_response();
        }
        data.serial += 1;
        let etag = format!("\"{}\"", data.serial);
        data.objects.insert(path.clone(), (bytes, etag));
        if data
            .fault
            .as_ref()
            .is_some_and(|(part, _, _)| path.contains(part))
        {
            let (_, s, m) = data.fault.take().unwrap();
            (s, m)
        } else {
            (200, 0)
        }
    };
    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
    (StatusCode::from_u16(status).unwrap(), Body::empty()).into_response()
}
struct TestClock(AtomicI64);
impl Clock for TestClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
fn clock() -> Arc<TestClock> {
    Arc::new(TestClock(AtomicI64::new(100)))
}
fn end() -> Instant {
    Instant::now() + Duration::from_secs(2)
}
fn store(peer: &Running, p: BudgetPolicy, c: Arc<TestClock>) -> Arc<BudgetStore<HttpS3Transport>> {
    Arc::new(BudgetStore::new(peer.transport(), p, c).unwrap())
}
fn candidate(store: Arc<BudgetStore<HttpS3Transport>>, key: &str) -> Candidate<HttpS3Transport> {
    Candidate {
        budget: store,
        key: ProviderKey::new(key.into()).unwrap(),
    }
}
fn validator(v: &serde_json::Value) -> bool {
    v.get("ok") == Some(&true.into())
}
async fn acquire(
    peer: &Running,
    candidates: Vec<Candidate<HttpS3Transport>>,
) -> Result<AcquiredBody, AcquisitionError> {
    FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(4096).unwrap()),
        Arc::new(validator as fn(&serde_json::Value) -> bool),
    )
    .unwrap()
    .execute(
        format!("{}/provider", peer.endpoint).parse().unwrap(),
        candidates,
        end(),
    )
    .await
    .map(|outcome| match outcome {
        AcquisitionOutcome::Data(raw) => raw,
        AcquisitionOutcome::NoData(_) => panic!("expected data in generic existing fixture"),
    })
}
#[tokio::test]
async fn cold_warm_and_replacement_burn_leftovers() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    let a = store(&peer, p.clone(), clock());
    assert_eq!(a.reserve(2, end()).await.unwrap().units(), 2);
    assert_eq!(a.reserve(2, end()).await.unwrap().units(), 2);
    assert_eq!(peer.peer.data.lock().unwrap().events.len(), 3);
    let b = store(&peer, p.clone(), clock());
    assert!(b.reserve(2, end()).await.is_ok());
    assert_eq!(peer.used(&p), 8);
    assert_eq!(
        a.reserve(2, end()).await.err(),
        Some(BudgetError::Exhausted)
    );
}
#[tokio::test]
async fn two_stores_race_nonoverlapping_ranges() {
    let peer = Running::new().await;
    let p = policy(4, 2);
    let a = store(&peer, p.clone(), clock());
    let b = store(&peer, p.clone(), clock());
    let (ra, rb) = tokio::join!(a.reserve(2, end()), b.reserve(2, end()));
    assert!(ra.is_ok() && rb.is_ok());
    assert_eq!(peer.used(&p), 4);
    let data = peer.peer.data.lock().unwrap();
    let mut ranges: Vec<_> = data
        .objects
        .iter()
        .filter(|(k, _)| k.contains("/blocks/"))
        .map(|(_, v)| {
            let w: RangeWitness = serde_json::from_slice(&v.0).unwrap();
            (w.start, w.end)
        })
        .collect();
    ranges.sort();
    assert_eq!(ranges, vec![(0, 2), (2, 4)]);
}
#[tokio::test]
async fn committed_unknown_cas_has_no_http_and_replacement_uses_next_range() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    peer.peer.data.lock().unwrap().fault = Some(("authority.json".into(), 500, 0));
    let a = store(&peer, p.clone(), clock());
    assert_eq!(
        acquire(&peer, vec![candidate(a, "first")]).await.err(),
        Some(AcquisitionError::Funding(BudgetError::Unknown))
    );
    assert_eq!(peer.calls(), 0);
    assert_eq!(peer.used(&p), 4);
    let b = store(&peer, p.clone(), clock());
    assert!(
        acquire(&peer, vec![candidate(b, "replacement")])
            .await
            .is_ok()
    );
    assert_eq!(peer.used(&p), 8);
}
#[tokio::test]
async fn unknown_witness_burns_range_no_http() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    peer.peer.data.lock().unwrap().fault = Some(("/blocks/".into(), 500, 0));
    let a = store(&peer, p.clone(), clock());
    assert!(matches!(
        acquire(&peer, vec![candidate(a, "unused")]).await,
        Err(AcquisitionError::Funding(BudgetError::Unknown))
    ));
    assert_eq!(peer.calls(), 0);
    assert_eq!(peer.used(&p), 4);
}
#[tokio::test]
async fn cancelled_late_cas_does_not_overlap_replacement() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    peer.peer.data.lock().unwrap().fault = Some(("authority.json".into(), 200, 180));
    let a = store(&peer, p.clone(), clock());
    let job = tokio::spawn(async move { a.reserve(2, end()).await });
    for _ in 0..100 {
        if peer
            .peer
            .data
            .lock()
            .unwrap()
            .objects
            .keys()
            .any(|k| k.ends_with("authority.json"))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(peer.used(&p), 4);
    job.abort();
    let b = store(&peer, p.clone(), clock());
    assert!(b.reserve(2, end()).await.is_ok());
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(peer.used(&p), 8);
}
#[tokio::test]
async fn funding_deadline_wait_and_unknown_put_are_bounded() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    peer.peer.data.lock().unwrap().fault = Some(("authority.json".into(), 200, 180));
    let a = store(&peer, p.clone(), clock());
    let b = a.clone();
    let job = tokio::spawn(async move { b.reserve(2, end()).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        a.reserve(2, Instant::now() + Duration::from_millis(15))
            .await
            .err(),
        Some(BudgetError::Deadline)
    );
    job.abort();
    let b = store(&peer, p.clone(), clock());
    peer.peer.data.lock().unwrap().fault = Some(("authority.json".into(), 200, 180));
    assert_eq!(
        b.reserve(2, Instant::now() + Duration::from_millis(15))
            .await
            .err(),
        Some(BudgetError::Unknown)
    );
    assert_eq!(peer.calls(), 0);
}
#[tokio::test]
async fn policy_drift_floor_decrease_and_clock_backwards_deny() {
    let peer = Running::new().await;
    let p = policy(8, 4);
    let c = clock();
    let a = store(&peer, p.clone(), c.clone());
    assert!(a.reserve(2, end()).await.is_ok());
    c.0.store(99, Ordering::SeqCst);
    assert_eq!(a.reserve(1, end()).await.err(), Some(BudgetError::Clock));
    let mut changed = p.clone();
    changed.limit = 9;
    let b = store(&peer, changed, clock());
    assert!(matches!(
        b.reserve(2, end()).await,
        Err(BudgetError::Corrupt(_))
    ));
    c.0.store(100000, Ordering::SeqCst);
    assert_eq!(a.reserve(1, end()).await.err(), Some(BudgetError::Clock));
}
#[tokio::test]
async fn all_candidate_funding_before_http_and_unused_candidate_burns() {
    let peer = Running::new().await;
    let p = policy(4, 2);
    let a = store(&peer, p.clone(), clock());
    let mut p2 = p.clone();
    p2.quota_id = "b".repeat(64);
    let b = store(&peer, p2.clone(), clock());
    assert!(
        acquire(&peer, vec![candidate(a, "first"), candidate(b, "unused")])
            .await
            .is_ok()
    );
    assert_eq!(peer.calls(), 1);
    assert_eq!(peer.used(&p), 2);
    assert_eq!(peer.used(&p2), 2);
    let a = store(&peer, p.clone(), clock());
    let mut denied = p2.clone();
    denied.limit = 1;
    denied.block_units = 1;
    let b = store(&peer, denied, clock());
    assert!(matches!(
        acquire(&peer, vec![candidate(a, "first"), candidate(b, "denied")]).await,
        Err(AcquisitionError::Funding(_))
    ));
    assert_eq!(peer.calls(), 1);
}
#[tokio::test]
async fn rotation_and_same_key_retry_total_two_calls() {
    for (status, body, rotate) in [
        (
            200,
            b"<returnReasonCode>22</returnReasonCode>".as_slice(),
            true,
        ),
        (401, b"{}".as_slice(), true),
        (500, b"bad".as_slice(), false),
        (302, b"{}".as_slice(), false),
        (200, b"".as_slice(), false),
    ] {
        let peer = Running::new().await;
        peer.responses(&[(status, body), (200, br#"{"ok":true}"#)]);
        let p = policy(8, 4);
        let mut p2 = p.clone();
        p2.quota_id = "b".repeat(64);
        let a = store(&peer, p, clock());
        let b = store(&peer, p2, clock());
        let result = acquire(&peer, vec![candidate(a, "first"), candidate(b, "second")])
            .await
            .unwrap();
        assert_eq!(result.attempts, 2);
        let calls = peer.peer.data.lock().unwrap().calls.clone();
        assert_eq!(
            calls,
            vec!["first", if rotate { "second" } else { "first" }]
        );
    }
}
#[tokio::test]
async fn other_4xx_stops_and_retry_failure_is_final() {
    for (status, expected) in [(404, 1), (500, 2)] {
        let peer = Running::new().await;
        peer.responses(&[(status, b"bad"), (500, b"bad")]);
        let a = store(&peer, policy(8, 4), clock());
        assert!(acquire(&peer, vec![candidate(a, "first")]).await.is_err());
        assert_eq!(peer.calls(), expected);
    }
}
#[tokio::test]
async fn durable_floor_decrease_or_missing_authority_is_rejected() {
    for missing in [false, true] {
        let peer = Running::new().await;
        let p = policy(8, 4);
        let a = store(&peer, p.clone(), clock());
        drop(a.reserve(4, end()).await.unwrap());
        {
            let mut data = peer.peer.data.lock().unwrap();
            let key = format!("/server2-s08/{}", p.authority_key());
            if missing {
                data.objects.remove(&key);
            } else {
                data.objects.get_mut(&key).unwrap().0 = serde_json::to_vec(&Authority {
                    version: 2,
                    policy: p,
                    used: 0,
                })
                .unwrap();
            }
        }
        assert!(matches!(
            a.reserve(1, end()).await,
            Err(BudgetError::Corrupt(_))
        ));
        assert_eq!(peer.calls(), 0);
    }
}
#[tokio::test]
async fn vc_record_costs_fund_maximum_before_attempt() {
    for cost in [49, 25, 1] {
        let peer = Running::new().await;
        let mut p = policy(120, 120);
        p.provider = Provider::VisualCrossing;
        let a = store(&peer, p.clone(), clock());
        let execute = FundedExecutor::new(
            Provider::VisualCrossing,
            cost,
            Arc::new(HttpProviderTransport::new(4096).unwrap()),
            Arc::new(validator as fn(&serde_json::Value) -> bool),
        )
        .unwrap();
        let result = execute
            .execute(
                format!("{}/provider", peer.endpoint).parse().unwrap(),
                vec![candidate(a.clone(), "dummy")],
                end(),
            )
            .await
            .unwrap();
        let AcquisitionOutcome::Data(result) = result else {
            panic!("VC data");
        };
        assert_eq!(result.attempts, 1);
        assert_eq!(peer.used(&p), 120);
        assert_eq!(
            a.reserve(120 - 2 * cost, end())
                .await
                .ok()
                .map(|r| r.units()),
            Some(120 - 2 * cost)
        );
    }
}
#[tokio::test]
async fn expired_window_between_attempts_blocks_retry() {
    let peer = Running::new().await;
    let c = clock();
    let a = store(&peer, policy(8, 4), c.clone());
    let validate = move |_: &serde_json::Value| {
        c.0.store(100000, Ordering::SeqCst);
        false
    };
    let e = FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(4096).unwrap()),
        Arc::new(validate),
    )
    .unwrap();
    let result = e
        .execute(
            format!("{}/provider", peer.endpoint).parse().unwrap(),
            vec![candidate(a, "first")],
            end(),
        )
        .await;
    assert_eq!(
        result.err(),
        Some(AcquisitionError::Funding(BudgetError::Clock))
    );
    assert_eq!(peer.calls(), 1);
}
#[tokio::test]
async fn aborted_after_witness_never_restores_unused_permit() {
    let peer = Running::new().await;
    let p = policy(4, 4);
    let a = store(&peer, p.clone(), clock());
    drop(a.reserve(1, end()).await.unwrap());
    drop(a);
    let b = store(&peer, p.clone(), clock());
    assert_eq!(
        acquire(&peer, vec![candidate(b, "unused")]).await.err(),
        Some(AcquisitionError::Funding(BudgetError::Exhausted))
    );
    assert_eq!(peer.calls(), 0);
    assert_eq!(peer.used(&p), 4);
}
#[tokio::test]
async fn provider_transport_failure_is_funded_and_total_attempts_bounded() {
    let peer = Running::new().await;
    let a = store(&peer, policy(8, 4), clock());
    let e = FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(4096).unwrap()),
        Arc::new(validator as fn(&serde_json::Value) -> bool),
    )
    .unwrap();
    let result = e
        .execute(
            "http://127.0.0.1:1/provider".parse().unwrap(),
            vec![candidate(a, "first")],
            end(),
        )
        .await;
    assert_eq!(result.err(), Some(AcquisitionError::Transport));
    assert_eq!(peer.calls(), 0);
}
#[tokio::test]
async fn budget_200_headers_with_truncated_ack_body_is_not_acknowledged() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let job = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = vec![0; 8192];
        let _ = socket.read(&mut bytes).await.unwrap();
        socket
            .write_all(
                concat!(
                    "HTTP/1.1 200 OK",
                    "\r\nContent-Length: 3\r\nConnection: close\r\n\r\nx"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        socket.shutdown().await.unwrap();
    });
    let t = HttpS3Transport::new(
        &endpoint,
        "server2-s08",
        "ap-northeast-2",
        rusty_s3::Credentials::new("dummy", "dummy-secret"),
    )
    .unwrap();
    let p = policy(8, 4);
    let result = t
        .put_budget(
            &p.authority_key(),
            b"{}",
            &server2::storage::WriteCondition::Absent,
        )
        .await;
    job.await.unwrap();
    assert!(
        result.is_err(),
        "200 response headers are not a completed funding acknowledgment: {result:?}"
    );
}
#[tokio::test]
async fn executor_admission_bounds_concurrent_downloads() {
    let peer = Running::new().await;
    peer.peer.data.lock().unwrap().provider_delay = 60;
    let a = store(&peer, policy(64, 16), clock());
    let e = Arc::new(
        FundedExecutor::new(
            Provider::DataGoKr,
            1,
            Arc::new(HttpProviderTransport::new(4096).unwrap()),
            Arc::new(validator as fn(&serde_json::Value) -> bool),
        )
        .unwrap(),
    );
    let mut jobs = Vec::new();
    for _ in 0..8 {
        let (e, a, url) = (
            e.clone(),
            a.clone(),
            format!("{}/provider", peer.endpoint).parse().unwrap(),
        );
        jobs.push(tokio::spawn(async move {
            e.execute(url, vec![candidate(a, "first")], end()).await
        }));
    }
    for job in jobs {
        assert!(job.await.unwrap().is_ok());
    }
    assert!(peer.peer.data.lock().unwrap().peak <= 4);
    assert_eq!(peer.calls(), 8);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelled_validator_retains_body_admission_until_cpu_finishes() {
    use std::sync::atomic::AtomicUsize;
    let peer = Running::new().await;
    let a = store(&peer, policy(64, 16), clock());
    let entered = Arc::new(AtomicUsize::new(0));
    let counter = entered.clone();
    let validate = move |_: &serde_json::Value| {
        counter.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(200));
        true
    };
    let e = Arc::new(
        FundedExecutor::new(
            Provider::DataGoKr,
            1,
            Arc::new(HttpProviderTransport::new(4096).unwrap()),
            Arc::new(validate),
        )
        .unwrap(),
    );
    let mut original = Vec::new();
    for _ in 0..2 {
        let (e, a, url) = (
            e.clone(),
            a.clone(),
            format!("{}/provider", peer.endpoint).parse().unwrap(),
        );
        original.push(tokio::spawn(async move {
            e.execute(url, vec![candidate(a, "first")], end()).await
        }));
    }
    for _ in 0..100 {
        if entered.load(Ordering::SeqCst) == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(entered.load(Ordering::SeqCst), 2);
    for job in original {
        job.abort();
    }
    let mut next = Vec::new();
    for _ in 0..4 {
        let (e, a, url) = (
            e.clone(),
            a.clone(),
            format!("{}/provider", peer.endpoint).parse().unwrap(),
        );
        next.push(tokio::spawn(async move {
            e.execute(url, vec![candidate(a, "first")], end()).await
        }));
    }
    tokio::time::sleep(Duration::from_millis(35)).await;
    assert!(
        peer.calls() <= 4,
        "cancelled CPU closures must retain admission for their response bodies"
    );
    for job in next {
        assert!(job.await.unwrap().is_ok());
    }
}
#[tokio::test]
async fn invalid_endpoint_is_rejected_before_funding() {
    let peer = Running::new().await;
    let a = store(&peer, policy(8, 4), clock());
    let e = FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(4096).unwrap()),
        Arc::new(validator as fn(&serde_json::Value) -> bool),
    )
    .unwrap();
    assert_eq!(
        e.execute(
            "http://example.invalid/provider".parse().unwrap(),
            vec![candidate(a, "first")],
            end()
        )
        .await
        .err(),
        Some(AcquisitionError::Invalid)
    );
    assert!(peer.peer.data.lock().unwrap().events.is_empty());
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_clock_observations_are_serialized() {
    use std::sync::atomic::AtomicUsize;
    struct Probe {
        active: AtomicUsize,
        peak: AtomicUsize,
        tick: AtomicI64,
    }
    impl Clock for Probe {
        fn now_ms(&self) -> Result<i64, BudgetError> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(active, Ordering::SeqCst);
            let value = self.tick.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(4));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(value)
        }
    }
    let peer = Running::new().await;
    let c = Arc::new(Probe {
        active: AtomicUsize::new(0),
        peak: AtomicUsize::new(0),
        tick: AtomicI64::new(100),
    });
    let a = Arc::new(BudgetStore::new(peer.transport(), policy(8, 4), c.clone()).unwrap());
    let barrier = Arc::new(tokio::sync::Barrier::new(5));
    let mut tasks = Vec::new();
    for _ in 0..4 {
        let (a, b) = (a.clone(), barrier.clone());
        tasks.push(tokio::spawn(async move {
            b.wait().await;
            a.reserve(1, end()).await
        }));
    }
    barrier.wait().await;
    for task in tasks {
        assert!(task.await.unwrap().is_ok());
    }
    assert_eq!(
        c.peak.load(Ordering::SeqCst),
        1,
        "a delayed earlier observation must not race a newer fence"
    );
}
#[tokio::test]
async fn delayed_cas_application_before_or_after_replacement_never_overlaps() {
    for old_wins in [false, true] {
        let peer = Running::new().await;
        let p = policy(8, 4);
        let gate = Arc::new(tokio::sync::Notify::new());
        peer.peer.data.lock().unwrap().before_apply = Some(gate.clone());
        let a = store(&peer, p.clone(), clock());
        let job = tokio::spawn(async move {
            a.reserve(2, Instant::now() + Duration::from_millis(160))
                .await
        });
        for _ in 0..200 {
            if peer.peer.data.lock().unwrap().before_entered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(peer.peer.data.lock().unwrap().before_entered);
        assert_eq!(job.await.unwrap().err(), Some(BudgetError::Unknown));
        assert_eq!(peer.calls(), 0);
        if old_wins {
            gate.notify_one();
            for _ in 0..100 {
                if peer.peer.data.lock().unwrap().late_status.is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
            assert_eq!(peer.peer.data.lock().unwrap().late_status, Some(200));
            assert_eq!(peer.used(&p), 4);
        }
        let replacement = store(&peer, p.clone(), clock());
        assert!(replacement.reserve(2, end()).await.is_ok());
        if !old_wins {
            gate.notify_one();
            for _ in 0..100 {
                if peer.peer.data.lock().unwrap().late_status.is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        }
        let data = peer.peer.data.lock().unwrap();
        assert_eq!(data.late_status, Some(if old_wins { 200 } else { 412 }));
        let witnesses: Vec<RangeWitness> = data
            .objects
            .iter()
            .filter(|(k, _)| k.contains("/blocks/"))
            .map(|(_, v)| serde_json::from_slice(&v.0).unwrap())
            .collect();
        assert_eq!(witnesses.len(), 1);
        assert_eq!(
            (witnesses[0].start, witnesses[0].end),
            if old_wins { (4, 8) } else { (0, 4) }
        );
        drop(data);
        assert_eq!(peer.used(&p), if old_wins { 8 } else { 4 });
    }
}

#[tokio::test]
async fn terminal_no_data_and_parameter_errors_send_one_http() {
    for body in [
        br#"{"response":{"header":{"resultCode":"03"}}}"#.as_slice(),
        b"<response><header><resultCode>03</resultCode></header></response>".as_slice(),
        br#"{"response":{"header":{"resultCode":"10"}}}"#.as_slice(),
        b"<response><header><resultCode>12</resultCode></header></response>".as_slice(),
    ] {
        let peer = Running::new().await;
        peer.responses(&[(200, body)]);
        let result = FundedExecutor::new(
            Provider::DataGoKr,
            1,
            Arc::new(HttpProviderTransport::new(4096).unwrap()),
            Arc::new(validator as fn(&serde_json::Value) -> bool),
        )
        .unwrap()
        .execute(
            format!("{}/provider", peer.endpoint).parse().unwrap(),
            vec![candidate(store(&peer, policy(8, 4), clock()), "first")],
            end(),
        )
        .await;
        if body.windows(2).any(|b| b == b"03") {
            let Ok(AcquisitionOutcome::NoData(raw)) = result else {
                panic!("typed no-data");
            };
            assert_eq!(raw.body, body);
            assert_eq!(raw.attempts, 1);
            assert!(
                peer.peer
                    .data
                    .lock()
                    .unwrap()
                    .objects
                    .keys()
                    .all(|key| key.contains("/budgets/v2/"))
            );
        } else {
            assert!(matches!(
                result,
                Err(AcquisitionError::Provider(Disposition::Rejected))
            ));
        }
        assert_eq!(peer.calls(), 1, "terminal provider outcome must not retry");
    }
}

#[tokio::test]
async fn duplicate_rotation_candidates_rejected_before_funding() {
    for duplicate in ["store", "key", "quota", "quota-other-window"] {
        let peer = Running::new().await;
        let p = policy(8, 4);
        let a = store(&peer, p.clone(), clock());
        let mut q = p.clone();
        if duplicate == "key" {
            q.quota_id = "b".repeat(64);
        }
        if duplicate == "quota-other-window" {
            q.window_id = "another_valid_window".into();
        }
        let b = if duplicate == "store" {
            a.clone()
        } else {
            store(&peer, q, clock())
        };
        let second_key = if duplicate == "key" {
            "first"
        } else {
            "second"
        };
        let result = acquire(&peer, vec![candidate(a, "first"), candidate(b, second_key)]).await;
        assert!(matches!(result, Err(AcquisitionError::Invalid)));
        assert_eq!(peer.calls(), 0);
        assert!(peer.peer.data.lock().unwrap().events.is_empty());
    }
}

#[tokio::test]
async fn persistent_cas_contention_is_not_exhaustion() {
    let peer = Running::new().await;
    peer.peer.data.lock().unwrap().conflict = true;
    let result = store(&peer, policy(100, 4), clock())
        .reserve(2, end())
        .await;
    assert!(matches!(result, Err(BudgetError::Contention)));
    assert_eq!(peer.calls(), 0);
    assert_eq!(
        peer.peer
            .data
            .lock()
            .unwrap()
            .events
            .iter()
            .filter(|e| e.starts_with("PUT "))
            .count(),
        8
    );
}
