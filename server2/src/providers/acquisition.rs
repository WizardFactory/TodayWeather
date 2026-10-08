use super::{
    Disposition, ProviderResponse, ProviderTransport, ProviderTransportError, Request, classify,
};
use crate::budget::{BudgetError, BudgetStore, BudgetTransport, Provider, Reservation};
use std::sync::Arc;
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};
/// Privately held secret. No Debug/serialization; never stored in budget objects.
pub struct ProviderKey(pub(crate) String);
impl ProviderKey {
    pub fn new(value: String) -> Result<Self, AcquisitionError> {
        if value.is_empty() || value.len() > 2048 || value.chars().any(char::is_control) {
            return Err(AcquisitionError::Invalid);
        }
        Ok(Self(value))
    }
}
pub struct Candidate<T> {
    pub budget: Arc<BudgetStore<T>>,
    pub key: ProviderKey,
}
pub trait Validator: Send + Sync + 'static {
    fn valid(&self, json: &serde_json::Value) -> bool;
}
impl<F: Fn(&serde_json::Value) -> bool + Send + Sync + 'static> Validator for F {
    fn valid(&self, json: &serde_json::Value) -> bool {
        self(json)
    }
}
/// Raw bytes only. Data requires caller S06 publication; NoData is RAM-only.
pub struct AcquiredBody {
    pub body: Vec<u8>,
    pub status: u16,
    pub content_type: String,
    pub attempts: u8,
}
/// Callers must explicitly distinguish weather data from terminal no-data.
/// NoData preserves the provider bytes in memory and is never a weather archive record.
pub enum AcquisitionOutcome {
    Data(AcquiredBody),
    NoData(AcquiredBody),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquisitionError {
    Invalid,
    Funding(BudgetError),
    Deadline,
    Provider(Disposition),
    Transport,
}
pub struct FundedExecutor<P, V> {
    provider: Provider,
    units: u64,
    transport: Arc<P>,
    validator: Arc<V>,
    cpu: Arc<Semaphore>,
    admission: Arc<Semaphore>,
}
impl<P: ProviderTransport, V: Validator> FundedExecutor<P, V> {
    pub fn new(
        provider: Provider,
        units: u64,
        transport: Arc<P>,
        validator: Arc<V>,
    ) -> Result<Self, AcquisitionError> {
        if match provider {
            Provider::DataGoKr => units != 1,
            Provider::VisualCrossing => !matches!(units, 49 | 25 | 1),
        } {
            return Err(AcquisitionError::Invalid);
        }
        Ok(Self {
            provider,
            units,
            transport,
            validator,
            cpu: Arc::new(Semaphore::new(2)),
            admission: Arc::new(Semaphore::new(4)),
        })
    }
    pub async fn execute<T: BudgetTransport>(
        &self,
        endpoint: reqwest::Url,
        candidates: Vec<Candidate<T>>,
        deadline: Instant,
    ) -> Result<AcquisitionOutcome, AcquisitionError> {
        if candidates.is_empty()
            || candidates.len() > 2
            || (self.provider == Provider::VisualCrossing && candidates.len() != 1)
            || candidates
                .iter()
                .any(|c| c.budget.policy().provider != self.provider)
        {
            return Err(AcquisitionError::Invalid);
        }
        if candidates.len() == 2 {
            let (a, b) = (&candidates[0], &candidates[1]);
            // Quota owner identity is provider + quota_id. A different window for
            // that owner does not make a second rotation key/quota.
            if Arc::ptr_eq(&a.budget, &b.budget)
                || a.key.0 == b.key.0
                || a.budget.policy().quota_id == b.budget.policy().quota_id
            {
                return Err(AcquisitionError::Invalid);
            }
        }
        if !super::transport::valid_endpoint(&endpoint) {
            return Err(AcquisitionError::Invalid);
        }
        let mut admission = timeout_at(deadline, self.admission.clone().acquire_owned())
            .await
            .map_err(|_| AcquisitionError::Deadline)?
            .map_err(|_| AcquisitionError::Invalid)?;
        // Pre-fund every permitted key, including the unused rotation candidate. No late reservation.
        let mut funds: Vec<Reservation> = Vec::with_capacity(candidates.len());
        for (i, c) in candidates.iter().enumerate() {
            let maximum = if i == 0 { self.units * 2 } else { self.units };
            funds.push(
                c.budget
                    .reserve(maximum, deadline)
                    .await
                    .map_err(AcquisitionError::Funding)?,
            );
        }
        let mut key = 0;
        for attempt in 1..=2 {
            funds[key]
                .consume(self.units, deadline)
                .map_err(AcquisitionError::Funding)?;
            let request = Request {
                endpoint: endpoint.clone(),
                key: ProviderKey(candidates[key].key.0.clone()),
                provider: self.provider,
            };
            let response = timeout_at(deadline, self.transport.send(&request))
                .await
                .map_err(|_| AcquisitionError::Deadline)?;
            let response = match response {
                Ok(r) => r,
                Err(ProviderTransportError::Response { status }) => {
                    // Incomplete bytes never reach JSON validation or Data/NoData.
                    // Preserve only received HTTP priority, not any partial provider code.
                    let disposition =
                        classify(status, &[], self.provider == Provider::DataGoKr, false);
                    if attempt == 2 || disposition == Disposition::Rejected {
                        return Err(AcquisitionError::Provider(disposition));
                    }
                    if matches!(disposition, Disposition::Quota | Disposition::Auth) {
                        if candidates.len() < 2 {
                            return Err(AcquisitionError::Provider(disposition));
                        }
                        key = 1;
                    }
                    continue;
                }
                Err(_) => {
                    if attempt == 1 {
                        continue;
                    }
                    return Err(AcquisitionError::Transport);
                }
            };
            if response.body.len() > 8 * 1024 * 1024 || response.content_type.len() > 512 {
                return Err(AcquisitionError::Transport);
            }
            let slot = timeout_at(deadline, self.cpu.clone().acquire_owned())
                .await
                .map_err(|_| AcquisitionError::Deadline)?
                .map_err(|_| AcquisitionError::Invalid)?;
            let validator = self.validator.clone();
            let is_data_go_kr = self.provider == Provider::DataGoKr;
            let task = tokio::task::spawn_blocking(move || {
                let _slot = slot;
                let valid = serde_json::from_slice::<serde_json::Value>(&response.body)
                    .ok()
                    .is_some_and(|v| validator.valid(&v));
                let disposition = classify(response.status, &response.body, is_data_go_kr, valid);
                (response, disposition, admission)
            });
            let (
                ProviderResponse {
                    status,
                    content_type,
                    body,
                },
                disposition,
                returned_admission,
            ) = timeout_at(deadline, task)
                .await
                .map_err(|_| AcquisitionError::Deadline)?
                .map_err(|_| AcquisitionError::Invalid)?;
            admission = returned_admission;
            if Instant::now() >= deadline {
                return Err(AcquisitionError::Deadline);
            }
            if matches!(disposition, Disposition::Data | Disposition::NoData) {
                let raw = AcquiredBody {
                    body,
                    status,
                    content_type,
                    attempts: attempt,
                };
                return Ok(if disposition == Disposition::NoData {
                    AcquisitionOutcome::NoData(raw)
                } else {
                    AcquisitionOutcome::Data(raw)
                });
            }
            if attempt == 2 || disposition == Disposition::Rejected {
                return Err(AcquisitionError::Provider(disposition));
            }
            if matches!(disposition, Disposition::Quota | Disposition::Auth) {
                if candidates.len() < 2 {
                    return Err(AcquisitionError::Provider(disposition));
                }
                key = 1;
            }
        }
        Err(AcquisitionError::Invalid)
    }
}
