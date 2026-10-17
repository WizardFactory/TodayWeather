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

/// S10b (#2730) lifetime selection, S10e (#2753) built-in values: (gateway, lifetime) -> result.
#[test]
fn connection_lifetime_selection_tracks_the_gateway_deadline() {
    let select = |gateway: bool, seconds: usize| {
        let mut c = Config {
            connection_seconds: seconds,
            ..Config::default()
        };
        c.select_connection_lifetime(gateway)
            .map(|()| c.connection_seconds)
    };
    // Gateway disabled: the foundation default and any validated value stay unchanged.
    assert_eq!(Config::default().connection_seconds, 9);
    assert_eq!(select(false, 9), Ok(9));
    assert_eq!(select(false, 2), Ok(2));
    // Gateway enabled: the built-in 12 s, above the 9 s deadline.
    assert_eq!(server2::GATEWAY_CONNECTION_SECONDS, 12);
    for seconds in [2, 9, 30] {
        assert_eq!(
            select(true, seconds),
            Ok(server2::GATEWAY_CONNECTION_SECONDS)
        );
    }
    assert_eq!(server2::gateway::PUBLIC_DEADLINE.as_secs(), 9);
}

/// Starts the actual binary with the gateway enabled in a restricted environment that holds
/// only legacy listener settings (S10e). Returns its exit status if it exited within five
/// seconds, plus its captured output.
fn start_gateway_process(
    settings: &[(&str, &str)],
) -> (Option<std::process::ExitStatus>, String, String) {
    // An empty working directory: the process never sees a real server2/.env (S10e).
    let cwd = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("s10e-no-dotenv");
    std::fs::create_dir_all(&cwd).unwrap();
    let _ = std::fs::remove_file(cwd.join(".env"));
    start_gateway_process_in(&cwd, settings)
}
fn start_gateway_process_in(
    cwd: &std::path::Path,
    settings: &[(&str, &str)],
) -> (Option<std::process::ExitStatus>, String, String) {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut command = Command::new(env!("CARGO_BIN_EXE_server2"));
    command
        .current_dir(cwd)
        .env_clear()
        .env("SERVER2_GATEWAY_LEGACY_URL", "http://127.0.0.1:9")
        .envs(settings.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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

/// S10e: the process binds where legacy `config.js` would (`OPENSHIFT_NODEJS_IP`, then
/// `OPENSHIFT_NODEJS_PORT` or `PORT`). An invalid listener setting is a configuration error
/// before any listener is bound; the removed `SERVER2_BIND`/`SERVER2_METRICS_BIND` are not read.
#[test]
fn gateway_process_binds_the_legacy_port_and_refuses_invalid_settings_before_binding() {
    // An occupied public address: a bind attempt would fail with AddrInUse, so a configuration
    // message proves the check runs before any bind.
    let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = occupied.local_addr().unwrap().port().to_string();
    for bad in [
        ("PORT", "http"),
        ("OPENSHIFT_NODEJS_PORT", "-1"),
        ("OPENSHIFT_NODEJS_IP", "localhost"),
    ] {
        let (status, stdout, stderr) = start_gateway_process(&[("PORT", &port), bad]);
        assert!(
            status.is_some_and(|status| !status.success()),
            "{bad:?}: expected a startup failure, got {status:?} {stdout}"
        );
        assert!(
            !stdout.contains("server2 public="),
            "{bad:?} bound: {stdout}"
        );
        assert!(
            stderr.contains(&format!("invalid {}", bad.0)),
            "{bad:?}: {stderr}"
        );
    }
    // Control: valid settings reach the bind and fail on the occupied address.
    let (status, _, stderr) = start_gateway_process(&[("PORT", &port)]);
    assert!(
        status.is_some_and(|status| !status.success())
            && stderr
                .lines()
                .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                .any(|event| event["schema"] == 1
                    && event["component"] == "process"
                    && event["stage"] == "bind"
                    && event["cause"] == "address_in_use"
                    && event["outcome"] == "failed"),
        "{status:?} {stderr}"
    );
    // Port 0 starts on ephemeral loopback ports; stale server2-only settings change nothing.
    let (status, stdout, stderr) = start_gateway_process(&[
        ("PORT", "0"),
        ("SERVER2_BIND", "0.0.0.0:1"),
        ("SERVER2_METRICS_BIND", "0.0.0.0:2"),
        ("SERVER2_CONNECTION_SECONDS", "1"),
    ]);
    assert!(status.is_none(), "exited: {stderr}");
    assert!(stdout.starts_with("server2 public=127.0.0.1:"), "{stdout}");
    assert!(stdout.contains(" metrics=127.0.0.1:"), "{stdout}");
}

/// S10e: the binary reads `.env` from its working directory with the legacy dotenv rules, and
/// the process environment wins over the file.
#[test]
fn the_working_directory_env_file_is_read_and_the_process_environment_wins() {
    let cwd = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("s10e-dotenv");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::write(
        cwd.join(".env"),
        "# test copy\nPORT=http\nOPENSHIFT_NODEJS_IP='127.0.0.1'\n",
    )
    .unwrap();
    let (status, stdout, stderr) = start_gateway_process_in(&cwd, &[]);
    assert!(
        status.is_some_and(|status| !status.success()) && stderr.contains("invalid PORT"),
        "the file value was not read: {status:?} {stdout} {stderr}"
    );
    let (status, stdout, stderr) = start_gateway_process_in(&cwd, &[("PORT", "0")]);
    assert!(status.is_none(), "exited: {stderr}");
    assert!(stdout.starts_with("server2 public=127.0.0.1:"), "{stdout}");
}
