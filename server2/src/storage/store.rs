use super::{Error, Limits, Object, PreparedRecord, RawRecord, RecordId, decode};
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};
/// Implementations must return bounded bodies, disable hidden retries and redact URLs/errors.
pub trait ObjectTransport: Send + Sync + 'static {
    /// Optional verified immutable weather raw cache; mutable controls/state are excluded.
    fn raw_cache(&self) -> Option<Arc<crate::cache::disk::DiskCache>> {
        None
    }
    fn put(&self, record: &PreparedRecord) -> impl Future<Output = Result<u16, Error>> + Send;
    fn head(&self, key: &str) -> impl Future<Output = Result<Object, Error>> + Send;
    fn get(&self, key: &str, maximum: usize) -> impl Future<Output = Result<Object, Error>> + Send;
    /// Make request credentials available before a write whose outcome must be classified (S10f:
    /// an instance-role refresh). A failure means no request was sent.
    fn ready(&self) -> impl Future<Output = Result<(), Error>> + Send {
        std::future::ready(Ok(()))
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishOutcome {
    Created,
    AlreadyPresent,
}
pub struct RawRecordStore<T> {
    transport: Arc<T>,
    limits: Limits,
    io: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
    buffers: Arc<Semaphore>,
    shared_cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    local_failure: Option<Arc<AtomicBool>>,
}
impl<T: ObjectTransport> RawRecordStore<T> {
    pub fn new(transport: T, limits: Limits) -> Result<Self, Error> {
        Self::new_shared(Arc::new(transport), limits)
    }
    /// Shared transport only; this does not share caches or permit pools with other stores.
    pub fn new_shared(transport: Arc<T>, limits: Limits) -> Result<Self, Error> {
        Self::new_shared_with_cpu(transport, limits, None)
    }
    pub fn new_shared_with_cpu(
        transport: Arc<T>,
        limits: Limits,
        shared_cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> Result<Self, Error> {
        limits.validate()?;
        Ok(Self {
            transport,
            io: Arc::new(Semaphore::new(limits.io)),
            buffers: Arc::new(Semaphore::new(limits.io)),
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            limits,
            shared_cpu,
            local_failure: None,
        })
    }
    pub(crate) fn invocation(&self, flag: Arc<AtomicBool>) -> Self {
        self.invocation_with_cpu(flag, self.shared_cpu.clone())
    }
    pub(crate) fn invocation_with_cpu(
        &self,
        flag: Arc<AtomicBool>,
        cpu: Option<Arc<crate::runtime_resources::CpuAdmission>>,
    ) -> Self {
        Self {
            transport: self.transport.clone(),
            limits: self.limits.clone(),
            io: self.io.clone(),
            cpu: self.cpu.clone(),
            buffers: self.buffers.clone(),
            shared_cpu: cpu,
            local_failure: Some(flag),
        }
    }
    async fn cpu<F, R>(&self, deadline: Instant, f: F) -> Result<R, Error>
    where
        F: FnOnce() -> Result<R, Error> + Send + 'static,
        R: Send + 'static,
    {
        if let Some(cpu) = &self.shared_cpu {
            return match cpu
                .run(
                    crate::operational_metrics::CpuKind::StorageCodec,
                    deadline,
                    Some(self.cpu.clone()),
                    f,
                )
                .await
            {
                Ok(value) => value,
                Err(
                    crate::runtime_resources::CpuFailure::Capacity
                    | crate::runtime_resources::CpuFailure::Deadline,
                ) => {
                    if let Some(flag) = &self.local_failure {
                        flag.store(true, Ordering::Release);
                    }
                    Err(Error::LocalCapacity)
                }
                Err(
                    crate::runtime_resources::CpuFailure::Panicked
                    | crate::runtime_resources::CpuFailure::Stopped,
                ) => Err(Error::Transport),
            };
        }
        let permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        crate::observability::spawn_blocking(move || {
            let _permit = permit;
            f()
        })
        .await
        .map_err(|_| Error::Transport)?
    }
    async fn verified(
        &self,
        key: &str,
        expected: &RecordId,
        head: Option<Object>,
        deadline: Instant,
    ) -> Result<RawRecord, Error> {
        // A bounded buffer slot spans GET, CPU wait and decode (including cancellation).
        let buffer = Arc::new(
            self.buffers
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| Error::Transport)?,
        );
        // A publish reconciliation must prove the canonical body is durable, not
        // merely that a previously verified disposable copy agrees with HEAD.
        let cache = if head.is_none() {
            self.transport.raw_cache()
        } else {
            None
        };
        if let Some(cache) = &cache
            && let Some(object) = cache.load(expected, self.limits.gzip_bytes).await
        {
            let agrees = head
                .as_ref()
                .is_none_or(|h| h.length == object.length && h.metadata == object.metadata);
            if agrees {
                let key = key.to_owned();
                let id = expected.clone();
                let limits = self.limits.clone();
                let cpu_buffer = buffer.clone();
                let checked = self
                    .cpu(deadline, move || {
                        let _buffer = cpu_buffer;
                        decode(&key, object, &id, &limits)
                    })
                    .await;
                match checked {
                    Ok(record) => return Ok(record),
                    Err(Error::LocalCapacity) => return Err(Error::LocalCapacity),
                    Err(_) => {}
                }
            }
            cache.invalidate(expected).await;
        }
        let object = self.transport.get(key, self.limits.gzip_bytes).await?;
        let writer = cache.as_ref().and_then(|c| c.writer(expected));
        let cached = writer.as_ref().map(|_| object.clone());
        if let Some(head) = head
            && (head.length != object.length || head.metadata != object.metadata)
        {
            return Err(Error::Corrupt("HEAD/GET disagreement"));
        }
        let key = key.to_owned();
        let expected = expected.clone();
        let limits = self.limits.clone();
        let record = self
            .cpu(deadline, move || {
                let _buffer = buffer;
                decode(&key, object, &expected, &limits)
            })
            .await?;
        if let (Some(writer), Some(object)) = (writer, cached) {
            writer.enqueue(object);
        }
        Ok(record)
    }
    fn reconciliation_error(error: Error) -> Error {
        match error {
            Error::Corrupt(_) | Error::Invalid(_) => error,
            _ => Error::Ambiguous,
        }
    }
    /// Success only acknowledges immutable body durability, never catalog/client publication.
    pub async fn publish(&self, record: RawRecord) -> Result<PublishOutcome, Error> {
        self.publish_at(record, Instant::now() + self.limits.deadline)
            .await
    }
    pub async fn publish_at(
        &self,
        record: RawRecord,
        deadline: Instant,
    ) -> Result<PublishOutcome, Error> {
        let deadline = deadline.min(Instant::now() + self.limits.deadline);
        crate::observability::observe(
            crate::observability::Component::S3,
            crate::observability::Stage::Publish,
            async {
                let mut put_started = false;
                timeout_at(deadline, async {
                    let _io = self
                        .io
                        .clone()
                        .try_acquire_owned()
                        .map_err(|_| Error::Capacity)?;
                    let expected = record.envelope.clone();
                    let limits = self.limits.clone();
                    let prepared = self.cpu(deadline, move || record.prepare(&limits)).await?;
                    // S10F GROK-1: a credential failure before the first PUT is definite, not ambiguous.
                    self.transport.ready().await?;
                    let mut uncertain_put = false;
                    for attempt in 0..2 {
                        put_started = true;
                        match self.transport.put(&prepared).await {
                            Ok(200) => return Ok(PublishOutcome::Created),
                            Ok(412)
                            | Ok(409)
                            | Ok(500..=599)
                            | Err(Error::Transport)
                            | Err(Error::Timeout)
                            | Err(Error::Capacity)
                            | Err(Error::Ambiguous) => {
                                // A missing HEAD does not rule out an earlier PUT committing later.
                                // A subsequent rejection/local error cannot clear this uncertainty.
                                uncertain_put = true;
                                match self.transport.head(&prepared.key).await {
                                    Ok(head) => {
                                        if head.length > self.limits.gzip_bytes
                                            || head.metadata.get("s2-record")
                                                != prepared.metadata.get("s2-record")
                                        {
                                            return Err(Error::Corrupt("existing metadata/length"));
                                        }
                                        let restored = self
                                            .verified(
                                                &prepared.key,
                                                &expected.identity,
                                                Some(head),
                                                deadline,
                                            )
                                            .await
                                            .map_err(Self::reconciliation_error)?;
                                        if restored.envelope != expected {
                                            return Err(Error::Corrupt("existing envelope"));
                                        }
                                        return Ok(PublishOutcome::AlreadyPresent);
                                    }
                                    Err(Error::NotFound) if attempt == 0 => (),
                                    Err(Error::NotFound) => return Err(Error::Ambiguous),
                                    Err(e) => return Err(Self::reconciliation_error(e)),
                                }
                            }
                            Ok(status) => {
                                return Err(if uncertain_put {
                                    Error::Ambiguous
                                } else {
                                    Error::Status(status)
                                });
                            }
                            Err(e) => {
                                return Err(if uncertain_put {
                                    Self::reconciliation_error(e)
                                } else {
                                    e
                                });
                            }
                        }
                    }
                    Err(Error::Transport)
                })
                .await
                .map_err(|_| {
                    if put_started {
                        Error::Ambiguous
                    } else {
                        Error::Timeout
                    }
                })?
            },
        )
        .await
    }
    /// A caller/catalog supplies the full expected identity; no short hashes or ETag identity.
    pub async fn load(&self, expected: &RecordId) -> Result<RawRecord, Error> {
        self.load_at(expected, Instant::now() + self.limits.deadline)
            .await
    }
    pub async fn load_at(
        &self,
        expected: &RecordId,
        deadline: Instant,
    ) -> Result<RawRecord, Error> {
        let deadline = deadline.min(Instant::now() + self.limits.deadline);
        crate::observability::observe(
            crate::observability::Component::S3,
            crate::observability::Stage::Restore,
            async {
                timeout_at(deadline, async {
                    let _io = self
                        .io
                        .clone()
                        .try_acquire_owned()
                        .map_err(|_| Error::Capacity)?;
                    self.verified(&expected.object_key()?, expected, None, deadline)
                        .await
                })
                .await
                .map_err(|_| Error::Timeout)?
            },
        )
        .await
    }
}

#[cfg(test)]
mod review_regressions {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Notify;
    struct Gated {
        started: Notify,
        reply: Notify,
        status: u16,
        object: std::sync::Mutex<Option<Object>>,
        gets: AtomicUsize,
    }
    impl ObjectTransport for Gated {
        async fn put(&self, p: &PreparedRecord) -> Result<u16, Error> {
            *self.object.lock().unwrap() = Some(Object {
                metadata: p.metadata.clone(),
                length: p.body.len(),
                body: p.body.clone(),
            });
            self.started.notify_one();
            self.reply.notified().await;
            if self.status == 0 {
                Err(Error::Transport)
            } else {
                Ok(self.status)
            }
        }
        async fn head(&self, _: &str) -> Result<Object, Error> {
            Ok(self.object.lock().unwrap().clone().unwrap())
        }
        async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
            self.gets.fetch_add(1, Ordering::SeqCst);
            Ok(self.object.lock().unwrap().clone().unwrap())
        }
    }
    fn record() -> RawRecord {
        use crate::storage::{Period, ProviderKey};
        RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20260131,
                slot: "2300".into(),
            },
            1769871600123,
            200,
            "application/json",
            None,
            b"contention".as_slice().into(),
            &Limits::default(),
        )
        .unwrap()
    }
    // CPU work uses real blocking threads; keep virtual request time fixed while
    // the owned transport/CPU phase progresses. An independent wall watchdog
    // bounds a broken fixture instead of silently consuming the request deadline.
    async fn phase_reached(mut ready: impl FnMut() -> bool) {
        let wall = std::time::Instant::now();
        std::future::poll_fn(|cx| {
            assert!(
                wall.elapsed() < std::time::Duration::from_secs(10),
                "storage test phase stalled"
            );
            if ready() {
                std::task::Poll::Ready(())
            } else {
                cx.waker().wake_by_ref();
                std::task::Poll::Pending
            }
        })
        .await;
    }
    #[tokio::test(start_paused = true)]
    async fn reconciliation_waits_for_decode_under_cpu_contention() {
        for status in [412, 500, 0] {
            let store = Arc::new(
                RawRecordStore::new(
                    Gated {
                        started: Notify::new(),
                        reply: Notify::new(),
                        status,
                        object: Default::default(),
                        gets: AtomicUsize::new(0),
                    },
                    Limits {
                        cpu: 1,
                        ..Limits::default()
                    },
                )
                .unwrap(),
            );
            let s = store.clone();
            let task = crate::observability::spawn(async move { s.publish(record()).await });
            phase_reached(|| store.transport.object.lock().unwrap().is_some()).await;
            let held = store.cpu.clone().acquire_owned().await.unwrap();
            store.transport.reply.notify_one();
            phase_reached(|| store.transport.gets.load(Ordering::SeqCst) == 1).await;
            assert_eq!(
                store.transport.gets.load(Ordering::SeqCst),
                1,
                "bounded download buffer permits GET while CPU is busy"
            );
            assert_eq!(
                store.buffers.available_permits(),
                store.limits.io - 1,
                "buffer remains reserved while waiting for CPU"
            );
            assert!(
                !task.is_finished(),
                "post-PUT contention must wait, not report not-attempted Capacity"
            );
            drop(held);
            phase_reached(|| task.is_finished()).await;
            assert_eq!(task.await.unwrap(), Ok(PublishOutcome::AlreadyPresent));
        }
    }
    #[tokio::test(start_paused = true)]
    async fn post_put_cpu_timeout_is_ambiguous_never_capacity() {
        let store = Arc::new(
            RawRecordStore::new(
                Gated {
                    started: Notify::new(),
                    reply: Notify::new(),
                    status: 500,
                    object: Default::default(),
                    gets: AtomicUsize::new(0),
                },
                Limits {
                    cpu: 1,
                    deadline: std::time::Duration::from_millis(100),
                    ..Limits::default()
                },
            )
            .unwrap(),
        );
        let s = store.clone();
        let task = crate::observability::spawn(async move { s.publish(record()).await });
        phase_reached(|| store.transport.object.lock().unwrap().is_some()).await;
        let held = store.cpu.clone().acquire_owned().await.unwrap();
        store.transport.reply.notify_one();
        phase_reached(|| store.transport.gets.load(Ordering::SeqCst) == 1).await;
        assert_eq!(store.buffers.available_permits(), store.limits.io - 1);
        assert!(
            !task.is_finished(),
            "decode must still be waiting for the held CPU permit"
        );
        // The intended timeout starts only after GET and CPU-wait are proven.
        // No product deadline is extended; this store still has the same100ms.
        tokio::time::advance(std::time::Duration::from_millis(101)).await;
        assert_eq!(task.await.unwrap(), Err(Error::Ambiguous));
        assert!(
            store.transport.object.lock().unwrap().is_some(),
            "body remains committed"
        );
        assert_eq!(store.transport.gets.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.buffers.available_permits(),
            store.limits.io,
            "timed-out waiter releases downloaded buffer"
        );
        drop(held);
    }
    #[tokio::test]
    async fn pre_put_cpu_timeout_and_io_capacity_never_send_put() {
        let store = RawRecordStore::new(
            Gated {
                started: Notify::new(),
                reply: Notify::new(),
                status: 500,
                object: Default::default(),
                gets: AtomicUsize::new(0),
            },
            Limits {
                cpu: 1,
                io: 1,
                deadline: std::time::Duration::from_millis(30),
                ..Limits::default()
            },
        )
        .unwrap();
        let cpu = store.cpu.clone().acquire_owned().await.unwrap();
        assert_eq!(store.publish(record()).await, Err(Error::Timeout));
        assert!(store.transport.object.lock().unwrap().is_none());
        drop(cpu);
        let io = store.io.clone().acquire_owned().await.unwrap();
        assert_eq!(store.publish(record()).await, Err(Error::Capacity));
        assert!(store.transport.object.lock().unwrap().is_none());
        drop(io);
    }
}
