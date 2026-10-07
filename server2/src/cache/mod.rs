//! Bounded volatile cache primitives. No cache value is persisted.
mod index;
mod keys;
mod memory;
pub use index::{DomesticDay, RevisionIndex, WorldHour, WorldHours};
pub use keys::{GeocodeMemoryKey, ParsedKey, ResponseKey};
pub use memory::{ByteBudget, ByteLease, WeightedCache, WeightedValue};
