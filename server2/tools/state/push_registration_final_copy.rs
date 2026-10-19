//! Explicit operator final copy. Preview/verify read S3; apply/settle can write S3 and require
//! separately scoped authority. No Mongo connection, sender start/stop or freeze is performed.
use server2::{
    push::{
        durable::{Counters, Durable, DurableConfig},
        final_copy::{self, Bundle, Operation},
    },
    storage::S3Settings,
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::Arc,
};

fn read_private(path: &str, max: u64) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    let meta = fs::symlink_metadata(p).map_err(|_| "input metadata")?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > max {
        return Err("input type or size".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("private input must be owner-only".into());
        }
    }
    let mut data = Vec::new();
    fs::File::open(p)
        .map_err(|_| "input open")?
        .take(max + 1)
        .read_to_end(&mut data)
        .map_err(|_| "input read")?;
    if data.len() as u64 > max {
        return Err("input size".into());
    }
    Ok(data)
}
fn write_private(path: &str, body: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "new owner-only operation output required")?;
    file.write_all(body)
        .and_then(|_| file.sync_all())
        .map_err(|_| "operation output write".to_string())?;
    // The write-ahead custody entry must survive a directory-entry crash before any PUT.
    fs::File::open(
        Path::new(path)
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
    )
    .and_then(|directory| directory.sync_all())
    .map_err(|_| "operation directory sync".to_string())
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = execute(std::env::args().collect(), None).await {
        eprintln!("BLOCKED final-copy: {error}");
        std::process::exit(2);
    }
}
pub async fn execute(args: Vec<String>, injected: Option<S3Settings>) -> Result<(), String> {
    if args.len() != 4 || !matches!(args[1].as_str(), "preview" | "apply" | "verify" | "settle") {
        return Err("usage: push_registration_final_copy preview|apply|verify|settle BUNDLE OPERATION (private files; no live authority implied)".into());
    }
    // Parse private bounded inputs before creating the real S3 transport.
    let bundle = Bundle::parse(&read_private(&args[2], final_copy::MAX_BUNDLE as u64)?)
        .map_err(|e| e.to_string())?;
    let operation = if args[1] != "preview" {
        Some(
            Operation::parse(&read_private(
                &args[3],
                (final_copy::MAX_BUNDLE * 4) as u64,
            )?)
            .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    if let Some(op) = &operation {
        if bundle.digest().map_err(|e| e.to_string())? != op.bundle_digest {
            return Err("operation bundle mismatch".into());
        }
        if op.encoded.len() > DurableConfig::default().entry_bytes {
            return Err("entry size".into());
        }
    }
    let settings = match injected {
        Some(settings) => settings,
        None => {
            let env = server2::dotenv::DotEnv::load(Path::new(server2::dotenv::FILE))
                .map_err(|_| "dotenv settings")?;
            S3Settings::from_vars(&|key| env.var(key)).map_err(|_| "S3 settings")?
        }
    };
    if settings.bucket != bundle.target.bucket || settings.region != bundle.target.region {
        return Err("target bucket or region mismatch".into());
    }
    let transport = settings.transport().map_err(|_| "S3 transport")?;
    let mut durable = Durable::new(
        Arc::new(transport),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    if args[1] == "preview" {
        if fs::symlink_metadata(&args[3]).is_ok() {
            return Err("new operation output required".into());
        }
        let plan = final_copy::preview(&mut durable, &bundle)
            .await
            .map_err(|e| e.to_string())?;
        let op = Operation::prepare(&plan).map_err(|e| e.to_string())?;
        if op.encoded.len() > durable.config.entry_bytes {
            return Err("entry size".into());
        }
        write_private(
            &args[3],
            &serde_json::to_vec(&op).map_err(|_| "operation encoding")?,
        )?;
        println!(
            "{}",
            serde_json::json!({"status":"PREVIEW","plan_digest":op.mark.plan,"generation":op.mark.generation,"journal_seq":op.mark.seq,"counts":plan.counts,"operational_freeze_verified":false,"production_eligible":false})
        );
    } else {
        let op = operation.as_ref().ok_or("operation required")?;
        let attempt_path = format!("{}.attempt.json", args[3]);
        let attempt=serde_json::to_vec(&serde_json::json!({"schema":1,"plan_digest":op.mark.plan,"entry_sha256":server2::storage::sha256(&op.encoded),"operation_sha256":server2::storage::sha256(&serde_json::to_vec(op).map_err(|_|"operation encoding")?)})).map_err(|_|"attempt encoding")?;
        let result = match args[1].as_str() {
            "apply" => {
                if fs::symlink_metadata(&attempt_path).is_ok() {
                    // Existing/unreadable/partial custody never authorizes another original PUT.
                    let valid=read_private(&attempt_path,4096).is_ok_and(|bytes|bytes==attempt);
                    let observed=final_copy::status(&mut durable,op).await;
                    match observed {
                        Ok(receipt) if receipt.status=="ALREADY_COMMITTED"=>Ok(receipt),
                        Ok(receipt) if valid=>Ok(receipt),
                        _=>{println!("{{\"status\":\"SETTLEMENT_REQUIRED\",\"production_eligible\":false}}");std::process::exit(1);}
                    }
                } else {
                    // Compare the exact prepared plan before persisting first-attempt custody.
                    let planned=final_copy::preview(&mut durable,&bundle).await.map_err(|e|e.to_string())?;
                    op.matches(&planned).map_err(|e|e.to_string())?;
                    if write_private(&attempt_path,&attempt).is_err() {
                        println!("{{\"status\":\"SETTLEMENT_REQUIRED\",\"production_eligible\":false}}");
                        std::process::exit(1);
                    }
                    final_copy::apply(&mut durable, &bundle, op).await
                }
            },
            "verify" => final_copy::verify(&mut durable, op).await,
            "settle" => final_copy::settle(&mut durable, op).await,
            _ => unreachable!(),
        }
        .map_err(|e| e.to_string())?;
        println!(
            "{}",
            serde_json::to_string(&result).map_err(|_| "receipt encoding")?
        );
        if !matches!(
            result.status,
            "COMMITTED" | "VERIFIED" | "ALREADY_COMMITTED"
        ) {
            std::process::exit(1);
        }
    }
    Ok(())
}
