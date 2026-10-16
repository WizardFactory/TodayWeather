//! S18a push registration state (#2703): legacy registration contracts, ordered S3-durable
//! state, restore and the one-time registration copy. No push provider is called.
#[path = "state/common.rs"]
mod common;
#[path = "state/durability.rs"]
mod durability;
#[path = "state/migrate.rs"]
mod migrate;
#[path = "state/parity.rs"]
mod parity;
#[path = "state/peer.rs"]
mod peer;
