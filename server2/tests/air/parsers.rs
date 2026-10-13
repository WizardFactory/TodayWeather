//! Provider body parsers ported from lib/air/providers/{google,openweather,waqi}.js.
use super::support::fixture;
use server2::world::air::{AirProvider, parse_google, parse_openweather, parse_waqi};
use server2::world::{AirCell, js::Val};

#[test]
fn google_concentrations_follow_the_legacy_unit_rules() {
    let o = parse_google(&fixture("google-seoul.json")).unwrap();
    assert_eq!(o.provider, "google");
    assert!(!o.station_based);
    assert_eq!(o.observed_at.as_deref(), Some("2026-09-27T14:00:00.000Z"));
    // ppb gases -> ppm with toFixed(3); PM stays ug/m3; POLLUTANTS order.
    assert_eq!(
        o.pollutants,
        vec![
            ("pm10", 41.),
            ("pm25", 29.),
            ("o3", 0.054),
            ("no2", 0.01),
            ("so2", 0.004),
            ("co", 0.334)
        ]
    );
    assert_eq!(o.attribution, Val::Str("Google Air Quality".into()));
    assert_eq!(o.station_name, None);
}

#[test]
fn openweather_components_are_ugm3_with_molar_gas_conversion() {
    let o = parse_openweather(&fixture("openweather-seoul.json")).unwrap();
    assert_eq!(o.provider, "openweather");
    assert_eq!(o.observed_at.as_deref(), Some("2026-09-27T15:00:00.000Z"));
    assert_eq!(
        o.pollutants,
        vec![
            ("pm10", 22.),
            ("pm25", 19.),
            ("o3", 0.03),
            ("no2", 0.007),
            ("so2", 0.003),
            ("co", 0.185)
        ]
    );
    assert_eq!(o.attribution, Val::Str("OpenWeather".into()));
}

#[test]
fn unusable_bodies_are_rejected_like_the_legacy_adapters() {
    for body in [
        &br#"{"pollutants":{}}"#[..],
        br#"{"dateTime":1,"pollutants":[]}"#,
        br#"[]"#,
        b"not json",
    ] {
        assert!(parse_google(body).is_none());
    }
    for body in [
        &br#"{"list":[]}"#[..],
        br#"{"list":[{"components":{},"dt":"1"}]}"#,
        br#"{"list":[{"dt":1}]}"#,
    ] {
        assert!(parse_openweather(body).is_none());
    }
    assert!(parse_waqi(br#"{"status":"error","data":"Invalid key"}"#).is_none());
    // Later duplicates win, as the legacy object assignment does; unknown units are dropped.
    let dup = br#"{"dateTime":"2026-09-27T14:00:00Z","pollutants":[
        {"code":"pm10","concentration":{"value":1,"units":"MICROGRAMS_PER_CUBIC_METER"}},
        {"code":"pm10","concentration":{"value":2,"units":"MICROGRAMS_PER_CUBIC_METER"}},
        {"code":"pm25","concentration":{"value":3,"units":"PARTS_PER_BILLION"}},
        {"code":"co","concentration":{"value":0.5,"units":"PARTS_PER_MILLION"}}]}"#;
    let o = parse_google(dup).unwrap();
    assert_eq!(o.pollutants, vec![("pm10", 2.), ("co", 0.5)]);
    assert_eq!(
        AirProvider::Waqi
            .parse(&fixture("waqi-seoul.json"))
            .unwrap()
            .provider,
        "aqicn"
    );
}

#[test]
fn air_cell_is_the_legacy_to_fixed_2_grid() {
    let c = AirCell::of(35.68123, 139.76456).unwrap();
    assert_eq!((c.lat(), c.lon()), (35.68, 139.76));
    assert_eq!(c.id(), "air-p3568-p13976");
    assert_eq!(AirCell::of(35.6849, 139.7551).unwrap(), c);
    let s = AirCell::of(-33.86789, -151.20934).unwrap();
    assert_eq!(s.id(), "air-n3387-n15121");
    assert_eq!((s.lat(), s.lon()), (-33.87, -151.21));
    // toFixed(2) rounds half away from zero on the binary value (1.005 -> "1.00").
    assert_eq!(AirCell::of(1.005, 2.675).unwrap().id(), "air-p100-p267");
    assert!(AirCell::of(f64::NAN, 1.).is_none());
}
