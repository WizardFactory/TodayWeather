//! Process wiring from the operator-injected environment.
//!
//! `SERVER2_GATEWAY_LEGACY_URL` enables the gateway. `SERVER2_NATIVE_FAMILIES` lists the
//! families routed to the native backend (`geocode`, `dsf`, `kma`); every other family stays on the
//! legacy origin, and an unlisted family reads none of its native settings. Removing a family
//! from the list and restarting is the rollback. These two and `SERVER2_WORLD_VERSIONS` are
//! coexistence routing, removed with legacy retirement; with `SERVER2_S3_BUCKET` and
//! `SERVER2_S3_REGION` (the server2 raw-record bucket and its region) they are the only
//! `SERVER2_*` settings.
//!
//! S10e (AK, 2026-10-15): every provider and storage setting is the legacy `server/.env` name
//! with its legacy value (`server/config/config.js`). Quotas without a legacy setting and every
//! provider and S3 endpoint are built in ([`Builtins`]); only tests build other values.
//! S10f (#2759): without real AWS keys, S3 requests are signed with EC2 instance-role
//! credentials ([`S3Settings`]).
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

/// Built-in provider and S3 roots and geocoder limits. Production uses
/// [`Builtins::production`]: the legacy production endpoints and the documented quotas; no
/// setting changes them. Tests and the test-only `loopback_server` example build other values
/// to reach loopback test peers (and, for the geocoder, to exhaust a small quota).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Builtins {
    /// S3 endpoint; `None` is the regional AWS endpoint of `SERVER2_S3_REGION`.
    pub s3: Option<String>,
    /// Instance metadata (IMDSv2) root for instance-role S3 credentials (S10f); `None` is the
    /// EC2 instance metadata service ([`crate::storage::METADATA_ROOT`]). Tests only: a loopback
    /// IMDS double.
    pub instance_metadata: Option<String>,
    pub data_go_kr: String,
    pub kma: String,
    pub kma_weather: String,
    /// MFDS food-poisoning root (S15b-3b, keyless; legacy `lib/foodPoisoning.js` `ENDPOINT`).
    pub mfds: String,
    /// The origin of the AirKorea forecast images (S15b-3c, keyless; the dust forecast's
    /// `imageUrl1..9` must be on it).
    pub airkorea_images: String,
    /// Visual Crossing Timeline root.
    pub vc: String,
    pub google_air: String,
    pub openweather: String,
    pub waqi: String,
    /// Geocoder roots (`https://dapi.kakao.com`, `https://maps.googleapis.com`).
    pub kakao: String,
    pub google: String,
    /// Units per Kakao key and per Google key and UTC day
    /// ([`crate::geocode::budget::KAKAO_DAILY_UNITS`], [`crate::geocode::budget::GOOGLE_DAILY_UNITS`]).
    pub geocoder_daily_units: [u64; 2],
}
impl Builtins {
    pub fn production() -> Self {
        let [google, openweather, waqi] = crate::world::runtime::AIR_ENDPOINTS;
        Self {
            s3: None,
            instance_metadata: None,
            data_go_kr: "https://apis.data.go.kr/".into(),
            kma: "https://www.kma.go.kr/".into(),
            kma_weather: "https://www.weather.go.kr/".into(),
            mfds: crate::domestic::mfds::DEFAULT_ROOT.into(),
            airkorea_images: crate::domestic::family::AIRKOREA_IMAGES.into(),
            vc: crate::world::runtime::VC_ENDPOINT.into(),
            google_air: google.1.into(),
            openweather: openweather.1.into(),
            waqi: waqi.1.into(),
            kakao: crate::geocode::KAKAO_ENDPOINT.into(),
            google: crate::geocode::GOOGLE_ENDPOINT.into(),
            geocoder_daily_units: [
                crate::geocode::budget::KAKAO_DAILY_UNITS,
                crate::geocode::budget::GOOGLE_DAILY_UNITS,
            ],
        }
    }
    /// The KMA family roots (data.go.kr, kma.go.kr, weather.go.kr).
    pub fn kma_endpoints(&self) -> Result<crate::domestic::family::Endpoints, GatewayError> {
        crate::domestic::family::Endpoints::new(&self.data_go_kr, &self.kma, &self.kma_weather)
            .and_then(|e| e.with_airkorea_images(&self.airkorea_images))
            .map_err(|_| GatewayError::InvalidConfiguration)
    }
}
impl Default for Builtins {
    fn default() -> Self {
        Self::production()
    }
}

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
/// The process S3 client from the S3 settings ([`S3Settings`]), behind one bounded admission.
/// With the instance role the one transport holds the process credential cache.
pub fn shared_s3(
    var: Var,
    builtins: &Builtins,
) -> Result<BoundedS3<HttpS3Transport>, GatewayError> {
    let settings = S3Settings::from_vars_with(
        var,
        builtins.s3.as_deref(),
        builtins.instance_metadata.as_deref(),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)?;
    let transport = settings
        .transport()
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(BoundedS3::new(transport, S3_IN_FLIGHT))
}
/// The native geocoder: existing `GEOCODER_*` keys, the built-in endpoints and per-key
/// daily limits ([`Builtins::geocoder_daily_units`]) funded in S3.
pub fn native_geocoder(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    builtins: &Builtins,
) -> Result<Geocoder, GatewayError> {
    let [kakao_units, google_units] = builtins.geocoder_daily_units;
    let config = GeocoderConfig::from_vars_at(var, &builtins.kakao, &builtins.google)
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let quota = FundedQuota::for_keys(
        Arc::new(s3),
        Arc::new(SystemClock),
        &config,
        Some(kakao_units),
        Some(google_units),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(Geocoder::new(config)
        .map_err(|_| GatewayError::InvalidConfiguration)?
        .with_quota(Arc::new(quota)))
}
/// The KMA request-time acquirer: the legacy data.go.kr key list `DONGNAE_SECRET_KEYS` (a JSON
/// array, required with `kma`), funded with the built-in
/// [`crate::domestic::kma::source::observe::DATA_GO_KR_DAILY_UNITS`] per key and KST day in S3
/// (S08), at the given builtins.
pub fn kma_acquirer(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    builtins: &Builtins,
) -> Result<
    crate::domestic::kma::source::observe::DailyAcquirer<
        crate::providers::HttpProviderTransport,
        crate::providers::HttpPublicTransport,
        BoundedS3<HttpS3Transport>,
    >,
    GatewayError,
> {
    let keys = crate::domestic::keys::parse_keys(
        &var("DONGNAE_SECRET_KEYS").ok_or(GatewayError::InvalidConfiguration)?,
    );
    let units = crate::domestic::kma::source::observe::DATA_GO_KR_DAILY_UNITS;
    let invalid = |_| GatewayError::InvalidConfiguration;
    crate::domestic::kma::source::observe::DailyAcquirer::new(
        Arc::new(crate::providers::HttpProviderTransport::new(8 * 1024 * 1024).map_err(invalid)?),
        Arc::new(crate::providers::HttpPublicTransport::new(8 * 1024 * 1024).map_err(invalid)?),
        Arc::new(s3),
        keys,
        units,
        builtins.kma_endpoints()?,
        Arc::new(SystemClock),
        Arc::new(crate::domestic::metrics::DomesticMetrics::default()),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)
}
/// Build the gateway from injected variables at the production builtins. No legacy URL keeps the
/// foundation service.
pub fn from_vars(var: Var) -> Result<Option<Arc<Gateway>>, GatewayError> {
    from_vars_at(var, &Builtins::production())
}
/// [`from_vars`] at the given builtins (tests and the test-only `loopback_server` example).
pub fn from_vars_at(var: Var, builtins: &Builtins) -> Result<Option<Arc<Gateway>>, GatewayError> {
    let Some(base) = var("SERVER2_GATEWAY_LEGACY_URL") else {
        return Ok(None);
    };
    let families = NativeFamilies::from_vars(var)?;
    let backend = BackendDispatcher::legacy(&base)?;
    let s3 = if families.geocode || families.dsf || families.kma {
        Some(shared_s3(var, builtins)?)
    } else {
        None
    };
    let geocoder: Arc<dyn super::Geocoder> = match (&s3, families.geocode) {
        (Some(s3), true) => Arc::new(native_geocoder(var, s3.clone(), builtins)?),
        _ => Arc::new(LegacyGeocoder::new(&base)?),
    };
    // One process air chain for the world family and the KMA air fallback (S15b-3).
    let air = match &s3 {
        Some(s3) if families.dsf || families.kma => {
            Some(crate::world::runtime::live_air(var, s3.clone(), builtins)?)
        }
        _ => None,
    };
    if let (Some(s3), true, Some(air)) = (s3.clone(), families.dsf, air.clone()) {
        crate::world::runtime::select(
            &backend,
            crate::world::runtime::build_with_air(var, s3, air, builtins)?,
        )?;
    }
    if let (Some(s3), true) = (s3, families.kma) {
        // S15b: the S3 input source over the shared admission. Inputs owned by later slices
        // still forward with named reasons until S15b-4. S15b-2 request-time acquisitions use
        // the data.go.kr keys for ASOS and the product geocoder for station coordinates.
        // S15b-3 adds request-time AirKorea
        // acquisition (`AIRKOREA_SECRET_KEYS`) and the air fallback through the shared air chain;
        // S15b-3b the life index and KASI on the same data.go.kr acquirer and the keyless MFDS
        // table (production endpoint, no setting).
        let airkorea = kma_airkorea(var, &s3, builtins)?;
        let daily = Arc::new(kma_acquirer(var, s3.clone(), builtins)?);
        let life = kma_life(&s3, daily.clone(), builtins)?;
        let air: Option<Arc<dyn crate::world::AirSource>> =
            air.map(|a| a as Arc<dyn crate::world::AirSource>);
        let source = crate::domestic::kma::source::S3Source::new(
            s3.clone(),
            crate::domestic::kma::backend::system_clock(),
            daily,
            Arc::new(crate::domestic::kma::source::observe::ProductGeocoder(
                geocoder.clone(),
            )),
        )
        .map_err(|_| GatewayError::InvalidConfiguration)?
        .with_air(airkorea, air)
        .with_image_calibration(
            crate::domestic::kma::source::air_forecast::Calibration::from_vars(var),
        )
        .with_life(Some(life));
        crate::domestic::kma::backend::select_native(&backend, Arc::new(source))?;
    }
    Ok(Some(Arc::new(Gateway::new(geocoder, backend))))
}
/// The request-time AirKorea acquirer of the KMA source; None without `AIRKOREA_SECRET_KEYS`.
fn kma_airkorea(
    var: Var,
    s3: &BoundedS3<HttpS3Transport>,
    builtins: &Builtins,
) -> Result<Option<Arc<dyn crate::domestic::kma::source::live::AirKoreaAcquire>>, GatewayError> {
    use crate::domestic::kma::source::live::{AirKoreaSettings, LiveAirKorea};
    let Some(settings) = AirKoreaSettings::from_vars(var, builtins.kma_endpoints()?)
        .map_err(|_| GatewayError::InvalidConfiguration)?
    else {
        return Ok(None);
    };
    // Legacy AirKorea bounds: 2 MiB bodies; each attempt, connecting included, gets the S13d
    // legacy timeout of its path (B552584: 5 s), the call its 30 s budget, and a request waits
    // only for its own bound.
    let funded = crate::domestic::kma::source::live::airkorea_transport()
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    // The keyless transport fetches the forecast GIFs (about 5 MB each, S15b-3c).
    let public = crate::providers::HttpPublicTransport::new(8 * 1024 * 1024)
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let store =
        crate::storage::CatalogStore::new(s3.clone(), crate::storage::CatalogLimits::default())
            .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(Some(Arc::new(LiveAirKorea::new(
        settings,
        Arc::new(funded),
        Arc::new(public),
        Arc::new(s3.clone()),
        Arc::new(store),
        Arc::new(SystemClock),
    ))))
}
/// The life-index, KASI and MFDS acquirer of the KMA source on the process data.go.kr acquirer
/// (each attempt gets the S13d legacy timeout of its path: life index 30 s, KASI 5 s; MFDS its
/// own 10 s deadline).
type DailyKma = crate::domestic::kma::source::observe::DailyAcquirer<
    crate::providers::HttpProviderTransport,
    crate::providers::HttpPublicTransport,
    BoundedS3<HttpS3Transport>,
>;
fn kma_life(
    s3: &BoundedS3<HttpS3Transport>,
    daily: Arc<DailyKma>,
    builtins: &Builtins,
) -> Result<Arc<dyn crate::domestic::kma::source::life_live::LifeAcquire>, GatewayError> {
    use crate::domestic::kma::source::life_live::{LifeSettings, LiveLife};
    let settings = LifeSettings::with_mfds_root(&builtins.mfds)
        .map_err(|_| GatewayError::InvalidConfiguration)?;
    let store =
        crate::storage::CatalogStore::new(s3.clone(), crate::storage::CatalogLimits::default())
            .map_err(|_| GatewayError::InvalidConfiguration)?;
    let mfds = crate::domestic::kma::source::life_live::mfds_acquirer(
        Arc::new(
            crate::providers::HttpProviderTransport::new(1024 * 1024)
                .map_err(|_| GatewayError::InvalidConfiguration)?,
        ),
        Arc::new(SystemClock),
    )
    .map_err(|_| GatewayError::InvalidConfiguration)?;
    Ok(Arc::new(LiveLife::new(
        settings,
        daily,
        Arc::new(mfds),
        Arc::new(store),
    )))
}
