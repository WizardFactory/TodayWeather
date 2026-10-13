//! S14 test doubles: in-memory demand transport, scripted capture source/publisher and the
//! owned S06 loopback S3 peer. TEST ONLY; nothing here reaches a provider or AWS.
#![allow(dead_code)]
use rusty_s3::Credentials;
use server2::domestic::family::{DataGoKrRequest, WebFamily, WebRequest};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::history::Grid;
use server2::history::capture::{CaptureSource, Publisher};
use server2::history::demand::{DemandError, DemandObject, DemandPage, DemandTransport};
use server2::resolver::Acquisition;
use server2::storage::{
    CatalogId, CatalogLimits, GroupDeclaration, GroupMember, HttpS3Transport, ProviderKey,
    RawRecord, WriteCondition,
};
use std::{
    collections::{BTreeMap, VecDeque},
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

pub fn g(nx: u16, ny: u16) -> Grid {
    Grid::new(nx, ny).unwrap()
}
pub fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
pub fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture_path(name)).unwrap()
}
pub fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/history/fixtures")
        .join(name)
}
pub fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(5)
}
pub const HOUR: i64 = 3_600_000;
pub const DAY: i64 = 24 * HOUR;

/// Volatile conditional object map with S3-like ETags and paged listing.
#[derive(Default)]
pub struct MemoryDemand {
    pub objects: Mutex<BTreeMap<String, (Vec<u8>, u64)>>,
    pub puts: AtomicUsize,
    pub gets: AtomicUsize,
    pub page_size: usize,
    /// Number of upcoming PUTs answered 412 after a concurrent writer replaced the object.
    pub conflicts: AtomicUsize,
}
impl MemoryDemand {
    pub fn paged(page_size: usize) -> Self {
        Self {
            page_size,
            ..Self::default()
        }
    }
    pub fn raw(&self, key: &str) -> Option<Vec<u8>> {
        self.objects
            .lock()
            .unwrap()
            .get(key)
            .map(|(b, _)| b.clone())
    }
    /// Plant an object directly, as another writer or a tampered store would.
    pub fn plant(&self, key: &str, body: &[u8]) {
        let mut map = self.objects.lock().unwrap();
        let version = map.get(key).map_or(1, |(_, v)| v + 1);
        map.insert(key.into(), (body.to_vec(), version));
    }
}
impl DemandTransport for MemoryDemand {
    async fn get_demand(&self, key: &str) -> Result<Option<DemandObject>, DemandError> {
        self.gets.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .objects
            .lock()
            .unwrap()
            .get(key)
            .map(|(body, v)| DemandObject {
                body: body.clone(),
                etag: format!("\"{v}\""),
            }))
    }
    async fn put_demand(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, DemandError> {
        self.puts.fetch_add(1, Ordering::SeqCst);
        let mut map = self.objects.lock().unwrap();
        if self
            .conflicts
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            let version = map.get(key).map_or(1, |(_, v)| v + 1);
            let body = map.get(key).map(|(b, _)| b.clone()).unwrap_or_default();
            if !body.is_empty() {
                map.insert(key.into(), (body, version));
            }
            return Ok(412);
        }
        let current = map.get(key).map(|(_, v)| format!("\"{v}\""));
        let ok = match condition {
            WriteCondition::Absent => current.is_none(),
            WriteCondition::Match(etag) => current.as_deref() == Some(etag.as_str()),
        };
        if !ok {
            return Ok(412);
        }
        let version = map.get(key).map_or(1, |(_, v)| v + 1);
        map.insert(key.into(), (body.to_vec(), version));
        Ok(200)
    }
    async fn list_demand(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<DemandPage, DemandError> {
        let size = if self.page_size == 0 {
            1000
        } else {
            self.page_size
        };
        let map = self.objects.lock().unwrap();
        let keys: Vec<String> = map
            .keys()
            .filter(|k| k.starts_with(prefix) && token.is_none_or(|t| k.as_str() > t))
            .cloned()
            .collect();
        let next = (keys.len() > size).then(|| keys[size - 1].clone());
        Ok(DemandPage {
            keys: keys.into_iter().take(size).collect(),
            next,
        })
    }
}

/// One acquisition group with a single synthetic page, as S13 would return for `kind`.
pub fn acquisition(
    source: &str,
    kind: &str,
    key: &ProviderKey,
    publication: Publication,
    fetched_at_ms: u64,
    body: &[u8],
) -> Acquisition {
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        source,
        kind,
        key,
        publication.period(),
        fetched_at_ms,
        200,
        "application/json",
        None,
        Arc::from(body),
        &limits.raw,
    )
    .unwrap();
    let partition = if source == "kma-web" && kind != "town-rss" {
        publication.base_date()
    } else {
        publication.partition()
    };
    let declaration = GroupDeclaration::new(
        vec![GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, &partition).unwrap()],
        }],
        &limits,
    )
    .unwrap();
    Acquisition {
        declaration,
        records: vec![record],
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Requested {
    Funded {
        kind: &'static str,
        nx: u16,
        ny: u16,
        publication: Publication,
    },
    Web {
        kind: &'static str,
        publication: Option<Publication>,
    },
}

/// Scripted S13 stand-in. Unscripted requests answer one complete synthetic page whose
/// publication is the requested one (the minute page answers `minute`).
pub struct FakeSource {
    pub calls: Mutex<Vec<Requested>>,
    pub script: Mutex<VecDeque<Result<Option<Acquired>, DomesticError>>>,
    pub minute: Mutex<Publication>,
    pub fetched_at: AtomicUsize,
    pub funding_left: Mutex<Option<usize>>,
}
impl FakeSource {
    pub fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            script: Mutex::new(VecDeque::new()),
            minute: Mutex::new(p(20261013, 1200)),
            fetched_at: AtomicUsize::new(1),
            funding_left: Mutex::new(None),
        }
    }
    pub fn calls(&self) -> Vec<Requested> {
        self.calls.lock().unwrap().clone()
    }
    pub fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
    /// Next answers in order; `Ok(None)` means the default complete page.
    pub fn push(&self, answer: Result<Option<Acquired>, DomesticError>) {
        self.script.lock().unwrap().push_back(answer);
    }
    pub fn funding(&self, calls: usize) {
        *self.funding_left.lock().unwrap() = Some(calls);
    }
    fn next(&self) -> Option<Result<Option<Acquired>, DomesticError>> {
        self.script.lock().unwrap().pop_front()
    }
    fn fetched(&self) -> u64 {
        1_790_000_000_000 + self.fetched_at.fetch_add(1, Ordering::SeqCst) as u64
    }
}
impl CaptureSource for FakeSource {
    async fn acquire(
        &self,
        request: &DataGoKrRequest,
        _deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let (nx, ny) = match request.target() {
            server2::domestic::family::Target::Grid { nx, ny } => (*nx, *ny),
            _ => panic!("capture requested a non-grid target"),
        };
        let kind = request.family().kind();
        self.calls.lock().unwrap().push(Requested::Funded {
            kind,
            nx,
            ny,
            publication: request.publication(),
        });
        {
            let mut left = self.funding_left.lock().unwrap();
            if let Some(n) = left.as_mut() {
                if *n == 0 {
                    return Err(DomesticError::Funding(
                        server2::budget::BudgetError::Exhausted,
                    ));
                }
                *n -= 1;
            }
        }
        if let Some(answer) = self.next()
            && let Some(a) = answer?
        {
            return Ok(a);
        }
        // S13 stores the ultra-short forecast under its canonical HH00 period.
        let publication = if kind == "ultra-srt-fcst" {
            request.publication().hour_start()
        } else {
            request.publication()
        };
        Ok(Acquired::Complete(acquisition(
            "data-go-kr",
            kind,
            &request.provider_key(),
            publication,
            self.fetched(),
            format!("{kind}:{nx}:{ny}:{}", publication.compact()).as_bytes(),
        )))
    }
    async fn acquire_web(
        &self,
        request: &WebRequest,
        _deadline: Instant,
    ) -> Result<Acquired, DomesticError> {
        let kind = request.family().kind();
        self.calls.lock().unwrap().push(Requested::Web {
            kind,
            publication: request.publication(),
        });
        if let Some(answer) = self.next()
            && let Some(a) = answer?
        {
            return Ok(a);
        }
        let publication = match request.family() {
            WebFamily::AwsMinute => *self.minute.lock().unwrap(),
            _ => request.publication().unwrap(),
        };
        Ok(Acquired::Complete(acquisition(
            "kma-web",
            kind,
            &request.provider_key(),
            publication,
            self.fetched(),
            format!("{kind}:{}", publication.compact()).as_bytes(),
        )))
    }
}

#[derive(Default)]
pub struct FakePublisher {
    pub published: Mutex<Vec<Acquisition>>,
    pub fail: AtomicUsize,
}
impl Publisher for FakePublisher {
    async fn publish(
        &self,
        acquisition: Acquisition,
        _deadline: Instant,
    ) -> Result<(), server2::storage::Error> {
        if self
            .fail
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            return Err(server2::storage::Error::Transport);
        }
        self.published.lock().unwrap().push(acquisition);
        Ok(())
    }
}

/// The owned S06 loopback S3 fault peer (`tests/storage/catalog_peer.py`).
pub struct Peer {
    child: Child,
    pub endpoint: String,
}
impl Peer {
    pub fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line);
            let _ = tx.send(result.map(|_| line));
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(endpoint)) if endpoint.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: endpoint.trim().to_owned(),
            },
            other => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("peer startup failure: {other:?}");
            }
        }
    }
    pub fn transport(&self) -> HttpS3Transport {
        HttpS3Transport::new(
            &self.endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap()
    }
    pub async fn status(&self) -> serde_json::Value {
        let bytes = reqwest::Client::new()
            .get(format!("{}__catalog/status", self.endpoint))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
    pub async fn count(&self, method_prefix: &str) -> u64 {
        self.status()
            .await
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with(method_prefix))
            .map(|(_, v)| v.as_u64().unwrap())
            .sum()
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Run the offline converter with `python3`, returning (exit code, stdout, stderr).
pub fn convert(args: &[&str]) -> (i32, String, String) {
    let out = Command::new("python3")
        .arg("tools/migration/export_history_seeds.py")
        .args(args)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}
pub fn temp_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "server2-s14-{}-{}",
        std::process::id(),
        name.replace('/', "_")
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("out.jsonl")
}
