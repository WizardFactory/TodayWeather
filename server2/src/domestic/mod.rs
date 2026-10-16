//! S13 domestic provider acquisition: request arguments, publication times, key rings and
//! raw-format checks. Produces checked `resolver::Acquisition` groups; it has no route,
//! scheduler or response assembly (S14/S15) and never stores normalized weather values.
mod acquire;
pub mod airkorea;
pub mod airkorea_image;
pub mod asos;
pub mod family;
pub mod format;
pub mod keys;
pub mod kma;
pub mod metrics;
pub mod mfds;
pub mod publication;
pub mod quota;
pub mod riseset;
pub mod zone;
use crate::{budget::BudgetError, providers::Disposition, resolver::Acquisition};
pub use acquire::{DomesticAcquirer, KeyBudgets, KeyRing};
use std::fmt;

/// Outcome of one acquisition. Only `Complete` carries raw records.
pub enum Acquired {
    /// All pages validated; publish through S06 before any new success (O-9).
    Complete(Acquisition),
    /// `03` or an empty `00` page, or a KMA page without a publication time.
    NotPublished,
    /// The provider answered an older (or other) publication than requested.
    Stale(publication::Publication),
    /// Life-index terminal no data (`03`/`99`).
    NoData,
}
impl fmt::Debug for Acquired {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Complete(a) => write!(f, "Complete({} records)", a.records.len()),
            Self::NotPublished => write!(f, "NotPublished"),
            Self::Stale(p) => write!(f, "Stale({})", p.compact()),
            Self::NoData => write!(f, "NoData"),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomesticError {
    Invalid(&'static str),
    Funding(BudgetError),
    Provider(Disposition),
    Transport,
    Deadline,
    /// A page set that cannot be proven complete; nothing is returned for storage.
    Incomplete(&'static str),
    Storage(crate::storage::Error),
}
impl fmt::Display for DomesticError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "domestic acquisition: {self:?}")
    }
}
impl std::error::Error for DomesticError {}
