//! KMA-NATION-DEADLINE: a nation city's inputs keep the three-second request budget, but its
//! assembly may queue for the CPU admission until the nation deadline. On EC2 (2026-11-07) the
//! inputs of fifteen cities ended near the observed bound and the assemblies, two at a time, were
//! cut at three seconds into the legacy child error page.
use super::support::*;
use serde_json::Value;
use server2::{
    domestic::kma::{
        DbVersion, KmaRequest, KmaStore, MidModel, Outcome, StoreResult, TownModel,
        backend::{KmaBackend, KmaSource, SourceAnswer, system_clock},
    },
    gateway::BoxFuture,
    nation::{CitySource, NATION_DEADLINE},
};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

/// The recorded store of `domestic-v000903` whose assembly holds the CPU for 400 ms.
struct Slow(RecordedStore);
impl KmaStore for Slow {
    fn db_version(&self) -> DbVersion {
        self.0.db_version()
    }
    fn towns(&self) -> StoreResult {
        std::thread::sleep(Duration::from_millis(400));
        self.0.towns()
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.0.town(a, b, c)
    }
    fn region_code(&self, region: &str, city: &str) -> StoreResult {
        self.0.region_code(region, city)
    }
    fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
        self.0.town_model(model, mx, my)
    }
    fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
        self.0.mid_model(model, reg_id)
    }
    fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
        self.0.forecast_zone(region, city)
    }
    fn stn_hourly_and_min_rns(
        &self,
        town: &Value,
        date_time: &str,
        current: &Value,
    ) -> StoreResult {
        self.0.stn_hourly_and_min_rns(town, date_time, current)
    }
    fn city_hourly(&self, town: &Value) -> StoreResult {
        self.0.city_hourly(town)
    }
    fn history(&self, town: &Value) -> StoreResult {
        self.0.history(town)
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.0.area_no(a, b, c)
    }
    fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
        self.0.area_no_near(lon_lat)
    }
    fn life_index(&self, area_no: f64) -> StoreResult {
        self.0.life_index(area_no)
    }
    fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
        self.0.food_poisoning(sd, sgg, start, end)
    }
    fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
        self.0.arpltn(town, now_ms)
    }
    fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
        self.0.dust_forecast(region, city, date)
    }
    fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
        self.0.air_fallback(g_coord, now_ms)
    }
    fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
        self.0.air_forecast(source, station)
    }
    fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
        self.0.rise_set(geocode, dates)
    }
    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        self.0.special_zones(area_codes)
    }
    fn as_of_ms(&self) -> Option<f64> {
        self.0.as_of_ms()
    }
    fn unconsumed(&self) -> Option<String> {
        self.0.unconsumed()
    }
}
/// Inputs that end at 2.8 s, near the observed source's bound.
struct LateInputs;
impl KmaSource for LateInputs {
    fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_millis(2800)).await;
            SourceAnswer::Snapshot(Box::new(Slow(replay(scenario("domestic-v000903")))))
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nation_cities_queued_for_the_cpu_admission_still_answer() {
    warm();
    let backend = Arc::new(KmaBackend::new(
        Arc::new(LateInputs),
        system_clock(),
        oracle_config(),
    ));
    let start = Instant::now();
    let deadline = start + NATION_DEADLINE;
    // Four assemblies of 400 ms on two CPU permits: the last two start at about 3.2 s.
    let cities = (0..4).map(|_| {
        let (backend, request) = (backend.clone(), request(scenario("domestic-v000903")));
        async move { CitySource::weather(&*backend, request, deadline).await }
    });
    let answers = futures_util::future::join_all(cities).await;
    let elapsed = start.elapsed();
    for answer in &answers {
        assert!(matches!(answer, Ok(Outcome::Json(_))), "{answer:?}");
    }
    assert!(
        elapsed > Duration::from_millis(3100) && elapsed < NATION_DEADLINE,
        "{elapsed:?}"
    );
}
