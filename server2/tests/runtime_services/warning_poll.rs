//! Test-only warning faults through the real supervisor and an owned HTTP S3 peer.
use server2::{
    budget::{BudgetError, Clock},
    push::deliver::{
        Diagnostics, Event, Servers,
        supervisor::Workers,
        warnings::{ApiLocations, WarningWorker},
    },
    runtime_services::RuntimeServices,
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

struct HealthyClock;
impl Clock for HealthyClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(1_792_112_400_000)
    }
}
struct WarningClock {
    calls: AtomicUsize,
    panic: bool,
}
impl Clock for WarningClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            if self.panic {
                panic!("synthetic warning poll clock panic");
            }
            return Err(BudgetError::Clock);
        }
        HealthyClock.now_ms()
    }
}
#[derive(Default)]
struct DiagnosticCount(AtomicUsize, AtomicUsize);
impl Diagnostics for DiagnosticCount {
    fn delivery(&self, _: &Event) {
        self.1.fetch_add(1, Ordering::SeqCst);
    }
    fn minute(&self, _: &str, _: &'static str) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
async fn observed(counter: &AtomicUsize, minimum: usize) -> bool {
    tokio::time::timeout(Duration::from_secs(2), async {
        while counter.load(Ordering::SeqCst) < minimum {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .is_ok()
}
fn warning_worker(
    services: &RuntimeServices,
    clock: Arc<dyn Clock>,
    diagnostics: Arc<dyn Diagnostics>,
) -> Arc<WarningWorker<server2::runtime_services::ProcessS3>> {
    Arc::new(WarningWorker::new(
        services.push.clone().unwrap(),
        Arc::new(services.s3.clone().unwrap()),
        services.warning_feed.clone().unwrap(),
        services.warning_store.clone().unwrap(),
        Arc::new(ApiLocations::new(
            Arc::new(services.native_fetch.clone()),
            Servers {
                service: "http://127.0.0.1:9".into(),
                api: "http://127.0.0.1:9".into(),
            },
        )),
        services.delivery.as_ref().unwrap().fcm.clone(),
        clock,
        diagnostics,
    ))
}
fn workers_with_warning_clock(
    services: &RuntimeServices,
    clock: Arc<dyn Clock>,
    diagnostics: Arc<DiagnosticCount>,
) -> Arc<Workers<server2::runtime_services::ProcessS3>> {
    let normal = services.delivery.as_ref().unwrap();
    Arc::new(Workers {
        alarm: normal.alarm.clone(),
        alerts: normal.alerts.clone(),
        warnings: warning_worker(services, clock, diagnostics.clone()),
        fcm: normal.fcm.clone(),
        clock: normal.clock.clone(),
        diagnostics,
    })
}
async fn recovery_case(panic: bool) {
    let peer = super::common::Peer::new();
    let port = reqwest::Url::parse(&peer.endpoint).unwrap().port().unwrap();
    let services = RuntimeServices::from_vars_with_delivery(
        &peer.vars("push"),
        &peer.builtins(),
        server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
        Arc::new(HealthyClock),
        None,
    )
    .unwrap();
    super::common::ready(&services).await;
    let clock = Arc::new(WarningClock {
        calls: AtomicUsize::new(0),
        panic,
    });
    let diagnostics = Arc::new(DiagnosticCount::default());
    let workers = workers_with_warning_clock(&services, clock.clone(), diagnostics.clone());
    let mut supervisor = workers.start();
    let first_failure = observed(&diagnostics.0, 1).await;
    // Restore and failure used real HTTP/time; accelerate only the regular poll interval.
    tokio::time::pause();
    tokio::time::sleep(Duration::from_secs(5)).await;
    tokio::time::resume();
    let later_poll = observed(&clock.calls, 2).await;
    let healthy_drain = supervisor
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    let writer_joined = services
        .push
        .as_ref()
        .unwrap()
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    drop(supervisor);
    drop(services);
    drop(peer);
    let peer_closed = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(100),
    )
    .is_err();
    assert!(first_failure, "the injected warning fault was not observed");
    assert!(
        writer_joined && peer_closed,
        "owned writer and peer must retire before behavior assertions"
    );
    assert_eq!(
        healthy_drain, !panic,
        "task panic remains an incomplete drain; ordinary poll error is completed work"
    );
    assert!(
        later_poll,
        "a terminated warning job must not suppress later regular polling"
    );
}
#[tokio::test]
async fn warning_poll_panic_does_not_permanently_latch_the_supervisor() {
    recovery_case(true).await;
}
#[tokio::test]
async fn warning_poll_error_returns_to_the_regular_schedule() {
    recovery_case(false).await;
}

struct HeldClock {
    calls: AtomicUsize,
    released: std::sync::Mutex<bool>,
    wake: std::sync::Condvar,
}
impl HeldClock {
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.wake.notify_all();
    }
}
impl Clock for HeldClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        // A test-only blocking dependency; let Tokio replace this worker so its
        // timer driver and the other jobs keep running. Release/timeout bound it.
        tokio::task::block_in_place(|| {
            let (released, _) = self
                .wake
                .wait_timeout_while(
                    self.released.lock().unwrap(),
                    Duration::from_secs(12),
                    |done| !*done,
                )
                .unwrap();
            if !*released {
                return Err(BudgetError::Clock);
            }
            HealthyClock.now_ms()
        })
    }
}
struct ReleaseClock(Arc<HeldClock>);
impl Drop for ReleaseClock {
    fn drop(&mut self) {
        self.0.release();
    }
}
struct AnchoredClock(std::time::Instant);
impl Clock for AnchoredClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(HealthyClock.now_ms()? + 59_950 + self.0.elapsed().as_millis() as i64)
    }
}
struct AlarmPanicClock(AtomicUsize);
impl Clock for AlarmPanicClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        panic!("synthetic unrelated alarm clock panic");
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unrelated_alarm_panic_does_not_queue_an_extra_warning_poll() {
    let peer = super::common::Peer::new();
    let port = reqwest::Url::parse(&peer.endpoint).unwrap().port().unwrap();
    let services = RuntimeServices::from_vars_with_delivery(
        &peer.vars("push"),
        &peer.builtins(),
        server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
        Arc::new(HealthyClock),
        None,
    )
    .unwrap();
    super::common::ready(&services).await;
    let normal = services.delivery.as_ref().unwrap();
    let held = Arc::new(HeldClock {
        calls: AtomicUsize::new(0),
        released: std::sync::Mutex::new(false),
        wake: std::sync::Condvar::new(),
    });
    let release = ReleaseClock(held.clone());
    let alarm_clock = Arc::new(AlarmPanicClock(AtomicUsize::new(0)));
    let diagnostics = Arc::new(DiagnosticCount::default());
    let servers = || Servers {
        service: "http://127.0.0.1:9".into(),
        api: "http://127.0.0.1:9".into(),
    };
    let warnings = warning_worker(&services, held.clone(), diagnostics.clone());
    let alarm = Arc::new(server2::push::deliver::AlarmWorker::new(
        services.push.clone().unwrap(),
        Arc::new(services.s3.clone().unwrap()),
        Arc::new(services.native_fetch.clone()),
        normal.fcm.clone(),
        servers(),
        alarm_clock.clone(),
        diagnostics.clone(),
    ));
    let workers = Arc::new(Workers {
        alarm,
        alerts: normal.alerts.clone(),
        warnings,
        fcm: normal.fcm.clone(),
        clock: Arc::new(AnchoredClock(std::time::Instant::now())),
        diagnostics,
    });
    let began = tokio::time::Instant::now();
    let mut supervisor = workers.start();
    let warning_started = observed(&held.calls, 1).await;
    let alarm_failed = observed(&alarm_clock.0, 1).await;
    // The regular tick at five seconds occurs while the original warning is live.
    tokio::time::sleep_until(began + Duration::from_secs(6)).await;
    // Stop new admission before releasing the live poll. A normally pending interval
    // tick must not be mistaken for a previously enqueued duplicate warning job.
    supervisor.quiesce();
    release.0.release();
    let healthy_drain = supervisor
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    let polls_before_next_regular_tick = held.calls.load(Ordering::SeqCst);
    let writer_joined = services
        .push
        .as_ref()
        .unwrap()
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    drop(supervisor);
    drop(services);
    drop(peer);
    drop(release);
    let peer_closed = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(100),
    )
    .is_err();
    assert!(warning_started && alarm_failed && writer_joined && peer_closed);
    assert!(
        !healthy_drain,
        "the unrelated alarm failure remains reported"
    );
    assert_eq!(
        polls_before_next_regular_tick, 1,
        "an unrelated failure must not queue an extra warning behind the held poll"
    );
}

/// Additional real-time CLI scenario. Requires this compile-time checkout and Python peer.
#[tokio::test]
#[ignore = "owned real-time API/S3 smoke, invoked explicitly by the task runner"]
async fn owned_warning_recovery_api_child() {
    use server2::storage::CatalogTransport;
    let peer = super::common::Peer::new();
    let s3_port = reqwest::Url::parse(&peer.endpoint).unwrap().port().unwrap();
    let services = RuntimeServices::from_vars_with_delivery(
        &peer.vars("push"),
        &peer.builtins(),
        server2::push::deliver::Endpoints::loopback("http://127.0.0.1:9/"),
        Arc::new(HealthyClock),
        None,
    )
    .unwrap();
    super::common::ready(&services).await;
    let clock = Arc::new(WarningClock {
        calls: AtomicUsize::new(0),
        panic: true,
    });
    let diagnostics = Arc::new(DiagnosticCount::default());
    let workers = workers_with_warning_clock(&services, clock.clone(), diagnostics.clone());
    let began = std::time::Instant::now();
    let mut supervisor = workers.start();
    let failed = observed(&diagnostics.0, 1).await;
    let recovered = tokio::time::timeout(Duration::from_secs(8), async {
        while clock.calls.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .is_ok();
    let recovered_seconds = began.elapsed().as_secs_f64();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api_port = listener.local_addr().unwrap().port();
    let push = services.push.clone().unwrap();
    let app = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let push = push.clone();
        async move { push.handle(request).await.unwrap() }
    });
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let api = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
            .unwrap();
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let body = r#"[{"type":"ios","fcmToken":"synthetic-warning-recovery","cityIndex":1,"id":1,"town":{"first":"Seoul"},"source":"KMA","pushTime":420}]"#;
    let result = client
        .post(format!("http://127.0.0.1:{api_port}/v000902/push-list"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await;
    let (status, reply) = match result {
        Ok(response) => (
            response.status().as_u16(),
            response.text().await.unwrap_or_default(),
        ),
        Err(_) => (0, String::new()),
    };
    let sequence = services.push.as_ref().unwrap().state().read().unwrap().seq;
    let journal_present = services
        .s3
        .as_ref()
        .unwrap()
        .get_control(&server2::push::durable::journal_key(1), 1024 * 1024)
        .await
        .is_ok();
    let _ = stop.send(());
    let api_joined = tokio::time::timeout(Duration::from_secs(2), api)
        .await
        .is_ok();
    let healthy_drain = supervisor
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    let writer_joined = services
        .push
        .as_ref()
        .unwrap()
        .drain(tokio::time::Instant::now() + Duration::from_secs(2))
        .await;
    let polls = clock.calls.load(Ordering::SeqCst);
    let deliveries = diagnostics.1.load(Ordering::SeqCst);
    drop(supervisor);
    drop(services);
    drop(peer);
    drop(client);
    let closed = |port| {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(100),
        )
        .is_err()
    };
    let ports_closed = closed(api_port) && closed(s3_port);
    assert!(
        api_joined && writer_joined && ports_closed,
        "owned API/writer/S3 must retire before behavior assertions"
    );
    assert!(failed && recovered && polls >= 2 && (4.5..8.5).contains(&recovered_seconds));
    assert!(
        !healthy_drain,
        "the original warning task failure must remain reported"
    );
    assert_eq!(status, 200);
    let list: serde_json::Value = serde_json::from_str(&reply).unwrap();
    assert!(
        list.as_array()
            .is_some_and(|rows| rows.len() == 1 && !rows[0].is_null())
    );
    assert!(sequence == 1 && journal_present);
    assert_eq!(
        deliveries, 0,
        "empty warning feed and no minute tick must cause no delivery events"
    );
    println!(
        "WARNING_RECOVERY_RESULT {}",
        serde_json::json!({
            "verdict":"PASS", "poll_calls":polls, "recovered_seconds":recovered_seconds,
            "task_failure_retained":!healthy_drain, "http_status":status, "sequence":sequence,
            "journal_1_present":journal_present, "delivery_diagnostic_events":deliveries,
            "api_port":api_port, "s3_port":s3_port, "owned_ports_closed":ports_closed,
            "production_eligible":false, "scope":"Real scheduled Workers and public push handler via owned API/S3; not full main or readiness endpoint",
        })
    );
}
