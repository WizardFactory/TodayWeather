//! Standalone owned HTTP rehearsal; never loads production environment/provider keys.
#[path = "../tests/delivery/common.rs"]
mod common;
#[path = "../tests/state/common.rs"]
mod state_common;
#[path = "../tests/delivery/warning_fanout_common.rs"]
mod warning_fanout_common;
#[tokio::main]
async fn main() {
    let n = std::env::args()
        .nth(1)
        .map(|s| s.parse::<usize>().expect("recipient count1..5000"))
        .unwrap_or(5000);
    println!(
        "{}",
        serde_json::to_string(&warning_fanout_common::run(n).await).unwrap()
    );
}
