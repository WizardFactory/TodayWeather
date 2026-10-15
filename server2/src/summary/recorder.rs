//! The post-response summary recorder. After a natively served v000903 response whose snapshot
//! read complete inputs, it stores the complete grid days of the town and the complete ASOS days
//! of its mapped station. It never delays a response: the work runs as a bounded background task.
//!
//! Per (source, key, date) memory keeps the last examined input digest and the newest stored
//! revision. An input set already examined costs nothing; a new one writes a revision only when
//! its values differ from the newest stored revision and its newest input is not older (late
//! inputs recompute; an older input set never supersedes a newer one). A cold process reads the
//! newest stored revision first.
use super::grid::{self, GridInputs};
use super::store::SummaryStore;
use super::transport::SummaryTransport;
use super::{Source, Summary, add_days, kst_date};
use crate::gateway::OrderedJson;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::Instant;

/// Record tasks running at once; a request finding both busy records nothing (a later request
/// of the town repeats the work).
pub const TASKS: usize = 2;
/// Memory entries kept; beyond this, entries of dates before today-8 are dropped first.
pub const MEMORY_ENTRIES: usize = 65_536;
/// Bound of one record task (S3 reads and writes, not a provider call).
const TASK_TIME: Duration = Duration::from_secs(30);

/// Receives the summary inputs of a natively served response (the KMA backend calls it).
pub trait SummarySink: Send + Sync + 'static {
    fn record(&self, inputs: GridInputs, rows: Vec<OrderedJson>, now_ms: f64);
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecordReport {
    /// Object keys of the revisions written.
    pub written: Vec<String>,
    /// Candidates with an examined input set, equal values or an older input set.
    pub unchanged: usize,
    /// Candidates whose S3 read or write failed (retried by a later request).
    pub failed: usize,
}

#[derive(Debug, Clone, Default)]
struct Entry {
    examined: Option<String>,
    /// (newest input time, values digest) of the newest stored revision.
    newest: Option<(u64, String)>,
}
type MemoryKey = (Source, String, u32);

struct Inner<T> {
    store: SummaryStore<T>,
    memory: Mutex<HashMap<MemoryKey, Entry>>,
    tasks: Arc<Semaphore>,
    dropped: AtomicU64,
}
/// Cheap to clone.
pub struct Recorder<T> {
    inner: Arc<Inner<T>>,
}
impl<T> Clone for Recorder<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}
fn memory_key(s: &Summary) -> MemoryKey {
    (s.key.source(), s.key.sha256(), s.date)
}
impl<T: SummaryTransport> Recorder<T> {
    pub fn new(transport: T) -> Self {
        Self {
            inner: Arc::new(Inner {
                store: SummaryStore::new(transport),
                memory: Mutex::new(HashMap::new()),
                tasks: Arc::new(Semaphore::new(TASKS)),
                dropped: AtomicU64::new(0),
            }),
        }
    }
    pub fn store(&self) -> &SummaryStore<T> {
        &self.inner.store
    }
    /// Record calls dropped because both tasks were busy.
    pub fn dropped(&self) -> u64 {
        self.inner.dropped.load(Ordering::Relaxed)
    }
    fn memory(&self) -> std::sync::MutexGuard<'_, HashMap<MemoryKey, Entry>> {
        self.inner.memory.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// The complete summaries of a served response: grid days of the town, ASOS days of its
    /// station (KST today-6..today-1).
    pub fn candidates(inputs: &GridInputs, rows: &[OrderedJson], now_ms: f64) -> Vec<Summary> {
        let mut out = grid::summaries(inputs, rows, now_ms);
        if let Some(asos) = &inputs.asos {
            out.extend(super::asos::summaries(
                &asos.station,
                &asos.fetched,
                &grid::dates(now_ms),
            ));
        }
        out
    }
    /// Store the candidates that need a new revision.
    pub async fn record_now(
        &self,
        candidates: Vec<Summary>,
        now_ms: f64,
        deadline: Instant,
    ) -> RecordReport {
        let mut report = RecordReport::default();
        for s in candidates {
            let key = memory_key(&s);
            let entry = self.memory().get(&key).cloned().unwrap_or_default();
            if entry.examined.as_deref() == Some(s.inputs.sha256.as_str()) {
                report.unchanged += 1;
                continue;
            }
            let newest = match entry.newest {
                Some(n) => Some(n),
                None => match self.inner.store.newest(&s.key, s.date, deadline).await {
                    Ok(found) => found.map(|f| (f.name.latest, f.summary.values_sha256())),
                    Err(_) => {
                        report.failed += 1;
                        continue;
                    }
                },
            };
            let values = s.values_sha256();
            let keep = newest.as_ref().is_some_and(|(latest, digest)| {
                *digest == values || *latest > s.inputs.latest_fetched_ms
            });
            let newest = if keep {
                report.unchanged += 1;
                newest
            } else {
                match self.inner.store.publish(&s, deadline).await {
                    Ok(()) => {
                        report.written.push(s.object_key());
                        Some((s.inputs.latest_fetched_ms, values))
                    }
                    Err(_) => {
                        report.failed += 1;
                        continue;
                    }
                }
            };
            self.remember(
                key,
                Entry {
                    examined: Some(s.inputs.sha256.clone()),
                    newest,
                },
                now_ms,
            );
        }
        report
    }
    fn remember(&self, key: MemoryKey, entry: Entry, now_ms: f64) {
        let mut memory = self.memory();
        if memory.len() >= MEMORY_ENTRIES && !memory.contains_key(&key) {
            let floor = add_days(kst_date(now_ms), -8).unwrap_or(0);
            memory.retain(|k, _| k.2 >= floor);
            if memory.len() >= MEMORY_ENTRIES {
                memory.clear();
            }
        }
        memory.insert(key, entry);
    }
    /// Wait until no record task runs (tests and shutdown); false at the deadline.
    pub async fn idle(&self, deadline: Instant) -> bool {
        matches!(
            tokio::time::timeout_at(deadline, self.inner.tasks.acquire_many(TASKS as u32)).await,
            Ok(Ok(_))
        )
    }
}
impl<T: SummaryTransport> SummarySink for Recorder<T> {
    fn record(&self, inputs: GridInputs, rows: Vec<OrderedJson>, now_ms: f64) {
        let candidates: Vec<Summary> = {
            let memory = self.memory();
            Self::candidates(&inputs, &rows, now_ms)
                .into_iter()
                .filter(|s| {
                    memory
                        .get(&memory_key(s))
                        .and_then(|e| e.examined.as_deref())
                        != Some(s.inputs.sha256.as_str())
                })
                .collect()
        };
        if candidates.is_empty() {
            return;
        }
        let Ok(permit) = self.inner.tasks.clone().try_acquire_owned() else {
            self.inner.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let this = self.clone();
        tokio::spawn(async move {
            let _permit = permit;
            this.record_now(candidates, now_ms, Instant::now() + TASK_TIME)
                .await;
        });
    }
}
