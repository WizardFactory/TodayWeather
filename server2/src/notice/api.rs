//! Read-only API library; S20 owns router mounting in the service process.
use super::{latest, store::NoticeStore};
use crate::storage::CatalogTransport;
use axum::{
    Json, Router,
    extract::Query,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
pub fn router<T: CatalogTransport>(store: Arc<NoticeStore<T>>) -> Router {
    router_with_clock(store, Arc::new(now_millis))
}
/// Dependency injection for deterministic tests; not an environment execution mode.
pub fn router_with_clock<T: CatalogTransport>(
    store: Arc<NoticeStore<T>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
) -> Router {
    Router::new().route(
        "/v000903/notice/latest",
        get(
            move |Query(query): Query<HashMap<String, String>>, headers: HeaderMap| {
                let store = store.clone();
                let clock = clock.clone();
                async move {
                    let mut response: Response = match store.view().await {
                        Ok(state) => {
                            let v = latest(&state.records, clock()).map(|n| {
                                n.public(
                                    query.get("lang").map(String::as_str),
                                    headers
                                        .get(header::ACCEPT_LANGUAGE)
                                        .and_then(|v| v.to_str().ok()),
                                )
                            });
                            let mut r = Json(json!({"notice":v})).into_response();
                            r.headers_mut().insert(
                                header::CACHE_CONTROL,
                                header::HeaderValue::from_static("public, max-age=300"),
                            );
                            r
                        }
                        Err(_) => {
                            let mut r = (
                                StatusCode::SERVICE_UNAVAILABLE,
                                Json(json!({"error":"notice storage unavailable"})),
                            )
                                .into_response();
                            r.headers_mut().insert(
                                header::CACHE_CONTROL,
                                header::HeaderValue::from_static("no-store"),
                            );
                            r
                        }
                    };
                    response.headers_mut().insert(
                        header::VARY,
                        header::HeaderValue::from_static("Accept-Language"),
                    );
                    response
                }
            },
        ),
    )
}
