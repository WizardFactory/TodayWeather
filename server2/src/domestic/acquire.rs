//! Funded data.go.kr page acquisition and keyless KMA web acquisition into one checked
//! `resolver::Acquisition`. Publication through S06 (O-9) remains the caller's step.
use super::family::{DataGoKrRequest, Endpoints, Service, WebRequest};
use super::format::{Expect, PageReport, PageVerdict, WebVerdict, inspect_page, inspect_web};
use super::metrics::DomesticMetrics;
use super::{Acquired, DomesticError};
use crate::budget::{BudgetStore, BudgetTransport, Clock, Provider};
use crate::providers::{
    AcquiredBody, AcquisitionError, AcquisitionOutcome, AttemptResult, CallReport, Candidate,
    Disposition, FundedExecutor, ProviderKey, ProviderTransport, ProviderTransportError,
    PublicRequest, PublicTransport, Validator,
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
        let start = self.current();
        let n = self.entries.len();
        let picked = if n > 1 {
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
        if advance > 0 {
            let next = (start + advance) % self.entries.len();
            let _ = self
                .current
                .compare_exchange(start, next, Ordering::AcqRel, Ordering::Acquire);
        }
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
            let mut report = CallReport::default();
            let result = self
                .funded
                .execute_reported(url, candidates, deadline, validator, &mut report)
                .await;
            self.metrics.record_call(&report, &result);
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
