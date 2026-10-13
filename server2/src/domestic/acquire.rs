//! Funded data.go.kr page acquisition and keyless KMA web acquisition into one checked
//! `resolver::Acquisition`. Publication through S06 (O-9) remains the caller's step.
use super::airkorea::AirKoreaRequest;
use super::family::{DataGoKrRequest, Endpoints, Service, WebRequest};
use super::format::{Expect, PageReport, PageVerdict, WebVerdict, inspect_page, inspect_web};
use super::metrics::{CallGuard, DomesticMetrics};
use super::publication::Publication;
use super::riseset::RiseSetRequest;
use super::zone::ZoneRequest;
use super::{Acquired, DomesticError};
use crate::budget::{BudgetStore, BudgetTransport, Clock, Provider};
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
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};

const DATA_GO_KR: &str = "data-go-kr";
const KMA_WEB: &str = "kma-web";

/// Sticky per-service key position (#2604). Keys are secrets; budgets are their quota owners.
pub struct KeyRing<B> {
    entries: Vec<(ProviderKey, Arc<BudgetStore<B>>)>,
    current: AtomicUsize,
}
impl<B: BudgetTransport> KeyRing<B> {
    pub fn new(entries: Vec<(ProviderKey, Arc<BudgetStore<B>>)>) -> Result<Self, DomesticError> {
        let mut keys = HashSet::new();
        let mut owners = HashSet::new();
        if entries.is_empty()
            || entries.len() > 64
            || entries.iter().any(|(key, budget)| {
                budget.policy().provider != Provider::DataGoKr
                    || !keys.insert(key.0.clone())
                    || !owners.insert(budget.policy().quota_id.clone())
            })
        {
            return Err(DomesticError::Invalid(
                "key ring needs distinct data.go.kr keys and quota owners",
            ));
        }
        Ok(Self {
            entries,
            current: AtomicUsize::new(0),
        })
    }
    pub fn current(&self) -> usize {
        self.current.load(Ordering::Acquire)
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    /// The current key and, when configured, the next one as the single rotation candidate.
    fn candidates(&self) -> (usize, Vec<Candidate<B>>) {
        self.offer(true)
    }
    /// `candidates`, or only the current key for a service that never rotates (AirKorea).
    fn offer(&self, rotate: bool) -> (usize, Vec<Candidate<B>>) {
        let start = self.current();
        let n = self.entries.len();
        let picked = if n > 1 && rotate {
            vec![start, (start + 1) % n]
        } else {
            vec![start]
        };
        let candidates = picked
            .into_iter()
            .map(|i| Candidate {
                budget: self.entries[i].1.clone(),
                key: ProviderKey(self.entries[i].0.0.clone()),
            })
            .collect();
        (start, candidates)
    }
    /// Move to the key that answered, or past every key rejected for quota/auth.
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
/// Page facts of an S13a family page (AirKorea, KASI, forecast zone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PageFacts {
    pub(crate) total: u32,
    pub(crate) rows: u32,
    /// Row identities used to reject duplicates across pages.
    pub(crate) row_keys: Vec<String>,
    /// Newest publication on the page (data time, locdate or fetch day).
    pub(crate) publication: Publication,
    /// At least one row carries a usable value (AirKorea concentration).
    pub(crate) usable: bool,
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
    /// Whether a rejected key rotates to the next ring entry within the call (#2604).
    fn rotates(&self) -> bool;
    fn per_page(&self) -> u32;
    fn max_pages(&self) -> u32;
    fn kind(&self) -> &'static str;
    fn provider_key(&self) -> crate::storage::ProviderKey;
    fn endpoint(&self, endpoints: &Endpoints, page: u32) -> Result<reqwest::Url, DomesticError>;
    fn partition(&self, publication: Publication) -> String;
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
            tokio::task::spawn_blocking(move || {
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
            let (start, candidates) = ring.candidates();
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

    /// AirKorea station or sido observations for one sido (S13a). Every page must pass.
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
    /// The forecast-zone code list (S13a).
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
            let (start, candidates) = ring.offer(request.rotates());
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
            // A non-rotating service (AirKorea) keeps its one selected key (#2636).
            if request.rotates() {
                ring.settle(start, &report);
            }
            let body = match result {
                Ok(AcquisitionOutcome::Data(body)) => body,
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
            if page == 1 {
                count = if facts.rows == facts.total {
                    1
                } else {
                    facts.total.div_ceil(request.per_page())
                };
                if count > request.max_pages() || count as usize > self.limits.members {
                    return Err(incomplete("page count exceeds the family limit"));
                }
                total = Some(facts.total);
            }
            pages.push((body, facts, fetched));
            page += 1;
        }
        if !pages.iter().any(|(_, f, _)| f.usable) {
            return Err(incomplete("no usable observation"));
        }
        let publication = pages
            .iter()
            .map(|(_, f, _)| f.publication)
            .max()
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
    fn report(attempts: &[(u8, Disposition)]) -> CallReport {
        CallReport {
            reserved: vec![2, 1],
            attempts: attempts
                .iter()
                .map(|(k, d)| (*k, AttemptResult::Disposition(*d)))
                .collect(),
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
