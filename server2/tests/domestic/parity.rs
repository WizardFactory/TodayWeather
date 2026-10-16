//! PARITY: every pinned-oracle request assembles to the recorded legacy bytes with the
//! recorded dependency answers consumed in order; the S02 v000903 KMA goldens are among them.
use super::support::*;
use server2::domestic::kma::{KmaStore, Outcome, assemble};

fn first_difference(a: &str, b: &str) -> String {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let i = a
        .iter()
        .zip(b)
        .position(|(x, y)| x != y)
        .unwrap_or(a.len().min(b.len()));
    let from = i.saturating_sub(120);
    format!(
        "at byte {i}\n  native: {}\n  legacy: {}",
        String::from_utf8_lossy(&a[from..(i + 120).min(a.len())]),
        String::from_utf8_lossy(&b[from..(i + 120).min(b.len())])
    )
}
pub fn run(sc: &serde_json::Value) -> Result<(), String> {
    let id = sc["id"].as_str().unwrap();
    let store = replay(sc);
    let outcome = assemble(
        &request(sc),
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    );
    let expected = sc["body"].as_str().unwrap();
    let status = sc["status"].as_u64().unwrap() as u16;
    if let Some((_, why)) = FORWARDED.iter().find(|(f, _)| *f == id)
        && !matches!(&outcome, Outcome::Legacy(r) if r.contains(why))
    {
        return Err(format!("{id}: expected a forward ({why})"));
    }
    let actual = match outcome {
        Outcome::Json(json) => {
            if status != 200 {
                return Err(format!("{id}: native 200, legacy {status}"));
            }
            String::from_utf8(json.to_bytes()).unwrap()
        }
        Outcome::Status(code, text) => {
            if code != status {
                return Err(format!("{id}: native {code}, legacy {status}"));
            }
            text
        }
        Outcome::Legacy(reason) => {
            // A declared forward: legacy answers this request (the port does not reproduce it).
            return match FORWARDED.iter().find(|(f, _)| *f == id) {
                Some((_, why)) if reason.contains(why) => Ok(()),
                _ => Err(format!("{id}: native forwarded ({reason})")),
            };
        }
    };
    if actual != expected {
        return Err(format!(
            "{id}: body differs {}",
            first_difference(&actual, expected)
        ));
    }
    if status == 200 {
        let etag = server2::gateway::response::etag(actual.as_bytes());
        if sc["etag"].as_str() != Some(etag.as_str()) {
            return Err(format!("{id}: ETag {etag} vs {}", sc["etag"]));
        }
    }
    if let Some(reason) = store.unconsumed() {
        return Err(format!("{id}: {reason}"));
    }
    Ok(())
}

/// The pinned recording, in order (unique ids); change deliberately with the recording.
const SCENARIOS: [&str; 97] = [
    "domestic-v000903",
    "domestic-locale-en",
    "domestic-locale-ko",
    "domestic-locale-ja",
    "domestic-locale-zh-CN",
    "domestic-locale-de",
    "domestic-locale-zh-TW",
    "domestic-v000903-db1",
    "domestic-null-units",
    "domestic-pop-covered",
    "domestic-pop-missing-hour",
    "domestic-old-no-pop",
    "domestic-never-requested-history",
    "domestic-partial-history",
    "domestic-special-info",
    "gateway-v000903-domestic",
    "gateway-query-normalization",
    "gateway-history-never-requested",
    "gateway-history-resumed-after-eight-days",
    "gateway-history-partial-eight-day-history",
    "rss-older",
    "rss-equal",
    "busan",
    "jeju",
    "station-first-rain",
    "station-first-snow-cloud",
    "rain-categories",
    "air-stations",
    "air-stations-airnow",
    "air-stale",
    "air-kaq-forecast",
    "air-kaq-past-only",
    "air-kaq-missing",
    "air-kaq-none-usable",
    "air-kaq-invalid-rows",
    "air-kaq-mixed-rows",
    "air-kaq-beyond-day",
    "air-kaq-day-edge",
    "air-kaq-no-history",
    "air-kaq-fallback-error",
    "air-airkorea-request",
    "air-airkorea-empty",
    "air-kaq-before-now",
    "air-dust-forecast",
    "air-fallback",
    "life-food-kasi",
    "life-index-near-area",
    "warning-two-zones",
    "winter-cold-wind",
    "hot-humid",
    "missing-short",
    "model-errors",
    "unknown-air-unit",
    "db1-history",
    "stn-error",
    "station-hourly-fill",
    "db1-daily-source",
    "short-publications",
    "current-error",
    "mid-forecast-error",
    "yesterday-warmer",
    "yesterday-colder",
    "rss-unusable-values",
    "current-sky-from-shortest",
    "stn-invalid-zero",
    "stn-fog-thunder",
    "region-guard",
    "clock-night-2340",
    "clock-kst-0030",
    "clock-kst-1010",
    "clock-kst-1110",
    "clock-kst-0605",
    "clock-kst-1535",
    "rss-pub-invalid-offset",
    "rss-pub-hour24-fraction",
    "rss-pub-non-ascii-offset",
    "rss-pub-non-ascii",
    "rss-pub-iso-offset",
    "rss-pub-hour24-submillisecond",
    "current-pub-small-year",
    "stn-boolean-datetime-false",
    "stn-boolean-datetime-true",
    "life-index-hex-area",
    "life-index-long-hex-area",
    "query-malformed-escape",
    "current-interpolated-strings",
    "stn-cloud-radix-sign",
    "stn-small-year-datetime",
    "history-stations-unconfigured",
    "history-asos-fill",
    "history-asos-fill-en",
    "history-read-timeout",
    "history-station-unavailable",
    "history-read-error",
    "history-with-station-hourly",
    "history-yesterday-from-asos",
    "history-short-rain-3h",
];

#[test]
fn all_oracle_scenarios_match_legacy_bytes() {
    let mut errors = Vec::new();
    for sc in scenarios() {
        if let Err(e) = std::panic::catch_unwind(|| run(sc)).unwrap_or_else(|p| {
            Err(format!(
                "{}: panic {}",
                sc["id"],
                p.downcast_ref::<String>()
                    .cloned()
                    .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default()
            ))
        }) {
            errors.push(e);
        }
    }
    let recorded: Vec<&str> = scenarios()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(recorded, SCENARIOS, "the pinned scenario set changed");
    assert!(
        errors.is_empty(),
        "{} of {} differ:\n{}",
        errors.len(),
        scenarios().len(),
        errors.join("\n\n")
    );
}

/// The S02 direct-route v000903 goldens are byte-identical to their oracle recordings
/// (so matching the recording is matching the golden), including the Express ETag/304 tag.
#[test]
fn s02_direct_goldens_equal_recorded_oracle_bodies() {
    let ids = [
        "domestic-v000903",
        "domestic-locale-en",
        "domestic-locale-ko",
        "domestic-locale-ja",
        "domestic-locale-zh-CN",
        "domestic-locale-de",
        "domestic-locale-zh-TW",
        "domestic-v000903-db1",
        "domestic-null-units",
        "domestic-pop-covered",
        "domestic-pop-missing-hour",
        "domestic-old-no-pop",
        "domestic-never-requested-history",
        "domestic-partial-history",
        "domestic-special-info",
    ];
    for id in ids {
        assert_eq!(
            scenario(id)["body"].as_str().unwrap(),
            golden_body(id),
            "{id}"
        );
        let etag = golden(id)["headers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h[0] == "etag")
            .map(|h| h[1].clone())
            .unwrap();
        assert_eq!(scenario(id)["etag"], etag, "{id}");
    }
    // The 304 golden revalidates the v000903 ETag with an empty body.
    let revalidate = golden("domestic-v000903-304");
    assert_eq!(revalidate["status"], 304);
    assert_eq!(revalidate["body_base64"], "");
}
