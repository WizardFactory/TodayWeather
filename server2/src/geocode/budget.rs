//! Per-key upfront geocoder funding using S08 durable range ownership.
//!
//! Each configured key is its own quota owner with a daily limit. One S08 window covers one UTC
//! day; a new budget store is opened when the day changes (never restored). The process limits
//! are built in (S10e): legacy has no geocoder call budget setting.
use super::{GeoProvider, GeocodeError, GeocoderConfig, ProviderDemand, Quota};
use crate::budget::{BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider};
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio::{sync::Mutex as AsyncMutex, time::Instant};

const DAY_MS: i64 = 86_400_000;
/// Units per Kakao key and UTC day: the documented 카카오맵 REST API daily quota, "좌표로
/// 행정구역정보 변환 100,000건" and the same for 좌표로 주소 변환 / 주소로 좌표 변환
/// (<https://developers.kakao.com/docs/latest/ko/getting-started/quota>, read 2026-10-15).
pub const KAKAO_DAILY_UNITS: u64 = 100_000;
/// Units of the Google key per UTC day. Google documents no default daily quota for the
/// Geocoding API, only a free usage cap of 10,000 events per month for the Essentials
/// "Geocoding" SKU (<https://developers.google.com/maps/billing-and-pricing/pricing>, read
/// 2026-10-15); a 31-day share of it keeps every month inside that cap.
pub const GOOGLE_DAILY_UNITS: u64 = 10_000 / 31;
/// Units claimed from the S08 authority at a time (bounded by the daily limit).
const BLOCK_UNITS: u64 = 50;

/// One key's funding: provider, its index in the configured key list, the S08 quota owner
/// (64 lowercase hex) and the configured units per UTC day.
pub struct KeyQuota {
    pub provider: GeoProvider,
    pub key_index: usize,
    pub quota_id: String,
    pub daily_units: u64,
}
struct Entry<T> {
    quota: KeyQuota,
    window: AsyncMutex<Option<(i64, Arc<BudgetStore<T>>)>>,
}
pub struct FundedQuota<T> {
    transport: Arc<T>,
    clock: Arc<dyn Clock>,
    entries: Vec<Entry<T>>,
}
/// The quota owner of a key: domain-separated SHA-256, so it follows key rotation without a
/// separate setting and differs from the legacy log fingerprint.
pub fn quota_owner(provider: GeoProvider, key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-geocoder-quota-v1");
    hash.update([0u8]);
    hash.update(budget_provider(provider).path().as_bytes());
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
fn budget_provider(provider: GeoProvider) -> Provider {
    match provider {
        GeoProvider::Kakao => Provider::Kakao,
        GeoProvider::Google => Provider::Google,
    }
}
fn policy(q: &KeyQuota, starts_at_ms: i64) -> Option<BudgetPolicy> {
    let window_id = crate::world::js::iso(starts_at_ms as f64)?
        .get(..10)?
        .to_owned();
    Some(BudgetPolicy {
        provider: budget_provider(q.provider),
        quota_id: q.quota_id.clone(),
        window_id,
        starts_at_ms,
        ends_at_ms: starts_at_ms.checked_add(DAY_MS)?,
        limit: q.daily_units,
        block_units: q.daily_units.min(BLOCK_UNITS),
    })
}
impl<T: BudgetTransport> FundedQuota<T> {
    pub fn new(
        transport: Arc<T>,
        clock: Arc<dyn Clock>,
        keys: Vec<KeyQuota>,
    ) -> Result<Self, GeocodeError> {
        if keys.is_empty() || keys.len() > 33 {
            return Err(GeocodeError::InvalidConfiguration);
        }
        for (i, q) in keys.iter().enumerate() {
            let valid = policy(q, 0).is_some_and(|p| p.validate().is_ok());
            if !valid
                || q.key_index > 31
                || keys[..i].iter().any(|o| {
                    o.provider == q.provider
                        && (o.key_index == q.key_index || o.quota_id == q.quota_id)
                })
            {
                return Err(GeocodeError::InvalidConfiguration);
            }
        }
        Ok(Self {
            transport,
            clock,
            entries: keys
                .into_iter()
                .map(|quota| Entry {
                    quota,
                    window: AsyncMutex::new(None),
                })
                .collect(),
        })
    }
    /// Fund every configured key of `config`: Kakao keys with `kakao_daily_units` each and the
    /// Google key with `google_daily_units`. A provider with a key needs its limit.
    pub fn for_keys(
        transport: Arc<T>,
        clock: Arc<dyn Clock>,
        config: &GeocoderConfig,
        kakao_daily_units: Option<u64>,
        google_daily_units: Option<u64>,
    ) -> Result<Self, GeocodeError> {
        let mut keys = Vec::new();
        for (key_index, key) in config.kakao_keys.iter().enumerate() {
            keys.push(KeyQuota {
                provider: GeoProvider::Kakao,
                key_index,
                quota_id: quota_owner(GeoProvider::Kakao, key),
                daily_units: kakao_daily_units.ok_or(GeocodeError::InvalidConfiguration)?,
            });
        }
        if let Some(key) = &config.google_key {
            keys.push(KeyQuota {
                provider: GeoProvider::Google,
                key_index: 0,
                quota_id: quota_owner(GeoProvider::Google, key),
                daily_units: google_daily_units.ok_or(GeocodeError::InvalidConfiguration)?,
            });
        }
        Self::new(transport, clock, keys)
    }
    /// The store of the current UTC day for one key, opened when the day changes.
    async fn store(&self, entry: &Entry<T>) -> Result<Arc<BudgetStore<T>>, GeocodeError> {
        let now = self.clock.now_ms().map_err(|_| GeocodeError::Quota)?;
        let starts = now.div_euclid(DAY_MS) * DAY_MS;
        let mut window = entry.window.lock().await;
        if let Some((at, store)) = window.as_ref()
            && *at == starts
        {
            return Ok(store.clone());
        }
        let p = policy(&entry.quota, starts).ok_or(GeocodeError::Quota)?;
        let store = Arc::new(
            BudgetStore::new(self.transport.clone(), p, self.clock.clone())
                .map_err(|_| GeocodeError::Quota)?,
        );
        *window = Some((starts, store.clone()));
        Ok(store)
    }
}
impl<T: BudgetTransport + 'static> Quota for FundedQuota<T> {
    fn reserve(
        &self,
        demands: Vec<ProviderDemand>,
    ) -> Pin<Box<dyn Future<Output = Result<(), GeocodeError>> + Send + '_>> {
        Box::pin(async move {
            if demands.is_empty() || demands.len() > 33 {
                return Err(GeocodeError::Quota);
            }
            // Resolve every quota owner before any reservation. Failures never authorize HTTP.
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut work = Vec::with_capacity(demands.len());
            for (i, d) in demands.iter().enumerate() {
                if d.attempts == 0
                    || d.attempts > 3
                    || demands[..i]
                        .iter()
                        .any(|v| v.provider == d.provider && v.key_index == d.key_index)
                {
                    return Err(GeocodeError::Quota);
                }
                let entry = self
                    .entries
                    .iter()
                    .find(|e| e.quota.provider == d.provider && e.quota.key_index == d.key_index)
                    .ok_or(GeocodeError::Quota)?;
                let store = tokio::time::timeout_at(deadline, self.store(entry))
                    .await
                    .map_err(|_| GeocodeError::Quota)??;
                work.push((store, u64::from(d.attempts)));
            }
            let mut reservations = Vec::with_capacity(work.len());
            for (store, maximum) in &work {
                reservations.push((
                    store
                        .reserve(*maximum, deadline)
                        .await
                        .map_err(|_| GeocodeError::Quota)?,
                    *maximum,
                ));
            }
            // Consume the requested maxima conservatively; funded attempts are not refunded.
            for (mut reservation, maximum) in reservations {
                reservation
                    .consume(maximum, deadline)
                    .map_err(|_| GeocodeError::Quota)?;
            }
            Ok(())
        })
    }
}
