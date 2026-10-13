//! AC3: the S11 oracle air scenarios through the live air chain (loopback WAQI stub serving the
//! recorded bodies), then a restart with empty memory, the production WAQI configuration and the
//! provider down: S3 records alone restore the bytes.
use super::common::{Peer, ScriptedVc, body, deadline, expect_calls, matches, ms, oracle, path};
use super::support::{Memory, Stub, WAQI, WAQI_KEY, live, restarted, waqi_only};
use server2::storage::CatalogLimits;
use server2::world::{
    AirStore, CatalogAirStore, FixedClock, World, WorldBackend, WorldConfig, WorldStore,
};
use std::sync::Arc;

fn air_scenarios() -> Vec<&'static serde_json::Value> {
    oracle()["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["options"]["air"] == "aqicn")
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn live_chain_matches_the_oracle_and_s3_alone_restores_the_same_bytes() {
    let scenarios = air_scenarios();
    assert_eq!(scenarios.len(), 6);
    let mut errors = Vec::new();
    let mut restored = 0;
    for sc in scenarios {
        let peer = Peer::new();
        let s3 = server2::world::BoundedS3::new(peer.transport(), 12);
        let stub = Stub::start().await;
        let weather: Arc<dyn WorldStore> = Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        );
        let air_store: Arc<dyn AirStore> =
            Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap());
        let clock = Arc::new(FixedClock::new(0.));
        let (air, _) = live(waqi_only(&stub), air_store, clock.clone());
        let vc = Arc::new(ScriptedVc::default());
        let backend = WorldBackend::new(World::new(
            weather.clone(),
            vc.clone(),
            air,
            clock.clone(),
            WorldConfig::default(),
        ));
        // Live pass: parity with the legacy oracle; each recorded air call is one WAQI call.
        for step in sc["steps"].as_array().unwrap() {
            clock.set(ms(step["at"].as_str().unwrap()));
            for r in step["requests"].as_array().unwrap() {
                vc.clear();
                expect_calls(&vc, r);
                for a in r["air"].as_array().unwrap() {
                    stub.push(
                        WAQI,
                        super::support::Reply::json(body(a["body_sha256"].as_str().unwrap())),
                    );
                }
                let before = stub.calls().len();
                let reply = backend
                    .reply(&path(r), r["lang"].as_str().unwrap_or(""), deadline())
                    .await;
                if let Err(m) = matches(r, &reply) {
                    errors.push(format!("{} live {}: {m}", sc["id"], path(r)));
                }
                let calls = stub.calls();
                let made: Vec<_> = calls[before..].iter().collect();
                let wanted = r["air"].as_array().unwrap();
                if made.len() != wanted.len() {
                    errors.push(format!(
                        "{} air calls {} vs {}",
                        sc["id"],
                        made.len(),
                        wanted.len()
                    ));
                }
                for (call, want) in made.iter().zip(wanted) {
                    let url = format!(
                        "https://api.waqi.info{}?{}",
                        call.path,
                        call.query.replace(WAQI_KEY, "<redacted>")
                    );
                    if url != want["request"].as_str().unwrap() {
                        errors.push(format!("{} request {url}", sc["id"]));
                    }
                }
            }
        }
        // Restore pass: new engines, empty memory, VC disabled and the air provider down.
        for step in sc["steps"].as_array().unwrap() {
            let at = Arc::new(FixedClock::new(ms(step["at"].as_str().unwrap())));
            let cold_air: Arc<dyn AirStore> =
                Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap());
            let (air, _down) = restarted(cold_air, Arc::new(Memory::default()), at.clone());
            let cold = WorldBackend::new(World::new(
                Arc::new(
                    server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default())
                        .unwrap(),
                ),
                Arc::new(super::common::Down),
                air,
                at,
                WorldConfig::default(),
            ));
            for r in step["requests"].as_array().unwrap() {
                if r["status"] != 200 {
                    continue;
                }
                let reply = cold
                    .reply(&path(r), r["lang"].as_str().unwrap_or(""), deadline())
                    .await;
                restored += 1;
                if let Err(m) = matches(r, &reply) {
                    errors.push(format!("{} restored {}: {m}", sc["id"], path(r)));
                }
            }
        }
    }
    assert_eq!(restored, 15);
    assert!(errors.is_empty(), "{}", errors.join("\n"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_without_records_serves_no_air_and_does_not_invent_values() {
    let peer = Peer::new();
    let s3 = server2::world::BoundedS3::new(peer.transport(), 12);
    let sc = air_scenarios()[0];
    let step = &sc["steps"][0];
    let r = &step["requests"][0];
    // Weather from S3 needs the VC record: run the weather once with air unconfigured.
    let clock = Arc::new(FixedClock::new(ms(step["at"].as_str().unwrap())));
    let vc = Arc::new(ScriptedVc::default());
    expect_calls(&vc, r);
    let warm = WorldBackend::new(World::new(
        Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        ),
        vc,
        Arc::new(server2::world::Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    ));
    let _ = warm.reply(&path(r), "ko", deadline()).await;
    let air_store: Arc<dyn AirStore> =
        Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap());
    let (air, down) = restarted(air_store, Arc::new(Memory::default()), clock.clone());
    let cold = WorldBackend::new(World::new(
        Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        ),
        Arc::new(super::common::Down),
        air,
        clock,
        WorldConfig::default(),
    ));
    match cold.reply(&path(r), "ko", deadline()).await {
        server2::world::WorldReply::Body(v) => {
            let text = String::from_utf8(v.to_json()).unwrap();
            assert!(!text.contains("airSource"), "no fabricated air: {text}");
        }
        other => panic!("{other:?}"),
    }
    // No stored record: the configured provider was tried once and was down.
    assert_eq!(down.calls(), 1);
}
