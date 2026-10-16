//! S18b-1 scheduled alarm delivery: the legacy alarm worker over server2 push state, the
//! legacy weather requests, FCM HTTP v1 without hidden retries, an S3 delivery ledger and
//! sanitized diagnostics. No process wiring yet (S20); tests use loopback doubles only.
pub mod alarm;
pub mod fcm;
pub mod ledger;
pub mod ops;
pub mod text;
pub mod weather;

pub use alarm::{AlarmWorker, Delivery, Diagnostics, Event, MinuteReport, StderrDiagnostics};
pub use fcm::{Endpoints, Fcm, Product, SendOutcome};
pub use weather::{Fetch, HttpFetch, Servers};
