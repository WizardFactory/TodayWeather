//! S10f operator readiness check of the server2 bucket (#2759). It reads the S3 settings of the
//! server2 runtime (`SERVER2_S3_BUCKET`, `SERVER2_S3_REGION`; `AWS_ACCESS_KEY`/`AWS_SECRET_KEY`,
//! or the EC2 instance role when both are unset) from the process environment and `server2/.env`
//! in the working directory, and exercises server2's real S3 stores and transports:
//!
//! - HEAD and GET of absent `raw/v2` and `index/v2` keys must be 404 (the missing-key readiness
//!   rule of `server2/deploy/staging/prerequisites.json`; 403 is never absence);
//! - a raw record is created conditionally (`If-None-Match: *`) and a repeat is reconciled;
//! - two catalog revisions are published (group descriptors created conditionally, the catalog
//!   replaced by ETag CAS), and a cold lookup finds both acquisitions;
//! - `budgets/v2` and `state/demand/grid` documents are created conditionally, a repeated create
//!   is refused with 412, and an ETag CAS update succeeds;
//! - HEAD of a key outside the server2 prefixes: with the instance role it must be 403 (the role
//!   policy denies it); with static keys the status is reported only.
//!
//! Every object is written under source/prefix `s10f-live` and the caller's LABEL, except the
//! content-addressed group descriptors `index/v2/groups/<sha256>.json`. Nothing is deleted (the
//! bucket keeps every version). Output is step names, statuses and keys; never credentials.
//! Running it against a bucket is a separately authorized operator action.
//!
//! Usage (from `server2/`): s3_readiness LABEL   (LABEL: 1-40 of a-z, 0-9, -)
use server2::{
    budget::BudgetTransport,
    history::demand::DemandTransport,
    storage::{
        CatalogId, CatalogLimits, CatalogStore, CatalogTransport, Error, GroupDeclaration,
        GroupMember, HttpS3Transport, Limits, LookupOutcome, ObjectTransport, Period, ProviderKey,
        PublishOutcome, RawRecord, RawRecordStore, S3Settings, WriteCondition,
    },
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SOURCE: &str = "s10f-live";

fn fail(step: &str, detail: impl std::fmt::Display) -> ! {
    eprintln!("FAIL {step}: {detail}");
    std::process::exit(1);
}
fn label_ok(label: &str) -> bool {
    (1..=40).contains(&label.len())
        && label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_else(|_| fail("clock", "before 1970"))
}
/// The KST calendar date of `ms` as YYYYMMDD.
fn kst_date(ms: u64) -> u32 {
    let at = time::OffsetDateTime::from_unix_timestamp((ms / 1000) as i64)
        .unwrap_or_else(|_| fail("clock", "out of range"))
        .to_offset(time::macros::offset!(+9));
    at.year() as u32 * 10000 + u8::from(at.month()) as u32 * 100 + at.day() as u32
}
fn record(label: &str, fetched_at_ms: u64, check: &str) -> RawRecord {
    let body = serde_json::json!({ "label": label, "check": check, "at": fetched_at_ms });
    RawRecord::new(
        SOURCE,
        "readiness",
        &ProviderKey::Named { id: label.into() },
        Period {
            local_date: kst_date(fetched_at_ms),
            slot: "0000".into(),
        },
        fetched_at_ms,
        200,
        "application/json",
        None,
        body.to_string().into_bytes().into(),
        &Limits::default(),
    )
    .unwrap_or_else(|e| fail("raw record", e))
}
fn status(result: &Result<impl Sized, Error>) -> String {
    match result {
        Ok(_) => "200".into(),
        Err(Error::NotFound) => "404".into(),
        Err(Error::Status(s)) => s.to_string(),
        Err(e) => format!("{e:?}"),
    }
}
fn expect_absent(step: &str, key: &str, result: Result<impl Sized, Error>) {
    let got = status(&result);
    println!("{step} {key} -> {got}");
    if !matches!(result, Err(Error::NotFound)) {
        fail(step, format!("expected 404, got {got}"));
    }
}
fn transport(settings: &S3Settings) -> HttpS3Transport {
    settings
        .transport()
        .unwrap_or_else(|e| fail("transport", e))
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 || !label_ok(&args[1]) {
        eprintln!(
            "usage: s3_readiness LABEL (1-40 of a-z, 0-9, -; S3 from SERVER2_S3_BUCKET, SERVER2_S3_REGION; AWS_ACCESS_KEY, AWS_SECRET_KEY or the EC2 instance role)"
        );
        std::process::exit(2);
    }
    let label = args[1].as_str();
    let env = server2::dotenv::DotEnv::load(std::path::Path::new(server2::dotenv::FILE))
        .unwrap_or_else(|e| fail("settings", e));
    let settings = S3Settings::from_vars(&|name: &str| env.var(name))
        .unwrap_or_else(|e| fail("settings", format!("invalid S3 settings: {e}")));
    let role = settings.uses_instance_role();
    println!(
        "bucket={} region={} credentials={} label={label}",
        settings.bucket,
        settings.region,
        if role { "instance-role" } else { "static-keys" }
    );
    let objects = transport(&settings);

    // Absent keys: 404, never 403.
    let raw_absent = format!("raw/v2/{SOURCE}/absent/{label}.raw.gz");
    let index_absent = format!("index/v2/{SOURCE}/absent/{label}.json");
    expect_absent("HEAD raw", &raw_absent, objects.head(&raw_absent).await);
    expect_absent("GET raw", &raw_absent, objects.get(&raw_absent, 1024).await);
    expect_absent(
        "HEAD index",
        &index_absent,
        objects.head(&index_absent).await,
    );
    expect_absent(
        "GET index",
        &index_absent,
        objects.get_control(&index_absent, 1024).await,
    );

    // Raw: conditional create, then a reconciled repeat.
    let raw = RawRecordStore::new(transport(&settings), Limits::default())
        .unwrap_or_else(|e| fail("raw store", e));
    let first = record(label, now_ms(), "raw");
    let key = first
        .envelope
        .identity
        .object_key()
        .unwrap_or_else(|e| fail("raw key", e));
    let created = raw
        .publish(first.clone())
        .await
        .unwrap_or_else(|e| fail("raw create", e));
    let repeated = raw
        .publish(first)
        .await
        .unwrap_or_else(|e| fail("raw repeat", e));
    println!("PUT raw (If-None-Match) {key} -> {created:?}; repeat -> {repeated:?}");
    if created != PublishOutcome::Created || repeated != PublishOutcome::AlreadyPresent {
        fail("raw", "expected Created then AlreadyPresent");
    }

    // Catalog: two revisions of one catalog (CAS), then a cold lookup.
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let catalogs = CatalogStore::new(transport(&settings), limits.clone())
        .unwrap_or_else(|e| fail("catalog store", e));
    let mut catalog = None;
    for revision in 1..=2 {
        let member = record(label, now_ms() + revision, "catalog");
        let id = CatalogId::for_record(&member.envelope.identity, "readiness")
            .unwrap_or_else(|e| fail("catalog id", e));
        let declaration = GroupDeclaration::new(
            vec![GroupMember {
                envelope: member.envelope.clone(),
                catalogs: vec![id.clone()],
            }],
            &limits,
        )
        .unwrap_or_else(|e| fail("group", e));
        let group = declaration
            .reference(&limits)
            .and_then(|r| r.descriptor_key())
            .unwrap_or_else(|e| fail("group key", e));
        let raw_key = member
            .envelope
            .identity
            .object_key()
            .unwrap_or_else(|e| fail("raw key", e));
        catalogs
            .publish(
                declaration,
                vec![member],
                tokio::time::Instant::now() + Duration::from_secs(9),
            )
            .await
            .unwrap_or_else(|e| fail("catalog publish", e));
        println!(
            "PUBLISH catalog revision {revision}: {} (If-None-Match/If-Match), group {group}, raw {raw_key}",
            id.key()
        );
        catalog = Some(id);
    }
    let catalog = catalog.unwrap_or_else(|| fail("catalog", "no revision"));
    let cold = CatalogStore::new(transport(&settings), limits.clone())
        .unwrap_or_else(|e| fail("catalog store", e));
    match cold
        .lookup(
            &catalog,
            tokio::time::Instant::now() + Duration::from_secs(9),
        )
        .await
    {
        Ok(LookupOutcome::Ready(set)) => {
            println!(
                "LOOKUP catalog {} -> {} acquisitions",
                catalog.key(),
                set.acquisitions().len()
            );
            if set.acquisitions().len() < 2 {
                fail("catalog lookup", "expected both revisions");
            }
        }
        Ok(LookupOutcome::Incomplete) => fail("catalog lookup", "incomplete"),
        Err(e) => fail("catalog lookup", e),
    }

    // Budget and demand documents: conditional create, refused repeat, CAS update.
    let budget_key = format!("budgets/v2/{SOURCE}/{label}.json");
    let body = |n: u32| serde_json::json!({ "label": label, "revision": n }).to_string();
    let created = objects
        .put_budget(&budget_key, body(1).as_bytes(), &WriteCondition::Absent)
        .await
        .unwrap_or_else(|e| fail("budget create", format!("{e:?}")));
    let repeat = objects
        .put_budget(&budget_key, body(1).as_bytes(), &WriteCondition::Absent)
        .await
        .unwrap_or_else(|e| fail("budget repeat", format!("{e:?}")));
    let etag = objects
        .get_budget(&budget_key)
        .await
        .unwrap_or_else(|e| fail("budget read", format!("{e:?}")))
        .etag;
    let updated = objects
        .put_budget(
            &budget_key,
            body(2).as_bytes(),
            &WriteCondition::Match(etag),
        )
        .await
        .unwrap_or_else(|e| fail("budget update", format!("{e:?}")));
    println!(
        "PUT budget {budget_key}: create (If-None-Match) -> {created}; repeat -> {repeat}; update (If-Match) -> {updated}"
    );
    if (created, repeat, updated) != (200, 412, 200) {
        fail("budget", "expected 200, 412, 200");
    }
    let demand_key = format!("state/demand/grid/{SOURCE}/{label}.json");
    let created = objects
        .put_demand(&demand_key, body(1).as_bytes(), &WriteCondition::Absent)
        .await
        .unwrap_or_else(|e| fail("demand create", format!("{e:?}")));
    let repeat = objects
        .put_demand(&demand_key, body(1).as_bytes(), &WriteCondition::Absent)
        .await
        .unwrap_or_else(|e| fail("demand repeat", format!("{e:?}")));
    let etag = objects
        .get_demand(&demand_key)
        .await
        .unwrap_or_else(|e| fail("demand read", format!("{e:?}")))
        .unwrap_or_else(|| fail("demand read", "absent after create"))
        .etag;
    let updated = objects
        .put_demand(
            &demand_key,
            body(2).as_bytes(),
            &WriteCondition::Match(etag),
        )
        .await
        .unwrap_or_else(|e| fail("demand update", format!("{e:?}")));
    println!(
        "PUT demand {demand_key}: create (If-None-Match) -> {created}; repeat -> {repeat}; update (If-Match) -> {updated}"
    );
    if (created, repeat, updated) != (200, 412, 200) {
        fail("demand", "expected 200, 412, 200");
    }

    // Outside the server2 prefixes: the runtime role has no access.
    let outside = format!("{SOURCE}/{label}.outside");
    let got = status(&objects.head(&outside).await);
    println!(
        "HEAD outside {outside} -> {got} ({})",
        if role {
            "the role must be denied"
        } else {
            "static keys: reported only"
        }
    );
    if role && got != "403" {
        fail("outside prefix", format!("expected 403, got {got}"));
    }
    println!("PASS s3_readiness label={label}; nothing deleted");
}
