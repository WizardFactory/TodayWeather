//! S14 legacy history and demand-gated capture (O-1, O-11). Internal library only: it wires no
//! route and starts no task. Durable demand lives under `state/demand/grid/`; capture uses the
//! S13 acquirer, S08 budgets and S06 publication. Coverage (corrected by AK, 2026-10-14) never
//! forwards to legacy: missing recent publications are fetched, older current hours back to D-7
//! take ASOS observations through the legacy #2564/#2648 history read, and older gaps stay
//! absent. No grid hour is invented. Parsing captured bodies into legacy rows is S15 assembly.
pub mod capture;
pub mod coverage;
pub mod demand;
pub mod index;
pub mod legacy;
pub mod metrics;
pub mod schedule;
mod transport;
pub use transport::IndexListing;

use crate::storage::ProviderKey;
use serde::{Deserialize, Serialize};

/// A KMA forecast grid cell. Never a user coordinate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grid {
    nx: u16,
    ny: u16,
}
impl Grid {
    pub fn new(nx: u16, ny: u16) -> Option<Self> {
        ((1..=149).contains(&nx) && (1..=253).contains(&ny)).then_some(Self { nx, ny })
    }
    pub fn nx(self) -> u16 {
        self.nx
    }
    pub fn ny(self) -> u16 {
        self.ny
    }
    fn valid(self) -> bool {
        Self::new(self.nx, self.ny).is_some()
    }
    /// The S05 provider key used by S13 grid records.
    pub fn provider_key(self) -> ProviderKey {
        ProviderKey::Grid {
            nx: self.nx,
            ny: self.ny,
        }
    }
    /// SHA-256 of the canonical provider key (the raw/catalog key segment).
    pub fn key_sha256(self) -> String {
        crate::storage::sha256(
            &self
                .provider_key()
                .canonical_bytes()
                .expect("validated grid key"),
        )
    }
}

/// Await every future, polling them concurrently (bounded by the caller's batch size).
pub(crate) async fn join_all<F: std::future::Future>(futures: Vec<F>) -> Vec<F::Output> {
    let mut futures: Vec<std::pin::Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    let mut out: Vec<Option<F::Output>> = futures.iter().map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (f, slot) in futures.iter_mut().zip(out.iter_mut()) {
            if slot.is_none() {
                match f.as_mut().poll(cx) {
                    std::task::Poll::Ready(v) => *slot = Some(v),
                    std::task::Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            std::task::Poll::Pending
        } else {
            std::task::Poll::Ready(())
        }
    })
    .await;
    out.into_iter().flatten().collect()
}
