//! Public HTTP endpoint: `GET /calendar/v1/kr/solar-terms/{year}`.

use super::calendar::YearSnapshot;
use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use std::sync::Arc;

pub trait CalendarApi: Send + Sync {
    fn in_range(&self, year: i32) -> bool;
    fn read_year(&self, year: i32) -> Option<Arc<YearSnapshot>>;
}

pub fn router(api: Arc<dyn CalendarApi>) -> Router {
    Router::new()
        .route("/calendar/v1/kr/solar-terms/{year}", get(handle))
        .with_state(api)
}

async fn handle(
    State(api): State<Arc<dyn CalendarApi>>,
    method: Method,
    headers: HeaderMap,
    Path(raw_year): Path<String>,
) -> Response {
    if raw_year.len() != 4 || !raw_year.bytes().all(|b| b.is_ascii_digit()) {
        return error_response(
            &method,
            StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_year"}"#,
        );
    }
    let Ok(year) = raw_year.parse::<i32>() else {
        return error_response(
            &method,
            StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_year"}"#,
        );
    };
    if !api.in_range(year) {
        return error_response(
            &method,
            StatusCode::NOT_FOUND,
            br#"{"error":"year_out_of_range"}"#,
        );
    }
    let Some(snapshot) = api.read_year(year) else {
        return error_response(
            &method,
            StatusCode::SERVICE_UNAVAILABLE,
            br#"{"error":"calendar_unavailable"}"#,
        );
    };

    let tag = format!("\"{}\"", snapshot.revision);
    let body = serde_json::to_vec(snapshot.as_ref()).expect("calendar snapshot JSON");
    let not_modified = is_not_modified(&headers, &tag);
    let length = body.len();

    let mut response = Response::new(if not_modified || method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(body)
    });
    *response.status_mut() = if not_modified {
        StatusCode::NOT_MODIFIED
    } else {
        StatusCode::OK
    };
    let h = response.headers_mut();
    h.insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=3600, must-revalidate"),
    );
    h.insert("etag", HeaderValue::from_str(&tag).expect("ASCII ETag"));
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    if !not_modified {
        h.insert(
            "content-type",
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        h.insert(
            "content-length",
            HeaderValue::from_str(&length.to_string()).expect("ASCII length"),
        );
    }
    response
}

fn error_response(method: &Method, status: StatusCode, body: &'static [u8]) -> Response {
    let mut response = Response::new(if *method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(body)
    });
    *response.status_mut() = status;
    let h = response.headers_mut();
    h.insert("cache-control", HeaderValue::from_static("no-store"));
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "content-type",
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    h.insert(
        "content-length",
        HeaderValue::from_str(&body.len().to_string()).expect("ASCII length"),
    );
    response
}

fn is_not_modified(headers: &HeaderMap, tag: &str) -> bool {
    if headers
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("no-cache"))
        })
    {
        return false;
    }
    headers
        .get("if-none-match")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|list| {
            list.split(',').any(|entry| {
                let entry = entry.trim();
                entry == "*" || entry == tag || entry.strip_prefix("W/") == Some(tag)
            })
        })
}
