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
    /// Provider time (two legacy attempts per page) plus publication. A warning cycle is tracked
    /// for at most [`MAX_OWNED`](crate::resolver::owned::MAX_OWNED): it runs in its own task and
    /// each of its steps carries the collector's 30 s deadline, so the bound never cancels it.
    pub fn owned_for(&self) -> Duration {
        if matches!(self, Self::Warnings) {
            return crate::resolver::owned::MAX_OWNED;
        }
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
            Self::Warnings => Duration::ZERO,
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

/// A warning source on the KST-day `WthrWrnInfoService` budgets of the process data.go.kr
/// acquirer (one per key, AK decision 5). Legacy
/// `kmaWarningRequester.get` (`server/lib/kmaWarningRequester.js:122-155`) uses the same
/// `DONGNAE_SECRET_KEYS`: it starts at the last successful key, moves to the next key on an
/// auth or quota error once around the list, and remembers the key that answered. Each attempt
/// here is funded by its key's S08 budget; an exhausted budget moves on like a quota error.
struct DailyWarnings<P, W, B> {
    daily: Arc<DailyAcquirer<P, W, B>>,
    base: String,
    /// Legacy `keyIndex`: the key that answered last.
    key_index: std::sync::atomic::AtomicUsize,
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
        use std::sync::atomic::Ordering::SeqCst;
        Box::pin(async move {
            let day = self.daily.day().await.map_err(|_| FetchError::Invalid)?;
            let count = day.warnings.len();
            if count == 0 {
                return Err(FetchError::Invalid);
            }
            let start = self.key_index.load(SeqCst) % count;
            let mut last = FetchError::Invalid;
            for offset in 0..count {
                let index = (start + offset) % count;
                let source = FundedSource::new(
                    self.daily.funded_transport(),
                    &self.base,
                    vec![day.warnings[index].clone()],
                    self.daily.clock(),
                )?;
                match source.fetch(operation, params.clone(), deadline).await {
                    Ok(page) => {
                        self.key_index.store(index, SeqCst);
                        return Ok(page);
                    }
                    // Auth, quota, or this key's S08 budget refused (reported as Invalid before
                    // any provider call): the next key.
                    Err(e @ (FetchError::Auth | FetchError::Quota | FetchError::Invalid)) => {
                        last = e;
                    }
                    Err(e) => return Err(e),
                }
            }
            Err(last)
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
            key_index: std::sync::atomic::AtomicUsize::new(0),
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
