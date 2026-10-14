//! Process wiring for the native world family (world weather and air).
//!
//! The family is built only when `SERVER2_NATIVE_FAMILIES` lists `dsf`; otherwise no world
//! setting is read and the gateway keeps the legacy world backend. Endpoints default to the
//! legacy production providers; S3 comes from the shared `SERVER2_S3_*` settings.
use super::{
    AirConfig, AirFunding, AirProviderConfig, BoundedS3, CatalogAirStore, CatalogWorldStore,
    FundedVc, HttpAirTransport, HttpVcTransport, LiveAir, SystemClock, VcFunding, World,
    WorldBackend, WorldConfig,
};
use crate::{
    budget::SystemClock as BudgetClock,
    gateway::{BackendDispatcher, BackendMode, GatewayError, Version, runtime::NativeFamilies},
    storage::{CatalogLimits, HttpS3Transport},
};
use std::sync::Arc;

/// Legacy `vcRequester` Timeline root.
pub const VC_ENDPOINT: &str =
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/";
/// Legacy air provider roots (`google.js`, `openweather.js`, `waqi.js`).
pub const AIR_ENDPOINTS: [(&str, &str); 3] = [
    ("GOOGLE", "https://airquality.googleapis.com/"),
    ("OPENWEATHER", "https://api.openweathermap.org/"),
    ("WAQI", "https://api.waqi.info/"),
];
/// A configured native world backend and the versions it is selected for.
pub type Configured = (Arc<WorldBackend>, Vec<Version>);
type Var<'a> = &'a dyn Fn(&str) -> Option<String>;

fn set(var: Var, name: &str) -> Option<String> {
    var(name).filter(|v| !v.is_empty())
}
fn need(var: Var, name: &str) -> Result<String, GatewayError> {
    set(var, name).ok_or(GatewayError::InvalidConfiguration)
}
fn number(var: Var, name: &str) -> Result<u64, GatewayError> {
    need(var, name)?
        .parse()
        .map_err(|_| GatewayError::InvalidConfiguration)
}

/// Build the native world when the routing list selects it, with its own S3 settings.
pub fn from_vars(var: Var) -> Result<Option<Configured>, GatewayError> {
    if !NativeFamilies::from_vars(var)?.dsf {
        return Ok(None);
    }
    let s3 = crate::gateway::runtime::shared_s3(var)?;
    build(var, s3).map(Some)
}

/// The process air chain (`LiveAir`) from `SERVER2_WORLD_AIR_*`. The world family and, since
/// S15b-3, the KMA air fallback share one instance, so one cell is resolved once.
pub type ProcessAir = LiveAir<BoundedS3<HttpS3Transport>>;
pub fn live_air(var: Var, s3: BoundedS3<HttpS3Transport>) -> Result<Arc<ProcessAir>, GatewayError> {
    // A provider takes part when its key is set; its limit and quota owner are then required.
    // With no provider the air output is the legacy `no-provider` result. Stored records are
    // read before the chain on every miss, so a restart restores from S3.
    let provider = |name: &str, root: &str| -> Result<Option<AirProviderConfig>, GatewayError> {
        let Some(key) = set(var, &format!("SERVER2_WORLD_AIR_{name}_KEY")) else {
            return Ok(None);
        };
        let monthly_units = number(var, &format!("SERVER2_WORLD_AIR_{name}_MONTHLY_UNITS"))?;
        Ok(Some(AirProviderConfig {
            base_url: set(var, &format!("SERVER2_WORLD_AIR_{name}_URL"))
                .unwrap_or_else(|| root.into()),
            key,
            quota_id: need(var, &format!("SERVER2_WORLD_AIR_{name}_QUOTA_ID"))?,
            monthly_units,
            block_units: monthly_units.clamp(1, 100),
        }))
    };
    let [google, openweather, waqi] = AIR_ENDPOINTS;
    let config = AirConfig {
        google: provider(google.0, google.1)?,
        openweather: provider(openweather.0, openweather.1)?,
        waqi: provider(waqi.0, waqi.1)?,
        ..AirConfig::default()
    };
    LiveAir::new(
        config,
        Arc::new(
            CatalogAirStore::new(s3.clone(), CatalogLimits::default())
                .map_err(|_| GatewayError::InvalidConfiguration)?,
        ),
        Arc::new(HttpAirTransport::new().map_err(|_| GatewayError::InvalidConfiguration)?),
        AirFunding {
            transport: Arc::new(s3),
            clock: Arc::new(BudgetClock),
        },
        Arc::new(SystemClock),
    )
    .map(Arc::new)
    .map_err(|_| GatewayError::InvalidConfiguration)
}
/// Build the native world over a shared S3 admission (weather, air and budget requests).
pub fn build(var: Var, s3: BoundedS3<HttpS3Transport>) -> Result<Configured, GatewayError> {
    let air = live_air(var, s3.clone())?;
    build_with_air(var, s3, air)
}
/// [`build`] with an already built process air chain.
pub fn build_with_air(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    air: Arc<ProcessAir>,
) -> Result<Configured, GatewayError> {
    let units = number(var, "SERVER2_WORLD_VC_DAILY_UNITS")?;
    // One S08 window per UTC day (the legacy usage day); FundedVc opens a fresh store per day.
    let funding = VcFunding {
        transport: Arc::new(s3.clone()),
        quota_id: need(var, "SERVER2_WORLD_VC_QUOTA_ID")?,
        daily_units: units,
        block_units: units.clamp(1, 98),
        clock: Arc::new(BudgetClock),
    };
    let provider =
        Arc::new(HttpVcTransport::new().map_err(|_| GatewayError::InvalidConfiguration)?);
    let vc = set(var, "SERVER2_WORLD_VC_URL").unwrap_or_else(|| VC_ENDPOINT.into());
    let source = FundedVc::new(&vc, provider, funding, need(var, "VC_SECRET_KEY")?)
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let store = CatalogWorldStore::new(s3.clone(), CatalogLimits::default())
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let world = World::new(
        Arc::new(store),
        Arc::new(source),
        air,
        Arc::new(SystemClock),
        WorldConfig::default(),
    );
    let versions = match set(var, "SERVER2_WORLD_VERSIONS") {
        None => vec![Version::V000901, Version::V000902, Version::V000903],
        Some(list) => list
            .split(',')
            .map(|v| Version::parse(v.trim()).ok_or(GatewayError::InvalidConfiguration))
            .collect::<Result<_, _>>()?,
    };
    Ok((Arc::new(WorldBackend::new(world)), versions))
}
/// Register a configured native world and select it for its versions.
pub fn select(dispatcher: &BackendDispatcher, configured: Configured) -> Result<(), GatewayError> {
    let (backend, versions) = configured;
    backend.register(dispatcher);
    WorldBackend::select(dispatcher, &versions, BackendMode::Native)
}
