//! Retained widget wire contract. No geocoder, legacy hop, alternate store or provider chain.
use super::{WorldBackend, WorldReply, parse_query, retry_seconds};
use crate::gateway::{GatewayError, metrics, response};
use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use std::{sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::Instant};

/// Only the retained category/days shape, with Express' optional final slash.
pub fn claims(path: &str) -> bool {
    let parts: Vec<_> = path.strip_suffix('/').unwrap_or(path).split('/').collect();
    matches!(parts.as_slice(), ["", "ww", version, "current", "2"] if !version.is_empty())
}
fn wire(
    method: &Method,
    headers: &HeaderMap,
    status: StatusCode,
    bytes: Vec<u8>,
    json: bool,
    retry: Option<u64>,
) -> Response {
    let mut reply = response::send(method, headers, status, bytes, None, retry);
    if retry.is_none() {
        reply.headers_mut().remove("cache-control");
    }
    if reply.status() != StatusCode::NOT_MODIFIED {
        reply.headers_mut().insert(
            "content-type",
            HeaderValue::from_static(if json {
                "application/json; charset=utf-8"
            } else {
                "text/html; charset=utf-8"
            }),
        );
    }
    reply
}
/// Same40-slot gateway admission; the spawned owner outlives a disconnected HTTP waiter.
pub async fn handle(
    backend: Arc<WorldBackend>,
    request: Request<Body>,
    slots: Arc<Semaphore>,
    timeout: Duration,
) -> Response {
    let method = request.method().clone();
    let headers = request.headers().clone();
    let path = request.uri().path();
    if path.strip_suffix('/').unwrap_or(path) != "/ww/010000/current/2" {
        return wire(
            &method,
            &headers,
            StatusCode::BAD_REQUEST,
            b"TWW> invalid version : false".to_vec(),
            false,
            None,
        );
    }
    let query = parse_query(request.uri().query().unwrap_or(""));
    if query
        .get("gcode")
        .str()
        .is_none_or(|s| s.split(',').count() != 2)
    {
        return wire(
            &method,
            &headers,
            StatusCode::BAD_REQUEST,
            b"It is not valid request".to_vec(),
            false,
            None,
        );
    }
    let permit = match slots.try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return response::error(&method, &headers, GatewayError::Unavailable(5)),
    };
    let lang = headers
        .get("accept-language")
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.encode_utf16().count() <= 64)
        .unwrap_or("en")
        .to_owned();
    let url = request.uri().to_string();
    let deadline = Instant::now() + timeout;
    let owned = metrics::Owned::start();
    let task = crate::observability::spawn(async move {
        let _owned = owned;
        let _permit = permit;
        let reply = tokio::time::timeout_at(deadline, backend.reply(&url, &lang, deadline)).await;
        (reply, backend.world().now_ms())
    });
    match task.await {
        Ok((Ok(WorldReply::Body(body)), _)) => wire(
            &method,
            &headers,
            StatusCode::OK,
            body.to_json(),
            true,
            None,
        ),
        Ok((Ok(WorldReply::Unavailable(at)), now)) => {
            let bytes = format!(
                "{{\"code\":\"EWEATHERUNAVAILABLE\",\"retryAt\":{}}}",
                response::js_number(at)
            )
            .into_bytes();
            wire(
                &method,
                &headers,
                StatusCode::SERVICE_UNAVAILABLE,
                bytes,
                true,
                Some(retry_seconds(at, now)),
            )
        }
        Ok((Ok(WorldReply::Unauthorized), _)) => failure(
            &method,
            &headers,
            StatusCode::UNAUTHORIZED,
            b"Unauthorized\n",
        ),
        _ => failure(
            &method,
            &headers,
            StatusCode::INTERNAL_SERVER_ERROR,
            b"Internal Server Error\n",
        ),
    }
}
fn failure(method: &Method, headers: &HeaderMap, status: StatusCode, bytes: &[u8]) -> Response {
    let mut reply = wire(method, headers, status, bytes.to_vec(), false, None);
    // Express finalhandler does not add an ETag, unlike res.send/json.
    reply.headers_mut().remove("etag");
    reply.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    reply
}
