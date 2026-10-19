/// A service-account file for `project` with the RFC 7515 A.2 example key (public test vector,
/// not a credential), in a temporary directory.
pub fn account_file(dir: &std::path::Path, product: &str, project: &str) -> std::path::PathBuf {
    let der = include_str!("../delivery/fixtures/rfc7515-a2-key.pkcs8.b64").trim();
    let mut pem = String::from("-----BEGIN PRIVATE KEY-----\n");
    for chunk in der.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap());
        pem.push('\n');
    }
    pem.push_str("-----END PRIVATE KEY-----\n");
    let json = serde_json::json!({"type": "service_account", "project_id": project, "private_key_id": "oracle",
        "private_key": pem, "client_email": format!("oracle@{project}.iam.gserviceaccount.com")});
    let path = dir.join(format!("fcm-test-{product}.json"));
    std::fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    path
}
