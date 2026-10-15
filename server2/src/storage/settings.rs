//! Operator S3 settings shared by the process runtime and the seed importers.
//!
//! S10e (AK, 2026-10-15): legacy `server/.env` names where legacy has the value.
//! `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` are the legacy `config.js` AWS credentials and
//! `TWA_S3_REGION` (default `ap-northeast-2`) the S3 region of the legacy environment. The
//! raw-record bucket is server2's own value, which legacy does not have: `SERVER2_S3_BUCKET`
//! in `server2/.env`. The endpoint is built in: the regional AWS endpoint
//! `https://s3.<region>.amazonaws.com/`, as the legacy AWS SDK selects it. Only tests choose
//! another endpoint, through [`S3Settings::from_vars_at`]. Every endpoint follows the transport
//! rule of [`HttpS3Transport`]: HTTPS, or plain HTTP only to a loopback address.
use super::{Error, HttpS3Transport};

/// Legacy credential names (`config.js` `keyString.aws_access_key` / `aws_secret_key`).
pub const ACCESS_KEY: &str = "AWS_ACCESS_KEY";
pub const SECRET_KEY: &str = "AWS_SECRET_KEY";
/// The server2 raw-record bucket (server2-only setting).
pub const BUCKET: &str = "SERVER2_S3_BUCKET";
/// Legacy S3 region name.
pub const REGION: &str = "TWA_S3_REGION";
/// Region when `TWA_S3_REGION` is unset (the server2 origin region).
pub const DEFAULT_REGION: &str = "ap-northeast-2";

/// Deliberately has no Debug: it holds credentials.
pub struct S3Settings {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    access_key_id: String,
    secret_access_key: String,
}
impl S3Settings {
    /// Read the settings through `var` with the production endpoint; a missing bucket or
    /// credential is `Invalid`.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, Error> {
        Self::from_vars_at(var, None)
    }
    /// [`S3Settings::from_vars`] with another endpoint (tests: a loopback S3 test peer). `None`
    /// is the production endpoint.
    pub fn from_vars_at(
        var: &dyn Fn(&str) -> Option<String>,
        endpoint: Option<&str>,
    ) -> Result<Self, Error> {
        let set = |name: &str| var(name).filter(|v| !v.is_empty());
        let need = |name: &'static str| set(name).ok_or(Error::Invalid(name));
        let region = set(REGION).unwrap_or_else(|| DEFAULT_REGION.into());
        let endpoint = endpoint
            .map(str::to_owned)
            .unwrap_or_else(|| format!("https://s3.{region}.amazonaws.com/"));
        let settings = Self {
            endpoint,
            region,
            bucket: need(BUCKET)?,
            access_key_id: need(ACCESS_KEY)?,
            secret_access_key: need(SECRET_KEY)?,
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
