//! Functional smoke: loopback provider stub + owned S3 test peer. Demand, capture, publication,
//! replacement rebuild, coverage, legacy import and exact readback.
//! Run in release mode with `cargo test --release --test history smoke`. No AWS/provider traffic.
use super::provider_support::{
    KEY_A, KEY_B, Reply, Stub, clock, envelope, kst, policy, vilage_page,
};
use super::support::*;
use server2::budget::BudgetStore;
use server2::domestic::family::{Endpoints, Service};
use server2::domestic::metrics::DomesticMetrics;
use server2::domestic::{DomesticAcquirer, KeyRing};
use server2::history::capture::{CaptureConfig, CaptureOwner, CaptureRunner};
use server2::history::coverage::{ColdCell, Coverage, CoverageConfig, HistoryRequest, read_slot};
use server2::history::demand::{DemandChange, DemandConfig, DemandStore};
use server2::history::index::{CaptureIndex, RebuildConfig};
use server2::history::legacy::{self, ExportKey, LegacyKind};
use server2::history::metrics::HistoryMetrics;
use server2::history::schedule::{self, Family, Target};
use server2::providers::{HttpProviderTransport, HttpPublicTransport, ProviderKey};
use server2::storage::{
    CatalogLimits, CatalogStore, CatalogTransport, Limits, RawRecordStore, WriteCondition,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

/// Synthetic getUltraSrtNcst page: one row per category for the requested hour and grid.
fn ncst_page(base: (&str, &str), grid: (u16, u16)) -> Vec<u8> {
    let items = ["T1H", "RN1", "UUU", "VVV", "REH", "PTY", "VEC", "WSD"]
        .iter()
        .map(|c| {
            serde_json::json!({
                "baseDate": base.0, "baseTime": base.1, "category": c,
                "nx": grid.0, "ny": grid.1, "obsrValue": "1",
            })
        })
        .collect();
    envelope(items, 1, 999, 8)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn smoke_demand_capture_rebuild_coverage_and_legacy_import() {
    let peer = Peer::new();
    let stub = Stub::start().await;
    let now = kst(2026, 10, 13, 14, 25);
    let clk = clock(now);
    let cell = g(60, 127);

    // Demand is durable under state/demand/grid/ in the S3 peer.
    let demand_wire = Arc::new(peer.transport());
    let demand = Arc::new(DemandStore::new(demand_wire.clone(), DemandConfig::default()).unwrap());
    assert_eq!(demand.touch(cell, now).await.unwrap(), DemandChange::New);
    assert_eq!(
        peer.count("PUT state/demand/grid/request/060-127.json")
            .await,
        1
    );

    // Real S13 acquirer over the loopback provider stub, budgets in the peer.
    let budget = Arc::new(peer.transport());
    let mut rings = BTreeMap::new();
    let entries = [(KEY_A, 'a'), (KEY_B, 'b')]
        .into_iter()
        .map(|(key, owner)| {
            (
                ProviderKey::new(key.into()).unwrap(),
                Arc::new(
                    BudgetStore::new(budget.clone(), policy(owner, 1000), clk.clone()).unwrap(),
                ),
            )
        })
        .collect();
    rings.insert(Service::VilageFcst, KeyRing::new(entries).unwrap());
    let acquirer = Arc::new(
        DomesticAcquirer::new(
            Arc::new(HttpProviderTransport::new(8 * 1024 * 1024).unwrap()),
            Arc::new(HttpPublicTransport::new(8 * 1024 * 1024).unwrap()),
            rings,
            Endpoints::new(&stub.base, &stub.base, &stub.base).unwrap(),
            clk.clone(),
            Arc::new(DomesticMetrics::default()),
            CatalogLimits::default(),
        )
        .unwrap(),
    );
    let pages = [
        (
            "1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
            ncst_page(("20261013", "1300"), (60, 127)),
        ),
        (
            "1360000/VilageFcstInfoService_2.0/getUltraSrtFcst",
            vilage_page(1, 60, 999, ("20261013", "1330"), (60, 127)),
        ),
        (
            "1360000/VilageFcstInfoService_2.0/getVilageFcst",
            vilage_page(1, 60, 999, ("20261013", "1400"), (60, 127)),
        ),
    ];
    for (path, body) in &pages {
        stub.push(path, Reply::json(body.clone()));
    }
    let minute_page = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/providers/fixtures/aws-minute-euckr.html"),
    )
    .unwrap();
    stub.push(
        "cgi-bin/aws/nph-aws_txt_min",
        Reply::with(200, "text/html", minute_page.clone()),
    );
    let publisher =
        Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let metrics = Arc::new(HistoryMetrics::default());
    let runner = CaptureRunner::new(
        CaptureOwner::claim("history-smoke").unwrap(),
        acquirer.clone(),
        publisher.clone(),
        demand.clone(),
        Arc::new(Mutex::new(CaptureIndex::default())),
        CaptureConfig {
            max_funded_attempts: 30,
            max_web_attempts: 0,
            ..CaptureConfig::default()
        },
        metrics.clone(),
    )
    .unwrap();
    let report = runner.tick(now).await;
    assert_eq!((report.published, report.failed), (3, 0), "{report:?}");
    let minute = runner.minute(now).await;
    assert!(minute.published, "{minute:?}");
    let captured_minute: Vec<_> = runner.index().lock().unwrap().minutes().collect();
    assert_eq!(captured_minute.len(), 1);
    println!("{}", metrics.render());
    drop(runner);

    // An interrupted publication: a raw object for 12:00 without any catalog entry.
    let orphan = super::support::acquisition(
        "data-go-kr",
        "ultra-srt-ncst",
        &cell.provider_key(),
        p(20261013, 1200),
        1_790_000_000_000,
        b"orphan page",
    );
    RawRecordStore::new(peer.transport(), Limits::default())
        .unwrap()
        .publish(orphan.records.into_iter().next().unwrap())
        .await
        .unwrap();

    // Legacy export seed for the same grid, imported into the peer.
    let exported = "2026-10-13T04:00:00.000Z";
    let out = temp_path("smoke-export");
    let input = fixture_path("kma.town.current.v2.jsonl");
    let (code, _, stderr) = convert(&[
        "--collection",
        "kma.town.current",
        "--db-version",
        "2.0",
        "--exported-at",
        exported,
        "--input",
        input.to_str().unwrap(),
        "--output",
        out.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stderr}");
    let seed = legacy::parse_seed(&std::fs::read(&out).unwrap()).unwrap();
    legacy::import(publisher.as_ref(), &seed, deadline())
        .await
        .unwrap();

    // Spot replacement: empty memory, rebuild demand and the capture index from S3 only.
    let replacement = DemandStore::new(demand_wire.clone(), DemandConfig::default()).unwrap();
    let rebuilt = replacement.rebuild().await.unwrap();
    assert_eq!((rebuilt.request_records, rebuilt.invalid), (1, 0));
    assert_eq!(replacement.active(now), BTreeSet::from([cell]));
    let (index, rebuild) = CaptureIndex::rebuild(
        &peer.transport(),
        &replacement.known(),
        &BTreeSet::new(),
        now,
        &RebuildConfig::default(),
    )
    .await
    .unwrap();
    assert!(rebuild.incomplete.is_empty(), "{rebuild:?}");
    let target = Target::Cell(cell);
    assert!(index.has(Family::Current, target, p(20261013, 1300)));
    assert!(index.has(Family::Shortest, target, p(20261013, 1300)));
    assert!(index.has(Family::Short, target, p(20261013, 1400)));
    // Raw presence alone is not publication: the orphan is not counted as captured.
    assert!(!index.has(Family::Current, target, p(20261013, 1200)));
    assert_eq!(rebuild.invalid_catalogs, 0);
    assert_eq!(index.minutes().collect::<Vec<_>>(), captured_minute);
    assert_eq!(
        index.exports(LegacyKind::TownCurrent, ExportKey::Grid(cell)),
        vec![schedule::to_ms(p(20261013, 1300))]
    );
    // Present publications are not planned again after the replacement.
    let plan = schedule::plan(now, &replacement.active(now), &index);
    assert!(!plan.iter().any(|x| !x.backfill && x.target == target));

    // Coverage: the export (legacy state up to 12:00) plus the 13:00 capture completes the
    // current history; ultra-short and short forecasts have no export, so the cell stays on legacy.
    let request = HistoryRequest {
        grid: cell,
        station: None,
        at_ms: now,
        minute_anchor: None,
    };
    match schedule_coverage(&request, &index) {
        Coverage::Legacy { cold, gaps, .. } => {
            assert_eq!(cold, ColdCell::Partial);
            assert!(
                !gaps.iter().any(|x| x.family == Family::Current),
                "{gaps:?}"
            );
            assert!(gaps.iter().any(|x| x.family == Family::Shortest));
            assert!(gaps.iter().any(|x| x.family == Family::Short));
        }
        other => panic!("expected legacy forwarding, got {other:?}"),
    }

    // Damaged catalogs: an empty catalog for 11:00 and corrupt JSON for 10:00 never count.
    let wire = peer.transport();
    let empty =
        server2::history::coverage::catalog_id(Family::Current, target_of(cell), p(20261013, 1100))
            .unwrap();
    let body = server2::storage::Catalog::empty(empty.clone())
        .bytes(&CatalogLimits::default())
        .unwrap();
    assert_eq!(
        wire.put_control(&empty.key(), &body, &WriteCondition::Absent)
            .await
            .unwrap(),
        200
    );
    let corrupt =
        server2::history::coverage::catalog_id(Family::Current, target_of(cell), p(20261013, 1000))
            .unwrap();
    assert_eq!(
        wire.put_control(&corrupt.key(), b"{}", &WriteCondition::Absent)
            .await
            .unwrap(),
        200
    );

    let (damaged, report) = CaptureIndex::rebuild(
        &peer.transport(),
        &replacement.known(),
        &BTreeSet::new(),
        now,
        &RebuildConfig::default(),
    )
    .await
    .unwrap();
    assert!(
        !damaged.has(Family::Current, target, p(20261013, 1100)),
        "empty catalog"
    );
    assert!(
        !damaged.has(Family::Current, target, p(20261013, 1000)),
        "corrupt catalog"
    );
    assert_eq!(report.invalid_catalogs, 2);
    assert_eq!(
        report.incomplete,
        vec![("ultra-srt-ncst".to_owned(), 20261013)],
        "unreadable catalog marks its family/date incomplete"
    );
    // The export (state up to 12:00) would cover 10:00, but unreadable archived revisions
    // forward the request to legacy instead of letting the export hide them.
    match schedule_coverage(&request, &damaged) {
        Coverage::Legacy { reason, .. } => assert_eq!(
            reason,
            server2::history::coverage::LegacyReason::IndexIncomplete
        ),
        other => panic!("expected IndexIncomplete, got {other:?}"),
    }

    // Exact readback of the captured provider bytes through S06 catalogs.
    let cold = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let slot = read_slot(
        &cold,
        Family::Current,
        target,
        p(20261013, 1300),
        deadline(),
    )
    .await
    .unwrap()
    .expect("captured slot");
    assert_eq!(&slot[0].records()[0].bytes[..], &pages[0].1[..]);
    let slot = read_slot(
        &cold,
        Family::Shortest,
        target,
        p(20261013, 1300),
        deadline(),
    )
    .await
    .unwrap()
    .expect("captured slot");
    assert_eq!(&slot[0].records()[0].bytes[..], &pages[1].1[..]);
    let minute = read_slot(
        &cold,
        Family::AwsMinute,
        Target::National,
        captured_minute[0],
        deadline(),
    )
    .await
    .unwrap()
    .expect("captured minute page");
    assert_eq!(&minute[0].records()[0].bytes[..], &minute_page[..]);
}

fn target_of(cell: server2::history::Grid) -> Target {
    Target::Cell(cell)
}
fn schedule_coverage(request: &HistoryRequest, index: &CaptureIndex) -> Coverage {
    server2::history::coverage::coverage(request, index, &CoverageConfig::default())
}
