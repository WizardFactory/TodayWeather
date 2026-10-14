//! Shared S13a/S13b domestic test environment over the S13 loopback stub and budget peer.
#![allow(dead_code)]
use super::support::*;
use server2::domestic::family::{Endpoints, Service};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::{Acquired, DomesticAcquirer, DomesticError};
use server2::providers::{HttpProviderTransport, HttpPublicTransport};
use server2::resolver::Acquisition;
use server2::storage::CatalogLimits;
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

pub const STATION: &str = "B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
pub const SIDO: &str = "B552584/ArpltnStatsSvc/getCtprvnMesureSidoLIst";
pub const KASI: &str = "B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo";
/// S13b: data.go.kr forecast-zone list (legacy #2740); the newsky2 path is removed.
pub const ZONE: &str = "1360000/FcstZoneInfoService/getFcstZoneCd";
/// S13b: AirKorea dust forecast and station list (legacy #2737).
pub const FORECAST: &str = "B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth";
pub const STATION_LIST: &str = "B552584/MsrstnInfoInqireSvc/getMsrstnList";
pub const KEY_C: &str = "S13B_LOCAL_KEY_C+cccccccccccccccc/=";
/// 2026-10-13 14:20 KST.
pub const NOW_MS: i64 = 1_791_868_800_000;

pub fn local(name: &str) -> Vec<u8> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/formats/fixtures")
            .join(name),
    )
    .unwrap()
}
pub struct Env {
    pub stub: Stub,
    pub acquirer: DomesticAcquirer<HttpProviderTransport, HttpPublicTransport, Memory>,
    pub metrics: Arc<DomesticMetrics>,
}
/// Rings: AirKorea gets its own owners; KASI and zone rotate over two keys.
pub async fn env_keys(airkorea: &[(&str, char)], data_go_kr: &[(&str, char)]) -> Env {
    let stub = Stub::start().await;
    let wire = Arc::new(Memory::default());
    let clk = clock(NOW_MS);
    let mut rings = BTreeMap::new();
    rings.insert(Service::AirKorea, ring(wire.clone(), clk.clone(), airkorea));
    let shift = |offset: u8| -> Vec<(&str, char)> {
        data_go_kr
            .iter()
            .map(|(k, o)| (*k, (*o as u8 + offset) as char))
            .collect()
    };
    rings.insert(Service::RiseSet, ring(wire.clone(), clk.clone(), &shift(0)));
    rings.insert(
        Service::ForecastZone,
        ring(wire.clone(), clk.clone(), &shift(2)),
    );
    let metrics = Arc::new(DomesticMetrics::default());
    let acquirer = DomesticAcquirer::new(
        Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
        Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
        rings,
        Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
        clk,
        metrics.clone(),
        CatalogLimits::default(),
    )
    .unwrap();
    Env {
        stub,
        acquirer,
        metrics,
    }
}
pub async fn env() -> Env {
    env_keys(&[(KEY_A, '5')], &[(KEY_A, 'a'), (KEY_B, 'b')]).await
}
pub fn complete(outcome: Result<Acquired, DomesticError>) -> Acquisition {
    match outcome {
        Ok(Acquired::Complete(a)) => a,
        other => panic!("expected complete acquisition, got {other:?}"),
    }
}
/// AirKorea station page with `rows` distinct stations (legacy row shape).
pub fn airkorea_page(page: u32, total: u32, rows: u32, sido: &str) -> Vec<u8> {
    let start = (page - 1) * 100;
    let items: Vec<serde_json::Value> = (start..(start + rows))
        .map(|i| {
            serde_json::json!({
                "stationName": format!("측정소{i}"),
                "sidoName": sido,
                "mangName": "도시대기",
                "dataTime": "2026-10-13 13:00",
                "pm10Value": "21",
                "pm25Value": "9",
            })
        })
        .collect();
    airkorea_envelope(items, page, total)
}
pub fn airkorea_envelope(items: Vec<serde_json::Value>, page: u32, total: u32) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"},
            "body": {"pageNo": page, "numOfRows": 100, "totalCount": total, "items": items}
        }
    }))
    .unwrap()
}
pub fn pairs(call: &Call) -> Vec<(String, String)> {
    call.query.clone()
}
