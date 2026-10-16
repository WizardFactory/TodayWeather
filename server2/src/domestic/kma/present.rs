//! Presentation steps: computed indices, sky icons, yesterday, warnings, unit conversion,
//! strings and summaries (`insertIndex`, `insertSkyIconLowCase` .. `getSummaryAfterUnitConverter`).
use super::air::recalculate_value;
use super::chain::{Cx, Flow};
use super::js::{
    V, add, catch, fixed, ge, gt, le, loose_eq, lt, parse_int, round, strict_eq, sv, to_number,
    to_str,
};
use super::{policy, precip, time, tr};
use crate::world::{i18n::Locale, js as wjs, units};

fn s(v: &str) -> V {
    V::s(v)
}
fn n(x: f64) -> V {
    V::Num(x)
}

// ---- LifeIndexKmaController computed indices ----

fn grade_high_low(grade: &V, l: Locale) -> String {
    let key = match grade {
        V::Num(g) if *g == 0. => "LOC_LOW",
        V::Num(g) if *g == 1. => "LOC_NORMAL",
        V::Num(g) if *g == 2. => "LOC_HIGH",
        V::Num(g) if *g == 3. => "LOC_VERY_HIGH",
        V::Num(g) if *g == 4. => "LOC_HAZARD",
        _ => return String::new(),
    };
    tr(l, key)
}
fn grade_attention(grade: &V, l: Locale) -> String {
    let key = match grade {
        V::Num(g) if *g == 0. => "LOC_ATTENTION",
        V::Num(g) if *g == 1. => "LOC_CAUTION",
        V::Num(g) if *g == 2. => "LOC_WARNING",
        V::Num(g) if *g == 3. => "LOC_HAZARD",
        _ => return String::new(),
    };
    tr(l, key)
}
fn invalid_th(t: &V, h: &V) -> bool {
    t.is_undef() || h.is_undef() || lt(t, &n(-50.)) || lt(h, &n(0.))
}
fn discomfort(t: &V, h: &V) -> V {
    if invalid_th(t, h) {
        return n(-1.);
    }
    let (t, h) = (to_number(t), to_number(h));
    n(round(
        (9. / 5. * t) - (0.55 * (1. - h / 100.) * (9. / 5. * t - 26.)) + 32.,
    ))
}
fn discomfort_grade(d: &V) -> V {
    if d.is_undef() || lt(d, &n(0.)) {
        return n(0.);
    }
    n(if lt(d, &n(68.)) {
        0.
    } else if lt(d, &n(75.)) {
        1.
    } else if lt(d, &n(80.)) {
        2.
    } else {
        3.
    })
}
fn decomposition(t: &V, h: &V) -> V {
    if invalid_th(t, h) {
        return n(-1.);
    }
    let mut i = (to_number(h) - 65.) / 14. * 1.054_f64.powf(to_number(t));
    if i < 0. {
        i = 0.;
    }
    n(round(i))
}
fn decomposition_grade(d: &V) -> V {
    n(if gt(d, &n(7.)) {
        2.
    } else if gt(d, &n(3.)) {
        1.
    } else {
        0.
    })
}
fn heat_index(t: &V, h: &V) -> V {
    if invalid_th(t, h) {
        return n(-1.);
    }
    let t2 = (9.0 / 5.0) * to_number(t) + 32.;
    let v2 = to_number(h);
    let mut v3 = -42.379 + (2.04901523 * t2) + (10.14333127 * v2)
        - (0.22475541 * t2 * v2)
        - (0.00683783 * t2 * t2)
        - (0.05481717 * v2 * v2)
        + (0.00122874 * t2 * t2 * v2)
        + (0.00085282 * t2 * v2 * v2)
        - (0.00000199 * t2 * t2 * v2 * v2);
    if v2 < 13. && (80. ..=112.).contains(&t2) {
        v3 -= 0.25 * (13. - v2) * ((17. - (t2 - 95.0).abs()) / 17.0).sqrt();
    }
    if v2 > 85.0 && (80.0..=87.).contains(&t2) {
        v3 += (v2 - 85.) / 10.0 * (87. - t2) / 5.0;
    }
    if t2 < 80.0 {
        v3 = t2;
    }
    v3 = (v3 - 32.) * (5.0 / 9.0);
    v3 = round(v3 * 10.) / 10.0;
    n(wjs::fixed(v3, 1))
}
fn heat_index_grade(hi: &V) -> V {
    if ge(hi, &n(66.)) {
        n(4.)
    } else if ge(hi, &n(54.)) {
        n(3.)
    } else if ge(hi, &n(41.)) && lt(hi, &n(54.)) {
        n(2.)
    } else if ge(hi, &n(32.)) && lt(hi, &n(41.)) {
        n(1.)
    } else if lt(hi, &n(32.)) {
        n(0.)
    } else {
        V::Undef
    }
}
fn frost_grade(t: &V) -> V {
    n(if lt(t, &n(-5.)) {
        2.
    } else if lt(t, &n(-1.5)) {
        1.
    } else {
        0.
    })
}
fn freeze_grade(t: &V, y: &V) -> V {
    n(if le(t, &n(-10.)) {
        3.
    } else if le(t, &n(-5.)) && lt(y, &n(-5.)) {
        2.
    } else if le(t, &n(-5.)) && ge(y, &n(-5.)) {
        1.
    } else {
        0.
    })
}
/// `_getNewWCT(Tdum, Wdum)`.
fn new_wct(t: &V, w: &V) -> V {
    if lt(w, &n(0.)) {
        return t.clone();
    }
    let tt = to_number(t);
    let mut ww = to_number(w) * 3.6;
    if ww > 4.8 {
        ww = ww.powf(0.16);
        let r = 13.12 + 0.6215 * tt - 11.37 * ww + 0.3965 * ww * tt;
        if gt(&n(r), t) { t.clone() } else { n(r) }
    } else {
        t.clone()
    }
}
fn apply_indices(cx: &Cx, row: &V, temp_key: &str, decpsn_source: &dyn Fn() -> V) {
    let l = cx.locale;
    let t = row.get(temp_key);
    if !row.get("wsd").nullish() {
        row.set("sensorytem", fixed(&new_wct(&t, &row.get("wsd")), 1));
    }
    if !row.get("reh").nullish() {
        let reh = row.get("reh");
        row.set("dspls", discomfort(&t, &reh));
        row.set("dsplsGrade", discomfort_grade(&row.get("dspls")));
        row.set("dsplsStr", grade_high_low(&row.get("dsplsGrade"), l));
        row.set("decpsn", decomposition(&t, &reh));
        row.set("decpsnGrade", decomposition_grade(&decpsn_source()));
        row.set("decpsnStr", grade_high_low(&row.get("decpsnGrade"), l));
        row.set("heatIndex", heat_index(&t, &reh));
        row.set("heatIndexGrade", heat_index_grade(&row.get("heatIndex")));
        row.set(
            "heatIndexStr",
            grade_high_low(&row.get("heatIndexGrade"), l),
        );
        let st = add(
            &add(&t, &n(super::js::sub(&row.get("sensorytem"), &t))),
            &n(super::js::sub(&row.get("heatIndex"), &t)),
        );
        row.set("sensorytem", round(to_number(&st)));
        let y = cx.r("yesterdayMinTemperature");
        if y.truthy() {
            row.set("freezeGrade", freeze_grade(&t, &y));
            row.set("freezeStr", grade_high_low(&row.get("freezeGrade"), l));
        }
    }
    row.set("frostGrade", frost_grade(&t));
    row.set("frostStr", grade_high_low(&row.get("frostGrade"), l));
}
pub fn insert_index(cx: &mut Cx) -> Flow {
    let current = cx.r("current");
    if current.truthy() && !current.get("t1h").nullish() {
        let c = current.clone();
        apply_indices(cx, &current, "t1h", &|| c.get("decpsn"));
    }
    let short = cx.r("short");
    if short.truthy() {
        for row in short.a().items() {
            if row.get("t3h").nullish() {
                continue;
            }
            let req = cx.req.clone();
            apply_indices(cx, &row, "t3h", &move || req.get("current").get("decpsn"));
        }
    }
    Flow::Next
}

// ---- sky icons ----

fn sky_icon_low_case(sky: &V, pty: &V, lgt: &V, night: bool) -> String {
    let mut name = if night {
        "moon".to_owned()
    } else {
        "sun".to_owned()
    };
    match sky {
        V::Num(x) if *x == 1. => (),
        V::Num(x) if *x == 2. => name.push_str("_smallcloud"),
        V::Num(x) if *x == 3. => name.push_str("_bigcloud"),
        V::Num(x) if *x == 4. => name = "cloud".into(),
        _ => (),
    }
    match pty {
        V::Num(x) if *x == 0. => (),
        V::Num(x) if *x == 1. => name.push_str("_rain"),
        V::Num(x) if *x == 2. => name.push_str("_rainsnow"),
        V::Num(x) if *x == 3. => name.push_str("_snow"),
        _ => (),
    }
    if strict_eq(lgt, &n(1.)) {
        name.push_str("_lightning");
    }
    name
}
/// `_isNight(dailyList, date, time)`.
fn is_night(days: &V, date: &V, tm: &V) -> bool {
    let info = days.a().find(|d| strict_eq(&d.get("date"), date));
    let mut sunrise = n(700.);
    let mut sunset = n(1800.);
    if !info.nullish() {
        if info.has("sunrise") {
            sunrise = V::from(time::dotted_hhmm(&sv(&info.get("sunrise"))));
        }
        if info.has("sunset") {
            sunset = V::from(time::dotted_hhmm(&sv(&info.get("sunset"))));
        }
    }
    !(le(&sunrise, tm) && le(tm, &sunset))
}
pub fn insert_sky_icon_low_case(cx: &mut Cx) -> Flow {
    let r = catch(|| {
        let days = || cx.r("midData").get("dailyData");
        for key in ["short", "shortest"] {
            let list = cx.r(key);
            if list.truthy() {
                for d in list.a().items() {
                    let night = is_night(&days(), &d.get("date"), &d.get("time"));
                    d.set("night", night);
                    d.set(
                        "skyIcon",
                        sky_icon_low_case(&d.get("sky"), &d.get("pty"), &d.get("lgt"), night),
                    );
                }
            }
        }
        let current = cx.r("current");
        if current.truthy() {
            let live = current.get("liveTime");
            let t = if live.truthy() {
                live
            } else {
                current.get("time")
            };
            let night = is_night(&days(), &current.get("date"), &t);
            current.set("night", night);
            current.set(
                "skyIcon",
                sky_icon_low_case(
                    &current.get("sky"),
                    &current.get("pty"),
                    &current.get("lgt"),
                    night,
                ),
            );
        }
        let mid = cx.r("midData");
        if mid.truthy() {
            for d in mid.get("dailyData").a().items() {
                if d.get("sky").truthy() {
                    d.set(
                        "skyIcon",
                        sky_icon_low_case(&d.get("sky"), &d.get("pty"), &d.get("lgt"), false),
                    );
                }
                if d.get("skyAm").truthy() {
                    d.set(
                        "skyAmIcon",
                        sky_icon_low_case(&d.get("skyAm"), &d.get("ptyAm"), &d.get("lgtAm"), false),
                    );
                }
                if d.get("skyPm").truthy() {
                    d.set(
                        "skyPmIcon",
                        sky_icon_low_case(&d.get("skyPm"), &d.get("ptyPm"), &d.get("lgtPm"), false),
                    );
                }
            }
        }
    });
    match r {
        Ok(()) => Flow::Next,
        // next(err): Express's default handler.
        Err(_) => super::js::next_err(),
    }
}

pub fn set_yesterday(cx: &mut Cx) -> Flow {
    let (current, list) = (cx.r("current"), cx.r("currentList"));
    if !current.truthy() || !list.truthy() {
        return Flow::Next;
    }
    let _ = catch(|| current.set("yesterday", policy::yesterday(&current, &list)));
    Flow::Next
}

pub fn get_special_info(cx: &mut Cx) -> Flow {
    let town = match catch(|| {
        let _ = cx.r("current").get("nearStnName");
        (cx.param("region"), cx.param("city"), cx.param("town"))
    }) {
        Ok(t) => t,
        Err(_) => return Flow::Next,
    };
    let text = |v: &V| {
        if v.nullish() {
            String::new()
        } else {
            to_str(v)
        }
    };
    let town = crate::warnings::zones::Town {
        first: text(&town.0),
        second: text(&town.1),
        third: text(&town.2),
    };
    let table = crate::warnings::zones::ZoneTable::shared(cx.now as i64);
    let codes = table.zones_for_town(&town);
    if codes.is_empty() {
        return Flow::Next;
    }
    let Ok(rows) = cx.store.special_zones(&codes) else {
        return Flow::Next;
    };
    // Entry fields are read by name; the row order (array) is preserved by the conversion.
    let rows: serde_json::Value = serde_json::from_slice(&rows.to_bytes()).unwrap_or_default();
    let entries: Vec<crate::warnings::zones::Entry> = rows
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(crate::warnings::zones::Entry::from_legacy)
                .collect()
        })
        .unwrap_or_default();
    let list = crate::warnings::zones::special_info_for(table, entries.iter(), &codes);
    if !cx.r("current").truthy() {
        cx.set("current", V::Obj(super::js::Ob::new()));
    }
    if !list.is_empty() {
        let json = crate::warnings::service::special_info_json(&list);
        cx.r("current")
            .set("specialInfo", super::js::from_ordered(&json));
    }
    Flow::Next
}

// ---- unit conversion ----

/// `UnitConverter.prototype.convertUnits(from, to, val)`.
pub fn convert_units(from: &str, to: &V, val: &V) -> V {
    if val.nullish() {
        return val.clone();
    }
    if loose_eq(&s(from), to) {
        return val.clone();
    }
    let to = to_str(to);
    let v = to_number(val);
    let f1 = |x: f64| n(wjs::fixed(x, 1));
    match from {
        "C" | "F" => {
            if from == "C" && to == "F" {
                return f1(v / (5. / 9.) + 32.);
            }
            if from == "F" && to == "C" {
                return f1((v - 32.) / (9. / 5.));
            }
            val.clone()
        }
        "mph" | "km/h" | "m/s" | "bft" | "kt" => {
            let beaufort = |ms: f64| -> V {
                let limits = [
                    0.3, 1.5, 3.3, 5.5, 8.0, 10.8, 13.9, 17.2, 20.7, 24.5, 28.4, 32.6,
                ];
                for (i, l) in limits.iter().enumerate() {
                    if ms < *l {
                        return n(i as f64);
                    }
                }
                if ms >= 32.6 { n(12.) } else { V::Undef }
            };
            let fx = |x: f64| wjs::fixed(x, 1);
            match (from, to.as_str()) {
                ("mph", "km/h") => f1(v * 1.609344),
                ("mph", "m/s") => f1(v * 0.44704),
                ("mph", "bft") => beaufort(fx(v * 0.44704)),
                ("mph", "kt") => f1(v * 0.868976),
                ("km/h", "mph") => f1(v * 0.621371),
                ("km/h", "m/s") => f1(v * 0.277778),
                ("km/h", "bft") => beaufort(fx(v * 0.277778)),
                ("km/h", "kt") => f1(v * 0.539957),
                ("m/s", "mph") => f1(v * 2.236936),
                ("m/s", "km/h") => f1(v * 3.6),
                ("m/s", "bft") => beaufort(v),
                ("m/s", "kt") => f1(v * 1.943844),
                ("bft", target) => {
                    let ms = match val {
                        V::Num(x) if (0. ..=12.).contains(x) && x.fract() == 0. => [
                            0., 0.3, 1.5, 3.3, 5.5, 8.0, 10.8, 13.9, 17.2, 20.7, 24.5, 28.4, 32.6,
                        ][*x as usize],
                        _ => f64::NAN,
                    };
                    match target {
                        "mph" => f1(ms * 2.236936),
                        "km/h" => f1(ms * 3.6),
                        "m/s" => {
                            if ms.is_nan() {
                                V::Undef
                            } else {
                                n(ms)
                            }
                        }
                        "kt" => f1(ms * 1.943844),
                        _ => V::Undef,
                    }
                }
                ("kt", "mph") => f1(v * 1.150779),
                ("kt", "km/h") => f1(v * 1.852),
                ("kt", "m/s") => f1(v * 0.514444),
                ("kt", "bft") => beaufort(fx(v * 0.514444)),
                _ => V::Undef,
            }
        }
        "mmHg" | "inHg" | "hPa" | "mb" => match (from, to.as_str()) {
            ("mmHg", "inHg") => f1(v * 0.03937),
            ("mmHg", "hPa" | "mb") => f1(v * 1.333224),
            ("inHg", "mmHg") => f1(v * 25.4),
            ("inHg", "hPa" | "mb") => f1(v * 33.863882),
            ("hPa" | "mb", "mmHg") => f1(v * 0.750062),
            ("hPa" | "mb", "inHg") => f1(v * 0.02953),
            ("hPa" | "mb", "hPa" | "mb") => val.clone(),
            _ => V::Undef,
        },
        "km" => f1(v * 0.621371),
        "mi" => f1(v * 1.609344),
        "mm" => f1(v * 0.03937),
        "in" => f1(v * 25.4),
        _ => val.clone(),
    }
}
/// `ControllerTown24h.prototype._convertWeatherData(wData, query)`.
fn convert_weather_data(w: &V, query: &V) {
    if w.nullish() || query.nullish() {
        return;
    }
    let to_temp = query.get("temperatureUnit");
    let to_precip = query.get("precipitationUnit");
    let to_wind = query.get("windSpeedUnit");
    let to_press = query.get("pressureUnit");
    let to_dist = query.get("distanceUnit");
    for name in ["s06", "sn1", "s1d"] {
        if w.has(name) {
            w.set(name, to_number(&w.get(name)) * 10.);
        }
    }
    if to_temp.truthy() && !strict_eq(&to_temp, &s("C")) {
        for name in [
            "t1h",
            "sensorytem",
            "dpt",
            "heatIndex",
            "t3h",
            "tmx",
            "tmn",
            "t1d",
        ] {
            if w.has(name) && !strict_eq(&w.get(name), &n(-50.)) {
                w.set(name, convert_units("C", &to_temp, &w.get(name)));
                if strict_eq(&to_temp, &s("F")) {
                    w.set(name, to_number(&w.get(name)).floor());
                }
            }
        }
    }
    if to_precip.truthy() && !strict_eq(&to_precip, &s("mm")) {
        for name in ["rn1", "rs1h", "rs1d", "r06", "s06", "sn1", "s1d"] {
            if w.has(name) {
                w.set(name, convert_units("mm", &to_wind, &w.get(name)));
            }
        }
    }
    if w.has("wsd") {
        w.set("wsd", convert_units("m/s", &to_wind, &w.get("wsd")));
    }
    if w.has("hPa") {
        w.set("hPa", convert_units("hPa", &to_press, &w.get("hPa")));
    }
    if w.has("visibility") {
        w.set(
            "visibility",
            convert_units("km", &to_dist, &w.get("visibility")),
        );
    }
}
fn convert_air_info(info: &V, unit: &V, current_date: &V) {
    if info.has("last") {
        recalculate_value(&info.get("last"), unit);
    }
    if info.has("pollutants") {
        let p = info.get("pollutants");
        for key in p.o().keys() {
            let pollutant = p.get(&key);
            if pollutant.has("daily") {
                for value in pollutant.get("daily").a().items() {
                    value.set(
                        "fromToday",
                        time::diff_days(&value.get("date"), current_date),
                    );
                    value.set("dayOfWeek", time::weekday(&value.get("date")));
                }
            }
        }
    }
}
pub fn convert_units_mw(cx: &mut Cx) -> Flow {
    let query = cx.r("query");
    let _ = catch(|| {
        let current = cx.r("current");
        if current.has("stnDateTime") {
            current.set(
                "dateObj",
                time::dotted_to_dot_space(&sv(&current.get("stnDateTime"))),
            );
        } else {
            current.set(
                "dateObj",
                time::dot_space(&to_str(&add(&current.get("date"), &current.get("time")))),
            );
        }
        let current_date = current.get("dateObj");
        current.set(
            "time",
            parse_int(&V::from(super::js::slice(
                &sv(&current.get("time")),
                0,
                Some(-2),
            ))),
        );
        convert_weather_data(&current, &query);
        let y = current.get("yesterday");
        if y.truthy() {
            convert_weather_data(&y, &query);
            if let V::Str(t) = y.get("time") {
                y.set(
                    "time",
                    parse_int(&V::from(super::js::slice(&t, 0, Some(-2)))),
                );
            }
        }
        for v in cx.r("shortest").a().items() {
            v.set(
                "dateObj",
                time::dot_space(&to_str(&add(&v.get("date"), &v.get("time")))),
            );
            convert_weather_data(&v, &query);
        }
        let short = cx.r("short");
        let rows = short.a().items();
        // Legacy never sets foundCurrentIndex, so every qualifying row is marked.
        let found = false;
        for (index, v) in rows.iter().enumerate() {
            v.set(
                "dateObj",
                time::dot_space(&to_str(&add(&v.get("date"), &v.get("time")))),
            );
            v.set(
                "time",
                parse_int(&V::from(super::js::slice(&sv(&v.get("time")), 0, Some(-2)))),
            );
            v.set(
                "fromToday",
                time::diff_days(&v.get("dateObj"), &current_date),
            );
            if !found && le(&v.get("dateObj"), &current_date) {
                if index == rows.len() - 1 {
                    v.set("currentIndex", true);
                } else {
                    let next = &rows[index + 1];
                    let next_date =
                        time::dot_space(&to_str(&add(&next.get("date"), &next.get("time"))));
                    if le(&current_date, &V::from(next_date)) {
                        v.set("currentIndex", true);
                    }
                }
            }
            convert_weather_data(v, &query);
        }
        for (index, v) in cx
            .r("midData")
            .get("dailyData")
            .a()
            .items()
            .iter()
            .enumerate()
        {
            v.set(
                "dateObj",
                time::dot_space(&format!("{}0000", to_str(&v.get("date")))),
            );
            v.set("skyAm", v.get("skyAmIcon"));
            v.set("skyPm", v.get("skyPmIcon"));
            v.set("tmx", v.get("taMax"));
            v.set("tmn", v.get("taMin"));
            v.set(
                "fromToday",
                time::diff_days(&v.get("dateObj"), &current_date),
            );
            v.set("dayOfWeek", time::weekday(&v.get("dateObj")));
            if strict_eq(&v.get("date"), &current.get("date")) {
                current.set("todayIndex", index as f64);
            }
            let dust = v.get("dustForecast");
            if !dust.nullish() {
                for (upper, lower) in [("PM10", "pm10"), ("PM25", "pm25"), ("O3", "o3")] {
                    let g = dust.get(&format!("{upper}Grade"));
                    if !g.nullish() {
                        dust.set(&format!("{lower}Grade"), add(&g, &n(1.)));
                        dust.set(&format!("{lower}Str"), dust.get(&format!("{upper}Str")));
                        dust.del(&format!("{upper}Grade"));
                        dust.del(&format!("{upper}Str"));
                    }
                }
            }
            for k in ["skyAmIcon", "skyPmIcon", "taMax", "taMin"] {
                v.del(k);
            }
            convert_weather_data(v, &query);
        }
        let unit = query.get("airUnit");
        if current.has("arpltn") {
            recalculate_value(&current.get("arpltn"), &unit);
        }
        if cx.has("airInfoList") {
            for info in cx.r("airInfoList").a().items() {
                convert_air_info(&info, &unit, &current_date);
            }
        } else if cx.has("airInfo") {
            convert_air_info(&cx.r("airInfo"), &unit, &current_date);
        }
    });
    Flow::Next
}

// ---- strings ----

fn make_arpltn_str(arpltn: &V, unit: &V, l: Locale) {
    for name in ["pm10", "pm25", "o3", "no2", "co", "so2", "khai", "aqi"] {
        let gk = format!("{name}Grade");
        if arpltn.has(&gk) {
            arpltn.set(
                &format!("{name}Str"),
                air_grade_str(unit, &arpltn.get(&gk), l),
            );
        }
    }
}
/// `UnitConverter.airGrade2Str(airUnit, grade, ts)`.
fn air_grade_str(unit: &V, grade: &V, l: Locale) -> String {
    let g = match grade {
        V::Num(x) => *x,
        _ => f64::NAN,
    };
    let key = if strict_eq(unit, &s("airnow")) || strict_eq(unit, &s("aqicn")) {
        match g {
            1. => "LOC_GOOD",
            2. => "LOC_MODERATE",
            3. => "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS",
            4. => "LOC_UNHEALTHY",
            5. => "LOC_VERY_UNHEALTHY",
            6. => "LOC_HAZARDOUS",
            _ => return String::new(),
        }
    } else {
        match g {
            1. => "LOC_GOOD",
            2. => "LOC_MODERATE",
            3. => "LOC_UNHEALTHY",
            4. => "LOC_VERY_UNHEALTHY",
            _ => return String::new(),
        }
    };
    tr(l, key)
}
fn insert_air_info_str(info: &V, unit: &V, l: Locale) {
    let last = info.get("last");
    if last.truthy() {
        make_arpltn_str(&last, unit, l);
        for name in ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"] {
            let gk = format!("{name}Grade");
            if last.has(&gk) {
                let guide =
                    units::action_guide(&world_val(unit), name, &world_val(&last.get(&gk)), l);
                last.set(
                    &format!("{name}ActionGuide"),
                    guide.str().map_or(V::Undef, V::from),
                );
            }
        }
    }
    let pollutants = info.get("pollutants");
    if pollutants.truthy() {
        for name in ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"] {
            let p = pollutants.get(name);
            if !p.truthy() {
                continue;
            }
            if p.get("hourly").truthy() {
                for item in p.get("hourly").a().items() {
                    if item.has("grade") {
                        item.set("str", air_grade_str(unit, &item.get("grade"), l));
                    }
                }
            }
            if p.get("daily").truthy() {
                for item in p.get("daily").a().items() {
                    for (g, k) in [
                        ("grade", "str"),
                        ("minGrade", "minStr"),
                        ("maxGrade", "maxStr"),
                    ] {
                        if item.has(g) {
                            item.set(k, air_grade_str(unit, &item.get(g), l));
                        }
                    }
                }
            }
        }
    }
}
/// Bridge a primitive to the S11 value type (action guides only read unit and grade).
fn world_val(v: &V) -> crate::world::js::Val {
    use crate::world::js::Val;
    match v {
        V::Undef => Val::Undef,
        V::Null => Val::Null,
        V::Bool(b) => Val::Bool(*b),
        V::Num(x) => Val::Num(*x),
        V::Str(t) => Val::Str(t.to_string()),
        V::Date(ms) => Val::Date(*ms),
        V::Arr(_) | V::Obj(_) => Val::Obj(crate::world::js::Obj::new()),
    }
}
fn sensorytem_str(st: &V, l: Locale) -> String {
    if ge(st, &n(0.)) {
        String::new()
    } else if gt(st, &n(-10.)) && lt(st, &n(0.)) {
        tr(l, "LOC_ATTENTION")
    } else if gt(st, &n(-25.)) && le(st, &n(-10.)) {
        tr(l, "LOC_CAUTION")
    } else if gt(st, &n(-45.)) && le(st, &n(-25.)) {
        tr(l, "LOC_WARNING")
    } else if le(st, &n(-45.)) {
        tr(l, "LOC_HAZARD")
    } else {
        String::new()
    }
}
fn wsd_grade(w: &V) -> V {
    n(if lt(w, &n(0.)) {
        0.
    } else if lt(w, &n(4.)) {
        1.
    } else if lt(w, &n(9.)) {
        2.
    } else if lt(w, &n(14.)) {
        3.
    } else if ge(w, &n(14.)) {
        4.
    } else {
        -1.
    })
}
fn wsd_str(g: &V, l: Locale) -> String {
    let key = match g {
        V::Num(x) if *x == 1. => "LOC_LIGHT_WIND",
        V::Num(x) if *x == 2. => "LOC_MODERATE_WIND",
        V::Num(x) if *x == 3. => "LOC_STRONG_WIND",
        V::Num(x) if *x == 4. => "LOC_VERY_STRONG_WIND",
        _ => return String::new(),
    };
    tr(l, key)
}
fn pty_str(pty: &V, l: Locale) -> String {
    if strict_eq(pty, &n(1.)) || strict_eq(pty, &n(2.)) {
        tr(l, "LOC_PRECIPITATION")
    } else if strict_eq(pty, &n(3.)) {
        tr(l, "LOC_SNOWFALL")
    } else {
        String::new()
    }
}
/// `_makeStrForKma(data, res)`.
fn make_str_for_kma(d: &V, l: Locale) {
    if d.has("sensorytem") && lt(&d.get("sensorytem"), &n(0.)) {
        d.set("sensorytemStr", sensorytem_str(&d.get("sensorytem"), l));
    }
    if d.has("fsnGrade") {
        d.set("fsnStr", grade_attention(&d.get("fsnGrade"), l));
    }
    if d.has("ultrvGrade") {
        d.set("ultrvStr", grade_high_low(&d.get("ultrvGrade"), l));
    }
    for name in ["flowerWoody", "flowerPine", "flowerWeeds"] {
        let gk = format!("{name}Grade");
        if d.has(&gk) {
            d.set(&format!("{name}Str"), grade_high_low(&d.get(&gk), l));
        }
    }
    if d.has("pollenGrade") {
        d.set("pollenStr", grade_high_low(&d.get("pollenGrade"), l));
    }
    if d.has("wsd") {
        d.set("wsdGrade", wsd_grade(&d.get("wsd")));
        d.set("wsdStr", wsd_str(&d.get("wsdGrade"), l));
    }
    if d.has("wdd") {
        let text = sv(&d.get("wdd"));
        let text = text
            .replace('N', &tr(l, "LOC_N"))
            .replace('S', &tr(l, "LOC_S"));
        let text = text
            .replace('E', &tr(l, "LOC_E"))
            .replace('W', &tr(l, "LOC_W"));
        d.set("wdd", text);
    }
    if d.has("pty") && gt(&d.get("pty"), &n(0.)) {
        d.set("ptyStr", pty_str(&d.get("pty"), l));
    }
    for (field, unit, ptys) in [
        ("r06", "mm", &[1., 2., 4., 5., 6.][..]),
        ("s06", "cm", &[2., 3., 6., 7.][..]),
        ("rn1", "mm", &[1., 2., 3., 4., 5., 6., 7.][..]),
    ] {
        if !d.has(field) {
            continue;
        }
        let mut total = precip::get(d, field);
        if total.is_none() && gt(&d.get("pty"), &n(0.)) {
            total = precip::parse(&d.get(field), unit, None);
        }
        if let Some(t) = &total
            && (t.amount > 0. || ptys.iter().any(|p| strict_eq(&d.get("pty"), &n(*p))))
        {
            d.set(&format!("{field}Str"), precip::format(Some(t), unit));
        }
    }
}
pub fn insert_str_for_data(cx: &mut Cx) -> Flow {
    let l = cx.locale;
    let mut air_unit = V::Undef;
    for key in ["short", "shortest"] {
        let list = cx.r(key);
        if list.truthy() {
            for d in list.a().items() {
                make_str_for_kma(&d, l);
            }
        }
    }
    let current = cx.r("current");
    if current.truthy() {
        make_str_for_kma(&current, l);
        if current.get("arpltn").truthy() {
            if cx.r("query").truthy() {
                air_unit = cx.query("airUnit");
            }
            make_arpltn_str(&current.get("arpltn"), &air_unit, l);
        }
    }
    let mid = cx.r("midData");
    if mid.truthy() {
        for d in mid.get("dailyData").a().items() {
            make_str_for_kma(&d, l);
        }
    }
    if cx.r("airInfoList").truthy() {
        for info in cx.r("airInfoList").a().items() {
            insert_air_info_str(&info, &air_unit, l);
        }
    } else if cx.r("airInfo").truthy() {
        insert_air_info_str(&cx.r("airInfo"), &air_unit, l);
    }
    Flow::Next
}

// ---- summaries ----

struct Item {
    text: String,
    grade: V,
}
fn order(mut items: Vec<Item>) -> Vec<Item> {
    wjs::js_sort(&mut items, |a, b| {
        if gt(&a.grade, &b.grade) {
            -1
        } else if lt(&a.grade, &b.grade) {
            1
        } else {
            0
        }
    });
    items
}
fn diff_today_yesterday(current: &V, yesterday: &V, l: Locale) -> (String, V) {
    let same = tr(l, "LOC_SIMILAR_TO_YESTERDAY");
    let than = tr(l, "LOC_THAN_YESTERDAY");
    let mut text = String::new();
    let mut grade = 0.;
    if policy::can_compare(current, yesterday) {
        let d = super::js::sub(&current.get("t1h"), &yesterday.get("t1h"));
        grade = round(d.abs());
        let d = round(d);
        if d == 0. {
            text.push_str(&same);
        } else {
            let t = if d > 0. {
                format!("+{}", to_str(&n(d)))
            } else {
                to_str(&n(d))
            };
            text.push_str(&than.replacen("%s", &t, 1));
        }
    }
    (text, n(grade))
}
fn has_weather_text(current: &V) -> bool {
    ge(&current.get("weatherType"), &n(0.))
        && matches!(current.get("weather"), V::Str(ref w) if !w.is_empty())
}
fn comparison_item(current: &V, yesterday: &V, l: Locale) -> Option<Item> {
    if !policy::can_compare(current, yesterday) {
        return None;
    }
    let (text, grade) = diff_today_yesterday(current, yesterday, l);
    let grade = if le(&grade, &n(2.)) { n(2.5) } else { grade };
    Some(Item { text, grade })
}
fn weather_item(current: &V) -> Option<Item> {
    if !has_weather_text(current) {
        return None;
    }
    let grade = if gt(&current.get("weatherType"), &n(3.)) {
        3.
    } else {
        2.5
    };
    Some(Item {
        text: to_str(&current.get("weather")),
        grade: n(grade),
    })
}
fn special_item(current: &V) -> Option<Item> {
    if !current.has("specialInfo") {
        return None;
    }
    let o = current.get("specialInfo").get("0");
    Some(Item {
        text: to_str(&add(&o.get("weatherStr"), &o.get("levelStr"))),
        grade: add(&o.get("weather"), &n(5.)),
    })
}
fn rain_item(current: &V, units: &V, l: Locale) -> Option<Item> {
    if !(current.get("rn1").truthy() && current.get("pty").truthy()) {
        return None;
    }
    let pty = current.get("pty");
    let label = if strict_eq(&pty, &n(1.)) {
        tr(l, "LOC_RAINFALL")
    } else if strict_eq(&pty, &n(2.)) {
        tr(l, "LOC_PRECIPITATION")
    } else if strict_eq(&pty, &n(3.)) {
        tr(l, "LOC_SNOWFALL")
    } else {
        String::new()
    };
    current.set("ptyStr", label.clone());
    let rn1_str = to_str(&add(&current.get("rn1"), &units.get("precipitationUnit")));
    current.set("rn1Str", rn1_str.clone());
    Some(Item {
        text: format!("{label} {rn1_str}"),
        grade: add(&current.get("rn1"), &n(3.)),
    })
}
fn discomfort_item(current: &V, l: Locale) -> Option<Item> {
    let g = current.get("dsplsGrade");
    if !(g.truthy() && ge(&current.get("t1h"), &n(20.))) {
        return None;
    }
    Some(Item {
        text: format!(
            "{} {}",
            tr(l, "LOC_DISCOMFORT_INDEX"),
            to_str(&current.get("dsplsStr"))
        ),
        grade: g,
    })
}
fn feels_item(current: &V, l: Locale) -> Option<Item> {
    let st = current.get("sensorytem");
    if !(st.truthy() && !strict_eq(&st, &current.get("t1h"))) {
        return None;
    }
    let diff = round(super::js::sub(&st, &current.get("t1h")));
    Some(Item {
        text: format!("{} {}˚", tr(l, "LOC_FEELS_LIKE"), to_str(&st)),
        grade: n(diff.abs()),
    })
}
fn uv_item(current: &V, time_value: &V, l: Locale) -> Option<Item> {
    if !(current.get("ultrv").truthy() && le(time_value, &n(15.))) {
        return None;
    }
    let mut g = current.get("ultrvGrade");
    if ge(&current.get("time"), &n(11.)) {
        g = n(to_number(&g) + 1.);
    }
    Some(Item {
        text: format!("{} {}", tr(l, "LOC_UV"), to_str(&current.get("ultrvStr"))),
        grade: g,
    })
}
fn wind_item(current: &V) -> Option<Item> {
    if !(current.get("wsdGrade").truthy() && current.get("wsdStr").truthy()) {
        return None;
    }
    Some(Item {
        text: to_str(&current.get("wsdStr")),
        grade: add(&current.get("wsdGrade"), &n(1.)),
    })
}
fn join(items: Vec<Item>) -> String {
    let items = order(items);
    match items.len() {
        0 => String::new(),
        1 => items[0].text.clone(),
        _ => format!("{}, {}", items[0].text, items[1].text),
    }
}
/// `ControllerTown24h.makeSummaryWeather`.
fn summary_weather(current: &V, yesterday: &V, units: &V, l: Locale) -> String {
    let mut items = Vec::new();
    items.extend(comparison_item(current, yesterday, l));
    items.extend(weather_item(current));
    items.extend(special_item(current));
    items.extend(rain_item(current, units, l));
    items.extend(discomfort_item(current, l));
    items.extend(feels_item(current, l));
    items.extend(uv_item(current, &current.get("time"), l));
    items.extend(wind_item(current));
    join(items)
}
/// `ControllerTown24h.makeSummaryAir`.
fn summary_air(current: &V, l: Locale) -> String {
    let air = current.get("arpltn");
    if !air.truthy() {
        return String::new();
    }
    for name in ["Value", "Grade", "Str"] {
        let khai = air.get(&format!("khai{name}"));
        air.set(
            &format!("aqi{name}"),
            if khai.truthy() {
                khai
            } else {
                air.get(&format!("aqi{name}"))
            },
        );
    }
    let mut max = n(0.);
    for key in air.o().keys() {
        if key.contains("Grade") && !key.contains("Grade24") && gt(&air.get(&key), &max) {
            max = air.get(&key);
        }
    }
    if le(&max, &n(0.)) {
        return String::new();
    }
    if strict_eq(&max, &n(1.)) {
        return tr(l, "LOC_AIR_QUALITY_IS_GOOD");
    }
    if strict_eq(&max, &n(2.)) {
        return tr(l, "LOC_AIR_QUALITY_IS_MODERATE");
    }
    let mut items = Vec::new();
    for (label, code, field) in [
        ("LOC_PM25", "pm25", "Value"),
        ("LOC_PM10", "pm10", "Value"),
        ("LOC_O3", "o3", "Value"),
        ("LOC_NO2", "no2", "Grade"),
        ("LOC_SO2", "so2", "Grade"),
        ("LOC_CO", "co", "Grade"),
    ] {
        if air.get(&format!("{code}{field}")).truthy() {
            items.push(Item {
                text: format!(
                    "{} {} {}",
                    tr(l, label),
                    to_str(&air.get(&format!("{code}Value"))),
                    to_str(&air.get(&format!("{code}Str")))
                ),
                grade: air.get(&format!("{code}Index")),
            });
        }
    }
    order(items)
        .into_iter()
        .next()
        .map_or_else(String::new, |i| i.text)
}
/// `ControllerTown.makeSummary`.
fn summary(current: &V, yesterday: &V, units: &V, l: Locale) -> String {
    let mut items = Vec::new();
    items.extend(comparison_item(current, yesterday, l));
    items.extend(weather_item(current));
    items.extend(special_item(current));
    let air = current.get("arpltn");
    let air = if air.truthy() {
        air
    } else {
        V::Obj(super::js::Ob::new())
    };
    for name in ["Grade", "Str"] {
        let khai = air.get(&format!("khai{name}"));
        air.set(
            &format!("aqi{name}"),
            if khai.truthy() {
                khai
            } else {
                air.get(&format!("aqi{name}"))
            },
        );
    }
    let mut grade = n(0.);
    let mut text = String::new();
    if air.get("pm25Grade").truthy() {
        grade = air.get("pm25Grade");
        text = format!("{} {}", tr(l, "LOC_PM25"), to_str(&air.get("pm25Str")));
    }
    if air.get("pm10Grade").truthy() && lt(&grade, &air.get("pm10Grade")) {
        grade = air.get("pm10Grade");
        text = format!("{} {}", tr(l, "LOC_PM10"), to_str(&air.get("pm10Str")));
    }
    if air.get("aqiGrade").truthy() && lt(&grade, &air.get("aqiGrade")) {
        grade = air.get("aqiGrade");
        text = format!("{} {}", tr(l, "LOC_AQI"), to_str(&air.get("aqiStr")));
    }
    if gt(&grade, &n(0.)) {
        items.push(Item { text, grade });
    }
    items.extend(rain_item(current, units, l));
    items.extend(discomfort_item(current, l));
    items.extend(feels_item(current, l));
    let t = match current.get("time") {
        V::Str(x) => n(wjs::string_to_number(&x) / 100.),
        other => other,
    };
    items.extend(uv_item(current, &t, l));
    items.extend(wind_item(current));
    join(items)
}
pub fn get_summary_after_unit_converter(cx: &mut Cx) -> Flow {
    let (current, list) = (cx.r("current"), cx.r("currentList"));
    if !current.truthy() || !list.truthy() {
        return Flow::Next;
    }
    let l = cx.locale;
    let query = cx.r("query");
    let r = catch(|| {
        current.set(
            "summaryWeather",
            summary_weather(&current, &current.get("yesterday"), &query, l),
        );
        current.set("summaryAir", summary_air(&current, l));
        if !current.get("summaryAir").truthy() {
            current.del("summaryAir");
        }
        current.set(
            "summary",
            summary(&current, &current.get("yesterday"), &query, l),
        );
    });
    if r.is_err() {
        current.set("summary", "");
    }
    Flow::Next
}
