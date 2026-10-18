//! Isolated weather fixture that moves the injected clock only after a whole first wave arrived.
use super::{common::WeatherDouble, state_common::FixedClock};
use server2::{gateway::BoxFuture, push::deliver::Fetch};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::Barrier;

pub struct CrossingFetch {
    inner: Arc<WeatherDouble>,
    clock: Arc<FixedClock>,
    target: String,
    wave: usize,
    barrier: Barrier,
    calls: AtomicUsize,
    active: AtomicUsize,
    peak: AtomicUsize,
}
impl CrossingFetch {
    pub fn new(
        inner: Arc<WeatherDouble>,
        clock: Arc<FixedClock>,
        target: &str,
        wave: usize,
    ) -> Self {
        assert!(wave > 0);
        Self {
            inner,
            clock,
            target: target.into(),
            wave,
            barrier: Barrier::new(wave),
            calls: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        }
    }
    pub fn peak(&self) -> usize {
        self.peak.load(Ordering::SeqCst)
    }
}
struct Active<'a>(&'a AtomicUsize);
impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl Fetch for CrossingFetch {
    fn get(
        &self,
        url: String,
        lang: Option<String>,
    ) -> BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        Box::pin(async move {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(active, Ordering::SeqCst);
            let _active = Active(&self.active);
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            let result = self.inner.get(url, lang).await;
            if call <= self.wave {
                // Change the clock BEFORE the final participant releases the barrier, so
                // every first-wave response deterministically observes the new time.
                if call == self.wave {
                    self.clock.set(&self.target);
                }
                self.barrier.wait().await;
            }
            result
        })
    }
}
