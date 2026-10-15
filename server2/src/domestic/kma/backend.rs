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
/// Supplies request inputs (S15b: [`super::source::S3Source`]).
pub trait KmaSource: Send + Sync {
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer>;
}
/// A source that keeps every request on legacy (tests; the runtime uses the S3 source).
pub struct LegacyOnly;
impl KmaSource for LegacyOnly {
    fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        Box::pin(async { SourceAnswer::Forward("no native KMA input source configured".into()) })
    }
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
    let backend = Arc::new(KmaBackend::new(
        source,
        system_clock(),
        AssemblyConfig::default(),
    ));
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
        let Some(request) = parse_path(&path, &lang) else {
            return Ok(Native::Forward);
        };
        match self.outcome(request, deadline).await? {
            Outcome::Json(json) => Ok(Native::Served(json)),
            // The legacy hop treats a non-200 or non-JSON backend reply as a dependency failure.
            Outcome::Status(..) | Outcome::Undefined => Err(GatewayError::Provider),
            Outcome::Legacy(_) => Ok(Native::Forward),
        }
    }
    /// S17b: assemble a parsed request (a gateway backend or a direct public route) from the
    /// source's snapshot. `Outcome::Legacy` means legacy answers: the source cannot supply the
    /// inputs, the assembly leaves the ported path, or a Rust panic (a port defect).
    pub async fn outcome(
        &self,
        request: KmaRequest,
        deadline: Instant,
    ) -> Result<Outcome, GatewayError> {
        let store = match self.source.snapshot(&request, deadline).await {
            SourceAnswer::Snapshot(store) => store,
            SourceAnswer::Forward(reason) => return Ok(Outcome::Legacy(reason)),
        };
        let now = store.as_of_ms().unwrap_or_else(|| (self.clock)());
        let config = self.config;
        let permit = tokio::time::timeout_at(deadline, self.cpu.clone().acquire_owned())
            .await
            .map_err(|_| GatewayError::Provider)?
            .map_err(|_| GatewayError::Provider)?;
        match tokio::task::spawn_blocking(move || {
            let _permit = permit;
            assemble(&request, store.as_ref(), now, config)
        })
        .await
        {
            Ok(outcome) => Ok(outcome),
            // A Rust panic is a port defect, not legacy behavior: legacy answers instead.
            Err(e) if e.is_panic() => Ok(Outcome::Legacy("assembly panic".into())),
            Err(_) => Err(GatewayError::Provider),
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
/// `qs` `Utils.decode`: `+` is a space, but a failed `decodeURIComponent` (malformed escape or
/// invalid UTF-8) returns the original text, plus signs included.
fn decode_query(raw: &str) -> String {
    decode_param(&raw.replace('+', " ")).unwrap_or_else(|| raw.to_owned())
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
/// `qs` `parameterLimit` of the pinned Express query parser.
const QS_PARAMETER_LIMIT: usize = 1000;
/// Parse a gateway backend path `/{version}/kma/addr/{region}[/{city}[/{town}]][?query]` for
/// the address versions `v000901`, `v000902` and `v000903` (S17a).
/// None means the native port does not handle it (forward to legacy).
pub fn parse_path(path: &str, lang: &str) -> Option<KmaRequest> {
    let (version, mount, rest) = split_mount(path)?;
    if !matches!(version, "v000901" | "v000902" | "v000903") {
        return None;
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let parts: Vec<&str> = rest.strip_prefix('/')?.split('/').collect();
    if parts.len() > 3 {
        return None;
    }
    parse_request(version, mount, None, &parts, path, lang)
}
/// S17b: parse a town path `/v000803/town/{region}[/{city}[/{town}]][?query]` or
/// `/v000705/town/{region}[/{city}[/{town}[/{mid|short|shortest|current}]]][?query]` (the
/// routes of `routes/v000803/routeTownForecast.js` and `routes/v000705/routeTownForecast.js`).
/// None means the native port does not handle it (forward to legacy).
pub fn parse_town_path(path: &str, lang: &str) -> Option<KmaRequest> {
    let (version, mount, rest) = split_mount(path)?;
    if !matches!(version, "v000803" | "v000705") {
        return None;
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let mut parts: Vec<&str> = rest.strip_prefix('/')?.split('/').collect();
    let part = match parts.as_slice() {
        [_, _, _, part] if version == "v000705" => {
            // Express matches route literals case-insensitively.
            let part = ["mid", "short", "shortest", "current"]
                .into_iter()
                .find(|p| part.eq_ignore_ascii_case(p))?;
            parts.pop();
            Some(part.to_owned())
        }
        _ if parts.len() > 3 => return None,
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
) -> Option<KmaRequest> {
    let (_, q) = path.split_once('?').unwrap_or((path, ""));
    if parts.is_empty() || parts.iter().any(|s| s.is_empty()) {
        return None;
    }
    let mut decoded = Vec::new();
    for part in parts {
        decoded.push(decode_param(part)?);
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
        if !plain_key(&key) {
            return None;
        }
        query.push((key, decode_query(v)));
    }
    let mut it = decoded.into_iter();
    Some(KmaRequest {
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
        assert!(parse_path("/v000903/kma/addr/a/b/c/d", "en").is_none());
        assert!(parse_path("/v000903/kma/addr/%ZZ", "en").is_none());
        assert!(parse_path("/v000903/kma/addr/a?x[y]=1", "en").is_none());
        assert_eq!(
            parse_path("/v000901/kma/addr/a", "en").unwrap().version,
            "v000901"
        );
        assert_eq!(
            parse_path("/v000902/kma/addr/a/b", "en").unwrap().version,
            "v000902"
        );
        assert!(parse_path("/v000904/kma/addr/a", "en").is_none());
        assert!(parse_path("/v000901/kma/coord/a", "en").is_none());
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
