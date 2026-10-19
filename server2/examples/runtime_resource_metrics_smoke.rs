//! Owned functional fixture: the actual resource-aware process with CPU1 initially occupied.
//! Inputs are loopback-only endpoints and the normal process environment. The fixed barrier
//! ends on the one stdin line `release` (or EOF during owned-child cleanup). This is not a
//! production mode, setting, remote control endpoint or capacity benchmark.
use server2::{
    Config, dotenv::DotEnv, gateway::runtime::Builtins, runtime_services::RuntimeServices,
};
use std::{
    io::{self, BufRead},
    sync::{Arc, mpsc},
    time::Duration,
};
const UNREACHABLE: &str = "http://127.0.0.1:9/";
fn builtins() -> Result<Builtins, Box<dyn std::error::Error>> {
    let mut roots = Builtins {
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
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || !args.len().is_multiple_of(2) {
        return Err(io::Error::other("loopback endpoint pairs required").into());
    }
    for pair in args.as_chunks::<2>().0 {
        let url: reqwest::Url = pair[1].parse()?;
        if url.scheme() != "http"
            || !url
                .host_str()
                .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
                .is_some_and(|ip| ip.is_loopback())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(io::Error::other("owned loopback endpoint required").into());
        }
        match pair[0].as_str() {
            "--s3" => roots.s3 = Some(pair[1].clone()),
            "--vc" => roots.vc = pair[1].clone(),
            "--waqi" => roots.waqi = pair[1].clone(),
            "--google" => roots.google = pair[1].clone(),
            "--kakao" => roots.kakao = pair[1].clone(),
            _ => return Err(io::Error::other("unsupported owned endpoint").into()),
        }
    }
    if roots.s3.is_none() {
        return Err(io::Error::other("owned S3 endpoint required").into());
    }
    Ok(roots)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let roots = builtins()?;
    let env = DotEnv::empty();
    let var = move |name: &str| env.var(name);
    let mut config = Config::from_vars(&var).map_err(io::Error::other)?;
    config.cpu_limit = 1;
    let (release, wait) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = io::stdin().lock().read_line(&mut line);
        if line.is_empty() || line.trim() == "release" {
            let _ = release.send(());
        }
    });
    server2::process::run_with_resources(config, move |resources| {
        let (started, ready) = mpsc::channel();
        let cpu = resources.cpu.clone();
        tokio::spawn(async move {
            let result = cpu
                .immediate(
                    server2::operational_metrics::CpuKind::Foundation,
                    move || {
                        let _ = started.send(());
                        let _ = wait.recv();
                    },
                )
                .await;
            if result.is_ok() {
                println!("owned CPU barrier released");
            }
        });
        ready
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| server2::gateway::GatewayError::InvalidConfiguration)?;
        // Labelled synthetic diagnostics stress only. Native traffic is exercised separately;
        // this proves typed operation accounting survives a deliberately unread owned sink.
        for _ in 0..2048 {
            use server2::observability::{
                Action, Cause, Component, Details, Operation, Outcome, Stage,
            };
            let mut operation = Operation::new(Component::Logging, Stage::Lifecycle);
            operation.finish(
                Cause::None,
                Action::None,
                Outcome::Success,
                Details::default(),
            );
            drop(operation);
        }

        RuntimeServices::from_vars_at_with_resources(&var, &roots, Arc::clone(&resources))
    })
}
