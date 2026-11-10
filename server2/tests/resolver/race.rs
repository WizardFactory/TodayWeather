//! KMA-RESTART-RACE: a stored restore has a head start of 700 ms from the start of the request.
//! A restore done by then is used as it is; a late one keeps running, and the caller starts the
//! provider acquisitions of what memory lacks alongside it.
use server2::observability::Component;
use server2::resolver::race::{HEAD_START, races, restored_by};
use std::time::Duration;
use tokio::time::Instant;

#[tokio::test(start_paused = true)]
async fn restored_by_reports_the_head_start() {
    assert_eq!(HEAD_START, Duration::from_millis(700));
    // A restore that ends within the head start is reported with its result.
    let start = Instant::now();
    let mut prompt = Box::pin(async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        "restored"
    });
    let done = restored_by(&mut prompt, start + HEAD_START, Component::Domestic).await;
    assert_eq!(done, Some("restored"));
    assert_eq!(Instant::now() - start, Duration::from_millis(400));
    // A late restore is reported at the head start and keeps running for the caller.
    let start = Instant::now();
    let mut late = Box::pin(async {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        "late"
    });
    let done = restored_by(&mut late, start + HEAD_START, Component::Domestic).await;
    assert_eq!(done, None);
    assert_eq!(Instant::now() - start, HEAD_START);
    assert_eq!(late.await, "late");
    assert_eq!(Instant::now() - start, Duration::from_millis(1500));
    // A head start already past reports a pending restore at once.
    let mut pending = Box::pin(std::future::pending::<()>());
    let at = Instant::now();
    assert_eq!(
        restored_by(&mut pending, at, Component::Domestic).await,
        None
    );
    assert_eq!(Instant::now(), at);
}

/// A head start no earlier than the end of the wait is none (the legacy source): the restore is
/// waited for until then and never counts as raced; with a real head start a late one does.
#[tokio::test(start_paused = true)]
async fn a_head_start_at_the_end_of_the_wait_is_no_race() {
    let start = Instant::now();
    let until = start + Duration::from_millis(2500);
    let mut late = Box::pin(tokio::time::sleep(Duration::from_secs(4)));
    assert!(!races(&mut late, until, until, Component::Domestic).await);
    assert_eq!(Instant::now() - start, Duration::from_millis(2500));
    let start = Instant::now();
    let mut late = Box::pin(tokio::time::sleep(Duration::from_secs(4)));
    assert!(
        races(
            &mut late,
            start + HEAD_START,
            start + Duration::from_millis(2500),
            Component::Domestic
        )
        .await
    );
    assert_eq!(Instant::now() - start, HEAD_START);
    let mut prompt = Box::pin(tokio::time::sleep(Duration::from_millis(100)));
    let start = Instant::now();
    assert!(
        !races(
            &mut prompt,
            start + HEAD_START,
            start + Duration::from_millis(2500),
            Component::Domestic
        )
        .await
    );
}
