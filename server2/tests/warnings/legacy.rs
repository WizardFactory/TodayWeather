//! Pure legacy ports compared with expectations produced by the legacy functions (oracle).
use super::common::*;
use server2::{
    gateway::OrderedJson,
    warnings::{
        collector::plan_days,
        js, provider, special, text,
        zones::{Town, ZONE_TABLE, ZoneState, ZoneTable, prepare_events, special_info_for},
    },
};

fn json(list: &[text::Situation]) -> serde_json::Value {
    let o = OrderedJson::Array(list.iter().map(text::Situation::to_json).collect());
    serde_json::from_slice(&o.to_bytes()).unwrap()
}
#[test]
fn situation_parsers_match_legacy() {
    let o = oracle();
    let texts = o["texts"].as_object().unwrap();
    assert!(texts.len() >= 40, "every recorded t6/t7 text is covered");
    for (name, value) in texts {
        let t = value.as_str().unwrap();
        assert_eq!(
            json(&text::parse_special_text(t)),
            o["special"][name],
            "special {name}"
        );
        assert_eq!(
            json(&text::parse_preliminary_text(t)),
            o["preliminary"][name],
            "preliminary {name}"
        );
    }
}
#[test]
fn line_change_matches_legacy_including_empty_first_match() {
    let o = oracle();
    let cases = [
        (vec!["강풍주의보", ""], "a<b*c o-d※e[f 강풍주의보 끝"),
        (vec!["", "강풍주의보"], "<첫줄 o 강풍주의보 [괄호] - 끝"),
    ];
    for (i, (list, input)) in cases.iter().enumerate() {
        let list: Vec<Vec<u16>> = list.iter().map(|s| js::utf16(s)).collect();
        let out = text::insert_line_change(&list, &js::utf16(input));
        assert_eq!(
            String::from_utf16(&out).unwrap(),
            o["lines"][i].as_str().unwrap()
        );
    }
}
#[test]
fn zones_for_town_matches_legacy_order() {
    let o = oracle();
    let table = ZoneTable::parse(ZONE_TABLE, Some("202610130000"));
    for case in o["towns"].as_array().unwrap() {
        let t = case["town"].as_array().unwrap();
        let town = Town {
            first: t[0].as_str().unwrap().into(),
            second: t[1].as_str().unwrap().into(),
            third: t[2].as_str().unwrap().into(),
        };
        let expected: Vec<String> = serde_json::from_value(case["zones"].clone()).unwrap();
        assert_eq!(table.zones_for_town(&town), expected, "{town:?}");
    }
}
#[test]
fn combined_gwangju_jeonnam_zones_match_legacy_and_reject_unknown() {
    let table = ZoneTable::parse(ZONE_TABLE, Some("202610130000"));
    let gwangju = ["동구", "서구", "남구", "북구", "광산구"];
    let jeonnam = [
        "목포시",
        "여수시",
        "순천시",
        "나주시",
        "광양시",
        "담양군",
        "곡성군",
        "구례군",
        "고흥군",
        "보성군",
        "화순군",
        "장흥군",
        "강진군",
        "해남군",
        "영암군",
        "무안군",
        "함평군",
        "영광군",
        "장성군",
        "완도군",
        "진도군",
        "신안군",
    ];
    for district in gwangju {
        let combined = table.zones_for_town(&Town {
            first: "전남광주통합특별시".into(),
            second: district.into(),
            third: String::new(),
        });
        let legacy = table.zones_for_town(&Town {
            first: "광주광역시".into(),
            second: district.into(),
            third: String::new(),
        });
        assert!(!legacy.is_empty(), "{district}");
        assert_eq!(combined, legacy, "gwangju {district}");
        assert!(
            !combined.iter().any(|z| z.starts_with("L105")),
            "gwangju {district} must exclude Jeonnam zones: {combined:?}"
        );
    }
    for district in jeonnam {
        let combined = table.zones_for_town(&Town {
            first: "전남광주통합특별시".into(),
            second: district.into(),
            third: String::new(),
        });
        let legacy = table.zones_for_town(&Town {
            first: "전라남도".into(),
            second: district.into(),
            third: String::new(),
        });
        assert!(!legacy.is_empty(), "{district}");
        assert_eq!(combined, legacy, "jeonnam {district}");
        assert!(
            !combined.iter().any(|z| z.starts_with("L113")),
            "jeonnam {district} must exclude Gwangju zones: {combined:?}"
        );
    }
    for (second, third, legacy_first, legacy_second) in [
        (" 서구 ", "치평동", "광주광역시", "서구"),
        (" 무안군 ", "삼향읍", "전라남도", "무안군"),
        (" 신안군 ", "흑산면", "전라남도", "신안군"),
        (" 여수시 ", "삼산면", "전라남도", "여수시"),
    ] {
        let combined = table.zones_for_town(&Town {
            first: "전남광주통합특별시".into(),
            second: second.into(),
            third: third.into(),
        });
        let legacy = table.zones_for_town(&Town {
            first: legacy_first.into(),
            second: legacy_second.into(),
            third: third.into(),
        });
        assert!(!legacy.is_empty(), "{second} {third}");
        assert_eq!(combined, legacy, "trimmed/island {second} {third}");
    }
    for bad in ["", "   ", "없는구", "강남구"] {
        assert!(
            table
                .zones_for_town(&Town {
                    first: "전남광주통합특별시".into(),
                    second: bad.into(),
                    third: String::new(),
                })
                .is_empty(),
            "unknown/missing district {bad:?} must stay unmapped"
        );
    }
}
#[tokio::test]
async fn special_info_resolves_combined_province_by_district() {
    let peer = Peer::new();
    let store = peer.store();
    let zone = serde_json::json!([
        {"areaCode": "L1130110", "areaName": "광주서부", "active": true, "warnVar": 2, "warnStress": 0},
        {"areaCode": "L1053410", "areaName": "무안군북부", "active": true, "warnVar": 1, "warnStress": 1},
        {"areaCode": "_sync", "warnVar": -1, "lastSyncAt": "2026-10-16T00:00:00.000Z"}
    ]);
    let zone = OrderedJson::parse(&serde_json::to_vec(&zone).unwrap()).unwrap();
    let file = seed_file(vec![], Some(zone), "2026-10-16T00:00:00.000Z");
    server2::warnings::seed::import(
        &store,
        &server2::warnings::seed::parse(&file).unwrap(),
        deadline(),
    )
    .await
    .unwrap();
    let service = peer.service(FixedClock::at("2026-10-16T01:02:00.000Z"));
    let gwangju = service
        .special_info(&Town {
            first: "전남광주통합특별시".into(),
            second: "서구".into(),
            third: "치평동".into(),
        })
        .await
        .unwrap();
    assert_eq!(gwangju.len(), 1);
    assert_eq!(gwangju[0].location_name, "광주서부");
    let jeonnam = service
        .special_info(&Town {
            first: "전남광주통합특별시".into(),
            second: "무안군".into(),
            third: "삼향읍".into(),
        })
        .await
        .unwrap();
    assert_eq!(jeonnam.len(), 1);
    assert_eq!(jeonnam[0].location_name, "무안군북부");
    let unknown = service
        .special_info(&Town {
            first: "전남광주통합특별시".into(),
            second: "없는구".into(),
            third: String::new(),
        })
        .await
        .unwrap();
    assert!(unknown.is_empty());
}
#[test]
fn zone_replay_and_special_info_match_legacy() {
    let o = oracle();
    let mut rows = items(PWN_CD);
    rows.extend(items(PWN_CD_DAILY));
    let events = prepare_events(&rows);
    assert_eq!(events.len() as u64, o["events"].as_u64().unwrap());
    let mut state = ZoneState::default();
    state.apply(&events);
    let replayed: Vec<serde_json::Value> = state
        .entries()
        .map(|e| {
            serde_json::json!({"areaCode": e.area_code, "areaName": e.area_name,
                "warnVar": e.warn_var, "warnStress": e.warn_stress, "active": e.active,
                "command": e.command, "eventTmFc": e.event_tm_fc, "eventTmSeq": e.event_tm_seq,
                "eventRank": e.event_rank})
        })
        .collect();
    let expected = o["state"].as_array().unwrap();
    assert_eq!(replayed.len(), expected.len());
    for (a, b) in replayed.iter().zip(expected) {
        for k in ["areaCode", "areaName", "active", "command"] {
            assert_eq!(a[k], b[k]);
        }
        for k in [
            "warnVar",
            "warnStress",
            "eventTmFc",
            "eventTmSeq",
            "eventRank",
        ] {
            assert_eq!(a[k].as_f64(), b[k].as_f64(), "{k}");
        }
    }
    // A partial replay (before the 11:30 releases) leaves active warnings.
    let partial: Vec<_> = rows
        .iter()
        .filter(|r| js::number(r.get("tmFc")) <= 202609261000.)
        .cloned()
        .collect();
    assert_eq!(partial.len() as u64, o["partialCount"].as_u64().unwrap());
    let mut state = ZoneState::default();
    state.apply(&prepare_events(&partial));
    let table = ZoneTable::parse(ZONE_TABLE, None);
    let mut nonempty = 0;
    for (case, expected) in o["towns"]
        .as_array()
        .unwrap()
        .iter()
        .zip(o["partialInfo"].as_array().unwrap())
    {
        let codes: Vec<String> = serde_json::from_value(case["zones"].clone()).unwrap();
        let list = special_info_for(&table, state.entries(), &codes);
        let got = OrderedJson::Array(list.iter().map(|i| i.to_json()).collect());
        let got: serde_json::Value = serde_json::from_slice(&got.to_bytes()).unwrap();
        assert_eq!(&got, expected);
        nonempty += usize::from(!list.is_empty());
    }
    assert!(nonempty > 0);
}
#[test]
fn provider_helpers_match_legacy() {
    let o = oracle();
    let at = provider::announcement_of(Some(&serde_json::json!(202609270910_i64))).unwrap();
    assert_eq!(js::iso(at), o["announcement"].as_str().unwrap());
    let kst = o["kstDate"].as_array().unwrap();
    assert_eq!(
        provider::kst_date(ms("2026-09-27T15:00:00.000Z"), 0).to_string(),
        kst[0].as_str().unwrap()
    );
    assert_eq!(
        provider::kst_date(ms("2026-09-27T14:59:59.000Z"), -1).to_string(),
        kst[1].as_str().unwrap()
    );
    // latestItem: tmFc then tmSeq, numeric strings included.
    let list = vec![
        serde_json::json!({"tmFc": "202609270910", "tmSeq": 2}),
        serde_json::json!({"tmFc": 202609270910_i64, "tmSeq": "10"}),
        serde_json::json!({"tmFc": 202609270810_i64, "tmSeq": 99}),
    ];
    assert_eq!(provider::latest_item(&list).unwrap()["tmSeq"], "10");
    // Gateway/provider classification.
    assert!(provider::items(ERR_30.as_bytes()).is_err());
    assert!(provider::items(ERR_99.as_bytes()).is_err());
    assert_eq!(
        provider::items(WTHR_PWN.as_bytes()).unwrap().unwrap().len(),
        1
    );
    assert!(
        provider::items(br#"{"response":{"header":{"resultCode":"03"}}}"#)
            .unwrap()
            .is_none()
    );
    assert!(
        provider::items(br#"{"response":{"header":{"resultCode":"00"},"body":{"items":""}}}"#)
            .unwrap()
            .is_none()
    );
}
#[test]
fn plan_days_ports_bootstrap_and_resume() {
    let now = ms("2026-09-26T03:05:00.000Z");
    // Empty state: today plus nine backfill days.
    let (days, oldest) = plan_days(now, None, None);
    assert_eq!(days.len(), 10);
    assert_eq!(days[0], 20260926);
    assert_eq!(days[9], 20260917);
    assert_eq!(oldest, 20260917);
    // Resume below the covered range.
    let (days, oldest) = plan_days(now + 60_000, Some(now), Some(20260917));
    assert_eq!(&days[..2], &[20260926, 20260925]);
    assert_eq!(days[2], 20260916);
    assert_eq!(oldest, 20260909);
    // Coverage beyond the 60-day window adds no backfill day.
    let (days, oldest) = plan_days(now, Some(now - 1000), Some(20260728));
    assert_eq!(days, vec![20260926, 20260925]);
    assert_eq!(oldest, 20260728);
}
#[test]
fn i18n_locale_selection() {
    let l = special::locale;
    assert_eq!(l(Some("ko"), None), "ko");
    assert_eq!(l(Some("ko-KR,ko;q=0.9"), None), "ko");
    assert_eq!(l(Some("en-US,ko;q=0.9"), None), "ko"); // exact match beats an earlier parent
    assert_eq!(l(Some("en-US,ja-JP;q=0.9"), None), "en");
    assert_eq!(l(Some("fr,de;q=0.1"), None), "de");
    assert_eq!(l(Some("ko;q=0,en;q=0.5"), None), "en");
    assert_eq!(l(None, None), "en");
    assert_eq!(l(Some("en"), Some("a=b; twcookie=ko")), "ko");
    assert_eq!(l(Some("ko"), Some("twcookie=xx")), "en");
    assert_eq!(l(Some("zh-CN"), None), "zh-CN");
}
