//! Funded data.go.kr page acquisition and keyless KMA web acquisition into one checked
//! `resolver::Acquisition`. Publication through S06 (O-9) remains the caller's step.
use super::airkorea::AirKoreaRequest;
use super::airkorea_image::AirKoreaImageRequest;
use super::family::{DataGoKrRequest, Endpoints, Service, WebRequest};
use super::format::{Expect, PageReport, PageVerdict, WebVerdict, inspect_page, inspect_web};
use super::metrics::{CallGuard, DomesticMetrics};
use super::mfds::MfdsRequest;
use super::publication::Publication;
use super::quota::DataGoKrApi;
use super::riseset::RiseSetRequest;
use super::zone::ZoneRequest;
use super::{Acquired, DomesticError};
use crate::budget::{BudgetError, BudgetStore, BudgetTransport, Clock, Provider};
use crate::providers::{
    AcquiredBody, AcquisitionError, AcquisitionOutcome, AttemptResult, CallReport, Candidate,
    Disposition, FundedExecutor, ProviderKey, ProviderTransport, ProviderTransportError,
    PublicRequest, PublicTransport, ResponseFormat, Validator,
};
use crate::resolver::Acquisition;
use crate::storage::{
    CatalogId, CatalogLimits, GroupDeclaration, GroupMember, Pagination, RawRecord,
};
use std::{
    collections::{BTreeMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicI64, AtomicUsize, Ordering},
    },
};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};

const DATA_GO_KR: &str = "data-go-kr";
const KMA_WEB: &str = "kma-web";

/// Sticky per-service key position (#2604). Keys are secrets; budgets are their quota owners.
/// AirKorea uses `preferred` instead (legacy `withKeys`, S13b).
pub struct KeyRing<B> {
    entries: Vec<(ProviderKey, KeyBudgets<B>)>,
    current: AtomicUsize,
    /// Index of the key that last completed an AirKorea operation; `NONE` before any success.
    preferred: AtomicUsize,
    /// Per entry: epoch ms at which the KST day ends in which AirKorea answered quota for it
    /// (S13c, #2745); 0 before any quota answer. Shared by every AirKorea operation.
    exhausted_until: Vec<AtomicI64>,
}
const NONE: usize = usize::MAX;
const DAY_MS: i64 = 86_400_000;
const KST_MS: i64 = 9 * 3_600_000;
/// First instant of the KST calendar day after the one containing `now_ms` (data.go.kr quota day).
fn kst_day_end(now_ms: i64) -> i64 {
    (now_ms + KST_MS).div_euclid(DAY_MS) * DAY_MS + DAY_MS - KST_MS
}
/// One key's S08 budget per data.go.kr API.
pub type ApiBudgets<B> = BTreeMap<DataGoKrApi, Arc<BudgetStore<B>>>;
/// The S08 budgets of one ring key: one for every call (`One`), or one per data.go.kr API
/// (AK decision 5: data.go.kr allocates its daily quota per API and key).
pub enum KeyBudgets<B> {
    One(Arc<BudgetStore<B>>),
    PerApi(ApiBudgets<B>),
}
impl<B> KeyBudgets<B> {
    fn stores(&self) -> Vec<&Arc<BudgetStore<B>>> {
        match self {
            Self::One(b) => vec![b],
            Self::PerApi(map) => map.values().collect(),
        }
    }
    /// The budget funding a call of `api` (None: no budget for that API).
    fn for_api(&self, api: Option<DataGoKrApi>) -> Option<Arc<BudgetStore<B>>> {
        match self {
            Self::One(b) => Some(b.clone()),
            Self::PerApi(map) => api.and_then(|a| map.get(&a).cloned()),
        }
    }
}
impl<B: BudgetTransport> KeyRing<B> {
    /// One budget per key for every call of the ring.
    pub fn new(entries: Vec<(ProviderKey, Arc<BudgetStore<B>>)>) -> Result<Self, DomesticError> {
        Self::with_budgets(
            entries
                .into_iter()
                .map(|(k, b)| (k, KeyBudgets::One(b)))
                .collect(),
        )
    }
    /// One budget per key and data.go.kr API; a call of an API without a budget is refused.
    pub fn per_api(entries: Vec<(ProviderKey, ApiBudgets<B>)>) -> Result<Self, DomesticError> {
        if entries.iter().any(|(_, map)| map.is_empty()) {
            return Err(DomesticError::Invalid("key ring needs a budget per API"));
        }
        Self::with_budgets(
            entries
                .into_iter()
                .map(|(k, map)| (k, KeyBudgets::PerApi(map)))
                .collect(),
        )
    }
    fn with_budgets(entries: Vec<(ProviderKey, KeyBudgets<B>)>) -> Result<Self, DomesticError> {
        let mut keys = HashSet::new();
        let mut owners = HashSet::new();
        if entries.is_empty()
            || entries.len() > 64
            || entries.iter().any(|(key, budgets)| {
                !keys.insert(key.0.clone())
                    || budgets.stores().into_iter().any(|budget| {
                        budget.policy().provider != Provider::DataGoKr
                            || !owners.insert(budget.policy().quota_id.clone())
                    })
            })
        {
            return Err(DomesticError::Invalid(
                "key ring needs distinct data.go.kr keys and quota owners",
            ));
        }
        Ok(Self {
            exhausted_until: entries.iter().map(|_| AtomicI64::new(0)).collect(),
            entries,
            current: AtomicUsize::new(0),
            preferred: AtomicUsize::new(NONE),
        })
    }
    pub fn current(&self) -> usize {
        self.current.load(Ordering::Acquire)
    }
    /// AirKorea (legacy `withKeys`): the key that last completed an operation, if any.
    pub fn preferred(&self) -> Option<usize> {
        Some(self.preferred.load(Ordering::Acquire)).filter(|i| *i < self.entries.len())
    }
    /// S13c (#2745): whether entry `index` reached its daily quota in a KST day that has not
    /// ended at `now_ms`.
    pub fn exhausted(&self, index: usize, now_ms: i64) -> bool {
        self.exhausted_until
            .get(index)
            .is_some_and(|until| now_ms < until.load(Ordering::Acquire))
    }
    /// Marks entry `index` exhausted until the end of the KST day containing `now_ms`.
    fn exhaust(&self, index: usize, now_ms: i64) {
        if let Some(until) = self.exhausted_until.get(index) {
            until.fetch_max(kst_day_end(now_ms), Ordering::AcqRel);
        }
    }
    /// Legacy `withKeys` start: the last working key, otherwise the last configured key.
    fn legacy_start(&self) -> usize {
        self.preferred().unwrap_or(self.entries.len() - 1)
    }
    fn remember(&self, index: usize) {
        self.preferred.store(index, Ordering::Release);
    }
    fn candidate(
        &self,
        index: usize,
        api: Option<DataGoKrApi>,
    ) -> Result<Candidate<B>, DomesticError> {
        let (key, budgets) = &self.entries[index];
        Ok(Candidate {
            budget: budgets.for_api(api).ok_or(DomesticError::Invalid(
                "no S08 budget for this data.go.kr API",
            ))?,
            key: ProviderKey(key.0.clone()),
        })
    }
    /// One candidate: the key at `index` (no rotation inside the funded call), funded by its
    /// budget for `api`.
    fn single(
        &self,
        index: usize,
        api: Option<DataGoKrApi>,
    ) -> Result<Vec<Candidate<B>>, DomesticError> {
        Ok(vec![self.candidate(index, api)?])
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    /// The current key and, when configured, the next one as the single rotation candidate,
    /// each funded by its budget for `api`.
    fn candidates(
        &self,
        api: Option<DataGoKrApi>,
    ) -> Result<(usize, Vec<Candidate<B>>), DomesticError> {
        let start = self.current();
        let n = self.entries.len();
        let picked = if n > 1 {
            vec![start, (start + 1) % n]
        } else {
            vec![start]
        };
        let candidates = picked
            .into_iter()
            .map(|i| self.candidate(i, api))
            .collect::<Result<_, _>>()?;
        Ok((start, candidates))
    }
    /// Move to the answering key, or past provider-rejected/known locally exhausted keys.
    fn settle(&self, start: usize, report: &CallReport) {
        let answered = report.attempts.iter().rev().find_map(|(k, r)| {
            matches!(
                r,
                AttemptResult::Disposition(Disposition::Data | Disposition::NoData)
            )
            .then_some(usize::from(*k))
        });
        let rejected = report
            .attempts
            .iter()
            .filter(|(_, r)| {
                matches!(
                    r,
                    AttemptResult::Disposition(Disposition::Quota | Disposition::Auth)
                )
            })
            .map(|(k, _)| usize::from(*k) + 1)
            .chain(report.exhausted_keys.iter().map(|k| usize::from(*k) + 1))
            .max();
        let advance = answered.or(rejected).unwrap_or(0);
        if advance == 0 {
            return;
        }
        let n = self.entries.len();
        let next = (start + advance) % n;
        // Absolute positions this call saw rejected. A concurrent call may already have
        // moved the ring; move again only if it now points at one of those keys.
        let rejected_at: Vec<usize> = report
            .attempts
            .iter()
            .filter(|(_, r)| {
                matches!(
                    r,
                    AttemptResult::Disposition(Disposition::Quota | Disposition::Auth)
                )
            })
            .map(|(k, _)| (start + usize::from(*k)) % n)
            .chain(
                report
                    .exhausted_keys
                    .iter()
                    .map(|k| (start + usize::from(*k)) % n),
            )
            .collect();
        let _ = self
            .current
            .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current == start || rejected_at.contains(&current)).then_some(next)
            });
    }
}

struct PageValidator {
    request: DataGoKrRequest,
    page: u32,
    expect: Option<Expect>,
}
impl Validator for PageValidator {
    fn valid(&self, json: &serde_json::Value) -> bool {
        matches!(
            inspect_page(&self.request, self.page, self.expect, json),
            PageVerdict::Valid(_)
        )
    }
    fn no_data(&self, json: &serde_json::Value) -> bool {
        self.page == 1
            && matches!(
                inspect_page(&self.request, self.page, self.expect, json),
                PageVerdict::NotPublished | PageVerdict::Stale(_) | PageVerdict::NoData
            )
    }
}
/// Page facts of an S13a/S13b family page (AirKorea, KASI, forecast zone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PageFacts {
    pub(crate) total: u32,
    pub(crate) rows: u32,
    /// Row identities used to reject duplicates across pages.
    pub(crate) row_keys: Vec<String>,
    /// Newest publication on the page (data time, announcement, locdate or fetch day).
    pub(crate) publication: Publication,
    /// At least one row is usable (AirKorea concentration, a forecast of the searched
    /// announcement day, any station or zone row).
    pub(crate) usable: bool,
}
/// How a family's pages end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Paging {
    /// `totalCount` counts every page; page 1 fixes the page count.
    Total,
    /// `totalCount` counts the returned page only (getFcstZoneCd, #2740): a full page
    /// continues, a shorter page or `03` after a full page ends the list.
    UntilShort,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PageCheck {
    Valid(PageFacts),
    /// Terminal empty answer on page 1 (never a record).
    NoData,
    Invalid(&'static str),
}
/// A data.go.kr-key family with its own response format (S13a). Sealed to this crate.
pub(crate) trait Paged: Clone + Send + Sync + 'static {
    fn service(&self) -> Service;
    fn format(&self) -> ResponseFormat;
    /// `true`: a rejected key rotates to the next ring entry within the call (#2604).
    /// `false`: legacy AirKorea `withKeys` (S13b): one key per call, from the last working
    /// key or the last entry; a rejected credential or a quota answer (which also exhausts the
    /// key until the end of its KST day, S13c) restarts the call with the previous key.
    fn rotates(&self) -> bool;
    fn paging(&self) -> Paging {
        Paging::Total
    }
    /// For `Paging::UntilShort`: whether a later no-data body is the family's own end-of-list
    /// envelope (a gateway or XML `03` is not).
    fn ends_list(&self, _json: &serde_json::Value) -> bool {
        false
    }
    fn per_page(&self) -> u32;
    fn max_pages(&self) -> u32;
    fn kind(&self) -> &'static str;
    fn provider_key(&self) -> crate::storage::ProviderKey;
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<reqwest::Url, DomesticError>;
    fn partition(&self, publication: Publication) -> String;
    /// The publication of a complete acquisition from its pages: the newest page publication,
    /// except where a family dates the whole dataset differently (S15b-3 nationwide).
    fn publication(&self, pages: &[&PageFacts]) -> Option<Publication> {
        pages.iter().map(|f| f.publication).max()
    }
    /// `total` is page 1's count for later pages; `now_ms` is the fetch wall clock.
    fn inspect(
        &self,
        page: u32,
        total: Option<u32>,
        json: &serde_json::Value,
        now_ms: i64,
    ) -> PageCheck;
}
struct PagedValidator<F> {
    request: F,
    page: u32,
    total: Option<u32>,
    now_ms: i64,
}
impl<F: Paged> Validator for PagedValidator<F> {
    fn valid(&self, json: &serde_json::Value) -> bool {
        matches!(
            self.request
                .inspect(self.page, self.total, json, self.now_ms),
            PageCheck::Valid(_)
        )
    }
    fn no_data(&self, json: &serde_json::Value) -> bool {
        self.page == 1
            && self
                .request
                .inspect(self.page, self.total, json, self.now_ms)
                == PageCheck::NoData
    }
}
struct Unused;
impl Validator for Unused {
    fn valid(&self, _: &serde_json::Value) -> bool {
        false
    }
}

pub struct DomesticAcquirer<P, W, B> {
    funded: FundedExecutor<P, Unused>,
    public: Arc<W>,
    rings: BTreeMap<Service, KeyRing<B>>,
    endpoints: Endpoints,
    clock: Arc<dyn Clock>,
    metrics: Arc<DomesticMetrics>,
    limits: CatalogLimits,
    cpu: Arc<Semaphore>,
    public_admission: Arc<Semaphore>,
}
impl<P, W, B> DomesticAcquirer<P, W, B>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
{
    pub fn new(
        funded: Arc<P>,
        public: Arc<W>,
        rings: BTreeMap<Service, KeyRing<B>>,
        endpoints: Endpoints,
        clock: Arc<dyn Clock>,
        metrics: Arc<DomesticMetrics>,
        limits: CatalogLimits,
    ) -> Result<Self, DomesticError> {
        limits.validate().map_err(DomesticError::Storage)?;
        let funded = FundedExecutor::new(Provider::DataGoKr, 1, funded, Arc::new(Unused))
            .map_err(|_| DomesticError::Invalid("executor"))?;
        Ok(Self {
            funded,
            public,
            rings,
            endpoints,
            clock,
            metrics,
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            public_admission: Arc::new(Semaphore::new(4)),
            limits,
        })
    }
    pub fn ring(&self, service: Service) -> Option<&KeyRing<B>> {
        self.rings.get(&service)
    }
    fn now_ms(&self) -> Result<u64, DomesticError> {
        let now = self.clock.now_ms().map_err(DomesticError::Funding)?;
        u64::try_from(now).map_err(|_| DomesticError::Invalid("clock"))
    }
    async fn blocking<T: Send + 'static>(
        &self,
        deadline: Instant,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, DomesticError> {
        let slot = timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| DomesticError::Deadline)?
            .map_err(|_| DomesticError::Invalid("cpu admission"))?;
        timeout_at(
            deadline,
            crate::observability::spawn_blocking(move || {
                let _slot = slot;
                work()
            }),
        )
        .await
        .map_err(|_| DomesticError::Deadline)?
        .map_err(|_| DomesticError::Invalid("inspection task"))
    }
    async fn inspect(
        &self,
        request: &DataGoKrRequest,
        page: u32,
        expect: Option<Expect>,
        body: &AcquiredBody,
        deadline: Instant,
    ) -> Result<PageVerdict, DomesticError> {
        let (request, bytes) = (request.clone(), body.body.clone());
        self.blocking(deadline, move || {
            match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(json) => inspect_page(&request, page, expect, &json),
                Err(_) => PageVerdict::Invalid("json"),
            }
        })
        .await
    }

    /// Acquire every page of one data.go.kr request. Records exist only when all pages pass.
    pub async fn acquire(
        &self,
        request: &DataGoKrRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let family = request.family();
        let ring = self
            .rings
            .get(&family.service())
            .ok_or(DomesticError::Invalid("no key ring for service"))?;
        let mut pages: Vec<(AcquiredBody, PageReport, u64)> = Vec::new();
        let mut seen = HashSet::new();
        let mut expect = None;
        let mut count = 1;
        let mut page = 1;
        let incomplete = |reason| {
            self.metrics.incomplete();
            DomesticError::Incomplete(reason)
        };
        while page <= count {
            let url = request.endpoint(&self.endpoints, page)?;
            let validator = Arc::new(PageValidator {
                request: request.clone(),
                page,
                expect,
            });
            let (start, candidates) = ring.candidates(DataGoKrApi::of_url(&url))?;
            let mut guard = CallGuard::new(&self.metrics);
            let result = self
                .funded
                .execute_reported(url, candidates, deadline, validator, &mut guard.report)
                .await;
            let report = guard.finish(&result);
            ring.settle(start, &report);
            let body = match result {
                Ok(AcquisitionOutcome::Data(body)) => body,
                Ok(AcquisitionOutcome::NoData(body)) => {
                    if page > 1 {
                        return Err(incomplete("no data after the first page"));
                    }
                    return Ok(
                        match self.inspect(request, page, None, &body, deadline).await? {
                            PageVerdict::Stale(found) => {
                                self.metrics.stale();
                                Acquired::Stale(found)
                            }
                            PageVerdict::NoData => {
                                self.metrics.no_data();
                                Acquired::NoData
                            }
                            _ => {
                                self.metrics.not_published();
                                Acquired::NotPublished
                            }
                        },
                    );
                }
                Err(e) => {
                    if !pages.is_empty() {
                        self.metrics.incomplete();
                    }
                    return Err(e.into());
                }
            };
            let fetched = self.now_ms()?;
            let PageVerdict::Valid(report) =
                self.inspect(request, page, expect, &body, deadline).await?
            else {
                return Err(incomplete("page changed after validation"));
            };
            if pages
                .first()
                .is_some_and(|(_, first, _)| first.publication != report.publication)
            {
                return Err(incomplete("publication changed between pages"));
            }
            if report.row_keys.iter().any(|k| !seen.insert(k.clone())) {
                return Err(incomplete("duplicate row across pages"));
            }
            if page == 1 {
                count = if report.rows == report.total {
                    1
                } else {
                    report.total.div_ceil(family.rows())
                };
                if count > family.max_pages() || count as usize > self.limits.members {
                    return Err(incomplete("page count exceeds the family limit"));
                }
                expect = Some(Expect {
                    total: report.total,
                });
            }
            pages.push((body, report, fetched));
            page += 1;
        }
        let publication = pages[0].1.publication;
        let key = request.provider_key();
        let pages_total = pages.len() as u32;
        let records = pages
            .into_iter()
            .enumerate()
            .map(|(i, (body, _, fetched))| {
                RawRecord::new(
                    DATA_GO_KR,
                    family.kind(),
                    &key,
                    publication.period(),
                    fetched,
                    body.status,
                    content_type(&body.content_type),
                    Some(Pagination {
                        page: i as u32 + 1,
                        pages: pages_total,
                        complete: true,
                    }),
                    body.body.into(),
                    &self.limits.raw,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(DomesticError::Storage)?;
        self.group(records, &publication.partition())
    }

    /// AirKorea station or sido observations for one sido (S13a), the dust forecast of a
    /// search date or the station list (S13b). Every page must pass; keys follow legacy
    /// `withKeys`.
    pub async fn acquire_airkorea(
        &self,
        request: &AirKoreaRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        self.acquire_paged(request, deadline).await
    }
    /// KASI sunrise/sunset of one legacy area and day (S13a).
    pub async fn acquire_rise_set(
        &self,
        request: &RiseSetRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        self.acquire_paged(request, deadline).await
    }
    /// KMA ASOS hourly or daily observations of one station and range (S15b-2).
    pub async fn acquire_asos(
        &self,
        request: &super::asos::AsosRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        self.acquire_paged(request, deadline).await
    }
    /// The forecast-zone code list (data.go.kr `getFcstZoneCd`, S13b).
    pub async fn acquire_zones(
        &self,
        request: &ZoneRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        self.acquire_paged(request, deadline).await
    }
    async fn inspect_paged<F: Paged>(
        &self,
        request: &F,
        page: u32,
        total: Option<u32>,
        body: &AcquiredBody,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<PageCheck, DomesticError> {
        let (request, bytes) = (request.clone(), body.body.clone());
        self.blocking(deadline, move || {
            match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(json) => request.inspect(page, total, &json, now_ms),
                Err(_) => PageCheck::Invalid("json"),
            }
        })
        .await
    }
    async fn acquire_paged<F: Paged>(
        &self,
        request: &F,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let ring = self
            .rings
            .get(&request.service())
            .ok_or(DomesticError::Invalid("no key ring for service"))?;
        if request.rotates() {
            return self
                .collect_pages(request, ring, None, &mut false, deadline)
                .await;
        }
        // Legacy AirKorea `withKeys` (#2737): the last working key, otherwise the last entry,
        // then the previous entries with one wrap. A rejected credential moves to the previous
        // key for this call; a quota answer (429 or code 22) also marks the key exhausted until
        // the end of its KST day (S13c, #2745). Either restarts from page 1 within the same
        // deadline. A known API-local funding Exhausted also moves to the previous key
        // without setting the provider-wide quota marker; other funding failures stop.
        // A provider-exhausted key is skipped without funding or HTTP.
        let n = ring.len();
        let start = ring.legacy_start();
        let mut quota = false;
        let mut funding_exhausted = false;
        for step in 0..n {
            let index = (start + n - step) % n;
            if ring.exhausted(index, self.now_ms()? as i64) {
                quota = true;
                continue;
            }
            let mut skipped = false;
            match self
                .collect_pages(request, ring, Some(index), &mut skipped, deadline)
                .await
            {
                Err(DomesticError::Funding(BudgetError::Exhausted)) => {
                    // A local per-API cap is not a provider-wide KST quota answer.
                    // Try the next legacy key without marking exhausted_until.
                    funding_exhausted = true;
                }
                Err(DomesticError::Provider(Disposition::Auth)) => {}
                Err(DomesticError::Provider(Disposition::Quota)) => {
                    quota = true;
                    // Only a provider quota answer exhausts the key. A page recheck that found
                    // it already exhausted by a parallel call must not move the end of that
                    // exhaustion, for example across KST midnight (review S13C-R1).
                    if !skipped {
                        ring.exhaust(index, self.now_ms()? as i64);
                    }
                }
                Ok(outcome) => {
                    if matches!(outcome, Acquired::Complete(_)) {
                        ring.remember(index);
                    }
                    return Ok(outcome);
                }
                Err(e) => return Err(e),
            }
        }
        // Provider quota retains its KST semantics. Local funding denial never
        // becomes an authentication error or a provider-wide exhaustion marker.
        if !quota && funding_exhausted {
            return Err(DomesticError::Funding(BudgetError::Exhausted));
        }
        Err(DomesticError::Provider(if quota {
            Disposition::Quota
        } else {
            Disposition::Auth
        }))
    }
    /// All pages of one paged request; `fixed` pins one key (legacy AirKorea), otherwise the
    /// #2604 ring offers and settles its candidates. `skipped` is set when the fixed key was
    /// found exhausted before a page, so no quota answer was received for it.
    async fn collect_pages<F: Paged>(
        &self,
        request: &F,
        ring: &KeyRing<B>,
        fixed: Option<usize>,
        skipped: &mut bool,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let incomplete = |reason| {
            self.metrics.incomplete();
            DomesticError::Incomplete(reason)
        };
        let mut pages: Vec<(AcquiredBody, PageFacts, u64)> = Vec::new();
        let mut seen = HashSet::new();
        let (mut total, mut count, mut page) = (None, 1, 1);
        while page <= count {
            let url = request.endpoint(&self.endpoints, page)?;
            let now = self.now_ms()?;
            let validator = Arc::new(PagedValidator {
                request: request.clone(),
                page,
                total,
                now_ms: now as i64,
            });
            // A key that a parallel call marked exhausted while this one was paging is not
            // funded or sent again; the caller restarts with the next key (S13c).
            if fixed.is_some_and(|index| ring.exhausted(index, now as i64)) {
                if !pages.is_empty() {
                    self.metrics.incomplete();
                }
                *skipped = true;
                return Err(DomesticError::Provider(Disposition::Quota));
            }
            let api = DataGoKrApi::of_url(&url);
            let (start, candidates) = match fixed {
                Some(index) => (index, ring.single(index, api)?),
                None => ring.candidates(api)?,
            };
            let mut guard = CallGuard::new(&self.metrics);
            let result = self
                .funded
                .execute_formatted(
                    url,
                    request.format(),
                    candidates,
                    deadline,
                    validator,
                    &mut guard.report,
                )
                .await;
            let report = guard.finish(&result);
            if fixed.is_none() {
                ring.settle(start, &report);
            }
            let body = match result {
                Ok(AcquisitionOutcome::Data(body)) => body,
                // `03` after a full page ends a per-page list (#2740); it is not a record.
                Ok(AcquisitionOutcome::NoData(body))
                    if page > 1 && request.paging() == Paging::UntilShort =>
                {
                    let (request, bytes) = (request.clone(), body.body);
                    let ends = self
                        .blocking(deadline, move || {
                            serde_json::from_slice::<serde_json::Value>(&bytes)
                                .is_ok_and(|json| request.ends_list(&json))
                        })
                        .await?;
                    if !ends {
                        return Err(incomplete("invalid end of list"));
                    }
                    break;
                }
                Ok(AcquisitionOutcome::NoData(_)) => {
                    if page > 1 {
                        return Err(incomplete("no data after the first page"));
                    }
                    self.metrics.no_data();
                    return Ok(Acquired::NoData);
                }
                Err(e) => {
                    if !pages.is_empty() {
                        self.metrics.incomplete();
                    }
                    return Err(e.into());
                }
            };
            let fetched = self.now_ms()?;
            let PageCheck::Valid(facts) = self
                .inspect_paged(request, page, total, &body, now as i64, deadline)
                .await?
            else {
                return Err(incomplete("page changed after validation"));
            };
            if facts.row_keys.iter().any(|k| !seen.insert(k.clone())) {
                return Err(incomplete("duplicate row across pages"));
            }
            match request.paging() {
                Paging::Total if page == 1 => {
                    count = if facts.rows == facts.total {
                        1
                    } else {
                        facts.total.div_ceil(request.per_page())
                    };
                    total = Some(facts.total);
                }
                Paging::Total => {}
                Paging::UntilShort => {
                    count = if facts.rows < request.per_page() {
                        page
                    } else if page >= request.max_pages() {
                        // Legacy `page limit`: a full last allowed page fails the list.
                        return Err(incomplete("page count exceeds the family limit"));
                    } else {
                        page + 1
                    };
                }
            }
            if count > request.max_pages() || count as usize > self.limits.members {
                return Err(incomplete("page count exceeds the family limit"));
            }
            pages.push((body, facts, fetched));
            page += 1;
        }
        if !pages.iter().any(|(_, f, _)| f.usable) {
            return Err(incomplete("no usable row"));
        }
        let facts: Vec<&PageFacts> = pages.iter().map(|(_, f, _)| f).collect();
        let publication = request
            .publication(&facts)
            .ok_or(DomesticError::Invalid("no pages"))?;
        let key = request.provider_key();
        let pages_total = pages.len() as u32;
        let records = pages
            .into_iter()
            .enumerate()
            .map(|(i, (body, _, fetched))| {
                RawRecord::new(
                    DATA_GO_KR,
                    request.kind(),
                    &key,
                    publication.period(),
                    fetched,
                    body.status,
                    content_type(&body.content_type),
                    Some(Pagination {
                        page: i as u32 + 1,
                        pages: pages_total,
                        complete: true,
                    }),
                    body.body.into(),
                    &self.limits.raw,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(DomesticError::Storage)?;
        self.group(records, &request.partition(publication))
    }

    fn group(&self, records: Vec<RawRecord>, partition: &str) -> Result<Acquired, DomesticError> {
        let members = records
            .iter()
            .map(|r| {
                Ok(GroupMember {
                    envelope: r.envelope.clone(),
                    catalogs: vec![CatalogId::for_record(&r.envelope.identity, partition)?],
                })
            })
            .collect::<Result<Vec<_>, crate::storage::Error>>()
            .map_err(DomesticError::Storage)?;
        let declaration =
            GroupDeclaration::new(members, &self.limits).map_err(DomesticError::Storage)?;
        self.metrics.complete();
        Ok(Acquired::Complete(Acquisition {
            declaration,
            records,
        }))
    }

    /// Acquire the AirKorea forecast images of one announcement (S15b-3c, legacy master
    /// `getDustImage`): keyless GETs of the two validated image paths on the built-in image root,
    /// HTTP 200 only, each a GIF of the characterized shape (820x820, 48 frames; the legend is
    /// checked when it is decoded). They form one group with a manifest of the two URLs (page 1
    /// PM10, page 2 PM2.5, page 3 the manifest); a failure of either image stores nothing.
    pub async fn acquire_airkorea_images(
        &self,
        request: &AirKoreaImageRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let targets = request.paths().map(|path| {
            self.endpoints
                .image_url(path)
                .and_then(|u| PublicRequest::new(u).map_err(|_| DomesticError::Invalid("endpoint")))
        });
        let mut bodies = Vec::new();
        for target in targets {
            let target = target?;
            let _admission = timeout_at(deadline, self.public_admission.clone().acquire_owned())
                .await
                .map_err(|_| DomesticError::Deadline)?
                .map_err(|_| DomesticError::Invalid("admission"))?;
            self.metrics.public_attempt();
            let response = match timeout_at(deadline, self.public.fetch(&target)).await {
                Err(_) => return Err(DomesticError::Deadline),
                Ok(Ok(response)) => response,
                Ok(Err(ProviderTransportError::Invalid)) => {
                    return Err(DomesticError::Invalid("endpoint"));
                }
                Ok(Err(ProviderTransportError::Transport)) => {
                    return Err(DomesticError::Transport);
                }
                Ok(Err(_)) => return Err(DomesticError::Provider(Disposition::Rejected)),
            };
            if response.status != 200 {
                return Err(DomesticError::Provider(Disposition::Rejected));
            }
            let bytes = Arc::<[u8]>::from(response.body);
            let (view, check) = (bytes.clone(), request.clone());
            let valid = self
                .blocking(deadline, move || check.shape_ok(&view))
                .await?;
            if !valid {
                return Err(DomesticError::Invalid("INVALID_IMAGE"));
            }
            bodies.push((bytes, response.status, response.content_type));
        }
        bodies.push((
            Arc::<[u8]>::from(request.manifest()),
            200,
            "application/json".to_owned(),
        ));
        let fetched = self.now_ms()?;
        let pages = bodies.len() as u32;
        let records = bodies
            .into_iter()
            .enumerate()
            .map(|(i, (bytes, status, content))| {
                RawRecord::new(
                    super::airkorea_image::SOURCE,
                    super::airkorea_image::KIND,
                    &AirKoreaImageRequest::provider_key(),
                    request.period(),
                    fetched,
                    status,
                    content_type(&content),
                    Some(Pagination {
                        page: i as u32 + 1,
                        pages,
                        complete: true,
                    }),
                    bytes,
                    &self.limits.raw,
                )
                .map_err(DomesticError::Storage)
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.group(records, &request.partition())
    }

    /// Acquire the keyless MFDS food-poisoning table (S15b-3b): one attempt inside the legacy
    /// 10 s deadline (`fetchRisk` has no retry), HTTP 200 only, at most 1 MiB, and a body legacy
    /// `parse` accepts at the reception instant. Anything else is an error and no record.
    pub async fn acquire_mfds(
        &self,
        request: &MfdsRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let deadline = deadline.min(Instant::now() + super::mfds::TIMEOUT);
        let target = PublicRequest::new(request.endpoint().clone())
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        let _admission = timeout_at(deadline, self.public_admission.clone().acquire_owned())
            .await
            .map_err(|_| DomesticError::Deadline)?
            .map_err(|_| DomesticError::Invalid("admission"))?;
        self.metrics.public_attempt();
        let response = match timeout_at(deadline, self.public.fetch(&target)).await {
            Err(_) => return Err(DomesticError::Deadline),
            Ok(Ok(response)) => response,
            Ok(Err(ProviderTransportError::Invalid)) => {
                return Err(DomesticError::Invalid("endpoint"));
            }
            Ok(Err(ProviderTransportError::Transport)) => return Err(DomesticError::Transport),
            Ok(Err(_)) => return Err(DomesticError::Provider(Disposition::Rejected)),
        };
        if response.status != 200 {
            return Err(DomesticError::Provider(Disposition::Rejected));
        }
        if response.body.len() > super::mfds::MAX_BYTES {
            return Err(DomesticError::Invalid("mfds body size"));
        }
        let fetched = self.now_ms()?;
        let bytes = Arc::<[u8]>::from(response.body);
        let view = bytes.clone();
        let parsed = self
            .blocking(deadline, move || {
                serde_json::from_slice::<serde_json::Value>(&view)
                    .map_err(|_| "MFDS invalid JSON")
                    .and_then(|body| super::mfds::parse(&body, fetched as f64).map(|_| ()))
            })
            .await?;
        parsed.map_err(DomesticError::Invalid)?;
        let record = RawRecord::new(
            super::mfds::SOURCE,
            super::mfds::KIND,
            &MfdsRequest::provider_key(),
            request.period(),
            fetched,
            response.status,
            content_type(&response.content_type),
            None,
            bytes,
            &self.limits.raw,
        )
        .map_err(DomesticError::Storage)?;
        self.group(vec![record], &request.partition())
    }

    /// Acquire one keyless KMA web page. At most two attempts inside the deadline: only a
    /// status-less transport failure, an incomplete body or a 5xx is retried.
    pub async fn acquire_web(
        &self,
        request: &WebRequest,
        deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let target = PublicRequest::new(request.endpoint(&self.endpoints)?)
            .map_err(|_| DomesticError::Invalid("endpoint"))?;
        let _admission = timeout_at(deadline, self.public_admission.clone().acquire_owned())
            .await
            .map_err(|_| DomesticError::Deadline)?
            .map_err(|_| DomesticError::Invalid("admission"))?;
        for attempt in 1..=2 {
            self.metrics.public_attempt();
            let response = match timeout_at(deadline, self.public.fetch(&target)).await {
                Err(_) => return Err(DomesticError::Deadline),
                Ok(Ok(response)) => response,
                Ok(Err(ProviderTransportError::Invalid)) => {
                    return Err(DomesticError::Invalid("endpoint"));
                }
                Ok(Err(ProviderTransportError::Response { status }))
                    if (300..500).contains(&status) =>
                {
                    return Err(DomesticError::Provider(Disposition::Rejected));
                }
                Ok(Err(_)) if attempt == 1 => continue,
                Ok(Err(ProviderTransportError::Transport)) => {
                    return Err(DomesticError::Transport);
                }
                Ok(Err(_)) => return Err(DomesticError::Provider(Disposition::Retryable)),
            };
            if (500..600).contains(&response.status) {
                if attempt == 1 {
                    continue;
                }
                return Err(DomesticError::Provider(Disposition::Retryable));
            }
            if !(200..300).contains(&response.status) {
                return Err(DomesticError::Provider(Disposition::Rejected));
            }
            let fetched = self.now_ms()?;
            let (req, ct, bytes) = (
                request.clone(),
                response.content_type.clone(),
                Arc::<[u8]>::from(response.body),
            );
            let view = bytes.clone();
            let verdict = self
                .blocking(deadline, move || inspect_web(&req, &ct, &view))
                .await?;
            return match verdict {
                WebVerdict::Valid(publication) => {
                    let record = RawRecord::new(
                        KMA_WEB,
                        request.family().kind(),
                        &request.provider_key(),
                        publication.period(),
                        fetched,
                        response.status,
                        content_type(&response.content_type),
                        None,
                        bytes,
                        &self.limits.raw,
                    )
                    .map_err(DomesticError::Storage)?;
                    self.group(vec![record], &request.partition(publication))
                }
                WebVerdict::NotPublished => {
                    self.metrics.not_published();
                    Ok(Acquired::NotPublished)
                }
                WebVerdict::Stale(found) => {
                    self.metrics.stale();
                    Ok(Acquired::Stale(found))
                }
                WebVerdict::Invalid(reason) => Err(DomesticError::Invalid(reason)),
            };
        }
        Err(DomesticError::Provider(Disposition::Retryable))
    }
}

/// Received content type, or a neutral label when the provider sent none.
fn content_type(received: &str) -> &str {
    if received.is_empty() {
        "application/octet-stream"
    } else {
        received
    }
}

impl From<AcquisitionError> for DomesticError {
    fn from(e: AcquisitionError) -> Self {
        match e {
            AcquisitionError::Invalid => Self::Invalid("executor arguments"),
            AcquisitionError::Funding(e) => Self::Funding(e),
            AcquisitionError::Deadline => Self::Deadline,
            AcquisitionError::Provider(d) => Self::Provider(d),
            AcquisitionError::Transport => Self::Transport,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::{BudgetError, BudgetObject, BudgetPolicy};
    use crate::storage::WriteCondition;
    struct Unreachable;
    impl BudgetTransport for Unreachable {
        async fn get_budget(&self, _: &str) -> Result<BudgetObject, BudgetError> {
            Err(BudgetError::Transport)
        }
        async fn put_budget(
            &self,
            _: &str,
            _: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, BudgetError> {
            Err(BudgetError::Transport)
        }
    }
    struct Fixed;
    impl Clock for Fixed {
        fn now_ms(&self) -> Result<i64, BudgetError> {
            Ok(10)
        }
    }
    fn ring(n: usize) -> KeyRing<Unreachable> {
        let entries = (0..n)
            .map(|i| {
                let policy = BudgetPolicy {
                    provider: Provider::DataGoKr,
                    quota_id: format!("{i:x}").repeat(64),
                    window_id: "unit".into(),
                    starts_at_ms: 1,
                    ends_at_ms: 100,
                    limit: 10,
                    block_units: 10,
                };
                let store =
                    BudgetStore::new(Arc::new(Unreachable), policy, Arc::new(Fixed)).unwrap();
                (ProviderKey(format!("unit-key-{i}")), Arc::new(store))
            })
            .collect();
        KeyRing::new(entries).unwrap()
    }
    fn store(owner: &str, provider: Provider) -> Arc<BudgetStore<Unreachable>> {
        let policy = BudgetPolicy {
            provider,
            quota_id: owner.repeat(64),
            window_id: "unit".into(),
            starts_at_ms: 1,
            ends_at_ms: 100,
            limit: 10,
            block_units: 10,
        };
        Arc::new(BudgetStore::new(Arc::new(Unreachable), policy, Arc::new(Fixed)).unwrap())
    }
    /// AK decision 5: one budget per key and API; invalid rings are refused and a call of an
    /// API without a budget never reaches the transport.
    #[test]
    fn per_api_rings_validate_and_select_the_api_budget() {
        let key = |k: &str| ProviderKey(k.into());
        let map = |pairs: &[(DataGoKrApi, &str)]| {
            pairs
                .iter()
                .map(|(api, owner)| (*api, store(owner, Provider::DataGoKr)))
                .collect::<BTreeMap<_, _>>()
        };
        // Empty map, duplicate key, an owner reused within a key or across keys, wrong provider.
        assert!(KeyRing::<Unreachable>::per_api(vec![(key("a"), BTreeMap::new())]).is_err());
        assert!(
            KeyRing::per_api(vec![
                (key("a"), map(&[(DataGoKrApi::MidFcst, "1")])),
                (key("a"), map(&[(DataGoKrApi::MidFcst, "2")])),
            ])
            .is_err()
        );
        assert!(
            KeyRing::per_api(vec![(
                key("a"),
                map(&[(DataGoKrApi::MidFcst, "1"), (DataGoKrApi::VilageFcst, "1")])
            )])
            .is_err()
        );
        assert!(
            KeyRing::per_api(vec![
                (key("a"), map(&[(DataGoKrApi::MidFcst, "1")])),
                (key("b"), map(&[(DataGoKrApi::MidFcst, "1")])),
            ])
            .is_err()
        );
        let wrong: BTreeMap<_, _> = [(DataGoKrApi::MidFcst, store("3", Provider::Kakao))].into();
        assert!(KeyRing::per_api(vec![(key("a"), wrong)]).is_err());
        // A valid ring funds each API from its own budget; an API without one is refused.
        let ring = KeyRing::per_api(vec![
            (
                key("a"),
                map(&[(DataGoKrApi::MidFcst, "4"), (DataGoKrApi::FcstZone, "5")]),
            ),
            (
                key("b"),
                map(&[(DataGoKrApi::MidFcst, "6"), (DataGoKrApi::FcstZone, "7")]),
            ),
        ])
        .unwrap();
        let (start, candidates) = ring.candidates(Some(DataGoKrApi::FcstZone)).unwrap();
        assert_eq!(start, 0);
        let owners: Vec<_> = candidates
            .iter()
            .map(|c| c.budget.policy().quota_id.clone())
            .collect();
        assert_eq!(owners, vec!["5".repeat(64), "7".repeat(64)]);
        assert!(ring.candidates(Some(DataGoKrApi::VilageFcst)).is_err());
        assert!(ring.candidates(None).is_err());
        assert!(ring.single(1, Some(DataGoKrApi::MidFcst)).is_ok());
        assert!(ring.single(1, Some(DataGoKrApi::RiseSet)).is_err());
    }
    fn report(attempts: &[(u8, Disposition)]) -> CallReport {
        CallReport {
            reserved: vec![2, 1],
            attempts: attempts
                .iter()
                .map(|(k, d)| (*k, AttemptResult::Disposition(*d)))
                .collect(),
            exhausted_keys: Vec::new(),
        }
    }
    /// S13-R8: two calls started at key 0; the first moved to key 1, the second saw keys 0
    /// and 1 rejected. The later settle must still skip past key 1.
    #[test]
    fn concurrent_settles_do_not_lose_a_rejected_key_skip() {
        let r = ring(3);
        r.settle(
            0,
            &report(&[(0, Disposition::Quota), (1, Disposition::Data)]),
        );
        assert_eq!(r.current(), 1);
        r.settle(
            0,
            &report(&[(0, Disposition::Auth), (1, Disposition::Quota)]),
        );
        assert_eq!(r.current(), 2);
        // Reverse order: the stale success does not move the ring back onto a rejected key.
        let r = ring(3);
        r.settle(
            0,
            &report(&[(0, Disposition::Auth), (1, Disposition::Quota)]),
        );
        r.settle(
            0,
            &report(&[(0, Disposition::Quota), (1, Disposition::Data)]),
        );
        assert_eq!(r.current(), 2);
        // Unrelated movement by another call is preserved.
        let r = ring(3);
        r.settle(
            0,
            &report(&[(0, Disposition::Quota), (1, Disposition::Data)]),
        );
        r.settle(2, &report(&[(0, Disposition::Data)]));
        assert_eq!(r.current(), 1);
    }
}
