//! Process wiring from the operator-injected environment.
//!
//! `SERVER2_GATEWAY_LEGACY_URL` enables the gateway. `SERVER2_NATIVE_FAMILIES` lists the
//! families routed to the native backend (`geocode`, `dsf`, `kma`); every other family stays on the
//! legacy origin, and an unlisted family reads none of its native settings. Removing a family
//! from the list and restarting is the rollback.
use super::{BackendDispatcher, Gateway, GatewayError, LegacyGeocoder};
use crate::{
    budget::SystemClock,
    geocode::{Geocoder, GeocoderConfig, budget::FundedQuota},
    storage::{HttpS3Transport, S3Settings},
    world::BoundedS3,
};
use std::sync::Arc;

/// Combined in-flight S3 requests of the process (world weather, world air, budgets and the KMA
/// input source), below the 16-connection limit of the S3 test peer.
const S3_IN_FLIGHT: usize = 12;
type Var<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Families routed to the native backend.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NativeFamilies {
    pub geocode: bool,
    pub dsf: bool,
    /// S15: KMA v000903 address weather.
    pub kma: bool,
}
impl NativeFamilies {
    /// Parse `SERVER2_NATIVE_FAMILIES`; unset or empty selects none. Unknown or repeated
    /// entries are a configuration error.
    pub fn from_vars(var: Var) -> Result<Self, GatewayError> {
        let mut families = Self::default();
        let Some(list) = var("SERVER2_NATIVE_FAMILIES").filter(|v| !v.trim().is_empty()) else {
            return Ok(families);
        };
        for entry in list.split(',').map(str::trim) {
            let slot = match entry {
                "geocode" => &mut families.geocode,
                "dsf" => &mut families.dsf,
                "kma" => &mut families.kma,
                _ => return Err(GatewayError::InvalidConfiguration),
            };
            if *slot {
                return Err(GatewayError::InvalidConfiguration);
            }
            *slot = true;
        }
        Ok(families)
    }
}
/// The process S3 client from `SERVER2_S3_*`, behind one bounded admission.
pub fn shared_s3(var: Var) -> Result<BoundedS3<HttpS3Transport>, GatewayError> {
    let settings = S3Settings::from_vars(var).map_err(|_| GatewayError::InvalidConfiguration)?;
    let transport = settings
        .transport()
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(BoundedS3::new(transport, S3_IN_FLIGHT))
}
fn units(var: Var, name: &str) -> Result<Option<u64>, GatewayError> {
    var(name)
        .filter(|v| !v.is_empty())
        .map(|v| v.parse().map_err(|_| GatewayError::InvalidConfiguration))
        .transpose()
}
/// The native geocoder: existing `GEOCODER_*` keys and endpoints, and per-key daily limits
/// `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` / `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS` funded in S3.
pub fn native_geocoder(var: Var, s3: BoundedS3<HttpS3Transport>) -> Result<Geocoder, GatewayError> {
    let config = GeocoderConfig::from_vars(var).map_err(|_| GatewayError::InvalidConfiguration)?;
    let quota = FundedQuota::for_keys(
        Arc::new(s3),
        Arc::new(SystemClock),
        &config,
        units(var, "SERVER2_GEOCODER_KAKAO_DAILY_UNITS")?,
        units(var, "SERVER2_GEOCODER_GOOGLE_DAILY_UNITS")?,
    )
    .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(Geocoder::new(config)
        .map_err(|_| GatewayError::InvalidConfiguration)?
        .with_quota(Arc::new(quota)))
}
/// The KMA request-time acquirer: `SERVER2_DATA_GO_KR_KEYS` (a JSON array of data.go.kr keys,
/// the legacy `DONGNAE_SECRET_KEYS` form) funded with `SERVER2_DATA_GO_KR_DAILY_UNITS` per key
/// and KST day in S3 (S08); both are required with `kma`. Provider roots are the production
/// HTTPS roots unless `SERVER2_DATA_GO_KR_BASE_URL`, `SERVER2_KMA_BASE_URL` or
/// `SERVER2_KMA_WEATHER_BASE_URL` name another (HTTPS, or HTTP to a loopback address).
pub fn kma_acquirer(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
) -> Result<
    crate::domestic::kma::source::observe::DailyAcquirer<
        crate::providers::HttpProviderTransport,
        crate::providers::HttpPublicTransport,
        BoundedS3<HttpS3Transport>,
    >,
    GatewayError,
> {
    let keys = crate::domestic::keys::parse_keys(
        &var("SERVER2_DATA_GO_KR_KEYS").ok_or(GatewayError::InvalidConfiguration)?,
    );
    let units =
        units(var, "SERVER2_DATA_GO_KR_DAILY_UNITS")?.ok_or(GatewayError::InvalidConfiguration)?;
    let invalid = |_| GatewayError::InvalidConfiguration;
    crate::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(crate::providers::HttpProviderTransport::new(8 * 1024 * 1024).map_err(invalid)?),
        Arc::new(crate::providers::HttpPublicTransport::new(8 * 1024 * 1024).map_err(invalid)?),
        Arc::new(s3),
        keys,
        units,
        kma_endpoints(var)?,
        Arc::new(SystemClock),
        Arc::new(crate::domestic::metrics::DomesticMetrics::default()),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)
}
fn kma_endpoints(var: Var) -> Result<crate::domestic::family::Endpoints, GatewayError> {
    let root = |name: &str, default: &str| {
        var(name)
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| default.to_owned())
    };
    crate::domestic::family::Endpoints::new(
        &root("SERVER2_DATA_GO_KR_BASE_URL", "https://apis.data.go.kr/"),
        &root("SERVER2_KMA_BASE_URL", "https://www.kma.go.kr/"),
        &root("SERVER2_KMA_WEATHER_BASE_URL", "https://www.weather.go.kr/"),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)
}
/// Build the gateway from injected variables. No legacy URL keeps the foundation service.
pub fn from_vars(var: Var) -> Result<Option<Arc<Gateway>>, GatewayError> {
    let Some(base) = var("SERVER2_GATEWAY_LEGACY_URL") else {
        return Ok(None);
    };
    let families = NativeFamilies::from_vars(var)?;
    let backend = BackendDispatcher::legacy(&base)?;
    let s3 = if families.geocode || families.dsf || families.kma {
        Some(shared_s3(var)?)
    } else {
        None
    };
    let geocoder: Arc<dyn super::Geocoder> = match (&s3, families.geocode) {
        (Some(s3), true) => Arc::new(native_geocoder(var, s3.clone())?),
        _ => Arc::new(LegacyGeocoder::new(&base)?),
    };
    if let (Some(s3), true) = (s3.clone(), families.dsf) {
        crate::world::runtime::select(&backend, crate::world::runtime::build(var, s3)?)?;
    }
    if let (Some(s3), true) = (s3, families.kma) {
        // S15b: the S3 input source over the shared admission. Inputs owned by later slices
        // still forward with named reasons until S15b-4. S15b-2 request-time acquisitions use
        // the data.go.kr keys for ASOS and the product geocoder for station coordinates.
        let source = crate::domestic::kma::source::S3Source::new(
            s3.clone(),
            crate::domestic::kma::backend::system_clock(),
            Arc::new(kma_acquirer(var, s3)?),
            Arc::new(crate::domestic::kma::source::observe::ProductGeocoder(
                geocoder.clone(),
            )),
        )
        .map_err(|_| GatewayError::InvalidConfiguration)?;
        crate::domestic::kma::backend::select_native(&backend, Arc::new(source))?;
    }
    Ok(Some(Arc::new(Gateway::new(geocoder, backend))))
}
/// The process environment entrypoint.
pub fn configured_gateway() -> Result<Option<Arc<Gateway>>, GatewayError> {
    from_vars(&|name: &str| std::env::var_os(name).map(|v| v.to_string_lossy().into_owned()))
}
