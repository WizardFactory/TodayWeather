//! Per-key upfront geocoder funding using S08 durable range ownership.
use super::{GeoProvider, GeocodeError, ProviderDemand, Quota};
use crate::budget::{BudgetStore, BudgetTransport, Provider};
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio::time::Instant;
type Entry<T> = (GeoProvider, usize, Arc<BudgetStore<T>>);
pub struct FundedQuota<T> {
    entries: Vec<Entry<T>>,
}
impl<T: BudgetTransport> FundedQuota<T> {
    pub fn new(entries: Vec<Entry<T>>) -> Result<Self, GeocodeError> {
        if entries.is_empty() || entries.len() > 33 {
            return Err(GeocodeError::InvalidConfiguration);
        }
        for (i, (provider, index, store)) in entries.iter().enumerate() {
            let expected = match provider {
                GeoProvider::Kakao => Provider::Kakao,
                GeoProvider::Google => Provider::Google,
            };
            if store.policy().provider != expected
                || *index > 31
                || entries[..i].iter().any(|(p, k, s)| {
                    (p == provider && k == index)
                        || (s.policy().provider == expected
                            && s.policy().quota_id == store.policy().quota_id)
                })
            {
                return Err(GeocodeError::InvalidConfiguration);
            }
        }
        Ok(Self { entries })
    }
}
impl<T: BudgetTransport + 'static> Quota for FundedQuota<T> {
    fn reserve(
        &self,
        demands: Vec<ProviderDemand>,
    ) -> Pin<Box<dyn Future<Output = Result<(), GeocodeError>> + Send + '_>> {
        Box::pin(async move {
            if demands.is_empty() || demands.len() > 33 {
                return Err(GeocodeError::Quota);
            }
            // Resolve every quota owner before any reservation. Failures never authorize HTTP.
            let mut work = Vec::with_capacity(demands.len());
            for (i, d) in demands.iter().enumerate() {
                if d.attempts == 0
                    || d.attempts > 3
                    || demands[..i]
                        .iter()
                        .any(|v| v.provider == d.provider && v.key_index == d.key_index)
                {
                    return Err(GeocodeError::Quota);
                }
                let (_, _, store) = self
                    .entries
                    .iter()
                    .find(|(p, k, _)| *p == d.provider && *k == d.key_index)
                    .ok_or(GeocodeError::Quota)?;
                work.push((store, u64::from(d.attempts)));
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut reservations = Vec::with_capacity(work.len());
            for (store, maximum) in work {
                reservations.push((
                    store
                        .reserve(maximum, deadline)
                        .await
                        .map_err(|_| GeocodeError::Quota)?,
                    maximum,
                ));
            }
            // Consume the entire possible chain conservatively; unused attempts are not refunded.
            for (mut reservation, maximum) in reservations {
                reservation
                    .consume(maximum, deadline)
                    .map_err(|_| GeocodeError::Quota)?;
            }
            Ok(())
        })
    }
}
