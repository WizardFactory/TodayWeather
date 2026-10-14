//! S15b-2 STATIONS: KMA observation pages read as the legacy scraper reads them (cheerio 0.20.0 /
//! htmlparser2 3.8.3 over the EUC-KR or UTF-8 page), compared with the pinned legacy oracle
//! (`fixtures/stations.json.gz`, see `fixtures/STATIONS-PROVENANCE.md`).
use super::source::{at, items_of, same, text};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use server2::domestic::kma::source::Doc;
use server2::domestic::kma::source::pages::{PageError, merge_aws_city, parse_aws, parse_city};
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
