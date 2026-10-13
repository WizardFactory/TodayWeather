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
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{Mutex as AsyncMutex, Semaphore, oneshot},
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
/// Bound on how long an eligibility check may hold a waiter (the funding task continues).
const PROBE_WAIT: Duration = Duration::from_millis(1500);
/// Pooled reservations kept per window; smaller leftovers beyond this are dropped.
const POOL_MAX: usize = 8;
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
/// One funding window: its own S08 store (never restored across windows), acknowledged
/// reservations not yet consumed (any range may use them), and the smallest denied amount.
struct Window<T> {
    starts_at_ms: i64,
    budget: Arc<BudgetStore<T>>,
    pool: Vec<Reservation>,
    denied: Option<u64>,
}
type Ledger<T> = Arc<AsyncMutex<Option<Window<T>>>>;
enum Want {
    /// Take funds for a fetch (pooled first, else a new S08 reservation).
    Fetch(oneshot::Sender<(Reservation, i64)>),
    /// Establish eligibility only; a new reservation is pooled for the next fetch.
    Probe,
}
enum Got {
    Funded,
    Exhausted(f64),
    Unknown,
}
fn pool(window: &mut Window<impl Sized>, r: Reservation, need_floor: u64) {
    if r.units() < need_floor {
        return;
    }
    window.pool.push(r);
    if window.pool.len() > POOL_MAX
        && let Some(i) = window
            .pool
            .iter()
            .enumerate()
            .min_by_key(|(_, r)| r.units())
            .map(|(i, _)| i)
    {
        window.pool.swap_remove(i);
    }
}
/// The serialized funding step: every reservation, probe and denial of a window happens under
/// one lock, so a fetch can never miss a pooled reservation or race a probe into a false
/// exhaustion. Runs as an owned task so a caller's deadline never cancels an S08 operation.
async fn acquire<T: BudgetTransport + 'static>(
    ledger: Ledger<T>,
    funding: Arc<VcFunding<T>>,
    need: u64,
    want: Want,
) -> Got {
    let mut guard = ledger.lock().await;
    let Ok(now) = funding.clock.now_ms() else {
        return Got::Unknown;
    };
    let starts = now.div_euclid(DAY_MS) * DAY_MS;
    if guard.as_ref().map(|w| w.starts_at_ms) != Some(starts) {
        let Some(budget) = funding.policy(starts).and_then(|p| {
            BudgetStore::new(funding.transport.clone(), p, funding.clock.clone()).ok()
        }) else {
            return Got::Unknown;
        };
        *guard = Some(Window {
            starts_at_ms: starts,
            budget: Arc::new(budget),
            pool: Vec::new(),
            denied: None,
        });
    }
    let Some(window) = guard.as_mut() else {
        return Got::Unknown;
    };
    let end = (starts + DAY_MS) as f64;
    // Best fit from acknowledged, unconsumed funds of any range.
    let fit = window
        .pool
        .iter()
        .enumerate()
        .filter(|(_, r)| r.units() >= need)
        .min_by_key(|(_, r)| r.units())
        .map(|(i, _)| i);
    let reservation = match fit {
        Some(i) => match want {
            Want::Probe => return Got::Funded,
            Want::Fetch(_) => window.pool.swap_remove(i),
        },
        None if window.denied.is_some_and(|d| d <= need) => return Got::Exhausted(end),
        None => {
            // Valid for the rest of the window; each S3 operation is bounded by its transport.
            let valid =
                Instant::now() + Duration::from_millis((starts + DAY_MS - now).max(0) as u64);
            match window.budget.reserve(need, valid).await {
                Ok(r) => r,
                // A larger need than the remaining units or the policy block: the legacy
                // daily-budget (EVCBUDGET) path. Denial is monotonic within a window.
                Err(BudgetError::Exhausted | BudgetError::Invalid(_)) => {
                    window.denied = Some(window.denied.map_or(need, |d| d.min(need)));
                    return Got::Exhausted(end);
                }
                Err(_) => return Got::Unknown,
            }
        }
    };
    match want {
        Want::Probe => {
            pool(window, reservation, 2);
            Got::Funded
        }
        Want::Fetch(reply) => {
            // A caller that gave up returns the reservation to the pool instead of losing it.
            if let Err((r, _)) = reply.send((reservation, starts)) {
                pool(window, r, 2);
            }
            Got::Funded
        }
    }
}
/// S08-funded Visual Crossing source with the legacy `vcRequester` policy. Two attempts
/// (98/50/2 units) are funded before any HTTP; only a concurrency 429 or a reset socket is
/// retried, a 401/403 or a limit 429 marks the provider down, and every 2xx body is returned for
/// engine validation (an unusable billed body backs off 15 minutes there). Unconsumed units of
/// a reservation return to the window's pool for any later fetch.
pub struct FundedVc<P, T> {
    base: String,
    key: String,
    transport: Arc<P>,
    funding: Arc<VcFunding<T>>,
    ledger: Ledger<T>,
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
            funding: Arc::new(funding),
            ledger: Arc::new(AsyncMutex::new(None)),
            admission: Arc::new(Semaphore::new(4)),
        })
    }
    fn spawn_acquire(&self, need: u64, want: Want) -> tokio::task::JoinHandle<Got> {
        tokio::spawn(acquire(
            self.ledger.clone(),
            self.funding.clone(),
            need,
            want,
        ))
    }
    /// Return unconsumed units to the window they were reserved in (never across windows).
    fn release(&self, reservation: Reservation, starts: i64) {
        let ledger = self.ledger.clone();
        tokio::spawn(async move {
            let mut guard = ledger.lock().await;
            if let Some(w) = guard.as_mut().filter(|w| w.starts_at_ms == starts) {
                pool(w, reservation, 2);
            }
        });
    }
    async fn attempts(
        &self,
        url: &reqwest::Url,
        units: u64,
        funds: &mut Reservation,
        deadline: Instant,
    ) -> Result<Vec<u8>, VcError> {
        let started = Instant::now();
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
    }
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
            // Fund both permitted attempts before any HTTP; no refunds or late reservations.
            let (reply, funded) = oneshot::channel();
            let task = self.spawn_acquire(units * 2, Want::Fetch(reply));
            let (mut funds, starts) = match timeout_at(deadline, task).await {
                Ok(Ok(Got::Exhausted(end))) => return Err(VcError::Exhausted { retry_at_ms: end }),
                Ok(Ok(Got::Funded)) => funded.await.map_err(|_| VcError::Failed)?,
                _ => return Err(VcError::Failed),
            };
            let result = self.attempts(&url, units, &mut funds, deadline).await;
            self.release(funds, starts);
            result
        })
    }
    /// `_checkProvider` budget part without HTTP: pooled funds or a new reservation (pooled for
    /// the next fetch of any range) prove eligibility; a denial proves exhaustion. Concurrent
    /// callers queue on the window lock and see the earlier outcome.
    fn eligible(&self, range: Range) -> BoxFuture<'_, Option<f64>> {
        Box::pin(async move {
            let task = self.spawn_acquire(units(range) * 2, Want::Probe);
            match timeout_at(Instant::now() + PROBE_WAIT, task).await {
                Ok(Ok(Got::Exhausted(end))) => Some(end),
                _ => None,
            }
        })
    }
}
