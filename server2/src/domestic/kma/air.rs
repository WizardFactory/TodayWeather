//! Enrichment steps of the v000903 chain: life index and food poisoning, AirKorea current
//! air with the provider fallback, dust forecasts, rise/set, air info lists and station
//! forecasts. Grades and indexes use the S11 `AqiConverter` port.
use super::chain::{Cx, Flow};
use super::js::{
    Arr, Ob, V, add, catch, from_store, ge, gt, is_finite_number, le, loose_eq, lt, obj, round,
    strict_eq, sv, throw, to_number, to_str,
};
use super::time;
use crate::world::units;

fn s(v: &str) -> V {
    V::s(v)
}
fn n(x: f64) -> V {
    V::Num(x)
}

// ---- AqiConverter / KecoController helpers ----

/// `AqiConverter.value2grade(airUnit, code, v)`; an unknown unit/code throws like legacy.
pub fn value2grade(unit: &V, code: &str, v: &V) -> f64 {
    units::value2grade(&to_str(unit), code, to_number(v))
        .unwrap_or_else(|_| throw("TypeError: Cannot read property of undefined (air unit)"))
}
/// `AqiConverter.value2index(airUnit, code, value)`.
pub fn value2index(unit: &V, code: &str, v: &V) -> V {
    if code == "aqi" || code == "khai" {
        return v.clone();
    }
    V::Num(
        units::value2index(&to_str(unit), code, to_number(v))
            .unwrap_or_else(|_| throw("TypeError: Cannot read property of undefined (air unit)")),
    )
}
/// AirKorea breakpoints for `grade2minMaxValue('airkorea', code, grade)` (aqi.converter.js).
fn airkorea_breakpoints(code: &str) -> Option<[f64; 5]> {
    Some(match code {
        "pm25" => [0., 15., 35., 75., 500.],
        "pm10" => [0., 30., 80., 150., 600.],
        "o3" => [0., 0.03, 0.09, 0.15, 0.6],
        _ => return None,
    })
}
/// `AqiConverter.grade2minMaxValue('airkorea', code, grade)` → (min, max).
fn grade2min_max(code: &str, grade: &V) -> (V, V) {
    let Some(b) = airkorea_breakpoints(code) else {
        throw("TypeError: unknown pollutant");
    };
    let at = |g: f64| {
        if g >= 0. && g.fract() == 0. && (g as usize) < b.len() {
            n(b[g as usize])
        } else {
            V::Undef
        }
    };
    let g = to_number(grade);
    let mut min = at(g - 1.);
    let inc = if code == "o3" { 0.001 } else { 0.1 };
    min = add(&min, &n(inc));
    (min, at(g))
}
/// `KecoController._parseDateTime(dataTime)`.
pub fn parse_date_time(v: &V) -> f64 {
    let Some(t) = v.str() else {
        return f64::NAN;
    };
    let b = t.as_bytes();
    let digits = |r: std::ops::Range<usize>| {
        t.get(r.clone())
            .filter(|x| x.bytes().all(|c| c.is_ascii_digit()))
            .map(|x| x.parse::<f64>().unwrap_or(f64::NAN))
    };
    if b.len() != 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b' ' || b[13] != b':' {
        return f64::NAN;
    }
    let (Some(y), Some(m), Some(d), Some(h), Some(mi)) = (
        digits(0..4),
        digits(5..7),
        digits(8..10),
        digits(11..13),
        digits(14..16),
    ) else {
        return f64::NAN;
    };
    let midnight = time::parse_date(&format!("{}T00:00:00Z", &t[..10]));
    let iso_ok = crate::world::js::iso(midnight).is_some_and(|i| i[..10] == t[..10]);
    let _ = (y, m, d);
    if !midnight.is_finite() || !iso_ok || h > 24. || mi > 59. || (h == 24. && mi != 0.) {
        return f64::NAN;
    }
    midnight + (h - 9.) * time::HOUR + mi * 60_000.
}
/// `KecoController._checkDateTime(arpltn, now)`.
fn check_date_time(row: &V, now_ms: f64) -> bool {
    let dt = if row.truthy() {
        row.get("dataTime")
    } else {
        V::Undef
    };
    now_ms - 8. * time::HOUR < parse_date_time(&dt)
}
/// `_formatAirKstTime(epoch)`.
fn format_air_kst(epoch: f64) -> String {
    match crate::world::js::iso(epoch + 9. * time::HOUR) {
        Some(i) => i[..16].replace('T', " "),
        None => throw("RangeError: Invalid time value"),
    }
}
/// `KecoController.recalculateValue(arpltn, airUnit)`.
pub fn recalculate_value(arpltn: &V, unit: &V) -> V {
    if arpltn.nullish() {
        return arpltn.clone();
    }
    for name in ["pm10", "pm25", "o3", "no2", "co", "so2"] {
        let value_key = format!("{name}Value");
        if arpltn.has(&value_key) {
            let grade_key = format!("{name}Grade");
            if strict_eq(unit, &s("airkorea"))
                && arpltn.has(&grade_key)
                && !strict_eq(&arpltn.get(&grade_key), &n(-1.))
            {
                continue;
            }
            let value = arpltn.get(&value_key);
            arpltn.set(&format!("{name}Index"), value2index(unit, name, &value));
            arpltn.set(&grade_key, value2grade(unit, name, &value));
            if strict_eq(&arpltn.get(&grade_key), &n(-1.)) {
                arpltn.del(&grade_key);
                arpltn.del(&value_key);
                arpltn.del(&format!("{name}Str"));
            }
        }
    }
    let mut aqi = n(-1.);
    for name in ["pm10", "pm25", "o3", "no2", "co", "so2"] {
        let index_key = format!("{name}Index");
        if !arpltn.has(&index_key) {
            arpltn.set(
                &index_key,
                value2index(unit, name, &arpltn.get(&format!("{name}Value"))),
            );
        }
        if gt(&arpltn.get(&index_key), &aqi) {
            aqi = arpltn.get(&index_key);
        }
    }
    arpltn.set("aqiValue", aqi.clone());
    arpltn.set("aqiIndex", aqi.clone());
    arpltn.set("khaiValue", aqi.clone());
    let grade = value2grade(unit, "aqi", &aqi);
    arpltn.set("aqiGrade", grade);
    arpltn.set("khaiGrade", grade);
    if strict_eq(&arpltn.get("aqiGrade"), &n(-1.)) {
        for k in ["aqiGrade", "aqiValue", "aqiStr"] {
            arpltn.del(k);
        }
    }
    if strict_eq(&arpltn.get("khaiGrade"), &n(-1.)) {
        for k in ["khaiGrade", "khaiValue", "khaiStr"] {
            arpltn.del(k);
        }
    }
    arpltn.clone()
}

// ---- life index and food poisoning ----

fn ultrv_grade(v: f64) -> f64 {
    units::ultrv_grade(v)
}
/// `LifeIndexKmaController._addIndexData2(midList, lifeIndexList)`: applied count.
fn add_index_data2(days: &V, list: &V) -> usize {
    let mut applied = 0;
    for day in days.a().items() {
        let rows: Vec<V> = list
            .a()
            .items()
            .into_iter()
            .filter(|row| {
                time::yyyymmdd(&row.get("date")) == to_str(&day.get("date"))
                    && matches!(day.get("date"), V::Str(_))
            })
            .collect();
        if rows.is_empty() {
            continue;
        }
        for row in rows {
            let kind = row.get("indexType");
            let index = row.get("index");
            if strict_eq(&kind, &s("ultrv")) && is_finite_number(&index) && to_number(&index) >= 0.
            {
                day.set("ultrv", index.clone());
                day.set("ultrvGrade", ultrv_grade(to_number(&index)));
                applied += 1;
            } else if ["flowerWoody", "flowerPine", "flowerWeeds"]
                .iter()
                .any(|k| strict_eq(&kind, &s(k)))
                && matches!(index, V::Num(x) if x.fract() == 0. && (0. ..=3.).contains(&x))
            {
                let k = to_str(&kind);
                day.set(&k, index.clone());
                day.set(&format!("{k}Grade"), index.clone());
                applied += 1;
            }
        }
        let grades: Vec<f64> = ["flowerWoody", "flowerPine", "flowerWeeds"]
            .iter()
            .filter_map(|k| match day.get(&format!("{k}Grade")) {
                V::Num(g) if g.fract() == 0. && (0. ..=3.).contains(&g) => Some(g),
                _ => None,
            })
            .collect();
        if !grades.is_empty() {
            day.set(
                "pollenGrade",
                grades.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            );
        }
    }
    applied
}
enum LifeIndex {
    Applied,
    NotFound,
    Failed,
}
/// `LifeIndexKmaController.appendData2(areaNo, midList)`.
fn append_data2(cx: &Cx, area_no: &V, days: &V) -> LifeIndex {
    let code = super::js::parse_int(area_no);
    let rows = match cx.store.life_index(code) {
        Ok(v) => from_store(&v),
        Err(_) => return LifeIndex::Failed,
    };
    let list = rows.a();
    if list.is_empty() || !list.at(0).get("lastUpdateDate").truthy() {
        return LifeIndex::NotFound;
    }
    match catch(|| add_index_data2(days, &rows)) {
        Ok(0) => LifeIndex::NotFound,
        Ok(_) => LifeIndex::Applied,
        Err(_) => LifeIndex::Failed,
    }
}
/// `_appendLifeIndexToCurrent(current, short, dailyData)`.
fn append_life_index_to_current(current: &V, days: &V) {
    for day in days.a().items() {
        if strict_eq(&day.get("date"), &current.get("date")) {
            if day.has("ultrv") {
                current.set("ultrv", day.get("ultrv"));
                current.set("ultrvGrade", day.get("ultrvGrade"));
                current.set("ultrvStr", day.get("ultrvStr"));
            }
            if day.has("pollenGrade") {
                current.set("pollenGrade", day.get("pollenGrade"));
                current.set("pollenStr", day.get("pollenStr"));
            }
            for name in ["fsn", "flowerWoody", "flowerPine", "flowerWeeds"] {
                if day.has(name) {
                    current.set(name, day.get(name));
                    current.set(&format!("{name}Grade"), day.get(&format!("{name}Grade")));
                    current.set(&format!("{name}Str"), day.get(&format!("{name}Str")));
                }
            }
            break;
        }
    }
}
fn trim_js(s: &str) -> &str {
    s.trim_matches(super::precip::js_ws)
}
/// `foodPoisoning.region(town)`.
fn food_region(first: &V, second: &V) -> Option<(String, String)> {
    let first = first.str()?;
    let mut sd = trim_js(first).to_owned();
    let sgg: String = match second {
        V::Str(x) => x.chars().filter(|c| !super::precip::js_ws(*c)).collect(),
        _ => String::new(),
    };
    if sd == "전남광주통합특별시" {
        const GWANGJU: [&str; 5] = ["동구", "서구", "남구", "북구", "광산구"];
        const JEONNAM: [&str; 22] = [
            "목포시",
            "여수시",
            "순천시",
            "나주시",
            "광양시",
            "담양군",
            "곡성군",
            "구례군",
            "고흥군",
            "보성군",
            "화순군",
            "장흥군",
            "강진군",
            "해남군",
            "영암군",
            "무안군",
            "함평군",
            "영광군",
            "장성군",
            "완도군",
            "진도군",
            "신안군",
        ];
        if GWANGJU.contains(&sgg.as_str()) {
            sd = "광주광역시".into();
        } else if JEONNAM.contains(&sgg.as_str()) {
            sd = "전라남도".into();
        } else {
            return None;
        }
    }
    sd = match sd.as_str() {
        "전라북도" => "전북특별자치도".into(),
        "강원도" => "강원특별자치도".into(),
        _ => sd,
    };
    (!sd.is_empty()).then_some((sd, sgg))
}
fn date_key(ms: f64) -> Option<String> {
    crate::world::js::iso(ms).map(|i| i[..10].replace('-', ""))
}
fn day_ms(key: &V) -> f64 {
    let Some(k) = key.str() else {
        return f64::NAN;
    };
    if k.len() != 8 || !k.bytes().all(|b| b.is_ascii_digit()) {
        return f64::NAN;
    }
    let ms = time::make_date(
        k[0..4].parse().unwrap_or(f64::NAN),
        k[4..6].parse::<f64>().unwrap_or(f64::NAN) - 1.,
        k[6..8].parse().unwrap_or(f64::NAN),
        0.,
        0.,
        0.,
    );
    if date_key(ms).as_deref() == Some(k) {
        ms
    } else {
        f64::NAN
    }
}
fn publication_ms(p: &V) -> f64 {
    let Some(t) = p.str() else {
        return f64::NAN;
    };
    // Byte tests: a non-ASCII string must be rejected, never sliced inside a character.
    let b = t.as_bytes();
    let dig = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    let ok = b.len() == 14
        && dig(0..4)
        && b[4] == b'-'
        && dig(5..7)
        && b[7] == b'-'
        && dig(8..10)
        && dig(10..14);
    if !ok {
        return f64::NAN;
    }
    let day = t[..10].replace('-', "");
    let (h, m): (f64, f64) = (
        t[10..12].parse().unwrap_or(99.),
        t[12..14].parse().unwrap_or(99.),
    );
    if h > 23. || m > 59. {
        return f64::NAN;
    }
    day_ms(&V::from(day)) + (h - 9.) * time::HOUR + m * 60_000.
}
fn fsn_grade(risk: f64) -> f64 {
    if risk < 0.315 {
        0.
    } else if risk < 0.559 {
        1.
    } else if risk < 0.743 {
        2.
    } else {
        3.
    }
}
/// `foodPoisoning.shared().append(town, days, now)`.
fn append_food_poisoning(cx: &Cx, days: &V) {
    let Some((sd, sgg)) = food_region(&cx.param("region"), &cx.param("city")) else {
        return;
    };
    if days.as_arr().is_none() {
        return;
    }
    let now = cx.now;
    let Some(start) = date_key(now + 9. * time::HOUR) else {
        return;
    };
    let Some(end) = date_key(day_ms(&V::from(start.clone())) + 2. * time::DAY) else {
        return;
    };
    let rows = match cx.store.food_poisoning(&sd, &sgg, &start, &end) {
        Ok(v) => from_store(&v),
        Err(_) => return,
    };
    let Some(rows) = rows.as_arr() else {
        return;
    };
    let mut by_date: Vec<(String, V)> = Vec::new();
    for row in rows.items() {
        let date = row.get("date");
        let base = row.get("baseDate");
        let publication = row.get("publication");
        let value = row.get("value");
        let risk = row.get("risk");
        let ds = to_str(&date);
        let valid = strict_eq(&row.get("sd"), &s(&sd))
            && (strict_eq(&row.get("sgg"), &s(&sgg)) || strict_eq(&row.get("sgg"), &s("")))
            && day_ms(&date).is_finite()
            && !lt(&date, &s(&start))
            && !gt(&date, &s(&end))
            && day_ms(&base).is_finite()
            && !gt(&base, &s(&start))
            && !lt(&date, &base)
            && day_ms(&date) <= day_ms(&base) + 2. * time::DAY
            && publication_ms(&publication).is_finite()
            && publication_ms(&publication) <= now
            && publication
                .str()
                .and_then(|p| p.get(..10))
                .is_some_and(|p| p.replace('-', "") == to_str(&base))
            && is_finite_number(&value)
            && (0. ..=100.).contains(&to_number(&value))
            && is_finite_number(&risk)
            && (0. ..=1.).contains(&to_number(&risk))
            && to_number(&value) == crate::world::js::fixed(to_number(&risk) * 100., 4)
            && strict_eq(&row.get("grade"), &n(fsn_grade(to_number(&risk))));
        if !valid {
            continue;
        }
        let prev = by_date
            .iter()
            .find(|(d, _)| *d == ds)
            .map(|(_, r)| r.clone());
        let replace = match &prev {
            None => true,
            Some(p) => {
                (strict_eq(&row.get("sgg"), &s(&sgg)) && !strict_eq(&p.get("sgg"), &s(&sgg)))
                    || (strict_eq(&row.get("sgg"), &p.get("sgg"))
                        && gt(&publication, &p.get("publication")))
            }
        };
        if replace {
            match by_date.iter_mut().find(|(d, _)| *d == ds) {
                Some(slot) => slot.1 = row,
                None => by_date.push((ds, row)),
            }
        }
    }
    for day in days.a().items() {
        let ds = to_str(&day.get("date"));
        if let Some((_, row)) = by_date.iter().find(|(d, _)| *d == ds) {
            day.set("fsn", row.get("value"));
            day.set("fsnGrade", row.get("grade"));
        }
    }
}
pub fn get_life_index_kma(cx: &mut Cx) -> Flow {
    if !cx.r("short").truthy() && !cx.r("midData").truthy() {
        return Flow::Next;
    }
    let region = to_str(&cx.param("region"));
    let city = to_str(&cx.param("city"));
    let town = to_str(&cx.param("town"));
    let mut applied = false;
    // findAreaNo .. appendNearLifeIndex (async.waterfall); errors end the waterfall.
    let mut area_info = V::Undef;
    let waterfall = (|| -> Result<(), ()> {
        let list = cx.store.area_no(&region, &city, &town).map_err(|_| ())?;
        let list = from_store(&list);
        if let Some(first) = list.as_arr().filter(|a| !a.is_empty()).map(|a| a.at(0)) {
            area_info = first.clone();
            cx.r("params").set("areaNo", first.get("areaNo"));
            let geo = first.get("geo");
            cx.set(
                "geocode",
                V::Obj(obj(vec![("lat", geo.get("1")), ("lon", geo.get("0"))])),
            );
            match append_data2(cx, &first.get("areaNo"), &cx.r("midData").get("dailyData")) {
                LifeIndex::Applied => {
                    applied = true;
                    return Ok(());
                }
                LifeIndex::NotFound => (),
                LifeIndex::Failed => return Err(()),
            }
        }
        let g = cx.r("gCoord");
        let lon_lat = if g.truthy() {
            cx.set("geocode", g.clone());
            V::Arr(Arr::from_vec(vec![g.get("lon"), g.get("lat")]))
        } else if area_info.truthy() {
            let geo = area_info.get("geo");
            cx.set(
                "geocode",
                V::Obj(obj(vec![("lat", geo.get("1")), ("lon", geo.get("0"))])),
            );
            geo
        } else {
            return Err(());
        };
        let near = cx
            .store
            .area_no_near(&super::to_store(&lon_lat))
            .map_err(|_| ())?;
        let near = from_store(&near);
        let mut candidates = near.a().items();
        if area_info.truthy() {
            candidates.retain(|a| !loose_eq(&a.get("areaNo"), &area_info.get("areaNo")));
        }
        for candidate in candidates {
            match append_data2(
                cx,
                &candidate.get("areaNo"),
                &cx.r("midData").get("dailyData"),
            ) {
                LifeIndex::Applied => {
                    cx.r("params").set("areaNo", candidate.get("areaNo"));
                    applied = true;
                    return Ok(());
                }
                LifeIndex::NotFound => continue,
                LifeIndex::Failed => return Err(()),
            }
        }
        Ok(())
    })();
    let _ = waterfall;
    if applied && cx.has("current") {
        append_life_index_to_current(&cx.r("current"), &cx.r("midData").get("dailyData"));
    }
    let mid = cx.r("midData");
    let days = if mid.truthy() {
        mid.get("dailyData")
    } else {
        V::Undef
    };
    append_food_poisoning(cx, &days);
    let current = cx.r("current");
    if current.truthy() && mid.truthy() && mid.get("dailyData").as_arr().is_some() {
        append_life_index_to_current(&current, &mid.get("dailyData"));
    }
    Flow::Next
}

// ---- AirKorea current air and fallback ----

fn ensure_current(cx: &Cx) {
    if !cx.r("current").truthy() {
        let (d, t) = cx.current_time_value(9.);
        cx.set(
            "current",
            V::Obj(obj(vec![("time", V::from(t)), ("date", V::from(d))])),
        );
    }
}
pub fn get_keco(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        ensure_current(cx);
        let Ok(town) = cx.town_info() else {
            return;
        };
        if town.truthy() && town.get("gCoord").truthy() {
            cx.set("airGCoord", town.get("gCoord"));
        }
        let info = cx
            .store
            .arpltn(&super::to_store(&town), cx.now)
            .ok()
            .map(|v| from_store(&v))
            .unwrap_or_default();
        if !info.truthy() {
            return;
        }
        cx.r("current").set("arpltn", info.get("arpltn"));
        cx.set("arpltnList", info.get("list"));
        cx.set("arpltnStnList", info.get("stnList"));
    });
    Flow::Next
}
fn has_air_value(arpltn: &V) -> bool {
    if !arpltn.truthy() {
        return false;
    }
    ["pm10", "pm25", "o3", "no2", "co", "so2", "khai"]
        .iter()
        .any(|name| {
            let v = arpltn.get(&format!("{name}Value"));
            is_finite_number(&v) && !strict_eq(&v, &n(-1.))
        })
}
pub fn get_air_fallback(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let current = cx.r("current");
        if !current.truthy() || has_air_value(&current.get("arpltn")) {
            return;
        }
        let g = cx.r("gCoord");
        let g = if g.truthy() { g } else { cx.r("airGCoord") };
        if !g.truthy() {
            return;
        }
        let Ok(found) = cx.store.air_fallback(&super::to_store(&g), cx.now) else {
            return;
        };
        let arpltn = from_store(&found);
        if arpltn.truthy() {
            let _ = catch(|| {
                current.set("arpltn", arpltn.clone());
                cx.set("arpltnList", V::Arr(Arr::from_vec(vec![arpltn.clone()])));
                cx.set(
                    "arpltnStnList",
                    V::Arr(Arr::from_vec(vec![V::Arr(Arr::from_vec(vec![
                        arpltn.clone(),
                    ]))])),
                );
            });
        }
    });
    Flow::Next
}
pub fn get_keco_dust_forecast(cx: &mut Cx) -> Flow {
    if !strict_eq(&cx.query("airForecastSource"), &s("airkorea")) {
        return Flow::Next;
    }
    let mid = cx.r("midData");
    if !mid.truthy() {
        return Flow::Next;
    }
    let add_list = |days: &V, list: &V| {
        for result in list.a().items() {
            for day in days.a().items() {
                if strict_eq(&day.get("date"), &result.get("date")) {
                    day.set("dustForecast", result.get("dustForecast"));
                }
            }
        }
    };
    if cx.has("dustFrcstList") && cx.r("dustFrcstList").as_arr().is_some() {
        add_list(&mid.get("dailyData"), &cx.r("dustFrcstList"));
        return Flow::Next;
    }
    let _ = catch(|| {
        let (date, _) = cx.current_time_value(9.);
        let region = to_str(&cx.param("region"));
        let city = to_str(&cx.param("city"));
        let Ok(results) = cx.store.dust_forecast(&region, &city, &date) else {
            return;
        };
        add_list(&mid.get("dailyData"), &from_store(&results));
    });
    Flow::Next
}

// ---- rise/set ----

pub fn get_rise_set_info(cx: &mut Cx) -> Flow {
    let mid = cx.r("midData");
    if mid.nullish() || mid.get("dailyData").nullish() || mid.get("dailyData").as_arr().is_none() {
        return Flow::Next;
    }
    let days = mid.get("dailyData");
    let dates: Vec<String> = days
        .a()
        .items()
        .iter()
        .map(|d| to_str(&d.get("date")))
        .collect();
    let _ = (|| -> Result<(), ()> {
        let geocode = if cx.r("geocode").truthy() {
            cx.r("geocode")
        } else {
            let list = cx
                .store
                .town(
                    &to_str(&cx.param("region")),
                    &to_str(&cx.param("city")),
                    &to_str(&cx.param("town")),
                )
                .map_err(|_| ())?;
            let list = from_store(&list);
            let first = list
                .as_arr()
                .filter(|a| !a.is_empty())
                .map(|a| a.at(0))
                .ok_or(())?;
            cx.set("geocode", first.get("gCoord"));
            first.get("gCoord")
        };
        let list = cx
            .store
            .rise_set(&super::to_store(&geocode), &dates)
            .map_err(|_| ())?;
        let list = from_store(&list);
        for rs in list.a().items() {
            for day in days.a().items() {
                if loose_eq(&day.get("date"), &rs.get("date")) {
                    day.o().copy_from(rs.o());
                    break;
                }
            }
        }
        Ok(())
    })();
    let g = cx.r("geocode");
    let g = if g.truthy() { g } else { cx.r("gCoord") };
    fill_missing_rise_set(&days, &g);
    Flow::Next
}
/// `_fillMissingRiseSet(dailyData, geocode)`.
fn fill_missing_rise_set(days: &V, geocode: &V) {
    if !geocode.truthy() {
        return;
    }
    for day in days.a().items() {
        if day.get("sunrise").truthy() && day.get("sunset").truthy() {
            continue;
        }
        let Some((rise, set)) =
            sun_rise_set(&geocode.get("lat"), &geocode.get("lon"), &day.get("date"))
        else {
            continue;
        };
        if !day.get("sunrise").truthy() {
            day.set("sunrise", rise);
        }
        if !day.get("sunset").truthy() {
            day.set("sunset", set);
        }
    }
}
/// `lib/sunRiseSet.compute(lat, lon, YYYYMMDD)` (NOAA equations, KST).
pub fn sun_rise_set(lat: &V, lon: &V, date: &V) -> Option<(String, String)> {
    let (lat, lon) = (to_number(lat), to_number(lon));
    let d = date.str()?;
    if !lat.is_finite()
        || !lon.is_finite()
        || lat.abs() > 90.
        || lon.abs() > 180.
        || d.len() != 8
        || !d.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let (year, month, day): (f64, f64, f64) = (
        d[0..4].parse().ok()?,
        d[4..6].parse().ok()?,
        d[6..8].parse().ok()?,
    );
    let check = time::make_date(year, month - 1., day, 0., 0., 0.);
    let p = crate::world::js::parts(check)?;
    if (p.month - 1) as f64 != month - 1. || p.day as f64 != day {
        return None;
    }
    let jd0 = julian_day(year, month, day);
    let rise = event_minutes(jd0, lat, lon, true)?;
    let set = event_minutes(jd0, lat, lon, false)?;
    Some((
        format_kst(year, month, day, rise),
        format_kst(year, month, day, set),
    ))
}
fn to_rad(d: f64) -> f64 {
    d * std::f64::consts::PI / 180.
}
fn to_deg(r: f64) -> f64 {
    r * 180. / std::f64::consts::PI
}
fn julian_day(mut year: f64, mut month: f64, day: f64) -> f64 {
    if month <= 2. {
        year -= 1.;
        month += 12.;
    }
    let a = (year / 100.).floor();
    let b = 2. - a + (a / 4.).floor();
    (365.25 * (year + 4716.)).floor() + (30.6001 * (month + 1.)).floor() + day + b - 1524.5
}
fn solar_position(jd: f64) -> (f64, f64) {
    let t = (jd - 2451545.0) / 36525.0;
    let mean_long = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.;
    let mean_anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    let eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    let m = to_rad(mean_anomaly);
    let center = m.sin() * (1.914602 - t * (0.004817 + 0.000014 * t))
        + (2. * m).sin() * (0.019993 - 0.000101 * t)
        + (3. * m).sin() * 0.000289;
    let omega = to_rad(125.04 - 1934.136 * t);
    let apparent_long = to_rad(mean_long + center - 0.00569 - 0.00478 * omega.sin());
    let mean_obliq =
        23. + (26. + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.) / 60.;
    let obliq = to_rad(mean_obliq + 0.00256 * omega.cos());
    let declination = to_deg((obliq.sin() * apparent_long.sin()).asin());
    let y = (obliq / 2.).tan().powi(2);
    let l0 = to_rad(mean_long);
    let eq = 4.
        * to_deg(
            y * (2. * l0).sin() - 2. * eccent * m.sin()
                + 4. * eccent * y * m.sin() * (2. * l0).cos()
                - 0.5 * y * y * (4. * l0).sin()
                - 1.25 * eccent * eccent * (2. * m).sin(),
        );
    (declination, eq)
}
fn event_minutes(jd0: f64, lat: f64, lon: f64, rising: bool) -> Option<f64> {
    let mut minutes = 720. - 4. * lon;
    for _ in 0..3 {
        let (decl, eq) = solar_position(jd0 + minutes / 1440.);
        let lat_rad = to_rad(lat);
        let decl_rad = to_rad(decl);
        let cos_ha = (to_rad(-0.833).sin() - lat_rad.sin() * decl_rad.sin())
            / (lat_rad.cos() * decl_rad.cos());
        if !(-1. ..=1.).contains(&cos_ha) {
            return None;
        }
        let ha = to_deg(cos_ha.acos());
        minutes = 720. - 4. * (lon + if rising { ha } else { -ha }) - eq;
    }
    Some(minutes)
}
fn format_kst(year: f64, month: f64, day: f64, utc_minutes: f64) -> String {
    let ms = time::make_date(year, month - 1., day, 0., 0., 0.)
        + ((utc_minutes + 540.) * 60.).floor() * 1000.;
    let p = crate::world::js::parts(ms).expect("finite KST instant");
    format!(
        "{}.{:02}.{:02} {:02}:{:02}",
        p.year, p.month, p.day, p.hour, p.minute
    )
}

// ---- air info lists and station forecasts ----

fn fresh_air_rows(rows: &V, now: f64) -> Vec<V> {
    let Some(a) = rows.as_arr() else {
        return Vec::new();
    };
    a.items()
        .into_iter()
        .filter(|row| {
            row.truthy()
                && ((row.get("source").truthy() && !strict_eq(&row.get("source"), &s("airkorea")))
                    || check_date_time(row, now))
        })
        .collect()
}
/// `_insertEmptyPollutantHourlyObj(lastDataTime)`.
fn empty_hourly(last: &V) -> Arr {
    let list = Arr::new();
    let _ = catch(|| {
        let mut epoch = parse_date_time(last);
        if !epoch.is_finite() {
            return;
        }
        epoch -= 24. * time::HOUR;
        for _ in 0..=24 {
            list.push(V::Obj(obj(vec![("date", V::from(format_air_kst(epoch)))])));
            epoch += time::HOUR;
        }
    });
    list
}
/// `_insertHourlyPollutants(pollutants, arpltnList, airUnit, lastDataTime)`.
fn insert_hourly_pollutants(pollutants: &V, rows: &[V], unit: &V, last: &V) {
    for row in rows {
        let row = recalculate_value(row, unit);
        let dt = row.get("dataTime");
        if sv(&dt).find("24:00").is_some_and(|i| i > 0) {
            row.set("dataTime", format_air_kst(parse_date_time(&dt)));
        }
        for name in ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"] {
            let value = row.get(&format!("{name}Value"));
            if value.nullish() {
                continue;
            }
            if pollutants.get(name).nullish() {
                pollutants.set(name, V::Obj(Ob::new()));
            }
            let pollutant = pollutants.get(name);
            if pollutant.get("hourly").as_arr().is_none() {
                pollutant.set("hourly", V::Arr(empty_hourly(last)));
            }
            let data_time = row.get("dataTime");
            let hourly = pollutant
                .get("hourly")
                .a()
                .find(|h| strict_eq(&h.get("date"), &data_time));
            if hourly.nullish() {
                continue;
            }
            hourly.set("val", row.get(&format!("{name}Value")));
            hourly.set("grade", row.get(&format!("{name}Grade")));
        }
    }
}
fn daily_aqi(air_info: &V, date: &V) -> V {
    let pollutants = air_info.get("pollutants");
    if !pollutants.has("aqi") {
        pollutants.set("aqi", V::Obj(Ob::new()));
    }
    let aqi = pollutants.get("aqi");
    if !aqi.has("daily") {
        aqi.set("daily", V::Arr(Arr::new()));
    }
    let found = aqi
        .get("daily")
        .a()
        .find(|o| strict_eq(&o.get("date"), date));
    if found.nullish() {
        let o = V::Obj(obj(vec![("date", date.clone())]));
        aqi.get("daily").a().push(o.clone());
        o
    } else {
        found
    }
}
fn insert_daily_aqi(air_info: &V, data: &V) {
    let o = daily_aqi(air_info, &data.get("date"));
    if o.has("val") {
        if ge(&o.get("val"), &data.get("val")) {
            return;
        }
    } else if o.has("maxVal") && ge(&o.get("maxVal"), &data.get("maxVal")) {
        return;
    }
    o.o().copy_from(data.o());
}
fn hourly_aqi(air_info: &V, date: &V) -> V {
    let pollutants = air_info.get("pollutants");
    if !pollutants.has("aqi") {
        pollutants.set("aqi", V::Obj(Ob::new()));
    }
    let aqi = pollutants.get("aqi");
    if !aqi.has("hourly") {
        aqi.set("hourly", V::Arr(Arr::new()));
    }
    let found = aqi
        .get("hourly")
        .a()
        .find(|o| strict_eq(&o.get("date"), date));
    if found.nullish() {
        let o = V::Obj(obj(vec![("date", date.clone())]));
        aqi.get("hourly").a().push(o.clone());
        o
    } else {
        found
    }
}
fn insert_hourly_aqi(air_info: &V, data: &V) {
    let o = hourly_aqi(air_info, &data.get("date"));
    if o.has("val") && ge(&o.get("val"), &data.get("val")) {
        return;
    }
    o.o().copy_from(data.o());
}
/// `_insertDailyPollutants(airInfo, dailyList, airUnit)`.
fn insert_daily_pollutants(air_info: &V, days: &[V], unit: &V) {
    let pollutants = air_info.get("pollutants");
    for day in days {
        if !day.has("dustForecast") {
            continue;
        }
        let fc = day.get("dustForecast");
        for name in ["pm25", "pm10", "o3"] {
            let upper = name.to_uppercase();
            let g = fc.get(&format!("{upper}Grade"));
            if g.nullish() {
                continue;
            }
            if pollutants.get(name).nullish() {
                pollutants.set(name, V::Obj(Ob::new()));
            }
            let pollutant = pollutants.get(name);
            if pollutant.get("daily").as_arr().is_none() {
                pollutant.set("daily", V::Arr(Arr::new()));
            }
            let dashed = V::from(time::dashed_date(&sv(&day.get("date"))));
            let mut daily = pollutant
                .get("daily")
                .a()
                .find(|o| strict_eq(&o.get("date"), &dashed));
            if daily.nullish() {
                daily = V::Obj(obj(vec![("date", dashed.clone())]));
            }
            let grade = add(&g, &n(1.));
            let (min, max) = grade2min_max(name, &grade);
            daily.set("minVal", min.clone());
            daily.set("maxVal", max.clone());
            daily.set("val", V::Num(round(to_number(&add(&max, &min)) / 2.)));
            daily.set("minGrade", value2grade(unit, name, &min));
            daily.set("maxGrade", value2grade(unit, name, &max));
            daily.set("grade", value2grade(unit, name, &daily.get("val")));
            pollutant.get("daily").a().push(daily.clone());
            let a_min = value2index(unit, name, &min);
            let a_max = value2index(unit, name, &max);
            let a_val = V::Num(round(to_number(&add(&a_min, &a_max)) / 2.));
            let data = obj(vec![
                ("date", daily.get("date")),
                ("code", s(name)),
                ("val", a_val.clone()),
                ("minVal", a_min.clone()),
                ("maxVal", a_max.clone()),
                ("grade", V::Num(value2grade(unit, "aqi", &a_val))),
                ("minGrade", V::Num(value2grade(unit, "aqi", &a_min))),
                ("maxGrade", V::Num(value2grade(unit, "aqi", &a_max))),
            ]);
            insert_daily_aqi(air_info, &V::Obj(data));
        }
    }
}
pub fn make_air_info_list(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let unit = cx.query("airUnit");
        let unit = if unit.truthy() { unit } else { s("airkorea") };
        let stn = cx.r("arpltnStnList");
        if !stn.truthy() {
            return;
        }
        let list = Arr::new();
        let now = cx.now;
        for rows in stn.a().items() {
            let rows = fresh_air_rows(&rows, now);
            if rows.is_empty() {
                continue;
            }
            let first = &rows[0];
            let source = if first.truthy() && first.get("source").truthy() {
                first.get("source")
            } else {
                s("airkorea")
            };
            let info = V::Obj(obj(vec![("source", source)]));
            info.set("last", first.clone());
            info.set("pollutants", V::Obj(Ob::new()));
            insert_hourly_pollutants(
                &info.get("pollutants"),
                &rows,
                &unit,
                &info.get("last").get("dataTime"),
            );
            let mid = cx.r("midData");
            if mid.truthy() && mid.get("dailyData").as_arr().is_some() {
                let days: Vec<V> = mid
                    .get("dailyData")
                    .a()
                    .items()
                    .into_iter()
                    .filter(|d| d.has("dustForecast"))
                    .collect();
                if !days.is_empty() {
                    if !info.get("pollutants").truthy() {
                        info.set("pollutants", V::Obj(Ob::new()));
                    }
                    insert_daily_pollutants(&info, &days, &unit);
                }
            }
            list.push(info);
        }
        if !list.is_empty() {
            cx.set("airInfoList", V::Arr(list));
        }
    });
    Flow::Next
}
/// `_getAirInfo(req)`: `req.airInfo`, created as `{source: "airkorea"}` when undefined.
fn air_info(cx: &Cx) -> V {
    if cx.r("airInfo").nullish() {
        cx.set("airInfo", V::Obj(obj(vec![("source", s("airkorea"))])));
    }
    cx.r("airInfo")
}
/// `makeAirInfo` (ControllerTown24h, v000901/v000902): one air object from the first station's
/// fresh rows (`req.arpltnList`) and the daily dust forecasts.
pub fn make_air_info(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let mut info = V::Undef;
        let unit = cx.query("airUnit");
        let unit = if unit.truthy() { unit } else { s("airkorea") };
        let rows = fresh_air_rows(&cx.r("arpltnList"), cx.now);
        if !rows.is_empty() {
            info = air_info(cx);
            info.set("last", rows[0].clone());
            info.set("pollutants", V::Obj(Ob::new()));
            insert_hourly_pollutants(
                &info.get("pollutants"),
                &rows,
                &unit,
                &info.get("last").get("dataTime"),
            );
        }
        let mid = cx.r("midData");
        if mid.truthy() && mid.get("dailyData").as_arr().is_some() {
            let days: Vec<V> = mid
                .get("dailyData")
                .a()
                .items()
                .into_iter()
                .filter(|d| d.has("dustForecast"))
                .collect();
            if !days.is_empty() {
                if info.nullish() {
                    info = air_info(cx);
                }
                if !info.get("pollutants").truthy() {
                    info.set("pollutants", V::Obj(Ob::new()));
                }
                insert_daily_pollutants(&info, &days, &unit);
            }
        }
    });
    Flow::Next
}
/// `AirForecast` (ControllerTown24h, v000901/v000902): the station forecast of `req.airInfo`,
/// which is created even when no air data exists. A failure is logged only.
pub fn air_forecast(cx: &mut Cx) -> Flow {
    let source = cx.query("airForecastSource");
    let info = air_info(cx);
    let _ = get_air_forecast(cx, &info, &source, &cx.query("airUnit"));
    Flow::Next
}
/// `_lastAirObservationTime(airInfo)` (legacy #2771): the last observation's `dataTime`, else
/// the latest hourly `date` of any pollutant, else `1970-01-01`.
fn last_air_observation_time(air_info: &V) -> V {
    let mut latest = s("1970-01-01");
    let last = air_info.get("last");
    if last.truthy() && last.get("dataTime").truthy() {
        latest = last.get("dataTime");
    } else if air_info.get("pollutants").truthy() {
        let p = air_info.get("pollutants");
        for key in p.o().keys() {
            let pollutant = p.get(&key);
            let hourly = pollutant.get("hourly");
            if hourly.truthy() && to_number(&hourly.len()) > 0. {
                let d = hourly.a().at(hourly.a().len() - 1).get("date");
                if lt(&latest, &d) {
                    latest = d;
                }
            }
        }
    }
    latest
}
/// `_insertForecastPollutants(airInfo, hourlyForecasts, source, airUnit)` (legacy #2771): rows
/// within the day after the last observation, compared and keyed as KST epochs
/// (`KecoController._parseDateTime`, `_formatAirKstTime`); a pollutant without observation
/// history keeps its first forecast.
fn insert_forecast_pollutants(air_info: &V, forecasts: &[V], source: &str, unit: &V) {
    let latest = last_air_observation_time(air_info);
    air_info.set("forecastSource", source);
    air_info.set(
        "forecastPubDate",
        forecasts[forecasts.len() - 1].get("pubDate"),
    );
    let last_epoch = parse_date_time(&latest);
    let end_epoch = last_epoch + time::DAY;
    for fc in forecasts {
        if fc.nullish() {
            continue;
        }
        let epoch = parse_date_time(&fc.get("dataTime"));
        if !epoch.is_finite() || epoch <= last_epoch || epoch > end_epoch {
            continue;
        }
        let dt = V::from(format_air_kst(epoch));
        let code = to_str(&fc.get("code"));
        let pollutants = air_info.get("pollutants");
        if pollutants.get(&code).nullish() {
            pollutants.set(&code, V::Obj(Ob::new()));
        }
        let pollutant = pollutants.get(&code);
        if pollutant.get("hourly").nullish() {
            pollutant.set(
                "hourly",
                V::Arr(Arr::from_vec(vec![V::Obj(obj(vec![(
                    "date",
                    latest.clone(),
                )]))])),
            );
        }
        let exists = pollutant
            .get("hourly")
            .a()
            .find(|h| strict_eq(&h.get("date"), &dt));
        if exists.truthy() {
            continue;
        }
        fc.set("grade", value2grade(unit, &code, &fc.get("val")));
        let hourly = obj(vec![
            ("date", dt.clone()),
            ("val", fc.get("val")),
            ("grade", fc.get("grade")),
            ("pubDate", fc.get("pubDate")),
        ]);
        pollutant.get("hourly").a().push(V::Obj(hourly));
        let aqi_val = value2index(unit, &code, &fc.get("val"));
        let data = obj(vec![
            ("date", dt.clone()),
            ("code", V::from(code.clone())),
            ("val", aqi_val.clone()),
            ("grade", V::Num(value2grade(unit, "aqi", &aqi_val))),
        ]);
        insert_hourly_aqi(air_info, &V::Obj(data));
    }
    if source == "kaq" {
        let days = Arr::new();
        for fc in forecasts {
            let day = V::from(super::js::slice(&sv(&fc.get("dataTime")), 0, Some(10)));
            let df = super::short::day_summary(&days, &day);
            let code = to_str(&fc.get("code"));
            if df.get(&code).nullish() {
                df.set(&code, V::Obj(Ob::new()));
            }
            if df.get(&code).get("hourly").nullish() {
                df.get(&code).set("hourly", V::Arr(Arr::new()));
            }
            df.get(&code).get("hourly").a().push(fc.get("val"));
        }
        let today = V::from(super::js::slice(&sv(&latest), 0, Some(10)));
        let days = days.filter(|o| ge(&o.get("date"), &today));
        days.pop();
        for df in days.items() {
            let date = df.get("date");
            for code in ["pm10", "pm25", "o3", "no2", "co", "so2"] {
                let fc = df.get(code);
                if fc.nullish() {
                    continue;
                }
                let pollutants = air_info.get("pollutants");
                if pollutants.get(code).nullish() {
                    pollutants.set(code, V::Obj(Ob::new()));
                }
                let pollutant = pollutants.get(code);
                if pollutant.get("daily").nullish() {
                    pollutant.set("daily", V::Arr(Arr::new()));
                }
                let mut day_data = pollutant
                    .get("daily")
                    .a()
                    .find(|o| strict_eq(&o.get("date"), &date));
                if day_data.nullish() {
                    day_data = V::Obj(Ob::new());
                    pollutant.get("daily").a().push(day_data.clone());
                }
                let hourly = fc.get("hourly");
                day_data.set("date", date.clone());
                day_data.set("maxVal", super::short::max(&hourly, &n(-1.)));
                day_data.set("minVal", super::short::min(&hourly, &n(-1.)));
                day_data.set("val", super::short::average(&hourly, &n(-1.), 0));
                day_data.set("grade", value2grade(unit, code, &day_data.get("val")));
                day_data.set("maxGrade", value2grade(unit, code, &day_data.get("maxVal")));
                day_data.set("minGrade", value2grade(unit, code, &day_data.get("minVal")));
                let a_val = value2index(unit, code, &day_data.get("val"));
                let a_min = value2index(unit, code, &day_data.get("minVal"));
                let a_max = value2index(unit, code, &day_data.get("maxVal"));
                let data = obj(vec![
                    ("date", day_data.get("date")),
                    ("code", s(code)),
                    ("val", a_val.clone()),
                    ("minVal", a_min.clone()),
                    ("maxVal", a_max.clone()),
                    ("grade", V::Num(value2grade(unit, "aqi", &a_val))),
                    ("minGrade", V::Num(value2grade(unit, "aqi", &a_min))),
                    ("maxGrade", V::Num(value2grade(unit, "aqi", &a_max))),
                ]);
                insert_daily_aqi(air_info, &V::Obj(data));
            }
        }
    }
}
/// `_getAirForecast(airInfo, forecastSource, airUnit)`: Err ends `async.map`.
fn get_air_forecast(cx: &Cx, info: &V, source: &V, unit: &V) -> Result<(), ()> {
    if info.truthy()
        && info.get("source").truthy()
        && !strict_eq(&info.get("source"), &s("airkorea"))
    {
        return Ok(());
    }
    let station = match catch(|| info.get("last").get("stationName")) {
        Ok(v) => v,
        Err(_) => return Err(()),
    };
    let src = to_str(source);
    if src != "kaq" && src != "airkorea" {
        return Err(());
    }
    let station_json = super::to_store(&station);
    if src == "kaq" {
        return kaq_or_airkorea(cx, info, &station_json, unit);
    }
    let results = from_store(&cx.store.air_forecast(&src, &station_json).map_err(|_| ())?);
    let r = catch(|| {
        if results.nullish() || le(&results.len(), &n(0.)) {
            if strict_eq(&station, &s("태하리")) {
                return Ok(());
            }
            throw("Fail to get forecast");
        }
        insert_forecast_pollutants(info, &results.a().items(), &src, unit);
        Ok::<(), ()>(())
    });
    match r {
        Ok(x) => x,
        Err(_) => Err(()),
    }
}
/// The `kaq` branch of `_getAirForecast` (legacy #2771): the KAQ forecast when it has a usable row
/// after now and within the day after the last observation, otherwise the stored AirKorea
/// forecast under the same condition, otherwise none. A KAQ read error falls back too; an AirKorea
/// read error or an exception ends the list (`callback(err)`).
fn kaq_or_airkorea(cx: &Cx, info: &V, station: &serde_json::Value, unit: &V) -> Result<(), ()> {
    let now = cx.now;
    let last_epoch = parse_date_time(&last_air_observation_time(info));
    // `usableRows`: listed pollutants with a finite non-negative number and a valid KST time,
    // copied with that time formatted.
    let usable = |results: &V| -> Vec<V> {
        let Some(rows) = results.as_arr() else {
            return Vec::new();
        };
        rows.items()
            .into_iter()
            .filter(|row| {
                // `row && ...`: a falsy row is not read.
                row.truthy()
                    && ["pm10", "pm25", "o3", "no2", "co", "so2"]
                        .iter()
                        .any(|c| strict_eq(&row.get("code"), &s(c)))
                    && is_finite_number(&row.get("val"))
                    && ge(&row.get("val"), &n(0.))
                    && parse_date_time(&row.get("dataTime")).is_finite()
            })
            .map(|row| {
                let copy = row.o().assign_copy();
                copy.set(
                    "dataTime",
                    format_air_kst(parse_date_time(&row.get("dataTime"))),
                );
                V::Obj(copy)
            })
            .collect()
    };
    // `insertIfAvailable`.
    let insert_if_available = |results: &V, source: &str| -> Result<bool, ()> {
        catch(|| {
            let rows = usable(results);
            let available = rows.iter().any(|row| {
                let epoch = parse_date_time(&row.get("dataTime"));
                epoch > now && epoch > last_epoch && epoch <= last_epoch + time::DAY
            });
            if available {
                insert_forecast_pollutants(info, &rows, source, unit);
            }
            available
        })
        .map_err(|_| ())
    };
    if let Ok(results) = cx.store.air_forecast("kaq", station)
        && insert_if_available(&from_store(&results), "kaq")?
    {
        return Ok(());
    }
    let fallback = cx.store.air_forecast("airkorea", station).map_err(|_| ())?;
    insert_if_available(&from_store(&fallback), "airkorea")?;
    Ok(())
}
pub fn air_forecast_list(cx: &mut Cx) -> Flow {
    let source = cx.query("airForecastSource");
    let unit = cx.query("airUnit");
    let list = cx.r("airInfoList");
    if let Some(a) = list.as_arr() {
        for info in a.items() {
            // async.map calls the final callback (next) on the first error.
            if get_air_forecast(cx, &info, &source, &unit).is_err() {
                break;
            }
        }
    }
    Flow::Next
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn non_ascii_mfds_publications_are_rejected_without_panicking() {
        // 14 bytes, not ASCII: `한글날짜ab` (4 x 3 + 2).
        for s in ["한글날짜ab", "2026-09-한abc", "2026-한-09abc"] {
            assert!(publication_ms(&V::s(s)).is_nan(), "{s}");
        }
        assert!(publication_ms(&V::s("2026-09-240600")).is_finite());
    }
}
