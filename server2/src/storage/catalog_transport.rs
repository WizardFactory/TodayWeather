//! Bounded JSON control objects and raw-prefix discovery, separate from raw gzip I/O.
//! The caller owns operation deadlines, admission, JSON validation and XML CPU work.
use super::{Error, HttpS3Transport, ObjectTransport};
use base64::{Engine, engine::general_purpose::STANDARD};
use instant_xml::FromXml;
use md5::{Digest, Md5};
use reqwest::{Response, header::HeaderValue};
use rusty_s3::S3Action;
use std::{collections::BTreeSet, future::Future, time::Duration};

const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOKEN_BYTES: usize = 2048;
const S3_NAMESPACE: &str = "http://s3.amazonaws.com/doc/2006-03-01/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlObject {
    pub body: Vec<u8>,
    /// Opaque, quoted HTTP validator; never a content hash.
    pub etag: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteCondition {
    Absent,
    Match(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListPage {
    pub keys: Vec<String>,
    pub next: Option<String>,
}

/// No SDK retries, credential discovery or completion claims are added here.
pub trait CatalogTransport: ObjectTransport {
    fn get_control(
        &self,
        key: &str,
        maximum: usize,
    ) -> impl Future<Output = Result<ControlObject, Error>> + Send;
    fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> impl Future<Output = Result<u16, Error>> + Send;
    /// Return bounded XML; the caller schedules `decode_list` on its CPU pool.
    fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> impl Future<Output = Result<Vec<u8>, Error>> + Send;
}

fn owned_path(path: &str, allow_trailing: bool) -> bool {
    let path = if allow_trailing {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    !path.is_empty()
        && path.len() <= 1024
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.'))
        && path.split('/').all(|p| !matches!(p, "" | "." | ".."))
}

fn valid_etag(value: &str) -> bool {
    (2..=512).contains(&value.len())
        && value.starts_with('"')
        && value.ends_with('"')
        && value.as_bytes()[1..value.len() - 1]
            .iter()
            .all(|b| *b == 0x21 || (0x23..=0x7e).contains(b))
}

fn valid_token(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_TOKEN_BYTES
        && !value.chars().any(char::is_control)
}

fn maximum(bytes: usize) -> Result<(), Error> {
    if bytes == 0 || bytes > MAX_DOCUMENT_BYTES {
        return Err(Error::Invalid("control document limit"));
    }
    Ok(())
}

fn header<'a>(response: &'a Response, name: &str) -> Result<Option<&'a HeaderValue>, Error> {
    let mut values = response.headers().get_all(name).iter();
    let first = values.next();
    if values.next().is_some() {
        return Err(Error::Corrupt("duplicate control header"));
    }
    Ok(first)
}

fn response_length(response: &Response, kind: &str, cap: usize) -> Result<usize, Error> {
    let header_bytes: usize = response
        .headers()
        .iter()
        .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
        .sum();
    if header_bytes > 8192 || response.headers().contains_key("content-encoding") {
        return Err(Error::Corrupt("control header/encoding limit"));
    }
    let content_type = header(response, "content-type")?
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::Corrupt("control content type"))?;
    if content_type != kind && !(kind == "application/xml" && content_type == "text/xml") {
        return Err(Error::Corrupt("control content type"));
    }
    let length = header(response, "content-length")?
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or(Error::Corrupt("control content length"))?;
    if length > cap {
        return Err(Error::Corrupt("control document size"));
    }
    Ok(length)
}

async fn read_body(mut response: Response, length: usize, cap: usize) -> Result<Vec<u8>, Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
        if chunk.len() > cap.saturating_sub(body.len()) {
            return Err(Error::Corrupt("control stream size"));
        }
        body.extend_from_slice(&chunk);
    }
    if body.len() != length {
        return Err(Error::Corrupt("control stream length"));
    }
    Ok(body)
}

impl CatalogTransport for HttpS3Transport {
    async fn get_control(&self, key: &str, cap: usize) -> Result<ControlObject, Error> {
        maximum(cap)?;
        if !key.starts_with("index/v2/") || !owned_path(key, false) {
            return Err(Error::Invalid("control key"));
        }
        let credentials = self.credentials.snapshot().await?;
        let url = self
            .bucket
            .get_object(Some(&credentials), key)
            .sign(Duration::from_secs(30));
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        match response.status().as_u16() {
            404 => return Err(Error::NotFound),
            200 => (),
            status => return Err(Error::Status(status)),
        }
        let length = response_length(&response, "application/json", cap)?;
        let etag = header(&response, "etag")?
            .and_then(|v| v.to_str().ok())
            .filter(|v| valid_etag(v))
            .ok_or(Error::Corrupt("control etag"))?
            .to_owned();
        let version = header(&response, "x-amz-version-id")?
            .map(|v| {
                v.to_str()
                    .ok()
                    .filter(|v| {
                        !v.is_empty()
                            && v.len() <= 256
                            && v.bytes().all(|b| (0x21..=0x7e).contains(&b))
                    })
                    .map(str::to_owned)
                    .ok_or(Error::Corrupt("control version"))
            })
            .transpose()?;
        let body = read_body(response, length, cap).await?;
        Ok(ControlObject {
            body,
            etag,
            version,
        })
    }

    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        maximum(body.len())?;
        if !key.starts_with("index/v2/") || !owned_path(key, false) {
            return Err(Error::Invalid("control key"));
        }
        let (name, value) = match condition {
            WriteCondition::Absent => ("if-none-match", "*"),
            WriteCondition::Match(etag) if valid_etag(etag) => ("if-match", etag.as_str()),
            WriteCondition::Match(_) => return Err(Error::Invalid("control etag")),
        };
        let md5 = STANDARD.encode(Md5::digest(body));
        let credentials = self.credentials.snapshot().await?;
        let mut action = self.bucket.put_object(Some(&credentials), key);
        action.headers_mut().insert(name, value);
        action.headers_mut().insert("content-md5", md5.as_str());
        action
            .headers_mut()
            .insert("content-type", "application/json");
        let url = action.sign(Duration::from_secs(30));
        let response = self
            .client
            .put(url)
            .header(name, value)
            .header("content-md5", md5)
            .header("content-type", "application/json")
            .body(body.to_vec())
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        // Preserve exact status. The engine, not the adapter, reconciles CAS/unknown writes.
        Ok(response.status().as_u16())
    }

    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        cap: usize,
    ) -> Result<Vec<u8>, Error> {
        maximum(cap)?;
        if !prefix.starts_with("raw/v2/")
            || !owned_path(prefix, true)
            || prefix.len() > 1024
            || !(1..=1000).contains(&maximum_keys)
            || token.is_some_and(|t| !valid_token(t))
        {
            return Err(Error::Invalid("raw list arguments"));
        }
        let credentials = self.credentials.snapshot().await?;
        let mut action = self.bucket.list_objects_v2(Some(&credentials));
        // Owned raw keys are XML-safe ASCII; do not request URL-encoded response keys.
        action.query_mut().remove("encoding-type");
        action.with_prefix(prefix);
        action.with_max_keys(maximum_keys);
        if let Some(token) = token {
            action.with_continuation_token(token);
        }
        let url = action.sign(Duration::from_secs(30));
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        if response.status().as_u16() != 200 {
            return Err(Error::Status(response.status().as_u16()));
        }
        let length = response_length(&response, "application/xml", cap)?;
        read_body(response, length, cap).await
    }
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

// instant-xml returns after the first root. Validate the whole token stream first;
// xmlparser itself does not enforce matched tags or unique attributes.
fn complete_xml(text: &str) -> Result<(), Error> {
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let mut stack = Vec::new();
    let mut attributes = BTreeSet::new();
    let mut root_seen = false;
    for token in Tokenizer::from(text) {
        match token.map_err(|_| Error::Corrupt("raw list xml document"))? {
            Token::DtdStart { .. }
            | Token::EmptyDtd { .. }
            | Token::EntityDeclaration { .. }
            | Token::DtdEnd { .. } => return Err(Error::Corrupt("raw list dtd")),
            Token::ElementStart { prefix, local, .. } => {
                if stack.is_empty() {
                    if root_seen {
                        return Err(Error::Corrupt("raw list extra root"));
                    }
                    root_seen = true;
                }
                if stack.len() >= 32 {
                    return Err(Error::Corrupt("raw list xml depth"));
                }
                stack.push((prefix.as_str(), local.as_str()));
                attributes.clear();
            }
            Token::Attribute { prefix, local, .. } => {
                if attributes.len() >= 64 || !attributes.insert((prefix.as_str(), local.as_str())) {
                    return Err(Error::Corrupt("raw list xml attributes"));
                }
            }
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => (),
                ElementEnd::Empty => {
                    stack
                        .pop()
                        .ok_or(Error::Corrupt("raw list xml structure"))?;
                }
                ElementEnd::Close(prefix, local) => {
                    if stack.pop() != Some((prefix.as_str(), local.as_str())) {
                        return Err(Error::Corrupt("raw list xml structure"));
                    }
                }
            },
            _ => (),
        }
    }
    if !root_seen || !stack.is_empty() {
        return Err(Error::Corrupt("raw list incomplete xml"));
    }
    Ok(())
}

/// Bounded XML parsing for the caller's CPU pool; this function performs no I/O.
pub fn decode_list(bytes: &[u8], maximum_keys: usize) -> Result<ListPage, Error> {
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES || !(1..=1000).contains(&maximum_keys) {
        return Err(Error::Corrupt("raw list limits"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::Corrupt("raw list utf8"))?;
    complete_xml(text)?;
    let list: WireList = instant_xml::from_str(text).map_err(|_| Error::Corrupt("raw list xml"))?;
    if list.count != list.contents.len() || list.count > maximum_keys {
        return Err(Error::Corrupt("raw list key count"));
    }
    if list.truncated != list.next.is_some()
        || list.next.as_deref().is_some_and(|v| !valid_token(v))
        || (list.truncated && list.count == 0)
    {
        return Err(Error::Corrupt("raw list continuation"));
    }
    let mut seen = BTreeSet::new();
    let mut keys = Vec::with_capacity(list.count);
    for member in list.contents {
        if !member.key.starts_with("raw/v2/")
            || !owned_path(&member.key, false)
            || !seen.insert(member.key.clone())
        {
            return Err(Error::Corrupt("raw list key"));
        }
        keys.push(member.key);
    }
    Ok(ListPage {
        keys,
        next: list.next,
    })
}
