//! S13a domestic provider formats (AirKorea, KASI rise/set, forecast zone) and the shared
//! format-aware transport. Recorded/synthetic fixtures and loopback stubs only.
#[path = "providers/support.rs"]
mod support;

#[path = "formats/common.rs"]
mod common;
#[path = "formats/domestic.rs"]
mod domestic;
#[path = "formats/smoke.rs"]
mod smoke;
#[path = "formats/transport.rs"]
mod transport;
