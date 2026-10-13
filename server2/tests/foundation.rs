use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use server2::{Config, SharedState, metrics_router, public_router};
use std::{
    net::{IpAddr, Ipv4Addr},
    sync::Arc,
};
use tower::ServiceExt;

#[tokio::test]
async fn health_exact_and_metrics_not_public() {
    let state = Arc::new(SharedState::new(&Config::default()));
    let public = public_router(state.clone());
    let response = public
        .clone()
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    assert_eq!(
        response.headers()["content-type"],
        "text/html; charset=utf-8"
    );
    assert_eq!(to_bytes(response.into_body(), 10).await.unwrap(), "OK");
    let head = public
        .clone()
        .oneshot(Request::head("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["content-length"], "2");
    assert!(to_bytes(head.into_body(), 10).await.unwrap().is_empty());
    let hidden = public
        .oneshot(
            Request::get("/internal/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    let metrics = metrics_router(state)
        .oneshot(
            Request::get("/internal/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metrics.status(), StatusCode::OK);
    assert!(
        !metrics
            .headers()
            .contains_key("access-control-allow-origin")
    );
}

#[test]
fn invalid_config_and_bounded_memory() {
    let mut c = Config::default();
    c.metrics_addr.set_ip(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    assert!(c.validate().is_err());
    c = Config::default();
    c.inflight_limit = 0;
    assert!(c.validate().is_err());
    c = Config::default();
    c.cache_bytes = 4;
    let state = SharedState::new(&c);
    assert!(state.replace_memory(Arc::from(&b"1234"[..])));
    assert!(!state.replace_memory(Arc::from(&b"12345"[..])));
    assert_eq!(state.memory_bytes(), 4);
    let permits: Vec<_> = (0..c.inflight_limit)
        .map(|_| state.try_admit().unwrap())
        .collect();
    assert!(state.try_admit().is_none());
    drop(permits);
    assert!(state.try_admit().is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_cpu_work_retains_permit_until_real_completion() {
    let c = Config {
        cpu_limit: 1,
        ..Config::default()
    };
    let state = Arc::new(SharedState::new(&c));
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = std::sync::mpsc::channel();
    let s = state.clone();
    let waiter = tokio::spawn(async move {
        s.run_cpu(move || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
        })
        .await
    });
    started_rx.await.unwrap();
    waiter.abort();
    let _ = waiter.await;
    assert!(state.run_cpu(|| ()).await.is_err());
    finish_tx.send(()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while state.cpu_available() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(state.run_cpu(|| 42).await.is_ok());
}

#[test]
fn runtime_shutdown_returns_while_blocking_work_is_still_running() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .max_blocking_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let state = Arc::new(SharedState::new(&Config {
        cpu_limit: 1,
        ..Config::default()
    }));
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let (finished_tx, finished_rx) = std::sync::mpsc::channel();
    let inspection = state.clone();
    runtime.spawn(async move {
        let _ = state
            .run_cpu(move || {
                let _ = entered_tx.send(());
                let _ = release_rx.recv();
                let _ = finished_tx.send(());
            })
            .await;
    });
    if entered_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .is_err()
    {
        let _ = release_tx.send(());
        server2::shutdown_runtime(runtime);
        panic!("CPU closure did not start");
    }
    let start = std::time::Instant::now();
    server2::shutdown_runtime(runtime);
    let elapsed = start.elapsed();
    // Release before assertions so even a timing failure cannot leave the thread blocked.
    release_tx.send(()).unwrap();
    finished_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    let cleanup_deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    while inspection.cpu_available() == 0 && std::time::Instant::now() < cleanup_deadline {
        std::thread::yield_now();
    }
    assert_eq!(inspection.cpu_available(), 1);
    assert!(elapsed >= std::time::Duration::from_millis(900));
    assert!(elapsed < std::time::Duration::from_secs(2));
}

#[tokio::test]
async fn exhausted_admission_is_503_with_public_cors_and_private_metrics_remain_available() {
    let state = Arc::new(SharedState::new(&Config {
        inflight_limit: 1,
        ..Config::default()
    }));
    let permit = state.try_admit().unwrap();
    let response = public_router(state.clone())
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    let private = metrics_router(state.clone())
        .oneshot(
            Request::get("/internal/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private.status(), StatusCode::OK);
    assert!(
        !private
            .headers()
            .contains_key("access-control-allow-origin")
    );
    drop(permit);
    let recovered = public_router(state)
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(recovered.status(), StatusCode::OK);
}

/// S10b (#2730) lifetime selection table: (gateway, configured lifetime) -> result.
#[test]
fn connection_lifetime_selection_tracks_the_gateway_deadline() {
    let select = |gateway: bool, configured: Option<usize>| {
        let mut c = Config::default();
        if let Some(seconds) = configured {
            c.connection_seconds = seconds;
        }
        c.select_connection_lifetime(gateway, configured.is_some())
            .map(|()| c.connection_seconds)
    };
    // Gateway disabled: the foundation default and any validated value stay unchanged.
    assert_eq!(select(false, None), Ok(9));
    assert_eq!(select(false, Some(2)), Ok(2));
    assert_eq!(select(false, Some(9)), Ok(9));
    // Gateway enabled: 12 s default; explicit values must exceed the 9 s deadline.
    assert_eq!(select(true, None), Ok(server2::GATEWAY_CONNECTION_SECONDS));
    assert_eq!(server2::GATEWAY_CONNECTION_SECONDS, 12);
    assert_eq!(select(true, Some(10)), Ok(10));
    assert_eq!(select(true, Some(30)), Ok(30));
    for seconds in [1, 8, 9] {
        let error = select(true, Some(seconds)).unwrap_err();
        assert!(
            error.contains("SERVER2_CONNECTION_SECONDS must exceed the 9-second gateway deadline"),
            "{error}"
        );
    }
    assert_eq!(server2::gateway::PUBLIC_DEADLINE.as_secs(), 9);
}

/// Starts the actual binary with the gateway enabled in a restricted environment.
/// Returns its exit status if it exited within five seconds, plus its captured output.
fn start_gateway_process(
    bind: &str,
    lifetime: Option<&str>,
) -> (Option<std::process::ExitStatus>, String, String) {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut command = Command::new(env!("CARGO_BIN_EXE_server2"));
    command
        .env_clear()
        .env("SERVER2_BIND", bind)
        .env("SERVER2_METRICS_BIND", "127.0.0.1:0")
        .env("SERVER2_GATEWAY_LEGACY_URL", "http://127.0.0.1:9")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(seconds) = lifetime {
        command.env("SERVER2_CONNECTION_SECONDS", seconds);
    }
    let mut child = command.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if status.is_none() {
        child.kill().unwrap();
    }
    let output = child.wait_with_output().unwrap();
    (
        status,
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

/// S10b (#2730): with the gateway enabled, a connection lifetime that cannot outlive
/// the 9-second deadline is a configuration error before any listener is bound.
#[test]
fn gateway_lifetime_at_or_below_deadline_is_refused_before_binding() {
    // An occupied public address: a bind attempt would fail with AddrInUse, so the
    // lifetime message proves the configuration check runs before any bind.
    let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let occupied = occupied.local_addr().unwrap().to_string();
    for seconds in ["9", "1"] {
        let (status, stdout, stderr) = start_gateway_process(&occupied, Some(seconds));
        assert!(
            status.is_some_and(|status| !status.success()),
            "lifetime {seconds}: expected a startup failure, got {status:?} {stdout}"
        );
        assert!(
            !stdout.contains("server2 public="),
            "lifetime {seconds} bound: {stdout}"
        );
        assert!(
            stderr.contains("SERVER2_CONNECTION_SECONDS must exceed the 9-second gateway deadline"),
            "lifetime {seconds}: {stderr}"
        );
    }
    // Control: a valid lifetime reaches the bind and fails on the occupied address.
    let (status, _, stderr) = start_gateway_process(&occupied, Some("10"));
    assert!(
        status.is_some_and(|status| !status.success()) && stderr.contains("AddrInUse"),
        "{status:?} {stderr}"
    );
    // Controls: the default and a lifetime above the deadline start and announce listeners.
    for lifetime in [None, Some("10")] {
        let (status, stdout, stderr) = start_gateway_process("127.0.0.1:0", lifetime);
        assert!(status.is_none(), "lifetime {lifetime:?} exited: {stderr}");
        assert!(stdout.starts_with("server2 public=127.0.0.1:"), "{stdout}");
    }
}
