//! KMA-RESTART-RACE (AK 2026-11-07, plan A): a stored restore's head start over the providers.
//!
//! After a restart the request reads what S3 holds. A restore that has not finished
//! [`HEAD_START`] into the request (counted from the gateway's accept, KMA-RESTART-BOUND) is raced: the owned provider acquisitions of what memory
//! still lacks start alongside it, as on an empty S3, and the answer takes whichever delivers by
//! the request bound. A restore done by then leaves the acquisitions to what S3 lacks, so it
//! makes no provider call a running process would not make. The head start is code, not a
//! setting.
use crate::observability::{Action, Cause, Component, Details, Outcome, Stage, event};
use std::future::Future;
use std::time::Duration;
use tokio::time::Instant;

/// How long a stored restore runs before its providers start, from the accept of the request.
pub const HEAD_START: Duration = Duration::from_millis(700);

/// Poll `restore` until `at`. Its output when it ended by then; None when it is late (it is left
/// running for the caller, who starts the providers and may keep waiting for it), with one
/// `operation.action` (timeout, fallback) for `component`.
pub async fn restored_by<F: Future + Unpin>(
    restore: &mut F,
    at: Instant,
    component: Component,
) -> Option<F::Output> {
    match tokio::time::timeout_at(at, restore).await {
        Ok(output) => Some(output),
        Err(_) => {
            raced(component);
            None
        }
    }
}
/// Whether `restore` is raced: true when it has not ended by `race_at` (it is left running for
/// the caller). A `race_at` not before `until` (the end of the caller's wait) is no head start:
/// the restore is waited for until `until`, as without one, and it is not raced.
pub async fn races<F: Future + Unpin>(
    restore: &mut F,
    race_at: Instant,
    until: Instant,
    component: Component,
) -> bool {
    if race_at < until {
        return restored_by(restore, race_at, component).await.is_none();
    }
    let _ = tokio::time::timeout_at(until, restore).await;
    false
}
/// Record that `component`'s restore missed its head start and its providers start.
pub fn raced(component: Component) {
    event(
        component,
        Stage::Restore,
        Cause::Timeout,
        Action::Fallback,
        Outcome::Pending,
        Details::default(),
    );
}
