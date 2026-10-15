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
//! (S12 precedent: no client reads it). When the assembly cannot answer from server2's inputs
//! (the S15b temporary forwards, until S15b-4), the request takes the legacy hop unchanged.
use crate::domestic::kma::{
    KmaRequest, Outcome,
    backend::{KmaBackend, parse_path, parse_town_path},
};
use crate::gateway::{BackendDispatcher, response::etag};
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

/// The native attempt of a direct request, as for a gateway backend (S10: 3 s); the source's own
/// request wait (S13d) is inside it. On expiry the request takes the legacy hop.
const NATIVE_ATTEMPT: Duration = Duration::from_secs(3);
/// The legacy hop of a forwarded direct request: the CloudFront default origin response timeout
/// (30 s), since the legacy Express routes have no deadline of their own.
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
    legacy: BackendDispatcher,
}
impl DirectRoutes {
    pub fn new(kma: Arc<KmaBackend>, families: DirectFamilies, legacy: BackendDispatcher) -> Self {
        Self {
            kma,
            families,
            legacy,
        }
    }
    /// Whether a listed direct route owns this request (GET or HEAD under its mount).
    pub fn claims(&self, method: &Method, path: &str) -> bool {
        if *method != Method::GET && *method != Method::HEAD {
            return false;
        }
        let f = self.families;
        (f.kma_v000903 && path.starts_with("/v000903/kma/addr/"))
            || (f.kma_v000901 && path.starts_with("/v000901/kma/addr/"))
            || (f.town
                && (path.starts_with("/v000803/town/") || path.starts_with("/v000705/town/")))
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
        let parsed =
            if path_and_query.starts_with("/v000803/") || path_and_query.starts_with("/v000705/") {
                parse_town_path(&path_and_query, locale)
            } else {
                parse_path(&path_and_query, locale)
            };
        if let Some(request) = parsed
            && let Some(outcome) = self.native(request).await
        {
            return express(&method, &headers, outcome);
        }
        self.forward(&method, &path_and_query, &headers).await
    }
    /// The native outcome, or None when legacy must answer.
    async fn native(&self, request: KmaRequest) -> Option<Outcome> {
        let deadline = Instant::now() + NATIVE_ATTEMPT;
        match tokio::time::timeout_at(deadline, self.kma.outcome(request, deadline)).await {
            Ok(Ok(Outcome::Legacy(_))) | Ok(Err(_)) | Err(_) => None,
            Ok(Ok(outcome)) => Some(outcome),
        }
    }
    async fn forward(
        &self,
        method: &Method,
        path_and_query: &str,
        headers: &HeaderMap,
    ) -> Response {
        match self
            .legacy
            .proxy(method, path_and_query, headers, LEGACY_HOP)
            .await
        {
            Ok((status, legacy_headers, body)) => {
                let mut response = Response::new(Body::from(body));
                *response.status_mut() =
                    StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
                *response.headers_mut() = legacy_headers;
                response
            }
            // The legacy origin did not answer: what nginx returns for an unreachable upstream.
            Err(_) => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = StatusCode::BAD_GATEWAY;
                response
            }
        }
    }
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
    let (status, body, content_type, tag) = match outcome {
        Outcome::Json(json) => {
            let bytes = json.to_bytes();
            let tag = etag(&bytes);
            (200, bytes, "application/json; charset=utf-8", Some(tag))
        }
        Outcome::Undefined => (200, Vec::new(), "application/json", None),
        Outcome::Status(code, text) => {
            let bytes = text.into_bytes();
            let tag = etag(&bytes);
            (code, bytes, "text/html; charset=utf-8", Some(tag))
        }
        Outcome::Legacy(_) => unreachable!("forwarded outcomes are not answered natively"),
    };
    let not_modified = (200..300).contains(&status) && fresh(request, tag.as_deref());
    let length = body.len();
    let empty = not_modified || *method == Method::HEAD;
    let mut response = Response::new(if empty {
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
    if let Some(tag) = tag {
        h.insert("etag", HeaderValue::from_str(&tag).expect("ASCII digest"));
    }
    if !not_modified {
        h.insert("content-type", HeaderValue::from_static(content_type));
        h.insert(
            "content-length",
            HeaderValue::from_str(&length.to_string()).expect("ASCII length"),
        );
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
