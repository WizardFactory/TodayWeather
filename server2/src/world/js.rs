//! JavaScript value, number, date and sort semantics needed for legacy byte parity.
//! The legacy process clock zone is UTC (S02 oracle normalization).
use crate::gateway::{OrderedJson, response::js_number};

/// Insertion-ordered JavaScript object. `Undef` values are retained (hasOwnProperty is true)
/// and omitted by JSON serialization, as `JSON.stringify` does.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Obj(Vec<(String, Val)>);
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Val {
    #[default]
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Val>),
    Obj(Obj),
    /// A JavaScript Date (time value in ms; NaN when invalid).
    Date(f64),
}
static UNDEF: Val = Val::Undef;
impl Obj {
    pub fn new() -> Self {
        Self(Vec::new())
    }
    pub fn get(&self, key: &str) -> &Val {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map_or(&UNDEF, |(_, v)| v)
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Val> {
        self.0.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    pub fn has(&self, key: &str) -> bool {
        self.0.iter().any(|(k, _)| k == key)
    }
    /// JS property assignment: an existing key keeps its position.
    pub fn set(&mut self, key: &str, value: impl Into<Val>) {
        let value = value.into();
        if let Some(slot) = self.get_mut(key) {
            *slot = value;
        } else {
            self.0.push((key.to_owned(), value));
        }
    }
    pub fn remove(&mut self, key: &str) {
        self.0.retain(|(k, _)| k != key);
    }
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }
    pub fn entries(&self) -> &[(String, Val)] {
        &self.0
    }
}
impl From<f64> for Val {
    fn from(v: f64) -> Self {
        Val::Num(v)
    }
}
impl From<i64> for Val {
    fn from(v: i64) -> Self {
        Val::Num(v as f64)
    }
}
impl From<bool> for Val {
    fn from(v: bool) -> Self {
        Val::Bool(v)
    }
}
impl From<&str> for Val {
    fn from(v: &str) -> Self {
        Val::Str(v.to_owned())
    }
}
impl From<String> for Val {
    fn from(v: String) -> Self {
        Val::Str(v)
    }
}
impl From<Obj> for Val {
    fn from(v: Obj) -> Self {
        Val::Obj(v)
    }
}
impl From<Vec<Val>> for Val {
    fn from(v: Vec<Val>) -> Self {
        Val::Arr(v)
    }
}
impl<T: Into<Val>> From<Option<T>> for Val {
    fn from(v: Option<T>) -> Self {
        v.map_or(Val::Undef, Into::into)
    }
}
impl Val {
    pub fn is_undef(&self) -> bool {
        matches!(self, Val::Undef)
    }
    /// `x == undefined` (undefined or null).
    pub fn is_nullish(&self) -> bool {
        matches!(self, Val::Undef | Val::Null)
    }
    pub fn truthy(&self) -> bool {
        match self {
            Val::Undef | Val::Null => false,
            Val::Bool(b) => *b,
            Val::Num(n) => *n != 0. && !n.is_nan(),
            Val::Str(s) => !s.is_empty(),
            Val::Arr(_) | Val::Obj(_) | Val::Date(_) => true,
        }
    }
    pub fn num(&self) -> Option<f64> {
        match self {
            Val::Num(n) => Some(*n),
            _ => None,
        }
    }
    /// JavaScript ToNumber for the primitive kinds used by legacy comparisons.
    pub fn to_number(&self) -> f64 {
        match self {
            Val::Undef => f64::NAN,
            Val::Null => 0.,
            Val::Bool(b) => f64::from(u8::from(*b)),
            Val::Num(n) => *n,
            Val::Str(s) => string_to_number(s),
            Val::Date(ms) => *ms,
            Val::Arr(_) | Val::Obj(_) => f64::NAN,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Val::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn obj(&self) -> Option<&Obj> {
        match self {
            Val::Obj(o) => Some(o),
            _ => None,
        }
    }
    pub fn obj_mut(&mut self) -> Option<&mut Obj> {
        match self {
            Val::Obj(o) => Some(o),
            _ => None,
        }
    }
    pub fn arr(&self) -> Option<&Vec<Val>> {
        match self {
            Val::Arr(a) => Some(a),
            _ => None,
        }
    }
    /// Property read with JavaScript `undefined` for missing or non-object receivers.
    pub fn get(&self, key: &str) -> &Val {
        match self {
            Val::Obj(o) => o.get(key),
            _ => &UNDEF,
        }
    }
    pub fn from_ordered(value: &OrderedJson) -> Val {
        match value {
            OrderedJson::Null => Val::Null,
            OrderedJson::Bool(b) => Val::Bool(*b),
            OrderedJson::Number(n) => Val::Num(*n),
            OrderedJson::String(s) => Val::Str(String::from_utf16_lossy(s)),
            OrderedJson::Array(a) => Val::Arr(a.iter().map(Val::from_ordered).collect()),
            OrderedJson::Object(entries) => {
                let mut o = Obj::new();
                for (k, v) in entries {
                    o.set(&String::from_utf16_lossy(k), Val::from_ordered(v));
                }
                Val::Obj(o)
            }
        }
    }
    /// `JSON.stringify` value conversion. Returns None for a top-level `undefined`.
    pub fn to_ordered(&self) -> Option<OrderedJson> {
        Some(match self {
            Val::Undef => return None,
            Val::Null => OrderedJson::Null,
            Val::Bool(b) => OrderedJson::Bool(*b),
            Val::Num(n) if n.is_finite() => OrderedJson::Number(*n),
            Val::Num(_) => OrderedJson::Null,
            Val::Str(s) => OrderedJson::String(s.encode_utf16().collect()),
            Val::Date(ms) => iso(*ms).map_or(OrderedJson::Null, |s| {
                OrderedJson::String(s.encode_utf16().collect())
            }),
            Val::Arr(a) => OrderedJson::Array(
                a.iter()
                    .map(|v| v.to_ordered().unwrap_or(OrderedJson::Null))
                    .collect(),
            ),
            Val::Obj(o) => OrderedJson::Object(
                o.0.iter()
                    .filter_map(|(k, v)| v.to_ordered().map(|v| (k.encode_utf16().collect(), v)))
                    .collect(),
            ),
        })
    }
    pub fn to_json(&self) -> Vec<u8> {
        self.to_ordered()
            .map_or_else(|| b"undefined".to_vec(), |v| v.to_bytes())
    }
}

/// ECMAScript WhiteSpace and LineTerminator as `Number(string)`, `parseInt` and `parseFloat`
/// skip them (pinned V8). Rust's `char::is_whitespace` also accepts U+0085, which they do not.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}
/// `Number(string)` for the decimal forms produced by legacy inputs.
pub fn string_to_number(s: &str) -> f64 {
    let t = s.trim_matches(is_js_space);
    if t.is_empty() {
        return 0.;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => (),
    }
    let lower = t.to_ascii_lowercase();
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            // Unsigned digits only: `from_str_radix` would also accept a leading `+`.
            if rest.is_empty() || !rest.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return u128::from_str_radix(rest, radix).map_or_else(
                |_| {
                    rest.chars().fold(0., |a, c| {
                        a * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
                    })
                },
                |n| n as f64,
            );
        }
    }
    let valid = t.bytes().enumerate().all(|(i, b)| {
        b.is_ascii_digit()
            || b == b'.'
            || b == b'e'
            || b == b'E'
            || ((b == b'-' || b == b'+') && (i == 0 || matches!(t.as_bytes()[i - 1], b'e' | b'E')))
    });
    if !valid || t.contains("inf") || t.contains("nan") {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `parseFloat(string)`: longest decimal prefix after leading whitespace.
pub fn parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(is_js_space);
    for (word, value) in [
        ("Infinity", f64::INFINITY),
        ("+Infinity", f64::INFINITY),
        ("-Infinity", f64::NEG_INFINITY),
    ] {
        if t.starts_with(word) {
            return value;
        }
    }
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i > int_start;
    if i < b.len() && b[i] == b'.' {
        let f = i + 1;
        let mut j = f;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > f || digits {
            digits = digits || j > f;
            i = j;
        }
    }
    if !digits {
        return f64::NAN;
    }
    let mut end = i;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let e = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > e {
            end = j;
        }
    }
    t[..end]
        .trim_end_matches('.')
        .parse::<f64>()
        .or_else(|_| t[..end].parse::<f64>())
        .unwrap_or(f64::NAN)
}
pub fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        _ => 28,
    }
}
/// `String(number)`.
pub fn num_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0. { "Infinity" } else { "-Infinity" }.into()
    } else {
        js_number(n)
    }
}

/// `Math.round`: ties toward positive infinity, preserving -0.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let up = x.ceil();
    if up - 0.5 > x { up - 1. } else { up }
}

/// `Number.prototype.toFixed` on the exact binary value: ties choose the larger magnitude.
pub fn to_fixed(x: f64, digits: usize) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.abs() >= 1e21 {
        return num_string(x);
    }
    let negative = x < 0.;
    let ax = x.abs();
    let guard = 24;
    let approx = format!("{:.*}", digits + guard, ax);
    let (int_part, frac) = approx.split_once('.').unwrap_or((&approx, ""));
    let keep = &frac[..digits];
    let rest = &frac[digits..];
    // Only a guard window of exactly "5000..." can hide which side of a tie the binary value is on.
    let ambiguous = rest.starts_with('5') && rest[1..].bytes().all(|b| b == b'0');
    let up = if ambiguous {
        let exact = format!("{:.1100}", ax);
        let (_, f) = exact.split_once('.').expect("exact decimal point");
        f.as_bytes()[digits] >= b'5'
    } else {
        rest.as_bytes()[0] >= b'5'
    };
    let mut all: Vec<u8> = int_part.bytes().chain(keep.bytes()).collect();
    if up {
        let mut i = all.len();
        loop {
            if i == 0 {
                all.insert(0, b'1');
                break;
            }
            i -= 1;
            if all[i] == b'9' {
                all[i] = b'0';
            } else {
                all[i] += 1;
                break;
            }
        }
    }
    let split = all.len() - digits;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(std::str::from_utf8(&all[..split]).expect("ascii digits"));
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&all[split..]).expect("ascii digits"));
    }
    out
}
/// `parseFloat(x.toFixed(digits))`.
pub fn fixed(x: f64, digits: usize) -> f64 {
    let s = to_fixed(x, digits);
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// Civil date from days since the Unix epoch (proleptic Gregorian).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}
/// UTC components of a time value: (year, month 1-12, day, hour, minute, second, ms, weekday 0=Sunday).
#[derive(Clone, Copy, Debug)]
pub struct Parts {
    pub year: i64,
    pub month: i64,
    pub day: i64,
    pub hour: i64,
    pub minute: i64,
    pub second: i64,
    pub milli: i64,
    pub weekday: i64,
}
pub fn parts(ms: f64) -> Option<Parts> {
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let ms = ms as i64;
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil(days);
    Some(Parts {
        year,
        month,
        day,
        hour: rem / 3_600_000,
        minute: rem / 60_000 % 60,
        second: rem / 1000 % 60,
        milli: rem % 1000,
        weekday: (days + 4).rem_euclid(7),
    })
}
fn pad(n: i64, width: usize) -> String {
    format!("{n:0width$}")
}
/// `Date.prototype.toISOString` (JSON form of a Date).
pub fn iso(ms: f64) -> Option<String> {
    let p = parts(ms)?;
    let year = if (0..=9999).contains(&p.year) {
        pad(p.year, 4)
    } else {
        format!("{}{:06}", if p.year < 0 { '-' } else { '+' }, p.year.abs())
    };
    Some(format!(
        "{year}-{}-{}T{}:{}:{}.{}Z",
        pad(p.month, 2),
        pad(p.day, 2),
        pad(p.hour, 2),
        pad(p.minute, 2),
        pad(p.second, 2),
        pad(p.milli, 3)
    ))
}
/// Legacy "YYYY.MM.DD HH:MM" in UTC components (`_convertTimeString`).
pub fn dot_time(ms: f64) -> String {
    match parts(ms) {
        Some(p) => format!(
            "{}.{}.{} {}:{}",
            pad(p.year, 4),
            pad(p.month, 2),
            pad(p.day, 2),
            pad(p.hour, 2),
            pad(p.minute, 2)
        ),
        // leadingZeros(NaN, 4) is "0NaN"; two-digit fields keep "NaN".
        None => "0NaN.NaN.NaN NaN:NaN".into(),
    }
}
/// V8 parse of the legacy "YYYY.MM.DD[ HH:MM]" strings as process-local (UTC) time.
pub fn parse_dot(s: &str) -> f64 {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let t = s.get(r)?;
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())
            .flatten()
    };
    let date = (|| {
        if b.len() < 10 || b[4] != b'.' || b[7] != b'.' {
            return None;
        }
        let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
        let (h, mi) = if b.len() == 10 {
            (0, 0)
        } else if b.len() == 16 && b[10] == b' ' && b[13] == b':' {
            (num(11..13)?, num(14..16)?)
        } else {
            return None;
        };
        if !(1..=12).contains(&m)
            || !(1..=31).contains(&d)
            || h > 24
            || mi > 59
            || (h == 24 && mi > 0)
        {
            return None;
        }
        Some(
            (days_from_civil(y, m, 1) + d - 1) as f64 * 86_400_000.
                + (h * 3_600_000 + mi * 60_000) as f64,
        )
    })();
    date.unwrap_or(f64::NAN)
}
/// `getHours()` of a legacy string in the UTC process zone, NaN when invalid.
pub fn hours_of(s: &str) -> f64 {
    parts(parse_dot(s)).map_or(f64::NAN, |p| p.hour as f64)
}
/// `kmaTimeLib.convertDateToYYYYMMDD(str)`.
pub fn yyyymmdd(s: &str) -> String {
    match parts(parse_dot(s)) {
        Some(p) => format!("{}{}{}", p.year, pad(p.month, 2), pad(p.day, 2)),
        None => "NaNNaNNaN".into(),
    }
}
/// `kmaTimeLib.getDiffDays(target, current)` for legacy strings.
pub fn diff_days(target: &str, current: &str) -> f64 {
    if target.is_empty() || current.is_empty() {
        return 0.;
    }
    let (a, b) = (parts(parse_dot(target)), parts(parse_dot(current)));
    match (a, b) {
        (Some(a), Some(b)) => {
            let da = days_from_civil(a.year, a.month, a.day);
            let db = days_from_civil(b.year, b.month, b.day);
            (((da - db) as f64 * 86_400_000.) / 86_400_000.).ceil()
        }
        _ => f64::NAN,
    }
}

/// V8 Array.prototype.sort for comparator-based sorting of short arrays (TimSort with a single
/// binary-insertion run below 64 elements), including inconsistent comparator results.
pub fn js_sort<T>(v: &mut [T], mut cmp: impl FnMut(&T, &T) -> i32) {
    let n = v.len();
    if n < 2 {
        return;
    }
    if n >= 64 {
        v.sort_by(|a, b| cmp(a, b).cmp(&0));
        return;
    }
    // CountAndMakeRun
    let mut run = 2;
    let descending = cmp(&v[1], &v[0]) < 0;
    let mut idx = 2;
    while idx < n {
        let order = cmp(&v[idx], &v[idx - 1]);
        if (descending && order >= 0) || (!descending && order < 0) {
            break;
        }
        run += 1;
        idx += 1;
    }
    if descending {
        v[..run].reverse();
    }
    // BinaryInsertionSort(low=0, start=run, high=n)
    for start in run..n {
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if cmp(&v[start], &v[mid]) < 0 {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        v[left..=start].rotate_right(1);
    }
}
/// Legacy `(a > b) ? 1 : (a < b) ? -1 : 0` comparator on strings.
pub fn cmp_str(a: &str, b: &str) -> i32 {
    match a.encode_utf16().cmp(b.encode_utf16()) {
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_and_round_follow_javascript() {
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(-2.5, 0), "-3");
        assert_eq!(to_fixed(1.45, 1), "1.4");
        assert_eq!(to_fixed(-0.04, 1), "-0.0");
        assert_eq!(to_fixed(1.125, 2), "1.13");
        assert_eq!(to_fixed(0.000001234, 3), "0.000");
        assert_eq!(to_fixed(99.96, 1), "100.0");
        assert_eq!(round(-2.5), -2.);
        assert_eq!(round(0.49999999999999994), 0.);
        assert!(round(-0.4).is_sign_negative());
        assert_eq!(fixed(-0.04, 1), 0.);
    }
    #[test]
    fn dates_parse_and_format_in_utc() {
        assert_eq!(parse_dot("2026.09.24 00:00"), 1_790_208_000_000.);
        assert_eq!(parse_dot("2026.09.24"), 1_790_208_000_000.);
        assert!(parse_dot("20260924").is_nan());
        assert_eq!(dot_time(1_790_208_000_000.), "2026.09.24 00:00");
        assert_eq!(iso(1_790_208_000_000.).unwrap(), "2026-09-24T00:00:00.000Z");
        assert_eq!(diff_days("2026.09.26 00:00", "2026.09.24 13:00"), 2.);
    }
    #[test]
    fn short_sort_matches_v8_insertion() {
        let mut v = vec![3, 1, 2, 1];
        js_sort(&mut v, |a: &i32, b: &i32| (a - b).signum());
        assert_eq!(v, [1, 1, 2, 3]);
    }
}
