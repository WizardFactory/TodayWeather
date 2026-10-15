//! Grid, ASOS and VC derivation: completeness thresholds, the stored date window, DST days,
//! late and early VC bodies and the live ASOS body.
use super::support::*;
use server2::domestic::asos::AsosKind;
use server2::domestic::kma::source::asos::AsosFetched;
use server2::summary::grid::GridInputs;
use server2::summary::{Source, SummaryKey, asos, grid, kst_midnight_ms, vc};
use server2::world::{Cell, Range, RawFetch};
use std::sync::Arc;

#[test]
fn grid_acquisitions_concern_every_date_their_rows_can_reach() {
    use server2::domestic::kma::source::{Family, Fetched, grid_input_id};
    let fetched = |partition: &str| Fetched {
        fetched_at_ms: 1,
        partition: partition.into(),
        pages: vec![Arc::from(b"{}".to_vec())],
    };
    // An ultra-short publication of D-1 12:00 can keep a trailing row of D (sky repair).
    let shortest = grid_input_id(
        Family::Shortest,
        "ultra-srt-fcst",
        &fetched("20261013-1200"),
    )
    .unwrap();
    assert!(shortest.concerns(20261014));
    assert!(!shortest.concerns(20261016));
    // A short publication reaches six days ahead; a current one only its own slot.
    let short = grid_input_id(Family::Short, "vilage-fcst", &fetched("20261010-2300")).unwrap();
    assert!(short.concerns(20261015));
    let current =
        grid_input_id(Family::Current, "ultra-srt-ncst", &fetched("20261014-0000")).unwrap();
    assert!(current.concerns(20261013) && !current.concerns(20261014));
}

fn inputs(ids: Vec<server2::summary::InputId>) -> GridInputs {
    GridInputs {
        town: town(),
        grid: (60, 127),
        ids,
        asos: None,
    }
}

#[test]
fn grid_keeps_complete_days_of_today_minus_six_to_minus_one() {
    // 2026-10-15 12:00 KST: stored dates 10-09 .. 10-14.
    let now = kst(20261015, 1200);
    assert_eq!(
        grid::dates(now),
        vec![20261009, 20261010, 20261011, 20261012, 20261013, 20261014]
    );
    // Before 01:00 yesterday's 2400 hour is today's live 00:00 row (minute page): not stored.
    assert_eq!(
        grid::dates(kst(20261015, 30)),
        vec![20261009, 20261010, 20261011, 20261012, 20261013]
    );
    assert_eq!(grid::dates(kst(20261015, 100)).last(), Some(&20261014));
    let start = kst_midnight_ms(20261014).unwrap();
    let ids = vec![
        input("ultra-srt-ncst", start + 3_600_000, start + 3_600_000, 10),
        input("ultra-srt-ncst", start + 86_400_000, start + 86_400_000, 20),
        // 10-14 00:00 is 10-13's 2400 hour.
        input("ultra-srt-ncst", start, start, 5),
    ];
    let rows = vec![
        day_row("20261008", 24., 20., 10.),
        day_row("20261012", 17., 20., 10.),
        day_row("20261013", 18., 21., 11.),
        day_row("20261014", 24., 22., 12.),
        day_row("20261015", 12., 18., 12.),
    ];
    let out = grid::summaries(&inputs(ids), &rows, now);
    let dates: Vec<u32> = out.iter().map(|s| s.date).collect();
    assert_eq!(dates, vec![20261013, 20261014]);
    let d14 = &out[1];
    assert_eq!(d14.key, SummaryKey::Grid { town: town() });
    assert_eq!(d14.grid, Some((60, 127)));
    assert_eq!(d14.values, rows[3], "values are the legacy row as emitted");
    assert_eq!(d14.inputs.count, 2);
    assert_eq!(d14.inputs.latest_fetched_ms, 20);
    // 10-13 owns only its 2400 hour among these inputs.
    assert_eq!(out[0].inputs.count, 1);
    assert_eq!(out[0].inputs.latest_fetched_ms, 5);
}

fn live_asos() -> AsosFetched {
    let body = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/summary/fixtures/asos-daily-108-20251012-20251018.json"),
    )
    .unwrap();
    AsosFetched {
        kind: AsosKind::Daily,
        start: "20251012".into(),
        end: "20251018".into(),
        fetched_at_ms: 1_791_000_000_000.,
        pages: vec![Arc::from(body)],
    }
}

#[test]
fn asos_live_range_normalizes_like_legacy_history() {
    let dates: Vec<u32> = (20251012..=20251018).collect();
    let out = asos::summaries("108", &[live_asos()], &dates);
    assert_eq!(out.len(), 7);
    let first = &out[0];
    assert_eq!(first.key.source(), Source::Asos);
    assert_eq!(first.date, 20251012);
    assert_eq!(
        String::from_utf8(first.values.to_bytes()).unwrap(),
        r#"{"taMin":17.6,"taMax":21.4,"t1d":19,"reh":84.6,"rn1":0.1,"wsd":2.3}"#
    );
    assert_eq!(out[1].value("rn1"), Some(25.1));
    assert!(out.iter().all(|s| s.inputs.count == 1));
    // Another station's rows never count.
    assert!(asos::summaries("119", &[live_asos()], &dates).is_empty());
}

#[test]
fn asos_requires_valid_ordered_extremes_and_keeps_rain_optional() {
    let body = |items: serde_json::Value| -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1,
                     "numOfRows": 999, "totalCount": 3}}}))
        .unwrap()
    };
    let fetched = AsosFetched {
        kind: AsosKind::Daily,
        start: "20251012".into(),
        end: "20251014".into(),
        fetched_at_ms: 1.,
        pages: vec![Arc::from(body(serde_json::json!([
            {"tm": "2025-10-12", "stnId": "108", "minTa": "12.0", "maxTa": "11.0", "sumRn": "1"},
            {"tm": "2025-10-13", "stnId": "108", "minTa": "", "maxTa": "11.0"},
            {"tm": "2025-10-14", "stnId": "108", "minTa": "-1.0", "maxTa": "3.0", "sumRn": ""},
        ])))],
    };
    let out = asos::summaries("108", &[fetched], &[20251012, 20251013, 20251014]);
    assert_eq!(
        out.len(),
        1,
        "inverted and missing extremes are not complete"
    );
    assert_eq!(out[0].date, 20251014);
    assert_eq!(out[0].value("rn1"), None);
}

/// A VC Timeline body for one local day of `zone` with `hours` hourly temperatures (°F).
fn vc_body(zone: &str, date: &str, start_epoch: i64, temps: &[f64], precip: f64) -> Vec<u8> {
    let hours: Vec<serde_json::Value> = temps
        .iter()
        .enumerate()
        .map(|(i, t)| {
            serde_json::json!({"datetime": format!("{:02}:00:00", i),
                               "datetimeEpoch": start_epoch + i as i64 * 3600, "temp": t})
        })
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "timezone": zone, "tzoffset": -5.0,
        "days": [{"datetime": date, "datetimeEpoch": start_epoch, "precip": precip,
                  "hours": hours}]}))
    .unwrap()
}
fn fetch(at_ms: u64, body: Vec<u8>) -> RawFetch {
    RawFetch {
        fetched_at_ms: at_ms,
        range: Range::Recent,
        first_date: 0,
        sha256: server2::storage::sha256(&body),
        body: Arc::from(body),
    }
}
const NYC: Cell = Cell {
    lat: 40.71,
    lon: -74.01,
};

#[test]
fn vc_counts_actual_local_hours_on_dst_days() {
    // America/New_York: 2026-03-08 has 23 hours, 2026-11-01 25, 2026-10-14 24.
    let cases = [
        ("2026-03-08", 20260308, 1_772_946_000_i64, 23, 18usize),
        ("2026-11-01", 20261101, 1_793_505_600, 25, 19),
        ("2026-10-14", 20261014, 1_791_950_400, 24, 18),
    ];
    for (label, date, start, local, needed) in cases {
        let after = (start + 86_400 * 2) as u64 * 1000;
        let enough = vc_body("America/New_York", label, start, &vec![50.; needed], 0.1);
        let s = vc::summary(NYC, date, &[fetch(after, enough)]).unwrap();
        assert_eq!(s.value("localHours"), Some(local as f64), "{label}");
        assert_eq!(s.value("observationHours"), Some(needed as f64));
        assert_eq!(s.value("taMin"), Some(10.));
        assert_eq!(s.value("rn1"), Some(2.5));
        let short = vc_body(
            "America/New_York",
            label,
            start,
            &vec![50.; needed - 1],
            0.1,
        );
        assert!(
            vc::summary(NYC, date, &[fetch(after, short)]).is_none(),
            "{label}: {} of {local} hours",
            needed - 1
        );
    }
}

#[test]
fn vc_uses_the_newest_body_fetched_after_the_local_day() {
    let start = 1_791_950_400_i64; // 2026-10-14 00:00 EDT
    let end_ms = (start + 86_400) as u64 * 1000;
    let warm = vc_body("America/New_York", "2026-10-14", start, &[68.; 24], 0.);
    let cold = vc_body("America/New_York", "2026-10-14", start, &[32.; 24], 0.);
    let forecast = vc_body("America/New_York", "2026-10-14", start, &[100.; 24], 0.);
    // A body fetched before the day ended holds forecasts: never used.
    let s = vc::summary(
        NYC,
        20261014,
        &[
            fetch(end_ms - 1, forecast.clone()),
            fetch(end_ms + 10, warm),
        ],
    )
    .unwrap();
    assert_eq!(s.value("taMax"), Some(20.));
    let s = vc::summary(
        NYC,
        20261014,
        &[
            fetch(end_ms + 20, cold),
            fetch(
                end_ms + 10,
                vc_body("America/New_York", "2026-10-14", start, &[68.; 24], 0.),
            ),
        ],
    )
    .unwrap();
    assert_eq!(s.value("taMax"), Some(0.), "newest eligible body");
    assert!(vc::summary(NYC, 20261014, &[fetch(end_ms - 1, forecast)]).is_none());
    assert_eq!(
        s.key,
        SummaryKey::Vc {
            lat: 4071,
            lon: -7401
        }
    );
    assert_eq!(s.inputs.latest_fetched_ms, end_ms + 20);
}
