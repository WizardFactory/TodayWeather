//! Reference inputs legacy derives from repository files: the town list (`initTownDataToMongo` +
//! `updateTownDataToMongo` over `part.csv`/`base.csv`, grid by `coordinate2xy`) and the mid region
//! table (`makeRegIdTable` + `getRegIdByTown` over `region.csv`). The files are byte-identical
//! copies under `data/` (see `data/PROVENANCE.md`); nothing here reads a legacy path.
use super::doc::{Doc, Val};
use crate::domestic::kma::js::{V, parse_int10};
use std::sync::OnceLock;

const PART_CSV: &str = include_str!("data/part.csv");
const BASE_CSV: &str = include_str!("data/base.csv");
const REGION_CSV: &str = include_str!("data/region.csv");

/// `Converter.prototype.lamcproj` (code 0) of `utils/coordinate2xy.js`: the KMA grid of a point.
pub fn grid_of(lat: f64, lon: f64) -> (f64, f64) {
    let pi = 1.0f64.asin() * 2.0;
    let degrad = pi / 180.0;
    let re = 6371.00877 / 5.0;
    let slat1 = 30.0 * degrad;
    let slat2 = 60.0 * degrad;
    let olon = 126.0 * degrad;
    let olat = 38.0 * degrad;
    let mut sn = (pi * 0.25 + slat2 * 0.5).tan() / (pi * 0.25 + slat1 * 0.5).tan();
    sn = (slat1.cos() / slat2.cos()).ln() / sn.ln();
    let mut sf = (pi * 0.25 + slat1 * 0.5).tan();
    sf = sf.powf(sn) * slat1.cos() / sn;
    let mut ro = (pi * 0.25 + olat * 0.5).tan();
    ro = re * sf / ro.powf(sn);
    let mut ra = (pi * 0.25 + lat * degrad * 0.5).tan();
    ra = re * sf / ra.powf(sn);
    let mut theta = lon * degrad - olon;
    if theta > pi {
        theta -= 2.0 * pi;
    }
    if theta < -pi {
        theta += 2.0 * pi;
    }
    theta *= sn;
    let x = (ra * theta.sin()) + 42.0;
    let y = (ro - ra * theta.cos()) + 135.0;
    // `parseInt(x + 1.5)`.
    (parse_int10(&V::Num(x + 1.5)), parse_int10(&V::Num(y + 1.5)))
}

/// `Number(value)` as Mongoose casts a CSV string into a Number path.
fn cast_number(s: &str) -> f64 {
    crate::world::js::string_to_number(s)
}
fn town_doc(first: &str, second: &str, third: &str, lat: f64, lon: f64, area: Option<Val>) -> Doc {
    let (mx, my) = grid_of(lat, lon);
    let mut d = Doc::new()
        .with(
            "town",
            Doc::new()
                .with("first", Val::str(first))
                .with("second", Val::str(second))
                .with("third", Val::str(third))
                .into(),
        )
        .with(
            "mCoord",
            Doc::new()
                .with("mx", Val::num(mx))
                .with("my", Val::num(my))
                .into(),
        )
        .with(
            "gCoord",
            Doc::new()
                .with("lat", Val::num(lat))
                .with("lon", Val::num(lon))
                .into(),
        );
    if let Some(area) = area {
        d.set("areaNo", area);
    }
    d.set("__v", Val::Num(0.));
    d
}
/// `text.split('\n')` without the header and the last element.
fn data_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    lines.remove(0);
    lines.pop();
    lines
}
fn field<'a>(parts: &[&'a str], i: usize) -> &'a str {
    parts.get(i).copied().unwrap_or("")
}

/// The rebuilt `towns` collection in load order (`find({}, {_id: 0})`).
pub fn towns() -> &'static [Doc] {
    static TOWNS: OnceLock<Vec<Doc>> = OnceLock::new();
    TOWNS.get_or_init(|| {
        let mut out = Vec::new();
        // initTownDataToMongo: `\r` removed, fields assigned in order; the last assignment of
        // lat/lon wins and Mongoose casts the strings with Number().
        for line in data_lines(PART_CSV) {
            let line = line.replace('\r', "");
            let p: Vec<&str> = line.split(',').collect();
            let area = (p.len() > 5).then(|| Val::str(p[5]));
            out.push(town_doc(
                field(&p, 0),
                field(&p, 1),
                field(&p, 2),
                cast_number(field(&p, 3)),
                cast_number(field(&p, 4)),
                area,
            ));
        }
        let initial = out.len();
        // updateTownDataToMongo: each line is compared with the towns read before the loop only.
        for line in data_lines(BASE_CSV) {
            let p: Vec<&str> = line.split(',').collect();
            let (f, s, t) = (field(&p, 0), field(&p, 1), field(&p, 2));
            let known = out[..initial].iter().any(|d| {
                let town = d.get("town").and_then(Val::as_doc);
                let get = |k| town.and_then(|t| t.get(k)).and_then(Val::as_str);
                get("first") == Some(f) && get("second") == Some(s) && get("third") == Some(t)
            });
            if known {
                continue;
            }
            // `parseInt(x).toString()` when the field is truthy; absent otherwise.
            let area = p
                .get(5)
                .filter(|v| !v.is_empty())
                .map(|v| Val::str(crate::gateway::response::js_number(parse_int10(&V::s(v)))));
            out.push(town_doc(
                f,
                s,
                t,
                crate::world::js::parse_float(field(&p, 3)),
                crate::world::js::parse_float(field(&p, 4)),
                area,
            ));
        }
        out
    })
}
/// `_findTown`: the first town whose names equal the request (strict equality; an absent name
/// matches only an absent field).
pub fn find_town<'a>(
    list: &'a [Doc],
    first: Option<&str>,
    second: Option<&str>,
    third: Option<&str>,
) -> Option<&'a Doc> {
    list.iter().find(|d| {
        let town = d.get("town").and_then(Val::as_doc);
        let get = |k| town.and_then(|t| t.get(k)).and_then(Val::as_str);
        get("first") == first && get("second") == second && get("third") == third
    })
}

/// One `codeTable` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegionRow {
    pub first: String,
    pub second: String,
    pub region_name: String,
    pub point_number: String,
    pub city_code: String,
}
impl RegionRow {
    pub fn doc(&self) -> Doc {
        Doc::new()
            .with("first", Val::str(&self.first))
            .with("second", Val::str(&self.second))
            .with("regionName", Val::str(&self.region_name))
            .with("pointNumber", Val::str(&self.point_number))
            .with("cityCode", Val::str(&self.city_code))
    }
}
/// `makeRegIdTable`: rows with at least five fields, in file order.
pub fn region_table() -> &'static [RegionRow] {
    static TABLE: OnceLock<Vec<RegionRow>> = OnceLock::new();
    TABLE.get_or_init(|| {
        REGION_CSV
            .split('\n')
            .filter_map(|line| {
                let p: Vec<&str> = line.split(',').collect();
                (p.len() >= 5).then(|| RegionRow {
                    first: p[0].into(),
                    second: p[1].into(),
                    region_name: p[2].into(),
                    point_number: p[3].into(),
                    city_code: p[4].into(),
                })
            })
            .collect()
    })
}
/// `getRegIdByTown(region, city)`: the row, or the legacy error message.
pub fn region_code(region: &str, city: &str) -> Result<&'static RegionRow, String> {
    let units = crate::domestic::kma::js::units(city);
    let city = crate::domestic::kma::js::from16(&units[..units.len().min(3)]);
    for (i, row) in region_table().iter().enumerate() {
        if row.first == region && (i < 8 || city.is_empty() || row.second == city) {
            return Ok(row);
        }
    }
    Err(format!("Fail to find code table {region}{city}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_grids() {
        assert_eq!(grid_of(37.5636, 126.98), (60., 127.));
        assert_eq!(region_table().len(), 174);
        assert_eq!(
            region_code("서울특별시", "종로구").unwrap().city_code,
            "11B10101"
        );
    }
}
