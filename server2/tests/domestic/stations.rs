//! S15b-2 STATIONS: KMA observation pages read as the legacy scraper reads them (cheerio 0.20.0 /
//! htmlparser2 3.8.3 over the EUC-KR or UTF-8 page), compared with the pinned legacy oracle
//! (`fixtures/stations.json.gz`, see `fixtures/STATIONS-PROVENANCE.md`).
use super::source::{at, items_of, same, text};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::domestic::kma::source::Doc;
use server2::domestic::kma::source::pages::{PageError, merge_aws_city, parse_aws, parse_city};
use server2::domestic::kma::source::stations::{Registry, RowStore, StationGeo};
use server2::domestic::kma::source::stn::{StnError, Stations};
use server2::gateway::OrderedJson;
use std::{io::Read, sync::OnceLock};

pub const STATIONS_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/stations.json.gz"
);
pub fn oracle() -> &'static OrderedJson {
    static ORACLE: OnceLock<OrderedJson> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(STATIONS_FIXTURE).unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut raw)
            .unwrap();
        OrderedJson::parse(&raw).unwrap()
    })
}
fn rows_json(rows: &[Doc]) -> OrderedJson {
    OrderedJson::Array(rows.iter().map(Doc::json).collect())
}
fn bytes(case: &OrderedJson, key: &str) -> Vec<u8> {
    STANDARD.decode(text(at(case, &[key]))).unwrap()
}
fn opt(case: &OrderedJson, key: &str) -> Option<String> {
    case.get(key).and_then(OrderedJson::string)
}
/// The legacy error text for each rejection.
fn error_text(kind: &str, e: &PageError) -> &'static str {
    match (kind, e) {
        ("aws", PageError::NoPublication) => "Retry",
        ("aws", PageError::Stale) => "Skip",
        ("city", PageError::Stale) => "city weather is not updated yes pubDate",
        ("city", PageError::NoPublication) => "Fail to get city weather pubDate",
        _ => "other",
    }
}

#[test]
fn observation_pages_parse_like_legacy() {
    for case in items_of(at(oracle(), &["pages"])) {
        let id = text(at(case, &["id"]));
        let kind = text(at(case, &["kind"]));
        let input = bytes(case, "base64");
        let requested = opt(case, "requested");
        let result = at(case, &["result"]);
        let got = if kind == "aws" {
            parse_aws(&input, requested.as_deref()).map(|p| (p.pub_date, p.rows))
        } else {
            parse_city(
                &input,
                &opt(case, "content_type").unwrap_or_default(),
                requested.as_deref(),
            )
            .map(|p| (p.pub_date, p.rows))
        };
        match (got, result.get("error").and_then(OrderedJson::string)) {
            (Ok((pub_date, rows)), None) => {
                assert_eq!(pub_date, text(at(result, &["pubDate"])), "{id} pubDate");
                same(&rows_json(&rows), at(result, &["rows"]), &format!("{id} rows"));
            }
            (Err(e), Some(expected)) => {
                // The header failure is reported with the publication error by the port.
                let mine = error_text(&kind, &e);
                assert!(
                    mine == expected || expected == "Fail to parse city weather header",
                    "{id}: {e:?} vs {expected}"
                );
            }
            (got, expected) => panic!("{id}: {:?} vs {expected:?}", got.map(|g| g.0)),
        }
    }
}

#[test]
fn aws_and_city_rows_merge_like_legacy() {
    let pages = items_of(at(oracle(), &["pages"]));
    for case in items_of(at(oracle(), &["merge"])) {
        let id = text(at(case, &["id"]));
        let find = |key: &str| {
            let want = text(at(case, &[key]));
            pages.iter().find(|p| text(at(p, &["id"])) == want).unwrap()
        };
        let aws_case = find("aws_id");
        let city_case = find("city_id");
        let aws = parse_aws(&bytes(aws_case, "base64"), opt(aws_case, "requested").as_deref())
            .unwrap();
        let city = parse_city(
            &bytes(city_case, "base64"),
            &opt(city_case, "content_type").unwrap_or_default(),
            opt(city_case, "requested").as_deref(),
        )
        .unwrap();
        let merged = merge_aws_city(aws.rows, &city.rows);
        same(&rows_json(&merged), at(case, &["merged"]), &id);
    }
}

/// The oracle's geocoding table (`_recursiveConvertGeoCode` double): Mongoose casts the text
/// coordinates to Number.
struct TableGeo(Vec<(String, f64, f64)>);
impl StationGeo for TableGeo {
    fn locate(&self, addr: &str) -> Option<(f64, f64)> {
        self.0
            .iter()
            .find(|(a, _, _)| a == addr)
            .map(|(_, lon, lat)| (*lon, *lat))
    }
}
fn table_geo(case: &OrderedJson) -> TableGeo {
    let OrderedJson::Object(entries) = at(case, &["geo"]) else {
        panic!("geo table")
    };
    TableGeo(
        entries
            .iter()
            .map(|(addr, pair)| {
                let p = items_of(pair);
                let n = |j: &OrderedJson| text(j).parse::<f64>().unwrap();
                (String::from_utf16(addr).unwrap(), n(&p[0]), n(&p[1]))
            })
            .collect(),
    )
}
fn to_serde(j: &OrderedJson) -> serde_json::Value {
    serde_json::from_slice(&j.to_bytes()).unwrap()
}
fn error_json(e: StnError) -> OrderedJson {
    OrderedJson::Object(vec![(
        "error".encode_utf16().collect(),
        OrderedJson::String(e.0.encode_utf16().collect()),
    )])
}

#[test]
fn station_store_saves_and_answers_like_legacy() {
    for case in items_of(at(oracle(), &["stn"])) {
        let id = text(at(case, &["id"]));
        let geo = table_geo(case);
        let (mut registry, mut hourly, mut minute) =
            (Registry::default(), RowStore::default(), RowStore::default());
        for run in items_of(at(case, &["runs"])) {
            let requested = opt(run, "requested");
            let aws = parse_aws(&bytes(run, "aws"), requested.as_deref()).unwrap();
            if text(at(run, &["kind"])) == "minute" {
                minute.save(&aws.rows);
                continue;
            }
            if opt(run, "city").is_some() {
                let city = parse_city(
                    &bytes(run, "city"),
                    &opt(run, "city_type").unwrap_or_default(),
                    requested.as_deref(),
                )
                .unwrap();
                let rows = merge_aws_city(aws.rows, &city.rows);
                registry.apply_run(&rows, true, &geo);
                hourly.save(&rows);
            } else {
                registry.apply_run(&aws.rows, false, &geo);
                hourly.save(&aws.rows);
            }
        }
        same(&rows_json(registry.docs()), at(case, &["registry"]), &format!("{id} registry"));
        same(&rows_json(hourly.docs()), at(case, &["hourly"]), &format!("{id} hourly"));
        same(&rows_json(minute.docs()), at(case, &["minute"]), &format!("{id} minute"));
        let stations = Stations {
            registry: &registry,
            hourly: &hourly,
            minute: &minute,
        };
        let now = at(case, &["now"]).number().unwrap();
        let date_time = text(at(case, &["date_time"]));
        let towns = items_of(at(case, &["towns"]));
        for (town, answer) in towns.iter().zip(items_of(at(case, &["answers"]))) {
            let name = text(at(town, &["name"]));
            let t = to_serde(town);
            let got = stations
                .hourly_and_min_rns(&t, &date_time)
                .map_or_else(error_json, |d| d.json());
            same(&got, at(answer, &["stn"]), &format!("{id} {name} stn"));
            let got = stations
                .city_hourly(&t, now)
                .map_or_else(error_json, |rows| rows_json(&rows));
            same(&got, at(answer, &["city"]), &format!("{id} {name} city"));
        }
    }
}
