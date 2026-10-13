use super::{GeoClient, GeoProvider, GeocodeError, KmaAddress, Location};
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Outcome {
    Success,
    Rotate,
    Terminal,
}
fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, GeocodeError> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or(GeocodeError::Provider)
}
fn types_start(value: &Value, expected: &[&str]) -> bool {
    value
        .get("types")
        .and_then(Value::as_array)
        .is_some_and(|types| {
            types.len() >= expected.len()
                && types
                    .iter()
                    .zip(expected)
                    .all(|(v, e)| v.as_str() == Some(e))
        })
}
fn types_exact(value: &Value, expected: &[&str]) -> bool {
    value
        .get("types")
        .and_then(Value::as_array)
        .is_some_and(|types| types.len() == expected.len())
        && types_start(value, expected)
}
pub(super) fn classify(provider: GeoProvider, status: u16, body: Option<&Value>) -> Outcome {
    if status >= 500 || [401, 403, 429].contains(&status) {
        return Outcome::Rotate;
    }
    match provider {
        GeoProvider::Kakao => {
            if (200..300).contains(&status) {
                return if body.is_some_and(|v| v.is_object() || v.is_array()) {
                    Outcome::Success
                } else {
                    Outcome::Rotate
                };
            }
            let code = body.and_then(|v| v.get("code")).and_then(Value::as_i64);
            let error = body
                .and_then(|v| v.get("errorType"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            if matches!(code, Some(-10 | -401 | -3))
                || [
                    "throttl",
                    "limit",
                    "quota",
                    "accessdenied",
                    "unauthori",
                    "appkey",
                    "permission",
                ]
                .iter()
                .any(|v| error.contains(v))
            {
                Outcome::Rotate
            } else {
                Outcome::Terminal
            }
        }
        GeoProvider::Google => {
            if !(200..300).contains(&status) {
                return Outcome::Terminal;
            }
            if !body.is_some_and(|v| v.is_object() || v.is_array()) {
                return Outcome::Rotate;
            }
            match body.and_then(|v| v.get("status")).and_then(Value::as_str) {
                Some("OK") => Outcome::Success,
                Some(
                    "REQUEST_DENIED" | "OVER_QUERY_LIMIT" | "OVER_DAILY_LIMIT" | "UNKNOWN_ERROR",
                ) => Outcome::Rotate,
                _ => Outcome::Terminal,
            }
        }
    }
}

pub(super) fn kakao_coord(body: &Value, loc: [f64; 2]) -> Result<GeoClient, GeocodeError> {
    let mut geo = GeoClient {
        location: Some(Location::from(loc)),
        ..GeoClient::default()
    };
    let total = body
        .get("meta")
        .and_then(|v| v.get("total_count"))
        .and_then(Value::as_u64)
        .ok_or(GeocodeError::Provider)?;
    if total < 2 {
        return Ok(geo);
    }
    let docs = array(body, "documents")?;
    if docs.is_empty() {
        return Err(GeocodeError::Provider);
    }
    if docs
        .first()
        .and_then(|v| v.get("region_1depth_name"))
        .and_then(Value::as_str)
        == Some("")
    {
        return Ok(geo);
    }
    if let Some(region) = docs
        .iter()
        .find(|v| v.get("region_type").and_then(Value::as_str) == Some("H"))
    {
        geo.country = Some("KR".into());
        geo.address = text(region, "address_name");
        geo.name = [
            "region_4depth_name",
            "region_3depth_name",
            "region_2depth_name",
            "region_1depth_name",
        ]
        .into_iter()
        .find_map(|key| text(region, key).filter(|v| !v.is_empty()));
        geo.kma_address = Some(KmaAddress {
            name1: text(region, "region_1depth_name").ok_or(GeocodeError::Provider)?,
            name2: text(region, "region_2depth_name").map(|v| v.replace(' ', "")),
            name3: text(region, "region_3depth_name"),
        });
    }
    Ok(geo)
}
fn number(value: &Value) -> Option<f64> {
    if value.is_null() {
        Some(0.0)
    } else if let Some(v) = value.as_f64() {
        Some(v)
    } else if let Some(v) = value.as_str() {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            Some(0.0)
        } else {
            trimmed.parse().ok()
        }
    } else {
        value.as_bool().map(|v| if v { 1.0 } else { 0.0 })
    }
}
pub(super) fn kakao_addr(body: &Value, address: &str) -> Result<GeoClient, GeocodeError> {
    let total = body
        .get("meta")
        .and_then(|v| v.get("total_count"))
        .and_then(Value::as_u64)
        .ok_or(GeocodeError::Provider)?;
    if total < 1 {
        return Err(GeocodeError::Provider);
    }
    let doc = array(body, "documents")?
        .first()
        .ok_or(GeocodeError::Provider)?;
    let lat = doc
        .get("y")
        .and_then(number)
        .filter(|v| v.is_finite())
        .ok_or(GeocodeError::Provider)?;
    let lon = doc
        .get("x")
        .and_then(number)
        .filter(|v| v.is_finite())
        .ok_or(GeocodeError::Provider)?;
    Ok(GeoClient {
        country: Some("KR".into()),
        address: Some(address.into()),
        location: Some(Location::from([lat, lon])),
        ..GeoClient::default()
    })
}
const LEVEL2: &[&str] = &["political", "sublocality", "sublocality_level_2"];
const LEVEL1: &[&str] = &["political", "sublocality", "sublocality_level_1"];
const LOCAL: &[&str] = &["locality", "political"];
pub(super) fn google_coord(body: &Value, loc: [f64; 2]) -> Result<GeoClient, GeocodeError> {
    if body.get("status").and_then(Value::as_str) != Some("OK") {
        return Err(GeocodeError::Provider);
    }
    let results = array(body, "results")?;
    let mut country = None;
    let mut level2 = None;
    let mut level1 = None;
    let mut local = None;
    for result in results {
        for component in array(result, "address_components")? {
            if country.is_none() && types_start(component, &["country"]) {
                country = text(component, "short_name")
                    .filter(|v| v.encode_utf16().count() <= 2 && !v.is_empty());
            }
        }
        if level2.is_none() && types_exact(result, LEVEL2) {
            level2 = Some(result);
        }
        if level1.is_none() && types_exact(result, LEVEL1) {
            level1 = Some(result);
        }
        if local.is_none() && types_exact(result, LOCAL) {
            local = Some(result);
        }
    }
    let country = country.ok_or(GeocodeError::Provider)?;
    let selected = if country == "KR" {
        level2.or(level1).or(local)
    } else {
        level1.or(local)
    };
    let (name, address) = if let Some(result) = selected {
        let expected = if country == "KR" && level2.is_some() {
            LEVEL2
        } else if level1.is_some() {
            LEVEL1
        } else {
            LOCAL
        };
        // The legacy function assigns each matching component; the last match wins.
        let name = array(result, "address_components")?
            .iter()
            .filter(|v| types_start(v, expected))
            .filter_map(|v| text(v, "short_name"))
            .next_back();
        (name, text(result, "formatted_address"))
    } else {
        let mut two = None;
        let mut one = None;
        let mut city = None;
        let mut nation = None;
        'outer: for result in results {
            for component in array(result, "address_components")? {
                if types_start(component, LEVEL2) {
                    two = text(component, "short_name");
                }
                if types_start(component, LEVEL1) {
                    one = text(component, "short_name");
                }
                if types_start(component, LOCAL) {
                    city = text(component, "short_name");
                }
                if types_start(component, &["country"]) {
                    nation = text(component, "long_name");
                }
                if [&two, &one, &city, &nation]
                    .iter()
                    .all(|v| v.as_ref().is_some_and(|v| !v.is_empty()))
                {
                    break 'outer;
                }
            }
        }
        let mut name = None;
        let mut address = String::new();
        if country == "KR"
            && let Some(value) = two.filter(|v| !v.is_empty())
        {
            address.push_str(&value);
            name = Some(value);
        }
        for value in [one, city, nation]
            .into_iter()
            .flatten()
            .filter(|v| !v.is_empty())
        {
            address.push(' ');
            address.push_str(&value);
            if name.is_none() {
                name = Some(value);
            }
        }
        (name, Some(address))
    };
    if name.is_none() || address.is_none() {
        return Err(GeocodeError::Provider);
    }
    Ok(GeoClient {
        name,
        country: Some(country),
        address,
        location: Some(Location::from(loc)),
        kma_address: None,
    })
}
pub(super) fn google_addr(body: &Value, address: &str) -> Result<GeoClient, GeocodeError> {
    if body.get("status").and_then(Value::as_str) != Some("OK") {
        return Err(GeocodeError::Provider);
    }
    let result = array(body, "results")?
        .first()
        .ok_or(GeocodeError::Provider)?;
    let location = result
        .get("geometry")
        .and_then(|v| v.get("location"))
        .ok_or(GeocodeError::Provider)?;
    let lat = location
        .get("lat")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or(GeocodeError::Provider)?;
    let lon = location
        .get("lng")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or(GeocodeError::Provider)?;
    let country = array(result, "address_components")?
        .iter()
        .find(|v| types_start(v, &["country"]))
        .and_then(|v| text(v, "short_name"));
    Ok(GeoClient {
        country,
        address: Some(address.into()),
        location: Some(Location::from([lat, lon])),
        ..GeoClient::default()
    })
}
