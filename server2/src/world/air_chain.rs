//! Live overseas air chain (S13a), ported from `lib/AQI/airFallback.js`,
//! `lib/air/providerChain.js`, `lib/air/providerBudget.js` (free phase) and the provider
//! adapters at 45e9193b. Provider calls are funded through S08 before HTTP and the decisive
//! body is published through S06 before it serves a request (O-9).
use super::{
    Clock,
    air::{AirOutcome, AirProvider, AirSource, Observation, usable},
    air_store::{AirCell, AirRecord, AirStore, TTL_MS},
    air_transport::{AirHttpRequest, AirTransport, valid_base},
    js::num_string,
};
use crate::{
    budget::{
        BudgetError, BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock as BudgetClock,
    },
    gateway::BoxFuture,
    storage::WriteCondition,
};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering::Relaxed},
    },
    time::Duration,
};
use tokio::{
    sync::{Mutex as AsyncMutex, watch},
    time::{Instant, timeout},
};

/// Legacy `FAILURE_CACHE_TTL_MS`.
const FAILURE_TTL_MS: f64 = 2. * 60_000.;
/// Legacy `DOWN_MS` after an auth or quota rejection.
const DOWN_MS: f64 = 10. * 60_000.;

/// One provider's endpoint root, credential and S08 monthly funding (operator configuration).
#[derive(Clone)]
pub struct AirProviderConfig {
    /// HTTPS root (or literal loopback HTTP), for example `https://api.waqi.info/`.
    pub base_url: String,
    /// Secret; legacy `isValidKey` (>= 10 characters, not the placeholder) decides configured.
    pub key: String,
    /// S08 quota owner (64 lowercase hex).
    pub quota_id: String,
    /// Units per UTC month (legacy free caps less the 5 % reserve: Google 9,500,
    /// OpenWeather 950,000; WAQI had none and needs an operator ceiling).
    pub monthly_units: u64,
    pub block_units: u64,
}
#[derive(Clone)]
pub struct AirConfig {
    pub google: Option<AirProviderConfig>,
    pub openweather: Option<AirProviderConfig>,
    pub waqi: Option<AirProviderConfig>,
    /// Legacy `AIR_PROVIDER_TIMEOUT_MS` (3 s).
    pub provider_timeout: Duration,
    /// Legacy `AIR_OWM_MINUTE_CAP` (rolling minute, per process here).
    pub openweather_minute_cap: u64,
    /// Bound for S06 reads and publication of one cell.
    pub store_timeout: Duration,
    /// Memory rows kept (expired rows go first).
    pub max_cells: usize,
}
impl Default for AirConfig {
    fn default() -> Self {
        Self {
            google: None,
            openweather: None,
            waqi: None,
            provider_timeout: Duration::from_secs(3),
            openweather_minute_cap: 60,
            store_timeout: Duration::from_secs(2),
            max_cells: 4096,
        }
    }
}
/// S08 funding inputs shared by the air providers.
pub struct AirFunding<T> {
    pub transport: Arc<T>,
    pub clock: Arc<dyn BudgetClock>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AirConfigError {
    Invalid(&'static str),
}
/// Budget transport of a restore-only source: never used.
pub struct NoFunding;
impl BudgetTransport for NoFunding {
    async fn get_budget(&self, _: &str) -> Result<BudgetObject, BudgetError> {
        Err(BudgetError::Transport)
    }
    async fn put_budget(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, BudgetError> {
        Err(BudgetError::Transport)
    }
}
/// Aggregate counters; no coordinate, cell, key or body.
#[derive(Debug, Default)]
pub struct AirMetrics {
    pub requests: AtomicU64,
    pub memory_hits: AtomicU64,
    pub store_hits: AtomicU64,
    pub chains: AtomicU64,
    pub provider_attempts: AtomicU64,
    pub provider_skips: AtomicU64,
    pub publications: AtomicU64,
    pub publication_failures: AtomicU64,
}

struct ProviderState<T> {
    provider: AirProvider,
    config: AirProviderConfig,
    base: reqwest::Url,
    /// UTC month window start and its S08 store (a new store per window, never restored).
    window: AsyncMutex<Option<(i64, Arc<BudgetStore<T>>)>>,
    down_until: Mutex<f64>,
}
#[derive(Clone, Debug)]
struct Row {
    expire_at: f64,
    observation: Option<Observation>,
}
/// Rolling minute of OpenWeather calls (legacy `checkMinute`).
#[derive(Default)]
struct Minute {
    index: i64,
    current: u64,
    previous: u64,
}
struct Inner<T> {
    providers: Vec<ProviderState<T>>,
    live: bool,
    store: Arc<dyn AirStore>,
    http: Option<Arc<dyn AirTransport>>,
    funding: Option<AirFunding<T>>,
    clock: Arc<dyn Clock>,
    config: AirConfig,
    rows: Mutex<HashMap<AirCell, Row>>,
    inflight: Mutex<HashMap<AirCell, watch::Receiver<Option<Row>>>>,
    minute: Mutex<Minute>,
    metrics: AirMetrics,
}
/// The request-time air source with provider chain, S3 raw records and memory rows.
pub struct LiveAir<T> {
    inner: Arc<Inner<T>>,
}
impl<T> Clone for LiveAir<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}
fn valid_key(key: &str) -> bool {
    key.chars().count() >= 10 && !key.starts_with("You have to set")
}
/// `encodeURIComponent`.
fn encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}
fn month_window(now_ms: i64) -> Option<(i64, i64, String)> {
    let p = super::js::parts(now_ms as f64)?;
    let start = super::js::days_from_civil(p.year, p.month, 1) * 86_400_000;
    let (ny, nm) = if p.month == 12 {
        (p.year + 1, 1)
    } else {
        (p.year, p.month + 1)
    };
    let end = super::js::days_from_civil(ny, nm, 1) * 86_400_000;
    Some((start, end, format!("{:04}-{:02}", p.year, p.month)))
}
fn policy(
    provider: AirProvider,
    c: &AirProviderConfig,
    start: i64,
    end: i64,
    id: String,
) -> BudgetPolicy {
    BudgetPolicy {
        provider: provider.budget(),
        quota_id: c.quota_id.clone(),
        window_id: id,
        starts_at_ms: start,
        ends_at_ms: end,
        limit: c.monthly_units,
        block_units: c.block_units,
    }
}
/// One provider attempt's classified outcome (legacy `httpClient` kinds).
enum Attempt {
    Observation(Box<(AirRecord, Observation)>),
    /// 401/403/429: the provider is marked down.
    Rejected,
    Failed,
}

impl<T: BudgetTransport + 'static> LiveAir<T> {
    pub fn new(
        config: AirConfig,
        store: Arc<dyn AirStore>,
        http: Arc<dyn AirTransport>,
        funding: AirFunding<T>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, AirConfigError> {
        let mut providers = Vec::new();
        for (provider, slot) in
            AirProvider::ORDER
                .into_iter()
                .zip([&config.google, &config.openweather, &config.waqi])
        {
            let Some(c) = slot else { continue };
            let base: reqwest::Url = c
                .base_url
                .parse()
                .map_err(|_| AirConfigError::Invalid("provider url"))?;
            if !valid_base(&base) {
                return Err(AirConfigError::Invalid("provider url"));
            }
            policy(provider, c, 0, 1, "check".into())
                .validate()
                .map_err(|_| AirConfigError::Invalid("provider funding"))?;
            if c.key.len() > 2048 || c.key.chars().any(char::is_control) {
                return Err(AirConfigError::Invalid("provider key"));
            }
            // Legacy `isConfigured`: an unset or placeholder key leaves the provider out.
            if !valid_key(&c.key) {
                continue;
            }
            providers.push(ProviderState {
                provider,
                config: c.clone(),
                base,
                window: AsyncMutex::new(None),
                down_until: Mutex::new(f64::NEG_INFINITY),
            });
        }
        if config.max_cells == 0 {
            return Err(AirConfigError::Invalid("max cells"));
        }
        Ok(Self::build(
            providers,
            true,
            store,
            Some(http),
            Some(funding),
            clock,
            config,
        ))
    }
    fn build(
        providers: Vec<ProviderState<T>>,
        live: bool,
        store: Arc<dyn AirStore>,
        http: Option<Arc<dyn AirTransport>>,
        funding: Option<AirFunding<T>>,
        clock: Arc<dyn Clock>,
        config: AirConfig,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                providers,
                live,
                store,
                http,
                funding,
                clock,
                config,
                rows: Mutex::new(HashMap::new()),
                inflight: Mutex::new(HashMap::new()),
                minute: Mutex::new(Minute::default()),
                metrics: AirMetrics::default(),
            }),
        }
    }
    pub fn metrics(&self) -> &AirMetrics {
        &self.inner.metrics
    }
    fn now(&self) -> f64 {
        self.inner.clock.now_ms()
    }
    fn cached(&self, cell: AirCell, now: f64) -> Option<Row> {
        self.inner
            .rows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&cell)
            .filter(|r| r.expire_at > now)
            .cloned()
    }
    fn remember(&self, cell: AirCell, row: Row) {
        let now = self.now();
        let mut rows = self.inner.rows.lock().unwrap_or_else(|e| e.into_inner());
        rows.insert(cell, row);
        if rows.len() > self.inner.config.max_cells {
            rows.retain(|_, r| r.expire_at > now);
        }
        while rows.len() > self.inner.config.max_cells {
            let Some(oldest) = rows
                .iter()
                .min_by(|a, b| a.1.expire_at.total_cmp(&b.1.expire_at))
                .map(|(k, _)| *k)
            else {
                break;
            };
            rows.remove(&oldest);
        }
    }
    async fn answer(&self, lat: f64, lon: f64, request_ms: f64) -> AirOutcome {
        let m = &self.inner.metrics;
        m.requests.fetch_add(1, Relaxed);
        let Some(cell) = AirCell::of(lat, lon) else {
            return AirOutcome::None; // legacy 'no-coord'
        };
        // Legacy 'no-provider': a live source without a configured provider reads nothing.
        if self.inner.live && self.inner.providers.is_empty() {
            return AirOutcome::None;
        }
        let row = match self.cached(cell, self.now()) {
            Some(row) => {
                m.memory_hits.fetch_add(1, Relaxed);
                row
            }
            None => self.shared(cell, lat, lon, request_ms).await,
        };
        match row.observation {
            Some(o) if usable(&o, lat, lon, request_ms) => AirOutcome::Observation(o),
            _ => AirOutcome::None,
        }
    }
    /// One miss resolution per cell in this process; later callers wait for its row.
    async fn shared(&self, cell: AirCell, lat: f64, lon: f64, request_ms: f64) -> Row {
        let mut rx = {
            let mut inflight = self
                .inner
                .inflight
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(rx) = inflight.get(&cell) {
                rx.clone()
            } else {
                let (tx, rx) = watch::channel(None);
                inflight.insert(cell, rx.clone());
                let me = self.clone();
                // Owned: a released request (air deadline) never cancels the fetch.
                tokio::spawn(async move {
                    let row = me.miss(cell, lat, lon, request_ms).await;
                    me.remember(cell, row.clone());
                    me.inner
                        .inflight
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&cell);
                    let _ = tx.send(Some(row));
                });
                rx
            }
        };
        match rx.wait_for(Option::is_some).await {
            Ok(row) => row.clone().unwrap_or(Row {
                expire_at: 0.,
                observation: None,
            }),
            Err(_) => Row {
                expire_at: 0.,
                observation: None,
            },
        }
    }
    /// S3 first (a read failure is a miss, as the legacy cache read failure), then the chain.
    async fn miss(&self, cell: AirCell, lat: f64, lon: f64, request_ms: f64) -> Row {
        let now = self.now();
        let store_deadline = Instant::now() + self.inner.config.store_timeout;
        if let Ok(Ok(records)) = timeout(
            self.inner.config.store_timeout,
            self.inner.store.load(cell, now, store_deadline),
        )
        .await
        {
            let newest = records
                .into_iter()
                .filter(|r| {
                    let at = r.fetched_at_ms as f64;
                    at <= now && now < at + TTL_MS
                })
                .max_by(|a, b| (a.fetched_at_ms, &a.body[..]).cmp(&(b.fetched_at_ms, &b.body[..])));
            if let Some(r) = newest {
                self.inner.metrics.store_hits.fetch_add(1, Relaxed);
                return Row {
                    expire_at: r.fetched_at_ms as f64 + TTL_MS,
                    observation: r.provider.parse(&r.body),
                };
            }
        }
        if !self.inner.live {
            return Row {
                expire_at: now + FAILURE_TTL_MS,
                observation: None,
            };
        }
        self.inner.metrics.chains.fetch_add(1, Relaxed);
        let Some((record, observation)) = self.chain(cell, lat, lon, request_ms).await else {
            return Row {
                expire_at: self.now() + FAILURE_TTL_MS,
                observation: None,
            };
        };
        let fetched = record.fetched_at_ms as f64;
        let deadline = Instant::now() + self.inner.config.store_timeout;
        match self.inner.store.publish(cell, record, deadline).await {
            Ok(()) => {
                self.inner.metrics.publications.fetch_add(1, Relaxed);
                Row {
                    expire_at: fetched + TTL_MS,
                    observation: Some(observation),
                }
            }
            Err(_) => {
                // O-9: an undurable body is not a success.
                self.inner
                    .metrics
                    .publication_failures
                    .fetch_add(1, Relaxed);
                Row {
                    expire_at: self.now() + FAILURE_TTL_MS,
                    observation: None,
                }
            }
        }
    }
    /// `providerChain.fetch` free phase: FREE_ORDER, then WAQI again when not yet tried.
    /// Returns the first usable observation for the first requester, else the last unusable.
    async fn chain(
        &self,
        cell: AirCell,
        lat: f64,
        lon: f64,
        request_ms: f64,
    ) -> Option<(AirRecord, Observation)> {
        let mut tried = BTreeSet::new();
        let mut last = None;
        for walk in [&AirProvider::ORDER[..], &[AirProvider::Waqi][..]] {
            for &provider in walk {
                let Some(state) = self.inner.providers.iter().find(|s| s.provider == provider)
                else {
                    continue;
                };
                if tried.contains(&provider) || !self.admit(state).await {
                    continue;
                }
                tried.insert(provider);
                match self.attempt(state, cell).await {
                    Attempt::Observation(found) => {
                        let (record, o) = *found;
                        if usable(&o, lat, lon, request_ms) {
                            return Some((record, o));
                        }
                        last = Some((record, o));
                    }
                    Attempt::Rejected => {
                        *state.down_until.lock().unwrap_or_else(|e| e.into_inner()) =
                            self.now() + DOWN_MS;
                    }
                    Attempt::Failed => {}
                }
            }
        }
        last
    }
    /// Legacy `budget.check` free phase: down marker, OpenWeather minute cap, then one S08
    /// unit reserved and consumed before HTTP. Any denial or S08 failure skips the provider.
    async fn admit(&self, state: &ProviderState<T>) -> bool {
        let skip = || {
            self.inner.metrics.provider_skips.fetch_add(1, Relaxed);
            false
        };
        let now = self.now();
        if *state.down_until.lock().unwrap_or_else(|e| e.into_inner()) > now {
            return skip();
        }
        if state.provider == AirProvider::OpenWeather && !self.minute_allows(now) {
            return skip();
        }
        let Some(funding) = &self.inner.funding else {
            return skip();
        };
        let deadline = Instant::now() + self.inner.config.store_timeout;
        let Ok(now_ms) = funding.clock.now_ms() else {
            return skip();
        };
        let Some((start, end, id)) = month_window(now_ms) else {
            return skip();
        };
        let store = {
            let mut window = state.window.lock().await;
            match window.as_ref() {
                Some((s, store)) if *s == start => store.clone(),
                _ => {
                    let Ok(store) = BudgetStore::new(
                        funding.transport.clone(),
                        policy(state.provider, &state.config, start, end, id),
                        funding.clock.clone(),
                    ) else {
                        return skip();
                    };
                    let store = Arc::new(store);
                    *window = Some((start, store.clone()));
                    store
                }
            }
        };
        let Ok(mut reservation) = store.reserve(1, deadline).await else {
            return skip();
        };
        if reservation.consume(1, deadline).is_err() {
            return skip();
        }
        true
    }
    fn minute_allows(&self, now: f64) -> bool {
        let mut m = self.inner.minute.lock().unwrap_or_else(|e| e.into_inner());
        roll(&mut m, now);
        let fraction = (60_000. - now.rem_euclid(60_000.)) / 60_000.;
        (m.current as f64 + m.previous as f64 * fraction)
            < self.inner.config.openweather_minute_cap as f64
    }
    fn request(&self, state: &ProviderState<T>, cell: AirCell) -> Option<AirHttpRequest> {
        let (lat, lon) = (num_string(cell.lat()), num_string(cell.lon()));
        let key = encode_component(&state.config.key);
        let (path, query, post_json) = match state.provider {
            AirProvider::Google => (
                "v1/currentConditions:lookup".to_owned(),
                format!("key={key}"),
                Some(
                    format!(
                        r#"{{"location":{{"latitude":{lat},"longitude":{lon}}},"extraComputations":["LOCAL_AQI","POLLUTANT_CONCENTRATION"],"universalAqi":true,"languageCode":"en"}}"#
                    )
                    .into_bytes(),
                ),
            ),
            AirProvider::OpenWeather => (
                "data/2.5/air_pollution".to_owned(),
                format!("lat={lat}&lon={lon}&appid={key}"),
                None,
            ),
            AirProvider::Waqi => (format!("feed/geo:{lat};{lon}/"), format!("token={key}"), None),
        };
        let mut url = state.base.join(&path).ok()?;
        url.set_query(Some(&query));
        Some(AirHttpRequest { url, post_json })
    }
    async fn attempt(&self, state: &ProviderState<T>, cell: AirCell) -> Attempt {
        self.inner.metrics.provider_attempts.fetch_add(1, Relaxed);
        if state.provider == AirProvider::OpenWeather {
            let now = self.now();
            let mut m = self.inner.minute.lock().unwrap_or_else(|e| e.into_inner());
            roll(&mut m, now);
            m.current += 1;
        }
        let (Some(http), Some(request)) = (&self.inner.http, self.request(state, cell)) else {
            return Attempt::Failed;
        };
        let deadline = Instant::now() + self.inner.config.provider_timeout;
        let Ok(response) = http.send(request, deadline).await else {
            return Attempt::Failed;
        };
        match response.status {
            401 | 403 | 429 => return Attempt::Rejected,
            200..=299 => {}
            _ => return Attempt::Failed,
        }
        let provider = state.provider;
        let body: Arc<[u8]> = response.body.into();
        let parsed = body.clone();
        let Ok(Some(observation)) =
            tokio::task::spawn_blocking(move || provider.parse(&parsed)).await
        else {
            return Attempt::Failed;
        };
        let content_type = Some(response.content_type)
            .filter(|c| !c.is_empty() && c.len() <= 128 && !c.bytes().any(|b| b.is_ascii_control()))
            .unwrap_or_else(|| "application/json".into());
        let fetched = self.now();
        if !(fetched.is_finite() && fetched >= 0.) {
            return Attempt::Failed;
        }
        Attempt::Observation(Box::new((
            AirRecord {
                provider,
                fetched_at_ms: fetched as u64,
                content_type,
                body,
            },
            observation,
        )))
    }
}
fn roll(m: &mut Minute, now: f64) {
    let index = (now / 60_000.).floor() as i64;
    if m.index != index {
        m.previous = if m.index + 1 == index { m.current } else { 0 };
        m.current = 0;
        m.index = index;
    }
}
impl LiveAir<NoFunding> {
    /// S3/memory only: no provider is configured or called (restore after replacement).
    pub fn restore_only(store: Arc<dyn AirStore>, clock: Arc<dyn Clock>) -> Self {
        Self::build(
            Vec::new(),
            false,
            store,
            None,
            None,
            clock,
            AirConfig::default(),
        )
    }
}
impl<T: BudgetTransport + 'static> AirSource for LiveAir<T> {
    fn current(&self, lat: f64, lon: f64, request_ms: f64) -> BoxFuture<'_, AirOutcome> {
        Box::pin(self.answer(lat, lon, request_ms))
    }
}
