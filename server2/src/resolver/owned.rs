//! Shared owned acquisitions with a bounded request waiter (S13d, AK 2026-10-14).
//!
//! One owned task runs per key: a grid publication, or a national dataset and publication time
//! (AirKorea, KMA scraper pages and ASOS answer the whole country at once, so every cell's
//! request waits on the same key). The task keeps the provider's legacy timeout and survives
//! every waiter. A waiter uses the outcome only when it is ready by its own bound (at most
//! [`WAITER_BOUND`]); otherwise it gets [`Waited::Pending`] and the caller leaves that section
//! out, as legacy assembly does for data that is not stored yet. A finished outcome answers
//! later joiners for `retain`, so a request that checked the store just before the owner
//! published never starts a duplicate acquisition.
use super::Error;
use crate::storage::Error as StorageError;
use std::{
    collections::HashMap,
    future::Future,
    hash::Hash,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Semaphore, watch},
    time::{Instant, timeout_at},
};

/// The longest a request waits for an owned acquisition (AK: 3 s, or the remaining gateway
/// attempt when that is shorter).
pub const WAITER_BOUND: Duration = Duration::from_secs(3);
/// The longest owned acquisition this primitive admits: eight life-index pages with two
/// 30-second legacy attempts each, plus publication, fit inside it.
pub const MAX_OWNED: Duration = Duration::from_secs(600);
/// An owned waiter ([`OwnedFlights::wait`]) waits this long past the task's own deadline, so it
/// observes the task's outcome instead of racing its timeout.
const OUTCOME_MARGIN: Duration = Duration::from_millis(100);

#[derive(Clone, Debug)]
pub struct OwnedConfig {
    /// Owned tasks running at once; a new key beyond this is [`Waited::Busy`].
    pub running: usize,
    /// Keys held at once, running or retained.
    pub entries: usize,
    /// How long a finished outcome answers later joiners.
    pub retain: Duration,
}
impl Default for OwnedConfig {
    fn default() -> Self {
        Self {
            running: 16,
            entries: 1024,
            retain: Duration::from_secs(3),
        }
    }
}
/// What a waiter sees at its bound.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Waited<T> {
    /// The owned task finished by the waiter's bound (now or within `retain`).
    Ready(T),
    /// Still running; the owned task ends by `owner_deadline`. Omit the section.
    Pending { owner_deadline: Instant },
    /// The owned task reached its own deadline without an outcome.
    Expired,
    /// The owned task ended without an outcome (it panicked); the key is free again.
    Failed,
    /// No capacity to start an owned task for a new key; nothing was started.
    Busy,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OwnedMetrics {
    pub started: u64,
    pub joined: u64,
    pub ready: u64,
    pub pending: u64,
    pub expired: u64,
    pub failed: u64,
    pub busy: u64,
}
#[derive(Default)]
struct Counters {
    started: AtomicU64,
    joined: AtomicU64,
    ready: AtomicU64,
    pending: AtomicU64,
    expired: AtomicU64,
    failed: AtomicU64,
    busy: AtomicU64,
}
/// `None` while running; `Some(None)` when the owner deadline passed.
type Outcome<T> = Option<Option<T>>;
struct Entry<T> {
    receiver: watch::Receiver<Outcome<T>>,
    owner_deadline: Instant,
    finished: Arc<Mutex<Option<Instant>>>,
    trace: crate::observability::Context,
}
struct Inner<K, T> {
    config: OwnedConfig,
    running: Arc<Semaphore>,
    entries: Mutex<HashMap<K, Entry<T>>>,
    counters: Counters,
}
/// Keyed single-flight of owned acquisitions. Cheap to clone.
pub struct OwnedFlights<K, T> {
    inner: Arc<Inner<K, T>>,
}
impl<K, T> Clone for OwnedFlights<K, T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}
impl<K, T> OwnedFlights<K, T>
where
    K: Eq + Hash + Clone + Send + Sync + 'static,
    T: Clone + Send + Sync + 'static,
{
    pub fn new(config: OwnedConfig) -> Result<Self, Error> {
        if !(1..=256).contains(&config.running)
            || !(config.running..=65536).contains(&config.entries)
            || config.retain > Duration::from_secs(60)
        {
            return Err(StorageError::Invalid("owned acquisition bounds").into());
        }
        Ok(Self {
            inner: Arc::new(Inner {
                running: Arc::new(Semaphore::new(config.running)),
                config,
                entries: Mutex::new(HashMap::new()),
                counters: Counters::default(),
            }),
        })
    }
    pub fn metrics(&self) -> OwnedMetrics {
        let c = &self.inner.counters;
        OwnedMetrics {
            started: c.started.load(Ordering::Relaxed),
            joined: c.joined.load(Ordering::Relaxed),
            ready: c.ready.load(Ordering::Relaxed),
            pending: c.pending.load(Ordering::Relaxed),
            expired: c.expired.load(Ordering::Relaxed),
            failed: c.failed.load(Ordering::Relaxed),
            busy: c.busy.load(Ordering::Relaxed),
        }
    }
    /// Owned tasks still running.
    pub fn running(&self) -> usize {
        self.inner.config.running - self.inner.running.available_permits()
    }
    /// Join the owned task for `key`, starting it with `start(owner_deadline)` when none is
    /// running or retained. The task gets `owned_for` (at most [`MAX_OWNED`]) and is never
    /// cancelled by a waiter. The waiter returns by `ready_by` or [`WAITER_BOUND`] from now,
    /// whichever is earlier.
    pub async fn join<F, Fut>(
        &self,
        key: K,
        ready_by: Instant,
        owned_for: Duration,
        start: F,
    ) -> Waited<T>
    where
        F: FnOnce(Instant) -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let ready_by = ready_by.min(Instant::now() + WAITER_BOUND);
        self.run(key, Some(ready_by), owned_for, start).await
    }
    /// [`join`](Self::join) for an owned caller (for example an S07 response owner): it waits
    /// until the task it joined ends, which is at most its owner deadline. Request waiters use
    /// `join`.
    pub async fn wait<F, Fut>(&self, key: K, owned_for: Duration, start: F) -> Waited<T>
    where
        F: FnOnce(Instant) -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        self.run(key, None, owned_for, start).await
    }
    /// Wait until no owned task runs (drain). Returns false at `deadline`.
    pub async fn idle(&self, deadline: Instant) -> bool {
        let all = self.inner.config.running as u32;
        matches!(
            timeout_at(deadline, self.inner.running.clone().acquire_many_owned(all)).await,
            Ok(Ok(_))
        )
    }
    async fn run<F, Fut>(
        &self,
        key: K,
        ready_by: Option<Instant>,
        owned_for: Duration,
        start: F,
    ) -> Waited<T>
    where
        F: FnOnce(Instant) -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let (mut receiver, owner_deadline) = match self.entry(key, owned_for, start) {
            Ok(entry) => entry,
            Err(waited) => return waited,
        };
        let ready_by = ready_by.unwrap_or(owner_deadline + OUTCOME_MARGIN);
        // Inner `None`: the task ended without sending (a panic dropped its sender).
        let outcome = timeout_at(ready_by, async {
            loop {
                if let Some(outcome) = receiver.borrow_and_update().clone() {
                    return Some(outcome);
                }
                if receiver.changed().await.is_err() {
                    return receiver.borrow().clone();
                }
            }
        })
        .await;
        let c = &self.inner.counters;
        match outcome {
            Ok(Some(Some(value))) => {
                c.ready.fetch_add(1, Ordering::Relaxed);
                Waited::Ready(value)
            }
            Ok(Some(None)) => {
                c.expired.fetch_add(1, Ordering::Relaxed);
                Waited::Expired
            }
            Ok(None) => {
                c.failed.fetch_add(1, Ordering::Relaxed);
                Waited::Failed
            }
            Err(_) => {
                c.pending.fetch_add(1, Ordering::Relaxed);
                Waited::Pending { owner_deadline }
            }
        }
    }
    #[allow(clippy::type_complexity)]
    fn entry<F, Fut>(
        &self,
        key: K,
        owned_for: Duration,
        start: F,
    ) -> Result<(watch::Receiver<Outcome<T>>, Instant), Waited<T>>
    where
        F: FnOnce(Instant) -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let now = Instant::now();
        let retain = self.inner.config.retain;
        let mut map = self.inner.entries.lock().unwrap_or_else(|e| e.into_inner());
        // A finished outcome expires after `retain`; a task that ended without sending (a
        // panic closed its channel before `finished` was set) is dropped at once.
        let finished_before = |entry: &Entry<T>, at: Instant| match *entry
            .finished
            .lock()
            .unwrap_or_else(|e| e.into_inner())
        {
            Some(done) => done + retain <= at,
            None => entry.receiver.has_changed().is_err(),
        };
        if let Some(entry) = map.get(&key) {
            if !finished_before(entry, now) {
                self.inner.counters.joined.fetch_add(1, Ordering::Relaxed);
                crate::observability::link(crate::observability::Component::Resolver, entry.trace);
                return Ok((entry.receiver.clone(), entry.owner_deadline));
            }
            map.remove(&key);
        }
        map.retain(|_, entry| !finished_before(entry, now));
        if map.len() >= self.inner.config.entries {
            self.inner.counters.busy.fetch_add(1, Ordering::Relaxed);
            return Err(Waited::Busy);
        }
        let Ok(permit) = self.inner.running.clone().try_acquire_owned() else {
            self.inner.counters.busy.fetch_add(1, Ordering::Relaxed);
            return Err(Waited::Busy);
        };
        let owner_deadline = now + owned_for.min(MAX_OWNED);
        let trace = crate::observability::current().child();
        let (sender, receiver) = watch::channel(None);
        let finished = Arc::new(Mutex::new(None));
        map.insert(
            key,
            Entry {
                trace,
                receiver: receiver.clone(),
                owner_deadline,
                finished: finished.clone(),
            },
        );
        self.inner.counters.started.fetch_add(1, Ordering::Relaxed);
        let work = start(owner_deadline);
        crate::observability::spawn(async move {
            let _permit = permit;
            use crate::observability::{
                Action, Cause, Component, Details, Operation, Outcome, Stage,
            };
            let mut operation = Operation::at(trace, Component::Resolver, Stage::SharedWork);
            let outcome = trace.scope(timeout_at(owner_deadline, work)).await.ok();
            operation.finish(
                if outcome.is_some() {
                    Cause::None
                } else {
                    Cause::Timeout
                },
                if outcome.is_some() {
                    Action::None
                } else {
                    Action::CancelOwner
                },
                if outcome.is_some() {
                    Outcome::Completed
                } else {
                    Outcome::Cancelled
                },
                Details::default(),
            );
            *finished.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            sender.send_replace(Some(outcome));
        });
        Ok((receiver, owner_deadline))
    }
}
