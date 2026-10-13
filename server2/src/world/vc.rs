//! Visual Crossing Timeline body -> Dark Sky documents -> legacy DsfForecast records.
//! Port of the legacy VC converter and `DsfController._parseData/_makeDbFormat` at ca8735cf.
//! No legacy file is read at runtime.
use super::js::{Obj, Val, iso, num_string, string_to_number};

const HOUR: f64 = 3600.;
const DAY: f64 = 86_400.;

fn num(v: &Val) -> Option<f64> {
    v.num().filter(|n| n.is_finite())
}
fn temperature(v: &Val) -> Option<f64> {
    num(v).map(|t| if t == 0. { 0.01 } else { t })
}
fn fraction(v: &Val) -> Option<f64> {
    num(v).map(|p| p / 100.)
}
fn index_of(list: &[Val], s: &str) -> bool {
    list.iter().any(|v| v.str() == Some(s))
}
pub fn precip_type(list: &Val) -> Option<&'static str> {
    let list = list.arr().filter(|l| !l.is_empty())?;
    let snow = index_of(list, "snow");
    let icy = index_of(list, "freezingrain") || index_of(list, "ice");
    let rain = index_of(list, "rain");
    if (snow && (rain || icy)) || icy {
        return Some("sleet");
    }
    if snow {
        Some("snow")
    } else if rain {
        Some("rain")
    } else {
        None
    }
}
fn is_str(v: &Val, s: &str) -> bool {
    v.str() == Some(s)
}
/// JavaScript `String(value)` for primitive legacy fields.
pub fn js_string(v: &Val) -> String {
    match v {
        Val::Undef => "undefined".into(),
        Val::Null => "null".into(),
        Val::Bool(b) => b.to_string(),
        Val::Num(n) => num_string(*n),
        Val::Str(s) => s.clone(),
        Val::Arr(a) => a
            .iter()
            .map(|x| {
                if x.is_nullish() {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Val::Obj(_) => "[object Object]".into(),
        Val::Date(ms) => match super::js::parts(*ms) {
            Some(p) => format!(
                "{} {} {:02} {:04} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
                ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday as usize],
                [
                    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov",
                    "Dec"
                ][(p.month - 1) as usize],
                p.day,
                p.year,
                p.hour,
                p.minute,
                p.second
            ),
            None => "Invalid Date".into(),
        },
    }
}
fn summary_of(row: &Val, rate: f64) -> String {
    let ty = precip_type(row.get("preciptype")).unwrap_or(if is_str(row.get("icon"), "snow") {
        "snow"
    } else {
        "rain"
    });
    let observed_wet = !is_str(row.get("source"), "fcst") && rate > 0.;
    let icon = row.get("icon");
    let wet = is_str(icon, "rain") || is_str(icon, "snow") || observed_wet;
    let conditions = row.get("conditions");
    let conditions = if conditions.truthy() {
        js_string(conditions)
    } else {
        String::new()
    };
    if wet && conditions.to_ascii_lowercase().contains("thunder") {
        return "thundershowers".into();
    }
    if wet {
        if rate <= 0. && is_str(row.get("source"), "fcst") {
            return if ty == "sleet" {
                "light sleet".into()
            } else {
                format!("possible light {ty}")
            };
        }
        return if rate < 0.098 {
            format!("light {ty}")
        } else if rate < 0.3 {
            ty.into()
        } else {
            format!("heavy {ty}")
        };
    }
    if is_str(icon, "fog") || num(row.get("visibility")).is_some_and(|v| v < 0.62) {
        return "fog".into();
    }
    if is_str(icon, "wind") {
        return "windy".into();
    }
    let cloud = num(row.get("cloudcover"))
        .filter(|c| *c != 0.)
        .unwrap_or(0.);
    if cloud <= 20. {
        "clear"
    } else if cloud <= 50. {
        "partly cloudy"
    } else if cloud <= 80. {
        "mostly cloudy"
    } else {
        "overcast"
    }
    .into()
}
fn icon_of(row: &Val, rate: f64) -> Val {
    let ty = precip_type(row.get("preciptype"));
    if !is_str(row.get("source"), "fcst") && rate > 0. {
        return ty.unwrap_or("rain").into();
    }
    let icon = row.get("icon");
    if (is_str(icon, "rain") || is_str(icon, "snow")) && ty == Some("sleet") {
        return "sleet".into();
    }
    icon.clone()
}
fn opt(v: Option<f64>) -> Val {
    v.map_or(Val::Undef, Val::Num)
}
/// Dark Sky data point for an hour or current conditions.
fn hour_point(row: &Val, time: Option<Val>) -> Obj {
    let rate = num(row.get("precip")).filter(|r| *r != 0.).unwrap_or(0.);
    let mut p = Obj::new();
    p.set(
        "time",
        time.unwrap_or_else(|| row.get("datetimeEpoch").clone()),
    );
    p.set("summary", summary_of(row, rate));
    p.set("icon", icon_of(row, rate));
    p.set("precipIntensity", rate);
    p.set("precipProbability", opt(fraction(row.get("precipprob"))));
    p.set(
        "precipType",
        precip_type(row.get("preciptype")).map_or(Val::Undef, Val::from),
    );
    p.set("temperature", opt(temperature(row.get("temp"))));
    p.set(
        "apparentTemperature",
        opt(temperature(row.get("feelslike"))),
    );
    p.set("humidity", opt(fraction(row.get("humidity"))));
    p.set("windSpeed", opt(num(row.get("windspeed"))));
    let bearing = num(row.get("winddir"));
    p.set(
        "windBearing",
        opt(if bearing == Some(0.) {
            Some(360.)
        } else {
            bearing
        }),
    );
    p.set("visibility", opt(num(row.get("visibility"))));
    p.set("cloudCover", opt(fraction(row.get("cloudcover"))));
    p.set("pressure", opt(num(row.get("pressure"))));
    if let Some(uv) = num(row.get("uvindex")).filter(|u| *u >= 0.) {
        p.set("uvIndex", uv);
    }
    p
}
fn hours_of(v: &Val) -> Result<Vec<Val>, String> {
    let hours = v.get("hours");
    if !hours.truthy() {
        return Ok(Vec::new());
    }
    hours
        .arr()
        .cloned()
        .ok_or_else(|| "VC> hours is not a list".to_owned())
}
fn extreme(hours: &[Val], field: &str, max: bool) -> (Option<f64>, Val) {
    let mut best: Option<(f64, Val)> = None;
    for hour in hours {
        if let Some(value) = num(hour.get(field))
            && best
                .as_ref()
                .is_none_or(|(b, _)| if max { value > *b } else { value < *b })
        {
            best = Some((value, hour.get("datetimeEpoch").clone()));
        }
    }
    best.map_or((None, Val::Undef), |(v, t)| (Some(v), t))
}
fn day_point(day: &Val, time: f64) -> Result<Obj, String> {
    let hours = hours_of(day)?;
    let total = num(day.get("precip")).filter(|r| *r != 0.).unwrap_or(0.);
    let (wet_value, wet_time) = extreme(&hours, "precip", true);
    let mut p = hour_point(day, Some(Val::Num(time)));
    p.set("summary", summary_of(day, total / 24.));
    p.set("icon", icon_of(day, total));
    p.set("precipIntensity", total / 24.);
    p.set("precipIntensityMax", wet_value.unwrap_or(0.));
    p.set(
        "precipIntensityMaxTime",
        if wet_time.is_undef() {
            Val::Num(time)
        } else {
            wet_time
        },
    );
    let epoch = |k: &str| {
        if num(day.get(k)).is_none() {
            Val::Null
        } else {
            day.get(k).clone()
        }
    };
    p.set("sunriseTime", epoch("sunriseEpoch"));
    p.set("sunsetTime", epoch("sunsetEpoch"));
    p.set("moonPhase", opt(num(day.get("moonphase"))));
    p.set("temperatureMax", opt(temperature(day.get("tempmax"))));
    p.set("temperatureMaxTime", extreme(&hours, "temp", true).1);
    p.set("temperatureMin", opt(temperature(day.get("tempmin"))));
    p.set("temperatureMinTime", extreme(&hours, "temp", false).1);
    p.set(
        "apparentTemperatureMax",
        opt(temperature(day.get("feelslikemax"))),
    );
    p.set(
        "apparentTemperatureMaxTime",
        extreme(&hours, "feelslike", true).1,
    );
    p.set(
        "apparentTemperatureMin",
        opt(temperature(day.get("feelslikemin"))),
    );
    p.set(
        "apparentTemperatureMinTime",
        extreme(&hours, "feelslike", false).1,
    );
    Ok(p)
}
/// `Date.parse("YYYY-MM-DDTHH:MM[:SS]Z")` for VC day/hour fields; NaN otherwise.
pub fn parse_iso_z(s: &str) -> f64 {
    let b = s.as_bytes();
    let n = |r: std::ops::Range<usize>| -> Option<i64> {
        let t = s.get(r)?;
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())
            .flatten()
    };
    (|| {
        if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
            return None;
        }
        let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
        if !(1..=12).contains(&m) || !(1..=super::js::days_in_month(y, m)).contains(&d) {
            return None;
        }
        let rest = &s[10..];
        let (h, mi, sec) = if rest.is_empty() {
            (0, 0, 0)
        } else if rest.len() == 7
            && rest.starts_with('T')
            && rest.ends_with('Z')
            && &rest[3..4] == ":"
        {
            (n(11..13)?, n(14..16)?, 0)
        } else if rest.len() == 10
            && rest.starts_with('T')
            && rest.ends_with('Z')
            && &rest[3..4] == ":"
            && &rest[6..7] == ":"
        {
            (n(11..13)?, n(14..16)?, n(17..19)?)
        } else {
            return None;
        };
        if h > 24 || mi > 59 || sec > 59 || (h == 24 && (mi > 0 || sec > 0)) {
            return None;
        }
        Some(
            (super::js::days_from_civil(y, m, d) as f64) * 86_400_000.
                + ((h * 3600 + mi * 60 + sec) * 1000) as f64,
        )
    })()
    .unwrap_or(f64::NAN)
}
fn offset_at(vc: &Val, now_sec: f64) -> f64 {
    let mut best: Option<(&Val, &Val)> = None;
    if let Some(days) = vc.get("days").arr() {
        for day in days {
            if let Some(hours) = day.get("hours").arr() {
                for hour in hours {
                    let epoch = hour.get("datetimeEpoch").to_number();
                    if epoch <= now_sec
                        && best.is_none_or(|(_, b)| epoch > b.get("datetimeEpoch").to_number())
                    {
                        best = Some((day, hour));
                    }
                }
            }
        }
    }
    match best {
        None => vc.get("tzoffset").to_number(),
        Some((day, hour)) => {
            let local = parse_iso_z(&format!(
                "{}T{}Z",
                js_string(day.get("datetime")),
                js_string(hour.get("datetime"))
            ));
            (local / 1000. - hour.get("datetimeEpoch").to_number()) / HOUR
        }
    }
}
fn local_date(epoch_sec: f64, offset_hours: f64) -> Result<String, String> {
    iso((epoch_sec + offset_hours * HOUR) * 1000.)
        .map(|s| s[..10].to_owned())
        .ok_or_else(|| "VC> invalid local time".to_owned())
}
/// Converted documents for one fetch. `today` and `current` always exist.
pub struct Docs {
    pub timezone: Val,
    pub offset_min: f64,
    pub two_days_ago: Option<Obj>,
    pub yesterday: Option<Obj>,
    pub today: Obj,
    pub current: Obj,
}
fn make(vc: &Val, offset: f64, currently: Obj, hours: &[Val], daily: Vec<Val>) -> Obj {
    let mut doc = Obj::new();
    doc.set("timezone", vc.get("timezone").clone());
    doc.set("offset", offset);
    doc.set("currently", currently);
    let mut hourly = Obj::new();
    hourly.set("summary", "");
    hourly.set(
        "data",
        hours
            .iter()
            .map(|h| Val::Obj(hour_point(h, None)))
            .collect::<Vec<_>>(),
    );
    doc.set("hourly", hourly);
    let mut d = Obj::new();
    d.set("summary", "");
    d.set("data", daily);
    doc.set("daily", d);
    doc
}
/// `vcConverter.toDarkSkyDocs(body, now)`.
pub fn to_docs(vc: &Val, now_ms: f64) -> Result<Docs, String> {
    let now_sec = (now_ms / 1000.).floor();
    let offset = offset_at(vc, now_sec);
    let today_str = local_date(now_sec, offset)?;
    let today_start = parse_iso_z(&format!("{today_str}T00:00:00Z")) / 1000. - offset * HOUR;
    let yesterday_str = local_date(today_start - DAY, offset)?;
    let two_str = local_date(today_start - 2. * DAY, offset)?;
    let empty = Vec::new();
    let days = if vc.get("days").truthy() {
        vc.get("days")
            .arr()
            .ok_or_else(|| "VC> days is not a list".to_owned())?
    } else {
        &empty
    };
    let find = |s: &str| days.iter().position(|d| d.get("datetime").str() == Some(s));
    let today_index =
        find(&today_str).ok_or_else(|| format!("VC> response has no local today {today_str}"))?;
    let day_record = |day: &Val, start: f64| -> Result<Obj, String> {
        let hours = hours_of(day)?;
        let mut first = if let Some(h) = hours.first() {
            hour_point(h, Some(Val::Num(start)))
        } else {
            hour_point(day, Some(Val::Num(start)))
        };
        if hours.is_empty() {
            first.remove("uvIndex");
        }
        Ok(make(
            vc,
            offset,
            first,
            &hours,
            vec![Val::Obj(day_point(day, start)?)],
        ))
    };
    let two_days_ago = find(&two_str)
        .map(|i| day_record(&days[i], today_start - 2. * DAY))
        .transpose()?;
    let yesterday = find(&yesterday_str)
        .map(|i| day_record(&days[i], today_start - DAY))
        .transpose()?;
    let today = day_record(&days[today_index], today_start)?;
    let offset_sec = super::js::round(offset * HOUR);
    let hour_start = ((now_sec + offset_sec) / HOUR).floor() * HOUR - offset_sec;
    let mut ahead = Vec::new();
    for day in &days[today_index..] {
        for hour in hours_of(day)? {
            let epoch = hour.get("datetimeEpoch").to_number();
            if epoch >= hour_start && epoch <= today_start + 3. * DAY {
                ahead.push(hour);
            }
        }
    }
    let daily_ahead = days[today_index..days.len().min(today_index + 8)]
        .iter()
        .enumerate()
        .map(|(i, day)| day_point(day, today_start + i as f64 * DAY).map(Val::Obj))
        .collect::<Result<Vec<_>, _>>()?;
    let conditions = vc.get("currentConditions");
    let (current, is_day) = if conditions.truthy() {
        (conditions, false)
    } else if ahead
        .first()
        .is_some_and(|h| h.get("datetimeEpoch").to_number() == hour_start)
    {
        (&ahead[0], false)
    } else {
        (&days[today_index], true)
    };
    let time = if now_sec == today_start {
        now_sec + 1.
    } else {
        now_sec
    };
    let mut point = hour_point(current, Some(Val::Num(time)));
    if is_day {
        point.remove("uvIndex");
    }
    Ok(Docs {
        timezone: vc.get("timezone").clone(),
        offset_min: super::js::round(offset * 60.),
        two_days_ago,
        yesterday,
        today,
        current: make(vc, offset, point, &ahead, daily_ahead),
    })
}

/// `new Date().setTime(time + '000')` with TimeClip; NaN for an invalid date.
pub fn make_date(time: &Val) -> f64 {
    let ms = string_to_number(&format!("{}000", js_string(time)));
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        f64::NAN
    } else {
        ms.trunc()
    }
}
/// `_makeDateOrNull`.
fn make_date_or_null(time: &Val) -> Val {
    if time.is_nullish() {
        Val::Null
    } else {
        Val::Date(make_date(time))
    }
}
/// `parseInt(kmaTimeLib.convertDatetoString(ms))` in the UTC process zone.
fn local_stamp(ms: f64) -> f64 {
    match super::js::parts(ms) {
        Some(p) => format!(
            "{:04}{:02}{:02}{:02}{:02}",
            p.year, p.month, p.day, p.hour, p.minute
        )
        .parse::<f64>()
        .unwrap_or(f64::NAN),
        // leadingZeros("NaN", 4) == "0NaN": parseInt reads 0.
        None => 0.,
    }
}
/// `_getFloatItem`: truthy -> parseFloat(item), else the -100 missing sentinel.
fn float_item(v: &Val) -> f64 {
    if !v.truthy() {
        return -100.;
    }
    match v {
        Val::Num(n) => *n,
        other => super::js::parse_float(&js_string(other)),
    }
}
fn uv(target: &mut Obj, src: &Val) {
    if let Some(u) = src
        .get("uvIndex")
        .num()
        .filter(|u| u.is_finite() && *u >= 0.)
    {
        target.set("uvIndex", u);
    }
}
fn common(p: &mut Obj, src: &Val) {
    p.set("pre_int", float_item(src.get("precipIntensity")));
    p.set("pre_pro", float_item(src.get("precipProbability")));
    if src.get("precipType").truthy() {
        p.set("pre_type", src.get("precipType").clone());
    }
    p.set("temp", float_item(src.get("temperature")));
    p.set("ftemp", float_item(src.get("apparentTemperature")));
    p.set("humid", float_item(src.get("humidity")));
    p.set("windspd", float_item(src.get("windSpeed")));
    p.set("winddir", float_item(src.get("windBearing")));
    p.set("vis", float_item(src.get("visibility")));
    p.set("cloud", float_item(src.get("cloudCover")));
    p.set("pres", float_item(src.get("pressure")));
    p.set("oz", float_item(src.get("ozone")));
    p.set("icon", src.get("icon").clone());
    uv(p, src);
}
/// `_parseData(doc).{current,hourly,daily}` as the record's `data`.
fn parse_data(src: &Obj) -> Obj {
    let src = Val::Obj(src.clone());
    let mut current = Obj::new();
    let currently = src.get("currently");
    if currently.truthy() {
        let ms = make_date(currently.get("time"));
        current.set("dateObj", Val::Date(ms));
        current.set("date", local_stamp(ms));
        current.set("summary", currently.get("summary").clone());
        common(&mut current, currently);
    }
    let mut hourly_data = Vec::new();
    if let Some(rows) = src.get("hourly").get("data").arr() {
        for item in rows {
            let mut h = Obj::new();
            let ms = make_date(item.get("time"));
            h.set("dateObj", Val::Date(ms));
            h.set("date", local_stamp(ms));
            if item.get("summary").truthy() {
                h.set("summary", item.get("summary").clone());
            }
            common(&mut h, item);
            hourly_data.push(Val::Obj(h));
        }
    }
    let mut daily_data = Vec::new();
    if let Some(rows) = src.get("daily").get("data").arr() {
        for item in rows {
            let mut d = Obj::new();
            let ms = make_date(item.get("time"));
            d.set("dateObj", Val::Date(ms));
            d.set("date", local_stamp(ms));
            d.set("summary", item.get("summary").clone());
            d.set("sunrise", make_date_or_null(item.get("sunriseTime")));
            d.set("sunset", make_date_or_null(item.get("sunsetTime")));
            d.set("moonphase", float_item(item.get("moonPhase")));
            d.set("pre_int", float_item(item.get("precipIntensity")));
            d.set("pre_intmax", float_item(item.get("precipIntensityMax")));
            d.set(
                "pre_intmaxt",
                make_date_or_null(item.get("precipIntensityMaxTime")),
            );
            d.set("pre_pro", float_item(item.get("precipProbability")));
            if item.get("precipType").truthy() {
                d.set("pre_type", item.get("precipType").clone());
            }
            d.set("temp_min", float_item(item.get("temperatureMin")));
            d.set(
                "temp_mint",
                make_date_or_null(item.get("temperatureMinTime")),
            );
            d.set("temp_max", float_item(item.get("temperatureMax")));
            d.set(
                "temp_maxt",
                make_date_or_null(item.get("temperatureMaxTime")),
            );
            d.set("ftemp_min", float_item(item.get("apparentTemperatureMin")));
            d.set(
                "ftemp_mint",
                make_date_or_null(item.get("apparentTemperatureMinTime")),
            );
            d.set("ftemp_max", float_item(item.get("apparentTemperatureMax")));
            d.set(
                "ftemp_maxt",
                make_date_or_null(item.get("apparentTemperatureMaxTime")),
            );
            d.set("humid", float_item(item.get("humidity")));
            d.set("windspd", float_item(item.get("windSpeed")));
            d.set("winddir", float_item(item.get("windBearing")));
            d.set("vis", float_item(item.get("visibility")));
            d.set("cloud", float_item(item.get("cloudCover")));
            d.set("pres", float_item(item.get("pressure")));
            d.set("oz", float_item(item.get("ozone")));
            d.set("icon", item.get("icon").clone());
            uv(&mut d, item);
            daily_data.push(Val::Obj(d));
        }
    }
    let mut data = Obj::new();
    data.set("current", current);
    let mut hourly = Obj::new();
    hourly.set("summary", src.get("hourly").get("summary").clone());
    hourly.set("data", hourly_data);
    data.set("hourly", hourly);
    let mut daily = Obj::new();
    daily.set("summary", src.get("daily").get("summary").clone());
    daily.set("data", daily_data);
    data.set("daily", daily);
    data
}

/// One stored DsfForecast document, keyed by `dateObj`.
#[derive(Clone, Debug)]
pub struct Record {
    pub date_ms: f64,
    pub pub_ms: f64,
    pub offset_min: f64,
    pub zone: Val,
    pub data: Obj,
}
/// Records produced by one fetch in legacy save order, plus the no-yesterday marker expiry.
pub struct Converted {
    pub records: Vec<(Kind, Record)>,
    pub no_yesterday_until: Option<f64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    TwoDaysAgo,
    Yesterday,
    Today,
    Current,
}
/// `_fetchVc` conversion plus `_markNoYesterday`, for a fetch at `now_ms` of `range`.
pub fn convert(vc: &Val, now_ms: f64, range: super::Range) -> Result<Converted, String> {
    let docs = to_docs(vc, now_ms)?;
    let mut records = Vec::new();
    let build = |doc: &Obj| -> Record {
        let data = parse_data(doc);
        let date_ms = match data.get("current").get("dateObj") {
            Val::Date(ms) => *ms,
            _ => f64::NAN,
        };
        Record {
            date_ms,
            pub_ms: now_ms,
            offset_min: if docs.offset_min != 1440. {
                docs.offset_min
            } else {
                Val::Obj(doc.clone()).get("offset").to_number().trunc() * 60.
            },
            zone: if docs.timezone.truthy() {
                docs.timezone.clone()
            } else {
                Val::Undef
            },
            data,
        }
    };
    if let Some(d) = &docs.two_days_ago {
        records.push((Kind::TwoDaysAgo, build(d)));
    }
    if let Some(d) = &docs.yesterday {
        records.push((Kind::Yesterday, build(d)));
    }
    records.push((Kind::Today, build(&docs.today)));
    records.push((Kind::Current, build(&docs.current)));
    if records.iter().any(|(_, r)| !r.date_ms.is_finite()) {
        return Err("VC> invalid record time".into());
    }
    let marks = (range != super::Range::Forecast && docs.yesterday.is_none())
        || (range == super::Range::Combined && docs.two_days_ago.is_none());
    let today_ms = records
        .iter()
        .find(|(k, _)| *k == Kind::Today)
        .map(|(_, r)| r.date_ms)
        .unwrap_or(f64::NAN);
    Ok(Converted {
        records,
        no_yesterday_until: marks.then_some(today_ms + 86_400_000.),
    })
}
