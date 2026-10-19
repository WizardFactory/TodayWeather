//! Explicit rainfall operator tool and owned-loopback native HTTP verification entry point.
#[path = "../tools/state/rainfall_activation.rs"]
mod activation;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg.starts_with("owned-")) {
        activation::owned::run(&args).await
    } else {
        activation::run(&args).await
    }
}
