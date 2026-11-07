//! The short publications the rows the client will show as current need (#2614 review
//! RP-lagging-current-publication). `convertUnits` marks `currentIndex` from the observation's
//! time, so a lagging observation marks a row the clock counts as past; the ASOS-primary wipe
//! keeps that row's forecast, and the source must read or acquire the publication covering it.
use super::observe::Folded;
use super::{Doc, Val, stn};
use crate::domestic::kma::js::{V, catch, obj, strict_eq};
use crate::domestic::kma::{policy, present, time};
use crate::domestic::publication::Publication;
use crate::history::schedule;

/// `(date, HH00)` of the KST wall clock `tz` hours after UTC (`_getCurrentTimeValue(tz)`).
fn hour_value(now: f64, tz: f64) -> (String, String) {
    let t = time::world_time(now, tz);
    (t[..8].to_owned(), format!("{}00", &t[8..10]))
}
/// The station minute's time that `getKmaStnMinuteWeather` copies to the current
/// (`stnDateTime`), unless the station answers nothing or all-zero readings. When present it alone
/// decides the current's `dateObj`.
pub(super) fn station_time(
    stations: Option<&Folded>,
    town: &Doc,
    now: f64,
    observed: bool,
) -> Option<String> {
    let empty = Folded::default();
    let f = stations.unwrap_or(&empty);
    let clock = V::Date(now + 9. * time::HOUR);
    let date_time = format!("{}{}", time::yyyymmdd(&clock), time::hhmm(&clock));
    let town_json: serde_json::Value =
        serde_json::from_slice(&town.json().to_bytes()).unwrap_or_default();
    let reading = stn::Stations {
        registry: &f.registry,
        hourly: &f.hourly,
        minute: &f.minute,
        representative: observed,
    }
    .hourly_and_min_rns(&town_json, &date_time)
    .ok()?;
    let zero = |k: &str| reading.get(k) == Some(&Val::Num(0.));
    if zero("t1h") && zero("vec") && zero("wsd") {
        return None;
    }
    match reading.get("stnDateTime") {
        Some(Val::Str(at)) => Some(at.clone()),
        _ => None,
    }
}
/// The current object as the chain hands it to `convertUnits`, reduced to what decides its
/// `dateObj`. `getCurrent` takes the newest current document when it is the clock's hour or later
/// than the hour three hours before; otherwise the current is the clock's hour (`_makeCurrent`, or
/// the default `getKmaStnMinuteWeather` sets). That step then copies the station's time
/// ([`station_time`]), and `convert0Hto24H` writes a `0000` time as the previous day's `2400`.
fn current_observation(newest: Option<&Doc>, station: Option<&str>, now: f64) -> V {
    let (nd, nt) = hour_value(now, 9.);
    let latest = newest
        .and_then(|d| d.get("currentData"))
        .and_then(Val::as_doc)
        .and_then(|d| {
            let text = |k: &str| d.get(k).and_then(Val::as_str).map(str::to_owned);
            Some((text("date")?, text("time")?))
        });
    let (date, hour) = match latest {
        Some((d, t)) if d == nd && t == nt => (d, t),
        Some((d, t)) => {
            let (ad, at) = hour_value(now, 6.);
            let accepted = policy::instant(&V::from(format!("{ad}{at}")));
            if accepted < policy::instant(&V::from(format!("{d}{t}"))) {
                (d, t)
            } else {
                (nd, nt)
            }
        }
        None => (nd, nt),
    };
    let current_row = V::Obj(obj(vec![("date", V::from(date)), ("time", V::from(hour))]));
    if let Some(at) = station {
        current_row.set("stnDateTime", V::from(at.to_owned()));
    }
    if strict_eq(&current_row.get("time"), &V::from("0000")) {
        time::convert_0h_to_24h(&current_row);
    }
    current_row
}
/// The short publications covering the rows `convertUnits` will mark `currentIndex` that the
/// latest publication does not cover, newest first, from the newest current document and the
/// station's time. The observation is never older than three hours, so only the clock-current slot
/// and the one before it can be marked; the rule is `present::marked_current` over the same row
/// labels (`0000` as the previous day's `2400`).
pub(super) fn publications(
    newest: Option<&Doc>,
    station: Option<&str>,
    now: f64,
) -> Vec<Publication> {
    let Some(latest) = schedule::Family::Short.latest(now as i64) else {
        return Vec::new();
    };
    let observation = current_observation(newest, station, now);
    // `convertUnits` marks nothing when this throws (a station time that is not text).
    let Ok(current_date) = catch(|| present::current_date_obj(&observation)) else {
        return Vec::new();
    };
    let clock = schedule::from_ms(now as i64);
    let Some(slot) = Publication::new(clock.date(), (clock.hour() - clock.hour() % 3) * 100) else {
        return Vec::new();
    };
    let labels: Vec<Publication> = [-3, 0, 3]
        .into_iter()
        .filter_map(|h| slot.add_hours(h))
        .collect();
    let rows: Vec<V> = labels
        .iter()
        .map(|p| {
            let row = V::Obj(obj(vec![
                ("date", V::from(p.base_date())),
                ("time", V::from(p.base_time())),
            ]));
            if p.time() == 0 {
                time::convert_0h_to_24h(&row);
            }
            row
        })
        .collect();
    let mut out = Vec::new();
    for (i, label) in labels.iter().enumerate().take(rows.len().saturating_sub(1)) {
        let shown = present::marked_current(
            &present::row_date_obj(&rows[i]),
            rows.get(i + 1),
            &current_date,
        );
        if shown
            && latest.add_hours(1).is_some_and(|first| first > *label)
            && let Some(covering) = label.add_hours(-1)
        {
            out.push(covering);
        }
    }
    out.reverse();
    out
}
