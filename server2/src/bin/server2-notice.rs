//! Operator CLI. Run from server2/; mutations require explicit operator authorization.
use server2::{
    dotenv::{DotEnv, FILE},
    notice::{
        self,
        translate::{HttpTransport, Settings, Translator},
    },
    storage::S3Settings,
};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("server2-notice: {error}");
        std::process::exit(1)
    }
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args[0] == "--help" {
        println!(
            "server2-notice add|update ID|withdraw ID|list|show ID|latest [LANG]|translate ID (add/update JSON on stdin)"
        );
        return Ok(());
    }
    let env = DotEnv::load(Path::new(FILE))
        .map_err(|_| notice::Error::Invalid("server2 dotenv unavailable"))?;
    let s3 = S3Settings::from_vars(&|k| env.var(k))
        .and_then(|s| s.transport())
        .map_err(|_| notice::Error::Invalid("notice S3 settings"))?;
    let store = notice::store::NoticeStore::new(s3);
    let translator = Translator::new(
        Settings::from_lookup(|k| env.var(k))?,
        HttpTransport::new()?,
    );
    let mut bytes = Vec::new();
    if matches!(args[0].as_str(), "add" | "update") {
        std::io::stdin()
            .take(128 * 1024 + 1)
            .read_to_end(&mut bytes)?;
    }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let operation = format!(
        "{:x}",
        Sha256::digest(format!("notice-cli:{nonce}:{}", std::process::id()))
    );
    let result = notice::cli::execute(
        &store,
        &translator,
        &args,
        &bytes,
        notice::api::now_millis(),
        &operation,
    )
    .await;
    match result {
        Ok(output) => {
            for warning in output.warnings {
                eprintln!("{warning}")
            }
            println!("{}", serde_json::to_string(&output.json)?);
            Ok(())
        }
        Err(error) => {
            if error == notice::Error::Uncertain {
                eprintln!(
                    "notice operation outcome uncertain: {operation}; inspect durable state before repeating"
                );
            }
            Err(Box::new(error))
        }
    }
}
