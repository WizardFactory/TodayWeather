//! Client delivery eval (`server2/config/contracts/kma-client-wire.v1.json`): every recorded
//! v000705/v000803 town, v000901/v000902 and v000903 address scenario is assembled natively, in
//! legacy mode and with ASOS-primary history, and every body is checked by
//! `server2/tools/verification/kma_client_eval.py`.
use super::support::*;
use serde_json::{Value, json};
use server2::domestic::kma::{Outcome, assemble};
use server2::gateway::OrderedJson;
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::Command;

const EVAL: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tools/verification/kma_client_eval.py"
);

/// KST calendar date `offset` days from `ms`, as `YYYYMMDD`.
fn kst_day(ms: f64, offset: i64) -> String {
    let days = ((ms + 9. * 3_600_000.) / 86_400_000.).floor() as i64 + offset + 719_468;
    let (era, doe) = (days.div_euclid(146_097), days.rem_euclid(146_097));
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}{month:02}{day:02}")
}

/// ASOS-primary history for the seven completed KST days before `clock`: dry hours, one
/// untyped measured-rain hour (D-1 08:00, no phenomenon code) and one typed rain hour
/// (D-2 15:00). Daily totals agree with the hours.
fn history(clock: f64) -> OrderedJson {
    let mut hourly = Vec::new();
    let mut daily = Vec::new();
    for offset in -7..=-1 {
        let day = kst_day(clock, offset);
        for hour in 0..24 {
            let values = match (offset, hour) {
                (-1, 8) => json!({"t1h":17,"reh":60,"sky":4,"rn1":0.5,"wsd":2,"vec":180}),
                (-2, 15) => json!({"t1h":17,"reh":60,"sky":4,"pty":1,"rn1":1.0,"wsd":2,"vec":180}),
                _ => json!({"t1h":17,"reh":60,"sky":4,"pty":0,"rn1":0,"wsd":2,"vec":180}),
            };
            hourly.push(
                json!({"source":"KMA_ASOS","kind":"hourly","timeBasis":"UTC",
                "stationId":"108","key":format!("{day}{hour:02}00"),"values":values}),
            );
        }
        let rain = match offset {
            -1 => 0.5,
            -2 => 1.0,
            _ => 0.,
        };
        daily.push(json!({"source":"KMA_ASOS","kind":"daily","timeBasis":"UTC",
            "stationId":"108","key":day,
            "values":{"taMin":7,"taMax":27,"t1d":17,"rn1":rain,"reh":60,"wsd":2}}));
    }
    OrderedJson::parse(
        &serde_json::to_vec(&json!({"policy":"asos-primary-v1",
            "startDate":kst_day(clock, -7),"endDate":kst_day(clock, -1),
            "hourly":hourly,"daily":daily}))
        .unwrap(),
    )
    .unwrap()
}

/// The wire body of a 200 answer; an empty body for legacy `res.json(undefined)`.
fn body(sc: &Value, store: RecordedStore) -> Option<String> {
    let request = try_request(sc)?;
    let clock = clock_ms(sc["clock"].as_str().unwrap());
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        assemble(&request, &store, clock, oracle_config())
    }))
    .ok()?;
    match outcome {
        Outcome::Json(json) => Some(String::from_utf8(json.to_bytes()).unwrap()),
        Outcome::Undefined => Some(String::new()),
        _ => None,
    }
}

#[test]
fn native_bodies_of_every_version_in_use_meet_the_client_delivery_eval() {
    let dir = std::env::temp_dir().join(format!("server2-client-eval-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut manifest = Vec::new();
    let mut counts: BTreeMap<(String, &str), usize> = BTreeMap::new();
    for fixture in [&KMA, &TOWN, &S15] {
        for sc in fixture.scenarios() {
            let id = sc["id"].as_str().unwrap();
            if sc["status"] != 200
                || sc["method"] == "HEAD"
                || matches!(sc["path"].as_str(), Some("" | "/"))
            {
                continue;
            }
            let version = sc["version"].as_str().unwrap_or("v000903").to_string();
            let surface = if matches!(version.as_str(), "v000803" | "v000705") {
                "town"
            } else {
                "addr"
            };
            let clock = clock_ms(sc["clock"].as_str().unwrap());
            // Injected history would shift a recording that itself read ASOS history.
            let recorded_history = sc["calls"]
                .as_array()
                .is_some_and(|calls| calls.iter().any(|c| c["m"] == "history"));
            let mut variants = vec![("legacy", fixture.source().store_for(id))];
            if !recorded_history {
                let store = fixture.source().store_for(id);
                variants.push((
                    "asos-primary",
                    store.map(|s| s.with_history(history(clock))),
                ));
            }
            for (mode, store) in variants {
                let Some(text) = store.and_then(|store| body(sc, store)) else {
                    continue;
                };
                let observed = mode == "asos-primary"
                    && serde_json::from_str::<Value>(&text)
                        .is_ok_and(|b| b.get("historyStatus").is_some());
                let name = format!("{:04}-{mode}.json", manifest.len());
                std::fs::write(dir.join(&name), &text).unwrap();
                manifest.push(json!({"body": name, "id": id, "version": version,
                    "surface": surface, "observed_history": observed}));
                *counts.entry((version.clone(), mode)).or_default() += 1;
                if observed {
                    *counts.entry((version.clone(), "observed")).or_default() += 1;
                }
            }
        }
    }
    let manifest_path = dir.join("manifest.json");
    let report_path = dir.join("report.json");
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let out = Command::new("python3")
        .arg(EVAL)
        .args(["--manifest", manifest_path.to_str().unwrap()])
        .args(["--report", report_path.to_str().unwrap()])
        .output()
        .expect("python3 runs the stdlib-only eval");
    let report: Value = serde_json::from_slice(&std::fs::read(&report_path).unwrap()).unwrap();
    let mut violations = Vec::new();
    for (entry, result) in manifest.iter().zip(report["results"].as_array().unwrap()) {
        for finding in result["findings"].as_array().unwrap() {
            if finding["severity"] == "violation" {
                violations.push(format!("{} {}: {finding}", entry["id"], entry["body"]));
            }
        }
    }
    std::fs::remove_dir_all(&dir).unwrap();
    assert!(
        violations.is_empty() && out.status.success(),
        "{} violations, counts {counts:?}:\n{}\n{}",
        violations.len(),
        violations
            .iter()
            .take(30)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n"),
        String::from_utf8_lossy(&out.stderr)
    );
    for version in ["v000705", "v000803", "v000901", "v000902", "v000903"] {
        assert!(
            counts
                .get(&(version.to_string(), "legacy"))
                .copied()
                .unwrap_or(0)
                > 0,
            "{version} legacy bodies: {counts:?}"
        );
    }
    for version in ["v000901", "v000902", "v000903"] {
        assert!(
            counts
                .get(&(version.to_string(), "observed"))
                .copied()
                .unwrap_or(0)
                > 0,
            "{version} observed-history bodies: {counts:?}"
        );
    }
    eprintln!("client delivery eval counts: {counts:?}");
}
