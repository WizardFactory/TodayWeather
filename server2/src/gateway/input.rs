//! Public gateway input normalization.
use super::{GatewayError, Version};
#[derive(Clone, PartialEq)]
pub enum Route {
    Weather(Version, [f64; 2]),
    Coord([f64; 2]),
    Address(String),
}
// Debug supports assertion diagnostics without exposing a precise identity.
impl std::fmt::Debug for Route {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Weather(version, _) => f
                .debug_tuple("Weather")
                .field(version)
                .field(&"<redacted>")
                .finish(),
            Self::Coord(_) => f.write_str("Coord(<redacted>)"),
            Self::Address(_) => f.write_str("Address(<redacted>)"),
        }
    }
}
pub fn parse_loc(raw: &str) -> Result<[f64; 2], GatewayError> {
    let mut parts = raw.split(',');
    let lat = number(parts.next().ok_or(GatewayError::BadRequest)?)?;
    let lon = number(parts.next().ok_or(GatewayError::BadRequest)?)?;
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err(GatewayError::BadRequest);
    }
    let loc = crate::geocode::normalize_loc([lat, lon]);
    if loc == [0., 0.] {
        return Err(GatewayError::NotFound);
    }
    Ok(loc)
}
fn number(raw: &str) -> Result<f64, GatewayError> {
    let raw=raw.trim_matches(|c:char|matches!(c,'\u{0009}'..='\u{000D}'|'\u{0020}'|'\u{00A0}'|'\u{1680}'|'\u{2000}'..='\u{200A}'|'\u{2028}'|'\u{2029}'|'\u{202F}'|'\u{205F}'|'\u{3000}'|'\u{FEFF}'));
    if raw.is_empty() {
        return Ok(0.);
    }
    let value = if let Some((radix, digits)) = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .map(|s| (16, s))
        .or_else(|| {
            raw.strip_prefix("0b")
                .or_else(|| raw.strip_prefix("0B"))
                .map(|s| (2, s))
        })
        .or_else(|| {
            raw.strip_prefix("0o")
                .or_else(|| raw.strip_prefix("0O"))
                .map(|s| (8, s))
        }) {
        if digits.is_empty() {
            return Err(GatewayError::BadRequest);
        }
        let mut n = 0.;
        for c in digits.chars() {
            n = n * f64::from(radix)
                + f64::from(c.to_digit(radix).ok_or(GatewayError::BadRequest)?);
        }
        n
    } else {
        raw.parse::<f64>().map_err(|_| GatewayError::BadRequest)?
    };
    if !value.is_finite() {
        return Err(GatewayError::BadRequest);
    }
    Ok(value)
}
pub fn decode(raw: &str, plus: bool) -> Result<String, GatewayError> {
    let mut bytes = Vec::with_capacity(raw.len());
    let raw = raw.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            let h = *raw.get(i + 1).ok_or(GatewayError::BadRequest)?;
            let l = *raw.get(i + 2).ok_or(GatewayError::BadRequest)?;
            let h = (h as char).to_digit(16).ok_or(GatewayError::BadRequest)?;
            let l = (l as char).to_digit(16).ok_or(GatewayError::BadRequest)?;
            bytes.push((h * 16 + l) as u8);
            i += 3;
        } else {
            bytes.push(if plus && raw[i] == b'+' { b' ' } else { raw[i] });
            i += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| GatewayError::BadRequest)
}
pub fn encode(raw: &str) -> String {
    let mut out = String::new();
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for b in raw.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 15) as usize] as char);
        }
    }
    out
}
pub fn build_query(original: &str) -> String {
    let Some((_, query)) = original.split_once('?') else {
        return String::new();
    };
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut positions = std::collections::HashMap::<String, usize>::new();
    for pair in query.split('&').filter(|s| !s.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let (Ok(key), Ok(value)) = (decode(key, true), decode(value, true)) else {
            continue;
        };
        if let Some(index) = positions.get(&key) {
            pairs[*index].1 = value;
        } else {
            positions.insert(key.clone(), pairs.len());
            pairs.push((key, value));
        }
    }
    if pairs.is_empty() {
        String::new()
    } else {
        format!(
            "?{}",
            pairs
                .into_iter()
                .map(|(k, v)| format!("{}={}", encode(&k), encode(&v)))
                .collect::<Vec<_>>()
                .join("&")
        )
    }
}
pub fn language(header: Option<&str>) -> String {
    let value = header.unwrap_or("en").split('-').next().unwrap_or("");
    if value.encode_utf16().count() > 64 {
        "en".into()
    } else {
        value.into()
    }
}
pub fn route(path: &str) -> Result<Route, GatewayError> {
    // Address wildcard includes slashes and its optional final slash verbatim.
    for version in ["v000901", "v000903"] {
        if let Some(raw) = path.strip_prefix(&format!("/geocode/{version}/addr/")) {
            let address = decode(raw, false)?;
            if address.is_empty() || address.encode_utf16().count() > 200 {
                return Err(GatewayError::BadRequest);
            }
            return Ok(Route::Address(address));
        }
    }
    let path = path.strip_suffix('/').unwrap_or(path);
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        ["", "weather", "coord", loc] if !loc.is_empty() => Ok(Route::Weather(
            Version::V000901,
            parse_loc(&decode(loc, false)?)?,
        )),
        ["", "weather", version, "coord", loc] if !loc.is_empty() => Ok(Route::Weather(
            Version::parse(version).ok_or(GatewayError::NotFound)?,
            parse_loc(&decode(loc, false)?)?,
        )),
        ["", "geocode", "v000903", "coord", loc] if !loc.is_empty() => {
            Ok(Route::Coord(parse_loc(&decode(loc, false)?)?))
        }
        _ => Err(GatewayError::NotFound),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn js_coordinate_and_query_contract() {
        assert_eq!(parse_loc("0x25,0b1111111"), Ok([37., 127.]));
        assert_eq!(parse_loc("1.0005,2.0005"), Ok([1., 2.001]));
        assert_eq!(parse_loc("-1.0625,2.0625,ignored"), Ok([-1.063, 2.063]));
        assert_eq!(parse_loc("0.0001,0.0001"), Err(GatewayError::NotFound));
        assert_eq!(parse_loc("\u{85},127"), Err(GatewayError::BadRequest));
        assert_eq!(
            build_query("/?b=1&a=x+b&b=2&bad=%ZZ&empty"),
            "?b=2&a=x%20b&empty="
        );
    }
    #[test]
    fn routes_and_utf16_address_limit() {
        assert!(matches!(
            route("/weather/coord/37,127/"),
            Ok(Route::Weather(Version::V000901, _))
        ));
        assert_eq!(
            route("/geocode/v000902/coord/37,127"),
            Err(GatewayError::NotFound)
        );
        assert_eq!(
            route("/geocode/v000903/addr/%ZZ"),
            Err(GatewayError::BadRequest)
        );
        assert_eq!(
            route(&format!("/geocode/v000903/addr/{}", "😀".repeat(101))),
            Err(GatewayError::BadRequest)
        );
        assert_eq!(language(Some(&"x".repeat(65))), "en");
    }
}
