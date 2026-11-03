//! Volatile response readiness is separate from canonical S3 eligibility.
//!
//! One supervisor owns the charged provider task and its raw batch before notifying
//! readers. HTTP body completion/drop releases persistence; a fixed cap and shutdown
//! also release it. The hook observes the server body, not remote client receipt.
use super::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, Error, GroupDeclaration, RawRecord,
    sha256,
};
use crate::gateway::BoxFuture;
use axum::body::{Body, Bytes};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering::SeqCst},
    },
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    sync::{Notify, OwnedSemaphorePermit, Semaphore, watch},
    task::JoinSet,
    time::Instant,
};

#[derive(Clone, Debug)]
pub struct Config {
    pub retained_bytes: usize,
    pub group_bytes: usize,
    pub entries: usize,
    pub writers: usize,
    pub attempts: usize,
    pub retry: Duration,
    pub dormancy: Duration,
    pub publish_timeout: Duration,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            retained_bytes: 768 * 1024 * 1024,
            group_bytes: 88 * 1024 * 1024,
            entries: 4096,
            writers: 3,
            attempts: 5,
            retry: Duration::from_millis(250),
            dormancy: Duration::from_secs(10),
            publish_timeout: Duration::from_secs(9),
        }
    }
}
impl Config {
    fn validate(&self) -> Result<(), Error> {
        if self.group_bytes == 0
            || self.retained_bytes < self.group_bytes
            || self.retained_bytes > 1024 * 1024 * 1024
            || self.entries == 0
            || self.entries > 8192
            || self.writers == 0
            || self.writers > 16
            || self.attempts == 0
            || self.attempts > 10
            || self.retry > Duration::from_secs(5)
            || self.dormancy.is_zero()
            || self.dormancy > Duration::from_secs(10)
            || self.publish_timeout.is_zero()
            || self.publish_timeout > Duration::from_secs(9)
        {
            return Err(Error::Invalid("response-first bounds"));
        }
        Ok(())
    }
}

pub struct Batch {
    pub declaration: GroupDeclaration,
    pub records: Vec<RawRecord>,
}
/// Only this publisher can confer durable eligibility. RAM records carry no S06 token.
pub trait Publisher: Send + Sync + 'static {
    fn publish(&self, batch: Arc<Batch>, deadline: Instant) -> BoxFuture<'_, Result<(), Error>>;
}
impl<T: CatalogTransport + 'static> Publisher for CatalogStore<T> {
    fn publish(&self, batch: Arc<Batch>, deadline: Instant) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            CatalogStore::publish(
                self,
                batch.declaration.clone(),
                batch.records.clone(),
                deadline,
            )
            .await
            .map(|_| ())
        })
    }
}

#[derive(Default)]
struct Release {
    released: AtomicBool,
    changed: Notify,
    event: Mutex<Option<(Instant, ReleaseReason)>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseReason {
    BodyTerminal,
    DormancyCap,
    Shutdown,
    NoWaiters,
    Background,
}
impl Release {
    fn release(&self, reason: ReleaseReason) {
        let mut event = self.event.lock().unwrap_or_else(|e| e.into_inner());
        if self.released.swap(true, SeqCst) {
            return;
        }
        *event = Some((Instant::now(), reason));
        self.changed.notify_waiters();
    }
    async fn wait(&self) {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.released.load(SeqCst) {
                return;
            }
            notified.await;
        }
    }
}
#[derive(Default)]
struct ScopeState {
    terminal: AtomicBool,
    gates: Mutex<Vec<Arc<Release>>>,
    started: OnceLock<Instant>,
    terminal_at: Mutex<Option<Instant>>,
    groups: Mutex<Vec<Arc<Receipt>>>,
    durable: Mutex<Vec<Arc<Receipt>>>,
}
/// A request owns one scope through construction and the entire emitted body.
#[derive(Clone, Default)]
pub struct ResponseScope(Arc<ScopeState>);
tokio::task_local! { static RESPONSE: ResponseScope; }
impl ResponseScope {
    pub fn current() -> Option<Self> {
        RESPONSE.try_with(Clone::clone).ok()
    }
    pub async fn run<F: Future>(&self, future: F) -> F::Output {
        self.0.started.get_or_init(Instant::now);
        RESPONSE.scope(self.clone(), future).await
    }
    fn attach(&self, gate: Arc<Release>) {
        let mut gates = self.0.gates.lock().unwrap_or_else(|e| e.into_inner());
        if self.0.terminal.load(SeqCst) {
            gate.release(ReleaseReason::BodyTerminal);
        } else if !gates.iter().any(|g| Arc::ptr_eq(g, &gate)) {
            gates.push(gate);
        }
    }
    pub fn terminal(&self) {
        self.0.terminal.store(true, SeqCst);
        self.0
            .terminal_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(Instant::now);
        for gate in self
            .0
            .gates
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            gate.release(ReleaseReason::BodyTerminal);
        }
    }
    pub fn body(&self, body: Body) -> Body {
        Body::new(TerminalBody {
            body,
            scope: self.clone(),
        })
    }
    pub fn started_at(&self) -> Option<Instant> {
        self.0.started.get().copied()
    }
    pub fn terminal_at(&self) -> Option<Instant> {
        *self.0.terminal_at.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn batches(&self) -> Vec<BatchTiming> {
        self.0
            .groups
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|r| r.timing())
            .collect()
    }
    pub async fn after_response(&self) {
        let gate = Arc::new(Release::default());
        self.attach(gate.clone());
        tokio::select! {_=gate.wait()=>(),_=tokio::time::sleep(Duration::from_secs(10))=>()}
    }
    /// Freeze only the pending originals this snapshot used. Neither older
    /// unrelated failures nor later acquisitions can postpone its admission.
    pub fn require_durable(&self, writer: &Writer, raw_ids: &[String]) {
        let wanted: HashSet<_> = raw_ids.iter().map(String::as_str).collect();
        let pending = writer.pending_receipts();
        let mut receipts = self.0.durable.lock().unwrap_or_else(|e| e.into_inner());
        for receipt in pending {
            if receipt.affects(&wanted) && !receipts.iter().any(|r| Arc::ptr_eq(r, &receipt)) {
                receipts.push(receipt);
            }
        }
    }
    pub async fn wait_durable(&self, deadline: Instant) -> bool {
        let receipts = self
            .0
            .durable
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        for receipt in receipts {
            loop {
                let changed = receipt.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if receipt
                    .durable
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_some()
                {
                    break;
                }
                if receipt.abandoned.load(SeqCst) || receipt.rejected.load(SeqCst) {
                    return false;
                }
                if tokio::time::timeout_at(deadline, changed).await.is_err() {
                    return false;
                }
            }
        }
        true
    }
}
/// Propagate the response scope across the same owned-task boundaries as tracing.
pub fn inherit<F: Future>(future: F) -> impl Future<Output = F::Output> {
    let scope = ResponseScope::current();
    async move {
        match scope {
            Some(scope) => scope.run(future).await,
            None => future.await,
        }
    }
}
struct TerminalBody {
    body: Body,
    scope: ResponseScope,
}
impl hyper::body::Body for TerminalBody {
    type Data = Bytes;
    type Error = axum::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<hyper::body::Frame<Bytes>, Self::Error>>> {
        let result = Pin::new(&mut self.body).poll_frame(cx);
        if matches!(result, Poll::Ready(None) | Poll::Ready(Some(Err(_))))
            || self.body.is_end_stream()
        {
            self.scope.terminal();
        }
        result
    }
    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }
    fn size_hint(&self) -> hyper::body::SizeHint {
        self.body.size_hint()
    }
}
impl Drop for TerminalBody {
    fn drop(&mut self) {
        self.scope.terminal();
    }
}
/// Releases dormant batches if request construction is cancelled before it owns a body.
pub struct ResponseGuard(Option<ResponseScope>);
impl ResponseGuard {
    pub fn new(scope: ResponseScope) -> Self {
        Self(Some(scope))
    }
    pub fn disarm(mut self) {
        self.0.take();
    }
}
impl Drop for ResponseGuard {
    fn drop(&mut self) {
        if let Some(scope) = &self.0 {
            scope.terminal();
        }
    }
}

struct Lease(Mutex<Option<OwnedSemaphorePermit>>);
impl Lease {
    fn shrink(&self, bytes: usize) {
        let mut permit = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(p) = permit.as_mut() {
            let extra = p.num_permits().saturating_sub(bytes);
            drop(p.split(extra));
        }
    }
}
/// Validated complete raw in RAM. This is deliberately not a CompleteSet or token.
pub struct RamReady {
    pub records: Vec<RawRecord>,
    pub catalogs: Vec<CatalogId>,
    gate: Arc<Release>,
    durable: AtomicBool,
    abandoned: AtomicBool,
    used: AtomicBool,
    loss_counted: AtomicBool,
    counters: Arc<Counters>,
    _lease: Arc<Lease>,
    receipt: Arc<Receipt>,
}
struct Receipt {
    group: String,
    raw_ids: Vec<String>,
    ram_ready: Instant,
    gate: Arc<Release>,
    durable: Mutex<Option<Instant>>,
    abandoned: AtomicBool,
    rejected: AtomicBool,
    changed: Notify,
}
impl Receipt {
    fn affects(&self, raw_ids: &HashSet<&str>) -> bool {
        self.raw_ids.iter().any(|id| raw_ids.contains(id.as_str()))
    }
    fn timing(&self) -> BatchTiming {
        BatchTiming {
            group: self.group.clone(),
            ram_ready: self.ram_ready,
            released: *self.gate.event.lock().unwrap_or_else(|e| e.into_inner()),
            durable: *self.durable.lock().unwrap_or_else(|e| e.into_inner()),
        }
    }
}
#[derive(Debug, Clone)]
pub struct BatchTiming {
    pub group: String,
    pub ram_ready: Instant,
    pub released: Option<(Instant, ReleaseReason)>,
    pub durable: Option<Instant>,
}
impl RamReady {
    pub fn is_durable(&self) -> bool {
        self.durable.load(SeqCst)
    }
    fn consumed(self: &Arc<Self>, scope: &ResponseScope) {
        self.used.store(true, SeqCst);
        // Attaching a later overlay reader can only release; it never prolongs dormancy.
        scope.attach(self.gate.clone());
        let mut groups = scope.0.groups.lock().unwrap_or_else(|e| e.into_inner());
        if !groups.iter().any(|r| Arc::ptr_eq(r, &self.receipt)) {
            groups.push(self.receipt.clone());
        }
        self.count_loss();
    }
    pub fn timing(&self) -> BatchTiming {
        self.receipt.timing()
    }
    fn count_loss(&self) {
        if self.used.load(SeqCst)
            && self.abandoned.load(SeqCst)
            && !self.loss_counted.swap(true, SeqCst)
        {
            self.counters.served_raw_abandoned.fetch_add(1, SeqCst);
        }
    }
}
#[derive(Clone)]
enum Stage {
    Fetching,
    Ready(Arc<RamReady>),
    Durable(Arc<RamReady>),
    Abandoned(Arc<RamReady>),
    Empty,
    Failed(Error),
}
struct Entry {
    state: watch::Sender<Stage>,
    gate: Arc<Release>,
    retired: AtomicU64,
}
#[derive(Default)]
struct Table {
    entries: HashMap<String, Arc<Entry>>,
    generation: u64,
    pins: BTreeMap<u64, usize>,
}
#[derive(Default)]
struct Counters {
    providers: AtomicU64,
    ready: AtomicU64,
    durable: AtomicU64,
    abandoned: AtomicU64,
    served_raw_abandoned: AtomicU64,
    publish_attempts: AtomicU64,
    permanent_failures: AtomicU64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub providers: u64,
    pub ready: u64,
    pub durable: u64,
    pub abandoned: u64,
    pub served_raw_abandoned: u64,
    pub publish_attempts: u64,
    pub permanent_failures: u64,
    pub retained_bytes: usize,
    pub entries: usize,
}

static WRITERS: OnceLock<Mutex<Vec<Weak<Writer>>>> = OnceLock::new();

pub struct Writer {
    publisher: Arc<dyn Publisher>,
    config: Config,
    bytes: Arc<Semaphore>,
    io: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
    table: Mutex<Table>,
    jobs: Mutex<JoinSet<()>>,
    closing: AtomicBool,
    stopping: Notify,
    counters: Arc<Counters>,
}
/// Pins entries across discovery -> overlay lookup. Retirement cannot create a zero-copy gap.
pub struct ReadPin {
    writer: Weak<Writer>,
    generation: u64,
}
impl Drop for ReadPin {
    fn drop(&mut self) {
        if let Some(writer) = self.writer.upgrade() {
            let mut table = writer.table.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(n) = table.pins.get_mut(&self.generation) {
                *n -= 1;
                if *n == 0 {
                    table.pins.remove(&self.generation);
                }
            }
            Writer::prune(&mut table);
        }
    }
}
impl Writer {
    pub fn new(publisher: Arc<dyn Publisher>, config: Config) -> Result<Arc<Self>, Error> {
        config.validate()?;
        let writer = Arc::new(Self {
            publisher,
            bytes: Arc::new(Semaphore::new(config.retained_bytes)),
            io: Arc::new(Semaphore::new(config.writers)),
            cpu: Arc::new(Semaphore::new(2)),
            config,
            table: Mutex::new(Table::default()),
            jobs: Mutex::new(JoinSet::new()),
            closing: AtomicBool::new(false),
            stopping: Notify::new(),
            counters: Arc::new(Counters::default()),
        });
        WRITERS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Arc::downgrade(&writer));
        Ok(writer)
    }
    pub fn pin(self: &Arc<Self>) -> ReadPin {
        let mut table = self.table.lock().unwrap_or_else(|e| e.into_inner());
        table.generation += 1;
        let generation = table.generation;
        table.pins.insert(generation, 1);
        ReadPin {
            writer: Arc::downgrade(self),
            generation,
        }
    }
    fn prune(table: &mut Table) {
        let oldest = table.pins.keys().next().copied().unwrap_or(u64::MAX);
        table.entries.retain(|_, e| {
            // A supervisor failure parks served raw under its charge. Only process
            // shutdown may abandon this state; it must not become a blind refetch.
            if matches!(*e.state.borrow(), Stage::Abandoned(_)) {
                return true;
            }
            let retired = e.retired.load(SeqCst);
            retired == 0 || retired >= oldest
        });
    }
    pub fn stats(&self) -> Stats {
        let c = &self.counters;
        Stats {
            providers: c.providers.load(SeqCst),
            ready: c.ready.load(SeqCst),
            durable: c.durable.load(SeqCst),
            abandoned: c.abandoned.load(SeqCst),
            served_raw_abandoned: c.served_raw_abandoned.load(SeqCst),
            publish_attempts: c.publish_attempts.load(SeqCst),
            permanent_failures: c.permanent_failures.load(SeqCst),
            retained_bytes: self.config.retained_bytes - self.bytes.available_permits(),
            entries: self
                .table
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entries
                .len(),
        }
    }
    /// Conservative durable-only gate for summary admission. A new group started
    /// afterwards cannot make an already durable snapshot input volatile again.
    pub fn settled(&self) -> bool {
        self.table
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .values()
            .all(|entry| {
                matches!(
                    *entry.state.borrow(),
                    Stage::Durable(_) | Stage::Empty | Stage::Failed(_)
                )
            })
    }
    /// Canonical inputs have no pending entry. RAM copies carry their full RawIds,
    /// including copies retained in station/grid state after their flight expires.
    pub fn inputs_durable(&self, raw_ids: &[String]) -> bool {
        let wanted: HashSet<_> = raw_ids.iter().map(String::as_str).collect();
        self.pending_receipts()
            .iter()
            .all(|receipt| !receipt.affects(&wanted))
    }
    // Intersections can span thousands of originals during an outage. Copy only
    // bounded receipt handles under the shared lock; compare identities outside it.
    fn pending_receipts(&self) -> Vec<Arc<Receipt>> {
        self.table
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .values()
            .filter_map(|entry| match &*entry.state.borrow() {
                Stage::Ready(ready) | Stage::Abandoned(ready) => Some(ready.receipt.clone()),
                _ => None,
            })
            .collect()
    }
    pub fn cached(&self, key: &str) -> Option<Arc<RamReady>> {
        let scope = ResponseScope::current()?;
        let entry = self
            .table
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .get(key)
            .cloned()?;
        let state = entry.state.borrow().clone();
        match state {
            Stage::Ready(r) | Stage::Durable(r) | Stage::Abandoned(r) => {
                r.consumed(&scope);
                Some(r)
            }
            _ => None,
        }
    }
    /// Reserve a worst-case retained acquisition BEFORE polling the provider future.
    /// Concurrent callers of a natural key join this one provider/publication owner.
    pub async fn acquire<F>(
        self: &Arc<Self>,
        key: String,
        reserve: usize,
        provider_until: Instant,
        provider: F,
    ) -> Result<Option<Arc<RamReady>>, Error>
    where
        F: Future<Output = Result<Option<Batch>, Error>> + Send + 'static,
    {
        let scope = ResponseScope::current();
        let entry = {
            let mut table = self.table.lock().unwrap_or_else(|e| e.into_inner());
            Self::prune(&mut table);
            if let Some(entry) = table.entries.get(&key) {
                entry.clone()
            } else {
                if self.closing.load(SeqCst)
                    || reserve == 0
                    || reserve > self.config.group_bytes
                    || table.entries.len() >= self.config.entries
                    || key.len() > 512
                {
                    return Err(Error::Capacity);
                }
                let (state, _) = watch::channel(Stage::Fetching);
                let entry = Arc::new(Entry {
                    state,
                    gate: Arc::new(Release::default()),
                    retired: AtomicU64::new(0),
                });
                if scope.is_none() {
                    entry.gate.release(ReleaseReason::Background);
                }
                table.entries.insert(key, entry.clone());
                let this = self.clone();
                let owned = entry.clone();
                let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
                while jobs.try_join_next().is_some() {}
                jobs.spawn(crate::observability::inherit(async move {
                    let mut admission = Completion {
                        writer: this.clone(),
                        entry: owned.clone(),
                        finished: false,
                    };
                    let permit = {
                        let stopping = this.stopping.notified();
                        tokio::pin!(stopping);
                        stopping.as_mut().enable();
                        if this.closing.load(SeqCst) {
                            admission.finish(Stage::Failed(Error::Capacity));
                            return;
                        }
                        let permits = this.bytes.clone().acquire_many_owned(reserve as u32);
                        tokio::select! {
                            result = tokio::time::timeout_at(provider_until, permits) => result,
                            _ = stopping => {
                                admission.finish(Stage::Failed(Error::Capacity));
                                return;
                            }
                        }
                    };
                    let Ok(Ok(permit)) = permit else {
                        admission.finish(Stage::Failed(Error::Capacity));
                        return;
                    };
                    let lease = Arc::new(Lease(Mutex::new(Some(permit))));
                    if this.closing.load(SeqCst) {
                        admission.finish(Stage::Failed(Error::Capacity));
                        return;
                    }
                    admission.finished = true;
                    this.run(owned, lease, reserve, provider_until, provider)
                        .await;
                }));
                entry
            }
        };
        let mut receiver = entry.state.subscribe();
        loop {
            let state = receiver.borrow_and_update().clone();
            match state {
                Stage::Ready(ready) | Stage::Abandoned(ready) if scope.is_some() => {
                    ready.consumed(scope.as_ref().unwrap());
                    return Ok(Some(ready));
                }
                Stage::Durable(ready) => {
                    if let Some(scope) = &scope {
                        ready.consumed(scope);
                    }
                    return Ok(Some(ready));
                }
                Stage::Abandoned(_) => return Err(Error::Transport),
                Stage::Empty => return Ok(None),
                Stage::Failed(e) => return Err(e),
                _ => (),
            }
            receiver.changed().await.map_err(|_| Error::Transport)?;
        }
    }
    async fn run<F>(
        self: Arc<Self>,
        entry: Arc<Entry>,
        lease: Arc<Lease>,
        reserve: usize,
        until: Instant,
        provider: F,
    ) where
        F: Future<Output = Result<Option<Batch>, Error>> + Send + 'static,
    {
        let mut completion = Completion {
            writer: self.clone(),
            entry: entry.clone(),
            finished: false,
        };
        self.counters.providers.fetch_add(1, SeqCst);
        let result = tokio::time::timeout_at(until, provider)
            .await
            .unwrap_or(Err(Error::Timeout));
        let batch = match result {
            Ok(Some(batch)) => batch,
            Ok(None) => {
                completion.finish(Stage::Empty);
                return;
            }
            Err(e) => {
                completion.finish(Stage::Failed(e));
                return;
            }
        };
        let _cpu = match self.cpu.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                completion.finish(Stage::Failed(Error::Capacity));
                return;
            }
        };
        let charged = lease.clone();
        let checked = tokio::task::spawn_blocking(move || {
            let _charged = charged;
            validate(batch, reserve)
        })
        .await;
        drop(_cpu);
        let (batch, records, retained) = match checked {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                completion.finish(Stage::Failed(e));
                return;
            }
            Err(_) => {
                completion.finish(Stage::Failed(Error::Transport));
                return;
            }
        };
        lease.shrink(retained);
        let raw_ids = records
            .iter()
            .map(|r| r.envelope.identity.object_key())
            .collect::<Result<Vec<_>, _>>()
            .expect("pure validation checked every raw identity before RamReady");
        let group = records
            .first()
            .and_then(|r| r.envelope.fetch_group.as_ref())
            .map(|g| g.group_sha256.clone())
            .unwrap_or_default();
        let ready = Arc::new(RamReady {
            receipt: Arc::new(Receipt {
                ram_ready: Instant::now(),
                durable: Mutex::new(None),
                group,
                raw_ids,
                gate: entry.gate.clone(),
                abandoned: AtomicBool::new(false),
                rejected: AtomicBool::new(false),
                changed: Notify::new(),
            }),
            records,
            catalogs: batch.declaration.partitions.clone(),
            gate: entry.gate.clone(),
            durable: AtomicBool::new(false),
            abandoned: AtomicBool::new(false),
            used: AtomicBool::new(false),
            loss_counted: AtomicBool::new(false),
            counters: self.counters.clone(),
            _lease: lease,
        });
        self.counters.ready.fetch_add(1, SeqCst);
        // The supervisor owns the charged batch before a waiter can observe Ready.
        entry.state.send_replace(Stage::Ready(ready.clone()));
        if entry.state.receiver_count() == 0 {
            entry.gate.release(ReleaseReason::NoWaiters);
        }
        tokio::select! {
            _=entry.gate.wait()=>(),
            _=tokio::time::sleep(self.config.dormancy)=>entry.gate.release(ReleaseReason::DormancyCap),
        }
        let mut success = false;
        let mut attempt = 0u32;
        let mut shutdown_failures = 0usize;
        loop {
            let stopping = self.stopping.notified();
            tokio::pin!(stopping);
            stopping.as_mut().enable();
            let _io = match self.io.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break,
            };
            self.counters.publish_attempts.fetch_add(1, SeqCst);
            let deadline = Instant::now() + self.config.publish_timeout;
            let result =
                tokio::time::timeout_at(deadline, self.publisher.publish(batch.clone(), deadline))
                    .await
                    .unwrap_or(Err(Error::Timeout));
            if result.is_ok() {
                success = true;
                break;
            }
            drop(_io);
            // Corrupt can arise from a stored/control read and may recover; only
            // deterministic invalid input is parked without normal retry.
            let permanent = matches!(result, Err(Error::Invalid(_)));
            if permanent {
                ready.receipt.rejected.store(true, SeqCst);
                ready.receipt.changed.notify_waiters();
                self.counters.permanent_failures.fetch_add(1, SeqCst);
            }
            if self.closing.load(SeqCst) {
                shutdown_failures += 1;
                if shutdown_failures >= self.config.attempts {
                    break;
                }
            }
            let delay = self
                .config
                .retry
                .saturating_mul(1u32 << attempt.min(8))
                .min(Duration::from_secs(30));
            attempt = attempt.saturating_add(1);
            // A storage outage parks the original under its byte charge. Retry slowly
            // until shutdown; never silently discard it or acquire another vintage.
            if !self.closing.load(SeqCst) {
                if permanent {
                    stopping.await;
                } else {
                    tokio::select! {_=tokio::time::sleep(delay)=>(),_=stopping=>()}
                }
            }
        }

        if success {
            *ready
                .receipt
                .durable
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            ready.durable.store(true, SeqCst);
            ready.receipt.changed.notify_waiters();
            self.counters.durable.fetch_add(1, SeqCst);
            completion.finish(Stage::Durable(ready));
        } else {
            ready.abandoned.store(true, SeqCst);
            ready.receipt.abandoned.store(true, SeqCst);
            ready.receipt.changed.notify_waiters();
            ready.count_loss();
            self.counters.abandoned.fetch_add(1, SeqCst);
            completion.finish(Stage::Abandoned(ready));
        }
    }
    pub fn quiesce(&self) {
        self.closing.store(true, SeqCst);
        self.stopping.notify_waiters();
        for e in self
            .table
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .values()
        {
            e.gate.release(ReleaseReason::Shutdown);
        }
    }
    pub async fn drain(&self, deadline: Instant) -> bool {
        self.quiesce();
        let mut jobs = std::mem::replace(
            &mut *self.jobs.lock().unwrap_or_else(|e| e.into_inner()),
            JoinSet::new(),
        );
        let mut clean = true;
        while !jobs.is_empty() {
            match tokio::time::timeout_at(deadline, jobs.join_next()).await {
                Ok(Some(Ok(()))) => (),
                Ok(Some(Err(_))) => clean = false,
                Ok(None) => break,
                Err(_) => {
                    clean = false;
                    jobs.abort_all();
                    while jobs.join_next().await.is_some() {}
                    break;
                }
            }
        }
        clean && self.counters.abandoned.load(SeqCst) == 0
    }
}
struct Completion {
    writer: Arc<Writer>,
    entry: Arc<Entry>,
    finished: bool,
}
impl Completion {
    fn finish(&mut self, stage: Stage) {
        self.entry.state.send_replace(stage);
        let table = self.writer.table.lock().unwrap_or_else(|e| e.into_inner());
        self.entry.retired.store(table.generation.max(1), SeqCst);
        self.finished = true;
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let previous = self.entry.state.borrow().clone();
        match previous {
            Stage::Ready(r) => {
                r.abandoned.store(true, SeqCst);
                r.receipt.abandoned.store(true, SeqCst);
                r.receipt.changed.notify_waiters();
                r.count_loss();
                self.writer.counters.abandoned.fetch_add(1, SeqCst);
                self.finish(Stage::Abandoned(r));
            }
            _ => self.finish(Stage::Failed(Error::Transport)),
        }
    }
}
fn validate(batch: Batch, reserve: usize) -> Result<(Arc<Batch>, Vec<RawRecord>, usize), Error> {
    let limits = CatalogLimits::default();
    let body = batch.declaration.bytes(&limits)?;
    let mut retained = body.len();
    for r in &batch.records {
        if r.bytes.len() != r.envelope.raw_length
            || sha256(&r.bytes) != r.envelope.identity.raw_sha256
        {
            return Err(Error::Invalid("RAM raw identity"));
        }
        retained = retained
            .checked_add(r.bytes.len())
            .and_then(|v| v.checked_add(1024))
            .ok_or(Error::Capacity)?;
    }
    if retained > reserve || retained > limits.output_bytes + limits.control_bytes {
        return Err(Error::Capacity);
    }
    let worst = batch
        .declaration
        .partitions
        .len()
        .checked_mul(limits.control_bytes)
        .and_then(|n| n.checked_add(body.len()))
        .ok_or(Error::Capacity)?;
    if worst > limits.retained_control_bytes {
        return Err(Error::Capacity);
    }
    let records = batch.declaration.attach(batch.records.clone(), &limits)?;
    Ok((Arc::new(batch), records, retained))
}

/// Private metrics only; keys, coordinates, provider URLs and weather bodies are omitted.
pub fn render_metrics() -> String {
    let mut writers = WRITERS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut totals = [0u64; 9];
    writers.retain(|weak| {
        let Some(writer) = weak.upgrade() else {
            return false;
        };
        let s = writer.stats();
        for (total, n) in totals.iter_mut().zip([
            s.providers,
            s.ready,
            s.durable,
            s.abandoned,
            s.served_raw_abandoned,
            s.publish_attempts,
            s.permanent_failures,
            s.retained_bytes as u64,
            s.entries as u64,
        ]) {
            *total += n;
        }
        true
    });
    [
        "provider_groups_total",
        "ram_ready_groups_total",
        "durable_groups_total",
        "abandoned_groups_total",
        "served_raw_abandoned_total",
        "publish_attempts_total",
        "permanent_failures_total",
        "retained_bytes",
        "entries",
    ]
    .into_iter()
    .zip(totals)
    .map(|(name, n)| format!("server2_raw_writer_{name} {n}\n"))
    .collect()
}
