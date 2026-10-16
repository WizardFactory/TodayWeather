use serde_json::json;
use server2::notice::{Notice, latest};

fn input(title: &str) -> serde_json::Value {
    json!({"texts":{"ko":{"title":title,"body":"서비스 변경입니다."}},"startsAt":"2026-10-16T09:00:00Z"})
}
const NOW: i64 = 1_792_141_200_000; // 2026-10-16T09:00:00Z

#[test]
fn active_notice_uses_time_then_numeric_id_and_end_is_exclusive() {
    let a = Notice::from_input(1, &input("first"), NOW).unwrap();
    let b = Notice::from_input(2, &input("second"), NOW).unwrap();
    assert_eq!(latest(&[a.clone(), b.clone()], NOW).unwrap().id, 2);
    assert!(latest(std::slice::from_ref(&a), NOW - 1).is_none());
    let mut ended = a.clone();
    ended.ends_at = Some(NOW);
    assert!(latest(&[ended], NOW).is_none());
    let mut withdrawn = b;
    withdrawn.withdrawn_at = Some(NOW);
    assert_eq!(latest(&[a, withdrawn], NOW).unwrap().id, 1);
}
#[test]
fn language_query_overrides_header_and_unsupported_falls_back_to_en_then_ko() {
    let mut v = input("한국어");
    v["texts"]["en"] = json!({"title":"English","body":"Change"});
    v["texts"]["fr"] = json!({"title":"Français","body":"Changement"});
    let n = Notice::from_input(1, &v, NOW).unwrap();
    assert_eq!(n.text(Some("fr-FR"), Some("en")).0, "fr");
    assert_eq!(n.text(Some("zh-TW"), Some("fr")).0, "en");
    assert_eq!(n.text(None, Some("fr;q=0, de, en-US")).0, "en");
    assert_eq!(n.text(None, Some("fr;Q=0, en-US")).0, "en");
    assert_eq!(n.text(None, Some("de, fr-CA;q=0.8, en")).0, "fr");
    assert_eq!(n.text(None, None).0, "en");
}
#[test]
fn validation_rejects_markup_http_unknown_language_empty_and_overlimit() {
    let good = input("좋음");
    for patch in [
        json!({"linkUrl":"http://example.com"}),
        json!({"texts":{"zz":{"title":"x","body":"y"}}}),
        json!({"texts":{"ko":{"title":"<b>title</b>","body":"text"}}}),
        json!({"texts":{"ko":{"title":" ","body":"text"}}}),
        json!({"endsAt":"2026-10-16T08:59:59Z"}),
    ] {
        let mut v = good.clone();
        for (k, x) in patch.as_object().unwrap() {
            v[k] = x.clone();
        }
        assert!(Notice::from_input(1, &v, NOW).is_err(), "{v}");
    }
    let mut v = good.clone();
    v["texts"]["ko"]["title"] = json!("가".repeat(101));
    assert!(Notice::from_input(1, &v, NOW).is_err());
    v["texts"]["ko"]["title"] = json!("가".repeat(100));
    assert!(Notice::from_input(1, &v, NOW).is_ok());
    v["texts"]["ko"]["body"] = json!("가".repeat(2001));
    assert!(Notice::from_input(1, &v, NOW).is_err());
}
#[test]
fn public_projection_has_only_contract_fields_and_normalized_utc() {
    let mut v = input("Title");
    v["startsAt"] = json!("2026-10-16T18:00:00+09:00");
    v["linkUrl"] = json!("https://example.com/info");
    let n = Notice::from_input(17, &v, NOW).unwrap();
    assert_eq!(
        n.public(Some("ko-KR"), None),
        json!({"id":17,"title":"Title","body":"서비스 변경입니다.","linkUrl":"https://example.com/info","lang":"ko","startsAt":"2026-10-16T09:00:00.000Z","endsAt":null})
    );
}
