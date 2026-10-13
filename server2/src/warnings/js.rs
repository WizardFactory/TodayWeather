//! Small JavaScript semantics used by the legacy warning code (ca8735cf).
//! Only the operations the ported functions rely on are implemented.
use crate::gateway::{OrderedJson, response::js_number};

/// ECMAScript WhiteSpace and LineTerminator code points (`\s`, `String.prototype.trim`).
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{000b}' | '\u{000c}' | '\r' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}
/// `s.replace(/\s+/g, with)`.
pub fn collapse_space(s: &str, with: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if is_space(c) {
            if !in_space {
                out.push_str(with);
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}
/// `String(value)` for JSON values; `None` stands for `undefined`.
pub fn string(value: Option<&serde_json::Value>) -> String {
    use serde_json::Value;
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_number(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::Null => String::new(),
                other => string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}
/// `String(value === undefined || value === null ? '' : value)`.
pub fn text(value: Option<&serde_json::Value>) -> String {
    match value {
        None | Some(serde_json::Value::Null) => String::new(),
        other => string(other),
    }
}
/// `Number(string)` for decimal, hexadecimal/octal/binary and infinity literals.
pub fn number_str(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = t.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0., |n, c| {
                n * radix as f64 + c.to_digit(radix).unwrap() as f64
            });
        }
    }
    let unsigned = t.strip_prefix(['+', '-']).unwrap_or(t);
    if unsigned == "Infinity" {
        return if t.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let b = unsigned.as_bytes();
    let mut i = 0;
    let digits = |i: &mut usize| {
        let start = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - start
    };
    let mut mantissa = digits(&mut i);
    if i < b.len() && b[i] == b'.' {
        i += 1;
        mantissa += digits(&mut i);
    }
    if mantissa == 0 {
        return f64::NAN;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return f64::NAN;
        }
    }
    if i != b.len() {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}
/// `Number(value)` for JSON values; `None` stands for `undefined`.
pub fn number(value: Option<&serde_json::Value>) -> f64 {
    use serde_json::Value;
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => number_str(s),
        Some(Value::Array(_)) => number_str(&string(value)),
        Some(Value::Object(_)) => f64::NAN,
    }
}
/// JavaScript truthiness of a JSON value.
pub fn truthy(value: Option<&serde_json::Value>) -> bool {
    use serde_json::Value;
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0. && !n.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}
/// The sign used by `Array.prototype.sort` for a comparator result (NaN is +0).
pub fn order(value: f64) -> std::cmp::Ordering {
    if value > 0. {
        std::cmp::Ordering::Greater
    } else if value < 0. {
        std::cmp::Ordering::Less
    } else {
        std::cmp::Ordering::Equal
    }
}
/// `a || b || c` over numeric differences, as the legacy comparators use it.
pub fn chain(values: &[f64]) -> f64 {
    for (i, v) in values.iter().enumerate() {
        if (*v != 0. && !v.is_nan()) || i + 1 == values.len() {
            return *v;
        }
    }
    0.
}
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
/// (year, month 1-12, day) of days since 1970-01-01.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
/// `Date.UTC(year, month0, day, hours, minutes)` with JavaScript overflow normalization.
pub fn date_utc(year: f64, month0: f64, day: f64, hours: f64, minutes: f64) -> f64 {
    if [year, month0, day, hours, minutes]
        .iter()
        .any(|v| !v.is_finite())
    {
        return f64::NAN;
    }
    let (year, month0) = (year.trunc() as i64, month0.trunc() as i64);
    let y = year + month0.div_euclid(12);
    let m = month0.rem_euclid(12) + 1;
    let days = days_from_civil(y, m, 1) as f64 + day.trunc() - 1.;
    let ms = days * 86_400_000. + hours.trunc() * 3_600_000. + minutes.trunc() * 60_000.;
    if ms.abs() > 8.64e15 { f64::NAN } else { ms }
}
/// `Date.prototype.toISOString` for a valid time value.
pub fn iso(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}
/// `new Date(string).getTime()` for the ISO forms written by `toISOString`/mongoexport.
pub fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let part = s.get(r)?;
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' {
        return None;
    }
    let (y, mo, d, h, mi) = (
        num(0..4)?,
        num(5..7)?,
        num(8..10)?,
        num(11..13)?,
        num(14..16)?,
    );
    let (mut sec, mut milli, mut pos) = (0, 0, 16);
    if b.get(16) == Some(&b':') {
        sec = num(17..19)?;
        pos = 19;
        if b.get(19) == Some(&b'.') {
            let end = (20..b.len()).find(|&i| !b[i].is_ascii_digit())?;
            let frac = &s[20..end];
            if frac.is_empty() {
                return None;
            }
            milli = format!("{frac:0<3}")[..3].parse().ok()?;
            pos = end;
        }
    }
    if &s[pos..] != "Z"
        || !(1..=12).contains(&mo)
        || !(1..=31).contains(&d)
        || h > 24
        || mi > 59
        || sec > 59
    {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    if civil_from_days(days) != (y, mo as u32, d as u32)
        || (h == 24 && (mi, sec, milli) != (0, 0, 0))
    {
        return None;
    }
    Some(days * 86_400_000 + h * 3_600_000 + mi * 60_000 + sec * 1000 + milli)
}
/// UTC calendar date as YYYYMMDD.
pub fn ymd(ms: i64) -> u32 {
    let (y, m, d) = civil_from_days(ms.div_euclid(86_400_000));
    (y * 10000 + i64::from(m) * 100 + i64::from(d)) as u32
}
/// Days since epoch of a YYYYMMDD date.
pub fn day_index(date: u32) -> i64 {
    days_from_civil(
        i64::from(date / 10000),
        i64::from(date / 100 % 100),
        i64::from(date % 100),
    )
}
pub fn date_of_index(index: i64) -> u32 {
    let (y, m, d) = civil_from_days(index);
    (y * 10000 + i64::from(m) * 100 + i64::from(d)) as u32
}
pub fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
pub fn key(name: &str) -> Vec<u16> {
    utf16(name)
}
pub fn ostr(s: &str) -> OrderedJson {
    OrderedJson::String(utf16(s))
}
/// Object member lookup without cloning.
pub fn member<'a>(value: &'a OrderedJson, name: &str) -> Option<&'a OrderedJson> {
    value.get(name)
}
