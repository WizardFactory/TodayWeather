use server2::observability::{self, Cause, Classify};
use server2::{Config, dotenv::DotEnv, runtime_services::RuntimeServices};
use std::path::Path;
fn main() {
    if let Err(cause) = run() {
        observability::fatal(cause);
        observability::flush(std::time::Duration::from_millis(50));
        std::process::exit(1);
    }
}
/// Process environment precedes server2/.env; configuration values never enter diagnostics.
fn run() -> Result<(), Cause> {
    let env = DotEnv::load(Path::new(server2::dotenv::FILE)).map_err(|_| Cause::Dotenv)?;
    let var = move |name: &str| env.var(name);
    observability::init(&var);
    let config = Config::from_vars(&var).map_err(|error| match error.as_str() {
        "invalid PORT" => Cause::InvalidPort,
        "invalid OPENSHIFT_NODEJS_PORT" => Cause::InvalidOpenshiftPort,
        "invalid OPENSHIFT_NODEJS_IP" => Cause::InvalidIp,
        _ => Cause::Configuration,
    })?;
    server2::process::run(config, move || RuntimeServices::from_vars(&var))
        .map_err(|e| e.classify().0)
}
