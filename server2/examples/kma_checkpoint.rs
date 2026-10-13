//! S15 O-2 checkpoint workload: assemble every recorded KMA v000903 oracle request (the S02
//! goldens and the supplementary scenarios) from in-memory store answers, repeatedly, and print
//! per-assembly timing as JSON. Peak RSS and CPU time are measured by the caller
//! (`tools/kma_checkpoint.py`) from the process rusage. No network, store or provider I/O.
//!
//! Usage: kma_checkpoint [rounds]
#[path = "../tests/domestic/support.rs"]
mod support;

use server2::domestic::kma::{Outcome, assemble};
use std::time::Instant;

fn main() {
    let rounds: usize = std::env::args()
        .nth(1)
        .map_or(20, |a| a.parse().expect("rounds"));
    support::warm();
    let scenarios = support::scenarios();
    let config = support::oracle_config();
    let mut samples: Vec<f64> = Vec::with_capacity(rounds * scenarios.len());
    let mut bytes = 0usize;
    let started = Instant::now();
    for _ in 0..rounds {
        for sc in scenarios {
            // Store snapshots are built outside the timed assembly, as a source would hand them over.
            let store = support::replay(sc);
            let request = support::request(sc);
            let now = support::clock_ms(sc["clock"].as_str().unwrap());
            let t = Instant::now();
            let outcome = assemble(&request, &store, now, config);
            let body = match outcome {
                Outcome::Json(json) => json.to_bytes(),
                Outcome::Status(_, text) => text.into_bytes(),
                Outcome::Legacy(reason) => panic!("{}: forwarded {reason}", sc["id"]),
            };
            samples.push(t.elapsed().as_secs_f64() * 1e6);
            assert_eq!(
                body,
                sc["body"].as_str().unwrap().as_bytes(),
                "{}",
                sc["id"]
            );
            bytes += body.len();
        }
    }
    let wall = started.elapsed().as_secs_f64();
    samples.sort_by(f64::total_cmp);
    // A zero-round run (fixture load baseline) has no samples.
    let at = |q: f64| {
        (!samples.is_empty()).then(|| samples[((samples.len() - 1) as f64 * q).round() as usize])
    };
    let mean = (!samples.is_empty()).then(|| samples.iter().sum::<f64>() / samples.len() as f64);
    println!(
        "{}",
        serde_json::json!({
            "schema": 1,
            "workload": "S15 KMA v000903 oracle scenarios (assemble + JSON encode, single thread)",
            "scenarios": scenarios.len(),
            "rounds": rounds,
            "assemblies": samples.len(),
            "response_bytes": bytes,
            "assembly_us": {"mean": mean, "p50": at(0.5), "p95": at(0.95), "p99": at(0.99), "max": at(1.0)},
            "wall_s": wall,
            "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        })
    );
}
