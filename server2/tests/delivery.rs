//! S18b-1 scheduled alarm delivery (#2703): legacy worker parity, no automatic resend, the S3
//! delivery ledger and sanitized diagnostics. Only loopback doubles; no push provider is called.
#[path = "delivery/common.rs"]
mod common;
#[path = "delivery/faults.rs"]
mod faults;
#[path = "delivery/parity.rs"]
mod parity;
#[path = "state/common.rs"]
mod state_common;

#[path = "delivery/alerts.rs"]
mod alerts;
