//! S16 daily summaries and the internal last-year lookup (#2701). TEST ONLY: no provider or AWS
//! is reached; S3 is an in-memory `summary/v2/` double (the S3 wire path is exercised by
//! `tests/domestic/summary_s3.rs` over the S06 loopback peer).
#[path = "summary/derive.rs"]
mod derive;
#[path = "summary/lookup.rs"]
mod lookup;
#[path = "summary/model.rs"]
mod model;
#[path = "summary/record.rs"]
mod record;
#[path = "summary/support.rs"]
mod support;
