//! S15b-3: AirKorea inputs of the KMA assembly rebuilt from S13b/S15b-3 raw records.
//!
//! Legacy references (master `05c06c67`):
//! - `MsrStnInfo` from `getMsrstnList` pages: `kecoRequester.completeGeoMsrStnInfo`,
//!   `parseMsrstnList`, `saveMsrstnList` (`update({stationName}, doc, {upsert})`).
//! - `ArpltnKeco` from real-time observation pages: `airkoreaObservation.parseRows` (station
//!   operation, `Arpltn.getKeyList()`), `kecoRequester.saveRLTMCtprvn`
//!   (`update({stationName, date}, row, {upsert})`).
//! - `MinuDustFrcst` from `getMinuDustFrcstDspth` pages: `_checkDataTime`, `_parseFrcst`,
//!   `_saveFrcst`.
//! - The tw_svc readers `kecoController.getArpLtnInfo` (`$near`, 24-hour rows,
//!   `_mergeArpltnList`, the station sort) and `getDustFrcst`, and `airFallback`'s
//!   `observation.evaluate` for the provider fallback.
//!
//! Documents keep the Mongoose 5.1.2 update form the oracle records: on insert the query fields
//! come first, then `__v`, then the `$set` fields in reverse order (Mongoose walks update keys
//! backwards); an update replaces fields in place and appends new ones. Legacy geocodes a station
//! without coordinates from its address; server2 does not, so such a station is not stored (no
//! live station lacked coordinates on 2026-10-14).
use super::doc::{Doc, Val};
use crate::gateway::OrderedJson;
use serde_json::Value;
use std::collections::HashMap;

const HOUR_MS: f64 = 3_600_000.;

// ---- shared helpers ----

/// `new Date('YYYY-MM-DDT00:00:00Z')` of a valid calendar date, in ms.
fn utc_midnight(date: &str) -> Option<f64> {
    let b = date.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || ![0..4, 5..7, 8..10]
            .iter()
            .all(|r| b[r.clone()].iter().all(u8::is_ascii_digit))
    {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (
        date[..4].parse().ok()?,
        date[5..7].parse().ok()?,
        date[8..10].parse().ok()?,
    );
    let ms = crate::world::js::days_from_civil(y, m, d) as f64 * 86_400_000.;
    // Calendar rollover (February 30) is not the same date.
    crate::world::js::iso(ms).filter(|i| &i[..10] == date)?;
    Some(ms)
}
/// `airkoreaObservation.kstInstant` / `KecoController._parseDateTime`: a KST `YYYY-MM-DD HH:MM`
/// wall time with `24:00` allowed at minute 0; NaN otherwise.
pub fn kst_instant(value: &str) -> f64 {
    let b = value.as_bytes();
    if b.len() != 16
        || b[10] != b' '
        || b[13] != b':'
        || !b[11..13].iter().all(u8::is_ascii_digit)
        || !b[14..16].iter().all(u8::is_ascii_digit)
    {
        return f64::NAN;
    }
    let Some(midnight) = utc_midnight(&value[..10]) else {
        return f64::NAN;
    };
    let (h, m): (f64, f64) = (
        value[11..13].parse().unwrap_or(99.),
        value[14..16].parse().unwrap_or(99.),
    );
    if h > 24. || m > 59. || (h == 24. && m != 0.) {
        return f64::NAN;
    }
    midnight + (h - 9.) * HOUR_MS + m * 60_000.
}
/// JavaScript `!value` of a JSON value.
fn falsy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::Bool(b)) => !b,
        Some(Value::Number(n)) => n.as_f64().is_none_or(|f| f == 0. || f.is_nan()),
        Some(Value::String(s)) => s.is_empty(),
        Some(_) => false,
    }
}
/// JavaScript `Number(value)` of a JSON scalar (strings with JavaScript whitespace trimmed).
fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim_matches(crate::domestic::kma::precip::js_ws);
            if t.is_empty() {
                0.
            } else {
                t.parse::<f64>()
                    .ok()
                    .filter(|_| {
                        !t.contains(['i', 'I', 'n', 'N', '_', 'x', 'X'])
                            || t == "Infinity"
                            || t == "+Infinity"
                            || t == "-Infinity"
                    })
                    .unwrap_or(f64::NAN)
            }
        }
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Null => 0.,
        _ => f64::NAN,
    }
}
/// JavaScript `parseFloat(String(value))`.
fn parse_float(v: &Value) -> f64 {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return f64::NAN,
    };
    let t = s.trim_start_matches(crate::domestic::kma::precip::js_ws);
    let b = t.as_bytes();
    let mut end = 0;
    if end < b.len() && (b[end] == b'+' || b[end] == b'-') {
        end += 1;
    }
    if t[end..].starts_with("Infinity") {
        return if b.first() == Some(&b'-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let digits_start = end;
    while end < b.len() && b[end].is_ascii_digit() {
        end += 1;
    }
    let mut seen = end > digits_start;
    if end < b.len() && b[end] == b'.' {
        let mut e = end + 1;
        while e < b.len() && b[e].is_ascii_digit() {
            e += 1;
        }
        if e > end + 1 || seen {
            seen |= e > end + 1;
            end = e;
        }
    }
    if !seen {
        return f64::NAN;
    }
    if end < b.len() && (b[end] == b'e' || b[end] == b'E') {
        let mut e = end + 1;
        if e < b.len() && (b[e] == b'+' || b[e] == b'-') {
            e += 1;
        }
        let ds = e;
        while e < b.len() && b[e].is_ascii_digit() {
            e += 1;
        }
        if e > ds {
            end = e;
        }
    }
    t[..end].parse().unwrap_or(f64::NAN)
}
/// Mongoose `update(query, doc, {upsert: true})` of one document: the `$set` fields walked in
/// reverse; an insert starts with the query fields and `__v: 0`.
fn upsert(docs: &mut Vec<Doc>, found: Option<usize>, query: &[(&str, Val)], set: &[(String, Val)]) {
    let doc = match found {
        Some(i) => &mut docs[i],
        None => {
            let mut d = Doc::new();
            for (k, v) in query {
                d.set(k, v.clone());
            }
            d.set("__v", Val::num(0.));
            docs.push(d);
            docs.last_mut().expect("just pushed")
        }
    };
    for (k, v) in set.iter().rev() {
        doc.set(k, v.clone());
    }
}

// ---- MsrStnInfo ----

/// The `MsrStnInfo` collection in natural (insertion) order.
#[derive(Debug, Clone, Default)]
pub struct Stations {
    docs: Vec<Doc>,
}
impl Stations {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }
    /// One complete `getMsrstnList` acquisition (items of every page in order):
    /// `completeGeoMsrStnInfo` (swap when `dmX > 100`; no geocoding), `parseMsrstnList`, then
    /// `saveMsrstnList`. An acquisition without one parsable station changes nothing.
    pub fn apply(&mut self, items: &[Value]) {
        let mut parsed: Vec<Vec<(String, Val)>> = Vec::new();
        for item in items {
            let Some(o) = item.as_object() else { continue };
            let (mut dm_x, mut dm_y) = (o.get("dmX").cloned(), o.get("dmY").cloned());
            let empty = |v: &Option<Value>| matches!(v, Some(Value::String(s)) if s.is_empty());
            if !empty(&dm_y) && !empty(&dm_x) {
                // `msrStn.dmX > 100` (relational comparison through ToNumber).
                if dm_x.as_ref().is_some_and(|x| js_number(x) > 100.) {
                    std::mem::swap(&mut dm_x, &mut dm_y);
                }
            }
            // An empty coordinate would be geocoded from `addr` by legacy (not ported).
            if falsy(o.get("stationName")) || falsy(dm_y.as_ref()) || falsy(dm_x.as_ref()) {
                continue;
            }
            let mut doc: Vec<(String, Val)> = Vec::new();
            // Mongoose casts the `String` path (a numeric name becomes its string).
            doc.push(("stationName".into(), string_cast(&o["stationName"])));
            let (lon, lat) = (
                parse_float(dm_y.as_ref().expect("checked")),
                parse_float(dm_x.as_ref().expect("checked")),
            );
            // Mongoose casts `geo` to `[Number]`: NaN is a CastError and that row's update is
            // not sent (an existing station keeps its document; the other rows are saved).
            if lon.is_nan() || lat.is_nan() {
                continue;
            }
            doc.push(("geo".into(), Val::Arr(vec![Val::num(lon), Val::num(lat)])));
            if let Some(Value::String(s)) = o.get("item") {
                doc.push((
                    "item".into(),
                    Val::Arr(s.split(',').map(Val::str).collect()),
                ));
            }
            for k in ["addr", "mangName", "map", "oper", "photo", "year"] {
                // `parsedMsrStn[k] = msrStn[k]`: an absent field is `undefined`, stored as null.
                doc.push((k.into(), o.get(k).map_or(Val::Null, string_cast)));
            }
            parsed.push(doc);
        }
        for doc in parsed {
            let name = doc[0].1.clone();
            let found = self
                .docs
                .iter()
                .position(|d| d.get("stationName") == Some(&name));
            upsert(
                &mut self.docs,
                found,
                &[("stationName", name.clone())],
                &doc,
            );
        }
    }
    /// `MsrStn.find({geo: {$near: [lon, lat], $maxDistance: 1}}).limit(6)`: planar distance
    /// over `[lon, lat]` degrees, nearest first, natural order for equal distances.
    pub fn near(&self, lon: f64, lat: f64) -> Vec<&Doc> {
        let mut hits: Vec<(f64, usize, &Doc)> = self
            .docs
            .iter()
            .enumerate()
            .filter_map(|(i, d)| {
                let Some(Val::Arr(g)) = d.get("geo") else {
                    return None;
                };
                let (x, y) = (g.first()?.as_num()?, g.get(1)?.as_num()?);
                let r = (x - lon).hypot(y - lat);
                (r <= 1.).then_some((r, i, d))
            })
            .collect();
        hits.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        hits.into_iter().take(6).map(|(_, _, d)| d).collect()
    }
}
/// Mongoose `String` cast of a `$set` value (numbers become strings, `null` stays `null`).
fn string_cast(v: &Value) -> Val {
    match v {
        Value::String(s) => Val::str(s),
        Value::Number(n) => Val::str(crate::world::js::num_string(n.as_f64().unwrap_or(f64::NAN))),
        Value::Bool(b) => Val::str(if *b { "true" } else { "false" }),
        _ => Val::Null,
    }
}

// ---- ArpltnKeco ----

/// `Arpltn.getKeyList()`.
const KEYS: [&str; 21] = [
    "stationName",
    "mangName",
    "dataTime",
    "so2Value",
    "coValue",
    "o3Value",
    "no2Value",
    "pm10Value",
    "pm10Value24",
    "pm25Value",
    "pm25Value24",
    "khaiValue",
    "khaiGrade",
    "so2Grade",
    "coGrade",
    "o3Grade",
    "no2Grade",
    "pm10Grade",
    "pm25Grade",
    "pm10Grade1h",
    "pm25Grade1h",
];
const VALUES: [&str; 9] = [
    "so2Value",
    "coValue",
    "o3Value",
    "no2Value",
    "pm10Value",
    "pm25Value",
    "pm10Value24",
    "pm25Value24",
    "khaiValue",
];
/// `airkoreaObservation.number`: a nonnegative finite number, or a plain decimal string.
fn obs_number(v: &Value) -> Option<f64> {
    let n = match v {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => {
            let t = s.trim_matches(crate::domestic::kma::precip::js_ws);
            let (int, frac) = t.split_once('.').unwrap_or((t, "0"));
            if int.is_empty()
                || frac.is_empty()
                || !int.bytes().all(|b| b.is_ascii_digit())
                || !frac.bytes().all(|b| b.is_ascii_digit())
            {
                return None;
            }
            js_number(v)
        }
        _ => return None,
    };
    (n.is_finite() && n >= 0.).then_some(n)
}
/// `parseRows(data, STATION, Arpltn.getKeyList())` for one row with a valid data time and a
/// station name; None when no concentration is usable.
fn parse_row(o: &serde_json::Map<String, Value>, ms: f64) -> Option<Vec<(String, Val)>> {
    let mut row: Vec<(String, Val)> = vec![("date".into(), Val::Date(ms))];
    let set = |row: &mut Vec<(String, Val)>, k: &str, v: Val| match row
        .iter_mut()
        .find(|(n, _)| n == k)
    {
        Some(slot) => slot.1 = v,
        None => row.push((k.into(), v)),
    };
    for name in KEYS {
        let Some(v) = o.get(name) else { continue };
        if ["stationName", "mangName", "dataTime"].contains(&name) {
            if let Value::String(s) = v {
                set(&mut row, name, Val::str(s));
            }
        } else if let Some(n) = obs_number(v)
            && (!name.contains("Grade") || ((1. ..=4.).contains(&n) && n.fract() == 0.))
        {
            set(&mut row, name, Val::num(n));
        }
    }
    if !VALUES.iter().any(|k| row.iter().any(|(n, _)| n == k)) {
        return None;
    }
    for p in ["pm10", "pm25"] {
        let grade = format!("{p}Grade");
        if let Some(i) = row.iter().position(|(n, _)| *n == grade) {
            let v = row.remove(i).1;
            set(&mut row, &format!("{p}Grade24"), v);
        }
        let hour = format!("{p}Grade1h");
        if let Some(i) = row.iter().position(|(n, _)| *n == hour) {
            let v = row.remove(i).1;
            set(&mut row, &grade, v);
        }
    }
    Some(row)
}
/// One parsed observation row (`parseRows` output) of a station and data time.
#[derive(Debug, Clone, PartialEq)]
pub struct ObsRow {
    pub station: String,
    pub ms: f64,
    pub fields: Vec<(String, Val)>,
}
/// The `ArpltnKeco` collection in natural order.
#[derive(Debug, Clone, Default)]
pub struct Observations {
    docs: Vec<Doc>,
    index: HashMap<(String, u64), usize>,
}
impl Observations {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    /// One complete observation acquisition (every page's items): [`Self::parse`] then
    /// [`Self::apply_rows`].
    pub fn apply(&mut self, items: &[Value]) {
        let rows = Self::parse(items);
        self.apply_rows(&rows);
    }
    /// Rows with a valid data time parsed as legacy `parseRows` does. A row without a valid
    /// data time is skipped (legacy rejected its province batch); an acquisition without a
    /// usable row yields none (`NO_USABLE_OBSERVATIONS`).
    pub fn parse(items: &[Value]) -> Vec<ObsRow> {
        let mut rows = Vec::new();
        for item in items {
            let Some(o) = item.as_object() else { continue };
            let Some(Value::String(t)) = o.get("dataTime") else {
                continue;
            };
            let ms = kst_instant(t);
            let Some(name) = o
                .get("stationName")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
            else {
                continue;
            };
            if !ms.is_finite() {
                continue;
            }
            if let Some(fields) = parse_row(o, ms) {
                rows.push(ObsRow {
                    station: name.to_owned(),
                    ms,
                    fields,
                });
            }
        }
        rows
    }
    /// `saveRLTMCtprvn`: upsert every row by station and date, in row order.
    pub fn apply_rows(&mut self, rows: &[ObsRow]) {
        for row in rows {
            let key = (row.station.clone(), row.ms.to_bits());
            let found = self.index.get(&key).copied();
            upsert(
                &mut self.docs,
                found,
                &[
                    ("stationName", Val::str(&row.station)),
                    ("date", Val::Date(row.ms)),
                ],
                &row.fields,
            );
            if found.is_none() {
                self.index.insert(key, self.docs.len() - 1);
            }
        }
    }
    /// `Arpltn.find({stationName, date: {$gt: now - 24 h}}, {_id: 0}).sort({date: -1})`.
    pub fn recent(&self, station: &str, now: f64) -> Vec<&Doc> {
        let limit = now - 24. * HOUR_MS;
        let mut rows: Vec<(f64, usize, &Doc)> = self
            .docs
            .iter()
            .enumerate()
            .filter_map(|(i, d)| {
                let Some(Val::Date(ms)) = d.get("date") else {
                    return None;
                };
                (d.get("stationName").and_then(Val::as_str) == Some(station) && *ms > limit)
                    .then_some((*ms, i, d))
            })
            .collect();
        rows.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        rows.into_iter().map(|(_, _, d)| d).collect()
    }
}
/// `src[key] != undefined && src[key] != -1` (a Date compares by its time value).
fn keepable(v: &Val) -> bool {
    !matches!(v, Val::Null)
        && !matches!(v, Val::Num(n) if *n == -1.)
        && !matches!(v, Val::Date(ms) if *ms == -1.)
        && !matches!(v, Val::Str(s) if js_number(&Value::String(s.clone())) == -1.)
}
/// `_mergeArpltnList(arpltnList, currentTime)`.
fn merge(lists: &[Vec<&Doc>], now: f64) -> Option<Doc> {
    const ITEMS: [&str; 7] = ["co", "khai", "no2", "o3", "pm10", "pm25", "so2"];
    let mut out: Option<Doc> = None;
    for list in lists {
        let src = list[0];
        let fresh = src
            .get("dataTime")
            .and_then(Val::as_str)
            .is_some_and(|t| now - 8. * HOUR_MS < kst_instant(t));
        if fresh {
            match out.as_mut() {
                None => {
                    let mut a = Doc::new();
                    for (k, v) in src.entries() {
                        if keepable(v) {
                            a.set(k, v.clone());
                        }
                    }
                    out = Some(a);
                }
                Some(a) => {
                    for name in ITEMS {
                        let value = format!("{name}Value");
                        let missing = a.get(&value).is_none_or(|v| matches!(v, Val::Null));
                        let src_value = src.get(&value);
                        let not_minus_one = !matches!(src_value, Some(Val::Num(n)) if *n == -1.);
                        if missing && not_minus_one {
                            set_js(a, &value, src_value);
                            set_js(a, &format!("{name}Grade"), src.get(&format!("{name}Grade")));
                            set_js(a, &format!("{name}StationName"), src.get("stationName"));
                        }
                    }
                }
            }
        }
        if let Some(a) = &out
            && ITEMS.iter().all(|n| {
                a.get(&format!("{n}Value"))
                    .is_some_and(|v| !matches!(v, Val::Null))
            })
        {
            break;
        }
    }
    out
}
/// `obj[k] = value` where an absent source property is `undefined`, kept in memory as `Null`
/// and dropped from JSON (see [`answer_json`]).
fn set_js(a: &mut Doc, k: &str, v: Option<&Val>) {
    a.set(k, v.cloned().unwrap_or(Val::Null));
}
/// V8 (Node 16) `Array.prototype.sort` for short arrays: TimSort's first run detection and
/// binary insertion sort, which is the whole algorithm below the minimum run length (32).
pub fn v8_sort<T>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> f64) {
    let n = items.len();
    if n < 2 {
        return;
    }
    assert!(n < 64, "short-array sort only");
    // CountAndMakeRun(0, n).
    let mut run = 2;
    let descending = compare(&items[1], &items[0]) < 0.;
    let mut previous = 1;
    for idx in 2..n {
        let order = compare(&items[idx], &items[previous]);
        if (descending && order >= 0.) || (!descending && order < 0.) {
            break;
        }
        previous = idx;
        run += 1;
    }
    if descending {
        items[..run].reverse();
    }
    // BinaryInsertionSort(0, run, n).
    for start in run..n {
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if compare(&items[start], &items[mid]) < 0. {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        items[left..=start].rotate_right(1);
    }
}
/// The station-list comparator of `getArpLtnInfo`.
fn station_order(a: &[&Doc], _: &[&Doc]) -> f64 {
    let first = a[0];
    let undefined = |k: &str| first.get(k).is_none_or(|v| matches!(v, Val::Null));
    if undefined("khaiValue") && undefined("pm10Value") {
        return 1.;
    }
    if first.get("mangName").and_then(Val::as_str) == Some("도시대기") {
        return -1.;
    }
    0.
}
/// `KecoController.getArpLtnInfo(townInfo, now)` over the folded collections:
/// `{arpltn, list, stnList}`; Err when the town has no coordinate (legacy throws).
pub fn arpltn_answer(
    stations: &Stations,
    observations: &Observations,
    g_coord: Option<(f64, f64)>,
    now: f64,
) -> Result<OrderedJson, String> {
    let (lat, lon) = g_coord.ok_or("town without gCoord")?;
    let lists: Vec<Vec<&Doc>> = stations
        .near(lon, lat)
        .into_iter()
        .filter_map(|s| s.get("stationName").and_then(Val::as_str))
        .map(|name| observations.recent(name, now))
        .filter(|rows| !rows.is_empty())
        .collect();
    let merged = merge(&lists, now);
    let mut top: Vec<Vec<&Doc>> = lists.into_iter().take(3).collect();
    v8_sort(&mut top, |a, b| station_order(a, b));
    let rows = |rows: &Vec<&Doc>| OrderedJson::Array(rows.iter().map(|d| d.json()).collect());
    let mut out = Vec::new();
    if let Some(a) = merged {
        out.push(("arpltn", answer_json(&a)));
    }
    if let Some(first) = top.first() {
        out.push(("list", rows(first)));
    }
    out.push((
        "stnList",
        OrderedJson::Array(top.iter().map(rows).collect()),
    ));
    Ok(OrderedJson::Object(
        out.into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    ))
}
/// A merged object as JSON: properties holding `undefined` are dropped.
fn answer_json(d: &Doc) -> OrderedJson {
    OrderedJson::Object(
        d.entries()
            .iter()
            .filter(|(_, v)| !matches!(v, Val::Null))
            .map(|(k, v)| (k.encode_utf16().collect(), v.json()))
            .collect(),
    )
}
/// Whether the `arpltn` of an answer carries a usable value (`_hasAirValue`).
pub fn has_air_value(answer: &OrderedJson) -> bool {
    let Some(a) = answer.get("arpltn") else {
        return false;
    };
    ["pm10", "pm25", "o3", "no2", "co", "so2", "khai"]
        .iter()
        .any(|n| {
            a.get(&format!("{n}Value"))
                .and_then(OrderedJson::number)
                .is_some_and(|v| v.is_finite() && v != -1.)
        })
}

// ---- MinuDustFrcst ----

/// One `MinuDustFrcst` document (the fields the reader and `_checkDataTime` use).
#[derive(Debug, Clone, PartialEq)]
pub struct Forecast {
    pub data_time: Option<String>,
    pub inform_code: Option<String>,
    pub inform_data: Option<String>,
    /// `informGrade` entries `(region, grade)`; a missing grade is None.
    pub grades: Vec<(Option<String>, Option<String>)>,
    /// `imageUrl1..9` (`_parseFrcst`), replaced by a later run as legacy `_saveFrcst` copies
    /// every field but `informGrade` (S15b-3c reads `imageUrl[6]`/`[7]`).
    pub image_urls: Vec<Option<String>>,
}
/// The `MinuDustFrcst` collection in natural order.
#[derive(Debug, Clone, Default)]
pub struct Forecasts {
    docs: Vec<Forecast>,
}
fn opt_str(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_owned)
}
impl Forecasts {
    pub fn docs(&self) -> &[Forecast] {
        &self.docs
    }
    /// One `getMinuDustFrcstDspth` run over the acquisition's items. `expected` is the
    /// announcement `_checkDataTime` chose before the call (`YYYY-MM-DD HH시 발표`): the run is
    /// skipped when it is stored; `_parseFrcst` keeps its items and `_saveFrcst` inserts, or
    /// updates the first document of the same `informData` and `informCode`, merging grades
    /// other than `예보없음` by region.
    pub fn apply(&mut self, expected: &str, items: &[Value]) {
        let expected = expected.to_owned();
        if self
            .docs
            .iter()
            .any(|d| d.data_time.as_deref() == Some(expected.as_str()))
        {
            return;
        }
        let parsed: Vec<Forecast> = items
            .iter()
            .filter_map(Value::as_object)
            .filter(|o| o.get("dataTime").and_then(Value::as_str) == Some(expected.as_str()))
            .map(|o| Forecast {
                data_time: opt_str(o.get("dataTime")),
                inform_code: opt_str(o.get("informCode")),
                inform_data: opt_str(o.get("informData")),
                grades: o
                    .get("informGrade")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .split(',')
                    .map(|g| {
                        let mut parts = g.split(" : ");
                        (
                            parts.next().map(str::to_owned),
                            parts.next().map(str::to_owned),
                        )
                    })
                    .collect(),
                image_urls: (1..=9)
                    .map(|i| opt_str(o.get(&format!("imageUrl{i}"))))
                    .collect(),
            })
            .collect();
        // async.map: every lookup sees the collection before this run's saves.
        let before = self.docs.len();
        for f in parsed {
            let found = self.docs[..before]
                .iter()
                .position(|d| d.inform_data == f.inform_data && d.inform_code == f.inform_code);
            match found {
                None => self.docs.push(f),
                Some(i) => {
                    let d = &mut self.docs[i];
                    d.data_time = f.data_time;
                    d.inform_code = f.inform_code;
                    d.inform_data = f.inform_data;
                    d.image_urls = f.image_urls;
                    for (region, grade) in f.grades {
                        if grade.as_deref() == Some("예보없음") {
                            continue;
                        }
                        match d.grades.iter_mut().find(|(r, _)| *r == region) {
                            Some(slot) => slot.1 = grade,
                            None => d.grades.push((region, grade)),
                        }
                    }
                }
            }
        }
    }
}
/// `_checkDataTime`: the announcement expected at `now` (`YYYY-MM-DD HH시 발표`).
pub fn expected_announcement(now: f64) -> Option<String> {
    announcement_text(crate::domestic::publication::dust_forecast_announcement(
        now as i64,
    )?)
}
/// `YYYY-MM-DD HH시 발표` of an announcement.
pub fn announcement_text(p: crate::domestic::publication::Publication) -> Option<String> {
    let d = p.base_date();
    Some(format!(
        "{}-{}-{} {:02}시 발표",
        &d[..4],
        &d[4..6],
        &d[6..],
        p.hour()
    ))
}
/// `keco.convertRegionToSido(regionName)`.
pub fn region_to_sido(region: &str) -> &'static str {
    match region {
        "강원도" | "강원" => "강원",
        "서울특별시" | "서울시" | "서울" => "서울",
        "경기도" | "경기" => "경기",
        "경상남도" | "경남" => "경남",
        "경상북도" | "경북" => "경북",
        "광주광역시" | "광주시" | "광주" => "광주",
        "대구광역시" | "대구시" | "대구" => "대구",
        "대전광역시" | "대전시" | "대전" => "대전",
        "부산광역시" | "부산시" | "부산" => "부산",
        "울산광역시" | "울산시" | "울산" => "울산",
        "충청북도" | "충북" => "충북",
        "충청남도" | "충남" => "충남",
        "인천광역시" | "인천시" | "인천" => "인천",
        "전라남도" | "전남" => "전남",
        "전라북도" | "전북" => "전북",
        "제주특별자치도" | "제주도" | "제주" => "제주",
        "세종특별자치시" | "세종시" | "세종" => "세종",
        _ => "",
    }
}
/// `_convertDustFrcstRegion(region, city)` over `manager.codeTable` (`region.csv`).
pub fn dust_region(region: &str, city: &str) -> String {
    let sido = region_to_sido(region);
    if sido != "강원" && sido != "경기" {
        return sido.into();
    }
    let u: Vec<u16> = city.encode_utf16().collect();
    let city = String::from_utf16_lossy(&u[..u.len().min(3)]);
    let name = super::region_table()
        .iter()
        .find(|r| r.first == region && r.second == city)
        .map(|r| r.region_name.as_str());
    match name {
        Some("강원동부") => "영동".into(),
        Some("강원서부" | "강원남서") => "영서".into(),
        Some("경기북부") => "경기북부".into(),
        Some("경기서부" | "경기남부") => "경기남부".into(),
        _ => sido.into(),
    }
}
/// `_convertDustForecastStrToGrade(str)`; an unknown text is `""`.
fn grade_of(s: Option<&str>) -> Val {
    match s {
        Some("좋음") => Val::num(0.),
        Some("보통") => Val::num(1.),
        Some("나쁨") => Val::num(2.),
        Some("매우나쁨") => Val::num(3.),
        _ => Val::str(""),
    }
}
/// `KecoController.getDustFrcst({region, city}, date)`: the per-day forecast list, or the
/// legacy error text.
pub fn dust_answer(
    forecasts: &Forecasts,
    region: &str,
    city: &str,
    date: &str,
) -> Result<OrderedJson, String> {
    let sido = dust_region(region, city);
    let u: Vec<u16> = date.encode_utf16().collect();
    let sub =
        |a: usize, n: usize| String::from_utf16_lossy(&u[a.min(u.len())..(a + n).min(u.len())]);
    let inform_date = format!("{}-{}-{}", sub(0, 4), sub(4, 2), sub(6, 2));
    let docs: Vec<&Forecast> = forecasts
        .docs
        .iter()
        .filter(|d| d.inform_data.as_deref().is_some_and(|x| *x >= *inform_date))
        .collect();
    if docs.is_empty() {
        return Err(format!(
            "Fail to find dust forecast {{\"informData\":{{\"$gte\":{}}}}}",
            serde_json::Value::String(inform_date)
        ));
    }
    let mut results: Vec<(String, Doc)> = Vec::new();
    for d in docs {
        let Some((_, grade)) = d
            .grades
            .iter()
            .find(|(r, _)| r.as_deref() == Some(sido.as_str()))
        else {
            continue;
        };
        if grade.as_deref() == Some("예보없음") {
            continue;
        }
        let data = d.inform_data.clone().unwrap_or_default();
        let du: Vec<u16> = data.encode_utf16().collect();
        let part = |a: usize, n: usize| {
            String::from_utf16_lossy(&du[a.min(du.len())..(a + n).min(du.len())])
        };
        let key = format!("{}{}{}", part(0, 4), part(5, 2), part(8, 2));
        let slot = match results.iter().position(|(k, _)| *k == key) {
            Some(i) => i,
            None => {
                results.push((key.clone(), Doc::new().with("sido", Val::str(&sido))));
                results.len() - 1
            }
        };
        let code = d.inform_code.clone().unwrap_or_else(|| "undefined".into());
        let f = &mut results[slot].1;
        f.set(&format!("{code}Grade"), grade_of(grade.as_deref()));
        f.set(
            &format!("{code}Str"),
            grade.as_deref().map_or(Val::Null, Val::str),
        );
    }
    if results.is_empty() {
        return Err(format!(
            "dust forecast length is zero region:{sido} informDate:{inform_date}"
        ));
    }
    Ok(OrderedJson::Array(
        results
            .into_iter()
            .map(|(date, f)| {
                OrderedJson::Object(vec![
                    (
                        "date".encode_utf16().collect(),
                        OrderedJson::String(date.encode_utf16().collect()),
                    ),
                    ("dustForecast".encode_utf16().collect(), answer_json(&f)),
                ])
            })
            .collect(),
    ))
}

// ---- air provider fallback ----

/// `observation.evaluate(observation, gCoord, requestTime).arpltn` of a usable observation.
pub fn fallback_arpltn(o: &crate::world::air::Observation) -> Option<OrderedJson> {
    let observed = o
        .observed_at
        .as_deref()
        .map(crate::world::air::parse_iso_offset)
        .filter(|m| m.is_finite())?;
    let p = crate::world::js::parts(observed + 9. * HOUR_MS)?;
    let mut out: Vec<(&str, OrderedJson)> = vec![("source", js_str(&o.provider))];
    if let Some(name) = &o.station_name {
        out.push(("stationName", js_str(name)));
    }
    out.push((
        "dataTime",
        js_str(&format!(
            "{:04}-{:02}-{:02} {:02}:{:02}",
            p.year, p.month, p.day, p.hour, p.minute
        )),
    ));
    if let Some(t) = o.attribution.str().map(str::trim).filter(|t| !t.is_empty()) {
        out.push(("attribution", js_str(t)));
    }
    let mut pm = false;
    for code in crate::world::air::POLLUTANTS {
        if let Some((_, v)) = o.pollutants.iter().find(|(c, _)| *c == code)
            && v.is_finite()
            && *v >= 0.
        {
            pm |= code == "pm10" || code == "pm25";
            out.push((
                match code {
                    "pm10" => "pm10Value",
                    "pm25" => "pm25Value",
                    "o3" => "o3Value",
                    "no2" => "no2Value",
                    "so2" => "so2Value",
                    _ => "coValue",
                },
                OrderedJson::Number(*v),
            ));
        }
    }
    pm.then(|| {
        OrderedJson::Object(
            out.into_iter()
                .map(|(k, v)| (k.encode_utf16().collect(), v))
                .collect(),
        )
    })
}
fn js_str(s: &str) -> OrderedJson {
    OrderedJson::String(s.encode_utf16().collect())
}
