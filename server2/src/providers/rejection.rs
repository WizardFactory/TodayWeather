//! Code/status precedence ported from server/lib/dataGoKrRejection.js at 94019cf5
//! (#2604). No runtime legacy reads. JSON result codes supplement the JSON request path.
use serde_json::Value;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    Quota,
    Auth,
    Rejected,
    Retryable,
    Data,
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
    let header = value
        .get("response")
        .and_then(|r| r.get("header"))
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
pub fn classify(status: u16, body: &[u8], data_go_kr: bool, valid: bool) -> Disposition {
    let c = if data_go_kr { code(body) } else { None };
    if status == 429 || c.as_deref() == Some("22") {
        return Disposition::Quota;
    }
    if matches!(status, 401 | 403) || matches!(c.as_deref(), Some("20" | "30" | "31" | "32")) {
        return Disposition::Auth;
    }
    if (400..500).contains(&status) {
        return Disposition::Rejected;
    }
    if !(200..300).contains(&status) || body.is_empty() || !valid {
        return Disposition::Retryable;
    }
    if data_go_kr
        && (std::str::from_utf8(body).is_ok_and(|t| t.trim_start().starts_with('<'))
            || c.as_deref().is_some_and(|c| !matches!(c, "0" | "00")))
    {
        return Disposition::Retryable;
    }
    Disposition::Data
}
