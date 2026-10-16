//! A DirectRoutes constructor dependency that selected nation test requests never use.
use server2::{
    domestic::kma::{
        KmaRequest,
        backend::{KmaSource, SourceAnswer},
    },
    gateway::BoxFuture,
};
use tokio::time::Instant;
pub struct UnusedCitySource;
impl KmaSource for UnusedCitySource {
    fn snapshot(&self, _: &KmaRequest, _: Instant) -> BoxFuture<'_, SourceAnswer> {
        Box::pin(async {
            panic!("nation test unexpectedly entered the ordinary direct KMA backend")
        })
    }
}
