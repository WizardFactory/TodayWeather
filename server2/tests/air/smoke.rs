//! Release-mode functional smoke (`cargo test --release --test air smoke`): live air over real
//! loopback HTTP with S08 budgets and raw records in the S3 test peer, then S3-only restore;
//! and the opt-in, loopback-only runtime variables. No AWS or provider traffic.
use super::common::{Peer, ScriptedVc, body, deadline, expect_calls, matches, ms, path, scenario};
use super::support::{Linked, Reply, Stub, WAQI, waqi_only};
use server2::storage::CatalogLimits;
use server2::world::{
    AirFunding, AirStore, CatalogAirStore, Disabled, FixedClock, HttpAirTransport, LiveAir, World,
    WorldBackend, WorldConfig, runtime::from_vars,
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
    let cold = WorldBackend::new(World::new(
        Arc::new(
            server2::world::CatalogWorldStore::new(s3.clone(), CatalogLimits::default()).unwrap(),
        ),
        Arc::new(Disabled),
        Arc::new(LiveAir::restore_only(cold_store, clock.clone())),
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
}

fn vars(extra: &[(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    let mut all = vec![
        ("SERVER2_WORLD_MODE", "native-local"),
        ("SERVER2_WORLD_S3_ENDPOINT", "http://127.0.0.1:9/"),
        ("SERVER2_WORLD_S3_BUCKET", "server2-local"),
        ("SERVER2_WORLD_S3_ACCESS_KEY_ID", "server2-local"),
        ("SERVER2_WORLD_S3_SECRET_ACCESS_KEY", "server2-local-secret"),
        ("SERVER2_WORLD_VC_DAILY_UNITS", "1000"),
        (
            "SERVER2_WORLD_VC_QUOTA_ID",
            "abababababababababababababababababababababababababababababababab",
        ),
        ("SERVER2_WORLD_VC_URL", "http://127.0.0.1:9/timeline/"),
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
async fn smoke_runtime_air_variables_are_opt_in_and_loopback_only() {
    const WAQI_VARS: [(&str, &str); 4] = [
        ("SERVER2_WORLD_AIR_WAQI_URL", "http://127.0.0.1:9/"),
        ("SERVER2_WORLD_AIR_WAQI_KEY", "S13A_LOCAL_WAQI_KEY"),
        (
            "SERVER2_WORLD_AIR_WAQI_QUOTA_ID",
            "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
        ),
        ("SERVER2_WORLD_AIR_WAQI_MONTHLY_UNITS", "100000"),
    ];
    // Unset: S11 behavior (no air provider). Without the world mode nothing is configured.
    assert!(from_vars(&vars(&[])).unwrap().is_some());
    assert!(from_vars(&|_: &str| None).unwrap().is_none());
    let mut live = vec![("SERVER2_WORLD_AIR", "live-local")];
    live.extend_from_slice(&WAQI_VARS);
    assert!(from_vars(&vars(&live)).unwrap().is_some());
    assert!(
        from_vars(&vars(&[("SERVER2_WORLD_AIR", "restore-local")]))
            .unwrap()
            .is_some()
    );
    // Unknown mode, a non-loopback provider URL or an incomplete provider is rejected.
    assert!(from_vars(&vars(&[("SERVER2_WORLD_AIR", "live")])).is_err());
    let mut remote = vec![("SERVER2_WORLD_AIR", "live-local")];
    remote.extend_from_slice(&WAQI_VARS);
    remote[1] = ("SERVER2_WORLD_AIR_WAQI_URL", "https://api.waqi.info/");
    assert!(from_vars(&vars(&remote)).is_err());
    let incomplete = vec![
        ("SERVER2_WORLD_AIR", "live-local"),
        ("SERVER2_WORLD_AIR_WAQI_URL", "http://127.0.0.1:9/"),
    ];
    assert!(from_vars(&vars(&incomplete)).is_err());
    // live-local without any provider is a configuration error, not a silent no-provider.
    assert!(from_vars(&vars(&[("SERVER2_WORLD_AIR", "live-local")])).is_err());
}
