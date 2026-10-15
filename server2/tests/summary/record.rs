//! The summary store and the post-response recorder: write-once revisions, newest selection,
//! late inputs, older input sets, repeated requests and cold processes.
use super::support::*;
use server2::summary::grid::GridInputs;
use server2::summary::{Recorder, SummarySink, SummaryStore};
use std::sync::Arc;
use std::sync::atomic::Ordering;

#[tokio::test]
async fn store_writes_once_and_reads_the_newest_verified_revision() {
    let t = Arc::new(MemorySummaries::new());
    let store = SummaryStore::new(t.clone());
    let old = grid_summary(20261014, 20., 100);
    let new = grid_summary(20261014, 21., 200);
    store.publish(&old, deadline()).await.unwrap();
    store.publish(&new, deadline()).await.unwrap();
    // The identical revision again is a verified 412.
    store.publish(&new, deadline()).await.unwrap();
    assert_eq!(t.keys().len(), 2);
    let newest = store
        .newest(&new.key, 20261014, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(newest.summary, new);
    // A corrupt newest object is skipped; a foreign name is ignored.
    t.plant(&new.object_key(), b"{}");
    t.plant(
        &format!("{}notes.json", new.key.date_prefix(20261014)),
        b"{}",
    );
    let newest = store
        .newest(&new.key, 20261014, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(newest.summary, old);
    // A different body under an existing name is an error, not a success.
    assert!(store.publish(&new, deadline()).await.is_err());
    assert!(
        store
            .newest(&new.key, 20261013, deadline())
            .await
            .unwrap()
            .is_none()
    );
}

fn inputs_at(fetched: u64) -> GridInputs {
    let start = server2::summary::kst_midnight_ms(20261014).unwrap();
    GridInputs {
        town: town(),
        grid: (60, 127),
        ids: vec![input(
            "ultra-srt-ncst",
            start + 3_600_000,
            start + 3_600_000,
            fetched,
        )],
        asos: None,
    }
}

#[tokio::test]
async fn recorder_writes_late_revisions_and_never_supersedes_newer_inputs() {
    let t = Arc::new(MemorySummaries::new());
    let recorder = Recorder::new(t.clone());
    let now = kst(20261015, 1200);
    let rows = |ta_max: f64| vec![day_row("20261014", 24., ta_max, 10.)];
    let record = |r: &Recorder<Arc<MemorySummaries>>, fetched: u64, ta_max: f64| {
        let r = r.clone();
        async move {
            let c = Recorder::<Arc<MemorySummaries>>::candidates(
                &inputs_at(fetched),
                &rows(ta_max),
                now,
            );
            r.record_now(c, now, deadline()).await
        }
    };
    let first = record(&recorder, 100, 20.).await;
    assert_eq!(first.written.len(), 1);
    // The same inputs again: no S3 call at all.
    let calls = t.calls();
    let again = record(&recorder, 100, 20.).await;
    assert_eq!((again.written.len(), again.unchanged), (0, 1));
    assert_eq!(t.calls(), calls);
    // A late input that leaves the values unchanged writes nothing.
    let same = record(&recorder, 150, 20.).await;
    assert_eq!(same.written.len(), 0);
    // A late input that changes the values writes a newer revision.
    let late = record(&recorder, 200, 23.).await;
    assert_eq!(late.written.len(), 1);
    let store = recorder.store();
    let key = server2::summary::SummaryKey::Grid { town: town() };
    let newest = store
        .newest(&key, 20261014, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(newest.summary.value("taMax"), Some(23.));
    assert_eq!(newest.name.latest, 200);
    // An older input set with other values never supersedes it.
    let older = record(&recorder, 120, 25.).await;
    assert_eq!(older.written.len(), 0);
    // A cold process reads the newest revision first and writes nothing for equal values.
    let cold = Recorder::new(t.clone());
    let puts = t.puts.load(Ordering::SeqCst);
    let report = record(&cold, 300, 23.).await;
    assert_eq!(report.written.len(), 0);
    assert_eq!(t.puts.load(Ordering::SeqCst), puts);
    assert_eq!(t.keys().len(), 2, "two revisions retained, none deleted");
}

#[tokio::test]
async fn recorder_skips_incomplete_days_and_retries_after_failures() {
    let t = Arc::new(MemorySummaries::new());
    let recorder = Recorder::new(t.clone());
    let now = kst(20261015, 1200);
    let rows = vec![
        day_row("20261013", 17., 20., 10.),
        day_row("20261014", 24., 20., 10.),
    ];
    let c = Recorder::<Arc<MemorySummaries>>::candidates(&inputs_at(100), &rows, now);
    assert_eq!(c.len(), 1, "17 valid hours are not a day");
    t.fail(true);
    let failed = recorder.record_now(c.clone(), now, deadline()).await;
    assert_eq!((failed.written.len(), failed.failed), (0, 1));
    t.fail(false);
    let ok = recorder.record_now(c, now, deadline()).await;
    assert_eq!(ok.written.len(), 1, "a failed attempt is not remembered");
}

#[tokio::test]
async fn sink_records_in_the_background() {
    let t = Arc::new(MemorySummaries::new());
    let recorder = Recorder::new(t.clone());
    let now = kst(20261015, 1200);
    let sink: Arc<dyn SummarySink> = Arc::new(recorder.clone());
    sink.record(
        inputs_at(100),
        vec![day_row("20261014", 24., 20., 10.)],
        now,
    );
    assert!(recorder.idle(deadline()).await);
    assert_eq!(t.keys().len(), 1);
    // Already examined: the sink does not even start a task.
    let calls = t.calls();
    sink.record(
        inputs_at(100),
        vec![day_row("20261014", 24., 20., 10.)],
        now,
    );
    assert!(recorder.idle(deadline()).await);
    assert_eq!(t.calls(), calls);
    assert_eq!(recorder.dropped(), 0);
}
