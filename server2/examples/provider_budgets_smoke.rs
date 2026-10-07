//! Actual release HTTP smoke against owned loopback peers, synthetic raw protocol data.
use server2::{
    budget::*,
    providers::{
        AcquisitionError, Candidate, FundedExecutor, HttpProviderTransport,
        ProviderKey as SecretKey,
    },
    storage::{
        self, CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember,
        HttpS3Transport, Limits, LookupOutcome, Period, RawRecord,
    },
};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
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
fn policy(id: &str) -> BudgetPolicy {
    let now = SystemClock.now_ms().unwrap();
    BudgetPolicy {
        provider: Provider::DataGoKr,
        quota_id: id.repeat(64),
        window_id: "synthetic_smoke".into(),
        starts_at_ms: now - 1000,
        ends_at_ms: now + 60000,
        limit: 4,
        block_units: 2,
    }
}
fn store(endpoint: &str, p: BudgetPolicy) -> Arc<BudgetStore<HttpS3Transport>> {
    Arc::new(BudgetStore::new(Arc::new(transport(endpoint)), p, Arc::new(SystemClock)).unwrap())
}
fn candidate(budget: Arc<BudgetStore<HttpS3Transport>>, key: &str) -> Candidate<HttpS3Transport> {
    Candidate {
        budget,
        key: SecretKey::new(key.into()).unwrap(),
    }
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(
        args.len(),
        3,
        "usage: provider_budgets_smoke LOOPBACK_S3/ LOOPBACK_PROVIDER"
    );
    let endpoint = &args[1];
    let provider: reqwest::Url = args[2].parse().unwrap();
    for url in [endpoint.parse::<reqwest::Url>().unwrap(), provider.clone()] {
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
    }
    let p = policy("a");
    let mut q = p.clone();
    q.quota_id = "b".repeat(64);
    let a = store(endpoint, p.clone());
    let b = store(endpoint, q);
    let executor = FundedExecutor::new(
        Provider::DataGoKr,
        1,
        Arc::new(HttpProviderTransport::new(4096).unwrap()),
        Arc::new(|v: &serde_json::Value| v.get("ok") == Some(&true.into())),
    )
    .unwrap();
    let raw = executor
        .execute(
            provider.clone(),
            vec![candidate(a.clone(), "first"), candidate(b, "second")],
            deadline(),
        )
        .await
        .unwrap();
    assert_eq!(raw.attempts, 2);
    println!("cold: both candidates pre-funded; quota XML rotated key; 2 HTTP total");
    let record = RawRecord::new(
        "kma",
        "current",
        &storage::ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20261008,
            slot: "1200".into(),
        },
        100,
        raw.status,
        &raw.content_type,
        None,
        raw.body.clone().into(),
        &Limits::default(),
    )
    .unwrap();
    let id = CatalogId::for_record(&record.envelope.identity, "synthetic-s08").unwrap();
    let d = GroupDeclaration::new(
        vec![GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![id.clone()],
        }],
        &CatalogLimits::default(),
    )
    .unwrap();
    let catalogs = CatalogStore::new(transport(endpoint), CatalogLimits::default()).unwrap();
    catalogs.publish(d, vec![record], deadline()).await.unwrap();
    let fresh = CatalogStore::new(transport(endpoint), CatalogLimits::default()).unwrap();
    let LookupOutcome::Ready(set) = fresh.lookup(&id, deadline()).await.unwrap() else {
        panic!("complete raw group")
    };
    assert_eq!(
        set.acquisitions()[0].records()[0].bytes.as_ref(),
        raw.body.as_slice()
    );
    println!("caller publication: raw body + complete S06 group; fresh S3 lookup matches bytes");
    executor
        .execute(provider.clone(), vec![candidate(a, "first")], deadline())
        .await
        .unwrap();
    let replacement = store(endpoint, p);
    assert!(matches!(
        executor
            .execute(
                provider.clone(),
                vec![candidate(replacement, "first")],
                deadline()
            )
            .await,
        Err(AcquisitionError::Funding(BudgetError::Exhausted))
    ));
    println!(
        "replacement: old unused/issued funds never reclaimed; exhausted request sends 0 HTTP"
    );
    let r = policy("c");
    let mut fault: reqwest::Url = format!("{endpoint}__test/fault/error-after-put")
        .parse()
        .unwrap();
    fault
        .query_pairs_mut()
        .append_pair("key", &r.authority_key());
    assert_eq!(
        reqwest::Client::new()
            .post(fault)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        204
    );
    assert!(matches!(
        executor
            .execute(
                provider.clone(),
                vec![candidate(store(endpoint, r.clone()), "first")],
                deadline()
            )
            .await,
        Err(AcquisitionError::Funding(BudgetError::Unknown))
    ));
    executor
        .execute(
            provider.clone(),
            vec![candidate(store(endpoint, r), "first")],
            deadline(),
        )
        .await
        .unwrap();
    println!("unknown committed CAS: no HTTP; replacement reserves disjoint next range");
    println!(
        "PASS synthetic local release smoke; no AWS signature/IAM/latency or API parity claim"
    );
}
