//! Native v000903 KMA backend for the S10 dispatcher (`Family::Kma`). Registration keeps legacy
//! selected. Only an unknown town and the `KR` remap still forward (S15b-4b-2); a request whose
//! inputs the source cannot read is a dependency failure.
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
    /// Legacy work that needs a provider the source does not call yet (a town absent from the
    /// town list: legacy geocodes it; S15b-4b-2). Forward the request to legacy.
    Forward(String),
    /// The source could not read its inputs (S3): a dependency failure, never a forward.
    Failed(String),
}
/// Supplies request inputs (S15b: [`super::source::S3Source`]).
pub trait KmaSource: Send + Sync {
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer>;
}

/// Register the v000903 KMA handler with `source` and select it (`SERVER2_NATIVE_FAMILIES`
/// contains `kma`; the runtime passes the S3 source built from the legacy S3 settings).
pub fn select_native(
    dispatcher: &BackendDispatcher,
    source: Arc<dyn KmaSource>,
) -> Result<(), GatewayError> {
    let backend = Arc::new(KmaBackend::new(
        source,
        system_clock(),
        AssemblyConfig::default(),
    ));
    backend.register(dispatcher);
    KmaBackend::select(dispatcher, BackendMode::Native)
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
        // A path the legacy routes do not take is Express's 404/400: a non-200 reply, which the
        // gateway answers as a dependency failure.
        let Ok(request) = parse_path(&path, &lang) else {
            return Err(GatewayError::Provider);
        };
        let store = match self.source.snapshot(&request, deadline).await {
            SourceAnswer::Snapshot(store) => store,
            SourceAnswer::Forward(_) => return Ok(Native::Forward),
            SourceAnswer::Failed(_) => {
                crate::gateway::metrics::add(&crate::gateway::metrics::COUNTERS.native_defects);
                return Err(GatewayError::Provider);
            }
        };
        let now = store.as_of_ms().unwrap_or_else(|| (self.clock)());
        let config = self.config;
        let permit = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| GatewayError::Provider)?
            .map_err(|_| GatewayError::Provider)?;
        let outcome = match tokio::task::spawn_blocking(move || {
            let _permit = permit;
            assemble(&request, store.as_ref(), now, config)
        })
        .await
        {
            Ok(outcome) => outcome,
            // A Rust panic is a port defect, not legacy behavior: a dependency failure (counted;
            // never a forward, legacy is not a steady-state fallback).
            Err(e) if e.is_panic() => {
                crate::gateway::metrics::add(&crate::gateway::metrics::COUNTERS.native_defects);
                return Err(GatewayError::Provider);
            }
            Err(_) => return Err(GatewayError::Provider),
        };
        match outcome {
            Outcome::Json(json) => Ok(Native::Served(json)),
            // The legacy hop treats a non-200 backend reply as a dependency failure.
            Outcome::Status(..) => Err(GatewayError::Provider),
            Outcome::Legacy(_) => Ok(Native::Forward),
            Outcome::Defect(_) => {
                crate::gateway::metrics::add(&crate::gateway::metrics::COUNTERS.native_defects);
                Err(GatewayError::Provider)
            }
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
/// Express `decode_param`: `decodeURIComponent` of a path parameter (None: `URIError`).
fn decode_param(raw: &str) -> Option<String> {
    super::js::decode_uri_component(raw)
}
/// `qs` `Utils.decode`: `+` is a space, but a failed `decodeURIComponent` (malformed escape or
/// invalid UTF-8) returns the original text, plus signs included.
fn decode_query(raw: &str) -> String {
    super::js::decode_uri_component(&raw.replace('+', " ")).unwrap_or_else(|| raw.to_owned())
}
/// `qs` `parameterLimit` of the pinned Express query parser.
const QS_PARAMETER_LIMIT: usize = 1000;
/// Express's reply for a path the legacy KMA routes do not take (finalhandler 0.4.1,
/// production): no `/addr/:region[/:city[/:town]]` route matches.
fn not_found() -> Outcome {
    Outcome::Status(404, "Not Found\n".into())
}
/// Parse a gateway backend path `/v000903/kma/addr/{region}[/{city}[/{town}]][?query]`.
/// Err is the reply legacy Express gives instead of the KMA router list: 404 when no
/// `/addr/...` route matches, 400 (`Bad Request`) when a path parameter cannot be decoded.
/// `query` lists the decoded raw fields; the chain parses `req.query` from the raw query with
/// `qs` 4.0.0 ([`super::qs`]).
pub fn parse_path(path: &str, lang: &str) -> Result<KmaRequest, Outcome> {
    let (p, q) = path.split_once('?').unwrap_or((path, ""));
    let p = p.strip_suffix('/').unwrap_or(p);
    let rest = p.strip_prefix("/v000903/kma/addr/").ok_or_else(not_found)?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.is_empty() || parts.len() > 3 || parts.iter().any(|s| s.is_empty()) {
        return Err(not_found());
    }
    let mut decoded = Vec::new();
    for part in &parts {
        decoded
            .push(decode_param(part).ok_or_else(|| Outcome::Status(400, "Bad Request\n".into()))?);
    }
    let mut query = Vec::new();
    // `qs` (parameterLimit 1000) splits at most 1,000 raw fields, empty ones included; an empty
    // field yields no key.
    for pair in q
        .split('&')
        .take(QS_PARAMETER_LIMIT)
        .filter(|s| !s.is_empty())
    {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        query.push((decode_query(k), decode_query(v)));
    }
    let mut it = decoded.into_iter();
    Ok(KmaRequest {
        version: "v000903".into(),
        original_url: path.to_owned(),
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
        let reply = |path: &str| parse_path(path, "en").err();
        let not_found = Some(Outcome::Status(404, "Not Found\n".into()));
        let bad = Some(Outcome::Status(400, "Bad Request\n".into()));
        assert_eq!(reply("/v000903/kma/addr/a/b/c/d"), not_found);
        assert_eq!(reply("/v000903/kma/addr/a//c"), not_found);
        assert_eq!(reply("/v000901/kma/addr/a"), not_found);
        assert_eq!(reply("/v000903/kma/addr/%ZZ"), bad);
        assert_eq!(reply("/v000903/kma/addr/%+1"), bad);
        // Bracket syntax and prototype names are `qs` structure, parsed by the chain.
        assert!(parse_path("/v000903/kma/addr/a?x[y]=1&hasOwnProperty=1", "en").is_ok());
        // Pinned qs: `F+%ZZ` -> "F+%ZZ", `a+%E0%A4%A` -> "a+%E0%A4%A", `a+%C3%28` -> "a+%C3%28".
        let q = parse_path(
            "/v000903/kma/addr/a?temperatureUnit=F+%ZZ&x=a+%E0%A4%A&y=a+%C3%28&z=a+b%20c",
            "en",
        )
        .unwrap()
        .query;
        assert_eq!(
            q,
            [
                ("temperatureUnit".into(), "F+%ZZ".into()),
                ("x".into(), "a+%E0%A4%A".into()),
                ("y".into(), "a+%C3%28".into()),
                ("z".into(), "a b c".into())
            ]
        );
    }
    #[test]
    fn query_fields_beyond_the_qs_parameter_limit_are_ignored() {
        let unit = |fields: Vec<String>| {
            let path = format!("/v000903/kma/addr/a?{}", fields.join("&"));
            let r = parse_path(&path, "en").unwrap();
            r.query
                .iter()
                .find(|(k, _)| k == "temperatureUnit")
                .map(|(_, v)| v.clone())
        };
        let filler = |n: usize| (0..n).map(|i| format!("p{i}=1")).collect::<Vec<_>>();
        let with = |mut f: Vec<String>, extra: &[&str]| {
            f.extend(extra.iter().map(|s| s.to_string()));
            f
        };
        // Field 1,000 is parsed; field 1,001 is not (legacy keeps the default Celsius).
        assert_eq!(
            unit(with(filler(999), &["temperatureUnit=F"])),
            Some("F".into())
        );
        assert_eq!(unit(with(filler(1000), &["temperatureUnit=F"])), None);
        // Empty fields count toward the limit.
        assert_eq!(
            unit(with(filler(998), &["", "temperatureUnit=F"])),
            Some("F".into())
        );
        assert_eq!(unit(with(filler(999), &["", "temperatureUnit=F"])), None);
    }
}
