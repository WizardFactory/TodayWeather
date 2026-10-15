//! S15b-3b: owned acquisitions of the life datasets for the KMA source.
//!
//! UV V5 and pollen V3 (all areas, S13 `DataGoKrRequest`), KASI area rise/set (S13a
//! `RiseSetRequest`) and the keyless MFDS table ([`crate::domestic::mfds`]). The funded requests
//! use the process data.go.kr acquirer of the KMA source (S15b-2 [`DailyAcquirer`]:
//! `SERVER2_DATA_GO_KR_KEYS`, the legacy `DONGNAE_SECRET_KEYS` list, with one S08 quota owner per
//! key and KST day); each complete group is published through S06 before any request uses it.
//!
//! Setting (read only when `kma` is in `SERVER2_NATIVE_FAMILIES`): `SERVER2_MFDS_BASE_URL`, the
//! MFDS root, default `https://poisonmap.mfds.go.kr/`.
use super::observe::DailyAcquirer;
use crate::budget::BudgetTransport;
use crate::domestic::Acquired;
use crate::domestic::family::{DataGoKrRequest, Service, owned_provider_time};
use crate::domestic::mfds::MfdsRequest;
use crate::domestic::publication::Publication;
use crate::domestic::riseset::RiseSetRequest;
use crate::gateway::BoxFuture;
use crate::providers::{ProviderTransport, PublicTransport};
use crate::storage::{CatalogStore, CatalogTransport};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// S06 publication bound after a complete acquisition.
const PUBLISH_BUDGET: Duration = Duration::from_secs(10);

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
    /// The provider time the owned acquisition allows (two legacy attempts per page) plus its
    /// publication.
    pub fn owned_for(&self) -> Duration {
        let provider = match self {
            Self::Index(r) => owned_provider_time(
                r.family().service().attempt_timeout(),
                r.family().max_pages(),
            ),
            Self::RiseSet(_) => owned_provider_time(Service::RiseSet.attempt_timeout(), 1),
            Self::Mfds(_) => crate::domestic::mfds::TIMEOUT,
        };
        provider + PUBLISH_BUDGET
    }
}
/// What one owned acquisition did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifeOutcome {
    /// A new complete group was published.
    Published,
    /// The provider answered no data for the request (`03`/`99`: e.g. out of season).
    NoData,
    /// Nothing new (not published yet or an older publication).
    Nothing,
}
/// Acquire and publish one life dataset.
pub trait LifeAcquire: Send + Sync + 'static {
    fn acquire(&self, request: LifeRequest) -> BoxFuture<'static, Result<LifeOutcome, String>>;
}

/// Static settings of the life acquirer.
#[derive(Debug, Clone)]
pub struct LifeSettings {
    pub mfds_root: reqwest::Url,
}
impl LifeSettings {
    /// `SERVER2_MFDS_BASE_URL`: HTTPS (or loopback HTTP), ending in `/`, without a query.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, String> {
        let mfds = var("SERVER2_MFDS_BASE_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| crate::domestic::mfds::DEFAULT_ROOT.into());
        let mfds_root = reqwest::Url::parse(&mfds)
            .ok()
            .filter(|u| {
                crate::providers::PublicRequest::new(u.clone()).is_ok()
                    && u.path().ends_with('/')
                    && u.query().is_none()
            })
            .ok_or("SERVER2_MFDS_BASE_URL must be an HTTPS (or loopback HTTP) root")?;
        Ok(Self { mfds_root })
    }
}

struct Inner<P, W, B, T> {
    settings: LifeSettings,
    daily: Arc<DailyAcquirer<P, W, B>>,
    store: Arc<CatalogStore<T>>,
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
    T: CatalogTransport + 'static,
{
    pub fn new(
        settings: LifeSettings,
        daily: Arc<DailyAcquirer<P, W, B>>,
        store: Arc<CatalogStore<T>>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                settings,
                daily,
                store,
            }),
        }
    }
}
impl<P, W, B, T> Inner<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    async fn run(&self, request: LifeRequest) -> Result<LifeOutcome, String> {
        let acquirer = self.daily.today().await.map_err(|e| e.to_string())?;
        let deadline = Instant::now() + request.owned_for() - PUBLISH_BUDGET;
        let outcome = match &request {
            LifeRequest::Index(r) => acquirer.acquire(r, deadline).await,
            LifeRequest::RiseSet(r) => acquirer.acquire_rise_set(r, deadline).await,
            LifeRequest::Mfds(slot) => {
                let request =
                    MfdsRequest::new(&self.settings.mfds_root, *slot).map_err(|e| e.to_string())?;
                acquirer.acquire_mfds(&request, deadline).await
            }
        }
        .map_err(|e| e.to_string())?;
        match outcome {
            Acquired::Complete(a) => {
                self.store
                    .publish(a.declaration, a.records, Instant::now() + PUBLISH_BUDGET)
                    .await
                    .map_err(|e| format!("publication: {e}"))?;
                Ok(LifeOutcome::Published)
            }
            Acquired::NoData => Ok(LifeOutcome::NoData),
            Acquired::NotPublished | Acquired::Stale(_) => Ok(LifeOutcome::Nothing),
        }
    }
}
impl<P, W, B, T> LifeAcquire for LiveLife<P, W, B, T>
where
    P: ProviderTransport + 'static,
    W: PublicTransport + 'static,
    B: BudgetTransport + 'static,
    T: CatalogTransport + 'static,
{
    fn acquire(&self, request: LifeRequest) -> BoxFuture<'static, Result<LifeOutcome, String>> {
        let inner = self.inner.clone();
        Box::pin(async move { inner.run(request).await })
    }
}
