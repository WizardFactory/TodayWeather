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
/// `new Date(y, m, d, h, mi, s)` / `Date.UTC(y, ...)` (process zone UTC): a year whose integer is
/// 0-99 means 1900-1999, as for every numeric Date constructor in the legacy code.
pub fn make_date(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64) -> f64 {
    let y = if y.is_finite() && (0. ..=99.).contains(&y.trunc()) {
        1900. + y.trunc()
    } else {
        y
    };
    make_date_literal(y, m, d, h, mi, s)
}
/// MakeDate with the year taken literally (the `Date.parse` ISO forms).
pub fn make_date_literal(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64) -> f64 {
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
        // ToNumber(boolean): `new Date(false)` is 0 ms, `new Date(true)` 1 ms.
        V::Bool(b) => f64::from(u8::from(*b)),
        other => parse_date(&to_str(other)),
    }
}
/// V8 `Date.parse` (process zone UTC, so local equals UTC) for the forms whose result this port
/// reproduces exactly:
/// - `YYYY-MM-DD` (month 1-12, day 1-31; day overflow rolls over as in V8);
/// - `YYYY-MM-DD{T|t| }HH:MM[:SS[.fraction]][Z|z|+-HH:MM|+-HHMM]` (hour 24 only at exactly
///   midnight, offsets up to 23:59; with `T` an out-of-range field is `NaN` as in V8; the space
///   form only for years from 100);
/// - the legacy dotted `YYYY.M[M].D[D]` date, optionally followed by ` H[H]:M[M]` or
///   `.H[H]:M[M]` (the KMA page forms; checked against the pinned V8 for 1- and 2-digit month,
///   day, hour and minute fields): in-range fields give the UTC fields; with a time, an
///   out-of-range field or a year below 100 is `NaN`;
/// - strings without an ASCII digit and digit-only strings of 7 or more digits (`NaN`).
///
/// Any other string with digits may be accepted by V8's permissive legacy parser; the request is
/// forwarded to legacy rather than guessing.
pub fn parse_date(s: &str) -> f64 {
    try_parse_date(s).unwrap_or_else(|| {
        super::js::forward(format!(
            "date string form not reproduced (V8 legacy Date.parse): {s:?}"
        ))
    })
}
/// [`parse_date`] without forwarding: None for a form this port does not reproduce.
pub fn try_parse_date(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<f64> {
        let t = b.get(r)?;
        (!t.is_empty() && t.iter().all(u8::is_ascii_digit))
            .then(|| std::str::from_utf8(t).ok()?.parse::<f64>().ok())
            .flatten()
    };
    if let Some(ms) = dotted(s) {
        return Some(ms);
    }
    if let Some(ms) = iso_date_time(b, &num) {
        return Some(ms);
    }
    let digits = b.iter().filter(|c| c.is_ascii_digit()).count();
    if digits == 0 || (digits == b.len() && digits >= 7) {
        return Some(f64::NAN);
    }
    None
}
/// The legacy dotted forms `YYYY.M[M].D[D]` and `YYYY.M[M].D[D]{ |.}H[H]:M[M]`; None for any
/// other shape.
fn dotted(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() < 8 || b.get(4) != Some(&b'.') || !b[..4].iter().all(u8::is_ascii_digit) {
        return None;
    }
    // Fields of 1-2 ASCII digits split at `.`, then an optional time after ` ` or `.`.
    let field = |t: &[u8]| -> Option<f64> {
        ((1..=2).contains(&t.len()) && t.iter().all(u8::is_ascii_digit))
            .then(|| std::str::from_utf8(t).ok()?.parse::<f64>().ok())
            .flatten()
    };
    let rest = &b[5..];
    let m_end = rest.iter().position(|c| *c == b'.')?;
    let m = field(&rest[..m_end])?;
    let rest = &rest[m_end + 1..];
    let d_end = rest
        .iter()
        .position(|c| *c == b'.' || *c == b' ')
        .unwrap_or(rest.len());
    let d = field(&rest[..d_end])?;
    let (h, mi) = if d_end == rest.len() {
        (0., 0.)
    } else {
        let time = &rest[d_end + 1..];
        let colon = time.iter().position(|c| *c == b':')?;
        (field(&time[..colon])?, field(&time[colon + 1..])?)
    };
    let y: f64 = std::str::from_utf8(&b[..4]).ok()?.parse().ok()?;
    let timed = d_end != rest.len();
    let in_range = y >= 100.
        && (1. ..=12.).contains(&m)
        && (1. ..=31.).contains(&d)
        && mi <= 59.
        && (h < 24. || (h == 24. && mi == 0.));
    // Probed: every timed form; a date-only form only in range (others are not claimed).
    match (in_range, timed) {
        (true, _) => Some(make_date_literal(y, m - 1., d, h, mi, 0.)),
        (false, true) => Some(f64::NAN),
        (false, false) => None,
    }
}
/// The ISO family of [`parse_date`]; None when `b` is not of that exact shape.
fn iso_date_time(b: &[u8], num: &dyn Fn(std::ops::Range<usize>) -> Option<f64>) -> Option<f64> {
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let date_ok = (1. ..=12.).contains(&m) && (1. ..=31.).contains(&d);
    if b.len() == 10 {
        return Some(if date_ok {
            make_date_literal(y, m - 1., d, 0., 0., 0.)
        } else {
            f64::NAN
        });
    }
    let strict = matches!(b[10], b'T' | b't');
    // The space form is V8's legacy parser: a year below 100 is not read literally there.
    if !(strict || b[10] == b' ') || b.len() < 16 || b[13] != b':' || (!strict && y < 100.) {
        return None;
    }
    let (h, mi) = (num(11..13)?, num(14..16)?);
    let (mut i, mut sec, mut milli, mut fraction) = (16, 0., 0., false);
    if b.get(i) == Some(&b':') {
        sec = num(i + 1..i + 3)?;
        i += 3;
        if b.get(i) == Some(&b'.') {
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j == i + 1 {
                return None;
            }
            let mut frac = b[i + 1..j.min(i + 4)].to_vec();
            frac.resize(3, b'0');
            milli = std::str::from_utf8(&frac).ok()?.parse::<f64>().ok()?;
            // The ISO parser rejects hour 24 with any nonzero fraction digit, even below 1 ms.
            fraction = b[i + 1..j].iter().any(|&c| c != b'0');
            i = j;
        }
    }
    let rest = &b[i..];
    let (sign, oh, om) = match rest {
        [] | [b'Z' | b'z'] => (0., 0., 0.),
        [s @ (b'+' | b'-'), _, _, b':', _, _] => (
            if *s == b'+' { 1. } else { -1. },
            num(i + 1..i + 3)?,
            num(i + 4..i + 6)?,
        ),
        [s @ (b'+' | b'-'), _, _, _, _] => (
            if *s == b'+' { 1. } else { -1. },
            num(i + 1..i + 3)?,
            num(i + 3..i + 5)?,
        ),
        _ => return None,
    };
    let in_range = date_ok
        && h <= 24.
        && mi <= 59.
        && sec <= 59.
        && (h < 24. || (mi == 0. && sec == 0. && milli == 0. && !(strict && fraction)))
        && oh <= 23.
        && om <= 59.;
    if !in_range {
        // V8's ISO parser rejects it; with a space the legacy parser decides (not reproduced).
        return strict.then_some(f64::NAN);
    }
    Some(make_date_literal(y, m - 1., d, h, mi, sec) + milli - sign * (oh * 60. + om) * 60_000.)
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
    /// Dotted KMA page forms against `Date.parse` of the pinned Node 16.20.2 (TZ=UTC; 540 forms
    /// probed, these are representative; `None` is `NaN`).
    #[test]
    fn dotted_page_dates_follow_v8() {
        for (s, v8) in [
            ("2026.10.15.3:00", Some(1_792_033_200_000.)),
            ("2026.1.5.3:00", Some(1_767_582_000_000.)),
            ("2026.01.05.03:00", Some(1_767_582_000_000.)),
            ("2026.10.15.3:0", Some(1_792_033_200_000.)),
            ("2026.10.15 3:00", Some(1_792_033_200_000.)),
            ("2026.10.15.24:00", Some(1_792_108_800_000.)),
            ("2026.1.31.0:59", Some(1_769_821_140_000.)),
            ("2026.1.5", Some(1_767_571_200_000.)),
            ("2026.10.32.3:00", None),
            ("2026.13.5.3:00", None),
            ("2026.0.5.3:00", None),
            ("2026.10.0.3:00", None),
            ("2026.10.15.24:59", None),
            ("2026.10.15.25:00", None),
            ("2026.10.15.3:60", None),
            ("0026.10.15.3:00", None),
        ] {
            let got = try_parse_date(s).unwrap();
            match v8 {
                Some(ms) => assert_eq!(got, ms, "{s}"),
                None => assert!(got.is_nan(), "{s}"),
            }
        }
        // Unprobed shapes stay unclaimed (the assembly forwards; page parsing reads NaN).
        assert_eq!(try_parse_date("2026.13.5"), None);
    }
    #[test]
    fn legacy_time_helpers() {
        let now = 1_790_208_600_000.; // 2026-09-24T00:10:00Z
        assert_eq!(world_time(now, 9.), "202609240910");
        assert_eq!(world_time(now, 9. - 192.), "202609160910");
        let d = convert_string_to_date(&V::s("20260924"));
        assert_eq!(yyyymmdd(&d), "20260924");
        assert!(convert_string_to_date(&V::s("20260231")).is_undef());
        assert_eq!(new_date(&V::Bool(false)), 0.);
        assert_eq!(new_date(&V::Bool(true)), 1.);
        // `new Date(1, 8, 24, 9, 0, 0)` is 1901: the year check fails as in legacy (S15-R13).
        assert!(convert_string_to_date(&V::s("000109240900")).is_undef());
        assert!(convert_string_to_date(&V::s("009909240900")).is_undef());
        assert_eq!(
            yyyymmdd(&convert_string_to_date(&V::s("010009240900"))),
            "1000924"
        );
        assert_eq!(
            make_date(1., 8., 24., 0., 0., 0.),
            make_date_literal(1901., 8., 24., 0., 0., 0.)
        );
        assert_eq!(
            make_date(-1., 0., 1., 0., 0., 0.),
            make_date_literal(-1., 0., 1., 0., 0., 0.)
        );
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
    /// Pinned Node 16.20.2 `Date.parse` (TZ=UTC) results; a forwarded string is one whose
    /// result the port does not reproduce (legacy answers it).
    #[test]
    fn date_parse_matches_v8_or_forwards() {
        let table: &[(&str, f64)] = &[
            ("2026-09-24", 1790208000000.0),
            ("2026-09-24T08:00", 1790236800000.0),
            ("2026-09-24T08:00Z", 1790236800000.0),
            ("2026-09-24T08:00:00", 1790236800000.0),
            ("2026-09-24T08:00:00Z", 1790236800000.0),
            ("2026-09-24T08:00:00.5Z", 1790236800500.0),
            ("2026-09-24T08:00:00.123456Z", 1790236800123.0),
            ("2026-09-24T08:00:00.Z", f64::NAN),
            ("2026-09-24T24:00:00Z", 1790294400000.0),
            ("2026-09-24T24:00:00.000Z", 1790294400000.0),
            ("2026-09-24T24:00:00.001Z", f64::NAN),
            ("2026-09-24T24:01Z", f64::NAN),
            ("2026-09-24T23:60Z", f64::NAN),
            ("2026-09-24T23:59:60Z", f64::NAN),
            ("2026-09-24T08:00:00+09:00", 1790204400000.0),
            ("2026-09-24T08:00:00+23:59", 1790150460000.0),
            ("2026-09-24T08:00:00+24:00", f64::NAN),
            ("2026-09-24T08:00:00+99:99", f64::NAN),
            ("2026-09-24T08:00:00+09:60", f64::NAN),
            ("2026-09-24T08:00:00+0900", 1790204400000.0),
            ("2026-09-24T08:00:00+09", f64::NAN),
            ("2026-09-24T08:00:00 +09:00", f64::NAN),
            ("2026-09-24T08:00+09:00", 1790204400000.0),
            ("2026-09-24 08:00", 1790236800000.0),
            ("2026-09-24 08:00:00", 1790236800000.0),
            ("2026-09-24 08:00Z", 1790236800000.0),
            ("2026-09-24 08:00:00+09:00", 1790204400000.0),
            ("2026-09-24 08:00:00Z", 1790236800000.0),
            ("2026-02-29", 1772323200000.0),
            ("2026-02-30T00:00Z", 1772409600000.0),
            ("2026-13-01", f64::NAN),
            ("2026-00-10", f64::NAN),
            ("2026-09-31", 1790812800000.0),
            ("2026-9-24", 1790208000000.0),
            ("2026-09-24T8:00", f64::NAN),
            ("2026-09", 1788220800000.0),
            ("2026", 1767225600000.0),
            ("+002026-09-24T00:00:00Z", 1790208000000.0),
            ("2026-09-24T08:00:00+aé00", f64::NAN),
            ("2026-09-24T08:00:00z", 1790236800000.0),
            ("2026-09-24t08:00:00Z", 1790236800000.0),
            ("2026.09.24", 1790208000000.0),
            ("2026.09.24 08:00", 1790236800000.0),
            ("202609240800", f64::NAN),
            ("20260924", f64::NAN),
            ("2026/09/24", 1790208000000.0),
            ("2026/09/24 08:00", 1790236800000.0),
            ("Sep 24 2026", 1790208000000.0),
            ("한글날짜", f64::NAN),
            ("", f64::NAN),
            ("   2026-09-24", 1790208000000.0),
            ("2026-09-24T08:00:00.000+09:00", 1790204400000.0),
            ("2026-09-24T08:00:00-03:30", 1790249400000.0),
            ("2026-09-24T08:00:00.1234+09:00", 1790204400123.0),
            ("2026-09-24T08", f64::NAN),
            ("2026-09-24T08:00:0", f64::NAN),
            ("2026-09-24T08:00:00.", f64::NAN),
            ("2026-09-24T08:00:00.000ZZ", f64::NAN),
            ("2026-09-24T08:00:00.000+09:00Z", f64::NAN),
            ("1970-01-01T00:00:00Z", 0.0),
            ("0000-01-01T00:00:00Z", -62167219200000.0),
            ("9999-12-31T23:59:59.999Z", 253402300799999.0),
            ("2026-09-24T08:00:00.000Z ", f64::NAN),
            ("2026-09-24 24:00", 1790294400000.0),
            ("2026-09-24 24:00:00.001", f64::NAN),
            ("2026-09-24T08:00:00+1:00", f64::NAN),
            ("2026-09-24T08:00:00+.5:00", f64::NAN),
            ("2026-09-24T08:00:00+-1:00", f64::NAN),
            ("2026-09-24T08:00:00+0a:00", f64::NAN),
            ("2026-09-24T08:00:00.1e3Z", f64::NAN),
            ("2026-09-24T08:00:00,5Z", f64::NAN),
            ("2026-09-24T08:00:00.000-00:00", 1790236800000.0),
            ("2026-09-24T00:00:00+00:00", 1790208000000.0),
            ("2026-02-29T00:00:00Z", 1772323200000.0),
            ("2028-02-29T00:00:00Z", 1835395200000.0),
            ("2026-09-24T25:00Z", f64::NAN),
            ("2026-09-24T08:5Z", f64::NAN),
            ("2026-09-24T08:00:00.9999Z", 1790236800999.0),
            ("1", 978307200000.0),
            ("12", 1007164800000.0),
            ("123", -58285699200000.0),
            ("20260", 577176624000000.0),
            ("202609", 6331555296000000.0),
            ("2026092", f64::NAN),
            ("2026092408", f64::NAN),
            ("20260924080000", f64::NAN),
            ("2026-09-24 08:00:00+0900", 1790204400000.0),
            ("2026-09-24 08:00+09:00", 1790204400000.0),
            ("2026-09-24T08:00+0900", 1790204400000.0),
            ("2026-09-31T00:00:00Z", 1790812800000.0),
            ("2026-02-30T00:00:00.000Z", 1772409600000.0),
            ("2026-09-24T24:00:00+09:00", 1790262000000.0),
            ("2026-09-24t08:00z", 1790236800000.0),
            ("2026-09-24 08:00z", 1790236800000.0),
            ("2026-09-24T08:00:00.5", 1790236800500.0),
            ("2026-09-24 08:00:00.5", 1790236800500.0),
            ("2026-09-24 08:00:00.5Z", 1790236800500.0),
            ("2026-09-32", f64::NAN),
            ("2026-09-00", f64::NAN),
            ("2026-09-24 ", 1790208000000.0),
            ("2026-09-24T08:00 ", f64::NAN),
            (" 2026-09-24T08:00:00Z", f64::NAN),
            ("2026-09-24T08:00:00+09:00 ", f64::NAN),
            ("2026-09T08:00Z", 1788249600000.0),
            ("2026T08:00Z", 1767254400000.0),
            ("-002026-09-24T00:00:00Z", -126078595200000.0),
            ("+2026-09-24", 1790208000000.0),
            ("02026-09-24", 1790208000000.0),
            ("2026-09-24T08:00:00-24:00", f64::NAN),
            ("2026-09-24T08:00:00-23:59", 1790323140000.0),
            ("Sep", f64::NAN),
            ("Tue Sep", f64::NAN),
            ("today", f64::NAN),
            ("now", f64::NAN),
            ("Z", f64::NAN),
            ("T", f64::NAN),
            ("-", f64::NAN),
            (".", f64::NAN),
            ("NaN", f64::NAN),
            ("Infinity", f64::NAN),
            ("2026-09-24T08:00:00.000000000000Z", 1790236800000.0),
            ("2026-09-24T08:00:60Z", f64::NAN),
            ("2026-09-24T08:60:00Z", f64::NAN),
            ("2026-09-24T-1:00Z", f64::NAN),
            ("2026-09-24T08:00:00+09:00:00", f64::NAN),
            ("2026-09-24 08", f64::NAN),
            ("2026-09-24 8:00", 1790236800000.0),
            ("2026-09-24 08:00:00 +09:00", 1790204400000.0),
            ("2026-09-24T08:00:00 Z", f64::NAN),
            ("2026-09-24TZ", f64::NAN),
            ("2026-09-24T", f64::NAN),
            ("2026-09-24 T08:00", f64::NAN),
            ("2026-13-01T00:00Z", f64::NAN),
            ("2026-09-32T00:00Z", f64::NAN),
            ("2026-09-00T00:00Z", f64::NAN),
            ("2026-00-01 00:00", f64::NAN),
            ("2026-09-32 08:00", f64::NAN),
            ("202609240", f64::NAN),
            ("20260924080", f64::NAN),
            ("2026092408000", f64::NAN),
            ("2026.9.24", 1790208000000.0),
            ("2026.09.24 24:00", 1790294400000.0),
            ("2026.13.01", f64::NAN),
            ("2026.09.24 08:00:00", 1790236800000.0),
            ("2026.09.24 8:00", 1790236800000.0),
            ("2026.09.31", 1790812800000.0),
            ("2026-09-24T08:00:00+09:00\n", f64::NAN),
            ("2026-09-24T08:00\n00Z", f64::NAN),
            ("2026-09-24T08:00:00 Z", f64::NAN),
            ("2026-09-24T08:00:00.000+23:59", 1790150460000.0),
            ("2026-09-24T08:00:00.000-23:59", 1790323140000.0),
            ("2026-09-24 08:00:00-0330", 1790249400000.0),
            ("2026-09-24T24:00Z", 1790294400000.0),
            ("2026-09-24 24:00:00.000Z", 1790294400000.0),
            ("2026-09-24 08:00:00+24:00", 1790150400000.0),
            ("2026-09-24 08:00:00+09:60", f64::NAN),
            ("2026-09-24T08:00:00+2400", f64::NAN),
            ("2026-09-24T08:00:00+0960", f64::NAN),
            ("2026-09-24T08:00:00.000z", 1790236800000.0),
            ("2026-09-24t24:00z", 1790294400000.0),
            ("0000.09.26", 969926400000.0),
            ("0000.09.26 09:03", 969958980000.0),
            ("0000-09-26", -62143977600000.0),
            ("0000-09-26 09:03", 969958980000.0),
            ("0000-09-26T09:03", -62143945020000.0),
            ("0000-09-26T09:03:00Z", -62143945020000.0),
            ("0000-09-26 09:03:00Z", 969958980000.0),
            ("0000-09-26t09:03z", -62143945020000.0),
            ("0001.09.26", 1767916800000.0),
            ("0001.09.26 09:03", 1767949380000.0),
            ("0001-09-26", -62112441600000.0),
            ("0001-09-26 09:03", 1767949380000.0),
            ("0001-09-26T09:03", -62112409020000.0),
            ("0001-09-26T09:03:00Z", -62112409020000.0),
            ("0001-09-26 09:03:00Z", 1767949380000.0),
            ("0001-09-26t09:03z", -62112409020000.0),
            ("0012.09.26", 1796774400000.0),
            ("0012.09.26 09:03", 1796806980000.0),
            ("0012-09-26", -61765286400000.0),
            ("0012-09-26 09:03", 1796806980000.0),
            ("0012-09-26T09:03", -61765253820000.0),
            ("0012-09-26T09:03:00Z", -61765253820000.0),
            ("0012-09-26 09:03:00Z", 1796806980000.0),
            ("0012-09-26t09:03z", -61765253820000.0),
            ("0031.09.26", f64::NAN),
            ("0031.09.26 09:03", f64::NAN),
            ("0031-09-26", -61165756800000.0),
            ("0031-09-26 09:03", f64::NAN),
            ("0031-09-26T09:03", -61165724220000.0),
            ("0031-09-26T09:03:00Z", -61165724220000.0),
            ("0031-09-26 09:03:00Z", f64::NAN),
            ("0031-09-26t09:03z", -61165724220000.0),
            ("0032.09.26", 1979769600000.0),
            ("0032.09.26 09:03", 1979802180000.0),
            ("0032-09-26", -61134134400000.0),
            ("0032-09-26 09:03", 1979802180000.0),
            ("0032-09-26T09:03", -61134101820000.0),
            ("0032-09-26T09:03:00Z", -61134101820000.0),
            ("0032-09-26 09:03:00Z", 1979802180000.0),
            ("0032-09-26t09:03z", -61134101820000.0),
            ("0049.09.26", 2516227200000.0),
            ("0049.09.26 09:03", 2516259780000.0),
            ("0049-09-26", -60597676800000.0),
            ("0049-09-26 09:03", 2516259780000.0),
            ("0049-09-26T09:03", -60597644220000.0),
            ("0049-09-26T09:03:00Z", -60597644220000.0),
            ("0049-09-26 09:03:00Z", 2516259780000.0),
            ("0049-09-26t09:03z", -60597644220000.0),
            ("0050.09.26", -607996800000.0),
            ("0050.09.26 09:03", -607964220000.0),
            ("0050-09-26", -60566140800000.0),
            ("0050-09-26 09:03", -607964220000.0),
            ("0050-09-26T09:03", -60566108220000.0),
            ("0050-09-26T09:03:00Z", -60566108220000.0),
            ("0050-09-26 09:03:00Z", -607964220000.0),
            ("0050-09-26t09:03z", -60566108220000.0),
            ("0099.09.26", 938304000000.0),
            ("0099.09.26 09:03", 938336580000.0),
            ("0099-09-26", -59019840000000.0),
            ("0099-09-26 09:03", 938336580000.0),
            ("0099-09-26T09:03", -59019807420000.0),
            ("0099-09-26T09:03:00Z", -59019807420000.0),
            ("0099-09-26 09:03:00Z", 938336580000.0),
            ("0099-09-26t09:03z", -59019807420000.0),
            ("0100.09.26", -58988304000000.0),
            ("0100.09.26 09:03", -58988271420000.0),
            ("0100-09-26", -58988304000000.0),
            ("0100-09-26 09:03", -58988271420000.0),
            ("0100-09-26T09:03", -58988271420000.0),
            ("0100-09-26T09:03:00Z", -58988271420000.0),
            ("0100-09-26 09:03:00Z", -58988271420000.0),
            ("0100-09-26t09:03z", -58988271420000.0),
            ("0999.09.26", -30618604800000.0),
            ("0999.09.26 09:03", -30618572220000.0),
            ("0999-09-26", -30618604800000.0),
            ("0999-09-26 09:03", -30618572220000.0),
            ("0999-09-26T09:03", -30618572220000.0),
            ("0999-09-26T09:03:00Z", -30618572220000.0),
            ("0999-09-26 09:03:00Z", -30618572220000.0),
            ("0999-09-26t09:03z", -30618572220000.0),
            ("1000.09.26", -30587068800000.0),
            ("1000.09.26 09:03", -30587036220000.0),
            ("1000-09-26", -30587068800000.0),
            ("1000-09-26 09:03", -30587036220000.0),
            ("1000-09-26T09:03", -30587036220000.0),
            ("1000-09-26T09:03:00Z", -30587036220000.0),
            ("1000-09-26 09:03:00Z", -30587036220000.0),
            ("1000-09-26t09:03z", -30587036220000.0),
            ("1970.09.26", 23155200000.0),
            ("1970.09.26 09:03", 23187780000.0),
            ("1970-09-26", 23155200000.0),
            ("1970-09-26 09:03", 23187780000.0),
            ("1970-09-26T09:03", 23187780000.0),
            ("1970-09-26T09:03:00Z", 23187780000.0),
            ("1970-09-26 09:03:00Z", 23187780000.0),
            ("1970-09-26t09:03z", 23187780000.0),
            ("9999.09.26", 253393920000000.0),
            ("9999.09.26 09:03", 253393952580000.0),
            ("9999-09-26", 253393920000000.0),
            ("9999-09-26 09:03", 253393952580000.0),
            ("9999-09-26T09:03", 253393952580000.0),
            ("9999-09-26T09:03:00Z", 253393952580000.0),
            ("9999-09-26 09:03:00Z", 253393952580000.0),
            ("9999-09-26t09:03z", 253393952580000.0),
            ("2026-09-23T24:00:00.0001Z", f64::NAN),
            ("2026-09-23 24:00:00.0001Z", 1790208000000.0),
            ("2026-09-23T24:00:00.0001+09:00", f64::NAN),
            ("2026-09-23 24:00:00.0001+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.0001-03:30", f64::NAN),
            ("2026-09-23 24:00:00.0001-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.0001", f64::NAN),
            ("2026-09-23 24:00:00.0001", 1790208000000.0),
            ("2026-09-23T24:00:00.0009Z", f64::NAN),
            ("2026-09-23 24:00:00.0009Z", 1790208000000.0),
            ("2026-09-23T24:00:00.0009+09:00", f64::NAN),
            ("2026-09-23 24:00:00.0009+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.0009-03:30", f64::NAN),
            ("2026-09-23 24:00:00.0009-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.0009", f64::NAN),
            ("2026-09-23 24:00:00.0009", 1790208000000.0),
            ("2026-09-23T24:00:00.0000001Z", f64::NAN),
            ("2026-09-23 24:00:00.0000001Z", 1790208000000.0),
            ("2026-09-23T24:00:00.0000001+09:00", f64::NAN),
            ("2026-09-23 24:00:00.0000001+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.0000001-03:30", f64::NAN),
            ("2026-09-23 24:00:00.0000001-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.0000001", f64::NAN),
            ("2026-09-23 24:00:00.0000001", 1790208000000.0),
            ("2026-09-23T24:00:00.0000Z", 1790208000000.0),
            ("2026-09-23 24:00:00.0000Z", 1790208000000.0),
            ("2026-09-23T24:00:00.0000+09:00", 1790175600000.0),
            ("2026-09-23 24:00:00.0000+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.0000-03:30", 1790220600000.0),
            ("2026-09-23 24:00:00.0000-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.0000", 1790208000000.0),
            ("2026-09-23 24:00:00.0000", 1790208000000.0),
            ("2026-09-23T24:00:00.000Z", 1790208000000.0),
            ("2026-09-23 24:00:00.000Z", 1790208000000.0),
            ("2026-09-23T24:00:00.000+09:00", 1790175600000.0),
            ("2026-09-23 24:00:00.000+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.000-03:30", 1790220600000.0),
            ("2026-09-23 24:00:00.000-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.000", 1790208000000.0),
            ("2026-09-23 24:00:00.000", 1790208000000.0),
            ("2026-09-23T24:00:00.0Z", 1790208000000.0),
            ("2026-09-23 24:00:00.0Z", 1790208000000.0),
            ("2026-09-23T24:00:00.0+09:00", 1790175600000.0),
            ("2026-09-23 24:00:00.0+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.0-03:30", 1790220600000.0),
            ("2026-09-23 24:00:00.0-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.0", 1790208000000.0),
            ("2026-09-23 24:00:00.0", 1790208000000.0),
            ("2026-09-23T24:00:00.00000000000001Z", f64::NAN),
            ("2026-09-23 24:00:00.00000000000001Z", 1790208000000.0),
            ("2026-09-23T24:00:00.00000000000001+09:00", f64::NAN),
            ("2026-09-23 24:00:00.00000000000001+09:00", 1790175600000.0),
            ("2026-09-23T24:00:00.00000000000001-03:30", f64::NAN),
            ("2026-09-23 24:00:00.00000000000001-03:30", 1790220600000.0),
            ("2026-09-23T24:00:00.00000000000001", f64::NAN),
            ("2026-09-23 24:00:00.00000000000001", 1790208000000.0),
        ];
        let mut forwarded = Vec::new();
        for (s, expected) in table {
            match std::panic::catch_unwind(|| parse_date(s)) {
                Ok(v) => assert!(
                    v == *expected || (v.is_nan() && expected.is_nan()),
                    "{s:?}: native {v}, V8 {expected}"
                ),
                Err(p) => {
                    assert!(
                        p.downcast_ref::<super::super::js::Forward>().is_some(),
                        "{s:?}"
                    );
                    forwarded.push(*s);
                }
            }
        }
        // The shapes the chain and the S15-R9/R10 reviews use are reproduced, not forwarded.
        for s in [
            "2026-09-24T08:00:00+99:99",
            "2026-09-24T24:00:00.001Z",
            "2026-09-24T08:00:00+09:00",
            "2026-09-24 08:00",
            "2026-09-24",
            "2026.09.24 08:00",
            "202609240800",
            "한글날짜",
            "2026-09-23T24:00:00.0001Z",
            "2026-09-23T24:00:00.0000Z",
            "2026-09-23 24:00:00.0001Z",
            "0001-09-26T09:03:00Z",
            "0001-09-26",
        ] {
            assert!(!forwarded.contains(&s), "{s:?} forwarded");
        }
        // Small years in V8's legacy forms are not read literally there: forwarded.
        for s in [
            "0001.09.26 09:03",
            "0001-09-26 09:03",
            "0049.09.26",
            "0099-09-26 09:03:00Z",
        ] {
            assert!(forwarded.contains(&s), "{s:?} not forwarded");
        }
    }
}
