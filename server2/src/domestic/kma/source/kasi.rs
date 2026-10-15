//! S15b-3b: KASI rise/set documents and the tw_svc reader.
//!
//! Legacy references (master `7ca6f002`, `controllers/kasi.riseset.controller.js`):
//! `gatherAreaRiseSetFromApi` (L771: every `getAreaList` area for the UTC days D-8..D+9) →
//! `updateAreaRiseSetFromApi` (L674: a stored area/day is skipped) → `_apiRaw2modelKasiRiseSet`
//! (L623) → `_updateKasiRiseSet` (L646, `update({locdate, location}, doc, {upsert})`), over the
//! S13a `kasi-area-rise-set` records. Reader: `getRiseSetList(geocode, dates)` (L582) →
//! `getRiseSetListFromDatabase` (L536): the nearest stored document by `$near` without a bound
//! (L511), that location's documents of the dates (L460) and `_model2RiseSet` (L486); any error
//! answers `[]` and the request path never calls the API.
use super::doc::{Doc, Val};
use super::life::string_to_date;
use crate::gateway::OrderedJson;
use serde_json::Value;

/// `KasiRiseSet.getDataPropertyList()`.
pub const PROPERTIES: [&str; 12] = [
    "sunrise",
    "suntransit",
    "sunset",
    "moonrise",
    "moontransit",
    "moonset",
    "civilm",
    "civile",
    "nautm",
    "naute",
    "astm",
    "aste",
];

/// The `kasiRiseSet` collection in natural order, and every stored location with its
/// coordinate (first seen first). Legacy keeps every document, so a location with only old days
/// still wins the unbounded nearest-location query; the places outlive the dated documents
/// server2 forgets.
#[derive(Debug, Clone, Default)]
pub struct RiseSets {
    docs: Vec<Doc>,
    places: Vec<(Val, Val)>,
}
impl RiseSets {
    pub fn len(&self) -> usize {
        self.docs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Array(self.docs.iter().map(Doc::json).collect())
    }
    /// Whether a document of `location` and the day `locdate` (`YYYYMMDD`) is stored
    /// (`_findKasiRiseSet`).
    pub fn has(&self, location: &str, locdate: &str) -> bool {
        string_to_date(locdate).is_some_and(|day| self.find(location, day).is_some())
    }
    fn find(&self, location: &str, day: f64) -> Option<usize> {
        self.docs.iter().position(|d| {
            d.get("location").and_then(Val::as_str) == Some(location)
                && d.get("locdate") == Some(&Val::Date(day))
        })
    }
    /// One area/day acquisition (`response.body.items.item`) of `area` and `locdate`: skipped
    /// when that area/day is stored; otherwise converted and upserted. A conversion that throws
    /// or a coordinate that does not cast saves nothing.
    pub fn apply(&mut self, area: &str, locdate: &str, item: &Value) {
        if self.has(area, locdate) {
            return;
        }
        let Some(fields) = convert(item) else {
            return;
        };
        let get = |k: &str| {
            fields
                .iter()
                .find(|(f, _)| *f == k)
                .map(|(_, v)| v.clone())
                .unwrap_or(Val::Null)
        };
        let (date, location) = (get("locdate"), get("location"));
        let existing = match (&date, &location) {
            (Val::Date(ms), Val::Str(l)) => self.find(l, *ms),
            _ => None,
        };
        let i = existing.unwrap_or_else(|| {
            // The query fields, then `__v` from the upsert's insert.
            self.docs.push(
                Doc::new()
                    .with("locdate", date)
                    .with("location", location)
                    .with("__v", Val::num(0.)),
            );
            self.docs.len() - 1
        });
        // Mongoose 5.1.2 walks the replacement's `$set` keys in reverse.
        for (k, v) in fields.iter().rev() {
            self.docs[i].set(k, v.clone());
        }
        let location = self.docs[i].get("location").cloned().unwrap_or(Val::Null);
        if let Some(Val::Arr(_)) = self.docs[i].get("geo")
            && !self.places.iter().any(|(l, _)| *l == location)
        {
            let geo = self.docs[i].get("geo").cloned().unwrap_or(Val::Null);
            self.places.push((location, geo));
        }
    }
    /// Whether a document of `location` was ever stored.
    pub fn has_place(&self, location: &str) -> bool {
        self.places
            .iter()
            .any(|(l, _)| l.as_str() == Some(location))
    }
    /// Stored locations (the nearest-location candidates).
    pub fn places(&self) -> usize {
        self.places.len()
    }
    /// Documents whose day is before `day` are forgotten (they never match a request date).
    pub fn forget_before(&mut self, day: f64) {
        self.docs
            .retain(|d| !matches!(d.get("locdate"), Some(Val::Date(ms)) if *ms < day));
    }
    /// `getRiseSetList(geocode, dates)` from the database; any error answers `[]`.
    pub fn answer(&self, geocode: &serde_json::Value, dates: &[String]) -> OrderedJson {
        let empty = OrderedJson::Array(Vec::new());
        let (Some(lon), Some(lat)) = (
            geocode.get("lon").and_then(Value::as_f64),
            geocode.get("lat").and_then(Value::as_f64),
        ) else {
            return empty;
        };
        // _findRiseSetByGeo: the nearest stored document; every document of a location has
        // that location's coordinate, so the nearest place (first seen on ties) names it.
        let nearest = self
            .places
            .iter()
            .enumerate()
            .filter_map(|(i, (_, geo))| {
                let Val::Arr(g) = geo else {
                    return None;
                };
                Some((
                    (g.first()?.as_num()? - lon).hypot(g.get(1)?.as_num()? - lat),
                    i,
                ))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let Some((_, i)) = nearest else {
            return empty;
        };
        let location = Some(self.places[i].0.clone());
        // _findKasiRiseSetList: `{$or: [{location, locdate}, ...]}`; none found is an error.
        let wanted: Vec<f64> = dates.iter().filter_map(|d| string_to_date(d)).collect();
        let mut found: Vec<&Doc> = self
            .docs
            .iter()
            .filter(|d| {
                d.get("location").cloned() == location
                    && matches!(d.get("locdate"), Some(Val::Date(ms)) if wanted.contains(ms))
            })
            .collect();
        // Legacy stores a location's days in ascending order (each gather adds the new last
        // day), and `sort({date: -1})` names no stored field: the natural order is by day.
        // server2 may capture another column first, so the answer is ordered by day.
        found.sort_by(|a, b| {
            let day = |d: &Doc| match d.get("locdate") {
                Some(Val::Date(ms)) => *ms,
                _ => f64::NEG_INFINITY,
            };
            day(a).total_cmp(&day(b))
        });
        if found.is_empty() {
            return empty;
        }
        // _model2RiseSet: a stored property that is not a Date throws (`getFullYear` of null).
        let mut out = Vec::new();
        for d in found {
            match model_to_rise_set(d) {
                Some(rs) => out.push(rs.json()),
                None => return empty,
            }
        }
        OrderedJson::Array(out)
    }
}
/// `_apiRaw2modelKasiRiseSet(rawData)`: the replacement's fields in key order, or None when the
/// conversion throws or Mongoose cannot cast the coordinate (the update is not sent).
fn convert(raw: &Value) -> Option<Vec<(&'static str, Val)>> {
    // `[Number]` cast: KASI answers the coordinates as strings ("37.5666660", 2026-10-15).
    let num = |k: &str| -> Option<Val> {
        match raw.get(k) {
            Some(Value::Number(n)) => n.as_f64().map(Val::num),
            Some(Value::String(s)) => {
                let n = crate::domestic::kma::js::to_number(&crate::domestic::kma::js::V::s(s));
                n.is_finite().then(|| Val::num(n))
            }
            Some(Value::Null) => Some(Val::Null),
            _ => None,
        }
    };
    let locdate = raw
        .get("locdate")
        .map_or_else(|| "undefined".into(), js_string);
    let location = match raw.get("location") {
        Some(Value::String(s)) => Val::str(s),
        Some(Value::Number(_) | Value::Bool(_)) => Val::str(js_string(&raw["location"])),
        _ => Val::Null,
    };
    let mut out = vec![
        (
            "geo",
            Val::Arr(vec![num("longitudeNum")?, num("latitudeNum")?]),
        ),
        ("location", location),
        (
            "locdate",
            string_to_date(&locdate).map_or(Val::Null, Val::Date),
        ),
    ];
    for p in PROPERTIES {
        let value = raw.get(p);
        let include = match value {
            Some(Value::Number(_)) => true,
            Some(Value::String(s)) => !s.contains('-'),
            // `rawData[p].indexOf` of a missing value throws: nothing is saved.
            None | Some(Value::Null) => return None,
            Some(Value::Bool(_)) => return None,
            // An array has `indexOf`; an object does not.
            Some(Value::Array(a)) => !a.iter().any(|v| v.as_str() == Some("-")),
            Some(Value::Object(_)) => return None,
        };
        if include {
            let text = format!("{locdate}{}", js_string(value.expect("checked")));
            // An instant that does not survive is `undefined`, stored as null.
            out.push((p, string_to_date(&text).map_or(Val::Null, Val::Date)));
        }
    }
    Some(out)
}
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => crate::gateway::response::js_number(n.as_f64().unwrap_or(f64::NAN)),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
/// `_model2RiseSet` of one stored document; None when a property throws.
fn model_to_rise_set(d: &Doc) -> Option<Doc> {
    let mut out = Doc::new()
        .with(
            "locationName",
            d.get("location").cloned().unwrap_or(Val::Null),
        )
        .with("locationGeo", d.get("geo").cloned().unwrap_or(Val::Null));
    // convertDateToYYYYMMDD(new Date(locdate)): null is the epoch.
    let day = match d.get("locdate") {
        Some(Val::Date(ms)) => *ms,
        _ => 0.,
    };
    let p = crate::world::js::parts(day)?;
    out.set(
        "date",
        Val::str(format!("{:04}{:02}{:02}", p.year, p.month, p.day)),
    );
    for name in PROPERTIES {
        match d.get(name) {
            None => {}
            Some(Val::Date(ms)) => {
                let t = crate::world::js::parts(*ms)?;
                out.set(
                    name,
                    Val::str(format!(
                        "{:04}.{:02}.{:02} {:02}:{:02}",
                        t.year, t.month, t.day, t.hour, t.minute
                    )),
                );
            }
            Some(_) => return None,
        }
    }
    Some(out)
}
