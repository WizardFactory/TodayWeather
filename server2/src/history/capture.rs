//! Demand-gated capture runner (O-1, O-11): hourly-family captures every 10 minutes and the
//! national minute page every 2 minutes, only while demand exists. Acquisition is S13, funding
//! S08 and publication S06 (O-9); a publication is marked captured only after its group is
//! published. One owner per scope in a process; multi-host capture needs the section 9 gate.
use super::{
    demand::{DemandStore, DemandTransport},
    index::CaptureIndex,
    metrics::HistoryMetrics,
    schedule::{self, Family, MINUTE_INTERVAL_MS, Planned, TICK_INTERVAL_MS, Target},
};
use crate::budget::{BudgetTransport, Clock};
use crate::domestic::{
    Acquired, DomesticAcquirer, DomesticError,
    family::{
        DataGoKrFamily, DataGoKrRequest, Target as RequestTarget, WebRequest, owned_provider_time,
    },
    publication::Publication,
};
use crate::providers::{ProviderTransport, PublicTransport};
use crate::resolver::Acquisition;
use crate::storage::{CatalogStore, CatalogTransport, Error as StorageError};
use std::{
    collections::{BTreeSet, HashSet},
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
    /// Funded data.go.kr HTTP attempts per tick. Each acquisition is charged its worst case
    /// (family page cap x two attempts) before it starts, so actual attempts never exceed this.
    /// Spending is additionally bounded by the S08 key-ring budgets.
    pub max_funded_attempts: usize,
    /// Keyless KMA page HTTP attempts per tick (two per page, worst case).
    pub max_web_attempts: usize,
    /// Acquisitions in flight at once.
    pub concurrency: usize,
    /// Publication and processing allowance of one acquisition. The deadline also adds the
    /// two legacy-timeout provider attempts of its service (S13d), so a slow provider that
    /// legacy waited for is still captured.
    pub call_timeout: Duration,
}
impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            max_funded_attempts: 2560,
            max_web_attempts: 64,
            concurrency: 4,
            call_timeout: Duration::from_secs(3),
        }
    }
}
/// Worst-case HTTP attempts of one acquisition (S13: at most two attempts per page).
const WEB_CHARGE: usize = 2;
fn funded_charge(family: DataGoKrFamily) -> usize {
    family.max_pages() as usize * 2
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
/// Each backfill publication is attempted at most once per KST hour (like the hourly legacy
/// past-condition pass), so a persistent provider gap is not retried every tick. Backfill left
/// unattempted by a cap or funding stop is carried over to the next tick.
#[derive(Default)]
struct BackfillState {
    hour: Option<Publication>,
    attempted: HashSet<(Family, Target, Publication)>,
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
        if config.max_funded_attempts > 1 << 20
            || config.max_web_attempts > 1 << 16
            || !(1..=64).contains(&config.concurrency)
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
    async fn capture_one(
        &self,
        item: Planned,
        request: Request,
    ) -> (Planned, Outcome, Option<Publication>) {
        let deadline = Instant::now() + request.provider_time() + self.config.call_timeout;
        let acquired = match &request {
            Request::Funded(q) => self.source.acquire(q, deadline).await,
            Request::Web(q) => self.source.acquire_web(q, deadline).await,
        };
        let (outcome, period) = self.publish(acquired, deadline).await;
        (item, outcome, period)
    }
    /// One hourly-family pass at `now_ms`: latest publications first, then backfill, under the
    /// per-tick attempt caps, `concurrency` acquisitions at a time. A funding error stops further
    /// data.go.kr launches in this pass; capped work stays planned for the next tick.
    pub async fn tick(&self, now_ms: i64) -> TickReport {
        crate::observability::root_work(
            crate::observability::Component::History,
            crate::observability::Stage::Worker,
            async {
                HistoryMetrics::add(&self.metrics.ticks, 1);
                let active = self.demand.active(now_ms);
                let planned: Vec<Planned> = {
                    let mut b = self.backfill.lock().unwrap_or_else(|e| e.into_inner());
                    let hour = schedule::hour_of(now_ms);
                    if b.hour != Some(hour) {
                        b.hour = Some(hour);
                        b.attempted.clear();
                    }
                    schedule::plan(now_ms, &active, &self.lock_index())
                        .into_iter()
                        .filter(|x| {
                            !x.backfill
                                || !b.attempted.contains(&(x.family, x.target, x.publication))
                        })
                        .collect()
                };
                let mut r = TickReport {
                    planned: planned.len(),
                    ..TickReport::default()
                };
                let (mut funded, mut web) = (0usize, 0usize);
                let mut pending = planned.into_iter();
                loop {
                    let mut batch = Vec::new();
                    for item in pending.by_ref() {
                        if self
                            .lock_index()
                            .has(item.family, item.target, item.publication)
                        {
                            r.present_skipped += 1;
                            continue;
                        }
                        let request = match Self::request(&item) {
                            Ok(request) => request,
                            Err(_) => {
                                r.failed += 1;
                                continue;
                            }
                        };
                        let (used, cap, charge) = match &request {
                            Request::Funded(q) => (
                                &mut funded,
                                if r.budget_denied {
                                    0
                                } else {
                                    self.config.max_funded_attempts
                                },
                                funded_charge(q.family()),
                            ),
                            Request::Web(_) => (&mut web, self.config.max_web_attempts, WEB_CHARGE),
                        };
                        if *used + charge > cap {
                            r.capped += 1;
                            continue;
                        }
                        *used += charge;
                        r.attempted += 1;
                        if item.backfill {
                            self.backfill
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .attempted
                                .insert((item.family, item.target, item.publication));
                        }
                        batch.push(self.capture_one(item, request));
                        if batch.len() >= self.config.concurrency {
                            break;
                        }
                    }
                    if batch.is_empty() {
                        break;
                    }
                    for (item, outcome, period) in super::join_all(batch).await {
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
            },
        )
        .await
    }
    /// The national minute page, once per 2-minute bucket while any cell has demand.
    pub async fn minute(&self, now_ms: i64) -> MinuteReport {
        crate::observability::root_work(
            crate::observability::Component::History,
            crate::observability::Stage::Worker,
            async {
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
                let minute = WebRequest::aws_minute(not_before);
                let deadline = Instant::now()
                    + owned_provider_time(minute.family().attempt_timeout(), 1)
                    + self.config.call_timeout;
                let acquired = self.source.acquire_web(&minute, deadline).await;
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
            },
        )
        .await
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
impl Request {
    /// The provider time the acquisition may spend (S13d): two legacy-timeout attempts for each
    /// page it may need (a KMA web page is one page).
    fn provider_time(&self) -> Duration {
        match self {
            Self::Funded(q) => owned_provider_time(
                q.family().service().attempt_timeout(),
                q.family().max_pages(),
            ),
            Self::Web(q) => owned_provider_time(q.family().attempt_timeout(), 1),
        }
    }
}
