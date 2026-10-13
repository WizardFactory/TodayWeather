//! Offline legacy export conversion, import with provenance/revisions and legacy read projection.
use super::support::*;
use server2::history::legacy::{
    self, ExportKey, LegacyError, LegacyKind, SeedFile, current_rows, minute_rows, parse_seed,
    record_documents,
};
use server2::storage::{CatalogLimits, CatalogStore, LookupOutcome, ProviderKey, sha256};
use std::path::Path;

const EXPORTED: &str = "2026-09-24T02:10:00.000Z";
const EXPORTED_MS: u64 = 1_790_215_800_000;

fn lines(name: &str) -> Vec<Vec<u8>> {
    fixture(name)
        .split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .map(<[u8]>::to_vec)
        .collect()
}
fn run(collection: &str, version: &str, input: &str, exported: &str) -> Vec<u8> {
    let out = temp_path(&format!("{collection}-{exported}"));
    let input = fixture_path(input);
    let (code, stdout, stderr) = convert(&[
        "--collection",
        collection,
        "--db-version",
        version,
        "--exported-at",
        exported,
        "--input",
        input.to_str().unwrap(),
        "--output",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    std::fs::read(out).unwrap()
}
fn seed(collection: &str, version: &str, input: &str, exported: &str) -> SeedFile {
    parse_seed(&run(collection, version, input, exported)).unwrap()
}

#[test]
fn legacy_converter_keeps_document_bytes_order_and_provenance() {
    let bytes = run(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        EXPORTED,
    );
    let text = String::from_utf8(bytes.clone()).unwrap();
    let out: Vec<&str> = text.lines().collect();
    assert_eq!(out.len(), 3, "manifest and two key groups");
    let manifest: serde_json::Value = serde_json::from_str(out[0]).unwrap();
    assert_eq!(manifest["schema"], 1);
    assert_eq!(manifest["tool"], "export_history_seeds");
    assert_eq!(manifest["collection"], "kma.town.current");
    assert_eq!(manifest["dbVersion"], "2.0");
    assert_eq!(manifest["exportedAt"], EXPORTED);
    assert_eq!(
        manifest["sourceSha256"],
        sha256(&fixture("kma.town.current.v2.jsonl")).as_str()
    );
    assert_eq!(
        (manifest["documents"].as_u64(), manifest["groups"].as_u64()),
        (Some(5), Some(2))
    );
    let parsed = parse_seed(&bytes).unwrap();
    assert_eq!(parsed.kind, LegacyKind::TownCurrent);
    assert_eq!(parsed.manifest.exported_at_ms, EXPORTED_MS);
    assert_eq!(parsed.groups[0].key, ExportKey::Grid(g(60, 127)));
    assert_eq!(parsed.groups[1].key, ExportKey::Grid(g(61, 127)));
    // Group documents are the original export lines byte for byte, in file order.
    let input = lines("kma.town.current.v2.jsonl");
    let acquisitions = legacy::acquisitions(&parsed, &CatalogLimits::default()).unwrap();
    let first = record_documents(&acquisitions[0].records[0].bytes).unwrap();
    assert_eq!(
        first.documents,
        vec![
            input[0].clone(),
            input[1].clone(),
            input[3].clone(),
            input[4].clone()
        ]
    );
    assert_eq!(first.lines, vec![1, 2, 4, 5]);
    let second = record_documents(&acquisitions[1].records[0].bytes).unwrap();
    assert_eq!(second.documents, vec![input[2].clone()]);
}

#[test]
fn legacy_converter_rejects_arrays_foreign_collections_and_personal_fields() {
    for (collection, version, input, needle) in [
        (
            "kma.town.current",
            "2.0",
            "bad-array.json",
            "one document per line",
        ),
        ("kma.town.current", "2.0", "bad-personal.jsonl", "lat"),
        ("kma.town.current", "2.0", "bad-row-field.jsonl", "deviceId"),
        ("push", "2.0", "kma.town.current.v2.jsonl", "collection"),
        (
            "kma.town.current",
            "1.0",
            "kma.town.current.v2.jsonl",
            "db version",
        ),
        ("current", "1.0", "kma.town.current.v2.jsonl", "fcsDate"),
        (
            "kma.town.current",
            "2.0",
            "bad-duplicate-key.jsonl",
            "duplicate member name",
        ),
        ("KmaStnMinute2", "2.0", "bad-station-id.jsonl", "32-bit"),
        (
            "short",
            "1.0",
            "bad-daily-metadata.jsonl",
            "invalid __v in dailySource",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-nan.jsonl",
            "non-JSON numeric constant",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-overflow.jsonl",
            "number out of range",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-long.jsonl",
            "non-scalar field 't1h'",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-digits.jsonl",
            "number out of range",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-grammar.jsonl",
            "non-scalar field 't1h'",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-number-newline.jsonl",
            "non-scalar field 't1h'",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-date-newline.jsonl",
            "fcsDate and pubDate",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-date-unicode.jsonl",
            "fcsDate and pubDate",
        ),
        (
            "kma.town.current",
            "2.0",
            "bad-date-range.jsonl",
            "fcsDate and pubDate",
        ),
    ] {
        let out = temp_path(&format!("reject-{collection}-{input}"));
        let _ = std::fs::remove_file(&out);
        let input_path = fixture_path(input);
        let (code, _, stderr) = convert(&[
            "--collection",
            collection,
            "--db-version",
            version,
            "--exported-at",
            EXPORTED,
            "--input",
            input_path.to_str().unwrap(),
            "--output",
            out.to_str().unwrap(),
        ]);
        assert_eq!(code, 2, "{collection} {input}: {stderr}");
        assert!(stderr.contains(needle), "{needle} not in {stderr}");
        assert!(!Path::new(&out).exists(), "no output on failure");
    }
    // An export instant whose KST date leaves the supported range is refused.
    let out = temp_path("reject-exported-range");
    let input_path = fixture_path("kma.town.current.v2.jsonl");
    let (code, _, stderr) = convert(&[
        "--collection",
        "kma.town.current",
        "--db-version",
        "2.0",
        "--exported-at",
        "9999-12-31T23:59:00Z",
        "--input",
        input_path.to_str().unwrap(),
        "--output",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("supported range"), "{stderr}");
}

#[test]
fn legacy_seed_parser_rejects_tampered_seeds() {
    let good = String::from_utf8(run(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        EXPORTED,
    ))
    .unwrap();
    for tampered in [
        good.replacen(
            r#""mCoord":{"mx":60,"my":127},"#,
            r#""mCoord":{"mx":60,"my":127},"token":"t","#,
            1,
        ),
        good.replacen(
            r#""collection":"kma.town.current""#,
            r#""collection":"push""#,
            1,
        ),
        good.replacen(r#""documents":5"#, r#""documents":6"#, 1),
        good.replacen(
            r#""key":{"type":"grid","nx":61,"ny":127}"#,
            r#""key":{"type":"grid","nx":62,"ny":127}"#,
            1,
        ),
        good.replacen(r#""dbVersion":"2.0""#, r#""dbVersion":"1.0""#, 1),
        good.replacen("\n", "\r\n", 1),
        // A repeated member name could hide a personal field behind the value kept by a parser.
        good.replacen(
            r#""t1h":21.3"#,
            r#""t1h":{"deviceId":"PRIVATE"},"t1h":21.3"#,
            1,
        ),
        // Out-of-range instants are refused before any KST conversion.
        good.replacen(
            r#""pubDate":{"$date":"2026-09-24T01:00:00Z"}"#,
            r#""pubDate":{"$date":{"$numberLong":"9223372036854775807"}}"#,
            1,
        ),
        good.replacen(EXPORTED, "9999-12-31T23:59:00.000Z", 1),
        // Numbers the converter refuses are refused by the importer too.
        good.replacen(r#""t1h":21.3"#, r#""t1h":NaN"#, 1),
        good.replacen(r#""t1h":21.3"#, r#""t1h":1e400"#, 1),
        good.replacen(
            r#""t1h":21.3"#,
            r#""t1h":{"$numberLong":"9223372036854775808"}"#,
            1,
        ),
        good.replacen(
            r#""t1h":21.3"#,
            &format!(r#""t1h":1{}"#, "0".repeat(400)),
            1,
        ),
        good.replacen(r#""t1h":21.3"#, r#""t1h":{"$numberLong":"1_0"}"#, 1),
        good.replacen(r#""t1h":21.3"#, r#""t1h":{"$numberDouble":" 1.0"}"#, 1),
        good.replacen(r#""t1h":21.3"#, r#""t1h":{"$numberLong":"10\n"}"#, 1),
        good.replacen(
            r#""pubDate":{"$date":"2026-09-24T01:00:00Z"}"#,
            r#""pubDate":{"$date":"2026-09-24T01:00:00Z\n"}"#,
            1,
        ),
        good.replacen(
            r#""pubDate":{"$date":"2026-09-24T01:00:00Z"}"#,
            "\"pubDate\":{\"$date\":\"\u{ff12}\u{ff10}\u{ff12}\u{ff16}-09-24T01:00:00Z\"}",
            1,
        ),
        // Metadata fields must hold their legacy types.
        good.replacen(r#""__v":0"#, r#""__v":"token""#, 1),
    ] {
        assert!(tampered != good);
        assert!(
            matches!(
                parse_seed(tampered.as_bytes()),
                Err(LegacyError::Invalid(_))
            ),
            "{tampered}"
        );
    }
}

#[test]
fn legacy_records_carry_identity_and_exact_seed_lines() {
    let bytes = run(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        EXPORTED,
    );
    let text = String::from_utf8(bytes.clone()).unwrap();
    let out: Vec<&str> = text.lines().collect();
    let parsed = parse_seed(&bytes).unwrap();
    let acquisitions = legacy::acquisitions(&parsed, &CatalogLimits::default()).unwrap();
    assert_eq!(acquisitions.len(), 2);
    let record = &acquisitions[0].records[0];
    let id = &record.envelope.identity;
    assert_eq!(
        (id.source.as_str(), id.kind.as_str()),
        ("legacy-mongo", "kma-town-current")
    );
    assert_eq!(
        id.key_sha256,
        sha256(
            &ProviderKey::Grid { nx: 60, ny: 127 }
                .canonical_bytes()
                .unwrap()
        )
    );
    assert_eq!(
        (id.period.local_date, id.period.slot.as_str()),
        (20260924, "1110")
    );
    assert_eq!(id.fetched_at_ms, EXPORTED_MS);
    assert_eq!(record.envelope.content_type, "application/json");
    assert_eq!(
        &record.bytes[..],
        format!("{}\n{}\n", out[0], out[1]).as_bytes()
    );
    assert_eq!(
        acquisitions[0].declaration.partitions[0].partition,
        legacy::partition(EXPORTED_MS).unwrap()
    );
    assert_eq!(legacy::partition(EXPORTED_MS).unwrap(), "20260924-1110");
    assert_eq!(
        LegacyKind::from_collection("KmaStnMinute2"),
        Some(LegacyKind::StnMinute2)
    );
    assert_eq!(LegacyKind::StnHourly2.kind(), "kma-stn-hourly2");
    assert_eq!(LegacyKind::CurrentV1.kind(), "current-v1");
    assert_eq!(LegacyKind::from_collection("modelPush"), None);
}

#[test]
fn legacy_current_rows_reproduce_the_legacy_read_projection() {
    let v2 = seed(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        EXPORTED,
    );
    let a = legacy::acquisitions(&v2, &CatalogLimits::default()).unwrap();
    let docs = record_documents(&a[0].records[0].bytes).unwrap().documents;
    assert_eq!(
        String::from_utf8(current_rows(LegacyKind::TownCurrent, &docs).unwrap()).unwrap(),
        String::from_utf8(fixture("expected-current-v2.json")).unwrap()
    );
    let v1 = seed("current", "1.0", "current.v1.jsonl", EXPORTED);
    let a = legacy::acquisitions(&v1, &CatalogLimits::default()).unwrap();
    let docs = record_documents(&a[0].records[0].bytes).unwrap().documents;
    assert_eq!(docs.len(), 2, "both legacy documents are retained");
    assert_eq!(
        String::from_utf8(current_rows(LegacyKind::CurrentV1, &docs).unwrap()).unwrap(),
        String::from_utf8(fixture("expected-current-v1.json")).unwrap()
    );
    assert!(current_rows(LegacyKind::StnMinute2, &docs).is_err());
}

#[test]
fn legacy_minute_rows_use_the_twenty_minute_window() {
    let s = seed("KmaStnMinute2", "2.0", "KmaStnMinute2.jsonl", EXPORTED);
    assert_eq!(s.groups[0].key, ExportKey::Station(108));
    assert_eq!(s.groups[1].key, ExportKey::Station(112));
    let a = legacy::acquisitions(&s, &CatalogLimits::default()).unwrap();
    let docs = record_documents(&a[0].records[0].bytes).unwrap().documents;
    let input = lines("KmaStnMinute2.jsonl");
    // Anchor 09:25 (KST wall clock stored in UTC fields): rows strictly after 09:05, by date.
    let after = 1_790_240_700_000; // 2026-09-24T09:05:00Z
    assert_eq!(
        minute_rows(&docs, 108, after).unwrap(),
        vec![input[4].clone(), input[3].clone()]
    );
    assert!(minute_rows(&docs, 112, after).unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_import_retains_every_export_revision_in_s3() {
    let peer = Peer::new();
    let store = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let first = seed(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        EXPORTED,
    );
    let second = seed(
        "kma.town.current",
        "2.0",
        "kma.town.current.v2.jsonl",
        "2026-09-24T03:10:00.000Z",
    );
    let report = legacy::import(&store, &first, deadline()).await.unwrap();
    assert_eq!((report.groups, report.documents), (2, 5));
    legacy::import(&store, &second, deadline()).await.unwrap();
    // Repeating an identical import is idempotent.
    legacy::import(&store, &first, deadline()).await.unwrap();
    let input = lines("kma.town.current.v2.jsonl");
    for exported in [EXPORTED_MS, EXPORTED_MS + 3_600_000] {
        let id = legacy::catalog_id(
            LegacyKind::TownCurrent,
            ExportKey::Grid(g(60, 127)),
            exported,
        )
        .unwrap();
        let cold = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
        let set = match cold.lookup(&id, deadline()).await.unwrap() {
            LookupOutcome::Ready(set) => set,
            LookupOutcome::Incomplete => panic!("export catalog incomplete"),
        };
        assert_eq!(
            set.acquisitions().len(),
            1,
            "idempotent re-import adds no revision"
        );
        let record = &set.acquisitions()[0].records()[0];
        assert_eq!(record.envelope.identity.fetched_at_ms, exported);
        let docs = record_documents(&record.bytes).unwrap().documents;
        assert_eq!(
            docs,
            vec![
                input[0].clone(),
                input[1].clone(),
                input[3].clone(),
                input[4].clone()
            ]
        );
    }
}
