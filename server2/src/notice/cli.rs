//! CLI commands share the same durable state as the read-only API.
use super::{
    Error, Notice, latest,
    store::{Mutation, NoticeStore, source_fingerprint},
    translate::{Translator, Transport},
    utc,
};
use crate::storage::CatalogTransport;
use serde_json::{Value, json};

pub struct Output {
    pub json: Value,
    pub warnings: Vec<String>,
}
fn id(args: &[String]) -> Result<u64, Error> {
    if args.len() != 2 {
        return Err(Error::Invalid("notice command arguments"));
    }
    let id = args[1]
        .parse::<u64>()
        .map_err(|_| Error::Invalid("notice id"))?;
    if id == 0 || id > 9_007_199_254_740_991 {
        return Err(Error::Invalid("notice id"));
    }
    Ok(id)
}
fn input(bytes: &[u8]) -> Result<Value, Error> {
    if bytes.len() > 128 * 1024 {
        return Err(Error::Invalid("notice input size"));
    }
    let v: Value =
        serde_json::from_slice(bytes).map_err(|_| Error::Invalid("notice input JSON"))?;
    if !v.is_object() {
        return Err(Error::Invalid("notice input object"));
    }
    Ok(v)
}
fn fields(n: &Notice) -> Value {
    json!({"texts":n.texts,"linkUrl":n.link_url,"startsAt":utc(n.starts_at),"endsAt":n.ends_at.map(utc)})
}
fn operator(n: &Notice) -> Value {
    let mut v = fields(n);
    v["id"] = json!(n.id);
    v["withdrawnAt"] = json!(n.withdrawn_at.map(utc));
    v["createdAt"] = json!(utc(n.created_at));
    v["updatedAt"] = json!(utc(n.updated_at));
    v
}
fn manual(n: &Notice) -> Result<(), Error> {
    if n.texts.values().any(|t| t.translated.is_some()) {
        return Err(Error::Invalid(
            "manual notice text cannot supply translation provenance",
        ));
    }
    Ok(())
}
async fn translate<T: Transport>(n: &mut Notice, t: &Translator<T>) -> Vec<String> {
    let out = t.fill(n).await;
    let mut warnings = Vec::new();
    if out.skipped {
        warnings.push("notice translation skipped: no key".into())
    }
    for lang in out.failed {
        warnings.push(format!("notice translation failed: {lang}"));
    }
    n.texts.extend(out.texts);
    warnings
}
pub async fn execute<S: CatalogTransport, T: Transport>(
    store: &NoticeStore<S>,
    translator: &Translator<T>,
    args: &[String],
    stdin: &[u8],
    now: i64,
    operation: &str,
) -> Result<Output, Error> {
    let command = args
        .first()
        .map(String::as_str)
        .ok_or(Error::Invalid("notice command"))?;
    let mut warnings = Vec::new();
    let value = match command {
        "add" => {
            if args.len() != 1 {
                return Err(Error::Invalid("notice add arguments"));
            }
            let mut n = Notice::from_input(1, &input(stdin)?, now)?;
            manual(&n)?;
            warnings = translate(&mut n, translator).await;
            let id = store
                .apply(operation, Mutation::Add(fields(&n)), now)
                .await?;
            json!({"id":id,"operation":operation})
        }
        "update" => {
            let id = id(args)?;
            let patch = input(stdin)?;
            let state = store.canonical().await?;
            let old = state
                .records
                .iter()
                .find(|n| n.id == id)
                .ok_or(Error::NotFound)?;
            let mut merged = fields(old);
            for (k, v) in patch.as_object().expect("validated object") {
                merged[k] = v.clone();
            }
            let mut next = Notice::from_input(id, &merged, now)?;
            let expected_source = if patch.get("texts").is_some() {
                manual(&next)?;
                warnings = translate(&mut next, translator).await;
                Some(source_fingerprint(old))
            } else {
                None
            };
            let mut applied = patch;
            if applied.get("texts").is_some() {
                applied["texts"] = json!(next.texts);
            }
            store
                .apply(
                    operation,
                    Mutation::Update {
                        id,
                        input: applied,
                        expected_source,
                    },
                    now,
                )
                .await?;
            json!({"id":id,"operation":operation})
        }
        "withdraw" => {
            let id = id(args)?;
            store.apply(operation, Mutation::Withdraw(id), now).await?;
            json!({"id":id,"operation":operation})
        }
        "translate" => {
            let id = id(args)?;
            let state = store.canonical().await?;
            let n = state
                .records
                .iter()
                .find(|n| n.id == id)
                .ok_or(Error::NotFound)?;
            let out = translator.fill(n).await;
            if out.skipped {
                warnings.push("notice translation skipped: no key".into())
            }
            for lang in out.failed {
                warnings.push(format!("notice translation failed: {lang}"));
            }
            if !out.texts.is_empty() {
                store
                    .apply(
                        operation,
                        Mutation::Fill {
                            id,
                            source: source_fingerprint(n),
                            texts: out.texts,
                        },
                        now,
                    )
                    .await?;
            }
            json!({"id":id,"operation":operation})
        }
        "list" => {
            if args.len() != 1 {
                return Err(Error::Invalid("notice list arguments"));
            }
            json!({"notices":store.canonical().await?.records.iter().map(operator).collect::<Vec<_>>()})
        }
        "show" => {
            let id = id(args)?;
            let s = store.canonical().await?;
            operator(
                s.records
                    .iter()
                    .find(|n| n.id == id)
                    .ok_or(Error::NotFound)?,
            )
        }
        "latest" => {
            if args.len() > 2 {
                return Err(Error::Invalid("notice latest arguments"));
            }
            let s = store.canonical().await?;
            json!({"notice":latest(&s.records,now).map(|n|n.public(args.get(1).map(String::as_str),None))})
        }
        _ => return Err(Error::Invalid("notice command")),
    };
    Ok(Output {
        json: value,
        warnings,
    })
}
