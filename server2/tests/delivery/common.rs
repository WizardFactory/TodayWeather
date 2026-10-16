//! S18b-1 test doubles: a recording weather fetcher, a loopback Google OAuth/FCM double with
//! scripted answers (JSON, text, connection reset, hang), recording diagnostics, and test
//! Firebase service accounts keyed with the public RFC 7515 A.2 example RSA key.
#![allow(dead_code)]
use super::state_common::*;
use server2::{
    gateway::{BoxFuture, OrderedJson},
    push::{
        Coll, PushService, Record,
        deliver::{AlarmWorker, Diagnostics, Endpoints, Event, Fcm, Fetch, Servers},
    },
    world::js::Val,
};
use std::{
    collections::VecDeque,
    io::Read,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn oracle_text() -> String {
    let gz = include_bytes!("fixtures/alarm-oracle.json.gz");
    let mut text = String::new();
    flate2::read::GzDecoder::new(&gz[..])
        .read_to_string(&mut text)
        .unwrap();
    text
}
pub fn oracle() -> serde_json::Value {
    serde_json::from_str(&oracle_text()).unwrap()
}
/// The fixture with object key order kept (records and weather bodies are order-sensitive).
pub fn oracle_ordered() -> OrderedJson {
    OrderedJson::parse(oracle_text().as_bytes()).unwrap()
}
pub fn items(v: &OrderedJson) -> &[OrderedJson] {
    match v {
        OrderedJson::Array(a) => a,
        _ => &[],
    }
}

/// Scripted answer of the weather double.
#[derive(Clone, Debug)]
pub enum Weather {
    Ok(u16, Vec<u8>),
    Transport,
}
fn weather_of(v: &OrderedJson) -> Weather {
    if v.get("error").is_some() {
        return Weather::Transport;
    }
    let status = v
        .get("status")
        .and_then(OrderedJson::number)
        .unwrap_or(200.) as u16;
    let body = match v.get("body") {
        Some(OrderedJson::String(_)) => v.get("body").unwrap().string().unwrap().into_bytes(),
        Some(other) => other.to_bytes(),
        None => Vec::new(),
    };
    Weather::Ok(status, body)
}

/// Routes like the oracle's `request` double: geocode on `API_SERVER`, `/kma/` and `/dsf/`.
#[derive(Default)]
pub struct WeatherDouble {
    pub kma: Mutex<Option<Weather>>,
    pub dsf: Mutex<Option<Weather>>,
    pub geo: Mutex<Option<Weather>>,
    pub calls: Mutex<Vec<(String, Option<String>)>>,
}
impl WeatherDouble {
    pub fn set(&self, routes: &OrderedJson) {
        let pick = |k: &str| {
            routes
                .get(k)
                .filter(|v| !matches!(v, OrderedJson::Null))
                .map(weather_of)
        };
        *self.kma.lock().unwrap() = pick("kma");
        *self.dsf.lock().unwrap() = pick("dsf");
        *self.geo.lock().unwrap() = pick("geo");
    }
}
impl Fetch for WeatherDouble {
    fn get(
        &self,
        url: String,
        lang: Option<String>,
    ) -> BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        self.calls.lock().unwrap().push((url.clone(), lang));
        let route = if url.starts_with("http://api.test/geocode/") {
            self.geo.lock().unwrap().clone()
        } else if url.contains("/kma/") {
            self.kma.lock().unwrap().clone()
        } else if url.contains("/dsf/") {
            self.dsf.lock().unwrap().clone()
        } else {
            None
        };
        Box::pin(async move {
            match route {
                Some(Weather::Ok(status, body)) => Ok((status, body)),
                _ => Err("transport".into()),
            }
        })
    }
}

/// Scripted answer of the Google double.
#[derive(Clone, Debug)]
pub enum Answer {
    Json(u16, String),
    Text(u16, String),
    /// Test-owned OAuth barrier; no runtime configuration.
    Held(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>, String),
    /// Read the request, then close the connection without an answer.
    Reset,
    /// Read the request and never answer.
    Hang,
}
pub fn answer_of(v: &serde_json::Value) -> Answer {
    if v.get("error").is_some() {
        return Answer::Reset;
    }
    let status = v["status"].as_u64().unwrap() as u16;
    let body = v["body"].as_str().unwrap().to_owned();
    let ct = v["headers"]["content-type"]
        .as_str()
        .unwrap_or("application/json");
    if ct.contains("text/") {
        Answer::Text(status, body)
    } else {
        Answer::Json(status, body)
    }
}

#[derive(Clone, Debug)]
pub struct Recorded {
    pub path: String,
    pub authorization: Option<String>,
    pub body: String,
}

#[derive(Default)]
pub struct GoogleState {
    pub token: Mutex<VecDeque<Answer>>,
    pub fcm: Mutex<VecDeque<Answer>>,
    pub requests: Mutex<Vec<Recorded>>,
}
pub const DEFAULT_TOKEN: &str =
    r#"{"access_token":"ya29.oracle-token","expires_in":3599,"token_type":"Bearer"}"#;
pub const DEFAULT_SEND: &str = r#"{"name":"projects/oracle/messages/1"}"#;

pub struct GoogleDouble {
    pub root: String,
    pub state: Arc<GoogleState>,
}
impl GoogleDouble {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}/", listener.local_addr().unwrap());
        let state = Arc::new(GoogleState::default());
        let s = state.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let s = s.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head_end, length) = loop {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&buf[..i]).to_ascii_lowercase();
                            let length = head
                                .lines()
                                .find_map(|l| {
                                    l.strip_prefix("content-length:")
                                        .map(|v| v.trim().parse::<usize>().unwrap())
                                })
                                .unwrap_or(0);
                            break (i + 4, length);
                        }
                    };
                    while buf.len() < head_end + length {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                    let authorization = head.lines().find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.eq_ignore_ascii_case("authorization")
                            .then(|| v.trim().to_owned())
                    });
                    let body =
                        String::from_utf8_lossy(&buf[head_end..head_end + length]).to_string();
                    s.requests.lock().unwrap().push(Recorded {
                        path: path.clone(),
                        authorization,
                        body,
                    });
                    let answer = if path.ends_with("/o/oauth2/token") {
                        s.token
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or(Answer::Json(200, DEFAULT_TOKEN.into()))
                    } else {
                        s.fcm
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or(Answer::Json(200, DEFAULT_SEND.into()))
                    };
                    let (status, ct, text) = match answer {
                        Answer::Reset => return,
                        Answer::Hang => {
                            tokio::time::sleep(Duration::from_secs(3600)).await;
                            return;
                        }
                        Answer::Held(started, release, b) => {
                            started.notify_one();
                            release.notified().await;
                            (200, "application/json; charset=UTF-8", b)
                        }
                        Answer::Json(s, b) => (s, "application/json; charset=UTF-8", b),
                        Answer::Text(s, b) => (s, "text/html", b),
                    };
                    let crlf = "\r\n";
                    let reply = format!(
                        "HTTP/1.1 {status} X{crlf}content-type: {ct}{crlf}content-length: {}{crlf}connection: close{crlf}{crlf}{text}",
                        text.len()
                    );
                    let _ = socket.write_all(reply.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        Self { root, state }
    }
    pub fn sends(&self) -> Vec<Recorded> {
        self.state
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path.contains("messages:send"))
            .cloned()
            .collect()
    }
    pub fn tokens(&self) -> Vec<Recorded> {
        self.state
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path.ends_with("/o/oauth2/token"))
            .cloned()
            .collect()
    }
    pub fn clear(&self) {
        self.state.requests.lock().unwrap().clear();
    }
}

/// A service-account file for `project` with the RFC 7515 A.2 example key (public test vector,
/// not a credential), in a temporary directory.
pub fn account_file(dir: &std::path::Path, product: &str, project: &str) -> std::path::PathBuf {
    let der = include_str!("fixtures/rfc7515-a2-key.pkcs8.b64").trim();
    let mut pem = String::from("-----BEGIN PRIVATE KEY-----\n");
    for chunk in der.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap());
        pem.push('\n');
    }
    pem.push_str("-----END PRIVATE KEY-----\n");
    let json = serde_json::json!({"type": "service_account", "project_id": project, "private_key_id": "oracle",
        "private_key": pem, "client_email": format!("oracle@{project}.iam.gserviceaccount.com")});
    let path = dir.join(format!("fcm-test-{product}.json"));
    std::fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    path
}

pub fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("s18b-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn fcm(google: &GoogleDouble, dir: &std::path::Path) -> Fcm {
    let tw = account_file(dir, "todayWeather", "tw-oracle");
    let ta = account_file(dir, "todayAir", "ta-oracle");
    let var = move |name: &str| match name {
        "SERVER2_FIREBASE_TODAYWEATHER" => Some(tw.to_string_lossy().into_owned()),
        "SERVER2_FIREBASE_TODAYAIR" => Some(ta.to_string_lossy().into_owned()),
        _ => None,
    };
    Fcm::from_vars(&var, Endpoints::loopback(&google.root)).unwrap()
}

#[derive(Default)]
pub struct Recorder {
    pub events: Mutex<Vec<Event>>,
    pub minutes: Mutex<Vec<String>>,
}
impl Diagnostics for Recorder {
    fn delivery(&self, e: &Event) {
        self.events.lock().unwrap().push(e.clone());
    }
    fn minute(&self, minute: &str, note: &'static str) {
        self.minutes
            .lock()
            .unwrap()
            .push(format!("{minute} {note}"));
    }
}

pub struct Rig {
    pub s3: MemS3,
    pub clock: Arc<FixedClock>,
    pub push: Arc<PushService>,
    pub weather: Arc<WeatherDouble>,
    pub google: GoogleDouble,
    pub diagnostics: Arc<Recorder>,
    pub worker: AlarmWorker<MemS3>,
}
pub fn servers() -> Servers {
    Servers {
        service: "http://service.test".into(),
        api: "http://api.test".into(),
    }
}
pub async fn rig(
    name: &str,
    at: &str,
    records: &[(Coll, Record)],
    send_timeout: Option<Duration>,
) -> Rig {
    let s3 = MemS3::new();
    seed(&s3, records).await;
    rig_with(s3, name, at, send_timeout).await
}
async fn rig_with(s3: MemS3, name: &str, at: &str, send_timeout: Option<Duration>) -> Rig {
    let clock = FixedClock::at(at);
    let push = start(&s3, clock.clone(), fast_config()).await;
    let weather = Arc::new(WeatherDouble::default());
    let google = GoogleDouble::start().await;
    let mut fcm = fcm(&google, &temp_dir(name));
    if let Some(t) = send_timeout {
        fcm = fcm.with_send_timeout(t);
    }
    let diagnostics = Arc::new(Recorder::default());
    let worker = AlarmWorker::new(
        push.clone(),
        Arc::new(s3.clone()),
        weather.clone(),
        Arc::new(fcm),
        servers(),
        clock.clone(),
        diagnostics.clone(),
    );
    Rig {
        s3,
        clock,
        push,
        weather,
        google,
        diagnostics,
        worker,
    }
}

/// A stored alarm document from oracle JSON (`updatedAt` ISO strings become dates).
pub fn alarm_record(n: u8, info: &OrderedJson) -> Record {
    let mut doc = server2::world::js::Obj::new();
    if let Val::Obj(o) = Val::from_ordered(info) {
        for (k, val) in o.entries() {
            if k == "updatedAt" {
                let ms = server2::warnings::js::parse_iso(val.str().unwrap()).unwrap();
                doc.set(k, Val::Date(ms as f64));
            } else {
                doc.set(k, val.clone());
            }
        }
    }
    let mut oid = [0x5au8; 12];
    oid[11] = n;
    Record { oid, doc }
}
