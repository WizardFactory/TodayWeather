//! `lib/kmaTimeLib.js`, `controllerManager.getWorldTime/leadingZeros` and the V8 `Date` parsing
//! the v000903 chain relies on. The legacy process zone is UTC (S02 oracle), so local Date
//! components equal UTC components and `getTimezoneOffset()` is 0.
use super::js::{V, sv, throw, to_str};
use crate::world::js as wjs;

pub const HOUR: f64 = 3_600_000.;
pub const DAY: f64 = 86_400_000.;

fn pad(n: i64, w: usize) -> String {
    if n < 0 {
        // leadingZeros on a negative number keeps the sign inside the padding like String(n).
        let s = n.to_string();
        if s.len() < w {
            format!("{}{s}", "0".repeat(w - s.len()))
        } else {
            s
        }
    } else {
        format!("{n:0w$}")
    }
}
/// `manager.getWorldTime(tz)`: `YYYYMMDDHHMM` of now shifted by `tz` hours.
pub fn world_time(now_ms: f64, tz: f64) -> String {
    let ms = now_ms + tz * HOUR;
    match wjs::parts(ms) {
        Some(p) => format!(
            "{}{}{}{}{}",
            pad(p.year, 4),
            pad(p.month, 2),
            pad(p.day, 2),
            pad(p.hour, 2),
            pad(p.minute, 2)
        ),
        None => "0NaNNaNNaNNaNNaN".into(),
    }
}
/// `Date.UTC`-style construction with JavaScript month/day overflow (`new Date(y, m, d, h, mi, s)`
/// in the UTC process zone).
pub fn make_date(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64) -> f64 {
    if ![y, m, d, h, mi, s].iter().all(|x| x.is_finite()) {
        return f64::NAN;
    }
    let (y, m, d) = (y.trunc(), m.trunc(), d.trunc());
    let ym = y + (m / 12.).floor();
    let mn = m.rem_euclid(12.);
    let days = wjs::days_from_civil(ym as i64, mn as i64 + 1, 1) as f64 + d - 1.;
    let ms = days * DAY + h.trunc() * HOUR + mi.trunc() * 60_000. + s.trunc() * 1000.;
    if ms.abs() > 8.64e15 { f64::NAN } else { ms }
}
/// `kmaTimeLib.convertStringToDate(str)`: a Date, `new Date(0)` for an empty string, or
/// undefined when the calendar fields do not survive.
pub fn convert_string_to_date(v: &V) -> V {
    if !v.truthy() {
        return V::Date(0.);
    }
    let s = sv(v);
    let sub = |a: usize, n: usize| super::js::substr(&s, a, n);
    let y = sub(0, 4);
    let m = wjs::string_to_number(&sub(4, 2)) - 1.;
    let d = sub(6, 2);
    let mut h = sub(8, 2);
    let mut mi = sub(10, 2);
    let mut sec = sub(12, 2);
    if h.is_empty() {
        h = "0".into();
    }
    if mi.is_empty() {
        mi = "0".into();
    }
    if sec.is_empty() {
        sec = "0".into();
    }
    let n = wjs::string_to_number;
    let ms = make_date(n(&y), m, n(&d), n(&h), n(&mi), n(&sec));
    let Some(p) = wjs::parts(ms) else {
        return V::Undef;
    };
    // D.getFullYear() == y && D.getMonth() == m && D.getDate() == d (loose equality on strings).
    if p.year as f64 == n(&y) && (p.month - 1) as f64 == m && p.day as f64 == n(&d) {
        V::Date(ms)
    } else {
        V::Undef
    }
}
/// Time value of a Date receiver; a non-Date receiver throws (`D.getDate` of undefined).
pub fn date_ms(v: &V) -> f64 {
    match v {
        V::Date(ms) => *ms,
        other => throw(format!("TypeError: not a Date: {}", to_str(other))),
    }
}
/// `new Date(v)` for a Date, number or string.
pub fn new_date(v: &V) -> f64 {
    match v {
        V::Date(ms) => *ms,
        V::Num(n) => {
            if n.is_finite() && n.abs() <= 8.64e15 {
                n.trunc()
            } else {
                f64::NAN
            }
        }
        V::Str(s) => parse_date(s),
        V::Undef => f64::NAN,
        V::Null => 0.,
        other => parse_date(&to_str(other)),
    }
}
/// V8 `Date.parse` for the forms the chain produces: ISO dates (UTC), ISO date-times with or
/// without an offset (no offset is local), and the legacy `YYYY.MM.DD[ HH:MM]` and
/// `YYYY-MM-DD HH:MM` forms (local). Local is UTC in the oracle process.
pub fn parse_date(s: &str) -> f64 {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<f64> {
        let t = s.get(r)?;
        (!t.is_empty() && t.bytes().all(|c| c.is_ascii_digit()))
            .then(|| t.parse::<f64>().ok())
            .flatten()
    };
    let ymd = |sep: u8| -> Option<(f64, f64, f64)> {
        if b.len() < 10 || b[4] != sep || b[7] != sep {
            return None;
        }
        Some((num(0..4)?, num(5..7)?, num(8..10)?))
    };
    let valid = |y: f64, m: f64, d: f64, h: f64, mi: f64, sec: f64| {
        (1. ..=12.).contains(&m)
            && d >= 1.
            && d <= wjs::days_in_month(y as i64, m as i64) as f64
            && h <= 24.
            && mi <= 59.
            && sec <= 59.
            && (h < 24. || (mi == 0. && sec == 0.))
    };
    // Legacy dotted form.
    if let Some((y, m, d)) = ymd(b'.') {
        let (h, mi) = if b.len() == 10 {
            (0., 0.)
        } else if b.len() == 16 && b[10] == b' ' && b[13] == b':' {
            match (num(11..13), num(14..16)) {
                (Some(h), Some(mi)) => (h, mi),
                _ => return f64::NAN,
            }
        } else {
            return wjs::parse_dot(s);
        };
        if !(1. ..=12.).contains(&m) || !(1. ..=31.).contains(&d) || h > 24. || mi > 59. {
            return f64::NAN;
        }
        return make_date(y, m - 1., d, h, mi, 0.);
    }
    if let Some((y, m, d)) = ymd(b'-') {
        if b.len() == 10 {
            return if valid(y, m, d, 0., 0., 0.) {
                make_date(y, m - 1., d, 0., 0., 0.)
            } else {
                f64::NAN
            };
        }
        if b.len() >= 16 && (b[10] == b'T' || b[10] == b' ') && b[13] == b':' {
            let (Some(h), Some(mi)) = (num(11..13), num(14..16)) else {
                return f64::NAN;
            };
            let mut i = 16;
            let mut sec = 0.;
            let mut milli = 0.;
            if b.len() > i && b[i] == b':' {
                let Some(x) = num(i + 1..i + 3) else {
                    return f64::NAN;
                };
                sec = x;
                i += 3;
                if b.len() > i && b[i] == b'.' {
                    let mut j = i + 1;
                    while j < b.len() && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    let frac = &s[i + 1..j];
                    let digits: String = frac.chars().take(3).collect();
                    milli = format!("{digits:0<3}").parse::<f64>().unwrap_or(0.);
                    i = j;
                }
            }
            if !valid(y, m, d, h, mi, sec) {
                return f64::NAN;
            }
            let base = make_date(y, m - 1., d, h, mi, sec) + milli;
            let rest = &s[i..];
            if rest.is_empty() {
                return base;
            }
            if rest == "Z" && b[10] == b'T' {
                return base;
            }
            let rb = rest.as_bytes();
            if rb.len() == 6 && (rb[0] == b'+' || rb[0] == b'-') && rb[3] == b':' {
                let (Ok(oh), Ok(om)) = (rest[1..3].parse::<f64>(), rest[4..6].parse::<f64>())
                else {
                    return f64::NAN;
                };
                let off = (oh * 60. + om) * 60_000.;
                return if rb[0] == b'+' {
                    base - off
                } else {
                    base + off
                };
            }
            return f64::NAN;
        }
    }
    f64::NAN
}
/// `kmaTimeLib.convertDateToYYYYMMDD(date)`.
pub fn yyyymmdd(v: &V) -> String {
    let ms = new_date(v);
    match wjs::parts(ms) {
        Some(p) => format!("{}{}{}", p.year, pad(p.month, 2), pad(p.day, 2)),
        None => "NaNNaNNaN".into(),
    }
}
pub fn yyyymmdd_ms(ms: f64) -> String {
    yyyymmdd(&V::Date(ms))
}
/// `kmaTimeLib.convertDateToHHZZ(date)`.
pub fn hhzz(v: &V) -> String {
    match wjs::parts(new_date(v)) {
        Some(p) => format!("{}00", pad(p.hour, 2)),
        None => "NaN00".into(),
    }
}
/// `kmaTimeLib.convertDateToHHMM(date)`.
pub fn hhmm(v: &V) -> String {
    match wjs::parts(new_date(v)) {
        Some(p) => format!("{}{}", pad(p.hour, 2), pad(p.minute, 2)),
        None => "NaNNaN".into(),
    }
}
/// `kmaTimeLib.getKoreaTimeString(date)`.
pub fn korea_time_string(v: &V) -> String {
    let ms = date_ms(v) + 9. * HOUR;
    match wjs::parts(ms) {
        Some(p) => format!(
            "{}{}{}{}{}",
            pad(p.year, 4),
            pad(p.month, 2),
            pad(p.day, 2),
            pad(p.hour, 2),
            pad(p.minute, 2)
        ),
        None => "NaNNaNNaNNaNNaN".into(),
    }
}
/// `kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(date)`.
pub fn yyyy_mm_dd_hhmm(ms: f64) -> String {
    match wjs::parts(ms) {
        Some(p) => format!(
            "{}-{}-{} {}:{}",
            p.year,
            pad(p.month, 2),
            pad(p.day, 2),
            pad(p.hour, 2),
            pad(p.minute, 2)
        ),
        None => "NaN-NaN-NaN NaN:NaN".into(),
    }
}
/// `convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM`.
pub fn dot_space(s: &str) -> String {
    let sub = |a, n| super::js::substr(s, a, n);
    let mut out = format!("{}.{}.{}", sub(0, 4), sub(4, 2), sub(6, 2));
    if s.encode_utf16().count() > 8 {
        out.push_str(&format!(" {}:{}", sub(8, 2), sub(10, 2)));
    }
    out
}
/// `convertYYYYoMMoDDoHHoMMtoYYYYoMMoDD_HHoMM`.
pub fn dotted_to_dot_space(s: &str) -> String {
    let sub = |a, n| super::js::substr(s, a, n);
    let mut out = format!("{}.{}.{}", sub(0, 4), sub(5, 2), sub(8, 2));
    if s.encode_utf16().count() > 10 {
        out.push_str(&format!(" {}:{}", sub(11, 2), sub(14, 2)));
    }
    out
}
/// `convertYYYYoMMoDDoHHoMMtoYYYYMMDDHHMM`.
pub fn dotted_to_compact(s: &str) -> String {
    let sub = |a, n| super::js::substr(s, a, n);
    let mut out = format!("{}{}{}", sub(0, 4), sub(5, 2), sub(8, 2));
    if s.encode_utf16().count() > 10 {
        out.push_str(&format!("{}{}", sub(11, 2), sub(14, 2)));
    }
    out
}
/// `convertYYYYoMMoDDoHHoMMtoHHMM`.
pub fn dotted_hhmm(s: &str) -> String {
    if s.encode_utf16().count() > 10 {
        format!(
            "{}{}",
            super::js::substr(s, 11, 2),
            super::js::substr(s, 14, 2)
        )
    } else {
        String::new()
    }
}
/// `convertYYYYMMDDtoYYYY_MM_DD`.
pub fn dashed_date(s: &str) -> String {
    let sub = |a, n| super::js::substr(s, a, n);
    format!("{}-{}-{}", sub(0, 4), sub(4, 2), sub(6, 2))
}
/// `kmaTimeLib.convert0Hto24H(obj)`.
pub fn convert_0h_to_24h(obj: &V) {
    if super::js::strict_eq(&obj.get("time"), &V::s("0000")) {
        let d = convert_string_to_date(&obj.get("date"));
        let ms = date_ms(&d) - DAY;
        obj.set("time", "2400");
        obj.set("date", yyyymmdd_ms(ms));
    }
}
/// `kmaTimeLib.convert24Hto0H(obj)`.
pub fn convert_24h_to_0h(obj: &V) {
    if super::js::strict_eq(&obj.get("time"), &V::s("2400")) {
        let d = convert_string_to_date(&obj.get("date"));
        let ms = date_ms(&d) + DAY;
        obj.set("time", "0000");
        obj.set("date", yyyymmdd_ms(ms));
    }
}
/// `kmaTimeLib.getDiffDays(target, current)`.
pub fn diff_days(target: &V, current: &V) -> f64 {
    if !target.truthy() || !current.truthy() {
        return 0.;
    }
    let (a, b) = (new_date(target), new_date(current));
    match (wjs::parts(a), wjs::parts(b)) {
        (Some(a), Some(b)) => {
            let da = make_date(
                a.year as f64,
                (a.month - 1) as f64,
                a.day as f64,
                0.,
                0.,
                0.,
            );
            let db = make_date(
                b.year as f64,
                (b.month - 1) as f64,
                b.day as f64,
                0.,
                0.,
                0.,
            );
            ((da - db) / DAY).ceil()
        }
        _ => f64::NAN,
    }
}
/// `(new Date(v)).getDay()`.
pub fn weekday(v: &V) -> f64 {
    wjs::parts(new_date(v)).map_or(f64::NAN, |p| p.weekday as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_time_helpers() {
        let now = 1_790_208_600_000.; // 2026-09-24T00:10:00Z
        assert_eq!(world_time(now, 9.), "202609240910");
        assert_eq!(world_time(now, 9. - 192.), "202609160910");
        let d = convert_string_to_date(&V::s("20260924"));
        assert_eq!(yyyymmdd(&d), "20260924");
        assert!(convert_string_to_date(&V::s("20260231")).is_undef());
        let o = V::Obj(super::super::js::obj(vec![
            ("date", V::s("20260925")),
            ("time", V::s("0000")),
        ]));
        convert_0h_to_24h(&o);
        assert_eq!(to_str(&o.get("date")), "20260924");
        assert_eq!(to_str(&o.get("time")), "2400");
        assert_eq!(parse_date("2026-09-24 08:50"), 1_790_239_800_000.);
        assert_eq!(
            diff_days(&V::s("2026.09.26 00:00"), &V::s("2026.09.24 08:50")),
            2.
        );
        assert_eq!(weekday(&V::s("2026.09.24 00:00")), 4.);
    }
}
