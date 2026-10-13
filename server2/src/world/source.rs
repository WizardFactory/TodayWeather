//! Visual Crossing Timeline acquisition at the cell centre, funded through S08 before HTTP.
use super::{
    Cell, Range,
    js::num_string,
    transport::{VcTransport, VcTransportError},
};
use crate::{
    budget::{
        BudgetError, BudgetPolicy, BudgetStore, BudgetTransport, Clock as BudgetClock, Provider,
        Reservation,
    },
    gateway::BoxFuture,
    providers::{AcquisitionError, ProviderKey},
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::Semaphore,
    time::{Instant, sleep, timeout_at},
};

pub const ELEMENTS: [&str; 25] = [
    "datetime",
    "datetimeEpoch",
    "temp",
    "tempmax",
    "tempmin",
    "feelslike",
    "feelslikemax",
    "feelslikemin",
    "humidity",
    "precip",
    "precipprob",
    "preciptype",
    "snow",
    "windspeed",
    "winddir",
    "pressure",
    "visibility",
    "uvindex",
    "cloudcover",
    "conditions",
    "icon",
    "source",
    "sunriseEpoch",
    "sunsetEpoch",
    "moonphase",
];
/// Provider outcome classes that change the legacy chain.
#[derive(Debug, Clone, PartialEq)]
pub enum VcError {
    /// Funding denied for this range; `retry_at_ms` is the funding window end.
    Exhausted { retry_at_ms: f64 },
    /// Rejected credentials (legacy providerDown for 401/403).
    ProviderDown,
    /// Transport/status/deadline failure without a usable billed body.
    Failed,
    /// Providers are disabled for this process (restore-only mode).
    Disabled,
}
pub trait VcSource: Send + Sync + 'static {
    /// Fetch one range for the cell centre; the bytes are the exact provider body.
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>>;
    /// Funding eligibility for `range` without provider HTTP: `Some(retry_at_ms)` when the
    /// funding window is exhausted (legacy `_checkProvider` budget check), else `None`.
    fn eligible(&self, _range: Range) -> BoxFuture<'_, Option<f64>> {
        Box::pin(async { None })
    }
}
/// No provider access: S3/memory only.
pub struct Disabled;
impl VcSource for Disabled {
    fn fetch(&self, _: Cell, _: Range, _: Instant) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async { Err(VcError::Disabled) })
    }
}
/// `formatCoordinate`: plain decimal with at most 6 decimals.
pub fn coordinate(v: f64) -> String {
    num_string(super::js::fixed(v, 6))
}
/// Timeline URL for the cell centre without the key (the transport appends `key`).
pub fn timeline_url(base: &str, cell: Cell, range: Range) -> String {
    format!(
        "{}{},{}/{}?unitGroup=us&lang=en&include=days,hours,current&elements={}",
        base,
        coordinate(cell.lat),
        coordinate(cell.lon),
        range.path(),
        ELEMENTS.join(",")
    )
}
/// Legacy `vcRequester` retry constants: one retry after 300 ms for a concurrency 429 seen
/// within 1.5 s of the call start or for a reset socket, when more than 300 ms remain.
const RETRY_DELAY: Duration = Duration::from_millis(300);
const RETRY_WINDOW: Duration = Duration::from_millis(1500);
/// Bound on how long an eligibility probe may hold a waiter (the probe itself continues).
const PROBE_WAIT: Duration = Duration::from_millis(1500);
const DAY_MS: i64 = 86_400_000;
fn concurrency_429(body: &[u8]) -> bool {
    String::from_utf8_lossy(body)
        .to_ascii_lowercase()
        .contains("concurren")
}
fn limit_429(body: &[u8]) -> bool {
    let text = String::from_utf8_lossy(body).to_ascii_lowercase();
    [
        "daily", "monthly", "per day", "usage", "quota", "cost", "records",
    ]
    .iter()
    .any(|w| text.contains(w))
}
/// Records billed per range (`combined` 49, `recent` 25, `forecast` 1); two attempts are funded.
pub fn units(range: Range) -> u64 {
    match range {
        Range::Combined => 49,
        Range::Recent => 25,
        Range::Forecast => 1,
    }
}
/// S08 funding inputs for the daily (UTC) Visual Crossing record window, the legacy usage day.
pub struct VcFunding<T> {
    pub transport: Arc<T>,
    pub quota_id: String,
    pub daily_units: u64,
    pub block_units: u64,
    pub clock: Arc<dyn BudgetClock>,
}
impl<T> VcFunding<T> {
    fn policy(&self, starts_at_ms: i64) -> Option<BudgetPolicy> {
        let window_id = super::js::iso(starts_at_ms as f64)?.get(..10)?.to_owned();
        Some(BudgetPolicy {
            provider: Provider::VisualCrossing,
            quota_id: self.quota_id.clone(),
            window_id,
            starts_at_ms,
            ends_at_ms: starts_at_ms + DAY_MS,
            limit: self.daily_units,
            block_units: self.block_units,
        })
    }
}
/// One funding window: its own S08 store (never restored across windows), funded reservations
/// kept from eligibility probes for the next fetch of that range, and observed exhaustion.
struct Window<T> {
    starts_at_ms: i64,
    budget: Arc<BudgetStore<T>>,
    pool: HashMap<Range, Reservation>,
    probing: HashSet<Range>,
    exhausted: HashSet<Range>,
}
type Windows<T> = Arc<Mutex<Option<Window<T>>>>;
/// S08-funded Visual Crossing source with the legacy `vcRequester` policy. Two attempts
/// (98/50/2 units) are reserved before any HTTP; only a concurrency 429 or a reset socket is
/// retried, a 401/403 or a limit 429 marks the provider down, and every 2xx body is returned for
/// engine validation (an unusable billed body backs off 15 minutes there).
pub struct FundedVc<P, T> {
    base: String,
    key: String,
    transport: Arc<P>,
    funding: VcFunding<T>,
    window: Windows<T>,
    admission: Arc<Semaphore>,
}
impl<P: VcTransport, T: BudgetTransport + 'static> FundedVc<P, T> {
    pub fn new(
        base: &str,
        transport: Arc<P>,
        funding: VcFunding<T>,
        key: String,
    ) -> Result<Self, AcquisitionError> {
        let url = reqwest::Url::parse(base).map_err(|_| AcquisitionError::Invalid)?;
        if !base.ends_with('/')
            || url.query().is_some()
            || !(url.scheme() == "https"
                || (url.scheme() == "http"
                    && url
                        .host_str()
                        .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
                        .is_some_and(|ip| ip.is_loopback())))
        {
            return Err(AcquisitionError::Invalid);
        }
        ProviderKey::new(key.clone())?;
        funding
            .policy(0)
            .ok_or(AcquisitionError::Invalid)?
            .validate()
            .map_err(|_| AcquisitionError::Invalid)?;
        Ok(Self {
            base: base.to_owned(),
            key,
            transport,
            funding,
            window: Arc::new(Mutex::new(None)),
            admission: Arc::new(Semaphore::new(4)),
        })
    }
    /// The current UTC-day window's store, creating a fresh one when the day changed.
    fn current(&self) -> Result<(i64, Arc<BudgetStore<T>>), VcError> {
        let now = self.funding.clock.now_ms().map_err(|_| VcError::Failed)?;
        let starts = now.div_euclid(DAY_MS) * DAY_MS;
        let mut guard = self.window.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = guard.as_ref().filter(|w| w.starts_at_ms == starts) {
            return Ok((starts, w.budget.clone()));
        }
        let policy = self.funding.policy(starts).ok_or(VcError::Failed)?;
        let budget = Arc::new(
            BudgetStore::new(
                self.funding.transport.clone(),
                policy,
                self.funding.clock.clone(),
            )
            .map_err(|_| VcError::Failed)?,
        );
        *guard = Some(Window {
            starts_at_ms: starts,
            budget: budget.clone(),
            pool: HashMap::new(),
            probing: HashSet::new(),
            exhausted: HashSet::new(),
        });
        Ok((starts, budget))
    }
    fn with_window<R>(&self, starts: i64, f: impl FnOnce(&mut Window<T>) -> R) -> Option<R> {
        settle(&self.window, starts, f)
    }
    /// A pooled reservation for the range, or a new one for both attempts.
    async fn funds(&self, range: Range, deadline: Instant) -> Result<Reservation, VcError> {
        let (starts, budget) = self.current()?;
        if let Some(r) = self
            .with_window(starts, |w| w.pool.remove(&range))
            .flatten()
        {
            return Ok(r);
        }
        let end = (starts + DAY_MS) as f64;
        match budget.reserve(units(range) * 2, deadline).await {
            Ok(r) => Ok(r),
            // A range larger than the remaining units or the policy block cannot be funded
            // in this window: the legacy daily-budget (EVCBUDGET) path.
            Err(BudgetError::Exhausted | BudgetError::Invalid(_)) => {
                self.with_window(starts, |w| w.exhausted.insert(range));
                Err(VcError::Exhausted { retry_at_ms: end })
            }
            Err(_) => Err(VcError::Failed),
        }
    }
}
fn settle<T, R>(
    window: &Mutex<Option<Window<T>>>,
    starts: i64,
    f: impl FnOnce(&mut Window<T>) -> R,
) -> Option<R> {
    let mut guard = window.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_mut().filter(|w| w.starts_at_ms == starts).map(f)
}
impl<P: VcTransport, T: BudgetTransport + 'static> VcSource for FundedVc<P, T> {
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            let units = units(range);
            let mut url = reqwest::Url::parse(&timeline_url(&self.base, cell, range))
                .map_err(|_| VcError::Failed)?;
            url.query_pairs_mut().append_pair("key", &self.key);
            let _admission = timeout_at(deadline, self.admission.clone().acquire_owned())
                .await
                .map_err(|_| VcError::Failed)?
                .map_err(|_| VcError::Failed)?;
            let started = Instant::now();
            // Fund both permitted attempts before any HTTP; no refunds or late reservations.
            let mut funds = self.funds(range, deadline).await?;
            for attempt in 1..=2 {
                funds
                    .consume(units, deadline)
                    .map_err(|_| VcError::Failed)?;
                let result = self.transport.get(url.clone(), deadline).await;
                let time_left = deadline.saturating_duration_since(Instant::now()) > RETRY_DELAY;
                let retry = attempt == 1 && time_left;
                let response = match result {
                    Err(VcTransportError::Reset) if retry => {
                        sleep(RETRY_DELAY).await;
                        continue;
                    }
                    Err(_) => return Err(VcError::Failed),
                    Ok(r) => r,
                };
                match response.status {
                    429 if concurrency_429(&response.body) => {
                        if retry && started.elapsed() < RETRY_WINDOW {
                            sleep(RETRY_DELAY).await;
                            continue;
                        }
                        return Err(VcError::Failed);
                    }
                    429 if limit_429(&response.body) => return Err(VcError::ProviderDown),
                    401 | 403 => return Err(VcError::ProviderDown),
                    200..=299 => return Ok(response.body),
                    _ => return Err(VcError::Failed),
                }
            }
            Err(VcError::Failed)
        })
    }
    /// `_checkProvider` budget part without HTTP: a window known exhausted, a pooled
    /// reservation, or a probe that funds both attempts and keeps them for the next fetch of
    /// this range (no reservation is discarded by the probe itself).
    fn eligible(&self, range: Range) -> BoxFuture<'_, Option<f64>> {
        Box::pin(async move {
            let (starts, budget) = self.current().ok()?;
            let end = (starts + DAY_MS) as f64;
            let start_probe = self.with_window(starts, |w| {
                if w.exhausted.contains(&range) {
                    return Err(end);
                }
                Ok(!w.pool.contains_key(&range) && w.probing.insert(range))
            })?;
            match start_probe {
                Err(end) => return Some(end),
                Ok(false) => return None,
                Ok(true) => {}
            }
            let window = self.window.clone();
            // Valid for the rest of the window; S3 operations are bounded by the transport.
            let now = self.funding.clock.now_ms().unwrap_or(starts);
            let valid =
                Instant::now() + Duration::from_millis((starts + DAY_MS - now).max(0) as u64);
            let probe = tokio::spawn(async move {
                let outcome = budget.reserve(units(range) * 2, valid).await;
                settle(&window, starts, |w| {
                    w.probing.remove(&range);
                    match outcome {
                        Ok(r) => {
                            w.pool.insert(range, r);
                            false
                        }
                        Err(BudgetError::Exhausted | BudgetError::Invalid(_)) => {
                            w.exhausted.insert(range);
                            true
                        }
                        Err(_) => false,
                    }
                })
                .unwrap_or(false)
            });
            match timeout_at(Instant::now() + PROBE_WAIT, probe).await {
                Ok(Ok(true)) => Some(end),
                _ => None,
            }
        })
    }
}
