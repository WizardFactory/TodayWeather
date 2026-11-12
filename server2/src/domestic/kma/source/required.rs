//! Required in-request current-day history; completed days come from ASOS. Under ASOS-primary,
//! hours of the last 23 h that the ASOS rules leave unknown add their nowcast (`fill`).
use crate::{domestic::publication::Publication, history::schedule};
/// Newest publication is always first. VSRT's six valid hours cover the current
/// day from the previous 23:30 issue; no past SHRT is a historical substitute. The current
/// three-hour row (label <= now < label + 3 h) keeps its forecast, so from HH+2:10 to HH+2:59,
/// when the latest SHRT starts at HH+3, the previous SHRT (the newest covering slot HH) follows.
pub fn foreground(family: schedule::Family, now_ms: i64) -> Vec<Publication> {
    let Some(latest) = family.latest(now_ms) else {
        return Vec::new();
    };
    let today = schedule::from_ms(now_ms).date();
    let mut out = vec![latest];
    match family {
        schedule::Family::Current => {
            let mut hour = latest;
            while let Some(previous) = hour.add_hours(-1) {
                if previous.date() != today {
                    break;
                }
                out.push(previous);
                hour = previous;
            }
        }
        schedule::Family::Shortest => {
            let mut issue = Publication::new(today, 0).and_then(|p| p.add_hours(-1));
            while let Some(p) = issue {
                if p > latest {
                    break;
                }
                if p != latest {
                    out.push(p);
                }
                issue = p.add_hours(6);
            }
        }
        schedule::Family::Short => {
            let now = schedule::from_ms(now_ms);
            let slot = Publication::new(today, (now.hour() - now.hour() % 3) * 100);
            if slot.is_some_and(|slot| latest.add_hours(1).is_some_and(|first| first > slot)) {
                out.push(family.previous(latest));
            }
        }
        _ => (),
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    fn now(date: u32, hour: u16, minute: u16) -> i64 {
        schedule::to_ms(Publication::new(date, hour * 100 + minute).unwrap())
    }
    #[test]
    fn observations_cover_current_day_and_keep_latest_first() {
        let n = now(20261025, 19, 59);
        let actual = foreground(schedule::Family::Current, n);
        assert_eq!(actual.first().copied(), schedule::Family::Current.latest(n));
        assert!(actual.iter().any(|p| p.date() == 20261025 && p.hour() == 0));
        assert!(actual.len() <= 24);
        assert!(actual.iter().all(|p| p.date() == 20261025));
    }
    #[test]
    fn six_hour_ultra_short_issues_cover_the_day_without_hourly_duplicate_calls() {
        let n = now(20261025, 19, 59);
        let actual = foreground(schedule::Family::Shortest, n);
        let latest = schedule::Family::Shortest.latest(n).unwrap();
        assert_eq!(actual.first(), Some(&latest));
        assert!(actual.len() <= 5);
        for hour in 0..=latest.hour() {
            let valid = Publication::new(20261025, hour * 100).unwrap();
            assert!(
                actual
                    .iter()
                    .any(|p| (1..=6).any(|lead| p.add_hours(lead) == Some(valid))),
                "missing {hour}"
            );
        }
        assert_eq!(
            foreground(schedule::Family::Short, n),
            vec![schedule::Family::Short.latest(n).unwrap()]
        );
    }
    /// The current three-hour row (label <= now < label + 3 h) keeps its forecast. From HH+2:10
    /// the latest SHRT starts at HH+3, so the previous one is the newest covering slot HH; before
    /// that the latest covers it and nothing older is read or requested.
    #[test]
    fn the_previous_short_publication_is_required_only_while_the_latest_misses_the_current_slot() {
        let short =
            |date, hour, minute| foreground(schedule::Family::Short, now(date, hour, minute));
        let p = |date, time| Publication::new(date, time).unwrap();
        // 18:31: the 17:00 publication covers the 18:00 slot.
        assert_eq!(short(20261107, 18, 31), vec![p(20261107, 1700)]);
        assert_eq!(short(20261107, 20, 9), vec![p(20261107, 1700)]);
        // 20:10..20:59: the 20:00 publication starts at 21:00.
        assert_eq!(
            short(20261107, 20, 10),
            vec![p(20261107, 2000), p(20261107, 1700)]
        );
        assert_eq!(
            short(20261107, 20, 59),
            vec![p(20261107, 2000), p(20261107, 1700)]
        );
        assert_eq!(short(20261107, 21, 0), vec![p(20261107, 2000)]);
        // Across midnight: 02:10..02:59 needs the previous day's 23:00 for the 00:00 slot.
        assert_eq!(short(20261108, 1, 0), vec![p(20261107, 2300)]);
        assert_eq!(
            short(20261108, 2, 30),
            vec![p(20261108, 200), p(20261107, 2300)]
        );
        assert_eq!(
            short(20261107, 23, 30),
            vec![p(20261107, 2300), p(20261107, 2000)]
        );
    }
    #[test]
    fn unpublished_midnight_does_not_schedule_a_future_observation() {
        let n = now(20261025, 0, 0);
        let actual = foreground(schedule::Family::Current, n);
        assert_eq!(actual, vec![schedule::Family::Current.latest(n).unwrap()]);
    }
}
