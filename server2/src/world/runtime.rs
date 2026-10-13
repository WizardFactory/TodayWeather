//! Opt-in local process wiring for the native world family (loopback S3 and VC peers only).
//! Without `SERVER2_WORLD_MODE` the gateway keeps the legacy world backend. No production,
//! AWS or live provider configuration is accepted by this entrypoint.
use super::{
    CatalogWorldStore, FundedVc, SystemClock, Unconfigured, World, WorldBackend, WorldConfig,
};
use crate::{
    budget::{BudgetPolicy, BudgetStore, Provider, SystemClock as BudgetClock},
    gateway::{BackendDispatcher, BackendMode, GatewayError, Version},
    providers::HttpProviderTransport,
    storage::{CatalogLimits, HttpS3Transport},
};
use std::{net::IpAddr, sync::Arc};

fn loopback_http(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "http"
            && u.host_str()
                .and_then(|h| h.trim_matches(['[', ']']).parse::<IpAddr>().ok())
                .is_some_and(|ip| ip.is_loopback())
    })
}
/// A configured native world backend and the versions it is selected for.
pub type Configured = (Arc<WorldBackend>, Vec<Version>);
/// Build the local native world backend from injected variables, or None when not selected.
pub fn from_vars(
    var: &dyn Fn(&str) -> Option<String>,
    now_ms: i64,
) -> Result<Option<Configured>, GatewayError> {
    let Some(mode) = var("SERVER2_WORLD_MODE") else {
        return Ok(None);
    };
    if mode != "native-local" {
        return Err(GatewayError::InvalidConfiguration);
    }
    let need = |name: &str| {
        var(name)
            .filter(|v| !v.is_empty())
            .ok_or(GatewayError::InvalidConfiguration)
    };
    let s3 = need("SERVER2_WORLD_S3_ENDPOINT")?;
    let vc = need("SERVER2_WORLD_VC_URL")?;
    if !loopback_http(&s3) || !loopback_http(&vc) {
        return Err(GatewayError::InvalidConfiguration);
    }
    let bucket = need("SERVER2_WORLD_S3_BUCKET")?;
    let credentials = rusty_s3::Credentials::new(
        need("SERVER2_WORLD_S3_ACCESS_KEY_ID")?,
        need("SERVER2_WORLD_S3_SECRET_ACCESS_KEY")?,
    );
    let transport = || {
        HttpS3Transport::new(&s3, &bucket, "ap-northeast-2", credentials.clone())
            .map_err(|_| GatewayError::InvalidConfiguration)
    };
    let units: u64 = need("SERVER2_WORLD_VC_DAILY_UNITS")?
        .parse()
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let quota_id = need("SERVER2_WORLD_VC_QUOTA_ID")?;
    let day = now_ms.div_euclid(86_400_000) * 86_400_000;
    let window = super::js::iso(day as f64)
        .map(|s| s[..10].to_owned())
        .ok_or(GatewayError::InvalidConfiguration)?;
    let policy = BudgetPolicy {
        provider: Provider::VisualCrossing,
        quota_id,
        window_id: window,
        starts_at_ms: day,
        ends_at_ms: day + 86_400_000,
        limit: units,
        block_units: units.clamp(1, 98),
    };
    let budget = Arc::new(
        BudgetStore::new(Arc::new(transport()?), policy, Arc::new(BudgetClock))
            .map_err(|_| GatewayError::InvalidConfiguration)?,
    );
    let provider = Arc::new(
        HttpProviderTransport::new(8 * 1024 * 1024)
            .map_err(|_| GatewayError::InvalidConfiguration)?,
    );
    let source = FundedVc::new(&vc, provider, budget, need("VC_SECRET_KEY")?)
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let store = CatalogWorldStore::new(transport()?, CatalogLimits::default())
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let world = World::new(
        Arc::new(store),
        Arc::new(source),
        Arc::new(Unconfigured),
        Arc::new(SystemClock),
        WorldConfig::default(),
    );
    let versions = match var("SERVER2_WORLD_VERSIONS") {
        None => vec![Version::V000901, Version::V000902, Version::V000903],
        Some(list) => list
            .split(',')
            .map(|v| Version::parse(v.trim()).ok_or(GatewayError::InvalidConfiguration))
            .collect::<Result<_, _>>()?,
    };
    Ok(Some((Arc::new(WorldBackend::new(world)), versions)))
}
/// Register the configured native world and select it for the configured versions.
pub fn configure(dispatcher: &BackendDispatcher) -> Result<(), GatewayError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| GatewayError::InvalidConfiguration)?
        .as_millis() as i64;
    let lookup = |name: &str| std::env::var(name).ok();
    if let Some((backend, versions)) = from_vars(&lookup, now)? {
        backend.register(dispatcher);
        WorldBackend::select(dispatcher, &versions, BackendMode::Native)?;
    }
    Ok(())
}
