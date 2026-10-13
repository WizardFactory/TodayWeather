//! Native overseas (world) weather backend for the S10 gateway `Family::Dsf` switch (S11).
//! Raw Visual Crossing bodies per legacy 0.02-degree cell are the only persisted weather
//! input; DsfForecast records, current/day views and the response are derived on read.
pub mod air;
pub mod assemble;
pub mod engine;
pub mod i18n;
pub mod js;
pub mod records;
pub mod runtime;
pub mod source;
pub mod store;
pub mod transport;
pub mod units;
pub mod vc;

pub use air::{AirOutcome, AirSource, RecordedWaqi, Unconfigured};
pub use engine::{Clock, Failure, FixedClock, SystemClock, World, WorldConfig};
pub use source::{Disabled, Eligibility, FundedVc, VcError, VcFunding, VcSource};
pub use store::{CatalogWorldStore, MemoryWorldStore, RawFetch, StoreError, WorldStore};
pub use transport::{HttpVcTransport, VcResponse, VcTransport, VcTransportError};

use crate::gateway::{
    BackendDispatcher, BackendHandler, BackendMode, BoxFuture, Family, GatewayError, OrderedJson,
    Version as GatewayVersion,
};
use js::{Obj, Val, fixed, round};
use std::sync::Arc;
use tokio::time::Instant;

/// Visual Crossing range requested by the legacy chain (`combined`, `recent`, `forecast`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Range {
    Combined = 0,
    Recent = 1,
    Forecast = 2,
}
impl Range {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Combined => "combined",
            Self::Recent => "recent",
            Self::Forecast => "forecast",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "combined" => Some(Self::Combined),
            "recent" => Some(Self::Recent),
            "forecast" => Some(Self::Forecast),
            _ => None,
        }
    }
    /// Timeline path segment (`last1days` starts at the day before yesterday).
    pub fn path(self) -> &'static str {
        match self {
            Self::Combined => "last1days/next7days",
            Self::Recent => "yesterday/next7days",
            Self::Forecast => "today/next7days",
        }
    }
}
/// Legacy route variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Version {
    V1,
    V2,
    V3,
}
impl Version {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "v000901" => Some(Self::V1),
            "v000902" => Some(Self::V2),
            "v000903" => Some(Self::V3),
            _ => None,
        }
    }
}
/// Centre of the legacy 0.02-degree cell (`DsfController._gridCell`), never a user coordinate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    pub lat: f64,
    pub lon: f64,
}
fn centre(value: f64, limit: f64) -> f64 {
    let cell = (round(value * 1e6) / 20000.).floor();
    let c = (cell * 20000. + 10000.) / 1e6;
    let clamped = if c.is_nan() {
        c
    } else {
        c.min(limit).max(-limit)
    };
    fixed(clamped, 2)
}
impl Cell {
    pub fn of(lat: f64, lon: f64) -> Option<Self> {
        let cell = Self {
            lat: centre(lat, 89.99),
            lon: centre(lon, 179.99),
        };
        (cell.lat.is_finite() && cell.lon.is_finite()).then_some(cell)
    }
    /// Integer hundredths; the lock/single-flight identity.
    pub fn key(self) -> (i64, i64) {
        (
            (self.lat * 100.).round() as i64,
            (self.lon * 100.).round() as i64,
        )
    }
}
impl Eq for Cell {}

/// Decoded legacy route input.
pub struct WorldRequest {
    pub version: Version,
    pub loc: String,
    pub query: Obj,
    pub accept_language: Option<String>,
}
/// Route outcome in legacy wire classes.
#[derive(Debug)]
pub enum WorldReply {
    Body(Val),
    /// 503 `{code: EWEATHERUNAVAILABLE, retryAt}`.
    Unavailable(f64),
    /// Any other non-200 legacy response.
    Error,
}
impl World {
    /// The `/v00090X/dsf/coord/:loc` route chain.
    pub async fn respond(&self, request: WorldRequest, deadline: Instant) -> WorldReply {
        self.metrics()
            .requests
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut query = request.query;
        for name in units::UNIT_LIST {
            if !query.has(name) || query.get(name).str() == Some("(null)") {
                query.set(name, units::default_unit(name));
            }
        }
        let parts: Vec<&str> = request.loc.split(',').collect();
        if parts.len() != 2 {
            return WorldReply::Error;
        }
        let lat = js::string_to_number(parts[0]);
        let lon = js::string_to_number(parts[1]);
        let now = self.now_ms();
        let (records, air) = tokio::join!(
            self.records(lat, lon, now, deadline),
            self.air(lat, lon, now, deadline)
        );
        let found = match records {
            Ok(found) => found,
            Err(Failure::Unavailable(at)) => return WorldReply::Unavailable(at),
            Err(Failure::Error) => return WorldReply::Error,
        };
        let Some(dsf) = records::output(&found, lat, lon) else {
            return WorldReply::Error;
        };
        let assembly = assemble::Assembly {
            version: request.version,
            query: &query,
            locale: i18n::guess(request.accept_language.as_deref()),
        };
        match assemble::assemble(&assembly, dsf, air) {
            Ok(result) => WorldReply::Body(Val::Obj(result)),
            Err(_) => WorldReply::Error,
        }
    }
}
fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
/// `decodeURIComponent`; None on malformed escapes or invalid UTF-8.
pub fn decode_component(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = hex(*b.get(i + 1)?)?;
            let l = hex(*b.get(i + 2)?)?;
            out.push(h * 16 + l);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
/// Express 4.13 (qs 4.0.0) decoding of the flat query used by the world route. The S10 gateway
/// forwards one value per key; a malformed escape keeps the original text like qs' decoder.
pub fn parse_query(raw: &str) -> Obj {
    let mut q = Obj::new();
    for pair in raw.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let decode =
            |s: &str| decode_component(&s.replace('+', " ")).unwrap_or_else(|| s.to_owned());
        let key = decode(k);
        if key.is_empty() {
            continue;
        }
        q.set(&key, Val::Str(decode(v)));
    }
    q
}
/// Parse `/{version}/dsf/coord/{loc}?{query}` as the legacy router does.
pub fn parse_path(path: &str) -> Option<(Version, String, Obj)> {
    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    let mut parts = route.strip_prefix('/')?.split('/');
    let version = Version::parse(parts.next()?)?;
    if parts.next()? != "dsf" || parts.next()? != "coord" {
        return None;
    }
    let loc = parts.next().filter(|s| !s.is_empty())?;
    if parts.next().is_some() {
        return None;
    }
    Some((version, decode_component(loc)?, parse_query(query)))
}
/// `Family::Dsf` native handler over a [`World`] engine.
pub struct WorldBackend {
    world: World,
}
impl WorldBackend {
    pub fn new(world: World) -> Self {
        Self { world }
    }
    pub fn world(&self) -> &World {
        &self.world
    }
    /// Register for every gateway version; the dispatcher keeps `Legacy` selected until
    /// [`BackendDispatcher::set_backend`] switches a version explicitly.
    pub fn register(self: &Arc<Self>, dispatcher: &BackendDispatcher) {
        for version in [
            GatewayVersion::V000901,
            GatewayVersion::V000902,
            GatewayVersion::V000903,
        ] {
            dispatcher.register_native(version, Family::Dsf, self.clone());
        }
    }
    /// Explicitly select native world for the listed versions (rollback: `BackendMode::Legacy`).
    pub fn select(
        dispatcher: &BackendDispatcher,
        versions: &[GatewayVersion],
        mode: BackendMode,
    ) -> Result<(), GatewayError> {
        for v in versions {
            dispatcher.set_backend(*v, Family::Dsf, mode)?;
        }
        Ok(())
    }
    /// Legacy-wire outcome for a backend path (body bytes or error class), for parity checks.
    pub async fn reply(&self, path: &str, lang: &str, deadline: Instant) -> WorldReply {
        let Some((version, loc, query)) = parse_path(path) else {
            return WorldReply::Error;
        };
        self.world
            .respond(
                WorldRequest {
                    version,
                    loc,
                    query,
                    accept_language: (!lang.is_empty()).then(|| lang.to_owned()),
                },
                deadline,
            )
            .await
    }
}
/// The gateway's retry-after seconds for a legacy `retryAt`.
pub fn retry_seconds(retry_at_ms: f64, now_ms: f64) -> u64 {
    ((retry_at_ms - now_ms) / 1000.).floor().clamp(1., 3600.) as u64
}
impl BackendHandler for WorldBackend {
    fn fetch(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(async move {
            match self.reply(&path, &lang, deadline).await {
                WorldReply::Body(v) => v.to_ordered().ok_or(GatewayError::Provider),
                WorldReply::Unavailable(at) => Err(GatewayError::Unavailable(retry_seconds(
                    at,
                    self.world.now_ms(),
                ))),
                WorldReply::Error => Err(GatewayError::Provider),
            }
        })
    }
}
