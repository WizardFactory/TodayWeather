//! Owned HTTP + real domestic acquisition/S08 logic; no live keys, S3 or providers.
use axum::{
    Router,
    extract::{Request, State},
    routing::get,
};
use serde_json::json;
use server2::{
    budget::{
        BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider,
    },
    domestic::{
        Acquired, DomesticAcquirer, KeyRing,
        family::{DataGoKrFamily, DataGoKrRequest, Endpoints, Service, Target},
        metrics::DomesticMetrics,
        publication::Publication,
    },
    providers::{HttpProviderTransport, HttpPublicTransport, ProviderKey},
    storage::{CatalogLimits, WriteCondition},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::Instant;

const KEY_A: &str = "B2_OWNED_SMOKE_KEY_A+aaaaaaaaaaaaaaaa/=";
const KEY_B: &str = "B2_OWNED_SMOKE_KEY_B+bbbbbbbbbbbbbbbb/=";
const NOW: i64 = 1_791_868_800_000;
#[derive(Default)]
struct Memory(Mutex<BTreeMap<String, (Vec<u8>, u64)>>);
impl BudgetTransport for Memory {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        self.0
            .lock()
            .unwrap()
            .get(key)
            .map(|(body, version)| BudgetObject {
                body: body.clone(),
                etag: format!("\"{version}\""),
            })
            .ok_or(BudgetError::NotFound)
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        let mut map = self.0.lock().unwrap();
        let valid = match (condition, map.get(key)) {
            (WriteCondition::Absent, None) => true,
            (WriteCondition::Match(tag), Some((_, version))) => *tag == format!("\"{version}\""),
            _ => false,
        };
        if !valid {
            return Ok(412);
        }
        let version = map.get(key).map_or(1, |(_, v)| v + 1);
        map.insert(key.into(), (body.to_vec(), version));
        Ok(200)
    }
}
struct Fixed;
impl Clock for Fixed {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(NOW)
    }
}
#[derive(Default)]
struct Peer {
    calls: Mutex<Vec<String>>,
}
async fn provider(State(peer): State<Arc<Peer>>, request: Request) -> Vec<u8> {
    let url: reqwest::Url = format!("http://127.0.0.1{}", request.uri())
        .parse()
        .unwrap();
    let key = url
        .query_pairs()
        .find(|(k, _)| k == "serviceKey")
        .unwrap()
        .1
        .into_owned();
    assert!(key == KEY_A || key == KEY_B);
    peer.calls.lock().unwrap().push(key);
    serde_json::to_vec(&json!({"response":{
        "header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"dataType":"JSON","pageNo":1,"numOfRows":999,"totalCount":1,
            "items":{"item":[{"baseDate":"20261013","baseTime":"1400",
                "category":"TMP","fcstDate":"20261013","fcstTime":"1500",
                "fcstValue":"17","nx":60,"ny":127}]}}
    }}))
    .unwrap()
}
fn end() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
async fn scenario(base: &str, peer: &Peer, spent_a: bool) -> serde_json::Value {
    let wire = Arc::new(Memory::default());
    let clock = Arc::new(Fixed);
    let mut entries = Vec::new();
    let mut authority_keys = Vec::new();
    for (key, owner, limit) in [(KEY_A, 'a', 1), (KEY_B, 'b', 3)] {
        let store = Arc::new(
            BudgetStore::new(
                wire.clone(),
                BudgetPolicy {
                    provider: Provider::DataGoKr,
                    quota_id: owner.to_string().repeat(64),
                    window_id: "b2_owned_smoke".into(),
                    starts_at_ms: 1,
                    ends_at_ms: i64::MAX,
                    limit,
                    block_units: 1,
                },
                clock.clone(),
            )
            .unwrap(),
        );
        authority_keys.push(store.policy().authority_key());
        if owner == 'a' && spent_a {
            drop(store.reserve(1, end()).await.unwrap());
        }
        entries.push((ProviderKey::new(key.into()).unwrap(), store));
    }
    let metrics = Arc::new(DomesticMetrics::default());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(1024 * 1024).unwrap()),
        BTreeMap::from([(Service::VilageFcst, KeyRing::new(entries).unwrap())]),
        Endpoints::new(base, base, base).unwrap(),
        clock,
        metrics.clone(),
        CatalogLimits::default(),
    )
    .unwrap();
    let request = DataGoKrRequest::new(
        DataGoKrFamily::VilageFcst,
        Target::Grid { nx: 60, ny: 127 },
        Publication::new(20261013, 1400).unwrap(),
    )
    .unwrap();
    let before = peer.calls.lock().unwrap().len();
    let count = if spent_a { 2 } else { 1 };
    for _ in 0..count {
        let Acquired::Complete(records) = acquirer.acquire(&request, end()).await.unwrap() else {
            panic!("complete page required")
        };
        assert_eq!(records.records.len(), 1);
    }
    let calls = peer.calls.lock().unwrap()[before..].to_vec();
    assert_eq!(calls, vec![if spent_a { KEY_B } else { KEY_A }; count]);
    let m = metrics.snapshot();
    assert_eq!(m.reserved_units, count as u64);
    assert_eq!(m.funded_attempts, count as u64);
    assert_eq!(m.attempts_quota, 0);
    assert_eq!(
        acquirer.ring(Service::VilageFcst).unwrap().current(),
        usize::from(spent_a)
    );
    let objects = wire.0.lock().unwrap();
    let total_authority_used: u64 = authority_keys
        .iter()
        .filter_map(|key| objects.get(key))
        .map(|(body, _)| {
            serde_json::from_slice::<serde_json::Value>(body).unwrap()["used"]
                .as_u64()
                .unwrap()
        })
        .sum();
    assert_eq!(total_authority_used, count as u64 + u64::from(spent_a));
    if !spent_a {
        assert!(!objects.contains_key(&authority_keys[1]));
    }
    json!({"local_a_exhausted":spent_a,"completed_pages":count,"http_attempts":calls.len(),
        "logical_reserved_units":m.reserved_units,"provider_quota_outcomes":m.attempts_quota,
        "remembered_key_index":acquirer.ring(Service::VilageFcst).unwrap().current(),
        "authority_used":total_authority_used})
}
#[tokio::main]
async fn main() {
    let peer = Arc::new(Peer::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap());
    let router = Router::new()
        .route(
            "/1360000/VilageFcstInfoService_2.0/getVilageFcst",
            get(provider),
        )
        .with_state(peer.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let fresh = scenario(&base, &peer, false).await;
    let rotated = scenario(&base, &peer, true).await;
    task.abort();
    let _ = task.await;
    println!(
        "{}",
        serde_json::to_string(&json!({"verdict":"PASS","scope":"owned-http-volatile-s08",
        "fresh_first_key":fresh,"known_exhaustion_rotation":rotated,
        "owned_http_total":peer.calls.lock().unwrap().len(),"live_provider_calls":0,
        "live_actions":false,"production_eligible":false}))
        .unwrap()
    );
}
