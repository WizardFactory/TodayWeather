//! Visual Crossing Timeline acquisition at the cell centre, funded through S08 before HTTP.
use super::{Cell, Range, js::num_string};
use crate::{
    budget::{BudgetError, BudgetStore, BudgetTransport, Provider},
    gateway::BoxFuture,
    providers::{
        AcquisitionError, ProviderKey, ProviderTransport, ProviderTransportError, Request,
    },
};
use std::{sync::Arc, time::Duration};
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
/// within 1.5 s of the call start.
const RETRY_DELAY: Duration = Duration::from_millis(300);
const RETRY_WINDOW: Duration = Duration::from_millis(1500);
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
/// S08-funded Visual Crossing source with the legacy `vcRequester` status policy. Two attempts
/// (98/50/2 units) are reserved before any HTTP; only a concurrency 429 is retried, a 401/403 or
/// a limit 429 marks the provider down, and every 200 body is returned for engine validation
/// (an unusable billed body backs off 15 minutes there).
pub struct FundedVc<P, T> {
    base: String,
    budget: Arc<BudgetStore<T>>,
    key: String,
    transport: Arc<P>,
    admission: Arc<Semaphore>,
}
impl<P: ProviderTransport + 'static, T: BudgetTransport + 'static> FundedVc<P, T> {
    pub fn new(
        base: &str,
        transport: Arc<P>,
        budget: Arc<BudgetStore<T>>,
        key: String,
    ) -> Result<Self, AcquisitionError> {
        let url = reqwest::Url::parse(base).map_err(|_| AcquisitionError::Invalid)?;
        if budget.policy().provider != Provider::VisualCrossing
            || !base.ends_with('/')
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
        Ok(Self {
            base: base.to_owned(),
            budget,
            key,
            transport,
            admission: Arc::new(Semaphore::new(4)),
        })
    }
}
impl<P: ProviderTransport + 'static, T: BudgetTransport + 'static> VcSource for FundedVc<P, T> {
    fn fetch(
        &self,
        cell: Cell,
        range: Range,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        Box::pin(async move {
            let units = match range {
                Range::Combined => 49,
                Range::Recent => 25,
                Range::Forecast => 1,
            };
            let endpoint = reqwest::Url::parse(&timeline_url(&self.base, cell, range))
                .map_err(|_| VcError::Failed)?;
            let _admission = timeout_at(deadline, self.admission.clone().acquire_owned())
                .await
                .map_err(|_| VcError::Failed)?
                .map_err(|_| VcError::Failed)?;
            let started = Instant::now();
            // Fund both permitted attempts before any HTTP; no refunds or late reservations.
            let mut funds = match self.budget.reserve(units * 2, deadline).await {
                Ok(r) => r,
                // A range larger than the remaining units or the policy block cannot be funded
                // in this window: the legacy daily-budget (EVCBUDGET) path.
                Err(BudgetError::Exhausted | BudgetError::Invalid(_)) => {
                    return Err(VcError::Exhausted {
                        retry_at_ms: self.budget.policy().ends_at_ms as f64,
                    });
                }
                Err(_) => return Err(VcError::Failed),
            };
            for attempt in 1..=2 {
                funds
                    .consume(units, deadline)
                    .map_err(|_| VcError::Failed)?;
                let request = Request {
                    endpoint: endpoint.clone(),
                    key: ProviderKey::new(self.key.clone()).map_err(|_| VcError::Failed)?,
                    provider: Provider::VisualCrossing,
                };
                let response = match timeout_at(deadline, self.transport.send(&request)).await {
                    Err(_) => return Err(VcError::Failed),
                    Ok(Err(ProviderTransportError::Response { status })) => {
                        return Err(if matches!(status, 401 | 403) {
                            VcError::ProviderDown
                        } else {
                            VcError::Failed
                        });
                    }
                    Ok(Err(_)) => return Err(VcError::Failed),
                    Ok(Ok(r)) => r,
                };
                match response.status {
                    429 if concurrency_429(&response.body) => {
                        let left = deadline.saturating_duration_since(Instant::now());
                        if attempt == 1 && started.elapsed() < RETRY_WINDOW && left > RETRY_DELAY {
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
}
