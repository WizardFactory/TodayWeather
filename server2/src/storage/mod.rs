//! Immutable exact-byte raw records. A body PUT is not catalog/fetch-group publication.
mod codec;
mod store;
mod transport;
pub use codec::{
    Envelope, FetchGroupRef, Pagination, Period, PreparedRecord, ProviderKey, RawRecord, RecordId,
    decode, sha256,
};
use std::fmt;
pub use store::{ObjectTransport, PublishOutcome, RawRecordStore};
pub use transport::{HttpS3Transport, RefreshableCredentials};
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Invalid(&'static str),
    Corrupt(&'static str),
    /// I/O admission rejected before any request; no PUT attempted.
    Capacity,
    /// PUT sent, but durability could not be verified; same identity must be reconciled.
    Ambiguous,
    Timeout,
    Transport,
    Status(u16),
    NotFound,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "raw storage: {self:?}")
    }
}
impl std::error::Error for Error {}
/// Hard per-operation limits. Caller must also bound admitted response bytes globally.
#[derive(Debug, Clone)]
pub struct Limits {
    pub raw_bytes: usize,
    pub gzip_bytes: usize,
    pub io: usize,
    pub cpu: usize,
    pub deadline: std::time::Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            raw_bytes: 8 * 1024 * 1024,
            gzip_bytes: 8 * 1024 * 1024 + 65536,
            io: 16,
            cpu: 2,
            deadline: std::time::Duration::from_secs(3),
        }
    }
}
impl Limits {
    pub fn validate(&self) -> Result<(), Error> {
        if self.raw_bytes == 0
            || self.raw_bytes > 64 * 1024 * 1024
            || self.gzip_bytes == 0
            || self.gzip_bytes > 65 * 1024 * 1024
            || self.io == 0
            || self.io > 128
            || self.cpu == 0
            || self.cpu > 64
            || self.deadline.is_zero()
            || self.deadline > std::time::Duration::from_secs(9)
        {
            return Err(Error::Invalid("limits"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub struct Object {
    pub metadata: std::collections::BTreeMap<String, String>,
    pub length: usize,
    pub body: Vec<u8>,
}
