//! Test tooling (S10e): the server2 process with its S3 and provider roots on loopback test
//! peers. Production runs the `server2` binary, whose roots are built in and cannot be changed
//! by any setting; this example exists only so the release smokes can drive the same process,
//! configuration and gateway against task-owned peers.
//!
//! The process environment is read under the same names as `server2` reads them; no `.env`
//! file is loaded, so a smoke never picks up real settings. Only the roots come from the
//! command line; a root that is not given is an unreachable loopback address, so no provider
//! can be called by accident.
//!
//! Usage: loopback_server --s3 URL [--data-go-kr URL] [--kma URL] [--kma-weather URL] [--mfds URL]
//!        [--vc URL] [--google-air URL] [--openweather URL] [--waqi URL]
//!        [--kakao URL] [--google URL] [--geocoder-daily-units N]   (per Kakao key and Google key; default: built in)
use server2::{
    Config, dotenv::DotEnv, gateway::runtime::Builtins, runtime_services::RuntimeServices,
};
use std::io;

/// Nothing listens on the discard port of the loopback address.
const UNREACHABLE: &str = "http://127.0.0.1:9/";

fn usage() -> ! {
    eprintln!(
        "usage: loopback_server --s3 URL [--data-go-kr URL] [--kma URL] [--kma-weather URL] [--mfds URL] \
         [--vc URL] [--google-air URL] [--openweather URL] [--waqi URL] \
         [--kakao URL] [--google URL] [--geocoder-daily-units N]"
    );
    std::process::exit(2);
}

fn builtins(args: &[String]) -> Builtins {
    let mut builtins = Builtins {
        s3: None,
        data_go_kr: UNREACHABLE.into(),
        kma: UNREACHABLE.into(),
        kma_weather: UNREACHABLE.into(),
        mfds: UNREACHABLE.into(),
        vc: UNREACHABLE.into(),
        google_air: UNREACHABLE.into(),
        openweather: UNREACHABLE.into(),
        waqi: UNREACHABLE.into(),
        kakao: UNREACHABLE.into(),
        google: UNREACHABLE.into(),
        ..Builtins::production()
    };
    let mut pairs = args.chunks(2);
    for pair in &mut pairs {
        let [flag, value] = pair else { usage() };
        let value = value.clone();
        match flag.as_str() {
            "--s3" => builtins.s3 = Some(value),
            "--data-go-kr" => builtins.data_go_kr = value,
            "--kma" => builtins.kma = value,
            "--kma-weather" => builtins.kma_weather = value,
            "--mfds" => builtins.mfds = value,
            "--vc" => builtins.vc = value,
            "--google-air" => builtins.google_air = value,
            "--openweather" => builtins.openweather = value,
            "--waqi" => builtins.waqi = value,
            "--kakao" => builtins.kakao = value,
            "--google" => builtins.google = value,
            "--geocoder-daily-units" => {
                let units = value.parse().unwrap_or_else(|_| usage());
                builtins.geocoder_daily_units = [units, units];
            }
            _ => usage(),
        }
    }
    if builtins.s3.is_none() {
        usage();
    }
    builtins
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let builtins = builtins(&args);
    // The process environment only (no file values).
    let env = DotEnv::empty();
    let var = move |name: &str| env.var(name);
    let config = Config::from_vars(&var).map_err(io::Error::other)?;
    server2::process::run(config, move || {
        RuntimeServices::from_vars_at(&var, &builtins)
    })
}
