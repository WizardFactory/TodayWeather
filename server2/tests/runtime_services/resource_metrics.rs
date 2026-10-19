//! Tests-only baseline for the explicit resource-aware factory feature.
//! Base setup uses existing APIs; the post-feature composition will inject the same resource.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use server2::{Config, SharedState, metrics_router};
use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tower::ServiceExt;

#[tokio::test]
async fn private_metrics_observe_native_operation_before_logging_admission() {
    use server2::observability::{Action, Cause, Component, Details, Operation, Outcome, Stage};
    let state = Arc::new(SharedState::new(&Config::default()));
    let mut operation = Operation::new(Component::World, Stage::Restore);
    operation.finish(
        Cause::None,
        Action::None,
        Outcome::Success,
        Details::default(),
    );
    drop(operation);
    let response = metrics_router(state)
        .oneshot(
            Request::get("/internal/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = to_bytes(response.into_body(), 512 * 1024).await.unwrap();
    let text = std::str::from_utf8(&body).unwrap();
    assert!(
        text.contains("server2_logging_filtered_total "),
        "existing metrics setup must succeed"
    );
    let prefix =
        "server2_native_operation_finished_total{op=\"world_restore\",outcome=\"success\"} ";
    let observed = text
        .lines()
        .find_map(|line| line.strip_prefix(prefix))
        .and_then(|value| value.parse::<u64>().ok());
    assert!(
        observed.is_some_and(|n| n >= 1),
        "the actual completed native operation must be visible independently of log admission; observed {observed:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_vc_gzip_cannot_bypass_the_selected_process_cpu_owner() {
    use server2::world::{HttpVcTransport, VcTransport};
    let config = Config {
        cpu_limit: 1,
        ..Config::default()
    };
    let resources = server2::runtime_resources::ProcessResources::new(&config);
    let state = Arc::new(SharedState::with_resources(&config, resources.clone()));
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = std::sync::mpsc::channel();
    let held = state.clone();
    let blocker = tokio::spawn(async move {
        held.run_cpu(move || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
        })
        .await
    });
    started_rx.await.unwrap();
    assert_eq!(state.cpu_available(), 0);
    let expected = br#"{"days":[],"source":"owned frozen fixture"}"#.to_vec();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&expected).unwrap();
    let gzip = encoder.finish().unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let count = attempts.clone();
    let app = Router::new().route(
        "/record",
        get(move || {
            let body = gzip.clone();
            let count = count.clone();
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                ([("content-encoding", "gzip")], body)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let peer = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    // Existing transport on the baseline. Green explicitly migrates this construction to
    // the additive injected variant, preserving this scenario and the held resource.
    let transport = HttpVcTransport::new_with_cpu(Some(resources.cpu.clone())).unwrap();
    let result = transport
        .get(
            reqwest::Url::parse(&format!("http://{address}/record")).unwrap(),
            tokio::time::Instant::now() + Duration::from_millis(300),
        )
        .await;
    let still_held = state.cpu_available() == 0;
    finish_tx.send(()).unwrap();
    assert!(blocker.await.unwrap().is_ok());
    peer.abort();
    let _ = peer.await;
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "exactly one owned wire attempt; no retry"
    );
    assert!(
        still_held,
        "CPU blocker must remain occupied until explicit release"
    );
    if let Ok(response) = &result {
        assert_eq!(response.status, 200);
        assert_eq!(
            response.body, expected,
            "owned gzip setup must decode exactly"
        );
    }
    assert!(
        result.is_err(),
        "normal VC gzip must not complete past an occupied process CPU limit"
    );
}
