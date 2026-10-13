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
