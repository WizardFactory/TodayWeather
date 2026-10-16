//! Staged public gateway: explicit legacy/native switches, owned deadlines and wire parity.
pub mod backend;
pub mod input;
pub mod metrics;
pub mod response;
use crate::geocode::GeoClient;
use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{Method, StatusCode},
    response::Response,
};
pub use backend::{BackendDispatcher, BackendHandler, BackendMode, Family, LegacyGeocoder};
pub use response::OrderedJson;
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::Instant,
};
/// Original public gateway deadline; a deadline expiry answers the legacy `501`.
pub const PUBLIC_DEADLINE: Duration = Duration::from_secs(9);
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Version {
    V000901,
    V000902,
    V000903,
}
impl Version {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "v000901" => Some(Self::V000901),
            "v000902" => Some(Self::V000902),
            "v000903" => Some(Self::V000903),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::V000901 => "v000901",
            Self::V000902 => "v000902",
            Self::V000903 => "v000903",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GatewayError {
    BadRequest,
    NotFound,
    Provider,
    Unavailable(u64),
    InvalidConfiguration,
}
impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::BadRequest => "invalid gateway input",
            Self::NotFound => "gateway route not found",
            Self::Provider => "gateway dependency unavailable",
            Self::Unavailable(_) => "gateway capacity unavailable",
            Self::InvalidConfiguration => "invalid gateway configuration",
        })
    }
}
impl std::error::Error for GatewayError {}
pub trait Geocoder: Send + Sync {
    fn coord(&self, loc: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>>;
    fn addr(&self, address: String, lang: String)
    -> BoxFuture<'_, Result<GeoClient, GatewayError>>;
}
impl Geocoder for crate::geocode::Geocoder {
    fn coord(&self, loc: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            crate::geocode::Geocoder::coord(self, loc, &lang)
                .await
                .map_err(map_geocode_error)
        })
    }
    fn addr(
        &self,
        address: String,
        lang: String,
    ) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            crate::geocode::Geocoder::addr(self, &address, &lang)
                .await
                .map_err(map_geocode_error)
        })
    }
}
fn map_geocode_error(error: crate::geocode::GeocodeError) -> GatewayError {
    match error {
        crate::geocode::GeocodeError::Capacity => GatewayError::Unavailable(5),
        _ => GatewayError::Provider,
    }
}
#[derive(Clone)]
pub struct Gateway {
    inner: Arc<Inner>,
    /// S17b: listed legacy direct routes, answered before the gateway routes.
    direct: Option<Arc<crate::api::DirectRoutes>>,
}
struct Inner {
    geocoder: Arc<dyn Geocoder>,
    backends: BackendDispatcher,
    slots: Arc<Semaphore>,
    limit: usize,
    deadline: Duration,
}
impl Gateway {
    pub fn new(geocoder: Arc<dyn Geocoder>, backends: BackendDispatcher) -> Self {
        Self {
            inner: Arc::new(Inner {
                geocoder,
                backends,
                slots: Arc::new(Semaphore::new(40)),
                limit: 40,
                deadline: PUBLIC_DEADLINE,
            }),
            direct: None,
        }
    }
    /// S17b: serve the listed legacy direct routes (`SERVER2_NATIVE_FAMILIES`) beside the gateway.
    pub fn with_direct(mut self, direct: Arc<crate::api::DirectRoutes>) -> Self {
        self.direct = Some(direct);
        self
    }
    /// Smaller isolated limits exercise overload and deadlines without widening production caps.
    pub fn with_limits(
        geocoder: Arc<dyn Geocoder>,
        backends: BackendDispatcher,
        limit: usize,
        deadline: Duration,
    ) -> Result<Self, GatewayError> {
        if limit == 0 || limit > 40 || deadline.is_zero() || deadline > PUBLIC_DEADLINE {
            return Err(GatewayError::InvalidConfiguration);
        }
        Ok(Self {
            inner: Arc::new(Inner {
                geocoder,
                backends,
                slots: Arc::new(Semaphore::new(limit)),
                limit,
                deadline,
            }),
            direct: None,
        })
    }
    pub fn inflight(&self) -> usize {
        self.inner.limit - self.inner.slots.available_permits()
    }
    pub fn router(self) -> Router {
        Router::new().fallback(move |request: Request| {
            let gateway = self.clone();
            async move { gateway.handle(request).await }
        })
    }
    /// Records aggregate outcome counters around the unchanged request contract.
    pub async fn handle(&self, request: Request<Body>) -> Response {
        if let Some(direct) = &self.direct
            && direct.claims(request.method(), request.uri().path())
        {
            // Direct routes are not gateway requests: no gateway counters or admission.
            return direct.handle(request).await;
        }
        let outcome = metrics::Outcome::start();
        let response = self.respond(request).await;
        outcome.finish(response.status().as_u16());
        response
    }
    async fn respond(&self, request: Request<Body>) -> Response {
        let method = request.method().clone();
        let headers = request.headers().clone();
        if method == Method::OPTIONS {
            return response::preflight(&headers);
        }
        if method != Method::GET && method != Method::HEAD {
            return response::error(&method, &headers, GatewayError::NotFound);
        }
        let route = match input::route(request.uri().path()) {
            Ok(route) => route,
            Err(error) => return response::error(&method, &headers, error),
        };
        let lang = input::language(headers.get("accept-language").and_then(|v| v.to_str().ok()));
        let query = input::build_query(&request.uri().to_string());
        let owner = match self.inner.slots.clone().try_acquire_owned() {
            Ok(owner) => Arc::new(owner),
            Err(_) => return response::error(&method, &headers, GatewayError::Unavailable(5)),
        };
        let inner = self.inner.clone();
        let deadline = Instant::now() + inner.deadline;
        // The spawned owner survives a disconnected waiter; all owned IO shares its deadline.
        let owned = metrics::Owned::start();
        let task = tokio::spawn(async move {
            let _owned = owned;
            let _owner = owner.clone();
            tokio::time::timeout_at(deadline, inner.process(route, lang, query, deadline, owner))
                .await
                .map_err(|_| GatewayError::Provider)?
        });
        match task.await {
            Ok(Ok((bytes, max_age, tag))) => response::send_tagged(
                &method,
                &headers,
                StatusCode::OK,
                bytes,
                Some(max_age),
                None,
                tag,
            ),
            Ok(Err(error)) => response::error(&method, &headers, error),
            Err(_) => response::error(&method, &headers, GatewayError::Provider),
        }
    }
}
impl Inner {
    async fn process(
        &self,
        route: input::Route,
        lang: String,
        query: String,
        deadline: Instant,
        owner: Arc<OwnedSemaphorePermit>,
    ) -> Result<(Vec<u8>, u32, String), GatewayError> {
        let (value, max_age) = self
            .result(route, lang, query, deadline, owner.clone())
            .await?;
        let (bytes, tag) = self.backends.encode(value, deadline, owner).await?;
        Ok((bytes, max_age, tag))
    }
    async fn result(
        &self,
        route: input::Route,
        lang: String,
        query: String,
        deadline: Instant,
        owner: Arc<OwnedSemaphorePermit>,
    ) -> Result<(OrderedJson, u32), GatewayError> {
        match route {
            input::Route::Coord(loc) => Ok((
                OrderedJson::from_serde(&self.geocoder.coord(loc, lang).await?)?,
                2_592_000,
            )),
            input::Route::Address(address) => Ok((
                OrderedJson::from_serde(&self.geocoder.addr(address, lang).await?)?,
                2_592_000,
            )),
            input::Route::Weather(version, loc) => {
                let geo = self.geocoder.coord(loc, lang.clone()).await?;
                let (family, mut path) = backend::backend_path(version, &geo)?;
                path.push_str(&query);
                let mut value = self
                    .backends
                    .fetch(version, family, path, lang, deadline, owner)
                    .await?;
                value.merge_geo(&OrderedJson::from_serde(&geo)?);
                Ok((value, 300))
            }
        }
    }
}

pub mod runtime;
