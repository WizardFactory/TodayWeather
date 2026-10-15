//! S10c/S10e: the real runtime configuration. Native geocoder, world/air and KMA are built from
//! the legacy `server/.env` settings without any mode variable; test peers are reached only
//! through test-built `Builtins` (S3 and provider roots are not settings). Test doubles live here.
use super::geocode::{fixture, stub};
use server2::gateway::runtime::Builtins;
use server2::geocode::{BoxFuture, GeocodeError, Geocoder, GeocoderConfig, ProviderDemand, Quota};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

/// Counting quota double: one unit per possible attempt, no refund.
pub struct CountingQuota(pub AtomicUsize);
impl CountingQuota {
    pub fn new(units: usize) -> Self {
        Self(AtomicUsize::new(units))
    }
    pub fn remaining(&self) -> usize {
        self.0.load(Ordering::Acquire)
    }
}
impl Quota for CountingQuota {
    fn reserve(&self, demands: Vec<ProviderDemand>) -> BoxFuture<'_, Result<(), GeocodeError>> {
        Box::pin(async move {
            let count: usize = demands.iter().map(|d| d.attempts as usize).sum();
            self.0
                .try_update(Ordering::AcqRel, Ordering::Acquire, |v| {
                    v.checked_sub(count)
                })
                .map(|_| ())
                .map_err(|_| GeocodeError::Quota)
        })
    }
}

fn vars(pairs: Vec<(&'static str, String)>) -> impl Fn(&str) -> Option<String> {
    move |name: &str| {
        pairs
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.clone())
    }
}

#[tokio::test]
async fn real_geocoder_accepts_configured_endpoints_and_funds_before_http() {
    // Any HTTPS endpoint is a valid configuration (no request is sent here).
    for url in ["https://dapi.kakao.com", "https://geocode.example.test/"] {
        let config = GeocoderConfig {
            kakao_base_url: url.into(),
            google_base_url: url.into(),
            kakao_keys: vec!["configured-kakao-key".into()],
            ..GeocoderConfig::default()
        };
        assert!(Geocoder::new(config).is_ok(), "{url}");
    }
    // The configured endpoint (a loopback test peer) is used with the configured quota.
    let peer = stub(
        vec![(200, fixture("kakao.coord.seoul"), Duration::ZERO)],
        vec![],
    )
    .await;
    let quota = Arc::new(CountingQuota::new(2));
    let geo = Geocoder::new(GeocoderConfig {
        kakao_base_url: peer.base.clone(),
        google_base_url: peer.base.clone(),
        kakao_keys: vec!["configured-kakao-key".into()],
        ..GeocoderConfig::default()
    })
    .unwrap()
    .with_quota(quota.clone());
    assert!(geo.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
    assert_eq!(quota.remaining(), 1);
}

/// S06 loopback S3 test peer (tests/storage/catalog_peer.py), killed on drop.
struct S3Peer {
    child: std::process::Child,
    endpoint: String,
}
impl S3Peer {
    fn start() -> Self {
        use std::io::{BufRead, BufReader};
        let mut child = std::process::Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.starts_with("http://127.0.0.1:"), "peer: {line}");
        Self {
            child,
            endpoint: line.trim().to_owned(),
        }
    }
    /// Every stored key (single listing page; the peer's local test-key control).
    async fn keys(&self) -> Vec<String> {
        let text = reqwest::Client::new()
            .get(format!("{}server2-local?list-type=2", self.endpoint))
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(text.contains("<IsTruncated>false</IsTruncated>"), "{text}");
        text.split("<Key>")
            .skip(1)
            .filter_map(|p| p.split("</Key>").next().map(str::to_owned))
            .collect()
    }
}
impl Drop for S3Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
/// The legacy S3 settings (S10e): bucket and credentials by their legacy `server/.env` names.
/// The endpoint is not a setting; tests reach the peer through [`peer_builtins`].
fn s3_vars() -> Vec<(&'static str, String)> {
    vec![
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("AWS_ACCESS_KEY", "server2-local".to_owned()),
        ("AWS_SECRET_KEY", "server2-local-secret".to_owned()),
    ]
}
/// Production roots with the S3 endpoint on a loopback test peer.
fn peer_builtins(peer: &S3Peer) -> Builtins {
    Builtins {
        s3: Some(peer.endpoint.clone()),
        ..Builtins::production()
    }
}
fn golden(id: &str) -> Vec<u8> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let records: serde_json::Value =
        serde_json::from_str(include_str!("../golden/records.json")).unwrap();
    let case = records["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone();
    STANDARD
        .decode(case["body_base64"].as_str().unwrap())
        .unwrap()
}
async fn body(gateway: &server2::gateway::Gateway, path: &str) -> (u16, Vec<u8>) {
    let request = axum::http::Request::get(path)
        .body(axum::body::Body::empty())
        .unwrap();
    let response = gateway.handle(request).await;
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

/// The only `SERVER2_*` names server2 reads (S10e): coexistence routing (temporary until
/// legacy retirement) and the raw-record bucket and its region (S10f), values legacy does not
/// have.
const SERVER2_ONLY: [&str; 5] = [
    "SERVER2_GATEWAY_LEGACY_URL",
    "SERVER2_NATIVE_FAMILIES",
    "SERVER2_WORLD_VERSIONS",
    "SERVER2_S3_BUCKET",
    "SERVER2_S3_REGION",
];

/// S10e (#2753, AK 2026-10-15): a legacy `server/.env`, plus the coexistence routing entries
/// and the server2 bucket, configures every native family. No provider key, quota, quota owner,
/// URL, S3 credential or region, or process setting has a `SERVER2_*` name. Built at the
/// production roots; nothing is sent.
#[test]
fn legacy_env_alone_builds_every_native_family() {
    let legacy = [
        // Coexistence routing (temporary until legacy retirement), the server2 bucket and its
        // region.
        ("SERVER2_GATEWAY_LEGACY_URL", "http://127.0.0.1:9"),
        ("SERVER2_NATIVE_FAMILIES", "geocode,dsf,kma"),
        ("SERVER2_S3_BUCKET", "server2-raw-records"),
        ("SERVER2_S3_REGION", "ap-northeast-2"),
        // Legacy server/.env names (config.js) with placeholder values.
        ("OPENSHIFT_NODEJS_IP", "127.0.0.1"),
        ("PORT", "3000"),
        ("OPENSHIFT_NODEJS_PORT", "3000"),
        // The legacy region of the unrelated 2018 bucket; not read since S10f.
        ("TWA_S3_REGION", "us-east-1"),
        ("TWA_S3_WEATHER_DATA_BUCKET_NAME", "legacy-weather-data"),
        ("AWS_ACCESS_KEY", "legacy-access-key"),
        ("AWS_SECRET_KEY", "legacy-secret-key"),
        ("AWS_REGION", "us-east-1"),
        ("DONGNAE_SECRET_KEYS", r#"["legacy-data-go-kr-key-0001"]"#),
        (
            "AIRKOREA_SECRET_KEYS",
            r#"["legacy-airkorea-key-000000001"]"#,
        ),
        ("VC_SECRET_KEY", "legacy-vc-key-0001"),
        ("VC_DAILY_RECORD_LIMIT", "1000"),
        ("GOOGLE_SECRET_KEY", "legacy-google-key-0001"),
        ("OWM_SECRET_KEY", "legacy-owm-key-0001"),
        ("WAQI_SECRET_KEY", "legacy-waqi-key-0001"),
        ("GEOCODER_KAKAO_KEYS", r#"["legacy-kakao-key"]"#),
        ("GEOCODER_GOOGLE_KEY", "legacy-geocoder-google-key"),
    ];
    let read = std::sync::Mutex::new(Vec::<String>::new());
    let var = |name: &str| {
        read.lock().unwrap().push(name.to_owned());
        legacy
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| (*v).to_owned())
    };
    let gateway = server2::gateway::runtime::from_vars(&var)
        .unwrap()
        .expect("gateway enabled");
    drop(gateway);
    let config = server2::Config::from_vars(&var).unwrap();
    assert_eq!(config.public_addr.to_string(), "127.0.0.1:3000");
    assert_eq!(config.metrics_addr.to_string(), "127.0.0.1:3001");
    assert_eq!(
        config.connection_seconds,
        server2::GATEWAY_CONNECTION_SECONDS
    );
    let read = read.into_inner().unwrap();
    for name in &read {
        assert!(
            !name.starts_with("SERVER2_") || SERVER2_ONLY.contains(&name.as_str()),
            "read {name}"
        );
    }
    // server2/.env.example lists every variable server2 read here.
    let example = include_str!("../../.env.example");
    for name in &read {
        assert!(
            example.contains(&format!("{name}=")),
            "{name} missing from .env.example"
        );
    }
    // Every family read its legacy settings.
    for name in [
        "SERVER2_S3_BUCKET",
        "AWS_ACCESS_KEY",
        "AWS_SECRET_KEY",
        "SERVER2_S3_REGION",
        "GEOCODER_KAKAO_KEYS",
        "DONGNAE_SECRET_KEYS",
        "AIRKOREA_SECRET_KEYS",
        "VC_SECRET_KEY",
        "VC_DAILY_RECORD_LIMIT",
        "GOOGLE_SECRET_KEY",
        "OWM_SECRET_KEY",
        "WAQI_SECRET_KEY",
        "OPENSHIFT_NODEJS_PORT",
    ] {
        assert!(read.iter().any(|n| n == name), "{name} not read");
    }
    // S10f: the legacy region of the unrelated 2018 bucket is not read.
    assert!(!read.iter().any(|n| n == "TWA_S3_REGION"));
}

/// S10f (#2759): the copied legacy `.env` holds the `config.js` placeholder AWS keys. The gateway
/// then signs S3 requests with EC2 instance-role credentials (IMDSv2 loopback double) and serves
/// the S02 geocode golden with its budgets in the S3 test peer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gateway_without_keys_uses_the_instance_role() {
    let providers = stub(
        vec![(200, fixture("kakao.coord.seoul"), Duration::ZERO)],
        vec![(200, fixture("google.coord.seoul.en"), Duration::ZERO)],
    )
    .await;
    let peer = S3Peer::start();
    // The S3 test peer accepts its one test access key ID.
    let imds = super::imds::Imds::start("server2-local", false).await;
    let settings = vec![
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("AWS_ACCESS_KEY", "You have to set key of AWS".to_owned()),
        ("AWS_SECRET_KEY", "You have to set key of AWS".to_owned()),
        (
            "SERVER2_GATEWAY_LEGACY_URL",
            "http://127.0.0.1:9".to_owned(),
        ),
        ("SERVER2_NATIVE_FAMILIES", "geocode".to_owned()),
        ("GEOCODER_KAKAO_KEYS", r#"["synthetic-kakao"]"#.to_owned()),
        ("GEOCODER_GOOGLE_KEY", "synthetic-google".to_owned()),
    ];
    let builtins = Builtins {
        kakao: providers.base.clone(),
        google: providers.base.clone(),
        geocoder_daily_units: [10, 10],
        instance_metadata: Some(imds.root.clone()),
        ..peer_builtins(&peer)
    };
    let gateway = server2::gateway::runtime::from_vars_at(&vars(settings), &builtins)
        .unwrap()
        .expect("gateway enabled");
    assert_eq!(imds.requests(), 0, "configuration does not contact IMDS");
    let (status, bytes) = body(&gateway, "/geocode/v000903/coord/37.5663,126.9779").await;
    assert_eq!(status, 200);
    assert_eq!(bytes, golden("geocode-v000903-coord"));
    assert_eq!(
        imds.requests(),
        3,
        "one IMDSv2 refresh for every S3 request"
    );
    assert!(
        peer.keys()
            .await
            .iter()
            .any(|k| k.starts_with("budgets/v2/")),
        "budgets written with role credentials"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_geocode_from_real_settings_serves_the_s02_golden() {
    let providers = stub(
        vec![(200, fixture("kakao.coord.seoul"), Duration::ZERO)],
        vec![(200, fixture("google.coord.seoul.en"), Duration::ZERO)],
    )
    .await;
    let peer = S3Peer::start();
    let mut settings = s3_vars();
    settings.extend([
        (
            "SERVER2_GATEWAY_LEGACY_URL",
            "http://127.0.0.1:9".to_owned(),
        ),
        ("SERVER2_NATIVE_FAMILIES", "geocode".to_owned()),
        ("GEOCODER_KAKAO_KEYS", r#"["synthetic-kakao"]"#.to_owned()),
        ("GEOCODER_GOOGLE_KEY", "synthetic-google".to_owned()),
    ]);
    let builtins = Builtins {
        kakao: providers.base.clone(),
        google: providers.base.clone(),
        geocoder_daily_units: [10, 10],
        ..peer_builtins(&peer)
    };
    let gateway = server2::gateway::runtime::from_vars_at(&vars(settings), &builtins)
        .unwrap()
        .expect("gateway enabled");
    let (status, bytes) = body(&gateway, "/geocode/v000903/coord/37.5663,126.9779").await;
    assert_eq!(status, 200);
    assert_eq!(bytes, golden("geocode-v000903-coord"));
    assert_eq!(
        providers.state.count.load(Ordering::Acquire),
        2,
        "Kakao + Google"
    );
    // Only S08 budget authorities reach S3; no coordinate, key or result.
    let keys = peer.keys().await;
    assert!(keys.iter().any(|k| k.starts_with("budgets/v2/kakao/")));
    assert!(keys.iter().any(|k| k.starts_with("budgets/v2/google/")));
    for k in &keys {
        assert!(k.starts_with("budgets/v2/"), "{k}");
        assert!(!k.contains("37.5") && !k.contains("synthetic"), "{k}");
    }
}

#[tokio::test]
async fn without_native_families_legacy_is_selected_and_no_native_setting_is_read() {
    let legacy = stub(
        vec![(
            200,
            serde_json::json!({"name":"legacy","country":"KR","address":"fixture"}),
            Duration::ZERO,
        )],
        vec![],
    )
    .await;
    let read = std::sync::Mutex::new(Vec::new());
    let base = legacy.base.clone();
    let var = |name: &str| {
        read.lock().unwrap().push(name.to_owned());
        (name == "SERVER2_GATEWAY_LEGACY_URL").then(|| base.clone())
    };
    let gateway = server2::gateway::runtime::from_vars(&var).unwrap().unwrap();
    let names = read.lock().unwrap().clone();
    assert_eq!(
        names,
        ["SERVER2_GATEWAY_LEGACY_URL", "SERVER2_NATIVE_FAMILIES"]
    );
    let (status, bytes) = body(&gateway, "/geocode/v000903/coord/37.5663,126.9779").await;
    assert_eq!(status, 200);
    assert!(String::from_utf8(bytes).unwrap().contains("legacy"));
    assert_eq!(
        legacy.state.calls.lock().unwrap().as_slice(),
        ["/geocode/v000903/coord/37.566,126.978"]
    );
    // No legacy URL keeps the foundation service and reads nothing else.
    assert!(
        server2::gateway::runtime::from_vars(&|_: &str| None)
            .unwrap()
            .is_none()
    );
}

#[test]
fn kma_requires_the_legacy_data_go_kr_keys_and_valid_provider_roots() {
    use server2::gateway::runtime::{from_vars as gateway, from_vars_at};
    let complete = || {
        let mut v = s3_vars();
        v.extend([
            (
                "SERVER2_GATEWAY_LEGACY_URL",
                "http://127.0.0.1:9".to_owned(),
            ),
            ("SERVER2_NATIVE_FAMILIES", "kma".to_owned()),
            (
                "DONGNAE_SECRET_KEYS",
                r#"["configured-data-go-kr-key-0001"]"#.to_owned(),
            ),
        ]);
        v
    };
    assert!(gateway(&vars(complete())).unwrap().is_some());
    let partial = complete()
        .into_iter()
        .filter(|(k, _)| *k != "DONGNAE_SECRET_KEYS")
        .collect();
    assert!(gateway(&vars(partial)).is_err(), "no DONGNAE_SECRET_KEYS");
    // Legacy `dataGoKrKeys.parse`: an empty, malformed or placeholder-only list has no key.
    for value in ["[]", "not json", r#"["key1", "key2"]"#] {
        let mut settings = complete();
        settings.retain(|(k, _)| *k != "DONGNAE_SECRET_KEYS");
        settings.push(("DONGNAE_SECRET_KEYS", value.to_owned()));
        assert!(gateway(&vars(settings)).is_err(), "{value}");
    }
    // The removed server2-only settings are not read: a stale value changes nothing.
    let mut stale = complete();
    stale.extend([
        ("SERVER2_DATA_GO_KR_DAILY_UNITS", "many".to_owned()),
        (
            "SERVER2_KMA_WEATHER_BASE_URL",
            "http://www.weather.go.kr/".to_owned(),
        ),
        ("SERVER2_S3_ENDPOINT", "http://s3.example.test/".to_owned()),
    ]);
    assert!(gateway(&vars(stale)).unwrap().is_some());
    // Builtins are not settings; a test root follows the transport rule.
    for roots in [
        Builtins {
            kma_weather: "http://www.weather.go.kr/".into(),
            ..Builtins::production()
        },
        Builtins {
            data_go_kr: "https://apis.data.go.kr/x?y".into(),
            ..Builtins::production()
        },
    ] {
        assert!(
            from_vars_at(&vars(complete()), &roots).is_err(),
            "{roots:?}"
        );
    }
    let loopback = Builtins {
        kma_weather: "http://127.0.0.1:9/".into(),
        ..Builtins::production()
    };
    assert!(
        from_vars_at(&vars(complete()), &loopback)
            .unwrap()
            .is_some()
    );
}

#[test]
fn routing_list_and_required_settings_fail_closed() {
    use server2::gateway::runtime::{NativeFamilies, from_vars as gateway, from_vars_at};
    let list = |v: &'static str| NativeFamilies::from_vars(&move |_: &str| Some(v.to_owned()));
    assert_eq!(list("").unwrap(), NativeFamilies::default());
    assert_eq!(
        list(" geocode , dsf ").unwrap(),
        NativeFamilies {
            geocode: true,
            dsf: true,
            kma: false
        }
    );
    assert_eq!(
        list("kma").unwrap(),
        NativeFamilies {
            kma: true,
            ..NativeFamilies::default()
        }
    );
    for bad in [
        "kma,kma",
        "KMA",
        "geocode,geocode",
        "geocode,",
        "mock",
        "native",
    ] {
        assert!(list(bad).is_err(), "{bad}");
    }
    let complete = || {
        let mut v = s3_vars();
        v.extend([
            (
                "SERVER2_GATEWAY_LEGACY_URL",
                "http://127.0.0.1:9".to_owned(),
            ),
            ("SERVER2_NATIVE_FAMILIES", "geocode,dsf".to_owned()),
            ("GEOCODER_KAKAO_KEYS", r#"["configured-kakao"]"#.to_owned()),
            ("VC_SECRET_KEY", "configured-vc-key".to_owned()),
        ]);
        v
    };
    // Production roots: HTTPS S3, Kakao, Google and Visual Crossing endpoints.
    assert!(gateway(&vars(complete())).unwrap().is_some());
    for missing in [
        "SERVER2_S3_BUCKET",
        "AWS_ACCESS_KEY",
        "AWS_SECRET_KEY",
        "GEOCODER_KAKAO_KEYS",
        "VC_SECRET_KEY",
    ] {
        let partial = complete()
            .into_iter()
            .filter(|(k, _)| *k != missing)
            .collect();
        assert!(gateway(&vars(partial)).is_err(), "{missing}");
    }
    for (name, value) in [
        ("SERVER2_WORLD_VERSIONS", "v000705"),
        // Legacy `config/air.js` throws on a cap that is not a whole number.
        ("AIR_GOOGLE_MONTHLY_CAP", "many"),
        ("AIR_OWM_MONTHLY_CAP", "-1"),
        ("SERVER2_S3_REGION", "bad/region"),
    ] {
        let mut changed = complete();
        changed.retain(|(k, _)| *k != name);
        changed.push((name, value.to_owned()));
        assert!(gateway(&vars(changed)).is_err(), "{name}={value}");
    }
    for roots in [
        Builtins {
            s3: Some("http://s3.example.test/".into()),
            ..Builtins::production()
        },
        Builtins {
            kakao: "http://dapi.kakao.com".into(),
            ..Builtins::production()
        },
        Builtins {
            vc: "http://weather.example.test/timeline/".into(),
            ..Builtins::production()
        },
        // S10C-R1-F02: a fragment would drop the request path; user information is refused.
        Builtins {
            vc: "https://weather.example.test/timeline/#/".into(),
            ..Builtins::production()
        },
        Builtins {
            vc: "https://user@weather.example.test/timeline/".into(),
            ..Builtins::production()
        },
    ] {
        assert!(
            from_vars_at(&vars(complete()), &roots).is_err(),
            "{roots:?}"
        );
    }
    // Non-loopback HTTPS roots are valid (a test peer or the production default).
    let mut https = complete();
    // S10e: legacy's test-only endpoint name is not read (an invalid value changes nothing).
    https.push((
        "GEOCODER_KAKAO_BASE_URL",
        "http://dapi.kakao.com".to_owned(),
    ));
    let roots = Builtins {
        kakao: "https://geocode.example.test".into(),
        s3: Some("https://s3.example.test/".into()),
        vc: "https://weather.example.test/timeline/".into(),
        ..Builtins::production()
    };
    assert!(from_vars_at(&vars(https), &roots).unwrap().is_some());
    // Legacy caps: blank is the default, zero leaves the provider out, digits are valid.
    for (name, value) in [
        ("AIR_GOOGLE_MONTHLY_CAP", " "),
        ("AIR_GOOGLE_MONTHLY_CAP", "0"),
        ("AIR_OWM_MONTHLY_CAP", " 2000 "),
        ("VC_DAILY_RECORD_LIMIT", "0"),
        ("VC_DAILY_RECORD_LIMIT", "many"),
    ] {
        let mut changed = complete();
        changed.push((name, value.to_owned()));
        assert!(gateway(&vars(changed)).unwrap().is_some(), "{name}={value}");
    }
}

/// S15b-3: `kma` reads the legacy AirKorea key list with the built-in daily units (S10e). No
/// key: stored AirKorea records only.
#[test]
fn kma_airkorea_acquisition_settings_fail_closed() {
    use server2::gateway::runtime::{from_vars as gateway, from_vars_at};
    let base = || {
        let mut v = s3_vars();
        v.extend([
            (
                "SERVER2_GATEWAY_LEGACY_URL",
                "http://127.0.0.1:9".to_owned(),
            ),
            ("SERVER2_NATIVE_FAMILIES", "kma".to_owned()),
            // S15b-2: kma also requires the data.go.kr key list.
            (
                "DONGNAE_SECRET_KEYS",
                r#"["configured-data-go-kr-key-0001"]"#.to_owned(),
            ),
        ]);
        v
    };
    assert!(gateway(&vars(base())).unwrap().is_some(), "no key");
    let keyed = || {
        let mut v = base();
        v.push((
            "AIRKOREA_SECRET_KEYS",
            r#"["configured-airkorea-key-0123456789"]"#.to_owned(),
        ));
        v
    };
    assert!(gateway(&vars(keyed())).unwrap().is_some());
    for roots in [
        Builtins {
            data_go_kr: "http://apis.example.test/".into(),
            ..Builtins::production()
        },
        Builtins {
            data_go_kr: "https://apis.example.test/?q=1".into(),
            ..Builtins::production()
        },
    ] {
        assert!(from_vars_at(&vars(keyed()), &roots).is_err(), "{roots:?}");
    }
    // A placeholder key list (legacy default `["key1", "key2"]`) is no key.
    let mut placeholder = base();
    placeholder.push(("AIRKOREA_SECRET_KEYS", r#"["key1", "key2"]"#.to_owned()));
    assert!(gateway(&vars(placeholder)).unwrap().is_some());
}

#[test]
fn real_world_configuration_builds_without_a_mode_variable() {
    let mut settings = s3_vars();
    settings.extend([
        ("SERVER2_NATIVE_FAMILIES", "dsf".to_owned()),
        ("VC_SECRET_KEY", "configured-vc-key".to_owned()),
        ("WAQI_SECRET_KEY", "configured-waqi-key".to_owned()),
    ]);
    let configured = server2::world::runtime::from_vars(&vars(settings)).unwrap();
    let (_, versions) = configured.expect("native world configured");
    assert_eq!(versions.len(), 3);
}

/// S10e: process listeners follow legacy `config.js` (`OPENSHIFT_NODEJS_IP`, then
/// `OPENSHIFT_NODEJS_PORT` or `PORT`, default 3000); metrics use the next loopback port.
#[test]
fn process_listeners_follow_the_legacy_port_rule() {
    use server2::Config;
    let config = |pairs: &[(&'static str, &str)]| {
        let pairs: Vec<_> = pairs.iter().map(|(k, v)| (*k, (*v).to_owned())).collect();
        Config::from_vars(&vars(pairs))
    };
    let addresses = |c: Config| (c.public_addr.to_string(), c.metrics_addr.to_string());
    assert_eq!(
        addresses(config(&[]).unwrap()),
        ("127.0.0.1:3000".into(), "127.0.0.1:3001".into())
    );
    assert_eq!(
        addresses(config(&[("PORT", "4100")]).unwrap()),
        ("127.0.0.1:4100".into(), "127.0.0.1:4101".into())
    );
    // `OPENSHIFT_NODEJS_PORT` wins over `PORT`; an empty value counts as unset (JavaScript `||`).
    assert_eq!(
        addresses(config(&[("PORT", "4100"), ("OPENSHIFT_NODEJS_PORT", "4200")]).unwrap()),
        ("127.0.0.1:4200".into(), "127.0.0.1:4201".into())
    );
    assert_eq!(
        addresses(config(&[("PORT", "4100"), ("OPENSHIFT_NODEJS_PORT", "")]).unwrap()),
        ("127.0.0.1:4100".into(), "127.0.0.1:4101".into())
    );
    // Port 0 selects ephemeral ports for both listeners (tests and smokes).
    assert_eq!(
        addresses(config(&[("PORT", "0")]).unwrap()),
        ("127.0.0.1:0".into(), "127.0.0.1:0".into())
    );
    // The public address may be any interface; metrics stay on loopback.
    assert_eq!(
        addresses(config(&[("OPENSHIFT_NODEJS_IP", "0.0.0.0"), ("PORT", "80")]).unwrap()),
        ("0.0.0.0:80".into(), "127.0.0.1:81".into())
    );
    assert_eq!(
        addresses(config(&[("OPENSHIFT_NODEJS_IP", "::1"), ("PORT", "80")]).unwrap()),
        ("[::1]:80".into(), "[::1]:81".into())
    );
    for bad in [
        ("PORT", "http"),
        ("PORT", "65535"),
        ("OPENSHIFT_NODEJS_PORT", "-1"),
        ("OPENSHIFT_NODEJS_IP", "localhost"),
    ] {
        assert!(config(&[bad]).is_err(), "{bad:?}");
    }
    // The removed process settings are not read.
    let stale = config(&[
        ("SERVER2_BIND", "0.0.0.0:1"),
        ("SERVER2_METRICS_BIND", "0.0.0.0:2"),
        ("SERVER2_WORKER_THREADS", "999"),
        ("SERVER2_CONNECTION_SECONDS", "1"),
    ])
    .unwrap();
    assert_eq!(stale.public_addr.to_string(), "127.0.0.1:3000");
    assert_eq!(stale.worker_threads, Config::default().worker_threads);
    assert_eq!(stale.connection_seconds, 9);
    // With the gateway the lifetime is the S10b 12 seconds.
    let gateway = config(&[("SERVER2_GATEWAY_LEGACY_URL", "http://127.0.0.1:9")]).unwrap();
    assert_eq!(
        gateway.connection_seconds,
        server2::GATEWAY_CONNECTION_SECONDS
    );
}
