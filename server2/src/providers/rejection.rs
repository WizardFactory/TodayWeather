//! Code/status precedence ported from server/lib/dataGoKrRejection.js at 94019cf5
//! (#2604). Terminal03 provenance: collectTownForecast.js407–410 and
//! kmaWarningRequester.js80–98 at94019cf5. JSON gateway envelope: kmaWarningRequester.js
//! 88–91 and lifeIndexKmaRequester.js 1159–1165 at ca8735cf (S13). No runtime legacy reads.
use super::ResponseFormat;
use serde_json::Value;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    Quota,
    Auth,
    Rejected,
    Retryable,
    Data,
    NoData,
}
fn code(body: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?;
    let mut found: Option<(usize, String)> = None;
    for tag in ["returnReasonCode", "resultCode"] {
        let needle = format!("<{tag}>");
        if let Some(at) = text.find(&needle) {
            let rest = &text[at + needle.len()..];
            let digits = rest.trim_start();
            let n = digits.bytes().take_while(u8::is_ascii_digit).count();
            if n > 0
                && digits[n..].trim_start().starts_with('<')
                && found.as_ref().is_none_or(|(old, _)| at < *old)
            {
                found = Some((at, digits[..n].to_owned()));
            }
        }
    }
    if let Some((_, c)) = found {
        return Some(c);
    }
    let value: Value = serde_json::from_slice(body).ok()?;
    // The gateway also answers its envelope as JSON when dataType=JSON is requested
    // (legacy kmaWarningRequester.classify / lifeIndexKmaRequester.parseUvIdxV5).
    let header = value
        .get("response")
        .and_then(|r| r.get("header"))
        .or_else(|| gateway_json(&value))
        .unwrap_or(&value);
    for field in ["returnReasonCode", "resultCode"] {
        if let Some(v) = header.get(field) {
            return match v {
                Value::String(s) => Some(s.trim().into()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            };
        }
    }
    None
}
// Terminal outcomes require a complete recognized envelope, rather than a code
// embedded in malformed XML or an HTML page. Quota/auth keep legacy loose-code
// precedence through `code` above. This is not a full weather-schema validator.
fn terminal_code(body: &[u8]) -> Option<String> {
    use std::collections::BTreeSet;
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let text = std::str::from_utf8(body).ok()?;
    if !text.trim_start().starts_with('<') {
        let json: Value = serde_json::from_slice(body).ok()?;
        if let Some(header) = gateway_json(&json) {
            return header
                .get("returnReasonCode")
                .and_then(|v| match v {
                    Value::String(s) => Some(s.trim().to_owned()),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .filter(|c| !c.is_empty() && c.bytes().all(|b| b.is_ascii_digit()));
        }
        return json
            .get("response")?
            .get("header")?
            .get("resultCode")?
            .as_str()
            .map(|s| s.trim().to_owned());
    }
    let mut stack = Vec::new();
    let mut attributes = BTreeSet::new();
    let mut root_seen = false;
    let mut found = None;
    let mut code_elements = 0;
    for token in Tokenizer::from(text) {
        match token.ok()? {
            Token::ElementStart { prefix, local, .. } => {
                if matches!(
                    stack.as_slice(),
                    [(_, "response"), (_, "header"), (_, "resultCode")]
                        | [
                            (_, "OpenAPI_ServiceResponse"),
                            (_, "cmmMsgHeader"),
                            (_, "returnReasonCode")
                        ]
                ) {
                    return None; // A scalar result code cannot contain child elements.
                }
                if stack.is_empty() {
                    if root_seen
                        || !matches!(local.as_str(), "response" | "OpenAPI_ServiceResponse")
                    {
                        return None;
                    }
                    root_seen = true;
                }
                if stack.len() >= 32 {
                    return None;
                }
                stack.push((prefix.as_str(), local.as_str()));
                attributes.clear();
                if matches!(
                    stack.as_slice(),
                    [(_, "response"), (_, "header"), (_, "resultCode")]
                        | [
                            (_, "OpenAPI_ServiceResponse"),
                            (_, "cmmMsgHeader"),
                            (_, "returnReasonCode")
                        ]
                ) {
                    code_elements += 1;
                    if code_elements > 1 {
                        return None;
                    }
                }
            }
            Token::Attribute { prefix, local, .. } => {
                if attributes.len() >= 64 || !attributes.insert((prefix.as_str(), local.as_str())) {
                    return None;
                }
            }
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => (),
                ElementEnd::Empty => {
                    stack.pop()?;
                }
                ElementEnd::Close(prefix, local) => {
                    if stack.pop() != Some((prefix.as_str(), local.as_str())) {
                        return None;
                    }
                }
            },
            Token::Text { text } => {
                let value = text.as_str().trim();
                if stack.is_empty() && !value.is_empty() {
                    return None;
                }
                if matches!(
                    stack.as_slice(),
                    [(_, "response"), (_, "header"), (_, "resultCode")]
                        | [
                            (_, "OpenAPI_ServiceResponse"),
                            (_, "cmmMsgHeader"),
                            (_, "returnReasonCode")
                        ]
                ) && !value.is_empty()
                {
                    if found.is_some() || !value.bytes().all(|b| b.is_ascii_digit()) {
                        return None;
                    }
                    found = Some(value.to_owned());
                }
            }
            Token::DtdStart { .. }
            | Token::EmptyDtd { .. }
            | Token::EntityDeclaration { .. }
            | Token::DtdEnd { .. }
            | Token::Cdata { .. } => return None,
            _ => (),
        }
    }
    if !root_seen || !stack.is_empty() || code_elements != 1 {
        return None;
    }
    found
}
/// JSON-form gateway envelope `{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{...}}}`.
fn gateway_json(value: &Value) -> Option<&Value> {
    value
        .get("OpenAPI_ServiceResponse")?
        .get("cmmMsgHeader")
        .filter(|h| h.is_object())
}
const QUOTA_MARKER: &[u8] = b"LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR";
const EXPIRED_MARKER: &[u8] = b"DEADLINE_HAS_EXPIRED_ERROR";
const UNREGISTERED_MARKER: &[u8] = b"SERVICE_KEY_IS_NOT_REGISTERED_ERROR";
/// AirKorea body rejections (S13b), ported from legacy `airkoreaObservation.rejectionCode` and
/// `gatewayCode` at ae21b6cc. A 401/403 with the regular JSON envelope keeps that envelope's
/// code. Otherwise a 401/403, or a 200 body that is not JSON or is the JSON gateway envelope,
/// is read for a 1-3 digit code other than `00`, then for the gateway markers; a 401/403
/// without either rejects the key. `None` leaves the S13 precedence in charge.
fn airkorea_rejection(status: u16, body: &[u8], c: Option<&str>) -> Option<Disposition> {
    let rejection = matches!(status, 401 | 403);
    let json = serde_json::from_slice::<Value>(body).ok();
    let envelope = json
        .as_ref()
        .and_then(|v| v.get("response")?.get("header")?.get("resultCode"));
    let credential = |code: &str| match code {
        "20" | "30" | "31" | "32" => Disposition::Auth,
        "22" => Disposition::Quota,
        _ => Disposition::Rejected,
    };
    if rejection && envelope.is_some() {
        return Some(credential(c.unwrap_or("")));
    }
    let gateway_body = rejection
        || (status == 200
            && json
                .as_ref()
                .is_none_or(|v| v.get("OpenAPI_ServiceResponse").is_some()));
    if !gateway_body {
        return None;
    }
    let numeric = c.filter(|c| {
        (1..=3).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_digit()) && *c != "00"
    });
    if let Some(code) = numeric {
        // A 200 non-credential code keeps the S13 retry/rejection rules.
        return (rejection || credential(code) != Disposition::Rejected).then(|| credential(code));
    }
    let has = |m: &[u8]| body.windows(m.len()).any(|w| w == m);
    if has(EXPIRED_MARKER) || has(UNREGISTERED_MARKER) {
        return Some(Disposition::Auth);
    }
    if has(QUOTA_MARKER) {
        return Some(Disposition::Quota);
    }
    rejection.then_some(Disposition::Auth)
}
pub fn classify(status: u16, body: &[u8], data_go_kr: bool, valid: bool) -> Disposition {
    classify_format(status, body, data_go_kr, valid, ResponseFormat::DataType)
}
/// `classify` for a service with another declared response format (S13a): the same
/// precedence and success codes. For AirKorea (`ReturnType`, S13b) an HTTP 401/403 keeps an
/// explicit body code, as legacy `airkoreaObservation.rejectionCode` does at ae21b6cc: only a
/// credential code (20/30/31/32) or a body without a code rejects the key; quota still wins.
pub fn classify_format(
    status: u16,
    body: &[u8],
    data_go_kr: bool,
    valid: bool,
    format: ResponseFormat,
) -> Disposition {
    let c = if data_go_kr { code(body) } else { None };
    if status == 429 || c.as_deref() == Some("22") {
        return Disposition::Quota;
    }
    if format == ResponseFormat::ReturnType
        && data_go_kr
        && let Some(d) = airkorea_rejection(status, body, c.as_deref())
    {
        return d;
    }
    if matches!(status, 401 | 403) || matches!(c.as_deref(), Some("20" | "30" | "31" | "32")) {
        return Disposition::Auth;
    }
    if (400..500).contains(&status) {
        return Disposition::Rejected;
    }
    if (200..300).contains(&status) && data_go_kr {
        match terminal_code(body).as_deref() {
            Some("03") => return Disposition::NoData,
            Some("10" | "12") => return Disposition::Rejected,
            _ => (),
        }
    }
    if !(200..300).contains(&status) || body.is_empty() || !valid {
        return Disposition::Retryable;
    }
    if data_go_kr
        && (std::str::from_utf8(body).is_ok_and(|t| t.trim_start().starts_with('<'))
            || c.as_deref()
                .is_some_and(|c| !format.success_codes().contains(&c)))
    {
        return Disposition::Retryable;
    }
    Disposition::Data
}
