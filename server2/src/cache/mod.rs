//! Bounded volatile memory caches and optional disposable verified weather raw disk cache.
pub mod disk;
mod index;
mod keys;
mod memory;
pub use index::{DomesticDay, RevisionIndex, WorldHour, WorldHours};
pub use keys::{GeocodeMemoryKey, ParsedKey, ResponseKey};
pub use memory::{ByteBudget, ByteLease, WeightedCache, WeightedValue};
