//! S15b-3 AIR: AirKorea documents and reader answers rebuilt from raw provider pages equal the
//! pinned legacy oracle (`fixtures/air.json.gz`, see `fixtures/AIR-PROVENANCE.md`): legacy
//! `kecoRequester`/`airkoreaObservation` collectors and the tw_svc `kecoController` readers with
//! Mongoose 5.1.2 over an in-memory collection double, fed the same synthetic pages.
use super::source::{at, items_of, number, same, text};
use server2::domestic::kma::source::air_input::page_items;
use server2::domestic::kma::source::airkorea::{
    Forecasts, Observations, Stations, arpltn_answer, dust_answer, kst_instant, v8_sort,
};
use server2::gateway::OrderedJson;
use std::{io::Read, sync::Arc, sync::OnceLock};

pub const AIR_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/air.json.gz"
);
pub fn oracle() -> &'static OrderedJson {
    static ORACLE: OnceLock<OrderedJson> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(AIR_FIXTURE).unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut raw)
            .unwrap();
        OrderedJson::parse(&raw).unwrap()
    })
}
/// One recorded acquisition: (fetch instant, items of every page).
pub fn acquisitions(path: &[&str]) -> Vec<(f64, Vec<serde_json::Value>, Vec<Vec<u8>>)> {
    items_of(at(oracle(), path))
        .iter()
        .map(|a| {
            let pages: Vec<Vec<u8>> = items_of(at(a, &["pages"]))
                .iter()
                .map(|p| text(p).into_bytes())
                .collect();
            let arcs: Vec<Arc<[u8]>> = pages.iter().map(|p| Arc::from(p.clone())).collect();
            (
                number(at(a, &["fetched"])),
                page_items(&arcs).expect("item pages"),
                pages,
            )
        })
        .collect()
}
pub fn stations() -> Stations {
    let mut s = Stations::default();
    for (_, items, _) in acquisitions(&["stations", "acquisitions"]) {
        s.apply(&items);
    }
    s
}
fn docs(list: Vec<OrderedJson>) -> OrderedJson {
    OrderedJson::Array(list)
}

#[test]
fn station_list_fold_equals_legacy_msrstn_documents() {
    let s = stations();
    same(
        &docs(s.docs().iter().map(|d| d.json()).collect()),
        at(oracle(), &["stations", "docs"]),
        "MsrStnInfo documents",
    );
    // The empty-coordinate station (legacy would geocode its address) and nothing else is left out.
    assert_eq!(s.docs().len(), 15);
}

#[test]
fn nationwide_observation_fold_equals_legacy_arpltn_documents() {
    let mut o = Observations::default();
    for (_, items, _) in acquisitions(&["observations", "acquisitions"]) {
        o.apply(&items);
    }
    same(
        &docs(o.docs().iter().map(|d| d.json()).collect()),
        at(oracle(), &["observations", "docs"]),
        "ArpltnKeco documents",
    );
}

#[test]
fn arpltn_answers_equal_legacy_get_arpltn_info() {
    let s = stations();
    let obs = acquisitions(&["observations", "acquisitions"]);
    let answers = items_of(at(oracle(), &["arpltn"]));
    assert_eq!(answers.len(), 48);
    let mut with_values = 0;
    for a in answers {
        let now = number(at(a, &["now"]));
        let g = at(a, &["gCoord"]);
        let mut o = Observations::default();
        for (fetched, items, _) in &obs {
            if *fetched <= now {
                o.apply(items);
            }
        }
        let got = arpltn_answer(
            &s,
            &o,
            Some((number(at(g, &["lat"])), number(at(g, &["lon"])))),
            now,
        )
        .unwrap();
        let town = text(at(a, &["town"]));
        same(&got, at(a, &["result"]), &format!("{town} at {now}"));
        with_values += usize::from(got.get("arpltn").is_some());
    }
    assert!(
        with_values >= 20,
        "fixture covers merged answers: {with_values}"
    );
}

#[test]
fn station_order_follows_v8_sort_for_every_three_station_pattern() {
    // Kinds of the oracle: khai+urban, khai+roadside, urban without khai/pm10, suburban without,
    // harbour with pm10 only.
    let kinds: [(bool, &str); 5] = [
        (true, "도시대기"),
        (true, "도로변대기"),
        (false, "도시대기"),
        (false, "교외대기"),
        (true, "항만"),
    ];
    let sorts = items_of(at(oracle(), &["sorts"]));
    assert_eq!(sorts.len(), 1 + 5 + 25 + 125);
    for s in sorts {
        let pattern: Vec<usize> = items_of(at(s, &["kinds"]))
            .iter()
            .map(|k| number(k) as usize)
            .collect();
        let mut list: Vec<(usize, (bool, &str))> = pattern
            .iter()
            .enumerate()
            .map(|(i, k)| (i, kinds[*k]))
            .collect();
        v8_sort(&mut list, |a, _| {
            if !a.1.0 {
                1.
            } else if a.1.1 == "도시대기" {
                -1.
            } else {
                0.
            }
        });
        let order: Vec<f64> = list.iter().map(|(i, _)| *i as f64).collect();
        let expected: Vec<f64> = items_of(at(s, &["order"])).iter().map(number).collect();
        assert_eq!(order, expected, "{pattern:?}");
    }
}

#[test]
fn dust_forecast_fold_and_answers_equal_legacy() {
    // Each run applies the announcement legacy `_checkDataTime` chose when it started.
    let mut f = Forecasts::default();
    let runs = items_of(at(oracle(), &["dust", "runs"]));
    for ((_, items, _), run) in acquisitions(&["dust", "acquisitions"]).iter().zip(runs) {
        f.apply(&text(at(run, &["expected"])), items);
    }
    // Stored documents: informData, informCode, dataTime and the (region, grade) list.
    let expected = items_of(at(oracle(), &["dust", "docs"]));
    assert_eq!(f.docs().len(), expected.len());
    for (d, e) in f.docs().iter().zip(expected) {
        assert_eq!(
            d.inform_data.as_deref(),
            at(e, &["informData"]).string().as_deref()
        );
        assert_eq!(
            d.inform_code.as_deref(),
            at(e, &["informCode"]).string().as_deref()
        );
        assert_eq!(
            d.data_time.as_deref(),
            at(e, &["dataTime"]).string().as_deref()
        );
        let grades: Vec<(Option<String>, Option<String>)> = items_of(at(e, &["informGrade"]))
            .iter()
            .map(|g| {
                (
                    g.get("region").and_then(OrderedJson::string),
                    g.get("grade").and_then(OrderedJson::string),
                )
            })
            .collect();
        assert_eq!(d.grades, grades, "{:?}", d.inform_data);
    }
    let queries = items_of(at(oracle(), &["dust", "queries"]));
    let mut errors = 0;
    for q in queries {
        let (region, city, date) = (
            text(at(q, &["region"])),
            text(at(q, &["city"])),
            text(at(q, &["date"])),
        );
        let got = dust_answer(&f, &region, &city, &date);
        match at(q, &["error"]).string() {
            Some(err) => {
                errors += 1;
                assert_eq!(got.unwrap_err(), err, "{region} {city} {date}");
            }
            None => same(
                &got.unwrap(),
                at(q, &["result"]),
                &format!("{region} {city} {date}"),
            ),
        }
    }
    assert!(errors > 0 && errors < queries.len());
}

#[test]
fn kst_instant_follows_legacy_parse_date_time() {
    assert_eq!(
        kst_instant("2026-10-14 24:00"),
        kst_instant("2026-10-15 00:00")
    );
    assert_eq!(kst_instant("2026-10-14 09:00"), 1_791_936_000_000.);
    for bad in [
        "2026-02-30 01:00",
        "2026-10-14 24:30",
        "2026-10-14 9:00",
        "2026-10-14T09:00",
        "",
    ] {
        assert!(kst_instant(bad).is_nan(), "{bad}");
    }
}
