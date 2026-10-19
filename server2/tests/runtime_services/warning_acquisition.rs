use super::common::{WarningCase, warning_case};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bound_push_process_publishes_changed_warning_without_product_http() {
    let report = warning_case(WarningCase::NoHttp).await;
    eprintln!("C5_NO_HTTP {report}");
    assert!(report["provider_listener_closed"].as_bool().unwrap());
    assert!(
        report["process_listener_failure_reported"]
            .as_bool()
            .unwrap()
    );
    assert!(report["native_source_put"].as_bool().unwrap());
    assert!(
        report["provider_calls_after_bind"].as_u64().unwrap() > 0,
        "a bound push process must acquire warnings without product HTTP"
    );
    assert_eq!(report["feed_events"], 1);
    assert!(report["new_native_source_puts"].as_u64().unwrap() > 0);
    assert!(report["storage_listener_closed"].as_bool().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn http_only_source_does_not_start_periodic_acquisition() {
    let report = warning_case(WarningCase::HttpOnly).await;
    assert_eq!(report["bound"], true);
    assert_eq!(report["provider_calls_after_bind"], 0);
    assert_eq!(report["feed_events"], 0);
    assert_eq!(report["new_native_source_puts"], 0);
    assert_eq!(report["provider_listener_closed"], true);
    assert_eq!(report["storage_listener_closed"], true);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn second_bind_failure_never_starts_warning_acquisition() {
    let report = warning_case(WarningCase::FailedBind).await;
    assert_eq!(report["bound"], false);
    assert_eq!(report["provider_calls_after_bind"], 0);
    assert_eq!(report["feed_events"], 0);
    assert_eq!(report["process_listener_failure_reported"], true);
    assert_eq!(report["provider_listener_closed"], true);
    assert_eq!(report["storage_listener_closed"], true);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_joiners_share_the_periodic_sources_actual_owned_collection() {
    let report = warning_case(WarningCase::Shared).await;
    eprintln!("C5_SHARED {report}");
    assert_eq!(
        report["provider_calls_after_bind"], report["baseline_provider_calls"],
        "four same-source request joins must not make another provider cycle"
    );
    assert_eq!(report["feed_events"], 1);
    assert_eq!(report["shared_waiters"], 4);
    let wait = report["shared_wait_ms"].as_u64().unwrap();
    assert!(
        (2900..4000).contains(&wait),
        "request wait remains bounded by existing3s: {wait}"
    );
    assert_eq!(report["provider_listener_closed"], true);
    assert_eq!(report["storage_listener_closed"], true);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listener_stop_drains_the_actual_held_provider_before_process_exit() {
    let report = warning_case(WarningCase::HeldStop).await;
    eprintln!("C5_STOP {report}");
    assert_eq!(report["drain_waited_for_provider"], true);
    assert_eq!(
        report["feed_events"], 1,
        "existing publication may complete during grace"
    );
    assert_eq!(
        report["provider_calls_after_bind"],
        report["baseline_provider_calls"]
    );
    assert!(report["new_native_source_puts"].as_u64().unwrap() > 0);
    assert_eq!(report["process_listener_failure_reported"], true);
    assert_eq!(report["provider_listener_closed"], true);
    assert_eq!(report["storage_listener_closed"], true);
}
