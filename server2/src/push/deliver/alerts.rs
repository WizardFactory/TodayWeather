//! Conditional alerts ported from `alert.push.controller.js` (parse, compare, update and text).
//! This worker does not retry delivery and never uses a legacy process as a fallback.
use super::text::{Message, Tr};
use crate::push::js::{self, Thrown, ge, greater, less, prop, strict_eq, to_string};
use crate::world::js::{Obj, Val, dot_time, js_sort, parse_dot, parts};

pub const SIX_HOURS_MS: i64 = 6 * 3_600_000;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Send {
    None,
    Weather,
    Air,
    All,
}
impl Send {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Weather => "weather",
            Self::Air => "air",
            Self::All => "all",
        }
    }
}
fn object(v: &Val) -> Result<&Obj, Thrown> {
    if let Val::Obj(o) = v {
        Ok(o)
    } else {
        Err("expected object".into())
    }
}
fn date(v: &Val) -> f64 {
    match v {
        Val::Date(ms) | Val::Num(ms) => *ms,
        Val::Null => 0.,
        Val::Bool(b) => {
            if *b {
                1.
            } else {
                0.
            }
        }
        Val::Str(s) => {
            let dot = parse_dot(s);
            if dot.is_finite() {
                return dot;
            }
            if let Some(ms) = crate::warnings::js::parse_iso(s) {
                return ms as f64;
            }
            parse_dot(&s.replace('-', "."))
        }
        _ => f64::NAN,
    }
}
fn formatted(ms: f64, dash: bool) -> String {
    let s = dot_time(ms);
    if dash { s.replace('.', "-") } else { s }
}
fn hour(v: &Val) -> Val {
    Val::Num(parts(date(v)).map_or(f64::NAN, |p| p.hour as f64))
}
fn grade_sort(list: &mut [Val]) {
    js_sort(list, |a, b| {
        let a = prop(a, "grade").unwrap_or(Val::Undef);
        let b = prop(b, "grade").unwrap_or(Val::Undef);
        if greater(&a, &b) {
            -1
        } else if less(&a, &b) {
            1
        } else {
            0
        }
    });
}

/// Legacy parser. Air forecasts are computed only at :35/:50 and then discarded as legacy
/// does; they cannot cause conditional delivery.
#[allow(clippy::collapsible_if)] // Keep the legacy parser branch order visible.
pub fn parse(record: &Obj, body: &Val, minute: u32, now_ms: i64) -> Result<Val, Thrown> {
    let data = object(body)?;
    let source = data.get("source");
    let mut current = match source {
        Val::Str(s) if s == "KMA" => data.get("current").clone(),
        Val::Str(s) if s == "VC" || s == "DSF" => {
            let publication = if data.get("pubDate").truthy() {
                let pubdate = data.get("pubDate");
                let vc = prop(pubdate, "VC")?;
                if vc.truthy() {
                    vc
                } else {
                    prop(pubdate, "DSF")?
                }
            } else {
                Val::Undef
            };
            if publication.truthy() && now_ms as f64 - date(&publication) > 1_800_000. {
                return Err("stale overseas weather".into());
            }
            prop(data.get("thisTime"), "1")?
        }
        _ => return Err("unknown source".into()),
    };
    if current.is_nullish() {
        return Err("data current is undefined".into());
    }
    if matches!(source,Val::Str(s) if s=="VC"||s=="DSF")
        && greater(&prop(&current, "pty")?, &Val::Num(0.))
    {
        if let Val::Obj(o) = &mut current {
            o.set("rns", true);
        }
    }
    let mut info = Obj::new();
    let mut name = data.get("name").clone();
    if name.is_nullish() {
        for field in ["townName", "cityName"] {
            let v = data.get(field);
            if v.truthy() && greater(&prop(v, "length")?, &Val::Num(0.)) {
                name = v.clone();
                break;
            }
        }
    }
    info.set("name", name);
    let mut weather = Obj::new();
    let pty = prop(&current, "pty")?;
    weather.set(
        "pty",
        if pty.truthy() {
            pty.clone()
        } else {
            Val::Num(0.)
        },
    );
    let rns = prop(&current, "rns")?;
    weather.set("rns", if rns.truthy() { rns } else { Val::Bool(false) });
    weather.set("desc", prop(&current, "weather")?);
    let current_o = object(&current)?;
    if current_o.has("rnsStnName") {
        weather.set("stnName", current_o.get("rnsStnName").clone());
    } else if current_o.has("stnName") {
        weather.set("stnName", current_o.get("stnName").clone());
    }
    if current_o.has("dateObj") {
        weather.set("dateObj", current_o.get("dateObj").clone());
    }
    let now = date(weather.get("dateObj"));
    let next = now + 3_600_000.;
    // Date#setHours retains minutes, but kmaTimeLib formats the hour with :00.
    let next_hour = next - next.rem_euclid(3_600_000.);
    let str_next = formatted(next_hour, false);
    if strict_eq(&pty, &Val::Num(0.)) && minute < 30 {
        if data.has("shortest") {
            let Val::Arr(rows) = data.get("shortest") else {
                return Err("shortest.findIndex is not a function".into());
            };
            let mut index = None;
            for (i, row) in rows.iter().enumerate() {
                // Array#findIndex stops at the first match and propagates an accessor
                // exception before it. A null row must not unlock a later wet fallback.
                if date(&prop(row, "dateObj")?) == date(&Val::Str(str_next.clone())) {
                    index = Some(i);
                    break;
                }
            }
            if let Some(i) = index {
                let mut forecast = Obj::new();
                forecast.set("pty", 0.);
                forecast.set("pubDate", data.get("shortestPubDate").clone());
                if greater(&prop(&rows[i], "pty")?, &Val::Num(0.))
                    && rows
                        .get(i + 1)
                        .is_some_and(|v| prop(v, "pty").is_ok_and(|p| greater(&p, &Val::Num(0.))))
                {
                    for (k, v) in object(&rows[i])?.entries() {
                        forecast.set(k, v.clone());
                    }
                }
                weather.set("forecast", Val::Obj(forecast));
            }
        }
        if !weather.has("forecast") {
            let str_short = formatted(next_hour + 3. * 3_600_000., false);
            for (field, pubfield) in [("short", Some("shortPubDate")), ("hourly", None)] {
                if data.has(field) {
                    let Val::Arr(rows) = data.get(field) else {
                        return Err("forecast.find is not a function".into());
                    };
                    let mut matched = None;
                    for row in rows {
                        if strict_eq(&prop(row, "dateObj")?, &Val::Str(str_short.clone())) {
                            matched = Some(row);
                            break;
                        }
                    }
                    if let Some(row) = matched {
                        let mut forecast = object(row)?.clone();
                        if let Some(key) = pubfield {
                            forecast.set("pubDate", data.get(key).clone());
                        }
                        weather.set("forecast", Val::Obj(forecast));
                    }
                }
            }
        }
    }
    info.set("weather", Val::Obj(weather));
    let mut air = Obj::new();
    if !data.has("airInfo") {
        info.set("air", Val::Obj(air));
        return Ok(Val::Obj(info));
    }
    let air_info = data.get("airInfo");
    let last = prop(air_info, "last")?;
    if last.is_nullish() {
        info.set("air", Val::Obj(air));
        return Ok(Val::Obj(info));
    }
    let mut list = Vec::new();
    for pollutant in ["pm10", "pm25", "o3", "no2", "co", "so2"] {
        let grade = prop(&last, &format!("{pollutant}Grade"))?;
        if grade.truthy() {
            let mut o = Obj::new();
            o.set("name", pollutant);
            o.set("grade", grade);
            o.set("value", prop(&last, &format!("{pollutant}Value"))?);
            list.push(Val::Obj(o));
        }
    }
    if !list.is_empty() {
        grade_sort(&mut list);
        let top = object(&list[0])?;
        if top.get("grade").truthy() {
            air.set("name", top.get("name").clone());
            air.set("grade", top.get("grade").clone());
            air.set("value", top.get("value").clone());
            air.set(
                "str",
                prop(&last, &format!("{}Str", to_string(top.get("name"))))?,
            );
            air.set("stationName", prop(&last, "stationName")?);
        }
        air.set("dataTime", prop(&last, "dataTime")?);
    }
    if (!air.has("grade") || less(air.get("grade"), record.get("airAlertsBreakPoint")))
        && minute > 30
    {
        let ai = object(air_info)?;
        if ai.has("pollutants") {
            let pollutants = object(ai.get("pollutants"))?;
            let mut forecasts = Vec::new();
            for (key, value) in pollutants.entries() {
                let p = object(value)?;
                if p.has("hourly") {
                    let Val::Arr(rows) = p.get("hourly") else {
                        return Err("hourly.filter is not a function".into());
                    };
                    // Legacy runs filter over the entire original array before find.
                    // Even a null after a matching hour aborts the whole evaluation, which
                    // can suppress a precipitation notification as well as an air one.
                    let mut hourly = Vec::new();
                    for row in rows {
                        if greater(&prop(row, "date")?, &Val::Str(formatted(now, true))) {
                            hourly.push(row);
                        }
                    }
                    for row in hourly {
                        if strict_eq(&prop(row, "date")?, &Val::Str(formatted(next_hour, true))) {
                            let mut o = object(row)?.clone();
                            o.set("name", key.as_str());
                            forecasts.push(Val::Obj(o));
                            break;
                        }
                    }
                }
            }
            grade_sort(&mut forecasts);
            // Legacy attaches then deletes air.forecast unconditionally. Still traversed above
            // to preserve exceptions and comparator behavior for malformed inputs.
        }
    }
    info.set("air", Val::Obj(air));
    Ok(Val::Obj(info))
}

/// The per-category six-hour transition gate; the selection prefilter separately checks either
/// category's recent push before requesting weather.
#[allow(clippy::collapsible_if)] // Separate cooldown, transition and trigger gates.
pub fn compare(record: &Obj, info: &Val, now_ms: i64) -> Result<Send, Thrown> {
    let info = object(info)?;
    let cutoff = Val::Date((now_ms - SIX_HOURS_MS) as f64);
    let mut send = Send::None;
    let precip = if record.get("precipAlerts").truthy() {
        record.get("precipAlerts").clone()
    } else {
        Val::Obj(Obj::new())
    };
    let state = object(&precip)?;
    if !state.has("pushTime") || less(state.get("pushTime"), &cutoff) {
        if let Val::Obj(weather) = info.get("weather") {
            if strict_eq(state.get("lastState"), &Val::Num(0.))
                || state.get("lastState").is_nullish()
            {
                if (greater(weather.get("pty"), &Val::Num(0.)) && weather.get("rns").truthy())
                    || (weather.has("forecast")
                        && greater(&prop(weather.get("forecast"), "pty")?, &Val::Num(0.)))
                {
                    send = Send::Weather;
                }
            }
        }
    }
    let air_state = if record.get("airAlerts").truthy() {
        record.get("airAlerts").clone()
    } else {
        Val::Obj(Obj::new())
    };
    let state = object(&air_state)?;
    if !state.has("pushTime") || less(state.get("pushTime"), &cutoff) {
        if let Val::Obj(air) = info.get("air") {
            if less(state.get("lastGrade"), record.get("airAlertsBreakPoint"))
                || state.get("lastGrade").is_nullish()
            {
                if ge(air.get("grade"), record.get("airAlertsBreakPoint"))
                    || (air.has("forecast")
                        && ge(
                            &prop(air.get("forecast"), "grade")?,
                            record.get("airAlertsBreakPoint"),
                        ))
                {
                    send = if send == Send::Weather {
                        Send::All
                    } else {
                        Send::Air
                    };
                }
            }
        }
    }
    Ok(send)
}
/// `_updateAlertPush`: state changes even when no notification is needed; send timestamps
/// precede provider submission and therefore also survive failed and unknown outcomes.
pub fn update(record: &mut Obj, info: &Val, send: Send, now_ms: i64) -> Result<(), Thrown> {
    let info = object(info)?;
    if let Val::Obj(weather) = info.get("weather") {
        let mut state = if record.has("precipAlerts") {
            object(record.get("precipAlerts"))?.clone()
        } else {
            Obj::new()
        };
        if weather.has("pty") {
            let pty = if strict_eq(weather.get("pty"), &Val::Num(0.))
                && weather.has("forecast")
                && greater(&prop(weather.get("forecast"), "pty")?, &Val::Num(0.))
            {
                prop(weather.get("forecast"), "pty")?
            } else {
                weather.get("pty").clone()
            };
            state.set("lastState", pty);
        }
        record.set("precipAlerts", Val::Obj(state));
    }
    if let Val::Obj(air) = info.get("air") {
        let mut state = if record.has("airAlerts") {
            object(record.get("airAlerts"))?.clone()
        } else {
            Obj::new()
        };
        if air.has("grade") {
            let use_forecast = less(air.get("grade"), record.get("airAlertsBreakPoint"))
                && air.has("forecast")
                && ge(
                    &prop(air.get("forecast"), "grade")?,
                    record.get("airAlertsBreakPoint"),
                );
            let (grade, name) = if use_forecast {
                (
                    prop(air.get("forecast"), "grade")?,
                    prop(air.get("forecast"), "name")?,
                )
            } else {
                (air.get("grade").clone(), air.get("name").clone())
            };
            state.set("lastGrade", grade);
            state.set("lastCode", name);
        }
        record.set("airAlerts", Val::Obj(state));
    }
    for (key, needed) in [
        ("precipAlerts", send == Send::Weather || send == Send::All),
        ("airAlerts", send == Send::Air || send == Send::All),
    ] {
        if needed {
            let mut o = object(record.get(key))?.clone();
            o.set("pushTime", Val::Date(now_ms as f64));
            record.set(key, Val::Obj(o));
        }
    }
    Ok(())
}
fn sprintf(fmt: &str, args: &[Val]) -> String {
    let mut out = String::new();
    let mut chars = fmt.chars();
    let mut index = 0;
    while let Some(ch) = chars.next() {
        if ch == '%' {
            if let Some(spec) = chars.next() {
                if spec == '%' {
                    out.push('%');
                } else {
                    let v = args.get(index).unwrap_or(&Val::Undef);
                    index += 1;
                    out.push_str(&if spec == 'd' {
                        to_string(&Val::Num(js::number(v).trunc()))
                    } else {
                        to_string(v)
                    });
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}
fn pollutant(name: &Val) -> &'static str {
    match name.str().unwrap_or("") {
        "pm10" => "LOC_PM10",
        "pm25" => "LOC_PM25",
        "o3" => "LOC_O3",
        "no2" => "LOC_NO2",
        "co" => "LOC_CO",
        "so2" => "LOC_SO2",
        "aqi" => "LOC_AQI",
        _ => "undefined",
    }
}
/// `_convertToNotification` independently of the selected category, as legacy (a precipitation
/// state can be included in an air-triggered notification).
pub fn message(record: &Obj, info: &Val) -> Result<Message, Thrown> {
    let info = object(info)?;
    if record.get("lang").is_nullish() {
        return Err("invalid locale".into());
    }
    let tr = Tr::for_lang(record.get("lang"));
    let city = if record.get("name").truthy() {
        record.get("name")
    } else if info.get("name").truthy() {
        info.get("name")
    } else {
        &Val::Undef
    };
    let mut title = format!(
        "{} ",
        if city.is_nullish() {
            String::new()
        } else {
            to_string(city)
        }
    );
    let mut text = String::new();
    let mut has_weather = false;
    if let Val::Obj(weather) = info.get("weather") {
        if greater(weather.get("pty"), &Val::Num(0.)) {
            let Val::Str(date) = weather.get("dateObj") else {
                return Err("dateObj.substr is not a function".into());
            };
            title.push_str(&date.chars().skip(11).take(5).collect::<String>());
            let key = match weather.get("pty") {
                Val::Num(1.) => Some("LOC_IT_IS_RAINING"),
                Val::Num(2.) => Some("LOC_IT_IS_SLEETING"),
                Val::Num(3.) => Some("LOC_IT_IS_SNOWING"),
                _ => None,
            };
            if let Some(k) = key {
                text.push_str(&tr.tr(k))
            }
            has_weather = true;
        } else if weather.get("forecast").truthy()
            && greater(&prop(weather.get("forecast"), "pty")?, &Val::Num(0.))
        {
            let f = weather.get("forecast");
            title.push_str(&tr.tr("LOC_FORECAST"));
            let key = match prop(f, "pty")? {
                Val::Num(1.) => "LOC_IT_WILL_BE_RAINY_FROM_H",
                Val::Num(2.) => "LOC_IT_WILL_BE_SLEETING_FROM_H",
                Val::Num(3.) => "LOC_IT_WILL_BE_SNOWY_FROM_H",
                _ => return Err("undefined sprintf format".into()),
            };
            text.push_str(&sprintf(&tr.tr(key), &[hour(&prop(f, "dateObj")?)]));
            has_weather = true;
        }
    }
    if let Val::Obj(air) = info.get("air") {
        if ge(air.get("grade"), record.get("airAlertsBreakPoint")) {
            if has_weather {
                text.push(' ');
            } else {
                title.push_str(&tr.tr("LOC_AIR_INFORMATION"));
                title.push(' ');
            }
            let name = tr.tr(pollutant(air.get("name")));
            let mut fmt = tr.tr("LOC_H_POLLUTANT_IS_GRADE");
            if name.contains("오존") {
                fmt = fmt.replacen('가', "이", 1);
            }
            let value = if air.get("str").truthy() {
                air.get("str")
            } else {
                air.get("value")
            };
            text.push_str(&sprintf(
                &fmt,
                &[hour(air.get("dataTime")), Val::Str(name), value.clone()],
            ));
        } else if air.has("forecast")
            && ge(
                &prop(air.get("forecast"), "grade")?,
                record.get("airAlertsBreakPoint"),
            )
        {
            let Val::Str(lang) = record.get("lang") else {
                return Err("lang.indexOf is not a function".into());
            };
            let label = if lang.contains("ko") {
                format!("대기{}", tr.tr("LOC_FORECAST"))
            } else {
                format!("{} {}", tr.tr("LOC_AQI"), tr.tr("LOC_FORECAST"))
            };
            if has_weather {
                text.push_str(&format!(" {label} "));
            } else {
                title.push_str(&label);
            }
            let f = air.get("forecast");
            let name = tr.tr(pollutant(&prop(f, "name")?));
            let mut fmt = tr.tr("LOC_POLLUTANT_IS_EXPECTED_TO_BE_AT_GRADE_FROM_H");
            if name.contains("오존") {
                fmt = fmt.replacen('가', "이", 1);
            }
            text.push_str(&sprintf(
                &fmt,
                &[hour(&prop(f, "date")?), Val::Str(name), prop(f, "str")?],
            ));
        }
    }
    Ok(Message {
        title: Val::Str(title),
        text: Val::Str(text),
    })
}

/// Database prefilter: explicitly enabled, inclusive day/overnight window, either category's
/// previous send at or after now−6h excludes the entire record.
pub fn eligible(record: &Obj, time_seconds: f64, now_ms: i64) -> bool {
    if record.get("enable") != &Val::Bool(true) {
        return false;
    }
    let time = Val::Num(time_seconds);
    let after_start = ge(&time, record.get("startTime"));
    let before_end = js::le(&time, record.get("endTime"));
    let within = match record.get("reverseTime") {
        Val::Bool(false) => after_start && before_end,
        Val::Bool(true) => after_start || before_end,
        _ => false,
    };
    within
        && ["precipAlerts", "airAlerts"].iter().all(|key| {
            !prop(record.get(key), "pushTime")
                .is_ok_and(|v| ge(&v, &Val::Date((now_ms - SIX_HOURS_MS) as f64)))
        })
}

use super::{
    Delivery, Diagnostics, Event, MinuteReport,
    alarm::{CONCURRENCY, fcm_body, futures_join},
    fcm::{Fcm, Product, SendOutcome},
    ledger::{Claim, Ledger, Written},
    weather::{self, Fetch, Servers},
};
use crate::{
    budget::Clock,
    push::{
        service::{InternalOp, PushService},
        store::{Coll, oid_hex},
    },
    storage::CatalogTransport,
};
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Each UTC :07/:17/:35/:50 cycle is claimed before fetching or sending. Alert state is
/// committed before submission. A claimed cycle is never re-sent, even if its result is lost.
pub struct AlertWorker<T> {
    push: Arc<PushService>,
    ledger: Ledger<T>,
    fetch: Arc<dyn Fetch>,
    fcm: Arc<Fcm>,
    servers: Servers,
    clock: Arc<dyn Clock>,
    diagnostics: Arc<dyn Diagnostics>,
}
impl<T: CatalogTransport + std::marker::Send + Sync + 'static> AlertWorker<T> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        push: Arc<PushService>,
        transport: Arc<T>,
        fetch: Arc<dyn Fetch>,
        fcm: Arc<Fcm>,
        servers: Servers,
        clock: Arc<dyn Clock>,
        diagnostics: Arc<dyn Diagnostics>,
    ) -> Self {
        Self {
            push,
            ledger: Ledger::new(transport, std::time::Duration::from_secs(4)),
            fetch,
            fcm,
            servers,
            clock,
            diagnostics,
        }
    }
    async fn send(
        &self,
        n: u64,
        oid: crate::push::store::Oid,
        info: &Obj,
        selected: &Obj,
        notification: &Message,
        now: i64,
    ) -> Delivery {
        let token = info.get("fcmToken");
        if token.truthy() {
            let Val::Str(token) = token else {
                return Delivery::Failed {
                    class: "invalid-token",
                };
            };
            match self
                .fcm
                .send_guarded(
                    Product::of(info.get("package")),
                    self.clock.now_ms().unwrap_or(now),
                    || async {
                        if !self
                            .push
                            .internal(InternalOp::CheckAlertSelection {
                                n,
                                oid,
                                selected: selected.clone(),
                            })
                            .await
                        {
                            return None;
                        }
                        let at = self.clock.now_ms().ok()?;
                        if at.div_euclid(60_000) != now.div_euclid(60_000)
                            || !inside_window(info, at)
                        {
                            return None;
                        }
                        Some(fcm_body(notification, info))
                    },
                )
                .await
            {
                SendOutcome::Accepted => Delivery::Accepted,
                SendOutcome::Unregistered { status } => Delivery::Unregistered {
                    status,
                    disabled: self
                        .push
                        .internal(InternalOp::DisableAlertsByFcm {
                            token: token.clone(),
                        })
                        .await,
                },
                SendOutcome::Rejected { status, code } => Delivery::Rejected { status, code },
                SendOutcome::Unknown { reason } => Delivery::Unknown { reason },
                SendOutcome::NotSent { reason } => Delivery::Failed {
                    class: match reason {
                        "credentials" => "fcm-credentials",
                        "oauth" => "fcm-oauth",
                        "shutdown" => "shutdown-before-post",
                        "guard" => "alert-admission",
                        _ => "fcm-connect",
                    },
                },
            }
        } else {
            Delivery::Failed {
                class: match info.get("type").str() {
                    Some("ios") => "ios-without-fcm-token",
                    Some("android") if info.get("registrationId").truthy() => "gcm-retired",
                    Some("android") => "gcm-without-registration-id",
                    _ => "unknown-type",
                },
            }
        }
    }
    pub async fn run_minute(&self, now_ms: i64) -> MinuteReport {
        let minute_ms = now_ms - now_ms.rem_euclid(60_000);
        let minute = (minute_ms / 60_000).rem_euclid(60) as u32;
        if ![7, 17, 35, 50].contains(&minute) {
            return MinuteReport::default();
        }
        // run_minute remains a directly testable legacy selection API. Admission age uses
        // the actual clock at entry; the supervisor separately rejects a stale queued tick.
        let admission_ms = self.clock.now_ms().unwrap_or(now_ms);
        let at = crate::world::js::iso(minute_ms as f64).unwrap_or_default();
        if !self.push.ready() {
            self.diagnostics
                .minute(&at, "alert state not ready; nothing sent");
            return MinuteReport::default();
        }
        self.push.internal(InternalOp::RemoveDuplicateAlerts).await;
        let due = {
            let state = self.push.state();
            let state = state.read().unwrap_or_else(|e| e.into_inner());
            state
                .coll(Coll::Alert)
                .iter()
                .filter(|(_, r)| {
                    eligible(
                        &r.doc,
                        (minute_ms.rem_euclid(86_400_000) / 1000) as f64,
                        now_ms,
                    )
                })
                .collect::<Vec<_>>()
        };
        if due.is_empty() {
            return MinuteReport::default();
        }
        let ids = due.iter().map(|(_, r)| oid_hex(&r.oid)).collect::<Vec<_>>();
        match self.ledger.claim("alert", minute_ms, now_ms, &ids).await {
            Claim::Owned => (),
            Claim::Taken => {
                self.diagnostics
                    .minute(&at, "alert cycle already claimed; nothing sent");
                return MinuteReport::default();
            }
            Claim::Unavailable => {
                self.diagnostics
                    .minute(&at, "alert ledger unavailable; nothing sent");
                return MinuteReport::default();
            }
        }
        let gate = Arc::new(Semaphore::new(CONCURRENCY));
        let mut tasks = Vec::new();
        for (n, record) in due {
            let gate = gate.clone();
            tasks.push(async move {
                let _permit = gate.acquire_owned().await.expect("open gate");
                let mut info = record.doc.clone();
                let result = async {
                    let body = weather::conditional(&mut info, &self.servers, &*self.fetch)
                        .await
                        .map_err(|_| "weather-request")?;
                    let evaluated_ms = self.clock.now_ms().unwrap_or(now_ms);
                    let parsed = parse(&info, &body, minute, evaluated_ms).map_err(|_| "parse")?;
                    let send = compare(&info, &parsed, evaluated_ms).map_err(|_| "compare")?;
                    update(&mut info, &parsed, send, evaluated_ms).map_err(|_| "update")?;
                    // The selected document is checked in the single writer, so a concurrent
                    // app update, token rotation or another cycle is never overwritten.
                    if !self
                        .push
                        .internal(InternalOp::UpdateAlertState {
                            n,
                            oid: record.oid,
                            selected: record.doc.clone(),
                            precip: info.get("precipAlerts").clone(),
                            air: info.get("airAlerts").clone(),
                        })
                        .await
                    {
                        return Err("state-not-committed");
                    }
                    if send == Send::None {
                        return Ok(None);
                    }
                    let notification = message(&info, &parsed).map_err(|_| "message")?;
                    let mut selected = record.doc.clone();
                    let mut fields = Obj::new();
                    fields.set("precipAlerts", info.get("precipAlerts").clone());
                    fields.set("airAlerts", info.get("airAlerts").clone());
                    let set = crate::push::mongoose::cast_set(Coll::Alert, &fields, false)
                        .map_err(|_| "state-cast")?;
                    crate::push::mongoose::apply_set(&mut selected, &set);
                    Ok(Some(
                        self.send(n, record.oid, &info, &selected, &notification, admission_ms)
                            .await,
                    ))
                }
                .await;
                (record.oid, result)
            });
        }
        let mut report = MinuteReport {
            claimed: true,
            deliveries: Vec::new(),
        };
        let mut rows = Vec::new();
        for (oid, result) in futures_join(tasks).await {
            let (outcome, class, status) = match result {
                Ok(Some(d)) => (d.outcome(), d.class(), d.status()),
                Ok(None) => ("not-needed", "unchanged".into(), None),
                Err(class) => ("failed", class.into(), None),
            };
            let id = oid_hex(&oid);
            let event = Event {
                kind: "alert",
                minute: at.clone(),
                id: id.clone(),
                outcome,
                class: class.clone(),
                status,
            };
            self.diagnostics.delivery(&event);
            rows.push(
                serde_json::json!({"_id":id,"outcome":outcome,"class":class,"status":status}),
            );
            report.deliveries.push((id, outcome.into(), class));
        }
        if self
            .ledger
            .result(
                "alert",
                minute_ms,
                &serde_json::json!({"schema":1,"kind":"alert","minute":at,"deliveries":rows}),
            )
            .await
            != Written::Recorded
        {
            self.diagnostics
                .minute(&at, "alert result unrecorded; claim kept, nothing resent");
        }
        // `removeOldAlerts` queries legacy's misspelled updateAt (not a schema field): it removes
        // nothing. Do not introduce a new deletion policy during the port.
        report
    }
    /// Boundary scheduler, no catch-up after downtime and no retry of a claimed cycle.
    pub async fn run(self: Arc<Self>) {
        let mut jobs = tokio::task::JoinSet::new();
        loop {
            while jobs.try_join_next().is_some() {}
            let Ok(now) = self.clock.now_ms() else {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            };
            let next = now - now.rem_euclid(60_000) + 60_000;
            tokio::time::sleep(std::time::Duration::from_millis((next - now) as u64)).await;
            // A suspended process or clock jump can wake well after `next`. Evaluate the
            // observed minute only; never catch up an old conditional cycle.
            let Ok(observed) = self.clock.now_ms() else {
                continue;
            };
            let worker = self.clone();
            jobs.spawn(async move {
                worker.run_minute(observed).await;
            });
        }
    }
}

fn inside_window(info: &Obj, now: i64) -> bool {
    let time = Val::Num((now.rem_euclid(86_400_000) / 1000) as f64);
    match info.get("reverseTime") {
        Val::Bool(false) => ge(&time, info.get("startTime")) && js::le(&time, info.get("endTime")),
        Val::Bool(true) => ge(&time, info.get("startTime")) || js::le(&time, info.get("endTime")),
        _ => false,
    }
}
