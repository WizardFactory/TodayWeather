//! One process-owned scheduler and JoinSet. Dropping the owner cancels every child job.
use super::{AlarmWorker, Diagnostics, Fcm, alerts::AlertWorker, warnings::WarningWorker};
use crate::{budget::Clock, storage::CatalogTransport};
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::watch,
    task::{JoinHandle, JoinSet},
    time::Instant,
};

/// HTTP/jobs/writer share this deadline; runtime teardown reserves the remaining second.
pub const DRAIN: Duration = Duration::from_secs(34);
pub const SHUTDOWN_LIMIT: Duration = Duration::from_secs(35);

pub struct Workers<T> {
    pub alarm: Arc<AlarmWorker<T>>,
    pub alerts: Arc<AlertWorker<T>>,
    pub warnings: Arc<WarningWorker<T>>,
    pub fcm: Arc<Fcm>,
    pub clock: Arc<dyn Clock>,
    pub diagnostics: Arc<dyn Diagnostics>,
}
#[derive(Debug, Default)]
pub struct DrainReport {
    pub completed: usize,
    pub incomplete: usize,
}
pub struct Supervisor {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<DrainReport>>,
    fcm: Arc<Fcm>,
}
impl<T: CatalogTransport + Send + Sync + 'static> Workers<T> {
    /// Called only after both process listeners have bound successfully.
    pub fn start(self: Arc<Self>) -> Supervisor {
        let (stop, rx) = watch::channel(false);
        let fcm = self.fcm.clone();
        let task = tokio::spawn(self.run(rx));
        Supervisor {
            stop,
            task: Some(task),
            fcm,
        }
    }
    async fn run(self: Arc<Self>, mut stop: watch::Receiver<bool>) -> DrainReport {
        let mut jobs = JoinSet::new();
        let mut report = DrainReport::default();
        let mut warning_running = false;
        let mut warning = tokio::time::interval(Duration::from_secs(5));
        warning.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let delay = self.clock.now_ms().map_or(Duration::from_secs(1), |now| {
                Duration::from_millis((60_000 - now.rem_euclid(60_000)) as u64)
            });
            let minute = tokio::time::sleep(delay);
            tokio::pin!(minute);
            // Keep the same boundary timer while joining jobs/polling warnings.
            loop {
                tokio::select! { biased;
                    _ = stop.changed() => break,
                    result = jobs.join_next(), if !jobs.is_empty() => {
                        match result {
                            Some(Ok(is_warning)) => { report.completed += 1; if is_warning { warning_running = false; } },
                            Some(Err(_)) => { report.incomplete += 1; self.diagnostics.minute("supervisor", "job failed; claim retained, no replay"); },
                            None => ()
                        }
                    },
                    _ = &mut minute => {
                        if !*stop.borrow() && let Ok(observed) = self.clock.now_ms() {
                            let alarm = self.alarm.clone();
                            let clock = self.clock.clone();
                            jobs.spawn(async move { if clock.now_ms().is_ok_and(|now| now.div_euclid(60_000) == observed.div_euclid(60_000)) { alarm.run_minute(observed).await; } false });
                            let alerts = self.alerts.clone();
                            let clock = self.clock.clone();
                            jobs.spawn(async move { if clock.now_ms().is_ok_and(|now| now.div_euclid(60_000) == observed.div_euclid(60_000)) { alerts.run_minute(observed).await; } false });
                        }
                        break;
                    },
                    _ = warning.tick(), if !warning_running => {
                        if !*stop.borrow() {
                            warning_running = true;
                            let warnings = self.warnings.clone();
                            let diagnostics = self.diagnostics.clone();
                            jobs.spawn(async move {
                                if warnings.poll().await.is_err() { diagnostics.minute("warning-feed", "poll unavailable; no unsafe submission"); }
                                true
                            });
                        }
                    }
                }
            }
            if *stop.borrow() {
                break;
            }
        }
        while let Some(result) = jobs.join_next().await {
            if result.is_ok() {
                report.completed += 1;
            } else {
                report.incomplete += 1;
            }
        }
        report
    }
}
impl Supervisor {
    pub fn quiesce(&self) {
        self.fcm.quiesce();
        self.stop.send_replace(true);
    }
    pub async fn drain(&mut self, deadline: Instant) -> bool {
        self.quiesce();
        let Some(mut task) = self.task.take() else {
            return true;
        };
        match tokio::time::timeout_at(deadline, &mut task).await {
            Ok(Ok(report)) => {
                eprintln!(
                    "server2 delivery jobs joined={} incomplete={}",
                    report.completed, report.incomplete
                );
                report.incomplete == 0
            }
            Ok(Err(_)) => false,
            Err(_) => {
                task.abort();
                let _ = tokio::time::timeout_at(deadline, &mut task).await;
                eprintln!(
                    "server2 delivery deadline: outstanding jobs cancelled/incomplete; claims retained"
                );
                false
            }
        }
    }
}
impl Drop for Supervisor {
    fn drop(&mut self) {
        self.quiesce();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}
