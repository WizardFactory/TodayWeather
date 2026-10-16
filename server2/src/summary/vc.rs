//! VC summaries: one observed local day of a Visual Crossing cell from the raw Timeline bodies
//! the world family stored (S11). Only a body fetched at or after the end of the local day counts
//! (its hours are observations, not forecasts); the newest such body by `(fetchedAtMs, sha256)`
//! is used. Complete when hourly `temp` covers at least 75 % of the actual local hours of the
//! date (23, 24 or 25 under DST, from the body's IANA `timezone`). The world family requests
//! `unitGroup=us` (`world/source.rs`); values are converted to °C and mm with one decimal.
use super::{InputId, Inputs, Source, Summary, SummaryKey};
use crate::gateway::OrderedJson;
use crate::world::{Cell, RawFetch};
use chrono::{NaiveDate, TimeZone};
use serde_json::Value;

/// Seconds of the local day `date` (`YYYYMMDD`) in `zone`: (start, next start). Unknown zones
/// count 24 hours from the body's `tzoffset` (hours).
fn day_bounds(zone: Option<&str>, offset_hours: Option<f64>, date: u32) -> Option<(i64, i64)> {
    let (y, m, d) = ((date / 10000) as i32, (date / 100 % 100), (date % 100));
    let day = NaiveDate::from_ymd_opt(y, m, d)?;
    let next = day.succ_opt()?;
    if let Some(tz) = zone.and_then(|z| {
        chrono_tz::Tz::from_str_insensitive(z)
            .or_else(|_| z.parse::<chrono_tz::Tz>())
            .ok()
    }) {
        // A zone whose clocks skip midnight starts the day at the first existing hour.
        let start_of = |d: NaiveDate| {
            (0..3).find_map(|h| {
                tz.from_local_datetime(&d.and_hms_opt(h, 0, 0)?)
                    .earliest()
                    .map(|t| t.timestamp())
            })
        };
        return Some((start_of(day)?, start_of(next)?));
    }
    let offset = (offset_hours? * 3600.).round() as i64;
    let start = day.and_hms_opt(0, 0, 0)?.and_utc().timestamp() - offset;
    Some((start, start + 86_400))
}
fn celsius(f: f64) -> f64 {
    round1((f - 32.) * 5. / 9.)
}
fn round1(x: f64) -> f64 {
    let r = (x * 10.).round() / 10.;
    if r == 0. { 0. } else { r }
}
fn finite(v: Option<&Value>) -> Option<f64> {
    v?.as_f64().filter(|n| n.is_finite())
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// The VC summary of `cell` for local `date` from the fetches of the cell; None when no
/// eligible body covers the date or the day is not complete.
pub fn summary(cell: Cell, date: u32, fetches: &[RawFetch]) -> Option<Summary> {
    let label = format!(
        "{:04}-{:02}-{:02}",
        date / 10000,
        date / 100 % 100,
        date % 100
    );
    // The newest body fetched after the end of the local day, with the day's bounds.
    let mut best: Option<(&RawFetch, Value, (i64, i64))> = None;
    for f in fetches {
        let Ok(body) = serde_json::from_slice::<Value>(&f.body) else {
            continue;
        };
        let has_day = body
            .get("days")
            .and_then(Value::as_array)
            .is_some_and(|days| {
                days.iter()
                    .any(|d| d.get("datetime").and_then(Value::as_str) == Some(label.as_str()))
            });
        if !has_day {
            continue;
        }
        let Some(bounds) = day_bounds(
            body.get("timezone").and_then(Value::as_str),
            finite(body.get("tzoffset")),
            date,
        ) else {
            continue;
        };
        if (f.fetched_at_ms as i64) < bounds.1 * 1000 {
            continue;
        }
        let newer = best
            .as_ref()
            .is_none_or(|(b, _, _)| (f.fetched_at_ms, &f.sha256) > (b.fetched_at_ms, &b.sha256));
        if newer {
            best = Some((f, body, bounds));
        }
    }
    let (fetch, body, (start, next)) = best?;
    let day = body
        .get("days")?
        .as_array()?
        .iter()
        .find(|d| d.get("datetime").and_then(Value::as_str) == Some(label.as_str()))?;
    let local_hours = (next - start) / 3600;
    let mut seen = std::collections::BTreeMap::new();
    for h in day
        .get("hours")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(epoch), Some(temp)) = (
            h.get("datetimeEpoch").and_then(Value::as_i64),
            finite(h.get("temp")),
        ) else {
            continue;
        };
        if (start..next).contains(&epoch) {
            seen.entry(epoch).or_insert(temp);
        }
    }
    let temps: Vec<f64> = seen.values().copied().collect();
    if temps.is_empty() {
        return None;
    }
    let min = temps.iter().copied().fold(f64::INFINITY, f64::min);
    let max = temps.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let mean = temps.iter().sum::<f64>() / temps.len() as f64;
    let mut values = vec![
        (u("date"), OrderedJson::String(u(&format!("{date:08}")))),
        (u("taMin"), OrderedJson::Number(celsius(min))),
        (u("taMax"), OrderedJson::Number(celsius(max))),
        (u("t1d"), OrderedJson::Number(celsius(mean))),
    ];
    if let Some(precip) = finite(day.get("precip")) {
        values.push((u("rn1"), OrderedJson::Number(round1(precip * 25.4))));
    }
    values.push((
        u("observationHours"),
        OrderedJson::Number(temps.len() as f64),
    ));
    values.push((u("localHours"), OrderedJson::Number(local_hours as f64)));
    let values = OrderedJson::Object(values);
    if !super::complete(Source::Vc, &values) {
        return None;
    }
    let id = InputId {
        family: format!("vc-{}", fetch.range.as_str()),
        start_ms: start * 1000,
        end_ms: next * 1000,
        fetched_at_ms: fetch.fetched_at_ms,
        content_sha256: fetch.sha256.clone(),
    };
    Some(Summary {
        key: SummaryKey::vc(cell),
        date,
        grid: None,
        values,
        inputs: Inputs::of([&id]),
    })
}
