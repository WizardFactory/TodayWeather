//! Shared S18a test helpers: an in-memory conditional-write object store with fault injection,
//! a fixed clock, oracle-compatible ObjectIds and the pinned legacy oracle fixture.
#![allow(dead_code)]
use axum::{body::Body as HttpBody, extract::Request};
use base64::{Engine, engine::general_purpose::STANDARD};
use server2::{
    budget::{BudgetError, Clock},
    gateway::OrderedJson,
    push::{
        Coll, OidSource, PushConfig, PushService, Record, State,
        durable::{Counters, Durable, DurableConfig},
        ejson,
        store::{Change, Oid},
    },
    storage::{
        CatalogTransport, ControlObject, Error, Object, ObjectTransport, PreparedRecord,
        WriteCondition,
    },
    world::js::{Obj, Val},
};
use std::{
    collections::{BTreeMap, VecDeque},
    io::Read,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicUsize, Ordering},
    },
    time::Duration,
};

/// What the double does with the next matching PUT.
#[derive(Clone, Debug, PartialEq)]
pub enum Fault {
    /// Answer this status without storing.
    Reject(u16),
    /// Store the body, then fail as a lost response (transport error).
    CommitLost,
    /// Store nothing and fail as a transport error (outcome unknown to the caller).
    Lost,
    /// Store nothing; the caller's timeout fires first.
    Hang,
    /// `Lost`, and the next read of the same key fails too.
    LostUnreadable,
    /// `CommitLost`, and the next read of the same key fails too.
    CommitLostUnreadable,
}

#[derive(Default)]
struct Inner {
    objects: BTreeMap<String, (Vec<u8>, String)>,
    put_faults: VecDeque<(String, Fault)>,
    get_faults: VecDeque<(String, usize)>,
    puts: Vec<String>,
}

/// In-memory S3 control-object store: `If-None-Match: *`/`If-Match` semantics, md5 ETags.
#[derive(Clone, Default)]
pub struct MemS3 {
    inner: Arc<Mutex<Inner>>,
    pub gets: Arc<AtomicUsize>,
}
impl MemS3 {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn fault_put(&self, prefix: &str, fault: Fault) {
        self.inner
            .lock()
            .unwrap()
            .put_faults
            .push_back((prefix.to_owned(), fault));
    }
    /// The next `count` GETs of keys under `prefix` fail with a transport error.
    pub fn fault_gets(&self, prefix: &str, count: usize) {
        self.inner
            .lock()
            .unwrap()
            .get_faults
            .push_back((prefix.to_owned(), count));
    }
    pub fn keys(&self, prefix: &str) -> Vec<String> {
        self.inner
            .lock()
            .unwrap()
            .objects
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect()
    }
    pub fn body(&self, key: &str) -> Option<Vec<u8>> {
        self.inner
            .lock()
            .unwrap()
            .objects
            .get(key)
            .map(|(b, _)| b.clone())
    }
    pub fn put_count(&self, prefix: &str) -> usize {
        self.inner
            .lock()
            .unwrap()
            .puts
            .iter()
            .filter(|k| k.starts_with(prefix))
            .count()
    }
    /// Store a body directly (another writer).
    pub fn insert(&self, key: &str, body: &[u8]) {
        let tag = etag(body);
        self.inner
            .lock()
            .unwrap()
            .objects
            .insert(key.to_owned(), (body.to_vec(), tag));
    }
}
fn etag(body: &[u8]) -> String {
    use md5::{Digest, Md5};
    format!("\"{:x}\"", Md5::digest(body))
}
impl ObjectTransport for MemS3 {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Err(Error::Invalid("raw records are not used by push state"))
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::Invalid("raw records are not used by push state"))
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::Invalid("raw records are not used by push state"))
    }
}
impl CatalogTransport for MemS3 {
    async fn get_control(&self, key: &str, _maximum: usize) -> Result<ControlObject, Error> {
        self.gets.fetch_add(1, Ordering::SeqCst);
        let mut inner = self.inner.lock().unwrap();
        if let Some(slot) = inner
            .get_faults
            .iter_mut()
            .find(|(p, n)| key.starts_with(p.as_str()) && *n > 0)
        {
            slot.1 -= 1;
            return Err(Error::Transport);
        }
        match inner.objects.get(key) {
            Some((body, tag)) => Ok(ControlObject {
                body: body.clone(),
                etag: tag.clone(),
                version: None,
            }),
            None => Err(Error::NotFound),
        }
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let fault = {
            let mut inner = self.inner.lock().unwrap();
            inner.puts.push(key.to_owned());
            let position = inner
                .put_faults
                .iter()
                .position(|(p, _)| key.starts_with(p.as_str()));
            position
                .and_then(|i| inner.put_faults.remove(i))
                .map(|(_, f)| f)
        };
        if matches!(
            fault,
            Some(Fault::LostUnreadable | Fault::CommitLostUnreadable)
        ) {
            self.fault_gets(key, 1);
        }
        match fault {
            Some(Fault::Reject(status)) => return Ok(status),
            Some(Fault::Lost | Fault::LostUnreadable) => return Err(Error::Transport),
            Some(Fault::Hang) => {
                tokio::time::sleep(Duration::from_secs(3600)).await;
                return Err(Error::Timeout);
            }
            _ => (),
        }
        let status = {
            let mut inner = self.inner.lock().unwrap();
            let current = inner.objects.get(key).map(|(_, t)| t.clone());
            let allowed = match condition {
                WriteCondition::Absent => current.is_none(),
                WriteCondition::Match(tag) => current.as_deref() == Some(tag.as_str()),
            };
            if allowed {
                inner
                    .objects
                    .insert(key.to_owned(), (body.to_vec(), etag(body)));
                200
            } else {
                412
            }
        };
        if matches!(fault, Some(Fault::CommitLost | Fault::CommitLostUnreadable)) && status == 200 {
            return Err(Error::Transport);
        }
        Ok(status)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid("listing is not used by push state"))
    }
}

pub struct FixedClock(pub AtomicI64);
impl FixedClock {
    pub fn at(iso: &str) -> Arc<Self> {
        Arc::new(Self(AtomicI64::new(ms(iso))))
    }
    pub fn set(&self, iso: &str) {
        self.0.store(ms(iso), Ordering::SeqCst);
    }
}
impl Clock for FixedClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
pub fn ms(iso: &str) -> i64 {
    server2::warnings::js::parse_iso(iso).unwrap()
}

/// The oracle's ObjectIds: seconds, `a5a5a5a5a5`, a counter from 1.
pub struct OracleIds(pub u32);
impl OidSource for OracleIds {
    fn next(&mut self, now_ms: f64) -> Oid {
        self.0 += 1;
        let mut oid = [0xa5u8; 12];
        oid[..4].copy_from_slice(&((now_ms / 1000.).floor() as u32).to_be_bytes());
        oid[9..].copy_from_slice(&self.0.to_be_bytes()[1..]);
        oid
    }
}

pub fn fast_config() -> PushConfig {
    PushConfig {
        wait: Duration::from_secs(9),
        min_remaining: Duration::from_millis(1),
        queue: 64,
        restore_retry: Duration::from_millis(50),
        durable: DurableConfig {
            op_deadline: Duration::from_millis(300),
            ..DurableConfig::default()
        },
    }
}

pub async fn start(s3: &MemS3, clock: Arc<FixedClock>, config: PushConfig) -> Arc<PushService> {
    let service = PushService::start(Arc::new(s3.clone()), clock, Box::new(OracleIds(0)), config);
    for _ in 0..200 {
        if service.ready() {
            return service;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("push state did not restore");
}

/// Seed records as the first journal entry (natural order = list order).
pub async fn seed(s3: &MemS3, records: &[(Coll, Record)]) {
    if records.is_empty() {
        return;
    }
    let changes: Vec<Change> = records
        .iter()
        .enumerate()
        .map(|(n, (c, r))| Change {
            coll: *c,
            n: n as u64,
            oid: r.oid,
            record: Some(r.clone()),
            imported: None,
        })
        .collect();
    let mut durable = Durable::new(
        Arc::new(s3.clone()),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    let state = durable.restore().await.unwrap();
    assert_eq!(
        durable
            .commit(state.seq + 1, &changes, records.len() as u64)
            .await,
        server2::push::durable::Commit::Committed
    );
}

pub fn oracle() -> serde_json::Value {
    let gz = include_bytes!("fixtures/push-oracle.json.gz");
    let mut text = String::new();
    flate2::read::GzDecoder::new(&gz[..])
        .read_to_string(&mut text)
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

/// An oracle collection document (`{"_id": {"$oid"}, ...}`) as a record.
pub fn record(doc: &serde_json::Value) -> Record {
    let parsed = OrderedJson::parse(&serde_json::to_vec(doc).unwrap()).unwrap();
    let OrderedJson::Object(entries) = &parsed else {
        panic!("document");
    };
    let mut out = Obj::new();
    let mut oid = None;
    for (k, v) in entries {
        let k = String::from_utf16_lossy(k);
        if k == "_id" {
            oid = ejson::read_oid(v);
        } else {
            out.set(&k, ejson::read_val(v).unwrap());
        }
    }
    Record {
        oid: oid.expect("oid"),
        doc: out,
    }
}

/// The exact request the oracle sent.
pub fn request(step: &serde_json::Value) -> Request {
    let req = &step["request"];
    let sent = &step["sent"];
    let mut builder = Request::builder()
        .method(req["method"].as_str().unwrap())
        .uri(req["path"].as_str().unwrap());
    for (k, v) in sent["headers"].as_object().unwrap() {
        builder = builder.header(k.as_str(), v.as_str().unwrap());
    }
    let body = match sent["body_base64"].as_str() {
        Some(b) => STANDARD.decode(b).unwrap(),
        None => Vec::new(),
    };
    builder.body(HttpBody::from(body)).unwrap()
}

pub async fn body(response: axum::response::Response) -> Vec<u8> {
    axum::body::to_bytes(response.into_body(), 1 << 24)
        .await
        .unwrap()
        .to_vec()
}

/// Order-insensitive BSON equality of two documents.
pub fn same_fields(a: &Obj, b: &Obj) -> bool {
    a.entries().len() == b.entries().len() && a.entries().iter().all(|(k, v)| value_eq(v, b.get(k)))
}
fn value_eq(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Obj(x), Val::Obj(y)) => same_fields(x, y),
        (Val::Arr(x), Val::Arr(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| value_eq(a, b))
        }
        (Val::Num(x), Val::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => a == b,
    }
}

/// The state's records of one collection in natural order.
pub fn records(state: &State, c: Coll) -> Vec<Record> {
    state.coll(c).iter().map(|(_, r)| r.clone()).collect()
}
