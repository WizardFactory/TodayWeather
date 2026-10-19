//! S12 KMA warnings: `/v000903/kma/special` and `specialInfo` rebuilt from durable raw
//! records and per-type identity catalogs (#2697). Ported from legacy #2609 code at
//! ca8735cf; no runtime read reaches `server/`. Latest bulletins are derived in memory from
//! the type catalogs; there is no separately stored latest pointer or normalized view.
pub mod acquisition_worker;
pub mod collector;
pub mod js;
pub mod provider;
pub mod records;
pub mod seed;
pub mod service;
pub mod special;
pub mod store;
pub mod text;
pub mod zones;

pub use collector::{Report, WarningCollector};
pub use provider::{FundedSource, Operation, WarningSource};
pub use service::{ServiceConfig, WarningService};
pub use store::{StoreConfig, WarningStore};
pub use zones::Town;
