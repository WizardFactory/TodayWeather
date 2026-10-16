//! The alarm worker's weather requests (`controllerPush.requestDailySummary`,
//! `_requestKmaDailySummary`, `_requestDsfDailySummary`, `_requestGeoInfo`, `_geoInfo2pushInfo`):
//! the legacy URLs on `SERVICE_SERVER` (v000902) and `API_SERVER` (geocode v000903), the units
//! query and `Accept-Language`, one attempt each. Legacy set no timeout; server2 bounds each
//! request ([`WEATHER_TIMEOUT`]).
use super::text::{self, Message};
use crate::gateway::{BoxFuture, OrderedJson};
use crate::push::js::{self, Thrown, encode_uri_component, has_own, prop, to_string};
use crate::push::routes::init_units;
use crate::world::js::{Obj, Val};
use std::time::Duration;

/// Bound of one weather or geocode request (legacy `request` had none).
pub const WEATHER_TIMEOUT: Duration = Duration::from_secs(30);

/// One GET; `Err` is a transport failure (message only, no URL).
pub trait Fetch: Send + Sync {
    fn get(
        &self,
        url: String,
        accept_language: Option<String>,
    ) -> BoxFuture<'_, Result<(u16, Vec<u8>), String>>;
}

/// reqwest GET with `Accept: application/json` (as `request` `json: true`), no retries.
pub struct HttpFetch {
    client: reqwest::Client,
}
impl HttpFetch {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(WEATHER_TIMEOUT)
                .retry(reqwest::retry::never())
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
}
impl Fetch for HttpFetch {
    fn get(
        &self,
        url: String,
        lang: Option<String>,
    ) -> BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        Box::pin(async move {
            let mut request = self.client.get(&url).header("accept", "application/json");
            if let Some(lang) = lang {
                request = request.header("accept-language", lang);
            }
            let response = request.send().await.map_err(|e| {
                if e.is_timeout() {
                    "timeout".to_owned()
                } else {
                    "transport".to_owned()
                }
            })?;
            let status = response.status().as_u16();
            let body = response.bytes().await.map_err(|_| "transport".to_owned())?;
            Ok((status, body.to_vec()))
        })
    }
}

/// Where the worker sends weather requests (legacy `config.serviceServer.url`,
/// `config.apiServer.url`, both `http://localhost` when unset).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Servers {
    pub service: String,
    pub api: String,
}
impl Servers {
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Self {
        let pick = |name: &str| {
            var(name)
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "http://localhost".into())
        };
        Self {
            service: pick("SERVICE_SERVER"),
            api: pick("API_SERVER"),
        }
    }
}

/// Why no message was built.
#[derive(Clone, Debug, PartialEq)]
pub enum WeatherFailure {
    /// A request failed (transport, timeout or HTTP status >= 400).
    Request(&'static str, String),
    /// The record or a response could not be used (`INVALID PUSHINFO`, `INVALID GEOINFO`, an
    /// exception in a text builder, an unknown package).
    Build(String),
}

fn units_query(units: &Val) -> String {
    let mut out = String::new();
    if let Val::Obj(o) = units {
        let mut keys: Vec<&str> = o.keys().collect();
        let idx = |k: &str| k.parse::<u32>().ok().filter(|n| n.to_string() == k);
        keys.sort_by_key(|k| idx(k).map_or((1, 0), |n| (0, n)));
        for (i, k) in keys.into_iter().enumerate() {
            out.push(if i == 0 { '?' } else { '&' });
            out.push_str(k);
            out.push('=');
            out.push_str(&to_string(o.get(k)));
        }
    }
    out
}

fn coords(info: &Obj) -> Result<String, Thrown> {
    let geo = info.get("geo");
    Ok(format!(
        "{},{}",
        to_string(&prop(geo, "1")?),
        to_string(&prop(geo, "0")?)
    ))
}

async fn fetch_json(
    fetch: &dyn Fetch,
    url: String,
    lang: Option<String>,
    what: &'static str,
) -> Result<Val, WeatherFailure> {
    let (status, body) = fetch
        .get(url, lang)
        .await
        .map_err(|e| WeatherFailure::Request(what, e))?;
    if status >= 400 {
        return Err(WeatherFailure::Request(
            what,
            format!("response.statusCode={status}"),
        ));
    }
    // `request` with `json: true`: a body that is not JSON stays a string.
    Ok(OrderedJson::parse(&body)
        .map(|v| Val::from_ordered(&v))
        .unwrap_or_else(|_| Val::Str(String::from_utf8_lossy(&body).into_owned())))
}

fn default_units(body: &mut Val) -> Result<(), Thrown> {
    match body {
        Val::Obj(o) => {
            if o.get("units").is_nullish() {
                let mut u = Obj::new();
                for (k, v) in [
                    ("temperatureUnit", "C"),
                    ("windSpeedUnit", "m/s"),
                    ("pressureUnit", "hPa"),
                    ("distanceUnit", "km"),
                    ("precipitationUnit", "mm"),
                    ("airUnit", "airkorea"),
                ] {
                    u.set(k, v);
                }
                o.set("units", Val::Obj(u));
            }
            Ok(())
        }
        Val::Null | Val::Undef => Err("Cannot read properties of null (reading 'units')".into()),
        _ => Ok(()),
    }
}

fn lang_of(info: &Obj) -> Option<String> {
    let lang = info.get("lang");
    (!lang.is_nullish()).then(|| to_string(lang))
}

fn build(info: &Obj, body: &Val, dsf: bool) -> Result<Message, WeatherFailure> {
    match text::message(info, body, dsf) {
        Ok(Some(m)) => Ok(m),
        Ok(None) => Err(WeatherFailure::Build("unknown package".into())),
        Err(e) => Err(WeatherFailure::Build(e)),
    }
}

async fn kma(info: &Obj, servers: &Servers, fetch: &dyn Fetch) -> Result<Message, WeatherFailure> {
    let mut url;
    let town = info.get("town").clone();
    if info.get("geo").truthy() {
        url = format!(
            "{}/v000902/kma/coord/{}",
            servers.service,
            coords(info).map_err(WeatherFailure::Build)?
        );
    } else if town.truthy()
        && prop(&town, "first")
            .map_err(WeatherFailure::Build)?
            .truthy()
        && !js::loose_eq(
            &prop(&town, "first").map_err(WeatherFailure::Build)?,
            &Val::Str(String::new()),
        )
    {
        url = format!("{}/v000902/kma/addr", servers.service);
        for part in ["first", "second", "third"] {
            let v = prop(&town, part).map_err(WeatherFailure::Build)?;
            if v.truthy() {
                url.push('/');
                url.push_str(&encode_uri_component(&to_string(&v)));
            }
        }
    } else {
        return Err(WeatherFailure::Build(
            "Fail to find geo or town info".into(),
        ));
    }
    url.push_str(&units_query(info.get("units")));
    let mut body = fetch_json(fetch, url, lang_of(info), "kma").await?;
    default_units(&mut body).map_err(WeatherFailure::Build)?;
    build(info, &body, false)
}

async fn dsf(info: &Obj, servers: &Servers, fetch: &dyn Fetch) -> Result<Message, WeatherFailure> {
    let mut url = format!(
        "{}/v000902/dsf/coord/{}",
        servers.service,
        coords(info).map_err(WeatherFailure::Build)?
    );
    url.push_str(&units_query(info.get("units")));
    let mut body = fetch_json(fetch, url, lang_of(info), "dsf").await?;
    default_units(&mut body).map_err(WeatherFailure::Build)?;
    build(info, &body, true)
}

/// `_geoInfo2pushInfo`: copy the KMA address and location; `false` when neither applies.
fn geo_to_info(info: &mut Obj, geo: &Val) -> bool {
    let copy = (|| -> Result<bool, Thrown> {
        let mut success = false;
        let address = prop(geo, "kmaAddress")?;
        if address.truthy() {
            let name1 = prop(&address, "name1")?;
            if name1.truthy() && js::greater(&prop(&name1, "length")?, &Val::Num(1.)) {
                let mut town = Obj::new();
                town.set("first", name1);
                for (key, field) in [("second", "name2"), ("third", "name3")] {
                    let v = prop(&address, field)?;
                    if v.truthy() {
                        town.set(key, v);
                    }
                }
                info.set("town", Val::Obj(town));
                success = true;
            }
        }
        let location = prop(geo, "location")?;
        if location.truthy() && has_own("geoInfo.location", &location, "lat", false)? {
            info.set(
                "geo",
                Val::Arr(vec![prop(&location, "long")?, prop(&location, "lat")?]),
            );
            success = true;
        }
        Ok(success)
    })();
    copy.unwrap_or(false)
}

async fn by_geo(
    info: &mut Obj,
    servers: &Servers,
    fetch: &dyn Fetch,
) -> Result<Message, WeatherFailure> {
    let url = format!(
        "{}/geocode/v000903/coord/{}",
        servers.api,
        coords(info).map_err(WeatherFailure::Build)?
    );
    let geo = fetch_json(fetch, url, None, "geocode").await?;
    if prop(&geo, "country").map_err(WeatherFailure::Build)? == Val::Str("KR".into()) {
        if !geo_to_info(info, &geo) {
            return Err(WeatherFailure::Build("INVALID GEOINFO".into()));
        }
        kma(info, servers, fetch).await
    } else {
        dsf(info, servers, fetch).await
    }
}

/// `requestDailySummary(pushInfo)`: defaults, request selection and the message. `info` is
/// mutated as legacy mutates the record (language, units, package, geocoded town/location).
pub async fn daily_summary(
    info: &mut Obj,
    servers: &Servers,
    fetch: &dyn Fetch,
) -> Result<Message, WeatherFailure> {
    if info.get("lang").is_nullish() {
        info.set("lang", "ko");
    }
    let units = init_units(info.get("units")).map_err(WeatherFailure::Build)?;
    info.set("units", units);
    if !info.get("package").truthy() {
        info.set("package", "todayWeather");
    }
    let source = info.get("source").clone();
    let is = |v: &str| js::loose_eq(&source, &Val::Str(v.into()));
    if js::strict_eq(info.get("cityIndex"), &Val::Num(0.)) && info.get("geo").truthy() {
        by_geo(info, servers, fetch).await
    } else if is("VC") || is("DSF") {
        dsf(info, servers, fetch).await
    } else if is("KMA") {
        kma(info, servers, fetch).await
    } else if info.get("geo").truthy() {
        by_geo(info, servers, fetch).await
    } else {
        let town = info.get("town").clone();
        let first = if town.truthy() {
            prop(&town, "first").unwrap_or(Val::Undef)
        } else {
            Val::Undef
        };
        if first.truthy()
            && js::greater(&prop(&first, "length").unwrap_or(Val::Undef), &Val::Num(0.))
        {
            kma(info, servers, fetch).await
        } else {
            Err(WeatherFailure::Build("INVALID PUSHINFO".into()))
        }
    }
}

/// `_makeRequestUrl` of the conditional worker. Its source must be present (unlike the daily
/// alarm's geocoding fallback); VC and DSF share the overseas route.
pub fn conditional_url(info: &mut Obj, servers: &Servers) -> Result<String, WeatherFailure> {
    if info.get("lang").is_nullish() {
        info.set("lang", "ko");
    }
    info.set(
        "units",
        init_units(info.get("units")).map_err(WeatherFailure::Build)?,
    );
    let Val::Str(source) = info.get("source") else {
        return Err(WeatherFailure::Build(
            "source.toLowerCase is not a function".into(),
        ));
    };
    let mut source = source.to_lowercase();
    if source == "vc" {
        source = "dsf".into();
    }
    let mut url = servers.service.clone();
    if info.get("geo").truthy() {
        url.push_str(&format!(
            "/v000902/{source}/coord/{}",
            coords(info).map_err(WeatherFailure::Build)?
        ));
    } else if info.get("town").truthy() {
        url.push_str("/v000902/kma/addr");
        for field in ["first", "second", "third"] {
            let v = prop(info.get("town"), field).map_err(WeatherFailure::Build)?;
            if v.truthy() {
                url.push('/');
                url.push_str(&encode_uri_component(&to_string(&v)));
            }
        }
    }
    url.push_str(&units_query(info.get("units")));
    Ok(url)
}

/// Conditional weather preparation, one attempt with the legacy 10 s timeout. It never
/// retries provider submission; a failed fetch is a skipped conditional cycle.
pub async fn conditional(
    info: &mut Obj,
    servers: &Servers,
    fetch: &dyn Fetch,
) -> Result<Val, WeatherFailure> {
    if !info.get("source").truthy() {
        return Err(WeatherFailure::Build("unknown source".into()));
    }
    let url = conditional_url(info, servers)?;
    tokio::time::timeout(
        Duration::from_secs(10),
        fetch_json(fetch, url, lang_of(info), "weather"),
    )
    .await
    .unwrap_or_else(|_| Err(WeatherFailure::Request("weather", "timeout".into())))
}
