//! Overseas current-air branch: normalized observation, WAQI body parsing, request-time
//! evaluation and the legacy `_applyAirObservation` rendering (#2628 at ca8735cf).
//! S13a adds the Google and OpenWeather parsers; the live chain is `air_chain::LiveAir`.
use super::{
    i18n::Locale,
    js::{Obj, Val, dot_time, iso},
    units::{
        air_grade_str, airkorea_grade_str, airnow_grade_str, index2grade, ppb2ppm, shorten_station,
        um2ppm, value2grade, value2index,
    },
    vc::parse_iso_z,
};
use crate::{
    budget::Provider,
    gateway::{BoxFuture, OrderedJson},
};

pub const POLLUTANTS: [&str; 6] = ["pm10", "pm25", "o3", "no2", "so2", "co"];
const FRESHNESS_MS: f64 = 8. * 3_600_000.;
const FUTURE_SLACK_MS: f64 = 3_600_000.;
const MAX_STATION_KM: f64 = 30.;

/// Normalized observation (PM in ug/m3, gases in ppm), as the legacy `observation.create`.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub provider: String,
    pub station_based: bool,
    pub observed_at: Option<String>,
    pub pollutants: Vec<(&'static str, f64)>,
    pub attribution: Val,
    pub station_name: Option<String>,
    pub station_geo: Option<[f64; 2]>,
}
fn finite(v: f64) -> bool {
    v.is_finite() && v >= 0.
}
/// Legacy `new Date(value)` for the provider time forms used by the adapters.
fn to_date(value: &Val) -> Option<f64> {
    match value {
        Val::Num(n) if n.is_finite() && n.abs() <= 8.64e15 => Some(n.trunc()),
        Val::Str(s) => {
            let ms = parse_iso_offset(s);
            ms.is_finite().then_some(ms)
        }
        Val::Date(ms) if ms.is_finite() => Some(*ms),
        _ => None,
    }
}
/// ISO 8601 date-time with `Z` or `+hh:mm`, as Date.parse accepts for these feeds.
pub(crate) fn parse_iso_offset(s: &str) -> f64 {
    if s.ends_with('Z') {
        let base = s.trim_end_matches('Z');
        let (main, frac) = base.split_once('.').unwrap_or((base, ""));
        let ms = parse_iso_z(&format!("{main}Z"));
        let frac_ms = if frac.is_empty() {
            0.
        } else if frac.bytes().all(|b| b.is_ascii_digit()) {
            format!("0.{frac}").parse::<f64>().unwrap_or(0.) * 1000.
        } else {
            return f64::NAN;
        };
        return ms + frac_ms.trunc();
    }
    if s.len() > 6 {
        let (main, zone) = s.split_at(s.len() - 6);
        let zb = zone.as_bytes();
        if (zb[0] == b'+' || zb[0] == b'-') && zb[3] == b':' {
            let h: f64 = zone[1..3].parse().unwrap_or(f64::NAN);
            let m: f64 = zone[4..6].parse().unwrap_or(f64::NAN);
            let sign = if zb[0] == b'-' { -1. } else { 1. };
            return parse_iso_offset(&format!("{main}Z")) - sign * (h * 60. + m) * 60_000.;
        }
    }
    f64::NAN
}
pub fn create(
    provider: &str,
    station_based: bool,
    observed_at: &Val,
    station_name: &Val,
    station_geo: &Val,
    pollutants: &[(&'static str, f64)],
    attribution: &Val,
) -> Observation {
    let geo = station_geo.arr().and_then(|g| {
        let (a, b) = (g.first()?.num()?, g.get(1)?.num()?);
        (a.is_finite() && b.is_finite()).then_some([a, b])
    });
    Observation {
        provider: provider.to_owned(),
        station_based,
        observed_at: to_date(observed_at).and_then(iso),
        pollutants: POLLUTANTS
            .iter()
            .filter_map(|c| {
                pollutants
                    .iter()
                    .find(|(k, _)| k == c)
                    .map(|(_, v)| *v)
                    .filter(|v| finite(*v))
                    .map(|v| (*c, v))
            })
            .collect(),
        attribution: if attribution.str().is_some() {
            attribution.clone()
        } else {
            Val::Str(provider.to_owned())
        },
        station_name: station_name
            .str()
            .filter(|s| !s.trim().is_empty())
            .map(shorten_station),
        station_geo: geo,
    }
}
/// `extractValue(type, Cp)` (US EPA sub-index -> concentration).
fn extract_value(code: &str, cp: f64) -> f64 {
    let table: &[(f64, f64, f64, f64)] = match code {
        "pm25" => &[
            (0., 12.0, 0., 50.),
            (12.1, 35.4, 51., 100.),
            (35.5, 55.4, 101., 150.),
            (55.5, 150.4, 151., 200.),
            (150.5, 250.4, 201., 300.),
            (250.5, 350.4, 301., 400.),
            (350.5, 500.4, 401., 500.),
        ],
        "pm10" => &[
            (0., 54., 0., 50.),
            (55., 154., 51., 100.),
            (155., 254., 101., 150.),
            (255., 354., 151., 200.),
            (355., 424., 201., 300.),
            (425., 504., 301., 400.),
            (505., 604., 401., 500.),
        ],
        "o3" => &[
            (0., 54., 0., 50.),
            (55., 70., 51., 100.),
            (71., 85., 101., 150.),
            (86., 105., 151., 200.),
            (106., 200., 201., 300.),
            (201., 504., 301., 400.),
            (505., 604., 401., 500.),
        ],
        "co" => &[
            (0., 4.4, 0., 50.),
            (4.5, 9.4, 51., 100.),
            (9.5, 12.4, 101., 150.),
            (12.5, 15.4, 151., 200.),
            (15.5, 30.4, 201., 300.),
            (30.5, 40.4, 301., 400.),
            (40.5, 50.4, 401., 500.),
        ],
        "no2" => &[
            (0., 53., 0., 50.),
            (54., 100., 51., 100.),
            (101., 360., 101., 150.),
            (361., 649., 151., 200.),
            (650., 1249., 201., 300.),
            (1250., 1649., 301., 400.),
            (1650., 2049., 401., 500.),
        ],
        "so2" => &[
            (0., 35., 0., 50.),
            (36., 75., 51., 100.),
            (76., 185., 101., 150.),
            (186., 304., 151., 200.),
            (305., 604., 201., 300.),
            (605., 1004., 301., 400.),
            (605., 1004., 401., 500.),
        ],
        _ => return -1.,
    };
    let value = cp;
    let row = table
        .iter()
        .take(6)
        .find(|(_, _, _, ihi)| value <= *ihi)
        .copied()
        .unwrap_or(table[6]);
    let (clo, chi, ilo, ihi) = row;
    let result = (value - ilo) * (chi - clo) / (ihi - ilo) + clo;
    if code == "pm10" || code == "pm25" {
        super::js::round(result)
    } else {
        super::js::fixed(result, 3)
    }
}
/// WAQI geo feed body -> observation (`providers/waqi.js` parse); None for an unusable body.
pub fn parse_waqi(body: &[u8]) -> Option<Observation> {
    let body = Val::from_ordered(&OrderedJson::parse(body).ok()?);
    if body.get("status").str() != Some("ok") {
        return None;
    }
    let data = body.get("data");
    data.obj()?;
    let t = data.get("time");
    let time = if let Some(s) = t.get("iso").str() {
        Val::Str(s.to_owned())
    } else if let (Some(s), Some(tz)) = (t.get("s").str(), t.get("tz").str()) {
        Val::Str(format!("{}{tz}", s.replacen(' ', "T", 1)))
    } else {
        Val::Undef
    };
    let iaqi = data.get("iaqi");
    iaqi.obj()?;
    let mut pollutants = Vec::new();
    for code in POLLUTANTS {
        let Some(v) = iaqi.get(code).get("v").num().filter(|v| finite(*v)) else {
            continue;
        };
        let value = extract_value(code, v);
        if !finite(value) {
            continue;
        }
        pollutants.push((
            code,
            if matches!(code, "o3" | "no2" | "so2") {
                ppb2ppm(value)
            } else {
                value
            },
        ));
    }
    let city = data.get("city");
    let names: Vec<String> = data
        .get("attributions")
        .arr()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("name").str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let attribution = if names.is_empty() {
        "World Air Quality Index Project".to_owned()
    } else {
        format!("World Air Quality Index Project; {}", names.join("; "))
    };
    Some(create(
        "aqicn",
        true,
        &time,
        city.get("name"),
        city.get("geo"),
        &pollutants,
        &Val::Str(attribution),
    ))
}
fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let rad = std::f64::consts::PI / 180.;
    let d_lat = (lat2 - lat1) * rad;
    let d_lon = (lon2 - lon1) * rad;
    let a = (d_lat / 2.).sin() * (d_lat / 2.).sin()
        + (lat1 * rad).cos() * (lat2 * rad).cos() * (d_lon / 2.).sin() * (d_lon / 2.).sin();
    6371. * 2. * a.sqrt().atan2((1. - a).sqrt())
}
/// `observation.evaluate`: whether the observation is usable for this request.
pub fn usable(o: &Observation, lat: f64, lon: f64, request_ms: f64) -> bool {
    let Some(observed) = o
        .observed_at
        .as_deref()
        .map(parse_iso_offset)
        .filter(|m| m.is_finite())
    else {
        return false;
    };
    let age = request_ms - observed;
    if age > FRESHNESS_MS || age < -FUTURE_SLACK_MS {
        return false;
    }
    if o.station_based {
        let Some([a, b]) = o.station_geo else {
            return false;
        };
        let distance = distance_km(lat, lon, a, b);
        if distance.is_nan() || distance > MAX_STATION_KM {
            return false;
        }
    }
    o.pollutants
        .iter()
        .any(|(c, _)| *c == "pm10" || *c == "pm25")
}
/// Enumerated `lib/air/observation.evaluate` outcome; no provider text enters a response.
pub fn rejection_reason(
    o: &Observation,
    lat: f64,
    lon: f64,
    request_ms: f64,
) -> Option<&'static str> {
    let Some(observed) = o
        .observed_at
        .as_deref()
        .map(parse_iso_offset)
        .filter(|m| m.is_finite())
    else {
        return Some("no-time");
    };
    let age = request_ms - observed;
    if age > FRESHNESS_MS {
        return Some("stale");
    }
    if age < -FUTURE_SLACK_MS {
        return Some("future");
    }
    if o.station_based {
        let Some([a, b]) = o.station_geo else {
            return Some("no-station-geo");
        };
        let distance = distance_km(lat, lon, a, b);
        if distance.is_nan() || distance > MAX_STATION_KM {
            return Some("too-far");
        }
    }
    if !o
        .pollutants
        .iter()
        .any(|(c, v)| (*c == "pm10" || *c == "pm25") && v.is_finite() && *v >= 0.)
    {
        return Some("no-pm");
    }
    None
}

fn attribution_text(v: &Val) -> Option<String> {
    let t = v.str()?.trim();
    (!t.is_empty()).then(|| t.to_owned())
}
/// `_applyAirObservation(current, observation, offsetMs, airUnit, res)`.
pub fn apply(current: &mut Obj, o: &Observation, offset_ms: f64, unit: &Val, ts: Locale) {
    let unit_s = unit.str().unwrap_or("");
    let mut indexes = Vec::new();
    let mut grades = Vec::new();
    for code in ["pm10", "pm25", "co", "so2", "no2", "o3"] {
        let Some(value) = o
            .pollutants
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, v)| *v)
        else {
            continue;
        };
        current.set(&format!("{code}Value"), value);
        let (index, grade, text) = if unit_s == "airnow" {
            let g = value2grade("airnow", code, value).unwrap_or(f64::NAN);
            (
                value2index("airnow", code, value).unwrap_or(f64::NAN),
                g,
                airnow_grade_str(g, ts),
            )
        } else if unit_s == "airkorea" || unit_s == "airkorea_who" {
            let g = value2grade(unit_s, code, value).unwrap_or(f64::NAN);
            (
                value2index(unit_s, code, value).unwrap_or(f64::NAN),
                g,
                airkorea_grade_str(g, ts),
            )
        } else {
            let i = value2index("aqicn", code, value).unwrap_or(f64::NAN);
            let g = index2grade("aqicn", &Val::Num(i)).unwrap_or(f64::NAN);
            (i, g, airnow_grade_str(g, ts))
        };
        current.set(&format!("{code}Str"), text);
        current.set(&format!("{code}Grade"), grade);
        indexes.push(index);
        grades.push(grade);
    }
    let max = |l: &[f64]| {
        l.iter().fold(f64::NEG_INFINITY, |m, v| {
            if v.is_nan() || m.is_nan() {
                f64::NAN
            } else {
                m.max(*v)
            }
        })
    };
    if !indexes.is_empty() {
        let mut value = max(&indexes);
        current.set("aqiValue", value);
        if unit_s == "airnow" {
            let g = max(&grades);
            current.set("aqiGrade", g);
            current.set("aqiStr", airnow_grade_str(g, ts));
        } else if unit_s == "airkorea_who" {
            let g = max(&grades);
            current.set("aqiGrade", g);
            current.set("aqiStr", airkorea_grade_str(g, ts));
        } else if unit_s == "airkorea" {
            let extra = indexes.iter().filter(|v| **v > 100.).count();
            if extra >= 3 {
                value += 75.;
            } else if extra >= 2 {
                value += 50.;
            }
            current.set("aqiValue", value);
            let g = index2grade("airkorea", &Val::Num(value)).unwrap_or(f64::NAN);
            current.set("aqiGrade", g);
            current.set("aqiStr", airkorea_grade_str(g, ts));
        } else {
            let g = index2grade("aqicn", &Val::Num(value)).unwrap_or(f64::NAN);
            current.set("aqiGrade", g);
            current.set("aqiStr", air_grade_str("aqicn", g, ts));
        }
    }
    if let Some(observed) = o
        .observed_at
        .as_deref()
        .map(parse_iso_offset)
        .filter(|m| m.is_finite())
    {
        current.set("mTime", dot_time(observed + offset_ms).replace('.', "-"));
    }
    current.set("airSource", o.provider.clone());
    if let Some(text) = attribution_text(&o.attribution) {
        current.set("airAttribution", text);
    }
    if let Some(name) = &o.station_name {
        current.set("mCity", name.clone());
    }
}
/// Result of the air branch for one request.
#[derive(Clone, Debug)]
pub enum AirOutcome {
    /// No usable observation (including the legacy `no-provider` case).
    None,
    /// The air deadline released the weather (`airStatus` pending).
    Pending,
    Observation(Observation),
}
/// Request-time air source. `lat`/`lon` are the precise request coordinates (never stored).
pub trait AirSource: Send + Sync + 'static {
    fn current(&self, lat: f64, lon: f64, request_ms: f64) -> BoxFuture<'_, AirOutcome>;
    /// NationAir needs the safe legacy reason that ordinary weather intentionally omits.
    /// Sources without detail retain their old outcome and an explicit unavailable reason.
    fn current_with_reason(
        &self,
        lat: f64,
        lon: f64,
        request_ms: f64,
    ) -> BoxFuture<'_, (AirOutcome, Option<&'static str>)> {
        Box::pin(async move {
            let outcome = self.current(lat, lon, request_ms).await;
            let reason = match &outcome {
                AirOutcome::Observation(o) => rejection_reason(o, lat, lon, request_ms),
                AirOutcome::Pending => Some("deadline"),
                AirOutcome::None => Some("fallback-unavailable"),
            };
            (outcome, reason)
        })
    }
}
/// Legacy behavior with no configured air provider key: no air fields.
pub struct Unconfigured;
impl AirSource for Unconfigured {
    fn current(&self, _: f64, _: f64, _: f64) -> BoxFuture<'_, AirOutcome> {
        Box::pin(async { AirOutcome::None })
    }
    fn current_with_reason(
        &self,
        _: f64,
        _: f64,
        _: f64,
    ) -> BoxFuture<'_, (AirOutcome, Option<&'static str>)> {
        Box::pin(async { (AirOutcome::None, Some("no-provider")) })
    }
}

/// Free-phase air providers in the legacy `FREE_ORDER` (S13a).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AirProvider {
    Google,
    OpenWeather,
    Waqi,
}
impl AirProvider {
    /// `config/air.js` FREE_ORDER: Google -> OpenWeather -> WAQI (aqicn).
    pub const ORDER: [AirProvider; 3] = [Self::Google, Self::OpenWeather, Self::Waqi];
    /// Raw record source.
    pub fn source(self) -> &'static str {
        match self {
            Self::Google => "air-google",
            Self::OpenWeather => "air-openweather",
            Self::Waqi => "air-waqi",
        }
    }
    pub fn from_source(source: &str) -> Option<Self> {
        Self::ORDER.into_iter().find(|p| p.source() == source)
    }
    /// S08 funding identity.
    pub fn budget(self) -> Provider {
        match self {
            Self::Google => Provider::GoogleAirQuality,
            Self::OpenWeather => Provider::OpenWeather,
            Self::Waqi => Provider::Waqi,
        }
    }
    /// The adapter's `parse` for a 2xx body; None is the legacy `invalid-body` failure.
    pub fn parse(self, body: &[u8]) -> Option<Observation> {
        match self {
            Self::Google => parse_google(body),
            Self::OpenWeather => parse_openweather(body),
            Self::Waqi => parse_waqi(body),
        }
    }
}
const GASES: [&str; 4] = ["o3", "no2", "so2", "co"];
/// `observation.fromUgm3`: PM stays ug/m3; a gas becomes ppm by the molar conversion.
fn from_ugm3(code: &str, value: &Val) -> Option<f64> {
    let v = value.num().filter(|v| finite(*v))?;
    if !GASES.contains(&code) {
        return Some(v);
    }
    Some(um2ppm(code, v)).filter(|p| finite(*p))
}
/// Set a pollutant like the legacy object assignment (a later duplicate wins).
fn assign(list: &mut Vec<(&'static str, f64)>, code: &'static str, value: f64) {
    match list.iter_mut().find(|(c, _)| *c == code) {
        Some(slot) => slot.1 = value,
        None => list.push((code, value)),
    }
}
fn json_object(body: &[u8]) -> Option<Val> {
    // httpClient: a 2xx body must parse to a non-null object (arrays included).
    let v = Val::from_ordered(&OrderedJson::parse(body).ok()?);
    matches!(v, Val::Obj(_) | Val::Arr(_)).then_some(v)
}
/// Google Air Quality `currentConditions:lookup` body (`providers/google.js` parse).
pub fn parse_google(body: &[u8]) -> Option<Observation> {
    let body = json_object(body)?;
    let items = body.get("pollutants").arr()?;
    let time = body.get("dateTime").str()?.to_owned();
    let mut pollutants = Vec::new();
    for item in items {
        let Some(code) = item
            .get("code")
            .str()
            .and_then(|c| POLLUTANTS.iter().find(|p| **p == c).copied())
        else {
            continue;
        };
        let c = item.get("concentration");
        if c.obj().is_none() || !c.get("value").num().is_some_and(finite) {
            continue;
        }
        let value = match c.get("units").str() {
            Some("MICROGRAMS_PER_CUBIC_METER") => from_ugm3(code, c.get("value")),
            Some("PARTS_PER_BILLION") if GASES.contains(&code) => {
                c.get("value").num().map(ppb2ppm).filter(|v| finite(*v))
            }
            Some("PARTS_PER_MILLION") if GASES.contains(&code) => c.get("value").num(),
            _ => None,
        };
        if let Some(v) = value {
            assign(&mut pollutants, code, v);
        }
    }
    Some(create(
        "google",
        false,
        &Val::Str(time),
        &Val::Undef,
        &Val::Undef,
        &pollutants,
        &Val::Str("Google Air Quality".into()),
    ))
}
/// OpenWeather `/data/2.5/air_pollution` body (`providers/openweather.js` parse).
pub fn parse_openweather(body: &[u8]) -> Option<Observation> {
    let body = json_object(body)?;
    let item = body.get("list").arr()?.first()?;
    item.obj()?;
    let components = item.get("components");
    let dt = item.get("dt").num().filter(|v| finite(*v))?;
    if components.obj().is_none() && components.arr().is_none() {
        return None;
    }
    let mut pollutants = Vec::new();
    for (field, code) in [
        ("pm2_5", "pm25"),
        ("pm10", "pm10"),
        ("o3", "o3"),
        ("no2", "no2"),
        ("so2", "so2"),
        ("co", "co"),
    ] {
        if let Some(v) = from_ugm3(code, components.get(field)) {
            assign(&mut pollutants, code, v);
        }
    }
    Some(create(
        "openweather",
        false,
        &Val::Num(dt * 1000.),
        &Val::Undef,
        &Val::Undef,
        &pollutants,
        &Val::Str("OpenWeather".into()),
    ))
}
