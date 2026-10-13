//! Aggregate acquisition counters. No key, URL, grid, coordinate or body is recorded.
use crate::providers::{AcquisitionError, AttemptResult, CallReport, Disposition};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

macro_rules! counters {
    ($($field:ident => $help:literal),* $(,)?) => {
        #[derive(Debug, Default)]
        pub struct DomesticMetrics {
            $($field: AtomicU64,)*
        }
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
        pub struct Snapshot {
            $(pub $field: u64,)*
        }
        impl DomesticMetrics {
            pub fn snapshot(&self) -> Snapshot {
                Snapshot { $($field: self.$field.load(Relaxed),)* }
            }
            /// Prometheus text exposition; not wired to a route by S13.
            pub fn render(&self) -> String {
                let s = self.snapshot();
                let mut out = String::new();
                $(
                    out.push_str(concat!("# HELP server2_domestic_", stringify!($field), "_total ", $help, "\n"));
                    out.push_str(concat!("# TYPE server2_domestic_", stringify!($field), "_total counter\n"));
                    out.push_str(&format!(concat!("server2_domestic_", stringify!($field), "_total {}\n"), s.$field));
                )*
                out
            }
        }
    };
}
counters! {
    funded_calls => "Funded data.go.kr executor calls (one per page request).",
    reserved_units => "Provider units durably reserved before HTTP; never refunded.",
    funded_attempts => "Funded HTTP attempts, each consuming one reserved unit.",
    attempts_data => "Funded attempts classified as data.",
    attempts_no_data => "Funded attempts classified as terminal no data, late or stale.",
    attempts_quota => "Funded attempts rejected for quota (429 or code 22).",
    attempts_auth => "Funded attempts rejected for authorization (401/403 or 20/30/31/32).",
    attempts_rejected => "Funded attempts rejected deterministically (other 4xx, 10, 12).",
    attempts_retryable => "Funded attempts with an invalid or transient response.",
    attempts_transport => "Funded attempts without a usable HTTP response.",
    attempts_deadline => "Funded attempts interrupted by the caller deadline.",
    funding_denied => "Calls stopped by budget funding before or between attempts.",
    public_attempts => "Keyless KMA web HTTP attempts.",
    groups_complete => "Complete acquisitions returned for publication.",
    groups_incomplete => "Acquisitions discarded after at least one valid page.",
    not_published => "Acquisitions answered as not yet published.",
    stale => "Acquisitions answered with an older publication.",
    no_data => "Acquisitions answered as terminal no data.",
}
impl DomesticMetrics {
    pub(crate) fn record_call<T>(&self, report: &CallReport, result: &Result<T, AcquisitionError>) {
        self.funded_calls.fetch_add(1, Relaxed);
        self.reserved_units
            .fetch_add(report.reserved_units(), Relaxed);
        self.funded_attempts
            .fetch_add(report.attempts.len() as u64, Relaxed);
        for (_, attempt) in &report.attempts {
            let counter = match attempt {
                AttemptResult::Disposition(Disposition::Data) => &self.attempts_data,
                AttemptResult::Disposition(Disposition::NoData) => &self.attempts_no_data,
                AttemptResult::Disposition(Disposition::Quota) => &self.attempts_quota,
                AttemptResult::Disposition(Disposition::Auth) => &self.attempts_auth,
                AttemptResult::Disposition(Disposition::Rejected) => &self.attempts_rejected,
                AttemptResult::Disposition(Disposition::Retryable) => &self.attempts_retryable,
                AttemptResult::Transport => &self.attempts_transport,
                AttemptResult::Deadline => &self.attempts_deadline,
            };
            counter.fetch_add(1, Relaxed);
        }
        if matches!(result, Err(AcquisitionError::Funding(_))) {
            self.funding_denied.fetch_add(1, Relaxed);
        }
    }
    pub(crate) fn public_attempt(&self) {
        self.public_attempts.fetch_add(1, Relaxed);
    }
    pub(crate) fn complete(&self) {
        self.groups_complete.fetch_add(1, Relaxed);
    }
    pub(crate) fn incomplete(&self) {
        self.groups_incomplete.fetch_add(1, Relaxed);
    }
    pub(crate) fn not_published(&self) {
        self.not_published.fetch_add(1, Relaxed);
    }
    pub(crate) fn stale(&self) {
        self.stale.fetch_add(1, Relaxed);
    }
    pub(crate) fn no_data(&self) {
        self.no_data.fetch_add(1, Relaxed);
    }
}
