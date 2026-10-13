//! AC4: no precise user coordinate reaches a provider request, an air raw key, a catalog,
//! object metadata or a stored body.
use super::common::{Peer, ms};
use super::support::*;
use server2::storage::{CatalogLimits, ProviderKey};
use server2::world::{AirCell, AirSource, AirStore, CatalogAirStore, FixedClock};
use std::sync::Arc;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn precise_coordinates_stay_in_memory() {
    let peer = Peer::new();
    let s3 = server2::world::BoundedS3::new(peer.transport(), 12);
    let stub = Stub::start().await;
    stub.push(GOOGLE, Reply::json(fixture("google-seoul.json")));
    stub.push(OWM, Reply::json(fixture("openweather-seoul.json")));
    stub.push(WAQI, Reply::json(fixture("waqi-seoul.json")));
    let clock = Arc::new(FixedClock::new(ms("2026-09-27T14:30:00Z")));
    let store: Arc<dyn AirStore> =
        Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap());
    let (air, _) = live(config(&stub, 100), store, clock.clone());
    let now = ms("2026-09-27T14:30:00Z");
    // Two precise users in one legacy cell share one Google call.
    let _ = air.current(37.56789123, 126.97812345, now).await;
    let _ = air.current(37.57111111, 126.98222222, now).await;
    // Google failing elsewhere stores OpenWeather; then OpenWeather down stores WAQI.
    stub.push(GOOGLE, Reply::status(500));
    let _ = air.current(35.17654321, 129.07654321, now).await;
    stub.push(OWM, Reply::status(503));
    let _ = air.current(33.49876543, 126.53123456, now).await;
    let precise = [
        "56789", "97812", "57111", "98222", "17654", "07654", "49876", "53123",
    ];
    let calls = stub.calls();
    assert_eq!(stub.calls_to(GOOGLE).len(), 3);
    for c in &calls {
        let text = format!(
            "{} {} {}",
            c.path,
            c.query,
            String::from_utf8_lossy(&c.body)
        );
        for p in precise {
            assert!(!text.contains(p), "provider request carries {p}: {text}");
        }
    }
    let dump = peer.dump().await;
    let raw: Vec<_> = dump
        .iter()
        .filter(|(k, _, _)| k.starts_with("raw/"))
        .collect();
    assert_eq!(
        raw.len(),
        3,
        "{:?}",
        dump.iter().map(|d| &d.0).collect::<Vec<_>>()
    );
    for (key, meta, bytes) in &dump {
        let body = String::from_utf8_lossy(bytes);
        for p in precise {
            assert!(!key.contains(p) && !meta.contains(p), "{key} {meta}");
            assert!(!body.contains(p), "{key} body carries {p}");
        }
    }
    // The raw key is the cell identity only.
    let cell = AirCell::of(37.56789123, 126.97812345).unwrap();
    let id = ProviderKey::Named { id: cell.id() };
    let sha = server2::storage::sha256(&id.canonical_bytes().unwrap());
    assert!(dump.iter().any(|(k, _, _)| k.contains(&sha)));
}
