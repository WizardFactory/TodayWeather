//! Bounded demand-only JSON wire adapter for `state/demand/grid/`. No other prefix, no SDK
//! retries; the caller reconciles conditional-write conflicts.
use super::demand::{DemandError, DemandObject, DemandPage, DemandTransport, PREFIX, PUSH_BYTES};
use crate::storage::{
    CatalogTransport, Error as StorageError, HttpS3Transport, ListPage, WriteCondition,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use instant_xml::FromXml;
use md5::{Digest, Md5};
use reqwest::Response;
use rusty_s3::S3Action;
use std::{collections::BTreeSet, future::Future, time::Duration};

const HEADER_BYTES: usize = 8192;
const LIST_BYTES: usize = 2 * 1024 * 1024;
const S3_NAMESPACE: &str = "http://s3.amazonaws.com/doc/2006-03-01/";

fn segment_ok(path: &str) -> bool {
    path.split('/')
        .all(|s| !s.is_empty() && s != "." && s != "..")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.'))
}
fn key_ok(key: &str) -> bool {
    key.starts_with(PREFIX) && key.len() <= 256 && key.ends_with(".json") && segment_ok(key)
}
fn prefix_ok(prefix: &str) -> bool {
    prefix.starts_with(PREFIX)
        && prefix.len() <= 256
        && prefix.ends_with('/')
        && segment_ok(prefix.trim_end_matches('/'))
}
fn etag_ok(s: &str) -> bool {
    (2..=512).contains(&s.len())
        && s.starts_with('"')
        && s.ends_with('"')
        && s.as_bytes()[1..s.len() - 1]
            .iter()
            .all(|b| *b == 0x21 || (0x23..=0x7e).contains(b))
}
fn token_ok(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control)
}
/// Single-valued, bounded headers without content encoding; returns the declared length.
fn headers(response: &Response, cap: usize) -> Result<Option<usize>, DemandError> {
    let h = response.headers();
    if h.iter()
        .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
        .sum::<usize>()
        > HEADER_BYTES
        || h.contains_key("content-encoding")
    {
        return Err(DemandError::Corrupt("demand headers"));
    }
    for name in ["etag", "content-type", "content-length"] {
        if h.get_all(name).iter().count() > 1 {
            return Err(DemandError::Corrupt("duplicate demand header"));
        }
    }
    let length = h
        .get("content-length")
        .map(|v| {
            v.to_str()
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or(DemandError::Corrupt("demand length"))
        })
        .transpose()?;
    if length.is_some_and(|n| n > cap) {
        return Err(DemandError::Corrupt("demand size"));
    }
    Ok(length)
}
async fn body(
    mut response: Response,
    length: Option<usize>,
    cap: usize,
) -> Result<Vec<u8>, DemandError> {
    let mut out = Vec::with_capacity(length.unwrap_or(0));
    while let Some(chunk) = response.chunk().await.map_err(|_| DemandError::Transport)? {
        if chunk.len() > cap.saturating_sub(out.len()) {
            return Err(DemandError::Corrupt("demand stream size"));
        }
        out.extend_from_slice(&chunk);
    }
    if length.is_some_and(|n| n != out.len()) {
        return Err(DemandError::Corrupt("demand length mismatch"));
    }
    Ok(out)
}

#[derive(FromXml)]
#[xml(rename = "ListBucketResult", ns(S3_NAMESPACE))]
struct WireList {
    #[xml(rename = "IsTruncated")]
    truncated: bool,
    #[xml(rename = "KeyCount")]
    count: usize,
    #[xml(rename = "NextContinuationToken")]
    next: Option<String>,
    contents: Vec<WireContent>,
}
#[derive(FromXml)]
#[xml(rename = "Contents", ns(S3_NAMESPACE))]
struct WireContent {
    #[xml(rename = "Key")]
    key: String,
}
/// Well-formedness first: instant-xml stops after the first root element.
fn well_formed(text: &str) -> bool {
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let mut stack = Vec::new();
    let mut root = false;
    for token in Tokenizer::from(text) {
        match token {
            Err(_) => return false,
            Ok(
                Token::DtdStart { .. } | Token::EmptyDtd { .. } | Token::EntityDeclaration { .. },
            ) => {
                return false;
            }
            Ok(Token::ElementStart { prefix, local, .. }) => {
                if stack.is_empty() {
                    if root {
                        return false;
                    }
                    root = true;
                }
                if stack.len() >= 16 {
                    return false;
                }
                stack.push((prefix.as_str(), local.as_str()));
            }
            Ok(Token::ElementEnd { end, .. }) => match end {
                ElementEnd::Open => {}
                ElementEnd::Empty => {
                    if stack.pop().is_none() {
                        return false;
                    }
                }
                ElementEnd::Close(prefix, local) => {
                    if stack.pop() != Some((prefix.as_str(), local.as_str())) {
                        return false;
                    }
                }
            },
            Ok(_) => {}
        }
    }
    root && stack.is_empty()
}
/// Keys of one bounded LIST page; every key must start with `prefix` and pass `valid`.
fn decode_keys(
    bytes: &[u8],
    prefix: &str,
    valid: impl Fn(&str) -> bool,
) -> Option<(Vec<String>, Option<String>)> {
    let text = std::str::from_utf8(bytes).ok()?;
    if !well_formed(text) {
        return None;
    }
    let list: WireList = instant_xml::from_str(text).ok()?;
    if list.count != list.contents.len()
        || list.count > 1000
        || list.truncated != list.next.is_some()
        || list.next.as_deref().is_some_and(|t| !token_ok(t))
    {
        return None;
    }
    let mut seen = BTreeSet::new();
    let mut keys = Vec::with_capacity(list.count);
    for c in list.contents {
        if !c.key.starts_with(prefix) || !valid(&c.key) || !seen.insert(c.key.clone()) {
            return None;
        }
        keys.push(c.key);
    }
    Some((keys, list.next))
}
pub(crate) fn decode_page(bytes: &[u8], prefix: &str) -> Result<DemandPage, DemandError> {
    decode_keys(bytes, prefix, key_ok)
        .map(|(keys, next)| DemandPage { keys, next })
        .ok_or(DemandError::Corrupt("demand list"))
}
/// One bounded ListObjectsV2 page body; the caller validates the prefix and decodes.
async fn list_page(
    t: &HttpS3Transport,
    prefix: &str,
    token: Option<&str>,
) -> Result<Vec<u8>, DemandError> {
    let credentials = t
        .credentials
        .snapshot()
        .await
        .map_err(|_| DemandError::Transport)?;
    let mut action = t.bucket.list_objects_v2(Some(&credentials));
    action.query_mut().remove("encoding-type");
    action.with_prefix(prefix);
    action.with_max_keys(1000);
    if let Some(token) = token {
        action.with_continuation_token(token);
    }
    let url = action.sign(Duration::from_secs(30));
    let response = t
        .client
        .get(url)
        .send()
        .await
        .map_err(|_| DemandError::Transport)?;
    if response.status().as_u16() != 200 {
        return Err(DemandError::Status(response.status().as_u16()));
    }
    let length = headers(&response, LIST_BYTES)?;
    body(response, length, LIST_BYTES).await
}

/// Bounded listing of published catalog keys (`index/v2/...`). Catalog objects are written only
/// by S06 publication or repair, so a listed catalog names a published identity set.
pub trait IndexListing: CatalogTransport {
    fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> impl Future<Output = Result<ListPage, StorageError>> + Send;
}
fn index_key_ok(key: &str) -> bool {
    key.starts_with("index/v2/") && key.len() <= 1024 && key.ends_with(".json") && segment_ok(key)
}
impl IndexListing for HttpS3Transport {
    async fn list_index(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<ListPage, StorageError> {
        if !prefix.starts_with("index/v2/")
            || prefix.len() > 1024
            || !segment_ok(prefix.trim_end_matches('/'))
            || token.is_some_and(|t| !token_ok(t))
        {
            return Err(StorageError::Invalid("index list arguments"));
        }
        let bytes = list_page(self, prefix, token).await.map_err(|e| match e {
            DemandError::Status(s) => StorageError::Status(s),
            DemandError::Transport => StorageError::Transport,
            _ => StorageError::Corrupt("index list"),
        })?;
        decode_keys(&bytes, prefix, index_key_ok)
            .map(|(keys, next)| ListPage { keys, next })
            .ok_or(StorageError::Corrupt("index list"))
    }
}

impl DemandTransport for HttpS3Transport {
    async fn get_demand(&self, key: &str) -> Result<Option<DemandObject>, DemandError> {
        if !key_ok(key) {
            return Err(DemandError::Invalid("demand key"));
        }
        let credentials = self
            .credentials
            .snapshot()
            .await
            .map_err(|_| DemandError::Transport)?;
        let url = self
            .bucket
            .get_object(Some(&credentials), key)
            .sign(Duration::from_secs(30));
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| DemandError::Transport)?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(None),
            s => return Err(DemandError::Status(s)),
        }
        let length = headers(&response, PUSH_BYTES)?;
        let h = response.headers();
        if h.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/json") {
            return Err(DemandError::Corrupt("demand content type"));
        }
        let etag = h
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .filter(|v| etag_ok(v))
            .ok_or(DemandError::Corrupt("demand etag"))?
            .to_owned();
        let body = body(response, length, PUSH_BYTES).await?;
        Ok(Some(DemandObject { body, etag }))
    }
    async fn put_demand(
        &self,
        key: &str,
        payload: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, DemandError> {
        if !key_ok(key) || payload.is_empty() || payload.len() > PUSH_BYTES {
            return Err(DemandError::Invalid("demand document"));
        }
        let (name, value) = match condition {
            WriteCondition::Absent => ("if-none-match", "*"),
            WriteCondition::Match(v) if etag_ok(v) => ("if-match", v.as_str()),
            WriteCondition::Match(_) => return Err(DemandError::Invalid("demand etag")),
        };
        let credentials = self
            .credentials
            .snapshot()
            .await
            .map_err(|_| DemandError::Transport)?;
        let digest = STANDARD.encode(Md5::digest(payload));
        let mut action = self.bucket.put_object(Some(&credentials), key);
        action.headers_mut().insert(name, value);
        action.headers_mut().insert("content-md5", digest.as_str());
        action
            .headers_mut()
            .insert("content-type", "application/json");
        let url = action.sign(Duration::from_secs(30));
        let response = self
            .client
            .put(url)
            .header(name, value)
            .header("content-md5", digest)
            .header("content-type", "application/json")
            .body(payload.to_vec())
            .send()
            .await
            .map_err(|_| DemandError::Transport)?;
        let status = response.status().as_u16();
        if status == 200 {
            // A truncated acknowledgment is an unknown outcome; the caller re-reads.
            let length = headers(&response, HEADER_BYTES)?;
            body(response, length, HEADER_BYTES).await?;
        }
        Ok(status)
    }
    async fn list_demand(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> Result<DemandPage, DemandError> {
        if !prefix_ok(prefix) || token.is_some_and(|t| !token_ok(t)) {
            return Err(DemandError::Invalid("demand list arguments"));
        }
        let bytes = list_page(self, prefix, token).await?;
        decode_page(&bytes, prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_and_pages_stay_under_the_demand_prefix() {
        assert!(key_ok("state/demand/grid/request/060-127.json"));
        assert!(key_ok("state/demand/grid/push.json"));
        assert!(!key_ok("state/demand/push.json"));
        assert!(!key_ok("index/v2/x.json"));
        assert!(!key_ok("state/demand/grid/../x.json"));
        assert!(!key_ok("state/demand/grid/request/060-127"));
        assert!(prefix_ok("state/demand/grid/request/"));
        assert!(!prefix_ok("raw/v2/"));
        let xml = |keys: &[&str], truncated: bool| {
            let contents: String = keys
                .iter()
                .map(|k| format!("<Contents><Key>{k}</Key><Size>1</Size></Contents>"))
                .collect();
            let next = if truncated {
                "<NextContinuationToken>abc</NextContinuationToken>"
            } else {
                ""
            };
            format!(
                r#"<ListBucketResult xmlns="{S3_NAMESPACE}"><IsTruncated>{truncated}</IsTruncated><KeyCount>{}</KeyCount>{next}{contents}</ListBucketResult>"#,
                keys.len()
            )
        };
        let page = decode_page(
            xml(&["state/demand/grid/request/060-127.json"], true).as_bytes(),
            "state/demand/grid/request/",
        )
        .unwrap();
        assert_eq!(page.keys.len(), 1);
        assert_eq!(page.next.as_deref(), Some("abc"));
        assert!(
            decode_page(
                xml(&["raw/v2/x"], false).as_bytes(),
                "state/demand/grid/request/"
            )
            .is_err()
        );
        assert!(decode_page(b"<broken>", "state/demand/grid/request/").is_err());
    }
}
