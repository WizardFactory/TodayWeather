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
    for (first, second, third, legacy_first, legacy_second, legacy_third) in [
        (
            "전남광주통합특별시",
            " 서구 ",
            "치평동",
            "광주광역시",
            "서구",
            "치평동",
        ),
        (
            " 전남광주통합특별시 ",
            " 서구 ",
            "치평동",
            "광주광역시",
            "서구",
            "치평동",
        ),
        (
            "전남광주통합특별시",
            " 무안군 ",
            "삼향읍",
            "전라남도",
            "무안군",
            "삼향읍",
        ),
        (
            " 전남광주통합특별시 ",
            " 무안군 ",
            "삼향읍",
            "전라남도",
            "무안군",
            "삼향읍",
        ),
        (
            "전남광주통합특별시",
            " 신안군 ",
            "흑산면",
            "전라남도",
            "신안군",
            "흑산면",
        ),
        (
            "전남광주통합특별시",
            " 신안군 ",
            "흑 산면",
            "전라남도",
            "신안군",
            "흑산면",
        ),
        (
            "전남광주통합특별시",
            " 여수시 ",
            "삼산면",
            "전라남도",
            "여수시",
            "삼산면",
        ),
        (
            "전남광주통합특별시",
            " 여수시 ",
            "삼 산면",
            "전라남도",
            "여수시",
            "삼산면",
        ),
    ] {
        let combined = table.zones_for_town(&Town {
            first: first.into(),
            second: second.into(),
            third: third.into(),
        });
        let legacy = table.zones_for_town(&Town {
            first: legacy_first.into(),
            second: legacy_second.into(),
            third: legacy_third.into(),
        });
        assert!(!legacy.is_empty(), "{first} {second} {third}");
        assert_eq!(combined, legacy, "trimmed/island {first} {second} {third}");
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
        {"areaCode": "L1130120", "areaName": "광주동부", "active": true, "warnVar": 2, "warnStress": 0},
        {"areaCode": "L1053420", "areaName": "무안군남부", "active": true, "warnVar": 1, "warnStress": 1},
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
    assert_eq!(gwangju[0].location_name, "광주동부");
    let jeonnam = service
        .special_info(&Town {
            first: "전남광주통합특별시".into(),
            second: "무안군".into(),
            third: "삼향읍".into(),
        })
        .await
        .unwrap();
    assert_eq!(jeonnam.len(), 1);
    assert_eq!(jeonnam[0].location_name, "무안군남부");
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
#[test]
fn granular_subzone_matching_and_fallbacks() {
    let table = ZoneTable::parse(ZONE_TABLE, Some("202611210000"));
    let names = |first: &str, second: &str, third: &str| {
        let mut out: Vec<String> = table
            .zones_for_town(&Town {
                first: first.into(),
                second: second.into(),
                third: third.into(),
            })
            .into_iter()
            .filter_map(|id| table.zone_name(&id).map(ToOwned::to_owned))
            .collect();
        out.sort();
        out.dedup();
        out
    };
    // Tier A: Seoul 4 zones, Busan 3, Ulsan 2, Gwangju 2 + #3078 combined province.
    assert_eq!(
        names("서울특별시", "강남구", "역삼동"),
        vec!["서울동남권", "서울특별시", "전국"]
    );
    assert_eq!(
        names("서울특별시", "노원구", "상계1동"),
        vec!["서울동북권", "서울특별시", "전국"]
    );
    assert_eq!(
        names("서울특별시", "영등포구", "여의동"),
        vec!["서울서남권", "서울특별시", "전국"]
    );
    assert_eq!(
        names("서울특별시", "종로구", "청운효자동"),
        vec!["서울서북권", "서울특별시", "전국"]
    );
    // ECMAScript \s parity (#3085 CODEX-2): U+FEFF is JS whitespace, U+0085 is not.
    assert_eq!(
        names("서울특별시", "종\u{feff}로구", "청운효자동"),
        vec!["서울서북권", "서울특별시", "전국"]
    );
    assert_eq!(
        names("서울특별시", "종\u{0085}로구", "청운효자동"),
        vec![
            "서울동남권",
            "서울동북권",
            "서울서남권",
            "서울서북권",
            "서울특별시",
            "전국"
        ]
    );
    assert_eq!(
        names("서울특별시", "", ""),
        vec![
            "서울동남권",
            "서울동북권",
            "서울서남권",
            "서울서북권",
            "서울특별시",
            "전국"
        ]
    );
    assert_eq!(
        names("부산광역시", "해운대구", ""),
        vec!["부산광역시", "부산동부", "전국"]
    );
    assert_eq!(
        names("울산광역시", "울주군", ""),
        vec!["울산광역시", "울산서부", "전국"]
    );
    assert_eq!(
        names("광주광역시", "광산구", ""),
        vec!["광주광역시", "광주서부", "전국"]
    );
    assert_eq!(
        names("전남광주통합특별시", "광산구", ""),
        vec!["광주광역시", "광주서부", "전국"]
    );
    assert_eq!(
        names("전남광주통합특별시", "영광군", "낙월면"),
        vec!["영광군", "영광낙월면", "전국", "전라남도"]
    );
    // Tier B: Incheon pre/post-2026-07-01, Sejong, 강원/경북 평지/산지, directional splits.
    assert_eq!(
        names("인천광역시", "영종구", ""),
        vec!["인천광역시", "인천영종", "전국"]
    );
    assert_eq!(
        names("인천광역시", "중구", "영종1동"),
        vec!["인천광역시", "인천영종", "전국"]
    );
    assert_eq!(
        names("인천광역시", "중구", "운서1동"),
        vec!["인천광역시", "인천영종", "전국"]
    );
    assert_eq!(
        names("인천광역시", "중구", "운서2동"),
        vec!["인천광역시", "인천영종", "전국"]
    );
    assert_eq!(
        names("인천광역시", "중구", "신포동"),
        vec!["인천광역시", "인천남부", "전국"]
    );
    assert_eq!(
        names("인천광역시", "남구", ""),
        vec!["인천광역시", "인천남부", "전국"]
    );
    assert_eq!(
        names("인천광역시", "검단구", ""),
        vec!["인천광역시", "인천북부", "전국"]
    );
    assert_eq!(
        names("세종특별자치시", "", "조치원읍"),
        vec!["세종북부", "세종특별자치시", "전국"]
    );
    assert_eq!(
        names("세종특별자치시", "", "한솔동"),
        vec!["세종남부", "세종특별자치시", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "강릉시", "왕산면"),
        vec!["강릉시", "강릉시산지", "강원도", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "강릉시", "주문진읍"),
        vec!["강릉시", "강릉시평지", "강원도", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "강릉시", "미확인동"),
        vec!["강릉시", "강릉시산지", "강릉시평지", "강원도", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "속초시", "대포동"),
        vec!["강원도", "속초시", "속초시산지", "속초시평지", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "속초시", "노학동"),
        vec!["강원도", "속초시", "속초시산지", "속초시평지", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "속초시", "설악동"),
        vec!["강원도", "속초시", "속초시산지", "전국"]
    );
    assert_eq!(
        names("강원특별자치도", "속초시", "조양동"),
        vec!["강원도", "속초시", "속초시평지", "전국"]
    );
    assert_eq!(
        names("경상북도", "울진군", "서면"),
        vec!["경상북도", "울진군", "울진군산지", "전국"]
    );
    assert_eq!(
        names("경기도", "용인시 수지구", ""),
        vec!["경기도", "용인시", "용인시서북부", "전국"]
    );
    assert_eq!(
        names("경기도", "파주시", "문산읍"),
        vec!["경기도", "전국", "파주시", "파주시동북부"]
    );
    assert_eq!(
        names("경기도", "파주시", "미확인동"),
        vec![
            "경기도",
            "전국",
            "파주시",
            "파주시남부",
            "파주시동북부",
            "파주시서북부"
        ]
    );
    assert_eq!(
        names("충청북도", "청주시 상당구", "용담명암산성동"),
        vec!["전국", "청주시", "청주시서부", "충청북도"]
    );
    // Tier C: partial splits and safe over-warn fallbacks (no blind suffix narrowing; external islands included on empty/unknown third).
    assert_eq!(
        names("인천광역시", "강화군", "서도면"),
        vec!["강화군", "서해5도", "연평도.우도", "인천광역시", "전국"]
    );
    assert_eq!(
        names("인천광역시", "강화군", "강화읍"),
        vec!["강화군", "인천광역시", "전국"]
    );
    assert_eq!(
        names("인천광역시", "옹진군", ""),
        vec![
            "백령도.대청도",
            "서해5도",
            "연평도.우도",
            "옹진군",
            "인천광역시",
            "전국"
        ]
    );
    assert_eq!(
        names("인천광역시", "옹진군", "미확인백령면"),
        vec![
            "백령도.대청도",
            "서해5도",
            "연평도.우도",
            "옹진군",
            "인천광역시",
            "전국"
        ]
    );
    assert_eq!(
        names("전라남도", "신안군", ""),
        vec!["신안군(흑산면제외)", "전국", "전라남도", "흑산도.홍도"]
    );
    assert_eq!(
        names("전라남도", "신안군", "미확인흑산면"),
        vec!["신안군(흑산면제외)", "전국", "전라남도", "흑산도.홍도"]
    );
    assert_eq!(
        names("전라남도", "여수시", ""),
        vec!["거문도.초도", "여수시", "전국", "전라남도"]
    );
    assert_eq!(
        names("전라남도", "여수시", "미확인삼산면"),
        vec!["거문도.초도", "여수시", "전국", "전라남도"]
    );
    assert_eq!(
        names("전라남도", "구례군", "구례읍"),
        vec!["구례군", "구례군평지", "전국", "전라남도"]
    );
    assert_eq!(
        names("전라남도", "구례군", "토지면"),
        vec!["구례군", "구례군산간", "구례군평지", "전국", "전라남도"]
    );
    assert_eq!(
        names("충청남도", "보령시", "오천면"),
        vec!["보령(도서제외)", "보령도서", "보령시", "전국", "충청남도"]
    );
    assert_eq!(
        names("충청남도", "보령시", "대천1동"),
        vec!["보령(도서제외)", "보령시", "전국", "충청남도"]
    );
    assert_eq!(
        names("충청남도", "보령시", "미확인면"),
        vec!["보령(도서제외)", "보령도서", "보령시", "전국", "충청남도"]
    );
    assert_eq!(
        names("전북특별자치도", "군산시", "옥도면"),
        vec![
            "군산시",
            "군산어청도",
            "군산옥도면(어청도 제외)",
            "전국",
            "전북자치도"
        ]
    );
    assert_eq!(
        names("전라남도", "완도군", "청산면"),
        vec![
            "완도군",
            "완도군(여서도 제외)",
            "완도군여서도",
            "전국",
            "전라남도"
        ]
    );
    assert_eq!(
        names("제주특별자치도", "제주시", "우도면"),
        vec!["전국", "제주도", "제주시(산지 제외)", "제주시동부"]
    );
    assert_eq!(
        names("제주특별자치도", "제주시", ""),
        vec![
            "전국",
            "제주도",
            "제주도산지",
            "제주시(산지 제외)",
            "제주시동부",
            "제주시북부",
            "제주시서부",
            "제주시중산간",
            "추자도"
        ]
    );
    assert_eq!(
        names("제주특별자치도", "제주시", "미확인추자면"),
        vec![
            "전국",
            "제주도",
            "제주도산지",
            "제주시(산지 제외)",
            "제주시동부",
            "제주시북부",
            "제주시서부",
            "제주시중산간",
            "추자도"
        ]
    );
    assert_eq!(
        names("제주특별자치도", "서귀포시", "성산읍"),
        vec![
            "서귀포시(산지 제외)",
            "서귀포시동부",
            "서귀포시중산간",
            "전국",
            "제주도",
            "제주도산지"
        ]
    );
    // Active Seoul 건조주의보 in 서울동북권 + 서울서남권 warns 노원구/영등포구 and excludes 강남구/종로구.
    let mut state = ZoneState::default();
    state.apply(&prepare_events(&[
        serde_json::json!({"areaCode":"L1100200","areaName":"서울동북권","warnVar":4,"warnStress":0,"command":"1","cancel":"0","tmFc":202611210900_i64,"tmSeq":1,"endTime":0,"allEndTime":0}),
        serde_json::json!({"areaCode":"L1100300","areaName":"서울서남권","warnVar":4,"warnStress":0,"command":"1","cancel":"0","tmFc":202611210900_i64,"tmSeq":1,"endTime":0,"allEndTime":0}),
    ]));
    let nowon = special_info_for(
        &table,
        state.entries(),
        &table.zones_for_town(&Town {
            first: "서울특별시".into(),
            second: "노원구".into(),
            third: "상계1동".into(),
        }),
    );
    assert_eq!(nowon.len(), 1);
    assert_eq!(nowon[0].location_name, "서울동북권");
    let gangnam = special_info_for(
        &table,
        state.entries(),
        &table.zones_for_town(&Town {
            first: "서울특별시".into(),
            second: "강남구".into(),
            third: "역삼동".into(),
        }),
    );
    assert!(gangnam.is_empty());
}
#[test]
fn subzone_table_integrity_and_split_leaf_coverage() {
    use server2::warnings::zones::SUBZONE_TABLE;
    use std::collections::{HashMap, HashSet};

    let table = ZoneTable::parse(ZONE_TABLE, Some("202611210000"));
    let raw: serde_json::Value = serde_json::from_str(SUBZONE_TABLE).unwrap();
    let mut referenced = HashSet::new();

    for (_province, districts) in raw["district_splits"].as_object().unwrap() {
        for (_district, ids) in districts.as_object().unwrap() {
            let list = ids.as_array().unwrap();
            assert!(!list.is_empty());
            for id in list {
                let id = id.as_str().unwrap();
                assert!(table.zone(id).is_some(), "unknown district REG_ID {id}");
                referenced.insert(id.to_owned());
            }
        }
    }
    for rule in raw["township_splits"].as_array().unwrap() {
        assert!(
            rule.get("dong_default").is_none() && rule.get("other_default").is_none(),
            "blind suffix defaults are forbidden"
        );
        let fallback = rule["fallback"].as_array().unwrap();
        assert!(!fallback.is_empty());
        for id in fallback {
            let id = id.as_str().unwrap();
            assert!(table.zone(id).is_some(), "unknown fallback REG_ID {id}");
            referenced.insert(id.to_owned());
        }
        let province = rule["province"].as_str().unwrap();
        let first_sec = rule["seconds"].as_array().unwrap()[0].as_str().unwrap();
        for (third, ids) in rule["by_third"].as_object().unwrap() {
            let list = ids.as_array().unwrap();
            assert!(!list.is_empty());
            for id in list {
                let id = id.as_str().unwrap();
                assert!(table.zone(id).is_some(), "unknown by_third REG_ID {id}");
                referenced.insert(id.to_owned());
            }
            let resolved = table.zones_for_town(&Town {
                first: province.into(),
                second: first_sec.into(),
                third: third.into(),
            });
            assert!(!resolved.is_empty());
            let set: HashSet<&str> = resolved.iter().map(String::as_str).collect();
            for id in &resolved {
                let mut cur = table.zone(id);
                while let Some(z) = cur {
                    assert!(
                        set.contains(z.id.as_str()),
                        "missing ancestor {} for {province}/{first_sec}/{third}",
                        z.id
                    );
                    cur = table.zone(&z.up);
                }
            }
        }
    }

    // Every split leaf under a split parent in ZONE_TABLE must be referenced.
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    let mut all_ids = Vec::new();
    for line in ZONE_TABLE.lines() {
        if line.is_empty() || line.starts_with('#') || line.starts_with("REG_ID,") {
            continue;
        }
        let f: Vec<&str> = line.split(',').collect();
        if f.len() < 7 || f[2] < "202611210000" {
            continue;
        }
        all_ids.push((f[0].to_owned(), f[4].to_owned(), f[6].to_owned()));
        children
            .entry(f[4].to_owned())
            .or_default()
            .push(f[0].to_owned());
    }
    let split_leaves: Vec<String> = all_ids
        .iter()
        .filter(|(id, up, _)| {
            children.get(id).is_none_or(Vec::is_empty)
                && *up != "L1000000"
                && table.zone(up).is_some_and(|p| {
                    p.up != "L1000000"
                        || p.name.ends_with("특별시")
                        || p.name.ends_with("광역시")
                        || p.name.ends_with("특별자치시")
                })
        })
        .filter(|(id, up, name)| {
            // Exclude unsplit county/island leaves directly under metro cities (e.g. 강화군/옹진군/기장군/달성군/군위군/울주군) except where split,
            // and check all 116 split-parent leaves match #3084 AC1.
            let _ = (id, up, name);
            children.get(up).is_some_and(|sibs| sibs.len() >= 2)
                && table.zone(up).is_some_and(|p| {
                    p.up != "L1000000"
                        || p.name == "서울특별시"
                        || p.name == "부산광역시"
                        || p.name == "울산광역시"
                        || p.name == "대구광역시"
                        || p.name == "광주광역시"
                        || p.name == "인천광역시"
                        || p.name == "세종특별자치시"
                })
        })
        .map(|(id, _, _)| id.clone())
        .collect();
    let uncovered: Vec<&String> = split_leaves
        .iter()
        .filter(|id| !referenced.contains(*id))
        .collect();
    assert!(
        uncovered.is_empty(),
        "uncovered split leaves: {uncovered:?}"
    );
}
