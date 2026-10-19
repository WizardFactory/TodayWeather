//! Owned process/provider/S3 rehearsal. Never reads product environment or real accounts.
#[allow(dead_code)]
#[path = "../tests/runtime_services/common.rs"]
mod common;
#[tokio::main]
async fn main() {
    let no_http = common::warning_case(common::WarningCase::NoHttp).await;
    assert_eq!(no_http["feed_events"], 1);
    assert!(no_http["provider_calls_after_bind"].as_u64().unwrap() > 0);
    assert!(no_http["new_native_source_puts"].as_u64().unwrap() > 0);
    let shared = common::warning_case(common::WarningCase::Shared).await;
    assert_eq!(shared["feed_events"], 1);
    assert_eq!(
        shared["provider_calls_after_bind"],
        shared["baseline_provider_calls"]
    );
    let stop = common::warning_case(common::WarningCase::HeldStop).await;
    assert_eq!(stop["drain_waited_for_provider"], true);
    assert_eq!(stop["feed_events"], 1);
    let recurring = common::warning_case(common::WarningCase::Recurring).await;
    assert_eq!(recurring["feed_events"], 2);
    let ms = recurring["cadence_ms"].as_u64().unwrap();
    assert!(
        (170_000..185_000).contains(&ms),
        "normal180s recurrence: {ms}"
    );
    assert_eq!(
        recurring["provider_calls_after_bind"].as_u64().unwrap(),
        2 * recurring["baseline_provider_calls"].as_u64().unwrap()
    );
    for report in [&no_http, &shared, &stop, &recurring] {
        assert_eq!(report["provider_listener_closed"], true);
        assert_eq!(report["storage_listener_closed"], true);
        assert_eq!(report["process_listener_failure_reported"], true);
    }
    println!(
        "C5_ACQUISITION {}",
        serde_json::json!({"no_http":no_http,"shared":shared,
        "stop":stop,"recurring":recurring,"scope":"owned loopback process, explicit prior quiet baseline; no live device/provider/shadow proof"})
    );
}
