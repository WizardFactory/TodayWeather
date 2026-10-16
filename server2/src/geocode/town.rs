//! Internal town geocoding contracts: convertGeocode (Kakao then Google XML) and KR
//! name2address (Google JSON, Korean labels). These operations do not change public addr.
use super::{BoxFuture, GeoProvider, GeocodeError, GeocoderConfig, ProviderDemand, Quota};
use instant_xml::FromXml;
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    Town,
    Remap,
}
/// Result contains only address-derived permitted fields, no keys or reverse lookup identity.
pub trait Acquire: Send + Sync + 'static {
    fn address(
        &self,
        operation: Operation,
        address: String,
    ) -> BoxFuture<'_, Result<Value, GeocodeError>>;
}
pub struct Client {
    config: GeocoderConfig,
    quota: Arc<dyn Quota>,
    http: reqwest::Client,
    rotation: AtomicUsize,
}
impl Client {
    /// Config is built from the legacy convertGeocode key names. Unlike the public product
    /// geocoder, that legacy path does not apply GeoController's Google-key fingerprint filter.
    pub fn new(mut config: GeocoderConfig, quota: Arc<dyn Quota>) -> Result<Self, GeocodeError> {
        if config.kakao_keys.len() > 16
            || config
                .kakao_keys
                .iter()
                .any(|k| k.is_empty() || k.len() > 512)
            || config
                .google_key
                .as_ref()
                .is_some_and(|k| k.is_empty() || k.len() > 512)
        {
            return Err(GeocodeError::InvalidConfiguration);
        }
        config.kakao_base_url = super::endpoint_root(&config.kakao_base_url)
            .ok_or(GeocodeError::InvalidConfiguration)?;
        config.google_base_url = super::endpoint_root(&config.google_base_url)
            .ok_or(GeocodeError::InvalidConfiguration)?;
        let http = reqwest::Client::builder()
            .no_proxy()
            .retry(reqwest::retry::never())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| GeocodeError::InvalidConfiguration)?;
        Ok(Self {
            config,
            quota,
            http,
            rotation: AtomicUsize::new(0),
        })
    }
    async fn call(
        &self,
        provider: GeoProvider,
        address: &str,
        xml: bool,
        deadline: Instant,
    ) -> Result<Vec<u8>, GeocodeError> {
        let (key_index, key) = match provider {
            GeoProvider::Kakao => {
                let count = self.config.kakao_keys.len();
                if count == 0 {
                    return Err(GeocodeError::Provider);
                }
                let i = self.rotation.fetch_add(1, Ordering::Relaxed) % count;
                (i, self.config.kakao_keys[i].as_str())
            }
            GeoProvider::Google => (
                0,
                self.config
                    .google_key
                    .as_deref()
                    .ok_or(GeocodeError::Provider)?,
            ),
        };
        // Fund the selected key before every actual HTTP attempt, including KR retries.
        self.quota
            .reserve(vec![ProviderDemand {
                provider,
                key_index,
                attempts: 1,
            }])
            .await?;
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(GeocodeError::Provider)?;
        let cap = remaining.min(Duration::from_secs(3));
        let url = match provider {
            GeoProvider::Kakao => format!(
                "{}/v2/local/search/address.json?query={}",
                self.config.kakao_base_url,
                super::encode(address)
            ),
            GeoProvider::Google => format!(
                "{}/maps/api/geocode/{}?address={}&language=ko&key={}",
                self.config.google_base_url,
                if xml { "xml" } else { "json" },
                super::encode(address),
                super::encode(key)
            ),
        };
        let counters = &crate::gateway::metrics::COUNTERS;
        crate::gateway::metrics::add(match provider {
            GeoProvider::Kakao => &counters.kakao_attempts,
            GeoProvider::Google => &counters.google_attempts,
        });
        let mut req = self.http.get(url).timeout(cap);
        if provider == GeoProvider::Kakao {
            req = req.header(reqwest::header::AUTHORIZATION, format!("KakaoAK {key}"));
        }
        tokio::time::timeout(cap, async {
            let mut response = req.send().await.map_err(|_| GeocodeError::Provider)?;
            // Both legacy convertGeocode adapters reject HTTP>=400; redirects are disabled.
            if !(200..300).contains(&response.status().as_u16()) {
                return Err(GeocodeError::Provider);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| GeocodeError::Provider)? {
                if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
                    return Err(GeocodeError::Provider);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(bytes)
        })
        .await
        .map_err(|_| GeocodeError::Provider)?
    }
}
impl Acquire for Client {
    fn address(
        &self,
        operation: Operation,
        address: String,
    ) -> BoxFuture<'_, Result<Value, GeocodeError>> {
        Box::pin(async move {
            if address.is_empty()
                || address.encode_utf16().count() > 200
                || address.chars().any(char::is_control)
            {
                return Err(GeocodeError::Provider);
            }
            let deadline = Instant::now() + Duration::from_secs(9);
            match operation {
                Operation::Town => {
                    if let Ok(bytes) = self
                        .call(GeoProvider::Kakao, &address, false, deadline)
                        .await
                        && let Ok(location) = kakao_location(&bytes)
                    {
                        return canonical_location(&location);
                    }
                    let bytes = self
                        .call(GeoProvider::Google, &address, true, deadline)
                        .await?;
                    canonical_location(&google_xml_location(&bytes)?)
                }
                Operation::Remap => {
                    // Legacy name2address retries the request, not parse errors.
                    let mut body = None;
                    for _ in 0..3 {
                        if let Ok(bytes) = self
                            .call(GeoProvider::Google, &address, false, deadline)
                            .await
                        {
                            body = Some(bytes);
                            break;
                        }
                    }
                    let body: Value = serde_json::from_slice(&body.ok_or(GeocodeError::Provider)?)
                        .map_err(|_| GeocodeError::Provider)?;
                    let geo = super::provider::google_coord(&body, [0., 0.])?;
                    Ok(
                        json!({"provider":"google","address":geo.address.ok_or(GeocodeError::Provider)?}),
                    )
                }
            }
        })
    }
}
fn finite(v: &Value) -> bool {
    let n = match v {
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Number(n) => n.as_f64(),
        _ => None,
    };
    n.is_some_and(f64::is_finite)
}
/// Keep Kakao's coordinate primitive types: convertGeocode does not parseFloat its x/y.
pub fn kakao_location(bytes: &[u8]) -> Result<Value, GeocodeError> {
    let body: Value = serde_json::from_slice(bytes).map_err(|_| GeocodeError::Provider)?;
    if body["meta"]["total_count"].as_f64().is_none_or(|n| n < 1.) {
        return Err(GeocodeError::Provider);
    }
    let first = body["documents"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or(GeocodeError::Provider)?;
    if !finite(&first["y"]) || !finite(&first["x"]) {
        return Err(GeocodeError::Provider);
    }
    Ok(json!({"provider":"kakao","lat":first["y"],"lon":first["x"]}))
}
#[derive(FromXml)]
#[xml(rename = "GeocodeResponse")]
struct GoogleXml {
    status: String,
    result: Vec<GoogleResult>,
}
#[derive(FromXml)]
#[xml(rename = "result")]
struct GoogleResult {
    geometry: GoogleGeometry,
}
#[derive(FromXml)]
#[xml(rename = "geometry")]
struct GoogleGeometry {
    location: GoogleLocation,
}
#[derive(FromXml)]
#[xml(rename = "location")]
struct GoogleLocation {
    lat: String,
    lng: String,
}
/// Google fallback parses location numbers; status ZERO_RESULTS is the explicit legacy guard.
pub fn google_xml_location(bytes: &[u8]) -> Result<Value, GeocodeError> {
    if bytes.len() > 1024 * 1024
        || bytes
            .windows(9)
            .any(|s| s.eq_ignore_ascii_case(b"<!DOCTYPE"))
        || bytes
            .windows(8)
            .any(|s| s.eq_ignore_ascii_case(b"<!ENTITY"))
    {
        return Err(GeocodeError::Provider);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| GeocodeError::Provider)?;
    let response: GoogleXml = instant_xml::from_str(text).map_err(|_| GeocodeError::Provider)?;
    if response.status == "ZERO_RESULTS" {
        return Err(GeocodeError::Provider);
    }
    let location = &response
        .result
        .first()
        .ok_or(GeocodeError::Provider)?
        .geometry
        .location;
    let lat = crate::world::js::parse_float(&location.lat);
    let lon = crate::world::js::parse_float(&location.lng);
    if !lat.is_finite() || !lon.is_finite() {
        return Err(GeocodeError::Provider);
    }
    Ok(json!({"provider":"google","lat":lat,"lon":lon}))
}

/// AK 2026-10-16: normalize address-derived coordinates at first admission as the real Town
/// schema casts them. This corrects legacy's hot plain-object string .toFixed failure; no
/// operating mode preserves that bug. The raw parser keeps provider types for oracle evidence.
pub fn canonical_location(input: &Value) -> Result<Value, GeocodeError> {
    let fields = input.as_object().ok_or(GeocodeError::Provider)?;
    if fields.len() != 3 || !matches!(input["provider"].as_str(), Some("kakao" | "google")) {
        return Err(GeocodeError::Provider);
    }
    let cast = |value: &Value| match value {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => crate::world::js::string_to_number(s),
        _ => f64::NAN,
    };
    let lat = cast(&input["lat"]);
    let lon = cast(&input["lon"]);
    if !(-90. ..=90.).contains(&lat) || !(-180. ..=180.).contains(&lon) {
        return Err(GeocodeError::Provider);
    }
    Ok(json!({"provider":input["provider"],"lat":lat,"lon":lon}))
}
