//! Capture runner: demand-gated requests, intervals, caps, budget stop, publication and ownership.
use super::provider_support::kst;
use super::support::*;
use server2::budget::BudgetError;
use server2::domestic::{Acquired, DomesticError};
use server2::history::capture::{CaptureConfig, CaptureOwner, CaptureRunner};
use server2::history::demand::{DEMAND_WINDOW_MS, DemandConfig, DemandStore};
use server2::history::index::CaptureIndex;
use server2::history::metrics::HistoryMetrics;
use server2::history::schedule::{Family, Target};
use std::sync::{Arc, Mutex, atomic::Ordering};

struct Env {
    source: Arc<FakeSource>,
    publisher: Arc<FakePublisher>,
    demand: Arc<DemandStore<MemoryDemand>>,
    runner: CaptureRunner<FakeSource, FakePublisher, MemoryDemand>,
}
fn env(scope: &str, config: CaptureConfig) -> Env {
    let source = Arc::new(FakeSource::new());
    let publisher = Arc::new(FakePublisher::default());
    let demand = Arc::new(
        DemandStore::new(Arc::new(MemoryDemand::default()), DemandConfig::default()).unwrap(),
    );
    let runner = CaptureRunner::new(
        CaptureOwner::claim(scope).expect("owner"),
        source.clone(),
        publisher.clone(),
        demand.clone(),
        Arc::new(Mutex::new(CaptureIndex::default())),
        config,
        Arc::new(HistoryMetrics::default()),
    )
    .unwrap();
    Env {
        source,
        publisher,
        demand,
        runner,
    }
}
fn at() -> i64 {
    kst(2026, 10, 13, 14, 25)
}
fn funded(calls: &[Requested]) -> Vec<(&'static str, u16, u16)> {
    calls
        .iter()
        .filter_map(|c| match c {
            Requested::Funded { kind, nx, ny, .. } => Some((*kind, *nx, *ny)),
            _ => None,
        })
        .collect()
}
fn web(calls: &[Requested]) -> usize {
    calls
        .iter()
        .filter(|c| matches!(c, Requested::Web { .. }))
        .count()
}

#[tokio::test]
async fn capture_without_demand_requests_nothing() {
    let e = env("capture-no-demand", CaptureConfig::default());
    let report = e.runner.tick(at()).await;
    assert_eq!(report.planned, 0);
    assert!(e.source.calls().is_empty());
    let minute = e.runner.minute(at()).await;
    assert!(!minute.attempted);
    assert!(e.source.calls().is_empty());
}

#[tokio::test]
async fn capture_requests_only_active_cells_and_publishes_before_marking() {
    let e = env("capture-active", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    let report = e.runner.tick(at()).await;
    let calls = e.source.calls();
    let f = funded(&calls);
    // 3 latest + 23 current + 23 shortest + 7 short backfill under the 64-call default cap.
    assert_eq!(f.len(), 56);
    assert!(f.iter().all(|(_, nx, ny)| (*nx, *ny) == (60, 127)));
    // 64 keyless attempts per tick at two worst-case attempts per page.
    assert_eq!(web(&calls), 32, "web cap per tick");
    assert_eq!(report.published, 88);
    assert_eq!(e.publisher.published.lock().unwrap().len(), 88);
    {
        let shared = e.runner.index();
        let index = shared.lock().unwrap();
        assert!(index.has(Family::Current, Target::Cell(g(60, 127)), p(20261013, 1300)));
        assert!(index.has(
            Family::Shortest,
            Target::Cell(g(60, 127)),
            p(20261013, 1300)
        ));
        assert!(index.has(Family::AwsHourly, Target::National, p(20261013, 1400)));
    }
    // A second tick requests nothing already present: only the remaining national backfill.
    e.source.clear();
    let again = e.runner.tick(at()).await;
    let calls = e.source.calls();
    assert!(funded(&calls).is_empty());
    assert_eq!(web(&calls), 32, "capped national backfill carries over");
    assert_eq!(
        again.present_skipped, 0,
        "present publications are not planned at all"
    );
}

#[tokio::test]
async fn capture_follows_push_demand_and_stops_after_expiry() {
    let e = env("capture-push", CaptureConfig::default());
    e.demand
        .replace_push(&[g(98, 76)], at(), 25 * HOUR)
        .await
        .unwrap();
    e.runner.tick(at()).await;
    assert!(
        funded(&e.source.calls())
            .iter()
            .all(|(_, nx, ny)| (*nx, *ny) == (98, 76))
    );
    assert!(!funded(&e.source.calls()).is_empty());
    // Request demand expires exactly 8 days after the last demand.
    let e = env("capture-expiry", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    let report = e.runner.tick(at() + DEMAND_WINDOW_MS).await;
    assert_eq!(report.planned, 0);
    assert!(e.source.calls().is_empty());
}

#[tokio::test]
async fn capture_stops_funded_calls_after_a_funding_error_and_honours_caps() {
    let e = env("capture-budget", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    e.source.funding(2);
    let report = e.runner.tick(at()).await;
    assert!(report.budget_denied);
    // Two funded calls succeed, the third is denied, and no further funded call is made.
    assert_eq!(funded(&e.source.calls()).len(), 3);
    assert_eq!(
        web(&e.source.calls()),
        32,
        "keyless pages are not data.go.kr budget"
    );
    let e = env(
        "capture-cap",
        CaptureConfig {
            max_funded_attempts: 50,
            max_web_attempts: 0,
            ..CaptureConfig::default()
        },
    );
    e.demand.touch(g(60, 127), at()).await.unwrap();
    let report = e.runner.tick(at()).await;
    assert_eq!(funded(&e.source.calls()).len(), 5);
    assert_eq!(web(&e.source.calls()), 0);
    assert!(report.capped > 0);
    // Each acquisition is charged its worst case (5 pages x 2 attempts): 19 attempts fund one.
    let e = env(
        "capture-charge",
        CaptureConfig {
            max_funded_attempts: 19,
            max_web_attempts: 3,
            ..CaptureConfig::default()
        },
    );
    e.demand.touch(g(60, 127), at()).await.unwrap();
    e.runner.tick(at()).await;
    assert_eq!(funded(&e.source.calls()).len(), 1);
    assert_eq!(web(&e.source.calls()), 1);
}

#[tokio::test]
async fn capture_retries_unpublished_or_failed_publications_on_the_next_tick() {
    let e = env(
        "capture-retry",
        CaptureConfig {
            max_funded_attempts: 30,
            max_web_attempts: 0,
            ..CaptureConfig::default()
        },
    );
    e.demand.touch(g(60, 127), at()).await.unwrap();
    e.source.push(Ok(Some(Acquired::NotPublished)));
    e.source.push(Err(DomesticError::Transport));
    e.publisher.fail.store(1, Ordering::SeqCst);
    let report = e.runner.tick(at()).await;
    assert_eq!(report.not_published, 1);
    assert_eq!(report.failed, 2);
    assert_eq!(report.published, 0);
    e.source.clear();
    e.runner.tick(at()).await;
    // The same three latest publications are requested again.
    assert_eq!(
        funded(&e.source.calls()),
        vec![
            ("ultra-srt-ncst", 60, 127),
            ("ultra-srt-fcst", 60, 127),
            ("vilage-fcst", 60, 127)
        ]
    );
    let _ = BudgetError::Exhausted;
}

#[tokio::test]
async fn capture_backfills_once_per_hour_and_at_once_for_new_cells() {
    let e = env(
        "capture-backfill-hourly",
        CaptureConfig {
            max_web_attempts: 0,
            ..CaptureConfig::default()
        },
    );
    e.demand.touch(g(60, 127), at()).await.unwrap();
    // Every backfill slot fails (provider gap): 3 latest succeed, 53 backfill calls fail.
    for _ in 0..3 {
        e.source.push(Ok(None));
    }
    for _ in 0..53 {
        e.source.push(Ok(Some(Acquired::NoData)));
    }
    let first = e.runner.tick(at()).await;
    assert_eq!((first.published, first.no_data), (3, 53));
    // Ten minutes later in the same hour: no backfill retry storm for the known cell.
    e.source.clear();
    e.runner.tick(at() + 10 * 60_000).await;
    assert!(funded(&e.source.calls()).is_empty());
    // A cell that gains demand in the same hour is backfilled immediately.
    e.demand
        .touch(g(61, 127), at() + 20 * 60_000)
        .await
        .unwrap();
    e.runner.tick(at() + 20 * 60_000).await;
    let f = funded(&e.source.calls());
    assert_eq!(f.iter().filter(|(_, nx, _)| *nx == 61).count(), 56);
    // At 14:45 the first cell only gains its new latest current and ultra-short hours.
    assert_eq!(
        f.iter().filter(|(_, nx, _)| *nx == 60).collect::<Vec<_>>(),
        vec![&("ultra-srt-ncst", 60, 127), &("ultra-srt-fcst", 60, 127)]
    );
    // The next KST hour retries the first cell's missing backfill (and its new latest slots).
    e.source.clear();
    e.runner.tick(kst(2026, 10, 13, 15, 5)).await;
    assert!(
        funded(&e.source.calls())
            .iter()
            .filter(|(_, nx, _)| *nx == 60)
            .count()
            > 50
    );
}

#[tokio::test]
async fn capture_carries_capped_backfill_over_within_the_hour() {
    let e = env(
        "capture-carry",
        CaptureConfig {
            max_funded_attempts: 100,
            max_web_attempts: 0,
            ..CaptureConfig::default()
        },
    );
    e.demand.touch(g(60, 127), at()).await.unwrap();
    let first = e.runner.tick(at()).await;
    assert_eq!(first.attempted, 10);
    assert!(first.capped > 0);
    let before: Vec<_> = e.source.calls();
    e.source.clear();
    // Ten minutes later, same hour: the next ten unattempted backfill publications run.
    let second = e.runner.tick(at() + 10 * 60_000).await;
    assert_eq!(second.attempted, 10);
    let after = e.source.calls();
    assert!(
        after.iter().all(|c| !before.contains(c)),
        "nothing repeated"
    );
    assert!(
        after
            .iter()
            .all(|c| matches!(c, Requested::Funded { nx: 60, .. }))
    );
}

#[tokio::test]
async fn capture_minute_page_every_two_minutes_only_with_demand() {
    let e = env("capture-minute", CaptureConfig::default());
    let t = kst(2026, 10, 13, 12, 0) + 30_000;
    assert!(!e.runner.minute(t).await.attempted);
    e.demand.touch(g(60, 127), t).await.unwrap();
    *e.source.minute.lock().unwrap() = p(20261013, 1158);
    let first = e.runner.minute(t).await;
    assert!(first.attempted && first.published);
    assert_eq!(
        e.source.calls().last().unwrap(),
        &Requested::Web {
            kind: "aws-minute",
            publication: None
        }
    );
    // Same two-minute bucket: not due.
    assert!(!e.runner.minute(t + 60_000).await.attempted);
    *e.source.minute.lock().unwrap() = p(20261013, 1200);
    let second = e.runner.minute(t + 100_000).await;
    assert!(second.attempted);
    // The next request asks for a page newer than the last captured minute.
    assert_eq!(
        e.source.calls().last().unwrap(),
        &Requested::Web {
            kind: "aws-minute",
            publication: Some(p(20261013, 1159))
        }
    );
    let index = e.runner.index();
    let minutes: Vec<_> = index.lock().unwrap().minutes().collect();
    assert_eq!(minutes, vec![p(20261013, 1158), p(20261013, 1200)]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn capture_run_drives_both_loops_until_shutdown() {
    let e = env("capture-run", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    let runner = Arc::new(e.runner);
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(
        runner
            .clone()
            .run(super::provider_support::clock(at()), shutdown),
    );
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    stop.send(true).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("run stops on shutdown")
        .unwrap();
    let text = runner.metrics().render();
    assert!(text.contains("server2_history_ticks_total 1\n"), "{text}");
    assert!(
        text.contains("server2_history_minute_ticks_total 1\n"),
        "{text}"
    );
}

#[test]
fn capture_owner_is_exclusive_per_scope() {
    let first = CaptureOwner::claim("capture-owner-scope").unwrap();
    assert!(CaptureOwner::claim("capture-owner-scope").is_none());
    assert!(CaptureOwner::claim("capture-owner-other").is_some());
    drop(first);
    assert!(CaptureOwner::claim("capture-owner-scope").is_some());
}

#[tokio::test]
async fn capture_metrics_render_counts() {
    let e = env("capture-metrics", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    e.runner.tick(at()).await;
    let text = e.runner.metrics().render();
    assert!(
        text.contains("server2_history_captures_published_total 88"),
        "{text}"
    );
    assert!(text.contains("server2_history_ticks_total 1"));
}

/// S13d (review S13D-R1-01): an owned capture may spend the two legacy-timeout attempts of every
/// page it can need, plus the publication allowance; a multi-page short forecast with a slow
/// retried first page is therefore still published.
#[tokio::test]
async fn capture_deadline_covers_two_legacy_attempts_per_page() {
    use std::time::Duration;
    let e = env("capture-legacy-deadline", CaptureConfig::default());
    e.demand.touch(g(60, 127), at()).await.unwrap();
    e.runner.tick(at()).await;
    e.runner.minute(at()).await;
    let deadlines = e.source.deadlines.lock().unwrap().clone();
    let allowance = CaptureConfig::default().call_timeout;
    let close =
        |left: Duration, want: Duration| left <= want && left + Duration::from_secs(1) >= want;
    // VilageFcst 2.0: 10 s per attempt, two attempts on each of up to five pages.
    for kind in ["ultra-srt-ncst", "ultra-srt-fcst", "vilage-fcst"] {
        let left = deadlines.iter().find(|(k, _)| *k == kind).unwrap().1;
        assert!(
            close(left, Duration::from_secs(100) + allowance),
            "{kind}: {left:?}"
        );
    }
    // KMA web pages: 30 s per attempt, one page.
    let left = deadlines
        .iter()
        .find(|(k, _)| *k == "aws-minute")
        .unwrap()
        .1;
    assert!(
        close(left, Duration::from_secs(60) + allowance),
        "aws-minute: {left:?}"
    );
}
