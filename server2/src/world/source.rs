//! Visual Crossing Timeline acquisition at the cell centre, funded through S08 before HTTP.
use super::{Cell, Range, js::num_string};
use crate::{
    budget::{BudgetError, BudgetStore, BudgetTransport, Provider},
    gateway::BoxFuture,
    providers::{
        AcquisitionError, AcquisitionOutcome, Candidate, Disposition, FundedExecutor, ProviderKey,
        ProviderTransport,
    },
};
use std::sync::Arc;
use tokio::time::Instant;

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
fn validator(json: &serde_json::Value) -> bool {
    json.is_object()
}
/// S08-funded Visual Crossing source. One key; 49/25/1 units per attempt, two attempts reserved.
pub struct FundedVc<P, T> {
    base: String,
    budget: Arc<BudgetStore<T>>,
    key: String,
    combined: FundedExecutor<P, fn(&serde_json::Value) -> bool>,
    recent: FundedExecutor<P, fn(&serde_json::Value) -> bool>,
    forecast: FundedExecutor<P, fn(&serde_json::Value) -> bool>,
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
        let v: Arc<fn(&serde_json::Value) -> bool> = Arc::new(validator);
        Ok(Self {
            base: base.to_owned(),
            budget,
            key,
            combined: FundedExecutor::new(
                Provider::VisualCrossing,
                49,
                transport.clone(),
                v.clone(),
            )?,
            recent: FundedExecutor::new(
                Provider::VisualCrossing,
                25,
                transport.clone(),
                v.clone(),
            )?,
            forecast: FundedExecutor::new(Provider::VisualCrossing, 1, transport, v)?,
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
            let url = reqwest::Url::parse(&timeline_url(&self.base, cell, range))
                .map_err(|_| VcError::Failed)?;
            let executor = match range {
                Range::Combined => &self.combined,
                Range::Recent => &self.recent,
                Range::Forecast => &self.forecast,
            };
            let key = ProviderKey::new(self.key.clone()).map_err(|_| VcError::Failed)?;
            let result = executor
                .execute(
                    url,
                    vec![Candidate {
                        budget: self.budget.clone(),
                        key,
                    }],
                    deadline,
                )
                .await;
            match result {
                Ok(AcquisitionOutcome::Data(body)) => Ok(body.body),
                Ok(AcquisitionOutcome::NoData(_)) => Err(VcError::Failed),
                // A range larger than the remaining units or the policy block cannot be funded
                // in this window: the legacy daily-budget (EVCBUDGET) path.
                Err(AcquisitionError::Funding(
                    BudgetError::Exhausted | BudgetError::Invalid(_),
                )) => Err(VcError::Exhausted {
                    retry_at_ms: self.budget.policy().ends_at_ms as f64,
                }),
                Err(AcquisitionError::Provider(Disposition::Auth)) => Err(VcError::ProviderDown),
                Err(_) => Err(VcError::Failed),
            }
        })
    }
}
