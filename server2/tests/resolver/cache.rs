use server2::cache::{ByteBudget, WeightedCache};

#[test]
fn pinned_evicted_value_remains_charged_until_last_owner_drops() {
    let budget = ByteBudget::new(128).unwrap();
    let cache = WeightedCache::new(budget.clone(), 4, 8).unwrap();
    let held = cache.insert("first", vec![1u8; 64], 64).unwrap();
    cache.clear();
    assert_eq!(budget.used(), 64, "an evicted Arc is still live");
    assert!(cache.insert("second", vec![2u8; 80], 80).is_err());
    drop(held);
    assert_eq!(budget.used(), 0);
    assert!(cache.insert("second", vec![2u8; 80], 80).is_ok());
}

use server2::cache::{
    DomesticDay, GeocodeMemoryKey, ResponseKey, RevisionIndex, WorldHour, WorldHours,
};
use server2::storage::{Limits, Period, ProviderKey, RawRecord};
use std::{collections::BTreeMap, sync::Arc};
fn key(locale: &str, location: &str, units: &str, p: &str) -> ResponseKey {
    ResponseKey::new(
        "weather/coord",
        "v000903",
        location,
        locale,
        units,
        "aqi",
        "parser-1",
        BTreeMap::from([("air".into(), p.into())]),
    )
    .unwrap()
}
#[test]
fn exact_response_and_geocode_identities_never_alias_or_authorize_an_archive() {
    let base = key("ko", "37.5001,127.0001", "C", "yes")
        .fingerprint()
        .unwrap();
    for k in [
        key("en", "37.5001,127.0001", "C", "yes"),
        key("ko", "37.5002,127.0001", "C", "yes"),
        key("ko", "37.5001,127.0001", "F", "yes"),
        key("ko", "37.5001,127.0001", "C", "no"),
    ] {
        assert_ne!(base, k.fingerprint().unwrap());
    }
    let coord = GeocodeMemoryKey::coordinates("37.5", "127", "ko").unwrap();
    let address = GeocodeMemoryKey::address("12 exact street", "ko").unwrap();
    assert!(coord.authorize_projection_identity().is_err());
    assert!(address.authorize_projection_identity().is_err());
    assert_ne!(
        coord.fingerprint(),
        GeocodeMemoryKey::coordinates("37.5", "127", "en")
            .unwrap()
            .fingerprint()
    );
    assert!(GeocodeMemoryKey::coordinates("NaN", "127", "ko").is_err());
}
#[test]
fn domestic_midnight_and_dst_world_days_keep_actual_instants() {
    assert!(DomesticDay::<u8>::new(101).is_err());
    assert!(DomesticDay::<u8>::attributed_day(10101, 0).is_err());
    let mut domestic = DomesticDay::new(20261007).unwrap();
    domestic.insert(20261007, 23, Arc::new(23)).unwrap();
    domestic.insert(20261008, 0, Arc::new(0)).unwrap();
    assert_eq!(**domestic.get(0).unwrap().unwrap(), 0);
    assert_eq!(
        DomesticDay::<u8>::attributed_day(20260101, 0).unwrap(),
        20251231
    );
    assert!(domestic.insert(20261007, 0, Arc::new(1)).is_err());
    let spring = time::macros::datetime!(2026-03-08 05:00 UTC).unix_timestamp();
    let fall = time::macros::datetime!(2026-11-01 04:00 UTC).unix_timestamp();
    let hours = (0..23)
        .map(|i| WorldHour {
            epoch: spring + i * 3600,
            local_day: 20260308,
            offset_seconds: if i < 2 { -5 * 3600 } else { -4 * 3600 },
            value: Arc::new(i),
        })
        .chain((0..25).map(|i| WorldHour {
            epoch: fall + i * 3600,
            local_day: 20261101,
            offset_seconds: if i < 2 { -4 * 3600 } else { -5 * 3600 },
            value: Arc::new(i),
        }))
        .collect();
    let world = WorldHours::new(hours, 48).unwrap();
    assert_eq!(world.day(20260308).len(), 23);
    assert_eq!(world.day(20261101).len(), 25);
    let repeated = world.range(fall + 3600, fall + 3 * 3600).unwrap();
    assert_eq!(repeated.len(), 2);
    assert_eq!(
        repeated[0].epoch + i64::from(repeated[0].offset_seconds),
        repeated[1].epoch + i64::from(repeated[1].offset_seconds)
    );
}
#[test]
fn revisions_use_full_hash_ties_and_binary_ranges_without_collapsing() {
    let records = [
        (2, "{\"value\":37626}"),
        (1, "{\"value\":0}"),
        (2, "{\"value\":59662}"),
    ]
    .into_iter()
    .map(|(fetch, body)| {
        Arc::new(
            RawRecord::new(
                "kma",
                "current",
                &ProviderKey::Grid { nx: 60, ny: 127 },
                Period {
                    local_date: 20261007,
                    slot: "1200".into(),
                },
                fetch,
                200,
                "application/json",
                None,
                body.as_bytes().into(),
                &Limits::default(),
            )
            .unwrap(),
        )
    })
    .collect();
    let index = RevisionIndex::new(records, 3).unwrap();
    let tie = index.range(2, 3).unwrap();
    assert_eq!(tie.len(), 2);
    assert!(tie[0].envelope.identity.raw_sha256 < tie[1].envelope.identity.raw_sha256);
    assert_eq!(index.range(1, 2).unwrap().len(), 1);
    assert!(index.range(3, 4).unwrap().is_empty());
}
#[test]
fn concurrent_cache_insert_never_exceeds_lease_or_entry_admission() {
    let budget = ByteBudget::new(4096).unwrap();
    let cache = Arc::new(WeightedCache::new(budget.clone(), 4, 8).unwrap());
    let jobs = (0..16)
        .map(|i| {
            let cache = cache.clone();
            std::thread::spawn(move || {
                for n in 0..32 {
                    let _ = cache.insert(format!("{i}:{n}"), [0u8; 256], 256);
                    assert!(cache.used_bytes() <= 4096);
                }
            })
        })
        .collect::<Vec<_>>();
    for j in jobs {
        j.join().unwrap();
    }
    assert!(cache.entries() <= 8);
    cache.clear();
    assert_eq!(budget.used(), 0);
}
