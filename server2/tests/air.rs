//! S13a world air chain: parsers, funded chain order, S3-only restore, privacy and a
//! release-mode smoke. Loopback provider stubs and the S06 S3 test peer only.
#[path = "world/common.rs"]
mod common;

#[path = "air/support.rs"]
mod support;

#[path = "air/chain.rs"]
mod chain;
#[path = "air/parsers.rs"]
mod parsers;
#[path = "air/privacy.rs"]
mod privacy;
#[path = "air/restore.rs"]
mod restore;
#[path = "air/smoke.rs"]
mod smoke;
#[path = "air/waiter.rs"]
mod waiter;
