//! S12 seed importer: publishes a canonical seed file into the S3 bucket named by the
//! S3 settings of the server2 runtime (`SERVER2_S3_BUCKET`,
//! `SERVER2_S3_REGION`; `AWS_ACCESS_KEY`, `AWS_SECRET_KEY` from legacy, or the EC2 instance role
//! when both are unset) at the regional AWS endpoint, read from the process environment and `server2/.env` in the working directory.
//! Running it against a production bucket is a separately authorized operator action.
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
        eprintln!(
            "usage: warning_seed_import SEED_FILE (S3 from SERVER2_S3_BUCKET, SERVER2_S3_REGION; AWS_ACCESS_KEY, AWS_SECRET_KEY or the EC2 instance role)"
        );
        std::process::exit(2);
    }
    // The process environment, then `server2/.env` in the working directory (as server2).
    let env = match server2::dotenv::DotEnv::load(std::path::Path::new(server2::dotenv::FILE)) {
        Ok(env) => env,
        Err(e) => {
            eprintln!("warning_seed_import: {e}");
            std::process::exit(2);
        }
    };
    let transport =
        match S3Settings::from_vars(&|name: &str| env.var(name)).and_then(|s| s.transport()) {
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
