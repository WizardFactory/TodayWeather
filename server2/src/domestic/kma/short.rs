//! Short, shortest and current preparation, observation correction and time alignment
//! (`getShort` .. `adjustShort` of the v000903 router list).
use super::chain::{Cx, Flow};
use super::data::{SHORT_STRING, read_town};
use super::js::{
    Arr, Ob, V, add, catch, fixed, ge, gt, json_clone, le, loose_eq, lt, obj, parse_int,
    parse_int10, round, slice, strict_eq, substr, sv, to_number, to_str,
};
use super::{TownModel, policy, precip, time};

fn s(v: &str) -> V {
    V::s(v)
}

// ---- shared list helpers (ControllerTown.prototype) ----

fn valid_list(list: &V, invalid: &V) -> Option<Vec<V>> {
    let a = list.as_arr()?;
    Some(if invalid.nullish() {
        a.items()
    } else {
        a.items()
            .into_iter()
            .filter(|v| !strict_eq(v, invalid))
            .collect()
    })
}
/// `_max(list, invalidValue)`.
pub fn max(list: &V, invalid: &V) -> V {
    let Some(valid) = valid_list(list, invalid) else {
        return V::Num(-1.);
    };
    let mut ret = V::Undef;
    for d in valid {
        if gt(&d, &ret) || ret.is_undef() {
            ret = d;
        }
    }
    if ret.is_undef() { invalid.clone() } else { ret }
}
/// `_min(list, invalidValue)`.
pub fn min(list: &V, invalid: &V) -> V {
    let Some(valid) = valid_list(list, invalid) else {
        return V::Num(-1.);
    };
    let mut ret = V::Undef;
    for d in valid {
        if lt(&d, &ret) || ret.is_undef() {
            ret = d;
        }
    }
    if ret.is_undef() { invalid.clone() } else { ret }
}
/// `_sum(list, invalidValue)`.
pub fn sum(list: &V, invalid: &V) -> V {
    let Some(valid) = valid_list(list, invalid) else {
        return V::Num(-1.);
    };
    let mut total = V::Num(0.);
    for n in valid {
        total = add(&total, &n);
    }
    if strict_eq(&total, &V::Num(0.)) {
        V::Num(round(0.))
    } else {
        V::Num(fixed(&total, 1))
    }
}
/// `_average(list, invalidValue, digits)`.
pub fn average(list: &V, invalid: &V, digits: usize) -> V {
    let Some(valid) = valid_list(list, invalid) else {
        return V::Num(-1.);
    };
    if valid.is_empty() {
        return V::Num(-1.);
    }
    let n = valid.len() as f64;
    let total = sum(&V::Arr(Arr::from_vec(valid)), &V::Undef);
    V::Num(fixed(&V::Num(to_number(&total) / n), digits))
}
/// `_summaryLgt(list, invalidValue)`.
pub fn summary_lgt(list: &V, invalid: &V) -> V {
    let Some(valid) = valid_list(list, invalid) else {
        return V::Num(-1.);
    };
    for v in valid {
        if gt(&v, &V::Num(0.)) {
            return v;
        }
    }
    V::Num(0.)
}
/// `_summaryPty(list, invalidValue)`.
pub fn summary_pty(list: &V, invalid: &V) -> V {
    let Some(a) = list.as_arr() else {
        return V::Num(-1.);
    };
    if a.is_empty() {
        return V::Num(-1.);
    }
    let valid = valid_list(list, invalid).unwrap_or_default();
    let mut pty = 0.;
    for v in valid {
        if strict_eq(&v, &V::Num(2.)) {
            return V::Num(2.);
        } else if strict_eq(&v, &V::Num(1.)) {
            if pty == 3. {
                return V::Num(2.);
            }
            pty = 1.;
        } else if strict_eq(&v, &V::Num(3.)) {
            if pty == 1. {
                return V::Num(2.);
            }
            pty = 3.;
        }
    }
    V::Num(pty)
}
/// `_createOrGetDaySummaryList(list, date)`.
pub fn day_summary(list: &Arr, date: &V) -> V {
    for item in list.items() {
        if strict_eq(&item.get("date"), date) {
            return item;
        }
    }
    let item = V::Obj(obj(vec![("date", date.clone())]));
    list.push(item.clone());
    item
}
/// The slot end time of `_createOrGet3hSummaryList` (`HH00`, hours rounded up to a multiple of 3).
fn slot_target(time: &V) -> String {
    let n = parse_int(&V::from(substr(&sv(time), 0, 2)));
    let target = (n / 3.).ceil() * 3.;
    if target < 10. {
        format!("0{}00", to_str(&V::Num(target)))
    } else {
        format!("{}00", to_str(&V::Num(target)))
    }
}
/// `_createOrGet3hSummaryList(list, date, strTime)` with an index over string dates (the list
/// order and the single object per (date, slot) are unchanged).
pub struct Slots {
    pub list: Arr,
    map: std::collections::HashMap<(String, String), V>,
}
impl Slots {
    pub fn new() -> Self {
        Self {
            list: Arr::new(),
            map: std::collections::HashMap::new(),
        }
    }
    pub fn get(&mut self, date: &V, time: &V) -> V {
        let target = slot_target(time);
        if let V::Str(d) = date {
            let key = (d.to_string(), target);
            if let Some(found) = self.map.get(&key) {
                return found.clone();
            }
            let item = V::Obj(obj(vec![
                ("date3h", date.clone()),
                ("time3h", V::from(key.1.clone())),
            ]));
            self.list.push(item.clone());
            self.map.insert(key, item.clone());
            return item;
        }
        let target = V::from(target);
        for item in self.list.items() {
            if strict_eq(&item.get("date3h"), date) && strict_eq(&item.get("time3h"), &target) {
                return item;
            }
        }
        let item = V::Obj(obj(vec![("date3h", date.clone()), ("time3h", target)]));
        self.list.push(item.clone());
        item
    }
}
/// `_isRssValueUsable(value, missing)`.
pub fn usable(v: &V, missing: f64) -> bool {
    match v {
        V::Num(n) if n.is_finite() => {
            if missing == -1. {
                *n >= 0.
            } else {
                *n > missing
            }
        }
        _ => false,
    }
}
/// `_convertSummaryTo3H(summary)`.
fn summary_to_3h(summary: &V) -> V {
    let item = V::Obj(Ob::new());
    for key in summary.o().keys() {
        let list = summary.get(&key);
        match key.as_str() {
            "pty" => item.set("pty", summary_pty(&list, &V::Num(-1.))),
            "lgt" => item.set("lgt", summary_lgt(&list, &V::Num(-1.))),
            "pop" => {
                let at = summary.get("popAtT");
                if !at.nullish() && !strict_eq(&at, &V::Num(-1.)) {
                    item.set("pop", at);
                }
            }
            "t1h" | "wsd" | "reh" | "uuu" | "vvv" | "vec" => {
                let invalid = match key.as_str() {
                    "t1h" => -50.,
                    "uuu" | "vvv" => -100.,
                    _ => -1.,
                };
                let times = summary.get("time");
                let last = times.get(&to_str(&V::Num(to_number(&times.len()) - 1.)));
                let t = parse_int(&V::from(substr(&sv(&last), 0, 2)));
                if t % 3. == 0. {
                    let values = list.a().items();
                    if let Some(v) = values
                        .iter()
                        .rev()
                        .find(|v| !(v.nullish() || loose_eq(v, &V::Num(invalid))))
                    {
                        item.set(&key, V::Num(fixed(v, 1)));
                    }
                }
            }
            "rn1" => item.set("rn1", sum(&list, &V::Num(-1.))),
            "sky" => item.set("sky", average(&list, &V::Num(-1.), 0)),
            _ => (),
        }
    }
    if summary.get("historyObservation").truthy() {
        for field in ["rn1", "pty", "lgt"] {
            let values = summary.get(field);
            let values = if values.truthy() {
                values.a().items()
            } else {
                Vec::new()
            };
            let valid: Vec<&V> = values.iter().filter(|v| usable(v, -1.)).collect();
            if valid.is_empty() || (field == "rn1" && valid.len() != 3) {
                item.set(field, -1.);
            }
        }
        item.set("historyObservation", summary.get("historyObservation"));
    }
    item
}
/// `_convert1Hto3H(srcList, usePartial)`.
pub fn convert_1h_to_3h(src: &Arr, use_partial: bool) -> Arr {
    let mut slots = Slots::new();
    for row in src.items() {
        let summary = slots.get(&row.get("date"), &row.get("time"));
        if strict_eq(&row.get("time"), &summary.get("time3h")) && !row.get("pop").nullish() {
            summary.set("popAtT", row.get("pop"));
        }
        for key in row.o().keys() {
            if summary.get(&key).nullish() {
                summary.set(&key, V::Arr(Arr::new()));
            }
            summary.get(&key).a().push(row.get(&key));
        }
    }
    let out = Arr::new();
    for summary in slots.list.items() {
        if !use_partial && !loose_eq(&summary.get("date").len(), &V::Num(3.)) {
            continue;
        }
        let item = summary_to_3h(&summary);
        item.set("date", summary.get("date3h"));
        item.set("time", summary.get("time3h"));
        out.push(item);
    }
    out
}

// ---- getShort ----

/// `_makeBasicShortList()`.
fn basic_short_list(cx: &Cx) -> Arr {
    let (_, t) = cx.current_time_value(9.);
    let current = parse_int(&V::from(slice(&t, 0, Some(2))));
    let out = Arr::new();
    for i in 0..41 {
        let (d, tm) = cx.time_value(9. - current - 48. + f64::from(i) * 3.);
        let item = obj(vec![("date", V::from(d)), ("time", V::from(tm))]);
        for f in SHORT_STRING {
            let v = match f {
                "tmn" | "tmx" | "t3h" => -50.,
                "uuu" | "vvv" => -100.,
                _ => -1.,
            };
            item.set(f, v);
        }
        out.push(V::Obj(item));
    }
    out
}
/// `_mergeShortWithBasicList(shortList, basicList)`.
fn merge_short_with_basic(short: &Arr, basic: &Arr) {
    for s_item in short.items() {
        for b in basic.items() {
            if strict_eq(&s_item.get("date"), &b.get("date"))
                && strict_eq(&s_item.get("time"), &b.get("time"))
            {
                for f in SHORT_STRING {
                    if f == "t3h" {
                        b.set(f, fixed(&s_item.get(f), 1));
                    } else {
                        b.set(f, s_item.get(f));
                    }
                }
            }
        }
    }
}
/// `_sumShortPrecipitation(shortList, basicList)`.
fn sum_short_precipitation(short: &Arr, basic: &Arr) {
    struct Slot {
        key: String,
        r06: Vec<Option<super::js::Total>>,
        s06: Vec<Option<super::js::Total>>,
        pty: Vec<V>,
    }
    let mut slots: Vec<Slot> = Vec::new();
    for row in short.items() {
        let (date, tm) = (row.get("date"), row.get("time"));
        if !matches!(date, V::Str(_)) || !matches!(tm, V::Str(_)) {
            continue;
        }
        // `parseInt(row.time.slice(0, 2), 10)`.
        let hour = parse_int10(&V::from(slice(&sv(&tm), 0, Some(2))));
        let end = (hour / 3.).ceil() * 3.;
        let slot_time = V::Obj(obj(vec![
            ("date", date.clone()),
            (
                "time",
                V::from(format!(
                    "{}{}00",
                    if end < 10. { "0" } else { "" },
                    to_str(&V::Num(end))
                )),
            ),
        ]));
        time::convert_24h_to_0h(&slot_time);
        let key = to_str(&add(&slot_time.get("date"), &slot_time.get("time")));
        let idx = match slots.iter().position(|s| s.key == key) {
            Some(i) => i,
            None => {
                slots.push(Slot {
                    key,
                    r06: Vec::new(),
                    s06: Vec::new(),
                    pty: Vec::new(),
                });
                slots.len() - 1
            }
        };
        slots[idx]
            .r06
            .push(precip::read(&row.get("r06"), &row.get("r06Text"), "mm"));
        slots[idx]
            .s06
            .push(precip::read(&row.get("s06"), &row.get("s06Text"), "cm"));
        if gt(&row.get("pty"), &V::Num(0.)) {
            slots[idx].pty.push(row.get("pty"));
        }
    }
    for item in basic.items() {
        let key = to_str(&add(&item.get("date"), &item.get("time")));
        let empty = Slot {
            key: String::new(),
            r06: Vec::new(),
            s06: Vec::new(),
            pty: Vec::new(),
        };
        let slot = slots.iter().find(|s| s.key == key).unwrap_or(&empty);
        precip::assign(&item, "r06", precip::total(&slot.r06));
        precip::assign(&item, "s06", precip::total(&slot.s06));
        if !gt(&item.get("pty"), &V::Num(0.))
            && (gt(&item.get("r06"), &V::Num(0.)) || gt(&item.get("s06"), &V::Num(0.)))
            && !slot.pty.is_empty()
        {
            let summary = summary_pty(&V::Arr(Arr::from_vec(slot.pty.clone())), &V::Undef);
            item.set(
                "pty",
                if summary.truthy() {
                    summary
                } else {
                    slot.pty[slot.pty.len() - 1].clone()
                },
            );
        }
    }
}
pub fn get_short(cx: &mut Cx) -> Flow {
    let params = cx.r("params");
    if params.get("city").is_undef() {
        params.set("city", "");
    }
    if params.get("town").is_undef() {
        params.set("town", "");
    }
    let _ = catch(|| {
        let basic = basic_short_list(cx);
        let Ok((coord, _)) = cx.coord() else {
            return;
        };
        let Ok(info) = read_town(cx, TownModel::Short, &coord, true) else {
            return;
        };
        let short_list = info.get("ret");
        let daily = info.get("dailyRows");
        cx.set(
            "_dailyShort",
            if daily.truthy() {
                daily
            } else {
                V::Arr(Arr::new())
            },
        );
        merge_short_with_basic(short_list.a(), &basic);
        sum_short_precipitation(short_list.a(), &basic);
        cx.set("shortPubDate", info.get("pubDate"));
        cx.set("short", V::Arr(basic));
    });
    Flow::Next
}

// ---- getShortRss ----

fn merge_rss_value(
    target: &V,
    field: &str,
    value: &V,
    overwrite: bool,
    missing: f64,
    round1: bool,
    contribution: &V,
) {
    if !usable(value, missing) {
        return;
    }
    if overwrite || !usable(&target.get(field), missing) {
        let v = if round1 {
            V::Num(fixed(value, 1))
        } else {
            value.clone()
        };
        target.set(field, v);
        contribution.set(field, target.get(field));
    }
}
pub fn get_short_rss(cx: &mut Cx) -> Flow {
    let Ok((coord, _)) = cx.coord() else {
        return Flow::Next;
    };
    if !cx.has("short") {
        cx.set("short", V::Arr(basic_short_list(cx)));
    }
    let Ok(info) = read_town(cx, TownModel::ShortRss, &coord, true) else {
        return Flow::Next;
    };
    let now = cx.now;
    let rss_pub = info.get("pubDate");
    if !policy::fresh_short(&rss_pub, now) {
        return Flow::Next;
    }
    let short_pub = cx.r("shortPubDate");
    if policy::fresh_short(&short_pub, now)
        && policy::timestamp(&rss_pub) < policy::timestamp(&short_pub)
    {
        return Flow::Next;
    }
    let rss_list = info.get("ret").a().clone();
    let rss = rss_list.items();
    let (rd, rt) = cx.time_value(9.);
    let request = parse_int(&V::from(format!("{rd}{rt}")));
    let mut i: i64 = rss.len() as i64 - 1;
    while i >= 0 {
        if parse_int(&V::from(to_str(&rss[i as usize].get("date")))) <= request {
            break;
        }
        i -= 1;
    }
    let start = (i + 1) as usize;
    cx.set("shortRssPubDate", rss_pub.clone());
    let daily_rss = obj(vec![
        ("pubDate", rss_pub.clone()),
        ("rows", V::Arr(Arr::new())),
    ]);
    cx.set("_dailyShortRss", V::Obj(daily_rss.clone()));
    let overwrite = !policy::fresh_short(&short_pub, now)
        || policy::timestamp(&short_pub) < policy::timestamp(&cx.r("shortRssPubDate"));
    let short = cx.r("short");
    for r in rss.iter().skip(start) {
        for target in short.a().items() {
            let key = parse_int(&add(&target.get("date"), &target.get("time")));
            if key == parse_int(&r.get("date")) {
                let contribution = V::Obj(obj(vec![
                    ("date", target.get("date")),
                    ("time", target.get("time")),
                ]));
                merge_rss_value(
                    &target,
                    "pop",
                    &r.get("pop"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "pty",
                    &r.get("pty"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "r06",
                    &r.get("r06"),
                    overwrite,
                    -1.,
                    true,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "s06",
                    &r.get("s06"),
                    overwrite,
                    -1.,
                    true,
                    &contribution,
                );
                for field in ["r06", "s06"] {
                    let c = contribution.get(field);
                    if !c.is_undef() {
                        precip::assign(&target, field, precip::exact(&c, 6.));
                    }
                }
                merge_rss_value(
                    &target,
                    "reh",
                    &r.get("reh"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "sky",
                    &r.get("sky"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "t3h",
                    &r.get("temp"),
                    overwrite,
                    -50.,
                    true,
                    &contribution,
                );
                if strict_eq(&target.get("time"), &s("0600")) {
                    merge_rss_value(
                        &target,
                        "tmn",
                        &r.get("tmn"),
                        overwrite,
                        -50.,
                        false,
                        &contribution,
                    );
                } else if strict_eq(&target.get("time"), &s("1500")) {
                    merge_rss_value(
                        &target,
                        "tmx",
                        &r.get("tmx"),
                        overwrite,
                        -50.,
                        false,
                        &contribution,
                    );
                }
                merge_rss_value(
                    &target,
                    "wsd",
                    &r.get("ws"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                let wd = r.get("wd");
                if usable(&wd, -1.) && le(&wd, &V::Num(7.)) && to_number(&wd) % 1. == 0. {
                    merge_rss_value(
                        &target,
                        "vec",
                        &V::Num(to_number(&wd) * 45.),
                        overwrite,
                        -1.,
                        false,
                        &contribution,
                    );
                }
                merge_rss_value(
                    &target,
                    "wav",
                    &r.get("wav"),
                    overwrite,
                    -1.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "uuu",
                    &r.get("uuu"),
                    overwrite,
                    -100.,
                    false,
                    &contribution,
                );
                merge_rss_value(
                    &target,
                    "vvv",
                    &r.get("vvv"),
                    overwrite,
                    -100.,
                    false,
                    &contribution,
                );
                if contribution.o().keys().len() > 2 {
                    daily_rss.get("rows").a().push(contribution);
                }
                break;
            }
        }
    }
    Flow::Next
}

// ---- getShortest / getCurrent ----

pub fn get_shortest(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let Ok((coord, _)) = cx.coord() else {
            return;
        };
        let Ok(info) = read_town(cx, TownModel::Shortest, &coord, true) else {
            return;
        };
        let list = info.get("ret");
        let (d, t) = cx.shortest_time_value(9.);
        let now = V::from(format!("{d}{t}"));
        let filtered = list
            .a()
            .filter(|row| le(&now, &add(&row.get("date"), &row.get("time"))));
        cx.set("shortest", V::Arr(filtered));
        cx.set("shortestList", list);
        cx.set("shortestPubDate", info.get("pubDate"));
    });
    Flow::Next
}
/// `_calcValue3hTo1h(time, prvValue, nextValue)`: `nextValue + (nextValue - prvValue)/3*time`, a
/// string `nextValue` concatenates (then `toFixed` throws and `Math.round` gives NaN, as in legacy).
fn calc_3h_to_1h(t: f64, prv: &V, next: &V) -> V {
    add(next, &V::Num((to_number(next) - to_number(prv)) / 3. * t))
}
/// `_makeCurrent(shortList, shortestList, date, time)`.
fn make_current(short: &V, shortest: &V, date: &str, tm: &str) -> V {
    let item = obj(vec![
        ("t1h", V::Num(-50.)),
        ("rn1", V::Num(-1.)),
        ("sky", V::Num(-1.)),
        ("uuu", V::Num(-100.)),
        ("vvv", V::Num(-100.)),
        ("reh", V::Num(-1.)),
        ("pty", V::Num(-1.)),
        ("lgt", V::Num(-1.)),
        ("vec", V::Num(-1.)),
        ("wsd", V::Num(-1.)),
    ]);
    let int_time = parse_int(&V::s(tm)) / 100.;
    if to_number(&shortest.len()) == 0. && to_number(&short.len()) == 0. {
        return V::Undef;
    }
    let shorts = short.a().items();
    let mut found: Option<(V, V)> = None;
    for (i, row) in shorts.iter().enumerate() {
        if strict_eq(&row.get("date"), &s(date)) && parse_int(&row.get("time")) >= parse_int(&s(tm))
        {
            let prv = if i > 0 {
                shorts[i - 1].clone()
            } else {
                V::Undef
            };
            found = Some((row.clone(), prv));
            break;
        }
    }
    if let Some((row, prv)) = found {
        item.set("pty", row.get("pty"));
        item.set("sky", row.get("sky"));
        if strict_eq(&row.get("time"), &s(tm)) {
            item.set("t1h", row.get("t3h"));
            item.set("reh", row.get("reh"));
            item.set("wsd", row.get("wsd"));
        } else {
            let t = int_time % 3.;
            item.set(
                "t1h",
                V::Num(fixed(
                    &calc_3h_to_1h(t, &row.get("t3h"), &prv.get("t3h")),
                    1,
                )),
            );
            item.set(
                "reh",
                V::Num(round(to_number(&calc_3h_to_1h(
                    t,
                    &row.get("reh"),
                    &prv.get("reh"),
                )))),
            );
            item.set(
                "wsd",
                V::Num(fixed(
                    &calc_3h_to_1h(t, &row.get("wsd"), &prv.get("wsd")),
                    1,
                )),
            );
        }
    }
    let shortest_items = shortest.a().items();
    if let Some(row) = shortest_items
        .iter()
        .rev()
        .find(|r| strict_eq(&r.get("date"), &s(date)) && strict_eq(&r.get("time"), &s(tm)))
    {
        item.set("pty", row.get("pty"));
        item.set("rn1", row.get("rn1"));
        item.set("sky", row.get("sky"));
        item.set("lgt", row.get("lgt"));
    }
    V::Obj(item)
}
pub fn get_current(cx: &mut Cx) -> Flow {
    let _ = catch(|| {
        let Ok((coord, _)) = cx.coord() else {
            return;
        };
        let Ok(info) = read_town(cx, TownModel::Current, &coord, true) else {
            return;
        };
        let list = info.get("ret");
        let (nd, nt) = cx.current_time_value(9.);
        let last = list.get(&to_str(&V::Num(to_number(&list.len()) - 1.)));
        let item = if strict_eq(&s(&nd), &last.get("date")) && strict_eq(&s(&nt), &last.get("time"))
        {
            json_clone(&last)
        } else {
            let (ad, at) = cx.current_time_value(6.);
            let current_ms = time::date_ms(&time::convert_string_to_date(&add(
                &last.get("date"),
                &last.get("time"),
            )));
            let accepted_ms =
                time::date_ms(&time::convert_string_to_date(&V::from(format!("{ad}{at}"))));
            if accepted_ms < current_ms {
                json_clone(&last)
            } else {
                let made = make_current(&cx.r("short"), &cx.r("shortestList"), &nd, &nt);
                made.set("time", nt.as_str());
                made.set("date", nd.as_str());
                made.set("overwrite", true);
                made
            }
        };
        if loose_eq(&item.get("t1h"), &V::Num(-50.)) {
            item.set("t1h", V::Undef);
        } else {
            item.set("t1h", fixed(&item.get("t1h"), 1));
        }
        if loose_eq(&item.get("rn1"), &V::Num(-1.)) {
            item.set("rn1", V::Undef);
        } else if lt(&item.get("rn1"), &V::Num(10.)) {
            item.set("rn1", fixed(&item.get("rn1"), 1));
        } else {
            item.set("rn1", round(to_number(&item.get("rn1"))));
        }
        for (k, sentinel) in [
            ("sky", -1.),
            ("uuu", -100.),
            ("vvv", -100.),
            ("reh", -1.),
            ("pty", -1.),
            ("lgt", -1.),
            ("vec", -1.),
        ] {
            if loose_eq(&item.get(k), &V::Num(sentinel)) {
                item.set(k, V::Undef);
            }
        }
        if loose_eq(&item.get("wsd"), &V::Num(-1.)) {
            item.set("wsd", V::Undef);
        } else {
            item.set("wsd", fixed(&item.get("wsd"), 1));
        }
        let short = cx.r("short");
        if !short.is_undef() {
            let y = time::date_ms(&time::convert_string_to_date(&item.get("date"))) - time::DAY;
            let ys = V::from(time::yyyymmdd_ms(y));
            let mut min = V::Num(-50.);
            for row in short.a().items() {
                if strict_eq(&row.get("date"), &ys)
                    && !strict_eq(&row.get("reh"), &V::Num(-1.))
                    && !strict_eq(&row.get("tmn"), &V::Num(-50.))
                {
                    min = row.get("tmn");
                    break;
                }
            }
            if strict_eq(&min, &V::Num(-50.)) {
                min = V::Num(0.);
            }
            cx.set("yesterdayMinTemperature", min);
        }
        cx.set("current", item);
        cx.set("currentPubDate", info.get("pubDate"));
        cx.set("currentList", list);
    });
    Flow::Next
}

// ---- current list validation and corrections ----

pub fn update_current_list_for_validation(cx: &mut Cx) -> Flow {
    if cx.r("currentList").nullish() {
        cx.set("currentList", V::Arr(Arr::new()));
    }
    let list = cx.r("currentList");
    let a = list.a().clone();
    let template = obj(vec![
        ("date", s("")),
        ("time", s("")),
        ("mx", V::Num(-1.)),
        ("my", V::Num(-1.)),
        ("t1h", V::Num(-50.)),
        ("rn1", V::Num(-1.)),
        ("sky", V::Num(-1.)),
        ("uuu", V::Num(-1.)),
        ("vvv", V::Num(-1.)),
        ("reh", V::Num(-1.)),
        ("pty", V::Num(-1.)),
        ("lgt", V::Num(-1.)),
        ("vec", V::Num(-1.)),
        ("wsd", V::Num(-1.)),
    ]);
    let mut dates = Vec::new();
    for i in (0..=192).rev() {
        dates.push(cx.current_time_value(9. - f64::from(i)));
    }
    // `==` against string slot keys: string rows match by text; any other row keeps the scan.
    let mut seen = std::collections::HashSet::new();
    let mut other = Vec::new();
    for c in a.items() {
        match (c.get("date"), c.get("time")) {
            (V::Str(d), V::Str(t)) => {
                seen.insert((d.to_string(), t.to_string()));
            }
            _ => other.push(c),
        }
    }
    for (d, t) in dates {
        let exists = seen.contains(&(d.clone(), t.clone()))
            || other
                .iter()
                .any(|c| loose_eq(&c.get("date"), &s(&d)) && loose_eq(&c.get("time"), &s(&t)));
        if exists {
            continue;
        }
        template.set("date", d.as_str());
        template.set("time", t.as_str());
        a.push(json_clone(&V::Obj(template.clone())));
    }
    a.sort_by(|x, y| {
        let (xd, yd) = (x.get("date"), y.get("date"));
        if gt(&xd, &yd) {
            1.
        } else if lt(&xd, &yd) {
            -1.
        } else if strict_eq(&xd, &yd) {
            let (xt, yt) = (x.get("time"), y.get("time"));
            if gt(&xt, &yt) {
                1.
            } else if lt(&xt, &yt) {
                -1.
            } else {
                0.
            }
        } else {
            0.
        }
    });
    let max = cx.config.max_current_count;
    if a.len() >= max {
        cx.set("currentList", V::Arr(a.slice_from(a.len() - max)));
    }
    Flow::Next
}
fn merge_current_sky_from_shortest(current: &V, shortest: &V) {
    let found = shortest.a().find(|r| {
        strict_eq(&r.get("date"), &current.get("date"))
            && strict_eq(&r.get("time"), &current.get("time"))
    });
    if found.is_undef() {
        return;
    }
    current.set("sky", found.get("sky"));
}
pub fn merge_current_sky_by_shortest(cx: &mut Cx) -> Flow {
    let shortest = cx.r("shortestList");
    if shortest.nullish() || loose_eq(&shortest.len(), &V::Num(0.)) {
        return Flow::Next;
    }
    for c in cx.r("currentList").a().items() {
        if c.get("sky").nullish() || lt(&c.get("sky"), &V::Num(0.)) {
            merge_current_sky_from_shortest(&c, &shortest);
        }
    }
    let current = cx.r("current");
    if current.nullish() {
        return Flow::Next;
    }
    if current.get("sky").nullish() || lt(&current.get("sky"), &V::Num(0.)) {
        merge_current_sky_from_shortest(&current, &shortest);
    }
    Flow::Next
}
/// `mergeCurrentByStnHourly`: legacy station hourly rows fill invalid grid hours, then the
/// ASOS history read (when the store supplies one; legacy `config.history.readEnabled`) fills
/// the remaining invalid fields of D-7..D-1 hours.
pub fn merge_current_by_stn_hourly(cx: &mut Cx) -> Flow {
    let Ok(town) = cx.town_info() else {
        return Flow::Next;
    };
    if !town.truthy() {
        return Flow::Next;
    }
    // loadLegacyForTown: a town without gCoord reads nothing.
    let rows = if !town.get("gCoord").truthy() {
        Some(V::Arr(Arr::new()))
    } else {
        cx.store
            .city_hourly(&super::to_store(&town))
            .ok()
            .map(|v| super::js::from_store(&v))
    };
    // `history.loadForTown`: null when reads are disabled; a failed read keeps the default.
    let history = match cx.store.history(&super::to_store(&town)) {
        Ok(crate::gateway::OrderedJson::Null) => V::Undef,
        Ok(v) => super::js::from_store(&v),
        Err(_) => V::Obj(obj(vec![
            ("reason", V::s("cache-read-timeout")),
            ("hourly", V::Arr(Arr::new())),
            ("daily", V::Arr(Arr::new())),
        ])),
    };
    policy::merge_legacy(&cx.req, &rows.unwrap_or_default());
    policy::merge_hourly(&cx.req, &history);
    Flow::Next
}

// ---- station minute weather ----

fn cloud_to_sky(current: &V, cloud: &V) -> V {
    let mut cloud_sky = V::Undef;
    if !cloud.nullish() {
        cloud_sky = V::Num(if le(cloud, &V::Num(2.)) {
            1.
        } else if le(cloud, &V::Num(5.)) {
            2.
        } else if le(cloud, &V::Num(8.)) {
            3.
        } else {
            4.
        });
    }
    if cloud_sky.truthy() {
        cloud_sky
    } else {
        current.clone()
    }
}
fn index_of(text: &str, needle: &str) -> bool {
    text.contains(needle)
}
fn stn_weather_to_pty(current_pty: &V, stn: &V) -> V {
    let weather = stn.get("weather");
    let rns = stn.get("rns");
    let temp = stn.get("t1h");
    let wt = stn.get("weatherType");
    let mut pty = current_pty.clone();
    let set_rns = |stn: &V| {
        if strict_eq(&stn.get("rns"), &V::Bool(false)) {
            stn.set("rns", true);
            stn.set("rnsSource", "weather");
        }
    };
    if !weather.is_undef() {
        let w = to_str(&weather);
        let mut weather_pty: Option<f64> = None;
        if to_number(&weather.len()) == 0. {
        } else if index_of(&sv(&weather), "뇌우끝,비") {
            weather_pty = Some(1.);
        } else if index_of(&w, "뇌우끝,눈") {
            weather_pty = Some(3.);
            set_rns(stn);
        } else if index_of(&w, "끝") {
            weather_pty = Some(0.);
        } else if index_of(&w, "진눈깨비") || index_of(&w, "비/눈") || index_of(&w, "눈/비")
        {
            if strict_eq(&wt, &V::Num(29.)) {
                set_rns(stn);
            }
            weather_pty = Some(2.);
        } else if index_of(&w, "비")
            || index_of(&w, "강수")
            || index_of(&w, "뇌우")
            || index_of(&w, "소나기")
        {
            if [14., 15., 16., 18., 19.]
                .iter()
                .any(|n| strict_eq(&wt, &V::Num(*n)))
            {
                set_rns(stn);
            }
            weather_pty = Some(1.);
        } else if index_of(&w, "눈") || index_of(&w, "얼음") || index_of(&w, "우박") {
            weather_pty = Some(3.);
            set_rns(stn);
        }
        if let Some(p) = weather_pty {
            pty = V::Num(p);
        }
    }
    if !rns.is_undef() {
        let mut rns_pty: Option<f64> = None;
        if strict_eq(&pty, &V::Num(0.))
            && strict_eq(&rns, &V::Bool(true))
            && stn.get("localMinAws").truthy()
            && !temp.is_undef()
        {
            rns_pty = Some(if gt(&temp, &V::Num(3.)) {
                1.
            } else if ge(&temp, &V::Num(0.)) {
                2.
            } else {
                3.
            });
        }
        if let Some(p) = rns_pty {
            pty = V::Num(p);
        }
    }
    pty
}
fn stn_weather_to_lgt(current: &V, weather: &V) -> V {
    let mut lgt = V::Undef;
    if let V::Str(w) = weather
        && (w.contains("뇌우") || w.contains("번개") || w.contains("뇌전"))
    {
        lgt = V::Num(1.);
    }
    if lgt.truthy() { lgt } else { current.clone() }
}
/// `_isValidObservation(key, value)`.
fn valid_observation(key: &str, v: &V) -> bool {
    let V::Num(n) = v else {
        return false;
    };
    if !n.is_finite() {
        return false;
    }
    match key {
        "t1h" => *n > -50. && *n < 60.,
        "reh" => (0. ..=100.).contains(n),
        "vec" => (0. ..=360.).contains(n),
        "wsd" => *n >= 0. && *n < 100.,
        _ => *n >= 0.,
    }
}
/// `controllerKmaStnWeather.updateWeather(current)`.
fn update_weather(current: &V) {
    let pty = current.get("pty");
    let set = |w: &str, t: f64| {
        current.set("weather", w);
        current.set("weatherType", t);
    };
    if ge(&pty, &V::Num(1.)) {
        let wt = current.get("weatherType");
        if wt.nullish() || lt(&wt, &V::Num(0.)) {
            current.set("weatherType", 0.);
        }
        let wt = current.get("weatherType");
        let case = |n: f64| strict_eq(&wt, &V::Num(n));
        if (0..=12).any(|n| case(f64::from(n))) {
            let p = |n: f64| loose_eq(&pty, &V::Num(n));
            if p(1.) {
                set("비", 65.);
            } else if p(2.) {
                set("진눈깨비", 64.);
            } else if p(3.) {
                set("눈", 66.);
            } else if p(4.) {
                set("소나기", 25.);
            } else if p(5.) {
                set("약한비", 19.);
            } else if p(6.) {
                set("약진눈깨비", 29.);
            } else if p(7.) {
                set("약한눈", 33.);
            }
        } else if case(17.) {
            set("보통이슬비", 15.);
        } else if case(27.) {
            set("약한소나기", 24.);
        } else if case(28.) {
            set("보통비단속", 20.);
        } else if case(31.) {
            set("진눈깨비", 64.);
        } else if case(40.) {
            set("소낙눈/약", 38.);
        } else if case(41.) {
            set("눈", 66.);
        } else if case(56.) {
            set("번개", 55.);
        }
    } else if strict_eq(&pty, &V::Num(0.)) {
        let wt = current.get("weatherType");
        if wt.nullish() || lt(&wt, &V::Num(0.)) {
            sky_weather(current);
        }
        let wt = current.get("weatherType");
        let rainy = [
            14., 15., 16., 18., 19., 20., 21., 22., 23., 24., 25., 26., 29., 30., 31., 32., 33.,
            34., 35., 36., 37., 38., 39., 42., 43., 44., 45., 46., 47., 49., 53., 54., 58., 64.,
            65., 66.,
        ];
        if rainy.iter().any(|n| strict_eq(&wt, &V::Num(*n))) {
            sky_weather(current);
        }
    }
}
fn sky_weather(current: &V) {
    let sky = current.get("sky");
    let set = |w: &str, t: f64| {
        current.set("weather", w);
        current.set("weatherType", t);
    };
    let is = |n: f64| strict_eq(&sky, &V::Num(n));
    if is(0.) || is(1.) {
        set("맑음", 0.);
    } else if is(2.) {
        set("구름조금", 1.);
    } else if is(3.) {
        set("구름많음", 2.);
    } else if is(4.) {
        set("흐림", 3.);
    }
}
/// `_updateCurrentFromMinWeather(currentList, reqCurrent)`.
fn update_current_from_min_weather(list: &V, current: &V) {
    let live = current.get("liveTime");
    let mut in_list = V::Undef;
    if live.truthy() && substr(&sv(&live), 2, 2) == "00" {
        in_list = list.a().find(|o| {
            strict_eq(&o.get("date"), &current.get("date")) && strict_eq(&o.get("time"), &live)
        });
        if in_list.truthy() {
            for p in super::data::CUR_STRING {
                in_list.set(p, current.get(p));
            }
        } else {
            in_list = V::Obj(obj(vec![
                ("date", current.get("date")),
                ("time", live.clone()),
                ("mx", current.get("mx")),
                ("my", current.get("my")),
            ]));
            for p in super::data::CUR_STRING {
                in_list.set(p, current.get(p));
            }
            list.a().push(in_list.clone());
        }
    }
    if in_list.truthy() && current.get("fieldObservations").truthy() {
        in_list.set(
            "fieldObservations",
            json_clone(&current.get("fieldObservations")),
        );
        in_list.set("historyObservation", current.get("historyObservation"));
    }
}
pub fn get_kma_stn_minute_weather(cx: &mut Cx) -> Flow {
    if !cx.r("current").truthy() {
        let (d, t) = cx.current_time_value(9.);
        cx.set(
            "current",
            V::Obj(obj(vec![("time", V::from(t)), ("date", V::from(d))])),
        );
    }
    let Ok(town) = cx.town_info() else {
        return Flow::Next;
    };
    let now = V::Date(cx.now + 9. * time::HOUR);
    let date_time = format!("{}{}", time::yyyymmdd(&now), time::hhmm(&now));
    let current = cx.r("current");
    let stn = match cx.store.stn_hourly_and_min_rns(
        &super::to_store(&town),
        &date_time,
        &super::to_store(&current),
    ) {
        Ok(v) => super::js::from_store(&v),
        Err(_) => return Flow::Next,
    };
    if strict_eq(&stn.get("t1h"), &V::Num(0.))
        && strict_eq(&stn.get("vec"), &V::Num(0.))
        && strict_eq(&stn.get("wsd"), &V::Num(0.))
    {
        return Flow::Next;
    }
    let req = cx.req.clone();
    let locale = cx.locale;
    let _ = catch(|| {
        let stn_ms = time::new_date(&stn.get("stnDateTime"));
        let mut stn_first = true;
        let cp = req.get("currentPubDate");
        if !cp.nullish() {
            let ct = time::date_ms(&time::convert_string_to_date(&cp));
            if ct >= stn_ms {
                stn_first = false;
            }
        }
        current.set("dongnae", json_clone(&current));
        let station_temperature = valid_observation("t1h", &stn.get("t1h"))
            && (current.get("t1h").is_undef()
                || le(&current.get("t1h"), &V::Num(-50.))
                || stn_first);
        for key in stn.o().keys() {
            let obs = stn.get(&key);
            if current.get(&key).nullish() {
                current.set(&key, obs);
            } else if key == "t1h" {
                if le(&current.get("t1h"), &V::Num(-50.))
                    || (stn_first && valid_observation(&key, &obs))
                {
                    current.set(&key, obs);
                }
            } else if ["rn1", "reh", "vec", "wsd"].contains(&key.as_str()) {
                let observed = ["reh", "vec", "wsd"].contains(&key.as_str()) || key == "t1h";
                if lt(&current.get(&key), &V::Num(0.))
                    || (stn_first && observed && valid_observation(&key, &obs))
                {
                    current.set(&key, obs);
                }
            } else {
                current.set(&key, obs);
            }
        }
        if stn_first {
            current.set("overwrite", true);
            current.set("date", time::yyyymmdd(&V::Date(stn_ms)));
            current.set("time", time::hhzz(&V::Date(stn_ms)));
            let sdt = sv(&stn.get("stnDateTime"));
            current.set("liveTime", substr(&sdt, 11, 5).replacen(':', "", 1));
        }
        if station_temperature {
            let src = V::Obj(obj(vec![
                ("source", s("KMA_STATION_LIVE")),
                ("stationId", stn.get("stnId")),
                (
                    "key",
                    V::from(time::dotted_to_compact(&sv(&stn.get("stnDateTime")))),
                ),
            ]));
            policy::record(&current, &src, &["t1h"]);
        }
        if (current.get("rn1").nullish() || stn_first) && stn.has("rs1h") {
            current.set("rn1", stn.get("rs1h"));
        }
        if current.has("rn1") {
            let rn1 = current.get("rn1");
            if matches!(rn1, V::Num(_)) {
                if gt(&rn1, &V::Num(10.)) {
                    current.set("rn1", round(to_number(&rn1)));
                } else {
                    current.set(
                        "rn1",
                        super::js::parse_float(&V::from(super::chain::fixed_str(&rn1, 1))),
                    );
                }
            } else {
                current.del("rn1");
            }
        }
        current.set("sky", cloud_to_sky(&current.get("sky"), &stn.get("cloud")));
        current.set("pty", stn_weather_to_pty(&current.get("pty"), &stn));
        if stn.get("rnsSource").truthy() {
            current.set("rns", stn.get("rns"));
            current.set("rnsSource", stn.get("rnsSource"));
        }
        current.set(
            "lgt",
            stn_weather_to_lgt(&current.get("lgt"), &stn.get("weather")),
        );
        update_weather(&current);
        let wt = current.get("weatherType");
        let weather = if wt.nullish() || lt(&wt, &V::Num(0.)) {
            String::new()
        } else {
            crate::world::units::weather_str(to_number(&wt), locale)
        };
        current.set("weather", weather);
        update_current_from_min_weather(&req.get("currentList"), &current);
    });
    Flow::Next
}

// ---- time alignment and merges ----

pub fn convert_0h_to_24h(cx: &mut Cx) -> Flow {
    let current = cx.r("current");
    if current.truthy() && strict_eq(&current.get("time"), &s("0000")) {
        time::convert_0h_to_24h(&current);
    }
    for key in ["short", "shortest", "currentList"] {
        let list = cx.r(key);
        if list.truthy() {
            for row in list.a().items() {
                time::convert_0h_to_24h(&row);
            }
        }
    }
    Flow::Next
}
/// `_mergeShortWithCurrent(shortList, currentList)`.
fn merge_short_with_current(cx: &Cx, short: &Arr, current: &Arr) {
    let (req_date, _) = cx.time_value(9.);
    let days = Arr::new();
    let first_date = short.at(0).get("date");
    for cur in current.items() {
        if lt(&cur.get("date"), &first_date) {
            continue;
        }
        let day = day_summary(&days, &cur.get("date"));
        if day.get("taMax").is_undef() {
            day.set("taMax", -50.);
        }
        if day.get("taMin").is_undef() {
            day.set("taMin", -50.);
        }
        if lt(&day.get("taMax"), &cur.get("t1h")) {
            day.set("taMax", cur.get("t1h"));
        }
        if strict_eq(&day.get("taMin"), &V::Num(-50.)) || gt(&day.get("taMin"), &cur.get("t1h")) {
            day.set("taMin", cur.get("t1h"));
        }
    }
    let tmp = convert_1h_to_3h(current, true);
    // Slots are unique per (date, time) string pair, so a map gives the same single match as
    // the legacy nested scan.
    let mut slots: std::collections::HashMap<(String, String), V> =
        std::collections::HashMap::new();
    for t in tmp.items() {
        if let (V::Str(d), V::Str(tm)) = (t.get("date"), t.get("time")) {
            slots.entry((d.to_string(), tm.to_string())).or_insert(t);
        }
    }
    for item in short.items() {
        let matched = match (item.get("date"), item.get("time")) {
            (V::Str(d), V::Str(tm)) => slots.get(&(d.to_string(), tm.to_string())).cloned(),
            _ => None,
        };
        if let Some(t) = matched {
            {
                for key in t.o().keys() {
                    if key == "t1h" {
                        item.set("t3h", t.get(&key));
                    } else {
                        item.set(&key, t.get(&key));
                    }
                }
            }
        }
        let req_day = s(&req_date);
        if strict_eq(&item.get("time"), &s("0600")) {
            let mut tmn = day_summary(&days, &item.get("date")).get("taMin");
            if tmn.is_undef() {
                tmn = V::Num(-50.);
            }
            if !strict_eq(&tmn, &V::Num(-50.)) {
                if strict_eq(&item.get("date"), &req_day)
                    && !strict_eq(&item.get("tmn"), &V::Num(-50.))
                {
                    let cur = item.get("tmn");
                    item.set("tmn", if lt(&cur, &tmn) { cur } else { tmn });
                } else {
                    item.set("tmn", tmn);
                }
            }
            item.set("tmn", fixed(&item.get("tmn"), 1));
        }
        if strict_eq(&item.get("time"), &s("1500")) {
            let mut tmx = day_summary(&days, &item.get("date")).get("taMax");
            if tmx.is_undef() {
                tmx = V::Num(-50.);
            }
            if !strict_eq(&tmx, &V::Num(-50.)) {
                if strict_eq(&item.get("date"), &req_day)
                    && !strict_eq(&item.get("tmx"), &V::Num(-50.))
                {
                    let cur = item.get("tmx");
                    item.set("tmx", if gt(&cur, &tmx) { cur } else { tmx });
                } else {
                    item.set("tmx", tmx);
                }
            }
            item.set("tmx", fixed(&item.get("tmx"), 1));
        }
    }
}
pub fn merge_short_with_current_list(cx: &mut Cx) -> Flow {
    let (current, short) = (cx.r("currentList"), cx.r("short"));
    if current.nullish() || short.nullish() {
        return Flow::Next;
    }
    let (sa, ca) = (short.a().clone(), current.a().clone());
    let _ = catch(|| merge_short_with_current(cx, &sa, &ca));
    Flow::Next
}
/// `_mergeShortByShortest(shortList, shortestList, currentList, currentTime)`.
fn merge_short_by_shortest(short: &V, shortest: &V, current: &V, ct: &(String, String)) {
    if short.nullish() || loose_eq(&short.len(), &V::Num(0.)) {
        return;
    }
    if shortest.nullish() || loose_eq(&shortest.len(), &V::Num(0.)) {
        return;
    }
    let (cd, tm) = (parse_int(&s(&ct.0)), parse_int(&s(&ct.1)));
    let filtered = shortest.a().filter(|o| {
        let od = parse_int(&o.get("date"));
        cd < od || (cd == od && tm < parse_int(&o.get("time")))
    });
    if current.truthy() {
        let hour = parse_int(&V::from(substr(&ct.1, 0, 2)));
        let list = current.a();
        let n = list.len() as i64;
        let at = |i: i64| {
            if i >= 0 {
                list.at(i as usize)
            } else {
                V::Undef
            }
        };
        if hour % 3. == 1. {
            filtered.unshift(vec![at(n - 1)]);
        } else if hour % 3. == 2. {
            filtered.unshift(vec![at(n - 2), at(n - 1)]);
        }
    }
    if filtered.is_empty() {
        return;
    }
    // lastFilterTime/restCount only feed a log line; the property read still happens.
    let _ = filtered.at(filtered.len() - 1).get("time");
    let tmp = convert_1h_to_3h(&filtered, false);
    let mut rain = Slots::new();
    let mut totals: Vec<(V, Vec<Option<super::js::Total>>)> = Vec::new();
    for src in filtered.items() {
        let slot = rain.get(&src.get("date"), &src.get("time"));
        let t = precip::get(&src, "rn1").or_else(|| precip::read(&src.get("rn1"), &V::Undef, "mm"));
        match totals.iter_mut().find(|(k, _)| strict_eq(k, &slot)) {
            Some((_, v)) => v.push(t),
            None => totals.push((slot, vec![t])),
        }
    }
    for (slot, list) in &totals {
        if list.len() != 3 || list.iter().any(Option::is_none) {
            continue;
        }
        let total = precip::total(list);
        for row in short.a().items() {
            if strict_eq(&row.get("date"), &slot.get("date3h"))
                && strict_eq(&row.get("time"), &slot.get("time3h"))
            {
                precip::keep(&row, "shortestRn1", total.clone());
            }
        }
    }
    let shorts = short.a().items();
    for s3 in tmp.items() {
        for row in &shorts {
            if strict_eq(&s3.get("date"), &row.get("date"))
                && strict_eq(&s3.get("time"), &row.get("time"))
            {
                for key in s3.o().keys() {
                    let v = s3.get(&key);
                    if key == "rn1" {
                        if loose_eq(&v, &V::Num(-1.)) {
                            continue;
                        }
                        row.set("shortestRn1", v);
                    } else if key == "t1h" {
                        if loose_eq(&v, &V::Num(-50.)) {
                            continue;
                        }
                        row.set("t3h", s3.get("t1h"));
                    } else {
                        let invalid = if key == "uuu" || key == "vvv" {
                            -100.
                        } else {
                            -1.
                        };
                        if loose_eq(&v, &V::Num(invalid)) {
                            continue;
                        }
                        row.set(&key, v);
                    }
                }
                break;
            }
        }
    }
}
pub fn merge_by_shortest(cx: &mut Cx) -> Flow {
    let ct = cx.current_time_value(9.);
    if cx.r("shortestList").truthy() {
        let (short, shortest, current) = (cx.r("short"), cx.r("shortestList"), cx.r("currentList"));
        let _ = catch(|| merge_short_by_shortest(&short, &shortest, &current, &ct));
        return Flow::Next;
    }
    let Ok((coord, _)) = cx.coord() else {
        return Flow::Next;
    };
    let Ok(info) = read_town(cx, TownModel::Shortest, &coord, true) else {
        return Flow::Next;
    };
    let _ = catch(|| {
        let list = info.get("ret");
        if list.truthy() && gt(&list.len(), &V::Num(0.)) {
            cx.set("shortestList", list.clone());
            merge_short_by_shortest(&cx.r("short"), &list, &cx.r("currentList"), &ct);
        }
    });
    Flow::Next
}
/// `ControllerTown24h.adjustShort`.
pub fn adjust_short(cx: &mut Cx) -> Flow {
    if !cx.has("short") {
        return Flow::Next;
    }
    let short = cx.r("short");
    let list = short.a().clone();
    let days = Arr::new();
    let n50 = V::Num(-50.);
    for row in list.items() {
        if row.get("pop").nullish() || loose_eq(&row.get("pop"), &V::Num(-1.)) {
            row.set("pop", 0.);
        }
        let day = day_summary(&days, &row.get("date"));
        if day.get("taMax").is_undef() {
            day.set("taMax", -50.);
        }
        if day.get("taMin").is_undef() {
            day.set("taMin", -50.);
        }
        if lt(&day.get("taMax"), &row.get("t3h")) {
            day.set("taMax", row.get("t3h"));
        }
        if lt(&day.get("taMax"), &row.get("tmx")) {
            day.set("taMax", row.get("tmx"));
        }
        row.set("tmx", -50.);
        if (strict_eq(&day.get("taMin"), &n50) || gt(&day.get("taMin"), &row.get("t3h")))
            && !strict_eq(&row.get("t3h"), &n50)
        {
            day.set("taMin", row.get("t3h"));
        }
        if strict_eq(&day.get("taMin"), &n50) && !strict_eq(&row.get("tmn"), &n50) {
            day.set("taMin", row.get("tmn"));
        } else if gt(&day.get("taMin"), &row.get("tmn")) && !strict_eq(&row.get("tmn"), &n50) {
            day.set("taMin", row.get("tmn"));
            row.set("tmn", -50.);
        }
        row.set("tmn", -50.);
    }
    for row in list.items() {
        if let Some(t) = precip::get(&row, "shortestRn1") {
            precip::assign(&row, "r06", Some(t));
        }
        precip::finalize(&row, "r06");
        precip::finalize(&row, "s06");
    }
    let rows = list.items();
    for (index, row) in rows.iter().enumerate() {
        let day = day_summary(&days, &row.get("date"));
        if day.get("taMax").is_undef() {
            day.set("taMax", -50.);
        }
        if day.get("taMin").is_undef() {
            day.set("taMin", -50.);
        }
        if strict_eq(&day.get("taMax"), &n50) || strict_eq(&day.get("taMin"), &n50) {
            continue;
        }
        let t3h = row.get("t3h");
        let tmx_diff = V::Num((super::js::sub(&day.get("taMax"), &t3h)).abs());
        let tmn_diff = V::Num((super::js::sub(&day.get("taMin"), &t3h)).abs());
        let at = |i: usize| list.at(i);
        let idx = |k: &str| to_number(&day.get(k)) as usize;
        if !day.has("tmxDiff") {
            day.set("tmxDiff", tmx_diff.clone());
            row.set("tmx", day.get("taMax"));
            day.set("tmxIndex", index as f64);
        } else if strict_eq(&day.get("tmxDiff"), &tmx_diff) {
            if strict_eq(&row.get("time"), &s("1500")) {
                at(idx("tmxIndex")).set("tmx", -50.);
                day.set("tmxDiff", tmx_diff.clone());
                row.set("tmx", day.get("taMax"));
                day.set("tmxIndex", index as f64);
            } else if strict_eq(&at(idx("tmxIndex")).get("time"), &s("1500")) {
            } else {
                let ti = to_number(&day.get("tmnIndex"));
                let prv = if ti > 0.
                    && gt(&at(ti as usize - 1).get("t3h"), &at(ti as usize).get("t3h"))
                {
                    at(ti as usize - 1).get("t3h")
                } else {
                    at(ti as usize).get("t3h")
                };
                let next = if index < rows.len() - 1 && gt(&at(index + 1).get("t3h"), &t3h) {
                    at(index + 1).get("t3h")
                } else {
                    t3h.clone()
                };
                if gt(&prv, &next) {
                } else {
                    at(idx("tmxIndex")).set("tmx", -50.);
                    day.set("tmxDiff", tmx_diff.clone());
                    row.set("tmx", day.get("taMax"));
                    day.set("tmxIndex", index as f64);
                }
            }
        } else if gt(&day.get("tmxDiff"), &tmx_diff) {
            at(idx("tmxIndex")).set("tmx", -50.);
            day.set("tmxDiff", tmx_diff.clone());
            row.set("tmx", day.get("taMax"));
            day.set("tmxIndex", index as f64);
        }
        if !day.has("tmnDiff") {
            day.set("tmnDiff", tmn_diff.clone());
            row.set("tmn", day.get("taMin"));
            day.set("tmnIndex", index as f64);
        } else if strict_eq(&day.get("tmnDiff"), &tmn_diff) {
            if strict_eq(&row.get("time"), &s("0600")) {
                at(idx("tmnIndex")).set("tmn", -50.);
                day.set("tmnDiff", tmn_diff.clone());
                row.set("tmn", day.get("taMin"));
                day.set("tmnIndex", index as f64);
            } else if strict_eq(&at(idx("tmnIndex")).get("time"), &s("0600")) {
            } else {
                let ti = to_number(&day.get("tmnIndex"));
                let prv = if ti > 0.
                    && lt(&at(ti as usize - 1).get("t3h"), &at(ti as usize).get("t3h"))
                {
                    at(ti as usize - 1).get("t3h")
                } else {
                    at(ti as usize).get("t3h")
                };
                let next = if index < rows.len() - 1 && lt(&at(index + 1).get("t3h"), &t3h) {
                    at(index + 1).get("t3h")
                } else {
                    t3h.clone()
                };
                if gt(&prv, &next) {
                    at(idx("tmnIndex")).set("tmn", -50.);
                    day.set("tmnDiff", tmn_diff.clone());
                    row.set("tmn", day.get("taMin"));
                    day.set("tmnIndex", index as f64);
                }
            }
        } else if gt(&day.get("tmnDiff"), &tmn_diff) {
            at(idx("tmnIndex")).set("tmn", -50.);
            day.set("tmnDiff", tmn_diff.clone());
            row.set("tmn", day.get("taMin"));
            day.set("tmnIndex", index as f64);
        }
    }
    let rows = list.items();
    let mut i = rows.len() as i64 - 1;
    while i >= 0 {
        if !strict_eq(&rows[i as usize].get("t3h"), &n50) {
            break;
        }
        i -= 1;
    }
    list.truncate((i + 1) as usize);
    Flow::Next
}
