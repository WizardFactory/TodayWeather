//! Aggregate S14 counters. No grid, coordinate or request detail is recorded.
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
pub struct HistoryMetrics {
    pub ticks: AtomicU64,
    pub minute_ticks: AtomicU64,
    pub planned: AtomicU64,
    pub attempted: AtomicU64,
    pub published: AtomicU64,
    pub not_published: AtomicU64,
    pub stale: AtomicU64,
    pub no_data: AtomicU64,
    pub failed: AtomicU64,
    pub budget_denied: AtomicU64,
    pub capped: AtomicU64,
}
impl HistoryMetrics {
    pub(crate) fn add(counter: &AtomicU64, n: u64) {
        counter.fetch_add(n, Ordering::Relaxed);
    }
    /// Prometheus text; not wired to `/internal/metrics` yet.
    pub fn render(&self) -> String {
        let rows = [
            ("ticks_total", &self.ticks),
            ("minute_ticks_total", &self.minute_ticks),
            ("captures_planned_total", &self.planned),
            ("captures_attempted_total", &self.attempted),
            ("captures_published_total", &self.published),
            ("captures_not_published_total", &self.not_published),
            ("captures_stale_total", &self.stale),
            ("captures_no_data_total", &self.no_data),
            ("captures_failed_total", &self.failed),
            ("budget_denied_total", &self.budget_denied),
            ("captures_capped_total", &self.capped),
        ];
        rows.iter()
            .map(|(name, v)| format!("server2_history_{name} {}\n", v.load(Ordering::Relaxed)))
            .collect()
    }
}
