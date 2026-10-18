use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static NEXT: AtomicU64 = AtomicU64::new(0);
const FAMILIES: [&str; 8] = [
    "geocode",
    "dsf",
    "kma",
    "kma-v000901",
    "kma-v000902",
    "town",
    "push",
    "notice",
];

fn coverage(families: Option<&str>, versions: Option<&str>, legacy: Option<&str>) -> bool {
    server2::startup::validate_native_coverage(&|name| {
        match name {
            "SERVER2_NATIVE_FAMILIES" => families,
            "SERVER2_WORLD_VERSIONS" => versions,
            "SERVER2_GATEWAY_LEGACY_URL" => legacy,
            other => panic!("coverage must not read provider/storage/account setting: {other}"),
        }
        .map(str::to_owned)
    })
    .is_ok()
}

#[test]
fn native_only_requires_every_accepted_family() {
    assert!(!coverage(None, None, None));
    assert!(!coverage(Some(""), None, None));
    for absent in FAMILIES {
        let selected = FAMILIES
            .into_iter()
            .filter(|family| *family != absent)
            .collect::<Vec<_>>()
            .join(",");
        assert!(!coverage(Some(&selected), None, None), "missing {absent}");
    }
    let all = FAMILIES.join(",");
    assert!(coverage(Some(&all), None, None));
    assert!(!coverage(None, None, Some("  ")));
}

#[test]
fn world_versions_preserve_defaults_syntax_and_complete_duplicate_lists() {
    let all = FAMILIES.join(",");
    for versions in [
        "v000902,v000903",
        "v000901,v000903",
        "v000901,v000902",
        "invalid",
        "v000901,,v000902,v000903",
    ] {
        assert!(!coverage(Some(&all), Some(versions), None), "{versions}");
    }
    // Existing set() treats empty as unset; do not add stricter parser behavior.
    for versions in [
        "",
        "v000901,v000902,v000903",
        " v000903 , v000901 , v000902 ",
        "v000901,v000902,v000903,v000901",
    ] {
        assert!(coverage(Some(&all), Some(versions), None), "{versions}");
    }
}

#[test]
fn explicit_coexistence_keeps_partial_factories_and_existing_validation() {
    assert!(coverage(None, None, Some("http://127.0.0.1:9")));
    assert!(coverage(Some("notice"), None, Some("http://127.0.0.1:9")));
    // The existing factory retains origin/world validation; the coverage guard does not probe.
    assert!(coverage(
        Some("dsf"),
        Some("invalid"),
        Some("http://127.0.0.1:9")
    ));
    for invalid in ["unknown", "notice,notice"] {
        assert!(!coverage(Some(invalid), None, Some("http://127.0.0.1:9")));
    }
    assert_eq!(
        server2::gateway::runtime::NativeFamilies::from_vars(&|_| None).unwrap(),
        server2::gateway::runtime::NativeFamilies::default()
    );
}

#[test]
fn production_main_rejects_unserved_configuration_without_dotenv() {
    let cwd = std::env::temp_dir().join(format!(
        "server2-startup-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&cwd).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_server2"))
        .env_clear()
        .env("PORT", "0")
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    let exited = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= until {
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    // Reap the accepted baseline before asserting the intended regression.
    if exited.is_none() {
        child.kill().unwrap();
    }
    let output = child.wait_with_output().unwrap();
    std::fs::remove_dir(&cwd).unwrap();
    assert!(
        exited.is_some_and(|status| !status.success()),
        "unserved configuration must fail before listeners; stdout={}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(
        !String::from_utf8_lossy(&output.stdout).contains("server2 public="),
        "invalid configuration bound a listener"
    );
}
