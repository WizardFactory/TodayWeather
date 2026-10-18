//! Warning-only ownership, shared by assembly and the post-bind periodic driver.
use super::{Attempts, Clock, Fetched, fetch};
use crate::{
    gateway::BoxFuture,
    history::IndexListing,
    resolver::OwnedFlights,
    warnings::{acquisition_worker::Acquisition, service::WarningService},
};
use std::{future::Future, sync::Arc, time::Duration};
use tokio::{sync::watch, task::AbortHandle, time::Instant};

#[derive(Default)]
struct State {
    closed: bool,
    running: bool,
    abort: Option<AbortHandle>,
}
#[derive(Clone)]
struct Lane(watch::Sender<State>);
impl Default for Lane {
    fn default() -> Self {
        Self(watch::channel(State::default()).0)
    }
}
/// Created synchronously before an unpolled wrapper can own the reservation.
struct Lease(Lane);
impl Drop for Lease {
    fn drop(&mut self) {
        self.0.0.send_modify(|s| {
            s.running = false;
            s.abort = None;
        });
    }
}
impl Lane {
    fn claim(&self, attempts: &Attempts, period: Duration) -> Option<Lease> {
        let mut fresh = false;
        self.0.send_modify(|s| {
            if !s.closed && !s.running && attempts.claim("warnings", period) {
                s.running = true;
                fresh = true;
            }
        });
        fresh.then(|| Lease(self.clone()))
    }
    async fn launch<F, Fut>(&self, lease: Lease, make: F)
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let mut lease = Some(lease);
        let mut make = Some(make);
        let mut task = None;
        self.0.send_modify(|s| {
            if !s.closed {
                let lease = lease.take().expect("single reservation");
                let make = make.take().expect("single constructor");
                // Spawn and registration are atomic with close. The collector future is
                // constructed INSIDE the task, after its first-local destruction guard.
                let handle = crate::observability::spawn(async move {
                    let _lease = lease;
                    make().await;
                });
                s.abort = Some(handle.abort_handle());
                task = Some(handle);
            }
        });
        // Closed-before-first-poll: never drop Lease while holding the watch write lock.
        drop(lease);
        if let Some(task) = task {
            let _ = task.await;
        }
    }
    fn close(&self) {
        self.0.send_modify(|s| s.closed = true);
    }
    fn abort(&self) {
        let mut abort = None;
        self.0.send_modify(|s| {
            s.closed = true;
            abort = s.abort.clone();
        });
        if let Some(abort) = abort {
            abort.abort();
        }
    }
    async fn idle(&self) {
        let mut rx = self.0.subscribe();
        loop {
            let running = rx.borrow_and_update().running;
            if !running {
                return;
            }
            if rx.changed().await.is_err() {
                return;
            }
        }
    }
}

pub(super) struct WarningCycles<T> {
    owned: OwnedFlights<String, Option<Fetched>>,
    attempts: Arc<Attempts>,
    warnings: Arc<WarningService<T>>,
    clock: Clock,
    acquire: Arc<dyn fetch::ForecastAcquire>,
    lane: Lane,
    period: Duration,
    tracking: Duration,
}
impl<T: IndexListing + Clone + Send + Sync + 'static> WarningCycles<T> {
    pub(super) fn new(
        owned: OwnedFlights<String, Option<Fetched>>,
        attempts: Arc<Attempts>,
        warnings: Arc<WarningService<T>>,
        clock: Clock,
        acquire: Arc<dyn fetch::ForecastAcquire>,
    ) -> Self {
        Self {
            owned,
            attempts,
            warnings,
            clock,
            acquire,
            lane: Lane::default(),
            period: fetch::WARNING_CYCLE,
            tracking: fetch::ForecastRequest::Warnings.owned_for(),
        }
    }
}
impl<T: IndexListing + Clone + Send + Sync + 'static> Acquisition for WarningCycles<T> {
    fn cycle(&self, until: Instant) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let key = format!(
                "warnings/{}",
                ((self.clock)() as i64).div_euclid(self.period.as_millis() as i64)
            );
            let lane = self.lane.clone();
            let attempts = self.attempts.clone();
            let acquire = self.acquire.clone();
            let warnings = self.warnings.clone();
            let period = self.period;
            let _ = self
                .owned
                .join(key, until, self.tracking, move |_| {
                    let lease = lane.claim(&attempts, period);
                    async move {
                        if let Some(lease) = lease {
                            lane.launch(lease, move || async move {
                                if acquire
                                    .acquire(fetch::ForecastRequest::Warnings)
                                    .await
                                    .is_ok()
                                {
                                    warnings.clear_memory().await;
                                }
                            })
                            .await;
                        }
                        None
                    }
                })
                .await;
        })
    }
    fn next_delay(&self) -> Duration {
        let remaining = self.attempts.remaining("warnings");
        if remaining.is_zero() {
            crate::resolver::owned::WAITER_BOUND
        } else {
            remaining + Duration::from_millis(1)
        }
    }
    fn idle(&self) -> BoxFuture<'_, ()> {
        Box::pin(self.lane.idle())
    }
    fn close(&self) {
        self.lane.close();
    }
    fn abort(&self) {
        self.lane.abort();
    }
}

#[cfg(test)]
#[path = "warning_cycle_tests.rs"]
mod tests;
