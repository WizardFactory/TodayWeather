//! HTTP foundation and immutable raw storage; no provider or weather-route cutover.
pub mod listener;
pub mod storage;
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use std::{
    env,
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Clone, Debug)]
pub struct Config {
    pub public_addr: SocketAddr,
    pub metrics_addr: SocketAddr,
    pub worker_threads: usize,
    pub blocking_threads: usize,
    pub cpu_limit: usize,
    pub inflight_limit: usize,
    pub cache_bytes: usize,
    pub connection_limit: usize,
    pub connection_seconds: usize,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            public_addr: "127.0.0.1:3002".parse().unwrap(),
            metrics_addr: "127.0.0.1:3003".parse().unwrap(),
            worker_threads: 2,
            blocking_threads: 4,
            cpu_limit: 2,
            inflight_limit: 40,
            cache_bytes: 16 * 1024 * 1024,
            connection_limit: 128,
            connection_seconds: 9,
        }
    }
}
impl Config {
    pub fn from_env() -> Result<Self, String> {
        let mut c = Self::default();
        macro_rules! value {
            ($name:literal, $field:ident) => {
                match env::var($name) {
                    Ok(v) => c.$field = v.parse().map_err(|_| format!("invalid {}", $name))?,
                    Err(env::VarError::NotPresent) => (),
                    Err(_) => return Err(format!("invalid {}", $name)),
                }
            };
        }
        value!("SERVER2_BIND", public_addr);
        value!("SERVER2_METRICS_BIND", metrics_addr);
        value!("SERVER2_WORKER_THREADS", worker_threads);
        value!("SERVER2_BLOCKING_THREADS", blocking_threads);
        value!("SERVER2_CPU_LIMIT", cpu_limit);
        value!("SERVER2_INFLIGHT_LIMIT", inflight_limit);
        value!("SERVER2_CACHE_BYTES", cache_bytes);
        value!("SERVER2_CONNECTION_LIMIT", connection_limit);
        value!("SERVER2_CONNECTION_SECONDS", connection_seconds);
        c.validate()?;
        Ok(c)
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.metrics_addr.ip().is_loopback() {
            return Err("metrics must bind to loopback".into());
        }
        if self.public_addr == self.metrics_addr && self.public_addr.port() != 0 {
            return Err("listeners must be distinct".into());
        }
        for (name, value, maximum) in [
            ("worker threads", self.worker_threads, 64),
            ("blocking threads", self.blocking_threads, 64),
            ("CPU limit", self.cpu_limit, self.blocking_threads),
            ("inflight limit", self.inflight_limit, 1024),
            ("connection limit", self.connection_limit, 1024),
            ("connection seconds", self.connection_seconds, 30),
            ("cache bytes", self.cache_bytes, 1024 * 1024 * 1024),
        ] {
            if value == 0 || value > maximum {
                return Err(format!("{name} must be in 1..={maximum}"));
            }
        }
        Ok(())
    }
}

pub struct SharedState {
    config: Config,
    admission: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
    memory: Mutex<Option<Arc<[u8]>>>,
    health_requests: AtomicU64,
    rejected: AtomicU64,
}
impl SharedState {
    pub fn new(c: &Config) -> Self {
        Self {
            config: c.clone(),
            admission: Arc::new(Semaphore::new(c.inflight_limit)),
            cpu: Arc::new(Semaphore::new(c.cpu_limit)),
            memory: Mutex::new(None),
            health_requests: AtomicU64::new(0),
            rejected: AtomicU64::new(0),
        }
    }
    pub fn try_admit(&self) -> Option<OwnedSemaphorePermit> {
        self.admission.clone().try_acquire_owned().ok()
    }
    pub fn cpu_available(&self) -> usize {
        self.cpu.available_permits()
    }
    /// CPU permit is moved into the blocking closure: cancellation cannot release it early.
    pub async fn run_cpu<F, T>(&self, work: F) -> Result<T, String>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let permit = self
            .cpu
            .clone()
            .try_acquire_owned()
            .map_err(|_| "CPU capacity exhausted".to_string())?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
        .map_err(|_| "CPU task failed".to_string())
    }
    /// One bounded volatile slot; S07 owns the eventual keyed/sharded cache implementation.
    pub fn replace_memory(&self, bytes: Arc<[u8]>) -> bool {
        if bytes.len() > self.config.cache_bytes {
            return false;
        }
        *self.memory.lock().unwrap_or_else(|e| e.into_inner()) = Some(bytes);
        true
    }
    pub fn memory_bytes(&self) -> usize {
        self.memory
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map_or(0, |v| v.len())
    }
}
async fn health(State(s): State<Arc<SharedState>>) -> Response {
    s.health_requests.fetch_add(1, Ordering::Relaxed);
    ([("content-type", "text/html; charset=utf-8")], "OK").into_response()
}
async fn admission(State(s): State<Arc<SharedState>>, request: Request, next: Next) -> Response {
    let Some(_permit) = s.try_admit() else {
        s.rejected.fetch_add(1, Ordering::Relaxed);
        return (StatusCode::SERVICE_UNAVAILABLE, "capacity exhausted").into_response();
    };
    next.run(request).await
}
async fn cors(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response
}
pub fn public_router(state: Arc<SharedState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .fallback(|| async { (StatusCode::NOT_FOUND, Body::from("Not Found")) })
        .layer(middleware::from_fn_with_state(state.clone(), admission))
        .layer(middleware::from_fn(cors))
        .with_state(state)
}
async fn metrics(State(s): State<Arc<SharedState>>) -> Response {
    let text = format!(
        "server2_health_requests_total {}\nserver2_rejected_total {}\nserver2_inflight {}\nserver2_inflight_limit {}\nserver2_cpu_inflight {}\nserver2_cpu_limit {}\nserver2_cache_bytes {}\nserver2_cache_limit_bytes {}\n",
        s.health_requests.load(Ordering::Relaxed),
        s.rejected.load(Ordering::Relaxed),
        s.config.inflight_limit - s.admission.available_permits(),
        s.config.inflight_limit,
        s.config.cpu_limit - s.cpu.available_permits(),
        s.config.cpu_limit,
        s.memory_bytes(),
        s.config.cache_bytes
    );
    (
        [
            ("content-type", "text/plain; version=0.0.4; charset=utf-8"),
            ("cache-control", "no-store"),
        ],
        text,
    )
        .into_response()
}
pub fn metrics_router(state: Arc<SharedState>) -> Router {
    Router::new()
        .route("/internal/metrics", get(metrics))
        .with_state(state)
}

/// Bound runtime destruction even when a cancelled CPU closure has not finished.
/// This is not a durable-work drain; future storage/provider tasks must define one.
pub fn shutdown_runtime(runtime: tokio::runtime::Runtime) {
    runtime.shutdown_timeout(std::time::Duration::from_secs(1));
}
