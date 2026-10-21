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
        for chunk in self.catalogs.chunks(super::records::LOOKUPS) {
            let reads = crate::history::join_all(
                chunk
                    .iter()
                    .map(|(p, _)| {
                        reader.forecast_identity(key.source(), key.kind(), &provider, p, deadline)
                    })
                    .collect(),
            )
            .await;
            for (found, (_, expected)) in reads.into_iter().zip(chunk) {
                if found? != *expected {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}
