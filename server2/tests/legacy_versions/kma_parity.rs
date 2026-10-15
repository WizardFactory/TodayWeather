//! PARITY (S17a): every pinned-oracle v000901/v000902 request assembles to the recorded legacy
//! bytes with the recorded dependency answers consumed in order; the S02 v000901/v000902
//! goldens are among them.
use super::support::*;
use server2::domestic::kma::{KmaStore, Outcome, assemble, middleware_of};

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
fn run(sc: &serde_json::Value) -> Result<(), String> {
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
    let declared = FORWARDED.iter().find(|(f, _)| *f == id);
    let actual = match outcome {
        Outcome::Json(json) => {
            if declared.is_some() {
                return Err(format!("{id}: expected a declared forward"));
            }
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
            return match declared {
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

#[test]
fn all_v000901_and_v000902_oracle_scenarios_match_legacy_bytes() {
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
    // The pinned recording: 93 v000901 requests (the 85 S15 scenarios, 8 v000901 air paths) and
    // 29 v000902 requests, plus the unversioned gateway default (a v000901 backend request).
    let count = |v: &str| scenarios().iter().filter(|s| s["version"] == v).count();
    assert_eq!((count("v000901"), count("v000902")), (94, 29));
    let mut ids: Vec<&str> = scenarios()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), scenarios().len(), "unique scenario ids");
    assert!(
        errors.is_empty(),
        "{} of {} differ:\n{}",
        errors.len(),
        scenarios().len(),
        errors.join("\n\n")
    );
}

/// The S02 direct-route v000901/v000902 goldens equal their oracle recordings (bodies and
/// Express ETags), so matching the recording is matching the golden.
#[test]
fn s02_v000901_and_v000902_goldens_equal_recorded_oracle_bodies() {
    for id in [
        "domestic-v000901",
        "domestic-v000901-db1",
        "domestic-v000902",
        "domestic-v000902-db1",
    ] {
        assert_eq!(
            scenario(id)["body"].as_str().unwrap(),
            golden_body(id),
            "{id}"
        );
        assert_eq!(
            scenario(id)["etag"].as_str(),
            golden_header(id, "etag"),
            "{id}"
        );
    }
    for id in ["domestic-v000901-304", "domestic-v000902-304"] {
        assert_eq!(golden(id)["status"], 304);
        assert_eq!(golden(id)["body_base64"], "");
    }
}

/// The router lists of `routes/v000901/route.kma.addr.js` and
/// `routes/v000902/route.kma.v000902.js` in legacy order.
#[test]
fn router_lists_follow_the_legacy_route_files() {
    let shared = [
        "checkQueryValidation",
        "checkParamValidation",
        "getAllDataFromDb",
        "getShort",
        "getShortRss",
        "getShortest",
        "getCurrent",
        "updateCurrentListForValidation",
        "mergeCurrentSkyByShortest",
        "mergeCurrentByStnHourly",
        "getKmaStnMinuteWeather",
        "convert0Hto24H",
        "mergeShortWithCurrentList",
        "mergeByShortest",
        "adjustShort",
        "getMid",
        "getMidRss",
        "convertMidKorStrToSkyInfo",
        "getPastMid",
        "mergeMidWithShort",
        "updateMidTempMaxMin",
        "getLifeIndexKma",
        "getKeco",
        "getKecoDustForecast",
        "getRiseSetInfo",
        "insertIndex",
        "makeAirInfo",
        "AirForecast",
    ];
    let tail = |icon: &'static str| {
        let mut v = shared.to_vec();
        v.extend([
            icon,
            "setYesterday",
            "convertUnits",
            "insertStrForData",
            "getSummaryAfterUnitConverter",
            "makeResult",
            "sendResult",
        ]);
        v
    };
    assert_eq!(middleware_of("v000901"), tail("insertSkyIcon"));
    assert_eq!(middleware_of("v000902"), tail("insertSkyIconLowCase"));
    assert_eq!(middleware_of("v000903").len(), 37);
    assert!(middleware_of("v000803").is_empty());
}
