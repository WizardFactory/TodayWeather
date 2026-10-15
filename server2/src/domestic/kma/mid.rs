//! Medium-range composition (`getMid` .. `updateMidTempMaxMin`) and the daily summaries of
//! observations and short forecasts.
use super::chain::{Cx, Flow};
use super::data::{forecast_zone, land_area_code, read_mid, read_town, region_code};
use super::js::{
    Arr, Ob, V, catch, fixed, gt, is_finite_number, lt, obj, parse_int, strict_eq, to_number,
    to_str,
};
use super::short::{average, day_summary, max, min, sum, summary_lgt, summary_pty, usable};
use super::{MidModel, TownModel, policy, precip, time};

fn s(v: &str) -> V {
    V::s(v)
}
fn n(x: f64) -> V {
    V::Num(x)
}

/// `_mergeList(dstList, srcList)`.
pub fn merge_list(dst: &Arr, src: &[V]) {
    for item in src {
        if let Some(target) = dst
            .items()
            .into_iter()
            .find(|d| strict_eq(&d.get("date"), &item.get("date")))
        {
            for key in item.o().keys() {
                target.set(&key, item.get(&key));
            }
            continue;
        }
        dst.push(item.clone());
    }
    dst.sort_by(sort_by_date_time);
}
/// `_sortByDateTime(a, b)`.
fn sort_by_date_time(a: &V, b: &V) -> f64 {
    let (ad, bd) = (a.get("date"), b.get("date"));
    if gt(&ad, &bd) {
        return 1.;
    }
    if lt(&ad, &bd) {
        return -1.;
    }
    if strict_eq(&ad, &bd) && a.has("time") && b.has("time") {
        if gt(&a.get("time"), &b.get("time")) {
            return 1.;
        }
        if lt(&a.get("time"), &b.get("time")) {
            return -1.;
        }
    }
    0.
}
/// `_convertSkyToKorStr(sky, pty)`.
fn sky_to_kor(sky: &V, pty: &V) -> V {
    let is = |v: &V, x: f64| strict_eq(v, &n(x));
    if is(pty, 0.) {
        for (k, t) in [
            (1., "맑음"),
            (2., "구름조금"),
            (3., "구름많음"),
            (4., "흐림"),
        ] {
            if is(sky, k) {
                return s(t);
            }
        }
        return s("");
    }
    let prefix = if is(sky, 1.) || is(sky, 2.) {
        "구름적고 "
    } else if is(sky, 3.) {
        "구름많고 "
    } else if is(sky, 4.) {
        "흐리고 "
    } else {
        ""
    };
    for (k, t) in [(1., "비"), (2., "비/눈"), (3., "눈")] {
        if is(pty, k) {
            return V::from(format!("{prefix}{t}"));
        }
    }
    s(prefix)
}
const CONDITION_ARRAYS: [&str; 17] = [
    "lgt", "pty", "reh", "rn1", "sky", "t1h", "wsd", "pop", "r06", "s06", "t3h", "lgtAm", "lgtPm",
    "ptyAm", "ptyPm", "skyAm", "skyPm",
];
/// `_createOrGetDayCondition(list, date)`.
fn day_condition(list: &Arr, date: &V) -> V {
    for item in list.items() {
        if strict_eq(&item.get("date"), date) {
            return item;
        }
    }
    let o = Ob::new();
    o.set("date", date.clone());
    for k in CONDITION_ARRAYS {
        o.set(k, V::Arr(Arr::new()));
        if k == "t3h" {
            o.set("tmx", -50.);
            o.set("tmn", -50.);
        }
    }
    list.push(V::Obj(o.clone()));
    V::Obj(o)
}
fn push(cond: &V, k: &str, v: V) {
    cond.get(k).a().push(v);
}
/// `_getDaySummaryList(pastList)`.
fn day_summary_list(past: &[V]) -> Vec<V> {
    let conditions = Arr::new();
    for input in past {
        let hc = V::Obj(input.o().assign_copy());
        if strict_eq(&hc.get("time"), &s("0000")) {
            let d = time::date_ms(&time::convert_string_to_date(&hc.get("date"))) - time::DAY;
            hc.set("time", "2400");
            hc.set("date", time::yyyymmdd_ms(d));
        }
        let dc = day_condition(&conditions, &hc.get("date"));
        if hc.get("historyObservation").truthy() {
            dc.set("historyRecovered", true);
        }
        for (field, missing) in [
            ("lgt", -1.),
            ("pty", -1.),
            ("reh", -1.),
            ("rn1", -1.),
            ("sky", -1.),
            ("t1h", -50.),
            ("wsd", -1.),
        ] {
            if usable(&hc.get(field), missing) {
                push(&dc, field, hc.get(field));
            }
        }
        let half = if parse_int(&hc.get("time")) <= 1200. {
            "Am"
        } else {
            "Pm"
        };
        for field in ["lgt", "sky", "pty"] {
            if usable(&hc.get(field), -1.) {
                push(&dc, &format!("{field}{half}"), hc.get(field));
            }
        }
    }
    let summaries = Arr::new();
    for dc in conditions.items() {
        if dc.get("t1h").a().is_empty() {
            continue;
        }
        let ds = day_summary(&summaries, &dc.get("date"));
        let m1 = n(-1.);
        ds.set("lgt", summary_lgt(&dc.get("lgt"), &m1));
        ds.set("pty", summary_pty(&dc.get("pty"), &m1));
        ds.set("reh", average(&dc.get("reh"), &m1, 0));
        ds.set("rn1", sum(&dc.get("rn1"), &m1));
        ds.set("sky", average(&dc.get("sky"), &m1, 0));
        ds.set("lgtAm", summary_lgt(&dc.get("lgtAm"), &m1));
        ds.set("ptyAm", summary_pty(&dc.get("ptyAm"), &m1));
        if !dc.get("skyAm").a().is_empty() {
            ds.set("skyAm", average(&dc.get("skyAm"), &m1, 0));
            ds.set("wfAm", sky_to_kor(&ds.get("skyAm"), &ds.get("ptyAm")));
        }
        ds.set("lgtPm", summary_lgt(&dc.get("lgtPm"), &m1));
        ds.set("ptyPm", summary_pty(&dc.get("ptyPm"), &m1));
        if !dc.get("skyPm").a().is_empty() {
            ds.set("skyPm", average(&dc.get("skyPm"), &m1, 0));
            ds.set("wfPm", sky_to_kor(&ds.get("skyPm"), &ds.get("ptyPm")));
        }
        ds.set("t1d", average(&dc.get("t1h"), &n(-50.), 1));
        ds.set("wsd", average(&dc.get("wsd"), &m1, 1));
        ds.set("taMax", fixed(&max(&dc.get("t1h"), &n(-50.)), 1));
        ds.set("taMin", fixed(&min(&dc.get("t1h"), &n(-50.)), 1));
        ds.set("observationType", "hourly-summary");
        ds.set("observationHours", dc.get("t1h").a().len() as f64);
        if dc.get("historyRecovered").truthy() && dc.get("rn1").a().len() < 24 {
            ds.del("rn1");
        }
        for field in [
            "reh", "rn1", "wsd", "lgt", "pty", "sky", "lgtAm", "lgtPm", "ptyAm", "ptyPm",
        ] {
            if dc.get(field).a().is_empty() {
                ds.del(field);
            }
        }
    }
    summaries.items()
}
/// `_getDaySummaryListByShort(shortList)`.
fn day_summary_list_by_short(rows: &[V]) -> Vec<V> {
    let conditions = Arr::new();
    let last = rows.len().saturating_sub(1);
    for (i, row) in rows.iter().enumerate() {
        if i == 0 && strict_eq(&row.get("time"), &s("2400")) {
            continue;
        }
        if i == last && strict_eq(&row.get("time"), &s("0000")) {
            continue;
        }
        let dc = day_condition(&conditions, &row.get("date"));
        let m1 = n(-1.);
        for field in ["pop", "pty", "r06", "reh", "s06", "sky"] {
            if !strict_eq(&row.get(field), &m1) {
                push(&dc, field, row.get(field));
            }
        }
        push(&dc, "t3h", row.get("t3h"));
        if !strict_eq(&row.get("tmx"), &n(-50.)) {
            dc.set("tmx", row.get("tmx"));
        }
        if !strict_eq(&row.get("tmn"), &n(-50.)) {
            dc.set("tmn", row.get("tmn"));
        }
        if !strict_eq(&row.get("wsd"), &m1) {
            push(&dc, "wsd", row.get("wsd"));
        }
        let half = if parse_int(&row.get("time")) <= 1200. {
            "Am"
        } else {
            "Pm"
        };
        for field in ["lgt", "sky", "pty"] {
            if !strict_eq(&row.get(field), &m1) {
                push(&dc, &format!("{field}{half}"), row.get(field));
            }
        }
    }
    let summaries = Arr::new();
    for dc in conditions.items() {
        let ds = day_summary(&summaries, &dc.get("date"));
        let m1 = n(-1.);
        ds.set("pop", max(&dc.get("pop"), &m1));
        ds.set("pty", summary_pty(&dc.get("pty"), &m1));
        ds.set("r06", sum(&dc.get("r06"), &m1));
        ds.set("reh", average(&dc.get("reh"), &m1, 0));
        ds.set("s06", sum(&dc.get("s06"), &m1));
        ds.set("sky", average(&dc.get("sky"), &m1, 0));
        ds.set("lgtAm", summary_lgt(&dc.get("lgtAm"), &m1));
        ds.set("ptyAm", summary_pty(&dc.get("ptyAm"), &m1));
        if !dc.get("skyAm").a().is_empty() {
            ds.set("skyAm", average(&dc.get("skyAm"), &m1, 0));
            ds.set("wfAm", sky_to_kor(&ds.get("skyAm"), &ds.get("ptyAm")));
        }
        ds.set("lgtPm", summary_lgt(&dc.get("lgtPm"), &m1));
        ds.set("ptyPm", summary_pty(&dc.get("ptyPm"), &m1));
        if !dc.get("skyPm").a().is_empty() {
            ds.set("skyPm", average(&dc.get("skyPm"), &m1, 0));
            ds.set("wfPm", sky_to_kor(&ds.get("skyPm"), &ds.get("ptyPm")));
        }
        ds.set("t1d", average(&dc.get("t3h"), &n(-50.), 1));
        ds.set("taMax", dc.get("tmx"));
        ds.set("taMin", dc.get("tmn"));
        ds.set("wsd", average(&dc.get("wsd"), &m1, 1));
        if ds.get("skyAm").nullish() {
            if !ds.get("sky").nullish() {
                ds.set("skyAm", average(&dc.get("sky"), &m1, 0));
                let p = if !super::js::loose_eq(&ds.get("ptyAm"), &m1) {
                    ds.get("ptyAm")
                } else {
                    ds.get("pty")
                };
                ds.set("wfAm", sky_to_kor(&ds.get("skyAm"), &p));
            } else if !ds.get("skyPm").nullish() {
                ds.set("skyAm", ds.get("skyPm"));
                ds.set("wfAm", ds.get("wfPm"));
            }
        }
        if ds.get("skyPm").nullish() {
            if !ds.get("sky").nullish() {
                let p = if !super::js::loose_eq(&ds.get("ptyPm"), &m1) {
                    ds.get("ptyPm")
                } else {
                    ds.get("pty")
                };
                ds.set("skyPm", average(&dc.get("sky"), &m1, 0));
                ds.set("wfPm", sky_to_kor(&ds.get("skyPm"), &p));
            } else if !ds.get("skyAm").nullish() {
                ds.set("skyPm", ds.get("skyAm"));
                ds.set("wfPm", ds.get("wfAm"));
            }
        }
    }
    summaries.items()
}
/// Day totals of `_sumDayPrecipitation`: `None` field is a six-hour amount (unknown total);
/// an absent field leaves the legacy daily sum.
struct DayTotals {
    date: String,
    r06: Option<Option<super::js::Total>>,
    s06: Option<Option<super::js::Total>>,
}
/// `_sumDayPrecipitation(shortList)`.
fn sum_day_precipitation(rows: &[V]) -> Vec<DayTotals> {
    struct Acc {
        date: String,
        r06: Option<Vec<super::js::Total>>,
        s06: Option<Vec<super::js::Total>>,
    }
    let mut days: Vec<Acc> = Vec::new();
    let last = rows.len().saturating_sub(1);
    for (i, row) in rows.iter().enumerate() {
        if (i == 0 && strict_eq(&row.get("time"), &s("2400")))
            || (i == last && strict_eq(&row.get("time"), &s("0000")))
        {
            continue;
        }
        let date = to_str(&row.get("date"));
        let idx = match days.iter().position(|d| d.date == date) {
            Some(i) => i,
            None => {
                days.push(Acc {
                    date,
                    r06: Some(Vec::new()),
                    s06: Some(Vec::new()),
                });
                days.len() - 1
            }
        };
        for field in ["r06", "s06"] {
            let slot = if field == "r06" {
                &mut days[idx].r06
            } else {
                &mut days[idx].s06
            };
            if let Some(list) = slot.as_mut() {
                match precip::get(row, field) {
                    Some(t) => list.push(t),
                    None => *slot = None,
                }
            }
        }
    }
    // Object.keys(days): 8-digit dates are array indices, so they enumerate in numeric order.
    days.sort_by(|a, b| {
        let (x, y) = (a.date.parse::<u64>().ok(), b.date.parse::<u64>().ok());
        match (x, y) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        }
    });
    days.into_iter()
        .map(|d| {
            let fold = |list: Option<Vec<super::js::Total>>| {
                list.map(|totals| {
                    if totals.iter().any(|t| t.hours.unwrap_or(1.) > 3.) {
                        None
                    } else {
                        precip::total(&totals.into_iter().map(Some).collect::<Vec<_>>())
                    }
                })
            };
            DayTotals {
                date: d.date,
                r06: fold(d.r06),
                s06: fold(d.s06),
            }
        })
        .collect()
}

pub fn get_mid(cx: &mut Cx) -> Flow {
    let Ok(code) = region_code(cx) else {
        return Flow::Next;
    };
    let forecast = read_mid(cx, MidModel::Forecast, &code.get("pointNumber"), true);
    let mid = Ob::new();
    cx.set("midData", V::Obj(mid.clone()));
    if let Ok(info) = &forecast {
        let list = info.get("ret");
        let list = if list.truthy() {
            list
        } else {
            V::Arr(Arr::new())
        };
        let len = to_number(&list.len());
        if len > 0. {
            mid.set("forecast", list.get(&to_str(&n(len - 1.))));
        }
    }
    let area = land_area_code(&code.get("cityCode"));
    let land = read_mid(cx, MidModel::Land, &s(&area), true)
        .unwrap_or_else(|_| V::Obj(obj(vec![("ret", V::Arr(Arr::new()))])));
    let mut city_code = code.get("cityCode");
    if !cx.r("regId").nullish() {
        city_code = cx.r("regId");
    } else if let Ok(r) = forecast_zone(cx) {
        city_code = r;
    }
    let temp = read_mid(cx, MidModel::Temp, &city_code, true)
        .unwrap_or_else(|_| V::Obj(obj(vec![("ret", V::Arr(Arr::new()))])));
    if let Ok(list) = catch(|| {
        merge_land_with_temp(
            cx.now,
            &land.get("ret"),
            &temp.get("ret"),
            &land.get("pubDate"),
            &temp.get("pubDate"),
        )
    }) {
        mid.set("dailyData", V::Arr(list));
        mid.set("landPubDate", land.get("pubDate"));
        mid.set("tempPubDate", temp.get("pubDate"));
    }
    Flow::Next
}
/// `_mergeLandWithTemp(landList, tempList, cb, publications)`.
fn merge_land_with_temp(now: f64, land_list: &V, temp_list: &V, land_pub: &V, temp_pub: &V) -> Arr {
    let land = policy::latest(land_list, land_pub, now);
    let temp = policy::latest(temp_list, temp_pub, now);
    let mut by_date: Vec<(String, V)> = Vec::new();
    for (source, record) in [(0, land), (1, temp)] {
        if !record.truthy() {
            continue;
        }
        for day in 3..=10 {
            let Some(date) = policy::add_days(&record.get("date"), f64::from(day)) else {
                continue;
            };
            if !policy::in_window(&s(&date), now) {
                continue;
            }
            let row = match by_date.iter().find(|(d, _)| *d == date) {
                Some((_, r)) => r.clone(),
                None => V::Obj(obj(vec![("date", s(&date))])),
            };
            if source == 0 {
                for half in ["Am", "Pm"] {
                    let suffix = format!("{day}{}", if day <= 7 { half } else { "" });
                    let wf = record.get(&format!("wf{suffix}"));
                    if policy::weather(&wf) {
                        row.set(&format!("wf{half}"), wf);
                    }
                    let rn = record.get(&format!("rnSt{suffix}"));
                    if policy::probability(&rn) {
                        row.set(&format!("rnSt{half}"), rn);
                    }
                }
            } else {
                for ext in ["Min", "Max"] {
                    let v = record.get(&format!("ta{ext}{day}"));
                    if policy::temperature(&v) {
                        row.set(&format!("ta{ext}"), v);
                    }
                }
            }
            match by_date.iter_mut().find(|(d, _)| *d == date) {
                Some(slot) => slot.1 = row,
                None => by_date.push((date, row)),
            }
        }
    }
    by_date.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
    Arr::from_vec(
        by_date
            .into_iter()
            .map(|(_, r)| r)
            .filter(|r| {
                policy::complete(r)
                    && policy::sky_info(&r.get("wfAm")).is_some()
                    && policy::sky_info(&r.get("wfPm")).is_some()
            })
            .collect(),
    )
}

pub fn convert_mid_kor_str_to_sky_info(cx: &mut Cx) -> Flow {
    if !cx.has("midData") {
        return Flow::Next;
    }
    let mid = cx.r("midData");
    if !mid.has("dailyData") || mid.get("dailyData").as_arr().is_none() {
        return Flow::Next;
    }
    let filtered = mid.get("dailyData").a().filter(|row| {
        policy::sky_info(&row.get("wfAm")).is_some()
            && policy::sky_info(&row.get("wfPm")).is_some()
            && policy::complete(row)
    });
    mid.set("dailyData", V::Arr(filtered.clone()));
    for d in filtered.items() {
        let (Some(am), Some(pm)) = (
            policy::sky_info(&d.get("wfAm")),
            policy::sky_info(&d.get("wfPm")),
        ) else {
            continue;
        };
        d.set("skyAm", am.0);
        d.set("ptyAm", am.1);
        d.set("lgtAm", 0.);
        d.set("skyPm", pm.0);
        d.set("ptyPm", pm.1);
        d.set("lgtPm", 0.);
        d.set("sky", if am.0 > pm.0 { am.0 } else { pm.0 });
        let (pa, pp) = (am.1, pm.1);
        let pty = if pp == 2. || pa == 2. {
            2.
        } else if pp == 3. {
            if pa == 1. { 2. } else { 3. }
        } else if pa == 3. {
            if pp == 1. { 2. } else { 3. }
        } else if pp == 1. || pa == 1. {
            1.
        } else {
            0.
        };
        d.set("pty", pty);
        d.set("lgt", 0.);
    }
    Flow::Next
}
fn ensure_daily(cx: &Cx) -> V {
    if !cx.has("midData") {
        cx.set("midData", V::Obj(Ob::new()));
    }
    let mid = cx.r("midData");
    if !mid.has("dailyData") || mid.get("dailyData").as_arr().is_none() {
        mid.set("dailyData", V::Arr(Arr::new()));
    }
    mid
}
/// `_mergeMidByCurrent`; returns a JSON copy of the merged day-summary rows (S16 records them
/// before later steps mutate the shared row objects).
fn merge_mid_by_current(
    daily: &Arr,
    current: &V,
    request_date: &str,
) -> Vec<crate::gateway::OrderedJson> {
    let rd = parse_int(&s(request_date));
    let past: Vec<V> = current
        .a()
        .items()
        .into_iter()
        .filter(|c| parse_int(&c.get("date")) >= rd)
        .collect();
    let summaries = day_summary_list(&past);
    let copy = summaries.iter().filter_map(super::js::to_json).collect();
    merge_list(daily, &summaries);
    copy
}
pub fn get_past_mid(cx: &mut Cx) -> Flow {
    let mid = ensure_daily(cx);
    let (rd, _) = cx.time_value(9. - 7. * 24.);
    if cx.r("currentList").truthy() {
        let (daily, current) = (mid.get("dailyData").a().clone(), cx.r("currentList"));
        if let Ok(rows) = catch(|| merge_mid_by_current(&daily, &current, &rd)) {
            cx.past_days = Some(rows);
        }
        return Flow::Next;
    }
    let Ok((coord, _)) = cx.coord() else {
        return Flow::Next;
    };
    let Ok(info) = read_town(cx, TownModel::Current, &coord, true) else {
        return Flow::Next;
    };
    if let Ok(rows) = catch(|| {
        let list = info.get("ret");
        cx.set("currentList", list.clone());
        for row in list.a().items() {
            time::convert_0h_to_24h(&row);
        }
        merge_mid_by_current(mid.get("dailyData").a(), &list, &rd)
    }) {
        cx.past_days = Some(rows);
    }
    Flow::Next
}
/// `overlay(inputs)` inside `mergeMidWithShort`.
fn overlay(daily: &Arr, inputs: &[V]) {
    let short_rows: Vec<V> = inputs
        .iter()
        .map(|src| {
            let row = V::Obj(src.o().assign_copy());
            for key in ["t3h", "tmn", "tmx"] {
                if !policy::temperature(&row.get(key)) {
                    row.set(key, -50.);
                }
            }
            for key in ["pop", "reh", "sky", "pty", "r06", "s06", "wsd", "lgt"] {
                let v = row.get(key);
                let maximum = match key {
                    "pop" | "reh" => Some(100.),
                    "sky" => Some(4.),
                    "pty" => Some(3.),
                    "lgt" => Some(1.),
                    _ => None,
                };
                let lower = if key == "sky" { 1. } else { 0. };
                let bad = match v {
                    V::Num(x) if x.is_finite() => {
                        x < lower
                            || maximum.is_some_and(|m| x > m)
                            || (["sky", "pty", "lgt"].contains(&key) && x % 1. != 0.)
                    }
                    _ => true,
                };
                if bad {
                    row.set(key, -1.);
                }
            }
            row
        })
        .collect();
    let summaries: Vec<V> = day_summary_list_by_short(&short_rows)
        .into_iter()
        .filter(|r| {
            policy::complete(r)
                && policy::weather(&r.get("wfAm"))
                && policy::weather(&r.get("wfPm"))
        })
        .collect();
    let precipitation = sum_day_precipitation(inputs);
    for row in &summaries {
        for key in row.o().keys() {
            let v = row.get(&key);
            if let V::Num(x) = v
                && (!x.is_finite()
                    || (!["taMin", "taMax", "t1d"].contains(&key.as_str()) && x < 0.))
            {
                row.del(&key);
            }
        }
        if !short_rows.iter().any(|src| {
            strict_eq(&src.get("date"), &row.get("date")) && policy::temperature(&src.get("t3h"))
        }) {
            row.del("t1d");
        }
        for key in ["r06", "s06", "lgtAm", "lgtPm"] {
            let lightning = key.starts_with("lgt");
            let present = short_rows.iter().any(|src| {
                let v = src.get(if lightning { "lgt" } else { key });
                strict_eq(&src.get("date"), &row.get("date"))
                    && is_finite_number(&v)
                    && to_number(&v) >= 0.
                    && (!lightning
                        || (to_number(&v) <= 1.
                            && (if key == "lgtAm" {
                                to_number(&src.get("time")) <= 1200.
                            } else {
                                to_number(&src.get("time")) > 1200.
                            })))
            });
            if !present {
                row.del(key);
            }
        }
    }
    merge_list(daily, &summaries);
    for row in daily.items() {
        let date = to_str(&row.get("date"));
        let Some(totals) = precipitation.iter().find(|d| d.date == date) else {
            continue;
        };
        if !summaries
            .iter()
            .any(|sm| strict_eq(&sm.get("date"), &row.get("date")))
        {
            continue;
        }
        for (field, value) in [("r06", &totals.r06), ("s06", &totals.s06)] {
            match value {
                None => (),
                Some(None) => precip::clear(&row, field),
                Some(Some(t)) => precip::assign(&row, field, Some(t.clone())),
            }
        }
    }
}
pub fn merge_mid_with_short(cx: &mut Cx) -> Flow {
    let mid = ensure_daily(cx);
    let now = cx.now;
    let extended: Vec<V> = policy::daily_short_rows(&cx.r("_dailyShort"), now)
        .into_iter()
        .map(|src| {
            let row = V::Obj(src.o().assign_copy());
            time::convert_0h_to_24h(&row);
            row
        })
        .filter(|row| {
            policy::date_ms(now)
                .and_then(|d| policy::add_days_s(&d, 2.))
                .is_some_and(|limit| gt(&row.get("date"), &s(&limit)))
        })
        .collect();
    if !extended.is_empty() {
        overlay(mid.get("dailyData").a(), &extended);
    }
    let mut daily_short = cx.r("short");
    let mut daily_pub = cx.r("shortPubDate");
    let rss = cx.r("_dailyShortRss");
    if !policy::fresh_short(&daily_pub, now) && rss.truthy() {
        let rows: Vec<V> = rss
            .get("rows")
            .a()
            .items()
            .into_iter()
            .map(|src| {
                let row = V::Obj(src.o().assign_copy());
                time::convert_0h_to_24h(&row);
                row.del("r06");
                row.del("s06");
                row
            })
            .collect();
        daily_short = V::Arr(Arr::from_vec(rows));
        daily_pub = rss.get("pubDate");
    }
    if daily_short.truthy() && policy::fresh_short(&daily_pub, now) {
        let daily = mid.get("dailyData").a().clone();
        let _ = catch(|| {
            let limit = policy::date(&daily_pub).and_then(|d| policy::add_days_s(&d, 4.));
            let rows: Vec<V> = daily_short
                .a()
                .items()
                .into_iter()
                .filter(|row| {
                    policy::in_window(&row.get("date"), now)
                        && limit
                            .as_ref()
                            .is_some_and(|l| super::js::le(&row.get("date"), &s(l)))
                })
                .collect();
            overlay(&daily, &rows);
        });
    }
    // finish(): the ASOS daily merge and status run before the window filter.
    if cx.r("_history").truthy() {
        policy::merge_daily_status(&cx.req, now);
    }
    let mut by_date: Vec<(String, V)> = Vec::new();
    for row in mid.get("dailyData").a().items() {
        if policy::in_window(&row.get("date"), now) && policy::complete(&row) {
            let d = to_str(&row.get("date"));
            match by_date.iter_mut().find(|(k, _)| *k == d) {
                Some(slot) => slot.1 = row,
                None => by_date.push((d, row)),
            }
        }
    }
    by_date.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
    mid.set(
        "dailyData",
        V::Arr(Arr::from_vec(by_date.into_iter().map(|(_, r)| r).collect())),
    );
    mid.set("dailyStatus", policy::daily_health(&mid, now));
    Flow::Next
}
pub fn update_mid_temp_max_min(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let current = cx.r("current");
        let today = current.get("date");
        let temp = current.get("t1h");
        let day = cx
            .r("midData")
            .get("dailyData")
            .a()
            .find(|d| strict_eq(&d.get("date"), &today));
        if gt(&temp, &day.get("taMax")) {
            day.set("taMax", temp.clone());
        }
        if lt(&temp, &day.get("taMin")) {
            day.set("taMin", temp);
        }
    });
    Flow::Next
}
