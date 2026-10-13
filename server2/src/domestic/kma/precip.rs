//! `lib/kmaPrecipitation.js` (#2583): category amounts with bounds, kept beside rows and never
//! serialized.
use super::js::{Ob, Total, V, round as js_round};

fn round(v: f64) -> f64 {
    js_round(v * 10.) / 10.
}
fn exact_total(amount: f64) -> Total {
    Total {
        amount: round(amount),
        min: round(amount),
        max: Some(round(amount)),
        approx: false,
        hours: None,
    }
}
/// `exports.exact(amount, hours)`.
pub fn exact(amount: &V, hours: f64) -> Option<Total> {
    match amount {
        V::Num(a) if a.is_finite() && *a >= 0. => {
            let mut t = exact_total(*a);
            t.hours = Some(hours);
            Some(t)
        }
        _ => None,
    }
}
/// JavaScript `\s`.
pub fn js_ws(c: char) -> bool {
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
/// `(\d+(?:\.\d+)?)` at the start of `s`: (value, rest).
fn number(s: &str) -> Option<(f64, &str)> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let mut end = i;
    if i < b.len() && b[i] == b'.' {
        let mut j = i + 1;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > i + 1 {
            end = j;
        }
    }
    Some((s[..end].parse().ok()?, &s[end..]))
}
fn skip_ws(s: &str) -> &str {
    s.trim_start_matches(js_ws)
}
/// The alternatives of the optional `(?:\s*unit)?` group: with the unit first, then without.
fn unit_options<'a>(s: &'a str, unit: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    if let Some(rest) = skip_ws(s).strip_prefix(unit) {
        out.push(rest);
    }
    out.push(s);
    out
}
/// `exports.parse(value, unit, noValue)`.
pub fn parse(value: &V, unit: &str, no_value: Option<&str>) -> Option<Total> {
    match value {
        V::Num(n) => {
            return (n.is_finite() && *n >= 0.).then(|| exact_total(*n));
        }
        V::Str(_) => (),
        _ => return None,
    }
    let raw = value.str().unwrap_or("");
    let text = raw.trim_matches(js_ws);
    if let Some(nv) = no_value
        && text == nv
    {
        return Some(exact_total(0.));
    }
    let (a, rest) = number(text)?;
    for r in unit_options(rest, unit) {
        if r.is_empty() {
            return Some(exact_total(a));
        }
    }
    for r in unit_options(rest, unit) {
        if skip_ws(r) == "미만" && a > 0. {
            return Some(Total {
                amount: round(a / 2.),
                min: 0.,
                max: Some(round(a)),
                approx: true,
                hours: None,
            });
        }
    }
    for r in unit_options(rest, unit) {
        if let Some(after) = skip_ws(r).strip_prefix('~')
            && let Some((b, tail)) = number(skip_ws(after))
            && unit_options(tail, unit).iter().any(|t| t.is_empty())
            && a < b
        {
            return Some(Total {
                amount: round((a + b) / 2.),
                min: round(a),
                max: Some(round(b)),
                approx: true,
                hours: None,
            });
        }
    }
    for r in unit_options(rest, unit) {
        if skip_ws(r) == "이상" {
            return Some(Total {
                amount: round(a),
                min: round(a),
                max: None,
                approx: true,
                hours: None,
            });
        }
    }
    None
}
/// `exports.read(amount, text, unit)`.
pub fn read(amount: &V, text: &V, unit: &str) -> Option<Total> {
    let parsed = if matches!(text, V::Str(_)) {
        parse(text, unit, None)
    } else {
        None
    };
    if let Some(p) = parsed
        && p.approx
    {
        return Some(p);
    }
    let amount = if matches!(amount, V::Num(_)) {
        amount.clone()
    } else {
        V::Undef
    };
    parse(&amount, unit, None)
}
/// `exports.total(list)`.
pub fn total(list: &[Option<Total>]) -> Option<Total> {
    let items: Vec<&Total> = list.iter().flatten().collect();
    if items.is_empty() {
        return None;
    }
    let mut r = Total {
        amount: 0.,
        min: 0.,
        max: Some(0.),
        approx: false,
        hours: Some(0.),
    };
    for it in items {
        r.amount += it.amount;
        r.min += it.min;
        r.max = match (r.max, it.max) {
            (Some(a), Some(b)) => Some(a + b),
            _ => None,
        };
        r.approx = r.approx || it.approx;
        r.hours = Some(r.hours.unwrap_or(0.) + it.hours.unwrap_or(1.));
    }
    r.amount = round(r.amount);
    r.min = round(r.min);
    r.max = r.max.map(round);
    Some(r)
}
fn num(n: f64) -> String {
    super::js::num_str(n)
}
/// `exports.format(total, unit)`.
pub fn format(total: Option<&Total>, unit: &str) -> String {
    let Some(t) = total else {
        return String::new();
    };
    if !t.approx {
        return format!("{}{unit}", num(t.amount));
    }
    match t.max {
        None => format!("{}~?{unit}", num(t.min)),
        Some(max) if t.min == 0. => format!("~{}{unit}", num(max)),
        Some(max) => format!("{}~{}{unit}", num(t.min), num(max)),
    }
}
/// `exports.copyText(source, target, fields)`.
pub fn copy_text(source: &V, target: &V, fields: &[&str]) {
    for f in fields {
        let key = format!("{f}Text");
        let v = source.get(&key);
        if matches!(v, V::Str(_)) {
            target.set(&key, v);
        }
    }
}
fn row(v: &V) -> Option<&Ob> {
    v.as_obj()
}
/// `exports.get(row, field)`.
pub fn get(r: &V, field: &str) -> Option<Total> {
    row(r).and_then(|o| o.kept(field))
}
/// `exports.keep(row, field, total)`.
pub fn keep(r: &V, field: &str, total: Option<Total>) {
    if let Some(o) = row(r) {
        o.keep(field, total);
    } else {
        super::js::throw("TypeError: Invalid value used as weak map key");
    }
}
/// `exports.assign(row, field, total)`.
pub fn assign(r: &V, field: &str, total: Option<Total>) {
    match total {
        None => {
            r.set(field, -1.);
            r.del(&format!("{field}Hours"));
            r.del(&format!("{field}Approx"));
            keep(r, field, None);
        }
        Some(t) => {
            r.set(field, t.amount);
            r.set(&format!("{field}Hours"), V::from(t.hours));
            r.set(&format!("{field}Approx"), t.approx);
            keep(r, field, Some(t));
        }
    }
}
/// `exports.clear(row, field)`.
pub fn clear(r: &V, field: &str) {
    r.del(field);
    r.del(&format!("{field}Hours"));
    r.del(&format!("{field}Approx"));
    keep(r, field, None);
}
/// `exports.readShortest(row, stored)`.
pub fn read_shortest(r: &V, stored: &V) {
    if let Some(mut t) = read(&stored.get("rn1"), &stored.get("rn1Text"), "mm") {
        t.hours = Some(1.);
        assign(r, "rn1", Some(t));
    }
}
/// `exports.finalize(row, field)`.
pub fn finalize(r: &V, field: &str) {
    if get(r, field).is_some() {
        return;
    }
    let value = r.get(field);
    let t = exact(&value, 3.).or_else(|| exact(&V::Num(0.), 0.));
    assign(r, field, t);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(s: &str, unit: &str) -> Option<Total> {
        parse(&V::s(s), unit, None)
    }
    #[test]
    fn categories_parse_like_the_legacy_regexes() {
        assert_eq!(format(t("1mm 미만", "mm").as_ref(), "mm"), "~1mm");
        assert_eq!(t("1mm 미만", "mm").unwrap().amount, 0.5);
        assert_eq!(format(t("30.0~50.0mm", "mm").as_ref(), "mm"), "30~50mm");
        assert_eq!(t("30.0~50.0mm", "mm").unwrap().amount, 40.);
        assert_eq!(format(t("50.0mm 이상", "mm").as_ref(), "mm"), "50~?mm");
        assert_eq!(format(t("2.0mm", "mm").as_ref(), "mm"), "2mm");
        assert_eq!(format(t("1.2cm", "cm").as_ref(), "cm"), "1.2cm");
        assert!(t("강수없음", "mm").is_none());
        assert!(t("50~30mm", "mm").is_none());
        assert_eq!(
            parse(&V::s("강수없음"), "mm", Some("강수없음"))
                .unwrap()
                .amount,
            0.
        );
        let sum = total(&[t("1mm 미만", "mm"), Some(exact_total(2.))]).unwrap();
        assert_eq!(
            (sum.amount, sum.min, sum.max, sum.hours),
            (2.5, 2., Some(3.), Some(2.))
        );
    }
}
