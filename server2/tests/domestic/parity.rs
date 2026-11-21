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
    if matches!(id, "domestic-special-info" | "warning-two-zones") {
        return run_narrowed_seoul_warning_scenario(sc);
    }
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
        // `res.json(undefined)` exists only on the v000705 town route.
        Outcome::Undefined => return Err(format!("{id}: native res.json(undefined)")),
        Outcome::Legacy(reason) => {
            // A declared forward: legacy answers this request (the port does not reproduce it).
            return match FORWARDED.iter().find(|(f, _)| *f == id) {
                Some((_, why)) if reason.contains(why) => Ok(()),
                _ => Err(format!("{id}: native forwarded ({reason})")),
            };
        }
        Outcome::Defect(reason) => return Err(format!("{id}: defect ({reason})")),
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

/// #3085: the pinned S02/S15 recordings for `domestic-special-info` and `warning-two-zones`
/// query `서울특별시/종로구/청운효자동` against pre-#3084 legacy (all 4 Seoul sub-zones).
/// Under #3084/#3085, 종로구 narrows to `서울서북권` (`L1100400`) plus `L1100000`/`L1000000`
/// and excludes sibling `서울동남권` (`L1100100`) warnings while keeping every other field,
/// key order, HTTP status, and derived Express ETag byte-for-byte identical.
fn run_narrowed_seoul_warning_scenario(sc: &serde_json::Value) -> Result<(), String> {
    use server2::gateway::OrderedJson;

    fn utf16(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }
    fn ostr(s: &str) -> OrderedJson {
        OrderedJson::String(utf16(s))
    }
    fn replace_field(
        entries: &mut [(Vec<u16>, OrderedJson)],
        name: &str,
        value: OrderedJson,
    ) -> Result<(), String> {
        let key = utf16(name);
        let (_, slot) = entries
            .iter_mut()
            .find(|(k, _)| *k == key)
            .ok_or_else(|| format!("missing expected field `{name}` in recorded fixture"))?;
        *slot = value;
        Ok(())
    }

    let id = sc["id"].as_str().unwrap();
    let status = sc["status"].as_u64().unwrap() as u16;
    if status != 200 {
        return Err(format!("{id}: expected recorded status 200, got {status}"));
    }
    let store = replay(sc).with_expected_special_zones(vec![
        "L1100400".into(),
        "L1100000".into(),
        "L1000000".into(),
    ]);
    let outcome = assemble(
        &request(sc),
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    );
    let actual = match outcome {
        Outcome::Json(json) => String::from_utf8(json.to_bytes()).unwrap(),
        Outcome::Status(code, _) => return Err(format!("{id}: native {code}, legacy {status}")),
        other => return Err(format!("{id}: unexpected outcome {other:?}")),
    };
    let mut expected_ordered = OrderedJson::parse(sc["body"].as_str().unwrap().as_bytes())
        .map_err(|e| format!("{id}: failed to parse recorded body as OrderedJson: {e:?}"))?;
    let current_key = utf16("current");
    let OrderedJson::Object(top_entries) = &mut expected_ordered else {
        return Err(format!("{id}: recorded body is not a JSON object"));
    };
    let (_, OrderedJson::Object(cur_entries)) = top_entries
        .iter_mut()
        .find(|(k, _)| *k == current_key)
        .ok_or_else(|| format!("{id}: missing `current` in recorded body"))?
    else {
        return Err(format!("{id}: recorded `current` is not a JSON object"));
    };
    let expected_etag = match id {
        "domestic-special-info" => {
            let special_key = utf16("specialInfo");
            let before = cur_entries.len();
            cur_entries.retain(|(k, _)| *k != special_key);
            if cur_entries.len() == before {
                return Err(format!("{id}: recorded fixture missing `specialInfo`"));
            }
            replace_field(cur_entries, "summaryWeather", ostr("어제와 비슷, 맑음"))?;
            replace_field(cur_entries, "summary", ostr("어제와 비슷, 맑음"))?;
            // Independently computed Express weak ETag (byte length 32986, base64-no-pad MD5).
            r#"W/"80da-22VAYrzbo8ML076i4eBQ4A""#
        }
        "warning-two-zones" => {
            let narrowed_info = OrderedJson::Array(vec![OrderedJson::Object(vec![
                (utf16("weather"), OrderedJson::Number(9.0)),
                (utf16("weatherStr"), ostr("한파")),
                (utf16("level"), OrderedJson::Number(1.0)),
                (utf16("levelStr"), ostr("주의보")),
                (utf16("locationName"), ostr("서울서북권")),
            ])]);
            replace_field(cur_entries, "specialInfo", narrowed_info)?;
            replace_field(
                cur_entries,
                "summaryWeather",
                ostr("한파주의보, Similar to yesterday"),
            )?;
            replace_field(
                cur_entries,
                "summary",
                ostr("한파주의보, Similar to yesterday"),
            )?;
            // Independently computed Express weak ETag (byte length 32436, base64-no-pad MD5).
            r#"W/"7eb4-SiEkTe4NsbB3Y9uLpE7rXQ""#
        }
        _ => unreachable!(),
    };
    let expected_bytes = expected_ordered.to_bytes();
    let expected = String::from_utf8(expected_bytes).unwrap();
    if actual != expected {
        return Err(format!(
            "{id}: body differs {}",
            first_difference(&actual, &expected)
        ));
    }
    let actual_etag = server2::gateway::response::etag(actual.as_bytes());
    if actual_etag != expected_etag {
        return Err(format!("{id}: ETag {actual_etag} vs {expected_etag}"));
    }
    if let Some(reason) = store.unconsumed() {
        return Err(format!("{id}: {reason}"));
    }
    Ok(())
}

/// The pinned recording, in order (unique ids); change deliberately with the recording.
const SCENARIOS: [&str; 98] = [
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
    "air-kaq-after-now",
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

/// The replay exception is restricted to the optional, empty final narrative read.
#[test]
fn empty_optional_narrative_tail_is_strict() {
    let fixture: serde_json::Value =
        serde_json::json!({"schema": 1, "scenarios": [scenario("domestic-v000903")]});
    let parse = |v: &serde_json::Value| RecordedSource::parse(&serde_json::to_vec(v).unwrap());
    // Keep the recording header used by RecordedSource (schema/oracle/source are not rewritten).
    assert!(parse(&fixture).is_ok());
    for kind in 0..5 {
        let mut v = fixture.clone();
        let calls = v["scenarios"][0]["calls"].as_array_mut().unwrap();
        let last = calls.len() - 1;
        match kind {
            0 => calls[last]["result"] = serde_json::json!([{"text":"present"}]),
            1 => calls[last]["error"] = serde_json::json!("read failure"),
            2 => calls[last]["args"] = serde_json::json!([{"stationId":109,"extra":true}]),
            3 => calls[last]["args"] = serde_json::json!([{"stationId":"109"}]),
            _ => {
                calls.swap(last - 1, last);
            }
        }
        assert!(parse(&v).is_err(), "invalid optional narrative case {kind}");
    }
}

/// Removing the redundant primary list must preserve the same stored-history chart:
/// legacy retains station-list[0] before replacing the current with provider fallback.
#[test]
fn fallback_history_uses_station_list_when_primary_missing() {
    let mut sc = scenario("air-stale").clone();
    let calls = sc["calls"].as_array_mut().unwrap();
    let air = calls.iter_mut().find(|c| c["m"] == "arpltn").unwrap();
    assert_eq!(air["result"]["list"], air["result"]["stnList"][0]);
    assert!(
        air["result"]
            .as_object_mut()
            .unwrap()
            .remove("list")
            .is_some()
    );
    run(&sc).unwrap();
}
