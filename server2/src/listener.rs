//! Foundation socket limits. Connection age bounds slow headers/body draining.
use axum::serve::Listener;
use std::{
    future::Future,
    io,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Sleep, sleep},
};

pub struct BoundedListener {
    listener: TcpListener,
    permits: Arc<Semaphore>,
    lifetime: Duration,
}
impl BoundedListener {
    pub fn new(listener: TcpListener, limit: usize, lifetime: Duration) -> Self {
        Self {
            listener,
            permits: Arc::new(Semaphore::new(limit)),
            lifetime,
        }
    }
}
impl Listener for BoundedListener {
    type Io = BoundedSocket;
    type Addr = SocketAddr;
    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.listener.accept().await {
                Ok((stream, addr)) => {
                    if let Ok(permit) = self.permits.clone().try_acquire_owned() {
                        return (
                            BoundedSocket {
                                stream,
                                deadline: Box::pin(sleep(self.lifetime)),
                                _permit: permit,
                            },
                            addr,
                        );
                    }
                    // Drop excess connections without an application-work queue.
                    drop(stream);
                    tokio::task::yield_now().await;
                }
                Err(_) => sleep(Duration::from_millis(100)).await,
            }
        }
    }
    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.listener.local_addr()
    }
}
pub struct BoundedSocket {
    stream: TcpStream,
    deadline: Pin<Box<Sleep>>,
    _permit: OwnedSemaphorePermit,
}
impl BoundedSocket {
    fn expired(&mut self, cx: &mut Context<'_>) -> bool {
        self.deadline.as_mut().poll(cx).is_ready()
    }
    fn timeout() -> io::Error {
        io::Error::new(io::ErrorKind::TimedOut, "foundation connection lifetime")
    }
}
impl AsyncRead for BoundedSocket {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.expired(cx) {
            return Poll::Ready(Err(Self::timeout()));
        }
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}
impl AsyncWrite for BoundedSocket {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.expired(cx) {
            return Poll::Ready(Err(Self::timeout()));
        }
        Pin::new(&mut self.stream).poll_write(cx, bytes)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.expired(cx) {
            return Poll::Ready(Err(Self::timeout()));
        }
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}
