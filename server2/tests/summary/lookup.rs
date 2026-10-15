//! The internal last-year lookup: date order, source order at each date, ASOS on demand (one
//! range, stored), VC derived from stored raw records, and failures that never fall through to
//! a lower-priority answer.
use super::support::*;
use server2::domestic::asos::AsosKind;
use server2::domestic::kma::source::asos::AsosFetched;
use server2::gateway::BoxFuture;
use server2::summary::lookup::{AsosOnDemand, VcRecords, candidates};
use server2::summary::{Lookup, LookupError, Source, SummaryKey, SummaryStore, Target};
use server2::world::{Cell, Range, RawFetch};
use std::sync::{Arc, Mutex};
use tokio::time::Instant;

#[test]
fn dates_are_same_day_then_nearest_earlier_first() {
    let dates: Vec<(i64, u32)> = candidates(20261015);
    assert_eq!(
        dates,
        vec![
            (0, 20251015),
            (-1, 20251014),
            (1, 20251016),
            (-2, 20251013),
            (2, 20251017),
            (-3, 20251012),
            (3, 20251018)
        ]
    );
    // February 29 has no same date in the previous year.
    let leap = candidates(20280229);
    assert_eq!(leap[0], (0, 20270228));
    assert_eq!(leap[1], (-1, 20270227));
    assert_eq!(leap[2], (1, 20270301));
    // Month and year boundaries.
    let jan = candidates(20270101);
    assert_eq!(jan[0], (0, 20260101));
    assert_eq!(jan[1], (-1, 20251231));
}

/// Scripted on-demand ASOS: the live body for station 108, `None` or a failure.
struct FakeAsos {
    calls: Mutex<Vec<(String, u32, u32)>>,
    answer: Mutex<Option<Result<bool, ()>>>,
}
impl FakeAsos {
    fn new(answer: Result<bool, ()>) -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(Vec::new()),
            answer: Mutex::new(Some(answer)),
        })
    }
    fn calls(&self) -> Vec<(String, u32, u32)> {
        self.calls.lock().unwrap().clone()
    }
}
impl AsosOnDemand for FakeAsos {
    fn daily(
        &self,
        station: String,
        start: u32,
        end: u32,
        _: Instant,
    ) -> BoxFuture<'_, Result<Option<Vec<AsosFetched>>, LookupError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((station, start, end));
            match (*self.answer.lock().unwrap()).unwrap() {
                Err(()) => Err(LookupError::Provider),
                Ok(false) => Ok(None),
                Ok(true) => {
                    let body = std::fs::read(
                        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("tests/summary/fixtures/asos-daily-108-20251012-20251018.json"),
                    )
                    .unwrap();
                    Ok(Some(vec![AsosFetched {
                        kind: AsosKind::Daily,
                        start: format!("{start:08}"),
                        end: format!("{end:08}"),
                        fetched_at_ms: 1_791_000_000_000.,
                        pages: vec![Arc::from(body)],
                    }]))
                }
            }
        })
    }
}
/// Stored raw VC fetches of one cell.
struct FakeVc(Vec<RawFetch>, Mutex<usize>);
impl VcRecords for FakeVc {
    fn fetches(
        &self,
        _: Cell,
        _: Vec<u32>,
        _: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, LookupError>> {
        *self.1.lock().unwrap() += 1;
        Box::pin(async move { Ok(self.0.clone()) })
    }
}
fn seoul_vc_day(date: &str, start_epoch: i64) -> RawFetch {
    let hours: Vec<serde_json::Value> = (0..24)
        .map(|i| serde_json::json!({"datetimeEpoch": start_epoch + i * 3600, "temp": 59.0}))
        .collect();
    let body = serde_json::to_vec(
        &serde_json::json!({"timezone": "Asia/Seoul", "tzoffset": 9.0,
        "days": [{"datetime": date, "precip": 0.0, "hours": hours}]}),
    )
    .unwrap();
    RawFetch {
        fetched_at_ms: (start_epoch as u64 + 2 * 86_400) * 1000,
        range: Range::Recent,
        first_date: 0,
        sha256: server2::storage::sha256(&body),
        body: Arc::from(body),
    }
}
fn target(town: bool, station: bool, cell: bool) -> Target {
    Target {
        town: town.then(super::support::town),
        station: station.then(|| "108".to_owned()),
        cell: cell.then_some((3757, 12697)),
    }
}

#[tokio::test]
async fn grid_wins_at_a_date_and_dates_win_over_sources() {
    let t = Arc::new(MemorySummaries::new());
    let store = SummaryStore::new(t.clone());
    // Grid only at +1; ASOS stored at the same date.
    store
        .publish(&grid_summary(20251016, 20., 1), deadline())
        .await
        .unwrap();
    let asos = server2::summary::asos::summaries(
        "108",
        &[AsosFetched {
            kind: AsosKind::Daily,
            start: "20251015".into(),
            end: "20251015".into(),
            fetched_at_ms: 1.,
            pages: vec![Arc::from(
                br#"{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"tm":"2025-10-15","stnId":"108","minTa":"16.1","maxTa":"25.3"}]}}}}"#.to_vec(),
            )],
        }],
        &[20251015],
    );
    assert_eq!(asos.len(), 1);
    store.publish(&asos[0], deadline()).await.unwrap();
    let fake = FakeAsos::new(Ok(true));
    let lookup = Lookup::new(t.clone(), Some(fake.clone() as Arc<dyn AsosOnDemand>), None);
    let found = lookup
        .last_year(&target(true, true, false), 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (found.source, found.date, found.offset),
        (Source::Asos, 20251015, 0)
    );
    // With grid at the same date, grid wins.
    store
        .publish(&grid_summary(20251015, 21., 1), deadline())
        .await
        .unwrap();
    let found = lookup
        .last_year(&target(true, true, false), 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((found.source, found.date), (Source::Grid, 20251015));
    assert!(fake.calls().is_empty(), "no provider call when stored");
}

#[tokio::test]
async fn missing_asos_is_acquired_once_and_stored() {
    let t = Arc::new(MemorySummaries::new());
    let fake = FakeAsos::new(Ok(true));
    let lookup = Lookup::new(t.clone(), Some(fake.clone() as Arc<dyn AsosOnDemand>), None);
    let found = lookup
        .last_year(&target(true, true, false), 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (found.source, found.date, found.offset),
        (Source::Asos, 20251015, 0)
    );
    assert_eq!(found.summary.value("taMax"), Some(25.3));
    assert_eq!(fake.calls(), vec![("108".into(), 20251012, 20251018)]);
    // Every complete day of the range is stored (7 objects).
    assert_eq!(t.keys().len(), 7);
    // A new process finds them in S3 without a provider call.
    let fresh = FakeAsos::new(Ok(true));
    let again = Lookup::new(
        t.clone(),
        Some(fresh.clone() as Arc<dyn AsosOnDemand>),
        None,
    );
    let found2 = again
        .last_year(&target(false, true, false), 20261016, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((found2.source, found2.date), (Source::Asos, 20251016));
    assert!(fresh.calls().is_empty());
}

#[tokio::test]
async fn vc_is_derived_from_stored_raw_records_when_asos_has_no_data() {
    let t = Arc::new(MemorySummaries::new());
    let fake = FakeAsos::new(Ok(false));
    // 2025-10-14 00:00 KST.
    let vc = Arc::new(FakeVc(
        vec![seoul_vc_day("2025-10-14", 1_760_367_600)],
        Mutex::new(0),
    ));
    let lookup = Lookup::new(
        t.clone(),
        Some(fake.clone() as Arc<dyn AsosOnDemand>),
        Some(vc.clone() as Arc<dyn VcRecords>),
    );
    let found = lookup
        .last_year(&target(true, true, true), 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (found.source, found.date, found.offset),
        (Source::Vc, 20251014, -1)
    );
    assert_eq!(found.summary.value("taMax"), Some(15.));
    assert_eq!(
        fake.calls().len(),
        1,
        "one ASOS range attempt for all dates"
    );
    // The derived VC summary is stored.
    let key = SummaryKey::Vc {
        lat: 3757,
        lon: 12697,
    };
    let stored = SummaryStore::new(t.clone())
        .newest(&key, 20251014, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.summary, found.summary);
}

#[tokio::test]
async fn failures_do_not_fall_through_to_lower_priority_sources() {
    let t = Arc::new(MemorySummaries::new());
    let fake = FakeAsos::new(Err(()));
    let vc = Arc::new(FakeVc(
        vec![seoul_vc_day("2025-10-15", 1_760_454_000)],
        Mutex::new(0),
    ));
    let lookup = Lookup::new(
        t.clone(),
        Some(fake.clone() as Arc<dyn AsosOnDemand>),
        Some(vc.clone() as Arc<dyn VcRecords>),
    );
    let err = lookup
        .last_year(&target(false, true, true), 20261015, deadline())
        .await
        .unwrap_err();
    assert_eq!(err, LookupError::Provider);
    assert_eq!(
        *vc.1.lock().unwrap(),
        0,
        "VC not consulted after a provider failure"
    );
    // The failed range may be tried again.
    *fake.answer.lock().unwrap() = Some(Ok(true));
    let found = lookup
        .last_year(&target(false, true, true), 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.source, Source::Asos);
    // A storage failure is an error too.
    t.fail(true);
    let err = lookup
        .last_year(&target(true, true, true), 20261015, deadline())
        .await
        .unwrap_err();
    assert!(matches!(err, LookupError::Storage(_)));
}

#[tokio::test]
async fn nothing_stored_and_no_sources_is_none() {
    let t = Arc::new(MemorySummaries::new());
    let lookup = Lookup::new(t.clone(), None, None);
    assert!(
        lookup
            .last_year(&target(true, true, true), 20261015, deadline())
            .await
            .unwrap()
            .is_none()
    );
}
