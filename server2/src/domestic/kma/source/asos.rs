//! The legacy `asos_history` collection rebuilt from server2's ASOS raw records (S15b-2), with
//! the rules of `server/lib/history/{recovery,policy,store}.js` (#2564/#2648):
//! - a recovery run computes, per kind, the window keys whose stored row is not complete
//!   (`policy.complete`) and requests each contiguous run of them (`policy.ranges`);
//! - each fetched item is normalized (`policy.normalize`: station, `tm` form, allowed keys, QC
//!   flags, the November–March hourly rain exclusion, cloud amount to sky) and the first item of
//!   a key wins (`seen`);
//! - `Store.save` inserts the identity once and sets each valid value field only while it is
//!   absent, so the first valid value of a field is kept.
//!
//! An acquisition's allowed keys are the range keys that were not complete when it was made;
//! folding acquisitions in fetch order over the same store state reproduces that set.
use super::doc::{Doc, Val};
use crate::domestic::asos::{AsosKind, number};
use crate::domestic::kma::js::V;
use crate::domestic::kma::policy;
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Arc;

/// One complete ASOS acquisition of a station range.
#[derive(Debug, Clone)]
pub struct AsosFetched {
    pub kind: AsosKind,
    /// Inclusive range keys (`YYYYMMDDHH00` or `YYYYMMDD`).
    pub start: String,
    pub end: String,
    pub fetched_at_ms: f64,
    pub pages: Vec<Arc<[u8]>>,
}
/// Items of all pages in page order; None when a page is not a data.go.kr JSON envelope.
pub fn page_items(pages: &[Arc<[u8]>]) -> Option<Vec<Value>> {
    let mut out = Vec::new();
    for page in pages {
        let json: Value = serde_json::from_slice(page).ok()?;
        let items = json
            .get("response")?
            .get("body")?
            .get("items")
            .and_then(|i| i.get("item"));
        match items {
            Some(Value::Array(a)) => out.extend(a.iter().cloned()),
            Some(v @ Value::Object(_)) => out.push(v.clone()),
            _ => {}
        }
    }
    Some(out)
}
fn valid(field: &str, n: f64) -> bool {
    policy::valid(field, &V::Num(n))
}
fn kind_name(kind: AsosKind) -> &'static str {
    kind.name()
}
/// `policy.range(kind, start, end)` over KST dates.
pub fn range(kind: AsosKind, start_date: &str, end_date: &str) -> Vec<String> {
    policy::range(kind == AsosKind::Daily, start_date, end_date)
}
/// Keys from `start` through `end` inclusive (hourly or daily steps).
fn keys_between(kind: AsosKind, start: &str, end: &str) -> Vec<String> {
    let (a, b) = (policy::instant(&V::s(start)), policy::instant(&V::s(end)));
    let step = match kind {
        AsosKind::Hourly => 3_600_000.,
        AsosKind::Daily => 86_400_000.,
    };
    let mut out = Vec::new();
    let mut t = a;
    while t.is_finite() && b.is_finite() && t <= b {
        if let Some(k) = policy::key(t, kind == AsosKind::Daily) {
            out.push(k);
        }
        t += step;
    }
    out
}
/// `policy.ranges(kind, keys)`: contiguous runs of sorted keys.
pub fn ranges(kind: AsosKind, keys: &[String]) -> Vec<(String, String)> {
    let step = match kind {
        AsosKind::Hourly => 3_600_000.,
        AsosKind::Daily => 86_400_000.,
    };
    let mut sorted = keys.to_vec();
    sorted.sort();
    let mut out: Vec<(String, String)> = Vec::new();
    for k in sorted {
        match out.last_mut() {
            Some(last) if policy::instant(&V::s(&k)) - policy::instant(&V::s(&last.1)) == step => {
                last.1 = k
            }
            _ => out.push((k.clone(), k)),
        }
    }
    out
}
fn flag_set(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty() && s != "0",
        Some(Value::Number(n)) => n.as_f64() != Some(0.),
        Some(Value::Bool(b)) => {
            let _ = b;
            true
        }
        Some(_) => true,
    }
}
/// `policy.normalize(kind, item, station, allowed, now)`: (key, values) or None.
pub fn normalize(
    kind: AsosKind,
    item: &Value,
    station: &str,
    allowed: &BTreeSet<String>,
) -> Option<(String, Doc)> {
    if !item.is_object() {
        return None;
    }
    let stn = match item.get("stnId") {
        Some(Value::String(s)) => policy::station(&V::s(s)),
        Some(Value::Number(n)) => policy::station(&V::Num(n.as_f64()?)),
        _ => None,
    };
    if stn.as_deref() != Some(station) {
        return None;
    }
    let tm = item.get("tm")?.as_str()?;
    let key = tm_key(kind, tm)?;
    if !policy::instant(&V::s(&key)).is_finite() || !allowed.contains(&key) {
        return None;
    }
    let mappings: &[(&str, &str)] = match kind {
        AsosKind::Hourly => &[
            ("ta", "t1h"),
            ("hm", "reh"),
            ("rn", "rn1"),
            ("ws", "wsd"),
            ("wd", "vec"),
        ],
        AsosKind::Daily => &[
            ("minTa", "taMin"),
            ("maxTa", "taMax"),
            ("avgTa", "t1d"),
            ("avgRhm", "reh"),
            ("sumRn", "rn1"),
            ("avgWs", "wsd"),
        ],
    };
    let month: u32 = key[4..6].parse().ok()?;
    let mut values = Doc::new();
    for (source, field) in mappings {
        if kind == AsosKind::Hourly && *source == "rn" && (month <= 3 || month >= 11) {
            continue;
        }
        if kind == AsosKind::Hourly
            && (flag_set(item.get(format!("{source}Qcflag").as_str()))
                || flag_set(item.get(format!("{source}Qcflg").as_str())))
        {
            continue;
        }
        if let Some(n) = number(item.get(*source))
            && valid(field, n)
        {
            values.set(field, Val::num(n));
        }
    }
    if kind == AsosKind::Hourly
        && let Some(cloud) = number(item.get("dc10Tca"))
        && (0. ..=10.).contains(&cloud)
    {
        let sky = if cloud <= 2. {
            1.
        } else if cloud <= 5. {
            2.
        } else if cloud <= 8. {
            3.
        } else {
            4.
        };
        values.set("sky", Val::num(sky));
    }
    if kind == AsosKind::Daily
        && let (Some(Val::Num(lo)), Some(Val::Num(hi))) = (values.get("taMin"), values.get("taMax"))
        && lo > hi
    {
        return None;
    }
    if values.entries().is_empty() {
        return None;
    }
    Some((key, values))
}
fn tm_key(kind: AsosKind, tm: &str) -> Option<String> {
    let b = tm.as_bytes();
    let d = |r: std::ops::Range<usize>| {
        b.get(r.clone())
            .filter(|x| x.iter().all(u8::is_ascii_digit))
            .map(|_| &tm[r])
    };
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let date = format!("{}{}{}", d(0..4)?, d(5..7)?, d(8..10)?);
    match kind {
        AsosKind::Daily => (b.len() == 10).then_some(date),
        AsosKind::Hourly => {
            if b.len() < 13 || b[10] != b' ' {
                return None;
            }
            let hour = d(11..13)?;
            match &tm[13..] {
                "" | ":00" => Some(format!("{date}{hour}00")),
                _ => None,
            }
        }
    }
}

/// The `asos_history` documents of one station.
#[derive(Debug, Clone, Default)]
pub struct AsosStore {
    docs: Vec<Doc>,
}
fn id(kind: AsosKind, station: &str, key: &str) -> String {
    format!("{}:{station}:{key}", kind_name(kind))
}
impl AsosStore {
    /// Documents ordered by `_id` (the collection dump).
    pub fn docs(&self) -> Vec<Doc> {
        let mut out = self.docs.clone();
        out.sort_by_key(|a| text(a, "_id"));
        out
    }
    fn find(&self, id: &str) -> Option<usize> {
        self.docs.iter().position(|d| text(d, "_id") == id)
    }
    /// `Store.read(kind, station, start, end)`: `_id` range, sorted by `key`.
    pub fn read(&self, kind: AsosKind, station: &str, start: &str, end: &str) -> Vec<Doc> {
        let (lo, hi) = (id(kind, station, start), id(kind, station, end));
        let mut out: Vec<Doc> = self
            .docs
            .iter()
            .filter(|d| {
                let i = text(d, "_id");
                i.as_str() >= lo.as_str() && i.as_str() <= hi.as_str()
            })
            .cloned()
            .collect();
        out.sort_by_key(|a| text(a, "key"));
        out
    }
    fn complete(doc: &Doc, kind: AsosKind) -> bool {
        let values = doc.get("values").and_then(Val::as_doc);
        let f = |k: &str| values.and_then(|v| v.get(k)).and_then(Val::as_num);
        match kind {
            AsosKind::Hourly => {
                f("t1h").is_some_and(|n| valid("t1h", n))
                    && f("reh").is_some_and(|n| valid("reh", n))
            }
            AsosKind::Daily => match (f("taMin"), f("taMax")) {
                (Some(lo), Some(hi)) => valid("taMin", lo) && valid("taMax", hi) && lo <= hi,
                _ => false,
            },
        }
    }
    /// Window keys of `kind` whose stored row is not complete.
    pub fn missing(&self, kind: AsosKind, station: &str, expected: &[String]) -> Vec<String> {
        let (Some(first), Some(last)) = (expected.first(), expected.last()) else {
            return Vec::new();
        };
        let complete: BTreeSet<String> = self
            .read(kind, station, first, last)
            .iter()
            .filter(|d| Self::complete(d, kind))
            .map(|d| text(d, "key"))
            .collect();
        expected
            .iter()
            .filter(|k| !complete.contains(*k))
            .cloned()
            .collect()
    }
    /// The ranges a legacy `Recovery.run(station, start, end)` requests now: hourly runs, then
    /// daily runs.
    pub fn plan(
        &self,
        station: &str,
        start_date: &str,
        end_date: &str,
    ) -> Vec<(AsosKind, String, String)> {
        let mut out = Vec::new();
        for kind in [AsosKind::Hourly, AsosKind::Daily] {
            let expected = range(kind, start_date, end_date);
            let missing = self.missing(kind, station, &expected);
            for (a, b) in ranges(kind, &missing) {
                out.push((kind, a, b));
            }
        }
        out
    }
    /// Apply one acquisition as the recovery that made it (fetch order).
    pub fn apply(&mut self, station: &str, f: &AsosFetched) {
        let Some(items) = page_items(&f.pages) else {
            return;
        };
        let range_keys = keys_between(f.kind, &f.start, &f.end);
        let allowed: BTreeSet<String> = self
            .missing(f.kind, station, &range_keys)
            .into_iter()
            .collect();
        let mut seen = BTreeSet::new();
        for item in &items {
            let Some((key, values)) = normalize(f.kind, item, station, &allowed) else {
                continue;
            };
            if !seen.insert(key.clone()) {
                continue;
            }
            self.save(f.kind, station, &key, &values, f.fetched_at_ms);
        }
    }
    /// The station's row of a nationwide AWS hourly page (ongoing hours; AK 2026-10-15: the
    /// page carries the ASOS stations). Applied like a one-key recovery: only while the hour is
    /// not complete, with the hourly ASOS field mapping (`t1h`, `reh`, `rs1h` as `rn1` outside
    /// November–March, `wsd`, `vec`). The document records `origin` so it is distinguishable
    /// from a data.go.kr row; the merge reads it as an ASOS hourly record.
    pub fn apply_national(&mut self, station: &str, row: &Doc, fetched_at: f64) {
        let Some(Val::Date(ms)) = row.get("date") else {
            return;
        };
        // Station rows store the KST wall clock in UTC fields.
        let Some(iso) = crate::world::js::iso(*ms) else {
            return;
        };
        if &iso[14..] != "00:00.000Z" {
            return;
        }
        let key = iso[..16].replace(['-', 'T', ':'], "");
        if !policy::instant(&V::s(&key)).is_finite()
            || !self
                .missing(AsosKind::Hourly, station, std::slice::from_ref(&key))
                .contains(&key)
        {
            return;
        }
        let month: u32 = key[4..6].parse().unwrap_or(0);
        let mut values = Doc::new();
        for (source, field) in [
            ("t1h", "t1h"),
            ("reh", "reh"),
            ("rs1h", "rn1"),
            ("wsd", "wsd"),
            ("vec", "vec"),
        ] {
            if source == "rs1h" && (month <= 3 || month >= 11) {
                continue;
            }
            if let Some(Val::Num(n)) = row.get(source)
                && valid(field, *n)
            {
                values.set(field, Val::num(*n));
            }
        }
        if values.entries().is_empty() {
            return;
        }
        let new = self.find(&id(AsosKind::Hourly, station, &key)).is_none();
        self.save(AsosKind::Hourly, station, &key, &values, fetched_at);
        if new && let Some(i) = self.find(&id(AsosKind::Hourly, station, &key)) {
            let doc = &mut self.docs[i];
            let values = doc.get("values").cloned().unwrap_or(Val::Doc(Doc::new()));
            doc.remove("values");
            doc.set("origin", Val::str("KMA_AWS_HOURLY_PAGE"));
            doc.set("values", values);
        }
    }
    /// `Store.save(row)`.
    fn save(&mut self, kind: AsosKind, station: &str, key: &str, values: &Doc, fetched_at: f64) {
        let _id = id(kind, station, key);
        let at = match self.find(&_id) {
            Some(i) => i,
            None => {
                let instant = policy::instant(&V::s(key));
                self.docs.push(
                    Doc::new()
                        .with("_id", Val::str(&_id))
                        .with("kind", Val::str(kind_name(kind)))
                        .with("stationId", Val::str(station))
                        .with("key", Val::str(key))
                        .with("date", Val::Date(instant))
                        .with("kstDate", Val::str(&key[..8]))
                        .with("timeBasis", Val::str("UTC"))
                        .with("source", Val::str("KMA_ASOS"))
                        .with("fetchedAt", Val::Date(fetched_at))
                        .with("values", Val::Doc(Doc::new())),
                );
                self.docs.len() - 1
            }
        };
        let doc = &mut self.docs[at];
        let mut stored = doc
            .get("values")
            .and_then(Val::as_doc)
            .cloned()
            .unwrap_or_default();
        for (field, v) in values.entries() {
            let Some(n) = v.as_num() else { continue };
            if valid(field, n) && !stored.has(field) {
                stored.set(field, Val::num(n));
            }
        }
        doc.set("values", Val::Doc(stored));
    }
}
fn text(d: &Doc, k: &str) -> String {
    d.get(k)
        .and_then(Val::as_str)
        .unwrap_or_default()
        .to_owned()
}
