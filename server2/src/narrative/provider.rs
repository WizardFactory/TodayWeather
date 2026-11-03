//! S08 funding is separate from WthrWrn and every other API of the same key.
use crate::providers::{
    AcquisitionError, AcquisitionOutcome, Candidate, Disposition, FundedExecutor, ProviderKey,
};
use crate::{domestic::kma::source::observe::DailyAcquirer, gateway::BoxFuture};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::time::Instant;

#[derive(Clone)]
pub struct Page {
    pub body: Arc<[u8]>,
    pub fetched_at_ms: u64,
    pub content_type: String,
}
/// Preserve the S08 failure category, including invalid funding versus exhausted quota.
pub type Error = AcquisitionError;
pub trait Source: Send + Sync {
    fn fetch(&self, station: u16, deadline: Instant) -> BoxFuture<'_, Result<Option<Page>, Error>>;
}
pub struct Funded<P, W, B> {
    daily: Arc<DailyAcquirer<P, W, B>>,
    url: reqwest::Url,
    selected: AtomicUsize,
}
impl<P, W, B> Funded<P, W, B> {
    pub fn new(daily: Arc<DailyAcquirer<P, W, B>>, root: &str) -> Result<Self, Error> {
        let url = reqwest::Url::parse(root)
            .and_then(|u| u.join("1360000/VilageFcstMsgService/getWthrSituation"))
            .map_err(|_| Error::Invalid)?;
        Ok(Self {
            daily,
            url,
            selected: AtomicUsize::new(0),
        })
    }
}
impl<P, W, B> Source for Funded<P, W, B>
where
    P: crate::providers::ProviderTransport + 'static,
    W: crate::providers::PublicTransport + 'static,
    B: crate::budget::BudgetTransport + 'static,
{
    fn fetch(&self, station: u16, deadline: Instant) -> BoxFuture<'_, Result<Option<Page>, Error>> {
        Box::pin(async move {
            let day = self.daily.day().await.map_err(|_| Error::Invalid)?;
            let budgets = &day.narratives;
            if budgets.is_empty() {
                return Err(Error::Invalid);
            }
            let mut url = self.url.clone();
            url.query_pairs_mut()
                .append_pair("stnId", &station.to_string())
                .append_pair("pageNo", "1")
                .append_pair("numOfRows", "10");
            let valid: fn(&serde_json::Value) -> bool = crate::warnings::provider::valid;
            let executor = FundedExecutor::new(
                crate::budget::Provider::DataGoKr,
                1,
                self.daily.funded_transport(),
                Arc::new(valid),
            )
            .map_err(|_| Error::Invalid)?;
            let start = self.selected.load(Ordering::Relaxed) % budgets.len();
            let mut last = Error::Invalid;
            for step in 0..budgets.len() {
                let i = (start + step) % budgets.len();
                let (budget, key) = &budgets[i];
                let candidate = Candidate {
                    budget: budget.clone(),
                    key: ProviderKey::new(key.clone()).map_err(|_| Error::Invalid)?,
                };
                // One executor candidate at a time: each configured key is tried at most once.
                match executor
                    .execute(url.clone(), vec![candidate], deadline)
                    .await
                {
                    Ok(outcome) => {
                        self.selected.store(i, Ordering::Relaxed);
                        return match outcome {
                            AcquisitionOutcome::NoData(raw) => {
                                if raw.status == 200 {
                                    Ok(None)
                                } else {
                                    Err(Error::Provider(Disposition::Rejected))
                                }
                            }
                            AcquisitionOutcome::Data(raw) => {
                                if raw.status != 200 {
                                    return Err(Error::Provider(Disposition::Rejected));
                                }
                                let fetched_at_ms = self
                                    .daily
                                    .clock()
                                    .now_ms()
                                    .ok()
                                    .and_then(|v| u64::try_from(v).ok())
                                    .ok_or(Error::Invalid)?;
                                Ok(Some(Page {
                                    body: raw.body.into(),
                                    fetched_at_ms,
                                    content_type: raw.content_type,
                                }))
                            }
                        };
                    }
                    Err(
                        error @ (AcquisitionError::Provider(Disposition::Auth | Disposition::Quota)
                        | AcquisitionError::Funding(_)
                        | AcquisitionError::Invalid),
                    ) => last = error,
                    Err(error) => return Err(error),
                }
            }
            Err(last)
        })
    }
}
