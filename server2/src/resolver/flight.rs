use super::{
    AcquisitionRequest, CappedOutput, Error, FundedAcquirer, OperationContext, ResolutionRequest,
    ViewBuilder,
    backend::{CatalogBackend, ColdOutcome},
};
use crate::{
    cache::{ByteBudget, ByteLease, WeightedCache, WeightedValue},
    storage::{CatalogTransport, DependencyToken, Error as StorageError, RawRecord, sha256},
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, watch},
    time::{Instant, timeout_at},
};

#[derive(Clone)]
pub struct ResolverConfig {
    pub cache_bytes: usize,
    pub cache_entries: usize,
    pub shards: usize,
    pub operations: usize,
    pub waiters: usize,
    pub operation_bytes: usize,
    pub parsed_bytes: usize,
    pub response_bytes: usize,
    pub cpu: usize,
    pub deadline: Duration,
}
impl Default for ResolverConfig {
    fn default() -> Self {
        Self {
            cache_bytes: 128 * 1024 * 1024,
            cache_entries: 1024,
            shards: 16,
            operations: 4,
            waiters: 128,
            operation_bytes: 64 * 1024 * 1024,
            parsed_bytes: 8 * 1024 * 1024,
            response_bytes: 1024 * 1024,
            cpu: 2,
            deadline: Duration::from_secs(3),
        }
    }
}
impl ResolverConfig {
    fn validate(&self) -> Result<(), Error> {
        if self.cache_bytes == 0
            || self.cache_bytes > 512 * 1024 * 1024
            || !(1..=16384).contains(&self.cache_entries)
            || !(1..=64).contains(&self.shards)
            || !(1..=16).contains(&self.operations)
            || !(1..=1024).contains(&self.waiters)
            || self.operation_bytes < 64 * 1024 * 1024
            || self.operation_bytes > 128 * 1024 * 1024
            || self.parsed_bytes == 0
            || self.parsed_bytes > 8 * 1024 * 1024
            || self.response_bytes == 0
            || self.response_bytes > 8 * 1024 * 1024
            || !(1..=16).contains(&self.cpu)
            || self.deadline.is_zero()
            || self.deadline > Duration::from_secs(3)
        {
            return Err(StorageError::Invalid("resolver bounds").into());
        }
        Ok(())
    }
}
struct Parsed {
    bytes: Box<[u8]>,
}
struct CachedRaw {
    record: RawRecord,
}
struct CachedResponse {
    bytes: Box<[u8]>,
    created: Instant,
    refresh_due: Instant,
    expires: Instant,
    dependencies: Vec<DependencyToken>,
    epoch: u64,
}
#[derive(Clone)]
pub struct Response {
    inner: Arc<WeightedValue<CachedResponse>>,
}
impl Response {
    pub fn bytes(&self) -> &[u8] {
        &self.inner.value.bytes
    }
}
#[derive(Debug, Clone, Default)]
pub struct Metrics {
    pub hits: u64,
    pub misses: u64,
    pub refreshes: u64,
    pub shared_flights: u64,
    pub admission_rejections: u64,
    pub acquisitions: u64,
    pub publications: u64,
    pub cancelled_waiters: u64,
    pub cache_bytes: usize,
    pub retired_or_pending_bytes: usize,
    pub operation_bytes: usize,
    pub active_cpu_jobs: usize,
    pub active_owners: usize,
    pub active_waiters: usize,
}
#[derive(Default)]
struct Counters {
    hits: AtomicU64,
    misses: AtomicU64,
    refreshes: AtomicU64,
    shared: AtomicU64,
    rejections: AtomicU64,
    acquisitions: AtomicU64,
    publications: AtomicU64,
    cancelled: AtomicU64,
}
type Terminal = Option<Result<Response, Error>>;
struct Flight {
    sender: watch::Sender<Terminal>,
}
struct Core<T, A, V> {
    backend: CatalogBackend<T>,
    acquirer: Arc<A>,
    builder: Arc<V>,
    config: ResolverConfig,
    responses: WeightedCache<String, CachedResponse>,
    raw: Arc<WeightedCache<String, CachedRaw>>,
    parsed: Arc<WeightedCache<String, Parsed>>,
    budget: Arc<ByteBudget>,
    temporary: Arc<ByteBudget>,
    owners: Arc<Semaphore>,
    waiters: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
    flights: Mutex<HashMap<String, Arc<Flight>>>,
    draining: AtomicBool,
    cancelled: Arc<AtomicBool>,
    epoch: AtomicU64,
    counters: Counters,
}
pub struct Resolver<T, A, V> {
    core: Arc<Core<T, A, V>>,
}
impl<T, A, V> Clone for Resolver<T, A, V> {
    fn clone(&self) -> Self {
        Self {
            core: self.core.clone(),
        }
    }
}
struct OwnerGuard<T, A, V> {
    core: Arc<Core<T, A, V>>,
    key: String,
    flight: Arc<Flight>,
    _owner: OwnedSemaphorePermit,
    _lease: Arc<ByteLease>,
}
impl<T, A, V> Drop for OwnerGuard<T, A, V> {
    fn drop(&mut self) {
        if self.flight.sender.borrow().is_none() {
            self.flight
                .sender
                .send_replace(Some(Err(Error::TaskFailed)));
        }
        if let Ok(mut map) = self.core.flights.lock() {
            map.remove(&self.key);
        }
    }
}
struct WaiterGuard<'a> {
    finished: bool,
    counters: &'a Counters,
}
impl Drop for WaiterGuard<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.counters.cancelled.fetch_add(1, Ordering::Relaxed);
        }
    }
}
#[derive(Debug, Clone)]
/// Counts owned resolver work and its view-builder pool only. Existing backend/storage
/// codec workers have separate bounds and are not all represented by this report.
pub struct DrainReport {
    pub unfinished_owners: usize,
    pub unfinished_view_jobs: usize,
}
impl<T: CatalogTransport, A: FundedAcquirer, V: ViewBuilder> Resolver<T, A, V> {
    pub fn new(
        backend: CatalogBackend<T>,
        acquirer: A,
        builder: V,
        config: ResolverConfig,
    ) -> Result<Self, Error> {
        config.validate()?;
        let budget = ByteBudget::new(config.cache_bytes)?;
        let temporary = ByteBudget::new(
            config
                .operation_bytes
                .checked_mul(config.operations)
                .ok_or(StorageError::Capacity)?,
        )?;
        Ok(Self {
            core: Arc::new(Core {
                backend,
                acquirer: Arc::new(acquirer),
                builder: Arc::new(builder),
                responses: WeightedCache::new(budget.clone(), config.shards, config.cache_entries)?,
                raw: Arc::new(WeightedCache::new(
                    budget.clone(),
                    config.shards,
                    config.cache_entries,
                )?),
                parsed: Arc::new(WeightedCache::new(
                    budget.clone(),
                    config.shards,
                    config.cache_entries,
                )?),
                budget,
                temporary,
                owners: Arc::new(Semaphore::new(config.operations)),
                waiters: Arc::new(Semaphore::new(config.waiters)),
                cpu: Arc::new(Semaphore::new(config.cpu)),
                flights: Mutex::new(HashMap::new()),
                draining: AtomicBool::new(false),
                cancelled: Arc::new(AtomicBool::new(false)),
                epoch: AtomicU64::new(0),
                counters: Counters::default(),
                config,
            }),
        })
    }
    /// Notify any known local publication. Conservative global invalidation is bounded, immediate,
    /// and includes absence dependencies. External changes are discovered at the refresh interval.
    pub fn invalidate(&self) {
        self.core.epoch.fetch_add(1, Ordering::AcqRel);
        self.core.responses.clear();
    }
    pub fn is_draining(&self) -> bool {
        self.core.draining.load(Ordering::Acquire)
    }
    pub fn metrics(&self) -> Metrics {
        let c = &self.core.counters;
        Metrics {
            hits: c.hits.load(Ordering::Relaxed),
            misses: c.misses.load(Ordering::Relaxed),
            refreshes: c.refreshes.load(Ordering::Relaxed),
            shared_flights: c.shared.load(Ordering::Relaxed),
            admission_rejections: c.rejections.load(Ordering::Relaxed),
            acquisitions: c.acquisitions.load(Ordering::Relaxed),
            publications: c.publications.load(Ordering::Relaxed),
            cancelled_waiters: c.cancelled.load(Ordering::Relaxed),
            cache_bytes: self.core.budget.used(),
            retired_or_pending_bytes: self.core.budget.used().saturating_sub(
                self.core
                    .responses
                    .mapped_bytes()
                    .saturating_add(self.core.raw.mapped_bytes())
                    .saturating_add(self.core.parsed.mapped_bytes()),
            ),
            operation_bytes: self.core.temporary.used(),
            active_cpu_jobs: self.core.config.cpu - self.core.cpu.available_permits(),
            active_owners: self.core.config.operations - self.core.owners.available_permits(),
            active_waiters: self.core.config.waiters - self.core.waiters.available_permits(),
        }
    }
    pub async fn resolve(
        &self,
        request: ResolutionRequest,
        waiter_deadline: Instant,
    ) -> Result<Response, Error> {
        if self.core.draining.load(Ordering::Acquire) {
            return Err(Error::Draining);
        }
        let _waiter = self.core.waiters.clone().try_acquire_owned().map_err(|_| {
            self.core
                .counters
                .rejections
                .fetch_add(1, Ordering::Relaxed);
            Error::Storage(StorageError::Capacity)
        })?;
        let mut waiter_guard = WaiterGuard {
            finished: false,
            counters: &self.core.counters,
        };
        if Instant::now() >= waiter_deadline {
            return Err(StorageError::Timeout.into());
        }
        let key = request.fingerprint()?;
        let now = Instant::now();
        if let Some(hit) = self.core.responses.get(&key)
            && hit.value.epoch == self.core.epoch.load(Ordering::Acquire)
            && now < hit.value.refresh_due
            && now < hit.value.expires
        {
            self.core.counters.hits.fetch_add(1, Ordering::Relaxed);
            waiter_guard.finished = true;
            return Ok(Response { inner: hit });
        }
        let mut receiver = {
            let mut map = self.core.flights.lock().map_err(|_| Error::TaskFailed)?;
            if self.core.draining.load(Ordering::Acquire) {
                return Err(Error::Draining);
            }
            if let Some(flight) = map.get(&key) {
                self.core.counters.shared.fetch_add(1, Ordering::Relaxed);
                flight.sender.subscribe()
            } else {
                let owner = self.core.owners.clone().try_acquire_owned().map_err(|_| {
                    self.core
                        .counters
                        .rejections
                        .fetch_add(1, Ordering::Relaxed);
                    Error::Storage(StorageError::Capacity)
                })?;
                let lease = Arc::new(
                    self.core
                        .temporary
                        .reserve(self.core.config.operation_bytes)?,
                );
                let (sender, receiver) = watch::channel(None);
                let flight = Arc::new(Flight { sender });
                map.insert(key.clone(), flight.clone());
                let deadline = Instant::now() + self.core.config.deadline;
                let core = self.core.clone();
                let guard = OwnerGuard {
                    core: core.clone(),
                    key: key.clone(),
                    flight,
                    _owner: owner,
                    _lease: lease.clone(),
                };
                tokio::spawn(async move {
                    let context = OperationContext {
                        deadline,
                        cancelled: core.cancelled.clone(),
                    };
                    let publishing = Arc::new(AtomicBool::new(false));
                    let result = match timeout_at(
                        context.deadline(),
                        Self::execute(core, key, request, context, lease, publishing.clone()),
                    )
                    .await
                    {
                        Ok(r) => r,
                        Err(_) => Err(if publishing.load(Ordering::Acquire) {
                            StorageError::Ambiguous
                        } else {
                            StorageError::Timeout
                        }
                        .into()),
                    };
                    guard.flight.sender.send_replace(Some(result));
                    drop(guard);
                });
                receiver
            }
        };
        let result = timeout_at(waiter_deadline, async {
            loop {
                let terminal = receiver.borrow().clone();
                if let Some(result) = terminal {
                    return result;
                }
                receiver.changed().await.map_err(|_| Error::TaskFailed)?;
            }
        })
        .await
        .map_err(|_| Error::Storage(StorageError::Timeout))?;
        waiter_guard.finished = true;
        result
    }
    async fn execute(
        core: Arc<Core<T, A, V>>,
        key: String,
        request: ResolutionRequest,
        context: OperationContext,
        lease: Arc<ByteLease>,
        publishing: Arc<AtomicBool>,
    ) -> Result<Response, Error> {
        let old = core.responses.get(&key);
        let epoch = core.epoch.load(Ordering::Acquire);
        if let Some(old) = old
            && old.value.epoch == epoch
            && Instant::now() < old.value.expires
        {
            core.counters.refreshes.fetch_add(1, Ordering::Relaxed);
            let mut unchanged = true;
            for token in &old.value.dependencies {
                match core
                    .backend
                    .dependency(token, &context, lease.clone())
                    .await
                {
                    Ok(current) if current == *token => (),
                    Ok(_) => {
                        unchanged = false;
                        break;
                    }
                    Err(Error::Storage(
                        StorageError::Transport
                        | StorageError::Timeout
                        | StorageError::Status(500..=599),
                    )) if Instant::now() < old.value.expires
                        && core.epoch.load(Ordering::Acquire) == epoch =>
                    {
                        return Ok(Response { inner: old });
                    }
                    Err(e) => return Err(e),
                }
            }
            if unchanged && core.epoch.load(Ordering::Acquire) == epoch {
                let weight = old.weight();
                let cached = CachedResponse {
                    bytes: old.value.bytes.clone(),
                    created: old.value.created,
                    refresh_due: (Instant::now() + request.refresh).min(old.value.expires),
                    expires: old.value.expires,
                    dependencies: old.value.dependencies.clone(),
                    epoch,
                };
                return Ok(Response {
                    inner: core.responses.insert(key, cached, weight)?,
                });
            }
            core.responses.remove(&key);
        }
        core.counters.misses.fetch_add(1, Ordering::Relaxed);
        let mut published = false;
        let input = match core.backend.cold(&request, &context).await? {
            ColdOutcome::Input(i) => i,
            ColdOutcome::Empty => {
                context.check()?;
                core.counters.acquisitions.fetch_add(1, Ordering::Relaxed);
                let acquisition = core
                    .acquirer
                    .acquire(
                        AcquisitionRequest {
                            request: request.clone(),
                        },
                        context.clone(),
                    )
                    .await?;
                context.check()?;
                publishing.store(true, Ordering::Release);
                let i = core
                    .backend
                    .publish(&request, acquisition, &context)
                    .await?;
                let previous = core.epoch.fetch_add(1, Ordering::AcqRel);
                core.responses.clear();
                if previous != epoch {
                    return Err(Error::Incomplete);
                }
                published = true;
                core.counters.publications.fetch_add(1, Ordering::Relaxed);
                i
            }
        };
        let expected_epoch = epoch + u64::from(published);
        if core.epoch.load(Ordering::Acquire) != expected_epoch {
            return Err(Error::Incomplete);
        }
        let epoch = expected_epoch;
        let permit = timeout_at(context.deadline(), core.cpu.clone().acquire_owned())
            .await
            .map_err(|_| StorageError::Timeout)?
            .map_err(|_| StorageError::Capacity)?;
        let builder = core.builder.clone();
        let parsed_cache = core.parsed.clone();
        let raw_cache = core.raw.clone();
        let config = core.config.clone();
        let req = request.clone();
        let (bytes, dependencies, excluded) = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let _lease = lease;
            let mut parsed = Vec::new();
            let mut retained = 0usize;
            for acquisition in &input.acquisitions {
                let mut ids = Vec::new();
                for record in acquisition {
                    let object_key = record.envelope.identity.object_key()?;
                    let weight = record.bytes.len()
                        + object_key.len()
                        + serde_json::to_vec(&record.envelope)
                            .map_err(|_| StorageError::Invalid("raw cache envelope"))?
                            .len()
                        + 128;
                    // Raw identity validation happened in S05/S06. Pins are charged even if evicted.
                    if let Some(old) = raw_cache.get(&object_key) {
                        if old.value.record.envelope != record.envelope
                            || old.value.record.bytes != record.bytes
                        {
                            return Err(StorageError::Corrupt("raw cache identity").into());
                        }
                    } else {
                        let _ = raw_cache.insert(
                            object_key.clone(),
                            CachedRaw {
                                record: record.clone(),
                            },
                            weight,
                        )?;
                    }
                    ids.push(object_key);
                }
                let cache_key = sha256(
                    &serde_json::to_vec(&(&ids, req.response.parser_revision()))
                        .map_err(|_| StorageError::Invalid("parsed key"))?,
                );
                let value = if let Some(hit) = parsed_cache.get(&cache_key) {
                    hit
                } else {
                    let views = acquisition
                        .iter()
                        .map(|r| super::RawView {
                            envelope: &r.envelope,
                            bytes: &r.bytes,
                        })
                        .collect::<Vec<_>>();
                    let mut output = CappedOutput::new(config.parsed_bytes);
                    builder.parse(&views, req.response.parser_revision(), &mut output)?;
                    let bytes = output.finish();
                    let weight = bytes.len()
                        + cache_key.len()
                        + ids.iter().map(String::len).sum::<usize>()
                        + req.response.parser_revision().len()
                        + 128;
                    parsed_cache.insert(cache_key, Parsed { bytes }, weight)?
                };
                retained = retained
                    .checked_add(value.value.bytes.len())
                    .ok_or(StorageError::Capacity)?;
                if retained > config.parsed_bytes {
                    return Err(StorageError::Capacity.into());
                }
                parsed.push(value);
            }
            let views = parsed
                .iter()
                .map(|v| v.value.bytes.as_ref())
                .collect::<Vec<_>>();
            let mut output = CappedOutput::new(config.response_bytes);
            builder.assemble(&req, &input, &views, &mut output)?;
            Ok::<_, Error>((output.finish(), input.dependencies, input.excluded))
        })
        .await
        .map_err(|_| Error::TaskFailed)??;
        context.check()?;
        if core.epoch.load(Ordering::Acquire) != epoch {
            return Err(Error::Incomplete);
        }
        let now = Instant::now();
        let metadata = serde_json::to_vec(
            &dependencies
                .iter()
                .map(|d| (&d.identity, d.generation, &d.etag, &d.version))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| StorageError::Invalid("dependency weight"))?;
        let weight = bytes.len() + key.len() + request.key_weight()? + metadata.len() + 256;
        let value = CachedResponse {
            bytes,
            created: now,
            refresh_due: now + request.refresh,
            expires: now + request.ttl,
            dependencies,
            epoch,
        };
        let cached = if excluded > 0 {
            WeightedValue::charged(value, &core.budget, weight)?
        } else {
            core.responses.insert(key, value, weight)?
        }; // Missing descriptor arrival is not detectable by target ETag alone.
        Ok(Response { inner: cached })
    }
    pub async fn drain(&self, deadline: Instant) -> Result<DrainReport, Error> {
        {
            let _map = self.core.flights.lock().map_err(|_| Error::TaskFailed)?;
            self.core.draining.store(true, Ordering::Release);
        }
        let owners = self
            .core
            .owners
            .clone()
            .acquire_many_owned(self.core.config.operations as u32);
        let owner_permit = timeout_at(deadline, owners).await;
        if owner_permit.is_err() {
            self.core.cancelled.store(true, Ordering::Release);
        }
        let cpu = timeout_at(
            deadline,
            self.core
                .cpu
                .clone()
                .acquire_many_owned(self.core.config.cpu as u32),
        )
        .await;
        let result = DrainReport {
            unfinished_owners: if owner_permit.is_ok() {
                0
            } else {
                self.core.config.operations - self.core.owners.available_permits()
            },
            unfinished_view_jobs: if cpu.is_ok() {
                0
            } else {
                self.core.config.cpu - self.core.cpu.available_permits()
            },
        };
        drop(owner_permit);
        drop(cpu);
        Ok(result)
    }
}
