//! Coverage decision for cold cells: complete inputs only from captures and export snapshots,
//! otherwise legacy forwarding with named gaps. No ASOS substitution, no invented hours.
use super::provider_support::kst;
use super::support::*;
use server2::domestic::publication::Publication;
use server2::history::coverage::{
    ColdCell, Coverage, CoverageConfig, HistoryRequest, LegacyReason, coverage,
};
use server2::history::index::CaptureIndex;
use server2::history::legacy::{ExportKey, LegacyKind};
use server2::history::schedule::{self, Family, Target};

const STATION: u32 = 108;

fn at() -> i64 {
    kst(2026, 10, 13, 14, 25)
}
fn request() -> HistoryRequest {
    HistoryRequest {
        grid: g(60, 127),
        station: Some(STATION),
        at_ms: at(),
        minute_anchor: Some(p(20261013, 1425)),
    }
}
fn fill(index: &mut CaptureIndex, family: Family, target: Target, from_ms: i64, at_ms: i64) {
    for publication in family.required(at_ms) {
        if schedule::to_ms(publication) >= from_ms {
            index.insert(family, target, publication);
        }
    }
}
fn minutes(index: &mut CaptureIndex, from: Publication, to: Publication, step: i64) {
    let mut t = schedule::to_ms(from);
    while t <= schedule::to_ms(to) {
        index.insert_minute(schedule::from_ms(t));
        t += step * 60_000;
    }
}
fn full(index: &mut CaptureIndex, from_ms: i64) {
    let cell = Target::Cell(g(60, 127));
    for f in [Family::Current, Family::Shortest, Family::Short] {
        fill(index, f, cell, from_ms, at());
    }
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(index, f, Target::National, from_ms, at());
    }
    minutes(index, p(20261013, 1403), p(20261013, 1423), 2);
}
fn legacy(c: Coverage) -> (LegacyReason, ColdCell, Vec<server2::history::coverage::Gap>) {
    match c {
        Coverage::Legacy { reason, cold, gaps } => (reason, cold, gaps),
        other => panic!("expected legacy forwarding, got {other:?}"),
    }
}

#[test]
fn coverage_complete_when_every_required_publication_is_captured() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    let plan = match coverage(&request(), &index, &CoverageConfig::default()) {
        Coverage::Complete(plan) => plan,
        other => panic!("expected complete, got {other:?}"),
    };
    assert_eq!(plan.current_window.len(), 192);
    assert_eq!(plan.yesterday, p(20261012, 1400));
    assert_eq!(plan.families[&Family::Current].len(), 191);
    assert!(
        plan.families[&Family::Current]
            .iter()
            .all(|s| s.captured && s.exports.is_empty())
    );
    let minute = plan.minute.unwrap();
    assert_eq!(
        (minute.after, minute.through),
        (p(20261013, 1405), p(20261013, 1425))
    );
    // Legacy reads rows strictly after anchor-20min: 14:07..14:23.
    assert_eq!(minute.captured.len(), 9);
}

#[test]
fn coverage_never_requested_cell_forwards_to_legacy() {
    let mut index = CaptureIndex::default();
    // National pages exist because other cells have demand; this grid has nothing.
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut index, f, Target::National, 0, at());
    }
    let (reason, cold, gaps) = legacy(coverage(&request(), &index, &CoverageConfig::default()));
    assert_eq!(reason, LegacyReason::Gaps);
    assert_eq!(cold, ColdCell::NeverCaptured);
    let current = gaps.iter().find(|x| x.family == Family::Current).unwrap();
    assert_eq!(
        (current.first, current.last, current.missing),
        (p(20261005, 1500), p(20261013, 1300), 191)
    );
}

#[test]
fn coverage_resumed_after_eight_days_keeps_the_gap_on_legacy() {
    // Demand resumed two days ago after more than 8 days without demand: only recent captures.
    let mut index = CaptureIndex::default();
    full(&mut index, at() - 2 * DAY);
    // National pages kept being captured for other cells with demand.
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut index, f, Target::National, 0, at());
    }
    let (reason, cold, gaps) = legacy(coverage(&request(), &index, &CoverageConfig::default()));
    assert_eq!(reason, LegacyReason::Gaps);
    assert_eq!(cold, ColdCell::Partial);
    let current = gaps.iter().find(|x| x.family == Family::Current).unwrap();
    assert_eq!(current.first, p(20261005, 1500));
    assert_eq!(current.last, p(20261011, 1400));
    assert!(!gaps.iter().any(|x| x.family == Family::AwsHourly));
}

#[test]
fn coverage_partial_history_names_each_missing_hour() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    let mut partial = CaptureIndex::default();
    for publication in Family::Current.required(at()) {
        if publication != p(20261010, 300) && publication != p(20261010, 400) {
            partial.insert(Family::Current, Target::Cell(g(60, 127)), publication);
        }
    }
    partial.merge(&index_without_current(&index));
    let (_, cold, gaps) = legacy(coverage(&request(), &partial, &CoverageConfig::default()));
    assert_eq!(cold, ColdCell::Partial);
    assert_eq!(gaps.len(), 1);
    assert_eq!(
        (gaps[0].family, gaps[0].first, gaps[0].last, gaps[0].missing),
        (Family::Current, p(20261010, 300), p(20261010, 400), 2)
    );
}
fn index_without_current(full: &CaptureIndex) -> CaptureIndex {
    let mut out = CaptureIndex::default();
    for f in [Family::Shortest, Family::Short] {
        for publication in f.required(at()) {
            if full.has(f, Target::Cell(g(60, 127)), publication) {
                out.insert(f, Target::Cell(g(60, 127)), publication);
            }
        }
    }
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut out, f, Target::National, 0, at());
    }
    for m in full.minutes() {
        out.insert_minute(m);
    }
    out
}

#[test]
fn coverage_needs_latest_when_only_the_newest_publication_is_missing() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    let mut without = CaptureIndex::default();
    for publication in Family::Current.required(at()) {
        if publication != p(20261013, 1300) {
            without.insert(Family::Current, Target::Cell(g(60, 127)), publication);
        }
    }
    without.merge(&index_without_current(&index));
    match coverage(&request(), &without, &CoverageConfig::default()) {
        Coverage::NeedsLatest { missing, .. } => {
            assert_eq!(missing, vec![(Family::Current, p(20261013, 1300))])
        }
        other => panic!("expected NeedsLatest, got {other:?}"),
    }
}

#[test]
fn coverage_combines_an_export_snapshot_with_captures_after_it() {
    let exported = kst(2026, 10, 10, 9, 50);
    let mut index = CaptureIndex::default();
    for kind in [
        LegacyKind::TownCurrent,
        LegacyKind::TownShortest,
        LegacyKind::TownShort,
    ] {
        index.add_export(kind, ExportKey::Grid(g(60, 127)), exported);
    }
    index.add_export(
        LegacyKind::StnHourly2,
        ExportKey::Station(STATION),
        exported,
    );
    // Captures continue from the first publication after the export.
    let cell = Target::Cell(g(60, 127));
    for f in [Family::Current, Family::Shortest, Family::Short] {
        let latest_at_export = schedule::to_ms(f.latest(exported).unwrap());
        fill(&mut index, f, cell, latest_at_export + 1, at());
    }
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut index, f, Target::National, exported - HOUR + 1, at());
    }
    minutes(&mut index, p(20261013, 1403), p(20261013, 1423), 2);
    let plan = match coverage(&request(), &index, &CoverageConfig::default()) {
        Coverage::Complete(plan) => plan,
        other => panic!("expected complete, got {other:?}"),
    };
    let first = &plan.families[&Family::Current][0];
    assert_eq!(
        (first.captured, first.exports.clone()),
        (false, vec![exported])
    );
    // Export alone (no captures after it) leaves the later publications missing.
    let mut stale = CaptureIndex::default();
    for kind in [
        LegacyKind::TownCurrent,
        LegacyKind::TownShortest,
        LegacyKind::TownShort,
    ] {
        stale.add_export(kind, ExportKey::Grid(g(60, 127)), exported);
    }
    let (_, cold, gaps) = legacy(coverage(&request(), &stale, &CoverageConfig::default()));
    assert_eq!(cold, ColdCell::Partial);
    let current = gaps.iter().find(|x| x.family == Family::Current).unwrap();
    assert_eq!(current.first, p(20261010, 1000));
}

#[test]
fn coverage_never_substitutes_station_or_asos_data_for_grid_hours() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    // A station-hourly export does not cover grid current hours.
    let mut station_only = index_without_current(&index);
    station_only.add_export(LegacyKind::StnHourly2, ExportKey::Station(STATION), at());
    let (_, _, gaps) = legacy(coverage(
        &request(),
        &station_only,
        &CoverageConfig::default(),
    ));
    assert!(
        gaps.iter()
            .any(|x| x.family == Family::Current && x.missing == 191)
    );
    // Legacy ASOS history reads cannot be reproduced: the request stays on legacy.
    let (reason, _, _) = legacy(coverage(
        &request(),
        &index,
        &CoverageConfig {
            legacy_asos_read: true,
        },
    ));
    assert_eq!(reason, LegacyReason::AsosRead);
}

#[test]
fn coverage_minute_window_requires_continuous_fresh_pages() {
    let mut base = CaptureIndex::default();
    full(&mut base, 0);
    let without_minutes = |index: &CaptureIndex| {
        let mut out = CaptureIndex::default();
        for f in [Family::Current, Family::Shortest, Family::Short] {
            for publication in f.required(at()) {
                if index.has(f, Target::Cell(g(60, 127)), publication) {
                    out.insert(f, Target::Cell(g(60, 127)), publication);
                }
            }
        }
        for f in [Family::AwsHourly, Family::CityObs] {
            fill(&mut out, f, Target::National, 0, at());
        }
        out
    };
    // A four-minute hole inside the window.
    let mut hole = without_minutes(&base);
    minutes(&mut hole, p(20261013, 1403), p(20261013, 1411), 2);
    minutes(&mut hole, p(20261013, 1415), p(20261013, 1423), 2);
    let (_, _, gaps) = legacy(coverage(&request(), &hole, &CoverageConfig::default()));
    assert!(gaps.iter().any(|x| x.family == Family::AwsMinute));
    // Capture started inside the window (demand began 10 minutes ago).
    let mut late = without_minutes(&base);
    minutes(&mut late, p(20261013, 1415), p(20261013, 1423), 2);
    assert!(matches!(
        coverage(&request(), &late, &CoverageConfig::default()),
        Coverage::Legacy { .. }
    ));
    // Newest page older than anchor-3min.
    let mut old = without_minutes(&base);
    minutes(&mut old, p(20261013, 1403), p(20261013, 1421), 2);
    assert!(matches!(
        coverage(&request(), &old, &CoverageConfig::default()),
        Coverage::Legacy { .. }
    ));
    // An exported station-minute snapshot at the anchor covers the window.
    let mut exported = without_minutes(&base);
    exported.add_export(
        LegacyKind::StnMinute2,
        ExportKey::Station(STATION),
        schedule::to_ms(p(20261013, 1425)),
    );
    assert!(matches!(
        coverage(&request(), &exported, &CoverageConfig::default()),
        Coverage::Complete(_)
    ));
}

#[test]
fn coverage_incomplete_index_forwards_to_legacy() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    index.mark_incomplete("ultra-srt-ncst", 20261009);
    let (reason, _, _) = legacy(coverage(&request(), &index, &CoverageConfig::default()));
    assert_eq!(reason, LegacyReason::IndexIncomplete);
}
