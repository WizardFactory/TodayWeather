//! `getCurrent` formatting ported from `server/controllers/kma.specialweather.controller.js`
//! and i18n 0.8.3 locale selection as configured by `server/app.js` (ca8735cf).
use super::{
    js::{self, key, ostr},
    records::Bulletin,
    text,
};
use crate::gateway::OrderedJson;

/// Legacy query order of `getCurrent`.
pub const ORDER: [u8; 4] = [4, 1, 2, 3];
const LOCALES: [&str; 6] = ["en", "ko", "ja", "zh-CN", "de", "zh-TW"];
const DEFAULT_LOCALE: &str = "en";

fn name(kind: f64, korean: bool) -> Option<&'static str> {
    // Every configured non-Korean locale file carries the English strings.
    Some(match (kind as i64, kind.fract() == 0., korean) {
        (1, true, true) => "기상특보",
        (2, true, true) => "예비특보",
        (3, true, true) => "기상정보",
        (4, true, true) => "기상속보",
        (1, true, false) => "Special weather",
        (2, true, false) => "Preliminary Special weather",
        (3, true, false) => "Weather information",
        (4, true, false) => "Flash weather information",
        _ => return None,
    })
}
fn set(fields: &mut Vec<(Vec<u16>, OrderedJson)>, name: &str, value: OrderedJson) {
    let k = key(name);
    match fields.iter_mut().find(|(f, _)| *f == k) {
        Some((_, v)) => *v = value,
        None => fields.push((k, value)),
    }
}
fn without_id(value: &mut OrderedJson) {
    if let OrderedJson::Object(fields) = value {
        let id = key("_id");
        fields.retain(|(k, _)| *k != id);
    }
}
/// `_parseSpecialWeatherSituation(doc, trans)`; `None` for an expired weather flash.
pub fn format(bulletin: &Bulletin, now_ms: i64, korean: bool) -> Option<OrderedJson> {
    let OrderedJson::Object(mut fields) = bulletin.doc.clone() else {
        return None;
    };
    let kind = bulletin.doc.get("type").and_then(OrderedJson::number);
    if let Some(n) = kind.and_then(|k| name(k, korean)) {
        set(&mut fields, "name", ostr(n));
    }
    let stored = bulletin.stored_ms;
    if kind == Some(4.) && stored + 10 * 3_600_000 < now_ms {
        return None;
    }
    set(
        &mut fields,
        "announcement",
        ostr(&js::iso(stored - 9 * 3_600_000)),
    );
    let mut list = Vec::new();
    let situation_key = key("situationList");
    if let Some((_, OrderedJson::Array(situations))) =
        fields.iter_mut().find(|(k, _)| *k == situation_key)
    {
        for s in situations.iter_mut() {
            without_id(s);
            if let OrderedJson::Object(entries) = s
                && let Some((_, OrderedJson::Array(info))) =
                    entries.iter_mut().find(|(k, _)| *k == key("info"))
            {
                info.iter_mut().for_each(without_id);
            }
            // `situation.weatherStr + situation.levelStr` is a string only when either is one.
            let (weather, level) = (s.get("weatherStr"), s.get("levelStr"));
            let is_string = |v: Option<&OrderedJson>| matches!(v, Some(OrderedJson::String(_)));
            if weather.and_then(OrderedJson::string).as_deref() != Some("없음")
                && (is_string(weather) || is_string(level))
            {
                let mut joined = js_string(weather);
                joined.extend(js_string(level));
                list.push(joined);
            }
        }
    }
    let comment = match bulletin.doc.get("comment") {
        Some(OrderedJson::String(s)) if !s.is_empty() => s.clone(),
        _ => vec![],
    };
    set(
        &mut fields,
        "comment",
        OrderedJson::String(text::insert_line_change(&list, &comment)),
    );
    Some(OrderedJson::Object(fields))
}
/// The `getCurrent` list in `[4,1,2,3]` order, skipping expired weather flashes.
pub fn current(latest: &[(u8, Option<Bulletin>)], now_ms: i64, korean: bool) -> OrderedJson {
    let mut out = Vec::new();
    for kind in ORDER {
        if let Some((_, Some(b))) = latest.iter().find(|(k, _)| *k == kind)
            && let Some(v) = format(b, now_ms, korean)
        {
            out.push(v);
        }
    }
    OrderedJson::Array(out)
}
fn cookie(header: Option<&str>, name: &str) -> Option<String> {
    header?.split(';').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k.trim() != name {
            return None;
        }
        let v = v.trim();
        let v = v
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .unwrap_or(v);
        Some(percent_decode(v))
    })
}
/// `decodeURIComponent`, keeping the raw value when it throws (cookie package behavior).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let (Some(h), Some(l)) = (
                b.get(i + 1).copied().and_then(hex),
                b.get(i + 2).copied().and_then(hex),
            ) else {
                return s.to_owned();
            };
            out.push(h * 16 + l);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_owned())
}
/// `String(value)` of a stored JSON member as UTF-16 (`undefined` when absent).
fn js_string(value: Option<&OrderedJson>) -> Vec<u16> {
    match value {
        None => js::utf16("undefined"),
        Some(OrderedJson::Null) => js::utf16("null"),
        Some(OrderedJson::Bool(b)) => js::utf16(&b.to_string()),
        Some(OrderedJson::Number(n)) => js::utf16(&crate::gateway::response::js_number(*n)),
        Some(OrderedJson::String(u)) => u.clone(),
        Some(OrderedJson::Array(items)) => {
            let mut out = Vec::new();
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',' as u16);
                }
                if !matches!(item, OrderedJson::Null) {
                    out.extend(js_string(Some(item)));
                }
            }
            out
        }
        Some(OrderedJson::Object(_)) => js::utf16("[object Object]"),
    }
}
/// i18n 0.8.3 `guessLanguage`: cookie `twcookie`, then `accept-language`, else `en`.
pub fn locale(accept_language: Option<&str>, cookie_header: Option<&str>) -> &'static str {
    let configured = |l: &str| LOCALES.iter().copied().find(|c| *c == l);
    if let Some(c) = cookie(cookie_header, "twcookie").filter(|c| !c.is_empty()) {
        return configured(&c).unwrap_or(DEFAULT_LOCALE);
    }
    let Some(header) = accept_language.filter(|h| !h.is_empty()) else {
        return DEFAULT_LOCALE;
    };
    let mut prefs: Vec<(String, f64)> = Vec::new();
    for item in header.split(',') {
        let item = js::trim(item);
        let mut parts = item.splitn(2, ";q=");
        let lang = parts.next().unwrap_or("").to_owned();
        let q = match parts.next() {
            None => 1.,
            Some(q) => {
                let v = parse_float(q);
                if v.is_nan() || v == 0. { 0. } else { v }
            }
        };
        // `preferences[lang] = q`: the last quality of a repeated tag applies to all copies.
        prefs.push((lang, q));
    }
    let quality = |l: &str| prefs.iter().rev().find(|(x, _)| x == l).map_or(0., |p| p.1);
    let mut accepted: Vec<String> = prefs
        .iter()
        .map(|(l, _)| l.clone())
        .filter(|l| quality(l) > 0.)
        .collect();
    accepted.sort_by(|a, b| js::order(quality(b) - quality(a)));
    let mut fallback = None;
    for lang in &accepted {
        if let Some(l) = configured(lang) {
            return l;
        }
        let parent = lang.split('-').next().unwrap_or("");
        if fallback.is_none() {
            fallback = configured(parent);
        }
    }
    fallback.unwrap_or(DEFAULT_LOCALE)
}
/// `parseFloat(string)`: longest decimal prefix after leading whitespace.
fn parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(js::is_space);
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    if t[i..].starts_with("Infinity") {
        return if t.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i == start || (i == start + 1 && b[start] == b'.') {
        return f64::NAN;
    }
    let mut end = i;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let digits = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > digits {
            end = j;
        }
    }
    t[..end].parse().unwrap_or(f64::NAN)
}
