//! Legacy provider order, S08 funding, down markers, single flight and O-9 publication.
use super::common::ms;
use super::support::*;
use server2::world::{AirConfig, AirOutcome, AirSource, FixedClock, LiveAir, MemoryAirStore};
use std::sync::Arc;

const T: &str = "2026-09-27T14:20:00Z";
fn fresh_waqi() -> Vec<u8> {
    waqi_body("2026-09-27T23:00:00+09:00", [37.566535, 126.9779692])
}
fn stale_owm() -> Vec<u8> {
    // dt 2026-09-27 05:00Z: older than 8 h at 14:20Z, so unusable for the request.
    let mut v: serde_json::Value =
        serde_json::from_slice(&fixture("openweather-seoul.json")).unwrap();
    v["list"][0]["dt"] = 1_790_485_200u64.into();
    serde_json::to_vec(&v).unwrap()
}
fn observed(outcome: &AirOutcome) -> Option<String> {
    match outcome {
        AirOutcome::Observation(o) => Some(o.provider.clone()),
        _ => None,
    }
}
fn memory() -> Arc<MemoryAirStore> {
    Arc::new(MemoryAirStore::default())
}

#[tokio::test]
async fn free_order_down_marking_and_last_unusable_fallback() {
    let stub = Stub::start().await;
    stub.push(GOOGLE, Reply::status(401));
    stub.push(OWM, Reply::json(stale_owm()));
    stub.push(WAQI, Reply::json(fresh_waqi()));
    let clock = Arc::new(FixedClock::new(ms(T)));
    let store = memory();
    let (air, _) = live(config(&stub, 100), store.clone(), clock.clone());
    let out = air.current(37.5665, 126.978, ms(T)).await;
    assert_eq!(observed(&out).as_deref(), Some("aqicn"));
    let order: Vec<String> = stub.calls().iter().map(|c| c.path.clone()).collect();
    assert_eq!(
        order,
        [
            GOOGLE.to_owned(),
            OWM.to_owned(),
            "/feed/geo:37.57;126.98/".to_owned()
        ]
    );
    // Google is POSTed the legacy JSON body at the cell coordinate.
    let g = &stub.calls()[0];
    assert_eq!(g.method, "POST");
    assert_eq!(
        String::from_utf8(g.body.clone()).unwrap(),
        r#"{"location":{"latitude":37.57,"longitude":126.98},"extraComputations":["LOCAL_AQI","POLLUTANT_CONCENTRATION"],"universalAqi":true,"languageCode":"en"}"#
    );
    assert_eq!(g.query, format!("key={GOOGLE_KEY}"));
    assert_eq!(
        stub.calls()[1].query,
        format!("lat=37.57&lon=126.98&appid={OWM_KEY}")
    );
    assert_eq!(stub.calls()[2].query, format!("token={WAQI_KEY}"));
    // The winning body is the stored record.
    let rows = store.all();
    assert_eq!(rows.len(), 1);
    assert_eq!(&rows[0].1.body[..], &fresh_waqi()[..]);

    // Another cell 5 min later: Google is still down (10 min), OpenWeather is unusable and
    // WAQI now fails, so the last unusable observation (OpenWeather) is kept and stored.
    clock.set(ms(T) + 300_000.);
    stub.push(WAQI, Reply::status(500));
    let out = air.current(35.18, 129.07, ms(T) + 300_000.).await;
    assert!(matches!(out, AirOutcome::None), "{out:?}");
    let later: Vec<String> = stub.calls()[3..].iter().map(|c| c.path.clone()).collect();
    assert_eq!(
        later,
        [OWM.to_owned(), "/feed/geo:35.18;129.07/".to_owned()]
    );
    let rows = store.all();
    assert_eq!(rows.len(), 2);
    assert_eq!(&rows[1].1.body[..], &stale_owm()[..]);
    assert_eq!(rows[1].1.provider.source(), "air-openweather");

    // After 10 min Google is asked again.
    clock.set(ms(T) + 601_000.);
    stub.push(GOOGLE, Reply::json(fixture("google-seoul.json")));
    let _ = air.current(33.5, 126.53, ms(T) + 601_000.).await;
    assert_eq!(stub.calls().last().unwrap().path, GOOGLE);
}

#[tokio::test]
async fn quota_rejection_and_exhausted_budget_skip_a_provider() {
    let stub = Stub::start().await;
    stub.push(GOOGLE, Reply::json(fixture("google-seoul.json")));
    stub.push(WAQI, Reply::json(fresh_waqi()));
    stub.push(OWM, Reply::status(429));
    let clock = Arc::new(FixedClock::new(ms("2026-09-27T14:30:00Z")));
    // One funded Google call for the month.
    let (air, budget) = live(config(&stub, 1), memory(), clock.clone());
    let out = air.current(37.5665, 126.978, clock_now(&clock)).await;
    assert_eq!(observed(&out).as_deref(), Some("google"));
    let out = air.current(37.4, 127.1, clock_now(&clock)).await;
    // Google exhausted (no HTTP), OpenWeather 429 (down), WAQI answers.
    assert_eq!(observed(&out).as_deref(), Some("aqicn"));
    assert_eq!(stub.calls_to(GOOGLE).len(), 1);
    assert_eq!(stub.calls_to(OWM).len(), 1);
    // A third cell far from the WAQI station: no usable observation, OpenWeather not asked.
    let out = air.current(36.0, 128.0, clock_now(&clock)).await;
    assert_eq!(observed(&out), None);
    assert_eq!(
        stub.calls_to(OWM).len(),
        1,
        "OpenWeather marked down after 429"
    );
    // Every HTTP attempt was funded before sending: budget authorities exist per provider.
    let keys: Vec<String> = budget.0.lock().unwrap().keys().cloned().collect();
    for path in ["google_air_quality", "openweather", "waqi"] {
        assert!(
            keys.iter()
                .any(|k| k.starts_with(&format!("budgets/v2/{path}/")) && k.contains("/2026-09/")),
            "{path}: {keys:?}"
        );
    }
}
fn clock_now(c: &FixedClock) -> f64 {
    use server2::world::Clock;
    c.now_ms()
}

#[tokio::test]
async fn one_fetch_per_cell_and_memory_rows_expire_after_thirty_minutes() {
    let stub = Stub::start().await;
    stub.push(WAQI, Reply::json(fresh_waqi()).delayed(300));
    let clock = Arc::new(FixedClock::new(ms(T)));
    let (air, _) = live(waqi_only(&stub), memory(), clock.clone());
    let (a, b) = tokio::join!(
        air.current(37.5665, 126.978, ms(T)),
        air.current(37.5651, 126.9812, ms(T))
    );
    assert_eq!(observed(&a), observed(&b));
    assert_eq!(stub.calls().len(), 1, "single flight per cell");
    clock.set(ms(T) + 29.0 * 60_000.);
    let _ = air.current(37.5665, 126.978, ms(T) + 29.0 * 60_000.).await;
    assert_eq!(stub.calls().len(), 1, "cached for 30 min");
    clock.set(ms(T) + 30.0 * 60_000.);
    let _ = air.current(37.5665, 126.978, ms(T) + 30.0 * 60_000.).await;
    assert_eq!(stub.calls().len(), 2, "expired at fetchedAt + 30 min");
}

#[tokio::test]
async fn failures_are_cached_for_two_minutes_and_publication_failure_is_no_success() {
    let stub = Stub::start().await;
    stub.push(WAQI, Reply::status(500));
    let clock = Arc::new(FixedClock::new(ms(T)));
    let store = memory();
    let (air, _) = live(waqi_only(&stub), store.clone(), clock.clone());
    assert!(matches!(
        air.current(37.5665, 126.978, ms(T)).await,
        AirOutcome::None
    ));
    clock.set(ms(T) + 119_000.);
    let _ = air.current(37.5665, 126.978, ms(T) + 119_000.).await;
    assert_eq!(stub.calls().len(), 1, "failure row for 2 min");
    // Unpublishable success: no observation is served and nothing is stored.
    clock.set(ms(T) + 121_000.);
    stub.push(WAQI, Reply::json(fresh_waqi()));
    store.set_failing(true);
    let out = air.current(37.5665, 126.978, ms(T) + 121_000.).await;
    assert!(matches!(out, AirOutcome::None), "{out:?}");
    assert_eq!(stub.calls().len(), 2);
    assert!(store.all().is_empty());
}

/// S13a-R1-F01: the OpenWeather minute cap holds while S08 funding is still in flight.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn openweather_minute_cap_is_atomic_across_cells() {
    let stub = Stub::start().await;
    stub.push(OWM, Reply::json(fixture("openweather-seoul.json")));
    let clock = Arc::new(FixedClock::new(ms("2026-09-27T14:30:00Z")));
    let config = AirConfig {
        openweather: Some(provider(&stub, OWM_KEY, 'b', 1000)),
        openweather_minute_cap: 1,
        ..AirConfig::default()
    };
    let air = LiveAir::new(
        config,
        memory(),
        Arc::new(server2::world::HttpAirTransport::new().unwrap()),
        server2::world::AirFunding {
            transport: Arc::new(Slow {
                delay_ms: 200,
                ..Slow::default()
            }),
            clock: Arc::new(Linked(clock.clone())),
        },
        clock.clone(),
    )
    .unwrap();
    let now = ms("2026-09-27T14:30:00Z");
    let _ = tokio::join!(
        air.current(37.5, 127.0, now),
        air.current(35.1, 129.0, now),
        air.current(33.5, 126.5, now),
        air.current(36.3, 127.4, now)
    );
    assert_eq!(stub.calls_to(OWM).len(), 1, "cap 1 per rolling minute");
}

/// S13a-R1-F02: one bounded admission caps all S3/budget requests that share it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shared_s3_admission_bounds_in_flight_requests() {
    use server2::budget::{BudgetError, BudgetObject, BudgetTransport};
    use server2::storage::WriteCondition;
    struct Probe(Arc<Slow>);
    impl BudgetTransport for Probe {
        async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
            self.0.get_budget(key).await
        }
        async fn put_budget(
            &self,
            key: &str,
            body: &[u8],
            condition: &WriteCondition,
        ) -> Result<u16, BudgetError> {
            self.0.put_budget(key, body, condition).await
        }
    }
    let slow = Arc::new(Slow {
        delay_ms: 20,
        ..Slow::default()
    });
    let bounded = server2::world::BoundedS3::new(Probe(slow.clone()), 3);
    let mut tasks = tokio::task::JoinSet::new();
    for i in 0..40 {
        let b = bounded.clone();
        tasks.spawn(async move {
            let _ = b.get_budget(&format!("budgets/v2/x/{i}.json")).await;
        });
    }
    while tasks.join_next().await.is_some() {}
    let peak = slow.peak.load(std::sync::atomic::Ordering::SeqCst);
    assert!((1..=3).contains(&peak), "peak in-flight {peak}");
    assert_eq!(bounded.available(), 3);
}

#[tokio::test]
async fn unconfigured_keys_and_no_provider_never_call_providers() {
    let stub = Stub::start().await;
    stub.push(WAQI, Reply::json(fresh_waqi()));
    let clock = Arc::new(FixedClock::new(ms(T)));
    let mut cfg = waqi_only(&stub);
    cfg.waqi.as_mut().unwrap().key = "You have to set".into();
    let (air, _) = live(cfg, memory(), clock.clone());
    assert!(matches!(
        air.current(37.5, 127.0, ms(T)).await,
        AirOutcome::None
    ));
    // No provider key at all: the legacy `no-provider` output, nothing is read or called.
    let (none, _) = live(AirConfig::default(), memory(), clock.clone());
    assert!(matches!(
        none.current(37.5, 127.0, ms(T)).await,
        AirOutcome::None
    ));
    assert!(stub.calls().is_empty());
    assert!(AirConfig::default().google.is_none());
}
