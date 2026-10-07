//! Code/status precedence ported from server/lib/dataGoKrRejection.js at 94019cf5
//! (#2604). Terminal03 provenance: collectTownForecast.js407–410 and
//! kmaWarningRequester.js80–98 at94019cf5. No runtime legacy reads.
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
// Terminal outcomes require a complete recognized envelope, rather than a code
// embedded in malformed XML or an HTML page. Quota/auth keep legacy loose-code
// precedence through `code` above. This is not a full weather-schema validator.
fn terminal_code(body: &[u8]) -> Option<String> {
    use std::collections::BTreeSet;
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let text = std::str::from_utf8(body).ok()?;
    if !text.trim_start().starts_with('<') {
        let json: Value = serde_json::from_slice(body).ok()?;
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
            || c.as_deref().is_some_and(|c| !matches!(c, "0" | "00")))
    {
        return Disposition::Retryable;
    }
    Disposition::Data
}
