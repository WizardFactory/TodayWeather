//! Offline B1 smoke: real Geocoder + S08 FundedQuota, owned HTTP, volatile budget objects.
//! Synthetic one-unit limits make authority counts readable; these are not production quotas.
use axum::{Router, body::Body, extract::State, http::Request, response::IntoResponse};
use server2::{
    budget::{Authority, BudgetError, BudgetObject, BudgetTransport, Clock},
    geocode::{
        GeoProvider, GeocodeError, Geocoder, GeocoderConfig, ProviderDemand, Quota,
        budget::{FundedQuota, KeyQuota},
    },
    storage::WriteCondition,
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

/// Owned in-memory S3 double with conditional ETags; never opens a remote connection.
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
        let current = map.get(key);
        let allowed = match condition {
            WriteCondition::Absent => current.is_none(),
            WriteCondition::Match(etag) => {
                current.is_some_and(|(_, version)| etag == &format!("\"{version}\""))
            }
        };
        if !allowed {
            return Ok(412);
        }
        let version = current.map_or(1, |(_, version)| version + 1);
        map.insert(key.into(), (body.into(), version));
        Ok(200)
    }
}
struct Now;
impl Clock for Now {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(1_790_000_000_000)
    }
}
fn used(wire: &Memory, provider: &str) -> u64 {
    wire.0
        .lock()
        .unwrap()
        .iter()
        .filter(|(key, _)| {
            key.starts_with(&format!("budgets/v2/{provider}/")) && key.ends_with("/authority.json")
        })
        .map(|(_, (body, _))| serde_json::from_slice::<Authority>(body).unwrap().used)
        .sum()
}
#[derive(Clone, Default)]
struct Peer {
    kakao: Arc<AtomicUsize>,
    google: Arc<AtomicUsize>,
}
async fn reply(State(peer): State<Peer>, request: Request<Body>) -> impl IntoResponse {
    if request.uri().path().starts_with("/maps/") {
        peer.google.fetch_add(1, Ordering::AcqRel);
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "unexpected Google HTTP".to_owned(),
        );
    }
    assert_eq!(
        request.headers().get("authorization").unwrap(),
        "KakaoAK synthetic-kakao"
    );
    peer.kakao.fetch_add(1, Ordering::AcqRel);
    let fixtures: serde_json::Value =
        serde_json::from_slice(include_bytes!("../tests/gateway/fixtures/providers.json")).unwrap();
    (
        axum::http::StatusCode::OK,
        fixtures["kakao.coord.space"].to_string(),
    )
}

#[tokio::main]
async fn main() {
    let wire = Arc::new(Memory::default());
    let quota = Arc::new(
        FundedQuota::new(
            wire.clone(),
            Arc::new(Now),
            vec![
                KeyQuota {
                    provider: GeoProvider::Kakao,
                    key_index: 0,
                    quota_id: "a".repeat(64),
                    daily_units: 1,
                },
                KeyQuota {
                    provider: GeoProvider::Google,
                    key_index: 0,
                    quota_id: "b".repeat(64),
                    daily_units: 1,
                },
            ],
        )
        .unwrap(),
    );
    quota
        .reserve(vec![ProviderDemand {
            provider: GeoProvider::Google,
            key_index: 0,
            attempts: 1,
        }])
        .await
        .unwrap();
    assert_eq!(used(&wire, "google"), 1);
    let peer = Peer::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new().fallback(reply).with_state(peer.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let geocoder = Geocoder::new(GeocoderConfig {
        kakao_base_url: root.clone(),
        google_base_url: root,
        kakao_keys: vec!["synthetic-kakao".into()],
        google_key: Some("synthetic-google".into()),
        cache_bytes: 8192,
        max_owners: 4,
    })
    .unwrap()
    .with_quota(quota);
    let cold = geocoder
        .coord([37.3, 127.0], "ko")
        .await
        .expect("Kakao-only cold lookup");
    assert_eq!(cold.country.as_deref(), Some("KR"));
    assert!(cold.kma_address.is_some());
    let warm = geocoder
        .coord([37.3, 127.0], "ko")
        .await
        .expect("warm cache");
    assert!(cold == warm);
    assert!(matches!(
        geocoder.coord([40.748, -73.985], "en").await,
        Err(GeocodeError::Quota)
    ));
    assert_eq!(peer.kakao.load(Ordering::Acquire), 1);
    assert_eq!(peer.google.load(Ordering::Acquire), 0);
    assert_eq!(used(&wire, "kakao"), 1);
    assert_eq!(used(&wire, "google"), 1);
    server.abort();
    assert!(server.await.unwrap_err().is_cancelled());
    println!(
        "{}",
        serde_json::json!({
            "verdict": "PASS", "scope": "owned-http-volatile-budget", "live_provider_calls": 0,
            "kakao_http": 1, "google_http": 0, "google_authority_before": 1, "google_authority_after": 1,
            "kakao_authority_after": 1, "synthetic_daily_limit": 1, "warm_matches_cold": true,
            "kma_projection_preserved": true, "foreign_google_denied_without_http": true,
            "production_eligible": false
        })
    );
}
