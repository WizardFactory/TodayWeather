//! Process ownership of the shared source lane. Construction performs no acquisition.
use crate::gateway::BoxFuture;
use std::{sync::Arc, time::Duration};
use tokio::{task::JoinHandle, time::Instant};

pub trait Acquisition: Send + Sync + 'static {
    /// Same bounded request join and admission used by native weather assembly.
    fn cycle(&self, until: Instant) -> BoxFuture<'_, ()>;
    /// Existing real-time admission expiry, with a bounded fallback when no attempt was made.
    fn next_delay(&self) -> Duration;
    /// Completion means the actual collector future was destroyed, not publication success.
    fn idle(&self) -> BoxFuture<'_, ()>;
    fn close(&self);
    /// Requests cancellation. This alone is not a confirmed drain.
    fn abort(&self);
}

pub struct Owner {
    source: Arc<dyn Acquisition>,
    timer: Option<JoinHandle<()>>,
}
impl Owner {
    /// Install before binds to cover early errors/unwind; no work starts here.
    pub fn new(source: Arc<dyn Acquisition>) -> Self {
        Self {
            source,
            timer: None,
        }
    }
    /// Only the bound push process calls this. HTTP-only processes retain request acquisition.
    pub fn start(&mut self) {
        assert!(self.timer.is_none(), "one periodic driver per process");
        let source = self.source.clone();
        self.timer = Some(crate::observability::spawn(async move {
            loop {
                source
                    .cycle(Instant::now() + crate::resolver::owned::WAITER_BOUND)
                    .await;
                // Tracking/waiter expiry does not cancel an actual collector. Never overlap it.
                source.idle().await;
                tokio::time::sleep(source.next_delay()).await;
            }
        }));
    }
    pub fn quiesce(&mut self) {
        self.source.close();
        if let Some(timer) = self.timer.take() {
            timer.abort();
        }
    }
    pub async fn drain(&self, until: Instant) -> bool {
        if tokio::time::timeout_at(until, self.source.idle())
            .await
            .is_ok()
        {
            true
        } else {
            self.source.abort();
            false
        }
    }
    pub fn abort(&self) {
        self.source.abort();
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.quiesce();
        self.source.abort();
    }
}
