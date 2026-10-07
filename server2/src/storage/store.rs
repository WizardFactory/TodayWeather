use super::{Error, Limits, Object, PreparedRecord, RawRecord, RecordId, decode};
use std::{future::Future, sync::Arc};
use tokio::{
    sync::Semaphore,
    time::{Instant, timeout_at},
};
/// Implementations must return bounded bodies, disable hidden retries and redact URLs/errors.
pub trait ObjectTransport: Send + Sync + 'static {
    fn put(&self, record: &PreparedRecord) -> impl Future<Output = Result<u16, Error>> + Send;
    fn head(&self, key: &str) -> impl Future<Output = Result<Object, Error>> + Send;
    fn get(&self, key: &str, maximum: usize) -> impl Future<Output = Result<Object, Error>> + Send;
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
}
impl<T: ObjectTransport> RawRecordStore<T> {
    pub fn new(transport: T, limits: Limits) -> Result<Self, Error> {
        limits.validate()?;
        Ok(Self {
            transport: Arc::new(transport),
            io: Arc::new(Semaphore::new(limits.io)),
            buffers: Arc::new(Semaphore::new(limits.io)),
            cpu: Arc::new(Semaphore::new(limits.cpu)),
            limits,
        })
    }
    async fn cpu<F, R>(&self, f: F) -> Result<R, Error>
    where
        F: FnOnce() -> Result<R, Error> + Send + 'static,
        R: Send + 'static,
    {
        let permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        tokio::task::spawn_blocking(move || {
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
    ) -> Result<RawRecord, Error> {
        // A bounded buffer slot spans GET, CPU wait and decode (including cancellation).
        let buffer = self
            .buffers
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        let object = self.transport.get(key, self.limits.gzip_bytes).await?;
        if let Some(head) = head
            && (head.length != object.length || head.metadata != object.metadata)
        {
            return Err(Error::Corrupt("HEAD/GET disagreement"));
        }
        let key = key.to_owned();
        let expected = expected.clone();
        let limits = self.limits.clone();
        let permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Transport)?;
        tokio::task::spawn_blocking(move || {
            let _buffer = buffer;
            let _permit = permit;
            decode(&key, object, &expected, &limits)
        })
        .await
        .map_err(|_| Error::Transport)?
    }
    fn reconciliation_error(error: Error) -> Error {
        match error {
            Error::Corrupt(_) | Error::Invalid(_) => error,
            _ => Error::Ambiguous,
        }
    }
    /// Success only acknowledges immutable body durability, never catalog/client publication.
    pub async fn publish(&self, record: RawRecord) -> Result<PublishOutcome, Error> {
        let deadline = Instant::now() + self.limits.deadline;
        let mut put_started = false;
        timeout_at(deadline, async {
            let _io = self
                .io
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Capacity)?;
            let expected = record.envelope.clone();
            let limits = self.limits.clone();
            let prepared = self.cpu(move || record.prepare(&limits)).await?;
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
                                    .verified(&prepared.key, &expected.identity, Some(head))
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
    }
    /// A caller/catalog supplies the full expected identity; no short hashes or ETag identity.
    pub async fn load(&self, expected: &RecordId) -> Result<RawRecord, Error> {
        let deadline = Instant::now() + self.limits.deadline;
        timeout_at(deadline, async {
            let _io = self
                .io
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Capacity)?;
            self.verified(&expected.object_key()?, expected, None).await
        })
        .await
        .map_err(|_| Error::Timeout)?
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
    #[tokio::test]
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
            let task = tokio::spawn(async move { s.publish(record()).await });
            store.transport.started.notified().await;
            let held = store.cpu.clone().acquire_owned().await.unwrap();
            store.transport.reply.notify_one();
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
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
            assert_eq!(task.await.unwrap(), Ok(PublishOutcome::AlreadyPresent));
        }
    }
    #[tokio::test]
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
        let task = tokio::spawn(async move { s.publish(record()).await });
        store.transport.started.notified().await;
        let held = store.cpu.clone().acquire_owned().await.unwrap();
        store.transport.reply.notify_one();
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
