//! Release-mode functional smoke (`cargo test --release --test air smoke`): live air over real
//! loopback HTTP with S08 budgets and raw records in the S3 test peer, then a restart with the
//! production WAQI configuration and the provider down that restores from S3; and the runtime
//! air settings. No AWS or provider traffic.
use super::common::{Peer, ScriptedVc, body, deadline, expect_calls, matches, ms, path, scenario};
use super::support::{Linked, Reply, Stub, WAQI, restarted, waqi_only};
use server2::storage::CatalogLimits;
use server2::world::{
    AirFunding, AirStore, CatalogAirStore, FixedClock, HttpAirTransport, LiveAir, World,
    WorldBackend, WorldConfig, runtime::build,
};
use std::sync::Arc;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn smoke_live_air_with_s3_budgets_then_s3_only_restore() {
    let peer = Peer::new();
    let s3 = server2::world::BoundedS3::new(peer.transport(), 12);
    let stub = Stub::start().await;
    let sc = scenario("air-waqi-high");
    let step = &sc["steps"][0];
    let clock = Arc::new(FixedClock::new(ms(step["at"].as_str().unwrap())));
    let air = LiveAir::new(
        waqi_only(&stub),
        Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap()),
        Arc::new(HttpAirTransport::new().unwrap()),
        AirFunding {
            transport: Arc::new(s3.clone()),
            clock: Arc::new(Linked(clock.clone())),
        },
        clock.clone(),
    )
    .unwrap();
    let vc = Arc::new(ScriptedVc::default());
    let backend = WorldBackend::new(World::new(
        Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        ),
        vc.clone(),
        Arc::new(air),
        clock.clone(),
        WorldConfig::default(),
    ));
    for r in step["requests"].as_array().unwrap() {
        vc.clear();
        expect_calls(&vc, r);
        for a in r["air"].as_array().unwrap() {
            stub.push(WAQI, Reply::json(body(a["body_sha256"].as_str().unwrap())));
        }
        let reply = backend
            .reply(&path(r), r["lang"].as_str().unwrap(), deadline())
            .await;
        matches(r, &reply).unwrap();
    }
    assert_eq!(stub.calls().len(), 1);
    let dump = peer.dump().await;
    assert!(
        dump.iter()
            .any(|(k, _, _)| k.starts_with("budgets/v2/waqi/"))
    );
    assert!(
        dump.iter()
            .any(|(k, _, _)| k.starts_with("raw/v2/air-waqi/current/"))
    );

    let cold_store: Arc<dyn AirStore> =
        Arc::new(CatalogAirStore::new(s3.clone(), CatalogLimits::default()).unwrap());
    let (air, down) = restarted(cold_store, Arc::new(s3.clone()), clock.clone());
    let cold = WorldBackend::new(World::new(
        Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        ),
        Arc::new(super::common::Down),
        air,
        clock,
        WorldConfig::default(),
    ));
    for r in step["requests"].as_array().unwrap() {
        let reply = cold
            .reply(&path(r), r["lang"].as_str().unwrap(), deadline())
            .await;
        matches(r, &reply).unwrap();
    }
    assert_eq!(stub.calls().len(), 1, "restore made no provider call");
    assert_eq!(
        down.calls(),
        0,
        "the stored record answered before the chain"
    );
}

fn vars(extra: &[(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    let mut all = vec![
        ("SERVER2_WORLD_VC_DAILY_UNITS", "1000"),
        (
            "SERVER2_WORLD_VC_QUOTA_ID",
            "abababababababababababababababababababababababababababababababab",
        ),
        ("VC_SECRET_KEY", "S13A_LOCAL_VC_KEY"),
    ];
    all.extend_from_slice(extra);
    move |name: &str| {
        all.iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| (*v).to_owned())
    }
}

#[tokio::test]
async fn smoke_runtime_air_settings_are_real_configuration() {
    let peer = super::common::Peer::new();
    let s3 = || server2::world::BoundedS3::new(peer.transport(), 12);
    const WAQI_VARS: [(&str, &str); 3] = [
        ("SERVER2_WORLD_AIR_WAQI_KEY", "S13A_LOCAL_WAQI_KEY"),
        (
            "SERVER2_WORLD_AIR_WAQI_QUOTA_ID",
            "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
        ),
        ("SERVER2_WORLD_AIR_WAQI_MONTHLY_UNITS", "100000"),
    ];
    // No air key: the legacy no-provider output. A key with its limit and owner: the funded
    // chain at the production endpoint root, or at a configured endpoint.
    assert!(build(&vars(&[]), s3()).is_ok());
    assert!(build(&vars(&WAQI_VARS), s3()).is_ok());
    let mut configured = WAQI_VARS.to_vec();
    configured.push(("SERVER2_WORLD_AIR_WAQI_URL", "https://waqi.example.test/"));
    assert!(build(&vars(&configured), s3()).is_ok());
    // A provider key without its limit or owner, or an endpoint outside the transport rule,
    // is a configuration error.
    for i in 1..WAQI_VARS.len() {
        let mut partial = WAQI_VARS.to_vec();
        partial.remove(i);
        assert!(build(&vars(&partial), s3()).is_err(), "{i}");
    }
    let mut plain = WAQI_VARS.to_vec();
    plain.push(("SERVER2_WORLD_AIR_WAQI_URL", "http://waqi.example.test/"));
    assert!(build(&vars(&plain), s3()).is_err());
    // Removed settings select nothing: the routing list alone selects the native world.
    assert!(
        server2::world::runtime::from_vars(&vars(&[("SERVER2_WORLD_AIR", "live-local")]))
            .unwrap()
            .is_none()
    );
}
