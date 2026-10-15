//! S15b-3b LIFE: area numbers, life-index, KASI and MFDS documents and reader answers rebuilt
//! from raw provider items equal the pinned legacy oracle (`fixtures/life.json.gz`, see
//! `fixtures/LIFE-PROVENANCE.md`): the legacy collectors and tw_svc readers with Mongoose 5.1.2
//! over an in-memory collection double, fed the same synthetic items.
use super::source::{at, items_of, number, same, text};
use server2::domestic::kma::source::kasi::RiseSets;
use server2::domestic::kma::source::life::{LifeIndex, areas};
use server2::domestic::kma::source::mfds::FoodPoisoning;
use server2::domestic::mfds::parse;
use server2::gateway::OrderedJson;
use std::{io::Read, sync::OnceLock};

pub const LIFE_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/life.json.gz"
);
pub fn oracle() -> &'static OrderedJson {
    static ORACLE: OnceLock<OrderedJson> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(LIFE_FIXTURE).unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut raw)
            .unwrap();
        OrderedJson::parse(&raw).unwrap()
    })
}
pub fn value(j: &OrderedJson) -> serde_json::Value {
    serde_json::from_slice(&j.to_bytes()).unwrap()
}
fn items(j: &OrderedJson) -> Vec<serde_json::Value> {
    items_of(j).iter().map(value).collect()
}
/// The oracle documents without `_id` grouped by `areaNo` (ascending), each area in natural
/// order: the order [`LifeIndex::json`] lists them.
fn by_area(docs: &OrderedJson) -> OrderedJson {
    let mut list: Vec<(f64, usize, OrderedJson)> = items_of(docs)
        .iter()
        .enumerate()
        .map(|(i, d)| (number(at(d, &["areaNo"])), i, d.clone()))
        .collect();
    list.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    OrderedJson::Array(list.into_iter().map(|(_, _, d)| d).collect())
}
/// Life-index runs in completion order: (legacy kind, completion instant, items).
pub fn life_runs() -> Vec<(String, f64, Vec<serde_json::Value>)> {
    items_of(at(oracle(), &["life", "runs"]))
        .iter()
        .map(|r| {
            (
                text(at(r, &["kind"])),
                number(at(r, &["fetched"])),
                items(at(r, &["items"])),
            )
        })
        .collect()
}
/// The life fold of every run completed by `now`.
fn life_at(now: f64) -> LifeIndex {
    let mut life = LifeIndex::default();
    for (kind, fetched, items) in life_runs() {
        if fetched <= now {
            life.apply(&kind, fetched, &items);
        }
    }
    life
}

#[test]
fn area_numbers_equal_the_legacy_area_no_list() {
    let a = oracle();
    assert_eq!(areas().len() as f64, number(at(a, &["area", "base"])));
    same(&areas().json(), at(a, &["area", "docs"]), "areaNoList");
    for q in items_of(at(a, &["area", "byTown"])) {
        let args: Vec<String> = items_of(at(q, &["args"])).iter().map(text).collect();
        same(
            &areas().by_town(&args[0], &args[1], &args[2]),
            at(q, &["result"]),
            &format!("findAreaNo {args:?}"),
        );
    }
    for q in items_of(at(a, &["area", "near"])) {
        let p = items_of(at(q, &["args"]));
        same(
            &areas().near(number(&p[0]), number(&p[1])),
            at(q, &["result"]),
            "findNearAreaNo",
        );
    }
    // The 2018 list never added a town: every new town's geocode threw (Kakao string x/y).
    assert!(!items_of(at(a, &["area", "geocoded"])).is_empty());
}

#[test]
fn life_index_fold_and_reader_equal_legacy() {
    let l = at(oracle(), &["life"]);
    let all = life_at(f64::INFINITY);
    same(&all.json(), &by_area(at(l, &["docs"])), "lifeIndexKma2");
    let mut checked = 0;
    for q in items_of(at(l, &["queries"])) {
        let now = number(at(q, &["now"]));
        let area: f64 = text(at(q, &["areaNo"])).parse().unwrap();
        let answer = life_at(now).by_area(area);
        match at(q, &["error"]).string() {
            // `_fromLifeIndexDb2` turns an empty list into its error.
            Some(_) => same(&answer, &OrderedJson::Array(vec![]), "no documents"),
            None => same(
                &answer,
                at(q, &["result"]),
                &format!("areaNo {area} at {now}"),
            ),
        }
        checked += 1;
    }
    assert_eq!(checked, 28);
    // The 12-day fixture crosses the retention boundary: documents an early answer holds are
    // removed by later UV runs (`_removeOldData`), in the fold as in legacy.
    let early = number(at(&items_of(at(l, &["queries"]))[0], &["now"]));
    let before =
        serde_json::from_slice::<serde_json::Value>(&life_at(early).json().to_bytes()).unwrap();
    let after = serde_json::from_slice::<serde_json::Value>(&all.json().to_bytes()).unwrap();
    let key = |d: &serde_json::Value| {
        (
            d["date"]["$date"].as_f64().unwrap() as i64,
            d["areaNo"].as_f64().unwrap() as i64,
            d["indexType"].as_str().unwrap().to_owned(),
        )
    };
    let kept: std::collections::HashSet<_> = after.as_array().unwrap().iter().map(key).collect();
    let removed = before
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| !kept.contains(&key(d)))
        .count();
    assert!(removed > 0, "documents removed at the retention boundary");
    // A repeated issuance is skipped (lastIssued) and the last issuance per kind is kept.
    assert_eq!(all.last_issued("ultrv"), Some("2026101412"));
}

#[test]
fn pollen_day_three_stays_in_server2_data_but_not_in_the_legacy_answer() {
    let all = life_at(f64::INFINITY);
    let day3 = all.pollen_day3(1_100_000_000.);
    assert!(!day3.is_empty(), "twodaysaftertomorrow kept");
    for d in &day3 {
        assert!((0. ..=3.).contains(&d.index));
        // Legacy reads `todaysaftertomorrow`, which the provider does not send: no stored
        // document has the day+3 date of its issuance unless that synthetic field was set.
        assert_eq!(d.issued.len(), 10);
    }
}

#[test]
fn kasi_documents_and_answers_equal_legacy() {
    let k = at(oracle(), &["kasi"]);
    let mut rs = RiseSets::default();
    for run in items_of(at(k, &["runs"])) {
        rs.apply(
            &text(at(run, &["area"])),
            &text(at(run, &["day"])),
            &value(at(run, &["raw"])),
        );
    }
    same(&rs.json(), at(k, &["docs"]), "kasiRiseSet");
    for q in items_of(at(k, &["queries"])) {
        let dates: Vec<String> = items_of(at(q, &["dates"])).iter().map(text).collect();
        same(
            &rs.answer(&value(at(q, &["geocode"])), &dates),
            at(q, &["result"]),
            "getRiseSetList",
        );
    }
}

#[test]
fn mfds_documents_and_reader_equal_legacy() {
    let m = at(oracle(), &["mfds"]);
    let mut fp = FoodPoisoning::default();
    for run in items_of(at(m, &["runs"])) {
        let rows = parse(&value(at(run, &["body"])), number(at(run, &["now"]))).unwrap();
        assert_eq!(rows.len() as f64, number(at(run, &["saved"])));
        fp.apply(&rows);
    }
    same(&fp.json(), at(m, &["docs"]), "mfds_food_poisoning");
    for q in items_of(at(m, &["queries"])) {
        let a: Vec<String> = items_of(at(q, &["args"])).iter().map(text).collect();
        same(
            &fp.find(&a[0], &a[1], &a[2], &a[3]),
            at(q, &["result"]),
            &format!("find {a:?}"),
        );
    }
}
