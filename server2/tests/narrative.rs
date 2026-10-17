use axum::http::{HeaderMap, Method};
use server2::narrative;
use server2::{domestic::kma::Outcome, gateway::OrderedJson};

#[test]
fn frozen_legacy_contract_and_all_province_aliases() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("narrative/contract.json")).unwrap();
    let now = fixture["now_ms"].as_i64().unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let selected = narrative::select(
            case["stationId"].as_u64().unwrap() as u16,
            case["items"].as_array().unwrap(),
            now,
        );
        assert_eq!(
            selected.is_err(),
            case["rejected"].as_bool().unwrap(),
            "{}",
            case["id"]
        );
        let actual = selected.ok().flatten().map(|(_, n)| {
            assert_eq!(
                serde_json::to_string(&n).unwrap(),
                case["value_json"].as_str().unwrap(),
                "ordered wire {}",
                case["id"]
            );
            serde_json::to_value(n).unwrap()
        });
        assert_eq!(
            actual.unwrap_or(serde_json::Value::Null),
            case["value"],
            "{}",
            case["id"]
        );
    }
    for office in fixture["offices"].as_array().unwrap() {
        for alias in office["provinces"].as_array().unwrap() {
            let name = alias.as_str().unwrap();
            assert_eq!(
                narrative::office(&format!(" {name} ")),
                Some(office["stationId"].as_u64().unwrap() as u16)
            );
        }
    }
    assert_eq!(narrative::office("US"), None);
    for case in fixture["province_cases"].as_array().unwrap() {
        assert_eq!(
            narrative::office(case["input"].as_str().unwrap()),
            Some(case["stationId"].as_u64().unwrap() as u16)
        );
    }
    let numeric: serde_json::Value =
        serde_json::from_str(r#"[{"stnId":108.0,"tmFc":202610171100.0,"wfSv1":"plain"}]"#).unwrap();
    assert!(
        narrative::select(108, numeric.as_array().unwrap(), now)
            .unwrap()
            .is_some()
    );
}

#[test]
fn publication_calendar_and_cache_boundaries() {
    for bad in [
        "202602301100",
        "202613011100",
        "202601012400",
        "202601011260",
        "009901011100",
        "20260101110x",
    ] {
        assert_eq!(narrative::announcement(bad), None, "{bad}");
    }
    let now = narrative::announcement("202610171100").unwrap();
    assert_eq!(
        server2::world::js::iso(now as f64).unwrap(),
        "2026-10-17T02:00:00.000Z"
    );
    let body = br#"{"forecastNarrative":{"expiresAt":"2026-10-17T02:00:30.000Z"}}"#;
    assert_eq!(narrative::cache_age(body, Some(10), now), Some(10));
    assert_eq!(narrative::cache_age(body, Some(300), now + 1), Some(29));
    assert_eq!(narrative::cache_age(body, Some(300), now + 30_000), Some(0));
    assert_eq!(
        narrative::cache_age(br#"{"weather":[]}"#, Some(300), now),
        None
    );
}

#[tokio::test(start_paused = true)]
async fn background_first_tick_is_delayed_and_stop_owns_pending_work() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Pending {
        started: Arc<AtomicUsize>,
        dropped: Arc<AtomicUsize>,
    }
    struct Guard(Arc<AtomicUsize>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl narrative::Acquire for Pending {
        fn refresh(&self) -> server2::gateway::BoxFuture<'_, ()> {
            Box::pin(async move {
                self.started.fetch_add(1, Ordering::SeqCst);
                let _g = Guard(self.dropped.clone());
                std::future::pending::<()>().await;
            })
        }
    }
    let started = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let worker = narrative::worker(
        Arc::new(Pending {
            started: started.clone(),
            dropped: dropped.clone(),
        }),
        std::time::Duration::from_secs(180),
    );
    tokio::task::yield_now().await;
    assert_eq!(started.load(Ordering::SeqCst), 0);
    tokio::time::advance(std::time::Duration::from_secs(179)).await;
    assert_eq!(started.load(Ordering::SeqCst), 0);
    tokio::time::advance(std::time::Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(started.load(Ordering::SeqCst), 1);
    worker.stop().await;
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn attached_narrative_caps_direct_cache_before_head_and_304() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let expires = server2::world::js::iso(now + 30_000.).unwrap();
    let bytes = serde_json::to_vec(&serde_json::json!({
        "source":"KMA", "forecastNarrative":{"expiresAt":expires}
    }))
    .unwrap();
    let response = server2::api::express(
        &Method::HEAD,
        &HeaderMap::new(),
        Outcome::Json(OrderedJson::parse(&bytes).unwrap()),
    );
    let age = response
        .headers()
        .get("cache-control")
        .and_then(|v| v.to_str().ok());
    assert!(
        age.is_some_and(|v| v
            .strip_prefix("max-age=")
            .and_then(|s| s.parse::<u32>().ok())
            .is_some_and(|n| n <= 30)),
        "attached prose must cap cache age: {age:?}"
    );
    let tag = response.headers()["etag"].clone();
    assert!(
        axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty()
    );
    let mut conditional = HeaderMap::new();
    conditional.insert("if-none-match", tag);
    let response = server2::api::express(
        &Method::GET,
        &conditional,
        Outcome::Json(OrderedJson::parse(&bytes).unwrap()),
    );
    assert_eq!(response.status(), 304);
    assert!(
        response.headers()["cache-control"]
            .to_str()
            .unwrap()
            .starts_with("max-age=")
    );
    assert!(
        axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty()
    );
}

#[test]
fn gateway_caps_existing_age_and_preserves_error_no_store() {
    use axum::http::StatusCode;
    let expires = server2::world::js::iso((narrative::now_ms() + 30_000) as f64).unwrap();
    let body = serde_json::to_vec(&serde_json::json!({"forecastNarrative":{"expiresAt":expires}}))
        .unwrap();
    for method in [Method::GET, Method::HEAD] {
        let response = server2::gateway::response::send(
            &method,
            &HeaderMap::new(),
            StatusCode::OK,
            body.clone(),
            Some(10),
            None,
        );
        assert_eq!(response.headers()["cache-control"], "max-age=10");
        let mut headers = HeaderMap::new();
        headers.insert("if-none-match", response.headers()["etag"].clone());
        let conditional = server2::gateway::response::send(
            &method,
            &headers,
            StatusCode::OK,
            body.clone(),
            Some(10),
            None,
        );
        assert_eq!(conditional.status(), 304);
        assert_eq!(conditional.headers()["cache-control"], "max-age=10");
    }
    let error = server2::gateway::response::send(
        &Method::GET,
        &HeaderMap::new(),
        StatusCode::BAD_GATEWAY,
        body,
        None,
        None,
    );
    assert_eq!(error.headers()["cache-control"], "no-store");
}
