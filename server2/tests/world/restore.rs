//! RESTORE: raw VC records published through S06 to the loopback S3 peer let a new engine
//! with empty memory and providers disabled serve the oracle bytes at the same instant.
use super::common::*;
use server2::{
    gateway::BoxFuture,
    world::{Disabled, FixedClock, World, WorldBackend, WorldConfig, WorldStore},
};
use std::sync::Arc;

struct Restore {
    store: Arc<dyn WorldStore>,
    errors: Vec<String>,
    checked: usize,
}
impl AsyncStep for Restore {
    fn run<'a>(
        &'a mut self,
        sc: &'a serde_json::Value,
        index: usize,
        step: &'a serde_json::Value,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let clock = Arc::new(FixedClock::new(ms(step["at"].as_str().unwrap())));
            let cold = WorldBackend::new(World::new(
                self.store.clone(),
                Arc::new(Disabled),
                air_for(sc),
                clock,
                WorldConfig::default(),
            ));
            for (ri, r) in step["requests"].as_array().unwrap().iter().enumerate() {
                if r["status"] != 200 {
                    continue;
                }
                let reply = cold
                    .reply(&path(r), r["lang"].as_str().unwrap_or(""), deadline())
                    .await;
                self.checked += 1;
                if let Err(m) = matches(r, &reply) {
                    self.errors.push(format!(
                        "{} step {index} request {ri} restored {}: {m}",
                        sc["id"],
                        path(r)
                    ));
                }
            }
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn empty_memory_s3_inputs_providers_disabled_serve_same_bytes() {
    let mut errors = Vec::new();
    let mut checked = 0;
    for sc in oracle()["scenarios"].as_array().unwrap() {
        let peer = Peer::new();
        let store: Arc<dyn WorldStore> = peer.store();
        let mut hook = Restore {
            store: store.clone(),
            errors: Vec::new(),
            checked: 0,
        };
        errors.extend(replay(sc, store, &mut hook).await);
        errors.extend(hook.errors);
        checked += hook.checked;
    }
    assert!(checked >= 150, "{checked}");
    assert!(
        errors.is_empty(),
        "{} mismatches:\n{}",
        errors.len(),
        errors.join("\n")
    );
}
