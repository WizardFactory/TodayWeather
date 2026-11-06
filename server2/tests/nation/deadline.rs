//! KMA-NATION-DEADLINE: the nation composition waits for its fifteen cities as long as legacy's
//! child requests did (9 s each), within the 9-second gateway deadline. Each city bounds its own
//! inputs at about 2.9 s; fifteen assemblies then queue for the CPU admission, so on EC2
//! (2026-11-07) the composition ended at about 3 s and missed the old 3-second deadline in 6 of 13
//! steady requests, answering the legacy error page.
use super::support::UnusedCitySource;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use server2::{
    api::{DirectFamilies, DirectRoutes},
    domestic::kma::{AssemblyConfig, KmaRequest, Outcome, backend::KmaBackend},
    gateway::{BackendDispatcher, BoxFuture, GatewayError, OrderedJson},
    nation::{CitySource, NationAir, NationBackend, NationSource, object, text},
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
fn routes(cities: SlowCities) -> DirectRoutes {
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
    .with_nation(Arc::new(NationBackend::new(
        Arc::new(cities),
        Arc::new(NoAir),
        clock,
    )))
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
