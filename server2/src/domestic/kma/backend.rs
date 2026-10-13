//! Native v000903 KMA backend for the S10 dispatcher (`Family::Kma`). Registration keeps legacy
//! selected; a request whose inputs the source cannot supply is forwarded to legacy.
use super::{AssemblyConfig, KmaRequest, KmaStore, Outcome, assemble};
use crate::gateway::{
    BackendDispatcher, BackendHandler, BackendMode, BoxFuture, Family, GatewayError, OrderedJson,
    Version, backend::Native,
};
use crate::world::i18n;
use std::sync::Arc;
use tokio::{sync::Semaphore, time::Instant};

/// A store snapshot for one request, or a decision to stay on legacy.
pub enum SourceAnswer {
    Snapshot(Box<dyn KmaStore + Send>),
    /// The source cannot supply complete inputs (S14 coverage `Legacy`, absent records, ...).
    Forward(String),
}
/// Supplies request inputs. S15b builds them from S3 raw records and S14 history.
pub trait KmaSource: Send + Sync {
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer>;
}
/// The runtime default until the S3 input source exists: every request stays on legacy.
pub struct LegacyOnly;
impl KmaSource for LegacyOnly {
    fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        Box::pin(async { SourceAnswer::Forward("no native KMA input source configured".into()) })
    }
}

/// Request clock (`Date.now()` in ms).
pub type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;
pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0., |d| d.as_millis() as f64)
    })
}

pub struct KmaBackend {
    source: Arc<dyn KmaSource>,
    clock: Clock,
    config: AssemblyConfig,
    cpu: Arc<Semaphore>,
}
impl KmaBackend {
    pub fn new(source: Arc<dyn KmaSource>, clock: Clock, config: AssemblyConfig) -> Self {
        Self {
            source,
            clock,
            config,
            cpu: Arc::new(Semaphore::new(2)),
        }
    }
    /// Register for v000903 (legacy stays selected).
    pub fn register(self: &Arc<Self>, dispatcher: &BackendDispatcher) {
        dispatcher.register_native(Version::V000903, Family::Kma, self.clone());
    }
    /// Switch v000903 KMA to `mode` (native or the legacy rollback).
    pub fn select(dispatcher: &BackendDispatcher, mode: BackendMode) -> Result<(), GatewayError> {
        dispatcher.set_backend(Version::V000903, Family::Kma, mode)
    }
    /// Assemble a parsed request with an already loaded store (tests and the checkpoint).
    pub fn assemble_with(&self, request: &KmaRequest, store: &dyn KmaStore) -> Outcome {
        assemble(request, store, (self.clock)(), self.config)
    }
    async fn serve(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> Result<Native, GatewayError> {
        let Some(request) = parse_path(&path, &lang) else {
            return Ok(Native::Forward);
        };
        let store = match self.source.snapshot(&request, deadline).await {
            SourceAnswer::Snapshot(store) => store,
            SourceAnswer::Forward(_) => return Ok(Native::Forward),
        };
        let now = (self.clock)();
        let config = self.config;
        let permit = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| GatewayError::Provider)?
            .map_err(|_| GatewayError::Provider)?;
        let outcome = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            assemble(&request, store.as_ref(), now, config)
        })
        .await
        .map_err(|_| GatewayError::Provider)?;
        match outcome {
            Outcome::Json(json) => Ok(Native::Served(json)),
            // The legacy hop treats a non-200 backend reply as a dependency failure.
            Outcome::Status(..) => Err(GatewayError::Provider),
            Outcome::Legacy(_) => Ok(Native::Forward),
        }
    }
}
impl BackendHandler for KmaBackend {
    fn fetch(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        Box::pin(async move {
            match self.serve(path, lang, deadline).await? {
                Native::Served(json) => Ok(json),
                Native::Forward => Err(GatewayError::Provider),
            }
        })
    }
    fn fetch_or_forward(
        &self,
        path: String,
        lang: String,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Native, GatewayError>> {
        Box::pin(self.serve(path, lang, deadline))
    }
}

/// Express `decodeURIComponent` of a path parameter (None for a malformed escape).
fn decode_param(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = raw.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
/// `qs` value/key decoding: `+` is a space; a malformed escape keeps the raw text.
fn decode_query(raw: &str) -> String {
    let spaced = raw.replace('+', " ");
    decode_param(&spaced).unwrap_or(spaced)
}
/// Keys `qs` would treat structurally or drop (bracket syntax, Object.prototype names).
fn plain_key(key: &str) -> bool {
    const PROTO: [&str; 12] = [
        "__proto__",
        "constructor",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "toString",
        "valueOf",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
    ];
    !key.is_empty() && !key.contains(['[', ']', '.']) && !PROTO.contains(&key)
}
/// Parse a gateway backend path `/v000903/kma/addr/{region}[/{city}[/{town}]][?query]`.
/// None means the native port does not handle it (forward to legacy).
pub fn parse_path(path: &str, lang: &str) -> Option<KmaRequest> {
    let (p, q) = path.split_once('?').unwrap_or((path, ""));
    let p = p.strip_suffix('/').unwrap_or(p);
    let rest = p.strip_prefix("/v000903/kma/addr/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.is_empty() || parts.len() > 3 || parts.iter().any(|s| s.is_empty()) {
        return None;
    }
    let mut decoded = Vec::new();
    for part in &parts {
        decoded.push(decode_param(part)?);
    }
    let mut query = Vec::new();
    for pair in q.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query(k);
        if !plain_key(&key) {
            return None;
        }
        query.push((key, decode_query(v)));
    }
    let mut it = decoded.into_iter();
    Some(KmaRequest {
        version: "v000903".into(),
        region: it.next(),
        city: it.next(),
        town: it.next(),
        query,
        locale: i18n::guess(Some(lang).filter(|l| !l.is_empty())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gateway_paths_parse_like_express() {
        let r = parse_path(
            "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A4%91%EA%B5%AC?temperatureUnit=F&note=a%20b",
            "ko",
        )
        .unwrap();
        assert_eq!(r.region.as_deref(), Some("서울특별시"));
        assert_eq!(r.city.as_deref(), Some("중구"));
        assert_eq!(r.town, None);
        assert_eq!(
            r.query,
            [
                ("temperatureUnit".into(), "F".into()),
                ("note".into(), "a b".into())
            ]
        );
        assert_eq!(r.locale.name(), "ko");
        assert!(parse_path("/v000903/kma/addr/a/b/c/d", "en").is_none());
        assert!(parse_path("/v000903/kma/addr/%ZZ", "en").is_none());
        assert!(parse_path("/v000903/kma/addr/a?x[y]=1", "en").is_none());
        assert!(parse_path("/v000901/kma/addr/a", "en").is_none());
    }
}
