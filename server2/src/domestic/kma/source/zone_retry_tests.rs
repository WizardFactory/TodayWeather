//! KMA-ZONE-NEWEST (design section 11, AK 2026-11-10) and #2819 D1: the forecast-zone memory, its
//! install order, the 10-minute check and the 24-hour acquisition rule. An isolated in-memory
//! store (or an empty one) stands for S3; the tests run on a paused clock with an injected wall
//! clock. The retry admission keeps its real monotonic clock: `expire` ends a claim, for a test
//! only.
use super::*;
use crate::storage::{
    CatalogId, CatalogTransport, ControlObject, Error, GroupDeclaration, GroupMember, ListPage,
    Object, ObjectTransport, Pagination, Period, PreparedRecord, RawRecord, WriteCondition,
};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::SeqCst};
use std::time::Duration;

/// An isolated in-memory S3: raw objects, conditional control objects and the catalog index,
/// with its LISTs counted. It does no I/O, so the paused clock moves only when a test advances
/// it or every task waits for a timer.
#[derive(Clone, Default)]
struct Memory(Arc<Mutex<Objects>>);
#[derive(Default)]
struct Objects {
    raw: BTreeMap<String, Object>,
    control: BTreeMap<String, ControlObject>,
    revision: u64,
    lists: usize,
}
impl Memory {
    fn lists(&self) -> usize {
        self.0.lock().unwrap().lists
    }
}
impl ObjectTransport for Memory {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        let mut objects = self.0.lock().unwrap();
        if objects.raw.contains_key(&record.key) {
            return Ok(412);
        }
        let object = Object {
            metadata: record.metadata.clone(),
            length: record.body.len(),
            body: record.body.clone(),
        };
        objects.raw.insert(record.key.clone(), object);
        Ok(200)
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let objects = self.0.lock().unwrap();
        let object = objects.raw.get(key).ok_or(Error::NotFound)?;
        Ok(Object {
            body: Vec::new(),
            ..object.clone()
        })
    }
    async fn get(&self, key: &str, _: usize) -> Result<Object, Error> {
        let objects = self.0.lock().unwrap();
        objects.raw.get(key).cloned().ok_or(Error::NotFound)
    }
}
impl CatalogTransport for Memory {
    async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
        let objects = self.0.lock().unwrap();
        objects.control.get(key).cloned().ok_or(Error::NotFound)
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let mut objects = self.0.lock().unwrap();
        let agrees = match (condition, objects.control.get(key)) {
            (WriteCondition::Absent, None) => true,
            (WriteCondition::Match(etag), Some(current)) => *etag == current.etag,
            _ => false,
        };
        if !agrees {
            return Ok(412);
        }
        objects.revision += 1;
        let etag = format!("\"v{}\"", objects.revision);
        objects.control.insert(
            key.to_owned(),
            ControlObject {
                body: body.to_vec(),
                etag,
                version: None,
            },
        );
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        panic!("the source lists the catalog index")
    }
}
impl IndexListing for Memory {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, Error> {
        let mut objects = self.0.lock().unwrap();
        objects.lists += 1;
        Ok(ListPage {
            keys: objects
                .control
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect(),
            next: None,
        })
    }
}
struct Never;
impl observe::Acquire for Never {
    fn web(
        &self,
        _: crate::domestic::family::WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<crate::domestic::Acquired, crate::domestic::DomesticError>> {
        Box::pin(async { panic!("unrelated provider") })
    }
    fn asos(
        &self,
        _: crate::domestic::asos::AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<crate::domestic::Acquired, crate::domestic::DomesticError>> {
        Box::pin(async { panic!("unrelated provider") })
    }
}
impl observe::Locate for Never {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { panic!("unrelated geocoder") })
    }
}

/// 2026-11-10 12:00 KST.
fn noon() -> f64 {
    schedule::to_ms(Publication::new(20261110, 1200).unwrap()) as f64
}
/// The KST day of an instant (`YYYYMMDD`), a zone list's partition.
fn day_of(ms: f64) -> u32 {
    crate::domestic::publication::observation_hour(ms as i64)
        .unwrap()
        .date()
}
/// One forecast-zone list of one page fetched at `fetched_at`, as S13b records it: its KST fetch
/// day is the period.
fn records_at(fetched_at: f64, body: &[u8]) -> Vec<RawRecord> {
    vec![
        RawRecord::new(
            "data-go-kr",
            "forecast-zone",
            &ProviderKey::Named {
                id: "forecast-zones".into(),
            },
            Period {
                local_date: day_of(fetched_at),
                slot: "0000".into(),
            },
            fetched_at as u64,
            200,
            "application/json",
            Some(Pagination {
                page: 1,
                pages: 1,
                complete: true,
            }),
            Arc::from(body),
            &crate::storage::Limits::default(),
        )
        .unwrap(),
    ]
}
/// The provider's recorded list: Seoul, Gunwi and a non-city zone.
fn valid() -> Vec<u8> {
    include_bytes!("../../../../tests/formats/fixtures/forecast-zone.json").to_vec()
}
/// A one-page list of city zones (`regId`, `regName`).
fn list(zones: &[(&str, &str)]) -> Vec<u8> {
    let items: Vec<Value> = zones
        .iter()
        .map(|(id, name)| serde_json::json!({"regId": id, "regName": name, "regSp": "C"}))
        .collect();
    let n = items.len();
    serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": n}}}))
    .unwrap()
}
/// A list of Incheon alone.
fn incheon() -> Vec<u8> {
    list(&[("11B20201", "인천")])
}
/// Publish one acquisition's records as one group in its KST-day catalog.
async fn store(memory: &Memory, records: &[RawRecord]) {
    let limits = crate::storage::CatalogLimits::default();
    let members = records
        .iter()
        .map(|r| GroupMember {
            envelope: r.envelope.clone(),
            catalogs: vec![
                CatalogId::for_record(
                    &r.envelope.identity,
                    &format!("{:08}", r.envelope.identity.period.local_date),
                )
                .unwrap(),
            ],
        })
        .collect();
    CatalogStore::new(memory.clone(), limits.clone())
        .unwrap()
        .publish(
            GroupDeclaration::new(members, &limits).unwrap(),
            records.to_vec(),
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
}
fn seoul(zones: &Zones) -> usize {
    zones.find_by_name("서울특별시", "종로구").len()
}
fn incheon_found(zones: &Zones) -> usize {
    zones.find_by_name("인천광역시", "남동구").len()
}

/// The injected wall clock (epoch milliseconds).
type Wall = Arc<AtomicU64>;
fn clock_at(ms: f64) -> Wall {
    Arc::new(AtomicU64::new(ms as u64))
}
fn source(
    memory: &Memory,
    clock: &Wall,
    forecast: Option<Arc<dyn fetch::ForecastAcquire>>,
    observed: bool,
) -> S3Source<Memory> {
    let now = clock.clone();
    let wall: super::super::backend::Clock = Arc::new(move || now.load(SeqCst) as f64);
    let s = if observed {
        let warnings = Arc::new(
            WarningStore::new(
                memory.clone(),
                CatalogLimits::default(),
                StoreConfig::default(),
            )
            .unwrap(),
        );
        S3Source::new_observed_with_warning_store(
            memory.clone(),
            wall,
            Arc::new(Never),
            Arc::new(Never),
            warnings,
        )
        .unwrap()
    } else {
        S3Source::new(memory.clone(), wall, Arc::new(Never), Arc::new(Never)).unwrap()
    };
    let mut s = s.with_forecast(forecast);
    // Unit fixture only: real production retains completed owned results for three seconds.
    s.owned = crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
        retain: Duration::ZERO,
        ..Default::default()
    })
    .unwrap();
    s
}
/// One request's zone read at the wall clock's instant; then the paused clock lets an owned
/// acquisition the read started run to its end.
async fn read(s: &S3Source<Memory>, clock: &Wall) -> Arc<Zones> {
    let zones = s
        .zones(
            clock.load(SeqCst) as f64,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    zones
}
fn expire(s: &S3Source<Memory>) {
    // Test-only expiry, not a production clock, mode or retry override.
    s.attempts.state.lock().unwrap().0.remove("forecast-zones");
}

/// A provider double: each call answers what `answer` makes of its number (0 first), and a held
/// answer waits until [`Provider::release`].
struct Provider {
    calls: AtomicUsize,
    answer: Box<dyn Fn(usize) -> Answer + Send + Sync>,
    open: tokio::sync::watch::Sender<bool>,
}
enum Answer {
    Failure,
    Nothing,
    Panic,
    Records(Vec<RawRecord>),
    /// Stored as S13b publishes, then answered.
    Stored(Memory, Vec<RawRecord>),
    Held(Vec<RawRecord>),
}
impl Provider {
    fn new(answer: impl Fn(usize) -> Answer + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            calls: AtomicUsize::new(0),
            answer: Box::new(answer),
            open: tokio::sync::watch::channel(false).0,
        })
    }
    fn calls(&self) -> usize {
        self.calls.load(SeqCst)
    }
    fn release(&self) {
        self.open.send_replace(true);
    }
}
impl fetch::ForecastAcquire for Provider {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        assert_eq!(request, fetch::ForecastRequest::Zones);
        let answer = (self.answer)(self.calls.fetch_add(1, SeqCst));
        let mut open = self.open.subscribe();
        Box::pin(async move {
            match answer {
                Answer::Failure => Err("owned failure".into()),
                Answer::Nothing => Ok(None),
                Answer::Panic => panic!("owned provider panic must not poison zone retry"),
                Answer::Records(records) => Ok(Some(records)),
                Answer::Stored(memory, records) => {
                    store(&memory, &records).await;
                    Ok(Some(records))
                }
                Answer::Held(records) => {
                    let _ = open.wait_for(|open| *open).await;
                    Ok(Some(records))
                }
            }
        })
    }
}

/// D1: a failed acquisition is retried after the existing five-minute admission; its list is
/// installed when it succeeds and is not acquired again while it is fresh (KMA-ZONE-NEWEST:
/// before, success latched the process and memory read S3 again).
#[tokio::test(start_paused = true)]
async fn failed_zone_collection_retries_after_existing_memo() {
    let clock = clock_at(noon());
    let now = noon();
    let f = Provider::new(move |call| {
        if call == 0 {
            Answer::Failure
        } else {
            Answer::Records(records_at(now, &valid()))
        }
    });
    let s = source(&Memory::default(), &clock, Some(f.clone()), false);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 1);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 1, "no immediate retry storm");
    expire(&s);
    read(&s, &clock).await;
    assert_eq!(
        f.calls(),
        2,
        "first failure must not latch process completion"
    );
    assert_eq!(seoul(&*read(&s, &clock).await), 1, "the list is installed");
    expire(&s);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 2, "a fresh installed list is not acquired again");
}

#[derive(Clone, Copy, Debug)]
enum Failure {
    None,
    Panic,
    Empty,
    Malformed,
    Incomplete,
}
/// D1: absent, panicked, empty, unreadable and incomplete results install nothing and stay
/// retryable; the next complete list is installed.
#[tokio::test(start_paused = true)]
async fn absent_panicked_and_unreadable_results_remain_retryable() {
    for first in [
        Failure::None,
        Failure::Panic,
        Failure::Empty,
        Failure::Malformed,
        Failure::Incomplete,
    ] {
        let clock = clock_at(noon());
        let now = noon();
        let f = Provider::new(move |call| {
            if call != 0 {
                return Answer::Records(records_at(now, &valid()));
            }
            match first {
                Failure::None => Answer::Nothing,
                Failure::Panic => Answer::Panic,
                Failure::Empty => Answer::Records(Vec::new()),
                Failure::Malformed => Answer::Records(records_at(now, b"not json")),
                Failure::Incomplete => {
                    let mut body: Value = serde_json::from_slice(&valid()).unwrap();
                    body["response"]["body"]["totalCount"] = Value::from(1001);
                    Answer::Records(records_at(now, &serde_json::to_vec(&body).unwrap()))
                }
            }
        });
        let s = source(&Memory::default(), &clock, Some(f.clone()), false);
        read(&s, &clock).await;
        assert!(
            read(&s, &clock).await.docs().is_empty(),
            "{first:?} installs nothing"
        );
        assert_eq!(f.calls(), 1, "bounded failure: {first:?}");
        expire(&s);
        read(&s, &clock).await;
        assert_eq!(f.calls(), 2, "recover after {first:?}");
        assert_eq!(
            seoul(&*read(&s, &clock).await),
            1,
            "installed after {first:?}"
        );
    }
}

/// D1, INSTALL: a failed acquisition keeps the last good list in memory.
#[tokio::test(start_paused = true)]
async fn a_failed_acquisition_keeps_the_last_good_list() {
    let memory = Memory::default();
    // Stored 30 hours ago: stale, so the read starts an acquisition, which fails.
    store(&memory, &records_at(noon() - 30. * HOUR_MS, &valid())).await;
    let clock = clock_at(noon());
    let f = Provider::new(|_| Answer::Failure);
    let s = source(&memory, &clock, Some(f.clone()), false);
    let first = read(&s, &clock).await;
    assert_eq!(f.calls(), 1);
    let kept = read(&s, &clock).await;
    assert!(
        Arc::ptr_eq(&first, &kept),
        "failure keeps the last good list"
    );
    assert_eq!(kept.docs().len(), 3);
}

/// D1: requests return while one owner continues; its list is installed when it ends, and a
/// fresh installed list ends the acquisitions.
#[tokio::test(start_paused = true)]
async fn requests_return_while_one_owner_continues_and_installs() {
    let clock = clock_at(noon());
    let now = noon();
    let f = Provider::new(move |_| Answer::Held(records_at(now, &valid())));
    let s = source(&Memory::default(), &clock, Some(f.clone()), false);
    read(&s, &clock).await;
    assert!(read(&s, &clock).await.docs().is_empty());
    assert_eq!(f.calls(), 1);
    f.release();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(seoul(&*read(&s, &clock).await), 1, "installed when it ends");
    expire(&s);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 1, "a fresh installed list ends the acquisitions");
}

/// FRESH: a restart whose newest stored list completed an hour ago acquires nothing (before: the
/// first request of every process acquired the list and stored it again).
#[tokio::test(start_paused = true)]
async fn a_restart_with_a_fresh_stored_list_acquires_nothing() {
    let memory = Memory::default();
    store(&memory, &records_at(noon() - HOUR_MS, &valid())).await;
    let clock = clock_at(noon());
    let f = Provider::new(|_| Answer::Failure);
    let s = source(&memory, &clock, Some(f.clone()), false);
    assert_eq!(seoul(&*read(&s, &clock).await), 1);
    assert_eq!(f.calls(), 0);
}

/// FRESH: the stored list is acquired again only once it completed more than 24 h ago.
#[tokio::test(start_paused = true)]
async fn the_list_is_acquired_once_it_completed_more_than_24_hours_ago() {
    for (age, acquired) in [(DAY_MS, 0), (DAY_MS + 1., 1)] {
        let memory = Memory::default();
        store(&memory, &records_at(noon() - age, &valid())).await;
        let clock = clock_at(noon());
        let f = Provider::new(|_| Answer::Failure);
        let s = source(&memory, &clock, Some(f.clone()), false);
        assert_eq!(seoul(&*read(&s, &clock).await), 1);
        assert_eq!(f.calls(), acquired, "a list {age} ms old");
    }
}

/// FRESH: a long-running process acquires the list again once the newest one is more than 24 h
/// old, every time (before: one successful acquisition per process).
#[tokio::test(start_paused = true)]
async fn a_long_running_process_acquires_again_after_24_hours() {
    let memory = Memory::default();
    let start = noon();
    store(&memory, &records_at(start - HOUR_MS, &valid())).await;
    let clock = clock_at(start);
    let (m, c) = (memory.clone(), clock.clone());
    // Each acquisition stores a list of Incheon fetched at the wall clock's instant.
    let f = Provider::new(move |_| {
        Answer::Stored(m.clone(), records_at(c.load(SeqCst) as f64, &incheon()))
    });
    let s = source(&memory, &clock, Some(f.clone()), false);
    assert_eq!(seoul(&*read(&s, &clock).await), 1);
    assert_eq!(f.calls(), 0, "fresh at the start");
    // A day later the 10-minute check finds the same list, 25 h old: acquired.
    clock.store((start + DAY_MS) as u64, SeqCst);
    tokio::time::advance(Duration::from_secs(600)).await;
    read(&s, &clock).await;
    assert_eq!(f.calls(), 1, "acquired after 24 h");
    let zones = read(&s, &clock).await;
    assert_eq!(
        (seoul(&zones), incheon_found(&zones)),
        (0, 1),
        "the acquired list answers"
    );
    // 24 h after that acquisition, once more.
    clock.store((start + 2. * DAY_MS + 1.) as u64, SeqCst);
    tokio::time::advance(Duration::from_secs(600)).await;
    expire(&s);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 2, "acquired again 24 h later");
}

/// FRESH: with nothing stored the observed source answers the release's land zones and starts
/// the acquisition; its list is installed when it ends, before S3 holds it (response-first
/// RAM-ready). The legacy source answers an empty collection.
#[tokio::test(start_paused = true)]
async fn an_empty_store_answers_packaged_zones_then_the_acquired_list() {
    let clock = clock_at(noon());
    let now = noon();
    let f = Provider::new(move |_| Answer::Records(records_at(now, &valid())));
    let s = source(&Memory::default(), &clock, Some(f.clone()), true);
    let first = read(&s, &clock).await;
    assert!(Arc::ptr_eq(&first, &Zones::packaged()), "the land zones");
    assert_eq!(f.calls(), 1, "nothing stored: acquired");
    let next = read(&s, &clock).await;
    assert_eq!(
        (seoul(&next), next.docs().len()),
        (1, 3),
        "the acquired list"
    );
    assert_eq!(f.calls(), 1);
    let legacy = source(&Memory::default(), &clock, None, false);
    assert!(read(&legacy, &clock).await.docs().is_empty());
}

/// INSTALL: an acquisition that ends after a newer list was installed does not replace it.
#[tokio::test(start_paused = true)]
async fn an_older_result_never_replaces_a_newer_installed_list() {
    let memory = Memory::default();
    let now = noon();
    // A stale stored list of Ganghwa starts the acquisition, which answers late with a list of
    // Seoul that completed two hours ago.
    store(
        &memory,
        &records_at(now - 30. * HOUR_MS, &list(&[("11B20101", "강화")])),
    )
    .await;
    let clock = clock_at(now);
    let f = Provider::new(move |_| Answer::Held(records_at(now - 2. * HOUR_MS, &valid())));
    let s = source(&memory, &clock, Some(f.clone()), false);
    read(&s, &clock).await;
    assert_eq!(f.calls(), 1);
    // Meanwhile another process stores a list of Incheon that completed an hour ago, and the
    // 10-minute check installs it.
    store(&memory, &records_at(now - HOUR_MS, &incheon())).await;
    tokio::time::advance(Duration::from_secs(600)).await;
    let newer = read(&s, &clock).await;
    assert_eq!(
        (incheon_found(&newer), newer.docs().len()),
        (1, 1),
        "the newer list"
    );
    f.release();
    tokio::time::sleep(Duration::from_millis(30)).await;
    let after = read(&s, &clock).await;
    assert!(
        Arc::ptr_eq(&newer, &after),
        "the older result is not installed"
    );
    assert_eq!(seoul(&after), 0);
}

/// INSTALL: a check that finds the installed list again moves the check time, so the selector
/// runs once per 10 minutes, not on every request.
#[tokio::test(start_paused = true)]
async fn a_reconfirmed_list_moves_the_check_time() {
    let memory = Memory::default();
    store(&memory, &records_at(noon() - HOUR_MS, &valid())).await;
    let clock = clock_at(noon());
    let s = source(&memory, &clock, None, false);
    read(&s, &clock).await;
    assert_eq!(memory.lists(), 1);
    for _ in 0..3 {
        read(&s, &clock).await;
    }
    assert_eq!(memory.lists(), 1, "memory answers");
    tokio::time::advance(Duration::from_secs(600)).await;
    let reconfirmed = read(&s, &clock).await;
    assert_eq!(memory.lists(), 2, "checked again after 10 minutes");
    assert_eq!(seoul(&reconfirmed), 1);
    tokio::time::advance(Duration::from_secs(540)).await;
    for _ in 0..3 {
        read(&s, &clock).await;
    }
    assert_eq!(memory.lists(), 2, "the re-confirmed check is recent");
    tokio::time::advance(Duration::from_secs(60)).await;
    read(&s, &clock).await;
    assert_eq!(memory.lists(), 3);
}
