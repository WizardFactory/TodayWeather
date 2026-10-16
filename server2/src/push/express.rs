//! The legacy Express 4.13.4 request/response path of the push routes (`server/app.js` order):
//! `cors()` (preflight), `body-parser` 1.20.6 `json()` and `urlencoded({extended: false})`, the
//! version router's `decodeURI(req.originalUrl)`, case-insensitive mount matching, `res.send`
//! and the production `finalhandler` 0.4.1 answer (status text only).
use super::routes::{Body, Reply, Route};
use crate::gateway::{OrderedJson, response::etag};
use crate::world::js::{Obj, Val};
use axum::{
    body::Body as HttpBody,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};
use std::io::Read;

/// `bodyParser.json()` and `urlencoded()` default `limit` ('100kb').
pub const BODY_LIMIT: usize = 100 * 1024;
/// Compressed request bytes accepted before inflating (the inflated limit still applies).
pub const RAW_LIMIT: usize = 1024 * 1024;
const PARAMETER_LIMIT: usize = 1000;

/// The push mounts: `/v000705/push`, `/v000902/push` (routePushNotification.js) and
/// `/v000902/push-list` (route.push.update.list.js).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mount {
    Push,
    List,
}

/// Whether a request path belongs to a push mount, and whether it reaches the mounted
/// router's `'/'` handlers (Express is case-insensitive and non-strict about one slash).
pub fn mount(path: &str) -> Option<(Mount, bool)> {
    let lower = path.to_ascii_lowercase();
    for (prefix, m) in [
        ("/v000705/push", Mount::Push),
        ("/v000902/push", Mount::Push),
        ("/v000902/push-list", Mount::List),
    ] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if rest.is_empty() || rest == "/" {
                return Some((m, true));
            }
            if rest.starts_with('/') {
                return Some((m, false));
            }
        }
    }
    None
}

/// The handler a method reaches on a mount.
pub fn route(m: Mount, exact: bool, method: &Method) -> Option<Route> {
    if !exact {
        return None;
    }
    match (m, method.as_str()) {
        (Mount::Push, "POST") => Some(Route::Post),
        (Mount::Push, "PUT") => Some(Route::Put),
        (Mount::Push, "DELETE") => Some(Route::Delete),
        (Mount::List, "POST") => Some(Route::List),
        _ => None,
    }
}

/// `decodeURI` succeeds: every `%` starts a two-digit escape and the escapes form UTF-8.
pub fn decode_uri_ok(text: &str) -> bool {
    let b = text.as_bytes();
    let mut i = 0;
    let hex = |i: usize| -> Option<u8> {
        let h = b.get(i + 1..i + 3)?;
        u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok()
    };
    while i < b.len() {
        if b[i] != b'%' {
            i += 1;
            continue;
        }
        let Some(first) = hex(i) else {
            return false;
        };
        i += 3;
        if first < 0x80 {
            continue;
        }
        let (count, min) = match first {
            0xC2..=0xDF => (1, 0x80),
            0xE0..=0xEF => (2, 0x800),
            0xF0..=0xF4 => (3, 0x10000),
            _ => return false,
        };
        let mut code = u32::from(first) & (0x3F >> count);
        for _ in 0..count {
            if b.get(i) != Some(&b'%') {
                return false;
            }
            let Some(next) = hex(i) else {
                return false;
            };
            if next & 0xC0 != 0x80 {
                return false;
            }
            code = (code << 6) | u32::from(next & 0x3F);
            i += 3;
        }
        if code < min || (0xD800..=0xDFFF).contains(&code) || code > 0x10FFFF {
            return false;
        }
    }
    true
}

/// A request failure answered by Express's final handler.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rejected(pub u16);

struct ContentType {
    essence: String,
    charset: Option<String>,
}
fn content_type(headers: &HeaderMap) -> Option<ContentType> {
    let raw = headers.get("content-type")?.to_str().ok()?;
    let mut parts = raw.split(';');
    let essence = parts.next()?.trim().to_ascii_lowercase();
    let (ty, sub) = essence.split_once('/')?;
    let token = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&c))
    };
    if !token(ty) || !token(sub) {
        return None;
    }
    let mut charset = None;
    for p in parts {
        if let Some((k, v)) = p.split_once('=')
            && k.trim().eq_ignore_ascii_case("charset")
        {
            charset = Some(v.trim().trim_matches('"').to_ascii_lowercase());
        }
    }
    Some(ContentType { essence, charset })
}

/// `typeis.hasBody`.
fn has_body(headers: &HeaderMap) -> bool {
    headers.contains_key("transfer-encoding")
        || headers
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| !js_is_nan(v))
}
fn js_is_nan(v: &str) -> bool {
    crate::world::js::string_to_number(v).is_nan()
}

fn inflate(headers: &HeaderMap, raw: &[u8]) -> Result<Vec<u8>, Rejected> {
    let encoding = headers
        .get("content-encoding")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("identity")
        .to_ascii_lowercase();
    let mut out = Vec::new();
    let reader: Box<dyn Read> = match encoding.as_str() {
        "identity" => {
            if raw.len() > BODY_LIMIT {
                return Err(Rejected(413));
            }
            return Ok(raw.to_vec());
        }
        "gzip" => Box::new(flate2::read::GzDecoder::new(raw)),
        "deflate" => Box::new(flate2::read::ZlibDecoder::new(raw)),
        _ => return Err(Rejected(415)),
    };
    reader
        .take(BODY_LIMIT as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| Rejected(400))?;
    if out.len() > BODY_LIMIT {
        return Err(Rejected(413));
    }
    Ok(out)
}

fn decode_text(bytes: &[u8], charset: &str) -> Result<String, Rejected> {
    match charset {
        "utf-8" => {
            let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
            Ok(String::from_utf8_lossy(bytes).into_owned())
        }
        "utf-16le" | "utf-16be" | "utf-16" => {
            let mut le = charset != "utf-16be";
            let mut bytes = bytes;
            if charset == "utf-16" && bytes.len() >= 2 {
                if bytes[..2] == [0xFE, 0xFF] {
                    le = false;
                    bytes = &bytes[2..];
                } else if bytes[..2] == [0xFF, 0xFE] {
                    bytes = &bytes[2..];
                }
            }
            let units: Vec<u16> = bytes
                .chunks(2)
                .map(|c| {
                    let pair = [c[0], *c.get(1).unwrap_or(&0)];
                    if le {
                        u16::from_le_bytes(pair)
                    } else {
                        u16::from_be_bytes(pair)
                    }
                })
                .collect();
            let units = units.strip_prefix(&[0xFEFF]).unwrap_or(&units);
            Ok(String::from_utf16_lossy(units))
        }
        _ => Err(Rejected(415)),
    }
}

/// `bodyParser.json()` then `bodyParser.urlencoded({extended: false})`; other bodies leave
/// `req.body = {}`.
pub fn parse_body(headers: &HeaderMap, raw: &[u8]) -> Result<Body, Rejected> {
    let plain = Body {
        value: Val::Obj(Obj::new()),
        form: false,
    };
    if !has_body(headers) {
        return Ok(plain);
    }
    let Some(ct) = content_type(headers) else {
        return Ok(plain);
    };
    match ct.essence.as_str() {
        "application/json" => {
            let charset = ct.charset.unwrap_or_else(|| "utf-8".into());
            if !charset.starts_with("utf-") {
                return Err(Rejected(415));
            }
            let bytes = inflate(headers, raw)?;
            let text = decode_text(&bytes, &charset)?;
            if text.is_empty() {
                return Ok(plain);
            }
            let first = text
                .bytes()
                .find(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'));
            if !matches!(first, Some(b'{' | b'[')) {
                return Err(Rejected(400));
            }
            let parsed = OrderedJson::parse(text.as_bytes()).map_err(|_| Rejected(400))?;
            Ok(Body {
                value: Val::from_ordered(&parsed),
                form: false,
            })
        }
        "application/x-www-form-urlencoded" => {
            let charset = ct.charset.unwrap_or_else(|| "utf-8".into());
            if charset != "utf-8" {
                return Err(Rejected(415));
            }
            let bytes = inflate(headers, raw)?;
            let text = decode_text(&bytes, "utf-8")?;
            if text.is_empty() {
                return Ok(plain);
            }
            if text.matches('&').count() + 1 > PARAMETER_LIMIT {
                return Err(Rejected(413));
            }
            Ok(Body {
                value: Val::Obj(querystring(&text)),
                form: true,
            })
        }
        _ => Ok(plain),
    }
}

/// Node 16 `querystring.parse(text)` (`+` is a space, lenient percent-decoding, repeated keys
/// become arrays).
pub fn querystring(text: &str) -> Obj {
    let mut out = Obj::new();
    for pair in text.split('&').take(PARAMETER_LIMIT) {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let (k, v) = (unescape(k), unescape(v));
        match out.get(&k).clone() {
            Val::Undef => out.set(&k, Val::Str(v)),
            Val::Arr(mut a) => {
                a.push(Val::Str(v));
                out.set(&k, Val::Arr(a));
            }
            prev => out.set(&k, Val::Arr(vec![prev, Val::Str(v)])),
        }
    }
    out
}
fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if b
                .get(i + 1..i + 3)
                .is_some_and(|h| h.iter().all(u8::is_ascii_hexdigit)) =>
            {
                let h = std::str::from_utf8(&b[i + 1..i + 3]).expect("ascii hex");
                out.push(u8::from_str_radix(h, 16).expect("hex"));
                i += 3;
                continue;
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Node 16 `http.STATUS_CODES` for the statuses the final handler can answer here.
pub fn status_text(status: u16) -> &'static str {
    match status {
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        _ => "Internal Server Error",
    }
}

fn base(status: u16, body: Vec<u8>, head: bool) -> Response {
    let length = body.len();
    let mut response = Response::new(if head {
        HttpBody::empty()
    } else {
        HttpBody::from(body)
    });
    *response.status_mut() = StatusCode::from_u16(status).expect("legacy status");
    let h = response.headers_mut();
    h.insert("x-powered-by", HeaderValue::from_static("Express"));
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "content-length",
        HeaderValue::from_str(&length.to_string()).expect("ASCII length"),
    );
    response
}

/// `res.send(...)` or the final handler for a handler reply.
pub fn respond(reply: &Reply, method: &Method) -> Response {
    let head = *method == Method::HEAD;
    match reply {
        Reply::Json(bytes) => send(200, bytes.clone(), "application/json; charset=utf-8", head),
        Reply::Text(status, text) => send(
            *status,
            text.as_bytes().to_vec(),
            "text/html; charset=utf-8",
            head,
        ),
        Reply::Final(status) => final_handler(*status, head),
    }
}
fn send(status: u16, body: Vec<u8>, kind: &'static str, head: bool) -> Response {
    let tag = etag(&body);
    let mut r = base(status, body, head);
    let h = r.headers_mut();
    h.insert("content-type", HeaderValue::from_static(kind));
    h.insert("etag", HeaderValue::from_str(&tag).expect("ASCII etag"));
    r
}
/// `finalhandler` with `NODE_ENV=production`: the status text, `nosniff`, no ETag.
pub fn final_handler(status: u16, head: bool) -> Response {
    let body = format!("{}\n", status_text(status)).into_bytes();
    let mut r = base(status, body, head);
    let h = r.headers_mut();
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        "content-type",
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    r
}

/// Node joins repeated `accept-language` headers with `, ` and reads header bytes as latin1.
pub fn accept_language(headers: &HeaderMap) -> Option<String> {
    let values: Vec<String> = headers
        .get_all("accept-language")
        .iter()
        .map(|v| v.as_bytes().iter().map(|b| char::from(*b)).collect())
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decode_uri_rules() {
        assert!(decode_uri_ok("/v000902/push?a=%E2%82%AC"));
        assert!(!decode_uri_ok("/v000902/push?%E0%A4%A"));
        assert!(!decode_uri_ok("/x%zz"));
        assert!(!decode_uri_ok("/x%C0%80"));
        assert!(!decode_uri_ok("/x%ED%A0%80"));
    }
    #[test]
    fn mounts() {
        assert_eq!(mount("/V000902/PUSH/"), Some((Mount::Push, true)));
        assert_eq!(mount("/v000902/push-list"), Some((Mount::List, true)));
        assert_eq!(mount("/v000902/push/extra"), Some((Mount::Push, false)));
        assert_eq!(mount("/v000902/pushx"), None);
        assert_eq!(mount("/v000903/push"), None);
    }
    #[test]
    fn querystring_like_node() {
        let o = querystring("a=1&a=2&b=x+y&c=%zz&d");
        assert_eq!(
            Val::Obj(o).to_json(),
            br#"{"a":["1","2"],"b":"x y","c":"%zz","d":""}"#
        );
    }
}
