//! The server2 process: listeners, the shared native services and the HTTP signal drain.
//!
//! `server2` (src/main.rs) runs it with the configuration and services built from the process
//! environment and `server2/.env` ([`crate::dotenv`]). The test-only `loopback_server` example
//! runs the same process with services built for loopback test peers (S10e).
use crate::gateway::GatewayError;
use crate::listener::BoundedListener;
use crate::runtime_services::RuntimeServices;
use crate::{Config, SharedState, metrics_router};
use std::{future::IntoFuture, io, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::watch};

/// Build the runtime from `config`, build shared services inside it and serve until a signal.
pub fn run<F>(config: Config, gateway: F) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce() -> Result<RuntimeServices, GatewayError>,
{
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.worker_threads)
        .max_blocking_threads(config.blocking_threads)
        .thread_name("server2")
        .enable_all()
        .build()?;
    let result = runtime.block_on(serve(config, gateway, |_| {}));
    crate::shutdown_runtime(runtime);
    result?;
    Ok(())
}
/// Same production lifecycle with code-injected listener failure for isolated process tests.
/// There is no production environment switch or endpoint override.
pub fn run_with_listener_hook<F, H>(
    config: Config,
    gateway: F,
    hook: H,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce() -> Result<RuntimeServices, GatewayError>,
    H: FnOnce(tokio::task::AbortHandle),
{
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.worker_threads)
        .max_blocking_threads(config.blocking_threads)
        .thread_name("server2")
        .enable_all()
        .build()?;
    let result = runtime.block_on(serve(config, gateway, hook));
    crate::shutdown_runtime(runtime);
    result?;
    Ok(())
}
type Signal = std::pin::Pin<Box<dyn std::future::Future<Output = io::Result<()>> + Send>>;
fn shutdown_signal() -> io::Result<Signal> {
    #[cfg(unix)]
    {
        // Register both before any listeners/jobs start; startup signals cannot use the default exit.
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        let mut interrupt =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
        Ok(Box::pin(async move {
            tokio::select! { _ = interrupt.recv() => Ok(()), _ = term.recv() => Ok(()) }
        }))
    }
    #[cfg(not(unix))]
    {
        Ok(Box::pin(tokio::signal::ctrl_c()))
    }
}
async fn wait_shutdown(mut stop: watch::Receiver<bool>) {
    if !*stop.borrow() {
        let _ = stop.changed().await;
    }
}
async fn serve<F, H>(config: Config, gateway: F, hook: H) -> io::Result<()>
where
    F: FnOnce() -> Result<RuntimeServices, GatewayError>,
    H: FnOnce(tokio::task::AbortHandle),
{
    use crate::push::deliver::supervisor::DRAIN;
    let signal = shutdown_signal()?;
    let gateway = gateway().map_err(|_| io::Error::other("invalid gateway configuration"))?;
    let push = gateway.push.clone();
    // Constructing services is inert for delivery. Both binds precede worker start.
    let bound = async {
        let public = TcpListener::bind(config.public_addr).await?;
        let private = TcpListener::bind(config.metrics_addr).await?;
        Ok::<_, io::Error>((public, private))
    }
    .await;
    let (public, private) = match bound {
        Ok(listeners) => listeners,
        Err(error) => {
            if let Some(push) = &push {
                push.quiesce();
                let _ = push.drain(tokio::time::Instant::now() + DRAIN).await;
            }
            return Err(error);
        }
    };
    println!(
        "server2 public={} metrics={}",
        public.local_addr()?,
        private.local_addr()?
    );
    let lifetime = Duration::from_secs(config.connection_seconds as u64);
    let public = BoundedListener::new(public, config.connection_limit, lifetime);
    let private = BoundedListener::new(private, 16, lifetime);
    let state = Arc::new(SharedState::new(&config));
    let mut delivery = gateway.delivery.clone().map(|workers| workers.start());
    let router = gateway.public_router(state.clone());
    let (tx, rx) = watch::channel(false);
    let mut listeners = tokio::task::JoinSet::new();
    let public = listeners.spawn(
        axum::serve(public, router)
            .with_graceful_shutdown(wait_shutdown(rx.clone()))
            .into_future(),
    );
    listeners.spawn(
        axum::serve(private, metrics_router(state))
            .with_graceful_shutdown(wait_shutdown(rx))
            .into_future(),
    );
    hook(public);
    let result = tokio::select! {
        result = signal => result,
        result = listeners.join_next() => match result {
            Some(Ok(Err(error))) => Err(error),
            Some(Err(error)) => Err(io::Error::other(error)),
            _ => Err(io::Error::other("listener terminated unexpectedly")),
        }
    };
    // HTTP-only processes retain the foundation 5s forced stop. A push writer or delivery
    // supervisor needs the shared 34s drain; listener failure takes this same owned stop path.
    let has_push_work = push.is_some() || delivery.is_some();
    let drain = if has_push_work {
        DRAIN
    } else {
        Duration::from_secs(5)
    };
    let deadline = tokio::time::Instant::now() + drain;
    if let Some(delivery) = &delivery {
        delivery.quiesce();
    }
    if let Some(push) = &push {
        push.quiesce();
    }
    tx.send_replace(true);
    let worker_drain = async {
        let jobs = if let Some(delivery) = &mut delivery {
            delivery.drain(deadline).await
        } else {
            true
        };
        let writer = if let Some(push) = &push {
            push.drain(deadline).await
        } else {
            true
        };
        (jobs, writer)
    };
    let http_drain = async {
        while let Some(result) = listeners.join_next().await {
            if !matches!(result, Ok(Ok(()))) {
                return false;
            }
        }
        true
    };
    let outcome =
        tokio::time::timeout_at(deadline, async { tokio::join!(worker_drain, http_drain) }).await;
    match outcome {
        Ok(((jobs, writer), http)) => eprintln!(
            "server2 stop delivery_joined={jobs} writer_joined={writer} http_joined={http}"
        ),
        Err(_) => {
            listeners.abort_all();
            // Dropping supervisor aborts its owned JoinSet; writer drain below cancels its handle.
            drop(delivery.take());
            if let Some(push) = &push {
                let _ = push.drain(deadline).await;
            }
            if !has_push_work && result.is_ok() {
                eprintln!("server2 signal drain deadline; forced stop");
            }
            eprintln!(
                "server2 stop deadline: delivery/writer/HTTP may be cancelled/incomplete; durable claims retained"
            );
        }
    }
    eprintln!(
        "server2 provider completion unverified; unfinished owned acquisitions cancelled at runtime teardown; shutdown limit={}s",
        if has_push_work { 35 } else { 6 }
    );
    result
}
