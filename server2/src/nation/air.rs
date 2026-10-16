//! Province averages and NationAir's representative points, from legacy `saveAvgSidoArpltn`
//! and `lib/air/nationAir.js`. Every request reuses the national AirKorea acquisition.
use crate::domestic::kma::source::{
    Doc, Val,
    airkorea::{Observations, Stations},
};

/// Fixed city-centre points, not a province centroid or a computed province mean.
pub const REGIONS: [(&str, &str, f64, f64); 17] = [
    ("서울", "Seoul", 37.5665, 126.9780),
    ("부산", "Busan", 35.1796, 129.0756),
    ("대구", "Daegu", 35.8714, 128.6014),
    ("인천", "Incheon", 37.4563, 126.7052),
    ("광주", "Gwangju", 35.1595, 126.8526),
    ("대전", "Daejeon", 36.3504, 127.3845),
    ("울산", "Ulsan", 35.5384, 129.3114),
    ("경기", "Suwon", 37.2636, 127.0286),
    ("강원", "Chuncheon", 37.8813, 127.7298),
    ("충북", "Cheongju", 36.6424, 127.4890),
    ("충남", "Hongseong", 36.6012, 126.6608),
    ("전북", "Jeonju", 35.8242, 127.1480),
    ("전남", "Mokpo", 34.8118, 126.3922),
    ("경북", "Andong", 36.5684, 128.7294),
    ("경남", "Changwon", 35.2280, 128.6811),
    ("제주", "Jeju", 33.4996, 126.5312),
    ("세종", "Sejong", 36.4800, 127.2890),
];

fn province<'a>(
    row: &'a crate::domestic::kma::source::airkorea::ObsRow,
    stations: &Stations,
) -> Option<&'a str> {
    let name = row.province.as_deref()?;
    if name != "전남광주" {
        return Some(name);
    }
    let address = stations
        .docs()
        .iter()
        .find(|s| s.get("stationName").and_then(Val::as_str) == Some(row.station.as_str()))?
        .get("addr")?
        .as_str()?;
    if address.starts_with("광주") {
        Some("광주")
    } else if address.starts_with("전라남도") || address.starts_with("전남") {
        Some("전남")
    } else {
        None
    }
}
/// Rebuild the latest stored province average from raw acquisitions. Latest urban hour only;
/// each pollutant has its own valid-value count. Roadside observations never move the hour.
pub fn province_averages(observations: &Observations, stations: &Stations) -> Vec<Doc> {
    REGIONS
        .iter()
        .filter_map(|(name, _, _, _)| {
            let rows: Vec<_> = observations
                .provincial_rows()
                .iter()
                .filter(|r| {
                    province(r, stations) == Some(*name)
                        && r.fields
                            .iter()
                            .any(|(k, v)| k == "mangName" && v.as_str() == Some("도시대기"))
                })
                .collect();
            let newest = rows.iter().map(|r| r.ms).max_by(f64::total_cmp)?;
            let rows: Vec<_> = rows.into_iter().filter(|r| r.ms == newest).collect();
            let time = rows
                .first()?
                .fields
                .iter()
                .find(|(k, _)| k == "dataTime")?
                .1
                .clone();
            let mut set = Doc::new()
                .with("sidocityName", Val::str(*name))
                .with("sidoName", Val::str(*name))
                .with("date", Val::Date(newest))
                .with("dataTime", time)
                .with("cityName", Val::str(""))
                .with("cityNameEng", Val::str(""));
            let mut sums: Vec<(String, f64, usize)> = Vec::new();
            for row in rows {
                for (key, value) in &row.fields {
                    if !key.contains("Value") {
                        continue;
                    }
                    let Some(value) = value.as_num().filter(|v| v.is_finite() && *v >= 0.) else {
                        continue;
                    };
                    if let Some((_, sum, count)) = sums.iter_mut().find(|(k, _, _)| k == key) {
                        *sum += value;
                        *count += 1;
                    } else {
                        sums.push((key.clone(), value, 1));
                    }
                }
            }
            for (key, sum, count) in sums {
                let average = sum / count as f64;
                let rounded = if [
                    "pm10Value",
                    "pm25Value",
                    "khaiValue",
                    "pm10Value24",
                    "pm25Value24",
                ]
                .contains(&key.as_str())
                {
                    (average + 0.5).floor()
                } else if ["no2Value", "o3Value", "coValue", "so2Value"].contains(&key.as_str()) {
                    (average * 1000. + 0.5).floor() / 1000.
                } else {
                    average
                };
                set.set(&key, Val::num(rounded));
            }
            // Mongoose update insert: query fields then reverse $set fields (no _id/__v on read).
            let mut out = Doc::new()
                .with("sidocityName", Val::str(*name))
                .with("date", Val::Date(newest));
            for (k, v) in set.entries().iter().rev() {
                out.set(k, v.clone());
            }
            Some(out)
        })
        .collect()
}
/// Stored averages use a strict eight-hour boundary; global observations accept that boundary.
pub fn stored_failure(row: &Doc, now: f64) -> Option<&'static str> {
    let ms = row
        .get("dataTime")
        .and_then(Val::as_str)
        .map(crate::domestic::kma::source::airkorea::kst_instant)
        .unwrap_or(f64::NAN);
    if !ms.is_finite()
        || !["pm10Value", "pm25Value"].iter().any(|k| {
            row.get(k)
                .and_then(Val::as_num)
                .is_some_and(|v| v.is_finite() && v >= 0.)
        })
    {
        return Some("invalid");
    }
    let age = now - ms;
    if age < -3_600_000. {
        Some("future")
    } else if age >= 8. * 3_600_000. {
        Some("stale")
    } else {
        None
    }
}
