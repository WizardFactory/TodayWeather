//! The grid nowcast for hours whose precipitation the ASOS rules leave unknown (`nowcast-fill-v1`
//! of `server2/config/contracts/kma-history.v1.json`, AK 2026-11-08). Under ASOS-primary the
//! completed days come from ASOS, which leaves some hours without a type or an amount: a QC9
//! blank, an uncoded amount below the wet-bulb cutoff, a winter hour between the three-hour
//! marks, or a day not yet released. Production reads the grid nowcast (`getUltraSrtNcst`) for
//! every hour, and the API serves the last 23 hours, so those hours of a cell read the stored
//! nowcast or acquire it, once per cell and base time.
use crate::domestic::kma::js::V;
use crate::domestic::kma::policy;
use crate::domestic::publication::{self, Publication};
use crate::gateway::OrderedJson;
use crate::history::schedule;

/// An ASOS answer still loading, or whose station state failed to load, tells nothing about an
/// hour yet; a later answer decides.
fn decided(history: &OrderedJson) -> bool {
    !matches!(
        history
            .get("reason")
            .and_then(OrderedJson::string)
            .as_deref(),
        Some("cache-read-timeout" | "cache-read-failed")
    )
}
/// The ASOS hourly record of KST hour `key` (`YYYYMMDDHHMM`).
fn record<'a>(hourly: &'a [OrderedJson], key: &str) -> Option<&'a OrderedJson> {
    hourly.iter().find(|r| {
        r.get("key").and_then(OrderedJson::string).as_deref() == Some(key)
            && r.get("source").and_then(OrderedJson::string).as_deref() == Some("KMA_ASOS")
    })
}
/// A measured or rule-derived value of `field` in the record.
fn known(record: Option<&OrderedJson>, field: &str) -> bool {
    record.is_some_and(|r| {
        ["values", "inferred"].iter().any(|part| {
            r.get(part)
                .and_then(|values| values.get(field))
                .and_then(OrderedJson::number)
                .is_some_and(|n| policy::valid(field, &V::Num(n)))
        })
    })
}
/// The ASOS key of hour `p`, and of the mark ending its three-hour slot (a winter amount is the
/// three-hour quantity reported at the mark).
fn keys(p: Publication) -> Option<(String, String)> {
    let key = |p: Publication| format!("{}{:02}00", p.base_date(), p.hour());
    let to_mark = (3 - p.hour() % 3) % 3;
    Some((key(p), key(p.add_hours(i64::from(to_mark))?)))
}
/// The nowcast base times before today, within the last 23 hours the API serves, whose
/// precipitation type or amount the ASOS rules leave unknown, newest first. Today's hours are
/// required anyway (`required::foreground`).
pub(super) fn unknown_hours(history: &OrderedJson, now: f64) -> Vec<Publication> {
    if !decided(history) {
        return Vec::new();
    }
    let Some(bases) = publication::past_current_bases(now as i64) else {
        return Vec::new();
    };
    let today = schedule::from_ms(now as i64).date();
    let hourly = match history.get("hourly") {
        Some(OrderedJson::Array(records)) => &records[..],
        _ => &[],
    };
    bases
        .into_iter()
        .filter(|p| p.date() < today)
        .filter(|p| {
            let Some((hour, mark)) = keys(*p) else {
                return false;
            };
            let at = record(hourly, &hour);
            let typed = known(at, "pty");
            let amount = known(at, "rn1") || known(record(hourly, &mark), "rn3h");
            !(typed && amount)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(date: u32, time: u16) -> Publication {
        Publication::new(date, time).unwrap()
    }
    fn kst(date: u32, time: u16) -> f64 {
        schedule::to_ms(p(date, time)) as f64
    }
    /// ASOS hourly records of 2026-11-06 with `values` for each hour.
    fn history(values: impl Fn(u16) -> Option<serde_json::Value>) -> OrderedJson {
        let hourly: Vec<_> = (0..24)
            .filter_map(|h| {
                values(h).map(|v| {
                    serde_json::json!({"source":"KMA_ASOS","kind":"hourly","timeBasis":"UTC",
                        "stationId":"108","key":format!("20261106{h:02}00"),"values":v})
                })
            })
            .collect();
        OrderedJson::from_serde(&serde_json::json!({"hourly": hourly})).unwrap()
    }
    fn dry(_: u16) -> Option<serde_json::Value> {
        Some(serde_json::json!({"pty":0,"rn1":0}))
    }
    /// At 2026-11-07 10:50 the nowcast reaches back to 2026-11-06 12:00.
    const NOW: (u32, u16) = (20261107, 1050);

    #[test]
    fn known_hours_and_hours_beyond_the_reach_ask_for_nothing() {
        let now = kst(NOW.0, NOW.1);
        assert!(unknown_hours(&history(dry), now).is_empty());
        let unknown_early = history(|h| (h >= 12).then(|| serde_json::json!({"pty":0,"rn1":0})));
        assert!(
            unknown_hours(&unknown_early, now).is_empty(),
            "hours before 12:00 are older than 23 h"
        );
    }

    #[test]
    fn an_unknown_type_or_amount_asks_for_its_nowcast() {
        let now = kst(NOW.0, NOW.1);
        let partial = history(|h| match h {
            20 => Some(serde_json::json!({"rn1":0.5})),
            21 => Some(serde_json::json!({"pty":1})),
            22 => None,
            _ => dry(h),
        });
        assert_eq!(
            unknown_hours(&partial, now),
            vec![p(20261106, 2200), p(20261106, 2100), p(20261106, 2000)]
        );
    }

    #[test]
    fn a_rule_derived_value_and_a_winter_three_hour_amount_are_known() {
        let now = kst(NOW.0, NOW.1);
        let hourly: Vec<_> = (0..24u16)
            .map(|h| {
                let key = format!("20261106{h:02}00");
                let record = match h {
                    // R1b: a QC9 blank on a closed day.
                    13 => serde_json::json!({"values":{},"inferred":{"pty":0,"rn1":0}}),
                    // A typed hour between marks, covered by the 15:00 three-hour amount.
                    14 => serde_json::json!({"values":{"pty":3}}),
                    15 => serde_json::json!({"values":{"pty":3,"rn3h":1.5}}),
                    _ => serde_json::json!({"values":{"pty":0,"rn1":0}}),
                };
                let mut record = record;
                record["source"] = "KMA_ASOS".into();
                record["key"] = key.into();
                record
            })
            .collect();
        let history = OrderedJson::from_serde(&serde_json::json!({"hourly": hourly})).unwrap();
        assert!(unknown_hours(&history, now).is_empty());
    }

    #[test]
    fn a_day_not_yet_released_asks_for_its_reachable_hours_and_a_loading_answer_for_none() {
        let now = kst(NOW.0, NOW.1);
        let released = OrderedJson::from_serde(&serde_json::json!({"hourly": []})).unwrap();
        let hours = unknown_hours(&released, now);
        assert_eq!(hours.first(), Some(&p(20261106, 2300)));
        assert_eq!(hours.last(), Some(&p(20261106, 1200)));
        assert_eq!(hours.len(), 12);
        let loading = OrderedJson::from_serde(
            &serde_json::json!({"reason":"cache-read-timeout","hourly":[]}),
        )
        .unwrap();
        assert!(unknown_hours(&loading, now).is_empty());
        let unmapped = OrderedJson::from_serde(
            &serde_json::json!({"reason":"station-unavailable","hourly":[]}),
        )
        .unwrap();
        assert_eq!(
            unknown_hours(&unmapped, now).len(),
            12,
            "no station: the nowcast only"
        );
    }
}
