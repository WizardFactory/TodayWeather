//! Internal checked resolution. No routes, provider adapter or shared-instance cache is wired here.
mod backend;
mod flight;
use crate::storage::{Error as StorageError, GroupDeclaration, RawRecord};
pub use backend::{CatalogBackend, CheckedInput, RawView, ReadSelection, ResolutionRequest};
pub use flight::{DrainReport, Metrics, Resolver, ResolverConfig, Response};
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Storage(StorageError),
    Incomplete,
    AcquisitionDenied,
    Cancelled,
    Draining,
    TaskFailed,
}
impl From<StorageError> for Error {
    fn from(e: StorageError) -> Self {
        Self::Storage(e)
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "resolution: {self:?}")
    }
}
impl std::error::Error for Error {}

/// Owned-operation signal, not an initiating HTTP waiter's cancellation signal.
#[derive(Clone)]
pub struct OperationContext {
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
}
impl OperationContext {
    pub fn deadline(&self) -> Instant {
        self.deadline
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    pub fn check(&self) -> Result<(), Error> {
        if self.is_cancelled() {
            Err(Error::Cancelled)
        } else if Instant::now() >= self.deadline {
            Err(StorageError::Timeout.into())
        } else {
            Ok(())
        }
    }
}
/// Exact response/query semantics stay volatile. The funding adapter maps this opaque request
/// to independently authorized coarse provider identities; hashing is not anonymization.
#[derive(Clone)]
pub struct AcquisitionRequest {
    request: ResolutionRequest,
}
impl AcquisitionRequest {
    pub fn resolution(&self) -> &ResolutionRequest {
        &self.request
    }
}
pub struct Acquisition {
    pub declaration: GroupDeclaration,
    pub records: Vec<RawRecord>,
}
/// Trusted seam: implementers must reserve durable maximum provider-unit funding before HTTP.
/// Recorded callbacks do not prove the later S08 funding adapter has been integrated.
pub trait FundedAcquirer: Send + Sync + 'static {
    fn acquire(
        &self,
        request: AcquisitionRequest,
        context: OperationContext,
    ) -> impl Future<Output = Result<Acquisition, Error>> + Send;
}
/// Trusted CPU adapter. Write into the capped output; do not allocate an unbounded temporary view.
/// Parsers see only checked complete acquisitions. Full-history merges must check coverage first.
pub trait ViewBuilder: Send + Sync + 'static {
    fn parse(
        &self,
        pages: &[RawView<'_>],
        parser_revision: &str,
        output: &mut CappedOutput,
    ) -> Result<(), Error>;
    fn assemble(
        &self,
        request: &ResolutionRequest,
        input: &CheckedInput,
        parsed: &[&[u8]],
        output: &mut CappedOutput,
    ) -> Result<(), Error>;
}
pub struct CappedOutput {
    bytes: Vec<u8>,
    maximum: usize,
}
impl CappedOutput {
    pub fn new(maximum: usize) -> Self {
        Self {
            bytes: Vec::new(),
            maximum,
        }
    }
    pub fn append(&mut self, bytes: &[u8]) -> Result<(), Error> {
        if bytes.len() > self.maximum.saturating_sub(self.bytes.len()) {
            return Err(StorageError::Capacity.into());
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    fn finish(self) -> Box<[u8]> {
        self.bytes.into_boxed_slice()
    }
}
