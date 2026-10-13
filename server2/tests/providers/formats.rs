//! Raw-format inspection before persistence: data.go.kr JSON pages, RSS XML, KMA HTML.
use super::support::*;
use serde_json::Value;
use server2::domestic::family::{DataGoKrFamily as F, DataGoKrRequest, Target, WebRequest};
use server2::domestic::format::{Expect, PageVerdict, WebVerdict, inspect_page, inspect_web};
use server2::domestic::publication::Publication;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}
fn vilage() -> DataGoKrRequest {
    DataGoKrRequest::new(
        F::VilageFcst,
        Target::Grid { nx: 60, ny: 127 },
        p(20261013, 1400),
    )
    .unwrap()
}
fn valid(v: PageVerdict) -> server2::domestic::format::PageReport {
    match v {
        PageVerdict::Valid(r) => r,
        other => panic!("expected valid page, got {other:?}"),
    }
}

#[test]
fn forecast_pages_validate_counts_echo_and_grid() {
    let r = vilage();
    let first = valid(inspect_page(
        &r,
        1,
        None,
        &json(&vilage_page(1, 1068, 999, ("20261013", "1400"), (60, 127))),
    ));
    assert_eq!(
        (first.total, first.rows, first.publication),
        (1068, 999, p(20261013, 1400))
    );
    assert_eq!(first.row_keys.len(), 999);
    let second = valid(inspect_page(
        &r,
        2,
        Some(Expect { total: 1068 }),
        &json(&vilage_page(2, 1068, 999, ("20261013", "1400"), (60, 127))),
    ));
    assert_eq!(second.rows, 69);
    // Wrong total, wrong page echo, short first page and grid mismatch are invalid.
    let other_total = vilage_page(2, 1069, 999, ("20261013", "1400"), (60, 127));
    assert!(matches!(
        inspect_page(&r, 2, Some(Expect { total: 1068 }), &json(&other_total)),
        PageVerdict::Invalid(_)
    ));
    let wrong_echo = vilage_page(2, 1068, 999, ("20261013", "1400"), (60, 127));
    assert!(matches!(
        inspect_page(&r, 1, None, &json(&wrong_echo)),
        PageVerdict::Invalid(_)
    ));
    let mut short = json(&vilage_page(1, 1068, 999, ("20261013", "1400"), (60, 127)));
    short["response"]["body"]["items"]["item"]
        .as_array_mut()
        .unwrap()
        .truncate(500);
    assert!(matches!(
        inspect_page(&r, 1, None, &short),
        PageVerdict::Invalid(_)
    ));
    let grid = vilage_page(1, 50, 999, ("20261013", "1400"), (61, 127));
    assert!(matches!(
        inspect_page(&r, 1, None, &json(&grid)),
        PageVerdict::Invalid(_)
    ));
}

#[test]
fn late_and_previous_publications_are_not_data() {
    let r = vilage();
    assert!(matches!(
        inspect_page(&r, 1, None, &json(&empty_items())),
        PageVerdict::NotPublished
    ));
    assert!(matches!(
        inspect_page(&r, 1, None, &json(&result_code("03"))),
        PageVerdict::NotPublished
    ));
    let previous = vilage_page(1, 50, 999, ("20261013", "1100"), (60, 127));
    assert_eq!(
        inspect_page(&r, 1, None, &json(&previous)),
        PageVerdict::Stale(p(20261013, 1100))
    );
    let mut mixed = json(&vilage_page(1, 50, 999, ("20261013", "1400"), (60, 127)));
    mixed["response"]["body"]["items"]["item"][7]["baseTime"] = "1100".into();
    assert!(matches!(
        inspect_page(&r, 1, None, &mixed),
        PageVerdict::Invalid(_)
    ));
    assert!(matches!(
        inspect_page(&r, 1, None, &json(&result_code("99"))),
        PageVerdict::Invalid(_)
    ));
}

#[test]
fn ultra_short_accepts_the_hh00_echo_and_stores_the_canonical_hour() {
    let r = DataGoKrRequest::new(
        F::UltraSrtFcst,
        Target::Grid { nx: 60, ny: 127 },
        p(20261013, 1430),
    )
    .unwrap();
    for echo in ["1430", "1400"] {
        let body = vilage_page(1, 60, 999, ("20261013", echo), (60, 127));
        assert_eq!(
            valid(inspect_page(&r, 1, None, &json(&body))).publication,
            p(20261013, 1400)
        );
    }
    let late = vilage_page(1, 60, 999, ("20261013", "1330"), (60, 127));
    assert_eq!(
        inspect_page(&r, 1, None, &json(&late)),
        PageVerdict::Stale(p(20261013, 1300))
    );
}

#[test]
fn recorded_life_index_pages() {
    let uv = DataGoKrRequest::new(F::UvIdxV5, Target::AllAreas, p(20260926, 1200)).unwrap();
    // Recorded excerpts used numOfRows=3; under the requested 1000 rows they are not pages of this request.
    assert!(matches!(
        inspect_page(&uv, 1, None, &json(&fixture("uv-idx-v5.json"))),
        PageVerdict::Invalid(_)
    ));
    let mut whole = json(&fixture("uv-idx-v5.json"));
    whole["response"]["body"]["numOfRows"] = 1000.into();
    whole["response"]["body"]["totalCount"] = 3.into();
    let report = valid(inspect_page(&uv, 1, None, &whole));
    assert_eq!(
        (report.total, report.rows, report.publication),
        (3, 3, p(20260926, 1200))
    );
    assert_eq!(
        inspect_page(&uv, 1, None, &json(&result_code("99"))),
        PageVerdict::NoData
    );
    let pollen =
        DataGoKrRequest::new(F::WeedsPollenV3, Target::AllAreas, p(20260930, 1800)).unwrap();
    let mut live = json(&fixture("pollen-v3-live-20261001.json"));
    live["response"]["body"]["numOfRows"] = 1000.into();
    live["response"]["body"]["totalCount"] = 3.into();
    assert_eq!(valid(inspect_page(&pollen, 1, None, &live)).rows, 3);
    // Duplicate areaNo or mixed issuance is not a consistent page.
    let mut duplicate = live.clone();
    duplicate["response"]["body"]["items"]["item"][2]["areaNo"] = "1100000000".into();
    assert!(matches!(
        inspect_page(&pollen, 1, None, &duplicate),
        PageVerdict::Invalid(_)
    ));
    let mut issuance = live.clone();
    issuance["response"]["body"]["items"]["item"][1]["date"] = "2026093006".into();
    assert!(matches!(
        inspect_page(&pollen, 1, None, &issuance),
        PageVerdict::Invalid(_)
    ));
}

#[test]
fn recorded_rss_xml_is_checked_without_transcoding() {
    let body = fixture("town-rss.xml");
    let rss = WebRequest::town_rss(60, 127).unwrap();
    assert_eq!(
        inspect_web(&rss, "text/xml;charset=UTF-8", &body),
        WebVerdict::Valid(p(20261013, 1400))
    );
    let other = WebRequest::town_rss(61, 127).unwrap();
    assert!(matches!(
        inspect_web(&other, "text/xml", &body),
        WebVerdict::Invalid(_)
    ));
    let truncated = &body[..body.len() / 2];
    assert!(matches!(
        inspect_web(&rss, "text/xml", truncated),
        WebVerdict::Invalid(_)
    ));
    let html = b"<html><body>Service unavailable</body></html>";
    assert!(matches!(
        inspect_web(&rss, "text/html", html),
        WebVerdict::Invalid(_)
    ));
    let gateway = fixture("gateway-quota.xml");
    assert!(matches!(
        inspect_web(&rss, "text/xml", &gateway),
        WebVerdict::Invalid(_)
    ));
    let dtd = [
        b"<!DOCTYPE wid [<!ENTITY x \"y\">]>".as_slice(),
        &body[body.iter().position(|b| *b == b'\n').unwrap()..],
    ]
    .concat();
    assert!(matches!(
        inspect_web(&rss, "text/xml", &dtd),
        WebVerdict::Invalid(_)
    ));
}

#[test]
fn euc_kr_aws_page_is_kept_as_bytes_and_checked_structurally() {
    let body = fixture("aws-minute-euckr.html");
    assert!(
        std::str::from_utf8(&body).is_err(),
        "fixture must remain EUC-KR bytes"
    );
    let minute = WebRequest::aws_minute(None);
    assert_eq!(
        inspect_web(&minute, "text/html", &body),
        WebVerdict::Valid(p(20261013, 1432))
    );
    let seen = WebRequest::aws_minute(Some(p(20261013, 1432)));
    assert_eq!(
        inspect_web(&seen, "text/html", &body),
        WebVerdict::Valid(p(20261013, 1432))
    );
    let ahead = WebRequest::aws_minute(Some(p(20261013, 1433)));
    assert_eq!(
        inspect_web(&ahead, "text/html", &body),
        WebVerdict::Stale(p(20261013, 1432))
    );
    let hourly = WebRequest::aws_hourly(p(20261013, 1500)).unwrap();
    assert_eq!(
        inspect_web(&hourly, "text/html", &body),
        WebVerdict::Stale(p(20261013, 1432))
    );
    // A lead byte without trail, 0x80 and 0xFF are not EUC-KR/CP949.
    for bad in [vec![0xB0], vec![0x80, b'a'], vec![0xFF, 0xA1]] {
        let mut corrupt = body.clone();
        corrupt.splice(10..10, bad);
        assert!(matches!(
            inspect_web(&minute, "text/html", &corrupt),
            WebVerdict::Invalid(_)
        ));
    }
    let mut truncated = body.clone();
    truncated.push(0xC7);
    assert!(matches!(
        inspect_web(&minute, "text/html", &truncated),
        WebVerdict::Invalid(_)
    ));
    let unpublished = replace_ascii(&body, b"2026.10.13.14:32", b"");
    assert_eq!(
        inspect_web(&minute, "text/html", &unpublished),
        WebVerdict::NotPublished
    );
    let no_table = replace_ascii(&body, b"<table border=\"1\">", b"<div>");
    assert!(matches!(
        inspect_web(&minute, "text/html", &no_table),
        WebVerdict::Invalid(_)
    ));
}
/// Byte-level replacement of every ASCII marker, preserving surrounding EUC-KR bytes.
fn replace_ascii(body: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len());
    let mut i = 0;
    let mut found = false;
    while i < body.len() {
        if body[i..].starts_with(from) {
            out.extend_from_slice(to);
            i += from.len();
            found = true;
        } else {
            out.push(body[i]);
            i += 1;
        }
    }
    assert!(found);
    out
}

#[test]
fn recorded_city_page_uses_its_declared_utf8_charset() {
    let body = fixture("city-obs-2026-09-25.html");
    let city = WebRequest::city(p(20260925, 1900)).unwrap();
    assert_eq!(
        inspect_web(&city, "text/html;charset=UTF-8", &body),
        WebVerdict::Valid(p(20260925, 1900))
    );
    // Declared in the first 2 KiB even without a content-type charset.
    assert_eq!(
        inspect_web(&city, "text/html", &body),
        WebVerdict::Valid(p(20260925, 1900))
    );
    let later = WebRequest::city(p(20260925, 2000)).unwrap();
    assert_eq!(
        inspect_web(&later, "text/html", &body),
        WebVerdict::Stale(p(20260925, 1900))
    );
    let mut invalid = body.clone();
    invalid.splice(3000..3000, [0xC3, 0x28]);
    assert!(matches!(
        inspect_web(&city, "text/html;charset=UTF-8", &invalid),
        WebVerdict::Invalid(_)
    ));
    let no_table = replace_ascii(&body, b"id=\"weather_table\"", b"id=\"other_table\"");
    assert!(matches!(
        inspect_web(&city, "text/html", &no_table),
        WebVerdict::Invalid(_)
    ));
    let no_time = replace_ascii(&body, b"2026.09.25.19:00", b"");
    assert_eq!(
        inspect_web(&city, "text/html", &no_time),
        WebVerdict::NotPublished
    );
}
