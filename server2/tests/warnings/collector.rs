//! Collector port with recorded provider bodies: an in-process source and the funded
//! S08 executor against a loopback HTTP stub. No live provider is contacted.
use super::common::*;
use server2::{
    budget::{BudgetPolicy, BudgetStore, Provider, SystemClock},
    gateway::OrderedJson,
    providers::HttpProviderTransport,
    storage::HttpS3Transport,
    warnings::{
        FundedSource, Operation, WarningCollector, WarningSource,
        collector::CycleError,
        provider::{BoxFuture, FetchError, Page},
    },
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::time::Instant;

type Calls = Mutex<Vec<(Operation, Vec<(&'static str, String)>)>>;
#[derive(Default)]
struct Recorded {
    bodies: HashMap<Operation, Vec<u8>>,
    errors: HashMap<Operation, FetchError>,
    calls: Calls,
}
impl Recorded {
    fn fixtures() -> Self {
        let mut r = Self::default();
        for (op, body) in [
            (Operation::PwnStatus, PWN_STATUS),
            (Operation::WrnMsg, WRN_MSG),
            (Operation::PwnCd, PWN_CD),
            (Operation::WthrPwn, WTHR_PWN),
            (Operation::WthrInfo, WTHR_INFO),
            (Operation::BrkNews, BRK_NEWS),
        ] {
            r.bodies.insert(op, body.as_bytes().to_vec());
        }
        r
    }
    fn calls(&self, op: Operation) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.0 == op)
            .count()
    }
}
impl WarningSource for Recorded {
    fn fetch<'a>(
        &'a self,
        operation: Operation,
        params: Vec<(&'static str, String)>,
        _deadline: Instant,
    ) -> BoxFuture<'a, Result<Option<Page>, FetchError>> {
        self.calls.lock().unwrap().push((operation, params));
        Box::pin(async move {
            if let Some(e) = self.errors.get(&operation) {
                return Err(*e);
            }
            let body = self.bodies.get(&operation).cloned().unwrap_or_default();
            let Some(items) = server2::warnings::provider::items(&body).ok().flatten() else {
                return Ok(None);
            };
            Ok(Some(Page {
                operation,
                body: body.into(),
                fetched_at_ms: ms("2026-09-26T03:05:00.000Z") as u64,
                items,
            }))
        })
    }
}
fn kinds(list: &OrderedJson) -> Vec<f64> {
    let OrderedJson::Array(a) = list else {
        panic!()
    };
    a.iter()
        .map(|i| i.get("type").unwrap().number().unwrap())
        .collect()
}
#[tokio::test]
async fn gather_publishes_each_announcement_once_and_serves_from_s3() {
    let peer = Peer::new();
    let store = peer.store();
    let source = Arc::new(Recorded::fixtures());
    let clock = FixedClock::at("2026-09-26T03:05:00.000Z");
    let collector = WarningCollector::new(source.clone(), store.clone(), clock.clone());
    let first = collector.gather().await;
    assert_eq!(first.errors, vec![]);
    assert_eq!(first.stored, 4, "{first:?}");
    assert!(first.synced);
    assert_eq!(
        first.zone_days, 10,
        "bootstrap plan: today and nine backfill days"
    );
    assert_eq!(source.calls(Operation::PwnCd), 10);
    // Same announcements: nothing new is published; bootstrap continues ten days further.
    let second = collector.gather().await;
    assert_eq!(second.stored, 0);
    assert!(second.synced);
    assert_eq!(source.calls(Operation::PwnCd), 20);
    // A replaced process serves the collected bulletins from S3 alone.
    let service = peer.service(clock);
    let list = service.special(true).await.unwrap();
    assert_eq!(kinds(&list), vec![4., 1., 2., 3.]);
    let OrderedJson::Array(a) = &list else {
        panic!()
    };
    assert!(
        a[1].get("bulletin").is_some(),
        "type 1 carries the matched bulletin"
    );
    // The getPwnCd parameters follow the legacy one-KST-day request.
    let calls = source.calls.lock().unwrap();
    let zone = calls.iter().find(|c| c.0 == Operation::PwnCd).unwrap();
    assert_eq!(
        zone.1,
        vec![
            ("fromTmFc", "20260926".to_owned()),
            ("toTmFc", "20260926".to_owned()),
            ("pageNo", "1".to_owned()),
            ("numOfRows", "10000".to_owned())
        ]
    );
}
#[tokio::test]
async fn quota_rejection_ends_the_cycle_without_publication() {
    let peer = Peer::new();
    let mut recorded = Recorded::fixtures();
    recorded
        .errors
        .insert(Operation::PwnStatus, FetchError::Quota);
    let source = Arc::new(recorded);
    let collector = WarningCollector::new(
        source.clone(),
        peer.store(),
        FixedClock::at("2026-09-26T03:05:00.000Z"),
    );
    let report = collector.gather().await;
    assert_eq!(
        report.errors,
        vec![CycleError::Fetch(Operation::PwnStatus, FetchError::Quota)]
    );
    assert_eq!(report.stored, 0);
    assert_eq!(source.calls(Operation::WthrPwn), 0);
    assert_eq!(source.calls(Operation::PwnCd), 0);
}
#[tokio::test]
async fn missing_bulletin_stays_pending_then_stores_after_twenty_cycles() {
    let peer = Peer::new();
    let mut recorded = Recorded::fixtures();
    recorded.bodies.remove(&Operation::WrnMsg);
    for op in [Operation::WthrPwn, Operation::WthrInfo, Operation::BrkNews] {
        recorded.bodies.remove(&op);
    }
    let source = Arc::new(recorded);
    let store = peer.store();
    let clock = FixedClock::at("2026-09-26T03:05:00.000Z");
    let collector = WarningCollector::new(source.clone(), store.clone(), clock.clone());
    for cycle in 1..20 {
        let r = collector.gather().await;
        assert_eq!((r.stored, r.pending_cycles), (0, cycle), "{r:?}");
    }
    let r = collector.gather().await;
    assert_eq!(r.stored, 1);
    assert_eq!(r.pending_cycles, 0);
    let latest = store
        .latest(
            1,
            clock.0.load(std::sync::atomic::Ordering::SeqCst),
            None,
            deadline(),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(
        latest.doc.get("bulletin").is_none(),
        "stored without bulletin"
    );
}
async fn stub(responses: HashMap<&'static str, (u16, &'static str)>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let responses = Arc::new(responses);
    let app = axum::Router::new().fallback(move |uri: axum::http::Uri| {
        let responses = responses.clone();
        async move {
            let op = uri.path().rsplit('/').next().unwrap_or("").to_owned();
            let query = uri.query().unwrap_or("").to_owned();
            assert!(query.contains("serviceKey=") && query.contains("dataType=JSON"));
            let (status, body) = responses.get(op.as_str()).copied().unwrap_or((404, ""));
            axum::response::Response::builder()
                .status(status)
                .header("content-type", "application/json;charset=UTF-8")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
    });
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{address}/1360000/WthrWrnInfoService/")
}
fn budget(peer: &Peer, id: &str) -> Arc<BudgetStore<HttpS3Transport>> {
    let now = server2::budget::Clock::now_ms(&SystemClock).unwrap();
    let policy = BudgetPolicy {
        provider: Provider::DataGoKr,
        quota_id: id.repeat(64),
        window_id: "s12_local".into(),
        starts_at_ms: now - 1000,
        ends_at_ms: now + 600_000,
        limit: 40,
        block_units: 2,
    };
    Arc::new(BudgetStore::new(Arc::new(peer.transport()), policy, Arc::new(SystemClock)).unwrap())
}
#[tokio::test]
async fn funded_source_uses_s08_budgets_and_rejection_rules_on_loopback() {
    let peer = Peer::new();
    let base = stub(HashMap::from([
        ("getWthrPwn", (200, WTHR_PWN)),
        ("getWthrInfo", (200, ERR_99)),
        ("getWthrBrkNews", (403, ERR_30)),
        ("getPwnCd", (200, ERR_30)),
        ("getPwnStatus", (429, "")),
        (
            "getWthrWrnMsg",
            (
                200,
                r#"{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}"#,
            ),
        ),
    ]))
    .await;
    let source = FundedSource::new(
        Arc::new(HttpProviderTransport::new(1 << 20).unwrap()),
        &base,
        vec![(budget(&peer, "a"), "local-test-key".into())],
        Arc::new(SystemClock),
    )
    .unwrap();
    let params = vec![("stnId", "108".to_owned())];
    let page = source
        .fetch(Operation::WthrPwn, params.clone(), deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&*page.body, WTHR_PWN.as_bytes());
    assert_eq!(page.items.len(), 1);
    assert_eq!(
        source
            .fetch(Operation::WthrInfo, params.clone(), deadline())
            .await
            .unwrap_err(),
        FetchError::Rejected
    );
    assert_eq!(
        source
            .fetch(Operation::BrkNews, params.clone(), deadline())
            .await
            .unwrap_err(),
        FetchError::Auth
    );
    assert_eq!(
        source
            .fetch(Operation::PwnStatus, params.clone(), deadline())
            .await
            .unwrap_err(),
        FetchError::Quota
    );
    // A status-200 JSON gateway envelope is never data. The shared S08 classifier treats
    // it as retryable (legacy kmaWarningRequester classified code 30 as auth).
    assert_eq!(
        source
            .fetch(Operation::PwnCd, params.clone(), deadline())
            .await
            .unwrap_err(),
        FetchError::Rejected
    );
    assert!(
        source
            .fetch(Operation::WrnMsg, params, deadline())
            .await
            .unwrap()
            .is_none()
    );
    // Funding is reserved in S3 before any HTTP request.
    let counts = peer.counts().await;
    assert!(
        counts
            .as_object()
            .unwrap()
            .keys()
            .any(|k| k.starts_with("PUT budgets/v2/data_go_kr/"))
    );
}
