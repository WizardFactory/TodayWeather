//! Coverage decision for cold cells (AK correction 2026-10-14): complete inputs from captures and
//! export snapshots; otherwise recent publications are fetched, older current hours back to D-7
//! are left to the ASOS history read and older gaps stay absent. Never a legacy forward, never an
//! invented hour.
use super::provider_support::kst;
use super::support::*;
use server2::domestic::publication::Publication;
use server2::history::coverage::{ColdCell, Coverage, Gap, HistoryRequest, coverage};
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
type Filled = (
    ColdCell,
    Vec<(Family, Publication)>,
    Vec<Publication>,
    Vec<Gap>,
);
fn filled(c: Coverage) -> Filled {
    match c {
        Coverage::Fill {
            cold,
            fetch,
            asos,
            absent,
            ..
        } => (cold, fetch, asos, absent),
        other => panic!("expected a fill plan, got {other:?}"),
    }
}
fn of(fetch: &[(Family, Publication)], family: Family) -> Vec<Publication> {
    fetch
        .iter()
        .filter(|(f, _)| *f == family)
        .map(|(_, p)| *p)
        .collect()
}

#[test]
fn coverage_complete_when_every_required_publication_is_captured() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    let plan = match coverage(&request(), &index) {
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
fn coverage_never_requested_cell_is_fetched_asos_filled_and_never_forwarded() {
    let mut index = CaptureIndex::default();
    // National pages exist because other cells have demand; this grid has nothing.
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut index, f, Target::National, 0, at());
    }
    let (cold, fetch, asos, absent) = filled(coverage(&request(), &index));
    assert_eq!(cold, ColdCell::NeverCaptured);
    // KMA backfill: the latest current slot and the 23 before it (data.go.kr serves ~1 day).
    let current = of(&fetch, Family::Current);
    assert_eq!(current.len(), 24);
    assert_eq!(
        (current[0], current[23]),
        (p(20261012, 1400), p(20261013, 1300))
    );
    assert_eq!(of(&fetch, Family::Shortest).len(), 24);
    assert_eq!(of(&fetch, Family::Short).len(), 8);
    // ASOS: the older current hours back to D-7 00:00 KST.
    assert_eq!(asos.len(), 158);
    assert_eq!((asos[0], asos[157]), (p(20261006, 0), p(20261012, 1300)));
    // Before D-7 there is no source: absent, as legacy answers absent data.
    let current = absent.iter().find(|x| x.family == Family::Current).unwrap();
    assert_eq!(
        (current.first, current.last, current.missing),
        (p(20261005, 1500), p(20261005, 2300), 9)
    );
}

#[test]
fn coverage_resumed_after_eight_days_fills_the_gap_from_asos() {
    // Demand resumed two days ago after more than 8 days without demand: only recent captures.
    let mut index = CaptureIndex::default();
    full(&mut index, at() - 2 * DAY);
    // National pages kept being captured for other cells with demand.
    for f in [Family::AwsHourly, Family::CityObs] {
        fill(&mut index, f, Target::National, 0, at());
    }
    let (cold, fetch, asos, absent) = filled(coverage(&request(), &index));
    assert_eq!(cold, ColdCell::Partial);
    assert!(
        of(&fetch, Family::Current).is_empty(),
        "the last day was captured"
    );
    assert_eq!(
        (asos[0], *asos.last().unwrap()),
        (p(20261006, 0), p(20261011, 1400))
    );
    let current = absent.iter().find(|x| x.family == Family::Current).unwrap();
    assert_eq!(current.first, p(20261005, 1500));
    assert_eq!(current.last, p(20261005, 2300));
    assert!(!absent.iter().any(|x| x.family == Family::AwsHourly));
}

#[test]
fn coverage_partial_history_leaves_each_older_missing_hour_to_asos() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    let mut partial = CaptureIndex::default();
    for publication in Family::Current.required(at()) {
        if publication != p(20261010, 300) && publication != p(20261010, 400) {
            partial.insert(Family::Current, Target::Cell(g(60, 127)), publication);
        }
    }
    partial.merge(&index_without_current(&index));
    let (cold, fetch, asos, absent) = filled(coverage(&request(), &partial));
    assert_eq!(cold, ColdCell::Partial);
    assert!(
        fetch.is_empty() && absent.is_empty(),
        "{fetch:?} {absent:?}"
    );
    assert_eq!(asos, vec![p(20261010, 300), p(20261010, 400)]);
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
    match coverage(&request(), &without) {
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
    let plan = match coverage(&request(), &index) {
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
    let (cold, fetch, asos, _) = filled(coverage(&request(), &stale));
    assert_eq!(cold, ColdCell::Partial);
    assert_eq!(asos[0], p(20261010, 1000));
    assert_eq!(
        *of(&fetch, Family::Current).last().unwrap(),
        p(20261013, 1300)
    );
}

#[test]
fn coverage_fills_recent_hours_from_kma_and_older_hours_from_asos() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    // A station-hourly export is not a grid publication: the current hours are still missing,
    // and they are fetched (KMA backfill reach) or ASOS-filled, never forwarded to legacy.
    let mut station_only = index_without_current(&index);
    station_only.add_export(LegacyKind::StnHourly2, ExportKey::Station(STATION), at());
    let (_, fetch, asos, absent) = filled(coverage(&request(), &station_only));
    assert_eq!(of(&fetch, Family::Current).len(), 24);
    assert_eq!(asos.len(), 158);
    assert!(
        asos.iter()
            .all(|h| *h >= p(20261006, 0) && *h < p(20261012, 1400))
    );
    assert_eq!(
        absent
            .iter()
            .filter(|x| x.family == Family::Current)
            .map(|x| x.missing)
            .sum::<usize>(),
        9
    );
    // The yesterday slot (24 h ago) is beyond the KMA reach (`getUltraSrtNcst` answers code 10
    // for it, live 2026-10-14) and comes from ASOS.
    assert!(asos.contains(&p(20261012, 1300)));
    assert!(!of(&fetch, Family::Current).contains(&p(20261012, 1300)));
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
    let (_, fetch, _, absent) = filled(coverage(&request(), &hole));
    assert!(absent.iter().any(|x| x.family == Family::AwsMinute));
    assert_eq!(of(&fetch, Family::AwsMinute), vec![p(20261013, 1425)]);
    // Capture started inside the window (demand began 10 minutes ago).
    let mut late = without_minutes(&base);
    minutes(&mut late, p(20261013, 1415), p(20261013, 1423), 2);
    assert!(matches!(coverage(&request(), &late), Coverage::Fill { .. }));
    // Newest page older than anchor-3min.
    let mut old = without_minutes(&base);
    minutes(&mut old, p(20261013, 1403), p(20261013, 1421), 2);
    assert!(matches!(coverage(&request(), &old), Coverage::Fill { .. }));
    // A snapshot two days after the anchor no longer holds the window (one-day retention).
    let mut late_export = without_minutes(&base);
    late_export.add_export(
        LegacyKind::StnMinute2,
        ExportKey::Station(STATION),
        schedule::to_ms(p(20261013, 1425)) + 2 * DAY,
    );
    assert!(matches!(
        coverage(&request(), &late_export),
        Coverage::Fill { .. }
    ));
    // An exported station-minute snapshot at the anchor covers the window.
    let mut exported = without_minutes(&base);
    exported.add_export(
        LegacyKind::StnMinute2,
        ExportKey::Station(STATION),
        schedule::to_ms(p(20261013, 1425)),
    );
    assert!(matches!(
        coverage(&request(), &exported),
        Coverage::Complete(_)
    ));
}

#[test]
fn coverage_incomplete_index_is_reported_without_forwarding() {
    let mut index = CaptureIndex::default();
    full(&mut index, 0);
    index.mark_incomplete("ultra-srt-ncst", 20261009);
    assert_eq!(coverage(&request(), &index), Coverage::IndexIncomplete);
    // Minute pages, station-minute exports and grid export listings count as well.
    for (kind, date) in [
        ("aws-minute", 20261013),
        ("kma-stn-minute2", 20261013),
        ("kma-town-current", server2::history::index::ALL_DATES),
        ("kma-stn-hourly2", server2::history::index::ALL_DATES),
    ] {
        let mut index = CaptureIndex::default();
        full(&mut index, 0);
        index.mark_incomplete(kind, date);
        assert_eq!(
            coverage(&request(), &index),
            Coverage::IndexIncomplete,
            "{kind}"
        );
    }
}
