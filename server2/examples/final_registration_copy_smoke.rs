//! Owned-peer launcher for the actual CLI execute path; no production environment override.
#[allow(dead_code)]
#[path = "../tools/state/push_registration_final_copy.rs"]
mod cli;
use server2::{
    push::{
        self, Coll,
        durable::{Counters, Durable, DurableConfig},
        final_copy::Bundle,
        store::Change,
    },
    storage::{CatalogTransport, S3Settings, WriteCondition},
    world::js::Obj,
};
use std::{collections::BTreeMap, sync::Arc};

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("owned final-copy: {error}");
        std::process::exit(2);
    }
}
async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 5 {
        return Err("owned launcher ROOT COMMAND BUNDLE OPERATION".into());
    }
    let endpoint: reqwest::Url = args[1].parse().map_err(|_| "loopback URL")?;
    if endpoint.scheme() != "http"
        || endpoint.host_str() != Some("127.0.0.1")
        || endpoint.port().is_none()
        || endpoint.path() != "/"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("literal loopback root required".into());
    }
    let vars = BTreeMap::from([
        ("SERVER2_S3_BUCKET", "server2-local"),
        ("SERVER2_S3_REGION", "ap-northeast-2"),
        ("AWS_ACCESS_KEY", "server2-local"),
        ("AWS_SECRET_KEY", "server2-local-secret"),
    ]);
    let settings = S3Settings::from_vars_at(
        &|k| vars.get(k).map(|v| (*v).to_owned()),
        Some(endpoint.as_str()),
    )
    .map_err(|_| "synthetic S3 settings")?;
    if args[2] == "seed" {
        let bundle = Bundle::parse(&std::fs::read(&args[3]).map_err(|_| "synthetic bundle")?)
            .map_err(|e| e.to_string())?;
        let mut canonical = String::new();
        let mut report = push::migrate::Report::default();
        for input in &bundle.baseline.collections {
            push::migrate::convert(
                Coll::parse(&input.collection).ok_or("collection")?,
                input.raw.as_bytes(),
                &mut canonical,
                &mut report,
            );
        }
        let records =
            push::migrate::parse_import(canonical.as_bytes()).map_err(|_| "canonical records")?;
        let transport = Arc::new(settings.transport().map_err(|_| "owned transport")?);
        let mut d = Durable::new(
            transport.clone(),
            DurableConfig::default(),
            Arc::new(Counters::default()),
        );
        push::migrate::import(&mut d, &records)
            .await
            .map_err(|e| e.to_string())?;
        let state = d.restore().await.map_err(|e| e.to_string())?;
        let mut doc = Obj::new();
        doc.set("fcmToken", "synthetic-native-only");
        doc.set("cityIndex", 9.);
        let record = push::Record { oid: [9; 12], doc };
        let change = Change {
            coll: Coll::Alarm,
            n: state.next_n,
            oid: record.oid,
            record: Some(record),
            imported: None,
        };
        if d.commit(state.seq + 1, &[change], state.next_n + 1).await
            != push::durable::Commit::Committed
        {
            return Err("seed native commit".into());
        }
        for key in [
            "index/v2/push/delivery/synthetic-final-copy-claim.json",
            "index/v2/push/delivery/synthetic-final-copy-claim.result.json",
        ] {
            if transport
                .put_control(
                    key,
                    b"{\"synthetic\":\"immutable-unknown\"}",
                    &WriteCondition::Absent,
                )
                .await
                .map_err(|_| "seed claims")?
                != 200
            {
                return Err("seed claim status".into());
            }
        }
        println!(
            "{{\"status\":\"SEEDED\",\"source_records\":{},\"native_records\":1}}",
            records.len()
        );
        Ok(())
    } else {
        cli::execute(
            vec![
                "owned-cli".into(),
                args[2].clone(),
                args[3].clone(),
                args[4].clone(),
            ],
            Some(settings),
        )
        .await
    }
}
