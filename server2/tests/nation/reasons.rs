use server2::world::air::{
    AirOutcome, AirSource, Observation, Unconfigured, rejection_reason, usable,
};
fn observation() -> Observation {
    Observation {
        provider: "openweather".into(),
        station_based: false,
        observed_at: Some("2026-10-16T00:00:00.000Z".into()),
        pollutants: vec![("pm10", 25.)],
        attribution: server2::world::js::Val::Str("OpenWeather".into()),
        station_name: None,
        station_geo: None,
    }
}
#[test]
fn safe_reasons_follow_legacy_evaluation_order_and_eight_hour_boundary() {
    let now = server2::world::vc::parse_iso_z("2026-10-16T08:00:00Z");
    let base = observation();
    assert!(usable(&base, 37., 127., now));
    assert_eq!(rejection_reason(&base, 37., 127., now), None);
    assert_eq!(rejection_reason(&base, 37., 127., now + 1.), Some("stale"));
    let mut o = base.clone();
    o.observed_at = None;
    assert_eq!(rejection_reason(&o, 37., 127., now), Some("no-time"));
    o = base.clone();
    o.observed_at = Some("2026-10-16T09:00:00.001Z".into());
    assert_eq!(rejection_reason(&o, 37., 127., now), Some("future"));
    o = base.clone();
    o.station_based = true;
    assert_eq!(rejection_reason(&o, 37., 127., now), Some("no-station-geo"));
    o.station_geo = Some([0., 0.]);
    assert_eq!(rejection_reason(&o, 37., 127., now), Some("too-far"));
    o = base;
    o.pollutants = vec![("o3", 0.02)];
    assert_eq!(rejection_reason(&o, 37., 127., now), Some("no-pm"));
}
#[tokio::test]
async fn unconfigured_source_keeps_ordinary_none_and_exposes_no_provider_only_to_nation() {
    let source = Unconfigured;
    assert!(matches!(
        source.current(37., 127., 0.).await,
        AirOutcome::None
    ));
    let (outcome, reason) = source.current_with_reason(37., 127., 0.).await;
    assert!(matches!(outcome, AirOutcome::None));
    assert_eq!(reason, Some("no-provider"));
}
