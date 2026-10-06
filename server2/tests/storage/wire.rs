use super::peer::{Fault, Peer};
use rusty_s3::Credentials;
use server2::storage::*;
use std::{sync::Arc, time::Duration};
fn record(bytes: &[u8]) -> RawRecord {
    RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20260131,
            slot: "2300".into(),
        },
        1769871600123,
        200,
        "application/json",
        None,
        bytes.into(),
        &Limits::default(),
    )
    .unwrap()
}
fn store(peer: &Peer, limits: Limits) -> RawRecordStore<HttpS3Transport> {
    RawRecordStore::new(
        HttpS3Transport::new(
            &peer.endpoint,
            "records",
            "us-east-1",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        limits,
    )
    .unwrap()
}
#[tokio::test]
async fn wire_conditional_put_repeat_restore_and_concurrency() {
    let peer = Peer::new();
    let store = Arc::new(store(&peer, Limits::default()));
    let r = record(b"\xb0\xa1\xff\0");
    let id = r.envelope.identity.clone();
    assert_eq!(
        store.publish(r.clone()).await.unwrap(),
        PublishOutcome::Created
    );
    assert_eq!(
        store.publish(r.clone()).await.unwrap(),
        PublishOutcome::AlreadyPresent
    );
    let (a, b) = tokio::join!(store.publish(r.clone()), store.publish(r.clone()));
    assert!(
        a.is_ok() && b.is_ok(),
        "a={a:?} b={b:?}, calls={:?}",
        peer.state.lock().unwrap().calls
    );
    assert_eq!(&*store.load(&id).await.unwrap().bytes, &*r.bytes);
    let s = peer.state.lock().unwrap();
    assert_eq!(s.objects.len(), 1);
    assert!(s.calls.iter().any(|(m, _)| m == "HEAD"));
    assert!(s.calls.iter().any(|(m, _)| m == "GET"));
}
#[tokio::test]
async fn committed_put_drop_or_error_is_verified_without_new_object() {
    for fault in [Fault::DropAfterPut, Fault::ErrorAfterPut] {
        let peer = Peer::new();
        peer.state.lock().unwrap().fault = fault;
        let store = store(&peer, Limits::default());
        assert_eq!(
            store.publish(record(b"committed")).await.unwrap(),
            PublishOutcome::AlreadyPresent
        );
        let s = peer.state.lock().unwrap();
        assert_eq!(s.objects.len(), 1);
        assert_eq!(s.calls.iter().filter(|(m, _)| m == "PUT").count(), 1);
    }
}
#[tokio::test]
async fn absent_after_error_retries_only_same_identity() {
    let peer = Peer::new();
    peer.state.lock().unwrap().fault = Fault::ErrorBeforePut;
    let store = store(&peer, Limits::default());
    assert_eq!(
        store.publish(record(b"absent")).await.unwrap(),
        PublishOutcome::Created
    );
    let s = peer.state.lock().unwrap();
    let keys: Vec<_> = s
        .calls
        .iter()
        .filter(|(m, _)| m == "PUT")
        .map(|(_, k)| k)
        .collect();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
    assert_eq!(s.objects.len(), 1);
}
#[tokio::test]
async fn existing_wrong_metadata_and_changed_group_are_rejected() {
    let peer = Peer::new();
    let store = store(&peer, Limits::default());
    let mut r = record(b"raw");
    store.publish(r.clone()).await.unwrap();
    peer.state.lock().unwrap().fault = Fault::WrongHead;
    assert!(matches!(
        store.publish(r.clone()).await,
        Err(Error::Corrupt(_))
    ));
    peer.state.lock().unwrap().fault = Fault::None;
    r.envelope.fetch_group = Some(FetchGroupRef {
        group_sha256: sha256(b"g"),
        member_sha256: sha256(b"m"),
        partitions_sha256: sha256(b"p"),
        members: 1,
    });
    assert!(matches!(store.publish(r).await, Err(Error::Corrupt(_))));
    assert_eq!(peer.state.lock().unwrap().objects.len(), 1);
}
#[tokio::test]
async fn corrupt_get_and_deadline_fail_closed() {
    let peer = Peer::new();
    let limits = Limits {
        deadline: Duration::from_millis(50),
        ..Limits::default()
    };
    let store = store(&peer, limits);
    let r = record(b"raw");
    let id = r.envelope.identity.clone();
    store.publish(r).await.unwrap();
    peer.state
        .lock()
        .unwrap()
        .objects
        .values_mut()
        .next()
        .unwrap()
        .1[10] ^= 1;
    assert!(matches!(store.load(&id).await, Err(Error::Corrupt(_))));
    peer.state.lock().unwrap().fault = Fault::Slow;
    let start = std::time::Instant::now();
    assert_eq!(store.load(&id).await.unwrap_err(), Error::Timeout);
    assert!(start.elapsed() < Duration::from_millis(150));
}
#[test]
fn rejects_remote_plaintext_and_invalid_limits() {
    assert!(
        HttpS3Transport::new(
            "http://example.com",
            "records",
            "us-east-1",
            Credentials::new("test", "test")
        )
        .is_err()
    );
    assert!(
        Limits {
            io: 0,
            ..Limits::default()
        }
        .validate()
        .is_err()
    );
}
struct AcceptedOnly;
impl ObjectTransport for AcceptedOnly {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Ok(202)
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
}
#[tokio::test]
async fn accepted_status_is_not_durable_publication() {
    let store = RawRecordStore::new(AcceptedOnly, Limits::default()).unwrap();
    assert_eq!(
        store.publish(record(b"accepted")).await,
        Err(Error::Status(202))
    );
}
#[tokio::test]
async fn bounded_reusable_client_parallel_publication_probe() {
    let peer = Peer::new();
    let store = store(&peer, Limits::default());
    let r = record(b"parallel-client-probe");
    store.publish(r.clone()).await.unwrap();
    for pair in 0..40 {
        let (a, b) = tokio::join!(store.publish(r.clone()), store.publish(r.clone()));
        assert!(
            a.is_ok() && b.is_ok(),
            "pair={pair} a={a:?} b={b:?} calls={:?}",
            peer.state
                .lock()
                .unwrap()
                .calls
                .iter()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
        );
    }
    let s = peer.state.lock().unwrap();
    assert_eq!(s.objects.len(), 1);
    assert_eq!(s.calls.iter().filter(|(m, _)| m == "PUT").count(), 81);
}
#[test]
fn peer_waits_for_delayed_headers_on_accepted_socket() {
    use std::io::{Read, Write};
    let peer = Peer::new();
    let address = peer.endpoint.strip_prefix("http://").unwrap();
    let mut stream = std::net::TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    std::thread::sleep(Duration::from_millis(30));
    let protocol = "HTTP/1.1";
    let target = "/records/missing?X-Amz-Signature=dummy&access=server2-local";
    let request =
        format!("GET {target} {protocol}\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(request.as_bytes());
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    assert!(
        response.starts_with("HTTP/1.1 404"),
        "peer must wait for headers: {response:?}"
    );
}

#[tokio::test]
async fn wire_rejects_wrong_content_md5_without_object() {
    let peer = Peer::new();
    let transport = HttpS3Transport::new(
        &peer.endpoint,
        "records",
        "us-east-1",
        Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap();
    let mut prepared = record(b"md5").prepare(&Limits::default()).unwrap();
    prepared.md5 = "invalid".into();
    assert_eq!(transport.put(&prepared).await.unwrap(), 400);
    assert!(peer.state.lock().unwrap().objects.is_empty());
}
