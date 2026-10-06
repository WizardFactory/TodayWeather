// Task-owned S3 protocol subset; never relays requests and does not validate SigV4 crypto/IAM.
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
#[derive(Clone, Copy, Default)]
pub enum Fault {
    #[default]
    None,
    DropAfterPut,
    ErrorAfterPut,
    ErrorBeforePut,
    Head403AfterPut,
    Head503AfterPut,
    Get403AfterPut,
    Get503AfterPut,
    RejectPut403,
    DelayedGet,
    ConflictBeforePut,
    ConflictExisting,
    WrongHead,
    Slow,
}
#[derive(Default)]
pub struct PeerState {
    pub objects: BTreeMap<String, (BTreeMap<String, String>, Vec<u8>)>,
    pub calls: Vec<(String, String)>,
    pub fault: Fault,
    pub credential_ids: Vec<String>,
    pub get_inflight: usize,
    pub max_get_inflight: usize,
}
pub struct Peer {
    pub endpoint: String,
    pub state: Arc<Mutex<PeerState>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Peer {
    pub fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(PeerState::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let s = state.clone();
        let flag = stop.clone();
        let thread = thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let s = s.clone();
                        thread::spawn(move || serve(stream, s));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            endpoint,
            state,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take().unwrap().join().unwrap();
    }
}
fn serve(mut stream: TcpStream, state: Arc<Mutex<PeerState>>) {
    // macOS inherits nonblocking from the listener; reads must wait for delayed headers.
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut byte = [0; 1];
    while !bytes.ends_with(b"\r\n\r\n") {
        if bytes.len() >= 8192 {
            return;
        }
        if stream.read_exact(&mut byte).is_err() {
            return;
        }
        bytes.push(byte[0]);
    }
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return;
    };
    let mut lines = text.split("\r\n");
    let line = lines.next().unwrap();
    let parts: Vec<_> = line.split_whitespace().collect();
    if parts.len() != 3 {
        return;
    }
    let method = parts[0].to_owned();
    let target = parts[1].to_owned();
    let key = target
        .split('?')
        .next()
        .unwrap()
        .strip_prefix("/records/")
        .unwrap_or("")
        .to_owned();
    let mut headers = BTreeMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    if key.is_empty() || !target.contains("X-Amz-Signature=") || !target.contains("server2-local") {
        respond(&mut stream, 403, BTreeMap::new(), b"", false);
        return;
    }
    let length = headers
        .get("content-length")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if length > 1024 * 1024 {
        return;
    }
    let mut body = vec![0; length];
    if stream.read_exact(&mut body).is_err() {
        return;
    }
    let mut s = state.lock().unwrap();
    s.calls.push((method.clone(), key.clone()));
    // Keep only the dummy access-key ID, never the signed URL or session credential material.
    if let Some(credential) = target.split("X-Amz-Credential=").nth(1) {
        s.credential_ids.push(
            credential
                .split("%2F")
                .next()
                .unwrap()
                .split('&')
                .next()
                .unwrap()
                .into(),
        );
    }
    let fault = s.fault;
    if matches!(fault, Fault::Slow) {
        drop(s);
        thread::sleep(Duration::from_millis(200));
        respond(&mut stream, 503, BTreeMap::new(), b"", false);
        return;
    }
    if method == "PUT" {
        if matches!(
            fault,
            Fault::DropAfterPut
                | Fault::ErrorAfterPut
                | Fault::ErrorBeforePut
                | Fault::ConflictBeforePut
                | Fault::ConflictExisting
        ) {
            s.fault = Fault::None;
        }
        if headers.get("if-none-match").map(String::as_str) != Some("*")
            || headers.get("content-md5") != Some(&STANDARD.encode(Md5::digest(&body)))
        {
            drop(s);
            respond(&mut stream, 400, BTreeMap::new(), b"", false);
            return;
        }
        if matches!(fault, Fault::RejectPut403) {
            drop(s);
            respond(&mut stream, 403, BTreeMap::new(), b"", false);
            return;
        }
        if s.objects.contains_key(&key) {
            drop(s);
            respond(
                &mut stream,
                if matches!(fault, Fault::ConflictExisting) {
                    409
                } else {
                    412
                },
                BTreeMap::new(),
                b"",
                false,
            );
            return;
        }
        if matches!(fault, Fault::ErrorBeforePut | Fault::ConflictBeforePut) {
            drop(s);
            respond(
                &mut stream,
                if matches!(fault, Fault::ConflictBeforePut) {
                    409
                } else {
                    500
                },
                BTreeMap::new(),
                b"",
                false,
            );
            return;
        }
        let metadata = headers
            .into_iter()
            .filter(|(k, _)| k.starts_with("x-amz-meta-"))
            .collect();
        s.objects.insert(key, (metadata, body));
        drop(s);
        if matches!(fault, Fault::DropAfterPut) {
            return;
        }
        respond(
            &mut stream,
            if matches!(
                fault,
                Fault::ErrorAfterPut
                    | Fault::Head403AfterPut
                    | Fault::Head503AfterPut
                    | Fault::Get403AfterPut
                    | Fault::Get503AfterPut
            ) {
                500
            } else {
                200
            },
            BTreeMap::new(),
            b"",
            false,
        );
        return;
    }
    let failure = match (method.as_str(), fault) {
        ("HEAD", Fault::Head403AfterPut) | ("GET", Fault::Get403AfterPut) => Some(403),
        ("HEAD", Fault::Head503AfterPut) | ("GET", Fault::Get503AfterPut) => Some(503),
        _ => None,
    };
    if let Some(status) = failure {
        drop(s);
        respond(&mut stream, status, BTreeMap::new(), b"", false);
        return;
    }
    let delayed = method == "GET" && matches!(fault, Fault::DelayedGet);
    if delayed {
        s.get_inflight += 1;
        s.max_get_inflight = s.max_get_inflight.max(s.get_inflight);
    }
    let Some((mut metadata, body)) = s.objects.get(&key).cloned() else {
        drop(s);
        respond(&mut stream, 404, BTreeMap::new(), b"", false);
        return;
    };
    drop(s);
    if delayed {
        thread::sleep(Duration::from_millis(50));
    }
    if method == "HEAD" && matches!(fault, Fault::WrongHead) {
        metadata.insert("x-amz-meta-s2-record".into(), "corrupt".into());
    }
    metadata.insert("content-type".into(), "application/gzip".into());
    respond(&mut stream, 200, metadata, &body, method == "HEAD");
    if delayed {
        state.lock().unwrap().get_inflight -= 1;
    }
}
fn respond(
    stream: &mut TcpStream,
    status: u16,
    headers: BTreeMap<String, String>,
    body: &[u8],
    head: bool,
) {
    let protocol = "HTTP/1.1";
    let mut response = format!(
        "{protocol} {status} Result\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in headers {
        response.push_str(&format!("{k}: {v}\r\n"));
    }
    response.push_str("\r\n");
    let _ = stream.write_all(response.as_bytes());
    if !head {
        let _ = stream.write_all(body);
    }
}
