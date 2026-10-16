//! A child entrypoint for actual OS-signal/listener failure smokes. Input arrives on stdin;
//! no dotenv, address environment variables, production settings or accounts are read.
use server2::{
    Config,
    budget::{BudgetError, Clock},
    gateway::{BackendHandler, BoxFuture, GatewayError, OrderedJson, runtime::NativeHandles},
    push::deliver::{Endpoints, native_fetch::NativeFetch},
    runtime_services::RuntimeServices,
};
use std::{io::Read, sync::Arc, time::Instant};
struct TestClock {
    began: Instant,
}
impl Clock for TestClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        // Next observed UTC boundary is :07, shared by alarm and conditional schedule.
        Ok(1_792_109_219_000 + self.began.elapsed().as_millis() as i64)
    }
}
type Acquisitions =
    server2::resolver::owned::OwnedFlights<String, Result<OrderedJson, GatewayError>>;
struct OwnedNative {
    root: String,
    client: reqwest::Client,
    flights: Acquisitions,
}
struct Acquisition {
    complete: bool,
}
impl Drop for Acquisition {
    fn drop(&mut self) {
        if !self.complete {
            println!("S20B_PROVIDER_CANCELLED incomplete");
        }
    }
}
impl BackendHandler for OwnedNative {
    fn fetch(
        &self,
        path: String,
        lang: String,
        _: tokio::time::Instant,
    ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
        let root = self.root.clone();
        let client = self.client.clone();
        Box::pin(async move {
            let result = self
                .flights
                .join(
                    path.clone(),
                    tokio::time::Instant::now() + std::time::Duration::from_secs(3),
                    std::time::Duration::from_secs(60),
                    move |_| async move {
                        let mut acquisition = Acquisition { complete: false };
                        let result = async {
                            let r = client
                                .get(format!("{root}native"))
                                .header("x-native-path", path)
                                .header("accept-language", lang)
                                .send()
                                .await
                                .map_err(|_| GatewayError::Provider)?;
                            OrderedJson::parse(
                                &r.bytes().await.map_err(|_| GatewayError::Provider)?,
                            )
                        }
                        .await;
                        acquisition.complete = true;
                        result
                    },
                )
                .await;
            match result {
                server2::resolver::owned::Waited::Ready(result) => result,
                _ => Err(GatewayError::Provider),
            }
        })
    }
}
#[test]
#[ignore = "child entrypoint; only the isolated runtime_services_smoke.py provides stdin"]
fn child() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let input: serde_json::Value = serde_json::from_str(&input).unwrap();
    let root = input["root"].as_str().unwrap().to_owned();
    assert!(root.starts_with("http://127.0.0.1:"));
    let account = input["account"].as_str().unwrap().to_owned();
    let failure = input["listener_failure"].as_bool().unwrap_or(false);
    let bind_failure = input["metrics_addr"].as_str().map(str::to_owned);
    let peer = super::common::Peer::new();
    let mut builtins = peer.builtins();
    builtins.s3 = Some(root.clone());
    let defaults = peer.vars("push,notice");
    let var = move |n: &str| {
        if n == "SERVER2_FIREBASE_TODAYWEATHER" {
            Some(account.clone())
        } else {
            defaults(n)
        }
    };
    let native = NativeFetch::new(NativeHandles {
        kma: Some(Arc::new(OwnedNative {
            root: root.clone(),
            client: reqwest::Client::new(),
            flights: server2::resolver::owned::OwnedFlights::new(Default::default()).unwrap(),
        })),
        ..Default::default()
    });
    let clock = Arc::new(TestClock {
        began: Instant::now(),
    });
    let config = Config {
        public_addr: "127.0.0.1:0".parse().unwrap(),
        metrics_addr: bind_failure
            .as_deref()
            .unwrap_or("127.0.0.1:0")
            .parse()
            .unwrap(),
        ..Config::default()
    };
    let result = server2::process::run_with_listener_hook(
        config,
        move || {
            RuntimeServices::from_vars_with_delivery(
                &var,
                &builtins,
                Endpoints::loopback(&root),
                clock,
                Some(native),
            )
        },
        move |listener| {
            if failure {
                // This test-only task injects failure into the real public serve task.
                tokio::spawn(async move {
                    let mut signal = tokio::signal::unix::signal(
                        tokio::signal::unix::SignalKind::user_defined1(),
                    )
                    .unwrap();
                    signal.recv().await;
                    listener.abort();
                });
            }
        },
    );
    println!(
        "S20B_PROCESS_RESULT {}",
        if result.is_ok() {
            "signal-ok"
        } else {
            "listener-error"
        }
    );
    if failure || bind_failure.is_some() {
        assert!(result.is_err());
    } else {
        result.unwrap();
    }
}
