//! PARITY (S17a, S17b): every pinned-oracle request of the older routers (v000901, v000902,
//! town v000803 and v000705) assembles to the recorded legacy status, bytes and ETag with the
//! recorded dependency answers consumed in order; the S02 goldens are among them.
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
    if sc["method"] == "HEAD" || matches!(sc["path"].as_str(), Some("" | "/")) {
        // HEAD and the usage roots are answered by the direct-route layer (`kma_direct.rs`).
        return Ok(());
    }
    let declared = FORWARDED.iter().find(|(f, _)| *f == id);
    let Some(request) = try_request(sc) else {
        return match declared {
            Some((_, "not routed")) => Ok(()),
            _ => Err(format!("{id}: path not routed")),
        };
    };
    let store = replay(sc);
    let outcome = assemble(
        &request,
        &store,
        clock_ms(sc["clock"].as_str().unwrap()),
        oracle_config(),
    );
    let expected = sc["body"].as_str().unwrap();
    let status = sc["status"].as_u64().unwrap() as u16;
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
        Outcome::Undefined => {
            // `res.json(undefined)`: 200, `application/json`, empty body, no ETag.
            if (
                status,
                sc["content_type"].as_str(),
                sc["etag"].as_str(),
                expected,
            ) != (200, Some("application/json"), None, "")
            {
                return Err(format!("{id}: native res.json(undefined), legacy {status}"));
            }
            return store
                .unconsumed()
                .map_or(Ok(()), |r| Err(format!("{id}: {r}")));
        }
        Outcome::Status(code, text) => {
            if code != status {
                return Err(format!("{id}: native {code}, legacy {status}"));
            }
            text
        }
        Outcome::Defect(reason) => panic!("native defect: {reason}"),
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
    let etag = (!(status >= 500 && actual == "Internal Server Error\n"))
        .then(|| server2::gateway::response::etag(actual.as_bytes()));
    if sc["etag"].as_str() != etag.as_deref() {
        return Err(format!("{id}: ETag {etag:?} vs {}", sc["etag"]));
    }
    if let Some(reason) = store.unconsumed() {
        return Err(format!("{id}: {reason}"));
    }
    Ok(())
}
fn run_all(fixture: &Fixture) -> Vec<String> {
    let mut errors = Vec::new();
    for sc in fixture.scenarios() {
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
    let mut ids: Vec<&str> = fixture
        .scenarios()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), fixture.scenarios().len(), "unique scenario ids");
    errors
}
fn count(fixture: &Fixture, version: &str) -> usize {
    fixture
        .scenarios()
        .iter()
        .filter(|s| s["version"] == version)
        .count()
}

#[test]
fn all_v000901_and_v000902_oracle_scenarios_match_legacy_bytes() {
    // 93 v000901 requests (the 85 S15 scenarios, 8 v000901 air paths) plus the unversioned
    // gateway default (a v000901 backend request), and 29 v000902 requests.
    assert_eq!((count(&KMA, "v000901"), count(&KMA, "v000902")), (94, 29));
    let errors = run_all(&KMA);
    assert!(
        errors.is_empty(),
        "{} of {} differ:\n{}",
        errors.len(),
        KMA.scenarios().len(),
        errors.join("\n\n")
    );
}

/// S17b: the town routers, including v000705 `res.json(undefined)` replies, the region guard
/// (400) and the v000705 sub-routes.
#[test]
fn all_town_oracle_scenarios_match_legacy_status_and_bytes() {
    assert_eq!(
        (
            count(&TOWN, "v000803"),
            count(&TOWN, "v000705"),
            count(&TOWN, "v000901")
        ),
        (58, 25, 3)
    );
    let errors = run_all(&TOWN);
    assert!(
        errors.is_empty(),
        "{} of {} differ:\n{}",
        errors.len(),
        TOWN.scenarios().len(),
        errors.join("\n\n")
    );
}

/// The S02 direct-route goldens equal their oracle recordings (bodies and Express ETags), so
/// matching the recording is matching the golden.
#[test]
fn s02_older_version_goldens_equal_recorded_oracle_bodies() {
    for id in [
        "domestic-v000901",
        "domestic-v000901-db1",
        "domestic-v000902",
        "domestic-v000902-db1",
        "domestic-v000803",
        "domestic-v000705",
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
    for id in [
        "domestic-v000901-304",
        "domestic-v000902-304",
        "domestic-v000803-304",
    ] {
        assert_eq!(golden(id)["status"], 304);
        assert_eq!(golden(id)["body_base64"], "");
    }
}

/// The router lists of `routes/v000901/route.kma.addr.js`, `routes/v000902/route.kma.v000902.js`,
/// `routes/v000803/routeTownForecast.js` and `routes/v000705/routeTownForecast.js` in legacy
/// order.
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
    assert_eq!(middleware_of("v000901", None), tail("insertSkyIcon"));
    assert_eq!(middleware_of("v000902", None), tail("insertSkyIconLowCase"));
    assert_eq!(middleware_of("v000903", None).len(), 37);
    fn town(names: &'static str) -> Vec<&'static str> {
        names.split(' ').collect()
    }
    assert_eq!(
        middleware_of("v000803", None),
        town(
            "checkParamValidation getAllDataFromDb getShort getShortRss getShortest getCurrent \
             updateCurrentListForValidation mergeCurrentSkyByShortest mergeCurrentByStnHourly \
             getKmaStnMinuteWeather convert0Hto24H mergeShortWithCurrentList mergeByShortest \
             adjustShort getMid getMidRss convertMidKorStrToSkyInfo getPastMid mergeMidWithShort \
             updateMidTempMaxMin getLifeIndexKma getKeco getKecoDustForecast getRiseSetInfo \
             insertIndex insertStrForData insertSkyIcon getSummary makeResult sendResult"
        )
    );
    assert_eq!(
        middleware_of("v000705", None),
        town(
            "checkParamValidation getAllDataFromDb getShort getShortRss getShortest getCurrent \
             updateCurrentListForValidation mergeCurrentByStnHourly getKmaStnMinuteWeather \
             convert0Hto24H mergeShortWithCurrentList mergeByShortest adjustShort getMid getMidRss \
             convertMidKorStrToSkyInfo getPastMid mergeMidWithShort getLifeIndexKma getKeco \
             getKecoDustForecast insertIndex insertStrForData insertSkyIcon getSummary dataToFixed \
             sendResult"
        )
    );
    assert_eq!(
        middleware_of("v000705", Some("mid")),
        town(
            "getMid getMidRss convertMidKorStrToSkyInfo getPastMid mergeMidWithShort \
             getLifeIndexKma getKeco getKecoDustForecast insertIndex insertSkyIcon \
             insertStrForData dataToFixed sendResult"
        )
    );
    assert_eq!(
        middleware_of("v000705", Some("short")),
        town(
            "getShort getShortRss getShortest convert0Hto24H mergeShortWithCurrentList \
             adjustShort getLifeIndexKma getKeco insertIndex insertStrForData insertSkyIcon \
             dataToFixed sendResult"
        )
    );
    assert_eq!(
        middleware_of("v000705", Some("shortest")),
        town(
            "getShortest convert0Hto24H insertIndex insertStrForData insertSkyIcon dataToFixed sendResult"
        )
    );
    assert_eq!(
        middleware_of("v000705", Some("current")),
        town(
            "getCurrent updateCurrentListForValidation mergeCurrentByStnHourly \
             getKmaStnMinuteWeather convert0Hto24H getLifeIndexKma getKeco insertIndex \
             insertStrForData insertSkyIcon getSummary dataToFixed sendResult"
        )
    );
    assert!(middleware_of("v000803", Some("mid")).is_empty());
    assert!(middleware_of("v000705", Some("other")).is_empty());
}
