//! Request-triggered funded acquisition primitives; no route adapters or collectors.
mod acquisition;
mod rejection;
mod transport;
pub use acquisition::{
    AcquiredBody, AcquisitionError, AcquisitionOutcome, Candidate, FundedExecutor, ProviderKey,
    Validator,
};
pub use rejection::{Disposition, classify};
pub use transport::{
    HttpProviderTransport, ProviderResponse, ProviderTransport, ProviderTransportError, Request,
};
