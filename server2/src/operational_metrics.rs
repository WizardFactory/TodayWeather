//! Fixed native operation/admission metrics. No request identity enters a dimension.
use crate::observability::{Component, Outcome, Stage};
use std::sync::{
    Arc, LazyLock,
    atomic::{AtomicU64, Ordering::Relaxed},
};
use std::time::{Duration, Instant};

pub const MAX_SERIES: usize = 2048;
pub const MAX_CELLS: usize = 4096;
pub const MAX_TEXT: usize = 512 * 1024;
const BOUNDS: [u64; 9] = [
    1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 2_500_000, 9_000_000,
];
#[derive(Default)]
pub(crate) struct Counter(AtomicU64);
impl Counter {
    pub(crate) fn add(&self, n: u64) -> bool {
        let mut old = self.0.load(Relaxed);
        loop {
            let next = old.saturating_add(n);
            match self.0.compare_exchange_weak(old, next, Relaxed, Relaxed) {
                Ok(_) => return n > u64::MAX - old,
                Err(found) => old = found,
            }
        }
    }
    pub(crate) fn sub(&self) {
        let _ = self
            .0
            .try_update(Relaxed, Relaxed, |v| Some(v.saturating_sub(1)));
    }
    pub(crate) fn get(&self) -> u64 {
        self.0.load(Relaxed)
    }
}
#[derive(Default)]
pub(crate) struct Histogram {
    buckets: [Counter; 10],
    sum: Counter,
    saturation: Counter,
}
impl Histogram {
    pub(crate) fn observe(&self, elapsed: Duration) {
        let wide = elapsed.as_micros();
        let us = wide.min(u128::from(u64::MAX)) as u64;
        let index = BOUNDS.iter().position(|b| us <= *b).unwrap_or(9);
        let a = self.buckets[index].add(1);
        let b = self.sum.add(us);
        if a || b || wide > u128::from(u64::MAX) {
            self.saturation.add(1);
        }
    }
    fn render(&self, out: &mut String, stem: &str, labels: &str) {
        let values: [u64; 10] = std::array::from_fn(|i| self.buckets[i].get());
        let mut count = 0u64;
        for (i, value) in values.iter().enumerate() {
            count = count.saturating_add(*value);
            let le = if i < 9 {
                seconds(BOUNDS[i])
            } else {
                "+Inf".into()
            };
            line(
                out,
                &format!("{stem}_seconds_bucket"),
                &format!("{labels},le=\"{le}\""),
                count,
            );
        }
        line(out, &format!("{stem}_seconds_count"), labels, count);
        out.push_str(&format!(
            "{stem}_seconds_sum{{{labels}}} {}\n",
            seconds(self.sum.get())
        ));
        line(
            out,
            &format!("{stem}_saturated_total"),
            labels,
            self.saturation.get(),
        );
    }
}
fn seconds(us: u64) -> String {
    format!("{}.{:06}", us / 1_000_000, us % 1_000_000)
}
pub(crate) fn line(out: &mut String, name: &str, labels: &str, value: u64) {
    if labels.is_empty() {
        out.push_str(&format!("{name} {value}\n"));
    } else {
        out.push_str(&format!("{name}{{{labels}}} {value}\n"));
    }
}
const OPS: [&str; 24] = [
    "http_request",
    "world_restore",
    "world_acquire",
    "world_provider_http",
    "domestic_acquire",
    "provider_http",
    "quota_reserve",
    "s3_lookup",
    "s3_restore",
    "s3_publish",
    "s3_reconcile",
    "s3_provider_http",
    "cache_lookup",
    "cache_publish",
    "push_restore",
    "push_writer",
    "push_publish",
    "push_snapshot",
    "delivery_cycle",
    "delivery_send",
    "delivery_result",
    "notice_mutation",
    "readiness",
    "other",
];
const OUTCOMES: [&str; 12] = [
    "started",
    "completed",
    "success",
    "failed",
    "cancelled",
    "unknown",
    "accepted",
    "reconciled",
    "voided",
    "conflict",
    "skipped",
    "pending",
];
fn op(c: Component, s: Stage) -> usize {
    match (c, s) {
        (Component::Http, Stage::Request) => 0,
        (Component::World, Stage::Restore) => 1,
        (Component::World, Stage::Acquire) => 2,
        (Component::World, Stage::ProviderHttp) => 3,
        (Component::Domestic, Stage::Acquire) => 4,
        (Component::Provider, Stage::ProviderHttp) => 5,
        (Component::Quota, Stage::Reserve) => 6,
        (Component::S3, Stage::Lookup) => 7,
        (Component::S3, Stage::Restore) => 8,
        (Component::S3, Stage::Publish) => 9,
        (Component::S3, Stage::Reconcile) => 10,
        (Component::S3, Stage::ProviderHttp) => 11,
        (Component::Cache, Stage::Lookup) => 12,
        (Component::Cache, Stage::Publish | Stage::Maintenance) => 13,
        (Component::PushState, Stage::Restore) => 14,
        (Component::PushState, Stage::Writer) => 15,
        (Component::PushState, Stage::Publish) => 16,
        (Component::PushState, Stage::Snapshot) => 17,
        (Component::Delivery, Stage::Worker) => 18,
        (Component::Delivery, Stage::Send) => 19,
        (Component::Delivery, Stage::RecordResult) => 20,
        (Component::Notice, Stage::Publish | Stage::Submission) => 21,
        (Component::Process, Stage::Startup | Stage::Bind) => 22,
        _ => 23,
    }
}
fn outcome(o: Outcome) -> usize {
    match o {
        Outcome::Started => 0,
        Outcome::Completed => 1,
        Outcome::Success => 2,
        Outcome::Failed => 3,
        Outcome::Cancelled => 4,
        Outcome::Unknown => 5,
        Outcome::Accepted => 6,
        Outcome::Reconciled => 7,
        Outcome::Voided => 8,
        Outcome::Conflict => 9,
        Outcome::Skipped => 10,
        Outcome::Pending => 11,
    }
}
#[derive(Default)]
struct OpSeries {
    starts: Counter,
    finishes: [Counter; 12],
    time: Histogram,
}
static OPERATIONS: LazyLock<[OpSeries; 24]> =
    LazyLock::new(|| std::array::from_fn(|_| OpSeries::default()));
pub(crate) fn started(c: Component, s: Stage) {
    let m = &OPERATIONS[op(c, s)];
    if m.starts.add(1) {
        m.time.saturation.add(1);
    }
}
pub(crate) fn finished(c: Component, s: Stage, o: Outcome, elapsed: Duration) {
    let m = &OPERATIONS[op(c, s)];
    if m.finishes[outcome(o)].add(1) {
        m.time.saturation.add(1);
    }
    m.time.observe(elapsed);
}
const HTTP: [&str; 8] = [
    "http", "world", "domestic", "provider", "geocode", "s3", "delivery", "other",
];
const STATUS: [&str; 7] = ["none", "1xx", "2xx", "3xx", "4xx", "5xx", "other"];
fn http_component(c: Component) -> usize {
    match c {
        Component::Http => 0,
        Component::World => 1,
        Component::Domestic => 2,
        Component::Provider => 3,
        Component::Geocode => 4,
        Component::S3 => 5,
        Component::Delivery => 6,
        _ => 7,
    }
}
fn status(s: Option<u16>) -> usize {
    match s {
        None => 0,
        Some(100..=199) => 1,
        Some(200..=299) => 2,
        Some(300..=399) => 3,
        Some(400..=499) => 4,
        Some(500..=599) => 5,
        _ => 6,
    }
}
#[derive(Default)]
struct HttpSeries {
    starts: Counter,
    status: [Counter; 7],
    time: Histogram,
}
static HTTP_METRICS: LazyLock<[HttpSeries; 8]> =
    LazyLock::new(|| std::array::from_fn(|_| HttpSeries::default()));
/// Headers-only send attempt guard; dropped sends still have a terminal sample.
pub(crate) struct HttpAttempt {
    component: usize,
    start: Instant,
    done: bool,
}
impl HttpAttempt {
    pub(crate) fn start(c: Component) -> Self {
        let i = http_component(c);
        let m = &HTTP_METRICS[i];
        if m.starts.add(1) {
            m.time.saturation.add(1);
        }
        Self {
            component: i,
            start: Instant::now(),
            done: false,
        }
    }
    pub(crate) fn finish(&mut self, code: Option<u16>) {
        if self.done {
            return;
        }
        self.done = true;
        let m = &HTTP_METRICS[self.component];
        if m.status[status(code)].add(1) {
            m.time.saturation.add(1);
        }
        m.time.observe(self.start.elapsed());
    }
}
impl Drop for HttpAttempt {
    fn drop(&mut self) {
        self.finish(None);
    }
}
pub fn render() -> String {
    render_operations(&OPERATIONS, &HTTP_METRICS)
}
fn render_operations(operations: &[OpSeries; 24], http: &[HttpSeries; 8]) -> String {
    let mut out = String::new();
    for (i, m) in operations.iter().enumerate() {
        let labels = format!("op=\"{}\"", OPS[i]);
        line(
            &mut out,
            "server2_native_operation_started_total",
            &labels,
            m.starts.get(),
        );
        for (j, c) in m.finishes.iter().enumerate() {
            line(
                &mut out,
                "server2_native_operation_finished_total",
                &format!("{labels},outcome=\"{}\"", OUTCOMES[j]),
                c.get(),
            );
        }
        m.time
            .render(&mut out, "server2_native_operation_duration", &labels);
    }
    for (i, m) in http.iter().enumerate() {
        let labels = format!("component=\"{}\"", HTTP[i]);
        line(
            &mut out,
            "server2_native_http_attempt_started_total",
            &labels,
            m.starts.get(),
        );
        for (j, c) in m.status.iter().enumerate() {
            line(
                &mut out,
                "server2_native_http_attempt_finished_total",
                &format!("{labels},status_class=\"{}\"", STATUS[j]),
                c.get(),
            );
        }
        m.time
            .render(&mut out, "server2_native_http_headers_duration", &labels);
    }
    out
}
#[derive(Clone, Copy)]
pub enum CpuKind {
    Foundation,
    VcGzip,
    VcParse,
    WorldRestore,
    AirParse,
    AirRestore,
    StorageCodec,
    StorageControl,
}
impl CpuKind {
    pub(crate) fn index(self) -> usize {
        self as usize
    }
}
const CPU_NAMES: [&str; 8] = [
    "foundation",
    "vc_gzip",
    "vc_parse",
    "world_restore",
    "air_parse",
    "air_restore",
    "storage_codec",
    "storage_control",
];
#[derive(Default)]
pub(crate) struct CpuSeries {
    pub queued: Counter,
    pub admitted: Counter,
    pub active: Counter,
    pub running: Counter,
    pub rejected: Counter,
    pub queued_cancelled: Counter,
    pub started_cancelled: Counter,
    pub panicked: Counter,
    pub stopped: Counter,
    pub completed: Counter,
    pub deadline: Counter,
    pub wait: Histogram,
    pub run: Histogram,
}
#[derive(Default)]
pub(crate) struct CpuMetrics {
    pub series: [CpuSeries; 8],
}
impl CpuMetrics {
    pub(crate) fn render(&self, limit: usize) -> String {
        let mut out = String::new();
        let mut queued = 0u64;
        let mut not_running = 0u64;
        for (i, m) in self.series.iter().enumerate() {
            let label = format!("kind=\"{}\"", CPU_NAMES[i]);
            queued = queued.saturating_add(m.queued.get());
            not_running =
                not_running.saturating_add(m.active.get().saturating_sub(m.running.get()));
            for (name, v) in [
                ("queued", m.queued.get()),
                ("admitted_total", m.admitted.get()),
                ("active", m.active.get()),
                ("running", m.running.get()),
                ("rejected_total", m.rejected.get()),
                ("queued_cancelled_total", m.queued_cancelled.get()),
                ("started_cancelled_total", m.started_cancelled.get()),
                ("panic_total", m.panicked.get()),
                ("stopped_total", m.stopped.get()),
                ("completed_total", m.completed.get()),
                ("deadline_total", m.deadline.get()),
            ] {
                line(&mut out, &format!("server2_cpu_{name}"), &label, v);
            }
            m.wait.render(&mut out, "server2_cpu_queue_wait", &label);
            m.run
                .render(&mut out, "server2_cpu_running_duration", &label);
        }
        for (name, v) in [
            ("limit", limit as u64),
            ("queue_limit", 16),
            ("queued", queued),
            ("admitted_not_running", not_running),
        ] {
            line(&mut out, &format!("server2_cpu_pool_{name}"), "", v);
        }
        out
    }
}
#[derive(Clone, Copy)]
pub(crate) enum S3Kind {
    RawPut,
    RawHead,
    RawGet,
    ControlGet,
    ControlPut,
    RawList,
    IndexList,
    BudgetGet,
    BudgetPut,
    SummaryGet,
    SummaryPut,
    SummaryList,
}
const S3_NAMES: [&str; 12] = [
    "raw_put",
    "raw_head",
    "raw_get",
    "control_get",
    "control_put",
    "raw_list",
    "index_list",
    "budget_get",
    "budget_put",
    "summary_get",
    "summary_put",
    "summary_list",
];
#[derive(Default)]
struct S3Series {
    queued: Counter,
    active: Counter,
    admitted: Counter,
    queue_cancel: Counter,
    active_cancel: Counter,
    status: [Counter; 7],
    outcome: [Counter; 12],
    returned: Counter,
    attempted: Counter,
    wait: Histogram,
    time: Histogram,
}
#[derive(Default)]
pub struct S3Metrics {
    series: [S3Series; 12],
}
impl S3Metrics {
    pub(crate) fn queued(self: &Arc<Self>, kind: S3Kind) -> S3Guard {
        self.series[kind as usize].queued.add(1);
        S3Guard {
            metrics: self.clone(),
            kind: kind as usize,
            start: Instant::now(),
            admitted: None,
            done: false,
        }
    }
    pub fn render(&self, limit: usize) -> String {
        let mut out = String::new();
        let mut queued = 0u64;
        let mut active = 0u64;
        for (i, m) in self.series.iter().enumerate() {
            let label = format!("kind=\"{}\"", S3_NAMES[i]);
            queued = queued.saturating_add(m.queued.get());
            active = active.saturating_add(m.active.get());
            for (name, v) in [
                ("queued", m.queued.get()),
                ("active", m.active.get()),
                ("admitted_total", m.admitted.get()),
                ("queued_cancelled_total", m.queue_cancel.get()),
                ("active_cancelled_total", m.active_cancel.get()),
                ("returned_body_bytes_total", m.returned.get()),
                ("attempted_payload_bytes_total", m.attempted.get()),
            ] {
                line(&mut out, &format!("server2_s3_{name}"), &label, v);
            }
            for (j, c) in m.status.iter().enumerate() {
                line(
                    &mut out,
                    "server2_s3_terminal_status_total",
                    &format!("{label},status_class=\"{}\"", STATUS[j]),
                    c.get(),
                );
            }
            for (j, c) in m.outcome.iter().enumerate() {
                line(
                    &mut out,
                    "server2_s3_terminal_total",
                    &format!("{label},outcome=\"{}\"", OUTCOMES[j]),
                    c.get(),
                );
            }
            m.wait.render(&mut out, "server2_s3_queue_wait", &label);
            m.time
                .render(&mut out, "server2_s3_service_duration", &label);
        }
        for (name, v) in [
            ("limit", limit as u64),
            ("queued", queued),
            ("active", active),
        ] {
            line(&mut out, &format!("server2_s3_pool_{name}"), "", v);
        }
        out
    }
}
pub(crate) struct S3Guard {
    metrics: Arc<S3Metrics>,
    kind: usize,
    start: Instant,
    admitted: Option<Instant>,
    done: bool,
}
impl S3Guard {
    pub(crate) fn admit(&mut self, payload: usize) {
        let m = &self.metrics.series[self.kind];
        m.queued.sub();
        m.wait.observe(self.start.elapsed());
        m.active.add(1);
        m.admitted.add(1);
        m.attempted.add(payload as u64);
        self.admitted = Some(Instant::now());
    }
    pub(crate) fn result<T, E: crate::observability::Classify>(
        &mut self,
        result: &Result<T, E>,
        success: impl FnOnce(&T) -> (Option<u16>, usize),
    ) {
        let (code, outcome, bytes) = match result {
            Ok(v) => {
                let (code, bytes) = success(v);
                let outcome = match code {
                    Some(409 | 412) => Outcome::Conflict,
                    Some(400..=599) => Outcome::Failed,
                    _ => Outcome::Success,
                };
                (code, outcome, bytes)
            }
            Err(e) => {
                let (_, outcome, code) = e.classify();
                (code, outcome, 0)
            }
        };
        self.finish(code, outcome, bytes);
    }
    pub(crate) fn finish(&mut self, code: Option<u16>, outcome: Outcome, returned: usize) {
        if self.done {
            return;
        }
        self.done = true;
        let m = &self.metrics.series[self.kind];
        if let Some(start) = self.admitted {
            m.active.sub();
            m.time.observe(start.elapsed());
            m.status[status(code)].add(1);
            m.outcome[crate::operational_metrics::outcome(outcome)].add(1);
            m.returned.add(returned as u64);
        } else {
            m.queued.sub();
            m.wait.observe(self.start.elapsed());
            m.queue_cancel.add(1);
        }
    }
}
impl Drop for S3Guard {
    fn drop(&mut self) {
        if !self.done {
            if self.admitted.is_some() {
                self.metrics.series[self.kind].active_cancel.add(1);
                self.finish(None, Outcome::Unknown, 0);
            } else {
                self.finish(None, Outcome::Cancelled, 0);
            }
        }
    }
}

/// Concrete immutable handles only; scrapes perform atomic loads, never acquisitions.
#[derive(Clone)]
pub struct NativeMetricsView {
    pub resources: Arc<crate::runtime_resources::ProcessResources>,
    pub push: Option<Arc<crate::push::Counters>>,
    pub s3: Option<(Arc<S3Metrics>, usize)>,
    pub disk: Option<Arc<crate::cache::disk::DiskCache>>,
}
impl NativeMetricsView {
    pub fn render(&self) -> String {
        let mut out = self.resources.cpu.render();
        out.push_str(&self.resources.domestic.render());
        if let Some(p) = &self.push {
            out.push_str(&p.render());
        }
        if let Some((s, limit)) = &self.s3 {
            out.push_str(&s.render(*limit));
        }
        if let Some(d) = &self.disk {
            let m = d.metrics();
            for (name, v) in [
                ("hits_total", m.hits),
                ("misses_total", m.misses),
                ("writes_total", m.writes),
                ("errors_total", m.errors),
                ("corruptions_total", m.corruptions),
                ("evictions_total", m.evictions),
                ("bytes", m.bytes),
                ("peak_bytes", m.peak_bytes),
                ("root_observed_bytes", m.root_observed_bytes),
                ("peak_root_reserved_bytes", m.peak_root_reserved_bytes),
                ("entries", m.entries as u64),
                ("pending_writes", m.pending_writes as u64),
            ] {
                line(&mut out, &format!("server2_raw_cache_{name}"), "", v);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn max_counter(c: &Counter) {
        c.0.store(u64::MAX, Relaxed);
    }
    fn max_hist(h: &Histogram) {
        for c in &h.buckets {
            max_counter(c);
        }
        max_counter(&h.sum);
        max_counter(&h.saturation);
    }
    #[test]
    fn schema_at_maximum_counters_is_complete_bounded_and_identity_free() {
        let ops: [OpSeries; 24] = std::array::from_fn(|_| Default::default());
        let http: [HttpSeries; 8] = std::array::from_fn(|_| Default::default());
        let cpu = CpuMetrics::default();
        let s3 = S3Metrics::default();
        for m in &ops {
            max_counter(&m.starts);
            for c in &m.finishes {
                max_counter(c);
            }
            max_hist(&m.time);
        }
        for m in &http {
            max_counter(&m.starts);
            for c in &m.status {
                max_counter(c);
            }
            max_hist(&m.time);
        }
        for m in &cpu.series {
            for c in [
                &m.queued,
                &m.admitted,
                &m.active,
                &m.running,
                &m.rejected,
                &m.queued_cancelled,
                &m.started_cancelled,
                &m.panicked,
                &m.stopped,
                &m.completed,
                &m.deadline,
            ] {
                max_counter(c);
            }
            max_hist(&m.wait);
            max_hist(&m.run);
        }
        for m in &s3.series {
            for c in [
                &m.queued,
                &m.active,
                &m.admitted,
                &m.queue_cancel,
                &m.active_cancel,
                &m.returned,
                &m.attempted,
            ] {
                max_counter(c);
            }
            for c in &m.status {
                max_counter(c);
            }
            for c in &m.outcome {
                max_counter(c);
            }
            max_hist(&m.wait);
            max_hist(&m.time);
        }
        let mut text = render_operations(&ops, &http);
        assert_eq!(text.lines().count(), 792);
        text.push_str(&cpu.render(2));
        assert_eq!(text.lines().count(), 1092);
        text.push_str(&s3.render(12));
        assert_eq!(text.lines().count(), 1719);
        // Existing immutable views retain their names. Reserve 90 actual scalar lines at max width.
        let domestic = crate::domestic::metrics::DomesticMetrics::default().render();
        let push = crate::push::Counters::default().render();
        let count = domestic.lines().count() + push.lines().count() + 12;
        assert!(count <= 90, "existing native views grew: {count}");
        for line in domestic.lines().chain(push.lines()) {
            let (name, _) = line.rsplit_once(' ').unwrap();
            text.push_str(&format!("{name} {}\n", u64::MAX));
        }
        for name in [
            "hits_total",
            "misses_total",
            "writes_total",
            "errors_total",
            "corruptions_total",
            "evictions_total",
            "bytes",
            "peak_bytes",
            "root_observed_bytes",
            "peak_root_reserved_bytes",
            "entries",
            "pending_writes",
        ] {
            line(
                &mut text,
                &format!("server2_raw_cache_{name}"),
                "",
                u64::MAX,
            );
        }
        assert!(text.lines().count() <= 1809);
        assert!(text.lines().count() <= MAX_SERIES);
        assert!(text.len() <= MAX_TEXT);
        let cells = std::mem::size_of_val(&ops)
            + std::mem::size_of_val(&http)
            + std::mem::size_of_val(&cpu)
            + std::mem::size_of_val(&s3);
        assert!(cells / 8 + 90 <= MAX_CELLS);
        println!(
            "METRIC_BOUND core_rendered_series=1719 core_stored_u64={} conservative_existing_reserve_u64=90 conservative_total_stored_u64={} max_counter_core_and_views_bytes={}",
            cells / 8,
            cells / 8 + 90,
            text.len()
        );
        let mut identities = std::collections::BTreeSet::new();
        for line in text.lines() {
            let (name, value) = line.rsplit_once(' ').unwrap();
            assert!(identities.insert(name), "duplicate {name}");
            assert!(!value.is_empty());
            for label in ["url=", "key=", "token=", "lat=", "lon=", "id=", "path="] {
                assert!(!name.contains(label));
            }
        }
        for stem in [
            "server2_native_operation_duration",
            "server2_native_http_headers_duration",
            "server2_cpu_queue_wait",
            "server2_cpu_running_duration",
            "server2_s3_queue_wait",
            "server2_s3_service_duration",
        ] {
            assert!(text.contains(stem), "missing complete family {stem}");
        }
    }
    #[test]
    fn histogram_saturates_without_wrap_and_count_matches_its_bucket_snapshot() {
        let h = Histogram::default();
        max_counter(&h.buckets[0]);
        max_counter(&h.sum);
        h.observe(Duration::from_micros(1));
        assert_eq!(h.buckets[0].get(), u64::MAX);
        assert_eq!(h.sum.get(), u64::MAX);
        assert_eq!(h.saturation.get(), 1);
        let mut text = String::new();
        h.render(&mut text, "test", "kind=\"fixed\"");
        assert!(text.contains(&format!(
            "test_seconds_count{{kind=\"fixed\"}} {}",
            u64::MAX
        )));
    }
    #[test]
    fn s3_guards_count_logical_bytes_and_distinguish_queued_and_active_cancellation() {
        let m = Arc::new(S3Metrics::default());
        drop(m.queued(S3Kind::RawGet));
        {
            let mut g = m.queued(S3Kind::ControlPut);
            g.admit(17);
            g.finish(Some(200), Outcome::Success, 3);
        }
        {
            let mut g = m.queued(S3Kind::RawPut);
            g.admit(19);
        }
        assert_eq!(m.series[S3Kind::RawGet as usize].queue_cancel.get(), 1);
        assert_eq!(m.series[S3Kind::ControlPut as usize].attempted.get(), 17);
        assert_eq!(m.series[S3Kind::ControlPut as usize].returned.get(), 3);
        assert_eq!(m.series[S3Kind::RawPut as usize].active_cancel.get(), 1);
        assert_eq!(
            m.series[S3Kind::RawPut as usize].outcome[outcome(Outcome::Unknown)].get(),
            1
        );
        assert_eq!(m.series[S3Kind::RawPut as usize].active.get(), 0);
    }
    #[tokio::test]
    async fn complete_private_exposition_all_views_at_max_width_stays_inside_the_selected_bound() {
        use tower::ServiceExt;
        let config = crate::Config::default();
        let resources = crate::runtime_resources::ProcessResources::new(&config);
        let state = Arc::new(crate::SharedState::with_resources(
            &config,
            resources.clone(),
        ));
        let root =
            std::env::temp_dir().join(format!("server2-metrics-unopened-{}", std::process::id()));
        assert!(!root.exists());
        let disk = Arc::new(
            crate::cache::disk::DiskCache::new(&root, "owned-metrics-only", 4096, 1).unwrap(),
        );
        let view = NativeMetricsView {
            resources,
            push: Some(Arc::new(crate::push::Counters::default())),
            s3: Some((Arc::new(S3Metrics::default()), 12)),
            disk: Some(disk),
        };
        let response = crate::metrics_router_with_native(state, view)
            .oneshot(
                axum::http::Request::get("/internal/metrics")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), MAX_TEXT)
            .await
            .unwrap();
        let actual = std::str::from_utf8(&body).unwrap();
        let mut worst = String::new();
        let mut schema = std::collections::BTreeSet::new();
        for item in actual.lines() {
            if item.starts_with('#') || item.is_empty() {
                worst.push_str(item);
                worst.push('\n');
                continue;
            }
            let (name, _) = item.rsplit_once(' ').unwrap();
            assert!(schema.insert(name), "duplicate series {name}");
            let value = if name.split('{').next().unwrap().ends_with("_seconds_sum") {
                seconds(u64::MAX)
            } else {
                u64::MAX.to_string()
            };
            worst.push_str(&format!("{name} {value}\n"));
        }
        assert!(
            schema.len() <= 1809,
            "full actual schema has {} series",
            schema.len()
        );
        assert!(
            worst.len() <= MAX_TEXT,
            "max-width complete output {} bytes",
            worst.len()
        );
        assert!(
            !root.exists(),
            "scrape cannot initialize or read the configured cache"
        );
        let saturation = schema
            .iter()
            .filter(|name| {
                name.split('{')
                    .next()
                    .is_some_and(|n| n.ends_with("_saturated_total"))
            })
            .count();
        println!(
            "METRIC_BOUND actual_full_private_sample_series={} actual_normal_exposition_bytes={} synthetic_max_width_including_comments_bytes={} histogram_saturation_series={} labels_fixed=true",
            schema.len(),
            body.len(),
            worst.len(),
            saturation
        );
        assert_eq!(
            actual
                .lines()
                .filter(|line| line.starts_with("server2_domestic_"))
                .count(),
            crate::domestic::metrics::DomesticMetrics::default()
                .render()
                .lines()
                .filter(|line| line.starts_with("server2_domestic_"))
                .count(),
            "one domestic collector view is rendered once"
        );
    }
}
