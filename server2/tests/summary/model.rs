//! Summary keys, bodies, object names, input identities and completeness rules.
use super::support::*;
use server2::summary::{
    InputId, Inputs, ObjectName, Source, Summary, SummaryKey, complete, kst_midnight_ms,
};

#[test]
fn keys_are_canonical_and_layout_is_summary_v2() {
    let grid = SummaryKey::Grid { town: town() };
    assert_eq!(
        String::from_utf8(grid.json().to_bytes()).unwrap(),
        r#"{"source":"grid","town":["서울특별시","종로구","청운효자동"]}"#
    );
    let asos = SummaryKey::Asos {
        station: "108".into(),
    };
    assert_eq!(
        String::from_utf8(asos.json().to_bytes()).unwrap(),
        r#"{"source":"asos","station":"108"}"#
    );
    let vc = SummaryKey::vc(server2::world::Cell {
        lat: 40.71,
        lon: -74.01,
    });
    assert_eq!(
        String::from_utf8(vc.json().to_bytes()).unwrap(),
        r#"{"source":"vc","cell":[4071,-7401]}"#
    );
    let prefix = grid.date_prefix(20261014);
    assert_eq!(
        prefix,
        format!("summary/v2/grid/{}/20261014/", grid.sha256())
    );
    let summary = grid_summary(20261014, 22.5, 1_790_000_000_000);
    let key = summary.object_key();
    assert!(key.starts_with(&prefix));
    let name = key.strip_prefix(&prefix).unwrap();
    let parsed = ObjectName::parse(name).unwrap();
    assert_eq!(parsed.latest, 1_790_000_000_000);
    assert_eq!(parsed.count, 1);
    assert_eq!(parsed.revision, summary.revision_sha256());
}

#[test]
fn bodies_round_trip_and_tampering_is_rejected() {
    let summary = grid_summary(20261014, 22.5, 1_790_000_000_000);
    let body = summary.body();
    let text = String::from_utf8(body.clone()).unwrap();
    assert!(text.starts_with(r#"{"schema":1,"source":"grid","key":{"source":"grid","town":["#));
    assert!(text.contains(r#""grid":{"nx":60,"ny":127},"values":{"date":"20261014""#));
    let name = summary.object_name();
    let parsed = Summary::parse(&body, &summary.key, 20261014, &name).unwrap();
    assert_eq!(parsed, summary);
    // Another key, date, a changed byte or a wrong name do not verify.
    let other = SummaryKey::Asos {
        station: "108".into(),
    };
    assert!(Summary::parse(&body, &other, 20261014, &name).is_none());
    assert!(Summary::parse(&body, &summary.key, 20261013, &name).is_none());
    let tampered = text.replace("22.5", "23.5").into_bytes();
    assert!(Summary::parse(&tampered, &summary.key, 20261014, &name).is_none());
    let renamed = name.replacen("1790000000000", "1790000000001", 1);
    assert!(Summary::parse(&body, &summary.key, 20261014, &renamed).is_none());
    // An incomplete day never verifies, even with a matching hash.
    let mut incomplete = summary.clone();
    incomplete.values = day_row("20261014", 17., 22.5, 10.);
    assert!(
        Summary::parse(
            &incomplete.body(),
            &incomplete.key,
            20261014,
            &incomplete.object_name()
        )
        .is_none()
    );
}

#[test]
fn object_names_order_by_newest_input_then_count() {
    let a = ObjectName::parse(&format!("1790000000000-000010-{}.json", "f".repeat(64))).unwrap();
    let b = ObjectName::parse(&format!("1790000000001-000001-{}.json", "0".repeat(64))).unwrap();
    let c = ObjectName::parse(&format!("1790000000001-000002-{}.json", "0".repeat(64))).unwrap();
    assert!(a < b && b < c);
    for bad in [
        "1790000000000-000010.json",
        "179000000000-000010-x.json",
        &format!("1790000000000-000010-{}.json", "F".repeat(64)),
        &format!("1790000000000-000010-{}", "f".repeat(64)),
    ] {
        assert!(ObjectName::parse(bad).is_none(), "{bad}");
    }
}

#[test]
fn inputs_concern_the_hours_of_a_kst_day_and_digest_ignores_order() {
    let d = 20261014;
    let start = kst_midnight_ms(d).unwrap();
    let hour = 3_600_000;
    // The 00:00 current publication of D belongs to D-1 (2400); D+1 00:00 belongs to D.
    let at = |h: i64| input("ultra-srt-ncst", start + h * hour, start + h * hour, 1);
    assert!(!at(0).concerns(d));
    assert!(at(1).concerns(d));
    assert!(at(24).concerns(d));
    assert!(!at(25).concerns(d));
    // An ultra-short publication at D-1 22:30 writes D 01:00..04:30.
    let shortest = input(
        "ultra-srt-fcst",
        start - 90 * 60_000,
        start - 90 * 60_000 + 6 * hour,
        1,
    );
    assert!(shortest.concerns(d));
    let ids: Vec<InputId> = (1..=3).map(at).collect();
    let mut reversed = ids.clone();
    reversed.reverse();
    reversed.push(ids[0].clone());
    let (a, b) = (Inputs::of(&ids), Inputs::of(&reversed));
    assert_eq!(a, b);
    assert_eq!(a.count, 3);
    assert_eq!(a.families.get("ultra-srt-ncst"), Some(&3));
}

#[test]
fn completeness_rules_per_source() {
    // Grid: at least 18 valid t1h hours.
    assert!(!complete(Source::Grid, &day_row("20261014", 17., 20., 10.)));
    assert!(complete(Source::Grid, &day_row("20261014", 18., 20., 10.)));
    // ASOS: valid and ordered minimum and maximum; rain optional.
    let asos = |lo: Option<f64>, hi: Option<f64>| {
        let mut m = vec![];
        if let Some(lo) = lo {
            m.push(("taMin", n(lo)));
        }
        if let Some(hi) = hi {
            m.push(("taMax", n(hi)));
        }
        complete(Source::Asos, &obj(m))
    };
    assert!(asos(Some(10.), Some(20.)));
    assert!(asos(Some(10.), Some(10.)));
    assert!(!asos(Some(21.), Some(20.)));
    assert!(!asos(None, Some(20.)));
    assert!(
        !asos(Some(-99.), Some(20.)),
        "the -99 sentinel is not valid"
    );
    // VC: 75 % of the actual local hours.
    let vc = |h: f64, l: f64| {
        complete(
            Source::Vc,
            &obj(vec![
                ("taMin", n(1.)),
                ("taMax", n(2.)),
                ("observationHours", n(h)),
                ("localHours", n(l)),
            ]),
        )
    };
    assert!(!vc(17., 23.) && vc(18., 23.));
    assert!(!vc(17., 24.) && vc(18., 24.));
    assert!(!vc(18., 25.) && vc(19., 25.));
    assert!(!vc(30., 24.), "more hours than the day has");
}
