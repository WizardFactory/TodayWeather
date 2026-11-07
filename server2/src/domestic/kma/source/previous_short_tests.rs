//! The previous SHRT publication the current three-hour slot needs from HH+2:10 to HH+2:59, when
//! the latest starts at HH+3: acquired at most once per cell and publication. An isolated empty
//! store stands for a cell nothing was stored for, and an isolated in-memory store for stored
//! acquisitions. The tests run on a paused clock (the request's wait and late answers are virtual
//! time) and synchronize on the provider's answers.
use super::*;
use crate::domestic::family::DataGoKrFamily;
use crate::storage::{
    CatalogId, CatalogTransport, ControlObject, Error, GroupDeclaration, GroupMember, ListPage,
    Object, ObjectTransport, Pagination, Period, PreparedRecord, RawRecord, WriteCondition,
};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone)]
struct Empty;
impl ObjectTransport for Empty {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        panic!("unit storage must not write")
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Empty {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        Err(Error::NotFound)
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        panic!("unit storage must not write")
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Ok(b"<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>".to_vec())
    }
}
impl IndexListing for Empty {
    async fn list_index(&self, _: &str, _: Option<&str>) -> Result<ListPage, Error> {
        Ok(ListPage {
            keys: vec![],
            next: None,
        })
    }
}
/// An isolated in-memory S3: raw objects, conditional control objects and the catalog index. The
/// catalog store publishes into it and the source reads it as it reads S3, with no I/O, so the
/// paused clock advances only when every task waits for a timer.
#[derive(Clone, Default)]
struct Memory(Arc<Mutex<Objects>>);
#[derive(Default)]
struct Objects {
    raw: BTreeMap<String, Object>,
    control: BTreeMap<String, ControlObject>,
    revision: u64,
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
        let objects = self.0.lock().unwrap();
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

fn publication(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn kst(date: u32, time: u16) -> f64 {
    schedule::to_ms(publication(date, time)) as f64
}
fn grid() -> crate::history::Grid {
    crate::history::Grid::new(60, 127).unwrap()
}
/// A complete `getVilageFcst` page of `p` for the test cell: hourly rows to the third (fourth
/// from 17:00) midnight, then three-hourly rows for a day. Its probability is `p`'s hour, so a
/// row shows which publication it came from.
fn page(p: Publication) -> Vec<u8> {
    let days = if p.hour() >= 17 { 4 } else { 3 };
    let extension = days * 24 - i64::from(p.hour());
    let mut offsets: Vec<i64> = (1..extension).collect();
    offsets.extend((0..8).map(|i| extension + i * 3));
    let mut items = Vec::new();
    for offset in offsets {
        let at = p.add_hours(offset).unwrap();
        let (date, time) = (at.base_date(), at.base_time());
        let mut values = vec![
            ("TMP", "17".to_owned()),
            ("UUU", "1.1".into()),
            ("VVV", "-0.4".into()),
            ("VEC", "180".into()),
            ("WSD", "2.5".into()),
            ("SKY", "1".into()),
            ("PTY", "0".into()),
            ("POP", p.hour().to_string()),
            ("PCP", "강수없음".into()),
            ("REH", "70".into()),
            ("SNO", "적설없음".into()),
        ];
        if time == "0600" {
            values.push(("TMN", "12".into()));
        }
        if time == "1500" {
            values.push(("TMX", "24".into()));
        }
        for (category, value) in values {
            items.push(
                serde_json::json!({"baseDate": p.base_date(), "baseTime": p.base_time(),
                "category": category, "fcstDate": date, "fcstTime": time, "fcstValue": value,
                "nx": 60, "ny": 127}),
            );
        }
    }
    let total = items.len();
    serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": total}}}))
    .unwrap()
}
fn records(p: Publication, fetched_at: f64) -> Vec<RawRecord> {
    vec![
        RawRecord::new(
            "data-go-kr",
            "vilage-fcst",
            &grid().provider_key(),
            Period {
                local_date: p.date(),
                slot: p.base_time(),
            },
            fetched_at as u64,
            200,
            "application/json",
            Some(Pagination {
                page: 1,
                pages: 1,
                complete: true,
            }),
            Arc::from(page(p)),
            &crate::storage::Limits::default(),
        )
        .unwrap(),
    ]
}
/// A complete page that organizes nothing: a stored acquisition legacy would not keep, so its
/// publication stays eligible for the bounded retries.
fn empty_page() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": []}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": 0}}}))
    .unwrap()
}
/// Publishes one acquisition of `p` with `body`, fetched at `fetched_at`, into `memory` through
/// the catalog store.
async fn stored(memory: &Memory, p: Publication, body: Vec<u8>, fetched_at: f64) {
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        "data-go-kr",
        "vilage-fcst",
        &grid().provider_key(),
        p.period(),
        fetched_at as u64,
        200,
        "application/json",
        None,
        Arc::from(body),
        &limits.raw,
    )
    .unwrap();
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap()],
    };
    let declaration = GroupDeclaration::new(vec![member], &limits).unwrap();
    CatalogStore::new(memory.clone(), limits)
        .unwrap()
        .publish(
            declaration,
            vec![record],
            Instant::now() + Duration::from_secs(10),
        )
        .await
        .unwrap();
}
/// Answers every SHRT request with its complete page, except `failing`, which fails, `slow`, which
/// answers only after a minute, and the first of `after`, which answers only once the second has
/// answered. `answered` lists the publications answered so far.
struct Provider {
    now: f64,
    failing: Option<Publication>,
    slow: Option<Publication>,
    after: Option<(Publication, Publication)>,
    calls: Mutex<Vec<Publication>>,
    answered: Arc<tokio::sync::watch::Sender<Vec<Publication>>>,
}
impl Provider {
    fn new(now: f64) -> Self {
        Self {
            now,
            failing: None,
            slow: None,
            after: None,
            calls: Mutex::new(Vec::new()),
            answered: Arc::new(tokio::sync::watch::channel(Vec::new()).0),
        }
    }
}
impl fetch::ForecastAcquire for Provider {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> BoxFuture<'static, Result<fetch::Published, String>> {
        let fetch::ForecastRequest::DataGoKr(r) = request else {
            panic!("only grid forecasts: {request:?}")
        };
        assert_eq!(r.family(), DataGoKrFamily::VilageFcst);
        let p = r.publication();
        self.calls.lock().unwrap().push(p);
        let answer = if self.failing == Some(p) {
            Err("provider failure".to_owned())
        } else {
            Ok(Some(records(p, self.now)))
        };
        let (slow, answered) = (self.slow == Some(p), self.answered.clone());
        let first = self
            .after
            .filter(|(later, _)| *later == p)
            .map(|(_, first)| first);
        Box::pin(async move {
            if let Some(first) = first {
                let mut done = answered.subscribe();
                let _ = done.wait_for(|answered| answered.contains(&first)).await;
            }
            if slow {
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            answered.send_modify(|answered| answered.push(p));
            answer
        })
    }
}
fn fixture(provider: Arc<Provider>, now: f64) -> S3Source<Empty> {
    fixture_on(Empty, provider, now)
}
fn fixture_on<T: IndexListing + Clone + Send + Sync + 'static>(
    transport: T,
    provider: Arc<Provider>,
    now: f64,
) -> S3Source<T> {
    let warnings = Arc::new(
        WarningStore::new(
            transport.clone(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let mut s = S3Source::new_with_history_policy(
        transport,
        Arc::new(move || now),
        Arc::new(Never),
        Arc::new(Never),
        warnings,
        true,
    )
    .unwrap()
    .with_forecast(Some(provider));
    // Unit fixture only: real production retains completed owned results for three seconds.
    s.owned = crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
        retain: Duration::ZERO,
        ..Default::default()
    })
    .unwrap();
    s
}
/// The documents of one request, after every acquisition it started has answered. The tests run
/// on a paused clock, so the request's wait and a late answer are virtual time; completion is the
/// provider's answer count, not elapsed time.
async fn short_docs(s: &S3Source<Empty>, provider: &Provider, now: f64) -> Vec<Doc> {
    let docs = s
        .grid_answer(
            Family::Short,
            grid(),
            now,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
    let started = provider.calls.lock().unwrap().len();
    provider
        .answered
        .subscribe()
        .wait_for(|answered| answered.len() >= started)
        .await
        .unwrap();
    docs
}
/// The probability of the stored row at `date`/`time` (None: no document holds the slot).
fn pop_at(docs: &[Doc], date: &str, time: &str) -> Option<f64> {
    docs.iter().find_map(|d| {
        let row = d.get("shortData")?.as_doc()?;
        (row.get("date")?.as_str()? == date && row.get("time")?.as_str()? == time)
            .then(|| row.get("pop").and_then(Val::as_num))
            .flatten()
    })
}

/// 2026-10-18 05:30 KST: the current slot is 03:00 and the latest (05:00) starts at 06:00, so
/// the 02:00 publication supplies the current row; it is acquired with the latest.
#[tokio::test(start_paused = true)]
async fn the_previous_publication_supplies_the_current_slot_after_the_latest_moves_on() {
    let now = kst(20261018, 530);
    let provider = Arc::new(Provider::new(now));
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, &provider, now).await;
    let mut calls = provider.calls.lock().unwrap().clone();
    calls.sort();
    assert_eq!(
        calls,
        vec![publication(20261018, 200), publication(20261018, 500)]
    );
    assert_eq!(pop_at(&docs, "20261018", "0300"), Some(2.), "the 02:00 row");
    assert_eq!(
        pop_at(&docs, "20261018", "0600"),
        Some(5.),
        "the newest wins"
    );
}

/// Before HH+2:10 the latest covers the current slot: nothing older is requested.
#[tokio::test(start_paused = true)]
async fn a_latest_publication_covering_the_current_slot_needs_no_other() {
    let now = kst(20261018, 430);
    let provider = Arc::new(Provider::new(now));
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, &provider, now).await;
    assert_eq!(
        provider.calls.lock().unwrap().clone(),
        vec![publication(20261018, 200)]
    );
    assert_eq!(pop_at(&docs, "20261018", "0300"), Some(2.));
}

/// Failure path: the previous publication fails, and only after the request stopped waiting. The
/// answer still comes (without that slot) and the cell does not ask for the publication again
/// within three hours, so its added data.go.kr calls stay at one per cell and publication.
#[tokio::test(start_paused = true)]
async fn a_failed_previous_publication_is_not_requested_again_for_three_hours() {
    let now = kst(20261018, 530);
    let previous = publication(20261018, 200);
    let provider = Arc::new(Provider {
        failing: Some(previous),
        slow: Some(previous),
        ..Provider::new(now)
    });
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, &provider, now).await;
    assert_eq!(
        provider.answered.borrow().len(),
        provider.calls.lock().unwrap().len(),
        "every acquisition it started has answered"
    );
    assert_eq!(pop_at(&docs, "20261018", "0300"), None);
    assert_eq!(pop_at(&docs, "20261018", "0600"), Some(5.));
    let later = kst(20261018, 559);
    short_docs(&s, &provider, later).await;
    let asked = |p: Publication| {
        provider
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| **c == p)
            .count()
    };
    assert_eq!(asked(previous), 1, "one attempt per cell and publication");
    let key = grid_flight(schedule::Family::Short, grid(), previous);
    assert!(
        s.attempts.remaining(&key) > Duration::from_secs(3 * 3600 - 60),
        "bounded for three hours: {:?}",
        s.attempts.remaining(&key)
    );
}

/// Review RP-previous-acquisition-starvation: the latest and the previous publication start
/// together under one wait. At 20:30 the latest (20:00) starts at 21:00, so the 17:00 publication
/// covers the current 18:00 slot; the 20:00 one answers after the wait, the 17:00 one at once.
/// The 18:00 slot still gets its forecast, and the answer ends at the wait (a paused clock).
#[tokio::test(start_paused = true)]
async fn a_slow_latest_publication_does_not_hold_back_the_previous_one() {
    let now = kst(20261018, 2030);
    let provider = Arc::new(Provider {
        slow: Some(publication(20261018, 2000)),
        ..Provider::new(now)
    });
    let s = fixture(provider.clone(), now);
    let started = Instant::now();
    let until = started + Duration::from_secs(1);
    let (docs, _, _) = s
        .grid_answer_by(
            Family::Short,
            grid(),
            now,
            started + Duration::from_secs(8),
            until,
        )
        .await
        .unwrap();
    assert!(
        started.elapsed() <= Duration::from_secs(1),
        "one wait: {:?}",
        started.elapsed()
    );
    assert_eq!(
        pop_at(&docs, "20261018", "1800"),
        Some(17.),
        "the 17:00 row of the current slot"
    );
    assert_eq!(
        pop_at(&docs, "20261018", "2100"),
        Some(17.),
        "20:00 is late"
    );
}

/// At 20:30 the latest publication (20:00) starts at 21:00, so the stored 17:00 publication, which
/// organizes nothing, is asked again for the current 18:00 slot; `latest_stored` stores an
/// unusable 20:00 one too. The provider answers 20:00 only once 17:00 has answered, and a minute
/// later. The answer, its time on the paused clock and the publications requested.
async fn unusable_previous(latest_stored: bool) -> (Vec<Doc>, Duration, Vec<Publication>) {
    let now = kst(20261018, 2030);
    let (latest, previous) = (publication(20261018, 2000), publication(20261018, 1700));
    let memory = Memory::default();
    stored(&memory, previous, empty_page(), now - 60_000.).await;
    if latest_stored {
        stored(&memory, latest, empty_page(), now - 60_000.).await;
    }
    let provider = Arc::new(Provider {
        slow: Some(latest),
        after: Some((latest, previous)),
        ..Provider::new(now)
    });
    let s = fixture_on(memory, provider.clone(), now);
    let started = Instant::now();
    let (docs, _, _) = s
        .grid_answer_by(
            Family::Short,
            grid(),
            now,
            started + Duration::from_secs(8),
            started + Duration::from_secs(1),
        )
        .await
        .unwrap();
    let mut calls = provider.calls.lock().unwrap().clone();
    calls.sort();
    (docs, started.elapsed(), calls)
}

/// Review RP-previous-acquisition-starvation, mixed: the latest publication is not stored and is
/// slow, and the previous one is stored but unusable. Its acquisition starts once the stored read
/// shows it unusable, not after the latest acquisition: the current slot gets its forecast and the
/// answer ends at its wait.
#[tokio::test(start_paused = true)]
async fn an_unusable_stored_publication_is_asked_again_without_waiting_for_an_absent_one() {
    let (docs, waited, calls) = unusable_previous(false).await;
    assert!(waited <= Duration::from_secs(1), "one wait: {waited:?}");
    assert_eq!(
        pop_at(&docs, "20261018", "1800"),
        Some(17.),
        "the 17:00 row of the current slot"
    );
    assert_eq!(
        calls,
        vec![publication(20261018, 1700), publication(20261018, 2000)],
        "one acquisition each"
    );
}
