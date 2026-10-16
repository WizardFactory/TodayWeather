//! Alarm notification text, ported from `server/controllers/controllerPush.js`
//! (`_makeKmaPushMessage`, `_makeKmaPushWeatherMessage`, `_makeDsfPushMessage`,
//! `_makeDsfPushWeatherMessage`, `_makePushAirMessage`, `_getAqiStr`, `_makeStrTmnTmx`,
//! `_pty2str`), `controllerTown24h.js` (`_getWeatherEmoji`, `_getEmoji`), `controllerTown.js`
//! (`_convertKmaPtyToStr`) and `aqi.converter.js` (`name2string`, `value2index`), over the
//! weather response exactly as the worker receives it. JavaScript semantics (truthiness, loose
//! comparisons, `parseInt`, `Math.round`, string conversion, `Array#toString`, V8 sort) are kept;
//! an exception is a build failure (`Err` with the V8-style message).
use crate::push::js::{
    self, Thrown, ge, greater, has_own, le, less, loose_eq, prop, strict_eq, to_string,
};
use crate::world::js::{Obj, Val, js_sort, num_string, parse_dot, parts, round};
use std::{collections::HashMap, sync::OnceLock};

const LOCALES: [&str; 6] = ["en", "ko", "ja", "zh-CN", "de", "zh-TW"];
type Table = HashMap<String, HashMap<String, String>>;
fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("locales.json")).expect("embedded locale subset");
        let mut out = Table::new();
        if let Some(locales) = raw.get("locales").and_then(|v| v.as_object()) {
            for (locale, entries) in locales {
                let map = entries
                    .as_object()
                    .map(|o| {
                        o.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                            .collect()
                    })
                    .unwrap_or_default();
                out.insert(locale.clone(), map);
            }
        }
        out
    })
}

/// i18n 0.8.3 `setLocale(lang)` on the configured locales (unknown: the default `en`) and
/// `__(key)` (a missing key returns the key).
#[derive(Clone, Copy, Debug)]
pub struct Tr(&'static str);
impl Tr {
    pub fn for_lang(lang: &Val) -> Self {
        let tag = match lang {
            Val::Str(s) => s.as_str(),
            _ => "",
        };
        Tr(LOCALES.iter().copied().find(|l| *l == tag).unwrap_or("en"))
    }
    pub fn tr(self, key: &str) -> String {
        table()
            .get(self.0)
            .and_then(|t| t.get(key))
            .cloned()
            .unwrap_or_else(|| key.to_owned())
    }
}

/// A built notification: `title` and `text` (`text` may be JavaScript `undefined`).
#[derive(Clone, Debug, PartialEq)]
pub struct Message {
    pub title: Val,
    pub text: Val,
}

fn s(v: &str) -> Val {
    Val::Str(v.into())
}
fn get(v: &Val, key: &str) -> Result<Val, Thrown> {
    prop(v, key)
}
/// `array.find(obj => obj.<field> === value)`.
fn find(list: &Val, field: &str, value: &Val, expr: &str) -> Result<Val, Thrown> {
    match list {
        Val::Arr(items) => {
            for item in items {
                if strict_eq(&get(item, field)?, value) {
                    return Ok(item.clone());
                }
            }
            Ok(Val::Undef)
        }
        Val::Undef | Val::Null => Err(format!(
            "Cannot read properties of {} (reading 'find')",
            if matches!(list, Val::Null) {
                "null"
            } else {
                "undefined"
            }
        )),
        _ => Err(format!("{expr}.find is not a function")),
    }
}

/// `new Date(value)` time value (legacy `YYYY.MM.DD HH:MM` strings in the UTC process zone).
fn date_of(v: &Val) -> f64 {
    match v {
        Val::Str(s) => parse_dot(s),
        Val::Num(n) => *n,
        Val::Date(ms) => *ms,
        Val::Null => 0.,
        Val::Bool(b) => f64::from(u8::from(*b)),
        _ => f64::NAN,
    }
}
fn hours(ms: f64) -> Val {
    parts(ms).map_or(Val::Num(f64::NAN), |p| Val::Num(p.hour as f64))
}
fn date_of_month(ms: f64) -> Val {
    parts(ms).map_or(Val::Num(f64::NAN), |p| Val::Num(p.day as f64))
}

/// `cTown._getWeatherEmoji(skyIcon)`.
pub fn weather_emoji(icon: &Val) -> Result<String, Thrown> {
    let Val::Str(icon) = icon else {
        return Err(match icon {
            Val::Undef | Val::Null => {
                "Cannot read properties of undefined (reading 'toLowerCase')".into()
            }
            _ => "skyIcon.toLowerCase is not a function".into(),
        });
    };
    let icon = icon.to_lowercase();
    Ok(if icon.contains("lightning") {
        "\u{26c8}"
    } else if icon.contains("rainsnow") {
        "\u{2614}\u{2603}"
    } else if icon.contains("rain") {
        "\u{2614}"
    } else if icon.contains("snow") {
        "\u{2603}"
    } else if icon.contains("cloud") {
        if icon.contains("sun") || icon.contains("moon") {
            "\u{26c5}"
        } else {
            "\u{2601}"
        }
    } else if icon.contains("sun") || icon.contains("moon") {
        "\u{1f31e}"
    } else {
        ""
    }
    .to_owned())
}
const ARROW: &str = "\u{2192}";

/// `String.prototype.replace(text, '')` of the first occurrence.
fn replace_first(s: &str, pat: &str) -> String {
    match s.find(pat) {
        Some(i) => format!("{}{}", &s[..i], &s[i + pat.len()..]),
        None => s.to_owned(),
    }
}
fn wf(v: &Val) -> Result<String, Thrown> {
    let Val::Str(t) = v else {
        return Err(match v {
            Val::Undef | Val::Null => {
                "Cannot read properties of undefined (reading 'replace')".into()
            }
            _ => "theDay.wfAm.replace is not a function".into(),
        });
    };
    Ok(replace_first(
        &replace_first(&replace_first(t, "흐리고 "), "구름적고 "),
        "구름많고 ",
    ))
}

/// `_makeStrTmnTmx(theDay, preDay, trans)`.
fn tmn_tmx(day: &Val, pre: &Val, tr: Tr) -> Result<String, Thrown> {
    let mut out = tr.tr("LOC_LOWEST");
    let part = |out: &mut String, key: &str| -> Result<(), Thrown> {
        out.push_str(&num_string(js::parse_int(&get(day, key)?)));
        out.push('˚');
        if pre.truthy() && get(pre, key)?.truthy() {
            let diff = round(js::number(&get(day, key)?) - js::number(&get(pre, key)?));
            if !(diff == 0.) {
                out.push('(');
                if diff > 0. {
                    out.push('+');
                }
                out.push_str(&num_string(diff));
                out.push(')');
            }
        }
        Ok(())
    };
    part(&mut out, "tmn")?;
    out.push(' ');
    out.push_str(&tr.tr("LOC_HIGHEST"));
    part(&mut out, "tmx")?;
    Ok(out)
}

/// `_getAqiStr(arpltn, trans)` with V8's sort and the legacy comparator as written.
fn aqi_str(arpltn: &Val, tr: Tr) -> Result<Option<String>, Thrown> {
    let mut order = ["pm25", "pm10", "o3", "khai"];
    let mut failure = None;
    js_sort(&mut order, |a, _b| {
        let key = format!("{a}Grade");
        match has_own("arpltn", arpltn, &key, false) {
            Err(e) => {
                failure.get_or_insert(e);
                0
            }
            Ok(false) => 1,
            Ok(true) => {
                let (ga, gb) = (
                    get(arpltn, &key).unwrap_or(Val::Undef),
                    get(arpltn, &format!("{_b}Grade")).unwrap_or(Val::Undef),
                );
                if less(&ga, &gb) {
                    1
                } else if greater(&ga, &gb) {
                    -1
                } else {
                    0
                }
            }
        }
    });
    if let Some(e) = failure {
        return Err(e);
    }
    let first = order[0];
    let value = get(arpltn, &format!("{first}Str"))?;
    if !value.truthy() {
        return Ok(None);
    }
    let label = match first {
        "pm25" => "LOC_PM25",
        "pm10" => "LOC_PM10",
        "o3" => "LOC_O3",
        _ => "LOC_AQI",
    };
    Ok(Some(format!("{} {}", tr.tr(label), to_string(&value))))
}

fn join(items: &[String]) -> String {
    items.join(",")
}

/// `_makeKmaPushWeatherMessage`.
fn kma_weather(info: &Obj, weather: &Val, tr: Tr) -> Result<(String, String), Thrown> {
    let current = get(weather, "current")?;
    let time = current_time(&current)?;
    let daily = get(&get(weather, "midData")?, "dailyData")?;
    let today = find(
        &daily,
        "fromToday",
        &Val::Num(0.),
        "weatherInfo.midData.dailyData",
    )?;
    let (from_today, the_day, pre_day, mut summary) = if less(&time, &Val::Num(18.)) {
        let pre = find(
            &daily,
            "fromToday",
            &Val::Num(-1.),
            "weatherInfo.midData.dailyData",
        )?;
        (0., today.clone(), pre, format!("{}: ", tr.tr("LOC_TODAY")))
    } else {
        let day = find(
            &daily,
            "fromToday",
            &Val::Num(1.),
            "weatherInfo.midData.dailyData",
        )?;
        (
            1.,
            day,
            today.clone(),
            format!("{}: ", tr.tr("LOC_TOMORROW")),
        )
    };
    let mut items = Vec::new();
    if get(&the_day, "skyAm")?.truthy() && get(&the_day, "skyPm")?.truthy() {
        let am = wf(&get(&the_day, "wfAm")?)?;
        let pm = wf(&get(&the_day, "wfPm")?)?;
        items.push(format!(
            "{am}{}{ARROW}{pm}{}",
            weather_emoji(&get(&the_day, "skyAm")?)?,
            weather_emoji(&get(&the_day, "skyPm")?)?
        ));
    } else if get(&the_day, "skyIcon")?.truthy() {
        items.push(weather_emoji(&get(&the_day, "skyIcon")?)?);
    }
    if has_own("theDay", &the_day, "tmn", false)? && has_own("theDay", &the_day, "tmx", false)? {
        items.push(tmn_tmx(&the_day, &pre_day, tr)?);
    }
    let pty = get(&the_day, "pty")?;
    if pty.truthy() && greater(&pty, &Val::Num(0.)) {
        let cur_pty = get(&current, "pty")?;
        if get(&the_day, "pop")?.truthy() && le(&cur_pty, &Val::Num(0.)) {
            let same = strict_eq(&get(&the_day, "date")?, &get(&today, "date")?);
            if !(same && le(&cur_pty, &Val::Num(0.))) {
                items.push(format!(
                    "{} {}%",
                    tr.tr("LOC_PROBABILITY_OF_PRECIPITATION"),
                    to_string(&get(&the_day, "pop")?)
                ));
            }
        }
    }
    let dust = get(&the_day, "dustForecast")?;
    if dust.truthy() {
        if greater(&get(&dust, "pm25Grade")?, &get(&dust, "pm10Grade")?) {
            items.push(format!(
                "{} {}",
                tr.tr("LOC_PM25"),
                to_string(&get(&dust, "pm25Str")?)
            ));
        } else {
            items.push(format!(
                "{} {}",
                tr.tr("LOC_PM10"),
                to_string(&get(&dust, "pm10Str")?)
            ));
        }
        let o3 = get(&dust, "o3Str")?;
        if o3.truthy() {
            items.push(format!("{} {}", tr.tr("LOC_O3"), to_string(&o3)));
        }
    } else {
        let air = get(weather, "airInfo")?;
        if air.truthy() && get(&air, "pollutants")?.truthy() {
            let pollutants = get(&air, "pollutants")?;
            let mut found: Option<(&str, Val)> = None;
            for name in ["aqi", "pm25", "pm10", "o3"] {
                let p = get(&pollutants, name)?;
                if found.is_none() && p.truthy() && get(&p, "daily")?.truthy() {
                    let row = find(
                        &get(&p, "daily")?,
                        "fromToday",
                        &Val::Num(from_today),
                        "pollutants[name].daily",
                    )?;
                    if row.truthy() {
                        found = Some((name, row));
                    }
                }
            }
            if let Some((name, row)) = found {
                let label = match name {
                    "aqi" => "LOC_AIR_STATUS",
                    "pm25" => "LOC_PM25",
                    "pm10" => "LOC_PM10",
                    _ => "LOC_O3",
                };
                items.push(format!(
                    "{} {}",
                    tr.tr(label),
                    to_string(&get(&row, "str")?)
                ));
            }
        }
    }
    summary.push_str(&join(&items));
    let mut hourly = Vec::new();
    if get(&current, "skyIcon")?.truthy() {
        hourly.push(weather_emoji(&get(&current, "skyIcon")?)?);
    }
    let t1h = get(&current, "t1h")?;
    if t1h.truthy() {
        hourly.push(format!("{}˚", to_string(&t1h)));
    }
    let arpltn = get(&current, "arpltn")?;
    if arpltn.truthy()
        && let Some(a) = aqi_str(&arpltn, tr)?
    {
        hourly.push(a);
    }
    let cpty = get(&current, "pty")?;
    let rn1 = get(&current, "rn1")?;
    if cpty.truthy() && greater(&cpty, &Val::Num(0.)) && !rn1.is_nullish() {
        let label = match &cpty {
            Val::Num(n) if *n == 1. || *n == 2. => tr.tr("LOC_PRECIPITATION"),
            Val::Num(n) if *n == 3. => tr.tr("LOC_SNOWFALL"),
            _ => String::new(),
        };
        hourly.push(format!(
            "{label} {}{}",
            to_string(&rn1),
            to_string(&get(&info_val(info), "units").and_then(|u| get(&u, "precipitationUnit"))?)
        ));
    }
    let title = format!("{}: {}", tr.tr("LOC_CURRENT"), join(&hourly));
    Ok((title, summary))
}

fn info_val(info: &Obj) -> Val {
    Val::Obj(info.clone())
}

/// The hour of `current.dateObj`, else `current.time`.
fn current_time(current: &Val) -> Result<Val, Thrown> {
    let date = get(current, "dateObj")?;
    if date.truthy() {
        return Ok(hours(date_of(&date)));
    }
    let time = get(current, "time")?;
    Ok(if time.truthy() { time } else { Val::Undef })
}

/// `_makeDsfPushWeatherMessage`.
fn dsf_weather(info: &Obj, weather: &Val, tr: Tr) -> Result<(String, String), Thrown> {
    let current = get(&get(weather, "thisTime")?, "1")?;
    let mut current_ms = date_of(&get(&current, "dateObj")?);
    let time = hours(current_ms);
    let (target, mut summary) = if less(&time, &Val::Num(18.)) {
        (
            date_of_month(current_ms),
            format!("{}: ", tr.tr("LOC_TODAY")),
        )
    } else {
        current_ms += 86_400_000.;
        (
            date_of_month(current_ms),
            format!("{}: ", tr.tr("LOC_TOMORROW")),
        )
    };
    let current_date = date_of_month(current_ms);
    let list = get(weather, "daily")?;
    let length = js::number(&get(&list, "length")?);
    let (mut today, mut the_day, mut pre_day) = (Val::Undef, Val::Undef, Val::Undef);
    let mut i = 0.;
    while i < length - 1. {
        let entry = get(&list, &num_string(i))?;
        let day = date_of_month(date_of(&get(&entry, "dateObj")?));
        if loose_eq(&day, &current_date) {
            today = entry.clone();
        }
        if loose_eq(&day, &target) {
            the_day = entry;
            pre_day = get(&list, &num_string(i - 1.))?;
            break;
        }
        i += 1.;
    }
    let mut items = Vec::new();
    if get(&the_day, "skyAm")?.truthy() && get(&the_day, "skyPm")?.truthy() {
        items.push(format!(
            "{}{ARROW}{}",
            weather_emoji(&get(&the_day, "skyAm")?)?,
            weather_emoji(&get(&the_day, "skyPm")?)?
        ));
    } else if get(&the_day, "skyIcon")?.truthy() {
        items.push(weather_emoji(&get(&the_day, "skyIcon")?)?);
    }
    if has_own("theDay", &the_day, "tmn", false)? && has_own("theDay", &the_day, "tmx", false)? {
        items.push(tmn_tmx(&the_day, &pre_day, tr)?);
    }
    let pty = get(&the_day, "pty")?;
    if pty.truthy() && greater(&pty, &Val::Num(0.)) && get(&the_day, "pop")?.truthy() {
        let same = strict_eq(&get(&the_day, "date")?, &get(&today, "date")?);
        if !(same && le(&get(&current, "pty")?, &Val::Num(0.))) {
            items.push(format!(
                "{} {}%",
                tr.tr("LOC_PROBABILITY_OF_PRECIPITATION"),
                to_string(&get(&the_day, "pop")?)
            ));
        }
    }
    summary.push_str(&join(&items));
    let mut hourly = Vec::new();
    if get(&current, "skyIcon")?.truthy() {
        hourly.push(weather_emoji(&get(&current, "skyIcon")?)?);
    }
    if has_own("current", &current, "t1h", false)? {
        hourly.push(format!("{}˚", to_string(&get(&current, "t1h")?)));
    }
    let arpltn = get(&current, "arpltn")?;
    if arpltn.truthy()
        && let Some(a) = aqi_str(&arpltn, tr)?
    {
        hourly.push(a);
    }
    let cpty = get(&current, "pty")?;
    if cpty.truthy() && greater(&cpty, &Val::Num(0.)) && has_own("current", &current, "rn1", false)?
    {
        let label = match &cpty {
            Val::Num(n) if *n == 1. || *n == 3. => tr.tr("LOC_PRECIPITATION"),
            Val::Num(n) if *n == 2. => tr.tr("LOC_SNOWFALL"),
            Val::Num(n) if *n == 4. => tr.tr("LOC_HAIL"),
            _ => String::new(),
        };
        hourly.push(format!(
            "{label} {}{}",
            to_string(&get(&current, "rn1")?),
            to_string(&get(&info_val(info), "units").and_then(|u| get(&u, "precipitationUnit"))?)
        ));
    }
    let title = format!("{}: {}", tr.tr("LOC_CURRENT"), join(&hourly));
    Ok((title, summary))
}

/// `_makePushAirMessage`: (title, text).
fn air(weather: &Val, tr: Tr) -> Result<(String, Val), Thrown> {
    let current = {
        let c = get(weather, "current")?;
        if c.truthy() {
            c
        } else {
            get(&get(weather, "thisTime")?, "1")?
        }
    };
    let air = get(weather, "airInfo")?;
    if air.is_nullish() {
        return Err("airInfo is invalid".into());
    }
    let time = current_time(&current)?;
    let from_today = if less(&time, &Val::Num(18.)) { 0. } else { 1. };
    let summary_air = get(&current, "summaryAir")?;
    let current_summary = summary_air
        .truthy()
        .then(|| format!("{}: {}", tr.tr("LOC_CURRENT"), to_string(&summary_air)));
    let undefined_or = |s: Option<String>| s.map_or(Val::Undef, Val::Str);
    let air_unit = get(&get(weather, "units")?, "airUnit")?;
    let pollutants = get(&air, "pollutants")?;
    if pollutants.is_nullish() {
        return Ok((String::new(), undefined_or(current_summary)));
    }
    // for (name in pollutants): own enumerable keys (integer-like first).
    let names: Vec<String> = match &pollutants {
        Val::Obj(o) => {
            let mut keys: Vec<String> = o.keys().map(str::to_owned).collect();
            let idx = |k: &str| k.parse::<u32>().ok().filter(|n| n.to_string() == k);
            keys.sort_by_key(|k| idx(k).map_or((1, 0), |n| (0, n)));
            keys
        }
        _ => Vec::new(),
    };
    let mut day: Vec<(String, Val, Val)> = Vec::new(); // (name, row, index)
    for name in &names {
        let p = get(&pollutants, name)?;
        if p.truthy() && get(&p, "daily")?.truthy() {
            let row = find(
                &get(&p, "daily")?,
                "fromToday",
                &Val::Num(from_today),
                "pollutants[name].daily",
            )?;
            if row.truthy() && name != "aqi" {
                let index = value2index(&air_unit, name, &get(&row, "val")?)?;
                day.push((name.clone(), row, index));
            }
        }
    }
    let mut max_grade = Val::Num(0.);
    let mut max_index = Val::Num(0.);
    let mut max_name: Option<String> = None;
    for (name, row, index) in &day {
        let grade = get(row, "grade")?;
        if greater(&grade, &max_grade) {
            max_grade = grade;
        }
        if greater(index, &max_index) {
            max_index = index.clone();
            max_name = Some(name.clone());
        }
    }
    if strict_eq(&max_grade, &Val::Num(0.)) {
        return Ok((String::new(), undefined_or(current_summary)));
    }
    let row_of = |n: &str| {
        day.iter()
            .find(|(name, ..)| name == n)
            .map(|(_, r, _)| r.clone())
    };
    let line = |label: &str, row: &Val| -> Result<String, Thrown> {
        Ok(format!(
            "{} {}{} {}",
            tr.tr(label),
            tr.tr("LOC_AVERAGE"),
            to_string(&get(row, "val")?),
            to_string(&get(row, "str")?)
        ))
    };
    let mut summary = String::new();
    if le(&max_grade, &Val::Num(1.)) {
        summary = tr.tr("LOC_AIR_QUALITY_IS_GOOD");
    } else {
        let threshold = if loose_eq(&max_grade, &Val::Num(2.)) {
            2.
        } else {
            3.
        };
        if let Some(r) = row_of("pm25")
            && ge(&get(&r, "grade")?, &Val::Num(threshold))
        {
            summary.push_str(&line("LOC_PM25", &r)?);
        }
        if let Some(r) = row_of("pm10")
            && ge(&get(&r, "grade")?, &Val::Num(threshold))
        {
            if !summary.is_empty() {
                summary.push_str(", ");
            }
            summary.push_str(&line("LOC_PM10", &r)?);
        }
        if summary.is_empty() {
            if threshold == 2. {
                summary = tr.tr("LOC_AIR_QUALITY_IS_MODERATE");
            } else {
                let Some(name) = max_name.clone() else {
                    return Err("Cannot read properties of undefined (reading 'val')".into());
                };
                let row = row_of(&name).expect("max index pollutant");
                summary.push_str(&tr.tr(name2string(&name)));
                summary.push_str(&format!(
                    " {}{}",
                    tr.tr("LOC_AVERAGE"),
                    to_string(&get(&row, "val")?)
                ));
                summary.push_str(&format!(" {}", to_string(&get(&row, "str")?)));
            }
        }
    }
    let prefix = if from_today == 0. {
        tr.tr("LOC_TODAY")
    } else {
        tr.tr("LOC_TOMORROW")
    };
    let day_summary = format!("{prefix}: {summary}");
    Ok((
        String::new(),
        undefined_or(current_summary.map(|c| format!("{c}\n{day_summary}"))),
    ))
}

/// `AqiConverter.name2string(name)` (an unknown name gives `undefined`, which i18n prints as is).
fn name2string(name: &str) -> &str {
    match name {
        "pm10" => "LOC_PM10",
        "pm25" => "LOC_PM25",
        "o3" => "LOC_O3",
        "co" => "LOC_CO",
        "so2" => "LOC_SO2",
        "no2" => "LOC_NO2",
        "aqi" => "LOC_AQI",
        _ => "undefined",
    }
}

/// `AqiConverter.value2index(airUnit, name, val)`.
fn value2index(unit: &Val, name: &str, value: &Val) -> Result<Val, Thrown> {
    if name == "khai" {
        return Ok(value.clone());
    }
    crate::world::units::value2index(&to_string(unit), name, js::number(value))
        .map(Val::Num)
        .map_err(|_| format!("Cannot read properties of undefined (reading '{name}')"))
}

/// The KMA (`_makeKmaPushMessage`) or DSF (`_makeDsfPushMessage`) message. `None` is the
/// legacy `undefined` message of a package that is neither `todayWeather` nor `todayAir`.
pub fn message(info: &Obj, weather: &Val, dsf: bool) -> Result<Option<Message>, Thrown> {
    let tr = Tr::for_lang(info.get("lang"));
    let mut location = String::new();
    let name = info.get("name");
    if name.truthy() {
        location = format!("{} ", to_string(name));
    } else if !dsf {
        for key in ["townName", "cityName", "regionName"] {
            let v = get(weather, key)?;
            if v.truthy() {
                location = format!("{} ", to_string(&v));
                break;
            }
        }
    }
    let package = info.get("package");
    if *package == s("todayWeather") {
        let (title, text) = if dsf {
            dsf_weather(info, weather, tr)?
        } else {
            kma_weather(info, weather, tr)?
        };
        Ok(Some(Message {
            title: Val::Str(format!("{location}{title}")),
            text: Val::Str(text),
        }))
    } else if *package == s("todayAir") {
        let (title, text) = air(weather, tr)?;
        Ok(Some(Message {
            title: Val::Str(format!("{location}{title}")),
            text,
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn emoji_and_replace() {
        assert_eq!(weather_emoji(&s("Cloud_Rain")).unwrap(), "\u{2614}");
        assert_eq!(weather_emoji(&s("sun_smallcloud")).unwrap(), "\u{26c5}");
        assert_eq!(wf(&s("흐리고 비")).unwrap(), "비");
    }
}
