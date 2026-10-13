use server2::budget::{Authority, BudgetError, BudgetObject, BudgetTransport, Clock, Provider};
use server2::geocode::budget::{FundedQuota, KeyQuota, quota_owner};
use server2::geocode::{GeoProvider, GeocoderConfig, ProviderDemand, Quota};
use server2::storage::WriteCondition;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
};
/// Volatile budget peer (test double for the S3 budget objects).
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
/// Settable wall clock (test double).
struct Now(AtomicI64);
impl Clock for Now {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::Acquire))
    }
}
const DAY: i64 = 86_400_000;
const T0: i64 = 1_790_000_000_000; // 2026-09-21T14:13:20Z
fn key(provider: GeoProvider, index: usize, owner: char, units: u64) -> KeyQuota {
    KeyQuota {
        provider,
        key_index: index,
        quota_id: owner.to_string().repeat(64),
        daily_units: units,
    }
}
fn demand() -> Vec<ProviderDemand> {
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
}
fn used(wire: &Memory, provider: &str, owner: char, day: &str) -> u64 {
    let map = wire.0.lock().unwrap();
    let path = format!(
        "budgets/v2/{provider}/{}/{day}/authority.json",
        owner.to_string().repeat(64)
    );
    serde_json::from_slice::<Authority>(map.get(&path).expect("authority"))
        .unwrap()
        .used
}
#[tokio::test]
async fn every_key_is_prefunded_per_utc_day_without_refund() {
    let wire = Arc::new(Memory::default());
    let clock = Arc::new(Now(AtomicI64::new(T0)));
    let quota = FundedQuota::new(
        wire.clone(),
        clock.clone(),
        vec![
            key(GeoProvider::Kakao, 0, 'a', 2),
            key(GeoProvider::Google, 0, 'b', 2),
        ],
    )
    .unwrap();
    quota.reserve(demand()).await.unwrap();
    quota.reserve(demand()).await.unwrap();
    assert!(quota.reserve(demand()).await.is_err(), "daily limit");
    assert_eq!(used(&wire, "kakao", 'a', "2026-09-21"), 2);
    assert_eq!(used(&wire, "google", 'b', "2026-09-21"), 2);
    assert!(
        wire.0
            .lock()
            .unwrap()
            .keys()
            .all(|k| !k.contains("37.5") && !k.contains("secret"))
    );
    // An unconfigured key index is never funded.
    let unknown = vec![ProviderDemand {
        provider: GeoProvider::Google,
        key_index: 1,
        attempts: 1,
    }];
    assert!(quota.reserve(unknown).await.is_err());
    // The next UTC day is a new window with its own limit; the old window is kept.
    clock.0.store(T0 + DAY, Ordering::Release);
    quota.reserve(demand()).await.unwrap();
    // The first reservation of the new window claims one block (the 2-unit limit).
    assert_eq!(used(&wire, "kakao", 'a', "2026-09-22"), 2);
    assert_eq!(used(&wire, "kakao", 'a', "2026-09-21"), 2);
}
#[tokio::test]
async fn a_changed_limit_applies_from_the_next_utc_day_and_fails_closed_until_then() {
    let wire = Arc::new(Memory::default());
    let clock = Arc::new(Now(AtomicI64::new(T0)));
    let one = |units| vec![key(GeoProvider::Kakao, 0, 'a', units)];
    let kakao = || {
        vec![ProviderDemand {
            provider: GeoProvider::Kakao,
            key_index: 0,
            attempts: 1,
        }]
    };
    let first = FundedQuota::new(wire.clone(), clock.clone(), one(2)).unwrap();
    first.reserve(kakao()).await.unwrap();
    // A restart with another limit in the same window meets the stored S08 policy: denied.
    let changed = FundedQuota::new(wire.clone(), clock.clone(), one(3)).unwrap();
    assert!(changed.reserve(kakao()).await.is_err());
    clock.0.store(T0 + DAY, Ordering::Release);
    changed.reserve(kakao()).await.unwrap();
    assert_eq!(used(&wire, "kakao", 'a', "2026-09-22"), 3);
}
#[test]
fn quota_configuration_is_validated() {
    let wire = Arc::new(Memory::default());
    let clock = || Arc::new(Now(AtomicI64::new(T0)));
    let build = |keys| FundedQuota::new(wire.clone(), clock(), keys).is_ok();
    assert!(!build(vec![]), "no key");
    assert!(
        !build(vec![key(GeoProvider::Kakao, 0, 'a', 0)]),
        "zero limit"
    );
    assert!(!build(vec![KeyQuota {
        quota_id: "not-hex".into(),
        ..key(GeoProvider::Kakao, 0, 'a', 1)
    }]));
    assert!(
        !build(vec![
            key(GeoProvider::Kakao, 0, 'a', 1),
            key(GeoProvider::Kakao, 1, 'a', 1)
        ]),
        "shared owner"
    );
    assert!(
        !build(vec![
            key(GeoProvider::Kakao, 0, 'a', 1),
            key(GeoProvider::Kakao, 0, 'b', 1)
        ]),
        "repeated index"
    );
    assert!(build(vec![
        key(GeoProvider::Kakao, 0, 'a', 1),
        key(GeoProvider::Google, 0, 'a', 1)
    ]));
}
#[test]
fn configured_keys_need_their_daily_limits_and_derive_owners() {
    let wire = Arc::new(Memory::default());
    let clock = || Arc::new(Now(AtomicI64::new(T0)));
    let config = GeocoderConfig {
        kakao_keys: vec!["synthetic-kakao-a".into(), "synthetic-kakao-b".into()],
        google_key: Some("synthetic-google".into()),
        ..GeocoderConfig::default()
    };
    assert!(FundedQuota::for_keys(wire.clone(), clock(), &config, Some(10), Some(5)).is_ok());
    assert!(FundedQuota::for_keys(wire.clone(), clock(), &config, None, Some(5)).is_err());
    assert!(FundedQuota::for_keys(wire.clone(), clock(), &config, Some(10), None).is_err());
    let kakao_only = GeocoderConfig {
        google_key: None,
        ..config
    };
    assert!(FundedQuota::for_keys(wire.clone(), clock(), &kakao_only, Some(10), None).is_ok());
    let none = GeocoderConfig::default();
    assert!(FundedQuota::for_keys(wire, clock(), &none, Some(10), Some(5)).is_err());
    let a = quota_owner(GeoProvider::Kakao, "synthetic-kakao-a");
    assert_eq!(a.len(), 64);
    assert!(
        a.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    );
    assert_ne!(a, quota_owner(GeoProvider::Kakao, "synthetic-kakao-b"));
    assert_ne!(a, quota_owner(GeoProvider::Google, "synthetic-kakao-a"));
    assert!(!a.contains("synthetic"));
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
