use super::common::Peer;
use server2::{push::deliver::Endpoints, runtime_services::RuntimeServices};
use std::time::Duration;

async fn stop(services: RuntimeServices) {
    super::common::ready(&services).await;
    if let Some(push) = services.push {
        push.quiesce();
        assert!(
            push.drain(tokio::time::Instant::now() + Duration::from_secs(2))
                .await
        );
    }
}

#[tokio::test]
async fn missing_active_account_is_rejected_before_push_startup() {
    let peer = Peer::new();
    let defaults = peer.vars("push");
    let vars = |name: &str| match name {
        "SERVER2_FIREBASE_TODAYWEATHER" | "SERVER2_FIREBASE_TODAYAIR" => None,
        _ => defaults(name),
    };
    let result = RuntimeServices::from_vars_with_fcm(
        &vars,
        &peer.builtins(),
        Endpoints::loopback("http://127.0.0.1:9/"),
    );
    let rejected = result.is_err();
    // The unchanged runtime accepts this configuration. Retire its owned writer
    // before the regression assertion, so intended Red leaves no background task.
    if let Ok(services) = result {
        super::common::ready(&services).await;
        let push = services.push.unwrap();
        push.quiesce();
        assert!(
            push.drain(tokio::time::Instant::now() + Duration::from_secs(2))
                .await
        );
    }
    assert!(
        rejected,
        "missing active account must reject startup before writer creation"
    );
}

#[tokio::test]
async fn invalid_accounts_fail_before_storage_construction() {
    use std::cell::Cell;
    for case in [
        "empty",
        "missing-file",
        "directory",
        "json",
        "project",
        "email",
        "rsa",
        "air-only",
        "invalid-air",
    ] {
        let peer = Peer::new();
        let defaults = peer.vars("push");
        let valid = defaults("SERVER2_FIREBASE_TODAYWEATHER").unwrap();
        let other = Peer::new();
        let invalid_air = other.vars("push")("SERVER2_FIREBASE_TODAYWEATHER").unwrap();
        let mut doc: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&valid).unwrap()).unwrap();
        let active = match case {
            "empty" => Some(String::new()),
            "missing-file" => Some(format!("{valid}.missing")),
            "directory" => Some(
                std::path::Path::new(&valid)
                    .parent()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned(),
            ),
            "json" => {
                std::fs::write(&valid, b"not-json").unwrap();
                Some(valid.clone())
            }
            "project" | "email" | "rsa" => {
                match case {
                    "project" => {
                        doc.as_object_mut().unwrap().remove("project_id");
                    }
                    "email" => {
                        doc["client_email"] = serde_json::json!("");
                    }
                    _ => {
                        doc["private_key"] = serde_json::json!("invalid-rsa");
                    }
                }
                std::fs::write(&valid, serde_json::to_vec(&doc).unwrap()).unwrap();
                Some(valid.clone())
            }
            "air-only" => None,
            _ => Some(valid.clone()),
        };
        std::fs::write(&invalid_air, b"invalid-air-json").unwrap();
        let storage_queries = Cell::new(0);
        let vars = |name: &str| match name {
            "SERVER2_FIREBASE_TODAYWEATHER" => active.clone(),
            "SERVER2_FIREBASE_TODAYAIR" => match case {
                "air-only" => Some(valid.clone()),
                "invalid-air" => Some(invalid_air.clone()),
                _ => None,
            },
            _ => {
                if name.starts_with("SERVER2_S3_") || name.starts_with("AWS_") {
                    storage_queries.set(storage_queries.get() + 1);
                }
                defaults(name)
            }
        };
        let result = RuntimeServices::from_vars_with_fcm(
            &vars,
            &peer.builtins(),
            Endpoints::loopback("http://127.0.0.1:9/"),
        );
        let rejected = result.is_err();
        if let Ok(services) = result {
            stop(services).await;
        }
        assert!(rejected, "{case}");
        assert_eq!(storage_queries.get(), 0, "storage constructed for {case}");
        let counts: serde_json::Value = serde_json::from_slice(
            &reqwest::get(format!("{}__catalog/status", peer.endpoint))
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(counts, serde_json::json!({}), "state work for {case}");
    }
}

#[tokio::test]
async fn valid_active_with_optional_retired_account_and_no_startup_probe() {
    for air in [false, true] {
        let peer = Peer::new();
        let defaults = peer.vars("push");
        let vars = |name: &str| {
            if name == "SERVER2_FIREBASE_TODAYAIR" && air {
                defaults("SERVER2_FIREBASE_TODAYWEATHER")
            } else {
                defaults(name)
            }
        };
        let root = peer.endpoint.clone();
        let services = RuntimeServices::from_vars_with_fcm(
            &vars,
            &peer.builtins(),
            Endpoints::loopback(&root),
        )
        .unwrap();
        stop(services).await;
        let counts: serde_json::Value = serde_json::from_slice(
            &reqwest::get(format!("{root}__catalog/status"))
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(
            !counts
                .as_object()
                .unwrap()
                .keys()
                .any(|key| key.contains("oauth") || key.contains("messages:send"))
        );
    }
}

#[tokio::test]
async fn disabled_push_never_queries_firebase_settings() {
    let peer = Peer::new();
    let defaults = peer.vars("");
    let vars = |name: &str| {
        assert!(
            !name.starts_with("SERVER2_FIREBASE_"),
            "disabled push queried account setting"
        );
        defaults(name)
    };
    let services = RuntimeServices::from_vars_with_fcm(
        &vars,
        &peer.builtins(),
        Endpoints::loopback("http://127.0.0.1:9/"),
    )
    .unwrap();
    assert!(services.push.is_none() && services.delivery.is_none());
}

#[tokio::test]
async fn checked_accounts_are_cached_before_first_send() {
    use server2::push::deliver::{Fcm, Product, SendOutcome};
    for product in [Product::TodayWeather, Product::TodayAir] {
        let peer = Peer::new();
        let defaults = peer.vars("push");
        let file = defaults("SERVER2_FIREBASE_TODAYWEATHER").unwrap();
        let vars = |name: &str| {
            if name == "SERVER2_FIREBASE_TODAYAIR" {
                Some(file.clone())
            } else {
                defaults(name)
            }
        };
        let fcm = Fcm::for_push(&vars, Endpoints::loopback("http://127.0.0.1:9/")).unwrap();
        std::fs::remove_file(&file).unwrap();
        // Closed loopback OAuth fails after account lookup: local parse was cached.
        // This is not remote authorization, a successful token or an FCM request.
        assert_eq!(
            fcm.send(product, b"{}".to_vec(), 1_792_101_600_000).await,
            SendOutcome::NotSent { reason: "oauth" }
        );
    }
}

/// Real process lifecycle with owned dependencies supplied on stdin. The test
/// harness exits nonzero on factory failure; no production dotenv/env is read.
#[test]
#[ignore = "isolated push_credentials_smoke.py child entrypoint"]
fn startup_child() {
    use std::io::Read;
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let input: serde_json::Value = serde_json::from_str(&input).unwrap();
    let root = input["root"].as_str().unwrap().to_owned();
    assert!(root.starts_with("http://127.0.0.1:"));
    let families = input["families"].as_str().unwrap().to_owned();
    let tw = input["todayweather"].as_str().map(str::to_owned);
    let ta = input["todayair"].as_str().map(str::to_owned);
    let peer = Peer::new();
    let mut builtins = peer.builtins();
    builtins.s3 = Some(root.clone());
    let defaults = peer.vars(&families);
    let vars = move |name: &str| match name {
        "SERVER2_FIREBASE_TODAYWEATHER" => tw.clone(),
        "SERVER2_FIREBASE_TODAYAIR" => ta.clone(),
        _ => defaults(name),
    };
    let config = server2::Config {
        public_addr: "127.0.0.1:0".parse().unwrap(),
        metrics_addr: "127.0.0.1:0".parse().unwrap(),
        ..Default::default()
    };
    let result = server2::process::run(config, move || {
        RuntimeServices::from_vars_with_fcm(&vars, &builtins, Endpoints::loopback(&root))
    });
    println!(
        "C6_PROCESS_RESULT {}",
        if result.is_ok() {
            "stopped"
        } else {
            "configuration-error"
        }
    );
    assert!(result.is_ok(), "push process rejected configuration");
}
