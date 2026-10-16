//! S18a importer for the one-time copy of legacy push registrations: merges a canonical import
//! file (`push_registration_convert` output) into the server2 push state in the S3 bucket named
//! by the server2 S3 settings (`SERVER2_S3_BUCKET`, `SERVER2_S3_REGION`; `AWS_ACCESS_KEY`,
//! `AWS_SECRET_KEY` from legacy, or the EC2 instance role when both are unset) at the regional
//! AWS endpoint, read from the process environment and `server2/.env` in the working directory.
//! Records merge by `_id`; re-running with the same file changes nothing. Running it against a
//! production bucket is a separately authorized operator action (#2705).
//!
//! Usage: push_registration_import IMPORT_FILE
use server2::{
    push::{
        durable::{Counters, Durable, DurableConfig},
        migrate,
    },
    storage::S3Settings,
};
use std::sync::Arc;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!(
            "usage: push_registration_import IMPORT_FILE (S3 from SERVER2_S3_BUCKET, SERVER2_S3_REGION; AWS_ACCESS_KEY, AWS_SECRET_KEY or the EC2 instance role)"
        );
        std::process::exit(2);
    }
    let env = match server2::dotenv::DotEnv::load(std::path::Path::new(server2::dotenv::FILE)) {
        Ok(env) => env,
        Err(e) => {
            eprintln!("push_registration_import: {e}");
            std::process::exit(2);
        }
    };
    let transport =
        match S3Settings::from_vars(&|name: &str| env.var(name)).and_then(|s| s.transport()) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("push_registration_import: invalid S3 settings: {e}");
                std::process::exit(2);
            }
        };
    let records = match std::fs::read(&args[1])
        .map_err(|e| e.to_string())
        .and_then(|b| migrate::parse_import(&b))
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("push_registration_import: {e}");
            std::process::exit(2);
        }
    };
    let mut durable = Durable::new(
        Arc::new(transport),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    match migrate::import(&mut durable, &records).await {
        Ok(c) => println!(
            "records={} inserted={} updated={} unchanged={} kept={} deleted={}",
            records.len(),
            c.inserted,
            c.updated,
            c.unchanged,
            c.kept,
            c.deleted
        ),
        Err(e) => {
            eprintln!("push_registration_import: {e}");
            std::process::exit(1);
        }
    }
}
