//! Legacy station rain-sensor statistics (`rnsHit`/`rnsCount`/`isMountain`), ported as pure
//! functions (S15b-2, AK 2026-10-15):
//! - [`update`]: `KmaScraper._updateRnsHitRate` (`server/lib/kmaScraper.js:1317-1408`);
//! - [`rns_allowed`]: the 0.5 hit-rate rule of `controllerKmaStnWeather._getStnMinute`
//!   (`controllerKmaStnWeather.js:411-417`);
//! - [`filter_stations`]: `controllerKmaStnWeather._filterStnList` (`:765-774`).
//!
//! In the legacy source these run only outside the v000903 chain: the update is reached from the
//! `/gather` route (`routes/v000001/routeGather.js:262`) and reads the retired `KmaStnMinute`
//! collection, and the two rules are used by `getStnHourly`/`getStnMinute` (v000001
//! `getKmaStnHourlyWeather`). The v000903 `getStnHourlyAndMinRns` copies the stored fields into
//! its answer and applies neither rule, so the S3 source keeps the seeded values; wiring the
//! update would change answers legacy serves and is an open decision.
use super::doc::{Doc, Val};

fn num(d: &Doc, k: &str) -> Option<f64> {
    match d.get(k) {
        Some(Val::Num(n)) => Some(*n),
        _ => None,
    }
}
/// `rnsHitRate = stnInfo.rnsHit / stnInfo.rnsCount; if (rnsHitRate < 0.5) minuteData.rns =
/// undefined`: whether the station's `rns` is kept (an undefined statistic is NaN, never < 0.5).
pub fn rns_allowed(station: &Doc) -> bool {
    let rate = match (num(station, "rnsHit"), num(station, "rnsCount")) {
        (Some(h), Some(c)) => h / c,
        _ => f64::NAN,
    };
    // NaN (an undefined statistic) is never below 0.5.
    rate.is_nan() || rate >= 0.5
}
/// `_filterStnList`: an undefined `isMountain` or a city station is kept, otherwise only
/// non-mountain stations.
pub fn filter_stations(list: &[Doc]) -> Vec<Doc> {
    list.iter()
        .filter(|s| match s.get("isMountain") {
            None | Some(Val::Null) | Some(Val::Undef) => true,
            Some(m) => truthy(s.get("isCityWeather")) || !truthy(Some(m)),
        })
        .cloned()
        .collect()
}
fn truthy(v: Option<&Val>) -> bool {
    match v {
        None | Some(Val::Null) | Some(Val::Undef) | Some(Val::Bool(false)) => false,
        Some(Val::Num(n)) => *n != 0. && !n.is_nan(),
        Some(Val::Str(s)) => !s.is_empty(),
        _ => true,
    }
}
/// `_updateRnsHitRate`: given the station's grid current row (`pty`, `rn1`) and the `rns` values
/// of its minute rows in the hour ending at that current slot, the new `(rnsHit, rnsCount)`, or
/// None when legacy updates nothing (not raining, fewer than 15 minute rows, or no `rns`).
pub fn update(
    station: &Doc,
    pty: f64,
    rn1: f64,
    minute_rns: &[Option<bool>],
) -> Option<(f64, f64)> {
    if !(pty > 0. || rn1 > 0.) {
        return None;
    }
    if minute_rns.len() < 15 {
        return None;
    }
    let counted = minute_rns.iter().filter(|r| r.is_some()).count();
    if counted == 0 {
        return None;
    }
    let hit = minute_rns.contains(&Some(true));
    let hits = num(station, "rnsHit").unwrap_or(0.) + if hit { 1. } else { 0. };
    let count = num(station, "rnsCount").unwrap_or(0.) + 1.;
    Some((hits, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stn(fields: &[(&str, Val)]) -> Doc {
        let mut d = Doc::new();
        for (k, v) in fields {
            d.set(k, v.clone());
        }
        d
    }
    #[test]
    fn hit_rate_rule_keeps_undefined_statistics() {
        assert!(rns_allowed(&stn(&[])));
        assert!(rns_allowed(&stn(&[
            ("rnsHit", Val::Num(1.)),
            ("rnsCount", Val::Num(2.))
        ])));
        assert!(!rns_allowed(&stn(&[
            ("rnsHit", Val::Num(0.)),
            ("rnsCount", Val::Num(1.))
        ])));
        // 0/0 is NaN: kept.
        assert!(rns_allowed(&stn(&[
            ("rnsHit", Val::Num(0.)),
            ("rnsCount", Val::Num(0.))
        ])));
    }
    #[test]
    fn mountain_filter_follows_legacy() {
        let list = vec![
            stn(&[("stnId", Val::str("1"))]),
            stn(&[("stnId", Val::str("2")), ("isMountain", Val::Bool(true))]),
            stn(&[
                ("stnId", Val::str("3")),
                ("isMountain", Val::Bool(true)),
                ("isCityWeather", Val::Bool(true)),
            ]),
            stn(&[("stnId", Val::str("4")), ("isMountain", Val::Bool(false))]),
        ];
        let kept: Vec<_> = filter_stations(&list)
            .iter()
            .map(|d| d.get("stnId").cloned())
            .collect();
        assert_eq!(
            kept,
            vec![
                Some(Val::str("1")),
                Some(Val::str("3")),
                Some(Val::str("4"))
            ]
        );
    }
    #[test]
    fn hit_update_needs_rain_fifteen_rows_and_an_rns_value() {
        let s = stn(&[("rnsHit", Val::Num(3.)), ("rnsCount", Val::Num(4.))]);
        let rows = |v: Option<bool>| vec![v; 15];
        assert_eq!(update(&s, 0., 0., &rows(Some(true))), None);
        assert_eq!(update(&s, 1., 0., &[Some(true); 14]), None);
        assert_eq!(update(&s, 1., 0., &rows(None)), None);
        assert_eq!(update(&s, 1., 0., &rows(Some(false))), Some((3., 5.)));
        let mut mixed = rows(Some(false));
        mixed[3] = Some(true);
        assert_eq!(update(&s, 0., 0.5, &mixed), Some((4., 5.)));
        assert_eq!(update(&stn(&[]), 1., 0., &mixed), Some((1., 1.)));
    }
}
