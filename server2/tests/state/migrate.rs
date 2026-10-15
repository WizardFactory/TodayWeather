//! The one-time registration copy: offline conversion of a `mongoexport` file with a
//! malformed-document report, and the idempotent import into server2 state.
use super::common::*;
use axum::{body::Body as HttpBody, extract::Request};
use server2::{
    push::{
        Coll,
        durable::{Counters, Durable, DurableConfig, journal_key},
        migrate,
    },
    world::js::Val,
};
use std::sync::Arc;

/// Synthetic export lines in the forms `mongoexport` writes (relaxed v2, canonical v2 and the
/// legacy v1 date form), plus malformed documents (fixtures; no production data).
const PUSHES: &str = include_str!("fixtures/export-pushes.jsonl");
const ALERTS: &str = include_str!("fixtures/export-alertpushes.json");

fn convert() -> (String, migrate::Report) {
    let mut out = String::new();
    let mut report = migrate::Report::default();
    migrate::convert(Coll::Alarm, PUSHES.as_bytes(), &mut out, &mut report);
    migrate::convert(Coll::Alert, ALERTS.as_bytes(), &mut out, &mut report);
    (out, report)
}

#[test]
fn conversion_keeps_every_field_and_reports_malformed_documents() {
    let (out, report) = convert();
    assert_eq!(report.read.get("pushes"), Some(&10));
    assert_eq!(report.converted.get("pushes"), Some(&3));
    assert_eq!(report.converted.get("alertpushes"), Some(&1));
    assert_eq!(report.extra_fields.get("pushes"), Some(&1));
    let reasons: Vec<(&str, usize, &str)> = report
        .malformed
        .iter()
        .map(|m| (m.collection, m.position, m.reason.as_str()))
        .collect();
    assert_eq!(
        reasons,
        [
            ("pushes", 4, "not valid JSON"),
            ("pushes", 5, "missing _id"),
            ("pushes", 6, "_id is not an ObjectId"),
            ("pushes", 7, "field cityIndex does not match the model type"),
            ("pushes", 8, "no fcmToken or registrationId"),
            ("pushes", 9, "duplicate _id"),
            ("pushes", 10, "field blob: unsupported extended JSON type"),
            (
                "alertpushes",
                2,
                "field airAlerts does not match the model type"
            ),
        ]
    );
    // The report carries no values or tokens.
    let json = report.to_json();
    assert!(!json.contains("tok-") && !json.contains("reg-"), "{json}");
    // Every field and its type survives, in document order.
    let records = migrate::parse_import(out.as_bytes()).unwrap();
    assert_eq!(records.len(), 4);
    let first = &records[0].1.doc;
    let keys: Vec<&str> = first.entries().iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys.first(), Some(&"type"));
    assert_eq!(keys.len(), 20);
    assert_eq!(first.get("updatedAt"), &Val::Date(1_790_812_800_000.));
    let second = &records[1].1.doc;
    assert_eq!(second.get("cityIndex"), &Val::Num(1.));
    assert_eq!(second.get("pushTime"), &Val::Num(3600.));
    assert_eq!(second.get("legacyOnly"), &Val::Str("kept".into()));
    let alert = &records[3];
    assert_eq!(alert.0, Coll::Alert);
    assert_eq!(
        alert.1.doc.get("precipAlerts").get("pushTime"),
        &Val::Date(1_791_946_800_000.)
    );
}

async fn import(
    s3: &MemS3,
    records: &[(Coll, server2::push::Record)],
    entry: usize,
) -> migrate::ImportCounts {
    let mut durable = Durable::new(
        Arc::new(s3.clone()),
        DurableConfig {
            entry_bytes: entry,
            ..DurableConfig::default()
        },
        Arc::new(Counters::default()),
    );
    migrate::import(&mut durable, records).await.unwrap()
}

#[tokio::test]
async fn import_is_idempotent_and_restores_with_the_registration_api() {
    let (out, _) = convert();
    let records = migrate::parse_import(out.as_bytes()).unwrap();
    let s3 = MemS3::new();
    let first = import(&s3, &records, 600).await;
    assert_eq!(
        (
            first.inserted,
            first.updated,
            first.unchanged,
            first.kept,
            first.deleted
        ),
        (4, 0, 0, 0, 0)
    );
    let entries = s3.keys("index/v2/push/state/journal/").len();
    assert!(entries >= 2, "bounded journal entries: {entries}");
    assert!(s3.body("index/v2/push/state/head.json").is_some());
    // A re-run changes nothing and writes no journal entry.
    let again = import(&s3, &records, 600).await;
    assert_eq!(
        (
            again.inserted,
            again.updated,
            again.unchanged,
            again.kept,
            again.deleted
        ),
        (0, 0, 4, 0, 0)
    );
    assert_eq!(s3.keys("index/v2/push/state/journal/").len(), entries);
    // The imported registrations restore from S3 with every field and serve the existing API.
    let service = start(
        &s3,
        FixedClock::at("2026-10-15T02:00:00.000Z"),
        fast_config(),
    )
    .await;
    {
        let state = service.state();
        let state = state.read().unwrap();
        let ours = records_of(&state);
        assert_eq!(ours, records);
    }
    let body =
        serde_json::to_vec(&serde_json::json!({"newToken": "tok-z", "oldToken": "tok-a"})).unwrap();
    let request = Request::builder()
        .method("PUT")
        .uri("/v000902/push")
        .header("content-type", "application/json")
        .header("content-length", body.len())
        .body(HttpBody::from(body))
        .unwrap();
    let response = service.handle(request).await.unwrap();
    assert_eq!(
        String::from_utf8(super::common::body(response).await).unwrap(),
        r#"[{"n":1,"nModified":1,"ok":1},{"n":1,"nModified":1,"ok":1}]"#
    );
    // Server2's change is newer than the legacy copy: a re-run keeps it.
    let rerun = import(&s3, &records, 600).await;
    assert_eq!(
        (
            rerun.inserted,
            rerun.updated,
            rerun.unchanged,
            rerun.kept,
            rerun.deleted
        ),
        (0, 0, 2, 2, 0)
    );
    // A newer legacy record (later updatedAt) replaces the server2 copy.
    let mut newer = records.clone();
    newer[2]
        .1
        .doc
        .set("updatedAt", Val::Date(1_800_000_000_000.));
    newer[2].1.doc.set("name", "renamed");
    let update = import(&s3, &newer, 600).await;
    assert_eq!(update.updated, 1);
    assert!(s3.body(&journal_key(1)).is_some());
    // A registration the user removed through the API stays removed when the copy is re-run,
    // also after a restore from the journal and from a snapshot.
    let service = start(
        &s3,
        FixedClock::at("2026-10-15T03:00:00.000Z"),
        fast_config(),
    )
    .await;
    let body = serde_json::to_vec(&serde_json::json!({"fcmToken": "tok-c"})).unwrap();
    let request = Request::builder()
        .method("DELETE")
        .uri("/v000902/push")
        .header("content-type", "application/json")
        .header("content-length", body.len())
        .body(HttpBody::from(body))
        .unwrap();
    let response = service.handle(request).await.unwrap();
    assert_eq!(
        String::from_utf8(super::common::body(response).await).unwrap(),
        r#"[{"n":0,"ok":1},{"n":1,"ok":1}]"#
    );
    let after_delete = import(&s3, &newer, 600).await;
    assert_eq!(
        (after_delete.inserted, after_delete.deleted),
        (0, 1),
        "an acknowledged removal is not revived"
    );
    let mut durable = Durable::new(
        Arc::new(s3.clone()),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    let state = durable.restore().await.unwrap();
    let plan = durable.prepare_snapshot(&state);
    durable.write_snapshot(plan).await.unwrap();
    let from_snapshot = import(&s3, &newer, 600).await;
    assert_eq!((from_snapshot.inserted, from_snapshot.deleted), (0, 1));
}

fn records_of(state: &server2::push::State) -> Vec<(Coll, server2::push::Record)> {
    let mut all: Vec<(u64, Coll, server2::push::Record)> = Vec::new();
    for c in [Coll::Alarm, Coll::Alert] {
        all.extend(state.coll(c).iter().map(|(n, r)| (n, c, r.clone())));
    }
    all.sort_by_key(|(n, ..)| *n);
    all.into_iter().map(|(_, c, r)| (c, r)).collect()
}
