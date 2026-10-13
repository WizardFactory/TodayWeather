//! S14 history: demand state, capture schedule/runner, coverage and legacy export import.
//! Recorded/synthetic fixtures, in-memory fakes, loopback provider stub and S3 peer only.
#[path = "providers/support.rs"]
mod provider_support;

#[path = "history/support.rs"]
mod support;

#[path = "history/capture.rs"]
mod capture;
#[path = "history/coverage.rs"]
mod coverage;
#[path = "history/demand.rs"]
mod demand;
#[path = "history/legacy.rs"]
mod legacy;
#[path = "history/schedule.rs"]
mod schedule;
#[path = "history/smoke.rs"]
mod smoke;
