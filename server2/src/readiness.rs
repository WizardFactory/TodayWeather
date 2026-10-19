//! Private, uncached availability snapshots; no lifecycle owner or durable mutation.
use crate::{
    SharedState,
    push::PushService,
    storage::{CatalogTransport, Error, decode_list},
};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;

const DEADLINE: Duration = Duration::from_secs(3);
const LIST_BYTES: usize = 64 * 1024;

struct Probe<T> {
    push: Option<Arc<PushService>>,
    s3: Option<T>,
    state: Arc<SharedState>,
    stop: watch::Receiver<bool>,
}
#[derive(Serialize)]
struct Snapshot {
    ready: bool,
    process: &'static str,
    push: &'static str,
    credentials: &'static str,
    s3: &'static str,
}
impl<T: CatalogTransport> Probe<T> {
    fn local(&self, snapshot: &mut Snapshot) -> bool {
        let serving = !*self.stop.borrow() && self.stop.has_changed().is_ok();
        snapshot.process = if serving { "ready" } else { "stopping" };
        snapshot.push = match &self.push {
            None => "not_required",
            Some(push) if push.ready() => "ready",
            Some(_) => "not_ready",
        };
        serving && snapshot.push != "not_ready"
    }
    async fn snapshot(&self) -> Snapshot {
        let mut snapshot = Snapshot {
            ready: false,
            process: "stopping",
            push: "not_ready",
            credentials: if self.s3.is_some() {
                "not_checked"
            } else {
                "not_required"
            },
            s3: if self.s3.is_some() {
                "not_checked"
            } else {
                "not_required"
            },
        };
        if !self.local(&mut snapshot) {
            return snapshot;
        }
        let dependencies = if let Some(s3) = &self.s3 {
            snapshot.credentials = "unavailable";
            let check = async {
                s3.ready().await?;
                snapshot.credentials = "ready";
                snapshot.s3 = "unavailable";
                let bytes = s3.list_raw_document("raw/v2/", None, 1, LIST_BYTES).await?;
                // Retain the endpoint's bound even for an injected transport.
                if bytes.len() > LIST_BYTES {
                    return Err(Error::Capacity);
                }
                self.state
                    .run_cpu(move || decode_list(&bytes, 1))
                    .await
                    .map_err(|_| Error::Capacity)??;
                snapshot.s3 = "ready";
                Ok::<_, Error>(())
            };
            matches!(tokio::time::timeout(DEADLINE, check).await, Ok(Ok(())))
        } else {
            true
        };
        // A successful dependency read cannot conceal a concurrent stop/writer exit.
        snapshot.ready = self.local(&mut snapshot) && dependencies;
        snapshot
    }
}
async fn respond<T: CatalogTransport>(State(probe): State<Arc<Probe<T>>>) -> Response {
    let snapshot = probe.snapshot().await;
    let status = if snapshot.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, [("cache-control", "no-store")], Json(snapshot)).into_response()
}

/// Compose on the existing private listener. Dependency injection is code-only;
/// production supplies its same ProcessS3 and canonical PushService handles.
pub fn router<T: CatalogTransport>(
    push: Option<Arc<PushService>>,
    s3: Option<T>,
    state: Arc<SharedState>,
    stop: watch::Receiver<bool>,
) -> Router {
    Router::new()
        .route("/internal/ready", get(respond::<T>))
        .with_state(Arc::new(Probe {
            push,
            s3,
            state,
            stop,
        }))
        .layer(axum::middleware::from_fn(crate::observability::http))
}
