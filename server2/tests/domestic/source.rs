//! S15b-1 SOURCE: legacy documents rebuilt from repository data and server2 raw records equal
//! the pinned legacy oracle (`fixtures/source.json.gz`, see `fixtures/SOURCE-PROVENANCE.md`):
//! legacy code with Mongoose 5.1.2 over an in-memory collection double, fed the same inputs.
use server2::domestic::kma::MidModel;
use server2::domestic::kma::source::{
    Coord, Doc, Family, Fetched, Organized, Slot, Val, Zones, collect, complete_list, find_town,
    grid_documents, grid_of, items, mid_documents, region_code, region_table, rss_documents,
    special_zone_docs, towns, zone_documents,
};
use server2::gateway::OrderedJson;
use server2::warnings::zones::{Entry, ZoneState};
use std::{io::Read, sync::Arc, sync::OnceLock};

pub const SOURCE_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/source.json.gz"
);
pub fn oracle() -> &'static OrderedJson {
    static ORACLE: OnceLock<OrderedJson> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(SOURCE_FIXTURE).unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut raw)
            .unwrap();
        OrderedJson::parse(&raw).unwrap()
    })
}
pub fn at<'a>(j: &'a OrderedJson, path: &[&str]) -> &'a OrderedJson {
    path.iter().fold(j, |j, k| {
        j.get(k)
            .unwrap_or_else(|| panic!("fixture path {path:?} at {k}"))
    })
}
pub fn items_of(j: &OrderedJson) -> &[OrderedJson] {
    match j {
        OrderedJson::Array(a) => a,
        other => panic!("expected array, got {other:?}"),
    }
}
fn text(j: &OrderedJson) -> String {
    j.string()
        .unwrap_or_else(|| panic!("expected string, got {j:?}"))
}
fn number(j: &OrderedJson) -> f64 {
    j.number()
        .unwrap_or_else(|| panic!("expected number, got {j:?}"))
}
pub fn docs_json(docs: &[Doc]) -> OrderedJson {
    OrderedJson::Array(docs.iter().map(Doc::json).collect())
}
/// Byte equality of two ordered JSON values with the first difference in the message.
pub fn same(actual: &OrderedJson, expected: &OrderedJson, what: &str) {
    let (a, e) = (actual.to_bytes(), expected.to_bytes());
    if a != e {
        let i = a.iter().zip(&e).take_while(|(x, y)| x == y).count();
        let window = |b: &[u8]| {
            String::from_utf8_lossy(&b[i.saturating_sub(120)..(i + 120).min(b.len())]).into_owned()
        };
        panic!(
            "{what}: differs at byte {i}\n  actual: ...{}\nexpected: ...{}",
            window(&a),
            window(&e)
        );
    }
}
fn fetched(at_ms: f64, partition: &str, pages: Vec<Vec<u8>>) -> Fetched {
    Fetched {
        fetched_at_ms: at_ms as u64,
        partition: partition.into(),
        pages: pages.into_iter().map(Arc::from).collect(),
    }
}
fn pages(run: &OrderedJson) -> Vec<Vec<u8>> {
    items_of(at(run, &["pages"]))
        .iter()
        .map(|p| text(p).into_bytes())
        .collect()
}

#[test]
fn towns_rebuild_the_legacy_load_order_and_documents() {
    let expected = at(oracle(), &["towns", "list"]);
    same(&docs_json(towns()), expected, "towns");
    let part = number(at(oracle(), &["towns", "part_rows"])) as usize;
    assert_eq!(part, 134);
    assert_eq!(towns().len(), 4652);
}

#[test]
fn town_lookup_matches_legacy_find() {
    for probe in items_of(at(oracle(), &["towns", "town"])) {
        let args: Vec<String> = items_of(at(probe, &["args"])).iter().map(text).collect();
        let found: Vec<Doc> = find_town(towns(), Some(&args[0]), Some(&args[1]), Some(&args[2]))
            .into_iter()
            .cloned()
            .collect();
        same(
            &docs_json(&found),
            at(probe, &["result"]),
            &format!("town {args:?}"),
        );
    }
}

#[test]
fn coordinate2xy_matches_legacy_grid() {
    for p in items_of(at(oracle(), &["towns", "points"])) {
        let v: Vec<f64> = items_of(p).iter().map(number).collect();
        assert_eq!(grid_of(v[0], v[1]), (v[2], v[3]), "grid of {:?}", &v[..2]);
    }
}

#[test]
fn region_code_matches_get_reg_id_by_town() {
    let table = items_of(at(oracle(), &["region", "table"]));
    assert_eq!(table.len(), region_table().len());
    for (row, expected) in region_table().iter().zip(table) {
        same(&row.doc().json(), expected, "region table row");
    }
    for case in items_of(at(oracle(), &["region", "cases"])) {
        let args: Vec<String> = items_of(at(case, &["args"])).iter().map(text).collect();
        match (region_code(&args[0], &args[1]), case.get("error")) {
            (Ok(row), None) => same(&row.doc().json(), at(case, &["result"]), "region row"),
            (Err(message), Some(e)) => assert_eq!(message, text(e), "{args:?}"),
            (got, _) => panic!("{args:?}: {got:?} vs {case:?}"),
        }
    }
}

/// Stored zone documents with the run-time `retiredAt` normalized like the oracle.
fn zone_docs(zones: &Zones) -> OrderedJson {
    let docs: Vec<Doc> = zones
        .docs()
        .iter()
        .map(|d| {
            let mut d = d.clone();
            if d.has("retiredAt") {
                d.set("retiredAt", Val::str("run-time"));
            }
            d
        })
        .collect();
    docs_json(&docs)
}

#[test]
fn forecast_zones_match_legacy_get_from_kma() {
    for run in items_of(at(oracle(), &["zones", "runs"])) {
        let id = text(at(run, &["id"]));
        let acquisitions = items_of(at(run, &["acquisitions"]));
        let steps = items_of(at(run, &["steps"]));
        let mut list = Vec::new();
        for (i, (a, step)) in acquisitions.iter().zip(steps).enumerate() {
            let p = pages(a);
            let refs: Vec<&[u8]> = p.iter().map(Vec::as_slice).collect();
            let failed = !matches!(step.get("error"), Some(OrderedJson::Null) | None);
            assert_eq!(
                complete_list(&refs).is_none(),
                failed,
                "{id} acquisition {i}"
            );
            list.push(fetched(1_000. + i as f64, "20260924", p));
        }
        let zones = zone_documents(&list, 1e15).unwrap_or_default();
        same(
            &zone_docs(&zones),
            at(run, &["docs"]),
            &format!("{id} docs"),
        );
        for q in items_of(at(run, &["queries"])) {
            let args: Vec<String> = items_of(at(q, &["args"])).iter().map(text).collect();
            same(
                &docs_json(&zones.find_by_name(&args[0], &args[1])),
                at(q, &["result"]),
                &format!("{id} {args:?}"),
            );
        }
    }
}

/// S13b stores only the data pages of a list; the `03` page that ended a list of full pages
/// leaves no record, and the stored full pages are the complete list.
#[test]
fn a_full_last_page_without_the_end_page_is_the_complete_list() {
    let run = items_of(at(oracle(), &["zones", "runs"]))
        .iter()
        .find(|r| text(at(r, &["id"])) == "two-pages-03-end")
        .unwrap();
    let p = pages(&items_of(at(run, &["acquisitions"]))[0]);
    assert_eq!(p.len(), 2);
    let with: Vec<&[u8]> = p.iter().map(Vec::as_slice).collect();
    let without = &with[..1];
    let (a, b) = (
        complete_list(&with).unwrap(),
        complete_list(without).unwrap(),
    );
    assert_eq!(a.len(), 1000);
    assert_eq!(a, b);
    // A first page that is missing is never a list.
    assert!(complete_list(&[]).is_none());
}

fn family(name: &str) -> Family {
    match name {
        "current" => Family::Current,
        "shortest" => Family::Shortest,
        "short" => Family::Short,
        other => panic!("family {other}"),
    }
}
const GRID: Coord = Coord { mx: 60., my: 127. };

#[test]
fn grid_collection_steps_match_legacy_outcomes() {
    for sc in items_of(at(oracle(), &["grid"])) {
        let id = text(at(sc, &["id"]));
        let mut runs: Vec<&OrderedJson> = items_of(at(sc, &["runs"])).iter().collect();
        runs.sort_by(|a, b| {
            number(at(a, &["fetched_at"])).total_cmp(&number(at(b, &["fetched_at"])))
        });
        let outcomes = items_of(at(sc, &["outcomes"]));
        assert_eq!(runs.len(), outcomes.len());
        for (run, expected) in runs.iter().zip(outcomes) {
            let f = family(&text(at(run, &["family"])));
            let slot = Slot::new(
                &text(at(run, &["slot", "date"])),
                &text(at(run, &["slot", "time"])),
            );
            let p = pages(run);
            let refs: Vec<&[u8]> = p.iter().map(Vec::as_slice).collect();
            let got = match items(&refs) {
                None => "KMA incomplete or inconsistent response",
                Some(list) => match collect(f, &list, &slot, GRID) {
                    Organized::Rows(_) => "saved",
                    Organized::InvalidForecast => {
                        "KMA invalid forecast publication, coordinate or value"
                    }
                    Organized::Failed => "KMA response organization failed",
                    Organized::BatchRejected => "batch-rejected",
                },
            };
            assert_eq!(
                got,
                text(at(expected, &["outcome"])),
                "{id} {} {:?}",
                text(at(run, &["period"])),
                slot
            );
        }
    }
}

#[test]
fn grid_documents_match_legacy_saves_and_retention() {
    for sc in items_of(at(oracle(), &["grid"])) {
        let id = text(at(sc, &["id"]));
        let now = number(at(sc, &["at"]));
        let answers = at(sc, &["answers"]);
        let OrderedJson::Object(entries) = answers else {
            panic!("answers")
        };
        for (name, expected) in entries {
            let name = String::from_utf16(name).unwrap();
            let f = family(&name);
            let list: Vec<Fetched> = items_of(at(sc, &["runs"]))
                .iter()
                .filter(|r| text(at(r, &["family"])) == name)
                .map(|r| {
                    fetched(
                        number(at(r, &["fetched_at"])),
                        &text(at(r, &["period"])),
                        pages(r),
                    )
                })
                .collect();
            let mut list = list;
            list.sort_by_key(|f| f.fetched_at_ms);
            same(
                &docs_json(&grid_documents(f, GRID, &list, now)),
                expected,
                &format!("{id} {name}"),
            );
        }
    }
}

#[test]
fn rss_documents_match_legacy_town_rss() {
    for sc in items_of(at(oracle(), &["rss"])) {
        let id = text(at(sc, &["id"]));
        let now = number(at(sc, &["at"]));
        let mut list: Vec<Fetched> = items_of(at(sc, &["runs"]))
            .iter()
            .map(|r| {
                let expected = text(at(r, &["expected"]));
                let partition = format!("{}-{}", &expected[..8], &expected[8..]);
                fetched(
                    number(at(r, &["fetched_at"])),
                    &partition,
                    vec![text(at(r, &["xml"])).into_bytes()],
                )
            })
            .collect();
        list.sort_by_key(|f| f.fetched_at_ms);
        same(
            &docs_json(&rss_documents(GRID, &list, now)),
            at(sc, &["answer"]),
            &id,
        );
    }
}

#[test]
fn mid_documents_match_legacy_save_mid() {
    for sc in items_of(at(oracle(), &["mid"])) {
        let runs = items_of(at(sc, &["runs"]));
        for answer in items_of(at(sc, &["answers"])) {
            let kind = text(at(answer, &["kind"]));
            let reg_id = text(at(answer, &["regId"]));
            let model = match kind.as_str() {
                "forecast" => MidModel::Forecast,
                "land" => MidModel::Land,
                _ => MidModel::Temp,
            };
            let mut list: Vec<Fetched> = runs
                .iter()
                .filter(|r| text(at(r, &["kind"])) == kind && text(at(r, &["code"])) == reg_id)
                .map(|r| {
                    let tmfc = text(at(r, &["tmfc"]));
                    fetched(
                        number(at(r, &["fetched_at"])),
                        &format!("{}-{}", &tmfc[..8], &tmfc[8..]),
                        pages(r),
                    )
                })
                .collect();
            list.sort_by_key(|f| f.fetched_at_ms);
            same(
                &docs_json(&mid_documents(model, &reg_id, &list, 1e15)),
                at(answer, &["result"]),
                &format!("mid {kind} {reg_id}"),
            );
        }
    }
}

#[test]
fn special_zones_are_active_warning_entries_of_the_codes() {
    let entry = |code: &str, var: f64, active: bool| Entry {
        area_code: code.into(),
        area_name: format!("{code} name"),
        warn_var: var,
        warn_stress: 1.,
        active,
        command: if active { "1".into() } else { "3".into() },
        event_tm_fc: 202609240100.,
        event_tm_seq: 2.,
        event_rank: 1.,
    };
    let mut state = ZoneState::default();
    state.insert(entry("L1100100", 3., true));
    state.insert(entry("L1100200", 0., true));
    state.insert(entry("L1100300", 2., false));
    state.insert(entry("L1100400", 1., true));
    state.insert(entry("L9999999", 1., true));
    let codes: Vec<String> = ["L1100400", "L1100100", "L1100200", "L1100300"]
        .map(String::from)
        .to_vec();
    let docs = special_zone_docs(&state, &codes);
    let got: Vec<&str> = docs
        .iter()
        .map(|d| d.get("areaCode").and_then(Val::as_str).unwrap())
        .collect();
    assert_eq!(
        got,
        ["L1100100", "L1100400"],
        "state order, active, warnVar > 0"
    );
    let first = &docs[0];
    for key in ["areaName", "warnVar", "warnStress", "active", "eventTmFc"] {
        assert!(first.has(key), "{key}");
    }
}
