//! HTTP foundation and immutable raw storage; no provider or weather-route cutover.
pub mod cache;
pub mod dotenv;
pub mod listener;
pub mod narrative;
pub mod observability;
pub mod process;
pub mod resolver;
pub mod runtime_services;
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
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Default connection lifetime when the gateway is enabled (AK decision, 2026-10-13).
pub const GATEWAY_CONNECTION_SECONDS: usize = 12;

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
            public_addr: "127.0.0.1:3000".parse().unwrap(),
            metrics_addr: "127.0.0.1:3001".parse().unwrap(),
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
    /// S10e: the listener follows legacy `server/config/config.js`: address
    /// `OPENSHIFT_NODEJS_IP` (default `127.0.0.1`), port `OPENSHIFT_NODEJS_PORT`, else `PORT`
    /// (default `3000`); an empty value counts as unset, as JavaScript `||` does. Metrics listen
    /// on loopback at the next port (an ephemeral port when the public port is `0`). Every other
    /// process setting is built in; legacy has no equivalent setting for them.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, String> {
        let set = |name: &str| var(name).filter(|v| !v.is_empty());
        let mut c = Self::default();
        let ip: std::net::IpAddr = match set("OPENSHIFT_NODEJS_IP") {
            Some(v) => v
                .parse()
                .map_err(|_| "invalid OPENSHIFT_NODEJS_IP".to_string())?,
            None => std::net::Ipv4Addr::LOCALHOST.into(),
        };
        let port: u16 = match set("OPENSHIFT_NODEJS_PORT")
            .map(|v| ("OPENSHIFT_NODEJS_PORT", v))
            .or_else(|| set("PORT").map(|v| ("PORT", v)))
        {
            Some((name, v)) => v.parse().map_err(|_| format!("invalid {name}"))?,
            None => 3000,
        };
        let metrics_port = match port {
            0 => 0,
            p => p
                .checked_add(1)
                .ok_or_else(|| "the port leaves no metrics port".to_string())?,
        };
        let loopback: std::net::IpAddr = if ip.is_ipv6() {
            std::net::Ipv6Addr::LOCALHOST.into()
        } else {
            std::net::Ipv4Addr::LOCALHOST.into()
        };
        c.public_addr = SocketAddr::new(ip, port);
        c.metrics_addr = SocketAddr::new(loopback, metrics_port);
        c.validate()?;
        // Same presence test as `gateway::runtime::from_vars`.
        let families =
            gateway::runtime::NativeFamilies::from_vars(var).map_err(|e| e.to_string())?;
        c.select_connection_lifetime(
            var("SERVER2_GATEWAY_LEGACY_URL").is_some() || families.any(),
        )?;
        Ok(c)
    }
    /// The absolute connection lifetime must outlive the gateway deadline so its
    /// legacy `501` is written before the socket closes (#2730). With the gateway
    /// enabled the lifetime is `GATEWAY_CONNECTION_SECONDS`; a lifetime at or below the
    /// deadline is rejected. Without the gateway the foundation value is kept unchanged.
    pub fn select_connection_lifetime(&mut self, gateway_enabled: bool) -> Result<(), String> {
        if !gateway_enabled {
            return Ok(());
        }
        self.connection_seconds = GATEWAY_CONNECTION_SECONDS;
        let deadline = gateway::PUBLIC_DEADLINE.as_secs();
        if self.connection_seconds as u64 <= deadline {
            return Err(format!(
                "the connection lifetime must exceed the {deadline}-second gateway deadline"
            ));
        }
        Ok(())
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
        crate::observability::spawn_blocking(move || {
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
        .layer(middleware::from_fn(observability::http))
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
    ) + &gateway::metrics::render()
        + &observability::render_metrics();
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
        .layer(middleware::from_fn(observability::http))
}

/// Bound runtime destruction even when a cancelled CPU closure has not finished.
/// S20b reserves this second after its shared 34-second HTTP/job/writer deadline.
/// This cancels unfinished async native acquisitions; it does not prove provider completion.
pub fn shutdown_runtime(runtime: tokio::runtime::Runtime) {
    runtime.shutdown_timeout(std::time::Duration::from_secs(1));
}

pub mod budget;
pub mod domestic;
pub mod history;
pub mod providers;
pub mod summary;

pub mod gateway;
pub mod geocode;
pub mod world;

/// Gateway owns its own bounded request jobs; health keeps foundation admission.
pub fn public_router_with_gateway(
    state: Arc<SharedState>,
    gateway: Arc<gateway::Gateway>,
) -> Router {
    let health_route = get(health)
        .layer(middleware::from_fn_with_state(state.clone(), admission))
        .layer(middleware::from_fn(cors));
    Router::new()
        .route("/health", health_route)
        .fallback(move |request: Request| {
            let gateway = gateway.clone();
            async move { gateway.handle(request).await }
        })
        .with_state(state)
        .layer(middleware::from_fn(observability::http))
}
/// S17b: legacy direct public KMA routes.
pub mod api;
pub mod push;
pub mod warnings;

/// S17c native nation weather and air composition.
pub mod nation;

pub mod notice;

/// Compose one fallback and route-only APIs; health retains foundation admission/CORS.
pub fn public_router_with_routes(state: Arc<SharedState>, routes: Router) -> Router {
    let health_route = get(health)
        .layer(middleware::from_fn_with_state(state.clone(), admission))
        .layer(middleware::from_fn(cors));
    Router::new()
        .route("/health", health_route)
        .with_state(state)
        .merge(routes)
        .layer(middleware::from_fn(observability::http))
}
