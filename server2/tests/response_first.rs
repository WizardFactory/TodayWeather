//! Isolated in-memory publisher; no provider, socket, credentials or S3.
use server2::{
    gateway::BoxFuture,
    storage::{
        CatalogId, CatalogLimits, Error, GroupDeclaration, GroupMember, Limits, Period,
        ProviderKey, RawRecord,
        response_first::{
            Batch, Checkpoint, Config, Publisher, ReleaseReason, ResponseScope, Writer,
        },
    },
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::SeqCst},
    },
    time::Duration,
};
use tokio::{sync::Semaphore, time::Instant};
struct Sink {
    attempts: AtomicUsize,
    allow: Semaphore,
}
impl Default for Sink {
    fn default() -> Self {
        Self {
            attempts: AtomicUsize::new(0),
            allow: Semaphore::new(0),
        }
    }
}
impl Publisher for Sink {
    fn publish(&self, _batch: Arc<Batch>, _deadline: Instant) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            self.attempts.fetch_add(1, SeqCst);
            self.allow
                .acquire()
                .await
                .map_err(|_| Error::Transport)?
                .forget();
            Ok(())
        })
    }
}
fn batch() -> Batch {
    batch_for(60)
}
fn batch_for(nx: u16) -> Batch {
    let r = RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx, ny: 127 },
        Period {
            local_date: 20261025,
            slot: "1200".into(),
        },
        1792897200000,
        200,
        "application/json",
        None,
        Arc::from(&b"{\"t1h\":17}"[..]),
        &Limits::default(),
    )
    .unwrap();
    let d = GroupDeclaration::new(
        vec![GroupMember {
            envelope: r.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&r.envelope.identity, "20261025-1200").unwrap()],
        }],
        &CatalogLimits::default(),
    )
    .unwrap();
    Batch {
        declaration: d,
        records: vec![r],
    }
}
fn writer(sink: Arc<Sink>) -> Arc<Writer> {
    Writer::new(
        sink,
        Config {
            retained_bytes: 32768,
            group_bytes: 16384,
            dormancy: Duration::from_millis(100),
            publish_timeout: Duration::from_millis(500),
            ..Config::default()
        },
    )
    .unwrap()
}
#[tokio::test]
async fn ready_precedes_s3_and_body_drop_releases_owned_raw() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let ready = tokio::time::timeout(
        Duration::from_millis(200),
        scope.run(writer.acquire(
            "grid/current/60/127/20261025-1200".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        )),
    )
    .await
    .expect("a blocked S3 write must not block RamReady")
    .unwrap()
    .unwrap();
    assert!(!ready.is_durable());
    assert_eq!(sink.attempts.load(SeqCst), 0);
    let body = scope.body(axum::body::Body::from("weather"));
    drop(body);
    tokio::task::yield_now().await;
    sink.allow.add_permits(1);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
    assert!(ready.is_durable());
    assert_eq!(writer.stats().durable, 1);
}

async fn durable(ready: &server2::storage::response_first::RamReady) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while !ready.is_durable() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn terminal_poll_releases_every_batch_and_later_readers_do_not_extend_the_gate() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let pin = writer.pin();
    let a = scope
        .run(writer.acquire(
            "a".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    let b = scope
        .run(writer.acquire(
            "b".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(sink.attempts.load(SeqCst), 0);
    assert_eq!(
        axum::body::to_bytes(scope.body(axum::body::Body::from("weather")), 1024)
            .await
            .unwrap(),
        "weather"
    );
    // A later request may read the overlay but cannot re-close a released gate.
    let late = ResponseScope::default();
    assert!(late.run(async { writer.cached("a") }).await.is_some());
    sink.allow.add_permits(2);
    durable(&a).await;
    durable(&b).await;
    assert_eq!(writer.stats().publish_attempts, 2);
    drop(pin);
}
#[tokio::test]
async fn one_natural_key_has_one_provider_and_byte_pressure_prevents_new_calls() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let calls = Arc::new(AtomicUsize::new(0));
    let (tx, rx) = tokio::sync::oneshot::channel();
    let c = calls.clone();
    let w = writer.clone();
    let s = scope.clone();
    let a = tokio::spawn(async move {
        s.run(w.acquire(
            "same".into(),
            16384,
            Instant::now() + Duration::from_secs(2),
            async move {
                c.fetch_add(1, SeqCst);
                rx.await.unwrap();
                Ok(Some(batch()))
            },
        ))
        .await
    });
    while calls.load(SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    let c = calls.clone();
    let w = writer.clone();
    let s = scope.clone();
    let b = tokio::spawn(async move {
        s.run(w.acquire(
            "same".into(),
            16384,
            Instant::now() + Duration::from_secs(2),
            async move {
                c.fetch_add(1, SeqCst);
                Ok(Some(batch()))
            },
        ))
        .await
    });
    let (tx2, rx2) = tokio::sync::oneshot::channel();
    let w = writer.clone();
    let s = scope.clone();
    let c = calls.clone();
    let second = tokio::spawn(async move {
        s.run(w.acquire(
            "other".into(),
            16384,
            Instant::now() + Duration::from_secs(2),
            async move {
                c.fetch_add(1, SeqCst);
                rx2.await.unwrap();
                Ok(Some(batch()))
            },
        ))
        .await
    });
    while calls.load(SeqCst) < 2 {
        tokio::task::yield_now().await;
    }
    let c = calls.clone();
    let denied = scope
        .run(writer.acquire(
            "over-capacity".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async move {
                c.fetch_add(100, SeqCst);
                Ok(Some(batch()))
            },
        ))
        .await;
    assert!(matches!(denied, Err(Error::Capacity)));
    assert_eq!(calls.load(SeqCst), 2);
    tx.send(()).unwrap();
    tx2.send(()).unwrap();
    let a = a.await.unwrap().unwrap().unwrap();
    let b = b.await.unwrap().unwrap().unwrap();
    second.await.unwrap().unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert_eq!(writer.stats().providers, 2);
    scope.terminal();
    sink.allow.add_permits(2);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}
#[tokio::test]
async fn cancelled_waiter_does_not_cancel_the_owned_provider_or_strand_raw() {
    let sink = Arc::new(Sink::default());
    sink.allow.add_permits(1);
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let w = writer.clone();
    let s = scope.clone();
    let waiter = tokio::spawn(async move {
        s.run(w.acquire(
            "cancel".into(),
            16384,
            Instant::now() + Duration::from_secs(2),
            async move {
                rx.await.unwrap();
                Ok(Some(batch()))
            },
        ))
        .await
    });
    while writer.stats().providers == 0 {
        tokio::task::yield_now().await;
    }
    waiter.abort();
    let _ = waiter.await;
    tx.send(()).unwrap();
    // No waiter remains to signal a response: the hard cap still makes progress.
    tokio::time::timeout(Duration::from_secs(1), async {
        while writer.stats().durable == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(sink.attempts.load(SeqCst), 1);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}
#[tokio::test]
async fn dormant_batches_do_not_hold_writer_slots_and_shutdown_releases_them() {
    let sink = Arc::new(Sink::default());
    sink.allow.add_permits(2);
    let writer = Writer::new(
        sink.clone(),
        Config {
            retained_bytes: 32768,
            group_bytes: 16384,
            writers: 1,
            dormancy: Duration::from_secs(2),
            ..Config::default()
        },
    )
    .unwrap();
    let first = ResponseScope::default();
    let second = ResponseScope::default();
    let a = first
        .run(writer.acquire(
            "dormant".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    let b = second
        .run(writer.acquire(
            "released".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    second.terminal();
    durable(&b).await;
    assert!(!a.is_durable());
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
    assert!(a.is_durable());
}
#[tokio::test]
async fn promotion_keeps_overlay_for_discovery_started_before_durability() {
    let sink = Arc::new(Sink::default());
    sink.allow.add_permits(1);
    let writer = writer(sink.clone());
    let old_discovery = writer.pin();
    let scope = ResponseScope::default();
    let ready = scope
        .run(writer.acquire(
            "promotion".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    scope.terminal();
    durable(&ready).await;
    let new_discovery = writer.pin();
    let old_reader = ResponseScope::default();
    assert!(
        old_reader
            .run(async { writer.cached("promotion") })
            .await
            .is_some()
    );
    drop(old_discovery);
    assert!(
        old_reader
            .run(async { writer.cached("promotion") })
            .await
            .is_none(),
        "new discovery can use the now-published canonical group"
    );
    drop(new_discovery);
}
#[tokio::test]
async fn corrupt_raw_never_becomes_ready_and_forced_drain_counts_served_abandonment() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let mut bad = batch();
    bad.records[0].bytes = Arc::from(&b"changed"[..]);
    let r = scope
        .run(writer.acquire(
            "corrupt".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(bad)) },
        ))
        .await;
    assert!(matches!(r, Err(Error::Invalid("RAM raw identity"))));
    assert_eq!(writer.stats().ready, 0);
    assert_eq!(sink.attempts.load(SeqCst), 0);
    let _ready = scope
        .run(writer.acquire(
            "leftover".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(!writer.drain(Instant::now()).await);
    assert_eq!(writer.stats().abandoned, 1);
    assert_eq!(writer.stats().served_raw_abandoned, 1);
}
#[tokio::test]
async fn background_callers_wait_for_durability() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let w = writer.clone();
    let waiter = tokio::spawn(async move {
        w.acquire(
            "background".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        )
        .await
    });
    while sink.attempts.load(SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    assert!(!waiter.is_finished());
    sink.allow.add_permits(1);
    assert!(waiter.await.unwrap().unwrap().unwrap().is_durable());
}
struct Flaky(AtomicUsize);
impl Publisher for Flaky {
    fn publish(&self, batch: Arc<Batch>, _deadline: Instant) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            assert_eq!(batch.records[0].bytes.as_ref(), b"{\"t1h\":17}");
            if self.0.fetch_add(1, SeqCst) == 0 {
                Err(Error::Ambiguous)
            } else {
                Ok(())
            }
        })
    }
}
#[tokio::test]
async fn ambiguous_publication_retries_the_same_original_identity() {
    let sink = Arc::new(Flaky(AtomicUsize::new(0)));
    let writer = Writer::new(
        sink.clone(),
        Config {
            retry: Duration::from_millis(1),
            ..Config::default()
        },
    )
    .unwrap();
    let scope = ResponseScope::default();
    let ready = scope
        .run(writer.acquire(
            "retry".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    scope.terminal();
    durable(&ready).await;
    assert_eq!(sink.0.load(SeqCst), 2);
    assert_eq!(writer.stats().served_raw_abandoned, 0);
}

#[tokio::test]
async fn queued_admission_resumes_when_an_earlier_provider_shrinks_its_charge() {
    let sink = Arc::new(Sink::default());
    sink.allow.add_permits(3);
    let writer = writer(sink);
    let scope = ResponseScope::default();
    let run = |key: &str| {
        scope.run(writer.acquire(
            key.into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(Some(batch()))
            },
        ))
    };
    let (a, b, c) = tokio::join!(run("a"), run("b"), run("c"));
    assert!(a.unwrap().is_some() && b.unwrap().is_some() && c.unwrap().is_some());
    assert_eq!(writer.stats().providers, 3);
    assert!(writer.stats().retained_bytes <= 32768);
    assert!(!writer.settled());
    scope.terminal();
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
    assert!(writer.settled());
    let timings = scope.batches();
    assert_eq!(timings.len(), 3);
    for timing in timings {
        assert!(timing.ram_ready <= timing.released.unwrap().0);
        assert!(timing.released.unwrap().0 <= timing.durable.unwrap());
    }
}

#[tokio::test]
async fn a_frozen_summary_gate_ignores_newer_unrelated_pending_inputs() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let a = ResponseScope::default();
    let pin = writer.pin();
    let first = a
        .run(writer.acquire(
            "first".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    a.require_durable(
        &writer,
        &[batch().records[0].envelope.identity.object_key().unwrap()],
    );
    let b = ResponseScope::default();
    let later = b
        .run(writer.acquire(
            "later".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(
        !a.wait_durable(Instant::now() + Duration::from_millis(5))
            .await
    );
    a.terminal();
    sink.allow.add_permits(1);
    durable(&first).await;
    assert!(!later.is_durable());
    assert!(!writer.settled());
    assert!(
        a.wait_durable(Instant::now() + Duration::from_millis(50))
            .await
    );
    b.terminal();
    sink.allow.add_permits(1);
    drop(pin);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}

#[tokio::test]
async fn a_full_cold_grid_fanout_can_reserve_before_any_provider_finishes() {
    let sink = Arc::new(Sink::default());
    let writer = Writer::new(sink.clone(), Config::default()).unwrap();
    // Three ODAM + three VSRT + SHRT + three mid + ASOS + RSS + three national pages.
    // 616MiB of conservative reservations; no actual payload allocation of that size.
    let reservations = [48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 72, 16, 16, 16, 16];
    assert_eq!(reservations.iter().sum::<usize>(), 616);
    let started = Arc::new(Semaphore::new(0));
    let finish = Arc::new(Semaphore::new(0));
    let scope = ResponseScope::default();
    let mut tasks = Vec::new();
    for (i, mib) in reservations.into_iter().enumerate() {
        let w = writer.clone();
        let s = scope.clone();
        let st = started.clone();
        let end = finish.clone();
        tasks.push(tokio::spawn(async move {
            s.run(w.acquire(
                format!("grid-fanout-{i}"),
                mib * 1024 * 1024,
                Instant::now() + Duration::from_secs(2),
                async move {
                    st.add_permits(1);
                    end.acquire().await.unwrap().forget();
                    Ok(Some(batch()))
                },
            ))
            .await
            .unwrap()
            .unwrap()
        }));
    }
    tokio::time::timeout(
        Duration::from_secs(1),
        started.acquire_many(reservations.len() as u32),
    )
    .await
    .expect("one cold fan-out cannot depend on some provider finishing first")
    .unwrap()
    .forget();
    finish.add_permits(reservations.len());
    for task in tasks {
        task.await.unwrap();
    }
    scope.terminal();
    sink.allow.add_permits(reservations.len());
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}

#[tokio::test]
async fn quiesce_does_not_start_a_provider_queued_for_bytes() {
    let sink = Arc::new(Sink::default());
    let writer = writer(sink.clone());
    let scope = ResponseScope::default();
    let started = Arc::new(Semaphore::new(0));
    let finish = Arc::new(Semaphore::new(0));
    let mut tasks = Vec::new();
    for i in 0..3 {
        let w = writer.clone();
        let s = scope.clone();
        let st = started.clone();
        let end = finish.clone();
        tasks.push(tokio::spawn(async move {
            s.run(w.acquire(
                format!("closing-{i}"),
                16384,
                Instant::now() + Duration::from_secs(2),
                async move {
                    st.add_permits(1);
                    end.acquire().await.unwrap().forget();
                    Ok(Some(batch()))
                },
            ))
            .await
        }));
    }
    started.acquire_many(2).await.unwrap().forget();
    writer.quiesce();
    tokio::time::timeout(Duration::from_millis(200), async {
        while !tasks.iter().any(|task| task.is_finished()) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("shutdown must wake queued byte admission before providers finish");
    finish.add_permits(3);
    let mut passed = 0;
    let mut refused = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(Some(_)) => passed += 1,
            Err(Error::Capacity) => refused += 1,
            other => panic!("unexpected result: {}", other.is_ok()),
        }
    }
    assert_eq!((passed, refused), (2, 1));
    assert_eq!(started.available_permits(), 0);
    sink.allow.add_permits(2);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}

struct Reject(AtomicUsize);
impl Publisher for Reject {
    fn publish(&self, _: Arc<Batch>, _: Instant) -> BoxFuture<'_, Result<(), Error>> {
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err(Error::Invalid("permanent test rejection")) })
    }
}
#[tokio::test]
async fn deterministic_rejection_parks_the_charged_original_until_shutdown() {
    let sink = Arc::new(Reject(AtomicUsize::new(0)));
    let writer = Writer::new(
        sink.clone(),
        Config {
            retry: Duration::from_millis(1),
            ..Config::default()
        },
    )
    .unwrap();
    let scope = ResponseScope::default();
    let ready = scope
        .run(writer.acquire(
            "rejected".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    scope.require_durable(
        &writer,
        &[batch().records[0].envelope.identity.object_key().unwrap()],
    );
    scope.terminal();
    tokio::time::timeout(Duration::from_secs(1), async {
        while sink.0.load(SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(sink.0.load(SeqCst), 1);
    assert!(!ready.is_durable());
    assert!(writer.stats().retained_bytes > 0);
    assert_eq!(writer.stats().permanent_failures, 1);
    let eligible = tokio::time::timeout(
        Duration::from_millis(100),
        scope.wait_durable(Instant::now() + Duration::from_secs(30)),
    )
    .await
    .expect("a rejected original must skip its affected summary immediately");
    assert!(!eligible);
    assert!(!writer.drain(Instant::now() + Duration::from_secs(1)).await);
    assert_eq!(writer.stats().served_raw_abandoned, 1);
}

struct SelectiveReject {
    rejected_raw: String,
}
impl Publisher for SelectiveReject {
    fn publish(&self, batch: Arc<Batch>, _: Instant) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            if batch.records[0].envelope.identity.object_key()? == self.rejected_raw {
                Err(Error::Invalid("permanent test rejection"))
            } else {
                Ok(())
            }
        })
    }
}
#[tokio::test]
async fn an_unrelated_parked_failure_does_not_block_snapshot_durability() {
    let bad = batch_for(61);
    let rejected_raw = bad.records[0].envelope.identity.object_key().unwrap();
    let writer = Writer::new(
        Arc::new(SelectiveReject { rejected_raw }),
        Config::default(),
    )
    .unwrap();
    let bad_scope = ResponseScope::default();
    bad_scope
        .run(writer.acquire(
            "bad".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(bad)) },
        ))
        .await
        .unwrap()
        .unwrap();
    bad_scope.terminal();
    tokio::time::timeout(Duration::from_secs(1), async {
        while writer.stats().permanent_failures == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let good_scope = ResponseScope::default();
    good_scope
        .run(writer.acquire(
            "good".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    let good_raw = batch().records[0].envelope.identity.object_key().unwrap();
    good_scope.require_durable(&writer, std::slice::from_ref(&good_raw));
    assert!(!writer.inputs_durable(std::slice::from_ref(&good_raw)));
    good_scope.terminal();
    assert!(
        good_scope
            .wait_durable(Instant::now() + Duration::from_millis(100))
            .await,
        "a snapshot must wait only for the originals it actually used"
    );
    assert!(!writer.settled(), "the unrelated original remains parked");
    assert!(writer.inputs_durable(&[good_raw]));
    assert!(!writer.drain(Instant::now() + Duration::from_secs(1)).await);
}

struct CorruptThenValid(AtomicUsize);
impl Publisher for CorruptThenValid {
    fn publish(&self, _: Arc<Batch>, _: Instant) -> BoxFuture<'_, Result<(), Error>> {
        let first = self.0.fetch_add(1, SeqCst) == 0;
        Box::pin(async move {
            if first {
                Err(Error::Corrupt("transient stored control read"))
            } else {
                Ok(())
            }
        })
    }
}
#[tokio::test]
async fn corrupt_storage_reads_retry_without_reacquiring_provider_data() {
    let sink = Arc::new(CorruptThenValid(AtomicUsize::new(0)));
    let writer = Writer::new(
        sink.clone(),
        Config {
            retry: Duration::from_millis(1),
            ..Config::default()
        },
    )
    .unwrap();
    let scope = ResponseScope::default();
    let ready = scope
        .run(writer.acquire(
            "retry-corrupt".into(),
            16384,
            Instant::now() + Duration::from_secs(1),
            async { Ok(Some(batch())) },
        ))
        .await
        .unwrap()
        .unwrap();
    scope.terminal();
    durable(&ready).await;
    assert_eq!(sink.0.load(SeqCst), 2);
    assert_eq!(writer.stats().providers, 1);
    assert_eq!(writer.stats().permanent_failures, 0);
    assert!(writer.drain(Instant::now() + Duration::from_secs(1)).await);
}

/// Scope inheritance wraps nested owned work, so its cost must not multiply with the depth.
#[test]
fn inheriting_a_scope_keeps_nested_futures_small() {
    use server2::observability::inherit;
    let large = async {
        let buffer = [1u8; 64 * 1024];
        tokio::task::yield_now().await;
        buffer[0]
    };
    let nested = inherit(inherit(inherit(inherit(large))));
    let size = std::mem::size_of_val(&nested);
    assert!(size < 4 * 1024, "{size} bytes on the caller's stack");
}

/// A batch of one grid's current conditions (distinct natural keys for many acquisitions).
fn batch_grid(nx: u16, ny: u16) -> Batch {
    let r = RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx, ny },
        Period {
            local_date: 20261025,
            slot: "1200".into(),
        },
        1792897200000,
        200,
        "application/json",
        None,
        Arc::from(&b"{\"t1h\":17}"[..]),
        &Limits::default(),
    )
    .unwrap();
    let d = GroupDeclaration::new(
        vec![GroupMember {
            envelope: r.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&r.envelope.identity, "20261025-1200").unwrap()],
        }],
        &CatalogLimits::default(),
    )
    .unwrap();
    Batch {
        declaration: d,
        records: vec![r],
    }
}
/// Stress check (not a regression test: its orders depend on the scheduler; the deterministic
/// ones are the `Checkpoint` tests below). 2,000 scoped acquisitions with instant providers,
/// created from the test thread; run on a saturated machine with
/// `cargo test --test response_first -- --ignored`. None may be released as unwaited
/// (NoWaiters) before the body ends; a dormancy release on a slow machine is not this defect.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "stress check: run under CPU saturation"]
async fn stress_scoped_instant_acquisitions_are_never_released_unwaited() {
    let sink = Arc::new(Sink::default());
    let writer = Writer::new(
        sink.clone(),
        Config {
            retained_bytes: 64 << 20,
            group_bytes: 16384,
            entries: 8192,
            ..Config::default()
        },
    )
    .unwrap();
    let scope = ResponseScope::default();
    scope
        .run(async {
            for i in 0..2000u16 {
                writer
                    .acquire(
                        format!("current/{i}"),
                        16384,
                        Instant::now() + Duration::from_secs(5),
                        async move { Ok(Some(batch_grid(1 + i % 140, 1 + i / 140))) },
                    )
                    .await
                    .unwrap();
            }
        })
        .await;
    let unwaited = released_early(&scope)
        .into_iter()
        .filter(|r| *r == ReleaseReason::NoWaiters)
        .count();
    assert_eq!(unwaited, 0, "released as unwaited before the body ended");
    drop(scope.body(axum::body::Body::from("weather")));
    sink.allow.add_permits(4000);
    assert!(writer.drain(Instant::now() + Duration::from_secs(10)).await);
    assert_eq!(writer.stats().durable, 2000);
}

/// A publisher that also holds the writer at one [`Checkpoint`]: the test learns when the writer
/// got there ([`Held::reached`]) and lets it go on ([`Held::go`]). Publications are counted and
/// wait for `allow`, as [`Sink`]'s.
struct Held {
    at: Checkpoint,
    reached: tokio::sync::watch::Sender<bool>,
    open: tokio::sync::watch::Sender<bool>,
    /// Every checkpoint passed so far.
    passed: tokio::sync::watch::Sender<Vec<Checkpoint>>,
    sink: Sink,
}
impl Held {
    fn at(at: Checkpoint) -> Self {
        Self {
            at,
            reached: tokio::sync::watch::channel(false).0,
            open: tokio::sync::watch::channel(false).0,
            passed: tokio::sync::watch::channel(Vec::new()).0,
            sink: Sink::default(),
        }
    }
    async fn reached(&self) {
        let _ = self.reached.subscribe().wait_for(|r| *r).await;
    }
    /// Wait until the writer passed `point`.
    async fn passed(&self, point: Checkpoint) {
        let _ = self
            .passed
            .subscribe()
            .wait_for(|p| p.contains(&point))
            .await;
    }
    fn go(&self) {
        self.open.send_replace(true);
    }
}
impl Publisher for Held {
    fn publish(&self, batch: Arc<Batch>, deadline: Instant) -> BoxFuture<'_, Result<(), Error>> {
        self.sink.publish(batch, deadline)
    }
    fn checkpoint(&self, point: Checkpoint) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if point == self.at {
                self.reached.send_replace(true);
                let _ = self.open.subscribe().wait_for(|o| *o).await;
            }
            self.passed.send_modify(|p| p.push(point));
        })
    }
}
/// A writer whose checks before a body ends stay clear of its 10 s dormancy cap.
fn held_writer(held: Arc<Held>) -> Arc<Writer> {
    Writer::new(
        held,
        Config {
            retained_bytes: 32768,
            group_bytes: 16384,
            dormancy: Duration::from_secs(10),
            ..Config::default()
        },
    )
    .unwrap()
}
/// The batches `scope` used that were released before its body ended, and why.
fn released_early(scope: &ResponseScope) -> Vec<ReleaseReason> {
    scope
        .batches()
        .into_iter()
        .filter_map(|b| b.released.map(|r| r.1))
        .collect()
}

/// RFW-zero-count-join: the response that created an acquisition is cancelled, so nobody waits
/// for it; another response joins it after its batch is valid and before it is Ready. That
/// response is a waiter: the batch is held until its body ends, not released as unwaited
/// (NoWaiters) and published while it is still being sent.
#[tokio::test]
async fn a_response_joining_before_ready_holds_a_cancelled_creators_batch() {
    let held = Arc::new(Held::at(Checkpoint::Validated));
    let writer = held_writer(held.clone());
    let key = "grid/current/60/127/20261025-1200";
    let (provide, provided) = tokio::sync::oneshot::channel::<()>();
    let creator = tokio::spawn({
        let writer = writer.clone();
        async move {
            let scope = ResponseScope::default();
            scope
                .run(writer.acquire(
                    key.into(),
                    16384,
                    Instant::now() + Duration::from_secs(5),
                    async move {
                        let _ = provided.await;
                        Ok(Some(batch()))
                    },
                ))
                .await
        }
    });
    tokio::task::yield_now().await;
    creator.abort();
    match creator.await {
        Err(e) => assert!(e.is_cancelled()),
        Ok(_) => panic!("the creator ran to its end"),
    }
    provide.send(()).unwrap();
    held.reached().await;
    let joiner = ResponseScope::default();
    let joined = tokio::spawn({
        let (writer, joiner) = (writer.clone(), joiner.clone());
        async move {
            joiner
                .run(writer.acquire(
                    key.into(),
                    16384,
                    Instant::now() + Duration::from_secs(5),
                    async { panic!("the joiner starts no provider") },
                ))
                .await
        }
    });
    tokio::task::yield_now().await;
    held.go();
    assert!(joined.await.unwrap().unwrap().is_some());
    assert_eq!(
        released_early(&joiner),
        Vec::new(),
        "released before the body ended"
    );
    assert_eq!(
        held.sink.attempts.load(SeqCst),
        0,
        "published before the body ended"
    );
    drop(joiner.body(axum::body::Body::from("weather")));
    held.sink.allow.add_permits(1);
    assert!(writer.drain(Instant::now() + Duration::from_secs(5)).await);
    assert_eq!(writer.stats().durable, 1);
}

/// One scoped acquisition of `writer` by a response of its own (`scope`), with an instant
/// provider.
fn respond(
    writer: &Arc<Writer>,
    scope: &ResponseScope,
) -> tokio::task::JoinHandle<Result<Option<Arc<server2::storage::response_first::RamReady>>, Error>>
{
    let (writer, scope) = (writer.clone(), scope.clone());
    tokio::spawn(async move {
        scope
            .run(writer.acquire(
                "grid/current/60/127/20261025-1200".into(),
                16384,
                Instant::now() + Duration::from_secs(5),
                async { Ok(Some(batch())) },
            ))
            .await
    })
}
/// The body of `scope` ends and its batch becomes durable.
async fn body_ends(held: &Held, writer: &Arc<Writer>, scope: &ResponseScope) {
    drop(scope.body(axum::body::Body::from("weather")));
    held.sink.allow.add_permits(1);
    assert!(writer.drain(Instant::now() + Duration::from_secs(5)).await);
    assert_eq!(writer.stats().durable, 1);
}

/// RFW-test-scheduling: the creating caller is paused right after it created the entry and
/// started its job, and the job makes the batch Ready meanwhile. The caller was a waiter from the
/// start, so its batch is held until its body ends.
#[tokio::test]
async fn a_creator_not_yet_waiting_when_its_batch_is_ready_holds_it() {
    let held = Arc::new(Held::at(Checkpoint::Created));
    let writer = held_writer(held.clone());
    let scope = ResponseScope::default();
    let creator = respond(&writer, &scope);
    held.reached().await;
    held.passed(Checkpoint::Announced).await;
    held.go();
    assert!(creator.await.unwrap().unwrap().is_some());
    assert_eq!(
        released_early(&scope),
        Vec::new(),
        "released before the body ended"
    );
    assert_eq!(
        held.sink.attempts.load(SeqCst),
        0,
        "published before the body ended"
    );
    body_ends(&held, &writer, &scope).await;
}

/// RFW-test-scheduling: the job is paused right after it made the batch Ready, and the waiting
/// response takes the batch and returns meanwhile. It was counted before Ready, so its batch is
/// held until its body ends.
#[tokio::test]
async fn a_waiter_that_takes_the_batch_at_once_holds_it() {
    let held = Arc::new(Held::at(Checkpoint::Announced));
    let writer = held_writer(held.clone());
    let scope = ResponseScope::default();
    let waiter = respond(&writer, &scope);
    held.reached().await;
    assert!(waiter.await.unwrap().unwrap().is_some());
    held.go();
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        released_early(&scope),
        Vec::new(),
        "released before the body ended"
    );
    assert_eq!(
        held.sink.attempts.load(SeqCst),
        0,
        "published before the body ended"
    );
    body_ends(&held, &writer, &scope).await;
}
