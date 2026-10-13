//! Capture families, legacy windows and the demand-gated plan.
use super::provider_support::kst;
use super::support::*;
use server2::history::index::CaptureIndex;
use server2::history::schedule::{
    self, BACKFILL_CURRENT, BACKFILL_SHORT, BACKFILL_SHORTEST, Family, Planned, Target,
};
use std::collections::BTreeSet;

fn at() -> i64 {
    kst(2026, 10, 13, 14, 25)
}

#[test]
fn windows_reproduce_the_legacy_192_slot_current_list() {
    let w = schedule::current_window(at());
    assert_eq!(w.len(), 192);
    assert_eq!(w[0], p(20261005, 1500));
    assert_eq!(w[191], p(20261013, 1400));
    assert!(
        w.windows(2)
            .all(|x| schedule::to_ms(x[1]) - schedule::to_ms(x[0]) == HOUR)
    );
    assert_eq!(schedule::hour_of(at()), p(20261013, 1400));
    // The midnight hour belongs to the previous day as 2400 (legacy convert0Hto24H).
    assert_eq!(schedule::day_attribution(p(20261013, 0)), (20261012, 2400));
    assert_eq!(schedule::day_attribution(p(20261013, 100)), (20261013, 100));
    assert_eq!(schedule::day_attribution(p(20260301, 0)), (20260228, 2400));
    // Yesterday is the slot exactly 24 hours earlier, across month ends.
    assert_eq!(schedule::yesterday(p(20261013, 1400)), p(20261012, 1400));
    assert_eq!(schedule::yesterday(p(20261101, 0)), p(20261031, 0));
    // Station minute window (anchor-20min, anchor].
    assert_eq!(
        schedule::minute_window(p(20261013, 5)),
        (p(20261012, 2345), p(20261013, 5))
    );
    assert_eq!(
        schedule::from_ms(schedule::to_ms(p(20261013, 1437))),
        p(20261013, 1437)
    );
}

#[test]
fn families_use_legacy_publication_times_and_lookbacks() {
    let t = at();
    assert_eq!(Family::Current.latest(t), Some(p(20261013, 1300)));
    assert_eq!(Family::Shortest.latest(t), Some(p(20261013, 1300)));
    assert_eq!(Family::Short.latest(t), Some(p(20261013, 1400)));
    assert_eq!(Family::AwsHourly.latest(t), Some(p(20261013, 1400)));
    assert_eq!(Family::CityObs.latest(t), Some(p(20261013, 1400)));
    assert_eq!(Family::AwsMinute.latest(t), None);
    // After HH40/HH45 the current hour becomes the latest.
    assert_eq!(
        Family::Current.latest(kst(2026, 10, 13, 14, 41)),
        Some(p(20261013, 1400))
    );
    assert_eq!(
        Family::Shortest.latest(kst(2026, 10, 13, 14, 46)),
        Some(p(20261013, 1400))
    );
    let current = Family::Current.required(t);
    assert_eq!(current.len(), 191);
    assert_eq!(current[0], p(20261005, 1500));
    assert_eq!(*current.last().unwrap(), p(20261013, 1300));
    assert_eq!(Family::Shortest.required(t), current);
    let short = Family::Short.required(t);
    assert_eq!(short.len(), 66);
    assert_eq!(short[0], p(20261005, 1100));
    assert_eq!(*short.last().unwrap(), p(20261013, 1400));
    assert!(short.iter().all(|x| x.minute() == 0 && x.hour() % 3 == 2));
    let hourly = Family::AwsHourly.required(t);
    assert_eq!(hourly.len(), 192);
    assert_eq!(hourly[0], p(20261005, 1500));
    assert_eq!(Family::CityObs.required(t), hourly);
    assert_eq!(
        (Family::Current.source(), Family::Current.kind()),
        ("data-go-kr", "ultra-srt-ncst")
    );
    assert_eq!(Family::Shortest.kind(), "ultra-srt-fcst");
    assert_eq!(Family::Short.kind(), "vilage-fcst");
    assert_eq!(
        (Family::AwsMinute.source(), Family::AwsMinute.kind()),
        ("kma-web", "aws-minute")
    );
    assert_eq!(Family::CityObs.kind(), "city-obs");
}

#[test]
fn plan_is_empty_without_demand() {
    let plan = schedule::plan(at(), &BTreeSet::new(), &CaptureIndex::default());
    assert!(plan.is_empty());
}

#[test]
fn plan_requests_latest_then_backfill_for_demand_cells_only() {
    let cell = g(60, 127);
    let active = BTreeSet::from([cell]);
    let plan = schedule::plan(at(), &active, &CaptureIndex::default());
    // Latest per-cell publications first, then the national latest pages.
    assert_eq!(
        &plan[..5],
        &[
            Planned {
                family: Family::Current,
                target: Target::Cell(cell),
                publication: p(20261013, 1300),
                backfill: false
            },
            Planned {
                family: Family::Shortest,
                target: Target::Cell(cell),
                publication: p(20261013, 1300),
                backfill: false
            },
            Planned {
                family: Family::Short,
                target: Target::Cell(cell),
                publication: p(20261013, 1400),
                backfill: false
            },
            Planned {
                family: Family::AwsHourly,
                target: Target::National,
                publication: p(20261013, 1400),
                backfill: false
            },
            Planned {
                family: Family::CityObs,
                target: Target::National,
                publication: p(20261013, 1400),
                backfill: false
            },
        ]
    );
    let count = |f: Family, b: bool| {
        plan.iter()
            .filter(|x| x.family == f && x.backfill == b)
            .count()
    };
    assert_eq!(count(Family::Current, true), BACKFILL_CURRENT);
    assert_eq!(BACKFILL_CURRENT, 23);
    assert_eq!(count(Family::Shortest, true), BACKFILL_SHORTEST);
    assert_eq!(count(Family::Short, true), BACKFILL_SHORT);
    assert_eq!((BACKFILL_SHORTEST, BACKFILL_SHORT), (23, 7));
    // National pages backfill the whole 192-hour lookback.
    assert_eq!(count(Family::AwsHourly, true), 191);
    assert_eq!(count(Family::CityObs, true), 191);
    // Backfill is newest first and never repeats the latest publication.
    let current: Vec<_> = plan
        .iter()
        .filter(|x| x.family == Family::Current && x.backfill)
        .map(|x| x.publication)
        .collect();
    assert_eq!(current[0], p(20261013, 1200));
    assert_eq!(current[22], p(20261012, 1400));
    // Only the demand cell is targeted; the minute page is not part of the hourly plan.
    assert!(plan.iter().all(|x| match x.target {
        Target::Cell(c) => c == cell,
        Target::National => matches!(x.family, Family::AwsHourly | Family::CityObs),
    }));
}

#[test]
fn plan_skips_publications_already_present() {
    let cell = g(60, 127);
    let mut index = CaptureIndex::default();
    index.insert(Family::Current, Target::Cell(cell), p(20261013, 1300));
    index.insert(Family::Current, Target::Cell(cell), p(20261013, 1200));
    index.insert(Family::AwsHourly, Target::National, p(20261013, 1400));
    let plan = schedule::plan(at(), &BTreeSet::from([cell]), &index);
    assert!(!plan.iter().any(|x| x.family == Family::Current
        && matches!(x.publication.time(), 1300 | 1200)
        && x.publication.date() == 20261013));
    assert!(
        !plan
            .iter()
            .any(|x| x.family == Family::AwsHourly && x.publication == p(20261013, 1400))
    );
    assert_eq!(
        plan.iter()
            .filter(|x| x.family == Family::Current && x.backfill)
            .count(),
        22
    );
}
