//! Opt-in local process wiring for the native KMA v000903 family. Without `SERVER2_KMA_MODE`
//! the gateway keeps the legacy KMA backend. `recorded-local` serves a recorded store snapshot
//! file (local verification only). Both local modes require a loopback legacy origin and a
//! loopback public listener (`SERVER2_BIND`, default `127.0.0.1:3002`); no production, AWS or
//! provider configuration is accepted here. The S3 input source is S15b.
use super::backend::{KmaBackend, LegacyOnly, system_clock};
use super::recorded::RecordedSource;
use super::{AssemblyConfig, backend::KmaSource};
use crate::gateway::{BackendDispatcher, BackendMode, GatewayError};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

fn loopback_http(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "http"
            && u.host_str()
                .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
                .is_some_and(|ip| ip.is_loopback())
    })
}
/// The public listener the process binds (`Config::from_env` reads the same variable).
fn loopback_listener(bind: Option<String>) -> bool {
    match bind {
        None => crate::Config::default().public_addr.ip().is_loopback(),
        Some(b) => b.parse::<SocketAddr>().is_ok_and(|a| a.ip().is_loopback()),
    }
}
/// Build the configured backend, or None when not selected.
pub fn from_vars(
    var: &dyn Fn(&str) -> Option<String>,
    legacy_base: &str,
) -> Result<Option<Arc<KmaBackend>>, GatewayError> {
    let Some(mode) = var("SERVER2_KMA_MODE") else {
        return Ok(None);
    };
    // Local modes serve recorded inputs: only a loopback client may reach them.
    if !loopback_http(legacy_base) || !loopback_listener(var("SERVER2_BIND")) {
        return Err(GatewayError::InvalidConfiguration);
    }
    let source: Arc<dyn KmaSource> = match mode.as_str() {
        // Native selected, every request forwarded: exercises the switch and forward path.
        "forward-local" => Arc::new(LegacyOnly),
        "recorded-local" => {
            let path = var("SERVER2_KMA_RECORDED")
                .filter(|p| !p.is_empty())
                .ok_or(GatewayError::InvalidConfiguration)?;
            let bytes = std::fs::read(&path).map_err(|_| GatewayError::InvalidConfiguration)?;
            let source =
                RecordedSource::parse(&bytes).map_err(|_| GatewayError::InvalidConfiguration)?;
            if source.is_empty() {
                return Err(GatewayError::InvalidConfiguration);
            }
            Arc::new(source)
        }
        _ => return Err(GatewayError::InvalidConfiguration),
    };
    let max_current_count = match var("SERVER2_KMA_MAX_CURRENT_COUNT") {
        None => AssemblyConfig::default().max_current_count,
        Some(n) => n.parse().map_err(|_| GatewayError::InvalidConfiguration)?,
    };
    Ok(Some(Arc::new(KmaBackend::new(
        source,
        system_clock(),
        AssemblyConfig { max_current_count },
    ))))
}
/// Register the configured native KMA backend and select it for v000903.
pub fn configure(dispatcher: &BackendDispatcher, legacy_base: &str) -> Result<(), GatewayError> {
    let lookup = |name: &str| std::env::var(name).ok();
    if let Some(backend) = from_vars(&lookup, legacy_base)? {
        backend.register(dispatcher);
        KmaBackend::select(dispatcher, BackendMode::Native)?;
    }
    Ok(())
}
