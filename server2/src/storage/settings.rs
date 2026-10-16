//! Operator S3 settings shared by the process runtime and the seed importers.
//!
//! S10e (AK, 2026-10-15): legacy `server/.env` names where legacy has the value, server2-only
//! names for values legacy does not have. `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` are the legacy
//! `config.js` AWS credentials. The bucket and its region are server2's own values:
//! `SERVER2_S3_BUCKET` and `SERVER2_S3_REGION` (default `ap-northeast-2`) in `server2/.env`.
//!
//! S10f (#2759, AK 2026-10-15): the legacy `TWA_S3_REGION` names the region of the unrelated
//! 2018 bucket `twa-weather-data` and is not read. When both AWS keys are unset (absent, empty or
//! the legacy `config.js` placeholder [`PLACEHOLDER`]) the credentials come from the EC2
//! instance role through IMDSv2 ([`super::credentials`]); real static keys are still used as
//! configured. One real key without the other is a configuration error.
//!
//! The endpoints are built in: the regional AWS endpoint `https://s3.<region>.amazonaws.com/`, as
//! the legacy AWS SDK selects it, and the EC2 instance metadata root. Only tests choose other
//! ones, through [`S3Settings::from_vars_at`] and [`S3Settings::from_vars_with`]. Every S3 endpoint
//! follows the transport rule of [`HttpS3Transport`]: HTTPS, or plain HTTP only to a loopback
//! address; a test metadata root is plain HTTP to a loopback address.
use super::credentials::{InstanceRole, METADATA_ROOT, loopback_root};
use super::{Error, HttpS3Transport, RefreshableCredentials};

/// Legacy credential names (`config.js` `keyString.aws_access_key` / `aws_secret_key`).
pub const ACCESS_KEY: &str = "AWS_ACCESS_KEY";
pub const SECRET_KEY: &str = "AWS_SECRET_KEY";
/// The legacy `config.js` default of both credential names: no key is configured.
pub const PLACEHOLDER: &str = "You have to set key of AWS";
/// The server2 raw-record bucket (server2-only setting).
pub const BUCKET: &str = "SERVER2_S3_BUCKET";
/// The region of the server2 bucket (server2-only setting).
pub const REGION: &str = "SERVER2_S3_REGION";
/// Region when `SERVER2_S3_REGION` is unset (the server2 origin region).
pub const DEFAULT_REGION: &str = "ap-northeast-2";

/// Deliberately has no Debug: it can hold credentials.
enum Credentials {
    Static {
        access_key_id: String,
        secret_access_key: String,
    },
    InstanceRole {
        metadata_root: String,
    },
}

/// Deliberately has no Debug: it can hold credentials.
pub struct S3Settings {
    local_cache: Option<(std::path::PathBuf, u64)>,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    credentials: Credentials,
}
impl S3Settings {
    /// Read the settings through `var` with the production endpoints; a missing bucket or one
    /// real key without the other is `Invalid`.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, Error> {
        Self::from_vars_with(var, None, None)
    }
    /// [`S3Settings::from_vars`] with another S3 endpoint (tests: a loopback S3 test peer).
    /// `None` is the production endpoint.
    pub fn from_vars_at(
        var: &dyn Fn(&str) -> Option<String>,
        endpoint: Option<&str>,
    ) -> Result<Self, Error> {
        Self::from_vars_with(var, endpoint, None)
    }
    /// [`S3Settings::from_vars_at`] with another instance metadata root (tests: a loopback IMDS
    /// double). `None` is the EC2 instance metadata service.
    pub fn from_vars_with(
        var: &dyn Fn(&str) -> Option<String>,
        endpoint: Option<&str>,
        metadata: Option<&str>,
    ) -> Result<Self, Error> {
        let set = |name: &str| var(name).filter(|v| !v.is_empty());
        let key = |name: &str| set(name).filter(|v| v != PLACEHOLDER);
        let region = set(REGION).unwrap_or_else(|| DEFAULT_REGION.into());
        let endpoint = endpoint
            .map(str::to_owned)
            .unwrap_or_else(|| format!("https://s3.{region}.amazonaws.com/"));
        let metadata_root = match metadata {
            Some(root) if loopback_root(root) => root.to_owned(),
            Some(_) => return Err(Error::Invalid("instance metadata root")),
            None => METADATA_ROOT.to_owned(),
        };
        let credentials = match (key(ACCESS_KEY), key(SECRET_KEY)) {
            (Some(access_key_id), Some(secret_access_key)) => Credentials::Static {
                access_key_id,
                secret_access_key,
            },
            (None, None) => Credentials::InstanceRole { metadata_root },
            (Some(_), None) => return Err(Error::Invalid(SECRET_KEY)),
            (None, Some(_)) => return Err(Error::Invalid(ACCESS_KEY)),
        };
        let cache_dir = set("SERVER2_LOCAL_CACHE_DIR");
        let cache_bytes = set("SERVER2_LOCAL_CACHE_MAX_BYTES");
        let local_cache = match (cache_dir, cache_bytes) {
            (None, None) => None,
            (None, Some(_)) => return Err(Error::Invalid("local cache directory")),
            (Some(dir), bytes) => {
                let bytes = bytes
                    .map(|b| {
                        b.parse::<u64>()
                            .map_err(|_| Error::Invalid("local cache bytes"))
                    })
                    .transpose()?
                    .unwrap_or(crate::cache::disk::DEFAULT_MAX_BYTES);
                // Pure validation; no local filesystem I/O during settings parsing.
                crate::cache::disk::DiskCache::new(&dir, "validation", bytes, 131_072)?;
                Some((dir.into(), bytes))
            }
        };
        let settings = Self {
            local_cache,
            endpoint,
            region,
            bucket: set(BUCKET).ok_or(Error::Invalid(BUCKET))?,
            credentials,
        };
        // Validate endpoint, bucket and region once, before any caller depends on them.
        settings.transport()?;
        Ok(settings)
    }
    /// Whether S3 requests are signed with EC2 instance-role credentials (no static keys).
    pub fn uses_instance_role(&self) -> bool {
        matches!(self.credentials, Credentials::InstanceRole { .. })
    }
    /// A new SigV4 transport for these settings. With the instance role each transport owns
    /// one credential cache; share the transport rather than building one per request.
    pub fn transport(&self) -> Result<HttpS3Transport, Error> {
        let credentials = match &self.credentials {
            Credentials::Static {
                access_key_id,
                secret_access_key,
            } => RefreshableCredentials::new(rusty_s3::Credentials::new(
                access_key_id,
                secret_access_key,
            )),
            Credentials::InstanceRole { metadata_root } => {
                RefreshableCredentials::instance_role(InstanceRole::new(metadata_root)?)
            }
        };
        let mut transport = HttpS3Transport::with_credentials(
            &self.endpoint,
            &self.bucket,
            &self.region,
            credentials,
        )?;
        if let Some((directory, bytes)) = &self.local_cache {
            let namespace = format!(
                "raw-cache-v1\n{}\n{}\n{}",
                self.endpoint, self.bucket, self.region
            );
            transport.raw_cache = Some(std::sync::Arc::new(crate::cache::disk::DiskCache::new(
                directory, &namespace, *bytes, 131_072,
            )?));
        }
        Ok(transport)
    }
}
