//! Explicit opt-in process wiring. Existing operator-loaded environment is injected.
use super::{BackendDispatcher, Gateway, GatewayError, LegacyGeocoder};
use std::{env, sync::Arc};
/// No gateway URL means the S04 foundation-only behavior remains selected.
/// Live native geocoding cannot be enabled through this local-first entrypoint.
pub fn configured_gateway() -> Result<Option<Arc<Gateway>>, GatewayError> {
    let Some(base) = env::var_os("SERVER2_GATEWAY_LEGACY_URL") else {
        return Ok(None);
    };
    let base = base
        .into_string()
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let backend = BackendDispatcher::legacy(&base)?;
    // S11: opt-in loopback-only native world; absent configuration keeps legacy world.
    crate::world::runtime::configure(&backend)?;
    // S15: opt-in loopback-only native KMA v000903; absent configuration keeps legacy KMA.
    crate::domestic::kma::runtime::configure(&backend, &base)?;
    let mode = env::var("SERVER2_GEOCODER_MODE").unwrap_or_else(|_| "legacy".into());
    let geocoder: Arc<dyn super::Geocoder> = match mode.as_str() {
        "legacy" => Arc::new(LegacyGeocoder::new(&base)?),
        "mock" => {
            let mut config = crate::geocode::GeocoderConfig::from_env()
                .map_err(|_| GatewayError::InvalidConfiguration)?;
            config.mock_mode = true;
            let geocoder = crate::geocode::Geocoder::new(config)
                .map_err(|_| GatewayError::InvalidConfiguration)?
                .with_quota(Arc::new(crate::geocode::MockQuota::new(10000)));
            Arc::new(geocoder)
        }
        _ => return Err(GatewayError::InvalidConfiguration),
    };
    Ok(Some(Arc::new(Gateway::new(geocoder, backend))))
}
