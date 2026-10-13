//! PRIVACY: S3 keys, metadata, catalogs and bodies and the VC request carry only the legacy
//! 0.02-degree cell centre; nearby precise coordinates share one provider call.
use super::common::*;
use server2::world::{
    Cell, Range,
    source::{coordinate, timeline_url},
    store::{partitions, provider_key},
};

#[test]
fn legacy_cell_algorithm_edges() {
    let c = |lat: f64, lon: f64| Cell::of(lat, lon).map(|c| (c.lat, c.lon));
    assert_eq!(c(35.68, 139.76), Some((35.69, 139.77)));
    assert_eq!(c(35.6799995, 139.76), Some((35.69, 139.77)));
    assert_eq!(c(35.679999, 139.76), Some((35.67, 139.77)));
    assert_eq!(c(-0.02, -0.02), Some((-0.01, -0.01)));
    assert_eq!(c(-0.0200001, -0.0200001), Some((-0.01, -0.01)));
    assert_eq!(c(-0.0000001, -0.039999), Some((0.01, -0.03)));
    assert_eq!(c(0.0199999, 0.0200004), Some((0.03, 0.03)));
    assert_eq!(c(10., 180.), Some((10.01, 179.99)));
    assert_eq!(c(-16.5, -180.), Some((-16.49, -179.99)));
    assert_eq!(c(90., 10.005), Some((89.99, 10.01)));
    assert_eq!(c(-90., 0.), Some((-89.99, 0.01)));
    assert_eq!(c(f64::NAN, 0.), None);
    assert_eq!(coordinate(35.69), "35.69");
    assert_eq!(coordinate(-0.01), "-0.01");
    let url = timeline_url(
        "http://127.0.0.1:9/",
        Cell::of(51.507, -0.128).unwrap(),
        Range::Combined,
    );
    assert!(url.starts_with("http://127.0.0.1:9/51.51,-0.13/last1days/next7days?unitGroup=us"));
    assert!(!url.contains("51.507") && !url.contains("-0.128") && !url.contains("key="));
    assert!(matches!(
        provider_key(Cell::of(51.507, -0.128).unwrap()),
        server2::storage::ProviderKey::WorldCell {
            lat_hundredths: 5151,
            lon_hundredths: -13
        }
    ));
    assert_eq!(partitions(ms("2026-09-26T07:04:30.000Z")).len(), 21);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stored_objects_and_provider_calls_contain_cell_coordinates_only() {
    let peer = Peer::new();
    let mut precise = Vec::new();
    let mut calls = 0;
    for id in [
        "london-recorded",
        "cell-boundary",
        "santiago-negative",
        "pole-south",
        "dateline-west",
    ] {
        let sc = scenario(id);
        for step in sc["steps"].as_array().unwrap() {
            for r in step["requests"].as_array().unwrap() {
                let loc = r["loc"].as_str().unwrap();
                for part in loc.split(',') {
                    let v: f64 = part.parse().unwrap();
                    // A precise request coordinate is never a two-decimal odd-hundredth centre.
                    let cell = Cell::of(v, 0.).unwrap().lat;
                    if (v - cell).abs() > 1e-9 && part.len() > 4 {
                        precise.push(part.to_owned());
                    }
                }
                calls += r["calls"].as_array().unwrap().len();
            }
        }
        let errors = replay(sc, peer.store(), NoStep).await;
        assert!(errors.is_empty(), "{errors:?}");
    }
    assert!(calls >= 10 && precise.len() >= 10, "{calls} {precise:?}");
    let objects = peer.dump().await;
    assert!(
        objects
            .iter()
            .any(|(k, _, _)| k.starts_with("raw/v2/vc/timeline/"))
    );
    assert!(
        objects
            .iter()
            .any(|(k, _, _)| k.starts_with("index/v2/vc/timeline/"))
    );
    for (key, meta, body) in &objects {
        let mut text = format!("{key}\n{meta}\n");
        if key.ends_with(".raw.gz") {
            let mut s = String::new();
            use std::io::Read;
            flate2::read::GzDecoder::new(&body[..])
                .read_to_string(&mut s)
                .unwrap();
            text.push_str(&s);
        } else {
            text.push_str(&String::from_utf8_lossy(body));
        }
        for p in &precise {
            assert!(!text.contains(p.as_str()), "{key} contains precise {p}");
        }
        assert!(!text.contains("key="), "{key} carries a request URL");
    }
}
