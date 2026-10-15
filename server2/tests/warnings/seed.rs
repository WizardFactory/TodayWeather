//! Legacy seed export (offline converter) and import with the shared S3 settings.
use super::common::*;
use server2::{gateway::OrderedJson, warnings::seed};
use std::process::Command;

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("server2-s12-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
#[tokio::test]
async fn mongoexport_files_convert_and_import_as_served_seeds() {
    let dir = temp_dir("seed");
    // Canonical and relaxed Extended JSON, one document per line, as mongoexport writes.
    let special = [
        r#"{"_id":{"$oid":"66f0000000000000000000a1"},"announcement":{"$date":"2026-09-20T09:10:00Z"},"type":{"$numberInt":"2"},"situationList":[{"weather":0,"weatherStr":"없음","level":0,"levelStr":"","info":[],"_id":{"$oid":"66f0000000000000000000a2"}}],"comment":"<예비특보> o 당초","__v":0}"#,
        r#"{"_id":{"$oid":"66f0000000000000000000b1"},"announcement":{"$date":{"$numberLong":"1789895400000"}},"type":3,"comment":"기상정보 본문"}"#,
        r#"{"announcement":{"$date":"2026-09-20T09:10:00.000Z"},"type":1,"situationList":[],"comment":"o 없음"}"#,
    ]
    .join("\n");
    let zones = r#"[{"_id":{"$oid":"66f0000000000000000000c1"},"areaCode":"L1100100","areaName":"label","warnVar":3,"warnStress":1,"active":true,"command":"1","eventTmFc":{"$numberDouble":"202609240900.0"},"eventTmSeq":7,"eventRank":1,"__v":0},{"areaCode":"_sync","warnVar":-1,"lastSyncAt":{"$date":"2026-09-24T00:00:00.000Z"}}]"#;
    std::fs::write(dir.join("special.json"), special).unwrap();
    std::fs::write(dir.join("zones.json"), zones).unwrap();
    let output = dir.join("seed.json");
    let status = Command::new("python3")
        .arg("tools/migration/export_warning_seeds.py")
        .args(["--special", dir.join("special.json").to_str().unwrap()])
        .args(["--zones", dir.join("zones.json").to_str().unwrap()])
        .args(["--exported-at", "2026-10-12T00:00:00Z"])
        .args(["--output", output.to_str().unwrap()])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status()
        .unwrap();
    assert!(status.success());
    let bytes = std::fs::read(&output).unwrap();
    let parsed = seed::parse(&bytes).unwrap();
    assert_eq!(parsed.special.len(), 3);
    assert_eq!(parsed.exported_at_ms, ms("2026-10-12T00:00:00.000Z") as u64);
    let first = OrderedJson::parse(&parsed.special[0].2).unwrap();
    assert_eq!(
        String::from_utf8(first.to_bytes()).unwrap(),
        r#"{"announcement":"2026-09-20T09:10:00.000Z","type":2,"situationList":[{"weather":0,"weatherStr":"없음","level":0,"levelStr":"","info":[]}],"comment":"<예비특보> o 당초"}"#,
        "exported key order preserved, ids removed"
    );
    assert_eq!(parsed.special[1].1, 20260920);
    assert!(
        String::from_utf8(parsed.zones.as_deref().unwrap().to_vec())
            .unwrap()
            .contains(r#""eventTmFc":202609240900,"#)
    );

    let peer = Peer::new();
    let store = peer.store();
    assert_eq!(seed::import(&store, &parsed, deadline()).await.unwrap(), 4);
    // Idempotent re-import of the same snapshot.
    assert_eq!(seed::import(&store, &parsed, deadline()).await.unwrap(), 4);
    let service = peer.service(FixedClock::at("2026-10-04T00:10:00.000Z"));
    let list = service.special(true).await.unwrap();
    let OrderedJson::Array(a) = &list else {
        panic!()
    };
    assert_eq!(a.len(), 3);
    assert_eq!(
        String::from_utf8(a[1].to_bytes()).unwrap(),
        r#"{"announcement":"2026-09-20T00:10:00.000Z","type":2,"situationList":[{"weather":0,"weatherStr":"없음","level":0,"levelStr":"","info":[]}],"comment":"<예비특보> \n\no 당초","name":"예비특보"}"#
    );
    let town = server2::warnings::Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: String::new(),
    };
    assert_eq!(service.special_info(&town).await.unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}
#[test]
fn converter_rejects_invalid_documents_without_output() {
    let dir = temp_dir("invalid");
    std::fs::write(
        dir.join("bad.json"),
        r#"[{"type":7,"announcement":{"$date":"2026-09-20T09:10:00Z"}}]"#,
    )
    .unwrap();
    let output = dir.join("out.json");
    let status = Command::new("python3")
        .arg("tools/migration/export_warning_seeds.py")
        .args(["--special", dir.join("bad.json").to_str().unwrap()])
        .args(["--exported-at", "2026-10-12T00:00:00Z"])
        .args(["--output", output.to_str().unwrap()])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(2));
    assert!(!output.exists());
    let _ = std::fs::remove_dir_all(dir);
}
#[test]
fn importer_settings_follow_the_transport_rule_and_seed_files_are_validated() {
    use server2::storage::S3Settings;
    // S10e: the legacy `server/.env` names; the endpoint is not a setting.
    let settings = |region: Option<&'static str>| {
        move |name: &str| match name {
            "TWA_S3_REGION" => region.map(str::to_owned),
            "SERVER2_S3_BUCKET" => Some("server2-seeds".to_owned()),
            "AWS_ACCESS_KEY" => Some("configured-access-key".to_owned()),
            "AWS_SECRET_KEY" => Some("configured-secret".to_owned()),
            // Removed server2-only names are not read.
            "SERVER2_S3_ENDPOINT" => Some("http://10.0.0.5:9000/".to_owned()),
            _ => None,
        }
    };
    // The regional AWS endpoint of `TWA_S3_REGION` (default ap-northeast-2) is built in.
    let default = S3Settings::from_vars(&settings(None)).unwrap();
    assert_eq!(default.endpoint, "https://s3.ap-northeast-2.amazonaws.com/");
    assert_eq!(default.bucket, "server2-seeds");
    let region = S3Settings::from_vars(&settings(Some("us-east-1"))).unwrap();
    assert_eq!(region.endpoint, "https://s3.us-east-1.amazonaws.com/");
    // Tests choose another endpoint through the test builder: any HTTPS or loopback HTTP one.
    for endpoint in [
        "https://s3.ap-northeast-2.amazonaws.com/",
        "https://s3.example.test/",
        "http://127.0.0.1:9000/",
        "http://[::1]:9000/",
    ] {
        assert!(
            S3Settings::from_vars_at(&settings(None), Some(endpoint)).is_ok(),
            "{endpoint}"
        );
    }
    for endpoint in [
        "http://10.0.0.5:9000/",
        "http://localhost.example.com/",
        "http://user:pass@127.0.0.1:9000/",
        "https://s3.example.test/prefix/",
        "not a url",
    ] {
        assert!(
            S3Settings::from_vars_at(&settings(None), Some(endpoint)).is_err(),
            "{endpoint}"
        );
    }
    for missing in ["SERVER2_S3_BUCKET", "AWS_ACCESS_KEY", "AWS_SECRET_KEY"] {
        let partial = |name: &str| (name != missing).then(|| settings(None)(name)).flatten();
        assert!(S3Settings::from_vars(&partial).is_err(), "{missing}");
    }
    assert!(seed::parse(br#"{"schema":2,"exportedAt":"2026-10-12T00:00:00.000Z"}"#).is_err());
    assert!(seed::parse(br#"{"schema":1,"exportedAt":"2026-10-12T00:00:00.000Z","special":[{"type":5,"announcement":"2026-09-20T09:10:00.000Z"}]}"#).is_err());
    assert!(
        seed::parse(
            br#"{"schema":1,"exportedAt":"2026-10-12T00:00:00.000Z","special":[{"type":2}]}"#
        )
        .is_err()
    );
}
