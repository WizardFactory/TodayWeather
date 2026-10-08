use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    time::Duration,
};
struct Peer {
    child: Child,
    endpoint: String,
}
impl Peer {
    fn new() -> Self {
        let mut c = Command::new("python3")
            .arg("tools/benchmark/local_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let out = c.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut s = String::new();
            let result = BufReader::new(out).read_line(&mut s);
            let _ = tx.send(result.map(|_| s));
        });
        let endpoint = match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(s)) if s.starts_with("http://127.0.0.1:") => s.trim().into(),
            other => {
                let _ = c.kill();
                let _ = c.wait();
                panic!("local benchmark startup {other:?}")
            }
        };
        Self { child: c, endpoint }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn run(cases: serde_json::Value) -> serde_json::Value {
    let p = Peer::new();
    let path = std::env::temp_dir().join(format!(
        "server2-s09-wire-{}-{}.json",
        std::process::id(),
        p.child.id()
    ));
    std::fs::write(&path,serde_json::to_vec(&serde_json::json!({"schema":1,"run_id":"wire","s3_endpoint":p.endpoint,"provider_endpoint":p.endpoint,"cases":cases})).unwrap()).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_server2-feasibility"))
        .args(["--config", path.to_str().unwrap()])
        .output()
        .unwrap();
    std::fs::remove_file(path).unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}
fn case(name: &str, mode: &str) -> serde_json::Value {
    serde_json::json!({"name":name,"workload":"revisions","mode":mode,"selection":"latest","clients":1,"owners":4,"trials":1,"revisions":1,"record_bytes":128})
}
fn count(v: &serde_json::Value, key: &str) -> u64 {
    v["requests"][key].as_u64().unwrap_or(0)
}
#[test]
fn cli_emits_gate_boundary_and_complete_report() {
    let out = Command::new(env!("CARGO_BIN_EXE_server2-feasibility"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(out.status.success());
    assert!(
        String::from_utf8(out.stdout)
            .unwrap()
            .contains("local-only")
    );
}
#[test]
fn actual_http_cold_and_idle_warm() {
    let mut cold = case("cold", "cold");
    cold["revisions"] = 2.into();
    let r = run(serde_json::json!([cold, case("warm", "warm")]));
    assert_eq!(
        r["gate_status"],
        "requires_intended_host_and_same_region_measurements"
    );
    assert_eq!(r["api_parity_verified"], false);
    for c in r["cases"].as_array().unwrap() {
        assert_eq!(c["summary"]["outcomes"]["success"], 1);
    }
    let seeded = &r["cases"][0]["trials"][0]["wire_after_seed"];
    assert!(
        seeded["catalog_version_bytes"].as_u64().unwrap()
            > seeded["catalog_current_bytes"].as_u64().unwrap()
    );
    let t = &r["cases"][1]["trials"][0];
    assert_eq!(
        t["wire_before"]["requests"],
        t["wire_after_maintenance"]["requests"]
    );
    assert_eq!(t["resolver_after_maintenance"]["hits"], 1);
    assert_eq!(
        t["parse_calls"], 0,
        "idle warm foreground must not include prewarm parsing"
    );
    assert_eq!(t["assembly_calls"], 0);
    let measured = &r["client_http_measurements"]["operations"]["GET:catalog"];
    assert!(measured["calls"].as_u64().unwrap() > 0);
    assert_eq!(measured["complete"], true);
    assert!(
        measured["samples"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["received_status"] == 200)
    );
    assert_eq!(
        measured["retained_client_elapsed"]["count"],
        measured["retained_samples"]
    );
}
#[test]
fn funded_data_only_archive_and_fresh_restore() {
    let r = run(serde_json::json!([
        case("data", "provider_data"),
        case("none", "provider_nodata"),
        case("denied", "provider_denied"),
        case("error", "provider_error")
    ]));
    let a = r["cases"].as_array().unwrap();
    assert_eq!(a[0]["summary"]["outcomes"]["success"], 1);
    assert_eq!(a[0]["trials"][0]["acquirer_data"], 1);
    assert_eq!(a[0]["trials"][0]["fresh_s3_only_checks"], 1);
    for c in &a[1..] {
        let t = &c["trials"][0];
        assert_eq!(c["summary"]["outcomes"]["acquisition_denied"], 1);
        for key in ["PUT:raw", "PUT:group", "PUT:catalog"] {
            assert_eq!(
                count(&t["wire_before"], key),
                count(&t["wire_after_maintenance"], key),
                "weather archive on terminal: {key}"
            );
        }
    }
    let d = &a[2]["trials"][0];
    assert_eq!(
        count(&d["wire_before"], "PROVIDER:provider"),
        count(&d["wire_after_maintenance"], "PROVIDER:provider")
    );
    assert_eq!(a[1]["trials"][0]["acquirer_nodata"], 1);
    assert_eq!(a[2]["trials"][0]["acquirer_denied"], 1);
    assert_eq!(a[3]["trials"][0]["acquirer_terminal"], 1);
}
#[test]
fn orphan_sibling_recovery_preserves_exact_complete_group() {
    let mut c = case("orphan", "cold");
    c["siblings"] = 2.into();
    c["layout"] = "orphan".into();
    let r = run(serde_json::json!([c]));
    assert_eq!(r["cases"][0]["catalogs_per_key"], 2);
    assert_eq!(r["cases"][0]["summary"]["outcomes"]["success"], 1);
    assert!(
        count(
            &r["cases"][0]["trials"][0]["wire_foreground_end"],
            "LIST:catalog"
        ) > 0
    );
}

#[test]
fn history_uses_real_days_and_sixteen_scopes() {
    let mut c = case("history", "cold");
    c["workload"] = "history8".into();
    c["selection"] = "full_history".into();
    let r = run(serde_json::json!([c]));
    let c = &r["cases"][0];
    assert_eq!(c["distinct_period_identities_per_key"], 192);
    assert_eq!(c["groups_per_key"], 192);
    assert_eq!(c["catalogs_per_key"], 8);
    assert_eq!(c["resolutions_per_client"], 16);
    assert_eq!(c["samples"][0]["components"].as_array().unwrap().len(), 16);
    assert_eq!(c["summary"]["samples"], 1);
    assert_eq!(c["workload_label"], "synthetic_16_resolution_8_day_batch");
}
#[test]
fn offered_pressure_does_not_raise_owner_admission_or_drop_failures() {
    let mut c = case("pressure", "cold");
    c["clients"] = 8.into();
    c["owners"] = 1.into();
    let r = run(serde_json::json!([c]));
    let c = &r["cases"][0];
    assert_eq!(c["summary"]["samples"], 8);
    assert!(c["summary"]["outcomes"]["capacity"].as_u64().unwrap_or(0) > 0);
    assert_eq!(c["summary"]["all_requests"]["count"], 8);
}
