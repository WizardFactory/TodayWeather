//! S15b-3c: the runtime prepares the image hourly forecast production only for the native KMA
//! source (built for KMA serving and for push) with an AirKorea acquirer; the bound process
//! starts it. Synthetic settings only.
use server2::runtime_services::RuntimeServices;

#[tokio::test]
async fn runtime_prepares_image_production_only_with_an_airkorea_acquirer() {
    let peer = super::common::Peer::new();
    for (families, keys, expected) in [
        ("kma", false, false),
        ("kma", true, true),
        ("town", true, true),
        ("push", true, true),
        ("notice", true, false),
    ] {
        let vars = peer.vars(families);
        let var = |name: &str| match name {
            "AIRKOREA_SECRET_KEYS" if keys => Some(r#"["synthetic-airkorea-key-0001"]"#.to_owned()),
            _ => vars(name),
        };
        let services = RuntimeServices::from_vars_at(&var, &peer.builtins()).unwrap();
        assert_eq!(
            services.image_production.is_some(),
            expected,
            "{families} with keys {keys}"
        );
    }
}

/// The timer produces at once (a new process does not wait a period) and then every period,
/// until its owner stops it.
#[tokio::test(start_paused = true)]
async fn the_image_worker_produces_at_once_then_every_period_until_stopped() {
    use server2::domestic::kma::source::air_input::{ImageProduction, image_worker};
    use server2::gateway::BoxFuture;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::time::Duration;
    struct Counted(AtomicUsize);
    impl ImageProduction for Counted {
        fn produce(&self) -> BoxFuture<'_, ()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {})
        }
    }
    let counted = Arc::new(Counted(AtomicUsize::new(0)));
    let worker = image_worker(counted.clone(), Duration::from_secs(600));
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(counted.0.load(Ordering::SeqCst), 1, "at once");
    tokio::time::sleep(Duration::from_secs(600)).await;
    assert_eq!(counted.0.load(Ordering::SeqCst), 2, "one period later");
    worker.stop().await;
    tokio::time::sleep(Duration::from_secs(1800)).await;
    assert_eq!(counted.0.load(Ordering::SeqCst), 2, "stopped");
}
