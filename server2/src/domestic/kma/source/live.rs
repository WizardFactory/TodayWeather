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
//!
//! Built in (S10e, AK 2026-10-15: no server2-only settings): [`AIRKOREA_DAILY_UNITS`] S08 units
//! per key and KST day across the AirKorea operations server2 calls, and the production
//! data.go.kr root (`gateway::runtime::Builtins`).
use crate::budget::{BudgetPolicy, BudgetStore, BudgetTransport, Clock, Provider};
use crate::domestic::airkorea::AirKoreaRequest;
use crate::domestic::family::{Endpoints, Service};
use crate::domestic::metrics::DomesticMetrics;
use crate::domestic::{Acquired, DomesticAcquirer, KeyRing};
use crate::gateway::BoxFuture;
use crate::providers::{
    HttpProviderTransport, ProviderKey, ProviderTransport, ProviderTransportError, PublicTransport,
    legacy_timeout,
};
use crate::resolver::{OwnedConfig, OwnedFlights, Waited};
use crate::storage::{CatalogLimits, CatalogStore, CatalogTransport, Period};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// Legacy AirKorea client bound for one logical call (`airkoreaObservation`: 5 s per attempt,
/// one transient retry, 30 s per call).
pub const CALL_BUDGET: Duration = Duration::from_secs(30);
/// The AirKorea provider transport: 2 MiB bodies, and the legacy 5 s timer covers connecting
/// too (`airkoreaObservation` starts it before `https.get`), so a connection may take the whole
/// attempt (S13d `legacy_timeout::AIRKOREA`); the default transport connects within 3 s.
pub fn airkorea_transport() -> Result<HttpProviderTransport, ProviderTransportError> {
    HttpProviderTransport::with_connect_timeout(2 * 1024 * 1024, legacy_timeout::AIRKOREA)
}
/// S08 units per AirKorea key and KST day: the documented development-account traffic of
/// `B552584/ArpltnInforInqireSvc`, "개발계정 : 500" per operation
/// (<https://www.data.go.kr/data/15073861/openapi.do>, read 2026-10-15). One budget spans every
/// AirKorea operation server2 calls, so it never exceeds a single operation's allowance.
pub const AIRKOREA_DAILY_UNITS: u64 = 500;
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
    /// `AIRKOREA_SECRET_KEYS` (legacy name) with the built-in [`AIRKOREA_DAILY_UNITS`], at the
    /// given provider roots (production: `gateway::runtime::Builtins::production`). None without a
    /// usable key.
    pub fn from_vars(
        var: &dyn Fn(&str) -> Option<String>,
        endpoints: Endpoints,
    ) -> Result<Option<Self>, String> {
        let keys = var("AIRKOREA_SECRET_KEYS")
            .map(|v| crate::domestic::keys::parse_keys(&v))
            .unwrap_or_default();
        if keys.is_empty() {
            return Ok(None);
        }
        Ok(Some(Self {
            keys,
            daily_units: AIRKOREA_DAILY_UNITS,
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

/// The longest one owned AirKorea acquisition runs: the call budget plus publication.
pub const OWNED_FOR: Duration =
    Duration::from_secs(CALL_BUDGET.as_secs() + PUBLISH_BUDGET.as_secs());

type EndedAt = Arc<std::sync::Mutex<HashMap<String, std::time::Instant>>>;
/// Owned acquisitions per dataset key on the S13d [`OwnedFlights`], with the retry throttle of
/// this source: an acquisition that ended is not started again for `throttle`. Within the owned
/// table's retain window a late joiner still receives the outcome (it may have read the store
/// just before the owner published).
pub struct Flights {
    owned: OwnedFlights<String, bool>,
    ended: EndedAt,
    retain: Duration,
    throttle: Duration,
}
/// Records when an owned acquisition ended, also when its owner deadline dropped it.
struct Ended(EndedAt, String);
impl Drop for Ended {
    fn drop(&mut self) {
        let mut ended = self.0.lock().unwrap_or_else(|e| e.into_inner());
        ended.insert(std::mem::take(&mut self.1), std::time::Instant::now());
    }
}
impl Flights {
    pub fn new(throttle: Duration) -> Self {
        let config = OwnedConfig::default();
        let retain = config.retain;
        Self {
            owned: OwnedFlights::new(config).expect("default owned bounds are valid"),
            ended: Arc::default(),
            retain,
            throttle,
        }
    }
    /// Join the owned acquisition of `key`, starting it with `work` unless one ended within the
    /// throttle. The caller waits until `ready_by` (at most the S13d waiter bound); true when the
    /// acquisition published by then, so the caller reads the store again. A pending, failed,
    /// throttled or refused (`Busy`) acquisition is false: the caller answers with what it read.
    pub async fn join(
        &self,
        key: &str,
        ready_by: Instant,
        work: impl FnOnce() -> BoxFuture<'static, bool>,
    ) -> bool {
        self.join_for(key, ready_by, OWNED_FOR, work).await
    }
    /// [`join`](Self::join) for an acquisition owned for `owned_for` (at most the S13d
    /// `MAX_OWNED`).
    pub async fn join_for(
        &self,
        key: &str,
        ready_by: Instant,
        owned_for: Duration,
        work: impl FnOnce() -> BoxFuture<'static, bool>,
    ) -> bool {
        if self.throttled(key) {
            return false;
        }
        let start = self.start(key, work);
        matches!(
            self.owned
                .join(key.to_owned(), ready_by, owned_for, start)
                .await,
            Waited::Ready(true)
        )
    }
    /// Run (or join) the owned acquisition of `key` and wait until it ends (a background
    /// capture, never a request): true when it published.
    pub async fn run(
        &self,
        key: &str,
        owned_for: Duration,
        work: impl FnOnce() -> BoxFuture<'static, bool>,
    ) -> bool {
        if self.throttled(key) {
            return false;
        }
        let start = self.start(key, work);
        matches!(
            self.owned.wait(key.to_owned(), owned_for, start).await,
            Waited::Ready(true)
        )
    }
    /// An acquisition of `key` ended within the throttle (and past the retain window).
    fn throttled(&self, key: &str) -> bool {
        let mut ended = self.ended.lock().unwrap_or_else(|e| e.into_inner());
        ended.retain(|_, at| at.elapsed() < self.throttle);
        ended.get(key).is_some_and(|at| at.elapsed() >= self.retain)
    }
    fn start(
        &self,
        key: &str,
        work: impl FnOnce() -> BoxFuture<'static, bool>,
    ) -> impl FnOnce(Instant) -> BoxFuture<'static, bool> {
        let ended = self.ended.clone();
        let name = key.to_owned();
        move |_| {
            let work = work();
            Box::pin(async move {
                let _ended = Ended(ended, name);
                work.await
            })
        }
    }
}
