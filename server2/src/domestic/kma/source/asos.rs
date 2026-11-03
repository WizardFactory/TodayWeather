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
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

mod phenomena;

/// One complete ASOS acquisition of a station range.
#[derive(Debug, Clone)]
pub struct AsosFetched {
    /// Full canonical RawId object keys in page order; never a durability receipt.
    pub raw_ids: Vec<String>,
    pub kind: AsosKind,
    /// Inclusive range keys (`YYYYMMDDHH00` or `YYYYMMDD`).
    pub start: String,
    pub end: String,
    pub fetched_at_ms: f64,
    pub pages: Vec<Arc<[u8]>>,
}
impl AsosFetched {
    pub fn same_original(&self, other: &Self) -> bool {
        if !self.raw_ids.is_empty() && !other.raw_ids.is_empty() {
            return self.raw_ids == other.raw_ids;
        }
        // Synthetic fixtures have no S06 envelope. Compare all available identity data.
        self.kind == other.kind
            && self.start == other.start
            && self.end == other.end
            && self.fetched_at_ms == other.fetched_at_ms
            && self.pages == other.pages
    }
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
fn normalize_legacy(
    kind: AsosKind,
    item: &Value,
    station: &str,
    allowed: &BTreeSet<String>,
) -> Option<(String, Doc)> {
    let (key, values) = normalize_fields(kind, item, station, allowed)?;
    (!values.entries().is_empty()).then_some((key, values))
}
/// The identity checks and field mappings of `policy.normalize`, before its empty-row rejection.
fn normalize_fields(
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
    Some((key, values))
}

/// Observed-history normalization. KMA ASOS answers 66383/29442 distinguish a
/// blank rain report (no precipitation) from numeric zero (trace precipitation).
/// Answer 30942 identifies blank QC as normal. These rules do not apply to
/// minute observations, missing fields, JSON null, bad QC or winter off-cycle
/// reports. The original response bytes are retained without normalization.
/// Winter cadence: data.kma.go.kr/data/grnd/selectAsosList.do?pgmNo=36.
pub fn normalize(
    kind: AsosKind,
    item: &Value,
    station: &str,
    allowed: &BTreeSet<String>,
) -> Option<(String, Doc)> {
    let (key, mut values) = normalize_fields(kind, item, station, allowed)?;
    // A blank rain report means dry only beside another valid measurement. A numeric amount or a
    // phenomenon code stands on its own.
    let measured = !values.entries().is_empty();
    let month: u32 = key[4..6].parse().ok()?;
    let winter = month <= 3 || month >= 11;
    let rain_field = match kind {
        AsosKind::Hourly => "rn",
        AsosKind::Daily => "sumRn",
    };
    let rain_quality = !flag_set(item.get(format!("{rain_field}Qcflag").as_str()))
        && !flag_set(item.get(format!("{rain_field}Qcflg").as_str()));
    let reported_blank = item.get(rain_field).and_then(Value::as_str) == Some("");
    let phenomenon = item.get("dmstMtphNo").and_then(Value::as_str);
    let pty = phenomenon.and_then(phenomena::precipitation);
    // A nonempty unsupported code, or an explicit wet code, cannot be replaced
    // with no-event just because the rain field is blank.
    let compatible = phenomenon.is_none_or(|raw| raw.is_empty() || pty == Some(0.));
    let reporting_time =
        kind == AsosKind::Daily || !winter || key[8..10].parse::<u16>().ok()?.is_multiple_of(3);
    // Daily rows have no native rain QC. Require an explicitly empty event log
    // and no conflicting duration, in addition to another normalized measurement.
    let daily_clear = kind != AsosKind::Daily
        || (item.get("iscs").and_then(Value::as_str) == Some("")
            && match item.get("sumRnDur") {
                None => true,
                Some(Value::String(s)) if s.is_empty() => true,
                value => number(value) == Some(0.),
            });
    let no_precipitation =
        measured && reported_blank && rain_quality && reporting_time && compatible && daily_clear;
    if no_precipitation {
        let field = if kind == AsosKind::Hourly && winter {
            "rn3h"
        } else {
            "rn1"
        };
        values.set(field, Val::num(0.));
    }
    if kind == AsosKind::Hourly
        && winter
        && key[8..10].parse::<u16>().ok()?.is_multiple_of(3)
        && rain_quality
        && let Some(n) = number(item.get("rn"))
        && valid("rn3h", n)
    {
        // KMA's winter quantity is a three-hour accumulation, never an hourly amount.
        values.set("rn3h", Val::num(n));
    }
    if kind == AsosKind::Hourly {
        // A valid numeric report, including trace zero, means precipitation
        // occurred. This also covers winter quantities without calling them hourly.
        let reported_precipitation =
            rain_quality && number(item.get("rn")).is_some_and(|n| valid("rn1", n));
        if let Some(pty) = pty.or_else(|| no_precipitation.then_some(0.))
            && !(pty == 0. && reported_precipitation)
        {
            values.set("pty", Val::num(pty));
        }
    }
    (!values.entries().is_empty()).then_some((key, values))
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
    observed: bool,
    provided: BTreeSet<String>,
    /// Hours any acquisition reported with a normal-QC numeric amount, trace included.
    reported_rain: BTreeSet<String>,
}
fn id(kind: AsosKind, station: &str, key: &str) -> String {
    format!("{}:{station}:{key}", kind_name(kind))
}
impl AsosStore {
    /// The approved measured-history parser; default retains frozen legacy replay.
    pub fn observed() -> Self {
        Self {
            observed: true,
            ..Self::default()
        }
    }
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
    fn complete(&self, doc: &Doc, kind: AsosKind) -> bool {
        let values = doc.get("values").and_then(Val::as_doc);
        let f = |k: &str| values.and_then(|v| v.get(k)).and_then(Val::as_num);
        let basic = match kind {
            AsosKind::Hourly => {
                f("t1h").is_some_and(|n| valid("t1h", n))
                    && f("reh").is_some_and(|n| valid("reh", n))
            }
            AsosKind::Daily => match (f("taMin"), f("taMax")) {
                (Some(lo), Some(hi)) => valid("taMin", lo) && valid("taMax", hi) && lo <= hi,
                _ => false,
            },
        };
        basic
            && (!self.observed
                || match kind {
                    AsosKind::Hourly => {
                        let key = text(doc, "key");
                        let winter = key
                            .get(4..6)
                            .and_then(|m| m.parse::<u32>().ok())
                            .is_some_and(|m| m <= 3 || m >= 11);
                        let rainfall = if winter {
                            !key.get(8..10)
                                .and_then(|h| h.parse::<u16>().ok())
                                .is_some_and(|h| h.is_multiple_of(3))
                                || f("rn3h").is_some_and(|n| valid("rn3h", n))
                        } else {
                            f("rn1").is_some_and(|n| valid("rn1", n))
                        };
                        ["sky", "pty"]
                            .iter()
                            .all(|k| f(k).is_some_and(|n| valid(k, n)))
                            && rainfall
                    }
                    AsosKind::Daily => f("rn1").is_some_and(|n| valid("rn1", n)),
                })
    }
    /// Window keys of `kind` whose stored row is not complete.
    pub fn missing(&self, kind: AsosKind, station: &str, expected: &[String]) -> Vec<String> {
        let (Some(first), Some(last)) = (expected.first(), expected.last()) else {
            return Vec::new();
        };
        let complete: BTreeSet<String> = self
            .read(kind, station, first, last)
            .iter()
            .filter(|d| self.complete(d, kind))
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
            let missing = if self.observed {
                expected
                    .iter()
                    .filter(|key| !self.provided.contains(&id(kind, station, key)))
                    .cloned()
                    .collect()
            } else {
                self.missing(kind, station, &expected)
            };
            if self.observed {
                // A full 7-day range fits one normal page. A field gap must not
                // explode a cold request into one provider call per missing hour.
                if !missing.is_empty()
                    && let (Some(a), Some(b)) = (missing.first(), missing.last())
                {
                    out.push((kind, a.clone(), b.clone()));
                }
                continue;
            }
            for (a, b) in ranges(kind, &missing) {
                out.push((kind, a, b));
            }
        }
        out
    }
    /// Apply one acquisition as the recovery that made it (fetch order).
    pub fn apply(&mut self, station: &str, f: &AsosFetched) {
        let allowed = self.allowed(station, f);
        self.apply_allowed(station, f, &allowed);
    }
    /// The keys of `f`'s range that are not complete in this store (legacy `allowed`).
    pub fn allowed(&self, station: &str, f: &AsosFetched) -> BTreeSet<String> {
        let range_keys = keys_between(f.kind, &f.start, &f.end);
        self.missing(f.kind, station, &range_keys)
            .into_iter()
            .collect()
    }
    /// Apply one acquisition with a given `allowed` key set.
    pub fn apply_allowed(&mut self, station: &str, f: &AsosFetched, allowed: &BTreeSet<String>) {
        let Some(items) = page_items(&f.pages) else {
            return;
        };
        let mut seen = BTreeSet::new();
        let covered: BTreeSet<_> = if self.observed {
            keys_between(f.kind, &f.start, &f.end).into_iter().collect()
        } else {
            BTreeSet::new()
        };
        for item in &items {
            // Acquisition coverage is distinct from known numeric fields. A complete
            // provider row with an optional blank/QC failure is not a reason to refetch
            // the same released range forever; completeness still reports the gap.
            let station_matches = match item.get("stnId") {
                Some(Value::String(s)) => policy::station(&V::s(s)),
                Some(Value::Number(n)) => n.as_f64().and_then(|v| policy::station(&V::Num(v))),
                _ => None,
            }
            .as_deref()
                == Some(station);
            if self.observed
                && station_matches
                && let Some(key) = item
                    .get("tm")
                    .and_then(Value::as_str)
                    .and_then(|tm| tm_key(f.kind, tm))
                && covered.contains(&key)
            {
                self.provided.insert(id(f.kind, station, &key));
                if f.kind == AsosKind::Hourly && reports_rain(item) {
                    self.reported_rain.insert(id(f.kind, station, &key));
                }
            }

            let normalizer = if self.observed {
                normalize
            } else {
                normalize_legacy
            };
            let Some((key, values)) = normalizer(f.kind, item, station, allowed) else {
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

/// A station's `asos_history` rows from its data.go.kr acquisitions and its ongoing-hour AWS page
/// rows, applied in fetch order. A range's `allowed` keys are the keys no earlier data.go.kr
/// acquisition completed: legacy `Recovery.run` plans from the store before it fetches, and runs
/// are serialized per station, so that is the plan-time set whatever ongoing page rows arrived in
/// between (their fields stay as earlier values; the range still adds the fields they lack).
pub fn replay(station: &str, fetched: &[AsosFetched], national: &[(f64, Doc)]) -> AsosStore {
    replay_with_policy(station, fetched, national, false)
}
/// Replay original raw with the measured-history field contract.
pub fn replay_observed(
    station: &str,
    fetched: &[AsosFetched],
    national: &[(f64, Doc)],
) -> AsosStore {
    replay_with_policy(station, fetched, national, true)
}
fn replay_with_policy(
    station: &str,
    fetched: &[AsosFetched],
    national: &[(f64, Doc)],
    observed: bool,
) -> AsosStore {
    enum Event<'a> {
        Range(&'a AsosFetched),
        Page(&'a Doc),
    }
    let mut events: Vec<(f64, Event)> = fetched
        .iter()
        .map(|f| (f.fetched_at_ms, Event::Range(f)))
        .collect();
    events.extend(national.iter().map(|(at, r)| (*at, Event::Page(r))));
    events.sort_by(|a, b| a.0.total_cmp(&b.0));
    let new_store = || {
        if observed {
            AsosStore::observed()
        } else {
            AsosStore::default()
        }
    };
    let mut store = new_store();
    let mut ranges_only = new_store();
    for (at, e) in events {
        match e {
            Event::Range(f) => {
                let allowed = ranges_only.allowed(station, f);
                ranges_only.apply_allowed(station, f, &allowed);
                store.apply_allowed(station, f, &allowed);
            }
            Event::Page(r) => store.apply_national(station, r, at),
        }
    }
    if observed {
        let hourly = latest_items(station, fetched, AsosKind::Hourly);
        let daily = latest_items(station, fetched, AsosKind::Daily);
        store.clear_contradicted_dry_types();
        store.close_dry_days(station, &hourly, &daily);
        store.type_warm_rain(station, &hourly);
        if super::representative::wind_unrepresentative(station) {
            store.drop_wind();
        }
    }
    store
}

/// The latest original item of each key for one kind, in fetch order; within one
/// acquisition the first item of a key wins, as in `apply_allowed`.
fn latest_items(station: &str, fetched: &[AsosFetched], kind: AsosKind) -> BTreeMap<String, Value> {
    let mut ordered: Vec<&AsosFetched> = fetched.iter().filter(|f| f.kind == kind).collect();
    ordered.sort_by(|a, b| a.fetched_at_ms.total_cmp(&b.fetched_at_ms));
    let mut out = BTreeMap::new();
    for f in ordered {
        let mut seen = BTreeSet::new();
        for item in page_items(&f.pages).unwrap_or_default() {
            let stn = match item.get("stnId") {
                Some(Value::String(s)) => policy::station(&V::s(s)),
                Some(Value::Number(n)) => n.as_f64().and_then(|v| policy::station(&V::Num(v))),
                _ => None,
            };
            let Some(key) = item
                .get("tm")
                .and_then(Value::as_str)
                .and_then(|tm| tm_key(kind, tm))
            else {
                continue;
            };
            if stn.as_deref() == Some(station) && seen.insert(key.clone()) {
                out.insert(key, item);
            }
        }
    }
    out
}
/// A normal-QC numeric hourly amount, trace included.
fn reports_rain(item: &Value) -> bool {
    !flag_set(item.get("rnQcflag"))
        && !flag_set(item.get("rnQcflg"))
        && number(item.get("rn")).is_some_and(|n| valid("rn1", n))
}
/// No phenomenon was recorded for the hour.
fn uncoded(item: &Value) -> bool {
    match item.get("dmstMtphNo") {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(_) => false,
    }
}
/// A phenomenon field that reports no precipitation: blank, or only non-precipitation codes.
fn code_dry(item: &Value) -> bool {
    uncoded(item)
        || item
            .get("dmstMtphNo")
            .and_then(Value::as_str)
            .and_then(phenomena::precipitation)
            == Some(0.)
}
/// April–October by a `YYYYMMDD...` key; November–March rain is a three-hour quantity.
fn warm_season(key: &str) -> bool {
    key.get(4..6)
        .and_then(|m| m.parse::<u32>().ok())
        .is_some_and(|m| (4..=10).contains(&m))
}
/// Wet-bulb temperature from air temperature and relative humidity (Stull 2011), with humidity
/// at most 99 % as in the held-out validation of `wet-bulb-rain-v1`.
fn wet_bulb(t: f64, humidity: f64) -> f64 {
    let rh = humidity.min(99.);
    t * (0.151977 * (rh + 8.313659).sqrt()).atan() + (t + rh).atan() - (rh - 1.676331).atan()
        + 0.00391838 * rh.powf(1.5) * (0.023101 * rh).atan()
        - 4.686035
}
fn blank(item: &Value, field: &str) -> bool {
    match item.get(field) {
        None => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(_) => false,
    }
}
impl AsosStore {
    /// `qc9-closure-dry` (R1b) and `dry-daily-total` (D1) of `kma-history.v1`, approved by AK
    /// on 2026-10-31 after held-out validation
    /// (docs/evidence/research/kma-history-gap-options-2026-10-30.md). One observation day is
    /// 01:00..24:00 KST. Its 24 latest hourly originals close against the official daily total
    /// when their numeric amounts (any QC) sum to `sumRn`, or when `sumRn` is blank and no hour
    /// is numeric. Then an April–October blank QC9 hour without a precipitation code is dry, and
    /// a blank `sumRn` without numeric or coded hourly precipitation and without a rain duration
    /// is 0 mm. A day whose stored rain fields differ from what its latest originals give is
    /// skipped. Only absent fields are filled.
    fn close_dry_days(
        &mut self,
        station: &str,
        hourly: &BTreeMap<String, Value>,
        daily: &BTreeMap<String, Value>,
    ) {
        let all: BTreeSet<String> = hourly.keys().cloned().collect();
        for (date, day) in daily {
            let start = policy::instant(&V::s(&format!("{date}0100")));
            let keys: Vec<String> = (0..24)
                .filter_map(|h| policy::key(start + f64::from(h) * 3_600_000., false))
                .collect();
            let items: Vec<&Value> = keys.iter().filter_map(|k| hourly.get(k)).collect();
            if items.len() != 24 {
                continue;
            }
            let consistent = keys.iter().zip(&items).all(|(key, item)| {
                let latest = normalize(AsosKind::Hourly, item, station, &all).map(|(_, v)| v);
                let stored = self
                    .find(&id(AsosKind::Hourly, station, key))
                    .and_then(|i| self.docs[i].get("values").and_then(Val::as_doc).cloned());
                ["rn1", "rn3h", "pty"].iter().all(|f| {
                    let have = stored.as_ref().and_then(|v| v.get(f)).and_then(Val::as_num);
                    have.is_none()
                        || have == latest.as_ref().and_then(|v| v.get(f)).and_then(Val::as_num)
                })
            });
            if !consistent {
                continue;
            }
            let amounts: Vec<f64> = items.iter().filter_map(|i| number(i.get("rn"))).collect();
            let total = number(day.get("sumRn"));
            let blank_total = day.get("sumRn").and_then(Value::as_str) == Some("");
            let sum = (amounts.iter().sum::<f64>() * 10.).round() / 10.;
            let closed = match total {
                Some(t) => (sum - t).abs() <= 0.05,
                None => blank_total && amounts.is_empty(),
            };
            if !closed {
                continue;
            }
            if warm_season(date) {
                for (key, item) in keys.iter().zip(&items) {
                    let flag = |f: &str| item.get(f).and_then(Value::as_str).map(str::trim);
                    let qc9 = flag("rnQcflg") == Some("9") || flag("rnQcflag") == Some("9");
                    if warm_season(key) && qc9 && blank(item, "rn") && code_dry(item) {
                        self.fill(AsosKind::Hourly, station, key, &[("rn1", 0.), ("pty", 0.)]);
                    }
                }
            }
            let no_duration = blank(day, "sumRnDur") || number(day.get("sumRnDur")) == Some(0.);
            if blank_total && amounts.is_empty() && no_duration && items.iter().all(|i| code_dry(i))
            {
                self.fill(AsosKind::Daily, station, date, &[("rn1", 0.)]);
            }
        }
    }
    /// `wet-bulb-rain-v1` (R2s of `kma-history.v1`), approved by AK on 2026-11-03 after
    /// held-out validation: in an April–October hour, a normal-QC numeric amount in the latest
    /// original without a phenomenon code is rain when its unflagged temperature and humidity
    /// (at least 5 %) give a wet-bulb temperature of at least 5 °C. A stored PTY from a code
    /// always stays.
    fn type_warm_rain(&mut self, station: &str, hourly: &BTreeMap<String, Value>) {
        let all: BTreeSet<String> = hourly.keys().cloned().collect();
        for (key, item) in hourly {
            if !warm_season(key) || !reports_rain(item) || !uncoded(item) {
                continue;
            }
            let Some((_, values)) = normalize(AsosKind::Hourly, item, station, &all) else {
                continue;
            };
            let field = |f: &str| values.get(f).and_then(Val::as_num);
            if let (Some(t), Some(humidity)) = (field("t1h"), field("reh"))
                && humidity >= 5.
                && wet_bulb(t, humidity) >= 5.
            {
                self.fill(AsosKind::Hourly, station, key, &[("pty", 1.)]);
            }
        }
    }
    /// Field-wise merging can keep a later blank report's PTY 0 beside an earlier numeric report,
    /// or the reverse. A reported amount, trace included, means precipitation occurred.
    fn clear_contradicted_dry_types(&mut self) {
        for at in 0..self.docs.len() {
            if !self.reported_rain.contains(&text(&self.docs[at], "_id")) {
                continue;
            }
            let doc = &mut self.docs[at];
            if let Some(mut values) = doc.get("values").and_then(Val::as_doc).cloned()
                && values.get("pty").and_then(Val::as_num) == Some(0.)
            {
                values.remove("pty");
                doc.set("values", Val::Doc(values));
            }
        }
    }
    /// A cape station's wind does not represent its towns; other sources may still fill it.
    fn drop_wind(&mut self) {
        for doc in &mut self.docs {
            if let Some(mut values) = doc.get("values").and_then(Val::as_doc).cloned() {
                values.remove("wsd");
                values.remove("vec");
                doc.set("values", Val::Doc(values));
            }
        }
    }
    /// Keep rule-derived values on an existing document while no measured value exists. Hourly
    /// ones stay in `inferred`: `policy::merge_hourly` applies them after every higher-precedence
    /// source (contract precedence 4), while ASOS `values` replace ODAM and VSRT under
    /// ASOS-primary. A daily total is the official value of its own row.
    fn fill(&mut self, kind: AsosKind, station: &str, key: &str, values: &[(&str, f64)]) {
        let Some(i) = self.find(&id(kind, station, key)) else {
            return;
        };
        let target = match kind {
            AsosKind::Hourly => "inferred",
            AsosKind::Daily => "values",
        };
        let doc = &mut self.docs[i];
        let stored = doc.get("values").and_then(Val::as_doc).cloned();
        let mut derived = doc
            .get(target)
            .and_then(Val::as_doc)
            .cloned()
            .unwrap_or_default();
        let before = derived.entries().len();
        for (field, n) in values {
            if !stored.as_ref().is_some_and(|v| v.has(field)) {
                derived.set(field, Val::num(*n));
            }
        }
        if derived.entries().len() != before {
            doc.set(target, Val::Doc(derived));
        }
    }
}
