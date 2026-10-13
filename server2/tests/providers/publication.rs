//! Legacy query-time boundaries (controllerManager.js, PastConditionGather.js,
//! lifeIndexKmaRequester.js, kma.town.short.rss.controller.js at ca8735cf).
use super::support::kst;
use server2::domestic::publication::*;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}

#[test]
fn short_base_uses_ten_minute_availability() {
    for (h, m, expected) in [
        (0, 0, p(20261012, 2300)),
        (2, 9, p(20261012, 2300)),
        (2, 10, p(20261013, 200)),
        (5, 9, p(20261013, 200)),
        (5, 10, p(20261013, 500)),
        (14, 9, p(20261013, 1100)),
        (14, 10, p(20261013, 1400)),
        (23, 9, p(20261013, 2000)),
        (23, 10, p(20261013, 2300)),
        (23, 59, p(20261013, 2300)),
    ] {
        assert_eq!(
            short_base(kst(2026, 10, 13, h, m)),
            Some(expected),
            "{h}:{m}"
        );
    }
}

#[test]
fn ultra_short_and_current_use_45_and_40_minutes() {
    assert_eq!(
        ultra_short_base(kst(2026, 10, 13, 10, 44)),
        Some(p(20261013, 930))
    );
    assert_eq!(
        ultra_short_base(kst(2026, 10, 13, 10, 45)),
        Some(p(20261013, 1030))
    );
    assert_eq!(
        ultra_short_base(kst(2026, 10, 13, 0, 10)),
        Some(p(20261012, 2330))
    );
    assert_eq!(
        current_base(kst(2026, 10, 13, 10, 39)),
        Some(p(20261013, 900))
    );
    assert_eq!(
        current_base(kst(2026, 10, 13, 10, 40)),
        Some(p(20261013, 1000))
    );
    assert_eq!(
        current_base(kst(2026, 10, 13, 0, 39)),
        Some(p(20261012, 2300))
    );
    // Month and year rollover follow the calendar, not string arithmetic.
    assert_eq!(current_base(kst(2027, 1, 1, 0, 0)), Some(p(20261231, 2300)));
}

#[test]
fn mid_tm_fc_switches_at_08_and_20() {
    assert_eq!(mid_tm_fc(kst(2026, 10, 13, 7, 59)), Some(p(20261012, 1800)));
    assert_eq!(mid_tm_fc(kst(2026, 10, 13, 8, 0)), Some(p(20261013, 600)));
    assert_eq!(mid_tm_fc(kst(2026, 10, 13, 19, 59)), Some(p(20261013, 600)));
    assert_eq!(mid_tm_fc(kst(2026, 10, 13, 20, 0)), Some(p(20261013, 1800)));
}

#[test]
fn past_current_slots_follow_the_utc_minute_rule() {
    // UTC minute equals KST minute. >40 starts at the KST hour, otherwise one hour earlier.
    let late = past_current_bases(kst(2026, 10, 13, 1, 41)).unwrap();
    assert_eq!(late.len(), 23);
    assert_eq!(late[0], p(20261013, 100));
    assert_eq!(late[1], p(20261013, 0));
    assert_eq!(late[2], p(20261012, 2300));
    assert_eq!(late[22], p(20261012, 300));
    let early = past_current_bases(kst(2026, 10, 13, 1, 40)).unwrap();
    assert_eq!(early[0], p(20261013, 0));
    assert_eq!(early.len(), 23);
}

#[test]
fn life_index_slots_and_observation_hours() {
    assert_eq!(
        uv_slots(kst(2026, 10, 13, 14, 20)).unwrap(),
        vec![
            p(20261013, 1200),
            p(20261013, 900),
            p(20261013, 600),
            p(20261013, 300),
            p(20261013, 0)
        ]
    );
    assert_eq!(
        uv_slots(kst(2026, 10, 13, 1, 0)).unwrap(),
        vec![
            p(20261013, 0),
            p(20261012, 2100),
            p(20261012, 1800),
            p(20261012, 1500),
            p(20261012, 1200)
        ]
    );
    assert_eq!(
        pollen_time(kst(2026, 10, 13, 6, 59)),
        Some(p(20261013, 600))
    );
    assert_eq!(
        observation_hour(kst(2026, 10, 13, 6, 59)),
        Some(p(20261013, 600))
    );
}

#[test]
fn rss_latest_publication_keeps_the_legacy_formula() {
    assert_eq!(
        rss_latest(kst(2026, 10, 13, 2, 59)),
        Some(p(20261012, 2300))
    );
    assert_eq!(rss_latest(kst(2026, 10, 13, 3, 0)), Some(p(20261013, 200)));
    assert_eq!(rss_latest(kst(2026, 10, 13, 5, 59)), Some(p(20261013, 200)));
    assert_eq!(rss_latest(kst(2026, 10, 13, 6, 0)), Some(p(20261013, 500)));
    assert_eq!(
        rss_latest(kst(2026, 10, 13, 23, 0)),
        Some(p(20261013, 2000))
    );
}

#[test]
fn publication_identity_is_strict() {
    assert!(Publication::new(20261332, 0).is_none());
    assert!(Publication::new(20261013, 2400).is_none());
    assert!(Publication::new(20261013, 1060).is_none());
    let x = p(20261013, 930);
    assert_eq!(x.compact(), "202610130930");
    assert_eq!(x.partition(), "20261013-0930");
    assert_eq!(Publication::parse_compact("202610130930"), Some(x));
    assert_eq!(
        Publication::parse_dotted("2026.9.25.19:00"),
        Some(p(20260925, 1900))
    );
    assert_eq!(
        Publication::parse_dotted("2026.10.13.14:32"),
        Some(p(20261013, 1432))
    );
    assert!(Publication::parse_dotted("2026.10.13 14:32").is_none());
    assert!(Publication::parse_compact("20261013093").is_none());
    assert!(short_base(-1).is_none());
}
