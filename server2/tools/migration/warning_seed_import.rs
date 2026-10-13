//! S12 seed importer: publishes a canonical seed file into the S3 bucket named by the
//! `SERVER2_S3_*` settings (the same settings as the server2 runtime). The endpoint follows the
//! transport rule: HTTPS, or plain HTTP only to a loopback address. Running it against a
//! production bucket is a separately authorized operator action.
//!
//! Usage: warning_seed_import SEED_FILE
use server2::{
    storage::{CatalogLimits, S3Settings},
    warnings::{StoreConfig, WarningStore, seed},
};
use std::time::Duration;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: warning_seed_import SEED_FILE (S3 from SERVER2_S3_* settings)");
        std::process::exit(2);
    }
    let transport = match S3Settings::from_vars(&|name: &str| std::env::var(name).ok())
        .and_then(|s| s.transport())
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("warning_seed_import: invalid S3 settings: {e}");
            std::process::exit(2);
        }
    };
    let bytes = match std::fs::read(&args[1]) {
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
