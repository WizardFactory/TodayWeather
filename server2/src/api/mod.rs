//! S17b (#2702): the legacy direct public KMA routes served by the native assembly.
//!
//! Legacy serves these paths from Express behind nginx (not through the `/weather` gateway):
//!
//! | Routing entry | Public path | Legacy handler |
//! | --- | --- | --- |
//! | `kma` | `GET/HEAD /v000903/kma/addr/{region}[/{city}[/{town}]]` | `routes/v000903/route.kma.v000903.js` |
//! | `kma-v000901` | `GET/HEAD /v000901/kma/addr/...` | `routes/v000901/route.kma.addr.js` |
//! | `town` | `GET/HEAD /v000803/town/...`, `/v000705/town/...[/{mid,short,shortest,current}]` | `routes/v000803/routeTownForecast.js`, `routes/v000705/routeTownForecast.js` |
//!
//! A listed entry claims its paths; an unlisted one leaves them to the existing handlers (the
//! gateway answers 404, as before S17b). The reply keeps the Express envelope of the pinned
//! legacy app (`res.json`/`res.send`, weak ETag, `fresh` 0.3.0 revalidation, HEAD, `cors()` and
//! `X-Powered-By`). The session cookie of the legacy app-wide session middleware is not emitted
//! (S12 precedent: no client reads it). Since S15b-4a missing forecast inputs are acquired at
//! request time. Selected native routes terminate natively on missing inputs or dependency
//! errors; neither unknown towns nor compatibility source markers invoke the legacy adapter.
use crate::domestic::kma::{
    KmaRequest, Outcome,
    backend::{KmaBackend, parse_path, parse_town_path, split_mount},
};
use crate::gateway::{BackendDispatcher, response::etag};
#[cfg(test)]
use crate::observability::ObservedHttp as _;
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

/// The native attempt of a direct request, as for a gateway backend (S10: 3 s); the source's own
/// request wait (S13d) is inside it. Expiry is a terminal native dependency error.
const NATIVE_ATTEMPT: Duration = Duration::from_secs(3);
/// Historical coexistence adapter timeout retained for API compatibility. Selected native
/// DirectRoutes do not invoke that adapter.
pub const LEGACY_HOP: Duration = Duration::from_secs(30);

/// Direct routes selected by `SERVER2_NATIVE_FAMILIES`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DirectFamilies {
    /// `/v000903/kma/addr` (`kma`).
    pub kma_v000903: bool,
    /// `/v000901/kma/addr` (`kma-v000901`).
    pub kma_v000901: bool,
    /// `/v000803/town`, `/v000705/town` (`town`).
    pub town: bool,
}
impl DirectFamilies {
    pub fn any(&self) -> bool {
        self.kma_v000903 || self.kma_v000901 || self.town
    }
}

pub struct DirectRoutes {
    kma: Arc<KmaBackend>,
    families: DirectFamilies,
    nation: Option<Arc<crate::nation::NationBackend>>,
}
impl DirectRoutes {
    /// The legacy parameter is retained for callers of the coexistence constructor. Selected
    /// native routes never use it; runtime no longer requires a plain-HTTP legacy adapter.
    pub fn new(kma: Arc<KmaBackend>, families: DirectFamilies, _legacy: BackendDispatcher) -> Self {
        Self {
            kma,
            families,
            nation: None,
        }
    }
    /// S17c shares the same KMA input source and backend with the nation composition.
    pub fn with_nation(mut self, nation: Arc<crate::nation::NationBackend>) -> Self {
        self.nation = Some(nation);
        self
    }
    /// Whether a listed direct route owns this request: GET or HEAD at or under its mount,
    /// matched case-insensitively as Express does.
    pub fn claims(&self, method: &Method, path: &str) -> bool {
        if *method != Method::GET && *method != Method::HEAD {
            return false;
        }
        let f = self.families;
        if let Some(version) = crate::nation::mount(path) {
            return (version == "v000903" && f.kma_v000903)
                || (version == "v000901" && f.kma_v000901);
        }
        match split_mount(path) {
            Some(("v000903", ..)) => f.kma_v000903,
            Some(("v000901", ..)) => f.kma_v000901,
            Some(("v000803" | "v000705", ..)) => f.town,
            _ => false,
        }
    }
    /// Serve a claimed request.
    pub async fn handle(&self, request: Request<Body>) -> Response {
        let method = request.method().clone();
        let headers = request.headers().clone();
        let path_and_query = request.uri().path_and_query().map_or_else(
            || request.uri().path().to_owned(),
            |p| p.as_str().to_owned(),
        );
        let text = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
        // i18n 0.8.3 `init`: the `twcookie` cookie, then Accept-Language (S12 implementation).
        let locale = crate::warnings::special::locale(text("accept-language"), text("cookie"));
        if let Some(version) = crate::nation::mount(&path_and_query) {
            let parameter = request.uri().path().split('/').nth(3).unwrap_or("");
            if !crate::nation::valid_parameter(parameter) {
                return express(
                    &method,
                    &headers,
                    crate::nation::rendered_error_status(
                        400,
                        &format!("Failed to decode param '{parameter}'"),
                    ),
                );
            }
            // Express claims mounts case-insensitively, but checkQueryValidation rejects
            // an uppercase `V`, so requestApi defaults those child calls to v000901.
            let version = if request
                .uri()
                .path()
                .split('/')
                .nth(1)
                .is_some_and(|v| v.starts_with('v'))
            {
                version
            } else {
                "v000901"
            };
            // Nation's internal HTTP calls forward Accept-Language only, never the parent's cookie.
            let child_locale = crate::warnings::special::locale(text("accept-language"), None);
            let query = path_and_query.split_once('?').map_or("", |(_, q)| q);
            let child = format!(
                "/{version}/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C?{query}"
            );
            let base = match parse_path(&child, child_locale) {
                Ok(base) => base,
                Err(_) => return express(&method, &headers, crate::nation::child_error(500)),
            };
            let Some(nation) = &self.nation else {
                return express(&method, &headers, crate::nation::child_error(500));
            };
            return express(&method, &headers, nation.outcome(base).await);
        }
        let Some((version, _, rest)) = split_mount(&path_and_query) else {
            return express(
                &method,
                &headers,
                Outcome::Status(404, "Not Found\n".into()),
            );
        };
        if matches!(rest, "" | "/") && version != "v000903" {
            // `router.get('/')` of the v000901 address and the town routers: the usage list.
            return express(&method, &headers, Outcome::Json(usage()));
        }
        let parsed = if matches!(version, "v000803" | "v000705") {
            parse_town_path(&path_and_query, locale)
        } else {
            parse_path(&path_and_query, locale)
        };
        match parsed {
            Err(outcome) => express(&method, &headers, outcome),
            Ok(request) => {
                return express(&method, &headers, self.native(request).await);
            }
        }
    }
    /// Native outcome; dependency failures are terminal 502 replies.
    async fn native(&self, request: KmaRequest) -> Outcome {
        let deadline = Instant::now() + NATIVE_ATTEMPT;
        match tokio::time::timeout_at(deadline, self.kma.outcome(request, deadline)).await {
            Ok(Ok(Outcome::Legacy(_))) => Outcome::Status(502, "Bad Gateway\n".into()),
            Ok(Err(_)) | Err(_) => Outcome::Status(502, "Bad Gateway\n".into()),
            Ok(Ok(outcome)) => outcome,
        }
    }
}
/// The `router.get('/')` reply of `routes/v000901/route.kma.addr.js` and the two town routers
/// (`req.summary` is never set): `{"usage": [...]}` with the legacy strings.
fn usage() -> crate::gateway::OrderedJson {
    use crate::gateway::OrderedJson;
    const USAGE: [&str; 6] = [
        "/{도,특별시,광역시} : response summarized weather information on matched region",
        "/{도,특별시,광역시}/{시,군,구} : response summarized weather information on matched city",
        "/{도,특별시,광역시}/{시,군,구}/{동,면,읍} : response weather data for all three types such as short, shortest, current",
        "/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/short : response only short information",
        "/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/shortest : response only shortest information",
        "/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/current : response only current information",
    ];
    let text = |s: &str| OrderedJson::String(s.encode_utf16().collect());
    OrderedJson::Object(vec![(
        "usage".encode_utf16().collect(),
        OrderedJson::Array(USAGE.iter().map(|s| text(s)).collect()),
    )])
}
/// `fresh` 0.3.0 as Express 4.13.4 calls it for a 2xx GET/HEAD reply without `Last-Modified`.
fn fresh(request: &HeaderMap, tag: Option<&str>) -> bool {
    let header = |name: &str| request.get(name).and_then(|v| v.to_str().ok());
    let modified_since = header("if-modified-since").filter(|v| !v.is_empty());
    let none_match = header("if-none-match").filter(|v| !v.is_empty());
    if modified_since.is_none() && none_match.is_none() {
        return false;
    }
    if header("cache-control").is_some_and(|cc| cc.contains("no-cache")) {
        return false;
    }
    // `new Date(undefined) <= since` is false: no reply here sets Last-Modified.
    if modified_since.is_some() {
        return false;
    }
    let tag = tag.unwrap_or("undefined");
    none_match.is_some_and(|list| {
        split_list(list)
            .into_iter()
            .any(|m| m == "*" || m == tag || m.strip_prefix("W/") == Some(tag))
    })
}
/// `value.split(/ *, */)`.
fn split_list(value: &str) -> Vec<&str> {
    value
        .split(',')
        .map(|part| part.trim_matches(' '))
        .collect()
}
/// The Express reply of an assembly outcome (`res.json(body)`, `res.json(undefined)`,
/// `res.status(code).send(text)`).
pub fn express(method: &Method, request: &HeaderMap, outcome: Outcome) -> Response {
    let undefined_head = *method == Method::HEAD && matches!(&outcome, Outcome::Undefined);
    // finalhandler 0.4.1 writes directly (no res.send ETag), and sets nosniff.
    let finalhandler = matches!(&outcome, Outcome::Status(code, text)
        if matches!((*code, text.as_str()),
            (500, "Internal Server Error\n") | (404, "Not Found\n") | (400, "Bad Request\n")));
    let (status, body, content_type, tag) = match outcome {
        Outcome::Json(json) => {
            let bytes = json.to_bytes();
            let tag = etag(&bytes);
            (200, bytes, "application/json; charset=utf-8", Some(tag))
        }
        Outcome::Undefined => (200, Vec::new(), "application/json", None),
        Outcome::Status(code, text) => {
            let bytes = text.into_bytes();
            let tag = (!finalhandler).then(|| etag(&bytes));
            (code, bytes, "text/html; charset=utf-8", tag)
        }
        Outcome::Defect(_) => unreachable!("defects are rejected by the backend"),
        Outcome::Legacy(_) => unreachable!("forwarded outcomes are not answered natively"),
    };
    let not_modified = (200..300).contains(&status) && fresh(request, tag.as_deref());
    let length = body.len();
    let empty = not_modified || *method == Method::HEAD;
    let mut response = Response::new(if undefined_head && !not_modified {
        // A finite, unknown-size empty stream avoids Hyper adding Content-Length: 0
        // to Express res.json(undefined) HEAD replies. It terminates immediately.
        Body::from_stream(futures_util::stream::empty::<
            Result<Vec<u8>, std::convert::Infallible>,
        >())
    } else if empty {
        Body::empty()
    } else {
        Body::from(body)
    });
    *response.status_mut() = if not_modified {
        StatusCode::NOT_MODIFIED
    } else {
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    };
    let h = response.headers_mut();
    h.insert("x-powered-by", HeaderValue::from_static("Express"));
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    if finalhandler {
        h.insert(
            "x-content-type-options",
            HeaderValue::from_static("nosniff"),
        );
    }
    if let Some(tag) = &tag {
        h.insert("etag", HeaderValue::from_str(tag).expect("ASCII digest"));
    }
    if !not_modified {
        h.insert("content-type", HeaderValue::from_static(content_type));
        // `res.send` sets Content-Length for a body; for `res.json(undefined)` only Node adds
        // `Content-Length: 0` when a GET ends without one, and a HEAD reply has none.
        if finalhandler || tag.is_some() || *method != Method::HEAD {
            h.insert(
                "content-length",
                HeaderValue::from_str(&length.to_string()).expect("ASCII length"),
            );
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }
    // Exercise Hyper's wire framing: a Response header-only check misses an
    // automatically inserted Content-Length for an exact-size empty HEAD body.
    #[tokio::test]
    async fn undefined_and_json_framing_matches_express_on_the_wire() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = axum::Router::new().fallback(|request: Request| async move {
            let outcome = if request.uri().path() == "/undefined" {
                Outcome::Undefined
            } else {
                Outcome::Json(crate::gateway::OrderedJson::parse(br#"{"ok":true}"#).unwrap())
            };
            express(request.method(), request.headers(), outcome)
        });
        let server =
            crate::observability::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let undefined = format!("http://{address}/undefined");
        let head = client
            .head(&undefined)
            .send()
            .observed(crate::observability::Component::Provider)
            .await
            .unwrap();
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers().get("content-length"), None);
        assert!(head.bytes().await.unwrap().is_empty());
        let get = client
            .get(&undefined)
            .send()
            .observed(crate::observability::Component::Provider)
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::OK);
        assert_eq!(get.headers()["content-length"], "0");
        assert!(get.bytes().await.unwrap().is_empty());
        let json = format!("http://{address}/json");
        let get = client
            .get(&json)
            .send()
            .observed(crate::observability::Component::Provider)
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::OK);
        let tag = get.headers()["etag"].clone();
        assert_eq!(get.bytes().await.unwrap().as_ref(), br#"{"ok":true}"#);
        let head = client
            .head(&json)
            .send()
            .observed(crate::observability::Component::Provider)
            .await
            .unwrap();
        assert_eq!(head.headers()["content-length"], "11");
        assert!(head.bytes().await.unwrap().is_empty());
        let fresh = client
            .get(&json)
            .header("if-none-match", tag)
            .send()
            .observed(crate::observability::Component::Provider)
            .await
            .unwrap();
        assert_eq!(fresh.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(fresh.headers().get("content-length"), None);
        assert!(fresh.bytes().await.unwrap().is_empty());
        server.abort();
    }
    #[test]
    fn freshness_follows_fresh_0_3_0() {
        let tag = Some(r#"W/"1d-abc""#);
        assert!(!fresh(&headers(&[]), tag));
        assert!(fresh(&headers(&[("if-none-match", r#"W/"1d-abc""#)]), tag));
        assert!(fresh(
            &headers(&[("if-none-match", r#"x, W/"1d-abc""#)]),
            tag
        ));
        assert!(fresh(&headers(&[("if-none-match", "*")]), tag));
        // Only the exact tag or `W/` + tag: a strong form of the weak tag does not match.
        assert!(!fresh(&headers(&[("if-none-match", r#""1d-abc""#)]), tag));
        assert!(!fresh(
            &headers(&[
                ("if-none-match", r#"W/"1d-abc""#),
                ("cache-control", "no-cache")
            ]),
            tag
        ));
        // Without Last-Modified, If-Modified-Since never revalidates.
        assert!(!fresh(
            &headers(&[
                ("if-none-match", r#"W/"1d-abc""#),
                ("if-modified-since", "Thu, 24 Sep 2026 00:10:00 GMT")
            ]),
            tag
        ));
        // `res.json(undefined)` has no ETag: `*` and the literal `W/undefined` still match.
        assert!(fresh(&headers(&[("if-none-match", "*")]), None));
        assert!(fresh(&headers(&[("if-none-match", "W/undefined")]), None));
        assert!(!fresh(
            &headers(&[("if-none-match", r#"W/"1d-abc""#)]),
            None
        ));
    }
}
