//! Provider parity with owned work, bounded volatile reverse caching and funded acquisition.
pub mod budget;
mod cache;
mod format;
mod provider;
pub mod storage;
use cache::{LookupKey, MemoryCache};
pub use format::{is_korea_area, language_from_header, normalize_loc};
use provider::Outcome;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, watch},
    time::Instant,
};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeocodeError {
    Provider,
    Capacity,
    InvalidConfiguration,
    Quota,
}
impl std::fmt::Display for GeocodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Provider => "geocode provider unavailable",
            Self::Capacity => "geocode capacity exhausted",
            Self::InvalidConfiguration => "invalid geocode configuration",
            Self::Quota => "geocode quota unavailable",
        })
    }
}
impl std::error::Error for GeocodeError {}
/// Deliberately has no Debug: a client result can contain a precise coordinate.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeoClient {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kma_address: Option<KmaAddress>,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Location {
    #[serde(serialize_with = "serialize_coordinate")]
    pub lat: f64,
    #[serde(serialize_with = "serialize_coordinate")]
    pub long: f64,
}
fn serialize_coordinate<S: serde::Serializer>(
    value: &f64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}
impl From<[f64; 2]> for Location {
    fn from(value: [f64; 2]) -> Self {
        Self {
            lat: value[0],
            long: value[1],
        }
    }
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KmaAddress {
    pub name1: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name3: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeoProvider {
    Kakao,
    Google,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProviderDemand {
    pub provider: GeoProvider,
    pub key_index: usize,
    pub attempts: u32,
}
/// Reserve and consume the maximum possible owner chain before the first HTTP attempt.
/// Unused units remain consumed: waiter cancellation and key rotation never refund or re-reserve.
pub trait Quota: Send + Sync {
    fn reserve(&self, demands: Vec<ProviderDemand>) -> BoxFuture<'_, Result<(), GeocodeError>>;
}
struct DenyQuota;
impl Quota for DenyQuota {
    fn reserve(&self, _: Vec<ProviderDemand>) -> BoxFuture<'_, Result<(), GeocodeError>> {
        Box::pin(async { Err(GeocodeError::Quota) })
    }
}
/// Safe address-only persistence projection; reverse lookups never call AddressStore.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddressProjection {
    pub geo: GeoClient,
    pub updated_unix_ms: u64,
}
impl AddressProjection {
    pub fn valid(&self, now: u64) -> bool {
        self.geo.name.is_none()
            && self.geo.kma_address.is_none()
            && self.geo.location.as_ref().is_some_and(|v| {
                v.lat.is_finite()
                    && v.long.is_finite()
                    && (-90.0..=90.0).contains(&v.lat)
                    && (-180.0..=180.0).contains(&v.long)
            })
            && cache::fresh(self.updated_unix_ms, now)
            && serde_json::to_vec(self).is_ok_and(|v| v.len() <= cache::PROJECTION_BYTES)
    }
}
pub trait AddressStore: Send + Sync {
    fn get<'a>(
        &'a self,
        address: &'a str,
    ) -> BoxFuture<'a, Result<Option<AddressProjection>, GeocodeError>>;
    fn put<'a>(
        &'a self,
        address: &'a str,
        projection: &'a AddressProjection,
    ) -> BoxFuture<'a, Result<(), GeocodeError>>;
}
/// Production endpoint roots (legacy `kakao.js` / `google.js` defaults).
pub const KAKAO_ENDPOINT: &str = "https://dapi.kakao.com";
pub const GOOGLE_ENDPOINT: &str = "https://maps.googleapis.com";
/// Existing environment is injected by the operator; no legacy file is read.
/// Keys and configuration deliberately have no Debug implementation.
pub struct GeocoderConfig {
    pub kakao_base_url: String,
    pub google_base_url: String,
    pub kakao_keys: Vec<String>,
    pub google_key: Option<String>,
    pub cache_bytes: usize,
    pub max_owners: usize,
}
impl Default for GeocoderConfig {
    fn default() -> Self {
        Self {
            kakao_base_url: KAKAO_ENDPOINT.into(),
            google_base_url: GOOGLE_ENDPOINT.into(),
            kakao_keys: Vec::new(),
            google_key: None,
            cache_bytes: 4 * 1024 * 1024,
            max_owners: 40,
        }
    }
}
impl GeocoderConfig {
    /// The existing legacy key names `GEOCODER_KAKAO_KEYS` (JSON array) and
    /// `GEOCODER_GOOGLE_KEY` at the production endpoints. S10e: the endpoints are built in;
    /// legacy's test-only `GEOCODER_*_BASE_URL` overrides are not read.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, GeocodeError> {
        Self::from_vars_at(var, KAKAO_ENDPOINT, GOOGLE_ENDPOINT)
    }
    /// [`GeocoderConfig::from_vars`] at other endpoints (tests: loopback test peers).
    pub fn from_vars_at(
        var: &dyn Fn(&str) -> Option<String>,
        kakao_base_url: &str,
        google_base_url: &str,
    ) -> Result<Self, GeocodeError> {
        let mut config = Self {
            kakao_base_url: kakao_base_url.into(),
            google_base_url: google_base_url.into(),
            ..Self::default()
        };
        if let Some(value) = var("GEOCODER_KAKAO_KEYS") {
            config.kakao_keys = legacy_kakao_keys(&value);
        }
        config.google_key = var("GEOCODER_GOOGLE_KEY").filter(|v| !v.is_empty());
        config.validate()?;
        Ok(config)
    }
    fn validate(&mut self) -> Result<(), GeocodeError> {
        if self.cache_bytes == 0
            || self.cache_bytes > 64 * 1024 * 1024
            || !(1..=40).contains(&self.max_owners)
            || self.kakao_keys.len() > 16
            || self
                .kakao_keys
                .iter()
                .any(|v| v.is_empty() || v.len() > 512)
            || self
                .google_key
                .as_ref()
                .is_some_and(|v| v.is_empty() || v.len() > 512)
        {
            return Err(GeocodeError::InvalidConfiguration);
        }
        self.kakao_base_url =
            endpoint_root(&self.kakao_base_url).ok_or(GeocodeError::InvalidConfiguration)?;
        self.google_base_url =
            endpoint_root(&self.google_base_url).ok_or(GeocodeError::InvalidConfiguration)?;
        // Legacy `keys.googleKey`: against the production Google endpoint only the allowed key
        // (fingerprint `ecd5fdb1`) is used; legacy skips the check only for a test endpoint.
        if self.google_base_url == GOOGLE_ENDPOINT
            && let Some(key) = &self.google_key
        {
            use sha2::{Digest, Sha256};
            let digest = Sha256::digest(key.as_bytes());
            if digest[..4] != [0xec, 0xd5, 0xfd, 0xb1] {
                self.google_key = None;
            }
        }
        Ok(())
    }
}
/// Legacy `lib/geocoder/keys.parseKeys` (S10e: the same values as legacy): a JSON array; its
/// nonempty strings in order. Unparseable or non-array values and other elements give no key.
fn legacy_kakao_keys(value: &str) -> Vec<String> {
    match serde_json::from_str::<serde_json::Value>(value) {
        Ok(serde_json::Value::Array(items)) => items
            .into_iter()
            .filter_map(|item| match item {
                serde_json::Value::String(key) if !key.is_empty() => Some(key),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}
/// The transport rule: HTTPS, or plain HTTP only to a loopback address; a root path and no
/// credentials, query or fragment. Returns the normalized root without its trailing slash.
fn endpoint_root(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    let loopback = url
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    let accepted = (url.scheme() == "https" || (url.scheme() == "http" && loopback))
        && url.host_str().is_some_and(|h| !h.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/";
    accepted.then(|| url.as_str().trim_end_matches('/').to_owned())
}
#[derive(Clone)]
pub struct Geocoder {
    inner: Arc<Inner>,
}
type Flight = watch::Receiver<Option<Result<GeoClient, GeocodeError>>>;
struct Inner {
    config: GeocoderConfig,
    client: reqwest::Client,
    quota: Arc<dyn Quota>,
    address_store: Option<Arc<dyn AddressStore>>,
    cache: MemoryCache,
    flights: Mutex<HashMap<LookupKey, Flight>>,
    owners: Arc<Semaphore>,
    rotation: AtomicUsize,
}
/// Cleanup runs on success, timeout and unwinding, without retaining a dead receiver.
/// The task owns the permit through provider/cache work even if all waiters disconnect.
struct FlightGuard {
    inner: Arc<Inner>,
    key: LookupKey,
    _permit: OwnedSemaphorePermit,
}
impl Drop for FlightGuard {
    fn drop(&mut self) {
        if let Ok(mut flights) = self.inner.flights.lock() {
            flights.remove(&self.key);
        }
    }
}
impl Geocoder {
    pub fn new(mut config: GeocoderConfig) -> Result<Self, GeocodeError> {
        config.validate()?;
        let cache = MemoryCache::new(config.cache_bytes)?;
        let owners = Arc::new(Semaphore::new(config.max_owners));
        let client = reqwest::Client::builder()
            .no_proxy()
            .retry(reqwest::retry::never())
            .pool_max_idle_per_host(4)
            .pool_idle_timeout(Duration::from_secs(4))
            .no_gzip()
            .no_brotli()
            .no_zstd()
            .no_deflate()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| GeocodeError::InvalidConfiguration)?;
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                client,
                quota: Arc::new(DenyQuota),
                address_store: None,
                cache,
                flights: Mutex::new(HashMap::new()),
                owners,
                rotation: AtomicUsize::new(0),
            }),
        })
    }
    /// Builders require exclusive ownership; clone only after configuration.
    pub fn with_quota(mut self, quota: Arc<dyn Quota>) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("configure before cloning")
            .quota = quota;
        self
    }
    pub fn with_address_store(mut self, store: Arc<dyn AddressStore>) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("configure before cloning")
            .address_store = Some(store);
        self
    }
    pub fn cache_bytes(&self) -> usize {
        self.inner.cache.bytes()
    }
    pub fn active_owners(&self) -> usize {
        self.inner.config.max_owners - self.inner.owners.available_permits()
    }
    pub async fn coord(&self, loc: [f64; 2], lang: &str) -> Result<GeoClient, GeocodeError> {
        if !loc[0].is_finite()
            || !loc[1].is_finite()
            || !(-90.0..=90.0).contains(&loc[0])
            || !(-180.0..=180.0).contains(&loc[1])
            || lang.encode_utf16().count() > 64
        {
            return Err(GeocodeError::Provider);
        }
        let loc = normalize_loc(loc);
        self.lookup(LookupKey::Coord {
            lat: loc[0].to_bits(),
            lon: loc[1].to_bits(),
            language: lang.into(),
        })
        .await
    }
    pub async fn addr(&self, address: &str, _lang: &str) -> Result<GeoClient, GeocodeError> {
        if address.is_empty() || address.encode_utf16().count() > 200 {
            return Err(GeocodeError::Provider);
        }
        self.lookup(LookupKey::Address(address.into())).await
    }
    async fn lookup(&self, key: LookupKey) -> Result<GeoClient, GeocodeError> {
        use crate::gateway::metrics::{COUNTERS, add};
        if let Some(geo) = self.inner.cache.get(&key) {
            add(&COUNTERS.geocoder_cache_hits);
            return Ok(geo);
        }
        let mut receiver = {
            let mut flights = self
                .inner
                .flights
                .lock()
                .map_err(|_| GeocodeError::Capacity)?;
            // Recheck after acquiring ownership: a preceding owner may have completed between locks.
            if let Some(geo) = self.inner.cache.get(&key) {
                add(&COUNTERS.geocoder_cache_hits);
                return Ok(geo);
            }
            if let Some(receiver) = flights.get(&key) {
                add(&COUNTERS.geocoder_joined);
                receiver.clone()
            } else {
                let permit = self.inner.owners.clone().try_acquire_owned().map_err(|_| {
                    add(&COUNTERS.capacity_rejections);
                    GeocodeError::Capacity
                })?;
                add(&COUNTERS.geocoder_flights);
                let (sender, receiver) = watch::channel(None);
                flights.insert(key.clone(), receiver.clone());
                let inner = self.inner.clone();
                tokio::spawn(async move {
                    let flight = FlightGuard {
                        inner: inner.clone(),
                        key: key.clone(),
                        _permit: permit,
                    };
                    let result = tokio::time::timeout(Duration::from_secs(5), inner.acquire(&key))
                        .await
                        .unwrap_or(Err(GeocodeError::Provider));
                    if let Ok(geo) = &result {
                        let eligible = match key {
                            LookupKey::Address(_) => true,
                            LookupKey::Coord { .. } => {
                                !(geo.country.as_deref() == Some("KR") && geo.kma_address.is_none())
                            }
                        };
                        if eligible {
                            inner.cache.put(key.clone(), geo.clone());
                        }
                    }
                    drop(flight);
                    sender.send_replace(Some(result));
                });
                receiver
            }
        };
        loop {
            if let Some(value) = receiver.borrow().clone() {
                return value;
            }
            receiver
                .changed()
                .await
                .map_err(|_| GeocodeError::Provider)?;
        }
    }
}
impl Inner {
    fn demands(&self, key: &LookupKey) -> Vec<ProviderDemand> {
        let use_kakao = matches!(key, LookupKey::Address(_))
            || matches!(key,LookupKey::Coord{lat,lon,..} if is_korea_area([f64::from_bits(*lat),f64::from_bits(*lon)]));
        let mut demands = Vec::new();
        if use_kakao {
            demands.extend(
                self.config
                    .kakao_keys
                    .iter()
                    .enumerate()
                    .map(|(key_index, _)| ProviderDemand {
                        provider: GeoProvider::Kakao,
                        key_index,
                        attempts: 1,
                    }),
            );
        }
        if self.config.google_key.is_some() {
            demands.push(ProviderDemand {
                provider: GeoProvider::Google,
                key_index: 0,
                attempts: 1,
            });
        }
        demands
    }
    async fn acquire(&self, key: &LookupKey) -> Result<GeoClient, GeocodeError> {
        let deadline = Instant::now() + Duration::from_secs(5);
        if let LookupKey::Address(address) = key
            && let Some(store) = &self.address_store
            && let Ok(Some(projection)) = store.get(address).await
            && projection.valid(cache::now_ms())
            && projection.geo.address.as_deref() == Some(address)
        {
            return Ok(projection.geo);
        }
        // Every possible attempt is funded before HTTP; without a quota every lookup is denied.
        self.quota
            .reserve(self.demands(key))
            .await
            .inspect_err(|_| {
                crate::gateway::metrics::add(&crate::gateway::metrics::COUNTERS.quota_rejections)
            })?;
        match key {
            LookupKey::Coord { lat, lon, language } => {
                let loc = [f64::from_bits(*lat), f64::from_bits(*lon)];
                let geo = if is_korea_area(loc) {
                    // An outer Kakao failure is terminal; Google supplements successful partial data only.
                    let body = self.call(GeoProvider::Kakao, key, deadline).await?;
                    let mut geo = provider::kakao_coord(&body, loc)?;
                    if language != "ko" {
                        geo.name = None;
                        geo.address = None;
                    }
                    if (!present(&geo.name) || !present(&geo.address))
                        && let Ok(body) = self.call(GeoProvider::Google, key, deadline).await
                        && let Ok(new) = provider::google_coord(&body, loc)
                    {
                        merge(&mut geo, new);
                    }
                    geo
                } else {
                    let body = self.call(GeoProvider::Google, key, deadline).await?;
                    provider::google_coord(&body, loc)?
                };
                if !present(&geo.name) || !present(&geo.address) {
                    return Err(GeocodeError::Provider);
                }
                Ok(geo)
            }
            LookupKey::Address(address) => {
                let google = match self.call(GeoProvider::Google, key, deadline).await {
                    Ok(body) => provider::google_addr(&body, address),
                    Err(error) => Err(error),
                };
                let mut geo = match google {
                    Ok(geo) => geo,
                    Err(_) => {
                        let body = self.call(GeoProvider::Kakao, key, deadline).await?;
                        provider::kakao_addr(&body, address)?
                    }
                };
                if let Some(location) = &mut geo.location {
                    let loc = normalize_loc([location.lat, location.long]);
                    location.lat = loc[0];
                    location.long = loc[1];
                }
                if let Some(store) = &self.address_store {
                    let projection = AddressProjection {
                        geo: geo.clone(),
                        updated_unix_ms: cache::now_ms(),
                    };
                    if !projection.valid(cache::now_ms()) {
                        return Err(GeocodeError::Provider);
                    }
                    store.put(address, &projection).await?;
                }
                Ok(geo)
            }
        }
    }
    async fn call(
        &self,
        provider: GeoProvider,
        key: &LookupKey,
        deadline: Instant,
    ) -> Result<serde_json::Value, GeocodeError> {
        let keys: Vec<&str> = match provider {
            GeoProvider::Kakao => self.config.kakao_keys.iter().map(String::as_str).collect(),
            GeoProvider::Google => self.config.google_key.iter().map(String::as_str).collect(),
        };
        if keys.is_empty() {
            return Err(GeocodeError::Provider);
        }
        let start = self.rotation.fetch_add(1, Ordering::Relaxed) % keys.len();
        for offset in 0..keys.len() {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Err(GeocodeError::Provider);
            };
            let attempt = remaining.min(Duration::from_secs(3));
            let key_value = keys[(start + offset) % keys.len()];
            let url = self.url(provider, key, key_value);
            let counters = &crate::gateway::metrics::COUNTERS;
            crate::gateway::metrics::add(match provider {
                GeoProvider::Kakao => &counters.kakao_attempts,
                GeoProvider::Google => &counters.google_attempts,
            });
            let mut request = self.client.get(url).timeout(attempt);
            if provider == GeoProvider::Kakao {
                request = request.header(
                    reqwest::header::AUTHORIZATION,
                    format!("KakaoAK {key_value}"),
                );
            }
            let response = tokio::time::timeout(attempt, async {
                let mut response = request.send().await.map_err(|_| GeocodeError::Provider)?;
                let status = response.status().as_u16();
                let mut bytes = Vec::new();
                while let Some(chunk) =
                    response.chunk().await.map_err(|_| GeocodeError::Provider)?
                {
                    if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
                        return Err(GeocodeError::Provider);
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok((
                    status,
                    serde_json::from_slice::<serde_json::Value>(&bytes).ok(),
                ))
            })
            .await;
            if let Ok(Ok((status, body))) = response {
                match provider::classify(provider, status, body.as_ref()) {
                    Outcome::Success => return body.ok_or(GeocodeError::Provider),
                    Outcome::Terminal => return Err(GeocodeError::Provider),
                    Outcome::Rotate => {}
                }
            }
        }
        Err(GeocodeError::Provider)
    }
    fn url(&self, provider: GeoProvider, query: &LookupKey, key: &str) -> String {
        let base = match provider {
            GeoProvider::Kakao => &self.config.kakao_base_url,
            GeoProvider::Google => &self.config.google_base_url,
        };
        match (provider, query) {
            (GeoProvider::Kakao, LookupKey::Coord { lat, lon, .. }) => format!(
                "{base}/v2/local/geo/coord2regioncode.json?x={}&y={}&input_coord=WGS84",
                f64::from_bits(*lon),
                f64::from_bits(*lat)
            ),
            (GeoProvider::Kakao, LookupKey::Address(address)) => format!(
                "{base}/v2/local/search/address.json?query={}",
                encode(address)
            ),
            (GeoProvider::Google, LookupKey::Coord { lat, lon, language }) => format!(
                "{base}/maps/api/geocode/json?latlng={},{}{}&key={}",
                f64::from_bits(*lat),
                f64::from_bits(*lon),
                if language.is_empty() {
                    String::new()
                } else {
                    format!("&language={}", encode(language))
                },
                encode(key)
            ),
            (GeoProvider::Google, LookupKey::Address(address)) => format!(
                "{base}/maps/api/geocode/json?address={}&key={}",
                encode(address),
                encode(key)
            ),
        }
    }
}
fn present(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|v| !v.is_empty())
}
fn merge(old: &mut GeoClient, new: GeoClient) {
    if !present(&old.name) {
        old.name = new.name;
    }
    if !present(&old.country) {
        old.country = new.country;
    }
    if !present(&old.address) {
        old.address = new.address;
    }
    if old.location.is_none() {
        old.location = new.location;
    }
    if old.kma_address.is_none() {
        old.kma_address = new.kma_address;
    }
}
fn encode(value: &str) -> String {
    const HEX: &[u8] = b"0123456789ABCDEF";
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX[(byte >> 4) as usize]));
            out.push(char::from(HEX[(byte & 15) as usize]));
        }
    }
    out
}
