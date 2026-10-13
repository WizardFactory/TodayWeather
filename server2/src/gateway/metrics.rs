//! Process-wide aggregate gateway/geocoder counters for the loopback metrics listener.
//! Counters never record a path, coordinate, address, locale, key or provider text.
use std::sync::atomic::{AtomicU64, Ordering};

macro_rules! counters {
    ($($field:ident => $name:literal),+ $(,)?) => {
        /// Monotonic counters plus the owned-inflight gauge; relaxed ordering is sufficient.
        pub struct Counters { $(pub $field: AtomicU64,)+ }
        pub static COUNTERS: Counters = Counters { $($field: AtomicU64::new(0),)+ };
        /// Point-in-time copy with stable Prometheus-style names.
        pub fn snapshot() -> Vec<(&'static str, u64)> {
            vec![$(($name, COUNTERS.$field.load(Ordering::Relaxed)),)+]
        }
    };
}
counters! {
    requests => "server2_gateway_requests_total",
    ok => "server2_gateway_responses_ok_total",
    not_modified => "server2_gateway_responses_not_modified_total",
    client_error => "server2_gateway_responses_client_error_total",
    dependency_error => "server2_gateway_responses_dependency_error_total",
    unavailable => "server2_gateway_responses_unavailable_total",
    abandoned => "server2_gateway_abandoned_total",
    owned_inflight => "server2_gateway_owned_inflight",
    backend_attempts => "server2_gateway_backend_attempts_total",
    legacy_geocode_attempts => "server2_gateway_legacy_geocode_attempts_total",
    geocoder_cache_hits => "server2_geocoder_cache_hits_total",
    geocoder_joined => "server2_geocoder_joined_total",
    geocoder_flights => "server2_geocoder_flights_total",
    kakao_attempts => "server2_geocoder_kakao_attempts_total",
    google_attempts => "server2_geocoder_google_attempts_total",
    quota_rejections => "server2_geocoder_quota_rejections_total",
    capacity_rejections => "server2_geocoder_capacity_rejections_total",
}

pub(crate) fn add(counter: &AtomicU64) {
    counter.fetch_add(1, Ordering::Relaxed);
}

/// Text lines appended to the existing loopback metrics response.
pub fn render() -> String {
    snapshot()
        .into_iter()
        .map(|(name, value)| format!("{name} {value}\n"))
        .collect()
}

/// Classifies a completed public response by status class.
pub(crate) fn record_status(status: u16) {
    let c = &COUNTERS;
    match status {
        304 => add(&c.not_modified),
        503 => add(&c.unavailable),
        200..=299 => add(&c.ok),
        400..=499 => add(&c.client_error),
        _ => add(&c.dependency_error),
    }
}

/// Counts a request whose waiter disappeared before a response was produced.
pub(crate) struct Outcome {
    done: bool,
}
impl Outcome {
    pub(crate) fn start() -> Self {
        add(&COUNTERS.requests);
        Self { done: false }
    }
    pub(crate) fn finish(mut self, status: u16) {
        self.done = true;
        record_status(status);
    }
}
impl Drop for Outcome {
    fn drop(&mut self) {
        if !self.done {
            add(&COUNTERS.abandoned);
        }
    }
}

/// Gauge of spawned gateway owners; decremented when owned work actually ends.
pub(crate) struct Owned;
impl Owned {
    pub(crate) fn start() -> Self {
        add(&COUNTERS.owned_inflight);
        Self
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        COUNTERS.owned_inflight.fetch_sub(1, Ordering::Relaxed);
    }
}
