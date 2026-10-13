//! data.go.kr key-list resolution ported from server/lib/dataGoKrKeys.js at ca8735cf.
//! Values are secrets: callers wrap them in `providers::ProviderKey` and never log them.

/// Legacy `parse`: a JSON array; strings whose trimmed length is at least 20, not the
/// `You have to set` placeholder, first occurrence kept. Each key is then decoded once
/// (`decodeURIComponent`); the funded transport encodes it once. A key whose encoding is
/// malformed is dropped here (legacy forecast URLs became empty for it).
pub fn parse_keys(value: &str) -> Vec<String> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(value)
    else {
        return Vec::new();
    };
    let mut seen: Vec<&str> = Vec::new();
    let mut out = Vec::new();
    for item in &items {
        let Some(key) = item.as_str() else { continue };
        if key.trim().chars().count() < 20
            || key.starts_with("You have to set")
            || seen.contains(&key)
        {
            continue;
        }
        seen.push(key);
        if let Some(decoded) = decode_component(key)
            && !decoded.is_empty()
        {
            out.push(decoded);
        }
    }
    out
}

/// `decodeURIComponent`: every `%XX` is decoded; a stray `%` or invalid UTF-8 is an error.
fn decode_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            out.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
