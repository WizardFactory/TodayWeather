//! S10c: the real runtime configuration. Native geocoder and native world/air are built from
//! real-format settings (HTTPS endpoints, keys, quotas, S3) without any mode variable; test
//! peers are reached only because the settings point at them. Test doubles live here.
use super::geocode::{fixture, stub};
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
fn s3_vars(peer: &S3Peer) -> Vec<(&'static str, String)> {
    vec![
        ("SERVER2_S3_ENDPOINT", peer.endpoint.clone()),
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("SERVER2_S3_ACCESS_KEY_ID", "server2-local".to_owned()),
        (
            "SERVER2_S3_SECRET_ACCESS_KEY",
            "server2-local-secret".to_owned(),
        ),
    ]
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_geocode_from_real_settings_serves_the_s02_golden() {
    let providers = stub(
        vec![(200, fixture("kakao.coord.seoul"), Duration::ZERO)],
        vec![(200, fixture("google.coord.seoul.en"), Duration::ZERO)],
    )
    .await;
    let peer = S3Peer::start();
    let mut settings = s3_vars(&peer);
    settings.extend([
        (
            "SERVER2_GATEWAY_LEGACY_URL",
            "http://127.0.0.1:9".to_owned(),
        ),
        ("SERVER2_NATIVE_FAMILIES", "geocode".to_owned()),
        ("GEOCODER_KAKAO_KEYS", r#"["synthetic-kakao"]"#.to_owned()),
        ("GEOCODER_GOOGLE_KEY", "synthetic-google".to_owned()),
        ("GEOCODER_KAKAO_BASE_URL", providers.base.clone()),
        ("GEOCODER_GOOGLE_BASE_URL", providers.base.clone()),
        ("SERVER2_GEOCODER_KAKAO_DAILY_UNITS", "10".to_owned()),
        ("SERVER2_GEOCODER_GOOGLE_DAILY_UNITS", "10".to_owned()),
    ]);
    let gateway = server2::gateway::runtime::from_vars(&vars(settings))
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
fn routing_list_and_required_settings_fail_closed() {
    use server2::gateway::runtime::{NativeFamilies, from_vars as gateway};
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
        vec![
            (
                "SERVER2_GATEWAY_LEGACY_URL",
                "http://127.0.0.1:9".to_owned(),
            ),
            ("SERVER2_NATIVE_FAMILIES", "geocode,dsf".to_owned()),
            ("SERVER2_S3_BUCKET", "server2-world".to_owned()),
            (
                "SERVER2_S3_ACCESS_KEY_ID",
                "configured-access-key".to_owned(),
            ),
            (
                "SERVER2_S3_SECRET_ACCESS_KEY",
                "configured-secret".to_owned(),
            ),
            ("GEOCODER_KAKAO_KEYS", r#"["configured-kakao"]"#.to_owned()),
            ("SERVER2_GEOCODER_KAKAO_DAILY_UNITS", "1000".to_owned()),
            ("SERVER2_WORLD_VC_DAILY_UNITS", "1000".to_owned()),
            ("SERVER2_WORLD_VC_QUOTA_ID", "ab".repeat(32)),
            ("VC_SECRET_KEY", "configured-vc-key".to_owned()),
        ]
    };
    // Production defaults: HTTPS S3, Kakao, Google and Visual Crossing endpoints.
    assert!(gateway(&vars(complete())).unwrap().is_some());
    for missing in [
        "SERVER2_S3_BUCKET",
        "SERVER2_S3_ACCESS_KEY_ID",
        "SERVER2_S3_SECRET_ACCESS_KEY",
        "GEOCODER_KAKAO_KEYS",
        "SERVER2_GEOCODER_KAKAO_DAILY_UNITS",
        "SERVER2_WORLD_VC_DAILY_UNITS",
        "SERVER2_WORLD_VC_QUOTA_ID",
        "VC_SECRET_KEY",
    ] {
        let partial = complete()
            .into_iter()
            .filter(|(k, _)| *k != missing)
            .collect();
        assert!(gateway(&vars(partial)).is_err(), "{missing}");
    }
    for (name, value) in [
        ("SERVER2_S3_ENDPOINT", "http://s3.example.test/"),
        ("GEOCODER_KAKAO_BASE_URL", "http://dapi.kakao.com"),
        (
            "SERVER2_WORLD_VC_URL",
            "http://weather.example.test/timeline/",
        ),
        // S10C-R1-F02: a fragment would drop the request path; user information is refused.
        (
            "SERVER2_WORLD_VC_URL",
            "https://weather.example.test/timeline/#/",
        ),
        (
            "SERVER2_WORLD_VC_URL",
            "https://user@weather.example.test/timeline/",
        ),
        ("SERVER2_GEOCODER_KAKAO_DAILY_UNITS", "many"),
        ("SERVER2_WORLD_VERSIONS", "v000705"),
    ] {
        let mut changed = complete();
        changed.retain(|(k, _)| *k != name);
        changed.push((name, value.to_owned()));
        assert!(gateway(&vars(changed)).is_err(), "{name}={value}");
    }
    // Non-loopback HTTPS endpoints are configuration, not errors.
    let mut https = complete();
    https.extend([
        ("SERVER2_S3_ENDPOINT", "https://s3.example.test/".to_owned()),
        (
            "GEOCODER_KAKAO_BASE_URL",
            "https://geocode.example.test".to_owned(),
        ),
        (
            "SERVER2_WORLD_VC_URL",
            "https://weather.example.test/timeline/".to_owned(),
        ),
    ]);
    assert!(gateway(&vars(https)).unwrap().is_some());
}

/// S15b-3: `kma` reads the legacy AirKorea key list; a key needs its S08 daily units, and the
/// data.go.kr root follows the transport rule. No key: stored AirKorea records only.
#[test]
fn kma_airkorea_acquisition_settings_fail_closed() {
    use server2::gateway::runtime::from_vars as gateway;
    let base = || {
        vec![
            (
                "SERVER2_GATEWAY_LEGACY_URL",
                "http://127.0.0.1:9".to_owned(),
            ),
            ("SERVER2_NATIVE_FAMILIES", "kma".to_owned()),
            ("SERVER2_S3_BUCKET", "server2-kma".to_owned()),
            (
                "SERVER2_S3_ACCESS_KEY_ID",
                "configured-access-key".to_owned(),
            ),
            (
                "SERVER2_S3_SECRET_ACCESS_KEY",
                "configured-secret".to_owned(),
            ),
        ]
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
    assert!(gateway(&vars(keyed())).is_err(), "a key without units");
    let mut ok = keyed();
    ok.push(("SERVER2_AIRKOREA_DAILY_UNITS", "400".to_owned()));
    assert!(gateway(&vars(ok.clone())).unwrap().is_some());
    for (name, value) in [
        ("SERVER2_AIRKOREA_DAILY_UNITS", "0"),
        ("SERVER2_AIRKOREA_DAILY_UNITS", "many"),
        ("SERVER2_DATA_GO_KR_URL", "http://apis.example.test/"),
        ("SERVER2_DATA_GO_KR_URL", "https://apis.example.test/?q=1"),
    ] {
        let mut changed = ok.clone();
        changed.retain(|(k, _)| *k != name);
        changed.push((name, value.to_owned()));
        assert!(gateway(&vars(changed)).is_err(), "{name}={value}");
    }
    // A placeholder key list (legacy default `["key1", "key2"]`) is no key.
    let mut placeholder = base();
    placeholder.push(("AIRKOREA_SECRET_KEYS", r#"["key1", "key2"]"#.to_owned()));
    assert!(gateway(&vars(placeholder)).unwrap().is_some());
}

#[test]
fn real_world_configuration_builds_without_a_mode_variable() {
    let s3 = vec![
        ("SERVER2_NATIVE_FAMILIES", "dsf".to_owned()),
        ("SERVER2_S3_BUCKET", "server2-world".to_owned()),
        (
            "SERVER2_S3_ACCESS_KEY_ID",
            "configured-access-key".to_owned(),
        ),
        (
            "SERVER2_S3_SECRET_ACCESS_KEY",
            "configured-secret".to_owned(),
        ),
        ("SERVER2_WORLD_VC_DAILY_UNITS", "1000".to_owned()),
        ("SERVER2_WORLD_VC_QUOTA_ID", "ab".repeat(32)),
        ("VC_SECRET_KEY", "configured-vc-key".to_owned()),
        (
            "SERVER2_WORLD_AIR_WAQI_KEY",
            "configured-waqi-key".to_owned(),
        ),
        ("SERVER2_WORLD_AIR_WAQI_MONTHLY_UNITS", "100000".to_owned()),
        ("SERVER2_WORLD_AIR_WAQI_QUOTA_ID", "cd".repeat(32)),
    ];
    let configured = server2::world::runtime::from_vars(&vars(s3)).unwrap();
    let (_, versions) = configured.expect("native world configured");
    assert_eq!(versions.len(), 3);
}
