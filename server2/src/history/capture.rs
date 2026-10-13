//! Demand-gated capture runner (O-1, O-11): hourly-family captures every 10 minutes and the
//! national minute page every 2 minutes, only while demand exists. Acquisition is S13, funding
//! S08 and publication S06 (O-9); a publication is marked captured only after its group is
//! published. One owner per scope in a process; multi-host capture needs the section 9 gate.
use super::{
    Grid,
    demand::{DemandStore, DemandTransport},
    index::CaptureIndex,
    metrics::HistoryMetrics,
    schedule::{self, Family, MINUTE_INTERVAL_MS, Planned, TICK_INTERVAL_MS, Target},
};
use crate::budget::{BudgetTransport, Clock};
use crate::domestic::{
    Acquired, DomesticAcquirer, DomesticError,
    family::{DataGoKrFamily, DataGoKrRequest, Target as RequestTarget, WebRequest},
    publication::Publication,
};
use crate::providers::{ProviderTransport, PublicTransport};
use crate::resolver::Acquisition;
use crate::storage::{CatalogStore, CatalogTransport, Error as StorageError};
use std::{
    collections::BTreeSet,
    future::Future,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::time::Instant;

/// S13 acquisition seam (implemented by `DomesticAcquirer`).
pub trait CaptureSource: Send + Sync + 'static {
    fn acquire(
        &self,
        request: &DataGoKrRequest,
        deadline: Instant,
    ) -> impl Future<Output = Result<Acquired, DomesticError>> + Send;
    fn acquire_web(
        &self,
        request: &WebRequest,
        deadline: Instant,
    ) -> impl Future<Output = Result<Acquired, DomesticError>> + Send;
}
/// S06 publication seam (implemented by `CatalogStore`): raw PUT plus complete group catalogs.
pub trait Publisher: Send + Sync + 'static {
    fn publish(
        &self,
        acquisition: Acquisition,
        deadline: Instant,
    ) -> impl Future<Output = Result<(), StorageError>> + Send;
}
impl<P, W, B> CaptureSource for DomesticAcquirer<P, W, B>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
{
    async fn acquire(
        &self,
        request: &DataGoKrRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        DomesticAcquirer::acquire(self, request, deadline).await
    }
    async fn acquire_web(
        &self,
        request: &WebRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        DomesticAcquirer::acquire_web(self, request, deadline).await
    }
}
impl<T: CatalogTransport> Publisher for CatalogStore<T> {
    async fn publish(
        &self,
        acquisition: Acquisition,
        deadline: Instant,
    ) -> Result<(), StorageError> {
        CatalogStore::publish(self, acquisition.declaration, acquisition.records, deadline)
            .await
            .map(|_| ())
    }
}

fn owners() -> &'static Mutex<BTreeSet<String>> {
    static OWNERS: OnceLock<Mutex<BTreeSet<String>>> = OnceLock::new();
    OWNERS.get_or_init(|| Mutex::new(BTreeSet::new()))
}
/// Exclusive capture ownership for one scope (for example the bucket) within this process.
#[derive(Debug)]
pub struct CaptureOwner {
    scope: String,
}
impl CaptureOwner {
    pub fn claim(scope: &str) -> Option<Self> {
        let mut set = owners().lock().unwrap_or_else(|e| e.into_inner());
        set.insert(scope.to_owned()).then(|| Self {
            scope: scope.to_owned(),
        })
    }
    pub fn scope(&self) -> &str {
        &self.scope
    }
}
impl Drop for CaptureOwner {
    fn drop(&mut self) {
        owners()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.scope);
    }
}

#[derive(Debug, Clone)]
pub struct CaptureConfig {
    /// data.go.kr calls per tick (each is funded by the S08 key-ring budgets).
    pub max_funded: usize,
    /// Keyless KMA page calls per tick (national hourly pages).
    pub max_web: usize,
    /// Deadline of one acquisition plus publication.
    pub call_timeout: Duration,
}
impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            max_funded: 64,
            max_web: 8,
            call_timeout: Duration::from_secs(3),
        }
    }
}
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TickReport {
    pub planned: usize,
    pub attempted: usize,
    pub published: usize,
    /// Present in the index when the call was about to run (a concurrent capture finished).
    pub present_skipped: usize,
    pub not_published: usize,
    pub stale: usize,
    pub no_data: usize,
    pub failed: usize,
    /// Planned captures left for a later tick by the per-tick caps or a funding error.
    pub capped: usize,
    pub budget_denied: bool,
}
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MinuteReport {
    pub attempted: bool,
    pub published: bool,
    pub stale: bool,
    pub failed: bool,
}

enum Outcome {
    Published,
    NotPublished,
    Stale,
    NoData,
    Funding,
    Failed,
}

pub struct CaptureRunner<S, P, D> {
    _owner: CaptureOwner,
    source: Arc<S>,
    publisher: Arc<P>,
    demand: Arc<DemandStore<D>>,
    index: Arc<Mutex<CaptureIndex>>,
    config: CaptureConfig,
    metrics: Arc<HistoryMetrics>,
    minute_bucket: Mutex<Option<i64>>,
    backfill: Mutex<BackfillState>,
}
/// Per-cell backfill runs once per KST hour for every active cell and at once for a cell that
/// became active since the last pass, so persistent provider gaps are not retried every tick.
#[derive(Default)]
struct BackfillState {
    hour: Option<Publication>,
    cells: BTreeSet<Grid>,
}
impl<S: CaptureSource, P: Publisher, D: DemandTransport> CaptureRunner<S, P, D> {
    pub fn new(
        owner: CaptureOwner,
        source: Arc<S>,
        publisher: Arc<P>,
        demand: Arc<DemandStore<D>>,
        index: Arc<Mutex<CaptureIndex>>,
        config: CaptureConfig,
        metrics: Arc<HistoryMetrics>,
    ) -> Result<Self, DomesticError> {
        if config.max_funded > 1024
            || config.max_web > 256
            || config.call_timeout.is_zero()
            || config.call_timeout > Duration::from_secs(9)
        {
            return Err(DomesticError::Invalid("capture configuration"));
        }
        Ok(Self {
            _owner: owner,
            source,
            publisher,
            demand,
            index,
            config,
            metrics,
            minute_bucket: Mutex::new(None),
            backfill: Mutex::new(BackfillState::default()),
        })
    }
    pub fn index(&self) -> Arc<Mutex<CaptureIndex>> {
        self.index.clone()
    }
    pub fn metrics(&self) -> &HistoryMetrics {
        &self.metrics
    }
    fn lock_index(&self) -> std::sync::MutexGuard<'_, CaptureIndex> {
        self.index.lock().unwrap_or_else(|e| e.into_inner())
    }
    async fn publish(
        &self,
        acquired: Result<Acquired, DomesticError>,
        deadline: Instant,
    ) -> (Outcome, Option<Publication>) {
        match acquired {
            Ok(Acquired::Complete(acquisition)) => {
                let period = acquisition.records.first().and_then(|r| {
                    let p = &r.envelope.identity.period;
                    Publication::new(p.local_date, p.slot.parse().ok()?)
                });
                match self.publisher.publish(acquisition, deadline).await {
                    Ok(()) => (Outcome::Published, period),
                    Err(_) => (Outcome::Failed, None),
                }
            }
            Ok(Acquired::NotPublished) => (Outcome::NotPublished, None),
            Ok(Acquired::Stale(_)) => (Outcome::Stale, None),
            Ok(Acquired::NoData) => (Outcome::NoData, None),
            Err(DomesticError::Funding(_)) => (Outcome::Funding, None),
            Err(_) => (Outcome::Failed, None),
        }
    }
    fn request(item: &Planned) -> Result<Request, DomesticError> {
        match (item.family, item.target) {
            (family, Target::Cell(grid)) if family.per_cell() => {
                let f = match family {
                    Family::Current => DataGoKrFamily::UltraSrtNcst,
                    Family::Shortest => DataGoKrFamily::UltraSrtFcst,
                    _ => DataGoKrFamily::VilageFcst,
                };
                Ok(Request::Funded(DataGoKrRequest::new(
                    f,
                    RequestTarget::Grid {
                        nx: grid.nx(),
                        ny: grid.ny(),
                    },
                    family.request_publication(item.publication),
                )?))
            }
            (Family::AwsHourly, Target::National) => {
                Ok(Request::Web(WebRequest::aws_hourly(item.publication)?))
            }
            (Family::CityObs, Target::National) => {
                Ok(Request::Web(WebRequest::city(item.publication)?))
            }
            _ => Err(DomesticError::Invalid("capture plan item")),
        }
    }
    /// One hourly-family pass at `now_ms`: latest publications first, then backfill, under the
    /// per-tick caps. A funding error stops further data.go.kr calls in this pass.
    pub async fn tick(&self, now_ms: i64) -> TickReport {
        HistoryMetrics::add(&self.metrics.ticks, 1);
        let active = self.demand.active(now_ms);
        let backfill_cells = {
            let mut b = self.backfill.lock().unwrap_or_else(|e| e.into_inner());
            let hour = schedule::hour_of(now_ms);
            if b.hour != Some(hour) {
                b.hour = Some(hour);
                b.cells = active.clone();
                active.clone()
            } else {
                let new: BTreeSet<Grid> = active.difference(&b.cells).copied().collect();
                b.cells.extend(new.iter().copied());
                new
            }
        };
        let planned = schedule::plan_with(now_ms, &active, &self.lock_index(), &backfill_cells);
        let mut r = TickReport {
            planned: planned.len(),
            ..TickReport::default()
        };
        let (mut funded, mut web) = (0usize, 0usize);
        for item in &planned {
            if self
                .lock_index()
                .has(item.family, item.target, item.publication)
            {
                r.present_skipped += 1;
                continue;
            }
            let request = match Self::request(item) {
                Ok(request) => request,
                Err(_) => {
                    r.failed += 1;
                    continue;
                }
            };
            let used = match request {
                Request::Funded(_) => &mut funded,
                Request::Web(_) => &mut web,
            };
            let cap = match request {
                Request::Funded(_) if r.budget_denied => 0,
                Request::Funded(_) => self.config.max_funded,
                Request::Web(_) => self.config.max_web,
            };
            if *used >= cap {
                r.capped += 1;
                continue;
            }
            *used += 1;
            r.attempted += 1;
            let deadline = Instant::now() + self.config.call_timeout;
            let acquired = match &request {
                Request::Funded(q) => self.source.acquire(q, deadline).await,
                Request::Web(q) => self.source.acquire_web(q, deadline).await,
            };
            let (outcome, period) = self.publish(acquired, deadline).await;
            match outcome {
                Outcome::Published => {
                    r.published += 1;
                    self.lock_index().insert(
                        item.family,
                        item.target,
                        period.unwrap_or(item.publication),
                    );
                }
                Outcome::NotPublished => r.not_published += 1,
                Outcome::Stale => r.stale += 1,
                Outcome::NoData => r.no_data += 1,
                Outcome::Funding => r.budget_denied = true,
                Outcome::Failed => r.failed += 1,
            }
        }
        let m = &self.metrics;
        for (counter, n) in [
            (&m.planned, r.planned),
            (&m.attempted, r.attempted),
            (&m.published, r.published),
            (&m.not_published, r.not_published),
            (&m.stale, r.stale),
            (&m.no_data, r.no_data),
            (&m.failed, r.failed),
            (&m.capped, r.capped),
            (&m.budget_denied, usize::from(r.budget_denied)),
        ] {
            HistoryMetrics::add(counter, n as u64);
        }
        r
    }
    /// The national minute page, once per 2-minute bucket while any cell has demand.
    pub async fn minute(&self, now_ms: i64) -> MinuteReport {
        let mut report = MinuteReport::default();
        if self.demand.active(now_ms).is_empty() {
            return report;
        }
        let bucket = now_ms.div_euclid(MINUTE_INTERVAL_MS);
        {
            let mut last = self.minute_bucket.lock().unwrap_or_else(|e| e.into_inner());
            if *last == Some(bucket) {
                return report;
            }
            *last = Some(bucket);
        }
        HistoryMetrics::add(&self.metrics.minute_ticks, 1);
        report.attempted = true;
        let not_before = self
            .lock_index()
            .last_minute()
            .map(|m| schedule::from_ms(schedule::to_ms(m) + 60_000));
        let deadline = Instant::now() + self.config.call_timeout;
        let acquired = self
            .source
            .acquire_web(&WebRequest::aws_minute(not_before), deadline)
            .await;
        match self.publish(acquired, deadline).await {
            (Outcome::Published, Some(observed)) => {
                report.published = true;
                self.lock_index().insert_minute(observed);
                HistoryMetrics::add(&self.metrics.published, 1);
            }
            (Outcome::Stale, _) => {
                report.stale = true;
                HistoryMetrics::add(&self.metrics.stale, 1);
            }
            _ => {
                report.failed = true;
                HistoryMetrics::add(&self.metrics.failed, 1);
            }
        }
        report
    }
    /// Drive both loops until `shutdown` turns true: the minute page every 2 minutes and the
    /// hourly families every 10 minutes, on separate tasks so a long pass cannot delay minutes.
    pub async fn run(
        self: Arc<Self>,
        clock: Arc<dyn Clock>,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) {
        let minute = {
            let this = self.clone();
            let clock = clock.clone();
            let mut stop = shutdown.clone();
            async move {
                let mut interval = tokio::time::interval(Duration::from_secs(5));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {}
                        _ = stop.changed() => {}
                    }
                    if *stop.borrow() {
                        break;
                    }
                    if let Ok(now) = clock.now_ms() {
                        this.minute(now).await;
                    }
                }
            }
        };
        let hourly = {
            let this = self.clone();
            let mut stop = shutdown;
            async move {
                let mut interval = tokio::time::interval(Duration::from_secs(5));
                let mut last = None;
                loop {
                    tokio::select! {
                        _ = interval.tick() => {}
                        _ = stop.changed() => {}
                    }
                    if *stop.borrow() {
                        break;
                    }
                    if let Ok(now) = clock.now_ms() {
                        let bucket = now.div_euclid(TICK_INTERVAL_MS);
                        if last != Some(bucket) {
                            last = Some(bucket);
                            this.tick(now).await;
                        }
                    }
                }
            }
        };
        tokio::join!(minute, hourly);
    }
}
enum Request {
    Funded(DataGoKrRequest),
    Web(WebRequest),
}
