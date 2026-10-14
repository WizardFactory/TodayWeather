//! S15b-2 station registry seed importer: publishes a seed file written by
//! `export_station_seeds.py` (legacy `kmastninfos`) as one raw record into the S3 bucket named by
//! the `SERVER2_S3_*` settings (the same settings as the server2 runtime). The endpoint follows
//! the transport rule: HTTPS, or plain HTTP only to a loopback address. Running it against a
//! production bucket is a separately authorized operator action.
//!
//! Usage: station_seed_import SEED_FILE
use server2::{
    domestic::kma::source::seed,
    storage::{CatalogLimits, CatalogStore, S3Settings},
};
use std::time::Duration;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: station_seed_import SEED_FILE (S3 from SERVER2_S3_* settings)");
        std::process::exit(2);
    }
    let transport = match S3Settings::from_vars(&|name: &str| std::env::var(name).ok())
        .and_then(|s| s.transport())
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("station_seed_import: invalid S3 settings: {e}");
            std::process::exit(2);
        }
    };
    let bytes = match std::fs::read(&args[1]) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("station_seed_import: {e}");
            std::process::exit(2);
        }
    };
    let (parsed, acquisition) =
        match seed::parse(&bytes).and_then(|p| Ok((p, seed::acquisition(&bytes)?))) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("station_seed_import: {e}");
                std::process::exit(2);
            }
        };
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let store = CatalogStore::new(transport, limits).expect("catalog store");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    match store
        .publish(acquisition.declaration, acquisition.records, deadline)
        .await
    {
        Ok(_) => println!("imported kmastninfos documents={}", parsed.docs.len()),
        Err(e) => {
            eprintln!("station_seed_import: {e}");
            std::process::exit(1);
        }
    }
}
