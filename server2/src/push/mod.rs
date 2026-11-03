//! S18a push registration state: the used legacy registration routes (`POST /v000705/push`,
//! `PUT`/`DELETE`/`OPTIONS /v000902/push`, `POST /v000902/push-list`) with their Express,
//! body-parser and Mongoose 5.1.2 contracts, server2-owned ordered state that is durable in S3
//! before a success answer (journal + snapshots) and restored after memory loss, and the
//! one-time copy of the legacy registrations (`migrate`). Delivery is not part of S18a.
pub(crate) mod attempt;
pub mod deliver;
pub mod durable;
pub mod ejson;
pub mod express;
pub mod js;
pub mod migrate;
pub mod mongoose;
pub mod routes;
pub mod service;
pub mod store;

pub use durable::{Counters, Durable, DurableConfig, StateError};
pub use routes::{Body, Reply, Route};
pub use service::{ObjectIds, PushConfig, PushService, router};
pub use store::{Coll, Oid, OidSource, Record, State};
