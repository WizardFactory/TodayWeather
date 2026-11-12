//! S15b-3b: owned acquisitions of the life datasets for the KMA source.
//!
//! UV V5 and pollen V3 (all areas, S13 `DataGoKrRequest`), KASI area rise/set (S13a
//! `RiseSetRequest`) and the keyless MFDS table ([`crate::domestic::mfds`]). The funded requests
//! use the process data.go.kr acquirer of the KMA source (S15b-2 [`DailyAcquirer`]: the legacy
//! `DONGNAE_SECRET_KEYS` list (S10e), with one S08 quota owner per key and KST day); each complete group is published through S06 before any request uses it.
//!
//! KMA-LIFE-DISTINCT D2: a complete UV or pollen acquisition whose content a stored group of its
//! catalog already holds (the same members' raw hashes in page order, restored completely) is not
//! published again ([`LifeOutcome::Stored`]). The check has its own bound beside the provider's
//! time and the publication's, and publishes whenever it fails or runs out of time.
//!
//! No new setting: MFDS is the production endpoint legacy hard-codes.
use super::observe::DailyAcquirer;
use super::records::Reader;
use crate::budget::BudgetTransport;
use crate::domestic::family::{DataGoKrRequest, Service, owned_provider_time};
use crate::domestic::mfds::MfdsRequest;
use crate::domestic::publication::Publication;
use crate::domestic::riseset::RiseSetRequest;
use crate::domestic::{Acquired, DomesticAcquirer};
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::providers::{ProviderTransport, PublicTransport};
use crate::storage::{CatalogStore, GroupDeclaration};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// Legacy `fetchRisk` `maxBytes`.
pub const MFDS_MAX_BYTES: usize = crate::domestic::mfds::MAX_BYTES;
/// The MFDS acquirer: no key ring, a keyless transport without redirects that may connect
/// within the legacy 10 s deadline and stops reading at 1 MiB. `funded` is never used by it.
pub fn mfds_acquirer<P: ProviderTransport + 'static, B: BudgetTransport + 'static>(
    funded: Arc<P>,
    clock: Arc<dyn crate::budget::Clock>,
) -> Result<
    DomesticAcquirer<P, crate::providers::HttpPublicTransport, B>,
    crate::domestic::DomesticError,
> {
    // Legacy `fetchRisk`: one absolute 10 s deadline, connecting included.
    let public = crate::providers::HttpPublicTransport::without_redirects(
        MFDS_MAX_BYTES,
        crate::domestic::mfds::TIMEOUT,
    )
    .map_err(|_| crate::domestic::DomesticError::Invalid("mfds transport"))?;
    let endpoints = crate::domestic::family::Endpoints::new(
        "https://apis.data.go.kr/",
        "https://www.kma.go.kr/",
        "https://www.weather.go.kr/",
    )?;
    DomesticAcquirer::new(
        funded,
        Arc::new(public),
        Default::default(),
        endpoints,
        clock,
        Arc::new(crate::domestic::metrics::DomesticMetrics::default()),
        crate::storage::CatalogLimits::default(),
    )
}
/// S06 publication bound after a complete acquisition.
pub const PUBLISH_BUDGET: Duration = Duration::from_secs(10);
/// KMA-LIFE-DISTINCT D2: the bound of the check for a stored group with a complete UV or pollen
/// acquisition's content (its catalog read and every restore together), before its publication.
pub const CHECK_BUDGET: Duration = Duration::from_secs(3);

/// One owned life acquisition.
#[derive(Debug, Clone)]
pub enum LifeRequest {
    /// UV V5 or a pollen V3 index of all areas.
    Index(DataGoKrRequest),
    RiseSet(RiseSetRequest),
    /// The MFDS table of one collection slot (08:20, 12:20 or 17:20 KST).
    Mfds(Publication),
}
impl LifeRequest {
    /// The provider time one attempt allows from its start: two legacy attempts per page (MFDS:
    /// its one 10 s deadline).
    pub fn provider_time(&self) -> Duration {
        match self {
            Self::Index(r) => owned_provider_time(
                r.family().service().attempt_timeout(),
                r.family().max_pages(),
            ),
            Self::RiseSet(_) => owned_provider_time(Service::RiseSet.attempt_timeout(), 1),
            Self::Mfds(_) => crate::domestic::mfds::TIMEOUT,
        }
    }
    /// The time the owned acquisition allows: its provider time, the stored-group check of a UV or
    /// pollen index ([`CHECK_BUDGET`], KMA-LIFE-DISTINCT D2) and its publication.
    pub fn owned_for(&self) -> Duration {
        let check = match self {
            Self::Index(_) => CHECK_BUDGET,
            Self::RiseSet(_) | Self::Mfds(_) => Duration::ZERO,
        };
        self.provider_time() + check + PUBLISH_BUDGET
    }
}
/// What one owned acquisition did.
#[derive(Debug, Clone)]
pub enum LifeOutcome {
    /// A new complete group was published: its records, so the requests that wait for it use
    /// them without reading S3 again (KMA-RESTART-RACE).
    Published(Vec<crate::storage::RawRecord>),
    /// KMA-LIFE-DISTINCT D2: a complete UV or pollen acquisition whose content a stored group
    /// already holds, so nothing was published: its records, for the requests that wait for it,
    /// and that group's (catalog partition, completion), which a read of S3 applies for it.
    Stored {
        records: Vec<crate::storage::RawRecord>,
        twin: (String, u64),
    },
    /// The provider answered no data for the request (`03`/`99`: e.g. out of season).
    NoData,
    /// Nothing new (not published yet or an older publication).
    Nothing,
}
/// Acquire and publish one life dataset.
pub trait LifeAcquire: Send + Sync + 'static {
    /// `owner_deadline`: when the owned task running the acquisition ends (its start plus the
    /// owned time of its candidates, at most `MAX_OWNED`); a candidate never extends it.
    fn acquire(
        &self,
        request: LifeRequest,
        owner_deadline: Instant,
    ) -> BoxFuture<'static, Result<LifeOutcome, String>>;
}

/// Static settings of the life acquirer. No setting is read (AK, 2026-10-15: server2 uses the
/// legacy configuration only): MFDS is the production endpoint legacy hard-codes
/// (`lib/foodPoisoning.js` `ENDPOINT`).
#[derive(Debug, Clone)]
pub struct LifeSettings {
    pub mfds_root: reqwest::Url,
}
impl Default for LifeSettings {
    fn default() -> Self {
        Self {
            mfds_root: reqwest::Url::parse(crate::domestic::mfds::DEFAULT_ROOT)
                .expect("valid MFDS root"),
        }
    }
}
impl LifeSettings {
    /// Tests and local peers only: another MFDS root (HTTPS, or HTTP to a loopback address),
    /// ending in `/`, without a query.
    pub fn with_mfds_root(root: &str) -> Result<Self, String> {
        let mfds_root = reqwest::Url::parse(root)
            .ok()
            .filter(|u| {
                crate::providers::PublicRequest::new(u.clone()).is_ok()
                    && u.path().ends_with('/')
                    && u.query().is_none()
            })
            .ok_or("the MFDS root must be an HTTPS (or loopback HTTP) root")?;
        Ok(Self { mfds_root })
    }
}

struct Inner<P, W, B, T> {
    settings: LifeSettings,
    daily: Arc<DailyAcquirer<P, W, B>>,
    /// The MFDS acquirer: no key ring, and a keyless transport of its own (legacy `fetchRisk`:
    /// no redirect, 1 MiB enforced while reading).
    mfds: Arc<DomesticAcquirer<P, W, B>>,
    /// The S3 the acquisitions are published to and checked against (KMA-LIFE-DISTINCT D2).
    s3: Reader<T>,
}
/// The life acquirer with S06 publication.
pub struct LiveLife<P, W, B, T> {
    inner: Arc<Inner<P, W, B, T>>,
}
impl<P, W, B, T> LiveLife<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: IndexListing + Clone + 'static,
{
    /// `mfds` must be a [`DomesticAcquirer`] without key rings over a
    /// [`HttpPublicTransport::without_redirects`]`(`[`MFDS_MAX_BYTES`]`)` (see [`mfds_acquirer`]).
    /// Acquisitions are published to `store`; `transport`, the S3 `store` was built on, reads the
    /// catalog of a UV or pollen acquisition for a stored group with its content.
    pub fn new(
        settings: LifeSettings,
        daily: Arc<DailyAcquirer<P, W, B>>,
        mfds: Arc<DomesticAcquirer<P, W, B>>,
        transport: T,
        store: Arc<CatalogStore<T>>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                settings,
                daily,
                mfds,
                s3: Reader { transport, store },
            }),
        }
    }
}
impl<P, W, B, T> Inner<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: IndexListing + Clone + 'static,
{
    async fn run(
        &self,
        request: LifeRequest,
        owner_deadline: Instant,
    ) -> Result<LifeOutcome, String> {
        // The provider time from the start of this attempt: the check never extends it.
        let deadline = Instant::now() + request.provider_time();
        let outcome = match &request {
            LifeRequest::Index(r) => {
                let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
                acquirer.acquire(r, deadline).await
            }
            LifeRequest::RiseSet(r) => {
                let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
                acquirer.acquire_rise_set(r, deadline).await
            }
            LifeRequest::Mfds(slot) => {
                let request =
                    MfdsRequest::new(&self.settings.mfds_root, *slot).map_err(|e| e.to_string())?;
                self.mfds.acquire_mfds(&request, deadline).await
            }
        }
        .map_err(|e| e.to_string())?;
        match outcome {
            Acquired::Complete(a) => {
                if matches!(request, LifeRequest::Index(_))
                    && let Some(twin) = self.stored_twin(&a.declaration, owner_deadline).await
                {
                    return Ok(LifeOutcome::Stored {
                        records: a.records,
                        twin,
                    });
                }
                let records = a.records.clone();
                self.s3
                    .store
                    .publish(a.declaration, a.records, Instant::now() + PUBLISH_BUDGET)
                    .await
                    .map_err(|e| format!("publication: {e}"))?;
                Ok(LifeOutcome::Published(records))
            }
            Acquired::NoData => Ok(LifeOutcome::NoData),
            Acquired::NotPublished | Acquired::Stale(_) => Ok(LifeOutcome::Nothing),
        }
    }
    /// KMA-LIFE-DISTINCT D2: the stored group (partition, completion) a complete UV or pollen
    /// acquisition need not be published beside. Checked only while the owned task keeps
    /// [`CHECK_BUDGET`] and [`PUBLISH_BUDGET`], within one deadline for the catalog read and every
    /// restore; None (publish) otherwise, and when the check fails or runs out of time.
    async fn stored_twin(
        &self,
        declaration: &GroupDeclaration,
        owner_deadline: Instant,
    ) -> Option<(String, u64)> {
        let now = Instant::now();
        if owner_deadline.saturating_duration_since(now) < CHECK_BUDGET + PUBLISH_BUDGET {
            return None;
        }
        let by = now + CHECK_BUDGET;
        tokio::time::timeout_at(by, self.s3.stored_twin(declaration, by))
            .await
            .ok()?
            .ok()?
    }
}
impl<P, W, B, T> LifeAcquire for LiveLife<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: IndexListing + Clone + 'static,
{
    fn acquire(
        &self,
        request: LifeRequest,
        owner_deadline: Instant,
    ) -> BoxFuture<'static, Result<LifeOutcome, String>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.run(request, owner_deadline).await })
    }
}
