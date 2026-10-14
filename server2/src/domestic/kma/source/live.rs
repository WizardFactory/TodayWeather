//! S15b-3: request-time AirKorea acquisition for the KMA source.
//!
//! A request that needs a national AirKorea dataset that is not in S3 starts one owned
//! acquisition (S13b `DomesticAcquirer`, funded through S08) and publishes the complete group
//! through S06 before any request uses it. The request waits only until its own deadline; the
//! acquisition keeps running with the legacy AirKorea client bound (30 s per call) and stores
//! its result for the next request (AK, 2026-10-14).
//!
//! Settings (read only when `kma` is in `SERVER2_NATIVE_FAMILIES`):
//! - `AIRKOREA_SECRET_KEYS`: the legacy key list (a JSON array, `dataGoKrKeys.parse` rules).
//!   Without a key no AirKorea acquisition runs; stored records are still read.
//! - `SERVER2_AIRKOREA_DAILY_UNITS`: S08 units per key and KST day across the AirKorea
//!   operations server2 calls; required with a key. The provider's own limit is per operation
//!   (500 requests a day for a development account).
//! - `SERVER2_DATA_GO_KR_URL`: data.go.kr root, default `https://apis.data.go.kr/`.
use crate::budget::{BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider};
use crate::domestic::airkorea::AirKoreaRequest;
use crate::domestic::family::{Endpoints, Service};
use crate::domestic::metrics::DomesticMetrics;
use crate::domestic::{Acquired, DomesticAcquirer, KeyRing};
use crate::gateway::BoxFuture;
use crate::providers::{ProviderKey, ProviderTransport, PublicTransport};
use crate::storage::{CatalogLimits, CatalogStore, CatalogTransport, Period};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// Legacy AirKorea client bound for one logical call (`airkoreaObservation`: 5 s per attempt,
/// one transient retry, 30 s per call).
pub const CALL_BUDGET: Duration = Duration::from_secs(30);
/// Legacy AirKorea attempt bound (`airkoreaObservation`: `timeoutMs` 5,000 per attempt).
pub const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(5);
/// S06 publication bound after a complete acquisition.
const PUBLISH_BUDGET: Duration = Duration::from_secs(10);
const DAY_MS: i64 = 86_400_000;
const KST_MS: i64 = 9 * 3_600_000;

/// Acquire and publish one AirKorea dataset.
pub trait AirKoreaAcquire: Send + Sync + 'static {
    /// Ok(Some(period)): a new complete group of that record period was published; Ok(None):
    /// the provider had nothing new (no data, not published, or an older publication); Err: a
    /// failure (no record).
    fn acquire(
        &self,
        request: AirKoreaRequest,
    ) -> BoxFuture<'static, Result<Option<Period>, String>>;
}

/// Static provider settings of the AirKorea acquirer.
#[derive(Clone)]
pub struct AirKoreaSettings {
    /// Decoded keys in configuration order (legacy `withKeys` starts with the last one).
    pub keys: Vec<String>,
    pub daily_units: u64,
    pub endpoints: Endpoints,
}
impl std::fmt::Debug for AirKoreaSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AirKoreaSettings")
            .field("keys", &self.keys.len())
            .field("daily_units", &self.daily_units)
            .finish()
    }
}
impl AirKoreaSettings {
    /// `AIRKOREA_SECRET_KEYS`, `SERVER2_AIRKOREA_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL`.
    /// None without a usable key; Err for an invalid setting.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Option<Self>, String> {
        let keys = var("AIRKOREA_SECRET_KEYS")
            .map(|v| crate::domestic::keys::parse_keys(&v))
            .unwrap_or_default();
        if keys.is_empty() {
            return Ok(None);
        }
        let daily_units = var("SERVER2_AIRKOREA_DAILY_UNITS")
            .filter(|v| !v.is_empty())
            .ok_or("SERVER2_AIRKOREA_DAILY_UNITS is required with AIRKOREA_SECRET_KEYS")?
            .parse::<u64>()
            .ok()
            .filter(|u| *u > 0)
            .ok_or("SERVER2_AIRKOREA_DAILY_UNITS must be a positive integer")?;
        let root = var("SERVER2_DATA_GO_KR_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "https://apis.data.go.kr/".into());
        let endpoints = Endpoints::new(
            &root,
            "https://www.kma.go.kr/",
            "https://www.weather.go.kr/",
        )
        .map_err(|_| "SERVER2_DATA_GO_KR_URL must be an HTTPS (or loopback HTTP) root")?;
        Ok(Some(Self {
            keys,
            daily_units,
            endpoints,
        }))
    }
}
/// The S08 quota owner of one AirKorea key: a domain-separated SHA-256 (the key never leaves).
pub fn quota_owner(key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-airkorea-quota-v1");
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
/// The KST day window `[start, end)` and its id at `now_ms`.
fn kst_day(now_ms: i64) -> (i64, i64, String) {
    let start = (now_ms + KST_MS).div_euclid(DAY_MS) * DAY_MS - KST_MS;
    let date = crate::world::js::iso((start + KST_MS) as f64)
        .map(|i| i[..10].replace('-', ""))
        .unwrap_or_default();
    (start, start + DAY_MS, format!("kst-{date}"))
}

type Acquirer<P, W, B> = DomesticAcquirer<P, W, B>;
/// The KST day window id and its acquirer.
type DayAcquirer<P, W, B> = (String, Arc<Acquirer<P, W, B>>);
struct Inner<P, W, B, T> {
    settings: AirKoreaSettings,
    funded: Arc<P>,
    public: Arc<W>,
    budget: Arc<B>,
    store: Arc<CatalogStore<T>>,
    clock: Arc<dyn Clock>,
    metrics: Arc<DomesticMetrics>,
    /// The acquirer of the current KST day (S08 windows are per day).
    day: tokio::sync::Mutex<Option<DayAcquirer<P, W, B>>>,
}
/// The funded AirKorea acquirer with S06 publication.
pub struct LiveAirKorea<P, W, B, T> {
    inner: Arc<Inner<P, W, B, T>>,
}
impl<P, W, B, T> LiveAirKorea<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    pub fn new(
        settings: AirKoreaSettings,
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
        let entries = self
            .settings
            .keys
            .iter()
            .map(|key| {
                let policy = BudgetPolicy {
                    provider: Provider::DataGoKr,
                    quota_id: quota_owner(key),
                    window_id: window.clone(),
                    starts_at_ms: start,
                    ends_at_ms: end,
                    limit: units,
                    block_units: units.min(50),
                };
                let store = BudgetStore::new(self.budget.clone(), policy, self.clock.clone())
                    .map_err(|e| format!("budget: {e:?}"))?;
                let key = ProviderKey::new(key.clone()).map_err(|_| "invalid AirKorea key")?;
                Ok((key, Arc::new(store)))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let ring = KeyRing::new(entries).map_err(|e| e.to_string())?;
        let mut rings = BTreeMap::new();
        rings.insert(Service::AirKorea, ring);
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
    async fn run(&self, request: AirKoreaRequest) -> Result<Option<Period>, String> {
        let acquirer = self.acquirer().await?;
        let outcome = acquirer
            .acquire_airkorea(&request, Instant::now() + CALL_BUDGET)
            .await
            .map_err(|e| e.to_string())?;
        match outcome {
            Acquired::Complete(a) => {
                let period = a
                    .records
                    .first()
                    .map(|r| r.envelope.identity.period.clone());
                self.store
                    .publish(a.declaration, a.records, Instant::now() + PUBLISH_BUDGET)
                    .await
                    .map_err(|e| format!("publication: {e}"))?;
                Ok(period)
            }
            Acquired::NotPublished | Acquired::NoData | Acquired::Stale(_) => Ok(None),
        }
    }
}
impl<P, W, B, T> AirKoreaAcquire for LiveAirKorea<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    fn acquire(
        &self,
        request: AirKoreaRequest,
    ) -> BoxFuture<'static, Result<Option<Period>, String>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.run(request).await })
    }
}

/// One single-flight table: at most one owned acquisition per dataset key; a finished attempt
/// is not repeated within its throttle.
#[derive(Default)]
pub struct Flights {
    map: std::sync::Mutex<std::collections::HashMap<String, Flight>>,
}
struct Flight {
    started: std::time::Instant,
    done: tokio::sync::watch::Receiver<bool>,
}
impl Flights {
    /// The running flight of `key`, or a new owned one from `work` unless an attempt finished
    /// within `throttle`; then the finished flight is returned (its result may have arrived after
    /// the caller's read, so the caller reads again).
    pub fn start(
        &self,
        key: &str,
        throttle: Duration,
        work: impl FnOnce() -> BoxFuture<'static, ()>,
    ) -> Option<tokio::sync::watch::Receiver<bool>> {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = map.get(key)
            && (!*f.done.borrow() || f.started.elapsed() < throttle)
        {
            return Some(f.done.clone());
        }
        // Forget finished flights older than a day so the table stays small.
        map.retain(|_, f| !*f.done.borrow() || f.started.elapsed() < Duration::from_secs(86_400));
        let (tx, rx) = tokio::sync::watch::channel(false);
        let task = work();
        tokio::spawn(async move {
            task.await;
            let _ = tx.send(true);
        });
        map.insert(
            key.to_owned(),
            Flight {
                started: std::time::Instant::now(),
                done: rx.clone(),
            },
        );
        Some(rx)
    }
    /// Whether a flight of `key` is running.
    pub fn running(&self, key: &str) -> bool {
        let map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.get(key).is_some_and(|f| !*f.done.borrow())
    }
}
/// Wait for a flight until `deadline`; true when it finished.
pub async fn wait(rx: Option<tokio::sync::watch::Receiver<bool>>, deadline: Instant) -> bool {
    let Some(mut rx) = rx else { return false };
    tokio::time::timeout_at(deadline, rx.wait_for(|done| *done))
        .await
        .is_ok_and(|r| r.is_ok())
}
