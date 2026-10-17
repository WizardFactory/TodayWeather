//! Native v000903 KMA backend for the S10 dispatcher (`Family::Kma`). Registration keeps legacy
//! selected during coexistence. Selected native routes resolve unknown towns and KR remaps
//! through their source; storage failures, compatibility markers and port defects never forward.
use super::{AssemblyConfig, KmaRequest, KmaStore, Outcome, assemble, assemble_capturing};
use crate::gateway::{
    BackendDispatcher, BackendHandler, BackendMode, BoxFuture, Family, GatewayError, OrderedJson,
    Version, backend::Native,
};
use crate::world::i18n;
use std::sync::Arc;
use tokio::{sync::Semaphore, time::Instant};

/// A request snapshot or terminal dependency failure.
pub enum SourceAnswer {
    Snapshot(Box<dyn KmaStore + Send>),
    /// Compatibility marker from custom/recorded sources, rejected by selected native handlers.
    Forward(String),
    /// Storage/build failure is a dependency failure, never a legacy forward.
    Failed(String),
}
/// Supplies request inputs (S15b: [`super::source::S3Source`]).
pub trait KmaSource: Send + Sync {
    /// Async legacy parameter remap before snapshot reads. Default sources need no remap.
    fn prepare(
        &self,
        request: KmaRequest,
        _deadline: Instant,
    ) -> BoxFuture<'_, Result<KmaRequest, Outcome>> {
        Box::pin(async { Ok(request) })
    }
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
/// S17a: register one KMA handler over `source` for each listed address version and select it
/// (`kma`, `kma-v000901` and `kma-v000902` in `SERVER2_NATIVE_FAMILIES`). Unlisted versions
/// stay on legacy.
pub fn select_native_versions(
    dispatcher: &BackendDispatcher,
    source: Arc<dyn KmaSource>,
    versions: &[Version],
) -> Result<Arc<KmaBackend>, GatewayError> {
    select_native_versions_with(dispatcher, source, versions, None)
}
/// [`select_native_versions`] with the S16 summary recorder: every natively assembled response
/// whose route reaches `getPastMid` with the v000903 current-data prefix records its town's
/// daily summaries (address versions and v000803 town, excluding v000705).
pub fn select_native_versions_with(
    dispatcher: &BackendDispatcher,
    source: Arc<dyn KmaSource>,
    versions: &[Version],
    summaries: Option<Arc<dyn crate::summary::SummarySink>>,
) -> Result<Arc<KmaBackend>, GatewayError> {
    let backend = Arc::new(
        KmaBackend::new(source, system_clock(), AssemblyConfig::default())
            .with_summaries(summaries),
    );
    for version in versions {
        backend.register_version(dispatcher, *version);
        KmaBackend::select_version(dispatcher, *version, BackendMode::Native)?;
    }
    // S17b: the same handler answers the listed direct routes.
    Ok(backend)
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
    /// S16: receives the summary inputs of natively served responses.
    summaries: Option<Arc<dyn crate::summary::SummarySink>>,
}
impl KmaBackend {
    pub fn new(source: Arc<dyn KmaSource>, clock: Clock, config: AssemblyConfig) -> Self {
        Self {
            source,
            clock,
            config,
            cpu: Arc::new(Semaphore::new(2)),
            summaries: None,
        }
    }
    /// Record S16 summaries after natively served responses (None: no recording).
    pub fn with_summaries(mut self, sink: Option<Arc<dyn crate::summary::SummarySink>>) -> Self {
        self.summaries = sink;
        self
    }
    /// Register for v000903 (legacy stays selected).
    pub fn register(self: &Arc<Self>, dispatcher: &BackendDispatcher) {
        dispatcher.register_native(Version::V000903, Family::Kma, self.clone());
    }
    /// Switch v000903 KMA to `mode` (native or the legacy rollback).
    pub fn select(dispatcher: &BackendDispatcher, mode: BackendMode) -> Result<(), GatewayError> {
        dispatcher.set_backend(Version::V000903, Family::Kma, mode)
    }
    /// Register for one address version (legacy stays selected).
    pub fn register_version(self: &Arc<Self>, dispatcher: &BackendDispatcher, version: Version) {
        dispatcher.register_native(version, Family::Kma, self.clone());
    }
    /// Switch one address version's KMA backend to `mode`.
    pub fn select_version(
        dispatcher: &BackendDispatcher,
        version: Version,
        mode: BackendMode,
    ) -> Result<(), GatewayError> {
        dispatcher.set_backend(version, Family::Kma, mode)
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
        let Ok(request) = parse_path(&path, &lang) else {
            return Err(GatewayError::Provider);
        };
        match self.outcome(request, deadline).await? {
            Outcome::Json(json) => Ok(Native::Served(json)),
            // The legacy hop treats a non-200 or non-JSON backend reply as a dependency failure.
            Outcome::Status(..) | Outcome::Undefined | Outcome::Defect(_) => {
                Err(GatewayError::Provider)
            }
            // Transitional/custom sources cannot escape a selected native handler to legacy.
            Outcome::Legacy(_) => native_defect(),
        }
    }
    /// S17b: assemble a parsed request (a gateway backend or a direct public route) from the
    /// source's snapshot. Async source preparation remaps KR before reads; a source compatibility
    /// marker is a counted dependency failure and cannot cause a legacy hop.
    pub async fn outcome(
        &self,
        request: KmaRequest,
        deadline: Instant,
    ) -> Result<Outcome, GatewayError> {
        let deadline = deadline.min(Instant::now() + std::time::Duration::from_secs(3));
        if let Some(reply) = super::chain::preflight(&request) {
            return Ok(reply);
        }
        let request = match self.source.prepare(request, deadline).await {
            Ok(request) => request,
            Err(reply) => return Ok(reply),
        };
        if let Some(reply) = super::chain::preflight(&request) {
            return Ok(reply);
        }
        let store = match self.source.snapshot(&request, deadline).await {
            SourceAnswer::Snapshot(store) => store,
            SourceAnswer::Forward(_) => return native_defect(),
            SourceAnswer::Failed(_) => return native_defect(),
        };
        let now = store.as_of_ms().unwrap_or_else(|| (self.clock)());
        let config = self.config;
        // S16: only a snapshot whose reads were complete records summaries.
        let inputs = self.summaries.as_ref().and_then(|_| store.summary_inputs());
        let permit = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| GatewayError::Provider)?
            .map_err(|_| GatewayError::Provider)?;
        let (outcome, past_days) = match crate::observability::spawn_blocking(move || {
            let _permit = permit;
            assemble_capturing(&request, store.as_ref(), now, config)
        })
        .await
        {
            Ok((Outcome::Defect(_) | Outcome::Legacy(_), _)) => return native_defect(),
            Ok(outcome) => outcome,
            // A Rust panic is a counted dependency defect, never a legacy forward.
            Err(e) if e.is_panic() => return native_defect(),
            Err(_) => return Err(GatewayError::Provider),
        };
        // S16: a JSON answer whose route ran `getPastMid` (a captured day list) records the
        // town's daily summaries; `getPastMid` reads the same inputs on every version.
        if let (Outcome::Json(_), Some(sink), Some(inputs), Some(rows)) =
            (&outcome, &self.summaries, inputs, past_days)
        {
            sink.record(inputs, rows, now);
        }
        Ok(outcome)
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

fn native_defect<T>() -> Result<T, GatewayError> {
    crate::gateway::metrics::add(&crate::gateway::metrics::COUNTERS.native_defects);
    Err(GatewayError::Provider)
}

/// Express `decodeURIComponent` of a path parameter (None for a malformed escape).
fn decode_param(raw: &str) -> Option<String> {
    super::js::decode_uri_component(raw)
}
/// `qs` `Utils.decode`: `+` is a space, but a failed `decodeURIComponent` (malformed escape or
/// invalid UTF-8) returns the original text, plus signs included.
fn decode_query(raw: &str) -> String {
    decode_param(&raw.replace('+', " ")).unwrap_or_else(|| raw.to_owned())
}
/// `qs` `parameterLimit` of the pinned Express query parser.
const QS_PARAMETER_LIMIT: usize = 1000;
fn not_found() -> Outcome {
    Outcome::Status(404, "Not Found\n".into())
}

/// Parse a gateway backend path `/{version}/kma/addr/{region}[/{city}[/{town}]][?query]` for
/// the address versions `v000901`, `v000902` and `v000903` (S17a).
/// A non-matching route is the native Express 404; bad path encoding is 400.
pub fn parse_path(path: &str, lang: &str) -> Result<KmaRequest, Outcome> {
    let (version, mount, rest) = split_mount(path).ok_or_else(not_found)?;
    if !matches!(version, "v000901" | "v000902" | "v000903") {
        return Err(not_found());
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let parts: Vec<&str> = rest
        .strip_prefix('/')
        .ok_or_else(not_found)?
        .split('/')
        .collect();
    if parts.len() > 3 {
        return Err(not_found());
    }
    parse_request(version, mount, None, &parts, path, lang)
}
/// S17b: parse a town path `/v000803/town/{region}[/{city}[/{town}]][?query]` or
/// `/v000705/town/{region}[/{city}[/{town}[/{mid|short|shortest|current}]]][?query]` (the
/// routes of `routes/v000803/routeTownForecast.js` and `routes/v000705/routeTownForecast.js`).
/// A non-matching route is the native Express 404; bad path encoding is 400.
pub fn parse_town_path(path: &str, lang: &str) -> Result<KmaRequest, Outcome> {
    let (version, mount, rest) = split_mount(path).ok_or_else(not_found)?;
    if !matches!(version, "v000803" | "v000705") {
        return Err(not_found());
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let mut parts: Vec<&str> = rest
        .strip_prefix('/')
        .ok_or_else(not_found)?
        .split('/')
        .collect();
    let part = match parts.as_slice() {
        [_, _, _, part] if version == "v000705" => {
            // Express matches route literals case-insensitively.
            let part = ["mid", "short", "shortest", "current"]
                .into_iter()
                .find(|p| part.eq_ignore_ascii_case(p))
                .ok_or_else(not_found)?;
            parts.pop();
            Some(part.to_owned())
        }
        _ if parts.len() > 3 => return Err(not_found()),
        _ => None,
    };
    parse_request(version, mount, part, &parts, path, lang)
}
/// The legacy mounts of the address and town routes: (version, `req.baseUrl`, route prefix).
/// Express matches both case-insensitively and keeps the requested spelling in `req.baseUrl`.
const MOUNTS: [(&str, &str, &str); 5] = [
    ("v000901", "/v000901/kma/addr", ""),
    ("v000902", "/v000902/kma", "/addr"),
    ("v000903", "/v000903/kma", "/addr"),
    ("v000803", "/v000803/town", ""),
    ("v000705", "/v000705/town", ""),
];
/// S17b: split a request path at its legacy mount: (version, `req.baseUrl` as requested, the
/// remaining path, empty or starting with `/`). None for any other path.
pub fn split_mount(path: &str) -> Option<(&'static str, String, &str)> {
    let p = path.split_once('?').map_or(path, |(p, _)| p);
    MOUNTS.into_iter().find_map(|(version, mount, route)| {
        let full = mount.len() + route.len();
        let head = p.get(..full)?;
        let rest = &p[full..];
        (head.eq_ignore_ascii_case(&format!("{mount}{route}"))
            && (rest.is_empty() || rest.starts_with('/')))
        .then(|| (version, p[..mount.len()].to_owned(), rest))
    })
}
/// The Express parameters and `qs` query of a matched route.
fn parse_request(
    version: &str,
    mount: String,
    part: Option<String>,
    parts: &[&str],
    path: &str,
    lang: &str,
) -> Result<KmaRequest, Outcome> {
    let (_, q) = path.split_once('?').unwrap_or((path, ""));
    if parts.is_empty() || parts.iter().any(|s| s.is_empty()) {
        return Err(not_found());
    }
    let mut decoded = Vec::new();
    for part in parts {
        decoded
            .push(decode_param(part).ok_or_else(|| Outcome::Status(400, "Bad Request\n".into()))?);
    }
    let mut query = Vec::new();
    // Express `qs` (parameterLimit 1000) splits at most 1,000 raw fields, empty ones included;
    // later fields are ignored and an empty field yields no key.
    for pair in q
        .split('&')
        .take(QS_PARAMETER_LIMIT)
        .filter(|s| !s.is_empty())
    {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query(k);
        query.push((key, decode_query(v)));
    }
    let mut it = decoded.into_iter();
    Ok(KmaRequest {
        version: version.into(),
        mount,
        part,
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
        assert!(parse_path("/v000903/kma/addr/a/b/c/d", "en").is_err());
        assert!(parse_path("/v000903/kma/addr/%ZZ", "en").is_err());
        assert!(parse_path("/v000903/kma/addr/a?x[y]=1", "en").is_ok());
        assert_eq!(
            parse_path("/v000901/kma/addr/a", "en").unwrap().version,
            "v000901"
        );
        assert_eq!(
            parse_path("/v000902/kma/addr/a/b", "en").unwrap().version,
            "v000902"
        );
        assert!(parse_path("/v000904/kma/addr/a", "en").is_err());
        assert!(parse_path("/v000901/kma/coord/a", "en").is_err());
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
