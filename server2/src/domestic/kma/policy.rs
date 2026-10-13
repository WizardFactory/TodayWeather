//! `lib/midForecastPolicy.js`, `lib/history/policy.js` and `lib/history/observations.js` as used
//! by the v000903 chain (ASOS history reads are off; see the module docs in `mod.rs`).
use super::js::{Arr, Ob, V, gt, is_finite_number, obj, strict_eq, to_str};
use super::time::{DAY, HOUR, make_date};
use crate::world::js as wjs;

const KST: f64 = 9. * HOUR;

fn iso_date_compact(ms: f64) -> Option<String> {
    wjs::iso(ms).map(|s| s[..10].replace('-', ""))
}
fn digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

// ---- midForecastPolicy ----

pub const LAND_FIELDS: [&str; 26] = [
    "wf3Am", "rnSt3Am", "wf3Pm", "rnSt3Pm", "wf4Am", "rnSt4Am", "wf4Pm", "rnSt4Pm", "wf5Am",
    "rnSt5Am", "wf5Pm", "rnSt5Pm", "wf6Am", "rnSt6Am", "wf6Pm", "rnSt6Pm", "wf7Am", "rnSt7Am",
    "wf7Pm", "rnSt7Pm", "wf8", "rnSt8", "wf9", "rnSt9", "wf10", "rnSt10",
];
pub const TEMP_FIELDS: [&str; 16] = [
    "taMin3", "taMax3", "taMin4", "taMax4", "taMin5", "taMax5", "taMin6", "taMax6", "taMin7",
    "taMax7", "taMin8", "taMax8", "taMin9", "taMax9", "taMin10", "taMax10",
];
pub fn temperature(v: &V) -> bool {
    matches!(v, V::Num(n) if n.is_finite() && *n > -50. && *n < 60.)
}
pub fn probability(v: &V) -> bool {
    matches!(v, V::Num(n) if n.is_finite() && *n >= 0. && *n <= 100.)
}
/// `midPolicy.skyInfo(value)`: (sky, pty).
pub fn sky_info(v: &V) -> Option<(f64, f64)> {
    let s = v.str()?;
    let t = s.trim_matches(super::precip::js_ws);
    let table: [(f64, f64, &str); 13] = [
        (1., 0., "맑음"),
        (2., 0., "구름조금"),
        (3., 0., "구름많음"),
        (4., 0., "흐림"),
        (4., 1., "흐리고 한때 비|흐리고 비|흐리고 소나기"),
        (2., 1., "구름적고 한때 비|구름적고 비"),
        (3., 1., "구름많고 한때 비|구름많고 비|구름많고 소나기"),
        (4., 3., "흐리고 한때 눈|흐리고 눈"),
        (2., 3., "구름적고 한때 눈|구름적고 눈"),
        (3., 3., "구름많고 한때 눈|구름많고 눈"),
        (2., 2., "구름적고 비/눈|구름적고 눈/비"),
        (3., 2., "구름많고 비/눈|구름많고 눈/비"),
        (4., 2., "흐리고 비/눈|흐리고 눈/비"),
    ];
    table
        .iter()
        .find(|(_, _, texts)| texts.split('|').any(|x| x == t))
        .map(|(sky, pty, _)| (*sky, *pty))
}
pub fn weather(v: &V) -> bool {
    sky_info(v).is_some()
}
/// `midPolicy.timestamp(value)`.
pub fn timestamp(v: &V) -> f64 {
    match v {
        V::Str(s) if digits(s, 12) => {
            let n = |a: usize, b: usize| s[a..b].parse::<f64>().unwrap_or(f64::NAN);
            let (y, m, d, h, mi) = (n(0, 4), n(4, 6), n(6, 8), n(8, 10), n(10, 12));
            let ms = make_date(y, m - 1., d, h, mi, 0.);
            match wjs::parts(ms) {
                Some(p)
                    if p.year as f64 == y
                        && (p.month - 1) as f64 == m - 1.
                        && p.day as f64 == d
                        && h <= 23.
                        && mi <= 59. =>
                {
                    ms - KST
                }
                _ => f64::NAN,
            }
        }
        V::Str(s) if is_tz_iso(s) => super::time::parse_date(s),
        V::Date(ms) => *ms,
        _ => f64::NAN,
    }
}
/// `/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/`.
fn is_tz_iso(s: &str) -> bool {
    // Byte tests: a non-ASCII string must be rejected, never sliced inside a character.
    let b = s.as_bytes();
    let dig = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    if b.len() < 11
        || !dig(0..4)
        || b[4] != b'-'
        || !dig(5..7)
        || b[7] != b'-'
        || !dig(8..10)
        || b[10] != b'T'
    {
        return false;
    }
    // `.*` matches no line terminator.
    if s.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return false;
    }
    if s.ends_with('Z') {
        return true;
    }
    let n = b.len();
    n >= 17
        && (b[n - 6] == b'+' || b[n - 6] == b'-')
        && dig(n - 5..n - 3)
        && b[n - 3] == b':'
        && dig(n - 2..n)
}
/// `midPolicy.date(value)` (a number is an instant).
pub fn date(v: &V) -> Option<String> {
    let ms = match v {
        V::Num(n) => *n,
        other => timestamp(other),
    };
    if ms.is_finite() {
        iso_date_compact(ms + KST)
    } else {
        None
    }
}
pub fn date_ms(ms: f64) -> Option<String> {
    date(&V::Num(ms))
}
/// `midPolicy.addDays(date, days)`.
pub fn add_days(d: &V, days: f64) -> Option<String> {
    let ms = match d {
        V::Str(s) if digits(s, 8) => timestamp(&V::Str(format!("{s}0000").into())),
        _ => f64::NAN,
    };
    if ms.is_finite() {
        date_ms(ms + days * DAY)
    } else {
        None
    }
}
pub fn add_days_s(d: &str, days: f64) -> Option<String> {
    add_days(&V::s(d), days)
}
fn opt(v: Option<String>) -> V {
    v.map_or(V::Undef, V::from)
}
/// `midPolicy.publication(value)`.
pub fn publication(v: &V) -> bool {
    let ms = timestamp(v);
    match wjs::parts(ms + KST) {
        Some(p) if ms.is_finite() => {
            (p.hour == 6 || p.hour == 18) && p.minute == 0 && p.second == 0 && p.milli == 0
        }
        _ => false,
    }
}
/// `midPolicy.fresh(value, now)`.
pub fn fresh(v: &V, now: f64) -> bool {
    let age = now - timestamp(v);
    publication(v) && (0. ..=36. * HOUR).contains(&age)
}
/// `midPolicy.freshShort(value, now)`.
pub fn fresh_short(v: &V, now: f64) -> bool {
    let age = now - timestamp(v);
    (0. ..=24. * HOUR).contains(&age)
}
/// `midPolicy.shortDailySnapshot(row, publication)`.
pub fn short_daily_snapshot(row: &V, publication: &V) -> V {
    let r = obj(vec![("pubDate", publication.clone())]);
    for f in [
        "date", "time", "t3h", "tmn", "tmx", "sky", "pty", "reh", "pop", "wsd",
    ] {
        let v = row.get(f);
        if !v.is_undef() {
            r.set(f, v);
        }
    }
    V::Obj(r)
}
/// `midPolicy.inWindow(date, now)`.
pub fn in_window(d: &V, now: f64) -> bool {
    let Some(today) = date_ms(now) else {
        return false;
    };
    let ds = to_str(d);
    let same = add_days(d, 0.);
    same.as_deref() == Some(ds.as_str())
        && matches!(
            d,
            V::Str(_) | V::Num(_) | V::Obj(_) | V::Arr(_) | V::Bool(_) | V::Date(_) | V::Null
        )
        && add_days_s(&today, -7.).is_some_and(|a| ds.encode_utf16().cmp(a.encode_utf16()).is_ge())
        && add_days_s(&today, 10.).is_some_and(|b| ds.encode_utf16().cmp(b.encode_utf16()).is_le())
}
/// `midPolicy.dailyShortRows(records, now)`.
pub fn daily_short_rows(records: &V, now: f64) -> Vec<V> {
    let Some(list) = records.as_arr() else {
        return Vec::new();
    };
    let mut slots: Vec<(String, V)> = Vec::new();
    for row in list.items() {
        if !row.truthy()
            || !matches!(row.get("date"), V::Str(_))
            || !matches!(row.get("time"), V::Str(_))
        {
            continue;
        }
        let key = format!("{}{}", to_str(&row.get("date")), to_str(&row.get("time")));
        if !timestamp(&V::Str(key.clone().into())).is_finite()
            || !timestamp(&row.get("pubDate")).is_finite()
        {
            continue;
        }
        match slots.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => {
                if timestamp(&row.get("pubDate")) >= timestamp(&slot.1.get("pubDate")) {
                    slot.1 = row;
                }
            }
            None => slots.push((key, row)),
        }
    }
    slots.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
    slots
        .into_iter()
        .map(|(_, r)| r)
        .filter(|row| {
            let pub_date = row.get("pubDate");
            fresh_short(&pub_date, now)
                && in_window(&row.get("date"), now)
                && date(&pub_date)
                    .and_then(|d| add_days_s(&d, 4.))
                    .is_some_and(|limit| {
                        to_str(&row.get("date"))
                            .encode_utf16()
                            .cmp(limit.encode_utf16())
                            .is_le()
                    })
        })
        .collect()
}
/// `midPolicy.latest(records, publication, now)`.
pub fn latest(records: &V, publication_v: &V, now: f64) -> V {
    let Some(list) = records.as_arr() else {
        return V::Null;
    };
    if list.is_empty() {
        return V::Null;
    }
    let items = list.items();
    let mut best = items[0].clone();
    for b in items.iter().skip(1) {
        let tb = timestamp(&super::js::add(&b.get("date"), &b.get("time")));
        let ta = timestamp(&super::js::add(&best.get("date"), &best.get("time")));
        if tb > ta {
            best = b.clone();
        }
    }
    let identity = super::js::add(&best.get("date"), &best.get("time"));
    if !fresh(&identity, now)
        || (!publication_v.is_undef() && timestamp(publication_v) != timestamp(&identity))
    {
        return V::Null;
    }
    best
}
/// `midPolicy.complete(row)`.
pub fn complete(row: &V) -> bool {
    row.truthy()
        && temperature(&row.get("taMin"))
        && temperature(&row.get("taMax"))
        && super::js::le(&row.get("taMin"), &row.get("taMax"))
}
/// `midPolicy.dailyHealth(mid, now)`.
pub fn daily_health(mid: &V, now: f64) -> V {
    let rows: Vec<V> = if mid.truthy() {
        mid.get("dailyData")
            .as_arr()
            .map(Arr::items)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut reasons: Vec<&str> = Vec::new();
    let today = date_ms(now).unwrap_or_default();
    if !mid.truthy() || !fresh(&mid.get("landPubDate"), now) {
        reasons.push("land-unavailable");
    }
    if !mid.truthy() || !fresh(&mid.get("tempPubDate"), now) {
        reasons.push("temperature-unavailable");
    }
    let mut seen: Vec<String> = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let d = row.get("date");
        if !in_window(&d, now) {
            reasons.push("target-out-of-window");
        }
        let ds = to_str(&d);
        if seen.contains(&ds) || (i > 0 && gt(&rows[i - 1].get("date"), &d)) {
            reasons.push("dates-not-unique-sorted");
        }
        let ot = row.get("observationType");
        let observed = super::js::lt(&d, &V::s(&today))
            && (strict_eq(&ot, &V::s("daily")) || strict_eq(&ot, &V::s("hourly-summary")));
        if complete(row) && (observed || (weather(&row.get("wfAm")) && weather(&row.get("wfPm")))) {
            seen.push(ds);
        } else {
            reasons.push("invalid-daily-row");
        }
    }
    let plus4 = add_days_s(&today, 4.).unwrap_or_default();
    if !rows.iter().any(|row| {
        super::js::ge(&row.get("date"), &V::s(&plus4))
            && complete(row)
            && weather(&row.get("wfAm"))
            && weather(&row.get("wfPm"))
    }) {
        reasons.push("future-mid-unavailable");
    }
    let mut missing = Vec::new();
    for d in 0..=10 {
        let target = add_days_s(&today, f64::from(d)).unwrap_or_default();
        if !seen.contains(&target) {
            missing.push(target);
        }
    }
    let mut future: Vec<&String> = seen
        .iter()
        .filter(|d| d.as_str() >= today.as_str())
        .collect();
    future.sort();
    if let Some(last) = future.last()
        && missing.iter().any(|d| d.as_str() <= last.as_str())
    {
        reasons.push("forecast-gap");
    }
    let mut unique: Vec<&str> = Vec::new();
    for r in reasons {
        if !unique.contains(&r) {
            unique.push(r);
        }
    }
    V::Obj(obj(vec![
        ("healthy", V::Bool(unique.is_empty())),
        (
            "reasons",
            V::Arr(Arr::from_vec(unique.into_iter().map(V::from).collect())),
        ),
        (
            "unavailableDates",
            V::Arr(Arr::from_vec(missing.into_iter().map(V::from).collect())),
        ),
        ("rss", V::s("retired")),
    ]))
}

// ---- history/policy ----

/// `policy.valid(field, value)`.
pub fn valid(field: &str, v: &V) -> bool {
    let (lo, hi) = match field {
        "t1h" | "t1d" | "taMin" | "taMax" => (-50., 60.),
        "reh" => (0., 100.),
        "rn1" => (0., 5000.),
        "wsd" => (0., 100.),
        "vec" => (0., 360.),
        "sky" => (1., 4.),
        _ => return false,
    };
    match v {
        V::Num(n) => {
            n.is_finite() && *n >= lo && *n <= hi && (!field.starts_with('t') || *n > -50.)
        }
        _ => false,
    }
}
/// `policy.key(ms, daily)`.
pub fn key(ms: f64, daily: bool) -> Option<String> {
    let iso = wjs::iso(ms + KST)?;
    let cut = if daily { 10 } else { 16 };
    Some(iso[..cut].replace(['-', 'T', ':'], ""))
}
/// `policy.instant(key)`.
pub fn instant(v: &V) -> f64 {
    let Some(s) = v.str() else {
        return f64::NAN;
    };
    if !(digits(s, 8) || digits(s, 12)) {
        return f64::NAN;
    }
    let n = |a: usize, b: usize| {
        s.get(a..b)
            .filter(|x| !x.is_empty())
            .map_or(0., |x| x.parse::<f64>().unwrap_or(0.))
    };
    let (y, m, d, h, mi) = (n(0, 4), n(4, 6), n(6, 8), n(8, 10), n(10, 12));
    if y < 1900. || m < 1. || m > 12. || d < 1. || h > 23. || mi != 0. {
        return f64::NAN;
    }
    let ms = make_date(y, m - 1., d, h, 0., 0.) - KST;
    if key(ms, s.len() == 8).as_deref() == Some(s) {
        ms
    } else {
        f64::NAN
    }
}
pub fn add_days_key(d: &str, n: f64) -> Option<String> {
    key(instant(&V::s(d)) + n * DAY, true)
}
/// `policy.station(value)`.
pub fn station(v: &V) -> Option<String> {
    let s = to_str(v);
    if (1..=3).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
        let n: u32 = s.parse().ok()?;
        (n > 0).then(|| n.to_string())
    } else {
        None
    }
}
/// `policy.slot(row)`.
pub fn slot(row: &V) -> Option<String> {
    if !row.truthy() {
        return None;
    }
    let (d, t) = (row.get("date"), row.get("time"));
    let (Some(d), Some(t)) = (d.str(), t.str()) else {
        return None;
    };
    if t == "2400" {
        add_days_key(d, 1.).map(|x| format!("{x}0000"))
    } else {
        Some(format!("{d}{t}"))
    }
}
fn slot_v(row: &V) -> V {
    opt(slot(row))
}
/// `policy.hourlyResponse(rows)`.
pub fn hourly_response(rows: &Arr) -> Arr {
    Arr::from_vec(
        rows.items()
            .into_iter()
            .map(|row| {
                if !row.get("historyObservation").truthy() {
                    return row;
                }
                let result = V::Obj(row.o().assign_copy());
                for f in ["rn1", "r06", "s06"] {
                    let v = result.get(f);
                    if !v.is_undef() && !matches!(v, V::Num(n) if n.is_finite() && n >= 0.) {
                        result.del(f);
                        result.del(&format!("{f}Str"));
                    }
                }
                result
            })
            .collect(),
    )
}
/// `policy.record(row, source, fields)`.
pub fn record(row: &V, source: &V, fields: &[&str]) {
    let provenance = obj(vec![
        ("source", source.get("source")),
        ("stationId", V::from(to_str(&source.get("stationId")))),
        ("key", source.get("key")),
        (
            "fields",
            V::Arr(Arr::from_vec(fields.iter().map(|f| V::s(f)).collect())),
        ),
    ]);
    row.set("historyObservation", V::Obj(provenance.clone()));
    if !row.get("fieldObservations").truthy() {
        row.set("fieldObservations", V::Obj(Ob::new()));
    }
    let fo = row.get("fieldObservations");
    for f in fields {
        fo.set(
            f,
            V::Obj(obj(vec![
                ("source", provenance.get("source")),
                ("stationId", provenance.get("stationId")),
                ("key", provenance.get("key")),
            ])),
        );
    }
}

// ---- history/observations ----

/// `observations.legacyKey(date)`.
pub fn legacy_key(d: &V) -> Option<String> {
    let ms = super::time::new_date(d);
    let iso = wjs::iso(ms)?;
    if &iso[14..] != "00:00.000Z" {
        return None;
    }
    let k = iso[..16].replace(['-', 'T', ':'], "");
    instant(&V::s(&k)).is_finite().then_some(k)
}
/// `observations.mergeLegacy(req, records)`.
pub fn merge_legacy(req: &V, records: &V) {
    let mut by_key: Vec<(String, V)> = Vec::new();
    if let Some(list) = records.as_arr() {
        for r in list.items() {
            let (Some(k), Some(st)) = (legacy_key(&r.get("date")), station(&r.get("stnId"))) else {
                continue;
            };
            let values = obj(vec![
                ("t1h", r.get("t1h")),
                ("reh", r.get("reh")),
                ("rn1", r.get("rs1h")),
                ("vec", r.get("vec")),
                ("wsd", r.get("wsd")),
            ]);
            let src = V::Obj(obj(vec![
                ("source", V::s("KMA_STATION_HOURLY")),
                ("stationId", V::from(st)),
                ("key", V::from(k.clone())),
                ("values", V::Obj(values)),
            ]));
            match by_key.iter_mut().find(|(x, _)| *x == k) {
                Some(slot) => slot.1 = src,
                None => by_key.push((k, src)),
            }
        }
    }
    let current_list = req.get("currentList");
    let mut rows: Vec<V> = current_list.as_arr().map(Arr::items).unwrap_or_default();
    let current = req.get("current");
    if current.truthy() && !rows.iter().any(|r| strict_eq(r, &current)) {
        rows.push(current);
    }
    for row in rows {
        let Some(s) = slot(&row) else {
            continue;
        };
        let Some((_, source)) = by_key.iter().find(|(k, _)| *k == s) else {
            continue;
        };
        let values = source.get("values");
        let mut fields = Vec::new();
        for f in values.o().keys() {
            let fv = values.get(&f);
            if !valid(&f, &row.get(&f)) && valid(&f, &fv) {
                row.set(&f, fv);
                fields.push(f);
            }
        }
        if !fields.is_empty() {
            let refs: Vec<&str> = fields.iter().map(String::as_str).collect();
            record(&row, source, &refs);
        }
    }
}
fn temperature_source(row: &V) -> V {
    let fo = row.get("fieldObservations");
    if fo.truthy() && fo.get("t1h").truthy() {
        return fo.get("t1h");
    }
    let source = row.get("historyObservation");
    if source.truthy() {
        let fields = source.get("fields");
        if fields.truthy()
            && fields
                .as_arr()
                .is_some_and(|a| a.index_of(&V::s("t1h")).is_some())
        {
            return source;
        }
    }
    V::Undef
}
fn measurement_hour(source: &V) -> f64 {
    if !strict_eq(&source.get("source"), &V::s("KMA_STATION_LIVE")) {
        return instant(&source.get("key"));
    }
    let k = source.get("key");
    let Some(s) = k.str() else {
        return f64::NAN;
    };
    if !digits(s, 12) || s[10..].parse::<f64>().unwrap_or(99.) > 59. {
        return f64::NAN;
    }
    instant(&V::Str(format!("{}00", &s[..10]).into()))
}
/// `observations.canCompare(current, yesterday)`.
pub fn can_compare(current: &V, yesterday: &V) -> bool {
    if !current.truthy()
        || !yesterday.truthy()
        || yesterday.get("missing").truthy()
        || strict_eq(&yesterday.get("comparisonAvailable"), &V::Bool(false))
    {
        return false;
    }
    if !is_finite_number(&current.get("t1h")) || !is_finite_number(&yesterday.get("t1h")) {
        return false;
    }
    if strict_eq(&yesterday.get("comparisonAvailable"), &V::Bool(true)) {
        return true;
    }
    if !valid("t1h", &current.get("t1h")) || !valid("t1h", &yesterday.get("t1h")) {
        return false;
    }
    let (a, b) = (temperature_source(current), temperature_source(yesterday));
    if !a.truthy() && !b.truthy() {
        return true;
    }
    let slot_ms = |row: &V| instant(&slot_v(row));
    if a.truthy() && strict_eq(&a.get("source"), &V::s("KMA_STATION_LIVE")) && !b.truthy() {
        let hour = measurement_hour(&a);
        return station(&a.get("stationId")).is_some()
            && hour == slot_ms(current)
            && hour - slot_ms(yesterday) == DAY;
    }
    if !a.truthy()
        || !b.truthy()
        || !strict_eq(&a.get("source"), &b.get("source"))
        || to_str(&a.get("stationId")) != to_str(&b.get("stationId"))
    {
        return false;
    }
    if strict_eq(&a.get("source"), &V::s("KMA_STATION_LIVE")) {
        return station(&a.get("stationId")).is_some()
            && measurement_hour(&a) == slot_ms(current)
            && measurement_hour(&b) == slot_ms(yesterday)
            && measurement_hour(&a) - measurement_hour(&b) == DAY;
    }
    !a.get("key").truthy()
        || !b.get("key").truthy()
        || instant(&a.get("key")) - instant(&b.get("key")) == DAY
}
/// `observations.yesterday(current, rows)`.
pub fn yesterday(current: &V, rows: &V) -> V {
    let s = slot_v(current);
    let target = key(instant(&s) - DAY, false);
    let found = rows.as_arr().map(|a| {
        a.find(|row| slot(row) == target && target.is_some() && valid("t1h", &row.get("t1h")))
    });
    let Some(target) = target else {
        return V::Obj(obj(vec![
            ("missing", V::Bool(true)),
            ("comparisonAvailable", V::Bool(false)),
        ]));
    };
    let result = found.unwrap_or_default();
    if result.is_undef() || !valid("t1h", &result.get("t1h")) {
        return V::Obj(obj(vec![
            ("date", V::from(target[..8].to_owned())),
            ("time", V::from(target[8..].to_owned())),
            ("missing", V::Bool(true)),
            ("comparisonAvailable", V::Bool(false)),
        ]));
    }
    let r = V::Obj(result.o().assign_copy());
    r.del("comparisonAvailable");
    let available = can_compare(current, &r);
    r.set("comparisonAvailable", available);
    if !available {
        r.del("t1h");
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn non_ascii_publication_strings_are_rejected_without_panicking() {
        // midForecastPolicy returns NaN for these; 4 is not a character boundary here.
        for s in [
            "한글날짜",
            "한글날짜T00:00Z",
            "2026-09-24T한",
            "가나다라마바사아",
            "2026-09-24T00:00:00+aé00",
            "2026-09-24T00:00:00+0é:0",
            "2026-09-24T00:00:00\nZ",
        ] {
            assert!(timestamp(&V::s(s)).is_nan(), "{s}");
            assert!(!is_tz_iso(s), "{s}");
        }
        // Matching the pattern but rejected by V8 (S15-R10).
        for s in ["2026-09-24T08:00:00+99:99", "2026-09-24T24:00:00.001Z"] {
            assert!(is_tz_iso(s) && timestamp(&V::s(s)).is_nan(), "{s}");
        }
        assert!(timestamp(&V::s("2026-09-24T08:00:00Z")).is_finite());
    }
}
