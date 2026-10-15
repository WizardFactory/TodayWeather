//! Process wiring for the native world family (world weather and air).
//!
//! The family is built only when `SERVER2_NATIVE_FAMILIES` lists `dsf`; otherwise no world
//! setting is read and the gateway keeps the legacy world backend.
//!
//! S10e (AK, 2026-10-15): the legacy `server/.env` names and values. Visual Crossing:
//! `VC_SECRET_KEY` and `VC_DAILY_RECORD_LIMIT` (`config.js` `vc.dailyRecordLimit`). Air: the
//! legacy chain keys `GOOGLE_SECRET_KEY`, `OWM_SECRET_KEY`, `WAQI_SECRET_KEY`
//! (`config.js` `google_key`, `owm_keys`, `aqi_keys`) and the legacy `config/air.js` free caps
//! `AIR_GOOGLE_MONTHLY_CAP` / `AIR_OWM_MONTHLY_CAP`. Quota owners derive from the keys;
//! endpoints are the legacy production providers ([`crate::gateway::runtime::Builtins`]); S3 is the
//! shared legacy S3 settings.
use super::{
    AirConfig, AirFunding, AirProviderConfig, BoundedS3, CatalogAirStore, CatalogWorldStore,
    FundedVc, HttpAirTransport, HttpVcTransport, LiveAir, SystemClock, VcFunding, World,
    WorldBackend, WorldConfig,
};
use crate::{
    budget::SystemClock as BudgetClock,
    gateway::{
        BackendDispatcher, BackendMode, GatewayError, Version,
        runtime::{Builtins, NativeFamilies},
    },
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

/// Visual Crossing records per UTC day when `VC_DAILY_RECORD_LIMIT` sets no budget: the
/// documented free plan, "1,000 records/day"
/// (<https://www.visualcrossing.com/weather-data-editions/>, read 2026-10-15). Legacy runs
/// without a budget then; S08 funding needs one.
pub const VC_FREE_DAILY_RECORDS: u64 = 1_000;
/// Legacy `config/air.js` defaults of `AIR_GOOGLE_MONTHLY_CAP` and `AIR_OWM_MONTHLY_CAP`
/// (the vendor free tiers: Google Air Quality 10,000 calls a month, OpenWeather 1,000,000).
pub const AIR_GOOGLE_MONTHLY_CAP: u64 = 10_000;
pub const AIR_OWM_MONTHLY_CAP: u64 = 1_000_000;
/// WAQI units per UTC month. Legacy has no WAQI cap; the provider documents only "The default
/// quota is 1,000 (one thousand) requests per second" (<https://aqicn.org/api/>, read
/// 2026-10-15), so the ceiling is that rate over a 31-day month.
pub const WAQI_MONTHLY_UNITS: u64 = 1_000 * 86_400 * 31;

/// The S08 quota owner of a world provider key: a domain-separated SHA-256 of the key, so it
/// follows key rotation and the key never leaves the process.
pub fn quota_owner(provider: &str, key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-world-quota-v1");
    hash.update([0u8]);
    hash.update(provider.as_bytes());
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
/// Legacy `config/air.js` `integer(env, name, default, 0)`: unset or blank is the default;
/// otherwise trimmed decimal digits up to `Number.MAX_SAFE_INTEGER`, anything else an error.
fn air_cap(var: Var, name: &str, default: u64) -> Result<u64, GatewayError> {
    let trim = |v: &str| v.trim_matches(super::js::is_js_space).to_owned();
    let Some(text) = var(name).map(|v| trim(&v)).filter(|v| !v.is_empty()) else {
        return Ok(default);
    };
    if !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(GatewayError::InvalidConfiguration);
    }
    text.parse::<u64>()
        .ok()
        .filter(|v| *v <= 9_007_199_254_740_991)
        .ok_or(GatewayError::InvalidConfiguration)
}
/// Calls a legacy free cap admits per month: legacy stops at `calls >= cap * (1 - 0.05)`, so
/// whole calls below the 5 % reserve, `ceil(0.95 * cap)`.
fn reserve(cap: u64) -> u64 {
    cap - cap / 20
}
/// Legacy `Number(VC_DAILY_RECORD_LIMIT) || 0` (JavaScript `Number`: `50.0`, `5e1` and `0x32`
/// are 50). Legacy denies a fetch when `records + cost > limit` with whole records, so a positive
/// finite limit admits `floor(limit)` records; it is never raised to the free plan. Zero, unset,
/// not a number and `Infinity` are "no budget" in legacy, here the documented free plan. A
/// negative limit, or one below 1, denies every fetch once the day has usage in legacy; here it is
/// the smallest budget, 1 record.
fn vc_daily_records(var: Var) -> u64 {
    let limit = var("VC_DAILY_RECORD_LIMIT")
        .map(|v| super::js::string_to_number(&v))
        .unwrap_or(0.);
    if limit.is_nan() || limit == 0. || limit == f64::INFINITY {
        return VC_FREE_DAILY_RECORDS;
    }
    if limit < 1. {
        return 1;
    }
    // `as` saturates at u64::MAX for huge finite limits.
    limit.floor() as u64
}

/// Build the native world when the routing list selects it, with the shared S3 settings, at
/// the production builtins.
pub fn from_vars(var: Var) -> Result<Option<Configured>, GatewayError> {
    from_vars_at(var, &Builtins::production())
}
/// [`from_vars`] at the given builtins (tests).
pub fn from_vars_at(var: Var, builtins: &Builtins) -> Result<Option<Configured>, GatewayError> {
    if !NativeFamilies::from_vars(var)?.dsf {
        return Ok(None);
    }
    let s3 = crate::gateway::runtime::shared_s3(var, builtins)?;
    build(var, s3, builtins).map(Some)
}

/// The process air chain (`LiveAir`) from the legacy air settings. The world family and, since
/// S15b-3, the KMA air fallback share one instance, so one cell is resolved once.
pub type ProcessAir = LiveAir<BoundedS3<HttpS3Transport>>;
pub fn live_air(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    builtins: &Builtins,
) -> Result<Arc<ProcessAir>, GatewayError> {
    // A provider takes part when its legacy key is set (the chain applies legacy `isValidKey`)
    // and its month has units. Google and OpenWeather keep the legacy free-cap rule: calls stop
    // at 95 % of the cap (`calls >= cap * (1 - RESERVE)`), so a cap of 0 leaves the provider out.
    // With no provider the air output is the legacy `no-provider` result. Stored records are
    // read before the chain on every miss, so a restart restores from S3.
    let provider = |name: &str, key: &str, root: &str, monthly_units: u64| {
        let key = set(var, key)?;
        (monthly_units > 0).then(|| AirProviderConfig {
            base_url: root.into(),
            quota_id: quota_owner(name, &key),
            key,
            monthly_units,
            block_units: monthly_units.clamp(1, 100),
        })
    };
    let google_cap = air_cap(var, "AIR_GOOGLE_MONTHLY_CAP", AIR_GOOGLE_MONTHLY_CAP)?;
    let owm_cap = air_cap(var, "AIR_OWM_MONTHLY_CAP", AIR_OWM_MONTHLY_CAP)?;
    let config = AirConfig {
        google: provider(
            "google",
            "GOOGLE_SECRET_KEY",
            &builtins.google_air,
            reserve(google_cap),
        ),
        openweather: provider(
            "openweather",
            "OWM_SECRET_KEY",
            &builtins.openweather,
            reserve(owm_cap),
        ),
        waqi: provider(
            "waqi",
            "WAQI_SECRET_KEY",
            &builtins.waqi,
            WAQI_MONTHLY_UNITS,
        ),
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
pub fn build(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    builtins: &Builtins,
) -> Result<Configured, GatewayError> {
    let air = live_air(var, s3.clone(), builtins)?;
    build_with_air(var, s3, air, builtins)
}
/// [`build`] with an already built process air chain.
pub fn build_with_air(
    var: Var,
    s3: BoundedS3<HttpS3Transport>,
    air: Arc<ProcessAir>,
    builtins: &Builtins,
) -> Result<Configured, GatewayError> {
    let key = need(var, "VC_SECRET_KEY")?;
    let units = vc_daily_records(var);
    // One S08 window per UTC day (the legacy usage day); FundedVc opens a fresh store per day.
    let funding = VcFunding {
        transport: Arc::new(s3.clone()),
        quota_id: quota_owner("visualcrossing", &key),
        daily_units: units,
        block_units: units.clamp(1, 98),
        clock: Arc::new(BudgetClock),
    };
    let provider =
        Arc::new(HttpVcTransport::new().map_err(|_| GatewayError::InvalidConfiguration)?);
    let source = FundedVc::new(&builtins.vc, provider, funding, key)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn one(name: &'static str, value: &'static str) -> impl Fn(&str) -> Option<String> {
        move |n: &str| (n == name).then(|| value.to_owned())
    }

    /// S10e: `VC_DAILY_RECORD_LIMIT` as legacy `Number(v) || 0`, with the free plan for "none".
    #[test]
    fn vc_records_follow_the_legacy_limit_or_the_free_plan() {
        let records = |v: &'static str| vc_daily_records(&one("VC_DAILY_RECORD_LIMIT", v));
        assert_eq!(vc_daily_records(&|_: &str| None), VC_FREE_DAILY_RECORDS);
        assert_eq!(records("2500"), 2500);
        assert_eq!(records(" 2500 "), 2500);
        // S10E-R2: JavaScript `Number` forms of a valid limit keep that limit.
        for fifty in ["50.0", "5e1", "0x32", "50.9", "\u{feff}50\u{a0}"] {
            assert_eq!(records(fifty), 50, "{fifty}");
        }
        for none in ["", "0", "-0", "many", "Infinity", "1_000"] {
            assert_eq!(records(none), VC_FREE_DAILY_RECORDS, "{none}");
        }
        for tiny in ["-5", "0.5", "-Infinity"] {
            assert_eq!(records(tiny), 1, "{tiny}");
        }
    }

    /// S10e: legacy `config/air.js` caps and the 5 % reserve below each free cap.
    #[test]
    fn air_caps_follow_legacy_config_air() {
        let name = "AIR_GOOGLE_MONTHLY_CAP";
        let cap = |v: &'static str| air_cap(&one(name, v), name, 7);
        assert_eq!(air_cap(&|_: &str| None, name, 7).ok(), Some(7));
        assert_eq!(cap(" ").ok(), Some(7));
        assert_eq!(cap(" 2000 ").ok(), Some(2000));
        assert_eq!(cap("\u{feff}2000\u{3000}").ok(), Some(2000));
        assert_eq!(cap("0").ok(), Some(0));
        assert_eq!(cap("9007199254740991").ok(), Some(9_007_199_254_740_991));
        for bad in ["-1", "1.5", "1e3", "many", "9007199254740992"] {
            assert!(cap(bad).is_err(), "{bad}");
        }
        // The defaults leave 9,500 and 950,000 calls a month, as legacy.
        assert_eq!(reserve(AIR_GOOGLE_MONTHLY_CAP), 9_500);
        assert_eq!(reserve(AIR_OWM_MONTHLY_CAP), 950_000);
        assert_eq!(reserve(19), 19);
        assert_eq!(reserve(1), 1);
        assert_eq!(reserve(0), 0);
        assert_eq!(WAQI_MONTHLY_UNITS, 2_678_400_000);
    }

    /// Quota owners derive from the key and the provider; 64 lowercase hex for S08.
    #[test]
    fn quota_owners_are_key_derived() {
        let a = quota_owner("waqi", "key-a");
        assert_eq!(a.len(), 64);
        assert!(
            a.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_ne!(a, quota_owner("waqi", "key-b"));
        assert_ne!(a, quota_owner("google", "key-a"));
    }
}
