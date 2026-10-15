use server2::{Config, dotenv::DotEnv, gateway::runtime::from_vars};
use std::{io, path::Path};
/// S10e: the process environment, then `server2/.env` in the working directory (legacy dotenv
/// rules), read under the legacy `server/.env` names.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let env = DotEnv::load(Path::new(server2::dotenv::FILE)).map_err(io::Error::other)?;
    let var = move |name: &str| env.var(name);
    let config = Config::from_vars(&var).map_err(io::Error::other)?;
    server2::process::run(config, move || from_vars(&var))
}
