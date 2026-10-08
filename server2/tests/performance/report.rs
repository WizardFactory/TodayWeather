#[allow(dead_code)]
#[path = "../../tools/benchmark/model.rs"]
mod model;
#[test]
fn all_request_tail_includes_failures() {
    assert_eq!(
        model::quantile(&[30, 10, 20, 3_000_000], 95),
        Some(3_000_000)
    );
    assert_eq!(model::quantile(&[30, 10, 20, 3_000_000], 50), Some(20));
    assert_eq!(model::quantile(&[], 95), None);
}
#[test]
fn explicit_loopback_only_before_io() {
    assert!(model::loopback("http://127.0.0.1:12345/"));
    for bad in [
        "https://s3.amazonaws.com/",
        "http://localhost:123/",
        "http://127.0.0.1:123/?redirect=remote",
        "http://u:p@127.0.0.1:123/",
    ] {
        assert!(!model::loopback(bad), "target {bad}");
    }
}

#[test]
fn config_bounds_reject_before_requests() {
    let mut c: model::Config =
        serde_json::from_str(include_str!("../../config/benchmarks/local.json")).unwrap();
    assert!(c.validate().is_ok());
    c.cases[0].clients = 65;
    assert!(c.validate().is_err());
    c.cases[0].clients = 64;
    c.cases[0].revisions = 240;
    assert!(c.validate().is_err());
}
#[test]
fn outcome_denominators_remain_distinct() {
    let samples = vec![
        model::Sample {
            trial: 0,
            client: 0,
            elapsed_us: Some(10),
            outcome: "success".into(),
            returned_bytes: 10,
            components: vec![],
        },
        model::Sample {
            trial: 0,
            client: 1,
            elapsed_us: Some(3_000_000),
            outcome: "timeout".into(),
            returned_bytes: 0,
            components: vec![],
        },
    ];
    let summary = model::summarize(&samples);
    assert_eq!(summary.all_requests.p95_us, Some(3_000_000));
    assert_eq!(summary.successful_requests.p95_us, Some(10));
    assert_eq!(summary.outcomes["timeout"], 1);
    assert!(summary.insufficient_for_tail_claim);
}

#[test]
fn unavailable_samples_are_not_zero_latency_or_tail_evidence() {
    let samples: Vec<_> = (0..100)
        .map(|i| model::Sample {
            trial: i,
            client: 0,
            elapsed_us: None,
            outcome: "warm_unavailable".into(),
            returned_bytes: 0,
            components: vec![],
        })
        .collect();
    let s = model::summarize(&samples);
    assert_eq!(s.all_requests.count, 0);
    assert_eq!(s.all_requests.p95_us, None);
    assert_eq!(s.unmeasured_samples, 100);
    assert!(s.insufficient_for_tail_claim);
    assert!(s.success_subset_insufficient_for_tail_claim);
}

#[test]
fn runner_resource_units_and_gate_rejection() {
    let script = [
        r#"import importlib.util"#,
        r#"from types import SimpleNamespace"#,
        r#"spec=importlib.util.spec_from_file_location('benchmark_runner','tools/benchmark/run.py')"#,
        r#"runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)"#,
        r#"usage=SimpleNamespace(ru_utime=1.25,ru_stime=0.5,ru_maxrss=1234)"#,
        r#"assert runner.resource_result(usage,'darwin')['peak_rss_bytes']==1234"#,
        r#"assert runner.resource_result(usage,'linux')['peak_rss_bytes']==1234*1024"#,
        r#"assert runner.resource_result(usage,'unknown')['peak_rss_bytes'] is None"#,
        r#"try:runner.validate_report({'schema':1,'gate_status':'PASS'})"#,
        r#"except ValueError:pass"#,
        r#"else:raise AssertionError('local report released actual host gate')"#,
    ].join("\n");
    let out = std::process::Command::new("python3")
        .args(["-c", script.as_str()])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
