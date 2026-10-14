//! Forecast zones (`kmaforecastzonecodes`) rebuilt from `forecast-zone` acquisitions with the
//! legacy `KmaForecastZoneController` rules at master after #2740 (`getFcstZoneCd`, JSON pages of
//! 1,000 rows, at most 10 pages, a `03` page after a full page ends the list): `_parsePage`,
//! `normalizeZone`, `_update` (upsert `$set` + `$unset`), `_retireAbsent`, and the read
//! `findForecastZoneByName` over active zones.
use super::doc::{Doc, Val};
use crate::gateway::response::js_number;
use serde_json::Value;
use std::collections::HashSet;

const ROWS_PER_PAGE: f64 = 1000.;
const MAX_PAGES: u32 = 10;
const TEXT_FIELDS: [&str; 6] = ["regEn", "regUp", "stnWn", "stnF3", "stnFd", "stnFw"];

/// JavaScript `String(value)` of a JSON value.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => js_number(n.as_f64().unwrap_or(f64::NAN)),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => a
            .iter()
            .map(|x| match x {
                Value::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
fn absent(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}
fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
/// `/^-?\d+(\.\d+)?$/`.
fn decimal_text(s: &str) -> bool {
    let t = s.strip_prefix('-').unwrap_or(s);
    match t.split_once('.') {
        Some((a, b)) => all_digits(a) && all_digits(b),
        None => all_digits(t),
    }
}
fn number_of(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        other => crate::world::js::string_to_number(&js_string(other)),
    }
}
/// `normalizeZone(obj)`.
pub fn normalize(obj: &Value) -> Option<Doc> {
    let o = obj.as_object()?;
    let text = |k: &str| o.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let mut zone = Doc::new()
        .with("regId", Val::str(text("regId")?))
        .with("regName", Val::str(text("regName")?))
        .with("regSp", Val::str(text("regSp")?));
    for field in TEXT_FIELDS {
        let v = o.get(field);
        if absent(v) {
            continue;
        }
        match v? {
            Value::String(s) => zone.set(field, Val::str(s.clone())),
            Value::Number(n) => zone.set(field, Val::str(js_number(n.as_f64()?))),
            _ => return None,
        }
    }
    for field in ["tmEd", "tmSt"] {
        let v = o.get(field);
        if absent(v) {
            continue;
        }
        let ok = match v? {
            Value::Number(n) => n
                .as_f64()
                .is_some_and(|x| x.fract() == 0. && x >= 0. && x.is_finite()),
            Value::String(s) => all_digits(s),
            _ => false,
        };
        if !ok {
            return None;
        }
        zone.set(field, Val::str(js_string(v?)));
    }
    let decimal = |v: &Value| -> bool {
        (matches!(v, Value::Number(_)) || matches!(v, Value::String(s) if decimal_text(s)))
            && number_of(v).is_finite()
    };
    for field in ["seq", "ht"] {
        let v = o.get(field);
        if absent(v) {
            continue;
        }
        if !decimal(v?) {
            return None;
        }
        zone.set(field, Val::num(number_of(v?)));
    }
    for field in ["lat", "lon"] {
        if let Some(v) = o.get(field).filter(|v| !v.is_null())
            && !decimal(v)
        {
            return None;
        }
    }
    let (lat_v, lon_v) = (o.get("lat"), o.get("lon"));
    if !absent(lon_v) && !absent(lat_v) {
        let (lon, lat) = (number_of(lon_v?), number_of(lat_v?));
        if lon != 0. && lat != 0. {
            if !(-180. ..180.).contains(&lon) || !(-90. ..=90.).contains(&lat) {
                return None;
            }
            zone.set("geo", Val::Arr(vec![Val::num(lon), Val::num(lat)]));
        }
    }
    Some(zone)
}

/// `_parsePage`: the page's zones, `None` for the `03` page that ends a list, or an error.
fn parse_page(raw: &Value, page_no: u32) -> Result<Option<Vec<Doc>>, &'static str> {
    let header = raw.get("response").and_then(|r| r.get("header"));
    let Some(header) = header.filter(|h| !h.is_null() && h.as_bool() != Some(false)) else {
        return Err("envelope");
    };
    let code = js_string(header.get("resultCode").unwrap_or(&Value::Null));
    if code == "03" && page_no > 1 {
        return Ok(None);
    }
    if code != "00" {
        return Err("resultCode");
    }
    let body = raw.get("response").and_then(|r| r.get("body"));
    let Some(list) = body
        .and_then(|b| b.get("items"))
        .and_then(|i| i.get("item"))
        .and_then(Value::as_array)
    else {
        return Err("items");
    };
    let number = |v: Option<&Value>| match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) if all_digits(s) => s.parse().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    let body = body.unwrap_or(&Value::Null);
    if number(body.get("totalCount")) != list.len() as f64 {
        return Err("totalCount");
    }
    if number(body.get("pageNo")) != f64::from(page_no)
        || number(body.get("numOfRows")) != ROWS_PER_PAGE
    {
        return Err("echo");
    }
    list.iter()
        .map(|item| normalize(item).ok_or("item"))
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}
/// `_fetchAll` over the stored pages of one acquisition: the complete list, or None when legacy
/// would have written nothing (a failed check, a duplicate, the page limit or a missing page).
pub fn complete_list(pages: &[&[u8]]) -> Option<Vec<Doc>> {
    let mut zones = Vec::new();
    let mut seen = HashSet::new();
    for page_no in 1..=MAX_PAGES {
        // S13b publishes only complete lists and keeps no record of the `03` page that ends a
        // list of full pages: no stored page after a full page is that end.
        let Some(page) = pages.get(page_no as usize - 1) else {
            return (page_no > 1).then_some(zones);
        };
        let raw: Value = serde_json::from_slice(page).ok()?;
        let Some(list) = parse_page(&raw, page_no).ok()? else {
            return Some(zones);
        };
        let full = list.len() as f64 >= ROWS_PER_PAGE;
        for zone in list {
            let id = zone.get("regId")?.as_str()?.to_owned();
            if !seen.insert(id) {
                return None;
            }
            zones.push(zone);
        }
        if !full {
            return Some(zones);
        }
    }
    None
}

/// The stored zone collection (insertion order).
#[derive(Debug, Clone, Default)]
pub struct Zones(Vec<Doc>);
impl Zones {
    /// Apply one complete list as `getFromKma` does; `retired_at_ms` is the run's wall clock.
    pub fn apply(&mut self, list: &[Doc], retired_at_ms: f64) {
        for zone in list {
            let id = zone.get("regId").cloned();
            let pos = self.0.iter().position(|d| d.get("regId") == id.as_ref());
            let doc = match pos {
                Some(i) => &mut self.0[i],
                None => {
                    let mut d = Doc::new();
                    if let Some(id) = &id {
                        d.set("regId", id.clone());
                    }
                    d.set("__v", Val::Num(0.));
                    self.0.push(d);
                    self.0.last_mut().expect("pushed")
                }
            };
            for (k, v) in zone.entries() {
                doc.set(k, v.clone());
            }
            doc.remove("retired");
            doc.remove("retiredAt");
            if !zone.has("geo") {
                doc.remove("geo");
            }
        }
        let ids: Vec<&Val> = list.iter().filter_map(|z| z.get("regId")).collect();
        for doc in &mut self.0 {
            let listed = doc.get("regId").is_some_and(|id| ids.contains(&id));
            if !listed && doc.get("retired") != Some(&Val::Bool(true)) {
                doc.set("retired", Val::Bool(true));
                doc.set("retiredAt", Val::Date(retired_at_ms));
            }
        }
    }
    pub fn docs(&self) -> &[Doc] {
        &self.0
    }
    /// `findForecastZoneByName(regionName, cityName)`: matching active zones in natural order.
    pub fn find_by_name(&self, region: &str, city: &str) -> Vec<Doc> {
        let (name, reg_id) = zone_query(region, city);
        self.0
            .iter()
            .filter(|d| {
                d.get("retired") != Some(&Val::Bool(true))
                    && d.get("regSp").and_then(Val::as_str) == Some("C")
                    && d.get("regName").and_then(Val::as_str) == name.as_deref()
                    && reg_id.is_none_or(|id| d.get("regId").and_then(Val::as_str) == Some(id))
            })
            .cloned()
            .collect()
    }
}
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
/// The `regName` (None: `undefined`, which matches no stored name) and special `regId`.
fn zone_query(region: &str, city: &str) -> (Option<String>, Option<&'static str>) {
    let region_type = ["특별시", "광역시", "특별자치시"]
        .into_iter()
        .find(|t| region.contains(t));
    let mut reg_id = None;
    let name: Option<String>;
    if let Some(t) = region_type {
        // `String.prototype.replace` with a string pattern replaces the first occurrence.
        let mut n = region.replacen(t, "", 1);
        if n == "인천" {
            if city == "강화군" {
                n = "강화".into();
            }
        } else if n == "광주" {
            reg_id = Some("11F20501");
        } else if n == "대구" && city == "군위군" {
            n = "군위".into();
        }
        name = Some(n);
    } else if region == "이어도" {
        name = Some(region.into());
    } else {
        let u = units(city);
        let last_gu = u.iter().rposition(|c| *c == units("구")[0]);
        let mut n = if u.is_empty() {
            // ''.lastIndexOf('구') === -1 === ''.length - 1 is false; slice(0, -1) is ''.
            String::new()
        } else if last_gu == Some(u.len() - 1) {
            let si = u.iter().rposition(|c| *c == units("시")[0]);
            // `slice(0, -1)` when there is no 시: everything but the last unit.
            let end = match si {
                Some(i) => i,
                None => u.len() - 1,
            };
            String::from_utf16_lossy(&u[..end])
        } else {
            String::from_utf16_lossy(&u[..u.len() - 1])
        };
        if n == "광주" {
            reg_id = Some("11B20702");
        } else if n == "울릉" {
            n = "울릉도".into();
        } else if n == "고성" {
            if region.contains("강원") {
                reg_id = Some("11D20402");
            } else if region.contains("경상남") {
                reg_id = Some("11H20404");
            }
        }
        name = Some(n);
    }
    (name, reg_id)
}
