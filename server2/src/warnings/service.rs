//! Serving: `/v000903/kma/special` and `specialInfo` from memory, then durable S3 catalogs.
use super::{
    records::Bulletin,
    special,
    store::WarningStore,
    zones::{SpecialInfo, Town, ZoneState, ZoneTable, special_info_for},
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
    /// Zone state rebuild interval.
    pub zone_refresh: Duration,
    /// Whole-request S3 budget.
    pub deadline: Duration,
}
impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            refresh: Duration::from_secs(30),
            stale: Duration::from_secs(300),
            zone_refresh: Duration::from_secs(300),
            deadline: Duration::from_secs(5),
        }
    }
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
    zones: Mutex<Option<Cached<Arc<ZoneState>>>>,
}
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
            zones: Mutex::new(None),
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
        *self.zones.lock().await = None;
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
    async fn zone_state(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Arc<ZoneState>, ServeError> {
        let mut memory = self.zones.lock().await;
        if let Some(c) = memory.as_ref()
            && c.at.elapsed() < self.config.zone_refresh
        {
            return Ok(c.value.clone());
        }
        match self.store.zone_state(now_ms, deadline).await {
            Ok(state) => {
                let state = Arc::new(state);
                *memory = Some(Cached {
                    value: state.clone(),
                    at: Instant::now(),
                });
                Ok(state)
            }
            Err(e) => match memory.as_ref() {
                Some(c) if c.at.elapsed() < self.config.zone_refresh + self.config.stale => {
                    Ok(c.value.clone())
                }
                _ => Err(ServeError::Storage(e)),
            },
        }
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
