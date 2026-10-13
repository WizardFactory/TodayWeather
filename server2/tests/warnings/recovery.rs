//! Durable recovery on the owned loopback S3 peer: empty memory, no provider, faults.
use super::common::*;
use server2::{
    gateway::OrderedJson,
    storage::{CatalogLimits, HttpS3Transport},
    warnings::{
        ServiceConfig, StoreConfig, Town, WarningService, WarningStore,
        provider::Operation,
        records::{self, Member},
    },
};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

fn member(op: Operation, body: &[u8], fetched: &str) -> Member {
    Member {
        role: op.role().into(),
        bytes: body.to_vec().into(),
        fetched_at_ms: ms(fetched) as u64,
    }
}
fn store_with(peer: &Peer) -> Arc<WarningStore<HttpS3Transport>> {
    let limits = CatalogLimits {
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let config = StoreConfig::default();
    Arc::new(WarningStore::new(peer.transport(), limits, config).unwrap())
}
fn service_on(
    store: Arc<WarningStore<HttpS3Transport>>,
    clock: Arc<FixedClock>,
    refresh: Duration,
) -> WarningService<HttpS3Transport> {
    WarningService::new(
        store,
        clock,
        ServiceConfig {
            refresh,
            deadline: Duration::from_secs(9),
            ..ServiceConfig::default()
        },
    )
}
/// Recorded provider acquisitions of 2026-09-26/27 (type 1 with its bulletin page).
async fn publish_recorded(store: &WarningStore<HttpS3Transport>) {
    let at = "2026-09-27T00:20:00.000Z";
    store
        .publish(
            "bulletin-1",
            20260926,
            vec![
                member(Operation::PwnStatus, PWN_STATUS.as_bytes(), at),
                member(Operation::WrnMsg, WRN_MSG.as_bytes(), at),
            ],
            deadline(),
        )
        .await
        .unwrap();
    store
        .publish(
            "bulletin-2",
            20260926,
            vec![member(Operation::WthrPwn, WTHR_PWN.as_bytes(), at)],
            deadline(),
        )
        .await
        .unwrap();
    store
        .publish(
            "bulletin-3",
            20260927,
            vec![member(Operation::WthrInfo, WTHR_INFO.as_bytes(), at)],
            deadline(),
        )
        .await
        .unwrap();
    store
        .publish(
            "bulletin-4",
            20260927,
            vec![member(Operation::BrkNews, BRK_NEWS.as_bytes(), at)],
            deadline(),
        )
        .await
        .unwrap();
}
fn types(list: &OrderedJson) -> Vec<(f64, String)> {
    let OrderedJson::Array(items) = list else {
        panic!()
    };
    items
        .iter()
        .map(|i| {
            (
                i.get("type").unwrap().number().unwrap(),
                i.get("announcement").unwrap().string().unwrap(),
            )
        })
        .collect()
}
#[tokio::test]
async fn week_old_provider_bulletins_recover_from_s3_alone() {
    let peer = Peer::new();
    publish_recorded(&peer.store()).await;
    // Replacement host one week later: fresh store/service, empty memory, no provider source.
    let clock = FixedClock::at("2026-10-04T00:10:00.000Z");
    let service = peer.service(clock);
    let list = service.special(true).await.unwrap();
    assert_eq!(
        types(&list),
        vec![
            (1., "2026-09-26T03:00:00.000Z".into()),
            (2., "2026-09-25T21:00:00.000Z".into()),
            (3., "2026-09-26T20:40:00.000Z".into()),
        ]
    );
    let type1 = &match &list {
        OrderedJson::Array(a) => a.clone(),
        _ => unreachable!(),
    }[0];
    let bulletin = type1.get("bulletin").unwrap();
    let msg = items(WRN_MSG)
        .into_iter()
        .find(|m| m["tmSeq"] == 130)
        .unwrap();
    assert_eq!(
        bulletin.get("title").unwrap().string().unwrap(),
        msg["t1"].as_str().unwrap().replace('\r', "").trim()
    );
    assert_eq!(type1.get("comment").unwrap().string().unwrap(), "o 없음");
    assert_eq!(type1.get("name").unwrap().string().unwrap(), "기상특보");
    let type2 = &match &list {
        OrderedJson::Array(a) => a.clone(),
        _ => unreachable!(),
    }[1];
    let expected: serde_json::Value = oracle()["preliminary"]["pwn"].clone();
    let got: serde_json::Value =
        serde_json::from_slice(&type2.get("situationList").unwrap().to_bytes()).unwrap();
    assert_eq!(got, expected);
    // Type 2 comment: legacy cleanText then _insertLineChange before 'o'.
    assert!(
        type2
            .get("comment")
            .unwrap()
            .string()
            .unwrap()
            .starts_with("<예비특보 추가 발표 현황> \n\n\no 당초")
    );
    // The English locale only changes names.
    let en = service.special(false).await.unwrap();
    assert_eq!(types(&en), types(&list));
}
#[tokio::test]
async fn weather_flash_follows_legacy_plus_nineteen_hours() {
    let peer = Peer::new();
    publish_recorded(&peer.store()).await;
    // brk-news latest tmFc 202609270910 KST = actual 2026-09-27T00:10Z.
    for (now, present) in [
        ("2026-09-27T10:10:00.000Z", true),
        ("2026-09-27T19:10:00.000Z", true),
        ("2026-09-27T19:10:00.001Z", false),
    ] {
        let service = peer.service(FixedClock::at(now));
        let list = service.special(true).await.unwrap();
        let kinds: Vec<f64> = types(&list).into_iter().map(|t| t.0).collect();
        assert_eq!(kinds.first() == Some(&4.), present, "{now}");
        assert_eq!(kinds.len(), if present { 4 } else { 3 });
    }
    // A warm process applies the same boundary to its memory result.
    let clock = FixedClock::at("2026-09-27T19:10:00.000Z");
    let service = peer.service(clock.clone());
    assert_eq!(types(&service.special(true).await.unwrap()).len(), 4);
    clock.set("2026-09-27T19:10:00.001Z");
    assert_eq!(types(&service.special(true).await.unwrap()).len(), 3);
}
fn type2_body(tm_fc: i64, rem: &str) -> Vec<u8> {
    provider_body(&[
        serde_json::json!({"stnId": "108", "tmFc": tm_fc, "tmSeq": 1, "pwn": "o 없음", "rem": rem}),
    ])
}
async fn latest_type2(peer: &Peer) -> String {
    let service = peer.service(FixedClock::at("2026-09-30T00:00:00.000Z"));
    let list = service.special(true).await.unwrap();
    types(&list).into_iter().find(|t| t.0 == 2.).unwrap().1
}
#[tokio::test]
async fn interrupted_publication_never_loses_acknowledged_latest() {
    let peer = Peer::new();
    let store = peer.store();
    publish_recorded(&store).await;
    let acknowledged = "2026-09-25T21:00:00.000Z";
    assert_eq!(latest_type2(&peer).await, acknowledged);
    let limits = CatalogLimits::default();
    let newer = vec![Member {
        role: Operation::WthrPwn.role().into(),
        bytes: type2_body(202609281000, "newer").into(),
        fetched_at_ms: ms("2026-09-28T01:01:00.000Z") as u64,
    }];
    let (declaration, raw) =
        records::group("bulletin-2", 20260928, newer.clone(), &limits).unwrap();
    let raw_key = raw[0].envelope.identity.object_key().unwrap();
    let descriptor_key = declaration
        .reference(&limits)
        .unwrap()
        .descriptor_key()
        .unwrap();
    let catalog_key = records::catalog("bulletin-2", 20260928).unwrap().key();
    for key in [&descriptor_key, &raw_key, &catalog_key] {
        peer.fault("reject", key).await;
        assert!(
            store
                .publish("bulletin-2", 20260928, newer.clone(), deadline())
                .await
                .is_err()
        );
        // Not acknowledged: the previously acknowledged latest is still served from S3.
        assert_eq!(latest_type2(&peer).await, acknowledged, "fault on {key}");
        peer.fault("clear", key).await;
    }
    // After writes recover, the complete orphan group is repaired and becomes servable.
    assert_eq!(latest_type2(&peer).await, "2026-09-28T01:00:00.000Z");

    // A partial multi-page group (second page rejected) is never served.
    let pages = vec![
        Member {
            role: Operation::WthrPwn.role().into(),
            bytes: type2_body(202609291000, "page-one").into(),
            fetched_at_ms: ms("2026-09-29T01:01:00.000Z") as u64,
        },
        Member {
            role: Operation::WthrPwn.role().into(),
            bytes: type2_body(202609291100, "page-two").into(),
            fetched_at_ms: ms("2026-09-29T01:01:01.000Z") as u64,
        },
    ];
    let (_, raw) = records::group("bulletin-2", 20260929, pages.clone(), &limits).unwrap();
    let second = raw[1].envelope.identity.object_key().unwrap();
    peer.fault("reject", &second).await;
    assert!(
        store
            .publish("bulletin-2", 20260929, pages, deadline())
            .await
            .is_err()
    );
    assert_eq!(latest_type2(&peer).await, "2026-09-28T01:00:00.000Z");
    peer.fault("clear", &second).await;

    // An ambiguous catalog commit is reconciled from actual catalogs.
    let later = vec![Member {
        role: Operation::WthrPwn.role().into(),
        bytes: type2_body(202609291200, "later").into(),
        fetched_at_ms: ms("2026-09-29T03:01:00.000Z") as u64,
    }];
    peer.fault(
        "drop-commit",
        &records::catalog("bulletin-2", 20260929).unwrap().key(),
    )
    .await;
    let _ = store
        .publish("bulletin-2", 20260929, later, deadline())
        .await;
    assert_eq!(latest_type2(&peer).await, "2026-09-29T03:00:00.000Z");
}
#[tokio::test]
async fn missing_catalog_is_repaired_from_raw_records() {
    let peer = Peer::new();
    publish_recorded(&peer.store()).await;
    peer.fault(
        "forget",
        &records::catalog("bulletin-3", 20260927).unwrap().key(),
    )
    .await;
    let service = peer.service(FixedClock::at("2026-10-04T00:10:00.000Z"));
    let kinds: Vec<f64> = types(&service.special(true).await.unwrap())
        .into_iter()
        .map(|t| t.0)
        .collect();
    assert_eq!(kinds, vec![1., 2., 3.]);
    let store = service.store();
    assert!(
        store
            .counters
            .repaired_days
            .load(std::sync::atomic::Ordering::Relaxed)
            >= 1
    );
}
#[tokio::test]
async fn s3_outage_uses_valid_memory_or_legacy_error() {
    let mut peer = Peer::new();
    publish_recorded(&peer.store()).await;
    let clock = FixedClock::at("2026-10-04T00:10:00.000Z");
    // Refresh on every request; stale memory (300 s) is the outage fallback.
    let warm = service_on(store_with(&peer), clock.clone(), Duration::ZERO);
    assert_eq!(types(&warm.special(true).await.unwrap()).len(), 3);
    let cold = service_on(store_with(&peer), clock.clone(), Duration::ZERO);
    peer.kill();
    assert_eq!(types(&warm.special(true).await.unwrap()).len(), 3);
    let response = get(&cold, &[("accept-language", "ko")]).await;
    assert_eq!(response.status().as_u16(), 501);
    assert_eq!(
        response.headers()["content-type"].to_str().unwrap(),
        "text/html; charset=utf-8"
    );
    assert!(response.headers().get("cache-control").is_none());
    assert_eq!(body(response).await, b"warning storage unavailable");
}
#[tokio::test]
async fn missing_type_returns_legacy_data_is_empty() {
    let peer = Peer::new();
    let store = store_with(&peer);
    store
        .publish(
            "bulletin-2",
            20260926,
            vec![member(
                Operation::WthrPwn,
                WTHR_PWN.as_bytes(),
                "2026-09-26T00:00:00.000Z",
            )],
            deadline(),
        )
        .await
        .unwrap();
    let service = service_on(
        store,
        FixedClock::at("2026-09-27T00:00:00.000Z"),
        Duration::from_secs(30),
    );
    let response = get(&service, &[]).await;
    assert_eq!(response.status().as_u16(), 501);
    assert_eq!(body(response).await, b"data is empty");
}
#[tokio::test]
async fn zone_state_recovers_from_published_days() {
    let peer = Peer::new();
    let store = peer.store();
    let mut rows = items(PWN_CD);
    rows.extend(items(PWN_CD_DAILY));
    let partial: Vec<_> = rows
        .iter()
        .filter(|r| server2::warnings::js::number(r.get("tmFc")) <= 202609261000.)
        .cloned()
        .collect();
    let (early, late): (Vec<_>, Vec<_>) = partial
        .into_iter()
        .partition(|r| server2::warnings::js::number(r.get("tmFc")) < 202609200000.);
    for (date, part) in [(20260919, early), (20260926, late)] {
        store
            .publish(
                records::ZONE_KIND,
                date,
                vec![Member {
                    role: Operation::PwnCd.role().into(),
                    bytes: provider_body(&part).into(),
                    fetched_at_ms: ms("2026-09-26T01:05:00.000Z") as u64,
                }],
                deadline(),
            )
            .await
            .unwrap();
    }
    let service = peer.service(FixedClock::at("2026-09-26T02:00:00.000Z"));
    let o = oracle();
    let town = Town {
        first: "제주특별자치도".into(),
        second: "서귀포시".into(),
        third: "성산읍".into(),
    };
    let list = service.special_info(&town).await.unwrap();
    let got: serde_json::Value =
        serde_json::from_slice(&server2::warnings::service::special_info_json(&list).to_bytes())
            .unwrap();
    assert_eq!(got, o["partialInfo"][1]);
    assert!(!list.is_empty());
}
fn seed_doc(kind: u8, announcement: &str) -> OrderedJson {
    OrderedJson::parse(
        format!(
            r#"{{"type":{kind},"announcement":"{announcement}","situationList":[],"comment":"seed {kind}"}}"#
        )
        .as_bytes(),
    )
    .unwrap()
}
async fn import(store: &WarningStore<HttpS3Transport>, file: &[u8]) {
    let parsed = server2::warnings::seed::parse(file).unwrap();
    server2::warnings::seed::import(store, &parsed, deadline())
        .await
        .unwrap();
}
#[tokio::test]
async fn years_old_bulletins_have_no_age_expiry() {
    // S12-R1-01: no age bound down to the earliest storable period (1970).
    let peer = Peer::new();
    let store = peer.store();
    let docs = (1..=3)
        .map(|k| seed_doc(k, "2005-03-01T09:10:00.000Z"))
        .collect();
    import(&store, &seed_file(docs, None, "2005-03-02T00:00:00.000Z")).await;
    let service = peer.service(FixedClock::at("2026-10-04T00:10:00.000Z"));
    let list = service.special(true).await.unwrap();
    assert_eq!(
        types(&list),
        vec![
            (1., "2005-03-01T00:10:00.000Z".into()),
            (2., "2005-03-01T00:10:00.000Z".into()),
            (3., "2005-03-01T00:10:00.000Z".into()),
        ]
    );
    let c = &service.store().counters;
    assert!(c.list_pages.load(std::sync::atomic::Ordering::Relaxed) >= 3);
}
fn zone_row(area: &str, warn_var: u8, stress: u8, command: &str, tm_fc: i64) -> serde_json::Value {
    serde_json::json!({"areaCode": area, "areaName": "x", "warnVar": warn_var, "warnStress": stress,
        "command": command, "cancel": "0", "tmFc": tm_fc, "tmSeq": 1, "endTime": 0, "allEndTime": 0,
        "startTime": 0, "stnId": "108"})
}
#[tokio::test]
async fn zone_changes_older_than_sixty_days_after_the_seed_are_kept() {
    // S12-R1-02: a release and a new issue beyond the 60-day window still apply.
    let peer = Peer::new();
    let store = peer.store();
    let zone = serde_json::json!([
        {"areaCode": "L1100100", "areaName": "seed", "warnVar": 3, "warnStress": 1, "active": true,
         "command": "1", "eventTmFc": 202601010900_i64, "eventTmSeq": 1, "eventRank": 1}
    ]);
    let zone = OrderedJson::parse(&serde_json::to_vec(&zone).unwrap()).unwrap();
    import(
        &store,
        &seed_file(vec![], Some(zone), "2026-01-02T00:00:00.000Z"),
    )
    .await;
    for (date, row) in [
        (20260105, zone_row("L1100100", 3, 1, "2", 202601050900)),
        (20260301, zone_row("L1100200", 12, 0, "1", 202603010900)),
    ] {
        store
            .publish(
                records::ZONE_KIND,
                date,
                vec![Member {
                    role: Operation::PwnCd.role().into(),
                    bytes: provider_body(&[row]).into(),
                    fetched_at_ms: ms("2026-03-01T01:00:00.000Z") as u64,
                }],
                deadline(),
            )
            .await
            .unwrap();
    }
    let service = peer.service(FixedClock::at("2026-10-04T00:10:00.000Z"));
    let town = Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: "청운효자동".into(),
    };
    let got =
        server2::warnings::service::special_info_json(&service.special_info(&town).await.unwrap());
    assert_eq!(
        String::from_utf8(got.to_bytes()).unwrap(),
        r#"[{"weather":12,"weatherStr":"폭염","level":1,"levelStr":"주의보","locationName":"서울동북권"}]"#
    );
}
#[tokio::test]
async fn a_day_larger_than_one_read_is_paged_whole_acquisitions() {
    // S12-R1-03: each publication fits, the day's history does not; reads page down to one.
    let peer = Peer::new();
    let limits = CatalogLimits {
        output_bytes: 6000,
        deadline: Duration::from_secs(9),
        ..CatalogLimits::default()
    };
    let store =
        Arc::new(WarningStore::new(peer.transport(), limits, StoreConfig::default()).unwrap());
    let padding = "가".repeat(1200);
    for (tm_fc, fetched) in [
        (202609281000_i64, "2026-09-28T01:01:00.000Z"),
        (202609280900, "2026-09-28T02:01:00.000Z"),
    ] {
        store
            .publish(
                "bulletin-2",
                20260928,
                vec![Member {
                    role: Operation::WthrPwn.role().into(),
                    bytes: type2_body(tm_fc, &padding).into(),
                    fetched_at_ms: ms(fetched) as u64,
                }],
                deadline(),
            )
            .await
            .unwrap();
    }
    let now = ms("2026-09-30T00:00:00.000Z");
    let latest = store
        .latest(2, now, None, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        server2::warnings::js::iso(latest.stored_ms),
        "2026-09-28T10:00:00.000Z"
    );
    assert!(
        store
            .exists(2, ms("2026-09-28T09:00:00.000Z"), deadline())
            .await
            .unwrap()
    );
    assert!(
        store
            .counters
            .paged_days
            .load(std::sync::atomic::Ordering::Relaxed)
            >= 1
    );
}

async fn publish_zone_row(
    store: &WarningStore<HttpS3Transport>,
    date: u32,
    row: serde_json::Value,
) {
    store
        .publish(
            records::ZONE_KIND,
            date,
            vec![Member {
                role: Operation::PwnCd.role().into(),
                bytes: provider_body(&[row]).into(),
                fetched_at_ms: ms("2026-09-28T01:00:00.000Z") as u64,
            }],
            deadline(),
        )
        .await
        .unwrap();
}
fn jongno() -> Town {
    Town {
        first: "서울특별시".into(),
        second: "종로구".into(),
        third: "청운효자동".into(),
    }
}
#[tokio::test]
async fn zone_replay_starts_from_the_seed_sync_not_its_export_time() {
    // S12-R2-02: a late export of an older sync state must not hide published releases.
    for marker in [
        serde_json::json!({"areaCode": "_sync", "warnVar": -1, "lastSyncAt": "2026-09-24T00:00:00.000Z", "oldestSyncedTmFc": "20260726"}),
        serde_json::json!({"areaCode": "_sync", "warnVar": -1, "lastSyncAt": "2026-09-24T00:00:00.000Z"}),
    ] {
        let peer = Peer::new();
        let store = peer.store();
        let zone = serde_json::json!([
            {"areaCode": "L1100100", "areaName": "seed", "warnVar": 3, "warnStress": 1, "active": true,
             "command": "1", "eventTmFc": 202609200900_i64, "eventTmSeq": 1, "eventRank": 1},
            marker
        ]);
        let zone = OrderedJson::parse(&serde_json::to_vec(&zone).unwrap()).unwrap();
        import(
            &store,
            &seed_file(vec![], Some(zone), "2026-10-12T00:00:00.000Z"),
        )
        .await;
        publish_zone_row(
            &store,
            20260927,
            zone_row("L1100100", 3, 1, "2", 202609270900),
        )
        .await;
        let service = peer.service(FixedClock::at("2026-10-13T00:10:00.000Z"));
        assert!(service.special_info(&jongno()).await.unwrap().is_empty());
    }
}
#[tokio::test]
async fn zone_refresh_timeout_serves_valid_memory() {
    // S12-R2-01: the request deadline elapses before a slow refresh; valid memory is served.
    let peer = Peer::new();
    let store = peer.store();
    publish_zone_row(
        &store,
        20260927,
        zone_row("L1100100", 3, 1, "1", 202609270900),
    )
    .await;
    let service = WarningService::new(
        store,
        FixedClock::at("2026-09-28T00:10:00.000Z"),
        ServiceConfig {
            zone_refresh: Duration::ZERO,
            deadline: Duration::from_millis(30),
            ..ServiceConfig::default()
        },
    );
    peer.fault("slow-all", "index/v2/unused.json").await;
    // Cold: the waiter times out, the owned task still fills memory.
    assert!(service.special_info(&jongno()).await.is_err());
    let filled = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(200)).await;
        // Memory younger than refresh + stale answers even though every refresh times out.
        if let Ok(list) = service.special_info(&jongno()).await {
            assert_eq!(list.len(), 1);
            break;
        }
        assert!(
            filled.elapsed() < Duration::from_secs(20),
            "owned refresh never filled memory"
        );
    }
    let again = service.special_info(&jongno()).await.unwrap();
    assert_eq!(again.len(), 1);
}
