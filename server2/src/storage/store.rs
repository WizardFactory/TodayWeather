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
}
impl<T: ObjectTransport> RawRecordStore<T> {
    pub fn new(transport: T, limits: Limits) -> Result<Self, Error> {
        limits.validate()?;
        Ok(Self {
            transport: Arc::new(transport),
            io: Arc::new(Semaphore::new(limits.io)),
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
            .try_acquire_owned()
            .map_err(|_| Error::Capacity)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            f()
        })
        .await
        .map_err(|_| Error::Transport)?
    }
    async fn verified(&self, key: &str, expected: &RecordId) -> Result<RawRecord, Error> {
        let object = self.transport.get(key, self.limits.gzip_bytes).await?;
        let key = key.to_owned();
        let expected = expected.clone();
        let limits = self.limits.clone();
        self.cpu(move || decode(&key, object, &expected, &limits))
            .await
    }
    /// Success only acknowledges immutable body durability, never catalog/client publication.
    pub async fn publish(&self, record: RawRecord) -> Result<PublishOutcome, Error> {
        let deadline = Instant::now() + self.limits.deadline;
        timeout_at(deadline, async {
            let _io = self
                .io
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Capacity)?;
            let expected = record.envelope.clone();
            let limits = self.limits.clone();
            let prepared = self.cpu(move || record.prepare(&limits)).await?;
            for attempt in 0..2 {
                match self.transport.put(&prepared).await {
                    Ok(200) => return Ok(PublishOutcome::Created),
                    Ok(412)
                    | Ok(409)
                    | Ok(500..=599)
                    | Err(Error::Transport)
                    | Err(Error::Timeout) => match self.transport.head(&prepared.key).await {
                        Ok(head) => {
                            if head.length != prepared.body.len()
                                || head.metadata != prepared.metadata
                            {
                                return Err(Error::Corrupt("existing metadata/length"));
                            }
                            let restored = self.verified(&prepared.key, &expected.identity).await?;
                            if restored.envelope != expected {
                                return Err(Error::Corrupt("existing envelope"));
                            }
                            return Ok(PublishOutcome::AlreadyPresent);
                        }
                        Err(Error::NotFound) if attempt == 0 => (),
                        Err(Error::NotFound) => return Err(Error::Transport),
                        Err(e) => return Err(e),
                    },
                    Ok(status) => return Err(Error::Status(status)),
                    Err(e) => return Err(e),
                }
            }
            Err(Error::Transport)
        })
        .await
        .map_err(|_| Error::Timeout)?
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
            self.verified(&expected.object_key()?, expected).await
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
}
