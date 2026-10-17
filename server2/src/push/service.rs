//! The push registration service: one writer task owns the state and its S3 journal (D01: the
//! component that orders concurrent updates inside the single Rust process). Every request is
//! planned against the current state, and a request that changes state is answered only after
//! its journal entry is durable. A request that cannot be made durable in time receives the
//! legacy store-error answer of its route, computed without touching the state.
use super::durable::{Commit, Counters, Durable, DurableConfig};
use super::express::{self, RAW_LIMIT};
use super::routes::{self, Body, FailedBackend, Reply, Route, TxnBackend};
use super::store::{Oid, OidSource, State, Txn};
use crate::budget::Clock;
use crate::storage::CatalogTransport;
use axum::{
    body::Body as HttpBody,
    extract::Request,
    http::{Method, StatusCode},
    response::Response,
};
use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    sync::{Arc, RwLock},
    time::Duration,
};
use tokio::{
    sync::{mpsc, oneshot, watch},
    time::Instant,
};

#[derive(Clone, Debug)]
pub struct PushConfig {
    /// How long a request waits for its answer (below the app's 10 s request timeout).
    pub wait: Duration,
    /// Time a queued request must still have left to be planned and committed.
    pub min_remaining: Duration,
    /// Bounded writer queue; a full queue answers the route's store-error response.
    pub queue: usize,
    /// Interval between restore attempts while the state is not loaded.
    pub restore_retry: Duration,
    pub durable: DurableConfig,
}
impl Default for PushConfig {
    fn default() -> Self {
        Self {
            wait: Duration::from_secs(9),
            min_remaining: Duration::from_secs(4),
            queue: 64,
            restore_retry: Duration::from_secs(5),
            durable: DurableConfig::default(),
        }
    }
}

/// Production ObjectIds: seconds, five random bytes and a three-byte counter (MongoDB layout).
pub struct ObjectIds {
    random: [u8; 5],
    counter: u32,
}
impl ObjectIds {
    pub fn new() -> Self {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(std::process::id().into());
        let r = h.finish().to_be_bytes();
        Self {
            random: [r[0], r[1], r[2], r[3], r[4]],
            counter: u32::from_be_bytes([0, r[5], r[6], r[7]]),
        }
    }
}
impl Default for ObjectIds {
    fn default() -> Self {
        Self::new()
    }
}
impl OidSource for ObjectIds {
    fn next(&mut self, now_ms: f64) -> Oid {
        self.counter = (self.counter + 1) & 0xFF_FFFF;
        let secs = (now_ms / 1000.).floor() as u32;
        let mut oid = [0u8; 12];
        oid[..4].copy_from_slice(&secs.to_be_bytes());
        oid[4..9].copy_from_slice(&self.random);
        oid[9..].copy_from_slice(&self.counter.to_be_bytes()[1..]);
        oid
    }
}

/// A selected alarm not updated for 60 days (`_removeOldList`): its natural-order number, `_id`,
/// the document as read at selection, the cutoff and its `makeRemoveSelector` filter. The
/// records it removes are the filter's matches that are still stale: the selected record only
/// while it equals `selected`, any other match only while its own `updatedAt` is older than
/// `cutoff_ms`. A change made since selection (a user update) keeps the record.
#[derive(Clone, Debug)]
pub struct StaleSelection {
    pub n: u64,
    pub oid: super::store::Oid,
    pub selected: crate::world::js::Obj,
    pub cutoff_ms: i64,
    pub filter: Vec<(String, crate::world::js::Val)>,
}

/// State changes the delivery workers make through the same writer (legacy store calls of the
/// alarm worker).
#[derive(Clone, Debug)]
pub enum InternalOp {
    CheckAlarmSelection {
        n: u64,
        oid: Oid,
        selected: crate::world::js::Obj,
    },
    /// Read-only selection guard. The writer catches up from S3 before evaluating it,
    /// including registration edits committed by another process.
    CheckAlertSelection {
        n: u64,
        oid: Oid,
        selected: crate::world::js::Obj,
    },
    /// Conditional worker: only update the selected registration if it has not changed while
    /// weather was fetched. Durable before provider submission, including send timestamps.
    UpdateAlertState {
        n: u64,
        oid: Oid,
        selected: crate::world::js::Obj,
        precip: crate::world::js::Val,
        air: crate::world::js::Val,
    },
    /// Disable every conditional alert of an unregistered FCM token, without touching alarms.
    DisableAlertsByFcm {
        token: String,
    },
    RemoveDuplicateAlerts,
    /// `removeDuplicateAlarms`: (registrationId, cityIndex, id) groups keep the newer record.
    RemoveDuplicateAlarms,
    /// `disableAlarmsByFcm(token)`: `{enable: false, updatedAt: now, updatedBy: 'push'}`, multi.
    /// The still-stale records of `spare` (the minute's 60-day cleanup of every selected record
    /// with this token) are removed in the same
    /// journal entry instead (disabling them would make them look recently updated).
    DisableAlarmsByFcm {
        token: String,
        spare: Vec<StaleSelection>,
    },
    /// `removeAlarms(makeRemoveSelector(pushInfo))` restricted to the still-stale records.
    RemoveAlarms(StaleSelection),
    /// `updatePushInfo(record)`: the worker's `updatedAt` stamp of a selected record without
    /// one, applied only while that record still has no `updatedAt` (any other change, such as
    /// an unregistered token's disable, sets it and is never overwritten).
    StampAlarm {
        n: u64,
        oid: super::store::Oid,
        info: crate::world::js::Obj,
    },
}

enum Job {
    Http {
        route: Route,
        body: Body,
        language: Option<String>,
        reply: oneshot::Sender<Reply>,
    },
    Internal {
        op: InternalOp,
        reply: oneshot::Sender<bool>,
    },
}

struct Command {
    context: crate::observability::Context,
    job: Job,
    now_ms: f64,
    deadline: Instant,
}

pub struct PushService {
    tx: mpsc::Sender<Command>,
    clock: Arc<dyn Clock>,
    config: PushConfig,
    state: Arc<RwLock<State>>,
    ready: Arc<std::sync::atomic::AtomicBool>,
    pub counters: Arc<Counters>,
    accepting: std::sync::atomic::AtomicBool,
    stop: watch::Sender<bool>,
    writer: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl PushService {
    /// Start the writer (it restores the state from S3 first) on the current runtime.
    pub fn start<T: CatalogTransport + Send + Sync + 'static>(
        transport: Arc<T>,
        clock: Arc<dyn Clock>,
        ids: Box<dyn OidSource>,
        config: PushConfig,
    ) -> Arc<Self> {
        let counters = Arc::new(Counters::default());
        let durable = Durable::new(transport, config.durable.clone(), counters.clone());
        let (tx, rx) = mpsc::channel(config.queue.max(1));
        let state = Arc::new(RwLock::new(State::default()));
        let ready = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let writer = Writer {
            durable,
            state: state.clone(),
            ids,
            ready: ready.clone(),
            config: config.clone(),
        };
        let (stop, stopped) = watch::channel(false);
        let writer = crate::observability::spawn(writer.run(rx, stopped));
        Arc::new(Self {
            tx,
            clock,
            config,
            state,
            ready,
            counters,
            accepting: std::sync::atomic::AtomicBool::new(true),
            stop,
            writer: std::sync::Mutex::new(Some(writer)),
        })
    }

    /// Reject new HTTP mutations; internal result/guard operations remain admitted during drain.
    pub fn quiesce(&self) {
        self.accepting
            .store(false, std::sync::atomic::Ordering::Release);
    }
    /// Close the writer queue after delivery jobs finish; existing queued writes may settle.
    pub async fn drain(&self, deadline: Instant) -> bool {
        self.quiesce();
        self.stop.send_replace(true);
        let task = self.writer.lock().unwrap_or_else(|e| e.into_inner()).take();
        let Some(task) = task else { return true };
        let mut task = AbortWriter(task);
        match tokio::time::timeout_at(deadline, &mut task.0).await {
            Ok(result) => result.is_ok(),
            Err(_) => {
                task.0.abort();
                let _ = tokio::time::timeout_at(deadline, &mut task.0).await;
                false
            }
        }
    }

    /// Shared read access to the acknowledged state (delivery, tests).
    pub fn state(&self) -> Arc<RwLock<State>> {
        self.state.clone()
    }
    pub fn ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Acquire)
    }

    /// Whether a path belongs to the push routes this service answers.
    pub fn matches(path: &str) -> bool {
        express::mount(path).is_some()
    }

    /// Answer a push request; `None` when the path is not a push route.
    pub async fn handle(&self, request: Request) -> Option<Response> {
        let (mount, exact) = express::mount(request.uri().path())?;
        let method = request.method().clone();
        let headers = request.headers().clone();
        if method == Method::OPTIONS {
            return Some(crate::gateway::response::preflight(&headers));
        }
        let original = request.uri().path_and_query().map_or_else(
            || request.uri().path().to_owned(),
            |p| p.as_str().to_owned(),
        );
        let raw = match axum::body::to_bytes(request.into_body(), RAW_LIMIT + 1).await {
            Ok(raw) if raw.len() <= RAW_LIMIT => raw,
            _ => return Some(express::final_handler(413, method == Method::HEAD)),
        };
        let body = match express::parse_body(&headers, &raw) {
            Ok(body) => body,
            Err(express::Rejected(status)) => {
                return Some(express::final_handler(status, method == Method::HEAD));
            }
        };
        if !express::decode_uri_ok(&original) {
            return Some(express::final_handler(500, method == Method::HEAD));
        }
        let Some(route) = express::route(mount, exact, &method) else {
            return Some(express::final_handler(404, method == Method::HEAD));
        };
        let language = express::accept_language(&headers);
        let reply = self.submit(route, body, language).await;
        Some(express::respond(&reply, &method))
    }

    /// Apply one worker state change through the writer; `true` once it is durable (or there
    /// was nothing to change).
    pub async fn internal(&self, op: InternalOp) -> bool {
        let Ok(now_ms) = self.clock.now_ms() else {
            return false;
        };
        let deadline = Instant::now() + self.config.wait;
        let (reply, answer) = oneshot::channel();
        let command = Command {
            context: crate::observability::current().child(),
            job: Job::Internal { op, reply },
            now_ms: now_ms as f64,
            deadline,
        };
        if self.tx.send(command).await.is_err() {
            return false;
        }
        matches!(
            tokio::time::timeout_at(deadline, answer).await,
            Ok(Ok(true))
        )
    }

    /// Run one handler through the writer and wait for its answer.
    pub async fn submit(&self, route: Route, body: Body, language: Option<String>) -> Reply {
        let now_ms = self.clock.now_ms().map_or(f64::NAN, |ms| ms as f64);
        let deadline = Instant::now() + self.config.wait;
        let (reply, answer) = oneshot::channel();
        let failure = |body: &Body, language: &Option<String>| {
            routes::handle(
                route,
                body,
                language.as_deref(),
                &mut FailedBackend { now: now_ms },
            )
        };
        if now_ms.is_nan() {
            return failure(&body, &language);
        }
        let command = Command {
            context: crate::observability::current().child(),
            job: Job::Http {
                route,
                body: body.clone(),
                language: language.clone(),
                reply,
            },
            now_ms,
            deadline,
        };
        if !self.accepting.load(std::sync::atomic::Ordering::Acquire)
            || self.tx.try_send(command).is_err()
        {
            return failure(&body, &language);
        }
        match tokio::time::timeout_at(deadline, answer).await {
            Ok(Ok(reply)) => reply,
            _ => failure(&body, &language),
        }
    }
}

enum Answer {
    Http(Reply),
    Internal(bool),
}
impl Job {
    fn answer(self, answer: Answer) {
        match (self, answer) {
            (Job::Http { reply, .. }, Answer::Http(r)) => {
                let _ = reply.send(r);
            }
            (Job::Internal { reply, .. }, Answer::Internal(ok)) => {
                let _ = reply.send(ok);
            }
            _ => (),
        }
    }
}

struct Writer<T> {
    durable: Durable<T>,
    state: Arc<RwLock<State>>,
    ids: Box<dyn OidSource>,
    ready: Arc<std::sync::atomic::AtomicBool>,
    config: PushConfig,
}

impl<T: CatalogTransport + Send + Sync + 'static> Writer<T> {
    async fn run(mut self, mut rx: mpsc::Receiver<Command>, mut stop: watch::Receiver<bool>) {
        let mut next_restore = Instant::now();
        loop {
            if *stop.borrow() {
                rx.close();
            }
            if rx.is_closed() && rx.is_empty() {
                return;
            }
            if !self.ready.load(std::sync::atomic::Ordering::Acquire)
                && Instant::now() >= next_restore
            {
                match self.durable.restore().await {
                    Ok(state) => {
                        *self.state.write().unwrap_or_else(|e| e.into_inner()) = state;
                        self.ready.store(true, std::sync::atomic::Ordering::Release);
                    }
                    Err(_) => next_restore = Instant::now() + self.config.restore_retry,
                }
            }
            let command = if self.ready.load(std::sync::atomic::Ordering::Acquire) {
                match tokio::select! { biased; _ = stop.changed(), if !*stop.borrow() => { rx.close(); rx.recv().await }, c = rx.recv() => c }
                {
                    Some(c) => c,
                    None => return,
                }
            } else {
                match tokio::time::timeout_at(next_restore, async { tokio::select! { biased; _ = stop.changed(), if !*stop.borrow() => { rx.close(); rx.recv().await }, c = rx.recv() => c } }).await {
                    Ok(Some(c)) => c,
                    Ok(None) => return,
                    Err(_) => continue,
                }
            };
            if !self.ready.load(std::sync::atomic::Ordering::Acquire) {
                // Dropping the reply makes the caller answer the route's store-error response.
                command
                    .context
                    .scope(async {
                        crate::observability::event(
                            crate::observability::Component::PushState,
                            crate::observability::Stage::Queue,
                            crate::observability::Cause::StateUnavailable,
                            crate::observability::Action::RejectBeforeIo,
                            crate::observability::Outcome::Failed,
                            Default::default(),
                        );
                    })
                    .await;
                continue;
            }
            command
                .context
                .scope(crate::observability::work_at(
                    command.context,
                    crate::observability::Component::PushState,
                    crate::observability::Stage::Writer,
                    self.process(command),
                ))
                .await;
        }
    }

    fn apply(&self, entries: &[(u64, Vec<u8>)]) -> bool {
        let mut state = self.state.write().unwrap_or_else(|e| e.into_inner());
        entries
            .iter()
            .all(|(seq, body)| self.durable.apply_entry(&mut state, *seq, body).is_ok())
    }

    async fn process(&mut self, command: Command) {
        if Instant::now() + self.config.min_remaining > command.deadline {
            return;
        }
        if self.durable.unsettled() {
            let seq = self.state.read().unwrap_or_else(|e| e.into_inner()).seq;
            match self.durable.settle(seq).await {
                Ok(entries) => {
                    if !self.apply(&entries) {
                        self.ready
                            .store(false, std::sync::atomic::Ordering::Release);
                        return;
                    }
                }
                Err(_) => return,
            }
        }
        // Another process (the importer, or an overlapping replacement) may have committed:
        // plan on the newest durable state.
        let seq = self.state.read().unwrap_or_else(|e| e.into_inner()).seq;
        match self.durable.next_exists(seq).await {
            Ok(false) => (),
            Ok(true) => match self.durable.fetch_after(seq).await {
                Ok(entries) if self.apply(&entries) => (),
                _ => return,
            },
            Err(_) => return,
        }
        for _ in 0..3 {
            let (reply, changes, next_n, seq) = {
                let state = self.state.read().unwrap_or_else(|e| e.into_inner());
                let mut txn = Txn::new(&state, command.now_ms, &mut *self.ids);
                let reply = match &command.job {
                    Job::Http {
                        route,
                        body,
                        language,
                        ..
                    } => Answer::Http(routes::handle(
                        *route,
                        body,
                        language.as_deref(),
                        &mut TxnBackend { txn: &mut txn },
                    )),
                    Job::Internal { op, .. } => {
                        Answer::Internal(super::deliver::ops::plan(op, &mut txn))
                    }
                };
                (reply, txn.changes(), txn.next_n(), state.seq + 1)
            };
            if changes.is_empty() {
                command.job.answer(reply);
                return;
            }
            match self.durable.commit(seq, &changes, next_n).await {
                Commit::Committed => {
                    {
                        let mut state = self.state.write().unwrap_or_else(|e| e.into_inner());
                        state.apply(&changes);
                        state.next_n = state.next_n.max(next_n);
                        state.seq = seq;
                    }
                    command.job.answer(reply);
                    self.maybe_snapshot().await;
                    return;
                }
                Commit::Conflict => {
                    let after = seq - 1;
                    match self.durable.fetch_after(after).await {
                        Ok(entries) if self.apply(&entries) => continue,
                        _ => {
                            self.ready
                                .store(false, std::sync::atomic::Ordering::Release);
                            return;
                        }
                    }
                }
                Commit::Voided => {
                    self.state.write().unwrap_or_else(|e| e.into_inner()).seq = seq;
                    return;
                }
                Commit::Rejected | Commit::Failed => return,
            }
        }
    }

    async fn maybe_snapshot(&mut self) {
        let plan = {
            let state = self.state.read().unwrap_or_else(|e| e.into_inner());
            if !self.durable.needs_snapshot(&state) {
                return;
            }
            self.durable.prepare_snapshot(&state)
        };
        let _ = self.durable.write_snapshot(plan).await;
    }
}

/// A loopback-only router for local verification of the push routes.
pub fn router(service: Arc<PushService>) -> axum::Router {
    axum::Router::new().fallback(move |request: Request| {
        let service = service.clone();
        async move {
            match service.handle(request).await {
                Some(r) => r,
                None => {
                    let mut r = Response::new(HttpBody::from("Not Found"));
                    *r.status_mut() = StatusCode::NOT_FOUND;
                    r
                }
            }
        }
    })
}

impl Drop for PushService {
    fn drop(&mut self) {
        if let Some(task) = self
            .writer
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            task.abort();
        }
    }
}

struct AbortWriter(tokio::task::JoinHandle<()>);
impl Drop for AbortWriter {
    fn drop(&mut self) {
        self.0.abort();
    }
}
