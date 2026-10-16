use serde_json::json;
use server2::domestic::kma::source::airkorea::{Observations, Stations};
use server2::nation::air::province_averages;
#[test]
fn latest_urban_hour_and_valid_pollutant_denominators_match_legacy() {
    let mut observations = Observations::default();
    observations.apply(&[
        json!({"stationName":"A", "sidoName":"서울", "mangName":"도시대기", "dataTime":"2026-10-16 09:00", "pm10Value":"21", "o3Value":"0.025"}),
        json!({"stationName":"B", "sidoName":"서울", "mangName":"도시대기", "dataTime":"2026-10-16 09:00", "pm10Value":"24", "o3Value":"-"}),
        json!({"stationName":"C", "sidoName":"서울", "mangName":"도로변대기", "dataTime":"2026-10-16 10:00", "pm10Value":"200"}),
        json!({"stationName":"A", "sidoName":"서울", "mangName":"도시대기", "dataTime":"2026-10-16 08:00", "pm10Value":"400"}),
    ]);
    let rows = province_averages(&observations, &Stations::default());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("pm10Value").unwrap().as_num(), Some(23.));
    assert_eq!(rows[0].get("o3Value").unwrap().as_num(), Some(0.025));
    assert_eq!(rows[0].get("sidoName").unwrap().as_str(), Some("서울"));
}

#[test]
fn route_parameter_decoding_keeps_express_acceptance_without_country_validation() {
    assert!(server2::nation::valid_parameter("US"));
    assert!(server2::nation::valid_parameter("%ED%95%9C%EA%B5%AD"));
    assert!(server2::nation::valid_parameter("%2F"));
    for bad in ["%", "%GG", "%FF", "%ED%A0%80"] {
        assert!(!server2::nation::valid_parameter(bad), "{bad}");
    }
    assert_eq!(
        server2::nation::mount("/V000903/NaTiOn/US/?a=b"),
        Some("v000903")
    );
    assert_eq!(server2::nation::mount("/v000902/nation/KR"), None);
}
