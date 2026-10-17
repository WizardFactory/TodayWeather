//! JavaScript-compatible ordered JSON and the observed Express wire envelope.
use super::GatewayError;
use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use md5::{Digest, Md5};

/// Object order and UTF-16 strings are retained instead of using serde_json's sorted map.
#[derive(Clone, Debug, PartialEq)]
pub enum OrderedJson {
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u16>),
    Array(Vec<Self>),
    Object(Vec<(Vec<u16>, Self)>),
}
impl OrderedJson {
    pub fn parse(bytes: &[u8]) -> Result<Self, GatewayError> {
        // Node's Buffer.toString('utf8') replaces invalid UTF-8 before JSON.parse.
        let text = String::from_utf8_lossy(bytes);
        let mut parser = Parser {
            bytes: text.as_bytes(),
            pos: 0,
        };
        let value = parser.value(0)?;
        parser.space();
        if parser.pos != parser.bytes.len() {
            return Err(GatewayError::Provider);
        }
        Ok(value)
    }
    pub fn from_serde<T: serde::Serialize>(value: &T) -> Result<Self, GatewayError> {
        Self::parse(&serde_json::to_vec(value).map_err(|_| GatewayError::Provider)?)
    }
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut output = String::new();
        self.write(&mut output);
        output.into_bytes()
    }
    pub fn get(&self, key: &str) -> Option<&Self> {
        let key: Vec<u16> = key.encode_utf16().collect();
        match self {
            Self::Object(entries) => entries.iter().find(|(k, _)| *k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn string(&self) -> Option<String> {
        match self {
            Self::String(s) => String::from_utf16(s).ok(),
            _ => None,
        }
    }
    pub fn number(&self) -> Option<f64> {
        match self {
            Self::Number(n) => Some(*n),
            _ => None,
        }
    }
    pub fn is_container(&self) -> bool {
        matches!(self, Self::Object(_) | Self::Array(_))
    }
    pub fn merge_geo(&mut self, geo: &Self) {
        // JS assigning non-index properties to an Array does not change JSON.stringify(Array).
        if let Self::Object(entries) = self {
            for key in ["name", "country", "address", "location"] {
                if let Some(value) = geo.get(key) {
                    let key: Vec<u16> = key.encode_utf16().collect();
                    if let Some((_, old)) = entries.iter_mut().find(|(k, _)| *k == key) {
                        *old = value.clone();
                    } else {
                        entries.push((key, value.clone()));
                    }
                }
            }
        }
    }
    fn write(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Self::Number(n) => out.push_str(&js_number(*n)),
            Self::String(s) => write_string(s, out),
            Self::Array(values) => {
                out.push('[');
                for (i, v) in values.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write(out);
                }
                out.push(']');
            }
            Self::Object(entries) => {
                let mut indices: Vec<(u32, usize)> = entries
                    .iter()
                    .enumerate()
                    .filter_map(|(i, (k, _))| array_index(k).map(|n| (n, i)))
                    .collect();
                indices.sort_unstable();
                let order = indices.into_iter().map(|(_, i)| i).chain(
                    entries
                        .iter()
                        .enumerate()
                        .filter(|(_, (k, _))| array_index(k).is_none())
                        .map(|(i, _)| i),
                );
                out.push('{');
                for (n, i) in order.enumerate() {
                    if n > 0 {
                        out.push(',');
                    }
                    write_string(&entries[i].0, out);
                    out.push(':');
                    entries[i].1.write(out);
                }
                out.push('}');
            }
        }
    }
}
fn array_index(s: &[u16]) -> Option<u32> {
    if s.is_empty() || s.len() > 10 || (s.len() > 1 && s[0] == u16::from(b'0')) {
        return None;
    }
    let mut n = 0u32;
    for c in s {
        if !(48..=57).contains(c) {
            return None;
        }
        n = n.checked_mul(10)?.checked_add(u32::from(*c - 48))?;
    }
    (n != u32::MAX).then_some(n)
}
fn write_string(s: &[u16], out: &mut String) {
    out.push('"');
    let mut i = 0;
    while i < s.len() {
        let u = s[i];
        i += 1;
        match u {
            8 => out.push_str("\\b"),
            9 => out.push_str("\\t"),
            10 => out.push_str("\\n"),
            12 => out.push_str("\\f"),
            13 => out.push_str("\\r"),
            34 => out.push_str("\\\""),
            92 => out.push_str("\\\\"),
            0..=31 => out.push_str(&format!("\\u{u:04x}")),
            0xD800..=0xDBFF if i < s.len() && (0xDC00..=0xDFFF).contains(&s[i]) => {
                let scalar = 0x10000 + ((u32::from(u) - 0xD800) << 10) + (u32::from(s[i]) - 0xDC00);
                i += 1;
                out.push(char::from_u32(scalar).expect("valid surrogate pair"));
            }
            0xD800..=0xDFFF => out.push_str(&format!("\\u{u:04x}")),
            _ => out.push(char::from_u32(u32::from(u)).expect("non-surrogate scalar")),
        }
    }
    out.push('"');
}
/// JSON.stringify uses ordinary decimal for [1e-6,1e21), scientific elsewhere.
pub fn js_number(value: f64) -> String {
    if !value.is_finite() {
        return "null".into();
    }
    if value == 0. {
        return "0".into();
    }
    let negative = value < 0.;
    let raw = serde_json::to_string(&value.abs()).expect("finite f64 serialization");
    let (mantissa, exp) = raw.split_once('e').map_or((raw.as_str(), 0), |(m, e)| {
        (m, e.parse::<i32>().expect("float exponent"))
    });
    let decimal = mantissa.find('.').unwrap_or(mantissa.len()) as i32 + exp;
    let all: String = mantissa.chars().filter(|c| *c != '.').collect();
    let leading = all.bytes().take_while(|b| *b == b'0').count();
    let digits = all[leading..].trim_end_matches('0');
    let point = decimal - leading as i32;
    let exponent = point - 1;
    let mut out = if negative {
        "-".to_owned()
    } else {
        String::new()
    };
    if !(-6..21).contains(&exponent) {
        out.push_str(&digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        if exponent >= 0 {
            out.push('+');
        }
        out.push_str(&exponent.to_string());
    } else if point <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-point) as usize));
        out.push_str(digits);
    } else if point as usize >= digits.len() {
        out.push_str(digits);
        out.extend(std::iter::repeat_n('0', point as usize - digits.len()));
    } else {
        out.push_str(&digits[..point as usize]);
        out.push('.');
        out.push_str(&digits[point as usize..]);
    }
    out
}
struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl Parser<'_> {
    fn space(&mut self) {
        while self
            .bytes
            .get(self.pos)
            .is_some_and(|b| matches!(b, b' ' | b'\n' | b'\r' | b'\t'))
        {
            self.pos += 1;
        }
    }
    fn value(&mut self, depth: usize) -> Result<OrderedJson, GatewayError> {
        if depth > 512 {
            return Err(GatewayError::Provider);
        }
        self.space();
        match self.bytes.get(self.pos).copied() {
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(OrderedJson::Null)
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(OrderedJson::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(OrderedJson::Bool(false))
            }
            Some(b'"') => Ok(OrderedJson::String(self.string()?)),
            Some(b'[') => {
                self.pos += 1;
                self.space();
                let mut values = Vec::new();
                if self.take(b']') {
                    return Ok(OrderedJson::Array(values));
                }
                loop {
                    values.push(self.value(depth + 1)?);
                    self.space();
                    if self.take(b']') {
                        break;
                    }
                    if !self.take(b',') {
                        return Err(GatewayError::Provider);
                    }
                }
                Ok(OrderedJson::Array(values))
            }
            Some(b'{') => {
                self.pos += 1;
                self.space();
                let mut values: Vec<(Vec<u16>, OrderedJson)> = Vec::new();
                let mut positions = std::collections::HashMap::<Vec<u16>, usize>::new();
                if self.take(b'}') {
                    return Ok(OrderedJson::Object(values));
                }
                loop {
                    self.space();
                    let key = self.string()?;
                    self.space();
                    if !self.take(b':') {
                        return Err(GatewayError::Provider);
                    }
                    let value = self.value(depth + 1)?;
                    if let Some(index) = positions.get(&key) {
                        values[*index].1 = value;
                    } else {
                        positions.insert(key.clone(), values.len());
                        values.push((key, value));
                    }
                    self.space();
                    if self.take(b'}') {
                        break;
                    }
                    if !self.take(b',') {
                        return Err(GatewayError::Provider);
                    }
                }
                Ok(OrderedJson::Object(values))
            }
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(GatewayError::Provider),
        }
    }
    fn take(&mut self, b: u8) -> bool {
        if self.bytes.get(self.pos) == Some(&b) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn literal(&mut self, s: &[u8]) -> Result<(), GatewayError> {
        if self.bytes.get(self.pos..self.pos + s.len()) == Some(s) {
            self.pos += s.len();
            Ok(())
        } else {
            Err(GatewayError::Provider)
        }
    }
    fn number(&mut self) -> Result<OrderedJson, GatewayError> {
        let start = self.pos;
        self.take(b'-');
        if !self.take(b'0') {
            if !self
                .bytes
                .get(self.pos)
                .is_some_and(|b| b.is_ascii_digit() && *b != b'0')
            {
                return Err(GatewayError::Provider);
            }
            self.pos += 1;
            self.digits();
        }
        if self.take(b'.') {
            let p = self.pos;
            self.digits();
            if p == self.pos {
                return Err(GatewayError::Provider);
            }
        }
        if self.take(b'e') || self.take(b'E') {
            self.take(b'+');
            self.take(b'-');
            let p = self.pos;
            self.digits();
            if p == self.pos {
                return Err(GatewayError::Provider);
            }
        }
        let number = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| GatewayError::Provider)?
            .parse::<f64>()
            .map_err(|_| GatewayError::Provider)?;
        Ok(OrderedJson::Number(number))
    }
    fn digits(&mut self) {
        while self.bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
            self.pos += 1;
        }
    }
    fn string(&mut self) -> Result<Vec<u16>, GatewayError> {
        if !self.take(b'"') {
            return Err(GatewayError::Provider);
        }
        let mut out = Vec::new();
        loop {
            let b = *self.bytes.get(self.pos).ok_or(GatewayError::Provider)?;
            self.pos += 1;
            match b {
                b'"' => return Ok(out),
                b'\\' => {
                    let b = *self.bytes.get(self.pos).ok_or(GatewayError::Provider)?;
                    self.pos += 1;
                    match b {
                        b'"' | b'\\' | b'/' => out.push(u16::from(b)),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(10),
                        b'r' => out.push(13),
                        b't' => out.push(9),
                        b'u' => {
                            let raw = self
                                .bytes
                                .get(self.pos..self.pos + 4)
                                .ok_or(GatewayError::Provider)?;
                            if !raw.iter().all(u8::is_ascii_hexdigit) {
                                return Err(GatewayError::Provider);
                            }
                            let s = std::str::from_utf8(raw).map_err(|_| GatewayError::Provider)?;
                            out.push(
                                u16::from_str_radix(s, 16).map_err(|_| GatewayError::Provider)?,
                            );
                            self.pos += 4;
                        }
                        _ => return Err(GatewayError::Provider),
                    }
                }
                0..=31 => return Err(GatewayError::Provider),
                32..=127 => out.push(u16::from(b)),
                _ => {
                    self.pos -= 1;
                    let s = std::str::from_utf8(&self.bytes[self.pos..])
                        .map_err(|_| GatewayError::Provider)?;
                    let c = s.chars().next().ok_or(GatewayError::Provider)?;
                    out.extend(c.encode_utf16(&mut [0; 2]).iter().copied());
                    self.pos += c.len_utf8();
                }
            }
        }
    }
}
pub fn etag(body: &[u8]) -> String {
    format!(
        r#"W/"{:x}-{}""#,
        body.len(),
        STANDARD_NO_PAD.encode(Md5::digest(body))
    )
}
pub fn send(
    method: &Method,
    request: &HeaderMap,
    status: StatusCode,
    body: Vec<u8>,
    max_age: Option<u32>,
    retry: Option<u64>,
) -> Response {
    let tag = etag(&body);
    send_tagged(method, request, status, body, max_age, retry, tag)
}
pub(crate) fn send_tagged(
    method: &Method,
    request: &HeaderMap,
    status: StatusCode,
    body: Vec<u8>,
    max_age: Option<u32>,
    retry: Option<u64>,
    tag: String,
) -> Response {
    let max_age = if status.is_success() && max_age.is_some() {
        crate::narrative::cache_age(&body, max_age, crate::narrative::now_ms()).or(max_age)
    } else {
        max_age
    };
    let fresh = status.is_success()
        && !request
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(',')
                    .any(|v| v.trim().eq_ignore_ascii_case("no-cache"))
            })
        && request
            .get("if-none-match")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(',').any(|v| {
                    let v = v.trim();
                    v == "*" || v.trim_start_matches("W/") == tag.trim_start_matches("W/")
                })
            });
    let empty = *method == Method::HEAD || fresh;
    let length = body.len();
    let mut response = Response::new(if empty {
        Body::empty()
    } else {
        Body::from(body)
    });
    *response.status_mut() = if fresh {
        StatusCode::NOT_MODIFIED
    } else {
        status
    };
    let headers = response.headers_mut();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert("x-powered-by", HeaderValue::from_static("Express"));
    headers.insert("etag", HeaderValue::from_str(&tag).expect("ASCII digest"));
    headers.insert(
        "cache-control",
        HeaderValue::from_str(
            &max_age.map_or_else(|| "no-store".into(), |v| format!("max-age={v}")),
        )
        .expect("ASCII cache directive"),
    );
    if !fresh {
        headers.insert(
            "content-type",
            HeaderValue::from_static(if max_age.is_some() {
                "application/json; charset=utf-8"
            } else {
                "text/plain; charset=utf-8"
            }),
        );
        headers.insert(
            "content-length",
            HeaderValue::from_str(&length.to_string()).expect("ASCII length"),
        );
    }
    if let Some(seconds) = retry {
        headers.insert(
            "retry-after",
            HeaderValue::from_str(&seconds.to_string()).expect("ASCII delay"),
        );
    }
    response
}
pub fn error(method: &Method, headers: &HeaderMap, error: GatewayError) -> Response {
    let (status, text, retry) = match error {
        GatewayError::BadRequest => (StatusCode::BAD_REQUEST, "Bad Request", None),
        GatewayError::NotFound => (StatusCode::NOT_FOUND, "Not Found", None),
        GatewayError::Unavailable(seconds) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Service Unavailable",
            Some(seconds.clamp(1, 3600)),
        ),
        _ => (StatusCode::NOT_IMPLEMENTED, "Not Implemented", None),
    };
    send(
        method,
        headers,
        status,
        text.as_bytes().to_vec(),
        None,
        retry,
    )
}
pub fn preflight(request: &HeaderMap) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    let h = response.headers_mut();
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET,HEAD,PUT,PATCH,POST,DELETE"),
    );
    h.insert(
        "vary",
        HeaderValue::from_static("Access-Control-Request-Headers"),
    );
    h.insert("content-length", HeaderValue::from_static("0"));
    h.insert("x-powered-by", HeaderValue::from_static("Express"));
    if let Some(value) = request.get("access-control-request-headers") {
        h.insert("access-control-allow-headers", value.clone());
    }
    response
}
