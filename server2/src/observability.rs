//! Typed, best-effort operational diagnostics. No caller-supplied text enters a record.
//! Producer work is bounded; only the dedicated writer can wait on stderr.
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::sync::Once;
use std::{
    cell::Cell,
    future::Future,
    io::Write,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender, TrySendError},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const MAX_LINE: usize = 1024;
const QUEUE: usize = 256;
const DEFAULT_RATE: u64 = 100;

macro_rules! vocabulary {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}
vocabulary!(Component {
    Http,
    Gateway,
    Geocode,
    World,
    Domestic,
    Provider,
    Quota,
    S3,
    Resolver,
    Cache,
    History,
    Summary,
    Warnings,
    PushState,
    Delivery,
    Notice,
    Process,
    Listener,
    Logging
});
vocabulary!(Stage {
    Request,
    Lifecycle,
    Startup,
    Bind,
    Shutdown,
    RuntimeTeardown,
    Admission,
    Lookup,
    Restore,
    Acquire,
    ProviderHttp,
    Reserve,
    Publish,
    Reconcile,
    Void,
    Writer,
    Queue,
    Worker,
    Claim,
    Send,
    Oauth,
    RecordResult,
    Submission,
    Translate,
    Snapshot,
    SharedWork,
    Maintenance
});
vocabulary!(Cause {
    None,
    Dependency,
    Transport,
    ConnectionRefused,
    ConnectionReset,
    AddressUnavailable,
    PermissionDenied,
    BrokenPipe,
    Timeout,
    Capacity,
    Quota,
    Auth,
    InvalidInput,
    NotFound,
    Corrupt,
    Ambiguous,
    Cancellation,
    Panic,
    Shutdown,
    StateUnavailable,
    ClaimExists,
    Configuration,
    Dotenv,
    InvalidPort,
    InvalidOpenshiftPort,
    InvalidIp,
    AddressInUse,
    LoggingConfiguration
});
vocabulary!(Action {
    None,
    ReturnResponse,
    ReturnError,
    Retry,
    RotateKey,
    Fallback,
    Reconcile,
    ReconcileBeforeRetry,
    Void,
    RetainClaim,
    DoNotRetry,
    Quiesce,
    Drain,
    CancelOwner,
    RejectBeforeIo,
    UseCache,
    RestoreFromS3,
    PublishBeforeResponse,
    AwaitExisting,
    UseDefaults,
    DetachWaiter,
    InspectLossCounters,
    InspectDurableState
});
vocabulary!(Outcome {
    Started,
    Completed,
    Success,
    Failed,
    Cancelled,
    Unknown,
    Accepted,
    Reconciled,
    Voided,
    Conflict,
    Skipped,
    Pending
});
vocabulary!(DeliveryKind {
    Alarm,
    Alert,
    Warning
});
vocabulary!(FailureClass {
    Weather,
    Message,
    StateGuard,
    StateCommit,
    StateCast,
    Decision,
    Credentials,
    Oauth,
    Connect,
    Shutdown,
    InvalidToken,
    UnsupportedType,
    Other
});
vocabulary!(Route {
    Health,
    Metrics,
    Weather,
    Geocode,
    Kma,
    World,
    Warnings,
    Nation,
    Town,
    Push,
    PushList,
    Notice,
    Other
});
vocabulary!(Method {
    Get,
    Head,
    Post,
    Put,
    Delete,
    Options,
    Other
});
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}
impl Level {
    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Context {
    trace: u128,
    operation: u64,
    parent: Option<u64>,
    route: Route,
    method: Method,
    delivery_kind: Option<DeliveryKind>,
}
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
static NONCE: OnceLock<u64> = OnceLock::new();
fn sequence() -> u64 {
    SEQUENCE.fetch_add(1, Ordering::Relaxed)
}
fn nonce() -> u64 {
    *NONCE.get_or_init(|| {
        let mut bytes = [0u8; 8];
        if SystemRandom::new().fill(&mut bytes).is_err() {
            // Diagnostics must not stop the service if entropy is unavailable. These IDs
            // are correlation, not authorization; neither fallback contains user inputs.
            bytes = (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64
                ^ u64::from(std::process::id()))
            .to_be_bytes();
        }
        u64::from_be_bytes(bytes)
    })
}
impl Context {
    pub fn root(route: Route, method: Method) -> Self {
        let operation = sequence();
        Self {
            trace: (u128::from(nonce()) << 64) | u128::from(operation),
            operation,
            parent: None,
            route,
            method,
            delivery_kind: None,
        }
    }
    pub fn with_delivery_kind(mut self, kind: DeliveryKind) -> Self {
        self.delivery_kind = Some(kind);
        self
    }
    pub fn child(self) -> Self {
        Self {
            operation: sequence(),
            parent: Some(self.operation),
            ..self
        }
    }
    pub fn trace_id(self) -> String {
        format!("{:032x}", self.trace)
    }
    pub fn operation_id(self) -> String {
        format!("{:016x}", self.operation)
    }
    pub fn parent_operation_id(self) -> Option<String> {
        self.parent.map(|id| format!("{id:016x}"))
    }
    pub async fn scope<F: Future>(self, future: F) -> F::Output {
        CURRENT.scope(self, Box::pin(future)).await
    }
}
tokio::task_local! { static CURRENT: Context; }
thread_local! { static BLOCKING: Cell<Option<Context>> = const { Cell::new(None) }; }
pub fn current() -> Context {
    CURRENT
        .try_with(|c| *c)
        .ok()
        .or_else(|| BLOCKING.with(Cell::get))
        .unwrap_or_else(|| Context::root(Route::Other, Method::Other))
}
/// Capture before handing work to another task/JoinSet. Does not change its lifetime.
pub fn inherit<F: Future>(future: F) -> impl Future<Output = F::Output> {
    let context = current();
    async move { context.scope(future).await }
}
pub fn spawn<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    tokio::spawn(inherit(future))
}
pub fn spawn_blocking<F, R>(function: F) -> tokio::task::JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let context = current();
    tokio::task::spawn_blocking(move || {
        struct Reset(Option<Context>);
        impl Drop for Reset {
            fn drop(&mut self) {
                BLOCKING.with(|c| c.set(self.0));
            }
        }
        let previous = BLOCKING.with(|c| c.replace(Some(context)));
        let _reset = Reset(previous);
        function()
    })
}

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub level: Level,
    pub rate_per_level: u64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            level: Level::Info,
            rate_per_level: DEFAULT_RATE,
        }
    }
}
impl Options {
    /// Only two explicitly named logging variables are read; their values are never emitted.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> (Self, bool) {
        let mut options = Self::default();
        let mut invalid = false;
        if let Some(value) = var("SERVER2_LOG_LEVEL") {
            match value.as_str() {
                "error" => options.level = Level::Error,
                "warn" => options.level = Level::Warn,
                "info" => options.level = Level::Info,
                "debug" => options.level = Level::Debug,
                _ => invalid = true,
            }
        }
        if let Some(value) = var("SERVER2_LOG_RATE") {
            match value.parse::<u64>() {
                Ok(rate) if (1..=1000).contains(&rate) => options.rate_per_level = rate,
                _ => invalid = true,
            }
        }
        (options, invalid)
    }
}
#[derive(Default)]
struct Counters {
    filtered: AtomicU64,
    rate_limited: AtomicU64,
    queue_full: AtomicU64,
    oversized: AtomicU64,
    sink_errors: AtomicU64,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Metrics {
    pub filtered: u64,
    pub rate_limited: u64,
    pub queue_full: u64,
    pub oversized: u64,
    pub sink_errors: u64,
}
impl Counters {
    fn snapshot(&self) -> Metrics {
        Metrics {
            filtered: self.filtered.load(Ordering::Relaxed),
            rate_limited: self.rate_limited.load(Ordering::Relaxed),
            queue_full: self.queue_full.load(Ordering::Relaxed),
            oversized: self.oversized.load(Ordering::Relaxed),
            sink_errors: self.sink_errors.load(Ordering::Relaxed),
        }
    }
}
/// One atomic fixed-second counter per severity; debug/info cannot consume error capacity.
struct Bucket(AtomicU64);
impl Bucket {
    fn admit(&self, second: u64, maximum: u64) -> bool {
        let second = second & 0xffff_ffff;
        let mut old = self.0.load(Ordering::Relaxed);
        for _ in 0..8 {
            let count = if old >> 32 == second {
                old & 0xffff_ffff
            } else {
                0
            };
            if count >= maximum {
                return false;
            }
            let new = (second << 32) | (count + 1);
            match self
                .0
                .compare_exchange_weak(old, new, Ordering::Relaxed, Ordering::Relaxed)
            {
                Ok(_) => return true,
                Err(value) => old = value,
            }
        }
        false // bounded contention loss is counted as limiter rejection; never spin indefinitely.
    }
}
enum Message {
    Record(Vec<u8>),
    Flush(mpsc::Sender<()>),
}
struct Logger {
    options: Options,
    tx: SyncSender<Message>,
    counters: Arc<Counters>,
    buckets: [Bucket; 4],
    started: Instant,
}
impl Logger {
    fn new<W: Write + Send + 'static>(options: Options, mut writer: W) -> Self {
        let (tx, rx) = mpsc::sync_channel(QUEUE);
        let counters = Arc::new(Counters::default());
        let stats = counters.clone();
        let spawned = std::thread::Builder::new()
            .name("server2-log-writer".into())
            .spawn(move || {
                let mut last = Metrics::default();
                let mut last_summary = Instant::now();
                loop {
                    let message = rx.recv_timeout(Duration::from_secs(1));
                    let flush = matches!(&message, Ok(Message::Flush(_)));
                    match &message {
                        Ok(Message::Record(bytes)) => {
                            if writer.write_all(bytes).is_err() {
                                stats.sink_errors.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Ok(Message::Flush(_)) | Err(mpsc::RecvTimeoutError::Timeout) => (),
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    let now = stats.snapshot();
                    if (flush || last_summary.elapsed() >= Duration::from_secs(10))
                        && (now.rate_limited != last.rate_limited
                            || now.queue_full != last.queue_full
                            || now.oversized != last.oversized
                            || now.sink_errors != last.sink_errors)
                    {
                        // One summary per interval (or bounded shutdown flush), outside the queue.
                        // A blocked sink cannot report its own blockage; metrics remain independent.
                        let mut summary_record = record(
                            Context::root(Route::Other, Method::Other),
                            "logging.loss",
                            Component::Logging,
                            Stage::Writer,
                            (
                                Cause::Capacity,
                                Action::InspectLossCounters,
                                Outcome::Unknown,
                            ),
                            Details::default(),
                        );
                        summary_record.level = Level::Warn;
                        let mut summary = serde_json::to_value(summary_record).unwrap_or_default();
                        summary["counts"] = serde_json::to_value(now).unwrap_or_default();
                        if let Ok(mut bytes) = serde_json::to_vec(&summary) {
                            bytes.push(b'\n');
                            if bytes.len() <= MAX_LINE && writer.write_all(&bytes).is_err() {
                                stats.sink_errors.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        last = now;
                        last_summary = Instant::now();
                    }
                    if let Ok(Message::Flush(done)) = message {
                        if writer.flush().is_err() {
                            stats.sink_errors.fetch_add(1, Ordering::Relaxed);
                        }
                        let _ = done.send(());
                    }
                }
            });
        if spawned.is_err() {
            counters.sink_errors.fetch_add(1, Ordering::Relaxed);
        }
        Self {
            options,
            tx,
            counters,
            buckets: std::array::from_fn(|_| Bucket(AtomicU64::new(0))),
            started: Instant::now(),
        }
    }
    fn emit(&self, record: &Record) {
        if record.level > self.options.level {
            self.counters.filtered.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let second = self.started.elapsed().as_secs();
        if !self.buckets[record.level.index()].admit(second, self.options.rate_per_level) {
            self.counters.rate_limited.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let Ok(mut bytes) = serde_json::to_vec(record) else {
            self.counters.oversized.fetch_add(1, Ordering::Relaxed);
            return;
        };
        bytes.push(b'\n');
        if bytes.len() > MAX_LINE {
            self.counters.oversized.fetch_add(1, Ordering::Relaxed);
            return;
        }
        match self.tx.try_send(Message::Record(bytes)) {
            Ok(()) => (),
            Err(TrySendError::Full(_)) => {
                self.counters.queue_full.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Disconnected(_)) => {
                self.counters.sink_errors.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    fn flush(&self, bound: Duration) -> bool {
        let (tx, rx) = mpsc::channel();
        if self.tx.try_send(Message::Flush(tx)).is_err() {
            return false;
        }
        rx.recv_timeout(bound).is_ok()
    }
}
static LOGGER: OnceLock<Logger> = OnceLock::new();
static PANIC_HOOK: Once = Once::new();
fn logger() -> &'static Logger {
    LOGGER.get_or_init(|| {
        Logger::new(
            Options::from_vars(&|name| std::env::var(name).ok()).0,
            std::io::stderr(),
        )
    })
}
pub fn init(var: &dyn Fn(&str) -> Option<String>) {
    let (options, invalid) = Options::from_vars(var);
    LOGGER.get_or_init(|| Logger::new(options, std::io::stderr()));
    PANIC_HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let mut r = record(
                current(),
                "operation.panic",
                Component::Process,
                Stage::Lifecycle,
                (Cause::Panic, Action::CancelOwner, Outcome::Failed),
                Details::default(),
            );
            r.level = Level::Error;
            if let Some(location) = info.location() {
                r.details.source = Some(Source::location(location));
                r.details.line = Some(location.line());
            }
            // The panic payload and default hook/backtrace are intentionally not printed.
            logger().emit(&r);
        }))
    });
    if invalid {
        event(
            Component::Logging,
            Stage::Startup,
            Cause::LoggingConfiguration,
            Action::UseDefaults,
            Outcome::Failed,
            Details::default(),
        );
    }
}
pub fn metrics() -> Metrics {
    LOGGER
        .get()
        .map_or_else(Metrics::default, |l| l.counters.snapshot())
}
/// Only shutdown callers may wait, and only inside their existing remaining drain allowance.
pub fn flush(bound: Duration) -> bool {
    LOGGER.get().is_none_or(|l| l.flush(bound))
}
fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

/// Only compiler-provided, allowlisted source identities; no path supplied by a request.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(transparent)]
pub struct Source(&'static str);
impl Source {
    fn location(location: &std::panic::Location<'_>) -> Self {
        const FILES: &[&str] = &[
            "src/api/mod.rs",
            "src/bin/server2-notice.rs",
            "src/budget/store.rs",
            "src/budget/transport.rs",
            "src/cache/disk.rs",
            "src/domestic/acquire.rs",
            "src/domestic/kma/backend.rs",
            "src/domestic/kma/source/air_input.rs",
            "src/domestic/kma/source/life_input.rs",
            "src/domestic/kma/source/mod.rs",
            "src/domestic/kma/source/observe.rs",
            "src/gateway/backend.rs",
            "src/gateway/mod.rs",
            "src/geocode/budget.rs",
            "src/geocode/mod.rs",
            "src/geocode/provider.rs",
            "src/geocode/storage.rs",
            "src/geocode/town.rs",
            "src/history/capture.rs",
            "src/history/transport.rs",
            "src/lib.rs",
            "src/listener.rs",
            "src/main.rs",
            "src/notice/cli.rs",
            "src/notice/store.rs",
            "src/notice/translate.rs",
            "src/observability.rs",
            "src/process.rs",
            "src/providers/acquisition.rs",
            "src/providers/public.rs",
            "src/providers/transport.rs",
            "src/push/deliver/alarm.rs",
            "src/push/deliver/alerts.rs",
            "src/push/deliver/fcm.rs",
            "src/push/deliver/ledger.rs",
            "src/push/deliver/supervisor.rs",
            "src/push/deliver/warnings.rs",
            "src/push/deliver/weather.rs",
            "src/push/durable.rs",
            "src/push/service.rs",
            "src/resolver/backend.rs",
            "src/resolver/flight.rs",
            "src/resolver/owned.rs",
            "src/runtime_services.rs",
            "src/storage/catalog.rs",
            "src/storage/catalog_transport.rs",
            "src/storage/credentials.rs",
            "src/storage/store.rs",
            "src/storage/transport.rs",
            "src/summary/lookup.rs",
            "src/summary/recorder.rs",
            "src/summary/transport.rs",
            "src/warnings/collector.rs",
            "src/warnings/service.rs",
            "src/warnings/store.rs",
            "src/world/air_chain.rs",
            "src/world/air_store.rs",
            "src/world/air_transport.rs",
            "src/world/engine.rs",
            "src/world/source.rs",
            "src/world/store.rs",
            "src/world/transport.rs",
        ];
        Self(
            FILES
                .iter()
                .copied()
                .find(|path| location.file().ends_with(path))
                .unwrap_or("external"),
        )
    }
}
/// Only the CLI-generated durable notice transaction ID can enter diagnostics.
/// Its generator preserves the existing notice-cli nonce/pid SHA-256 algorithm.
#[derive(Clone, Copy, Debug)]
pub struct DurableOperationId([u8; 32]);
impl DurableOperationId {
    pub fn notice(nonce: u128) -> Self {
        use sha2::{Digest, Sha256};
        Self(Sha256::digest(format!("notice-cli:{nonce}:{}", std::process::id())).into())
    }
    pub fn hex(self) -> String {
        self.0.iter().map(|v| format!("{v:02x}")).collect()
    }
}
impl Serialize for DurableOperationId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.hex())
    }
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct Details {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_class: Option<FailureClass>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_joined: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub writer_joined: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_joined: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub durable_operation_id: Option<DurableOperationId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<crate::budget::Provider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}
// Formatting happens only after severity/rate admission, never for filtered records.
struct Timestamp;
impl Serialize for Timestamp {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&timestamp())
    }
}
struct TraceId(u128);
impl Serialize for TraceId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:032x}", self.0))
    }
}
struct OperationId(u64);
impl Serialize for OperationId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:016x}", self.0))
    }
}
#[derive(Serialize)]
struct Record {
    schema: u8,
    build_revision: &'static str,
    timestamp: Timestamp,
    level: Level,
    event: &'static str,
    component: Component,
    stage: Stage,
    trace_id: TraceId,
    operation_id: OperationId,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_operation_id: Option<OperationId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    linked_trace_id: Option<TraceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    linked_operation_id: Option<OperationId>,
    route: Route,
    method: Method,
    #[serde(skip_serializing_if = "Option::is_none")]
    delivery_kind: Option<DeliveryKind>,
    cause: Cause,
    action: Action,
    outcome: Outcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<&'static str>,
    #[serde(flatten)]
    details: Details,
}
fn record(
    context: Context,
    event: &'static str,
    component: Component,
    stage: Stage,
    decision: (Cause, Action, Outcome),
    details: Details,
) -> Record {
    let (cause, action, outcome) = decision;
    Record {
        schema: 1,
        build_revision: option_env!("SERVER2_BUILD_REVISION")
            .filter(|v| v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .unwrap_or("unknown"),
        timestamp: Timestamp,
        level: match outcome {
            Outcome::Unknown
                if component == Component::Process
                    && stage == Stage::RuntimeTeardown
                    && cause == Cause::Cancellation =>
            {
                Level::Info
            }
            Outcome::Unknown | Outcome::Failed => Level::Warn,
            Outcome::Cancelled => Level::Info,
            _ => Level::Info,
        },
        event,
        component,
        stage,
        trace_id: TraceId(context.trace),
        operation_id: OperationId(context.operation),
        parent_operation_id: context.parent.map(OperationId),
        linked_trace_id: None,
        linked_operation_id: None,
        route: context.route,
        method: context.method,
        delivery_kind: context.delivery_kind,
        cause,
        action,
        outcome,
        duration_ms: None,
        note: match cause {
            Cause::Configuration if component == Component::Process && stage == Stage::Startup => {
                Some("invalid gateway configuration")
            }
            Cause::InvalidPort => Some("invalid PORT"),
            Cause::InvalidOpenshiftPort => Some("invalid OPENSHIFT_NODEJS_PORT"),
            Cause::InvalidIp => Some("invalid OPENSHIFT_NODEJS_IP"),
            Cause::Dotenv => Some("unable to load server2/.env"),
            _ => None,
        },
        details,
    }
}
pub fn event(
    component: Component,
    stage: Stage,
    cause: Cause,
    action: Action,
    outcome: Outcome,
    details: Details,
) {
    logger().emit(&record(
        current(),
        "operation.action",
        component,
        stage,
        (cause, action, outcome),
        details,
    ));
}
pub fn link(component: Component, owner: Context) {
    let mut r = record(
        current(),
        "operation.linked",
        component,
        Stage::SharedWork,
        (Cause::None, Action::AwaitExisting, Outcome::Pending),
        Details::default(),
    );
    r.linked_trace_id = Some(TraceId(owner.trace));
    r.linked_operation_id = Some(OperationId(owner.operation));
    logger().emit(&r);
}
/// Correlates a mutex-serialized owner without adding a blocking logging lock.
/// If metadata is contended, omit the link rather than link to an old owner.
#[derive(Default)]
pub struct SharedOwner {
    context: std::sync::Mutex<Option<Context>>,
    active: AtomicU64,
}
pub struct OwnerGuard<'a>(&'a SharedOwner);
impl SharedOwner {
    pub fn enter(&self) -> OwnerGuard<'_> {
        let context = current();
        if let Ok(mut slot) = self.context.try_lock() {
            *slot = Some(context);
            self.active.store(context.operation, Ordering::Release);
        }
        OwnerGuard(self)
    }
    pub fn join(&self, component: Component) {
        if let Ok(slot) = self.context.try_lock()
            && let Some(context) = *slot
            && self.active.load(Ordering::Acquire) == context.operation
        {
            link(component, context);
        }
    }
}
impl Drop for OwnerGuard<'_> {
    fn drop(&mut self) {
        self.0.active.store(0, Ordering::Release);
    }
}
/// Terminal evidence is emitted even when a future is dropped. No input is retained.
pub struct Operation {
    context: Context,
    component: Component,
    stage: Stage,
    start: Instant,
    pending_external: bool,
    finished: bool,
    level: Level,
    source: Source,
    line: u32,
}
impl Operation {
    #[track_caller]
    pub fn new(component: Component, stage: Stage) -> Self {
        Self::at(current().child(), component, stage)
    }
    #[track_caller]
    pub fn at(context: Context, component: Component, stage: Stage) -> Self {
        let location = std::panic::Location::caller();
        let source = Source::location(location);
        let line = location.line();
        let level = if matches!(context.route, Route::Health | Route::Metrics)
            || matches!(
                stage,
                Stage::Lookup | Stage::Restore | Stage::Reserve | Stage::ProviderHttp
            )
            || component == Component::Cache
        {
            Level::Debug
        } else {
            Level::Info
        };
        let mut r = record(
            context,
            "operation.started",
            component,
            stage,
            (Cause::None, Action::None, Outcome::Started),
            Details {
                source: Some(source),
                line: Some(line),
                ..Default::default()
            },
        );
        r.level = level;
        logger().emit(&r);
        Self {
            context,
            component,
            stage,
            start: Instant::now(),
            pending_external: false,
            finished: false,
            level,
            source,
            line,
        }
    }
    pub fn context(&self) -> Context {
        self.context
    }
    pub fn external_pending(&mut self) {
        self.pending_external = true;
    }
    pub fn finish(&mut self, cause: Cause, action: Action, outcome: Outcome, mut details: Details) {
        if self.finished {
            return;
        }
        self.finished = true;
        details.source.get_or_insert(self.source);
        details.line.get_or_insert(self.line);
        let mut r = record(
            self.context,
            "operation.finished",
            self.component,
            self.stage,
            (cause, action, outcome),
            details,
        );
        r.duration_ms = Some(self.start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64);
        if !matches!(outcome, Outcome::Unknown | Outcome::Failed) {
            r.level = self.level;
        }
        // An absent S3 object is a normal cold-read result; parent failure remains visible.
        if self.component == Component::S3 && cause == Cause::NotFound {
            r.level = Level::Debug;
        }
        if self.component == Component::Http
            && details
                .status
                .is_some_and(|s| (400..500).contains(&s) && s != 429)
        {
            r.level = Level::Info;
        }
        logger().emit(&r);
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if !self.finished {
            self.finish(
                if std::thread::panicking() {
                    Cause::Panic
                } else {
                    Cause::Cancellation
                },
                if self.pending_external && self.component == Component::S3 {
                    Action::ReconcileBeforeRetry
                } else if self.pending_external {
                    Action::DoNotRetry
                } else if self.stage == Stage::Request {
                    Action::DetachWaiter
                } else {
                    Action::CancelOwner
                },
                if self.pending_external {
                    Outcome::Unknown
                } else {
                    if std::thread::panicking() {
                        Outcome::Failed
                    } else {
                        Outcome::Cancelled
                    }
                },
                Details::default(),
            );
        }
    }
}
/// Explicit safe error classification; implementations must never format the input error.
pub trait Classify {
    fn classify(&self) -> (Cause, Outcome, Option<u16>);
}
pub async fn observe<F, T, E>(component: Component, stage: Stage, future: F) -> Result<T, E>
where
    F: Future<Output = Result<T, E>>,
    E: Classify,
{
    let mut operation = Operation::new(component, stage);
    let context = operation.context();
    if stage == Stage::Publish {
        operation.external_pending();
    }
    let result = context.scope(future).await;
    match &result {
        Ok(_) => operation.finish(
            Cause::None,
            Action::None,
            Outcome::Success,
            Details::default(),
        ),
        Err(error) => {
            let (cause, outcome, status) = error.classify();
            operation.finish(
                cause,
                Action::ReturnError,
                outcome,
                Details {
                    status,
                    ..Details::default()
                },
            );
        }
    }
    result
}
/// Non-Result work returned; completed does not claim its individual deliveries succeeded.
pub async fn work<F: Future>(component: Component, stage: Stage, future: F) -> F::Output {
    let mut operation = Operation::new(component, stage);
    let context = operation.context();
    let result = context.scope(future).await;
    operation.finish(
        Cause::None,
        Action::None,
        Outcome::Completed,
        Details::default(),
    );
    result
}
pub fn route(path: &str) -> Route {
    // Never return a piece of the incoming path, including unknown routes.
    if path == "/health" {
        Route::Health
    } else if path == "/internal/metrics" {
        Route::Metrics
    } else if path.starts_with("/weather/") {
        Route::Weather
    } else if path.starts_with("/geocode/") {
        Route::Geocode
    } else if ![
        "/v000901/",
        "/v000902/",
        "/v000903/",
        "/v000803/",
        "/v000705/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
    {
        Route::Other
    } else if path.split('/').nth(2) == Some("push-list") {
        Route::PushList
    } else if path.split('/').nth(2) == Some("push") {
        Route::Push
    } else if path.split('/').nth(2) == Some("notice") {
        Route::Notice
    } else if path.contains("/kma/special") {
        Route::Warnings
    } else if path.split('/').nth(2) == Some("kma") {
        Route::Kma
    } else if path.split('/').nth(2) == Some("dsf") {
        Route::World
    } else if path.split('/').nth(2) == Some("nation") {
        Route::Nation
    } else if path.split('/').nth(2) == Some("town") {
        Route::Town
    } else {
        Route::Other
    }
}
fn method(method: &axum::http::Method) -> Method {
    match *method {
        axum::http::Method::GET => Method::Get,
        axum::http::Method::HEAD => Method::Head,
        axum::http::Method::POST => Method::Post,
        axum::http::Method::PUT => Method::Put,
        axum::http::Method::DELETE => Method::Delete,
        axum::http::Method::OPTIONS => Method::Options,
        _ => Method::Other,
    }
}
pub async fn http(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let context = Context::root(route(request.uri().path()), method(request.method()));
    let mut operation = Operation::at(context, Component::Http, Stage::Request);
    let response = context.scope(next.run(request)).await;
    let status = response.status().as_u16();
    operation.finish(
        match status {
            404 => Cause::NotFound,
            429 | 503 => Cause::Capacity,
            s if (400..500).contains(&s) => Cause::InvalidInput,
            500..=599 => Cause::Dependency,
            _ => Cause::None,
        },
        Action::ReturnResponse,
        if status >= 400 {
            Outcome::Failed
        } else {
            Outcome::Success
        },
        Details {
            status: Some(status),
            ..Details::default()
        },
    );
    response
}
impl Classify for crate::storage::Error {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::storage::Error as E;
        let cause = match self {
            E::Invalid(_) => Cause::InvalidInput,
            E::Corrupt(_) => Cause::Corrupt,
            E::Capacity => Cause::Capacity,
            E::Ambiguous => Cause::Ambiguous,
            E::Timeout => Cause::Timeout,
            E::Transport => Cause::Transport,
            E::NotFound => Cause::NotFound,
            E::Status(401 | 403) => Cause::Auth,
            E::Status(429) => Cause::Quota,
            E::Status(_) => Cause::Dependency,
        };
        (
            cause,
            if matches!(self, E::Ambiguous) {
                Outcome::Unknown
            } else {
                Outcome::Failed
            },
            if let E::Status(s) = self {
                Some(*s)
            } else {
                None
            },
        )
    }
}
impl Classify for std::io::Error {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        (
            match self.kind() {
                std::io::ErrorKind::AddrInUse => Cause::AddressInUse,
                std::io::ErrorKind::TimedOut => Cause::Timeout,
                _ => Cause::Transport,
            },
            Outcome::Failed,
            None,
        )
    }
}

/// A fresh scheduled/process root; it is not linked to the startup request that built a worker.
pub async fn root_work<F: Future>(component: Component, stage: Stage, future: F) -> F::Output {
    let context = Context::root(Route::Other, Method::Other);
    let mut operation = Operation::at(context, component, stage);
    let result = context.scope(future).await;
    operation.finish(
        Cause::None,
        Action::None,
        Outcome::Completed,
        Details::default(),
    );
    result
}
pub fn fatal(cause: Cause) {
    let mut r = record(
        Context::root(Route::Other, Method::Other),
        "operation.finished",
        Component::Process,
        Stage::Startup,
        (cause, Action::ReturnError, Outcome::Failed),
        Details::default(),
    );
    r.level = Level::Error;
    logger().emit(&r);
}
pub fn render_metrics() -> String {
    let m = metrics();
    format!(
        "server2_logging_filtered_total {}\nserver2_logging_rate_limited_total {}\nserver2_logging_queue_full_total {}\nserver2_logging_oversized_total {}\nserver2_logging_sink_errors_total {}\n",
        m.filtered, m.rate_limited, m.queue_full, m.oversized, m.sink_errors
    )
}

impl Classify for crate::budget::BudgetError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::budget::BudgetError as E;
        let cause = match self {
            E::Invalid(_) => Cause::InvalidInput,
            E::Corrupt(_) => Cause::Corrupt,
            E::Exhausted => Cause::Quota,
            E::Contention => Cause::Capacity,
            E::Unknown => Cause::Ambiguous,
            E::Deadline => Cause::Timeout,
            E::Clock => Cause::Configuration,
            E::Transport => Cause::Transport,
            E::NotFound => Cause::NotFound,
            E::Status(401 | 403) => Cause::Auth,
            E::Status(429) => Cause::Quota,
            E::Status(_) => Cause::Dependency,
        };
        (
            cause,
            if matches!(self, E::Unknown) {
                Outcome::Unknown
            } else {
                Outcome::Failed
            },
            if let E::Status(s) = self {
                Some(*s)
            } else {
                None
            },
        )
    }
}
impl Classify for crate::providers::AcquisitionError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::providers::AcquisitionError as E;
        match self {
            E::Funding(error) => error.classify(),
            E::Invalid => (Cause::InvalidInput, Outcome::Failed, None),
            E::Deadline => (Cause::Timeout, Outcome::Failed, None),
            E::Transport => (Cause::Transport, Outcome::Failed, None),
            E::Provider(disposition) => (provider_cause(*disposition), Outcome::Failed, None),
        }
    }
}
pub fn provider_cause(disposition: crate::providers::Disposition) -> Cause {
    use crate::providers::Disposition as D;
    match disposition {
        D::Quota => Cause::Quota,
        D::Auth => Cause::Auth,
        D::Data | D::NoData => Cause::None,
        D::Rejected => Cause::InvalidInput,
        D::Retryable => Cause::Dependency,
    }
}
impl Classify for crate::providers::ProviderTransportError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::providers::ProviderTransportError as E;
        match self {
            E::Invalid => (Cause::InvalidInput, Outcome::Failed, None),
            E::Transport => (Cause::Transport, Outcome::Failed, None),
            E::Response { status } => (Cause::Corrupt, Outcome::Failed, Some(*status)),
        }
    }
}
impl Classify for crate::geocode::GeocodeError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::geocode::GeocodeError as E;
        (
            match self {
                E::Provider => Cause::Dependency,
                E::Capacity => Cause::Capacity,
                E::InvalidConfiguration => Cause::Configuration,
                E::Quota => Cause::Quota,
            },
            Outcome::Failed,
            None,
        )
    }
}
impl Classify for crate::gateway::GatewayError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::gateway::GatewayError as E;
        (
            match self {
                E::BadRequest => Cause::InvalidInput,
                E::NotFound => Cause::NotFound,
                E::Provider => Cause::Dependency,
                E::Unavailable(_) => Cause::Capacity,
                E::InvalidConfiguration => Cause::Configuration,
            },
            Outcome::Failed,
            None,
        )
    }
}
impl Classify for crate::notice::Error {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        use crate::notice::Error as E;
        (
            match self {
                E::Invalid(_) => Cause::InvalidInput,
                E::Unavailable | E::Translation(_) => Cause::Dependency,
                E::Corrupt => Cause::Corrupt,
                E::Conflict => Cause::Capacity,
                E::Uncertain => Cause::Ambiguous,
                E::NotFound => Cause::NotFound,
                E::Capacity => Cause::Capacity,
            },
            if matches!(self, E::Uncertain) {
                Outcome::Unknown
            } else {
                Outcome::Failed
            },
            None,
        )
    }
}
impl Classify for crate::push::durable::StateError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        match self {
            Self::Storage(error) => error.classify(),
            Self::Corrupt(_) => (Cause::Corrupt, Outcome::Failed, None),
        }
    }
}
impl Classify for crate::resolver::Error {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        match self {
            Self::Storage(error) => error.classify(),
            Self::Incomplete => (Cause::Corrupt, Outcome::Failed, None),
            Self::AcquisitionDenied => (Cause::Quota, Outcome::Failed, None),
            Self::Cancelled => (Cause::Cancellation, Outcome::Cancelled, None),
            Self::Draining => (Cause::Shutdown, Outcome::Cancelled, None),
            Self::TaskFailed => (Cause::Panic, Outcome::Failed, None),
        }
    }
}
/// Observe a shared owner's own generated context; joining callers link to this exact operation.
pub async fn observe_at<F, T, E>(
    context: Context,
    component: Component,
    stage: Stage,
    future: F,
) -> Result<T, E>
where
    F: Future<Output = Result<T, E>>,
    E: Classify,
{
    let mut operation = Operation::at(context, component, stage);
    let result = context.scope(future).await;
    match &result {
        Ok(_) => operation.finish(
            Cause::None,
            Action::None,
            Outcome::Success,
            Details::default(),
        ),
        Err(error) => {
            let (cause, outcome, status) = error.classify();
            operation.finish(
                cause,
                Action::ReturnError,
                outcome,
                Details {
                    status,
                    ..Details::default()
                },
            );
        }
    }
    result
}
pub async fn work_at<F: Future>(
    context: Context,
    component: Component,
    stage: Stage,
    future: F,
) -> F::Output {
    let mut operation = Operation::at(context, component, stage);
    let result = context.scope(future).await;
    operation.finish(
        Cause::None,
        Action::None,
        Outcome::Completed,
        Details::default(),
    );
    result
}

fn transport_cause(error: &reqwest::Error) -> Cause {
    let mut source = std::error::Error::source(error);
    for _ in 0..8 {
        let Some(error) = source else { break };
        if let Some(io) = error.downcast_ref::<std::io::Error>() {
            return match io.kind() {
                std::io::ErrorKind::ConnectionRefused => Cause::ConnectionRefused,
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted => {
                    Cause::ConnectionReset
                }
                std::io::ErrorKind::AddrNotAvailable => Cause::AddressUnavailable,
                std::io::ErrorKind::PermissionDenied => Cause::PermissionDenied,
                std::io::ErrorKind::BrokenPipe => Cause::BrokenPipe,
                std::io::ErrorKind::TimedOut => Cause::Timeout,
                _ => Cause::Transport,
            };
        }
        source = error.source();
    }
    Cause::Transport
}
impl Classify for reqwest::Error {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        let cause = if self.is_timeout() {
            Cause::Timeout
        } else if self
            .status()
            .is_some_and(|s| s.as_u16() == 401 || s.as_u16() == 403)
        {
            Cause::Auth
        } else if self.status().is_some_and(|s| s.as_u16() == 429) {
            Cause::Quota
        } else {
            transport_cause(self)
        };
        (
            cause,
            if self.is_connect() {
                Outcome::Failed
            } else {
                Outcome::Unknown
            },
            self.status().map(|s| s.as_u16()),
        )
    }
}
/// Observes only status and safe transport classes. Does not clone/retry a request or read its body.
pub trait ObservedHttp: Future<Output = Result<reqwest::Response, reqwest::Error>> + Sized {
    fn observed(
        self,
        component: Component,
    ) -> impl Future<Output = Result<reqwest::Response, reqwest::Error>> {
        async move {
            let mut operation = Operation::new(component, Stage::ProviderHttp);
            operation.external_pending();
            let context = operation.context();
            let result = context.scope(self).await;
            let (cause, outcome, status) = match &result {
                Ok(response) => {
                    let status = response.status().as_u16();
                    (
                        match status {
                            401 | 403 => Cause::Auth,
                            429 => Cause::Quota,
                            404 => Cause::NotFound,
                            400..=599 => Cause::Dependency,
                            _ => Cause::None,
                        },
                        if status >= 400 {
                            Outcome::Failed
                        } else {
                            Outcome::Completed
                        },
                        Some(status),
                    )
                }
                Err(error) => error.classify(),
            };
            operation.finish(
                cause,
                Action::None,
                outcome,
                Details {
                    status,
                    ..Details::default()
                },
            );
            result
        }
    }
}
impl<F: Future<Output = Result<reqwest::Response, reqwest::Error>>> ObservedHttp for F {}

impl Classify for crate::world::Failure {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        (
            match self {
                Self::Unavailable(_) => Cause::Quota,
                Self::Error => Cause::Dependency,
            },
            Outcome::Failed,
            None,
        )
    }
}
impl Classify for crate::warnings::service::ServeError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        match self {
            Self::Empty => (Cause::NotFound, Outcome::Failed, None),
            Self::Clock => (Cause::Configuration, Outcome::Failed, None),
            Self::Storage(error) => error.classify(),
        }
    }
}

impl Classify for crate::summary::lookup::LookupError {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        match self {
            Self::Storage(e) => e.classify(),
            Self::Provider => (Cause::Dependency, Outcome::Failed, None),
            Self::Pending => (Cause::Timeout, Outcome::Failed, None),
            Self::Invalid => (Cause::InvalidInput, Outcome::Failed, None),
        }
    }
}
impl Classify for Box<dyn std::error::Error> {
    fn classify(&self) -> (Cause, Outcome, Option<u16>) {
        if let Some(e) = self.downcast_ref::<crate::notice::Error>() {
            e.classify()
        } else if let Some(e) = self.downcast_ref::<std::io::Error>() {
            e.classify()
        } else if let Some(e) = self.downcast_ref::<crate::storage::Error>() {
            e.classify()
        } else {
            (Cause::Configuration, Outcome::Failed, None)
        }
    }
}

/// A transport returning a status has acknowledged only that status, not a business commit.
pub async fn observe_status<F, E>(component: Component, stage: Stage, future: F) -> Result<u16, E>
where
    F: Future<Output = Result<u16, E>>,
    E: Classify,
{
    observe_response(component, stage, |status| *status, future).await
}
pub async fn observe_response<F, T, E>(
    component: Component,
    stage: Stage,
    status_of: fn(&T) -> u16,
    future: F,
) -> Result<T, E>
where
    F: Future<Output = Result<T, E>>,
    E: Classify,
{
    let mut operation = Operation::new(component, stage);
    operation.external_pending();
    let result = operation.context().scope(future).await;
    let (cause, action, outcome, status) = match &result {
        Ok(value) => {
            let status = status_of(value);
            (
                match status {
                    401 | 403 => Cause::Auth,
                    429 => Cause::Quota,
                    404 => Cause::NotFound,
                    400..=599 => Cause::Dependency,
                    _ => Cause::None,
                },
                if status == 412 {
                    Action::Reconcile
                } else {
                    Action::None
                },
                if status == 412 {
                    Outcome::Conflict
                } else if status >= 400 {
                    Outcome::Failed
                } else {
                    Outcome::Completed
                },
                Some(status),
            )
        }
        Err(error) => {
            let (cause, outcome, status) = error.classify();
            (
                cause,
                if component == Component::S3 {
                    Action::ReconcileBeforeRetry
                } else {
                    Action::DoNotRetry
                },
                if component == Component::S3
                    && matches!(
                        cause,
                        Cause::Transport
                            | Cause::Timeout
                            | Cause::ConnectionReset
                            | Cause::BrokenPipe
                    )
                {
                    Outcome::Unknown
                } else {
                    outcome
                },
                status,
            )
        }
    };
    operation.finish(
        cause,
        action,
        outcome,
        Details {
            status,
            ..Default::default()
        },
    );
    result
}

/// A conclusion contains only bounded safe vocabulary, never the value being observed.
pub struct Conclusion {
    pub cause: Cause,
    pub action: Action,
    pub outcome: Outcome,
    pub details: Details,
}
pub fn skipped() -> Conclusion {
    Conclusion {
        cause: Cause::None,
        action: Action::None,
        outcome: Outcome::Skipped,
        details: Details::default(),
    }
}
pub fn error<E: Classify>(error: &E) -> Conclusion {
    let (cause, outcome, status) = error.classify();
    Conclusion {
        cause,
        action: Action::ReturnError,
        outcome,
        details: Details {
            status,
            ..Details::default()
        },
    }
}
/// Classify a static worker failure; the input text never enters a record.
pub fn failure(class: &str) -> Conclusion {
    let failure_class = match class {
        "weather" | "weather-json" => FailureClass::Weather,
        "text" | "message" => FailureClass::Message,
        "alarm-admission"
        | "alert-admission"
        | "warning-admission"
        | "registration-changed-or-expired" => FailureClass::StateGuard,
        "state-not-committed" => FailureClass::StateCommit,
        "state-cast" => FailureClass::StateCast,
        "compare" | "update" => FailureClass::Decision,
        "fcm-credentials" => FailureClass::Credentials,
        "fcm-oauth" => FailureClass::Oauth,
        "fcm-connect" => FailureClass::Connect,
        "shutdown-before-post" => FailureClass::Shutdown,
        "invalid-token" => FailureClass::InvalidToken,
        "unknown-type" => FailureClass::UnsupportedType,
        _ => FailureClass::Other,
    };
    let cause = match failure_class {
        FailureClass::Credentials => Cause::Auth,
        FailureClass::Connect => Cause::Transport,
        FailureClass::StateGuard | FailureClass::StateCommit => Cause::StateUnavailable,
        FailureClass::InvalidToken | FailureClass::UnsupportedType => Cause::InvalidInput,
        FailureClass::Decision | FailureClass::StateCast => Cause::Corrupt,
        FailureClass::Shutdown => Cause::Shutdown,
        _ => Cause::Dependency,
    };
    Conclusion {
        cause,
        action: Action::DoNotRetry,
        outcome: Outcome::Failed,
        details: Details {
            failure_class: Some(failure_class),
            ..Details::default()
        },
    }
}
pub fn delivery(delivery: &crate::push::deliver::Delivery) -> Conclusion {
    use crate::push::deliver::Delivery;
    let (cause, outcome, status) = match delivery {
        Delivery::Accepted => (Cause::None, Outcome::Accepted, None),
        Delivery::Unknown { reason } => (
            if *reason == "timeout" {
                Cause::Timeout
            } else {
                Cause::Transport
            },
            Outcome::Unknown,
            None,
        ),
        Delivery::Unregistered { status, .. } => (Cause::NotFound, Outcome::Failed, Some(*status)),
        Delivery::Rejected { status, .. } => (
            match status {
                401 | 403 => Cause::Auth,
                429 => Cause::Quota,
                _ => Cause::Dependency,
            },
            Outcome::Failed,
            Some(*status),
        ),
        Delivery::Failed { class } => return failure(class),
    };
    Conclusion {
        cause,
        action: if outcome == Outcome::Accepted {
            Action::None
        } else {
            Action::DoNotRetry
        },
        outcome,
        details: Details {
            status,
            ..Details::default()
        },
    }
}
/// One anonymous item beneath its existing batch/cycle. Returns its original value unchanged.
pub async fn value<F, T>(
    component: Component,
    stage: Stage,
    future: F,
    classify: impl FnOnce(&T) -> Conclusion,
) -> T
where
    F: Future<Output = T>,
{
    let mut operation = Operation::new(component, stage);
    let result = operation.context().scope(future).await;
    let conclusion = classify(&result);
    operation.finish(
        conclusion.cause,
        conclusion.action,
        conclusion.outcome,
        conclusion.details,
    );
    result
}

pub async fn delivery_cycle<F: Future>(kind: DeliveryKind, future: F) -> F::Output {
    let context = Context::root(Route::Other, Method::Other).with_delivery_kind(kind);
    work_at(context, Component::Delivery, Stage::Worker, future).await
}
pub async fn delivery_cycle_result<F, T, E>(kind: DeliveryKind, future: F) -> Result<T, E>
where
    F: Future<Output = Result<T, E>>,
    E: Classify,
{
    let context = Context::root(Route::Other, Method::Other).with_delivery_kind(kind);
    observe_at(context, Component::Delivery, Stage::Worker, future).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn severity_buckets_bound_floods_and_reserve_error_capacity() {
        let buckets: [Bucket; 4] = std::array::from_fn(|_| Bucket(AtomicU64::new(0)));
        assert_eq!(
            (0..1000)
                .filter(|_| buckets[Level::Info.index()].admit(123, 7))
                .count(),
            7
        );
        assert!(buckets[Level::Error.index()].admit(123, 7));
        assert!(buckets[Level::Info.index()].admit(124, 7));
    }
    #[test]
    fn stalled_sink_does_not_block_producer_or_grow_queue() {
        struct Stalled(mpsc::Receiver<()>);
        impl Write for Stalled {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                let _ = self.0.recv();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (release, receiver) = mpsc::channel();
        let logger = Logger::new(
            Options {
                level: Level::Debug,
                rate_per_level: 1000,
            },
            Stalled(receiver),
        );
        let r = record(
            Context::root(Route::Other, Method::Other),
            "operation.action",
            Component::Logging,
            Stage::Writer,
            (Cause::None, Action::None, Outcome::Success),
            Details::default(),
        );
        let before = Instant::now();
        for _ in 0..900 {
            logger.emit(&r);
        }
        assert!(
            before.elapsed() < Duration::from_secs(2),
            "producer waited for stalled output"
        );
        assert!(
            logger.counters.snapshot().queue_full > 0,
            "fixed queue did not expose overload"
        );
        assert!(
            !logger.flush(Duration::from_millis(1)),
            "blocked sink cannot claim flushed"
        );
        drop(release); // releases every later write and lets the test-owned thread exit.
    }
    #[test]
    fn sink_errors_and_filtering_are_observable_without_raw_error_text() {
        struct Failed;
        impl Write for Failed {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("SYNTHETIC-SECRET-SINK-ERROR"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let logger = Logger::new(
            Options {
                level: Level::Warn,
                rate_per_level: 10,
            },
            Failed,
        );
        let mut r = record(
            Context::root(Route::Other, Method::Other),
            "operation.action",
            Component::Logging,
            Stage::Writer,
            (Cause::None, Action::None, Outcome::Success),
            Details::default(),
        );
        logger.emit(&r);
        assert_eq!(logger.counters.snapshot().filtered, 1);
        r.level = Level::Warn;
        logger.emit(&r);
        assert!(logger.flush(Duration::from_secs(1)));
        assert!(logger.counters.snapshot().sink_errors > 0);
        let encoded = serde_json::to_vec(&r).unwrap();
        assert!(encoded.len() < MAX_LINE);
        assert!(
            !String::from_utf8(encoded)
                .unwrap()
                .contains("SYNTHETIC-SECRET")
        );
    }
}
