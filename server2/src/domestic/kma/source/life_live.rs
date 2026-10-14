//! S15b-3b: owned acquisitions of the life datasets for the KMA source.
//!
//! UV V5 and pollen V3 (all areas, S13 `DataGoKrRequest`), KASI area rise/set (S13a
//! `RiseSetRequest`) and the keyless MFDS table ([`crate::domestic::mfds`]). Each complete group is
//! published through S06 before any request uses it.
//!
//! Settings (read only when `kma` is in `SERVER2_NATIVE_FAMILIES`):
//! - `DONGNAE_SECRET_KEYS`: the legacy data.go.kr key list of the life index and KASI
//!   (`lifeIndexKmaRequester`, `kasiRiseSet`). Without a key only MFDS is acquired.
//! - `SERVER2_DONGNAE_DAILY_UNITS`: S08 units per key, service and KST day; required with a key.
//! - `SERVER2_DATA_GO_KR_URL`: data.go.kr root (shared with S15b-3a).
//! - `SERVER2_MFDS_URL`: MFDS root, default `https://poisonmap.mfds.go.kr/`.
use crate::budget::{BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider};
use crate::domestic::family::{DataGoKrRequest, Endpoints, Service, owned_provider_time};
use crate::domestic::metrics::DomesticMetrics;
use crate::domestic::mfds::MfdsRequest;
use crate::domestic::riseset::RiseSetRequest;
use crate::domestic::{Acquired, DomesticAcquirer, KeyRing};
use crate::gateway::BoxFuture;
use crate::providers::{ProviderKey, ProviderTransport, PublicTransport};
use crate::storage::{CatalogLimits, CatalogStore, CatalogTransport};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// S06 publication bound after a complete acquisition.
const PUBLISH_BUDGET: Duration = Duration::from_secs(10);
const DAY_MS: i64 = 86_400_000;
const KST_MS: i64 = 9 * 3_600_000;

/// One owned life acquisition.
#[derive(Debug, Clone)]
pub enum LifeRequest {
    /// UV V5 or a pollen V3 index of all areas.
    Index(DataGoKrRequest),
    RiseSet(RiseSetRequest),
    /// The MFDS table of one collection slot (08:20, 12:20 or 17:20 KST).
    Mfds(crate::domestic::publication::Publication),
}
impl LifeRequest {
    /// The provider time the owned acquisition allows (two legacy attempts per page) plus its
    /// publication.
    pub fn owned_for(&self) -> Duration {
        let provider = match self {
            Self::Index(r) => owned_provider_time(
                r.family().service().attempt_timeout(),
                r.family().max_pages(),
            ),
            Self::RiseSet(_) => owned_provider_time(Service::RiseSet.attempt_timeout(), 1),
            Self::Mfds(_) => crate::domestic::mfds::TIMEOUT,
        };
        provider + PUBLISH_BUDGET
    }
}
/// What one owned acquisition did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifeOutcome {
    /// A new complete group was published.
    Published,
    /// The provider answered no data for the request (`03`/`99`: e.g. out of season).
    NoData,
    /// Nothing new (not published yet or an older publication).
    Nothing,
}
/// Acquire and publish one life dataset.
pub trait LifeAcquire: Send + Sync + 'static {
    fn acquire(&self, request: LifeRequest) -> BoxFuture<'static, Result<LifeOutcome, String>>;
    /// Whether data.go.kr keys are configured (UV, pollen and KASI need one; MFDS does not).
    fn funded(&self) -> bool;
}

/// Static provider settings of the life acquirer.
#[derive(Clone)]
pub struct LifeSettings {
    pub keys: Vec<String>,
    pub daily_units: u64,
    pub endpoints: Endpoints,
    pub mfds_root: reqwest::Url,
}
impl std::fmt::Debug for LifeSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LifeSettings")
            .field("keys", &self.keys.len())
            .field("daily_units", &self.daily_units)
            .finish()
    }
}
impl LifeSettings {
    /// `DONGNAE_SECRET_KEYS`, `SERVER2_DONGNAE_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL`,
    /// `SERVER2_MFDS_URL`. Err for an invalid setting.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, String> {
        let keys = var("DONGNAE_SECRET_KEYS")
            .map(|v| crate::domestic::keys::parse_keys(&v))
            .unwrap_or_default();
        let daily_units = if keys.is_empty() {
            0
        } else {
            var("SERVER2_DONGNAE_DAILY_UNITS")
                .filter(|v| !v.is_empty())
                .ok_or("SERVER2_DONGNAE_DAILY_UNITS is required with DONGNAE_SECRET_KEYS")?
                .parse::<u64>()
                .ok()
                .filter(|u| *u > 0)
                .ok_or("SERVER2_DONGNAE_DAILY_UNITS must be a positive integer")?
        };
        let root = var("SERVER2_DATA_GO_KR_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "https://apis.data.go.kr/".into());
        let endpoints = Endpoints::new(
            &root,
            "https://www.kma.go.kr/",
            "https://www.weather.go.kr/",
        )
        .map_err(|_| "SERVER2_DATA_GO_KR_URL must be an HTTPS (or loopback HTTP) root")?;
        let mfds = var("SERVER2_MFDS_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| crate::domestic::mfds::DEFAULT_ROOT.into());
        let mfds_root = reqwest::Url::parse(&mfds)
            .ok()
            .filter(|u| {
                crate::providers::PublicRequest::new(u.clone()).is_ok()
                    && u.path().ends_with('/')
                    && u.query().is_none()
            })
            .ok_or("SERVER2_MFDS_URL must be an HTTPS (or loopback HTTP) root")?;
        Ok(Self {
            keys,
            daily_units,
            endpoints,
            mfds_root,
        })
    }
}
/// The S08 quota owner of one data.go.kr key for one service: a domain-separated SHA-256 (the
/// key never leaves).
pub fn quota_owner(service: Service, key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-dongnae-quota-v1");
    hash.update([0u8]);
    hash.update(format!("{service:?}").as_bytes());
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
fn kst_day(now_ms: i64) -> (i64, i64, String) {
    let start = (now_ms + KST_MS).div_euclid(DAY_MS) * DAY_MS - KST_MS;
    let date = crate::world::js::iso((start + KST_MS) as f64)
        .map(|i| i[..10].replace('-', ""))
        .unwrap_or_default();
    (start, start + DAY_MS, format!("kst-{date}"))
}

type Acquirer<P, W, B> = DomesticAcquirer<P, W, B>;
type DayAcquirer<P, W, B> = (String, Arc<Acquirer<P, W, B>>);
struct Inner<P, W, B, T> {
    settings: LifeSettings,
    funded: Arc<P>,
    public: Arc<W>,
    budget: Arc<B>,
    store: Arc<CatalogStore<T>>,
    clock: Arc<dyn Clock>,
    metrics: Arc<DomesticMetrics>,
    day: tokio::sync::Mutex<Option<DayAcquirer<P, W, B>>>,
}
/// The life acquirer with S06 publication.
pub struct LiveLife<P, W, B, T> {
    inner: Arc<Inner<P, W, B, T>>,
}
impl<P, W, B, T> LiveLife<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    pub fn new(
        settings: LifeSettings,
        funded: Arc<P>,
        public: Arc<W>,
        budget: Arc<B>,
        store: Arc<CatalogStore<T>>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                settings,
                funded,
                public,
                budget,
                store,
                clock,
                metrics: Arc::new(DomesticMetrics::default()),
                day: tokio::sync::Mutex::new(None),
            }),
        }
    }
    pub fn metrics(&self) -> &DomesticMetrics {
        &self.inner.metrics
    }
}
impl<P, W, B, T> Inner<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    /// The acquirer of the current KST day (S08 windows are per day); one ring per service.
    async fn acquirer(&self) -> Result<Arc<Acquirer<P, W, B>>, String> {
        let now = self.clock.now_ms().map_err(|e| format!("clock: {e:?}"))?;
        let (start, end, window) = kst_day(now);
        let mut day = self.day.lock().await;
        if let Some((id, a)) = day.as_ref()
            && *id == window
        {
            return Ok(a.clone());
        }
        let units = self.settings.daily_units;
        let mut rings = BTreeMap::new();
        if !self.settings.keys.is_empty() {
            for service in [
                Service::LivingWthrIdx,
                Service::HealthWthrIdx,
                Service::RiseSet,
            ] {
                let entries = self
                    .settings
                    .keys
                    .iter()
                    .map(|key| {
                        let policy = BudgetPolicy {
                            provider: Provider::DataGoKr,
                            quota_id: quota_owner(service, key),
                            window_id: window.clone(),
                            starts_at_ms: start,
                            ends_at_ms: end,
                            limit: units,
                            block_units: units.min(50),
                        };
                        let store =
                            BudgetStore::new(self.budget.clone(), policy, self.clock.clone())
                                .map_err(|e| format!("budget: {e:?}"))?;
                        let key =
                            ProviderKey::new(key.clone()).map_err(|_| "invalid data.go.kr key")?;
                        Ok((key, Arc::new(store)))
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                rings.insert(service, KeyRing::new(entries).map_err(|e| e.to_string())?);
            }
        }
        let acquirer = Arc::new(
            DomesticAcquirer::new(
                self.funded.clone(),
                self.public.clone(),
                rings,
                self.settings.endpoints.clone(),
                self.clock.clone(),
                self.metrics.clone(),
                CatalogLimits::default(),
            )
            .map_err(|e| e.to_string())?,
        );
        *day = Some((window, acquirer.clone()));
        Ok(acquirer)
    }
    async fn run(&self, request: LifeRequest) -> Result<LifeOutcome, String> {
        let acquirer = self.acquirer().await?;
        let deadline = Instant::now() + request.owned_for() - PUBLISH_BUDGET;
        let outcome = match &request {
            LifeRequest::Index(r) => acquirer.acquire(r, deadline).await,
            LifeRequest::RiseSet(r) => acquirer.acquire_rise_set(r, deadline).await,
            LifeRequest::Mfds(slot) => {
                let request =
                    MfdsRequest::new(&self.settings.mfds_root, *slot).map_err(|e| e.to_string())?;
                acquirer.acquire_mfds(&request, deadline).await
            }
        }
        .map_err(|e| e.to_string())?;
        match outcome {
            Acquired::Complete(a) => {
                self.store
                    .publish(a.declaration, a.records, Instant::now() + PUBLISH_BUDGET)
                    .await
                    .map_err(|e| format!("publication: {e}"))?;
                Ok(LifeOutcome::Published)
            }
            Acquired::NoData => Ok(LifeOutcome::NoData),
            Acquired::NotPublished | Acquired::Stale(_) => Ok(LifeOutcome::Nothing),
        }
    }
}
impl<P, W, B, T> LifeAcquire for LiveLife<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    fn acquire(&self, request: LifeRequest) -> BoxFuture<'static, Result<LifeOutcome, String>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.run(request).await })
    }
    fn funded(&self) -> bool {
        !self.inner.settings.keys.is_empty()
    }
}
