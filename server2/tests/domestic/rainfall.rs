//! F2 regression through the existing S3Source/KmaStore interfaces. Every object belongs to the
//! owned loopback peer; the schema1 checkpoint is ordinary JSON, with no new runtime test hook.
use super::source_s3::{Peer, S3_PEERS, Unreachable, deadline, request, seed as seed_forecasts};
use serde_json::{Value, json};
use server2::domestic::kma::{
    KmaStore, TownModel,
    backend::{KmaSource, SourceAnswer},
    source::{S3Source, Val, pages, seed, stations::RowStore},
};
use server2::domestic::publication::{Publication, current_base};
use server2::gateway::OrderedJson;
use server2::history::{Grid, schedule};
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, GroupDeclaration, GroupMember,
    HttpS3Transport, ProviderKey, RawRecord, WriteCondition, sha256,
};
use server2::world::BoundedS3;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use std::time::Duration;

type Transport = BoundedS3<HttpS3Transport>;
const DAY: u32 = 20261017;
const OID: &str = "000000000000000000000108";
const STATE_KEY: &str = "index/v2/statistics/rns/state.json";
const POLICY: &str = "flat-minute-rnshit-v1";
const SEED_ADDRESS: &str = "owned-rainfall-2819-seoul";

fn publication(time: u16) -> Publication {
    Publication::new(DAY, time).unwrap()
}
fn utc(time: u16) -> i64 {
    schedule::to_ms(publication(time))
}
fn digest(value: Value) -> String {
    sha256(&serde_json::to_vec(&value).unwrap())
}
fn seed_bytes() -> Vec<u8> {
    let line = serde_json::to_string(&json!({
        "_id": {"$oid": OID}, "stnId": "108", "stnName": "서울",
        "addr": SEED_ADDRESS, "isCityWeather": true,
        "altitude": 86, "geo": [126.9658, 37.5714], "__v": 0,
        "rnsHit": 3, "rnsCount": 4, "isMountain": false
    }))
    .unwrap()
        + "\n";
    let manifest = json!({
        "schema": 1, "tool": "export_station_seeds", "collection": "kmastninfos",
        "exportedAt": "2026-10-16T00:00:00.000Z", "documents": 1,
        "sourceSha256": sha256(line.as_bytes())
    });
    format!("{}\n{line}", serde_json::to_string(&manifest).unwrap()).into_bytes()
}
fn checkpoint(bytes: &[u8]) -> Vec<u8> {
    let imported = seed::parse(bytes).unwrap();
    let seed_hash = sha256(bytes);
    serde_json::to_vec(&json!({
        "schema": 1, "revision": 1,
        "activation": {
            "epoch": sha256(b"owned-rainfall-handover-2819"), "policy": POLICY,
            "target": {"bucket": "server2-local", "region": "ap-northeast-2"},
            "source": {"store": "mongo", "database": "owned-test", "collection": "kmastninfos"},
            "seed_body_sha256": seed_hash,
            "seed_source_sha256": imported.source_sha256,
            "seed_exported_at_ms": imported.exported_at_ms, "seed_documents": 1,
            "seed_identity_sha256": digest(json!(["rns-identities-v1", [OID]])),
            "baseline_sha256": digest(json!(["rns-baseline-v1", seed_hash, [[OID, 3.0, 4.0]]])),
            "shutdown_at_ms": imported.exported_at_ms - 60_000,
            "shutdown_evidence_sha256": sha256(b"synthetic-owned-test-shutdown-proof"),
            "first_end_ms": pages::page_date("2026.10.17.10:00") as u64,
            "first_end_basis": "full-post-shutdown-hour", "legacy_highwater_ms": null
        },
        "rows": [{"oid": OID, "rns_hit": 3.0, "rns_count": 4.0,
                  "last_end_ms": null, "receipt": null}]
    }))
    .unwrap()
}
fn current_page() -> Vec<u8> {
    let values = [
        ("PTY", "1"),
        ("RN1", "0.5"),
        ("T1H", "18"),
        ("REH", "60"),
        ("UUU", "1.2"),
        ("VEC", "200"),
        ("VVV", "-0.5"),
        ("WSD", "2.1"),
    ];
    let items: Vec<Value> = values
        .iter()
        .map(|(category, value)| {
            json!({
                "baseDate": DAY.to_string(), "baseTime": "1000", "category": category,
                "nx": 60, "ny": 127, "obsrValue": value
            })
        })
        .collect();
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items},
                 "pageNo": 1, "numOfRows": 999, "totalCount": items.len()}
    }}))
    .unwrap()
}
fn minute_page(at: Publication, rain: bool) -> Vec<u8> {
    let mark = if rain {
        "<font color=blue>●</font>"
    } else {
        "<font color=red>○</font>"
    };
    let columns = [
        "108",
        "서울",
        "86m",
        mark,
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "18.4",
        "270.1",
        "W",
        "1.2",
        "265.0",
        "WSW",
        "1.4",
        "61",
        "1013.2",
        "서울특별시 종로구 송월동",
    ];
    let cells: String = columns.iter().map(|c| format!("<td>{c}</td>")).collect();
    let html = format!(
        concat!(
            r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
            "\n",
            r#"<span class=ehead>[ 매분관측자료 ] 2026.10.17.{:02}:{:02}</span>"#,
            "\n",
            r#"<table border=0 cellspacing=0 cellpadding=0><tr><td bgcolor=#999999><table border=0 cellspacing=1 cellpadding=1>"#,
            "\n",
            r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#,
            "\n",
            r#"<tr align=center class=text>{cells}</tr>"#,
            "\n",
            r#"</table></td></tr></table></BODY></HTML>"#
        ),
        at.hour(),
        at.minute(),
        cells = cells
    );
    encoding_rs::EUC_KR.encode(&html).0.into_owned()
}
async fn publish_record(store: &CatalogStore<Transport>, record: RawRecord) {
    let id = &record.envelope.identity;
    let partition = if id.kind == "ultra-srt-ncst" {
        format!("{}-{}", id.period.local_date, id.period.slot)
    } else {
        id.period.local_date.to_string()
    };
    let member = GroupMember {
        catalogs: vec![CatalogId::for_record(&record.envelope.identity, &partition).unwrap()],
        envelope: record.envelope.clone(),
    };
    store
        .publish(
            GroupDeclaration::new(vec![member], &CatalogLimits::default()).unwrap(),
            vec![record],
            deadline(),
        )
        .await
        .unwrap();
}
#[allow(clippy::too_many_arguments)]
fn record(
    source: &str,
    kind: &str,
    key: &ProviderKey,
    at: Publication,
    fetched: u64,
    body: Vec<u8>,
    content_type: &str,
) -> RawRecord {
    RawRecord::new(
        source,
        kind,
        key,
        at.period(),
        fetched,
        200,
        content_type,
        None,
        body.into(),
        &CatalogLimits::default().raw,
    )
    .unwrap()
}
async fn prepare(peer: &Peer, active: bool) {
    eprintln!(
        "rainfall owned peer endpoint={} active={active}",
        peer.endpoint()
    );
    let transport = peer.transport_limited(4);
    let store = CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap();
    // Reuse the existing owned forecast-zone fixture; other sections may legitimately be empty.
    seed_forecasts(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let bytes = seed_bytes();
    let acquired = seed::acquisition(&bytes).unwrap();
    store
        .publish(acquired.declaration, acquired.records, deadline())
        .await
        .unwrap();
    let current = record(
        "data-go-kr",
        "ultra-srt-ncst",
        &Grid::new(60, 127).unwrap().provider_key(),
        publication(1000),
        utc(1040) as u64,
        current_page(),
        "application/json",
    );
    eprintln!(
        "rainfall current identity: {}",
        serde_json::to_string(&current.envelope.identity).unwrap()
    );
    publish_record(&store, current).await;
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    let mut rows = RowStore::default();
    let mut identities = Vec::new();
    for offset in (2..=60).step_by(2).chain(std::iter::once(106)) {
        let at = schedule::from_ms(utc(900) + offset * 60_000);
        let body = minute_page(at, offset == 2);
        let parsed = pages::parse_aws(&body, None).expect("owned minute HTML must parse");
        assert_eq!(
            parsed.rows.len(),
            1,
            "one actual sensor row per raw acquisition"
        );
        assert_eq!(parsed.rows[0].get("rns"), Some(&Val::Bool(offset == 2)));
        rows.save(&parsed.rows);
        let raw = record(
            "kma-web",
            "aws-minute",
            &key,
            at,
            (schedule::to_ms(at) + 30_000) as u64,
            body,
            "text/html;charset=euc-kr",
        );
        identities.push(raw.envelope.identity.clone());
        publish_record(&store, raw).await;
    }
    let end = pages::page_date("2026.10.17.10:00");
    let window: Vec<_> = rows
        .after(108., end - 3_600_000.)
        .into_iter()
        .filter(|r| server2::domestic::kma::source::stations::date_of(r) <= end)
        .collect();
    assert_eq!(
        window.len(),
        30,
        "statistics window contains 30 actual unique minutes"
    );
    assert_eq!(
        window
            .iter()
            .filter(|r| r.get("rns") == Some(&Val::Bool(true)))
            .count(),
        1
    );
    assert_eq!(
        server2::domestic::kma::source::stations::date_of(&window[0]),
        pages::page_date("2026.10.17.09:02")
    );
    assert_eq!(
        identities.len(),
        31,
        "10:46 false is only a public station-path input"
    );
    eprintln!(
        "rainfall minute identities: {}",
        serde_json::to_string(&identities).unwrap()
    );
    eprintln!("rainfall seed sha256: {}", sha256(&bytes));
    if active {
        let body = checkpoint(&bytes);
        assert_eq!(
            transport
                .put_control(STATE_KEY, &body, &WriteCondition::Absent)
                .await
                .unwrap(),
            200
        );
        assert_eq!(
            transport
                .get_control(STATE_KEY, 1024 * 1024)
                .await
                .unwrap()
                .body,
            body
        );
    }
}
async fn snapshot<T: server2::history::IndexListing + Clone + Send + Sync + 'static>(
    source: &S3Source<T>,
) -> Box<dyn KmaStore + Send> {
    match source.snapshot(&request(), deadline()).await {
        SourceAnswer::Snapshot(store) => store,
        SourceAnswer::Forward(reason) | SourceAnswer::Failed(reason) => {
            panic!("snapshot setup: {reason}")
        }
    }
}
async fn station<T: server2::history::IndexListing + Clone + Send + Sync + 'static>(
    source: &S3Source<T>,
) -> OrderedJson {
    // Existing source initialization is owned and may finish after an early snapshot on slow CI.
    // Wait only for observable fixture readiness, never for the desired counter value.
    for _ in 0..12 {
        let store = snapshot(source).await;
        let currents = store
            .town_model(TownModel::Current, &json!(60), &json!(127))
            .unwrap();
        let OrderedJson::Array(current) = currents else {
            panic!("Current array")
        };
        let current = current
            .last()
            .expect("published canonical Current is visible")
            .get("currentData")
            .expect("existing Current document projection");
        assert_eq!(
            current.get("date").and_then(OrderedJson::string).as_deref(),
            Some("20261017")
        );
        assert_eq!(
            current.get("time").and_then(OrderedJson::string).as_deref(),
            Some("1000")
        );
        assert_eq!(current.get("pty").unwrap().to_bytes(), b"1");
        let town = json!({"gCoord": {"lon": 126.9658, "lat": 37.5714}});
        if let Ok(result) = store.stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
            && result.get("addr").and_then(OrderedJson::string).as_deref() == Some(SEED_ADDRESS)
        {
            assert_eq!(
                result.get("rns").unwrap(),
                &OrderedJson::Bool(false),
                "public fold excludes the old true row"
            );
            return result;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("station fixture did not become readable; not a rainfall counter Red");
}
async fn put_count(peer: &Peer) -> u64 {
    let response = reqwest::get(format!("{}__catalog/status", peer.endpoint()))
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let status: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    status
        .get(format!("PUT {STATE_KEY}"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}
fn counters(station: &OrderedJson) -> (Vec<u8>, Vec<u8>) {
    (
        station.get("rnsHit").expect("imported seed hit").to_bytes(),
        station
            .get("rnsCount")
            .expect("imported seed count")
            .to_bytes(),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn inactive_authority_preserves_seed_and_never_puts_rainfall_state() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, false).await;
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| utc(1047) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        counters(&station(&source).await),
        (b"3".to_vec(), b"4".to_vec())
    );
    assert_eq!(
        put_count(&peer).await,
        0,
        "inactive runtime must never create authority"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn activated_canonical_current_counts_full_hour_once_beyond_public_minute_fold() {
    let _peers = S3_PEERS.lock().await;
    assert_eq!(
        current_base(utc(1017)),
        Some(publication(900)),
        "10:17 cannot select normal 10:00 Current"
    );
    assert_eq!(current_base(utc(1047)), Some(publication(1000)));
    assert_eq!(current_base(utc(1048)), Some(publication(1000)));
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let clock = Arc::new(AtomicI64::new(utc(1047)));
    let read_clock = clock.clone();
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(move || read_clock.load(Ordering::SeqCst) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap();
    let first = station(&source).await;
    // Intended behavior Red: the baseline ignores the ordinary checkpoint and returns (3, 4).
    assert_eq!(
        counters(&first),
        (b"4".to_vec(), b"5".to_vec()),
        "activated rainy canonical 10:00 Current must count the complete (09:00,10:00] window"
    );
    clock.store(utc(1048), Ordering::SeqCst);
    assert_eq!(
        counters(&station(&source).await),
        (b"4".to_vec(), b"5".to_vec()),
        "a new request minute with the same canonical Current must not count twice"
    );
    assert_eq!(
        counters(&first),
        (b"4".to_vec(), b"5".to_vec()),
        "delivered station value stays immutable"
    );
    assert_eq!(
        put_count(&peer).await,
        2,
        "one fixture activation plus one native statistics batch"
    );
}

#[test]
fn checkpoint_requires_exact_recursive_schema_and_original_seed_identity() {
    use server2::domestic::kma::source::rainfall_store::{Checkpoint, Namespace};
    let bytes = seed_bytes();
    let parsed = seed::parse(&bytes).unwrap();
    let target = Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap();
    let body = checkpoint(&bytes);
    assert!(Checkpoint::decode(&body, &parsed, &target).is_ok());
    let object: Value = serde_json::from_slice(&body).unwrap();
    for (case, body) in [
        ("unknown", {
            let mut v = object.clone();
            v["activation"]["extra"] = json!(true);
            serde_json::to_vec(&v).unwrap()
        }),
        ("required nullable", {
            let mut v = object.clone();
            v["rows"][0].as_object_mut().unwrap().remove("receipt");
            serde_json::to_vec(&v).unwrap()
        }),
        ("version", {
            let mut v = object.clone();
            v["schema"] = json!(2);
            serde_json::to_vec(&v).unwrap()
        }),
        ("target", {
            let mut v = object.clone();
            v["activation"]["target"]["bucket"] = json!("another-owned-bucket");
            serde_json::to_vec(&v).unwrap()
        }),
        ("source", {
            let mut v = object.clone();
            v["activation"]["source"]["store"] = json!("other");
            serde_json::to_vec(&v).unwrap()
        }),
        (
            "duplicate",
            String::from_utf8(body.clone())
                .unwrap()
                .replacen("\"schema\":1", "\"schema\":1,\"schema\":1", 1)
                .into_bytes(),
        ),
        ("early export", {
            let mut v = object.clone();
            v["activation"]["shutdown_at_ms"] = json!(parsed.exported_at_ms + 1);
            serde_json::to_vec(&v).unwrap()
        }),
        ("identity", {
            let mut v = object.clone();
            v["rows"][0]["oid"] = json!("000000000000000000000109");
            serde_json::to_vec(&v).unwrap()
        }),
    ] {
        assert!(
            Checkpoint::decode(&body, &parsed, &target).is_err(),
            "{case}"
        );
    }
}

#[test]
fn baseline_preserves_fractional_absent_counters_and_distinct_duplicate_station_ids() {
    use server2::domestic::kma::source::rainfall_store;
    let bytes = seed_bytes();
    let text = String::from_utf8(bytes).unwrap();
    let mut doc: Value = serde_json::from_str(text.lines().nth(1).unwrap()).unwrap();
    doc["rnsHit"] = json!(0.25);
    doc.as_object_mut().unwrap().remove("rnsCount");
    let mut second = doc.clone();
    second["_id"]["$oid"] = json!("000000000000000000000109");
    second["rnsCount"] = json!(-1.5);
    let file = |docs: Vec<Value>| {
        let lines = docs
            .iter()
            .map(|v| serde_json::to_string(v).unwrap() + "\n")
            .collect::<String>();
        format!("{}\n{lines}",json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos","documents":docs.len(),"sourceSha256":sha256(lines.as_bytes()),"exportedAt":"2026-10-16T00:00:00.000Z"})).into_bytes()
    };
    let distinct = seed::parse(&file(vec![doc.clone(), second])).unwrap();
    let rows = rainfall_store::baseline(&distinct).unwrap();
    assert_eq!(rows.len(), 2);
    assert_ne!(rows[0].oid, rows[1].oid);
    assert_eq!(rows[0].rns_hit, Some(0.25));
    assert_eq!(rows[0].rns_count, None);
    assert_eq!(rows[1].rns_count, Some(-1.5));
    assert!(
        rainfall_store::baseline(&seed::parse(&file(vec![doc.clone(), doc.clone()])).unwrap())
            .is_err()
    );
    doc.as_object_mut().unwrap().remove("_id");
    assert!(rainfall_store::baseline(&seed::parse(&file(vec![doc])).unwrap()).is_err());
}

#[test]
fn rust_exact_checkpoint_buffer_fits_full_1024_receipt_profile_and_rejects_overflow() {
    use server2::domestic::kma::source::rainfall_store::{
        self, Activation, Checkpoint, Namespace, Receipt, SAFE,
    };
    let one = String::from_utf8(seed_bytes()).unwrap();
    let template: Value = serde_json::from_str(one.lines().nth(1).unwrap()).unwrap();
    let mut lines = String::new();
    for i in 0..1024 {
        let mut d = template.clone();
        d["_id"]["$oid"] = json!(format!("{i:024x}"));
        lines += &(serde_json::to_string(&d).unwrap() + "\n");
    }
    let file=format!("{}\n{lines}",json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos","documents":1024,"sourceSha256":sha256(lines.as_bytes()),"exportedAt":"2026-10-16T00:00:00.000Z"})).into_bytes();
    let seed = seed::parse(&file).unwrap();
    let base = rainfall_store::baseline(&seed).unwrap();
    let object: Value = serde_json::from_slice(&checkpoint(&seed_bytes())).unwrap();
    let mut activation: Activation = serde_json::from_value(object["activation"].clone()).unwrap();
    activation.seed_body_sha256 = sha256(&file);
    activation.seed_source_sha256 = sha256(lines.as_bytes());
    activation.seed_documents = 1024;
    activation.seed_identity_sha256 = rainfall_store::identity_digest(&base);
    activation.baseline_sha256 = rainfall_store::baseline_digest(&seed, &base);
    let target = Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap();
    let mut state = Checkpoint::initial(activation, &seed, &target).unwrap();
    state.revision = 2;
    for row in &mut state.rows {
        row.rns_hit = Some(-(SAFE as f64));
        row.rns_count = Some(SAFE as f64);
        row.last_end_ms = Some(state.activation.first_end_ms);
        row.receipt = Some(Receipt {
            end_ms: state.activation.first_end_ms,
            cutoff_at_ms: SAFE,
            grid: [149, 253],
            current_sha256: "f".repeat(64),
            minute_sha256: "f".repeat(64),
            batch_sha256: "f".repeat(64),
            row_count: 60,
            sensor_count: 60,
            hit: true,
        });
    }
    let bytes = state.encode().unwrap();
    assert!(bytes.len() <= 1024 * 1024);
    assert!(Checkpoint::decode(&bytes, &seed, &target).is_ok());
    eprintln!(
        "rainfall exact Rust1024receipt bytes={} sha256={}",
        bytes.len(),
        sha256(&bytes)
    );
    state.activation.source.database = "x".repeat(1024 * 1024);
    assert!(
        state.encode().is_err(),
        "the exact would-be PUT buffer exceeds1MiB"
    );
}

fn enabled_source(peer: &Peer) -> S3Source<Transport> {
    S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| utc(1047) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap()
}
async fn fault(peer: &Peer, mode: &str) {
    let response = reqwest::Client::new()
        .post(format!(
            "{}__catalog?mode={mode}&key={STATE_KEY}",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 204);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn competing_owners_and_unknown_accepted_put_keep_one_cumulative_contribution() {
    let _peers = S3_PEERS.lock().await;
    for mode in ["barrier", "commit500", "drop-commit"] {
        let peer = Peer::persistent();
        prepare(&peer, true).await;
        fault(&peer, mode).await;
        let a = enabled_source(&peer);
        let b = enabled_source(&peer);
        if mode == "barrier" {
            let (a, b) = tokio::join!(station(&a), station(&b));
            assert_eq!(counters(&a), (b"4".to_vec(), b"5".to_vec()));
            assert_eq!(counters(&b), (b"4".to_vec(), b"5".to_vec()));
        } else {
            assert_eq!(counters(&station(&a).await), (b"4".to_vec(), b"5".to_vec()));
        }
        let restored = enabled_source(&peer);
        assert_eq!(
            counters(&station(&restored).await),
            (b"4".to_vec(), b"5".to_vec()),
            "restart {mode}"
        );
        let object = peer
            .transport()
            .get_control(STATE_KEY, 1024 * 1024)
            .await
            .unwrap();
        let state: Value = serde_json::from_slice(&object.body).unwrap();
        assert_eq!(state["revision"], 2);
        assert_eq!(state["rows"][0]["rns_count"], 5.0);
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn malformed_active_control_fails_station_reads_cold_and_warm() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let warm = enabled_source(&peer);
    let delivered = station(&warm).await;
    assert_eq!(counters(&delivered), (b"4".to_vec(), b"5".to_vec()));
    fault(&peer, "corrupt").await;
    for source in [&warm, &enabled_source(&peer)] {
        let store = snapshot(source).await;
        let town = json!({"gCoord":{"lon":126.9658,"lat":37.5714}});
        assert!(
            store
                .stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
                .is_err()
        );
        assert!(store.city_hourly(&town).is_err());
        assert!(store.summary_inputs().is_none());
        assert!(
            store
                .town_model(TownModel::Current, &json!(60), &json!(127))
                .is_ok(),
            "unrelated current remains usable"
        );
    }
    assert_eq!(
        counters(&delivered),
        (b"4".to_vec(), b"5".to_vec()),
        "previous immutable value does not change"
    );
}

#[derive(Clone)]
struct DelayedFirstPut {
    inner: Transport,
    first: Arc<std::sync::atomic::AtomicBool>,
    calls: Arc<std::sync::atomic::AtomicUsize>,
    release: Arc<tokio::sync::Notify>,
    done: Arc<tokio::sync::Notify>,
    outcome: Arc<std::sync::Mutex<Option<u16>>>,
    original: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
}
impl DelayedFirstPut {
    fn new(inner: Transport) -> Self {
        Self {
            inner,
            first: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            release: Arc::new(tokio::sync::Notify::new()),
            done: Arc::new(tokio::sync::Notify::new()),
            outcome: Arc::new(std::sync::Mutex::new(None)),
            original: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}
impl server2::storage::ObjectTransport for DelayedFirstPut {
    async fn put(
        &self,
        r: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        server2::storage::ObjectTransport::put(&self.inner, r).await
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::head(&self.inner, key).await
    }
    async fn get(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::get(&self.inner, key, maximum).await
    }
}
impl CatalogTransport for DelayedFirstPut {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        self.inner.get_control(key, maximum).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        if key == STATE_KEY {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.first.swap(false, Ordering::SeqCst) {
                let delayed = self.clone();
                let bytes = body.to_vec();
                let condition = condition.clone();
                *self.original.lock().unwrap() = Some(bytes.clone());
                tokio::spawn(async move {
                    delayed.release.notified().await;
                    let status = delayed
                        .inner
                        .put_control(STATE_KEY, &bytes, &condition)
                        .await
                        .unwrap();
                    *delayed.outcome.lock().unwrap() = Some(status);
                    delayed.done.notify_one();
                });
                return Err(server2::storage::Error::Transport);
            }
        }
        self.inner.put_control(key, body, condition).await
    }
}
impl server2::history::IndexListing for DelayedFirstPut {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<server2::storage::ListPage, server2::storage::Error> {
        server2::history::IndexListing::list_index(&self.inner, prefix, token).await
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn delayed_unknown_old_put_in_both_orders_never_replays_or_overwrites_fresh_state() {
    let _peers = S3_PEERS.lock().await;
    for old_first in [true, false] {
        let peer = Peer::persistent();
        prepare(&peer, true).await;
        let delayed = DelayedFirstPut::new(peer.transport_limited(4));
        let source = S3Source::new(
            delayed.clone(),
            Arc::new(|| utc(1047) as f64),
            Arc::new(Unreachable),
            Arc::new(Unreachable),
        )
        .unwrap()
        .with_rainfall(
            server2::domestic::kma::source::rainfall_store::Namespace::new(
                "server2-local".into(),
                "ap-northeast-2".into(),
            )
            .unwrap(),
        )
        .unwrap();
        let store = match source.snapshot(&request(), deadline()).await {
            SourceAnswer::Snapshot(s) => s,
            _ => panic!("normal snapshot setup"),
        };
        let town = json!({"gCoord":{"lon":126.9658,"lat":37.5714}});
        assert!(
            store
                .stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
                .is_err(),
            "unknown unacknowledged write cannot project counters"
        );
        assert_eq!(
            delayed.calls.load(Ordering::SeqCst),
            1,
            "original unknown buffer is never automatically resent"
        );
        assert!(
            delayed.original.lock().unwrap().is_some(),
            "qualified write reached delayed transport"
        );
        if old_first {
            delayed.release.notify_one();
            tokio::time::timeout(Duration::from_secs(2), delayed.done.notified())
                .await
                .unwrap();
            assert_eq!(*delayed.outcome.lock().unwrap(), Some(200));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        let fresh = enabled_source(&peer);
        assert_eq!(
            counters(&station(&fresh).await),
            (b"4".to_vec(), b"5".to_vec())
        );
        if !old_first {
            delayed.release.notify_one();
            tokio::time::timeout(Duration::from_secs(2), delayed.done.notified())
                .await
                .unwrap();
            assert_eq!(
                *delayed.outcome.lock().unwrap(),
                Some(412),
                "late old ETag must not overwrite a fresh commit"
            );
        }
        assert_eq!(delayed.calls.load(Ordering::SeqCst), 1);
        let state: Value = serde_json::from_slice(
            &peer
                .transport()
                .get_control(STATE_KEY, 1024 * 1024)
                .await
                .unwrap()
                .body,
        )
        .unwrap();
        assert_eq!(state["revision"], 2);
        assert_eq!(state["rows"][0]["rns_count"], 5.0);
        assert_eq!(
            counters(&station(&source).await),
            (b"4".to_vec(), b"5".to_vec()),
            "later fresh demand reconciles current acknowledged authority"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn full_replay_keeps_late_old_publication_revisions_missing_sensor_and_cutoff() {
    let _peers = S3_PEERS.lock().await;
    for variant in ["late-false", "late-omitted", "future-false"] {
        let peer = Peer::persistent();
        prepare(&peer, true).await;
        let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
        let at = publication(902);
        let mut body = minute_page(at, false);
        if variant == "late-omitted" {
            let text = encoding_rs::EUC_KR
                .decode(&body)
                .0
                .replace("<font color=red>○</font>", "-");
            body = encoding_rs::EUC_KR.encode(&text).0.into_owned();
            assert!(
                pages::parse_aws(&body, None).unwrap().rows[0]
                    .get("rns")
                    .is_none()
            );
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let fetched = if variant == "future-false" {
            now + 60_000
        } else {
            now - 2_000
        };
        let key = ProviderKey::Named {
            id: "aws-national".into(),
        };
        let raw = record(
            "kma-web",
            "aws-minute",
            &key,
            at,
            fetched,
            body,
            "text/html;charset=euc-kr",
        );
        eprintln!(
            "rainfall {variant} revision identity: {}",
            serde_json::to_string(&raw.envelope.identity).unwrap()
        );
        publish_record(&store, raw).await;
        // Keep the unchanged public minute loader's early-stop policy supplied with a recent row.
        publish_record(
            &store,
            record(
                "kma-web",
                "aws-minute",
                &key,
                publication(1046),
                now - 1_000,
                minute_page(publication(1046), false),
                "text/html;charset=euc-kr",
            ),
        )
        .await;
        let source = enabled_source(&peer);
        let expected = if variant == "late-false" {
            b"3".to_vec()
        } else {
            b"4".to_vec()
        };
        assert_eq!(
            counters(&station(&source).await),
            (expected, b"5".to_vec()),
            "{variant}: all selected immutable revisions replay, omitted sensors preserve old values, fetchedaftercutoff excluded"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn activated_seed_is_restored_exactly_after_newer_import_and_restart() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let original = enabled_source(&peer);
    assert_eq!(
        counters(&station(&original).await),
        (b"4".to_vec(), b"5".to_vec())
    );
    let before = peer
        .transport()
        .get_control(STATE_KEY, 1024 * 1024)
        .await
        .unwrap()
        .body;
    let original_bytes = seed_bytes();
    let text = String::from_utf8(original_bytes.clone()).unwrap();
    let mut row: Value = serde_json::from_str(text.lines().nth(1).unwrap()).unwrap();
    row["rnsHit"] = json!(100);
    row["rnsCount"] = json!(200);
    let line = serde_json::to_string(&row).unwrap() + "\n";
    let manifest = json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos","exportedAt":"2026-10-16T00:01:00.000Z","documents":1,"sourceSha256":sha256(line.as_bytes())});
    let newer_bytes = format!("{manifest}\n{line}").into_bytes();
    let newer = seed::parse(&newer_bytes).unwrap();
    assert!(newer.exported_at_ms > seed::parse(&original_bytes).unwrap().exported_at_ms);
    let acquisition = seed::acquisition(&newer_bytes).unwrap();
    CatalogStore::new(peer.transport_limited(4), CatalogLimits::default())
        .unwrap()
        .publish(acquisition.declaration, acquisition.records, deadline())
        .await
        .unwrap();
    eprintln!(
        "rainfall pinned old seed bodysha={} newer seed bodysha={}",
        sha256(&original_bytes),
        sha256(&newer_bytes)
    );
    let restarted = enabled_source(&peer);
    let store = snapshot(&restarted).await;
    let current = store
        .town_model(TownModel::Current, &json!(60), &json!(127))
        .unwrap();
    assert!(
        matches!(current,OrderedJson::Array(ref a) if !a.is_empty()),
        "canonicalCurrent setup remains available"
    );
    let town = json!({"gCoord":{"lon":126.9658,"lat":37.5714}});
    let read = store.stn_hourly_and_min_rns(&town, "202610171047", &json!({}));
    assert!(
        read.is_ok(),
        "active restart must restore exact finalseed rather than fail on newer import: {read:?}"
    );
    assert_eq!(
        counters(&read.unwrap()),
        (b"4".to_vec(), b"5".to_vec()),
        "newer100/200 import cannot reset authority"
    );
    assert_eq!(
        peer.transport()
            .get_control(STATE_KEY, 1024 * 1024)
            .await
            .unwrap()
            .body,
        before,
        "same Current does not rewrite authority"
    );
    assert_eq!(
        counters(&station(&restarted).await),
        (b"4".to_vec(), b"5".to_vec()),
        "same source stays pinned after exact restoration"
    );
    let old = seed::acquisition(&original_bytes).unwrap();
    let raw_key = old.records[0].envelope.identity.object_key().unwrap();
    let erased = reqwest::Client::new()
        .post(format!(
            "{}__catalog?mode=forget&key={raw_key}",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(erased.status().as_u16(), 204);
    let missing = enabled_source(&peer);
    let snapshot = snapshot(&missing).await;
    assert!(
        snapshot
            .stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
            .is_err(),
        "missing exact seed never falls back to the newer100/200 import"
    );
    assert!(snapshot.summary_inputs().is_none());
    assert_eq!(
        peer.transport()
            .get_control(STATE_KEY, 1024 * 1024)
            .await
            .unwrap()
            .body,
        before,
        "failed recovery never recreates/reset/rewrites authority"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn duplicate_station_documents_keep_original_order_and_increment_in_one_exact_grid_batch() {
    use server2::domestic::kma::source::rainfall_store::{
        self, Activation, Checkpoint, Namespace, Store,
    };
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, false).await;
    let original = String::from_utf8(seed_bytes()).unwrap();
    let first: Value = serde_json::from_str(original.lines().nth(1).unwrap()).unwrap();
    let mut second = first.clone();
    second["_id"]["$oid"] = json!("000000000000000000000109");
    second["rnsHit"] = json!(7);
    second["rnsCount"] = json!(9);
    second["isMountain"] = json!(true);
    let lines = serde_json::to_string(&first).unwrap()
        + "\n"
        + &serde_json::to_string(&second).unwrap()
        + "\n";
    let manifest = json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos","exportedAt":"2026-10-16T00:01:00.000Z","documents":2,"sourceSha256":sha256(lines.as_bytes())});
    let bytes = format!("{manifest}\n{lines}").into_bytes();
    let seed = seed::parse(&bytes).unwrap();
    let acquisition = seed::acquisition(&bytes).unwrap();
    CatalogStore::new(peer.transport_limited(4), CatalogLimits::default())
        .unwrap()
        .publish(acquisition.declaration, acquisition.records, deadline())
        .await
        .unwrap();
    let mut activation: Activation = serde_json::from_value(
        serde_json::from_slice::<Value>(&checkpoint(&seed_bytes())).unwrap()["activation"].clone(),
    )
    .unwrap();
    let base = rainfall_store::baseline(&seed).unwrap();
    activation.seed_body_sha256 = sha256(&bytes);
    activation.seed_source_sha256 = seed.source_sha256.clone();
    activation.seed_exported_at_ms = seed.exported_at_ms;
    activation.seed_documents = 2;
    activation.seed_identity_sha256 = rainfall_store::identity_digest(&base);
    activation.baseline_sha256 = rainfall_store::baseline_digest(&seed, &base);
    let target = Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap();
    let state = Checkpoint::initial(activation, &seed, &target).unwrap();
    Store {
        transport: peer.transport_limited(4),
        target,
    }
    .activate(&state, &seed, deadline())
    .await
    .unwrap();
    let source = enabled_source(&peer);
    let read = station(&source).await;
    assert_eq!(
        counters(&read),
        (b"4".to_vec(), b"5".to_vec()),
        "firstsame-distance originaldocument remains first"
    );
    assert!(read.get("_id").is_none());
    assert_eq!(read.get("isMountain"), Some(&OrderedJson::Bool(false)));
    let body = peer
        .transport()
        .get_control(STATE_KEY, 1024 * 1024)
        .await
        .unwrap()
        .body;
    let state: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(state["revision"], 2);
    assert_eq!(state["rows"].as_array().unwrap().len(), 2);
    assert_eq!(state["rows"][0]["rns_hit"], 4.0);
    assert_eq!(state["rows"][0]["rns_count"], 5.0);
    assert_eq!(state["rows"][1]["rns_hit"], 8.0);
    assert_eq!(state["rows"][1]["rns_count"], 10.0);
    assert_eq!(
        put_count(&peer).await,
        2,
        "activationplusonesame-gridbatch, notonewriteperOID"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn early_fetched_future_current_cannot_qualify_before_its_hour_40_availability() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let t = peer.transport_limited(4);
    let store = CatalogStore::new(t.clone(), CatalogLimits::default()).unwrap();
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    // Keep this contrived Current/fetch availability boundary separate from future public rows.
    let minute_catalog = CatalogId {
        source: "kma-web".into(),
        kind: "aws-minute".into(),
        key_sha256: sha256(&key.canonical_bytes().unwrap()),
        partition: DAY.to_string(),
    };
    let pinned = t
        .get_control(&minute_catalog.key(), 1024 * 1024)
        .await
        .unwrap();
    let mut catalog = server2::storage::Catalog::from_bytes(
        &pinned.body,
        &minute_catalog,
        &CatalogLimits::default(),
    )
    .unwrap();
    catalog.entries.retain(|e| e.identity.period.slot != "1046");
    catalog.generation += 1;
    assert_eq!(
        t.put_control(
            &minute_catalog.key(),
            &catalog.bytes(&CatalogLimits::default()).unwrap(),
            &WriteCondition::Match(pinned.etag)
        )
        .await
        .unwrap(),
        200
    );
    publish_record(
        &store,
        record(
            "kma-web",
            "aws-minute",
            &key,
            publication(1016),
            (utc(1016) + 30_000) as u64,
            minute_page(publication(1016), false),
            "text/html;charset=euc-kr",
        ),
    )
    .await;
    publish_record(
        &store,
        record(
            "data-go-kr",
            "ultra-srt-ncst",
            &Grid::new(60, 127).unwrap().provider_key(),
            publication(1000),
            utc(1010) as u64,
            current_page(),
            "application/json",
        ),
    )
    .await;
    let clock = Arc::new(AtomicI64::new(utc(1017)));
    let read_clock = clock.clone();
    let source = S3Source::new(
        t.clone(),
        Arc::new(move || read_clock.load(Ordering::SeqCst) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap();
    let snapshot = snapshot(&source).await;
    let model = snapshot
        .town_model(TownModel::Current, &json!(60), &json!(127))
        .unwrap();
    assert!(
        matches!(model,OrderedJson::Array(ref a) if a.last().and_then(|d|d.get("currentData")).and_then(|d|d.get("time")).and_then(OrderedJson::string).as_deref()==Some("1000")),
        "actual existing source selected earlyfetched10:00 Current at10:17"
    );
    assert_eq!(current_base(utc(1017)), Some(publication(900)));
    let town = json!({"gCoord":{"lon":126.9658,"lat":37.5714}});
    let first = snapshot
        .stn_hourly_and_min_rns(&town, "202610171017", &json!({}))
        .expect("public10:16 row and importedseed setup");
    assert_eq!(
        counters(&first),
        (b"3".to_vec(), b"4".to_vec()),
        "a10:00 observation fetchedearlyat10:10 must not qualify beforeCurrentavailabilityHH:40"
    );
    assert_eq!(
        put_count(&peer).await,
        1,
        "only fixtureactivation before10:40"
    );
    publish_record(
        &store,
        record(
            "kma-web",
            "aws-minute",
            &key,
            publication(1046),
            (utc(1046) + 30_000) as u64,
            minute_page(publication(1046), false),
            "text/html;charset=euc-kr",
        ),
    )
    .await;
    clock.store(utc(1047), Ordering::SeqCst);
    let _ = source.snapshot(&request(), deadline()).await;
    let acknowledged: Value =
        serde_json::from_slice(&t.get_control(STATE_KEY, 1024 * 1024).await.unwrap().body).unwrap();
    assert_eq!(acknowledged["rows"][0]["rns_hit"], 4.0);
    assert_eq!(
        acknowledged["rows"][0]["rns_count"], 5.0,
        "the same source qualifies the unchanged canonical end after availability"
    );
    // The public minute cache intentionally keeps its five-minute reload policy and the provider
    // double denies refreshes. A fresh reader sees the already published10:46 public row.
    let public = enabled_source(&peer);
    assert_eq!(
        counters(&station(&public).await),
        (b"4".to_vec(), b"5".to_vec()),
        "samecanonicalrow becomes eligible once its actual publication isavailable"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelling_snapshot_waiter_after_owner_read_starts_does_not_cancel_commit() {
    use server2::domestic::kma::source::rainfall_store::{Checkpoint, Namespace, Store};
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, false).await;
    let source = Arc::new(enabled_source(&peer));
    let delivered = station(source.as_ref()).await;
    assert_eq!(counters(&delivered), (b"3".to_vec(), b"4".to_vec()));
    let bytes = seed_bytes();
    let seed = seed::parse(&bytes).unwrap();
    let target = Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap();
    let checkpoint = Checkpoint::decode(&checkpoint(&bytes), &seed, &target).unwrap();
    Store {
        transport: peer.transport_limited(4),
        target,
    }
    .activate(&checkpoint, &seed, deadline())
    .await
    .unwrap();
    let count = async {
        let value: Value = serde_json::from_slice(
            &reqwest::get(format!("{}__catalog/status", peer.endpoint()))
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        value
            .get(format!("GET {STATE_KEY}"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let before = count.await;
    fault(&peer, "delay").await;
    let request_source = source.clone();
    let waiter = tokio::spawn(async move { request_source.snapshot(&request(), deadline()).await });
    let mut observed = false;
    for _ in 0..100 {
        let value: Value = serde_json::from_slice(
            &reqwest::get(format!("{}__catalog/status", peer.endpoint()))
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        if value
            .get(format!("GET {STATE_KEY}"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > before
        {
            observed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        observed,
        "actualowner GET reached the owned S3 peer before waiter cancellation"
    );
    waiter.abort();
    assert!(matches!(waiter.await, Err(error) if error.is_cancelled()));
    let mut committed = false;
    for _ in 0..10 {
        let object = peer
            .transport()
            .get_control(STATE_KEY, 1024 * 1024)
            .await
            .unwrap();
        let state: Value = serde_json::from_slice(&object.body).unwrap();
        if state["revision"] == 2 {
            assert_eq!(state["rows"][0]["rns_hit"], 4.0);
            assert_eq!(state["rows"][0]["rns_count"], 5.0);
            committed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        committed,
        "sourceownedjob completes conditionalcommit/readback after HTTP waiter dropped"
    );
    assert_eq!(
        counters(&delivered),
        (b"3".to_vec(), b"4".to_vec()),
        "alreadydeliveredsnapshot isimmutable"
    );
    assert_eq!(put_count(&peer).await, 2);
    let owner = source.rainfall_owner().unwrap();
    owner.quiesce();
    assert!(
        owner
            .drain(tokio::time::Instant::now() + Duration::from_secs(3))
            .await
    );
}

#[derive(Clone)]
struct ChangedMinuteCatalog {
    inner: Transport,
    old_raw: String,
    catalog: CatalogId,
    changed: Arc<std::sync::atomic::AtomicBool>,
}
impl server2::storage::ObjectTransport for ChangedMinuteCatalog {
    async fn put(
        &self,
        r: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        server2::storage::ObjectTransport::put(&self.inner, r).await
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::head(&self.inner, key).await
    }
    async fn get(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        let object = server2::storage::ObjectTransport::get(&self.inner, key, maximum).await?;
        if key == self.old_raw && !self.changed.swap(true, Ordering::SeqCst) {
            let old = self
                .inner
                .get_control(&self.catalog.key(), 1024 * 1024)
                .await?;
            let mut control = server2::storage::Catalog::from_bytes(
                &old.body,
                &self.catalog,
                &CatalogLimits::default(),
            )?;
            control.generation += 1;
            assert_eq!(
                self.inner
                    .put_control(
                        &self.catalog.key(),
                        &control.bytes(&CatalogLimits::default())?,
                        &WriteCondition::Match(old.etag)
                    )
                    .await?,
                200
            );
        }
        Ok(object)
    }
}
impl CatalogTransport for ChangedMinuteCatalog {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        self.inner.get_control(key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
}
impl server2::history::IndexListing for ChangedMinuteCatalog {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<server2::storage::ListPage, server2::storage::Error> {
        server2::history::IndexListing::list_index(&self.inner, prefix, token).await
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn changed_catalog_or_missing_selected_old_raw_is_incomplete_then_retryable() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    let old = record(
        "kma-web",
        "aws-minute",
        &key,
        publication(902),
        (utc(902) + 30_000) as u64,
        minute_page(publication(902), true),
        "text/html;charset=euc-kr",
    );
    let transport = ChangedMinuteCatalog {
        inner: peer.transport_limited(4),
        old_raw: old.envelope.identity.object_key().unwrap(),
        catalog: CatalogId::for_record(&old.envelope.identity, &DAY.to_string()).unwrap(),
        changed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };
    let source = S3Source::new(
        transport.clone(),
        Arc::new(|| utc(1047) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap();
    let view = snapshot(&source).await;
    let town = json!({"gCoord":{"lon":126.9658,"lat":37.5714}});
    assert!(
        transport.changed.load(Ordering::SeqCst),
        "fullreader actually reached09:02 outsidepublicfold"
    );
    assert!(
        view.stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
            .is_err()
    );
    assert_eq!(
        put_count(&peer).await,
        1,
        "changedobservedcatalog cannotconsume window"
    );
    assert_eq!(
        counters(&station(&enabled_source(&peer)).await),
        (b"4".to_vec(), b"5".to_vec()),
        "a later complete observedview retries uncommittedsameend"
    );
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let raw_key = old.envelope.identity.object_key().unwrap();
    let response = reqwest::Client::new()
        .post(format!(
            "{}__catalog?mode=forget&key={raw_key}",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 204);
    let source = enabled_source(&peer);
    let view = snapshot(&source).await;
    assert!(
        view.stn_hourly_and_min_rns(&town, "202610171047", &json!({}))
            .is_err()
    );
    assert!(view.summary_inputs().is_none());
    assert_eq!(
        put_count(&peer).await,
        1,
        "missingselectedraw cannotbe droppedtoqualifyfrompublictail"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unchanged_acknowledged_statistics_keep_the_same_s16_registry_input_identity() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::persistent();
    prepare(&peer, true).await;
    let clock = Arc::new(AtomicI64::new(utc(1047)));
    let read_clock = clock.clone();
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(move || read_clock.load(Ordering::SeqCst) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_rainfall(
        server2::domestic::kma::source::rainfall_store::Namespace::new(
            "server2-local".into(),
            "ap-northeast-2".into(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        counters(&station(&source).await),
        (b"4".to_vec(), b"5".to_vec())
    );
    async fn registry(source: &S3Source<Transport>) -> server2::summary::InputId {
        for _ in 0..30 {
            let store = snapshot(source).await;
            if let Some(inputs) = store.summary_inputs()
                && let Some(id) = inputs
                    .ids
                    .into_iter()
                    .find(|i| i.family == "station-registry")
            {
                return id;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!(
            "complete public S16 input fixture setup unavailable; not a registryidentity behaviorRed"
        );
    }
    let first = registry(&source).await;
    clock.store(utc(1048), Ordering::SeqCst);
    let second = registry(&source).await;
    assert_eq!(
        first.content_sha256, second.content_sha256,
        "countercontent didnotchange for repeatedcanonicalCurrent"
    );
    assert_eq!(
        put_count(&peer).await,
        2,
        "no additional statistics PUT for sameend"
    );
    eprintln!(
        "rainfall public S16 registry first={first:?} repeat={second:?}; acknowledgedcountersetup=4/5; rainfallPUTs=2"
    );
    assert_eq!(
        first.fetched_at_ms, second.fetched_at_ms,
        "unchanged acknowledged statistics must keep S16registry first-seen identity acrossrequestminutes"
    );
}

#[test]
fn full_catalog_decode_admits_2048_entries_and_rejects_2049_without_truncation() {
    let limits = CatalogLimits::default();
    assert_eq!(limits.entries, 2048);
    assert_eq!(limits.control_bytes, 1024 * 1024);
    let template = record(
        "kma-web",
        "aws-minute",
        &ProviderKey::Named {
            id: "aws-national".into(),
        },
        publication(1000),
        utc(1040) as u64,
        b"x".to_vec(),
        "text/html",
    )
    .envelope;
    let id = CatalogId::for_record(&template.identity, &DAY.to_string()).unwrap();
    let mut catalog = server2::storage::Catalog::empty(id.clone());
    for offset in 0..2048 {
        let mut member = template.clone();
        member.identity.fetched_at_ms += offset;
        catalog.entries.push(member);
    }
    let bytes = catalog
        .bytes(&limits)
        .expect("2048 full envelopes fit the unchanged 1MiB bound");
    let decoded = server2::storage::Catalog::from_bytes(&bytes, &id, &limits).unwrap();
    assert_eq!(decoded.entries.len(), 2048);
    let mut extra = template;
    extra.identity.fetched_at_ms += 2048;
    catalog.entries.push(extra);
    let excessive = serde_json::to_vec(&catalog).unwrap();
    assert!(
        excessive.len() <= limits.control_bytes,
        "entry-cap check must not be hidden by a byte-cap setup failure"
    );
    eprintln!(
        "rainfall catalog full decode: boundary_entries=2048 boundary_bytes={} rejected_entries=2049 rejected_bytes={} fixed_control_bytes={}",
        bytes.len(),
        excessive.len(),
        limits.control_bytes
    );
    assert!(matches!(
        server2::storage::Catalog::from_bytes(&excessive, &id, &limits),
        Err(server2::storage::Error::Capacity)
    ));
}

// Review preparation: current public S3Source API, ordinary S06 records and owned peer only.
async fn prepare_review_replay(
    peer: &Peer,
    current: bool,
    count: u16,
    inside_rain: bool,
    active: bool,
) {
    let transport = peer.transport_limited(4);
    let store = CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap();
    // seed_forecasts takes SKIPPED families. Do not accidentally publish September Current.
    seed_forecasts(&store, &["current", "shortest", "short", "rss", "mid"]).await;
    let bytes = seed_bytes();
    let acquired = seed::acquisition(&bytes).unwrap();
    store
        .publish(acquired.declaration, acquired.records, deadline())
        .await
        .unwrap();
    if current {
        publish_record(
            &store,
            record(
                "data-go-kr",
                "ultra-srt-ncst",
                &Grid::new(60, 127).unwrap().provider_key(),
                publication(1000),
                utc(1040) as u64,
                current_page(),
                "application/json",
            ),
        )
        .await;
    }
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    let mut rows = RowStore::default();
    let mut identities = Vec::new();
    let minutes = std::iter::once((0, true))
        .chain((1..=count).map(|n| (n, inside_rain && n == 1)))
        .chain(std::iter::once((106, false)));
    for (offset, rain) in minutes {
        let at = schedule::from_ms(utc(900) + i64::from(offset) * 60_000);
        let body = minute_page(at, rain);
        let page = pages::parse_aws(&body, None).expect("setup: real EUC-KR AWS page");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].get("rns"), Some(&Val::Bool(rain)));
        rows.save(&page.rows);
        let raw = record(
            "kma-web",
            "aws-minute",
            &key,
            at,
            (schedule::to_ms(at) + 30_000) as u64,
            body,
            "text/html;charset=euc-kr",
        );
        identities.push(raw.envelope.identity.clone());
        publish_record(&store, raw).await;
    }
    let end = pages::page_date("2026.10.17.10:00");
    let actual: Vec<_> = rows
        .after(108., end - 3_600_000.)
        .into_iter()
        .filter(|d| server2::domestic::kma::source::stations::date_of(d) <= end)
        .collect();
    assert_eq!(
        actual.len(),
        usize::from(count),
        "setup: actual unique (09:00,10:00] rows"
    );
    assert_eq!(
        actual
            .iter()
            .filter(|d| d.get("rns") == Some(&Val::Bool(true)))
            .count(),
        usize::from(inside_rain)
    );
    assert_eq!(
        identities.len(),
        usize::from(count) + 2,
        "setup: exact-left true and public-only 10:46 false are separate raw identities"
    );
    println!(
        "review replay setup current={current} rows={count} inside_rain={inside_rain} raw_ids={}",
        serde_json::to_string(&identities).unwrap()
    );
    if active {
        let body = checkpoint(&bytes);
        assert_eq!(
            transport
                .put_control(STATE_KEY, &body, &WriteCondition::Absent)
                .await
                .unwrap(),
            200
        );
        assert_eq!(
            transport
                .get_control(STATE_KEY, 1024 * 1024)
                .await
                .unwrap()
                .body,
            body
        );
    } else {
        assert!(
            matches!(
                transport.get_control(STATE_KEY, 1024 * 1024).await,
                Err(server2::storage::Error::NotFound)
            ),
            "setup: authority really absent"
        );
    }
}

#[derive(Clone)]
struct ReviewAuthorityDelay {
    inner: Transport,
    first: Arc<std::sync::atomic::AtomicBool>,
}
impl server2::storage::ObjectTransport for ReviewAuthorityDelay {
    async fn put(
        &self,
        r: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        server2::storage::ObjectTransport::put(&self.inner, r).await
    }
    async fn head(&self, key: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::head(&self.inner, key).await
    }
    async fn get(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        server2::storage::ObjectTransport::get(&self.inner, key, maximum).await
    }
}
impl CatalogTransport for ReviewAuthorityDelay {
    async fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        if key == STATE_KEY && self.first.swap(false, Ordering::SeqCst) {
            // Only schedule overlapping checkpoint demand, below the unchanged owned3s.
            // This is not a 250ms performance assertion or a larger product deadline.
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        self.inner.get_control(key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        self.inner.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        self.inner
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
}
impl server2::history::IndexListing for ReviewAuthorityDelay {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<server2::storage::ListPage, server2::storage::Error> {
        server2::history::IndexListing::list_index(&self.inner, prefix, token).await
    }
}
fn review_station(store: &dyn KmaStore, current: bool) -> Result<OrderedJson, String> {
    let value = store
        .town_model(TownModel::Current, &json!(60), &json!(127))
        .expect("setup: Current model readable");
    let OrderedJson::Array(values) = value else {
        panic!("setup: Current array")
    };
    if current {
        let data = values
            .last()
            .expect("setup: canonical Current present")
            .get("currentData")
            .unwrap();
        assert_eq!(
            data.get("time").and_then(OrderedJson::string).as_deref(),
            Some("1000")
        );
        assert_eq!(data.get("pty").unwrap().to_bytes(), b"1");
    } else {
        assert!(
            values.is_empty(),
            "setup: no Current means no witness, not a dry/future Current"
        );
    }
    store
        .stn_hourly_and_min_rns(
            &json!({"gCoord":{"lon":126.9658,"lat":37.5714}}),
            "202610171047",
            &json!({}),
        )
        .map_err(|e| format!("{e:?}"))
}
async fn review_warm<T: server2::history::IndexListing + Clone + Send + Sync + 'static>(
    source: &S3Source<T>,
    current: bool,
) {
    // Warm the actual same Source BEFORE enabling rainfall; no counter expectation is retried.
    for _ in 0..12 {
        let store = snapshot(source).await;
        if let Ok(value) = review_station(&*store, current)
            && value.get("addr").and_then(OrderedJson::string).as_deref() == Some(SEED_ADDRESS)
        {
            assert_eq!(value.get("rns"), Some(&OrderedJson::Bool(false)));
            assert_eq!(counters(&value), (b"3".to_vec(), b"4".to_vec()));
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("setup: pre-owner Source station fold did not become ready");
}
async fn review_forty_sources(current: bool, active: bool, delayed_authority: bool) {
    let peer = Peer::persistent();
    prepare_review_replay(&peer, current, 30, true, active).await;
    let transport = ReviewAuthorityDelay {
        inner: peer.transport_limited(4),
        first: Arc::new(std::sync::atomic::AtomicBool::new(delayed_authority)),
    };
    let source = S3Source::new(
        transport,
        Arc::new(|| utc(1047) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap();
    review_warm(&source, current).await;
    assert_eq!(put_count(&peer).await, u64::from(active));
    let source = Arc::new(
        source
            .with_rainfall(
                server2::domestic::kma::source::rainfall_store::Namespace::new(
                    "server2-local".into(),
                    "ap-northeast-2".into(),
                )
                .unwrap(),
            )
            .unwrap(),
    );
    let barrier = Arc::new(tokio::sync::Barrier::new(41));
    let mut tasks = Vec::new();
    for _ in 0..40 {
        let source = source.clone();
        let barrier = barrier.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            let store = snapshot(&source).await;
            review_station(&*store, current)
        }));
    }
    barrier.wait().await;
    let mut answers = Vec::new();
    for task in tasks {
        answers.push(task.await);
    }
    let owner = source.rainfall_owner().unwrap();
    owner.quiesce();
    assert!(
        owner
            .drain(tokio::time::Instant::now() + Duration::from_secs(4))
            .await,
        "setup: rainfall-owned work physically retired before outcome assertions"
    );
    let expected = if active && current {
        (b"4".to_vec(), b"5".to_vec())
    } else {
        (b"3".to_vec(), b"4".to_vec())
    };
    let mut successes = 0;
    let mut unexpected = Vec::new();
    for answer in answers {
        let answer = answer.expect("setup: every Source task must finish without panic");
        match answer {
            Ok(value) => {
                assert_eq!(counters(&value), expected);
                successes += 1;
            }
            Err(error) => {
                println!("review001 station partial: {error}");
                if !error.contains("raw storage: Capacity") {
                    unexpected.push(error);
                }
            }
        }
    }
    let puts = put_count(&peer).await;
    if active {
        let object = peer
            .transport()
            .get_control(STATE_KEY, 1024 * 1024)
            .await
            .unwrap();
        let value: Value = serde_json::from_slice(&object.body).unwrap();
        assert_eq!(value["revision"], if current { 2 } else { 1 });
        assert_eq!(puts, if current { 2 } else { 1 });
    } else {
        assert_eq!(puts, 0, "absent runtime must never initialize authority");
    }
    assert!(
        unexpected.is_empty(),
        "unexpected station errors are a separate blocker, not the intended001 Capacity Red: {unexpected:?}"
    );
    assert_eq!(
        successes, 40,
        "forty normal Source callers must not consume forty mutation slots"
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn absent_authority_forty_sources_with_or_without_current_preserve_readable_baseline() {
    let _peers = S3_PEERS.lock().await;
    for current in [false, true] {
        for delayed in [false, true] {
            review_forty_sources(current, false, delayed).await;
        }
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn active_authority_forty_no_current_sources_share_validated_overlay() {
    let _peers = S3_PEERS.lock().await;
    for delayed in [false, true] {
        review_forty_sources(false, true, delayed).await;
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn active_same_grid_forty_sources_join_one_canonical_current_decision() {
    let _peers = S3_PEERS.lock().await;
    for delayed in [false, true] {
        review_forty_sources(true, true, delayed).await;
    }
}
async fn review_window_boundary(count: u16) {
    let peer = Peer::persistent();
    prepare_review_replay(&peer, true, count, false, true).await;
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| utc(1047) as f64),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap();
    review_warm(&source, true).await;
    let source = source
        .with_rainfall(
            server2::domestic::kma::source::rainfall_store::Namespace::new(
                "server2-local".into(),
                "ap-northeast-2".into(),
            )
            .unwrap(),
        )
        .unwrap();
    let value = station(&source).await;
    let owner = source.rainfall_owner().unwrap();
    owner.quiesce();
    assert!(
        owner
            .drain(tokio::time::Instant::now() + Duration::from_secs(4))
            .await
    );
    let object = peer
        .transport()
        .get_control(STATE_KEY, 1024 * 1024)
        .await
        .unwrap();
    let saved: Value = serde_json::from_slice(&object.body).unwrap();
    if count == 14 {
        assert_eq!(
            counters(&value),
            (b"3".to_vec(), b"4".to_vec()),
            "09:00 true is excluded; fourteen actual window rows do not qualify"
        );
        assert_eq!(saved["revision"], 1);
        assert!(saved["rows"][0]["last_end_ms"].is_null());
        assert!(saved["rows"][0]["receipt"].is_null());
        assert_eq!(put_count(&peer).await, 1);
    } else {
        assert_eq!(count, 15);
        assert_eq!(
            counters(&value),
            (b"3".to_vec(), b"5".to_vec()),
            "fifteen false rows qualify as a miss; exact-left true must not turn it into a hit"
        );
        assert_eq!(saved["revision"], 2);
        assert_eq!(saved["rows"][0]["receipt"]["row_count"], 15);
        assert_eq!(saved["rows"][0]["receipt"]["sensor_count"], 15);
        assert_eq!(saved["rows"][0]["receipt"]["hit"], false);
        assert_eq!(put_count(&peer).await, 2);
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn complete_s06_replay_fourteen_rows_excludes_exact_left_and_does_not_count() {
    let _peers = S3_PEERS.lock().await;
    review_window_boundary(14).await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn complete_s06_replay_fifteen_false_rows_excludes_exact_left_and_counts_miss() {
    let _peers = S3_PEERS.lock().await;
    review_window_boundary(15).await;
}
