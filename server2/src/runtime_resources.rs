//! Explicit process CPU ownership. No mutable global or late service attachment.
use crate::operational_metrics::{CpuKind, CpuMetrics};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
};
use std::time::{Duration, Instant as WallInstant};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, timeout_at},
};

pub const NATIVE_QUEUE: usize = 16;
pub const CPU_MARGIN: Duration = Duration::from_millis(10);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CpuFailure {
    Capacity,
    Deadline,
    Panicked,
    Stopped,
}
// One load/flight, never a process-global cause. No identity or metric labels.
#[derive(Default)]
struct CpuObservation {
    active: AtomicUsize,
    refused: AtomicBool,
    interrupted: AtomicBool,
}
struct RunState {
    scope: Option<Arc<CpuObservation>>,
    live: AtomicBool,
    fault: AtomicU8,
}
impl RunState {
    fn new(scope: Option<Arc<CpuObservation>>) -> Arc<Self> {
        if let Some(scope) = &scope {
            scope.active.fetch_add(1, Ordering::AcqRel);
        }
        Arc::new(Self {
            scope,
            live: AtomicBool::new(true),
            fault: AtomicU8::new(0),
        })
    }
    fn retire(&self) -> bool {
        let live = self.live.swap(false, Ordering::AcqRel);
        if live && let Some(scope) = &self.scope {
            scope.active.fetch_sub(1, Ordering::AcqRel);
        }
        live
    }
    fn refuse(&self) {
        if self.fault.load(Ordering::Acquire) == 0
            && let Some(scope) = &self.scope
        {
            scope.refused.store(true, Ordering::Release);
        }
        self.retire();
    }
    fn fault(&self, panic: bool) {
        self.fault
            .store(if panic { 1 } else { 2 }, Ordering::Release);
        self.retire();
    }
    fn known_fault(&self) -> Option<CpuFailure> {
        match self.fault.load(Ordering::Acquire) {
            1 => Some(CpuFailure::Panicked),
            2 => Some(CpuFailure::Stopped),
            _ => None,
        }
    }
}
struct RunObservation(Arc<RunState>);
impl RunObservation {
    fn finish(&self, error: Option<CpuFailure>) {
        if matches!(error, Some(CpuFailure::Capacity | CpuFailure::Deadline)) {
            self.0.refuse();
        } else {
            self.0.retire();
        }
    }
}
impl Drop for RunObservation {
    fn drop(&mut self) {
        // timeout_at drops its inner future before its caller can inspect the view.
        // Retire the gauge while retaining that exact unfinished computation for the
        // caller's actual timeout branch; an ordinary external abort returns nothing.
        if self.0.retire()
            && let Some(scope) = &self.0.scope
        {
            scope.interrupted.store(true, Ordering::Release);
        }
    }
}
pub struct CpuAdmission {
    gate: Arc<Semaphore>,
    offers: Arc<Semaphore>,
    limit: usize,
    metrics: Arc<CpuMetrics>,
    observation: Option<Arc<CpuObservation>>,
}
impl CpuAdmission {
    pub fn new(limit: usize) -> Arc<Self> {
        Arc::new(Self {
            gate: Arc::new(Semaphore::new(limit)),
            offers: Arc::new(Semaphore::new(NATIVE_QUEUE)),
            limit,
            metrics: Arc::new(CpuMetrics::default()),
            observation: None,
        })
    }
    /// Reuse an ancestor observation explicitly. Storage adapters must not silently
    /// replace the enclosing caller's scope with a fresh cause flag.
    pub(crate) fn same_pool(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.gate, &other.gate)
            && Arc::ptr_eq(&self.offers, &other.offers)
            && Arc::ptr_eq(&self.metrics, &other.metrics)
    }
    pub(crate) fn observed_view(self: &Arc<Self>) -> Arc<Self> {
        if self.observation.is_some() {
            return self.clone();
        }
        Arc::new(Self {
            gate: self.gate.clone(),
            offers: self.offers.clone(),
            limit: self.limit,
            metrics: self.metrics.clone(),
            observation: Some(Arc::new(CpuObservation::default())),
        })
    }
    pub(crate) fn local_unavailable(&self) -> bool {
        self.observation.as_ref().is_some_and(|s| {
            s.active.load(Ordering::Acquire) > 0
                || s.refused.load(Ordering::Acquire)
                || s.interrupted.load(Ordering::Acquire)
        })
    }
    #[cfg(test)]
    pub(crate) fn local_refusal(&self) -> bool {
        self.observation
            .as_ref()
            .is_some_and(|s| s.refused.load(Ordering::Acquire))
    }
    pub fn available(&self) -> usize {
        self.gate.available_permits()
    }
    pub fn limit(&self) -> usize {
        self.limit
    }
    pub fn render(&self) -> String {
        self.metrics.render(self.limit)
    }
    pub async fn immediate<F, R>(&self, kind: CpuKind, work: F) -> Result<R, CpuFailure>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let permit = self.gate.clone().try_acquire_owned().map_err(|_| {
            self.metrics.series[kind.index()].rejected.add(1);
            CpuFailure::Capacity
        })?;
        self.spawn(kind, permit, None, work, None, None).await
    }
    pub async fn run<F, R>(
        &self,
        kind: CpuKind,
        deadline: Instant,
        local: Option<Arc<Semaphore>>,
        work: F,
    ) -> Result<R, CpuFailure>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let observation = RunObservation(RunState::new(self.observation.clone()));
        let mut result = self
            .run_inner(kind, deadline, local, work, observation.0.clone())
            .await;
        if let Some(fault) = observation.0.known_fault() {
            result = Err(fault);
        }
        observation.finish(result.as_ref().err().copied());
        result
    }
    async fn run_inner<F, R>(
        &self,
        kind: CpuKind,
        deadline: Instant,
        local: Option<Arc<Semaphore>>,
        work: F,
        observation: Arc<RunState>,
    ) -> Result<R, CpuFailure>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let m = &self.metrics.series[kind.index()];
        let Some(until) = deadline
            .checked_sub(CPU_MARGIN)
            .filter(|t| *t > Instant::now())
        else {
            m.rejected.add(1);
            m.deadline.add(1);
            return Err(CpuFailure::Deadline);
        };
        let offer = self.offers.clone().try_acquire_owned().map_err(|_| {
            m.rejected.add(1);
            CpuFailure::Capacity
        })?;
        let mut queued = QueueGuard::new(self.metrics.clone(), kind);
        let permits = timeout_at(until, async {
            let local = match local {
                Some(g) => Some(g.acquire_owned().await.map_err(|_| CpuFailure::Stopped)?),
                None => None,
            };
            let process = self
                .gate
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| CpuFailure::Stopped)?;
            Ok::<_, CpuFailure>((process, local))
        })
        .await;
        let (process, local) = match permits {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                queued.reject(e);
                return Err(e);
            }
            Err(_) => {
                queued.reject(CpuFailure::Deadline);
                return Err(CpuFailure::Deadline);
            }
        };
        queued.admit();
        drop(offer);
        self.spawn(kind, process, local, work, Some(until), Some(observation))
            .await
    }
    async fn spawn<F, R>(
        &self,
        kind: CpuKind,
        process: OwnedSemaphorePermit,
        local: Option<OwnedSemaphorePermit>,
        work: F,
        until: Option<Instant>,
        observation: Option<Arc<RunState>>,
    ) -> Result<R, CpuFailure>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let m = &self.metrics.series[kind.index()];
        m.admitted.add(1);
        m.active.add(1);
        let phase = Arc::new(AtomicU8::new(0));
        let deadline_counted = Arc::new(AtomicBool::new(false));
        let guard = JobGuard {
            metrics: self.metrics.clone(),
            kind,
            phase: phase.clone(),
            deadline_counted: deadline_counted.clone(),
            start: None,
            done: false,
            _process: process,
            _local: local,
            observation: observation.clone(),
        };
        let mut waiter = Waiter {
            metrics: self.metrics.clone(),
            kind,
            phase,
            done: false,
        };
        let job = crate::observability::spawn_blocking(move || {
            let mut guard = guard;
            guard.enter();
            if until.is_some_and(|t| Instant::now() >= t) {
                guard.expired();
                return Err(CpuFailure::Deadline);
            }
            let result = work();
            guard.finish();
            Ok(result)
        });
        let joined = if let Some(until) = until {
            match timeout_at(until, job).await {
                Ok(r) => r,
                Err(_) => {
                    waiter.done = true;
                    if let Some(fault) = observation.as_ref().and_then(|s| s.known_fault()) {
                        return Err(fault);
                    }
                    record_deadline(&deadline_counted, &self.metrics.series[kind.index()]);
                    return Err(CpuFailure::Deadline);
                }
            }
        } else {
            job.await
        };
        waiter.done = true;
        match joined {
            Ok(result) => {
                if until.is_some_and(|t| Instant::now() >= t) {
                    record_deadline(&deadline_counted, &self.metrics.series[kind.index()]);
                    Err(CpuFailure::Deadline)
                } else {
                    result
                }
            }
            Err(e) => Err(if e.is_panic() {
                CpuFailure::Panicked
            } else {
                CpuFailure::Stopped
            }),
        }
    }
}
fn record_deadline(counted: &AtomicBool, metrics: &crate::operational_metrics::CpuSeries) {
    if !counted.swap(true, Ordering::AcqRel) {
        metrics.deadline.add(1);
    }
}
struct QueueGuard {
    metrics: Arc<CpuMetrics>,
    kind: CpuKind,
    start: WallInstant,
    done: bool,
}
impl QueueGuard {
    fn new(metrics: Arc<CpuMetrics>, kind: CpuKind) -> Self {
        metrics.series[kind.index()].queued.add(1);
        Self {
            metrics,
            kind,
            start: WallInstant::now(),
            done: false,
        }
    }
    fn admit(&mut self) {
        self.done = true;
        let m = &self.metrics.series[self.kind.index()];
        m.queued.sub();
        m.wait.observe(self.start.elapsed());
    }
    fn reject(&mut self, error: CpuFailure) {
        self.admit();
        let m = &self.metrics.series[self.kind.index()];
        m.rejected.add(1);
        match error {
            CpuFailure::Deadline => {
                m.deadline.add(1);
            }
            CpuFailure::Stopped => {
                m.stopped.add(1);
            }
            _ => {}
        }
    }
}
impl Drop for QueueGuard {
    fn drop(&mut self) {
        if !self.done {
            self.admit();
            self.metrics.series[self.kind.index()]
                .queued_cancelled
                .add(1);
        }
    }
}
struct Waiter {
    metrics: Arc<CpuMetrics>,
    kind: CpuKind,
    phase: Arc<AtomicU8>,
    done: bool,
}
impl Drop for Waiter {
    fn drop(&mut self) {
        if !self.done && self.phase.load(Ordering::Acquire) != 2 {
            self.metrics.series[self.kind.index()]
                .started_cancelled
                .add(1);
        }
    }
}
struct JobGuard {
    metrics: Arc<CpuMetrics>,
    kind: CpuKind,
    phase: Arc<AtomicU8>,
    deadline_counted: Arc<AtomicBool>,
    start: Option<WallInstant>,
    done: bool,
    _process: OwnedSemaphorePermit,
    _local: Option<OwnedSemaphorePermit>,
    observation: Option<Arc<RunState>>,
}
impl JobGuard {
    fn enter(&mut self) {
        self.phase.store(1, Ordering::Release);
        self.start = Some(WallInstant::now());
        self.metrics.series[self.kind.index()].running.add(1);
    }
    fn expired(&mut self) {
        self.done = true;
        if let Some(observation) = &self.observation {
            observation.refuse();
        }
        record_deadline(
            &self.deadline_counted,
            &self.metrics.series[self.kind.index()],
        );
    }
    fn finish(&mut self) {
        self.done = true;
        self.metrics.series[self.kind.index()].completed.add(1);
    }
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        let m = &self.metrics.series[self.kind.index()];
        if let Some(start) = self.start {
            m.running.sub();
            m.run.observe(start.elapsed());
            if !self.done {
                if std::thread::panicking() {
                    m.panicked.add(1);
                } else {
                    m.stopped.add(1);
                }
            }
        } else {
            m.stopped.add(1);
        }
        if !self.done
            && let Some(observation) = &self.observation
        {
            observation.fault(std::thread::panicking());
        }
        m.active.sub();
        self.phase.store(2, Ordering::Release);
    }
}

pub struct ProcessResources {
    pub cpu: Arc<CpuAdmission>,
    pub domestic: Arc<crate::domestic::metrics::DomesticMetrics>,
}
impl ProcessResources {
    pub fn new(config: &crate::Config) -> Arc<Self> {
        Arc::new(Self {
            cpu: CpuAdmission::new(config.cpu_limit),
            domestic: Arc::new(crate::domestic::metrics::DomesticMetrics::default()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_queue_is_bounded_and_queued_cancellation_releases_admission() {
        let cpu = CpuAdmission::new(1);
        let (started, ready) = tokio::sync::oneshot::channel();
        let (end, wait) = std::sync::mpsc::channel();
        let held = cpu.clone();
        let blocker = tokio::spawn(async move {
            held.immediate(CpuKind::Foundation, move || {
                let _ = started.send(());
                wait.recv().unwrap();
            })
            .await
        });
        ready.await.unwrap();
        let mut queued = Vec::new();
        for _ in 0..NATIVE_QUEUE {
            let cpu = cpu.clone();
            queued.push(tokio::spawn(async move {
                cpu.run(
                    CpuKind::VcParse,
                    Instant::now() + Duration::from_secs(5),
                    None,
                    || (),
                )
                .await
            }));
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            while cpu.offers.available_permits() != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            cpu.run(
                CpuKind::VcParse,
                Instant::now() + Duration::from_secs(1),
                None,
                || ()
            )
            .await,
            Err(CpuFailure::Capacity)
        );
        for task in queued {
            task.abort();
            let _ = task.await;
        }
        assert_eq!(cpu.offers.available_permits(), NATIVE_QUEUE);
        assert_eq!(cpu.metrics.series[CpuKind::VcParse.index()].queued.get(), 0);
        assert_eq!(
            cpu.metrics.series[CpuKind::VcParse.index()]
                .queued_cancelled
                .get(),
            16
        );
        end.send(()).unwrap();
        assert_eq!(blocker.await.unwrap(), Ok(()));
        assert_eq!(cpu.available(), 1);
    }
    #[tokio::test]
    async fn panic_is_not_stopped_and_releases_the_actual_permit() {
        let cpu = CpuAdmission::new(1);
        assert_eq!(
            cpu.run(
                CpuKind::VcParse,
                Instant::now() + Duration::from_secs(1),
                None,
                || panic!("owned CPU fault")
            )
            .await,
            Err(CpuFailure::Panicked)
        );
        assert_eq!(cpu.available(), 1);
        let m = &cpu.metrics.series[CpuKind::VcParse.index()];
        assert_eq!(m.panicked.get(), 1);
        assert_eq!(m.stopped.get(), 0);
    }
    #[test]
    fn cancelled_admitted_job_retains_permit_before_blocking_pool_start() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (start, ready) = tokio::sync::oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let external = tokio::task::spawn_blocking(move || {
                let _ = start.send(());
                wait.recv().unwrap();
            });
            ready.await.unwrap();
            let cpu = CpuAdmission::new(1);
            let ran = Arc::new(AtomicBool::new(false));
            let done = ran.clone();
            let task_cpu = cpu.clone();
            let task = tokio::spawn(async move {
                task_cpu
                    .run(
                        CpuKind::WorldRestore,
                        Instant::now() + Duration::from_secs(3),
                        None,
                        move || {
                            done.store(true, Ordering::SeqCst);
                        },
                    )
                    .await
            });
            tokio::time::timeout(Duration::from_secs(1), async {
                while cpu.available() != 0 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            task.abort();
            let _ = task.await;
            assert_eq!(cpu.available(), 0);
            assert!(!ran.load(Ordering::SeqCst));
            release.send(()).unwrap();
            external.await.unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while cpu.available() != 1 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert!(ran.load(Ordering::SeqCst));
            assert_eq!(
                cpu.metrics.series[CpuKind::WorldRestore.index()]
                    .started_cancelled
                    .get(),
                1
            );
        });
    }
    #[test]
    fn expired_prestart_job_never_runs_its_cpu_work() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (start, ready) = tokio::sync::oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let external = tokio::task::spawn_blocking(move || {
                let _ = start.send(());
                wait.recv().unwrap();
            });
            ready.await.unwrap();
            let cpu = CpuAdmission::new(1);
            let ran = Arc::new(AtomicBool::new(false));
            let done = ran.clone();
            let result = cpu
                .run(
                    CpuKind::VcParse,
                    Instant::now() + Duration::from_millis(80),
                    None,
                    move || done.store(true, Ordering::SeqCst),
                )
                .await;
            assert_eq!(result, Err(CpuFailure::Deadline));
            assert_eq!(cpu.available(), 0);
            release.send(()).unwrap();
            external.await.unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while cpu.available() != 1 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert!(!ran.load(Ordering::SeqCst));
            assert_eq!(
                cpu.metrics.series[CpuKind::VcParse.index()].deadline.get(),
                1,
                "waiter and late closure share one deadline terminal"
            );
            assert_eq!(
                cpu.metrics.series[CpuKind::VcParse.index()]
                    .started_cancelled
                    .get(),
                0,
                "an actual deadline is not caller cancellation"
            );
        });
    }
    #[tokio::test(start_paused = true)]
    async fn simultaneous_outer_and_cpu_deadlines_preserve_the_typed_local_result() {
        let cpu = CpuAdmission::new(1);
        let held = cpu.gate.clone().acquire_owned().await.unwrap();
        let run_cpu = cpu.clone();
        let deadline = Instant::now() + Duration::from_millis(100);
        let task = tokio::spawn(async move {
            timeout_at(
                deadline,
                run_cpu.run::<_, ()>(CpuKind::StorageControl, deadline, None, || {
                    panic!("must never start")
                }),
            )
            .await
        });
        while cpu.metrics.series[CpuKind::StorageControl.index()]
            .queued
            .get()
            == 0
        {
            tokio::task::yield_now().await;
        }
        // Both deadlines become ready in one poll; classification must not depend only on
        // the wall-clock 10ms margin having been scheduled separately.
        tokio::time::advance(Duration::from_millis(100)).await;
        assert_eq!(task.await.unwrap(), Ok(Err(CpuFailure::Deadline)));
        assert_eq!(
            cpu.metrics.series[CpuKind::StorageControl.index()]
                .queued
                .get(),
            0
        );
        drop(held);
        assert_eq!(cpu.available(), 1);
    }
    #[tokio::test(start_paused = true)]
    async fn observed_timeout_retains_interrupted_cpu_after_inner_drop_but_retires_active() {
        let process = CpuAdmission::new(1);
        let held = process.gate.clone().acquire_owned().await.unwrap();
        let view = process.observed_view();
        let owned = view.clone();
        let until = Instant::now() + Duration::from_secs(3);
        let task = tokio::spawn(async move {
            timeout_at(
                until,
                owned.run(
                    CpuKind::AirRestore,
                    until + Duration::from_secs(5),
                    None,
                    || (),
                ),
            )
            .await
        });
        while process.metrics.series[CpuKind::AirRestore.index()]
            .queued
            .get()
            == 0
        {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_secs(3)).await;
        assert!(task.await.unwrap().is_err());
        let scope = view.observation.as_ref().unwrap();
        assert_eq!(
            scope.active.load(Ordering::Acquire),
            0,
            "timeout dropped inner run before this inspection"
        );
        assert!(scope.interrupted.load(Ordering::Acquire));
        assert!(view.local_unavailable());
        assert!(
            !view.local_refusal(),
            "no CpuFailure was polled; this is interrupted completion"
        );
        assert_eq!(
            process.metrics.series[CpuKind::AirRestore.index()]
                .queued
                .get(),
            0
        );
        drop(held);
        assert_eq!(process.available(), 1);
    }
    #[tokio::test(start_paused = true)]
    async fn observed_finished_cpu_then_io_timeout_is_not_local_and_ancestor_is_retained() {
        let process = CpuAdmission::new(1);
        let view = process.observed_view();
        assert!(
            Arc::ptr_eq(&view, &view.observed_view()),
            "do not replace ancestor provenance"
        );
        assert!(view.same_pool(&process));
        let owned = view.clone();
        let task = tokio::spawn(async move {
            owned
                .run(
                    CpuKind::AirRestore,
                    Instant::now() + Duration::from_secs(8),
                    None,
                    || 7,
                )
                .await
        });
        while !task.is_finished() {
            tokio::task::yield_now().await;
        }
        assert_eq!(task.await.unwrap(), Ok(7));
        assert!(
            timeout_at(
                Instant::now() + Duration::from_secs(3),
                std::future::pending::<()>()
            )
            .await
            .is_err()
        );
        assert!(
            !view.local_unavailable(),
            "completed CPU is not an I/O or mutex failure"
        );
    }
    #[tokio::test]
    async fn observation_covers_completed_result_pending_and_excludes_known_panic_or_stopped() {
        use std::{future::Future, task::Poll};
        let process = CpuAdmission::new(1);
        let view = process.observed_view();
        let mut run = Box::pin(view.run(
            CpuKind::WorldRestore,
            Instant::now() + Duration::from_secs(8),
            None,
            || 7,
        ));
        assert!(
            std::future::poll_fn(|cx| Poll::Ready(run.as_mut().poll(cx)))
                .await
                .is_pending()
        );
        while process.metrics.series[CpuKind::WorldRestore.index()]
            .completed
            .get()
            == 0
        {
            tokio::task::yield_now().await;
        }
        assert!(
            view.local_unavailable(),
            "result reception remains a local CPU stage"
        );
        assert_eq!(run.await, Ok(7));
        assert!(!view.local_unavailable());
        let defect = process.observed_view();
        let mut run = Box::pin(defect.run::<_, ()>(
            CpuKind::VcParse,
            Instant::now() + Duration::from_secs(8),
            None,
            || panic!("known local defect"),
        ));
        assert!(
            std::future::poll_fn(|cx| Poll::Ready(run.as_mut().poll(cx)))
                .await
                .is_pending()
        );
        while process.metrics.series[CpuKind::VcParse.index()]
            .panicked
            .get()
            == 0
        {
            tokio::task::yield_now().await;
        }
        while process.available() == 0 {
            tokio::task::yield_now().await;
        }
        assert!(
            !defect.local_unavailable(),
            "confirmed panic cannot become capacity while its join result waits"
        );
        assert_eq!(run.await, Err(CpuFailure::Panicked));
        let stop = process.observed_view();
        let local = Arc::new(Semaphore::new(1));
        local.close();
        assert_eq!(
            stop.run(
                CpuKind::VcParse,
                Instant::now() + Duration::from_secs(8),
                Some(local),
                || ()
            )
            .await,
            Err(CpuFailure::Stopped)
        );
        assert!(!stop.local_unavailable());
    }
    #[test]
    fn observation_covers_admitted_prestart_and_running_outer_deadline() {
        for prestart in [true, false] {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .start_paused(true)
                .max_blocking_threads(1)
                .build()
                .unwrap();
            rt.block_on(async {
                let cpu = CpuAdmission::new(1);
                let view = cpu.observed_view();
                let (start, ready) = tokio::sync::oneshot::channel();
                let (release, wait) = std::sync::mpsc::channel();
                let external = if prestart {
                    Some(tokio::task::spawn_blocking(move || {
                        let _ = start.send(());
                        let _ = wait.recv();
                    }))
                } else {
                    None
                };
                let owned = view.clone();
                let until = Instant::now() + Duration::from_secs(3);
                // Separate barriers because a prestart closure has not entered CPU work.
                let (running, entered) = tokio::sync::oneshot::channel();
                let (finish, stopped) = std::sync::mpsc::channel();
                let task = tokio::spawn(async move {
                    timeout_at(
                        until,
                        owned.run(
                            CpuKind::WorldRestore,
                            until + Duration::from_secs(5),
                            None,
                            move || {
                                let _ = running.send(());
                                if !prestart {
                                    let _ = stopped.recv();
                                }
                                7
                            },
                        ),
                    )
                    .await
                });
                if prestart {
                    ready.await.unwrap();
                } else {
                    entered.await.unwrap();
                }
                while cpu.metrics.series[CpuKind::WorldRestore.index()]
                    .admitted
                    .get()
                    == 0
                {
                    tokio::task::yield_now().await;
                }
                assert_eq!(
                    cpu.metrics.series[CpuKind::WorldRestore.index()]
                        .running
                        .get(),
                    if prestart { 0 } else { 1 }
                );
                tokio::time::advance(Duration::from_secs(3)).await;
                assert!(task.await.unwrap().is_err());
                assert!(
                    view.local_unavailable(),
                    "the exact unfinished CPU stage exceeded caller budget"
                );
                assert_eq!(
                    view.observation
                        .as_ref()
                        .unwrap()
                        .active
                        .load(Ordering::Acquire),
                    0
                );
                assert_eq!(
                    cpu.available(),
                    0,
                    "closure still owns the actual process permit"
                );
                if prestart {
                    let _ = release.send(());
                    external.unwrap().await.unwrap();
                } else {
                    let _ = finish.send(());
                }
                while cpu.available() == 0 {
                    tokio::task::yield_now().await;
                }
                assert_eq!(
                    cpu.metrics.series[CpuKind::WorldRestore.index()]
                        .active
                        .get(),
                    0
                );
            });
        }
    }
}
