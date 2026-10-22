//! Canonical catalog identities for a folded view; no raw or group descriptor reads.
use super::{
    forecast_cache::{Key, add, allocation, reserve, vector},
    records::{ForecastScope, Reader},
};
use crate::{
    history::{IndexListing, schedule},
    storage::{Envelope, Error},
};
use sha2::{Digest, Sha256};
use tokio::time::Instant;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Manifest {
    pub months: Vec<u32>,
    pub catalogs: Vec<(String, String)>,
}
/// Include every envelope field: fetch-group, page, content and original fetch identities.
pub(super) fn fingerprint<'a>(
    entries: impl Iterator<Item = &'a Envelope>,
) -> Result<String, Error> {
    let mut hashes: Vec<[u8; 32]> = Vec::new();
    for entry in entries {
        if hashes.len() >= 2048 {
            return Err(Error::Capacity);
        }
        let bytes = serde_json::to_vec(entry).map_err(|_| Error::Capacity)?;
        reserve(&mut hashes, 1)?;
        hashes.push(Sha256::digest(bytes).into());
    }
    hashes.sort_unstable();
    let mut digest = Sha256::new();
    for h in hashes {
        digest.update(h);
    }
    Ok(format!("{:x}", digest.finalize()))
}
impl Manifest {
    pub fn normalize(&mut self) {
        self.months.sort_unstable();
        self.months.dedup();
        self.catalogs.sort_unstable();
    }
    pub fn weight(&self) -> Result<usize, Error> {
        let mut total = add(vector(&self.months)?, vector(&self.catalogs)?)?;
        for (p, h) in &self.catalogs {
            total = add(
                total,
                add(allocation(p.capacity())?, allocation(h.capacity())?)?,
            )?;
        }
        Ok(total)
    }
    pub async fn unchanged<T: IndexListing + Clone>(
        &self,
        reader: &Reader<T>,
        key: &Key,
        now: f64,
        deadline: Instant,
    ) -> Result<bool, Error> {
        if self.months.len() > 1024 || self.catalogs.len() > 1024 {
            return Err(Error::Capacity);
        }
        let mut scope = ForecastScope::default();
        let provider = key.provider();
        let mut parts = reader
            .forecast_partitions(
                key.source(),
                key.kind(),
                &provider,
                &self.months,
                &mut scope,
                deadline,
            )
            .await?;
        let lookback = match key {
            Key::Grid(f, ..) => Some(super::lookback_ms(*f)),
            Key::Rss(..) => Some(super::RSS_LOOKBACK_MS),
            Key::Mid(..) => None,
        };
        if let Some(back) = lookback {
            let oldest = schedule::from_ms((now - back) as i64).partition();
            parts.retain(|p| *p >= oldest);
        }
        if parts.len() != self.catalogs.len()
            || parts
                .iter()
                .zip(&self.catalogs)
                .any(|(p, (old, _))| p != old)
        {
            return Ok(false);
        }
        let reads: Vec<crate::gateway::BoxFuture<'_, Result<bool, Error>>> = self
            .catalogs
            .iter()
            .map(|(partition, expected)| {
                Box::pin(async {
                    reader
                        .forecast_identity(key.source(), key.kind(), &provider, partition, deadline)
                        .await
                        .map(|found| found == *expected)
                }) as crate::gateway::BoxFuture<'_, Result<bool, Error>>
            })
            .collect();
        all_identities_match(reads).await
    }
}

async fn all_identities_match<F>(reads: impl IntoIterator<Item = F>) -> Result<bool, Error>
where
    F: std::future::Future<Output = Result<bool, Error>>,
{
    use futures_util::{StreamExt, stream};
    // Match the existing shared S3 gate. Futures borrow their inputs and are
    // dropped on rejection; no detached validation work survives this call.
    let mut pending = stream::iter(reads).buffer_unordered(12);
    while let Some(found) = pending.next().await {
        if !found? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    };

    #[tokio::test]
    async fn slow_catalog_does_not_block_other_available_validation_slots() {
        let started = Arc::new(AtomicUsize::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(tokio::sync::Notify::new());
        let progress = Arc::new(tokio::sync::Notify::new());
        let task = tokio::spawn({
            let (started, active, peak, release, progress) = (
                started.clone(),
                active.clone(),
                peak.clone(),
                release.clone(),
                progress.clone(),
            );
            async move {
                all_identities_match((0..25).map(|i| {
                    let (started, active, peak, release, progress) = (
                        started.clone(),
                        active.clone(),
                        peak.clone(),
                        release.clone(),
                        progress.clone(),
                    );
                    async move {
                        started.fetch_add(1, SeqCst);
                        let count = active.fetch_add(1, SeqCst) + 1;
                        peak.fetch_max(count, SeqCst);
                        if i == 0 {
                            release.notified().await;
                        } else {
                            tokio::task::yield_now().await;
                        }
                        active.fetch_sub(1, SeqCst);
                        if i == 24 {
                            progress.notify_one();
                        }
                        Ok(true)
                    }
                }))
                .await
            }
        });
        tokio::time::timeout(std::time::Duration::from_secs(1), progress.notified())
            .await
            .expect("remaining catalogs must finish while one catalog is still pending");
        assert_eq!(started.load(SeqCst), 25);
        assert_eq!(active.load(SeqCst), 1);
        assert!(peak.load(SeqCst) <= 12);
        release.notify_one();
        assert!(task.await.unwrap().unwrap());
    }

    #[tokio::test]
    async fn mismatch_or_error_cancels_pending_catalog_reads() {
        use std::sync::atomic::AtomicBool;
        struct Dropped(Arc<AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, SeqCst);
            }
        }
        for error in [false, true] {
            let dropped = Arc::new(AtomicBool::new(false));
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(1),
                all_identities_match((0..2).map(|i| {
                    let dropped = dropped.clone();
                    async move {
                        if i == 0 {
                            let _guard = Dropped(dropped);
                            std::future::pending::<()>().await;
                        }
                        if error {
                            Err(Error::Capacity)
                        } else {
                            Ok(false)
                        }
                    }
                })),
            )
            .await
            .expect("rejection must cancel pending reads without waiting for their deadlines");
            assert!(if error {
                result.is_err()
            } else {
                matches!(result, Ok(false))
            });
            assert!(
                dropped.load(SeqCst),
                "no detached validation read may survive rejection"
            );
        }
    }
}
