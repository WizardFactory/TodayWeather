//! Legacy `/v00090X/dsf/coord` assembly after `getDsfData`, in route order:
//! convertDsfLocalTime -> mergeDsfDailyData -> mergeDsfCurrentDataNewForm -> mergeDsfHourlyData
//! -> mergeAqi -> dataSort -> [skyIconLowCase] -> convertUnits -> makeAirInfo -> makeSummary
//! -> sendResult. Port of controllerWorldWeather.js and controller.ww.units.js at ca8735cf.
use super::{
    Version,
    air::{AirOutcome, apply},
    i18n::Locale,
    js::{
        Obj, Val, cmp_str, diff_days, dot_time, fixed, hours_of, js_sort, parse_dot, round,
        yyyymmdd,
    },
    records::Dsf,
    units::{
        UNIT_LIST, action_guide, convert, default_unit, humidity_icon, shorten_station, summary,
        summary_air, summary_weather, ultrv_grade, ultrv_str, value2index, weather_str,
        weather_type, wind_dir_name,
    },
    vc::js_string,
};

/// Legacy middleware error that reaches Express' error handler (500).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Failed;

fn date_ms(v: &Val) -> f64 {
    match v {
        Val::Date(ms) => *ms,
        Val::Str(s) => parse_dot(s),
        other => other.to_number(),
    }
}
fn str_of(v: &Val) -> String {
    v.str().map_or_else(|| js_string(v), str::to_owned)
}
/// `_getTimeString(tzOffset, cDate)`.
fn time_string(offset_min: &Val, c_ms: f64) -> String {
    let offset = if offset_min.is_undef() {
        540.
    } else {
        offset_min.to_number()
    };
    dot_time(c_ms + offset * 60_000.)
}
fn prefix(s: &str, n: usize) -> &str {
    let end = s.char_indices().nth(n).map_or(s.len(), |(i, _)| i);
    &s[..end]
}
/// `_compareDateString`: equal through the hour.
fn same_hour(a: &str, b: &str) -> bool {
    prefix(a, 13) == prefix(b, 13)
}
fn is_value(v: &Val) -> bool {
    !v.is_nullish() && v.num() != Some(-100.)
}
fn to_c(f: f64) -> f64 {
    fixed((f - 32.) / (9. / 5.), 1)
}
fn add_uv(target: &mut Obj, summary: &Obj, ts: Locale) {
    if let Some(v) = summary
        .get("uvIndex")
        .num()
        .filter(|v| v.is_finite() && *v >= 0.)
    {
        target.set("uvIndex", v);
        target.set("ultrv", v);
        let g = ultrv_grade(v);
        target.set("ultrvGrade", g);
        target.set("ultrvStr", ultrv_str(g, ts));
    }
}
/// `_getPrecType(icon, pro, type)`.
fn prec_type(icon: &Val, pro: &Val, ty: &Val) -> f64 {
    let pro = pro.to_number();
    let mut prec = 0.;
    if icon.truthy() {
        match icon.str() {
            Some("rain") => prec = 1.,
            Some("snow") => prec = 2.,
            Some("sleet" | "hail") => prec = 3.,
            _ if pro < 0.5 => return prec,
            _ => (),
        }
    } else if pro < 0.5 {
        return prec;
    }
    match ty.str() {
        Some("rain") => 1.,
        Some("snow") => 2.,
        Some("sleet") => 3.,
        _ => prec,
    }
}
/// `_parseWorldSkyState(precType, cloud, isNight)`.
fn sky_state(prec: &Val, cloud: &Val, night: bool) -> String {
    let mut name = String::from(if night { "Moon" } else { "Sun" });
    if !cloud.is_nullish() {
        let c = cloud.to_number();
        if c <= 20. {
        } else if c <= 50. {
            name.push_str("SmallCloud");
        } else if c <= 80. {
            name.push_str("BigCloud");
        } else {
            name = "Cloud".into();
        }
    } else if prec.to_number() > 0. {
        name = "Cloud".into();
    }
    match prec {
        Val::Num(p) if *p == 1. => name.push_str("Rain"),
        Val::Num(p) if *p == 2. => name.push_str("Snow"),
        Val::Num(p) if *p == 3. || *p == 4. => name.push_str("RainSnow"),
        _ => (),
    }
    name
}
fn make_daily(s: &Obj, ts: Locale) -> Obj {
    let mut day = Obj::new();
    add_uv(&mut day, s, ts);
    if s.get("dateObj").truthy() {
        day.set("date", s.get("dateObj").clone());
    } else if s.get("date").truthy() {
        day.set("date", s.get("date").clone());
    }
    if s.get("summary").truthy() {
        day.set("desc", s.get("summary").clone());
    }
    if s.get("sunrise").truthy() {
        day.set("sunrise", s.get("sunrise").clone());
    }
    if s.get("sunset").truthy() {
        day.set("sunset", s.get("sunset").clone());
    }
    for (src, c, f) in [
        ("temp_max", "tempMax_c", "tempMax_f"),
        ("temp_min", "tempMin_c", "tempMin_f"),
        ("ftemp_max", "ftempMax_c", "ftempMax_f"),
        ("ftemp_min", "ftempMin_c", "ftempMin_f"),
    ] {
        if is_value(s.get(src)) {
            let v = s.get(src).to_number();
            day.set(c, to_c(v));
            day.set(f, fixed(v, 1));
        }
    }
    let cloud = s.get("cloud");
    if cloud.truthy() {
        let c = cloud.to_number();
        day.set("cloud", if c > 0. { round(c * 100.) } else { 0. });
    }
    day.set("precType", 0.);
    day.set(
        "precType",
        prec_type(s.get("icon"), s.get("pre_pro"), s.get("pre_type")),
    );
    if s.get("pre_pro").truthy() {
        let p = s.get("pre_pro").to_number();
        day.set("precProb", if p > 0. { round(p * 100.) } else { 0. });
    }
    if s.get("pre_int").truthy() {
        let p = s.get("pre_int").to_number();
        day.set("precip", if p > 0. { fixed(p * 25.4 * 24., 2) } else { 0. });
    }
    if s.get("humid").to_number() > 0. {
        day.set("humid", round(s.get("humid").to_number() * 100.));
    }
    if s.get("windspd").truthy() {
        let w = s.get("windspd").to_number();
        let mh = if w > 0. { w } else { 0. };
        day.set("windSpd_mh", mh);
        day.set("windSpd_ms", fixed(mh * 0.44704, 2));
    }
    if s.get("winddir").to_number() > 0. {
        day.set("windDir", s.get("winddir").clone());
    }
    if s.get("pres").to_number() > 0. {
        day.set("press", s.get("pres").clone());
    }
    if s.get("vis").truthy() && s.get("vis").to_number() != -100. {
        day.set("vis", fixed(s.get("vis").to_number() * 1.609344, 2));
    }
    let sky = sky_state(day.get("precType"), day.get("cloud"), false);
    day.set("skyIcon", sky);
    day
}
/// `_isNight(current, dailyInfo)` over the record's own daily points.
fn is_night(current: &str, daily: &[Val]) -> bool {
    for d in daily.iter().take(daily.len().saturating_sub(1)) {
        let day = str_of(d.get("dateObj"));
        if *current >= *prefix(&day, 13) {
            let now = Val::Str(current.into());
            return lt(&now, d.get("sunrise")) || ge(&now, d.get("sunset"));
        }
    }
    false
}
/// Abstract relational comparison for the string/number/null mixes in legacy code.
fn compare(a: &Val, b: &Val) -> Option<std::cmp::Ordering> {
    match (a, b) {
        (Val::Str(x), Val::Str(y)) => Some(x.encode_utf16().cmp(y.encode_utf16())),
        _ => a.to_number().partial_cmp(&b.to_number()),
    }
}
fn lt(a: &Val, b: &Val) -> bool {
    compare(a, b) == Some(std::cmp::Ordering::Less)
}
fn le(a: &Val, b: &Val) -> bool {
    matches!(
        compare(a, b),
        Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
    )
}
fn ge(a: &Val, b: &Val) -> bool {
    matches!(
        compare(a, b),
        Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
    )
}
/// `_getSunTime(name, date, list)` over assembled daily rows.
fn sun_time(name: &str, date: &str, list: &[Val]) -> Val {
    for d in list.iter().take(list.len().saturating_sub(1)) {
        if prefix(date, 10) == prefix(&str_of(d.get("date")), 10) {
            return d.get(name).clone();
        }
    }
    Val::Undef
}
fn avg(list: &[Val]) -> f64 {
    let mut total = 0.;
    let mut n = 0;
    for v in list {
        if !v.is_nullish() {
            total += v.to_number();
            n += 1;
        }
    }
    if n == 0 { -1. } else { total / f64::from(n) }
}
fn make_current(s: &Obj, ts: Locale) -> Result<Obj, Failed> {
    let mut c = Obj::new();
    add_uv(&mut c, s, ts);
    if s.get("dateObj").truthy() {
        c.set("date", s.get("dateObj").clone());
    } else if s.get("date").truthy() {
        c.set("date", s.get("date").clone());
    }
    if s.get("summary").truthy() {
        c.set("desc", s.get("summary").clone());
        let t = weather_type(s.get("summary")).map_err(|_| Failed)?;
        c.set("weatherType", t);
        c.set("desc", weather_str(t, ts));
    }
    if is_value(s.get("temp")) {
        let v = s.get("temp").to_number();
        c.set("temp_c", to_c(v));
        c.set("temp_f", fixed(v, 1));
    }
    if is_value(s.get("ftemp")) {
        let v = s.get("ftemp").to_number();
        c.set("ftemp_c", to_c(v));
        c.set("ftemp_f", fixed(v, 1));
    }
    if s.get("cloud").truthy() {
        let v = s.get("cloud").to_number();
        c.set("cloud", if v > 0. { round(v * 100.) } else { 0. });
    }
    if s.get("windspd").truthy() {
        let v = s.get("windspd").to_number();
        if v > 0. {
            c.set("windSpd_mh", v);
            c.set("windSpd_ms", fixed(v * 0.44704, 2));
        } else {
            c.set("windSpd_mh", 0.);
            c.set("windSpd_ms", 0.);
        }
    }
    if s.get("winddir").to_number() > 0. {
        c.set("windDir", s.get("winddir").clone());
    }
    if s.get("humid").truthy() {
        let v = s.get("humid").to_number();
        c.set("humid", if v > 0. { round(v * 100.) } else { 0. });
    }
    c.set(
        "precType",
        prec_type(s.get("icon"), s.get("pre_pro"), s.get("pre_type")),
    );
    if s.get("pre_pro").truthy() {
        let v = s.get("pre_pro").to_number();
        c.set("precProb", if v > 0. { fixed(v * 100., 2) } else { 0. });
    }
    if s.get("pre_int").truthy() {
        let v = s.get("pre_int").to_number();
        c.set("precip", if v > 0. { fixed(v * 25.4, 1) } else { 0. });
    }
    if s.get("vis").truthy() {
        let v = s.get("vis").to_number();
        c.set("vis", if v > 0. { round(v * 1.609344) } else { 0. });
    }
    if s.get("pres").to_number() > 0. {
        c.set("press", s.get("pres").clone());
    }
    if s.get("oz").truthy() {
        c.set("oz", s.get("oz").clone());
    }
    Ok(c)
}
fn make_hourly(
    s: &Obj,
    s2: Option<&Obj>,
    s1: Option<&Obj>,
    daily: &[Val],
    ts: Locale,
) -> Result<Obj, Failed> {
    let empty = Obj::new();
    let s2 = s2.unwrap_or(&empty);
    let s1 = s1.unwrap_or(&empty);
    let mut h = Obj::new();
    if s.get("dateObj").truthy() {
        h.set("date", s.get("dateObj").clone());
    } else if s.get("date").truthy() {
        h.set("date", s.get("date").clone());
    }
    if is_value(s.get("temp")) {
        let v = s.get("temp").to_number();
        h.set("temp_c", to_c(v));
        h.set("temp_f", fixed(v, 1));
    }
    if is_value(s.get("ftemp")) {
        let v = s.get("ftemp").to_number();
        h.set("ftemp_c", to_c(v));
        h.set("ftemp_f", fixed(v, 1));
    }
    let date = s.get("dateObj");
    let date_s = str_of(date);
    let sunrise = sun_time("sunrise", &date_s, daily);
    let sunset = sun_time("sunset", &date_s, daily);
    let night = !(lt(&sunrise, date) && le(date, &sunset));
    let clouds: Vec<Val> = [s, s2, s1]
        .iter()
        .filter(|x| x.get("cloud").to_number() > 0.)
        .map(|x| x.get("cloud").clone())
        .collect();
    h.set(
        "cloud",
        if clouds.is_empty() {
            0.
        } else {
            round(avg(&clouds) * 100.)
        },
    );
    if s.get("windspd").truthy() {
        let v = s.get("windspd").to_number();
        if v > 0. {
            h.set("windSpd_mh", v);
            h.set("windSpd_ms", fixed(v * 0.44704, 2));
        } else {
            h.set("windSpd_mh", 0.);
            h.set("windSpd_ms", 0.);
        }
    }
    if s.get("winddir").to_number() > 0. {
        h.set("windDir", s.get("winddir").clone());
    }
    if s.get("humid").truthy() {
        let v = s.get("humid").to_number();
        h.set("humid", if v > 0. { round(v * 100.) } else { 0. });
    }
    let p = prec_type(s.get("icon"), s.get("pre_pro"), s.get("pre_type"));
    let p2 = prec_type(s2.get("icon"), s2.get("pre_pro"), s2.get("pre_type"));
    let p1 = prec_type(s1.get("icon"), s1.get("pre_pro"), s1.get("pre_type"));
    let mut prec = 0.;
    if p == 1. || p2 == 1. || p1 == 1. {
        prec = 1.;
    }
    if p == 2. || p2 == 2. || p1 == 2. {
        prec += 2.;
    }
    if p == 3. || p2 == 3. || p1 == 3. {
        prec = 3.;
    }
    h.set("precType", prec);
    let mut max = 0.;
    for x in [s, s2, s1] {
        let v = x.get("pre_pro").to_number();
        if v > max {
            max = v;
        }
    }
    h.set("precProb", round(max * 100.));
    let mut sum = 0.;
    for x in [s, s2, s1] {
        let v = x.get("pre_int").to_number();
        if v >= 0. {
            sum += v;
        }
    }
    h.set("precip", fixed(sum * 25.4, 2));
    let vis: Vec<Val> = [s, s2, s1]
        .iter()
        .map(|x| {
            if x.get("vis").to_number() > 0. {
                x.get("vis").clone()
            } else {
                Val::Undef
            }
        })
        .collect();
    h.set("vis", fixed(avg(&vis) * 1.609344, 2));
    if s.get("pres").to_number() > 0. {
        h.set("press", s.get("pres").clone());
    }
    let oz: Vec<Val> = [s, s2, s1].iter().map(|x| x.get("oz").clone()).collect();
    h.set("oz", fixed(avg(&oz), 2));
    h.set("desc", Val::Undef);
    let t = weather_type(s.get("summary")).map_err(|_| Failed)?;
    h.set("weatherType", t);
    h.set("desc", weather_str(t, ts));
    let sky = sky_state(h.get("precType"), h.get("cloud"), night);
    h.set("skyIcon", sky);
    Ok(h)
}
fn lower_icon(s: &str) -> String {
    let mut out = s.to_owned();
    for (from, to) in [
        ("Sun", "sun"),
        ("Moon", "moon"),
        ("SmallCloud", "_smallcloud"),
        ("BigCloud", "_bigcloud"),
        ("Cloud", "cloud"),
        ("RainSnow", "_rainsnow"),
        ("Rain", "_rain"),
        ("Snow", "_snow"),
        ("Lightning", "_lightning"),
    ] {
        out = out.replacen(from, to, 1);
    }
    out
}
fn this_time_units(w: &mut Obj, q: &Obj) {
    let to_temp = q.get("temperatureUnit").clone();
    w.set(
        "pty",
        if w.get("precType").truthy() {
            w.get("precType").clone()
        } else {
            Val::Num(0.)
        },
    );
    if to_temp.str() == Some("C") {
        w.set("t1h", w.get("temp_c").clone());
        w.set("sensorytem", w.get("ftemp_c").clone());
    } else if to_temp.str() == Some("F") {
        w.set("t1h", w.get("temp_f").clone());
        w.set("sensorytem", w.get("ftemp_f").clone());
    }
    let reh = if w.get("humid").truthy() {
        w.get("humid").clone()
    } else {
        Val::Num(0.)
    };
    w.set("reh", reh.clone());
    w.set("humidityIcon", humidity_icon(&reh));
    if w.has("precip") {
        let v = convert("mm", q.get("precipitationUnit"), w.get("precip"));
        w.set("rn1", v);
    }
    if w.has("windSpd_ms") {
        let v = convert("m/s", q.get("windSpeedUnit"), w.get("windSpd_ms"));
        w.set("wsd", v);
    }
    let v = convert("hPa", q.get("pressureUnit"), w.get("press"));
    w.set("hPa", v);
    let v = convert("km", q.get("distanceUnit"), w.get("vis"));
    w.set("visibility", v);
    w.set("stnDateTime", w.get("date").clone());
    let wdd = wind_dir_name(w.get("windDir"));
    w.set("wdd", wdd);
    w.set("dateObj", w.get("date").clone());
    let ymd = yyyymmdd(&str_of(w.get("date")));
    w.set("date", ymd);
}
fn rain_fields(w: &mut Obj, q: &Obj, current_date: &str) {
    if !w.has("precip") {
        return;
    }
    let to = q.get("precipitationUnit");
    let rounded = |v: Val| Val::Num(fixed(v.to_number(), 1));
    if le(w.get("date"), &Val::Str(current_date.into())) {
        let v = rounded(convert("mm", to, w.get("precip")));
        w.set("rn1", v);
    } else {
        let p = w.get("precType").clone();
        if p.num() == Some(1.) {
            let v = rounded(convert("mm", to, w.get("precip")));
            w.set("r06", v);
        } else if p.num() == Some(2.) {
            let v = rounded(convert("mm", to, w.get("precip")));
            w.set("r06", v);
            let v = rounded(convert("mm", to, w.get("precip")));
            w.set("s06", v);
        } else if p.num() == Some(3.) {
            let v = rounded(convert("mm", to, w.get("precip")));
            w.set("s06", v);
        }
    }
}
fn daily_units(w: &mut Obj, q: &Obj, current_date: &str) {
    let to_temp = q.get("temperatureUnit").clone();
    if to_temp.str() == Some("C") {
        w.set("tmx", w.get("tempMax_c").clone());
        w.set("tmn", w.get("tempMin_c").clone());
    } else if to_temp.str() == Some("F") {
        w.set("tmx", w.get("tempMax_f").clone());
        w.set("tmn", w.get("tempMin_f").clone());
    }
    w.set(
        "pty",
        if w.get("precType").truthy() {
            w.get("precType").clone()
        } else {
            Val::Num(0.)
        },
    );
    w.set(
        "pop",
        if w.get("precProb").truthy() {
            w.get("precProb").clone()
        } else {
            Val::Num(0.)
        },
    );
    let sky = w.get("skyIcon").clone();
    w.set("skyPm", sky.clone());
    w.set("skyAm", sky);
    let reh = if w.get("humid").truthy() {
        w.get("humid").clone()
    } else {
        Val::Num(0.)
    };
    w.set("reh", reh.clone());
    w.set("humidityIcon", humidity_icon(&reh));
    rain_fields(w, q, current_date);
    let v = convert("m/s", q.get("windSpeedUnit"), w.get("windSpd_ms"));
    w.set("wsd", v);
    let v = convert("hPa", q.get("pressureUnit"), w.get("press"));
    w.set("hPa", v);
    if w.has("vis") {
        let v = convert("km", q.get("distanceUnit"), w.get("vis"));
        w.set("visibility", v);
    }
    let wdd = wind_dir_name(w.get("windDir"));
    w.set("wdd", wdd);
    w.set("dateObj", w.get("date").clone());
    let ymd = yyyymmdd(&str_of(w.get("date")));
    w.set("date", ymd);
}
fn hourly_units(w: &mut Obj, q: &Obj, current_date: &str) {
    let to_temp = q.get("temperatureUnit").clone();
    if to_temp.str() == Some("C") {
        w.set("t3h", w.get("temp_c").clone());
        w.set("sensorytem", w.get("ftemp_c").clone());
    } else if to_temp.str() == Some("F") {
        w.set("t3h", w.get("temp_f").clone());
        w.set("sensorytem", w.get("ftemp_f").clone());
    }
    w.set(
        "pty",
        if w.get("precType").truthy() {
            w.get("precType").clone()
        } else {
            Val::Num(0.)
        },
    );
    w.set(
        "pop",
        if w.get("precProb").truthy() {
            w.get("precProb").clone()
        } else {
            Val::Num(0.)
        },
    );
    if w.has("windSpd_ms") {
        let v = convert("m/s", q.get("windSpeedUnit"), w.get("windSpd_ms"));
        w.set("wsd", v);
    }
    let reh = if w.get("humid").truthy() {
        w.get("humid").clone()
    } else {
        Val::Num(0.)
    };
    w.set("reh", reh.clone());
    w.set("humidityIcon", humidity_icon(&reh));
    let cloud = if w.get("cloud").truthy() {
        w.get("cloud").clone()
    } else {
        Val::Num(0.)
    };
    w.set("cloud", cloud);
    rain_fields(w, q, current_date);
    let v = convert("hPa", q.get("pressureUnit"), w.get("press"));
    w.set("hPa", v);
    let v = convert("km", q.get("distanceUnit"), w.get("vis"));
    w.set("visibility", v);
    w.set("dateObj", w.get("date").clone());
    w.set("time", hours_of(&str_of(w.get("date"))));
    let ymd = yyyymmdd(&str_of(w.get("date")));
    w.set("date", ymd);
}
/// `_makeArpltn`; Err when the air unit is unknown (legacy TypeError inside convertUnits).
fn make_arpltn(current: &mut Obj, q: &Obj) -> Result<(), Failed> {
    current.set("arpltn", Obj::new());
    let unit = q.get("airUnit").clone();
    let mut air = Obj::new();
    for p in ["co", "no2", "o3", "pm10", "pm25", "so2", "aqi"] {
        for post in ["Value", "Grade", "Str"] {
            let name = format!("{p}{post}");
            if current.has(&name) {
                air.set(&name, current.get(&name).clone());
                if p == "aqi" {
                    air.set(&format!("khai{post}"), current.get(&name).clone());
                }
            }
        }
        if p == "aqi" {
            let v = air.get("aqiValue").clone();
            air.set("aqiIndex", v);
        } else {
            let value = air.get(&format!("{p}Value")).to_number();
            match unit.str().map(|u| value2index(u, p, value)) {
                Some(Ok(i)) => air.set(&format!("{p}Index"), i),
                _ => {
                    // The legacy object is attached before the throw: keep what it held.
                    current.set("arpltn", air);
                    return Err(Failed);
                }
            }
        }
    }
    if current.has("airSource") {
        air.set("source", current.get("airSource").clone());
    }
    if current.has("airAttribution") {
        air.set("attribution", current.get("airAttribution").clone());
    }
    if current.has("mTime") {
        air.set("dataTime", current.get("mTime").clone());
    }
    if current.has("mCity") {
        let v = match current.get("mCity") {
            Val::Str(s) => Val::Str(shorten_station(s)),
            other => other.clone(),
        };
        air.set("stationName", v);
    }
    current.set("arpltn", air);
    Ok(())
}
fn rows(result: &mut Obj, key: &str) -> Vec<Val> {
    match result.get_mut(key) {
        Some(Val::Arr(a)) => std::mem::take(a),
        _ => Vec::new(),
    }
}
fn obj_mut(v: &mut Val) -> &mut Obj {
    match v {
        Val::Obj(o) => o,
        _ => unreachable!("legacy rows are objects"),
    }
}
/// `convertUnits`; any legacy exception stops the remaining conversions (caught and logged).
fn convert_units(result: &mut Obj, q: &Obj) {
    let mut this_time = rows(result, "thisTime");
    let mut daily = rows(result, "daily");
    let mut hourly = rows(result, "hourly");
    let mut shortest = rows(result, "shortest");
    let _ = (|| -> Result<(), Failed> {
        let current_date = match this_time.get(1) {
            Some(Val::Obj(c)) => str_of(c.get("date")),
            _ => return Err(Failed),
        };
        for v in this_time.iter_mut() {
            let w = obj_mut(v);
            w.set("time", hours_of(&str_of(w.get("date"))));
            let desc = w.get("desc").clone();
            w.set("weather", desc);
            this_time_units(w, q);
            make_arpltn(w, q)?;
        }
        let mut today_index = None;
        for (index, v) in daily.iter_mut().enumerate() {
            let w = obj_mut(v);
            let date = str_of(w.get("date"));
            if prefix(&date, 10) == prefix(&current_date, 10) {
                today_index = Some(index);
                if let Some(Val::Obj(c)) = this_time.get_mut(1) {
                    c.set("todayIndex", index as f64);
                }
            }
            w.set("fromToday", diff_days(&date, &current_date));
            w.set(
                "dayOfWeek",
                super::js::parts(parse_dot(&date)).map_or(f64::NAN, |p| p.weekday as f64),
            );
            daily_units(w, q, &current_date);
        }
        let _ = today_index;
        let n = hourly.len();
        for index in 0..n {
            let next_date = hourly.get(index + 1).map(|v| v.get("date").clone());
            let w = obj_mut(&mut hourly[index]);
            let date = str_of(w.get("date"));
            w.set("fromToday", diff_days(&date, &current_date));
            let cd = Val::Str(current_date.clone());
            if le(w.get("date"), &cd) {
                if index == n - 1 {
                    w.set("currentIndex", true);
                } else if let Some(next) = &next_date
                    && le(&cd, next)
                {
                    w.set("currentIndex", true);
                }
            }
            hourly_units(w, q, &current_date);
        }
        if shortest.len() > 1 {
            for v in shortest.iter_mut() {
                let w = obj_mut(v);
                w.set("time", hours_of(&str_of(w.get("date"))));
                let desc = w.get("desc").clone();
                w.set("weather", desc);
                this_time_units(w, q);
            }
        }
        Ok(())
    })();
    result.set("thisTime", this_time);
    result.set("daily", daily);
    result.set("hourly", hourly);
    result.set("shortest", shortest);
}

/// Request inputs used by the assembly chain.
pub struct Assembly<'a> {
    pub version: Version,
    pub query: &'a Obj,
    pub locale: Locale,
}
/// Run the route chain after `getDsfData`. Err is the legacy 500 path.
pub fn assemble(a: &Assembly<'_>, dsf: Dsf, air: AirOutcome) -> Result<Obj, Failed> {
    let ts = a.locale;
    let q = a.query;
    let mut result = Obj::new();
    result.set("timezone", dsf.timezone.clone());
    let mut data = dsf.data;
    // convertDsfLocalTime
    let mut offset = result.get("timezone").get("ms").to_number();
    for item in data.iter_mut() {
        if let Some(Val::Obj(c)) = item.get_mut("current") {
            if !c.get("timeOffset").is_nullish() {
                offset = c.get("timeOffset").to_number() * 60_000.;
            }
            let s = dot_time(date_ms(c.get("dateObj")) + offset);
            c.set("dateObj", s);
        }
        for list in ["hourly", "daily"] {
            if let Some(Val::Obj(group)) = item.get_mut(list)
                && let Some(Val::Arr(points)) = group.get_mut("data")
            {
                for p in points.iter_mut() {
                    let p = obj_mut(p);
                    let s = dot_time(date_ms(p.get("dateObj")) + offset);
                    p.set("dateObj", s);
                    if list == "daily" {
                        for k in ["sunrise", "sunset"] {
                            if p.get(k).truthy() {
                                let s = dot_time(date_ms(p.get(k)) + offset);
                                p.set(k, s);
                            }
                        }
                    }
                }
            }
        }
    }
    let tz_min = result.get("timezone").get("min").clone();
    let days_back = if a.version == Version::V3 { 48. } else { 24. };
    let start = format!(
        "{}00:00",
        prefix(
            &time_string(
                &Val::Num(-days_back * 60. + tz_min.to_number()),
                dsf.weather_ms
            ),
            11
        )
    );
    let start_ms = parse_dot(&start);
    // mergeDsfDailyData
    let mut location = Obj::new();
    location.set("lat", dsf.lat);
    location.set("lon", dsf.lon);
    result.set("location", location);
    let mut pub_date = Obj::new();
    pub_date.set("VC", Val::Date(dsf.date_obj));
    result.set("pubDate", pub_date);
    let mut daily: Vec<Val> = Vec::new();
    for item in &data {
        if let Some(points) = item.get("daily").get("data").arr() {
            for p in points {
                let po = p.obj().cloned().unwrap_or_default();
                if parse_dot(&str_of(po.get("dateObj"))) >= start_ms {
                    let mut exists = false;
                    let made = make_daily(&po, ts);
                    for d in daily.iter_mut() {
                        if same_hour(&str_of(d.get("date")), &str_of(po.get("dateObj"))) {
                            *d = Val::Obj(made.clone());
                            exists = true;
                        }
                    }
                    if !exists {
                        daily.push(Val::Obj(made));
                    }
                }
            }
        }
    }
    result.set("daily", daily);
    // mergeDsfCurrentDataNewForm
    let cur_date = time_string(&tz_min, dsf.weather_ms);
    let mut this_time: Vec<Val> = Vec::new();
    let mut current_index = None;
    let mut current_offset_ms = 0.;
    for item in &data {
        let cur = item.get("current");
        if cur.get("dateObj").str() == Some(cur_date.as_str()) {
            let mut row = make_current(cur.obj().expect("record current"), ts)?;
            let empty = Vec::new();
            let night = is_night(
                &cur_date,
                item.get("daily").get("data").arr().unwrap_or(&empty),
            );
            let sky = sky_state(row.get("precType"), row.get("cloud"), night);
            row.set("skyIcon", sky);
            this_time.push(Val::Obj(row));
            current_index = Some(this_time.len() - 1);
            current_offset_ms = if cur.get("timeOffset").is_nullish() {
                result.get("timezone").get("ms").to_number()
            } else {
                cur.get("timeOffset").to_number() * 60_000.
            };
            break;
        }
    }
    result.set("thisTime", Val::Undef);
    // mergeDsfHourlyData
    let end = (a.version != Version::V3).then(|| {
        format!(
            "{}00",
            prefix(
                &time_string(&Val::Num(48. * 60. + tz_min.to_number()), dsf.weather_ms),
                14
            )
        )
    });
    let end_ms = end.as_deref().map(parse_dot);
    let yesterday_date = format!(
        "{}00",
        prefix(
            &time_string(&Val::Num(-24. * 60. + tz_min.to_number()), dsf.weather_ms),
            14
        )
    );
    let hour_cur = format!("{}00", prefix(&cur_date, 14));
    let mut list: Vec<Obj> = Vec::new();
    for item in &data {
        if let Some(points) = item.get("hourly").get("data").arr() {
            for p in points {
                let po = p.obj().cloned().unwrap_or_default();
                if list.is_empty() {
                    list.push(po);
                    continue;
                }
                let mut exists = false;
                for i in 0..list.len() - 1 {
                    if same_hour(&str_of(list[i].get("dateObj")), &str_of(po.get("dateObj"))) {
                        list[i] = po.clone();
                        exists = true;
                        break;
                    }
                }
                if !exists {
                    list.push(po);
                }
            }
        }
    }
    let mut hourly: Vec<Val> = Vec::new();
    let mut shortest: Vec<Val> = Vec::new();
    let mut found_yesterday = false;
    for (i, item) in list.iter().enumerate() {
        let date = str_of(item.get("dateObj"));
        if same_hour(&yesterday_date, &date) {
            let mut exists = false;
            for row in this_time.iter_mut() {
                if !row.get("date").is_nullish()
                    && same_hour(&yesterday_date, &str_of(row.get("date")))
                {
                    *row = Val::Obj(make_current(item, ts)?);
                    exists = true;
                }
            }
            if !exists {
                this_time.push(Val::Obj(make_current(item, ts)?));
            }
            found_yesterday = true;
        }
        let ms = parse_dot(&date);
        let hour = prefix(&date, 13).get(11..13).unwrap_or("");
        if ["00", "03", "06", "09", "12", "15", "18", "21", "24"].contains(&hour)
            && ms >= start_ms
            && end_ms.is_none_or(|e| ms <= e)
        {
            let made = make_hourly(
                item,
                i.checked_sub(1).map(|j| &list[j]),
                i.checked_sub(2).map(|j| &list[j]),
                result.get("daily").arr().map_or(&[][..], Vec::as_slice),
                ts,
            )?;
            let mut exists = false;
            for index in 0..hourly.len().saturating_sub(1) {
                if same_hour(&str_of(hourly[index].get("date")), &date) {
                    hourly[index] = Val::Obj(made.clone());
                    exists = true;
                    break;
                }
            }
            if !exists {
                hourly.push(Val::Obj(made));
            }
        }
        if date.as_str() > hour_cur.as_str() && shortest.len() < 3 {
            shortest.push(Val::Obj(make_current(item, ts)?));
        }
    }
    if !found_yesterday {
        let mut y = Obj::new();
        y.set("date", yesterday_date.clone());
        this_time.push(Val::Obj(y));
    }
    result.set("thisTime", this_time);
    result.set("hourly", hourly);
    result.set("shortest", shortest);
    // mergeAqi
    match &air {
        AirOutcome::Pending => {
            let mut status = Obj::new();
            status.set("state", "pending");
            status.set("retryAfterSeconds", 3.);
            result.set("airStatus", status);
        }
        AirOutcome::Observation(o) => {
            if let Some(index) = current_index
                && let Some(Val::Arr(rows)) = result.get_mut("thisTime")
                && let Some(Val::Obj(row)) = rows.get_mut(index)
            {
                apply(row, o, current_offset_ms, q.get("airUnit"), ts);
            }
        }
        AirOutcome::None => (),
    }
    // dataSort
    for key in ["thisTime", "hourly", "daily"] {
        if let Some(Val::Arr(rows)) = result.get_mut(key) {
            js_sort(rows, |x, y| {
                cmp_str(&str_of(x.get("date")), &str_of(y.get("date")))
            });
        }
    }
    result.set("source", "VC");
    // skyIconLowCase (v000902/v000903)
    if a.version != Version::V1 {
        for key in ["daily", "thisTime", "hourly"] {
            if let Some(Val::Arr(rows)) = result.get_mut(key) {
                for r in rows.iter_mut() {
                    if let Val::Obj(o) = r
                        && o.get("skyIcon").truthy()
                    {
                        let s = lower_icon(&str_of(o.get("skyIcon")));
                        o.set("skyIcon", s);
                    }
                }
            }
        }
    }
    convert_units(&mut result, q);
    // makeAirInfo
    let mut air_last = None;
    if let Some(Val::Arr(rows)) = result.get_mut("thisTime")
        && let Some(last) = rows.len().checked_sub(1)
        && let Val::Obj(current) = &mut rows[last]
        && current.has("arpltn")
    {
        let arpltn = current.get("arpltn").clone();
        let mut info = Obj::new();
        let source = arpltn.get("source");
        info.set(
            "source",
            if source.truthy() {
                source.clone()
            } else {
                Val::Str("aqicn".into())
            },
        );
        if arpltn.get("attribution").truthy() {
            info.set("attribution", arpltn.get("attribution").clone());
        }
        if let Some(Val::Obj(last_air)) = current.get_mut("arpltn") {
            for p in ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"] {
                let grade = format!("{p}Grade");
                if last_air.has(&grade) {
                    let g = action_guide(q.get("airUnit"), p, last_air.get(&grade), ts);
                    last_air.set(&format!("{p}ActionGuide"), g);
                }
            }
        }
        info.set("last", Val::Undef);
        air_last = Some((last, info));
    }
    if let Some((_, info)) = &air_last {
        result.set("airInfo", info.clone());
    }
    // makeSummary
    {
        let Some(Val::Arr(rows)) = result.get_mut("thisTime") else {
            return Err(Failed);
        };
        if rows.len() < 2 {
            return Err(Failed);
        }
        let (head, tail) = rows.split_at_mut(1);
        let yesterday = head[0].obj().cloned();
        let Val::Obj(current) = &mut tail[0] else {
            return Err(Failed);
        };
        let weather = summary_weather(current, yesterday.as_ref(), q, ts);
        current.set("summaryWeather", weather);
        let air_text = summary_air(current, ts);
        current.set("summaryAir", air_text.clone());
        if air_text.is_empty() {
            current.remove("summaryAir");
        }
        let text = summary(current, yesterday.as_ref(), q, ts);
        current.set("summary", text);
    }
    if let Some((last, _)) = air_last {
        let arpltn = result
            .get("thisTime")
            .arr()
            .and_then(|r| r.get(last))
            .map(|r| r.get("arpltn").clone());
        if let Some(Val::Obj(info)) = result.get_mut("airInfo") {
            info.set("last", arpltn.unwrap_or_default());
        }
    }
    // sendResult
    let mut units = Obj::new();
    for name in UNIT_LIST {
        let v = q.get(name);
        units.set(
            name,
            if v.truthy() {
                v.clone()
            } else {
                Val::Str(default_unit(name).into())
            },
        );
    }
    result.set("units", units);
    Ok(result)
}
