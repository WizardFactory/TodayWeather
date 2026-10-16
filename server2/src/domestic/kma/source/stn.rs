//! The station store answers of the v000903 chain (`server/controllers/
//! controllerKmaStnWeather.js`): `getStnHourlyAndMinRns(townInfo, dateTime, current)` and
//! `getCityHourlyList(townInfo)` over the rebuilt `KmaStnInfo`, `KmaStnHourly2` and
//! `KmaStnMinute2` collections. Answers are the objects legacy hands to the controller (insertion
//! order, `undefined` kept, Dates as Dates).
use super::doc::{Doc, Val};
use super::stations::{Registry, RowStore, date_of};
use crate::domestic::kma::js::{V, parse_int};

const MINUTE: f64 = 60_000.;
const HOUR: f64 = 3_600_000.;
const DAY: f64 = 86_400_000.;

/// The station inputs of one request.
pub struct Stations<'a> {
    pub registry: &'a Registry,
    pub hourly: &'a RowStore,
    pub minute: &'a RowStore,
}
/// A legacy callback error (the controller logs it and continues without station data).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StnError(pub String);

fn coords(town: &serde_json::Value) -> Result<(f64, f64), StnError> {
    let g = town.get("gCoord").ok_or(StnError("no gCoord".into()))?;
    match (
        g.get("lon").and_then(serde_json::Value::as_f64),
        g.get("lat").and_then(serde_json::Value::as_f64),
    ) {
        (Some(lon), Some(lat)) => Ok((lon, lat)),
        _ => Err(StnError("coordinates are not numbers".into())),
    }
}
/// `parseInt(stnInfo.stnId)`.
fn stn_number(d: &Doc) -> f64 {
    match d.get("stnId") {
        Some(Val::Str(s)) => parse_int(&V::s(s)),
        Some(Val::Num(n)) => parse_int(&V::Num(*n)),
        _ => f64::NAN,
    }
}
fn two(n: i64) -> String {
    format!("{n:02}")
}
/// `kmaTimeLib.convertDateToYYYYoMMoDDoHHoMM(date)` in the UTC process.
pub fn dotted_minute(ms: f64) -> String {
    match crate::world::js::parts(ms) {
        Some(p) if ms.is_finite() => format!(
            "{}.{}.{}.{}:{}",
            p.year,
            two(p.month),
            two(p.day),
            two(p.hour),
            two(p.minute)
        ),
        _ => "NaN.NaN.NaN.NaN:NaN".into(),
    }
}
/// `kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM` / `...HHoZZ` (`substr` based).
fn dotted(date_time: &str, hour_only: bool) -> String {
    let u: Vec<u16> = crate::domestic::kma::js::units(date_time);
    let sub = |a: usize, n: usize| {
        crate::domestic::kma::js::from16(&u[a.min(u.len())..(a + n).min(u.len())])
    };
    let mut s = format!("{}.{}.{}", sub(0, 4), sub(4, 2), sub(6, 2));
    if u.len() > 8 {
        s += &format!(
            ".{}:{}",
            sub(8, 2),
            if hour_only { "00".into() } else { sub(10, 2) }
        );
    }
    s
}
fn rns_rule(w: &mut Doc) {
    let gt0 = matches!(w.get("rs15m"), Some(Val::Num(n)) if *n > 0.);
    if w.get("rns") == Some(&Val::Bool(false)) && gt0 {
        w.set("rns", Val::Bool(true));
        w.set("rnsSource", Val::str("rs15m"));
    }
}
fn copy_into(target: &mut Doc, source: &Doc) {
    for (k, v) in source.entries() {
        target.set(k, v.clone());
    }
}

impl Stations<'_> {
    /// `_getStnMinute2(stn, dateTime)`: the station object with the newest minute row of the
    /// last 20 minutes copied in (date as text) and `rns` true when any row had rain.
    fn minute2(&self, stn: &Doc, date_time: &str) -> Result<Doc, StnError> {
        let limit = super::pages::page_date(date_time) - 20. * MINUTE;
        let rows = self.minute.after(stn_number(stn), limit);
        let Some(last) = rows.last() else {
            return Err(StnError(format!(
                "Fail to find stn Weather info of stnId={}",
                stn.get("stnId").map(js_text).unwrap_or_default()
            )));
        };
        let rns = rows.iter().any(|r| r.get("rns") == Some(&Val::Bool(true)));
        let mut out = stn.clone();
        for (k, v) in last.entries() {
            if k == "date" {
                out.set(k, Val::str(dotted_minute(date_of(last))));
            } else {
                out.set(k, v.clone());
            }
        }
        if rns {
            out.set("rns", Val::Bool(true));
        }
        Ok(out)
    }
    /// `getStnHourlyAndMinRns(townInfo, dateTime, current)`.
    pub fn hourly_and_min_rns(
        &self,
        town: &serde_json::Value,
        date_time: &str,
    ) -> Result<Doc, StnError> {
        let (lon, lat) = coords(town)?;
        let stn_date_time = dotted(date_time, false);
        let stn_date_hour = dotted(date_time, true);
        let mut w = Doc::new();
        let stn = self
            .registry
            .near(lon, lat, Some(1.), true, 1)
            .into_iter()
            .next()
            .ok_or_else(|| no_station(lon, lat))?;
        copy_into(&mut w, &stn);
        let from = super::pages::page_date(&stn_date_hour) - 2. * HOUR;
        let hourly = self.hourly.after(stn_number(&stn), from);
        match hourly.last() {
            None => w.set("hourlyMissing", Val::Bool(true)),
            Some(row) => {
                copy_into(&mut w, row);
                rns_rule(&mut w);
                w.set("cityHourAws", Val::Doc(row.clone()));
            }
        }
        let minute = self.minute2(&stn, &stn_date_time)?;
        copy_into(&mut w, &minute);
        rns_rule(&mut w);
        w.set("cityMinAws", Val::Doc(minute));
        let near = self.registry.near(lon, lat, Some(0.2), false, 5);
        if let Some(first) = near.first() {
            w.set(
                "nearStnId",
                first.get("stnId").cloned().unwrap_or(Val::Undef),
            );
            w.set(
                "nearStnName",
                first.get("stnName").cloned().unwrap_or(Val::Undef),
            );
        }
        if near.len() >= 2
            && let Some(result) = self.check_precip(&near, &stn_date_time)
        {
            let field = |k: &str| result.get(k).cloned().unwrap_or(Val::Undef);
            w.set("rns", field("rns"));
            w.set("rs15m", field("rs15m"));
            w.set("rnsStnId", field("stnId"));
            w.set("rnsStnName", field("stnName"));
            w.set("rnsDate", field("date"));
            rns_rule(&mut w);
            w.set("localMinAws", Val::Doc(result));
        }
        let date = w.get("date").cloned().unwrap_or(Val::Undef);
        w.set("stnDateTime", date);
        if let Some(Val::Str(weather)) = w.get("weather")
            && !weather.is_empty()
        {
            let t = crate::world::units::weather_type(&crate::world::js::Val::Str(weather.clone()))
                .unwrap_or(-1.);
            w.set("weatherType", Val::Num(t));
        }
        Ok(w)
    }
    /// `_checkPrecipFromStnMinuteList(stnList, dateTime)` + `_findRainStnMinuteList`.
    fn check_precip(&self, list: &[Doc], date_time: &str) -> Option<Doc> {
        let limit = super::pages::page_date(date_time) - 15. * MINUTE;
        let ids: Vec<f64> = list.iter().map(stn_number).collect();
        let rows = self.minute.any_after_desc(&ids, limit);
        let mut rain: Vec<&Doc> = Vec::new();
        for (i, row) in rows.iter().enumerate() {
            // `minWeather.date === date`: the same Date object only for the row that set it.
            let first_of_list = rain.is_empty();
            let rs = matches!(row.get("rs15m"), Some(Val::Num(n)) if *n > 0.);
            let qualifies = (rs && first_of_list) || row.get("rns") == Some(&Val::Bool(true));
            let _ = i;
            if qualifies && !rain.iter().any(|r| r.get("stnId") == row.get("stnId")) {
                rain.push(row);
            }
            if rain.len() >= 2 {
                break;
            }
        }
        if rain.len() < 2 {
            return None;
        }
        let found = list.iter().find_map(|stn| {
            rain.iter()
                .find(|r| loose_eq(r.get("stnId"), stn.get("stnId")))
                .copied()
        })?;
        let mut out = found.clone();
        out.set("date", Val::str(dotted_minute(date_of(found))));
        Some(out)
    }
    /// `getCityHourlyList(townInfo)` at `now_ms`.
    pub fn city_hourly(&self, town: &serde_json::Value, now_ms: f64) -> Result<Vec<Doc>, StnError> {
        let (lon, lat) = coords(town)?;
        let stn = self
            .registry
            .near(lon, lat, Some(1.), true, 1)
            .into_iter()
            .next()
            .ok_or_else(|| no_station(lon, lat))?;
        // `toTimeZone(9, new Date())` then `setDate(getDate() - 8)`.
        let from = now_ms + 9. * HOUR - 8. * DAY;
        let rows = self.hourly.after(stn_number(&stn), from);
        if rows.is_empty() {
            return Err(StnError("Fail to find hourlies".into()));
        }
        Ok(rows)
    }
}
/// `getStnList`'s empty-result error (`"..." + coords` joins the array).
fn no_station(lon: f64, lat: f64) -> StnError {
    use crate::gateway::response::js_number;
    StnError(format!(
        "Fail to find stn coords={},{}",
        js_number(lon),
        js_number(lat)
    ))
}
/// `a == b` for a numeric row id and a text registry id.
fn loose_eq(a: Option<&Val>, b: Option<&Val>) -> bool {
    match (a, b) {
        (Some(Val::Num(x)), Some(Val::Str(s))) | (Some(Val::Str(s)), Some(Val::Num(x))) => {
            crate::world::js::string_to_number(s) == *x
        }
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}
fn js_text(v: &Val) -> String {
    match v {
        Val::Str(s) => s.clone(),
        Val::Num(n) => crate::gateway::response::js_number(*n),
        _ => String::new(),
    }
}
