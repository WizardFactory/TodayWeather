//! Local-only S14 history seed importer: publishes seed files written by
//! `export_history_seeds.py` into a loopback S3-compatible peer with its documented dummy
//! credentials. Never a production tool; production import needs separate authority.
//!
//! Usage: history_seed_import http://127.0.0.1:PORT/ SEED_FILE...
use server2::{
    history::legacy,
    storage::{CatalogLimits, CatalogStore, HttpS3Transport},
};
use std::time::Duration;

fn loopback(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint).is_ok_and(|u| {
        u.scheme() == "http"
            && u.username().is_empty()
            && u.password().is_none()
            && u.host_str()
                .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
                .is_some_and(|ip| ip.is_loopback())
    })
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: history_seed_import LOOPBACK_S3_ENDPOINT SEED_FILE...");
        std::process::exit(2);
    }
    if !loopback(&args[1]) {
        eprintln!("history_seed_import: refusing a non-loopback endpoint");
        std::process::exit(2);
    }
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
    let store = CatalogStore::new(transport, limits).expect("catalog store");
    for path in &args[2..] {
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
