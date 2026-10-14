//! Explicit legacy HTTP hops and per-family/version switches.
use super::{
    BoxFuture, GatewayError, Geocoder, Version, input,
    response::{OrderedJson, js_number},
};
use crate::geocode::GeoClient;
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::Instant,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Family {
    Kma,
    Dsf,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackendMode {
    Legacy,
    Native,
}
/// A native handler's answer: a served body, or a decision to use the legacy hop instead.
pub enum Native {
    Served(OrderedJson),
    Forward,
}
pub trait BackendHandler: Send + Sync {
    fn fetch(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>>;
    /// S15: a handler that cannot supply complete inputs may forward to legacy. The default
    /// serves `fetch` and never forwards.
    fn fetch_or_forward(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Native, GatewayError>> {
        Box::pin(async move { self.fetch(path, lang, deadline).await.map(Native::Served) })
    }
}
#[derive(Clone)]
struct Http {
    base: String,
    client: reqwest::Client,
}
impl Http {
    fn new(base: &str) -> Result<Self, GatewayError> {
        let url = reqwest::Url::parse(base).map_err(|_| GatewayError::InvalidConfiguration)?;
        let loopback = url
            .host_str()
            .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback());
        if !matches!(url.scheme(), "http" | "https")
            || (url.scheme() == "http" && !loopback)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || url.host_str().is_none()
        {
            return Err(GatewayError::InvalidConfiguration);
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .pool_idle_timeout(Duration::from_secs(4))
            .pool_max_idle_per_host(40)
            .build()
            .map_err(|_| GatewayError::InvalidConfiguration)?;
        Ok(Self {
            base: url.as_str().trim_end_matches('/').into(),
            client,
        })
    }
    async fn get(
        &self,
        path: &str,
        lang: &str,
        timeout: Duration,
        max: usize,
    ) -> Result<(u16, Vec<u8>), GatewayError> {
        let mut response = self
            .client
            .get(format!("{}{path}", self.base))
            .header("accept-language", lang)
            .header("accept", "application/json")
            .timeout(timeout)
            .send()
            .await
            .map_err(|_| GatewayError::Provider)?;
        let status = response.status().as_u16();
        if response.content_length().is_some_and(|n| n > max as u64) {
            return Err(GatewayError::Provider);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| GatewayError::Provider)? {
            if bytes.len().saturating_add(chunk.len()) > max {
                return Err(GatewayError::Provider);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok((status, bytes))
    }
}
/// Public legacy geocode remains the default until native quota/privacy gates are accepted.
pub struct LegacyGeocoder {
    http: Http,
}
impl LegacyGeocoder {
    pub fn new(base: &str) -> Result<Self, GatewayError> {
        Ok(Self {
            http: Http::new(base)?,
        })
    }
}
impl Geocoder for LegacyGeocoder {
    fn coord(&self, loc: [f64; 2], lang: String) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            self.lookup(
                format!(
                    "/geocode/v000903/coord/{},{}",
                    js_number(loc[0]),
                    js_number(loc[1])
                ),
                lang,
            )
            .await
        })
    }
    fn addr(
        &self,
        address: String,
        lang: String,
    ) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
        Box::pin(async move {
            self.lookup(
                format!("/geocode/v000903/addr/{}", input::encode(&address)),
                lang,
            )
            .await
        })
    }
}
impl LegacyGeocoder {
    async fn lookup(&self, path: String, lang: String) -> Result<GeoClient, GatewayError> {
        super::metrics::add(&super::metrics::COUNTERS.legacy_geocode_attempts);
        let (status, body) = self
            .http
            .get(&path, &lang, Duration::from_secs(5), 256 * 1024)
            .await?;
        if status != 200 {
            return Err(GatewayError::Provider);
        }
        serde_json::from_slice(&body).map_err(|_| GatewayError::Provider)
    }
}
struct Switch {
    mode: BackendMode,
    native: Option<Arc<dyn BackendHandler>>,
}
#[derive(Clone)]
pub struct BackendDispatcher {
    http: Http,
    switches: Arc<RwLock<HashMap<(Version, Family), Switch>>>,
    cpu: Arc<Semaphore>,
}
impl BackendDispatcher {
    pub fn legacy(base: &str) -> Result<Self, GatewayError> {
        Ok(Self {
            http: Http::new(base)?,
            switches: Arc::new(RwLock::new(HashMap::new())),
            cpu: Arc::new(Semaphore::new(2)),
        })
    }
    pub fn with_native(
        self,
        version: Version,
        family: Family,
        handler: Arc<dyn BackendHandler>,
    ) -> Self {
        self.register_native(version, family, handler);
        self
    }
    pub fn register_native(
        &self,
        version: Version,
        family: Family,
        handler: Arc<dyn BackendHandler>,
    ) {
        self.switches
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .entry((version, family))
            .and_modify(|s| s.native = Some(handler.clone()))
            .or_insert(Switch {
                mode: BackendMode::Legacy,
                native: Some(handler),
            });
    }
    pub fn set_backend(
        &self,
        version: Version,
        family: Family,
        mode: BackendMode,
    ) -> Result<(), GatewayError> {
        let mut switches = self.switches.write().unwrap_or_else(|e| e.into_inner());
        let switch = switches.entry((version, family)).or_insert(Switch {
            mode: BackendMode::Legacy,
            native: None,
        });
        if mode == BackendMode::Native && switch.native.is_none() {
            return Err(GatewayError::InvalidConfiguration);
        }
        switch.mode = mode;
        Ok(())
    }
    pub fn mode(&self, version: Version, family: Family) -> BackendMode {
        self.switches
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&(version, family))
            .map_or(BackendMode::Legacy, |s| s.mode)
    }
    pub(crate) async fn encode(
        &self,
        value: OrderedJson,
        deadline: Instant,
        owner: Arc<OwnedSemaphorePermit>,
    ) -> Result<(Vec<u8>, String), GatewayError> {
        let cpu = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| GatewayError::Provider)?
            .map_err(|_| GatewayError::Provider)?;
        tokio::task::spawn_blocking(move || {
            let _cpu = cpu;
            let _owner = owner;
            let bytes = value.to_bytes();
            let tag = super::response::etag(&bytes);
            (bytes, tag)
        })
        .await
        .map_err(|_| GatewayError::Provider)
    }
    pub(crate) async fn fetch(
        &self,
        version: Version,
        family: Family,
        path: String,
        lang: String,
        deadline: Instant,
        owner: Arc<OwnedSemaphorePermit>,
    ) -> Result<OrderedJson, GatewayError> {
        let native = {
            let switches = self.switches.read().unwrap_or_else(|e| e.into_inner());
            switches
                .get(&(version, family))
                .filter(|s| s.mode == BackendMode::Native)
                .and_then(|s| s.native.clone())
        };
        if let Some(native) = native {
            let attempt_deadline = deadline.min(Instant::now() + Duration::from_secs(3));
            match tokio::time::timeout_at(
                attempt_deadline,
                native.fetch_or_forward(path.clone(), lang.clone(), attempt_deadline),
            )
            .await
            .map_err(|_| GatewayError::Provider)??
            {
                Native::Served(value) => return Ok(value),
                // S15: forwarded requests take the unchanged legacy hop on the remaining deadline.
                Native::Forward => (),
            }
        }
        for attempt in 0..3 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(GatewayError::Provider);
            }
            super::metrics::add(&super::metrics::COUNTERS.backend_attempts);
            let result = self
                .http
                .get(
                    &path,
                    &lang,
                    remaining.min(Duration::from_secs(3)),
                    6 * 1024 * 1024,
                )
                .await;
            let (status, bytes) = match result {
                Ok(value) => value,
                Err(error) => {
                    if attempt < 2 {
                        continue;
                    }
                    return Err(error);
                }
            };
            // The permit travels into blocking parsing, so timeout cannot release its owner early.
            let cpu = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
                .await
                .map_err(|_| GatewayError::Provider)?
                .map_err(|_| GatewayError::Provider)?;
            let lease = owner.clone();
            let value = tokio::task::spawn_blocking(move || {
                let _cpu = cpu;
                let _owner = lease;
                OrderedJson::parse(&bytes)
            })
            .await
            .map_err(|_| GatewayError::Provider)?;
            if status == 503
                && let Ok(ref value) = value
                && value.get("code").and_then(OrderedJson::string).as_deref()
                    == Some("EWEATHERUNAVAILABLE")
                && let Some(at) = value
                    .get("retryAt")
                    .and_then(OrderedJson::number)
                    .filter(|n| n.is_finite() && *n > 0.)
            {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|_| GatewayError::Provider)?
                    .as_secs_f64()
                    * 1000.;
                let seconds = ((at - now) / 1000.).floor().clamp(1., 3600.) as u64;
                return Err(GatewayError::Unavailable(seconds));
            }
            if status >= 500 && attempt < 2 {
                continue;
            }
            if status != 200 {
                return Err(GatewayError::Provider);
            }
            let value = value?;
            return if value.is_container() {
                Ok(value)
            } else {
                Err(GatewayError::Provider)
            };
        }
        Err(GatewayError::Provider)
    }
}
pub(crate) fn backend_path(
    version: Version,
    geo: &GeoClient,
) -> Result<(Family, String), GatewayError> {
    if geo.country.as_deref() == Some("KR") {
        let kma = geo
            .kma_address
            .as_ref()
            .filter(|a| !a.name1.is_empty())
            .ok_or(GatewayError::Provider)?;
        let mut path = format!(
            "/{}/kma/addr/{}",
            version.as_str(),
            input::encode(&kma.name1)
        );
        for part in [&kma.name2, &kma.name3]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
        {
            path.push('/');
            path.push_str(&input::encode(part));
        }
        Ok((Family::Kma, path))
    } else {
        let loc = geo.location.as_ref().ok_or(GatewayError::Provider)?;
        if !loc.lat.is_finite() || !loc.long.is_finite() {
            return Err(GatewayError::Provider);
        }
        Ok((
            Family::Dsf,
            format!(
                "/{}/dsf/coord/{},{}",
                version.as_str(),
                js_number(loc.lat),
                js_number(loc.long)
            ),
        ))
    }
}
