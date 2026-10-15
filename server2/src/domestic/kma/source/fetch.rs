//! S15b-4: request-time acquisition of the forecast inputs of the S3 source (#2742).
//!
//! A request that finds a publication missing in S3 starts an owned acquisition (S13d
//! `OwnedFlights`, keyed by dataset and publication, surviving the waiter, legacy provider
//! timeouts), waits at most 3 s and builds its answer from what is stored then; the acquisition
//! publishes its raw records through S06 before any request uses them (O-9).
//!
//! Families and their legacy collection (`server/controllers/controllerManager.js`):
//! - the grid forecasts (`getUltraSrtNcst`, `getUltraSrtFcst`, `getVilageFcst`) per cell: the
//!   latest publication, and the earlier publications legacy's backfill keeps (current and
//!   ultra-short 23, short 7; `PastConditionGather`, S14 `schedule`), acquired by one owned pass
//!   per cell that the request does not wait for;
//! - the short RSS (`wid/queryDFS.jsp`) per cell (legacy hourly `shortrss`);
//! - the mid forecasts (`getMidFcst`, `getMidLandFcst`, `getMidTa`) per region at the `tmFc`
//!   legacy requests (06/18 KST);
//! - the forecast-zone list (`getFcstZoneCd`; legacy fetches it at process start);
//! - the warning cycle (`kmaWarningCollector.gather`, legacy every 3 minutes).
//!
//! Keys: the legacy `DONGNAE_SECRET_KEYS` list with one S08 quota owner per key and KST day
//! (S15b-2 [`DailyAcquirer`]), shared with the warning requester (legacy uses the same keys).
use super::observe::DailyAcquirer;
use crate::budget::BudgetTransport;
use crate::domestic::family::{DataGoKrRequest, WebRequest, owned_provider_time};
use crate::domestic::zone::ZoneRequest;
use crate::domestic::{Acquired, DomesticError};
use crate::gateway::BoxFuture;
use crate::providers::{ProviderTransport, PublicTransport};
use crate::storage::{CatalogStore, CatalogTransport, RawRecord};
use crate::warnings::collector::WarningCollector;
use crate::warnings::provider::{FundedSource, Operation, Page, WarningSource};
use crate::warnings::store::WarningStore;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// S06 publication allowance of one owned acquisition.
pub const PUBLISH_BUDGET: Duration = Duration::from_secs(10);
/// Legacy warning cadence (`controllerManager.startScrape`: every 3 minutes).
pub const WARNING_CYCLE: Duration = Duration::from_secs(180);

/// One request-time forecast acquisition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForecastRequest {
    /// A grid or mid publication (S13 `DataGoKrRequest`).
    DataGoKr(DataGoKrRequest),
    /// The short RSS of a grid (keyless).
    Rss(WebRequest),
    /// The forecast-zone code list.
    Zones,
    /// One legacy warning cycle.
    Warnings,
}
impl ForecastRequest {
    /// Provider time (two legacy attempts per page) plus publication.
    pub fn owned_for(&self) -> Duration {
        let provider = match self {
            Self::DataGoKr(r) => owned_provider_time(
                r.family().service().attempt_timeout(),
                r.family().max_pages(),
            ),
            Self::Rss(r) => owned_provider_time(r.family().attempt_timeout(), 1),
            Self::Zones => owned_provider_time(
                crate::domestic::family::Service::ForecastZone.attempt_timeout(),
                10,
            ),
            // Legacy steps run in sequence; the collector bounds each step itself.
            Self::Warnings => Duration::from_secs(150),
        };
        provider + PUBLISH_BUDGET
    }
}
/// The published records of one acquisition (pages in order), or None when nothing new was
/// published (not published yet, an older publication, no data, or a provider failure).
pub type Published = Option<Vec<RawRecord>>;

/// Request-time forecast acquisition (tests inject doubles).
pub trait ForecastAcquire: Send + Sync + 'static {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>>;
}

/// A warning source on the KST-day budgets of the process data.go.kr acquirer (legacy
/// `kmaWarningRequester` uses the same `DONGNAE_SECRET_KEYS`, rotating on quota or auth).
struct DailyWarnings<P, W, B> {
    daily: Arc<DailyAcquirer<P, W, B>>,
    base: String,
}
impl<P, W, B> WarningSource for DailyWarnings<P, W, B>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
{
    fn fetch<'a>(
        &'a self,
        operation: Operation,
        params: Vec<(&'static str, String)>,
        deadline: Instant,
    ) -> BoxFuture<'a, Result<Option<Page>, crate::warnings::provider::FetchError>> {
        use crate::warnings::provider::FetchError;
        Box::pin(async move {
            let day = self.daily.day().await.map_err(|_| FetchError::Invalid)?;
            // The executor offers at most two candidates (the current key and one rotation).
            let candidates = day.budgets.iter().take(2).cloned().collect();
            let source = FundedSource::new(
                self.daily.funded_transport(),
                &self.base,
                candidates,
                self.daily.clock(),
            )?;
            source.fetch(operation, params, deadline).await
        })
    }
}

/// The live forecast acquirer with S06 publication.
pub struct LiveForecast<P, W, B, T> {
    daily: Arc<DailyAcquirer<P, W, B>>,
    store: Arc<CatalogStore<T>>,
    warnings: Arc<WarningCollector<dyn WarningSource, T>>,
}
impl<P, W, B, T> LiveForecast<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    /// `data_go_kr` is the data.go.kr root (built in; tests use a loopback root).
    pub fn new(
        daily: Arc<DailyAcquirer<P, W, B>>,
        store: Arc<CatalogStore<T>>,
        warning_store: Arc<WarningStore<T>>,
        data_go_kr: &str,
    ) -> Self {
        let source: Arc<dyn WarningSource> = Arc::new(DailyWarnings {
            daily: daily.clone(),
            base: format!(
                "{}1360000/WthrWrnInfoService/",
                if data_go_kr.ends_with('/') {
                    data_go_kr.to_owned()
                } else {
                    format!("{data_go_kr}/")
                }
            ),
        });
        let clock = daily.clock();
        Self {
            daily,
            store,
            warnings: Arc::new(WarningCollector::new(source, warning_store, clock)),
        }
    }
    async fn publish(&self, outcome: Result<Acquired, DomesticError>) -> Result<Published, String> {
        match outcome.map_err(|e| e.to_string())? {
            Acquired::Complete(a) => {
                let records = a.records.clone();
                self.store
                    .publish(a.declaration, a.records, Instant::now() + PUBLISH_BUDGET)
                    .await
                    .map_err(|e| format!("publication: {e}"))?;
                Ok(Some(records))
            }
            Acquired::NotPublished | Acquired::Stale(_) | Acquired::NoData => Ok(None),
        }
    }
    async fn run(&self, request: ForecastRequest) -> Result<Published, String> {
        let deadline = Instant::now() + request.owned_for() - PUBLISH_BUDGET;
        match request {
            ForecastRequest::DataGoKr(r) => {
                let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
                let outcome = acquirer.acquire(&r, deadline).await;
                self.publish(outcome).await
            }
            ForecastRequest::Rss(r) => {
                let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
                let outcome = acquirer.acquire_web(&r, deadline).await;
                self.publish(outcome).await
            }
            ForecastRequest::Zones => {
                let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
                let outcome = acquirer.acquire_zones(&ZoneRequest::new(), deadline).await;
                self.publish(outcome).await
            }
            ForecastRequest::Warnings => {
                let report = self.warnings.gather().await;
                if report.errors.is_empty() {
                    Ok(None)
                } else {
                    Err(format!("{} warning step errors", report.errors.len()))
                }
            }
        }
    }
}
impl<P, W, B, T> ForecastAcquire for LiveForecast<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let this = Self {
            daily: self.daily.clone(),
            store: self.store.clone(),
            warnings: self.warnings.clone(),
        };
        Box::pin(async move { this.run(request).await })
    }
}
