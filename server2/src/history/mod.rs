//! S14 legacy history and demand-gated capture (O-1, O-11). Internal library only: it wires no
//! route and starts no task. Durable demand lives under `state/demand/grid/`; capture uses the
//! S13 acquirer, S08 budgets and S06 publication; coverage keeps a cell on legacy until exports
//! and captures hold every required publication. No grid hour is invented and ASOS never
//! substitutes for one. Parsing captured bodies into legacy rows is S15 assembly.
pub mod capture;
pub mod coverage;
pub mod demand;
pub mod index;
pub mod legacy;
pub mod metrics;
pub mod schedule;
mod transport;

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
