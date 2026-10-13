//! Operator S3 settings shared by the process runtime and the seed importers.
//!
//! `SERVER2_S3_REGION` (default `ap-northeast-2`), `SERVER2_S3_ENDPOINT` (default the regional
//! AWS endpoint), `SERVER2_S3_BUCKET`, `SERVER2_S3_ACCESS_KEY_ID` and
//! `SERVER2_S3_SECRET_ACCESS_KEY`. The endpoint follows the transport rule of
//! [`HttpS3Transport`]: HTTPS, or plain HTTP only to a loopback address.
use super::{Error, HttpS3Transport};

/// Deliberately has no Debug: it holds credentials.
pub struct S3Settings {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    access_key_id: String,
    secret_access_key: String,
}
impl S3Settings {
    /// Read the settings through `var`; a missing bucket or credential is `Invalid`.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let set = |name: &str| var(name).filter(|v| !v.is_empty());
        let need = |name: &'static str| set(name).ok_or(Error::Invalid(name));
        let region = set("SERVER2_S3_REGION").unwrap_or_else(|| "ap-northeast-2".into());
        let endpoint = set("SERVER2_S3_ENDPOINT")
            .unwrap_or_else(|| format!("https://s3.{region}.amazonaws.com/"));
        let settings = Self {
            endpoint,
            region,
            bucket: need("SERVER2_S3_BUCKET")?,
            access_key_id: need("SERVER2_S3_ACCESS_KEY_ID")?,
            secret_access_key: need("SERVER2_S3_SECRET_ACCESS_KEY")?,
        };
        // Validate endpoint, bucket and region once, before any caller depends on them.
        settings.transport()?;
        Ok(settings)
    }
    /// A new SigV4 transport for these settings.
    pub fn transport(&self) -> Result<HttpS3Transport, Error> {
        HttpS3Transport::new(
            &self.endpoint,
            &self.bucket,
            &self.region,
            rusty_s3::Credentials::new(&self.access_key_id, &self.secret_access_key),
        )
    }
}
