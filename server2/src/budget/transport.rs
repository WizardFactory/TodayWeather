//! Bounded budget-only JSON wire adapter. No raw/catalog prefix extension or SDK retries.
use super::BudgetError;
use crate::storage::{HttpS3Transport, WriteCondition};
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use rusty_s3::S3Action;
use std::{future::Future, time::Duration};
const CAP: usize = 4096;
#[derive(Debug)]
pub struct BudgetObject {
    pub body: Vec<u8>,
    pub etag: String,
}
pub trait BudgetTransport: Send + Sync {
    fn get_budget(
        &self,
        key: &str,
    ) -> impl Future<Output = Result<BudgetObject, BudgetError>> + Send;
    fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> impl Future<Output = Result<u16, BudgetError>> + Send;
}
fn key_valid(key: &str) -> bool {
    key.starts_with("budgets/v2/")
        && key.len() <= 256
        && key.ends_with(".json")
        && key
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.'))
}
fn etag_valid(s: &str) -> bool {
    (2..=512).contains(&s.len())
        && s.starts_with('"')
        && s.ends_with('"')
        && s.as_bytes()[1..s.len() - 1]
            .iter()
            .all(|b| *b == 0x21 || (0x23..=0x7e).contains(b))
}
impl BudgetTransport for HttpS3Transport {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        if !key_valid(key) {
            return Err(BudgetError::Invalid("budget key"));
        }
        let credentials = self
            .credentials
            .snapshot()
            .await
            .map_err(|_| BudgetError::Transport)?;
        let url = self
            .bucket
            .get_object(Some(&credentials), key)
            .sign(Duration::from_secs(30));
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| BudgetError::Transport)?;
        match response.status().as_u16() {
            200 => (),
            404 => return Err(BudgetError::NotFound),
            s => return Err(BudgetError::Status(s)),
        }
        let h = response.headers();
        if h.iter()
            .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
            .sum::<usize>()
            > 8192
            || h.contains_key("content-encoding")
        {
            return Err(BudgetError::Corrupt("budget headers"));
        }
        for name in ["etag", "content-type", "content-length"] {
            if h.get_all(name).iter().count() > 1 {
                return Err(BudgetError::Corrupt("duplicate budget header"));
            }
        }
        if h.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/json") {
            return Err(BudgetError::Corrupt("budget type"));
        }
        let etag = h
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .filter(|v| etag_valid(v))
            .ok_or(BudgetError::Corrupt("budget etag"))?
            .to_owned();
        let length = h
            .get("content-length")
            .map(|v| {
                v.to_str()
                    .ok()
                    .and_then(|s| s.parse::<usize>().ok())
                    .ok_or(BudgetError::Corrupt("budget length"))
            })
            .transpose()?;
        if length.is_some_and(|n| n > CAP) {
            return Err(BudgetError::Corrupt("budget size"));
        }
        let mut body = Vec::with_capacity(length.unwrap_or(0));
        while let Some(chunk) = response.chunk().await.map_err(|_| BudgetError::Transport)? {
            if chunk.len() > CAP.saturating_sub(body.len()) {
                return Err(BudgetError::Corrupt("budget stream size"));
            }
            body.extend_from_slice(&chunk);
        }
        if length.is_some_and(|n| n != body.len()) {
            return Err(BudgetError::Corrupt("budget length mismatch"));
        }
        Ok(BudgetObject { body, etag })
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        if !key_valid(key) || body.is_empty() || body.len() > CAP {
            return Err(BudgetError::Invalid("budget document"));
        }
        let (name, value) = match condition {
            WriteCondition::Absent => ("if-none-match", "*"),
            WriteCondition::Match(v) if etag_valid(v) => ("if-match", v.as_str()),
            _ => return Err(BudgetError::Invalid("budget etag")),
        };
        let credentials = self
            .credentials
            .snapshot()
            .await
            .map_err(|_| BudgetError::Transport)?;
        let digest = STANDARD.encode(Md5::digest(body));
        let mut action = self.bucket.put_object(Some(&credentials), key);
        action.headers_mut().insert(name, value);
        action.headers_mut().insert("content-md5", digest.as_str());
        action
            .headers_mut()
            .insert("content-type", "application/json");
        let url = action.sign(Duration::from_secs(30));
        let mut response = self
            .client
            .put(url)
            .header(name, value)
            .header("content-md5", digest)
            .header("content-type", "application/json")
            .body(body.to_vec())
            .send()
            .await
            .map_err(|_| BudgetError::Transport)?;
        let status = response.status().as_u16();
        if status == 200 {
            // A header-only success with a truncated acknowledgment is still an
            // unknown write outcome. Bound and fully consume the response first.
            let h = response.headers();
            if h.iter()
                .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                .sum::<usize>()
                > 8192
                || h.contains_key("content-encoding")
                || h.get_all("content-length").iter().count() > 1
            {
                return Err(BudgetError::Corrupt("budget acknowledgment headers"));
            }
            let length = h
                .get("content-length")
                .map(|v| {
                    v.to_str()
                        .ok()
                        .and_then(|s| s.parse::<usize>().ok())
                        .ok_or(BudgetError::Corrupt("budget acknowledgment length"))
                })
                .transpose()?;
            if length.is_some_and(|n| n > 8192) {
                return Err(BudgetError::Corrupt("budget acknowledgment size"));
            }
            let mut observed = 0usize;
            while let Some(chunk) = response.chunk().await.map_err(|_| BudgetError::Transport)? {
                if chunk.len() > 8192usize.saturating_sub(observed) {
                    return Err(BudgetError::Corrupt("budget acknowledgment stream"));
                }
                observed += chunk.len();
            }
            if length.is_some_and(|n| n != observed) {
                return Err(BudgetError::Corrupt("budget acknowledgment incomplete"));
            }
        }
        Ok(status)
    }
}
