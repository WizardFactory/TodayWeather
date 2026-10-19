//! One admitted occurrence of the conditional alert's existing UTC time predicate.
use crate::push::js::{self, ge};
use crate::world::js::{Obj, Val};

const DAY_SECONDS: i64 = 86_400;
const DAY_MS: i64 = DAY_SECONDS * 1000;

// Keep the legacy comparisons, including coercion and inclusive whole seconds.
pub(super) fn inside_window(info: &Obj, now: i64) -> bool {
    let time = Val::Num((now.rem_euclid(DAY_MS) / 1000) as f64);
    match info.get("reverseTime") {
        Val::Bool(false) => ge(&time, info.get("startTime")) && js::le(&time, info.get("endTime")),
        Val::Bool(true) => ge(&time, info.get("startTime")) || js::le(&time, info.get("endTime")),
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum Close {
    Unbounded,
    At(i64),
}

/// The actual admission clock is separate from run_minute's explicit selection argument.
/// An invalid window remains refused; an all-day predicate has no invented daily cutoff.
#[derive(Clone, Copy)]
pub(super) struct AlertAdmission {
    pub(super) at_ms: i64,
    close: Option<Close>,
}
impl AlertAdmission {
    pub(super) fn new(info: &Obj, at_ms: i64) -> Self {
        Self {
            at_ms,
            close: close(info, at_ms),
        }
    }
    pub(super) fn permits(self, now_ms: i64) -> bool {
        now_ms >= self.at_ms
            && match self.close {
                Some(Close::Unbounded) => true,
                Some(Close::At(end)) => now_ms < end,
                None => false,
            }
    }
}

fn close(info: &Obj, at_ms: i64) -> Option<Close> {
    if !inside_window(info, at_ms) {
        return None;
    }
    // The left comparison operand is numeric, so the existing JS rules coerce both
    // endpoints to numbers. Its truth value changes at at most these two integer cuts.
    let start = js::number(info.get("startTime"));
    let end = js::number(info.get("endTime"));
    let mut cuts = [0, DAY_SECONDS, DAY_SECONDS, DAY_SECONDS];
    if start.is_finite() {
        cuts[2] = start.ceil().clamp(0., DAY_SECONDS as f64) as i64;
    }
    if end.is_finite() {
        cuts[3] = (end.floor() + 1.).clamp(0., DAY_SECONDS as f64) as i64;
    }
    cuts.sort_unstable();
    let mut allowed = [(0, 0); 3];
    let mut count = 0;
    for pair in cuts.windows(2) {
        let (lo, hi) = (pair[0], pair[1]);
        if lo == hi || !inside_window(info, lo * 1000) {
            continue;
        }
        if count > 0 && allowed[count - 1].1 == lo {
            allowed[count - 1].1 = hi;
        } else {
            allowed[count] = (lo, hi);
            count += 1;
        }
    }
    let spans = &allowed[..count];
    if spans == [(0, DAY_SECONDS)] {
        return Some(Close::Unbounded);
    }
    let second = at_ms.rem_euclid(DAY_MS) / 1000;
    let mut stop = spans
        .iter()
        .find(|(lo, hi)| *lo <= second && second < *hi)?
        .1;
    // An overnight occurrence can join the last and first allowed pieces, but cannot
    // jump the first excluded second into a different day's occurrence.
    if stop == DAY_SECONDS && spans.first()?.0 == 0 {
        stop += spans[0].1;
    }
    let day_start = at_ms.checked_sub(at_ms.rem_euclid(DAY_MS))?;
    Some(Close::At(day_start.checked_add(stop.checked_mul(1000)?)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(start: Val, end: Val, reverse: Val) -> Obj {
        let mut info = Obj::new();
        info.set("startTime", start);
        info.set("endTime", end);
        info.set("reverseTime", reverse);
        info
    }

    #[test]
    fn captured_occurrence_matches_the_original_predicate_without_scanning_at_runtime() {
        let cases = [
            (Val::Num(7.2), Val::Num(17.8), Val::Bool(false), 8500),
            (
                Val::Num(23. * 3600.),
                Val::Num(2. * 3600.),
                Val::Bool(true),
                84_600_123,
            ),
            (Val::Num(0.), Val::Num(86399.), Val::Bool(false), 43_200_500),
            (Val::Num(10.), Val::Num(9.), Val::Bool(true), 12_000),
            (Val::Num(10.5), Val::Num(9.5), Val::Bool(true), 12_000),
            (
                Val::Str("7.2".into()),
                Val::Str("17.8".into()),
                Val::Bool(false),
                8500,
            ),
            (
                Val::Arr(vec![Val::Num(3600.)]),
                Val::Null,
                Val::Bool(true),
                7_200_000,
            ),
            (Val::Bool(false), Val::Bool(true), Val::Bool(false), 1999),
            (Val::Obj(Obj::new()), Val::Num(10.), Val::Bool(true), 5000),
            (Val::Undef, Val::Num(10.), Val::Bool(true), 5000),
            (
                Val::Null,
                Val::Num(f64::INFINITY),
                Val::Bool(false),
                43_200_000,
            ),
            (
                Val::Num(f64::INFINITY),
                Val::Num(f64::NAN),
                Val::Bool(true),
                5000,
            ),
            (Val::Date(7.), Val::Date(17.), Val::Bool(false), 8500),
            (
                Val::Num(0.),
                Val::Num(86399.),
                Val::Str("false".into()),
                5000,
            ),
            (Val::Num(7.), Val::Num(17.), Val::Bool(false), -86_391_500),
        ];
        for (start, end, reverse, at) in cases {
            let info = record(start, end, reverse);
            let admission = AlertAdmission::new(&info, at);
            assert!(
                !admission.permits(at - 1),
                "never admit a clock behind entry"
            );
            if !inside_window(&info, at) {
                assert!(!admission.permits(at));
                assert!(!admission.permits(at + DAY_MS));
                continue;
            }
            assert!(admission.permits(at));
            // Independent test-only brute scan of the original predicate. Production
            // derives at most three allowed intervals; it never loops over the day.
            let next_second = (at.div_euclid(1000) + 1) * 1000;
            let first_closed = (0..DAY_SECONDS)
                .map(|i| next_second + i * 1000)
                .find(|t| !inside_window(&info, *t));
            if let Some(stop) = first_closed {
                assert!(admission.permits(stop - 1), "inclusive last second");
                assert!(!admission.permits(stop), "first excluded second");
                assert!(!admission.permits(stop + DAY_MS), "no next-window revival");
            } else {
                assert!(admission.permits(at + 2 * DAY_MS), "all-day is continuous");
            }
        }
    }

    #[test]
    fn unrepresentable_window_end_fails_closed() {
        let at = i64::MAX;
        let last_second = at.rem_euclid(DAY_MS) / 1000;
        let info = record(
            Val::Num(0.),
            Val::Num((last_second + 1) as f64),
            Val::Bool(false),
        );
        assert!(
            inside_window(&info, at),
            "the legacy predicate itself permits this instant"
        );
        let admission = AlertAdmission::new(&info, at);
        assert!(
            !admission.permits(at),
            "a closing timestamp that would overflow must fail closed"
        );
    }
}
