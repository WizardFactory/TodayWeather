//! Local-only S12 seed importer: publishes a canonical seed file into a loopback
//! S3-compatible peer with its documented dummy credentials. Never a production tool.
//!
//! Usage: warning_seed_import http://127.0.0.1:PORT/ SEED_FILE
use server2::{
    storage::{CatalogLimits, HttpS3Transport},
    warnings::{StoreConfig, WarningStore, seed},
};
use std::time::Duration;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: warning_seed_import LOOPBACK_S3_ENDPOINT SEED_FILE");
        std::process::exit(2);
    }
    if !seed::loopback_endpoint(&args[1]) {
        eprintln!("warning_seed_import: refusing a non-loopback endpoint");
        std::process::exit(2);
    }
    let bytes = match std::fs::read(&args[2]) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("warning_seed_import: cannot read seed file: {e}");
            std::process::exit(2);
        }
    };
    let parsed = match seed::parse(&bytes) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("warning_seed_import: {e}");
            std::process::exit(2);
        }
    };
    let transport = HttpS3Transport::new(
        &args[1],
        "server2-local",
        "ap-northeast-2",
        rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
    )
    .expect("loopback transport");
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let store = WarningStore::new(transport, limits, StoreConfig::default()).expect("store");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    match seed::import(&store, &parsed, deadline).await {
        Ok(n) => println!("imported seed acquisitions={n}"),
        Err(e) => {
            eprintln!("warning_seed_import: {e}");
            std::process::exit(1);
        }
    }
}
