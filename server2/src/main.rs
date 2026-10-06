use server2::listener::BoundedListener;
use server2::{Config, SharedState, metrics_router, public_router};
use std::{future::IntoFuture, io, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::watch};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env().map_err(io::Error::other)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.worker_threads)
        .max_blocking_threads(config.blocking_threads)
        .thread_name("server2")
        .enable_all()
        .build()?;
    let result = runtime.block_on(serve(config));
    server2::shutdown_runtime(runtime);
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
async fn serve(config: Config) -> io::Result<()> {
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
    let (tx, rx) = watch::channel(false);
    let mut public_task = tokio::spawn(
        axum::serve(public, public_router(state.clone()))
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
    tokio::time::timeout(Duration::from_secs(5), async {
        public_task.await.map_err(io::Error::other)??;
        private_task.await.map_err(io::Error::other)??;
        Ok::<(), io::Error>(())
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "shutdown deadline"))??;
    result
}
