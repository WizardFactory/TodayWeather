//! Optional bounded S3 address projections. No reverse-geocode persistence API.
use super::{AddressProjection, AddressStore, GeocodeError};
use crate::observability::ObservedHttp as _;
use crate::storage::HttpS3Transport;
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest as _, Md5};
use rusty_s3::S3Action;
use sha2::Sha256;
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const CAP: usize = 16 * 1024;
pub struct S3AddressStore {
    transport: Arc<HttpS3Transport>,
}
impl S3AddressStore {
    pub fn new(transport: Arc<HttpS3Transport>) -> Self {
        Self { transport }
    }
    fn key(address: &str) -> Result<String, GeocodeError> {
        if address.is_empty()
            || address.encode_utf16().count() > 200
            || !address.chars().any(char::is_alphabetic)
            || address.chars().any(char::is_control)
        {
            return Err(GeocodeError::Provider);
        }
        Ok(format!(
            "geocode/address/v1/{:x}.json",
            Sha256::digest(address.as_bytes())
        ))
    }
    fn valid(address: &str, p: &AddressProjection) -> bool {
        let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else {
            return false;
        };
        let now = now.as_millis().min(u64::MAX as u128) as u64;
        p.valid(now) && p.geo.address.as_deref() == Some(address)
    }
    async fn read_bytes(&self, key: &str) -> Result<Option<Vec<u8>>, GeocodeError> {
        let credentials = self
            .transport
            .credentials
            .snapshot()
            .await
            .map_err(|_| GeocodeError::Provider)?;
        let url = self
            .transport
            .bucket
            .get_object(Some(&credentials), key)
            .sign(Duration::from_secs(30));
        let mut response = self
            .transport
            .client
            .get(url)
            .send()
            .observed(crate::observability::Component::Geocode)
            .await
            .map_err(|_| GeocodeError::Provider)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        let h = response.headers();
        if response.status().as_u16() != 200
            || h.iter()
                .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                .sum::<usize>()
                > 8192
            || h.contains_key("content-encoding")
            || h.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/json")
            || ["content-type", "content-length"]
                .iter()
                .any(|k| h.get_all(*k).iter().count() > 1)
        {
            return Err(GeocodeError::Provider);
        }
        let length = h
            .get("content-length")
            .map(|v| {
                v.to_str()
                    .ok()
                    .and_then(|v| v.parse::<usize>().ok())
                    .ok_or(GeocodeError::Provider)
            })
            .transpose()?;
        if length.is_some_and(|n| n > CAP) {
            return Err(GeocodeError::Provider);
        }
        let mut bytes = Vec::with_capacity(length.unwrap_or(0));
        while let Some(chunk) = response.chunk().await.map_err(|_| GeocodeError::Provider)? {
            if chunk.len() > CAP.saturating_sub(bytes.len()) {
                return Err(GeocodeError::Provider);
            }
            bytes.extend_from_slice(&chunk);
        }
        if length.is_some_and(|n| n != bytes.len()) {
            return Err(GeocodeError::Provider);
        }
        Ok(Some(bytes))
    }
}
impl AddressStore for S3AddressStore {
    fn get<'a>(
        &'a self,
        address: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<AddressProjection>, GeocodeError>> + Send + 'a>>
    {
        let address = address.to_owned();
        Box::pin(async move {
            let key = Self::key(&address)?;
            let Some(bytes) = self.read_bytes(&key).await? else {
                return Ok(None);
            };
            let Ok(p) = serde_json::from_slice::<AddressProjection>(&bytes) else {
                return Ok(None);
            };
            Ok(Self::valid(&address, &p).then_some(p))
        })
    }
    fn put<'a>(
        &'a self,
        address: &'a str,
        projection: &'a AddressProjection,
    ) -> Pin<Box<dyn Future<Output = Result<(), GeocodeError>> + Send + 'a>> {
        let address = address.to_owned();
        let projection = projection.clone();
        Box::pin(async move {
            let key = Self::key(&address)?;
            if !Self::valid(&address, &projection) {
                return Err(GeocodeError::Provider);
            }
            let bytes = serde_json::to_vec(&projection).map_err(|_| GeocodeError::Provider)?;
            if bytes.len() > CAP {
                return Err(GeocodeError::Provider);
            }
            let credentials = self
                .transport
                .credentials
                .signing()
                .await
                .map_err(|_| GeocodeError::Provider)?;
            let digest = STANDARD.encode(Md5::digest(&bytes));
            let mut action = self.transport.bucket.put_object(Some(&credentials), &key);
            action
                .headers_mut()
                .insert("content-type", "application/json");
            action.headers_mut().insert("content-md5", &digest);
            let url = action.sign(Duration::from_secs(30));
            let mut response = self
                .transport
                .client
                .put(url)
                .header("content-type", "application/json")
                .header("content-md5", digest)
                .body(bytes.clone())
                .send()
                .observed(crate::observability::Component::Geocode)
                .await
                .map_err(|_| GeocodeError::Provider)?;
            if response.status().as_u16() != 200 {
                return Err(GeocodeError::Provider);
            }
            let h = response.headers();
            if h.iter()
                .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                .sum::<usize>()
                > 8192
                || h.contains_key("content-encoding")
                || h.get_all("content-length").iter().count() > 1
                || h.get("content-length").is_some_and(|v| {
                    v.to_str()
                        .ok()
                        .and_then(|v| v.parse::<usize>().ok())
                        .is_none_or(|n| n > 8192)
                })
            {
                return Err(GeocodeError::Provider);
            }
            let mut ack = 0usize;
            while let Some(c) = response.chunk().await.map_err(|_| GeocodeError::Provider)? {
                ack = ack
                    .checked_add(c.len())
                    .filter(|n| *n <= 8192)
                    .ok_or(GeocodeError::Provider)?;
            }
            // Exact independent readback establishes this complete projection, without a catalog pointer.
            if self.read_bytes(&key).await?.as_deref() != Some(bytes.as_slice()) {
                return Err(GeocodeError::Provider);
            }
            Ok(())
        })
    }
}
