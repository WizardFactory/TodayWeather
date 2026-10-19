//! Local warning work bounds. The poll view is advisory; each post-claim and
//! after-OAuth admission still starts an independent strict source acquisition.
use super::{alarm::CONCURRENCY, warnings::CurrentZones};
use crate::{storage::Error, warnings::zones::ZoneState};
use futures_util::{StreamExt, stream::FuturesUnordered};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

pub(super) const MEMO_CAPACITY: usize = 65_536;
#[derive(Default)]
pub(super) struct TerminalMemo {
    groups: HashMap<String, HashSet<String>>,
    entries: usize,
}
impl TerminalMemo {
    pub(super) fn known(&self, group: &str, key: &str) -> bool {
        self.groups.get(group).is_some_and(|s| s.contains(key))
    }
    /// False is only an optimization bypass: it does not confer ownership or
    /// change the caller's ordinary durable-claim outcome.
    pub(super) fn record(&mut self, group: &str, key: String, capacity: usize) -> bool {
        if self.known(group, &key) {
            return true;
        }
        if self.entries >= capacity {
            return false;
        }
        self.groups.entry(group.into()).or_default().insert(key);
        self.entries += 1;
        true
    }
    pub(super) fn retain(&mut self, open: impl Iterator<Item = String>) {
        let open: HashSet<_> = open.collect();
        self.groups.retain(|g, _| open.contains(g));
        self.entries = self.groups.values().map(HashSet::len).sum();
    }
    fn key_bytes(&self) -> usize {
        self.groups
            .iter()
            .map(|(g, s)| g.len() + s.iter().map(String::len).sum::<usize>())
            .sum()
    }
}
#[derive(Default)]
pub(super) struct Counters {
    pub known_terminal: AtomicU64,
    pub saturated: AtomicU64,
    reads: AtomicU64,
    errors: AtomicU64,
    active_reads: AtomicU64,
    peak_reads: AtomicU64,
    active_jobs: AtomicU64,
    peak_jobs: AtomicU64,
}
/// Local counters only, not HTTP metrics, allocator overhead or process RSS.
#[derive(Clone, Debug, serde::Serialize)]
pub struct FanoutSnapshot {
    pub known_terminal_skips: u64,
    pub memo_saturation_bypasses: u64,
    pub strict_zone_reads: u64,
    pub zone_read_errors: u64,
    pub peak_live_reads: u64,
    pub peak_live_jobs: u64,
    pub memo_entries: usize,
    pub memo_key_bytes: usize,
}
impl Counters {
    pub(super) fn snapshot(&self, memo: &TerminalMemo) -> FanoutSnapshot {
        FanoutSnapshot {
            known_terminal_skips: self.known_terminal.load(Ordering::Relaxed),
            memo_saturation_bypasses: self.saturated.load(Ordering::Relaxed),
            strict_zone_reads: self.reads.load(Ordering::Relaxed),
            zone_read_errors: self.errors.load(Ordering::Relaxed),
            peak_live_reads: self.peak_reads.load(Ordering::Relaxed),
            peak_live_jobs: self.peak_jobs.load(Ordering::Relaxed),
            memo_entries: memo.entries,
            memo_key_bytes: memo.key_bytes(),
        }
    }
    pub(super) fn job(&self) -> Live<'_> {
        Live::new(&self.active_jobs, &self.peak_jobs)
    }
}
pub(super) struct Live<'a> {
    active: &'a AtomicU64,
}
impl<'a> Live<'a> {
    fn new(active: &'a AtomicU64, peak: &AtomicU64) -> Self {
        let n = active.fetch_add(1, Ordering::Relaxed) + 1;
        peak.fetch_max(n, Ordering::Relaxed);
        Self { active }
    }
}
impl Drop for Live<'_> {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::Relaxed);
    }
}

/// One poll only. Source errors affect unclaimed candidates, not a persisted
/// negative cache; the next ordinary poll creates a new view.
#[derive(Default)]
pub(super) struct PassView {
    initial: tokio::sync::OnceCell<Result<Arc<ZoneState>, Error>>,
    sequence: AtomicU64,
    latest: Mutex<Option<(u64, Arc<ZoneState>)>>,
}
impl PassView {
    fn offer(&self, seq: u64, value: &Arc<ZoneState>) {
        let mut latest = self.latest.lock().unwrap_or_else(|e| e.into_inner());
        if latest.as_ref().is_none_or(|(old, _)| *old < seq) {
            *latest = Some((seq, value.clone()));
        }
    }
    pub(super) async fn current(
        &self,
        source: &dyn CurrentZones,
        now: i64,
        counters: &Counters,
    ) -> Result<Arc<ZoneState>, Error> {
        if let Some((_, value)) = &*self.latest.lock().unwrap_or_else(|e| e.into_inner()) {
            return Ok(value.clone());
        }
        self.initial
            .get_or_init(|| self.fresh(source, now, counters))
            .await
            .clone()
    }
    /// Never join another caller's acquisition or return the advisory view.
    /// Caller retains its original outer admission deadline.
    pub(super) async fn fresh(
        &self,
        source: &dyn CurrentZones,
        now: i64,
        counters: &Counters,
    ) -> Result<Arc<ZoneState>, Error> {
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed);
        counters.reads.fetch_add(1, Ordering::Relaxed);
        let _live = Live::new(&counters.active_reads, &counters.peak_reads);
        let result = source.current(now).await.map(Arc::new);
        match &result {
            Ok(value) => self.offer(seq, value),
            Err(_) => {
                counters.errors.fetch_add(1, Ordering::Relaxed);
            }
        }
        result
    }
}
/// Preserve start order while constructing at most the existing six futures.
/// Registration/location/group metadata remains O(N), not O(6) process memory.
pub(super) async fn join_bounded<I, F>(jobs: I) -> Vec<F::Output>
where
    I: IntoIterator<Item = F>,
    F: Future,
{
    let mut jobs = jobs.into_iter();
    let mut active = FuturesUnordered::new();
    let mut out = Vec::new();
    for _ in 0..CONCURRENCY {
        if let Some(job) = jobs.next() {
            active.push(Box::pin(job));
        }
    }
    while let Some(value) = active.next().await {
        out.push(value);
        if let Some(job) = jobs.next() {
            active.push(Box::pin(job));
        }
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    struct Failed(AtomicUsize);
    impl CurrentZones for Failed {
        fn current(&self, _: i64) -> crate::gateway::BoxFuture<'_, Result<ZoneState, Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(Error::Transport) })
        }
    }
    #[test]
    fn full_memo_does_not_invent_new_endpoint_ownership() {
        let mut memo = TerminalMemo::default();
        assert!(memo.record("a", "exact-ledger-key1".into(), 1));
        assert!(memo.known("a", "exact-ledger-key1"));
        assert!(!memo.record("a", "new-endpoint-key".into(), 1));
        assert!(!memo.known("a", "new-endpoint-key"));
        memo.retain(["b".into()].into_iter());
        assert_eq!(memo.entries, 0);
        assert!(memo.record("b", "new-endpoint-key".into(), 1));
    }
    #[tokio::test]
    async fn dispatcher_lazily_constructs_at_most_six_futures_in_input_order() {
        let active = AtomicU64::new(0);
        let peak = AtomicU64::new(0);
        let starts = Mutex::new(Vec::new());
        let result = join_bounded((0..31).map(|n| {
            let lease = Live::new(&active, &peak);
            let starts = &starts;
            async move {
                let _lease = lease;
                starts.lock().unwrap().push(n);
                tokio::task::yield_now().await;
                n
            }
        }))
        .await;
        assert_eq!(result.len(), 31);
        assert_eq!(peak.load(Ordering::Relaxed), 6);
        assert_eq!(active.load(Ordering::Relaxed), 0);
        assert_eq!(*starts.lock().unwrap(), (0..31).collect::<Vec<_>>());
    }
    #[tokio::test]
    async fn older_completion_does_not_overwrite_a_newer_started_advisory_view() {
        let view = PassView::default();
        let old = Arc::new(ZoneState::default());
        let new = Arc::new(ZoneState::default());
        view.offer(2, &new);
        view.offer(1, &old);
        let source = Failed(AtomicUsize::new(0));
        assert!(Arc::ptr_eq(
            &view
                .current(&source, 0, &Counters::default())
                .await
                .unwrap(),
            &new
        ));
        assert_eq!(source.0.load(Ordering::SeqCst), 0);
    }
    #[tokio::test]
    async fn advisory_error_is_shared_only_until_the_next_poll() {
        let source = Failed(AtomicUsize::new(0));
        let counters = Counters::default();
        let view = PassView::default();
        assert!(view.current(&source, 0, &counters).await.is_err());
        assert!(view.current(&source, 0, &counters).await.is_err());
        assert_eq!(source.0.load(Ordering::SeqCst), 1);
        assert!(
            PassView::default()
                .current(&source, 0, &counters)
                .await
                .is_err()
        );
        assert_eq!(source.0.load(Ordering::SeqCst), 2);
        assert_eq!(counters.errors.load(Ordering::Relaxed), 2);
    }
}
