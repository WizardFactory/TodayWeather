//! S11-R2-F03: the world VC transport/requester against a raw loopback TCP peer that can reset
//! or close connections, with real S08 funding over the S3 peer (legacy `vcRequester`).
use super::{chain::funded_at, common::*};
use server2::world::{Cell, FixedClock, Range, VcError, VcSource};
use std::{
    collections::VecDeque,
    io::Write,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::Instant,
};

#[derive(Clone)]
enum Act {
    /// Read the request, then reset the connection (RST): Node `ECONNRESET`.
    Reset,
    /// Read the request, then close without a response: Node "socket hang up" (`ECONNRESET`).
    Close,
    /// Respond with status and body, optionally gzip-encoded.
    Respond(u16, Vec<u8>, bool),
}
struct Peer2 {
    endpoint: String,
    acts: Arc<Mutex<VecDeque<Act>>>,
    requests: Arc<Mutex<usize>>,
}
async fn tcp_peer() -> Peer2 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let acts: Arc<Mutex<VecDeque<Act>>> = Arc::new(Mutex::new(VecDeque::new()));
    let requests = Arc::new(Mutex::new(0));
    let (a, r) = (acts.clone(), requests.clone());
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let (a, r) = (a.clone(), r.clone());
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    match socket.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                *r.lock().unwrap() += 1;
                let act = a.lock().unwrap().pop_front().unwrap_or(Act::Close);
                match act {
                    Act::Reset => {
                        #[allow(deprecated)]
                        socket.set_linger(Some(Duration::ZERO)).unwrap();
                        drop(socket);
                    }
                    Act::Close => drop(socket),
                    Act::Respond(status, body, gzip) => {
                        let body = if gzip {
                            let mut e = flate2::write::GzEncoder::new(
                                Vec::new(),
                                flate2::Compression::default(),
                            );
                            e.write_all(&body).unwrap();
                            e.finish().unwrap()
                        } else {
                            body
                        };
                        // Plain literals for the version/type keep encoded strings path-free.
                        let (version, json, crlf) = ("HTTP/1.1", "application/json", "\r\n");
                        let encoding = if gzip { "content-encoding: gzip" } else { "" };
                        let mut head =
                            format!("{version} {status} X{crlf}content-type: {json}{crlf}");
                        if gzip {
                            head.push_str(&format!("{encoding}{crlf}"));
                        }
                        head.push_str(&format!(
                            "content-length: {}{crlf}connection: close{crlf}{crlf}",
                            body.len()
                        ));
                        let _ = socket.write_all(head.as_bytes()).await;
                        let _ = socket.write_all(&body).await;
                        let _ = socket.shutdown().await;
                    }
                }
            });
        }
    });
    Peer2 {
        endpoint: format!("http://{addr}/timeline/"),
        acts,
        requests,
    }
}
impl Peer2 {
    fn queue(&self, acts: &[Act]) {
        self.acts.lock().unwrap().extend(acts.iter().cloned());
    }
    fn count(&self) -> usize {
        *self.requests.lock().unwrap()
    }
}
fn ok(body: &[u8]) -> Act {
    Act::Respond(200, body.to_vec(), false)
}
fn setup(s3: &Peer, vc: &Peer2) -> Arc<dyn VcSource> {
    let clock = Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z")));
    funded_at(s3, &vc.endpoint, clock, 1000)
}
fn cell() -> Cell {
    Cell::of(35.68, 139.76).unwrap()
}
fn within(ms: u64) -> Instant {
    Instant::now() + Duration::from_millis(ms)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_then_success_is_retried_once() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    vc.queue(&[Act::Reset, ok(br#"{"a":1}"#)]);
    let started = Instant::now();
    let body = source
        .fetch(cell(), Range::Forecast, within(8000))
        .await
        .unwrap();
    assert_eq!(body, br#"{"a":1}"#);
    assert_eq!(vc.count(), 2);
    assert!(
        started.elapsed() >= Duration::from_millis(300),
        "legacy 300 ms retry delay"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn close_before_response_is_a_reset() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    vc.queue(&[Act::Close, ok(b"{}")]);
    assert!(
        source
            .fetch(cell(), Range::Forecast, within(8000))
            .await
            .is_ok()
    );
    assert_eq!(vc.count(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn repeated_reset_fails_after_one_retry() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    vc.queue(&[Act::Reset, Act::Reset, ok(b"{}")]);
    assert_eq!(
        source.fetch(cell(), Range::Forecast, within(8000)).await,
        Err(VcError::Failed)
    );
    assert_eq!(vc.count(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_without_retry_time_left_is_not_retried() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    // Warm the funding block so the short call deadline is spent only on HTTP.
    vc.queue(&[ok(b"{}")]);
    source
        .fetch(cell(), Range::Forecast, within(8000))
        .await
        .unwrap();
    vc.queue(&[Act::Reset, ok(b"{}")]);
    assert_eq!(
        source.fetch(cell(), Range::Forecast, within(250)).await,
        Err(VcError::Failed)
    );
    assert_eq!(vc.count(), 2, "no second attempt with <= 300 ms left");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn non_reset_transport_failure_is_not_retried() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    // A body over the legacy 4 MiB cap is a transport failure, not a reset.
    vc.queue(&[
        Act::Respond(200, vec![b' '; 4 * 1024 * 1024 + 1], false),
        ok(b"{}"),
    ]);
    assert_eq!(
        source.fetch(cell(), Range::Forecast, within(8000)).await,
        Err(VcError::Failed)
    );
    assert_eq!(vc.count(), 1);
    // A refused connection (no listener) fails at once without the 300 ms retry.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let refused = funded_at(
        &s3,
        &format!("http://127.0.0.1:{port}/timeline/"),
        Arc::new(FixedClock::new(ms("2026-09-26T07:04:30.000Z"))),
        1000,
    );
    let started = Instant::now();
    assert_eq!(
        refused.fetch(cell(), Range::Forecast, within(8000)).await,
        Err(VcError::Failed)
    );
    assert!(started.elapsed() < Duration::from_millis(1500));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn gzip_bodies_are_decoded_and_statuses_classified() {
    let s3 = Peer::new();
    let vc = tcp_peer().await;
    let source = setup(&s3, &vc);
    vc.queue(&[Act::Respond(200, br#"{"days":[]}"#.to_vec(), true)]);
    assert_eq!(
        source
            .fetch(cell(), Range::Forecast, within(8000))
            .await
            .unwrap(),
        br#"{"days":[]}"#
    );
    vc.queue(&[Act::Respond(401, b"Unauthorized".to_vec(), false)]);
    assert_eq!(
        source.fetch(cell(), Range::Forecast, within(8000)).await,
        Err(VcError::ProviderDown)
    );
    vc.queue(&[Act::Respond(500, b"oops".to_vec(), false), ok(b"{}")]);
    assert_eq!(
        source.fetch(cell(), Range::Forecast, within(8000)).await,
        Err(VcError::Failed)
    );
    assert_eq!(vc.count(), 3, "a 5xx is not retried");
}
