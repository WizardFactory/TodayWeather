//! Request-triggered funded acquisition primitives and the keyless public-page transport;
//! no route adapters or collectors.
mod acquisition;
mod public;
mod rejection;
mod transport;
pub use acquisition::{
    AcquiredBody, AcquisitionError, AcquisitionOutcome, AttemptResult, CallReport, Candidate,
    FundedExecutor, ProviderKey, Validator,
};
pub use public::{HttpPublicTransport, PublicRequest, PublicTransport};
pub use rejection::{Disposition, classify};
pub(crate) use transport::valid_endpoint;
pub use transport::{
    HttpProviderTransport, ProviderResponse, ProviderTransport, ProviderTransportError, Request,
};
