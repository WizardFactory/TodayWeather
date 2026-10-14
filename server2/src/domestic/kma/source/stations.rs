//! Station collections rebuilt from shared nationwide observation pages, with the legacy saver
//! rules (`server/lib/kmaScraper.js`):
//! - `KmaStnHourly2` (`_saveStnHourly2`): one hourly run = an AWS hourly page merged with the
//!   city page (`getStnHourlyWeather`), each row upserted by `{stnId, date}`;
//! - `KmaStnMinute2` (`_saveStnMinute2`): one minute page, each row upserted by `{stnId, date}`;
//! - `KmaStnInfo` (`_saveStnInfo`): a station is registered the first time a run carries it with
//!   an address that geocodes; `isCityWeather` follows every later run with city data.
//!
//! Updates are Mongoose 5.1.2 `update(query, row, {upsert: true})` casts: schema fields only
//! (`strict`), `stnId` cast to Number, `$set` keys in reverse row order, `__v` on insert, and
//! MongoDB < 5.0 field order (existing fields keep their place, new ones are appended).
use super::doc::{Doc, Val};
use crate::world::js::string_to_number;

/// `KmaStnHourly2` / `KmaStnMinute2` schema paths (identical field sets).
const ROW_SCHEMA: [&str; 23] = [
    "stnId",
    "stnName",
    "date",
    "weather",
    "visibility",
    "cloud",
    "heavyCloud",
    "t1h",
    "dpt",
    "sensoryTem",
    "dspls",
    "r1d",
    "s1d",
    "reh",
    "wdd",
    "vec",
    "wsd",
    "hPa",
    "rs1h",
    "rs1d",
    "rs15m",
    "rns",
    // Not a path: keeps the array length for the documentation of the order above.
    "",
];
fn row_field(name: &str) -> bool {
    !name.is_empty() && ROW_SCHEMA.contains(&name)
}
/// Mongoose Number cast of a row value (`stnId` arrives as text).
fn cast_number(v: &Val) -> Option<f64> {
    match v {
        Val::Num(n) => Some(*n),
        Val::Str(s) => {
            let n = string_to_number(s);
            (!n.is_nan()).then_some(n)
        }
        Val::Bool(b) => Some(f64::from(u8::from(*b))),
        _ => None,
    }
}
/// The cast `$set` document of one row (reverse key order), or None when the query cannot be
/// cast (legacy logs the CastError and the row is not written).
fn cast_set(row: &Doc) -> Option<Doc> {
    let mut set = Doc::new();
    for (k, v) in row.entries().iter().rev() {
        if !row_field(k) {
            continue;
        }
        let v = match (k.as_str(), v) {
            ("stnId", v) => Val::num(cast_number(v)?),
            ("date", Val::Date(ms)) if ms.is_finite() => Val::Date(*ms),
            ("date", _) => return None,
            (
                "visibility" | "cloud" | "heavyCloud" | "t1h" | "dpt" | "sensoryTem" | "dspls"
                | "r1d" | "s1d" | "reh" | "vec" | "wsd" | "hPa" | "rs1h" | "rs1d" | "rs15m",
                v,
            ) => Val::num(cast_number(v)?),
            ("rns", Val::Bool(b)) => Val::Bool(*b),
            ("rns", _) => return None,
            (_, Val::Str(s)) => Val::Str(s.clone()),
            (_, Val::Num(n)) => Val::str(crate::gateway::response::js_number(*n)),
            _ => return None,
        };
        set.set(k, v);
    }
    Some(set)
}

/// One station collection (`KmaStnHourly2` or `KmaStnMinute2`) in natural order, indexed by
/// the upsert key `{stnId, date}`.
#[derive(Debug, Clone, Default)]
pub struct RowStore {
    docs: Vec<Doc>,
    index: std::collections::HashMap<(u64, u64), usize>,
}
fn row_key(id: &Val, date: &Val) -> Option<(u64, u64)> {
    match (id, date) {
        (Val::Num(i), Val::Date(d)) => Some((i.to_bits(), d.to_bits())),
        _ => None,
    }
}
impl RowStore {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    /// `update({stnId, date}, row, {upsert: true})` for every row of one save.
    pub fn save(&mut self, rows: &[Doc]) {
        for row in rows {
            let Some(set) = cast_set(row) else { continue };
            let (Some(id), Some(date)) = (set.get("stnId").cloned(), set.get("date").cloned())
            else {
                continue;
            };
            let Some(k) = row_key(&id, &date) else {
                continue;
            };
            match self.index.get(&k).copied() {
                Some(i) => {
                    for (k, v) in set.entries() {
                        self.docs[i].set(k, v.clone());
                    }
                }
                None => {
                    let mut doc = Doc::new()
                        .with("stnId", id)
                        .with("date", date)
                        .with("__v", Val::Num(0.));
                    for (k, v) in set.entries() {
                        doc.set(k, v.clone());
                    }
                    self.index.insert(k, self.docs.len());
                    self.docs.push(doc);
                }
            }
        }
    }
    /// `find({stnId, date: {$gt: from}}, {_id: 0}).sort({date: 1})`.
    pub fn after(&self, stn_id: f64, from: f64) -> Vec<Doc> {
        let mut out: Vec<Doc> = self
            .docs
            .iter()
            .filter(|d| d.get("stnId") == Some(&Val::Num(stn_id)) && date_of(d) > from)
            .cloned()
            .collect();
        out.sort_by(|a, b| date_of(a).total_cmp(&date_of(b)));
        out
    }
    /// `find({$or: [{stnId, date: {$gt: from}}...]}, {_id: 0}).sort({date: -1})`.
    pub fn any_after_desc(&self, stn_ids: &[f64], from: f64) -> Vec<Doc> {
        let mut out: Vec<Doc> = self
            .docs
            .iter()
            .filter(|d| {
                stn_ids
                    .iter()
                    .any(|id| d.get("stnId") == Some(&Val::Num(*id)))
                    && date_of(d) > from
            })
            .cloned()
            .collect();
        out.sort_by(|a, b| date_of(b).total_cmp(&date_of(a)));
        out
    }
    /// Remove rows dated at or before `before` (memory bound of the minute collection; the
    /// readers never look that far back).
    pub fn drop_before(&mut self, before: f64) {
        self.docs.retain(|d| date_of(d) > before);
        self.index = self
            .docs
            .iter()
            .enumerate()
            .filter_map(|(i, d)| Some((row_key(d.get("stnId")?, d.get("date")?)?, i)))
            .collect();
    }
}
pub fn date_of(d: &Doc) -> f64 {
    match d.get("date") {
        Some(Val::Date(ms)) => *ms,
        _ => f64::NAN,
    }
}

/// The station registry (`KmaStnInfo`) in natural order.
#[derive(Debug, Clone, Default)]
pub struct Registry {
    docs: Vec<Doc>,
    index: std::collections::HashMap<String, usize>,
}
/// Geocoding of a station address (`_recursiveConvertGeoCode`, then the product geocoder):
/// `[lon, lat]`, or None when it fails (the station is not registered in that run).
pub trait StationGeo {
    fn locate(&self, addr: &str) -> Option<(f64, f64)>;
}
impl Registry {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    /// Whether station `id` is registered.
    pub fn has(&self, id: &str) -> bool {
        self.index.contains_key(id)
    }
    /// `_saveStnInfo` for every row of one hourly run (`city_available` false is the legacy
    /// `cityUnavailable` run, which keeps the stored `isCityWeather`).
    pub fn apply_run(&mut self, rows: &[Doc], city_available: bool, geo: &dyn StationGeo) {
        for row in rows {
            let (Some(Val::Str(id)), Some(Val::Str(addr))) = (row.get("stnId"), row.get("addr"))
            else {
                continue;
            };
            let city = row.get("isCityWeather").cloned();
            match self.index.get(id.as_str()).map(|i| &mut self.docs[*i]) {
                Some(saved) => {
                    if city_available && saved.get("isCityWeather") != city.as_ref() {
                        match &city {
                            Some(v) => saved.set("isCityWeather", v.clone()),
                            None => saved.remove("isCityWeather"),
                        }
                    }
                }
                None => {
                    let Some((lon, lat)) = geo.locate(&addr.replace("(산간)", "")) else {
                        continue;
                    };
                    let mut doc = Doc::new()
                        .with("stnId", Val::str(id))
                        .with("stnName", row.get("stnName").cloned().unwrap_or(Val::Undef));
                    if matches!(doc.get("stnName"), Some(Val::Undef)) {
                        doc.remove("stnName");
                    }
                    doc.set("addr", Val::str(addr));
                    if let Some(c) = city {
                        doc.set("isCityWeather", c);
                    }
                    if let Some(Val::Num(a)) = row.get("altitude") {
                        doc.set("altitude", Val::num(*a));
                    }
                    doc.set("geo", Val::Arr(vec![Val::num(lon), Val::num(lat)]));
                    doc.set("__v", Val::Num(0.));
                    self.index.insert(id.clone(), self.docs.len());
                    self.docs.push(doc);
                }
            }
        }
    }
    /// `KmaStnInfo.find({geo: {$near: coords, $maxDistance}, isCityWeather?}).limit(limit)`
    /// with the `{_id: 0, __v: 0}` projection: a 2d index distance in degrees, nearest first,
    /// ties in natural order.
    pub fn near(&self, lon: f64, lat: f64, max: Option<f64>, city: bool, limit: usize) -> Vec<Doc> {
        let mut found: Vec<(f64, &Doc)> = self
            .docs
            .iter()
            .filter(|d| !city || d.get("isCityWeather") == Some(&Val::Bool(true)))
            .filter_map(|d| {
                let Some(Val::Arr(g)) = d.get("geo") else {
                    return None;
                };
                let (x, y) = (g.first()?.as_num()?, g.get(1)?.as_num()?);
                let dist = ((x - lon).powi(2) + (y - lat).powi(2)).sqrt();
                max.is_none_or(|m| dist <= m).then_some((dist, d))
            })
            .collect();
        found.sort_by(|a, b| a.0.total_cmp(&b.0));
        found
            .into_iter()
            .take(limit)
            .map(|(_, d)| {
                let mut d = d.clone();
                d.remove("__v");
                d
            })
            .collect()
    }
}
