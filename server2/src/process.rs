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
    let result = runtime.block_on(serve(config, gateway));
    crate::shutdown_runtime(runtime);
    result?;
    Ok(())
}
async fn shutdown_signal() -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! { x = tokio::signal::ctrl_c() => x, _ = term.recv() => Ok(()) }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await
    }
}
async fn wait_shutdown(mut stop: watch::Receiver<bool>) {
    if !*stop.borrow() {
        let _ = stop.changed().await;
    }
}
async fn serve<F>(config: Config, gateway: F) -> io::Result<()>
where
    F: FnOnce() -> Result<RuntimeServices, GatewayError>,
{
    let gateway = gateway().map_err(|_| io::Error::other("invalid gateway configuration"))?;
    let public = TcpListener::bind(config.public_addr).await?;
    let private = TcpListener::bind(config.metrics_addr).await?;
    println!(
        "server2 public={} metrics={}",
        public.local_addr()?,
        private.local_addr()?
    );
    let lifetime = Duration::from_secs(config.connection_seconds as u64);
    let public = BoundedListener::new(public, config.connection_limit, lifetime);
    let private = BoundedListener::new(private, 16, lifetime);
    let state = Arc::new(SharedState::new(&config));
    let router = gateway.public_router(state.clone());
    let (tx, rx) = watch::channel(false);
    let mut public_task = tokio::spawn(
        axum::serve(public, router)
            .with_graceful_shutdown(wait_shutdown(rx.clone()))
            .into_future(),
    );
    let mut private_task = tokio::spawn(
        axum::serve(private, metrics_router(state))
            .with_graceful_shutdown(wait_shutdown(rx))
            .into_future(),
    );
    let result = tokio::select! {
        result = shutdown_signal() => result,
        result = &mut public_task => return result.map_err(io::Error::other)?,
        result = &mut private_task => return result.map_err(io::Error::other)?,
    };
    let _ = tx.send(true);
    let drain = tokio::time::timeout(Duration::from_secs(5), async {
        (&mut public_task).await.map_err(io::Error::other)??;
        (&mut private_task).await.map_err(io::Error::other)??;
        Ok::<(), io::Error>(())
    })
    .await;
    match drain {
        Ok(drained) => drained?,
        Err(_) => {
            public_task.abort();
            private_task.abort();
            // A received operator signal permits a bounded, logged forced stop.
            // Signal registration and unexpected server failures still return errors.
            if result.is_ok() {
                eprintln!("server2 signal drain deadline; forced stop");
            }
        }
    }
    result
}
