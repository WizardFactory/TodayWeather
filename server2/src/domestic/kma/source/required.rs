//! Required in-request current-day history; completed days come from ASOS.
use crate::{domestic::publication::Publication, history::schedule};
/// Newest publication is always first. VSRT's six valid hours cover the current
/// day from the previous 23:30 issue; no past SHRT is a historical substitute.
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
    #[test]
    fn unpublished_midnight_does_not_schedule_a_future_observation() {
        let n = now(20261025, 0, 0);
        let actual = foreground(schedule::Family::Current, n);
        assert_eq!(actual, vec![schedule::Family::Current.latest(n).unwrap()]);
    }
}
