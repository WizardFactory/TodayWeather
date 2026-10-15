//! S14 history seed importer: publishes seed files written by `export_history_seeds.py` into
//! the S3 bucket named by the S3 settings of the server2 runtime (`SERVER2_S3_BUCKET`;
//! `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `TWA_S3_REGION` from legacy) at the regional AWS
//! endpoint, read from the process environment and `server2/.env` in the working directory.
//! Running it against a production bucket is a separately authorized operator action.
//!
//! Usage: history_seed_import SEED_FILE...
use server2::{
    history::legacy,
    storage::{CatalogLimits, CatalogStore, S3Settings},
};
use std::time::Duration;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "usage: history_seed_import SEED_FILE... (S3 from AWS_ACCESS_KEY, AWS_SECRET_KEY, TWA_S3_REGION, SERVER2_S3_BUCKET)"
        );
        std::process::exit(2);
    }
    // The process environment, then `server2/.env` in the working directory (as server2).
    let env = match server2::dotenv::DotEnv::load(std::path::Path::new(server2::dotenv::FILE)) {
        Ok(env) => env,
        Err(e) => {
            eprintln!("history_seed_import: {e}");
            std::process::exit(2);
        }
    };
    let transport =
        match S3Settings::from_vars(&|name: &str| env.var(name)).and_then(|s| s.transport()) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("history_seed_import: invalid S3 settings: {e}");
                std::process::exit(2);
            }
        };
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let store = CatalogStore::new(transport, limits).expect("catalog store");
    for path in &args[1..] {
        let seed = match std::fs::read(path)
            .map_err(|e| e.to_string())
            .and_then(|b| legacy::parse_seed(&b).map_err(|e| e.to_string()))
        {
            Ok(seed) => seed,
            Err(e) => {
                eprintln!("history_seed_import: {e}");
                std::process::exit(2);
            }
        };
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        match legacy::import(&store, &seed, deadline).await {
            Ok(r) => println!(
                "imported collection={} groups={} documents={}",
                seed.manifest.collection, r.groups, r.documents
            ),
            Err(e) => {
                eprintln!("history_seed_import: {e}");
                std::process::exit(1);
            }
        }
    }
}
