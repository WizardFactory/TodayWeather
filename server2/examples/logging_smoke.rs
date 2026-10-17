//! Isolated diagnostics contract: real loopback status classification plus context/drop probes.
//! It does not attest production delivery, a real provider, or deployed retention.
use axum::{Router, http::StatusCode, routing::get};
use server2::observability::{
    self as obs, Action, Cause, Component, Context, Method, ObservedHttp, Operation, Outcome,
    Route, Stage,
};
use server2::resolver::{OwnedConfig, OwnedFlights};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    obs::init(&|name| std::env::var(name).ok());
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let server = obs::spawn(async move {
        axum::serve(
            socket,
            Router::new()
                .route(
                    "/dependency",
                    get(|| async { StatusCode::SERVICE_UNAVAILABLE }),
                )
                .route("/auth", get(|| async { StatusCode::FORBIDDEN }))
                .route("/quota", get(|| async { StatusCode::TOO_MANY_REQUESTS })),
        )
        .with_graceful_shutdown(async {
            let _ = stopped.await;
        })
        .await
        .unwrap();
    });
    let root = Context::root(Route::Weather, Method::Get);
    root.scope(async {
        let client = reqwest::Client::builder()
            .retry(reqwest::retry::never())
            .build()
            .unwrap();
        for (path, status) in [("dependency", 503), ("auth", 403), ("quota", 429)] {
            let answer = client
                .get(format!(
                    "http://{address}/{path}?secret=SYNTHETIC-PRIVATE-2802"
                ))
                .header("authorization", "SYNTHETIC-PRIVATE-2802")
                .send()
                .observed(Component::Provider)
                .await
                .unwrap();
            assert_eq!(answer.status().as_u16(), status);
        }
        let task = obs::spawn(async { obs::current() });
        assert_eq!(task.await.unwrap(), root);
        assert_eq!(obs::spawn_blocking(obs::current).await.unwrap(), root);
        // Drop probes describe helper semantics, not evidence that an external POST occurred.
        drop(Operation::new(Component::Resolver, Stage::SharedWork));
        let mut pending = Operation::new(Component::Delivery, Stage::Send);
        pending.external_pending();
        drop(pending);
        let panic = obs::spawn(async {
            let _operation = Operation::new(Component::Provider, Stage::Acquire);
            panic!("SYNTHETIC-PRIVATE-2802 panic payload must never leave stderr");
        });
        assert!(panic.await.unwrap_err().is_panic());
    })
    .await;
    let flights = OwnedFlights::<u8, u8>::new(OwnedConfig::default()).unwrap();
    let release = Arc::new(tokio::sync::Notify::new());
    let owner_root = Context::root(Route::Weather, Method::Get);
    let owner = release.clone();
    owner_root
        .scope(flights.join(
            1,
            Instant::now(),
            Duration::from_secs(2),
            move |_| async move {
                owner.notified().await;
                7
            },
        ))
        .await;
    let joined_root = Context::root(Route::World, Method::Get);
    joined_root
        .scope(
            flights.join(1, Instant::now(), Duration::from_secs(2), |_| async {
                panic!("must join existing owner")
            }),
        )
        .await;
    release.notify_one();
    assert!(flights.idle(Instant::now() + Duration::from_secs(2)).await);
    stop.send(()).unwrap();
    server.await.unwrap();
    obs::event(
        Component::Logging,
        Stage::Lifecycle,
        Cause::None,
        Action::None,
        Outcome::Completed,
        Default::default(),
    );
    assert!(
        obs::flush(Duration::from_secs(2)),
        "probe sink must accept final records"
    );
    println!(
        "PASS real loopback 503/403/429; async/blocking; shared-owner; dropped/unknown; private panic"
    );
}
