//! F1 explicit final-copy regression. This first test intentionally exposes the existing
//! merge-only import omission before the final-copy implementation is introduced.
use server2::{
    push::{
        Coll, State,
        final_copy::{
            self, Bundle, CollectionExport, Custody, Evidence, Export, Operation, SourceIdentity,
            Target,
        },
        migrate,
        store::Change,
    },
    world::js::Val,
};

#[test]
fn final_copy_requires_removal_for_unchanged_source_owned_absence() {
    // Synthetic complete source snapshot: two alarms and one alert, no private data.
    let alarm_export = concat!(
        "{\"_id\":{\"$oid\":\"000000000000000000000001\"},\"fcmToken\":\"synthetic-removed\",\"cityIndex\":1}\n",
        "{\"_id\":{\"$oid\":\"000000000000000000000002\"},\"fcmToken\":\"synthetic-retained\",\"cityIndex\":2}\n"
    );
    let alert_export = "{\"_id\":{\"$oid\":\"000000000000000000000003\"},\"fcmToken\":\"synthetic-alert\",\"cityIndex\":3}\n";
    let mut canonical = String::new();
    let mut report = migrate::Report::default();
    migrate::convert(
        Coll::Alarm,
        alarm_export.as_bytes(),
        &mut canonical,
        &mut report,
    );
    migrate::convert(
        Coll::Alert,
        alert_export.as_bytes(),
        &mut canonical,
        &mut report,
    );
    assert!(report.malformed.is_empty());
    let baseline = migrate::parse_import(canonical.as_bytes()).unwrap();
    assert_eq!(baseline.len(), 3);

    // The actual existing import planner assigns import digests. No hand-built ownership.
    let mut native = State::default();
    let (first_changes, next_n, _) = migrate::plan_import(&native, &baseline).unwrap();
    native.apply(&first_changes).unwrap();
    native.next_n = next_n;
    native.seq = 1;
    let removed_oid = baseline[0].1.oid;
    let imported = native
        .alarms
        .iter_encoded()
        .find(|entry| *entry.1 == removed_oid)
        .unwrap();
    assert!(
        imported.3.is_some(),
        "baseline must be source-owned before final copy"
    );

    // A new native-only row is outside the source baseline and must survive finalization.
    let mut native_only = baseline[1].1.clone();
    native_only.oid = [9; 12];
    native_only.doc.set("fcmToken", "synthetic-native-only");
    let native_n = native.next_n;
    native
        .apply(&[Change {
            coll: Coll::Alarm,
            n: native_n,
            oid: native_only.oid,
            record: Some(native_only.clone()),
            imported: None,
        }])
        .unwrap();
    native.next_n += 1;
    native.seq += 1;
    assert_eq!(
        native_only.doc.get("fcmToken"),
        &Val::Str("synthetic-native-only".into())
    );

    // The user removed alarm1 in legacy; the complete final source retains alarm2 + alert3.
    // Intentionally invoke the real merge-only baseline API, which currently ignores absence.
    // After intended Red, the final-only planner replaces this call; merge import stays compatible.
    let final_source = vec![baseline[1].clone(), baseline[2].clone()];
    let bundle = bundle_for(
        alarm_export,
        alert_export,
        &alarm_export.lines().skip(1).collect::<Vec<_>>().join("\n"),
        alert_export,
    );
    let planned = final_copy::plan(&native, &bundle).unwrap();
    let changes = planned.changes;
    assert_eq!(planned.counts.source_absent_delete, 1);
    // Ordinary merge import retains its old semantics; explicit finalization is separate.
    assert!(
        migrate::plan_import(&native, &final_source)
            .unwrap()
            .0
            .is_empty()
    );
    assert!(
        changes.iter().any(|change| change.coll == Coll::Alarm
            && change.oid == removed_oid
            && change.record.is_none()),
        "final complete copy must tombstone unchanged source-owned alarm1 absent from export; merge-only import currently leaves it live"
    );
    assert!(
        !changes.iter().any(|change| change.oid == native_only.oid),
        "final copy must not alter native-only registrations"
    );
}

fn export(collection: &str, raw: &str) -> CollectionExport {
    let coll = Coll::parse(collection).unwrap();
    let mut canonical = String::new();
    let mut report = migrate::Report::default();
    migrate::convert(coll, raw.as_bytes(), &mut canonical, &mut report);
    assert!(report.malformed.is_empty());
    CollectionExport {
        collection: collection.into(),
        complete: true,
        count: *report.read.get(collection).unwrap_or(&0) as u64,
        raw: raw.into(),
        raw_sha256: server2::storage::sha256(raw.as_bytes()),
        canonical_sha256: server2::storage::sha256(canonical.as_bytes()),
        report_sha256: server2::storage::sha256(report.to_json().as_bytes()),
    }
}
fn evidence(kind: &str) -> Evidence {
    let body=serde_json::json!({"kind":kind,"observed_at_ms":1000,"subject_ids":["synthetic-owner-1"],"details":"Owned synthetic receipt; no actual operational evidence."}).to_string();
    Evidence {
        reference: format!("synthetic-{kind}.json"),
        sha256: server2::storage::sha256(body.as_bytes()),
        body,
    }
}
fn bundle_for(
    before_alarm: &str,
    before_alert: &str,
    after_alarm: &str,
    after_alert: &str,
) -> Bundle {
    Bundle {
        schema: 1,
        target: Target {
            bucket: "server2-local".into(),
            region: "ap-northeast-2".into(),
            state_prefix: "index/v2/push/state".into(),
        },
        source: SourceIdentity {
            id: "synthetic-source".into(),
            store: "mongo".into(),
            database: "synthetic-db".into(),
            revision: "c1ae9082b2c86f0087727be9872b0cf82b4e3bb1".into(),
        },
        baseline: Export {
            generation: 1,
            exported_at_ms: 1000,
            collections: vec![
                export("pushes", before_alarm),
                export("alertpushes", before_alert),
            ],
        },
        final_export: Export {
            generation: 2,
            exported_at_ms: 2000,
            collections: vec![
                export("pushes", after_alarm),
                export("alertpushes", after_alert),
            ],
        },
        previous: None,
        custody: Custody {
            process_exit: evidence("process-exit"),
            edit_freeze: evidence("edit-freeze"),
            settled_cutoff: evidence("settled-cutoff"),
        },
    }
}
const ONE: &str = "{\"_id\":{\"$oid\":\"000000000000000000000001\"},\"fcmToken\":\"synthetic-one\",\"cityIndex\":1}\n";
fn one_state() -> (State, Bundle) {
    let b = bundle_for(ONE, "", "", "");
    let mut text = String::new();
    let mut r = migrate::Report::default();
    migrate::convert(Coll::Alarm, ONE.as_bytes(), &mut text, &mut r);
    let records = migrate::parse_import(text.as_bytes()).unwrap();
    let mut s = State::default();
    let (changes, n, _) = migrate::plan_import(&s, &records).unwrap();
    s.apply(&changes).unwrap();
    s.next_n = n;
    s.seq = 1;
    (s, b)
}
fn durable(s3: &super::common::MemS3) -> server2::push::Durable<super::common::MemS3> {
    server2::push::Durable::new(
        std::sync::Arc::new(s3.clone()),
        server2::push::DurableConfig::default(),
        std::sync::Arc::new(server2::push::Counters::default()),
    )
}
async fn seed_one(s3: &super::common::MemS3) -> Bundle {
    let (s, b) = one_state();
    let mut d = durable(s3);
    d.write_snapshot(d.prepare_snapshot(&s)).await.unwrap();
    b
}
#[test]
fn complete_bundle_rejects_bad_scope_counts_custody_generation_and_duplicates() {
    let (_, base) = one_state();
    let mut bad = base.clone();
    bad.final_export.collections.pop();
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.final_export.collections[0].complete = false;
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.final_export.collections[0].count = 1;
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.final_export.collections[0].raw = "truncated".into();
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.final_export.collections[1] = bad.final_export.collections[0].clone();
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.custody.process_exit.body = "true".into();
    bad.custody.process_exit.sha256 = server2::storage::sha256(b"true");
    assert!(bad.validate().is_err());
    let mut bad = base.clone();
    bad.final_export.generation = final_copy::MAX_SAFE + 1;
    assert!(bad.validate().is_err());
    assert!(Bundle::parse(br#"{"schema":1,"schema":1}"#).is_err());
    assert!(
        base.validate().is_ok(),
        "explicit complete empty final collections are valid"
    );
}
#[test]
fn final_planner_rejects_native_edits_missing_baseline_and_collisions() {
    let (mut s, b) = one_state();
    let record = s.alarms.get(0).unwrap().unwrap();
    let mut edited = record.clone();
    edited.doc.set("name", "native-newer");
    s.alarms.put(0, edited).unwrap();
    assert!(
        final_copy::plan(&s, &b).is_err(),
        "absent but edited imported row must not be deleted"
    );
    let (mut s, b) = one_state();
    s.alarms.remove(0);
    assert!(
        final_copy::plan(&s, &b).is_err(),
        "baseline missing without tombstone is inconsistent"
    );
    let mut b = bundle_for("", "", ONE, "");
    let mut s = State::default();
    let mut record = record;
    record.doc.set("name", "native-collision");
    s.alarms.put(0, record).unwrap();
    s.next_n = 1;
    assert!(
        final_copy::plan(&s, &b).is_err(),
        "native colliding _id is a conflict"
    );
    b.final_export.collections[0] = export("pushes", "");
    assert_eq!(
        final_copy::plan(&s, &b).unwrap().counts.native_created_kept,
        1
    );
}
#[test]
fn final_plan_is_deterministic_and_fingerprint_binds_all_native_ownership() {
    let (s, b) = one_state();
    let plan = final_copy::plan(&s, &b).unwrap();
    assert_eq!(plan.mark, final_copy::plan(&s, &b).unwrap().mark);
    let base = final_copy::native_digest(&s).unwrap();
    let mut changed = s.clone();
    changed.next_n += 1;
    assert_ne!(base, final_copy::native_digest(&changed).unwrap());
    let mut changed = s.clone();
    changed.seq += 1;
    assert_ne!(base, final_copy::native_digest(&changed).unwrap());
    let mut changed = s.clone();
    changed.alarms.mark_deleted([8; 12]);
    assert_ne!(base, final_copy::native_digest(&changed).unwrap());
    let mut changed = s.clone();
    changed.source = Some(plan.mark.clone());
    assert_ne!(base, final_copy::native_digest(&changed).unwrap());
    let mut changed = s.clone();
    let record = changed.alarms.get(0).unwrap().unwrap();
    changed
        .alarms
        .put_imported(0, record, Some(&"f".repeat(64)))
        .unwrap();
    assert_ne!(base, final_copy::native_digest(&changed).unwrap());
    let mut operation = Operation::prepare(&plan).unwrap();
    operation.encoded.push(b' ');
    assert!(operation.matches(&plan).is_err());
}
#[tokio::test]
async fn atomic_final_copy_cold_restore_replay_and_claims_are_preserved() {
    use super::common::MemS3;
    let s3 = MemS3::new();
    let bundle = seed_one(&s3).await;
    let claim = "index/v2/push/delivery/synthetic-claim.json";
    let result = "index/v2/push/delivery/synthetic-claim.result.json";
    s3.insert(claim, b"synthetic-immutable-claim");
    s3.insert(result, b"synthetic-unknown-result");
    let mut d = durable(&s3);
    let p = final_copy::preview(&mut d, &bundle).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    let outcome = final_copy::apply(&mut d, &bundle, &op).await.unwrap();
    assert_eq!(outcome.status, "COMMITTED");
    let state = durable(&s3).restore().await.unwrap();
    assert!(state.alarms.is_empty());
    assert!(
        state
            .alarms
            .is_deleted(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    );
    assert_eq!(state.source, Some(op.mark.clone()));
    assert_eq!(
        final_copy::verify(&mut durable(&s3), &op)
            .await
            .unwrap()
            .status,
        "VERIFIED"
    );
    let before = s3.put_count("");
    assert_eq!(
        final_copy::apply(&mut durable(&s3), &bundle, &op)
            .await
            .unwrap()
            .status,
        "ALREADY_COMMITTED"
    );
    assert_eq!(s3.put_count(""), before);
    assert_eq!(s3.body(claim).unwrap(), b"synthetic-immutable-claim");
    assert_eq!(s3.body(result).unwrap(), b"synthetic-unknown-result");
    assert!(
        migrate::plan_import(&state, &[]).is_err(),
        "merge-only import is fenced after finalization"
    );
}
#[tokio::test]
async fn exact_entry_bound_and_stale_preview_do_not_publish() {
    use super::common::MemS3;
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let mut d = durable(&s3);
    let p = final_copy::preview(&mut d, &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    d.config.entry_bytes = op.encoded.len() - 1;
    let before = s3.put_count("");
    assert!(final_copy::apply(&mut d, &b, &op).await.is_err());
    assert_eq!(s3.put_count(""), before);
    let mut writer = durable(&s3);
    let mut state = writer.restore().await.unwrap();
    state.next_n += 1;
    assert_eq!(
        writer.commit(state.seq + 1, &[], state.next_n).await,
        server2::push::durable::Commit::Committed
    );
    let before = s3.put_count("");
    assert!(final_copy::apply(&mut durable(&s3), &b, &op).await.is_err());
    assert_eq!(s3.put_count(""), before);
}
#[tokio::test]
async fn lost_final_response_settles_without_second_original_payload() {
    use super::common::{Fault, MemS3};
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let mut d = durable(&s3);
    let p = final_copy::preview(&mut d, &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    let key = server2::push::durable::journal_key(op.mark.seq);
    s3.fault_put(&key, Fault::CommitLostUnreadable);
    assert_eq!(
        final_copy::apply(&mut d, &b, &op).await.unwrap().status,
        "SETTLEMENT_REQUIRED"
    );
    let before = s3.put_count(&key);
    assert_eq!(
        final_copy::apply(&mut d, &b, &op).await.unwrap().status,
        "SETTLEMENT_REQUIRED"
    );
    assert_eq!(
        s3.put_count(&key),
        before,
        "same owner must not clear pending and resend"
    );
    let done = final_copy::settle(&mut durable(&s3), &op).await.unwrap();
    assert_eq!(done.status, "COMMITTED");
    assert_eq!(s3.put_count(&key), before);
    assert_eq!(
        final_copy::verify(&mut durable(&s3), &op)
            .await
            .unwrap()
            .status,
        "VERIFIED"
    );
}
#[tokio::test]
async fn source_marker_survives_external_catchup_and_snapshot() {
    use super::common::MemS3;
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let mut old = durable(&s3);
    let mut state = old.restore().await.unwrap();
    let p = final_copy::preview(&mut durable(&s3), &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    final_copy::apply(&mut durable(&s3), &b, &op).await.unwrap();
    old.catch_up(&mut state).await.unwrap();
    assert_eq!(state.source, Some(op.mark.clone()));
    let raced = old.write_snapshot(old.prepare_snapshot(&state)).await;
    assert!(
        matches!(
            raced,
            Err(server2::push::StateError::Storage(
                server2::storage::Error::Status(412)
            ))
        ),
        "existing snapshot CAS must reject the stale validator and refresh it"
    );
    old.write_snapshot(old.prepare_snapshot(&state))
        .await
        .unwrap();
    assert_eq!(
        durable(&s3).restore().await.unwrap().source,
        Some(op.mark.clone())
    );
    // The marker belongs to the head/header, never record part lines.
    let head: serde_json::Value =
        serde_json::from_slice(&s3.body("index/v2/push/state/head.json").unwrap()).unwrap();
    assert!(head.get("source").is_some());
    for key in s3.keys("index/v2/push/state/snapshot/") {
        assert!(
            !String::from_utf8(s3.body(&key).unwrap())
                .unwrap()
                .contains("\"source\":")
        );
    }
}

#[tokio::test]
async fn final_copy_marker_survives_actual_service_writer_catchup_and_compaction() {
    use super::common::{FixedClock, MemS3, fast_config, start};
    use axum::{body::Body, extract::Request};
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let mut config = fast_config();
    config.durable.compact_every = 1;
    let service = start(&s3, FixedClock::at("2026-10-19T01:00:00Z"), config).await;
    let p = final_copy::preview(&mut durable(&s3), &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    final_copy::apply(&mut durable(&s3), &b, &op).await.unwrap();
    // Two queued writes also cover the first snapshot's stale-head CAS refresh before
    // the second successful service compaction, rather than relying on a tool snapshot.
    for city in [8, 9] {
        let body=serde_json::to_vec(&serde_json::json!([{"type":"ios","fcmToken":format!("synthetic-after-final-{city}"),"cityIndex":city,"id":city,"town":{"first":"Seoul"},"source":"KMA"}])).unwrap();
        let response = service
            .handle(
                Request::builder()
                    .method("POST")
                    .uri("/v000902/push-list")
                    .header("content-type", "application/json")
                    .header("content-length", body.len())
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 200);
    }
    let observed_seq = {
        let state = service.state();
        let state = state.read().unwrap();
        assert_eq!(state.source, Some(op.mark.clone()));
        assert_eq!(state.alarms.len(), 2);
        state.seq
    };
    for _ in 0..100 {
        let head: serde_json::Value =
            serde_json::from_slice(&s3.body("index/v2/push/state/head.json").unwrap()).unwrap();
        if head["seq"].as_u64() == Some(observed_seq) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let compacted: serde_json::Value =
        serde_json::from_slice(&s3.body("index/v2/push/state/head.json").unwrap()).unwrap();
    assert_eq!(
        compacted["seq"].as_u64(),
        Some(observed_seq),
        "actual service writer must compact its newer state"
    );
    assert!(compacted.get("source").is_some());
    assert!(
        service
            .drain(tokio::time::Instant::now() + std::time::Duration::from_secs(2))
            .await
    );
    let state = durable(&s3).restore().await.unwrap();
    assert_eq!(state.seq, observed_seq);
    assert_eq!(state.source, Some(op.mark.clone()));
    assert_eq!(state.alarms.len(), 2);
    assert_eq!(
        final_copy::verify(&mut durable(&s3), &op)
            .await
            .unwrap()
            .status,
        "COMMITTED",
        "verification must observe newer native state rather than rewrite it"
    );
}

#[tokio::test]
async fn predecessor_and_erased_marker_block_new_finalization() {
    use super::common::MemS3;
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let p = final_copy::preview(&mut durable(&s3), &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    final_copy::apply(&mut durable(&s3), &b, &op).await.unwrap();
    let mut next = b.clone();
    next.previous = Some(op.mark.predecessor());
    next.baseline = b.final_export.clone();
    next.final_export.generation = 3;
    next.final_export.exported_at_ms = 3000;
    assert!(final_copy::preview(&mut durable(&s3), &next).await.is_ok());
    let mut wrong = next.clone();
    wrong.previous.as_mut().unwrap().plan = "f".repeat(64);
    assert!(
        final_copy::preview(&mut durable(&s3), &wrong)
            .await
            .is_err()
    );
    let mut wrong = next.clone();
    wrong.baseline.exported_at_ms += 1;
    assert!(
        final_copy::preview(&mut durable(&s3), &wrong)
            .await
            .is_err(),
        "baseline must be exact last final export, not only same generation"
    );
    let mut head: serde_json::Value =
        serde_json::from_slice(&s3.body("index/v2/push/state/head.json").unwrap()).unwrap();
    head.as_object_mut().unwrap().remove("source");
    s3.insert(
        "index/v2/push/state/head.json",
        &serde_json::to_vec(&head).unwrap(),
    );
    assert!(
        final_copy::preview(&mut durable(&s3), &next).await.is_err(),
        "an old writer erasing the marker cannot satisfy a claimed custody chain"
    );
}

#[tokio::test]
async fn malformed_marker_is_corrupt_and_unmarked_bytes_stay_exact() {
    use super::common::MemS3;
    let literal = b"{\"schema\":1,\"seq\":1,\"nonce\":\"same\",\"next_n\":0,\"changes\":0}\n";
    assert_eq!(
        server2::push::durable::entry_bytes(1, 0, "same", &[]),
        literal
    );
    assert_eq!(
        server2::push::durable::entry_bytes_with_source(1, 0, "same", &[], None).unwrap(),
        literal
    );
    let (state, b) = one_state();
    let p = final_copy::plan(&state, &b).unwrap();
    let op = Operation::prepare(&p).unwrap();
    for (field, value) in [
        ("generation", serde_json::json!(final_copy::MAX_SAFE + 1)),
        ("seq", serde_json::json!(3)),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut body = op.encoded.clone();
        let end = body.iter().position(|b| *b == b'\n').unwrap();
        let mut header: serde_json::Value = serde_json::from_slice(&body[..end]).unwrap();
        header["source"][field] = value;
        let mut altered = serde_json::to_vec(&header).unwrap();
        altered.push(b'\n');
        altered.extend_from_slice(&body.split_off(end + 1));
        let mut native = state.clone();
        let d = durable(&MemS3::new());
        assert!(d.apply_entry(&mut native, op.mark.seq, &altered).is_err());
        assert_eq!(
            final_copy::native_digest(&native).unwrap(),
            final_copy::native_digest(&state).unwrap()
        );
    }
    let d = durable(&MemS3::new());
    let mut native = state;
    d.apply_entry(&mut native, op.mark.seq, &op.encoded)
        .unwrap();
    let before = final_copy::native_digest(&native).unwrap();
    assert!(
        d.apply_entry(&mut native, op.mark.seq, &op.encoded)
            .is_err()
    );
    assert_eq!(final_copy::native_digest(&native).unwrap(), before);
}

#[derive(Clone)]
struct ReadyProbe {
    inner: super::common::MemS3,
    calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    fail: bool,
}
impl server2::storage::ObjectTransport for ReadyProbe {
    async fn put(
        &self,
        _: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        Err(server2::storage::Error::Invalid("test control only"))
    }
    async fn head(&self, _: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        Err(server2::storage::Error::Invalid("test control only"))
    }
    async fn get(
        &self,
        _: &str,
        _: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        Err(server2::storage::Error::Invalid("test control only"))
    }
    async fn ready(&self) -> Result<(), server2::storage::Error> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.fail {
            Err(server2::storage::Error::Transport)
        } else {
            Ok(())
        }
    }
}
impl server2::storage::CatalogTransport for ReadyProbe {
    async fn get_control(
        &self,
        k: &str,
        n: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        server2::storage::CatalogTransport::get_control(&self.inner, k, n).await
    }
    async fn put_control(
        &self,
        k: &str,
        b: &[u8],
        c: &server2::storage::WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        server2::storage::CatalogTransport::put_control(&self.inner, k, b, c).await
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        Err(server2::storage::Error::Invalid("test control only"))
    }
}
#[tokio::test]
async fn exact_encoded_entry_boundary_precedes_credentials_and_same_bytes_reach_store() {
    use super::common::MemS3;
    use server2::push::{Counters, Durable, DurableConfig, durable::Commit};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let (state, b) = one_state();
    let p = final_copy::plan(&state, &b).unwrap();
    let op = Operation::prepare(&p).unwrap();
    let s3 = MemS3::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut d = Durable::new(
        Arc::new(ReadyProbe {
            inner: s3.clone(),
            calls: calls.clone(),
            fail: false,
        }),
        DurableConfig {
            entry_bytes: op.encoded.len() - 1,
            ..DurableConfig::default()
        },
        Arc::new(Counters::default()),
    );
    assert_eq!(
        d.commit_final(op.mark.seq, &op.encoded).await,
        Commit::Rejected
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(s3.put_count(""), 0);
    d.config.entry_bytes = op.encoded.len();
    assert_eq!(
        d.commit_final(op.mark.seq, &op.encoded).await,
        Commit::Committed
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        s3.body(&server2::push::durable::journal_key(op.mark.seq))
            .unwrap(),
        op.encoded
    );
    let s3 = MemS3::new();
    let mut d = Durable::new(
        Arc::new(ReadyProbe {
            inner: s3.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
            fail: true,
        }),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    assert_eq!(
        d.commit_final(op.mark.seq, &op.encoded).await,
        Commit::Rejected
    );
    assert_eq!(s3.put_count(""), 0);
}
#[tokio::test]
async fn final_commit_faults_keep_reject_conflict_void_and_unknown_distinct() {
    use super::common::{Fault, MemS3};
    use server2::push::durable::{Commit, journal_key};
    let (state, b) = one_state();
    let p = final_copy::plan(&state, &b).unwrap();
    let op = Operation::prepare(&p).unwrap();
    for (fault, expected, puts) in [
        (Fault::Reject(403), Commit::Rejected, 1),
        (Fault::Reject(412), Commit::Conflict, 1),
        (Fault::CommitLost, Commit::Committed, 1),
        (Fault::Lost, Commit::Voided, 2),
        (Fault::LostUnreadable, Commit::Failed, 1),
        (Fault::CommitLostUnreadable, Commit::Failed, 1),
    ] {
        let s3 = MemS3::new();
        let key = journal_key(op.mark.seq);
        s3.fault_put(&key, fault.clone());
        let mut d = durable(&s3);
        assert_eq!(
            d.commit_final(op.mark.seq, &op.encoded).await,
            expected,
            "fault {fault:?}"
        );
        assert_eq!(s3.put_count(&key), puts);
        if matches!(fault, Fault::LostUnreadable) {
            assert_eq!(
                d.settle_final(op.mark.seq, &op.encoded).await,
                Commit::Voided
            );
            assert_eq!(s3.put_count(&key), 2);
        }
        if matches!(fault, Fault::CommitLostUnreadable) {
            assert_eq!(
                d.settle_final(op.mark.seq, &op.encoded).await,
                Commit::Committed
            );
            assert_eq!(s3.put_count(&key), 1);
        }
        if let Some(body) = s3.body(&key)
            && body != op.encoded
        {
            let first = body.split(|b| *b == b'\n').next().unwrap();
            let header: serde_json::Value = serde_json::from_slice(first).unwrap();
            assert_eq!(
                header["void"], true,
                "only a distinct void may replace an absent original"
            );
        }
    }
}
#[tokio::test]
async fn committed_finalization_does_not_become_not_applied_on_snapshot_failure() {
    use super::common::{Fault, MemS3};
    let s3 = MemS3::new();
    let b = seed_one(&s3).await;
    let p = final_copy::preview(&mut durable(&s3), &b).await.unwrap();
    let op = Operation::prepare(&p).unwrap();
    s3.fault_put("index/v2/push/state/head.json", Fault::Reject(403));
    let result = final_copy::apply(&mut durable(&s3), &b, &op).await.unwrap();
    assert_eq!(result.status, "COMMITTED");
    assert!(result.snapshot_pending);
    assert_eq!(
        final_copy::verify(&mut durable(&s3), &op)
            .await
            .unwrap()
            .status,
        "VERIFIED"
    );
}
#[test]
fn planner_updates_only_unchanged_imports_and_keeps_native_tombstones() {
    let (mut s, mut b) = one_state();
    let updated = ONE.replace("synthetic-one", "synthetic-source-update");
    b.final_export.collections[0] = export("pushes", &updated);
    let p = final_copy::plan(&s, &b).unwrap();
    assert_eq!(p.counts.updated, 1);
    assert_eq!(p.changes[0].n, 0);
    let mut record = s.alarms.get(0).unwrap().unwrap();
    record.doc.set("name", "native edit");
    s.alarms.put(0, record).unwrap();
    b.final_export.collections[0] = export("pushes", ONE);
    let p = final_copy::plan(&s, &b).unwrap();
    assert_eq!(p.counts.native_modified_kept, 1);
    assert!(p.changes.is_empty());
    s.alarms.remove(0);
    s.alarms.mark_deleted([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    let p = final_copy::plan(&s, &b).unwrap();
    assert_eq!(p.counts.native_deleted_kept, 1);
    assert!(p.changes.is_empty());
}
