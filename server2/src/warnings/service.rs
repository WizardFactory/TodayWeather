//! Serving: `/v000903/kma/special` and `specialInfo` from memory, then durable S3 catalogs.
use super::{
    records::Bulletin,
    special,
    store::WarningStore,
    zones::{SpecialInfo, Town, ZoneState, ZoneTable, prepare_events, special_info_for},
};
use crate::{
    budget::Clock,
    gateway::{OrderedJson, response},
    storage::{CatalogTransport, Error},
};
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

#[derive(Clone, Debug)]
pub struct ServiceConfig {
    /// A memory result younger than this is served without an S3 read.
    pub refresh: Duration,
    /// A memory result younger than this is served when the S3 refresh fails.
    pub stale: Duration,
    /// Zone state refresh interval (re-reads the last 60 KST days).
    pub zone_refresh: Duration,
    /// Full zone replay interval (seed plus every published day since it).
    pub zone_full: Duration,
    /// Budget of one owned zone refresh task, independent of the waiting request.
    pub zone_deadline: Duration,
    /// Whole-request S3 budget.
    pub deadline: Duration,
}
impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            refresh: Duration::from_secs(30),
            stale: Duration::from_secs(300),
            zone_refresh: Duration::from_secs(300),
            zone_full: Duration::from_secs(24 * 3600),
            zone_deadline: Duration::from_secs(30),
            deadline: Duration::from_secs(5),
        }
    }
}
struct ZoneCache {
    state: Arc<ZoneState>,
    at: Instant,
    full_at: Instant,
}
#[derive(Clone)]
struct Cached<V> {
    value: V,
    at: Instant,
}
pub struct WarningService<T> {
    store: Arc<WarningStore<T>>,
    clock: Arc<dyn Clock>,
    config: ServiceConfig,
    latest: Mutex<HashMap<u8, Cached<Option<Bulletin>>>>,
    zones: ZoneSlot,
    zone_refresh: Arc<Mutex<()>>,
}
type ZoneSlot = Arc<std::sync::Mutex<Option<ZoneCache>>>;
/// Failures keep the legacy 501 contract; `Empty` is legacy `data is empty`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServeError {
    Empty,
    Storage(Error),
    Clock,
}
impl ServeError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Empty => "data is empty",
            Self::Storage(_) | Self::Clock => "warning storage unavailable",
        }
    }
}
impl<T: CatalogTransport> WarningService<T> {
    pub fn new(store: Arc<WarningStore<T>>, clock: Arc<dyn Clock>, config: ServiceConfig) -> Self {
        Self {
            store,
            clock,
            config,
            latest: Mutex::new(HashMap::new()),
            zones: Arc::new(std::sync::Mutex::new(None)),
            zone_refresh: Arc::new(Mutex::new(())),
        }
    }
    pub fn store(&self) -> &Arc<WarningStore<T>> {
        &self.store
    }
    fn now_ms(&self) -> Result<i64, ServeError> {
        self.clock.now_ms().map_err(|_| ServeError::Clock)
    }
    /// Drop memory results (tests and replacement simulation).
    pub async fn clear_memory(&self) {
        self.latest.lock().await.clear();
        *self.zones.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    async fn latest_of(
        &self,
        kind: u8,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Option<Bulletin>, ServeError> {
        let mut memory = self.latest.lock().await;
        let cached = memory.get(&kind).cloned();
        if let Some(c) = &cached
            && c.at.elapsed() < self.config.refresh
        {
            return Ok(c.value.clone());
        }
        // A refresh only walks partitions at or above the cached one.
        let floor = cached
            .as_ref()
            .and_then(|c| c.value.as_ref())
            .filter(|_| kind != 4)
            .map(Bulletin::date);
        match self.store.latest(kind, now_ms, floor, deadline).await {
            Ok(found) => {
                // A refreshed walk that stopped at the floor cannot lose the cached result.
                let value = found.or_else(|| {
                    cached
                        .as_ref()
                        .and_then(|c| c.value.clone())
                        .filter(|_| kind != 4)
                });
                memory.insert(
                    kind,
                    Cached {
                        value: value.clone(),
                        at: Instant::now(),
                    },
                );
                Ok(value)
            }
            Err(e) => match cached {
                Some(c) if c.at.elapsed() < self.config.stale => Ok(c.value),
                _ => Err(ServeError::Storage(e)),
            },
        }
    }
    /// Latest bulletins of types 1-4 (type 4 already filtered by the +19 h rule).
    pub async fn latest(&self) -> Result<Vec<(u8, Option<Bulletin>)>, ServeError> {
        let now_ms = self.now_ms()?;
        let deadline = Instant::now() + self.config.deadline;
        let mut out = Vec::new();
        for kind in special::ORDER {
            let found = self.latest_of(kind, now_ms, deadline).await?;
            if kind != 4 && found.is_none() {
                return Err(ServeError::Empty);
            }
            out.push((kind, found));
        }
        Ok(out)
    }
    /// The `/v000903/kma/special` JSON list.
    pub async fn special(&self, korean: bool) -> Result<OrderedJson, ServeError> {
        let latest = self.latest().await?;
        let now_ms = self.now_ms()?;
        Ok(special::current(&latest, now_ms, korean))
    }
    /// Valid zone memory for the outage fallback (younger than refresh + stale).
    fn zone_memory(
        zones: &ZoneSlot,
        config: &ServiceConfig,
        fresh: bool,
    ) -> Option<Arc<ZoneState>> {
        let memory = zones.lock().unwrap_or_else(|e| e.into_inner());
        let limit = if fresh {
            config.zone_refresh
        } else {
            config.zone_refresh + config.stale
        };
        memory
            .as_ref()
            .filter(|c| c.at.elapsed() < limit)
            .map(|c| c.state.clone())
    }
    /// Zone state through one owned single-flight refresh task: it completes and fills memory
    /// even when the waiting request reaches its deadline. Warm refreshes re-read only the days
    /// the collector can still publish; a full rebuild replays everything since the seed.
    /// Memory is readable during a refresh, so a timed-out or failed refresh still serves
    /// valid memory.
    pub(crate) async fn zone_state(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Arc<ZoneState>, ServeError> {
        if let Some(state) = Self::zone_memory(&self.zones, &self.config, true) {
            return Ok(state);
        }
        let (store, zones, refresh, config) = (
            self.store.clone(),
            self.zones.clone(),
            self.zone_refresh.clone(),
            self.config.clone(),
        );
        let task = tokio::spawn(async move {
            let _single = refresh.lock_owned().await;
            if let Some(state) = Self::zone_memory(&zones, &config, true) {
                return Ok(state);
            }
            let previous = zones
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .map(|c| (c.state.clone(), c.full_at));
            let owned = Instant::now() + config.zone_deadline;
            let refreshed = match previous {
                Some((state, full_at)) if full_at.elapsed() < config.zone_full => {
                    store.recent_zone_rows(now_ms, owned).await.map(|rows| {
                        let mut state = (*state).clone();
                        state.apply(&prepare_events(&rows));
                        (state, full_at)
                    })
                }
                _ => store
                    .zone_state(now_ms, owned)
                    .await
                    .map(|state| (state, Instant::now())),
            };
            let (state, full_at) = refreshed.map_err(ServeError::Storage)?;
            let state = Arc::new(state);
            *zones.lock().unwrap_or_else(|e| e.into_inner()) = Some(ZoneCache {
                state: state.clone(),
                at: Instant::now(),
                full_at,
            });
            Ok(state)
        });
        let result = match tokio::time::timeout_at(deadline, task).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(ServeError::Storage(Error::Transport)),
            Err(_) => Err(ServeError::Storage(Error::Timeout)),
        };
        result.or_else(|e| Self::zone_memory(&self.zones, &self.config, false).ok_or(e))
    }
    /// `getSpecialInfo(town)`: active warnings of the town's zones, legacy order.
    pub async fn special_info(&self, town: &Town) -> Result<Vec<SpecialInfo>, ServeError> {
        let now_ms = self.now_ms()?;
        let table = ZoneTable::shared(now_ms);
        let codes = table.zones_for_town(town);
        if codes.is_empty() {
            return Ok(vec![]);
        }
        let deadline = Instant::now() + self.config.deadline;
        let state = self.zone_state(now_ms, deadline).await?;
        Ok(special_info_for(table, state.entries(), &codes))
    }
    /// Legacy route matching: Express is case-insensitive and non-strict about one trailing slash.
    pub fn matches(path: &str) -> bool {
        let p = path.strip_suffix('/').unwrap_or(path);
        p.eq_ignore_ascii_case("/v000903/kma/special")
    }
    /// `GET|HEAD /v000903/kma/special`; `None` when the request is not this route.
    pub async fn handle(
        &self,
        method: &Method,
        path: &str,
        headers: &HeaderMap,
    ) -> Option<Response> {
        if (*method != Method::GET && *method != Method::HEAD) || !Self::matches(path) {
            return None;
        }
        let text = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        let korean = special::locale(text("accept-language"), text("cookie")) == "ko";
        Some(match self.special(korean).await {
            Ok(list) => response::send(
                method,
                headers,
                StatusCode::OK,
                list.to_bytes(),
                Some(300),
                None,
            ),
            Err(e) => error(method, headers, e.message()),
        })
    }
}
/// `res.status(501).send(err.message)`: Express HTML string response.
fn error(method: &Method, request: &HeaderMap, message: &str) -> Response {
    let mut r = response::send(
        method,
        request,
        StatusCode::NOT_IMPLEMENTED,
        message.as_bytes().to_vec(),
        None,
        None,
    );
    let h = r.headers_mut();
    h.remove("cache-control");
    h.insert(
        "content-type",
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    r
}
/// A loopback-only router for local verification of the native route.
pub fn router<T: CatalogTransport>(service: Arc<WarningService<T>>) -> axum::Router {
    axum::Router::new().fallback(move |request: Request| {
        let service = service.clone();
        async move {
            let (method, path, headers) = (
                request.method().clone(),
                request.uri().path().to_owned(),
                request.headers().clone(),
            );
            match service.handle(&method, &path, &headers).await {
                Some(r) => r,
                None => {
                    let mut r = Response::new(Body::from("Not Found"));
                    *r.status_mut() = StatusCode::NOT_FOUND;
                    r
                }
            }
        }
    })
}
pub fn special_info_json(list: &[SpecialInfo]) -> OrderedJson {
    OrderedJson::Array(list.iter().map(SpecialInfo::to_json).collect())
}
