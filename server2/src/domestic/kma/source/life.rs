//! S15b-3b: area numbers and the life index of the KMA assembly.
//!
//! Legacy references (master `7ca6f002`):
//! - `areaNoList` (`models/modelAreaNo.js`): `utils/updateAreaNo.js` saved the geocoded 2016 list
//!   (`utils/data/20160704_AreaNoResutl`, `update({town}, {areaNo, town, geo}, {upsert})`), then
//!   `utils/update.areano.to.db.js` applied `20180119_kma_lifeindex_areano.csv`: an existing town
//!   gets `$set {areaNo: parseInt, updatedAt: "20180119"}`. A new town needed a Kakao geocode and
//!   the script calls `x.toFixed` on the string coordinates Kakao returns, so no new town was
//!   stored: the collection is repository data only (`data/PROVENANCE.md`). Readers:
//!   `controllerTown.getLifeIndexKma` `findAreaNo` (`find({town}).limit(1)`) and `findNearAreaNo`
//!   (`$near`, `$maxDistance` 0.3, `limit(3)`).
//! - `lifeIndexKma2` from the S13 `uv-idx-v5` and `*-pollen-v3` acquisitions:
//!   `lifeIndexKmaRequester.convertUvItemsV5` (L1209), `convertPollenItemsV3` (L1446),
//!   `saveLifeIndex2` (L1027, `update({date, areaNo, indexType}, row, {upsert})`),
//!   `_removeOldData` (L1045) before a UV issuance is saved and the per-kind `lastIssued` skip
//!   (L1331, L1588). Reader: `lifeIndexKmaController._fromLifeIndexDb2` (`find({areaNo})`,
//!   natural order).
//! - Pollen day+3: the provider sends `twodaysaftertomorrow`; legacy reads
//!   `todaysaftertomorrow` and so never stores day+3. The fold keeps the provider's day+3
//!   separately ([`LifeIndex::pollen_day3`]); the legacy reader answer does not include it.
use super::doc::{Doc, Val};
use crate::domestic::kma::js::{V, parse_int, to_number};
use crate::gateway::OrderedJson;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;

/// `kmaTimeLib.convertStringToDate(str)` in the UTC process (None: `undefined`).
pub(crate) fn string_to_date(s: &str) -> Option<f64> {
    match crate::domestic::kma::time::convert_string_to_date(&V::s(s)) {
        V::Date(ms) => Some(ms),
        _ => None,
    }
}
/// `''+value` / `String(value)` of a JSON scalar (objects never reach here: S13 rejects them).
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => crate::gateway::response::js_number(n.as_f64().unwrap_or(f64::NAN)),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(_) | Value::Object(_) => String::new(),
    }
}
/// `Number(value)` of a JSON scalar.
fn js_number(v: &Value) -> f64 {
    match v {
        Value::String(s) => to_number(&V::s(s)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Null => 0.,
        Value::Array(_) | Value::Object(_) => f64::NAN,
    }
}
fn ten_digits(s: &str) -> bool {
    s.len() == 10 && s.bytes().all(|b| b.is_ascii_digit())
}

// ---- area numbers ----

/// The `areaNoList` collection (natural order).
pub struct Areas {
    docs: Vec<Doc>,
}
static AREAS: OnceLock<Areas> = OnceLock::new();
/// The area-number collection rebuilt from the repository lists (built once).
pub fn areas() -> &'static Areas {
    AREAS.get_or_init(Areas::build)
}
type TownKey = (String, String, String);
impl Areas {
    fn build() -> Self {
        let mut docs: Vec<Doc> = Vec::new();
        let mut by_town: HashMap<TownKey, usize> = HashMap::new();
        // updateAreaNo.js: every geocoded line, `update({town}, {areaNo, town, geo}, {upsert})`.
        for line in include_str!("data/20160704_AreaNoResutl").lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let (Some(town), Some(g)) = (v.get("town"), v.get("geocode")) else {
                continue;
            };
            let part = |k: &str| town.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
            let key = (part("first"), part("second"), part("third"));
            let town_doc = Doc::new()
                .with("first", Val::str(&key.0))
                .with("second", Val::str(&key.1))
                .with("third", Val::str(&key.2));
            let num = |x: Option<&Value>| x.and_then(Value::as_f64).map_or(Val::Null, Val::num);
            let i = *by_town.entry(key).or_insert_with(|| {
                // The query field, then `__v` from the upsert's insert.
                docs.push(
                    Doc::new()
                        .with("town", Val::Doc(town_doc.clone()))
                        .with("__v", Val::num(0.)),
                );
                docs.len() - 1
            });
            // Mongoose 5.1.2 walks the replacement's `$set` keys in reverse.
            let set = [
                ("areaNo", num(v.get("areaNo"))),
                ("town", Val::Doc(town_doc)),
                ("geo", Val::Arr(vec![num(g.get("lon")), num(g.get("lat"))])),
            ];
            for (k, val) in set.iter().rev() {
                docs[i].set(k, val.clone());
            }
        }
        // update.areano.to.db.js: `line.split(',')`; an existing town gets
        // `$set {areaNo: parseInt(areaNo), updatedAt: "20180119"}` on its first match.
        let mut lines = include_str!("data/20180119_kma_lifeindex_areano.csv").split('\n');
        lines.next();
        for line in lines {
            let cols: Vec<&str> = line.split(',').collect();
            if cols.len() < 4 {
                continue;
            }
            let key = (cols[1].to_owned(), cols[2].to_owned(), cols[3].to_owned());
            if let Some(i) = by_town.get(&key) {
                docs[*i].set("areaNo", Val::num(parse_int(&V::s(cols[0]))));
                docs[*i].set("updatedAt", Val::str("20180119"));
            }
        }
        Self { docs }
    }
    pub fn len(&self) -> usize {
        self.docs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }
    /// Every document in natural order.
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Array(self.docs.iter().map(Doc::json).collect())
    }
    /// `modelAreaNo.find({'town.first', 'town.second', 'town.third'}).limit(1)`.
    pub fn by_town(&self, first: &str, second: &str, third: &str) -> OrderedJson {
        OrderedJson::Array(
            self.docs
                .iter()
                .filter(|d| {
                    let t = d.get("town").and_then(Val::as_doc);
                    let f = |k| t.and_then(|t| t.get(k)).and_then(Val::as_str);
                    f("first") == Some(first)
                        && f("second") == Some(second)
                        && f("third") == Some(third)
                })
                .take(1)
                .map(Doc::json)
                .collect(),
        )
    }
    /// `modelAreaNo.find({geo: {$near: [lon, lat], $maxDistance: 0.3}}).limit(3)`: planar 2d
    /// distance, the bound inclusive, nearest first, natural order for equal distances.
    pub fn near(&self, lon: f64, lat: f64) -> OrderedJson {
        let mut hits: Vec<(f64, usize)> = self
            .docs
            .iter()
            .enumerate()
            .filter_map(|(i, d)| {
                let Some(Val::Arr(g)) = d.get("geo") else {
                    return None;
                };
                let (x, y) = (g.first()?.as_num()?, g.get(1)?.as_num()?);
                let r = (x - lon).hypot(y - lat);
                (r <= 0.3).then_some((r, i))
            })
            .collect();
        hits.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        OrderedJson::Array(
            hits.into_iter()
                .take(3)
                .map(|(_, i)| self.docs[i].json())
                .collect(),
        )
    }
}

// ---- life index ----

/// Legacy `indexType` values: UV and the three pollen kinds.
pub const KINDS: [&str; 4] = ["ultrv", "flowerWoody", "flowerPine", "flowerWeeds"];

/// One saved `lifeIndexKma2` row. Every document is created by the same upsert, so its stored
/// field order is fixed: `date, areaNo, indexType, __v, lastUpdateDate, index`.
#[derive(Debug, Clone, PartialEq)]
struct Row {
    date: f64,
    kind: u8,
    index: f64,
    issued: String,
}
/// One pollen day+3 value of the provider (`twodaysaftertomorrow`).
#[derive(Debug, Clone, PartialEq)]
pub struct Day3 {
    pub kind: &'static str,
    pub date: f64,
    pub index: f64,
    pub issued: String,
}
/// The `lifeIndexKma2` collection: rows per `areaNo` in natural order, and the per-kind last
/// saved issuance (`lastIssued`).
#[derive(Debug, Clone, Default)]
pub struct LifeIndex {
    areas: BTreeMap<u64, Vec<Row>>,
    last: [Option<String>; 4],
    day3: HashMap<(u64, u8), Day3>,
}
fn kind_of(kind: &str) -> Option<u8> {
    KINDS.iter().position(|k| *k == kind).map(|i| i as u8)
}
/// The legacy `areaNo` value stored by Mongoose (`Number` schema; BSON drops `-0`).
fn area_bits(area: f64) -> u64 {
    if area == 0. {
        0f64.to_bits()
    } else {
        area.to_bits()
    }
}
impl LifeIndex {
    /// The last saved issuance of `kind` (`ultrv` or a pollen kind).
    pub fn last_issued(&self, kind: &str) -> Option<&str> {
        kind_of(kind).and_then(|k| self.last[k as usize].as_deref())
    }
    pub fn len(&self) -> usize {
        self.areas.values().map(Vec::len).sum()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    /// One acquisition of `kind` completed at `fetched` (its items in page order).
    pub fn apply(&mut self, kind: &str, fetched: f64, items: &[Value]) {
        let Some(k) = kind_of(kind) else {
            return;
        };
        let Some(issued) = items.first().and_then(|i| i.get("date")).map(js_string) else {
            return;
        };
        // taskUltrvV5 / taskPollenV3: an issuance not newer than the last saved one is skipped.
        if self.last[k as usize]
            .as_deref()
            .is_some_and(|l| issued.as_str() <= l)
        {
            return;
        }
        let rows = if k == 0 {
            // taskLifeIndex2 removes old documents before the UV task saves.
            self.remove_old(fetched);
            convert_uv(items)
        } else {
            self.keep_day3(k, items);
            convert_pollen(k, items)
        };
        // A pollen issuance without rows waits for the next publication unsaved.
        if rows.is_empty() && k != 0 {
            return;
        }
        for (area, row) in rows {
            let list = self.areas.entry(area_bits(area)).or_default();
            match list
                .iter_mut()
                .find(|r| r.date == row.date && r.kind == row.kind)
            {
                Some(found) => *found = row,
                None => list.push(row),
            }
        }
        self.last[k as usize] = Some(issued);
    }
    /// `_removeOldData` at `now`: documents dated before `now - 10 days` (local = UTC).
    fn remove_old(&mut self, now: f64) {
        let limit = now - 10. * DAY_MS;
        for list in self.areas.values_mut() {
            list.retain(|r| r.date >= limit);
        }
        self.areas.retain(|_, l| !l.is_empty());
    }
    fn keep_day3(&mut self, k: u8, items: &[Value]) {
        for item in items {
            let issued = item.get("date").map(js_string).unwrap_or_default();
            let area = item.get("areaNo").map_or(f64::NAN, js_number);
            let Some(raw) = item.get("twodaysaftertomorrow") else {
                continue;
            };
            let index = match raw {
                Value::String(s) if !s.trim().is_empty() => js_number(raw),
                Value::Number(_) => js_number(raw),
                _ => continue,
            };
            if !ten_digits(&issued)
                || !area.is_finite()
                || area.fract() != 0.
                || !(index.fract() == 0. && (0. ..=3.).contains(&index))
            {
                continue;
            }
            let Some(day) = string_to_date(&issued[..8]) else {
                continue;
            };
            self.day3.insert(
                (area_bits(area), k),
                Day3 {
                    kind: KINDS[k as usize],
                    date: day + 3. * DAY_MS,
                    index,
                    issued,
                },
            );
        }
    }
    /// The provider's pollen day+3 values for `area` (latest issuance of each kind).
    pub fn pollen_day3(&self, area: f64) -> Vec<&Day3> {
        (1..4u8)
            .filter_map(|k| self.day3.get(&(area_bits(area), k)))
            .collect()
    }
    /// `LifeIndexKma2.find({areaNo})` with `lean()`: the stored documents in natural order.
    pub fn by_area(&self, area: f64) -> OrderedJson {
        let rows = self
            .areas
            .get(&area_bits(area))
            .map_or(&[][..], Vec::as_slice);
        OrderedJson::Array(rows.iter().map(|r| row_doc(area, r).json()).collect())
    }
    /// Every document grouped by `areaNo` (ascending), each area in natural order.
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Array(
            self.areas
                .iter()
                .flat_map(|(a, rows)| {
                    let area = f64::from_bits(*a);
                    rows.iter().map(move |r| row_doc(area, r).json())
                })
                .collect(),
        )
    }
}
fn row_doc(area: f64, r: &Row) -> Doc {
    Doc::new()
        .with("date", Val::Date(r.date))
        .with("areaNo", Val::num(area))
        .with("indexType", Val::str(KINDS[r.kind as usize]))
        .with("__v", Val::num(0.))
        .with("lastUpdateDate", Val::str(&r.issued))
        .with("index", Val::num(r.index))
}
/// `convertUvItemsV5(items)`: (areaNo, row) per area and KST day with a 12:00 value.
fn convert_uv(items: &[Value]) -> Vec<(f64, Row)> {
    let mut out = Vec::new();
    for item in items {
        let issued = item
            .get("date")
            .map_or_else(|| "undefined".into(), js_string);
        let area = item.get("areaNo").map_or(f64::NAN, |a| {
            crate::domestic::kma::js::parse_int10(&V::s(&js_string(a)))
        });
        if !ten_digits(&issued) || area.is_nan() {
            continue;
        }
        let digits = |a: usize, b: usize| issued[a..b].parse::<i64>().unwrap_or(0);
        let base = crate::world::js::days_from_civil(digits(0, 4), digits(4, 6), digits(6, 8))
            as f64
            * DAY_MS
            + digits(8, 10) as f64 * HOUR_MS;
        let mut days: BTreeMap<String, (f64, bool)> = BTreeMap::new();
        for n in (0..=78).step_by(3) {
            let Some(v) = item.get(format!("h{n}")) else {
                continue;
            };
            if v.is_null() || v.as_str() == Some("") {
                continue;
            }
            let index = js_number(v);
            if !index.is_finite() || index < 0. {
                continue;
            }
            let Some(p) = crate::world::js::parts(base + f64::from(n) * HOUR_MS) else {
                continue;
            };
            let day = format!("{:04}{:02}{:02}", p.year, p.month, p.day);
            let slot = days.entry(day).or_insert((index, false));
            slot.0 = slot.0.max(index);
            if p.hour == 12 {
                slot.1 = true;
            }
        }
        for (day, (index, noon)) in days {
            if !noon {
                continue;
            }
            if let Some(date) = string_to_date(&day) {
                out.push((
                    area,
                    Row {
                        date,
                        kind: 0,
                        index,
                        issued: issued.clone(),
                    },
                ));
            }
        }
    }
    out
}
/// `convertPollenItemsV3(indexName, items)`.
fn convert_pollen(k: u8, items: &[Value]) -> Vec<(f64, Row)> {
    let mut out = Vec::new();
    for item in items {
        let issued = item
            .get("date")
            .map_or_else(|| "undefined".into(), js_string);
        let area = item.get("areaNo").map_or(f64::NAN, js_number);
        let safe = area.is_finite() && area.fract() == 0. && area.abs() <= 9_007_199_254_740_991.;
        if !ten_digits(&issued) || !safe {
            continue;
        }
        let Some(day) = string_to_date(&issued[..8]) else {
            continue;
        };
        for (offset, field) in [
            "today",
            "tomorrow",
            "dayaftertomorrow",
            "todaysaftertomorrow",
        ]
        .iter()
        .enumerate()
        {
            let mut raw = item.get(*field);
            if *field == "dayaftertomorrow" && raw.is_none() {
                raw = item.get("theDayAfterTomorrow");
            }
            let index = match raw {
                Some(v @ Value::String(s)) if !s.trim_matches(js_space).is_empty() => js_number(v),
                Some(v @ Value::Number(_)) => js_number(v),
                _ => continue,
            };
            if !(index.fract() == 0. && (0. ..=3.).contains(&index)) {
                continue;
            }
            out.push((
                area,
                Row {
                    date: day + offset as f64 * DAY_MS,
                    kind: k,
                    index,
                    issued: issued.clone(),
                },
            ));
        }
    }
    out
}
fn js_space(c: char) -> bool {
    crate::domestic::kma::precip::js_ws(c)
}
