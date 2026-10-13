use server2::budget::{
    Authority, BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock,
    Provider,
};
use server2::geocode::budget::FundedQuota;
use server2::geocode::{GeoProvider, ProviderDemand, Quota};
use server2::storage::WriteCondition;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
#[derive(Default)]
struct Memory(Mutex<BTreeMap<String, Vec<u8>>>);
impl BudgetTransport for Memory {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        self.0
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .map(|body| BudgetObject {
                body,
                etag: "\"1\"".into(),
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
        if matches!(condition, WriteCondition::Absent) && map.contains_key(key) {
            return Ok(412);
        }
        map.insert(key.into(), body.into());
        Ok(200)
    }
}
struct Now;
impl Clock for Now {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(10)
    }
}
fn policy(provider: Provider, key: char) -> BudgetPolicy {
    BudgetPolicy {
        provider,
        quota_id: key.to_string().repeat(64),
        window_id: "local_mock".into(),
        starts_at_ms: 1,
        ends_at_ms: 100,
        limit: 2,
        block_units: 1,
    }
}
#[tokio::test]
async fn every_key_is_prefunded_and_no_refund_or_replacement_quota() {
    let wire = Arc::new(Memory::default());
    let kp = policy(Provider::Kakao, 'a');
    let gp = policy(Provider::Google, 'b');
    let quota = FundedQuota::new(vec![
        (
            GeoProvider::Kakao,
            0,
            Arc::new(BudgetStore::new(wire.clone(), kp.clone(), Arc::new(Now)).unwrap()),
        ),
        (
            GeoProvider::Google,
            0,
            Arc::new(BudgetStore::new(wire.clone(), gp.clone(), Arc::new(Now)).unwrap()),
        ),
    ])
    .unwrap();
    let demand = || {
        vec![
            ProviderDemand {
                provider: GeoProvider::Kakao,
                key_index: 0,
                attempts: 1,
            },
            ProviderDemand {
                provider: GeoProvider::Google,
                key_index: 0,
                attempts: 1,
            },
        ]
    };
    quota.reserve(demand()).await.unwrap();
    quota.reserve(demand()).await.unwrap();
    assert!(quota.reserve(demand()).await.is_err());
    for p in [&kp, &gp] {
        let map = wire.0.lock().unwrap();
        let a: Authority = serde_json::from_slice(map.get(&p.authority_key()).unwrap()).unwrap();
        assert_eq!(a.used, 2);
        assert!(
            map.keys()
                .all(|k| !k.contains("37.5") && !k.contains("secret"))
        );
    }
    assert!(
        quota
            .reserve(vec![ProviderDemand {
                provider: GeoProvider::Google,
                key_index: 1,
                attempts: 1
            }])
            .await
            .is_err()
    );
}
#[test]
fn geocoder_identities_do_not_use_weather_transport_or_executor() {
    assert_eq!(Provider::Kakao.path(), "kakao");
    assert_eq!(Provider::Google.path(), "google");
    for provider in [Provider::Kakao, Provider::Google] {
        let transport = Arc::new(server2::providers::HttpProviderTransport::new(1024).unwrap());
        let executor = server2::providers::FundedExecutor::new(
            provider,
            1,
            transport,
            Arc::new(|_: &serde_json::Value| true),
        );
        assert!(matches!(
            executor,
            Err(server2::providers::AcquisitionError::Invalid)
        ));
    }
}
