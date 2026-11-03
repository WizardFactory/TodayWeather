//! Contract `station-altitude-v1` (`server2/config/contracts/kma-history.v1.json`), required by AK
//! on 2026-11-03: an ASOS station on a mountain or in a special area is not used as-is for a
//! town's local weather. Horizontal distance alone is not enough, so the nearest city station
//! must also lie within 200 m of the town's elevation. A town listed in `data/town_elevations.csv`
//! has three elevation estimates and a change needs all of them to agree; any other town keeps
//! the nearest station. A replacement lies within 35 km. Without one the town uses no station.
//! An island station serves only its own county, keeps it whatever the altitude, and Jeju stations
//! serve only Jeju. Evidence: docs/evidence/research/kma-history-gap-options-2026-10-30.md.
use super::doc::{Doc, Val};
use crate::domestic::kma::js::V;
use crate::domestic::kma::policy;
use std::collections::HashMap;
use std::sync::OnceLock;

const TOWN_ELEVATIONS: &str = include_str!("data/town_elevations.csv");
const MAX_ALTITUDE_DIFFERENCE_M: f64 = 200.;
const MAX_REPLACEMENT_KM: f64 = 35.;
const JEJU: &str = "제주특별자치도";
const JEJU_STATIONS: [&str; 4] = ["184", "185", "188", "189"];
const ISLAND_STATIONS: [(&str, &str); 3] =
    [("102", "옹진군"), ("115", "울릉군"), ("169", "신안군")];

/// What the rule says about a town's station.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The rule has no objection: use the path's own nearest station.
    Nearest,
    Station(String),
    NoStation,
}

/// Capes whose exposure makes the wind unrepresentative of their towns: other fields stay.
pub fn wind_unrepresentative(station: &str) -> bool {
    matches!(station, "185" | "188")
}

type Key = (String, String, String);
fn elevations() -> &'static HashMap<Key, [f64; 3]> {
    static TABLE: OnceLock<HashMap<Key, [f64; 3]>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut out = HashMap::new();
        for line in TOWN_ELEVATIONS.lines().skip(1) {
            let p: Vec<&str> = line.split(',').collect();
            let number = |i: usize| p.get(i).and_then(|v| v.parse::<f64>().ok());
            if let (Some(a), Some(b), Some(c)) = (number(3), number(4), number(5)) {
                out.insert(
                    (p[0].to_owned(), p[1].to_owned(), p[2].to_owned()),
                    [a, b, c],
                );
            }
        }
        out
    })
}
/// The table keeps the province names of the town list.
fn listed_first(first: &str) -> &str {
    match first {
        "강원특별자치도" => "강원도",
        "전북특별자치도" => "전라북도",
        other => other,
    }
}
fn serves(first: &str, second: &str, station: &str) -> bool {
    if (first == JEJU) != JEJU_STATIONS.contains(&station) {
        return false;
    }
    ISLAND_STATIONS
        .iter()
        .find(|(id, _)| *id == station)
        .is_none_or(|(_, county)| *county == second)
}
pub fn station_id(doc: &Doc) -> Option<String> {
    policy::station(&match doc.get("stnId")? {
        Val::Str(s) => V::s(s),
        Val::Num(n) => V::Num(*n),
        _ => return None,
    })
}
fn distance_km(lat: f64, lon: f64, station_lat: f64, station_lon: f64) -> f64 {
    let rad = std::f64::consts::PI / 180.;
    let dl = (station_lat - lat) * rad;
    let dn = (station_lon - lon) * rad;
    let a = (dl / 2.).sin().powi(2)
        + (lat * rad).cos() * (station_lat * rad).cos() * (dn / 2.).sin().powi(2);
    6371. * 2. * a.sqrt().min(1.).asin()
}
struct Candidate {
    km: f64,
    id: String,
    altitude: Option<f64>,
}
/// City stations by distance, ties by station number.
fn city_stations(lat: f64, lon: f64, stations: &[Doc]) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = stations
        .iter()
        .filter(|s| s.get("isCityWeather") == Some(&Val::Bool(true)))
        .filter_map(|s| {
            let Some(Val::Arr(geo)) = s.get("geo") else {
                return None;
            };
            let (x, y) = (geo.first()?.as_num()?, geo.get(1)?.as_num()?);
            Some(Candidate {
                km: distance_km(lat, lon, y, x),
                id: station_id(s)?,
                altitude: s.get("altitude").and_then(Val::as_num),
            })
        })
        .collect();
    out.sort_by(|a, b| {
        a.km.total_cmp(&b.km).then_with(|| {
            let n = |c: &Candidate| c.id.parse::<f64>().unwrap_or(f64::NAN);
            n(a).total_cmp(&n(b))
        })
    });
    out
}
/// The rule for a named town at a coordinate.
pub fn verdict(
    first: &str,
    second: &str,
    third: &str,
    lat: f64,
    lon: f64,
    stations: &[Doc],
) -> Verdict {
    let first = listed_first(first);
    let key = (first.to_owned(), second.to_owned(), third.to_owned());
    let Some(estimates) = elevations().get(&key) else {
        return Verdict::Nearest;
    };
    let all = city_stations(lat, lon, stations);
    let allowed: Vec<&Candidate> = all
        .iter()
        .filter(|c| serves(first, second, &c.id))
        .collect();
    let Some(nearest) = allowed.first() else {
        return Verdict::Nearest;
    };
    let keep = if all.first().is_some_and(|c| c.id == nearest.id) {
        Verdict::Nearest
    } else {
        Verdict::Station(nearest.id.clone())
    };
    let fits = |altitude: Option<f64>, estimate: f64| {
        altitude.is_some_and(|a| (estimate - a).abs() <= MAX_ALTITUDE_DIFFERENCE_M)
    };
    if ISLAND_STATIONS.iter().any(|(id, _)| *id == nearest.id)
        || nearest.altitude.is_none()
        || estimates.iter().any(|e| fits(nearest.altitude, *e))
    {
        return keep;
    }
    let pick = |estimate: f64| {
        allowed
            .iter()
            .take_while(|c| c.km <= MAX_REPLACEMENT_KM)
            .find(|c| fits(c.altitude, estimate))
            .map(|c| c.id.clone())
    };
    let first_pick = pick(estimates[0]);
    if estimates[1..].iter().any(|e| pick(*e) != first_pick) {
        return keep;
    }
    first_pick.map_or(Verdict::NoStation, Verdict::Station)
}
/// [`verdict`] for a town document; a town without names or coordinates has no objection.
pub fn verdict_for_doc(town: &Doc, stations: &[Doc]) -> Verdict {
    let name = |k: &str| {
        town.get("town")
            .and_then(Val::as_doc)
            .and_then(|t| t.get(k))
            .and_then(Val::as_str)
    };
    let coordinate = |k: &str| match town.get("gCoord").and_then(Val::as_doc)?.get(k)? {
        Val::Num(n) => Some(*n),
        Val::Str(s) => Some(crate::world::js::string_to_number(s)),
        _ => None,
    };
    match (
        name("first"),
        name("second"),
        name("third"),
        coordinate("lat"),
        coordinate("lon"),
    ) {
        (Some(a), Some(b), Some(c), Some(lat), Some(lon)) if lat.is_finite() && lon.is_finite() => {
            verdict(a, b, c, lat, lon, stations)
        }
        _ => Verdict::Nearest,
    }
}
/// The station documents the rule allows for `id`.
pub fn only_station(stations: &[Doc], id: &str) -> Vec<Doc> {
    stations
        .iter()
        .filter(|s| station_id(s).as_deref() == Some(id))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{reference, seed};
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    fn seeded(first: &str, second: &str, third: &str) -> Verdict {
        let town = reference::towns()
            .iter()
            .find(|t| {
                let name = |k: &str| {
                    t.get("town")
                        .and_then(Val::as_doc)
                        .and_then(|n| n.get(k))
                        .and_then(Val::as_str)
                };
                name("first") == Some(first)
                    && name("second") == Some(second)
                    && name("third") == Some(third)
            })
            .unwrap_or_else(|| panic!("{second} {third}"));
        verdict_for_doc(town, &seed::embedded().docs)
    }
    fn station(name: &str) -> Verdict {
        let doc = seed::embedded()
            .docs
            .iter()
            .find(|d| {
                d.get("stnName").and_then(Val::as_str) == Some(name)
                    && d.get("isCityWeather") == Some(&Val::Bool(true))
            })
            .unwrap();
        Verdict::Station(station_id(doc).unwrap())
    }

    #[test]
    fn a_mountain_station_keeps_the_towns_at_its_own_height() {
        assert_eq!(seeded("강원도", "태백시", "황지동"), Verdict::Nearest);
        assert_eq!(seeded("강원도", "평창군", "대관령면"), Verdict::Nearest);
    }
    #[test]
    fn a_lower_town_leaves_a_mountain_station() {
        assert_eq!(seeded("강원도", "삼척시", "가곡면"), station("울진"));
        assert_eq!(seeded("강원도", "삼척시", "도계읍"), station("봉화"));
        assert_eq!(seeded("강원도", "평창군", "진부면"), Verdict::NoStation);
    }
    #[test]
    fn a_higher_town_leaves_a_lowland_station() {
        assert_eq!(seeded("전라북도", "남원시", "운봉읍"), station("장수"));
    }
    #[test]
    fn disagreeing_estimates_keep_the_nearest_station() {
        assert_eq!(seeded("경상북도", "봉화군", "석포면"), Verdict::Nearest);
        assert_eq!(seeded("부산광역시", "북구", "구포3동"), Verdict::Nearest);
    }
    #[test]
    fn islands_keep_their_own_station_and_unverified_towns_change_nothing() {
        assert_eq!(seeded("경상북도", "울릉군", "서면"), Verdict::Nearest);
        assert_eq!(seeded("충청북도", "제천시", "모산동"), Verdict::Nearest);
    }
    #[test]
    fn a_renamed_province_finds_the_same_row() {
        let town = reference::towns()
            .iter()
            .find(|t| {
                t.get("town")
                    .and_then(Val::as_doc)
                    .and_then(|n| n.get("third"))
                    .and_then(Val::as_str)
                    == Some("진부면")
            })
            .unwrap();
        let coord = town.get("gCoord").and_then(Val::as_doc).unwrap();
        let (lat, lon) = (
            coord.get("lat").and_then(Val::as_num).unwrap(),
            coord.get("lon").and_then(Val::as_num).unwrap(),
        );
        assert_eq!(
            verdict(
                "강원특별자치도",
                "평창군",
                "진부면",
                lat,
                lon,
                &seed::embedded().docs
            ),
            Verdict::NoStation
        );
    }
    #[test]
    fn the_rule_changes_only_the_reviewed_towns() {
        let mut seen = BTreeSet::new();
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for town in reference::towns() {
            let name = |k: &str| {
                town.get("town")
                    .and_then(Val::as_doc)
                    .and_then(|n| n.get(k))
                    .and_then(Val::as_str)
            };
            let (Some(a), Some(b), Some(c)) = (name("first"), name("second"), name("third")) else {
                continue;
            };
            if c.is_empty() || !seen.insert((a, b, c)) {
                continue;
            }
            let kind = match verdict_for_doc(town, &seed::embedded().docs) {
                Verdict::Nearest => "nearest",
                Verdict::Station(_) => "moved",
                Verdict::NoStation => "none",
            };
            *counts.entry(kind).or_default() += 1;
        }
        assert_eq!(counts.get("moved"), Some(&16), "{counts:?}");
        assert_eq!(counts.get("none"), Some(&9), "{counts:?}");
    }
    #[test]
    fn history_maps_through_the_rule() {
        use super::super::observe::{Unrepresentative, representative_mapping};
        let docs = &seed::embedded().docs;
        let mapping = |second: &str, third: &str| {
            let town = reference::towns()
                .iter()
                .find(|t| {
                    let name = |k: &str| {
                        t.get("town")
                            .and_then(Val::as_doc)
                            .and_then(|n| n.get(k))
                            .and_then(Val::as_str)
                    };
                    name("second") == Some(second) && name("third") == Some(third)
                })
                .unwrap();
            representative_mapping(town, docs, 100.).map(|m| m.unwrap().station)
        };
        assert_eq!(mapping("삼척시", "가곡면"), Ok("130".to_owned()));
        assert_eq!(mapping("태백시", "황지동"), Ok("216".to_owned()));
        assert_eq!(mapping("평창군", "진부면"), Err(Unrepresentative));
    }
    #[test]
    fn only_the_two_capes_lose_their_wind() {
        assert!(wind_unrepresentative("185") && wind_unrepresentative("188"));
        assert!(!wind_unrepresentative("135") && !wind_unrepresentative("108"));
    }
}
