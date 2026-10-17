//! S15b-1 S3 PATH: the oracle scenarios published to the S06 loopback S3 test peer and read back
//! High-read S3 cases reuse the existing bounded peer to avoid local ephemeral-port exhaustion.
//! by the S3 source with empty memory equal the legacy answers (listing windows, partition and
//! fetch-time filters included), plus the store behaviors review round 1 pinned
//! (S15b1-R1..R5). TEST ONLY.
use super::source::{at, docs_json, items_of, number, oracle, pages, same, text, zone_docs};
use super::source_s3::{Peer, Unreachable, deadline};
use serde_json::json;
use server2::domestic::kma::MidModel;
use server2::domestic::kma::source::{
    Family, LAND_CODES, POINT_NUMBERS, S3Source, Zones, collected, grid_documents,
};
use server2::domestic::publication::Publication;
use server2::gateway::OrderedJson;
use server2::history::Grid;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    Pagination, Period, ProviderKey, RawRecord,
};
use server2::world::BoundedS3;
use std::sync::Arc;

type Store = CatalogStore<BoundedS3<HttpS3Transport>>;

/// Publish one acquisition whose pages arrived at the given instants.
#[allow(clippy::too_many_arguments)]
async fn publish(
    store: &Store,
    source: &str,
    kind: &str,
    key: &ProviderKey,
    period: Period,
    partition: &str,
    pages: &[(f64, Vec<u8>)],
    content_type: &str,
) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, (fetched_at, page)) in pages.iter().enumerate() {
        let record = RawRecord::new(
            source,
            kind,
            key,
            period.clone(),
            *fetched_at as u64,
            200,
            content_type,
            Some(Pagination {
                page: i as u32 + 1,
                pages: n,
                complete: true,
            }),
            page.clone().into(),
            &limits.raw,
        )
        .unwrap();
        members.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, partition).unwrap()],
        });
        records.push(record);
    }
    let declaration = GroupDeclaration::new(members, &limits).unwrap();
    store
        .publish(declaration, records, deadline())
        .await
        .unwrap();
}
fn publication(partition: &str) -> Publication {
    let (d, t) = partition.split_once('-').unwrap();
    Publication::new(d.parse().unwrap(), t.parse().unwrap()).unwrap()
}
fn grid() -> Grid {
    Grid::new(60, 127).unwrap()
}
fn store(peer: &Peer) -> Store {
    CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap()
}
fn source(peer: &Peer, now: f64) -> S3Source<BoundedS3<HttpS3Transport>> {
    // The source also starts its station loads (S15b-2): stay well below the Python S3 peer's
    // connection limit, which drops connections under concurrency on Linux CI runners.
    S3Source::new(
        peer.transport_limited(4),
        Arc::new(move || now),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
}
fn family(name: &str) -> (Family, &'static str) {
    match name {
        "current" => (Family::Current, "ultra-srt-ncst"),
        "shortest" => (Family::Shortest, "ultra-srt-fcst"),
        _ => (Family::Short, "vilage-fcst"),
    }
}
const JSON: &str = "application/json";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn grid_documents_read_from_s3_equal_the_legacy_oracle() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    for sc in items_of(at(oracle(), &["grid"])) {
        let id = text(at(sc, &["id"]));
        let now = number(at(sc, &["at"]));
        let peer = Peer::persistent();
        let store = store(&peer);
        for run in items_of(at(sc, &["runs"])) {
            let (_, kind) = family(&text(at(run, &["family"])));
            let partition = text(at(run, &["period"]));
            let when = number(at(run, &["fetched_at"]));
            let p: Vec<(f64, Vec<u8>)> = pages(run).into_iter().map(|b| (when, b)).collect();
            publish(
                &store,
                "data-go-kr",
                kind,
                &grid().provider_key(),
                publication(&partition).period(),
                &partition,
                &p,
                JSON,
            )
            .await;
        }
        let s3 = source(&peer, now);
        let OrderedJson::Object(answers) = at(sc, &["answers"]) else {
            panic!("answers")
        };
        for (name, expected) in answers {
            let name = String::from_utf16(name).unwrap();
            let (f, _) = family(&name);
            let docs = s3
                .grid_answer(f, grid(), now, deadline())
                .await
                .unwrap_or_else(|e| panic!("{id} {name}: {e}"));
            same(&docs_json(&docs), expected, &format!("S3 {id} {name}"));
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rss_and_mid_documents_read_from_s3_equal_the_legacy_oracle() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    for sc in items_of(at(oracle(), &["rss"])) {
        let id = text(at(sc, &["id"]));
        let now = number(at(sc, &["at"]));
        let peer = Peer::persistent();
        let store = store(&peer);
        for run in items_of(at(sc, &["runs"])) {
            let expected = text(at(run, &["expected"]));
            let partition = format!("{}-{}", &expected[..8], &expected[8..]);
            publish(
                &store,
                "kma-web",
                "town-rss",
                &grid().provider_key(),
                publication(&partition).period(),
                &partition,
                &[(
                    number(at(run, &["fetched_at"])),
                    text(at(run, &["xml"])).into_bytes(),
                )],
                "application/xml",
            )
            .await;
        }
        let docs = source(&peer, now)
            .rss_answer(grid(), now, deadline())
            .await
            .unwrap_or_else(|e| panic!("{id}: {e}"));
        same(&docs_json(&docs), at(sc, &["answer"]), &format!("S3 {id}"));
    }
    // Mid: 2026-09-24 20:30 KST, after every run; the latest publication is 1800.
    let now = 1_790_249_400_000.;
    for sc in items_of(at(oracle(), &["mid"])) {
        let peer = Peer::persistent();
        let store = store(&peer);
        for run in items_of(at(sc, &["runs"])) {
            let kind = match text(at(run, &["kind"])).as_str() {
                "forecast" => "mid-fcst",
                "land" => "mid-land-fcst",
                _ => "mid-ta",
            };
            let code = text(at(run, &["code"]));
            let key = ProviderKey::Named {
                id: if kind == "mid-fcst" {
                    format!("stn-{}", code.to_ascii_lowercase())
                } else {
                    format!("reg-{}", code.to_ascii_lowercase())
                },
            };
            let tmfc = text(at(run, &["tmfc"]));
            let partition = format!("{}-{}", &tmfc[..8], &tmfc[8..]);
            let when = number(at(run, &["fetched_at"]));
            let p: Vec<(f64, Vec<u8>)> = pages(run).into_iter().map(|b| (when, b)).collect();
            publish(
                &store,
                "data-go-kr",
                kind,
                &key,
                publication(&partition).period(),
                &partition,
                &p,
                JSON,
            )
            .await;
        }
        let s3 = source(&peer, now);
        for answer in items_of(at(sc, &["answers"])) {
            let kind = text(at(answer, &["kind"]));
            let reg_id = text(at(answer, &["regId"]));
            let (model, legacy_collects) = match kind.as_str() {
                "forecast" => (MidModel::Forecast, POINT_NUMBERS.contains(&reg_id.as_str())),
                "land" => (MidModel::Land, LAND_CODES.contains(&reg_id.as_str())),
                _ => (MidModel::Temp, false),
            };
            let got = s3
                .mid_answer(model, &reg_id, legacy_collects, now, deadline())
                .await;
            if reg_id == "11D10000" {
                // Collected by legacy, but the scenario has no record and no acquirer: legacy's
                // empty answer (S15b-4a acquires it when an acquirer is configured).
                assert_eq!(docs_json(&got.unwrap()).to_bytes(), b"[]");
                continue;
            }
            same(
                &docs_json(&got.unwrap_or_else(|e| panic!("{kind} {reg_id}: {e}"))),
                at(answer, &["result"]),
                &format!("S3 mid {kind} {reg_id}"),
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forecast_zones_read_from_s3_equal_the_legacy_oracle() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    // 2026-10-14 00:00 UTC, inside the record history.
    let base = 1_791_936_000_000.;
    let key = ProviderKey::Named {
        id: "forecast-zones".into(),
    };
    for run in items_of(at(oracle(), &["zones", "runs"])) {
        let id = text(at(run, &["id"]));
        let peer = Peer::persistent();
        let store = store(&peer);
        let acquisitions = items_of(at(run, &["acquisitions"]));
        for (i, a) in acquisitions.iter().enumerate() {
            let when = base + i as f64 * 60_000.;
            let p: Vec<(f64, Vec<u8>)> = pages(a).into_iter().map(|b| (when, b)).collect();
            publish(
                &store,
                "data-go-kr",
                "forecast-zone",
                &key,
                Period {
                    local_date: 20261014,
                    slot: "0000".into(),
                },
                "20261014",
                &p,
                JSON,
            )
            .await;
        }
        let now = base + 3_600_000.;
        let zones = source(&peer, now)
            .zones(now, deadline())
            .await
            .map(|z| (*z).clone())
            .unwrap_or_default();
        same(
            &zone_docs(&zones),
            at(run, &["docs"]),
            &format!("S3 zones {id}"),
        );
    }
}

fn current_page(time: &str, t1h: &str) -> Vec<u8> {
    let items: Vec<serde_json::Value> = [
        ("PTY", "0"),
        ("REH", "60"),
        ("RN1", "0"),
        ("T1H", t1h),
        ("UUU", "1"),
        ("VEC", "90"),
        ("VVV", "1"),
        ("WSD", "2"),
    ]
    .iter()
    .map(|(c, v)| {
        json!({"baseDate": "20261014", "baseTime": time, "category": c, "nx": 60, "ny": 127,
               "obsrValue": v})
    })
    .collect();
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "OK"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": 8}}}),
    )
    .unwrap()
}

/// S15b1-R3: an acquisition counts from the arrival of its last page.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_acquisition_completed_after_the_request_instant_does_not_apply() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    // 2026-10-14 10:50 KST; the 1000 publication is complete at 10:41.
    let now = 1_791_942_600_000.;
    let peer = Peer::persistent();
    let store = store(&peer);
    let key = grid().provider_key();
    let put = async |time: &str, pages: &[(f64, Vec<u8>)]| {
        let partition = format!("20261014-{time}");
        publish(
            &store,
            "data-go-kr",
            "ultra-srt-ncst",
            &key,
            publication(&partition).period(),
            &partition,
            pages,
            JSON,
        )
        .await;
    };
    let t = |minutes: f64| now + minutes * 60_000.;
    put("1000", &[(t(-9.), current_page("1000", "20"))]).await;
    // The 0900 slot is fetched again: page 1 before the request instant, page 2 after it.
    put("0900", &[(t(-110.), current_page("0900", "18"))]).await;
    let late = vec![
        (t(-5.), current_page("0900", "30")),
        (t(5.), current_page("0900", "30")),
    ];
    put("0900", &late).await;
    let docs = source(&peer, now)
        .grid_answer(Family::Current, grid(), now, deadline())
        .await
        .unwrap();
    let t1h: Vec<f64> = docs
        .iter()
        .map(|d| {
            d.get("currentData")
                .and_then(|c| c.as_doc())
                .and_then(|c| c.get("t1h"))
                .and_then(|v| v.as_num())
                .unwrap()
        })
        .collect();
    assert_eq!(t1h, [18., 20.], "the late acquisition is not applied");
}

/// A getMidTa page; with `usable` false every temperature is outside (-50, 60).
fn temp_page(reg_id: &str, usable: bool) -> Vec<u8> {
    let mut o = serde_json::Map::new();
    o.insert("regId".into(), json!(reg_id));
    for d in 3..=10 {
        o.insert(format!("taMin{d}"), json!(if usable { 10 } else { 99 }));
        o.insert(format!("taMax{d}"), json!(if usable { 25 } else { 99 }));
    }
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "OK"},
        "body": {"dataType": "JSON", "items": {"item": [o]}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": 1}}}),
    )
    .unwrap()
}
fn zone_list(ids: &[(&str, &str, Option<f64>)]) -> Vec<u8> {
    let items: Vec<serde_json::Value> = ids
        .iter()
        .map(|(id, name, ht)| {
            let mut z = json!({"regId": id, "regName": name, "regSp": "C", "regEn": name});
            if let Some(ht) = ht {
                z["ht"] = json!(ht);
            }
            z
        })
        .collect();
    let n = items.len();
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "00", "resultMsg": "OK"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 1000,
                 "totalCount": n}}}),
    )
    .unwrap()
}
async fn put_zones(store: &Store, date: u32, when: f64, page: Vec<u8>) {
    publish(
        store,
        "data-go-kr",
        "forecast-zone",
        &ProviderKey::Named {
            id: "forecast-zones".into(),
        },
        Period {
            local_date: date,
            slot: "0000".into(),
        },
        &format!("{date}"),
        &[(when, page)],
        JSON,
    )
    .await;
}

/// S15b1-R2: retiring a zone stops future collection only; its stored document stays readable.
/// S15b1-R4: the last stored mid document survives failed newer publications in later months.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stored_mid_documents_outlive_retirement_and_failed_publications() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store = store(&peer);
    let key = ProviderKey::Named {
        id: "reg-11b10101".into(),
    };
    let put = async |partition: &str, when: f64, page: Vec<u8>| {
        publish(
            &store,
            "data-go-kr",
            "mid-ta",
            &key,
            publication(partition).period(),
            partition,
            &[(when, page)],
            JSON,
        )
        .await;
    };
    // 2026-09-30 18:00 KST publication stored; October publications without a usable value.
    put(
        "20260930-1800",
        1_790_758_920_000.,
        temp_page("11B10101", true),
    )
    .await;
    put(
        "20261005-0600",
        1_791_155_000_000.,
        temp_page("11B10101", false),
    )
    .await;
    // The zone list of 2026-10-05 no longer has 11B10101.
    put_zones(
        &store,
        20261005,
        1_791_150_000_000.,
        zone_list(&[("11B20201", "인천", None)]),
    )
    .await;
    let now = 1_791_162_000_000.; // 2026-10-05 10:00 KST: latest tmFc 0600.
    let s3 = source(&peer, now);
    let zones: Zones = (*s3.zones(now, deadline()).await.unwrap()).clone();
    assert!(
        !collected(MidModel::Temp, "11B10101", &zones),
        "retired: not collected"
    );
    let docs = s3
        .mid_answer(MidModel::Temp, "11B10101", false, now, deadline())
        .await
        .unwrap();
    assert_eq!(docs.len(), 1);
    let data = docs[0].get("data").and_then(|d| d.as_doc()).unwrap();
    assert_eq!(data.get("time").and_then(|v| v.as_str()), Some("1800"));
    assert_eq!(data.get("taMax3").and_then(|v| v.as_num()), Some(25.));
    // A collected region whose latest publication was attempted keeps the older document too.
    let collected_docs = s3
        .mid_answer(MidModel::Temp, "11B10101", true, now, deadline())
        .await
        .unwrap();
    same(
        &docs_json(&collected_docs),
        &docs_json(&docs),
        "collected region",
    );
}

/// S15b1-R5: fields set by an older zone list and omitted by a newer one stay (legacy `$set`).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forecast_zone_fields_from_older_months_are_kept() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store = store(&peer);
    put_zones(
        &store,
        20260710,
        1_783_641_600_000.,
        zone_list(&[("11B10101", "서울", Some(12.5))]),
    )
    .await;
    put_zones(
        &store,
        20261013,
        1_791_849_600_000.,
        zone_list(&[("11B10101", "서울", None)]),
    )
    .await;
    let now = 1_791_936_000_000.;
    let zones = source(&peer, now).zones(now, deadline()).await.unwrap();
    let found = zones.find_by_name("서울특별시", "종로구");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].get("ht").and_then(|v| v.as_num()), Some(12.5));
}

/// S15b1-R1: a short publication more than 10 days old still owns retained slots.
#[test]
fn the_short_lookback_covers_retained_slots_of_old_publications() {
    let sc = items_of(at(oracle(), &["grid"]))
        .iter()
        .find(|s| text(at(s, &["id"])) == "short-retention")
        .unwrap();
    let now = number(at(sc, &["at"]));
    let oldest = items_of(at(sc, &["runs"]))
        .iter()
        .map(|r| number(at(r, &["fetched_at"])))
        .fold(f64::INFINITY, f64::min);
    assert!(
        now - oldest > 10. * 86_400_000.,
        "the scenario spans more than 10 days"
    );
    let docs = items_of(at(sc, &["answers", "short"]));
    let first = text(at(&docs[0], &["shortData", "date"]));
    assert_eq!(
        first, "20260914",
        "legacy retains rows of the 0913 publication"
    );
    let _ = grid_documents;
}

/// S15b1-R7: a list published after the memory fold but completed before the last folded one is
/// not appended out of order: the refresh refolds, so warm memory equals a cold fold.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_late_zone_list_refolds_instead_of_being_skipped() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::persistent();
    let store = store(&peer);
    let t0 = 1_791_849_600_000.; // 2026-10-13 09:00 KST
    let t1 = t0 + 3_600_000.;
    let now = t1 + 3_600_000.;
    // List B (without ht) is published first; list A (ht 12.5) completed earlier, published later.
    put_zones(
        &store,
        20261013,
        t1,
        zone_list(&[("11B10101", "서울", None)]),
    )
    .await;
    let s3 = source(&peer, now);
    let warm = s3.zones(now, deadline()).await.unwrap();
    assert!(
        warm.find_by_name("서울특별시", "종로구")[0]
            .get("ht")
            .is_none()
    );
    put_zones(
        &store,
        20261013,
        t0,
        zone_list(&[("11B10101", "서울", Some(12.5))]),
    )
    .await;
    let refreshed = s3.refresh_zones(now, deadline()).await.unwrap();
    let cold = source(&peer, now).zones(now, deadline()).await.unwrap();
    same(
        &zone_docs(&refreshed),
        &zone_docs(&cold),
        "warm refresh equals a cold fold",
    );
    let found = refreshed.find_by_name("서울특별시", "종로구");
    assert_eq!(found[0].get("ht").and_then(|v| v.as_num()), Some(12.5));
    // A newer list in the window is appended incrementally.
    put_zones(
        &store,
        20261013,
        now - 60_000.,
        zone_list(&[("11B20201", "인천", None)]),
    )
    .await;
    let appended = s3.refresh_zones(now, deadline()).await.unwrap();
    let cold = source(&peer, now).zones(now, deadline()).await.unwrap();
    same(
        &zone_docs(&appended),
        &zone_docs(&cold),
        "incremental append equals a cold fold",
    );
}
