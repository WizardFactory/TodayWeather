//! KMA-NATION-DEADLINE: the nation composition waits for its fifteen cities for 8 s (legacy gave
//! each child request 9 s), while air and each city's inputs keep the three-second budget. On EC2
//! (2026-11-07) the city inputs ended near that bound and the assemblies, queued for the CPU
//! admission, were cut at three seconds in 6 of 13 steady requests (the legacy error page).
//! `tests/domestic/nation_city.rs` checks the queue on the KMA backend itself.
use super::support::UnusedCitySource;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::kma::{AssemblyConfig, KmaRequest, Outcome, backend::KmaBackend},
    gateway::{BackendDispatcher, BoxFuture, GatewayError, OrderedJson},
    nation::{
        CitySource, NATION_DEADLINE, NATION_INPUTS, NationAir, NationBackend, NationSource, object,
        text,
    },
};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

/// Cities that answer after `delay`; `stuck` never answers.
struct SlowCities {
    delay: Duration,
    stuck: Option<&'static str>,
}
impl CitySource for SlowCities {
    fn weather(&self, r: KmaRequest, _: Instant) -> BoxFuture<'_, Result<Outcome, GatewayError>> {
        Box::pin(async move {
            let name = [r.region, r.city]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("/");
            let delay = if self.stuck == Some(name.as_str()) {
                Duration::from_secs(3600)
            } else {
                self.delay
            };
            tokio::time::sleep(delay).await;
            Ok(Outcome::Json(object(vec![
                ("cityName", text(&name)),
                ("current", object(vec![("t1h", OrderedJson::Number(20.))])),
            ])))
        })
    }
}
struct NoAir;
impl NationSource for NoAir {
    fn nation_air(&self, _: f64, _: Instant) -> BoxFuture<'_, NationAir> {
        Box::pin(async {
            NationAir {
                rows: vec![],
                status: object(vec![]),
            }
        })
    }
}
/// Records the time each input and city is given from the start of the composition.
#[derive(Clone, Default)]
struct Budgets(Arc<std::sync::Mutex<Vec<(&'static str, Duration)>>>);
impl Budgets {
    fn note(&self, what: &'static str, deadline: Instant) {
        let left = deadline - Instant::now();
        self.0.lock().unwrap().push((what, left));
    }
}
impl CitySource for Budgets {
    fn weather(
        &self,
        _: KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Outcome, GatewayError>> {
        self.note("city", deadline);
        Box::pin(async { Ok(Outcome::Json(object(vec![("cityName", text("x"))]))) })
    }
}
impl NationSource for Budgets {
    fn nation_air(&self, _: f64, deadline: Instant) -> BoxFuture<'_, NationAir> {
        self.note("air", deadline);
        Box::pin(async {
            NationAir {
                rows: vec![],
                status: object(vec![]),
            }
        })
    }
}
/// A national narrative read that never finishes.
struct PendingNarrative;
impl server2::narrative::Read for PendingNarrative {
    fn read(&self, _: u16, _: Instant) -> BoxFuture<'_, Option<server2::narrative::Narrative>> {
        Box::pin(std::future::pending())
    }
}
fn routes(cities: SlowCities) -> DirectRoutes {
    with(Arc::new(cities), Arc::new(NoAir), None)
}
fn with(
    cities: Arc<dyn CitySource>,
    air: Arc<dyn NationSource>,
    narrative: Option<Arc<dyn server2::narrative::Read>>,
) -> DirectRoutes {
    let clock = Arc::new(|| 0.);
    DirectRoutes::new(
        Arc::new(KmaBackend::new(
            Arc::new(UnusedCitySource),
            clock.clone(),
            AssemblyConfig::default(),
        )),
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: true,
            town: false,
        },
        BackendDispatcher::legacy("http://127.0.0.1:1").unwrap(),
    )
    .with_nation(Arc::new(
        NationBackend::new(cities, air, clock).with_narrative(narrative),
    ))
}
async fn nation(direct: &DirectRoutes) -> (u16, String, Duration) {
    let started = tokio::time::Instant::now();
    let request = Request::builder()
        .uri("/v000903/nation/KR")
        .header("Accept-Language", "ko-KR")
        .body(Body::empty())
        .unwrap();
    let response = direct.handle(request).await;
    let status = response.status().as_u16();
    let body = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        String::from_utf8_lossy(&body).into_owned(),
        started.elapsed(),
    )
}

#[tokio::test(start_paused = true)]
async fn cities_that_answer_after_three_seconds_still_answer_the_nation() {
    let direct = routes(SlowCities {
        delay: Duration::from_millis(3_500),
        stuck: None,
    });
    let (status, body, took) = nation(&direct).await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("\"nation\":\"KR\""), "{body}");
    assert_eq!(body.matches("\"cityName\"").count(), 15, "{body}");
    assert!(took >= Duration::from_millis(3_500) && took < Duration::from_secs(4));
}

#[tokio::test(start_paused = true)]
async fn a_city_that_never_answers_is_the_legacy_child_error_at_eight_seconds() {
    let direct = routes(SlowCities {
        delay: Duration::from_millis(100),
        stuck: Some("대전광역시"),
    });
    let (status, body, took) = nation(&direct).await;
    assert_eq!(status, 500);
    assert!(
        body.contains("response.statusCode=500 {&quot;method&quot;:&quot;getWeather&quot;}"),
        "{body}"
    );
    assert_eq!(took, Duration::from_secs(8));
}

#[tokio::test(start_paused = true)]
async fn air_keeps_the_input_budget_and_cities_get_the_nation_deadline() {
    let budgets = Budgets::default();
    let direct = with(Arc::new(budgets.clone()), Arc::new(budgets.clone()), None);
    for path in ["v000903", "v000901"] {
        budgets.0.lock().unwrap().clear();
        let request = Request::builder()
            .uri(format!("/{path}/nation/KR"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(direct.handle(request).await.status(), 200, "{path}");
        let seen = budgets.0.lock().unwrap().clone();
        assert_eq!(
            seen.iter().filter(|(w, _)| *w == "city").count(),
            15,
            "{path}"
        );
        for (what, left) in seen {
            let expected = if what == "air" {
                NATION_INPUTS
            } else {
                NATION_DEADLINE
            };
            assert_eq!(left, expected, "{path} {what}");
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_late_composition_does_not_wait_for_the_narrative() {
    let direct = with(
        Arc::new(SlowCities {
            delay: Duration::from_millis(3_500),
            stuck: None,
        }),
        Arc::new(NoAir),
        Some(Arc::new(PendingNarrative)),
    );
    for path in ["v000903", "v000901"] {
        let started = Instant::now();
        let request = Request::builder()
            .uri(format!("/{path}/nation/KR"))
            .body(Body::empty())
            .unwrap();
        let response = direct.handle(request).await;
        assert_eq!(response.status(), 200, "{path}");
        let body = to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        assert!(!String::from_utf8_lossy(&body).contains("forecastNarrative"));
        assert_eq!(started.elapsed(), Duration::from_millis(3_500), "{path}");
    }
}
