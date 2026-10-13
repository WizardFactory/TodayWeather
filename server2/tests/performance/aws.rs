use std::process::Command;
#[test]
fn inert_aws_config_validates_without_execution_or_discovery() {
    let out = Command::new(env!("CARGO_BIN_EXE_server2-feasibility"))
        .args(["--validate-aws-config", "config/benchmarks/aws.json"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "inert static validation must succeed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["configuration_valid"], true);
    assert_eq!(report["execution"], false);
    assert_eq!(report["metadata_requests"], 0);
    assert_eq!(report["S3_requests"], 0);
}

#[test]
fn explicit_local_worker_rejects_remote_and_mixed_live_flags_before_discovery() {
    let binary = env!("CARGO_BIN_EXE_server2-feasibility");
    for args in [
        vec![
            "--local-approved-worker",
            "config/benchmarks/aws.json",
            "--run-manifest",
            "not-read.json",
            "--loopback-s3",
            "https://s3.ap-northeast-2.amazonaws.com/",
        ],
        vec![
            "--local-approved-worker",
            "config/benchmarks/aws.json",
            "--run-manifest",
            "not-read.json",
            "--loopback-s3",
            "http://127.0.0.1:1/",
            "--execute-approved-run",
        ],
    ] {
        let out = Command::new(binary).args(args).output().unwrap();
        assert!(!out.status.success());
        let stderr = String::from_utf8(out.stderr).unwrap();
        assert!(stderr.contains("literal loopback") || stderr.contains("usage"));
    }
    let live = Command::new(binary)
        .args([
            "--aws-config",
            "config/benchmarks/aws.json",
            "--run-manifest",
            "not-read.json",
            "--execute-approved-run",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    assert!(!live.status.success());
    assert!(
        String::from_utf8(live.stderr)
            .unwrap()
            .contains("private manifest location")
    );
}
