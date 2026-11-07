//! The previous SHRT publication the current three-hour slot needs from HH+2:10 to HH+2:59, when
//! the latest starts at HH+3: acquired at most once per cell and publication. An isolated empty
//! store stands for a cell nothing was stored for.
use super::*;
use crate::domestic::family::DataGoKrFamily;
use crate::storage::{
    CatalogTransport, ControlObject, Error, ListPage, Object, ObjectTransport, Pagination, Period,
    PreparedRecord, RawRecord, WriteCondition,
};
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
/// Answers every SHRT request with its complete page, except `failing`, which fails.
struct Provider {
    now: f64,
    failing: Option<Publication>,
    calls: Mutex<Vec<Publication>>,
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
        Box::pin(async move { answer })
    }
}
fn fixture(provider: Arc<Provider>, now: f64) -> S3Source<Empty> {
    let warnings = Arc::new(
        WarningStore::new(Empty, CatalogLimits::default(), StoreConfig::default()).unwrap(),
    );
    let mut s = S3Source::new_with_history_policy(
        Empty,
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
async fn short_docs(s: &S3Source<Empty>, now: f64) -> Vec<Doc> {
    let docs = s
        .grid_answer(
            Family::Short,
            grid(),
            now,
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
    // Let the owned acquisitions the request stopped waiting for finish before assertions.
    tokio::time::sleep(Duration::from_millis(30)).await;
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
#[tokio::test]
async fn the_previous_publication_supplies_the_current_slot_after_the_latest_moves_on() {
    let now = kst(20261018, 530);
    let provider = Arc::new(Provider {
        now,
        failing: None,
        calls: Mutex::new(Vec::new()),
    });
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, now).await;
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
#[tokio::test]
async fn a_latest_publication_covering_the_current_slot_needs_no_other() {
    let now = kst(20261018, 430);
    let provider = Arc::new(Provider {
        now,
        failing: None,
        calls: Mutex::new(Vec::new()),
    });
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, now).await;
    assert_eq!(
        provider.calls.lock().unwrap().clone(),
        vec![publication(20261018, 200)]
    );
    assert_eq!(pop_at(&docs, "20261018", "0300"), Some(2.));
}

/// Failure path: the previous publication fails. The answer still comes (without that slot)
/// and the cell does not ask for the publication again within three hours, so its added
/// data.go.kr calls stay at one per cell and three hours.
#[tokio::test]
async fn a_failed_previous_publication_is_not_requested_again_for_three_hours() {
    let now = kst(20261018, 530);
    let previous = publication(20261018, 200);
    let provider = Arc::new(Provider {
        now,
        failing: Some(previous),
        calls: Mutex::new(Vec::new()),
    });
    let s = fixture(provider.clone(), now);
    let docs = short_docs(&s, now).await;
    assert_eq!(pop_at(&docs, "20261018", "0300"), None);
    assert_eq!(pop_at(&docs, "20261018", "0600"), Some(5.));
    let later = kst(20261018, 559);
    short_docs(&s, later).await;
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
