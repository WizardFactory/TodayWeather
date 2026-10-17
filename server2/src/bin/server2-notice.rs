//! Operator CLI. Run from server2/; mutations require explicit operator authorization.
use server2::observability::{
    self as obs, Action, Cause, Classify, Component, Details, Outcome, Stage,
};
use server2::{
    dotenv::{DotEnv, FILE},
    notice::{
        self,
        translate::{HttpTransport, Settings, Translator},
    },
    storage::S3Settings,
};
use std::{
    io::Read,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let root = obs::Context::root(obs::Route::Other, obs::Method::Other);
    let failed = root
        .scope(async {
            let result = run().await;
            if let Err(error) = &result {
                let (cause, outcome, status) = error.classify();
                obs::event(
                    Component::Notice,
                    Stage::Lifecycle,
                    cause,
                    Action::ReturnError,
                    outcome,
                    Details {
                        status,
                        ..Default::default()
                    },
                );
            }
            obs::flush(std::time::Duration::from_millis(50));
            result.is_err()
        })
        .await;
    if failed {
        std::process::exit(1);
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
    obs::init(&|name| env.var(name));
    obs::observe(Component::Notice, Stage::Lifecycle, async {
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
        let durable_operation_id = obs::DurableOperationId::notice(nonce);
        let operation = durable_operation_id.hex();
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
                if !output.warnings.is_empty() {
                    obs::event(
                        Component::Notice,
                        Stage::Translate,
                        Cause::Dependency,
                        Action::Fallback,
                        Outcome::Completed,
                        Details {
                            count: Some(output.warnings.len() as u64),
                            ..Default::default()
                        },
                    );
                }
                println!("{}", serde_json::to_string(&output.json)?);
                Ok(())
            }
            Err(error) => {
                if error == notice::Error::Uncertain {
                    obs::event(
                        Component::Notice,
                        Stage::Publish,
                        Cause::Ambiguous,
                        Action::InspectDurableState,
                        Outcome::Unknown,
                        Details {
                            durable_operation_id: Some(durable_operation_id),
                            ..Default::default()
                        },
                    );
                }
                Err(Box::new(error) as Box<dyn std::error::Error>)
            }
        }
    })
    .await
}
