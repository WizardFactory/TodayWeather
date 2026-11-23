//! Korean 24 solar-term calendar, official almanac reconciliation, and domestic summary ranking.

pub mod api;
pub mod astro;
pub mod calendar;
pub mod official;
pub mod pdf;
pub mod store;
pub mod summary;

use calendar::TermEntry;
use std::sync::Arc;
use std::time::Duration;

pub use summary::summary_cache_age;

/// Synchronous in-memory lookup used during domestic `v000903` KMA response assembly.
pub trait TermLookup: Send + Sync {
    /// Returns the active KR solar term for a KST civil date (`YYYY-MM-DD`) if the year snapshot
    /// is available and a term falls on that date.
    fn term_for_date(&self, iso_date: &str) -> Option<TermEntry>;

    /// Whether a complete year snapshot exists in memory for the given KST year.
    fn year_available(&self, year: i32) -> bool;

    /// Active validated Korean editorial policy.
    fn policy(&self) -> Arc<summary::Policy>;
}

/// Owned periodic reconciliation handle. Dropping or stopping cancels the background loop cleanly.
pub struct Worker(tokio::task::JoinHandle<()>);

impl Worker {
    pub async fn stop(mut self) {
        self.0.abort();
        let _ = (&mut self.0).await;
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub trait Reconcile: Send + Sync {
    fn tick(&self) -> crate::gateway::BoxFuture<'_, ()>;
}

pub fn worker(reconciler: Arc<dyn Reconcile>, every: Duration) -> Worker {
    Worker(crate::observability::spawn(async move {
        let mut interval = tokio::time::interval(every);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            reconciler.tick().await;
        }
    }))
}
