//! Source-local immutable forecast views. Limits are logical admission policy, not RSS.
use super::{Coord, Doc, Family, Fetched, MidModel, fetch, grid_input_id, records::Reader};
use crate::cache::{ByteBudget, ByteLease, WeightedCache, WeightedValue};
use crate::history::{Grid, IndexListing, schedule};
use crate::resolver::{OwnedConfig, OwnedFlights, Waited};
use crate::storage::{Error, ProviderKey};
use crate::summary::InputId;
use std::{
    collections::HashMap,
    mem::size_of,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::Instant,
};

const MIB: usize = 1024 * 1024;
pub(super) const PAGE_BYTES: usize = MIB;
pub(super) const DOCS: usize = 4096;
pub(super) const PARSE_BYTES: usize = 48 * MIB;
const RAW_BYTES: usize = 32 * MIB;
const DOC_BYTES: usize = 8 * MIB;
const ID_BYTES: usize = 4 * MIB;
const ENTRY_BYTES: usize = 48 * MIB;
const WORKSPACE: usize = 192 * MIB;
const OWNER: Duration = Duration::from_secs(8);

pub(super) fn add(a: usize, b: usize) -> Result<usize, Error> {
    a.checked_add(b).ok_or(Error::Capacity)
}
pub(super) fn allocation(capacity: usize) -> Result<usize, Error> {
    add(capacity, 79).map(|n| n & !15)
}
pub(super) fn vector<T>(v: &Vec<T>) -> Result<usize, Error> {
    allocation(
        v.capacity()
            .checked_mul(size_of::<T>())
            .ok_or(Error::Capacity)?,
    )
}
pub(super) fn reserve<T>(v: &mut Vec<T>, additional: usize) -> Result<(), Error> {
    v.try_reserve_exact(additional).map_err(|_| Error::Capacity)
}
pub(super) fn copied(s: &str) -> Result<String, Error> {
    let mut out = String::new();
    out.try_reserve_exact(s.len())
        .map_err(|_| Error::Capacity)?;
    out.push_str(s);
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum Key {
    Grid(Family, u16, u16),
    Rss(u16, u16),
    Mid(MidModel, String),
}
impl Key {
    pub(super) fn source(&self) -> &'static str {
        if matches!(self, Self::Rss(..)) {
            "kma-web"
        } else {
            "data-go-kr"
        }
    }
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Self::Grid(Family::Current, ..) => "ultra-srt-ncst",
            Self::Grid(Family::Shortest, ..) => "ultra-srt-fcst",
            Self::Grid(Family::Short, ..) => "vilage-fcst",
            Self::Rss(..) => "town-rss",
            Self::Mid(MidModel::Forecast, _) => "mid-fcst",
            Self::Mid(MidModel::Land, _) => "mid-land-fcst",
            Self::Mid(MidModel::Temp, _) => "mid-ta",
        }
    }
    pub(super) fn provider(&self) -> ProviderKey {
        match self {
            Self::Grid(_, x, y) | Self::Rss(x, y) => {
                Grid::new(*x, *y).expect("checked grid").provider_key()
            }
            Self::Mid(model, code) => ProviderKey::Named {
                id: format!(
                    "{}-{}",
                    if *model == MidModel::Forecast {
                        "stn"
                    } else {
                        "reg"
                    },
                    code.to_ascii_lowercase()
                ),
            },
        }
    }
}
/// Arc roots, backing capacities and descendants, with fixed logical allocator allowance.
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct Charge {
    pub raw: usize,
    pub docs: usize,
    pub identities: usize,
    pub total: usize,
    pub serialized: usize,
}
#[derive(Debug, serde::Serialize)]
pub struct Stats {
    pub mapped_entries: usize,
    pub retained_logical_bytes: usize,
    pub active_workspace_logical_bytes: usize,
    pub parse_acquisitions: u64,
    pub folds: u64,
    pub identity_renewals: u64,
    pub disk_restores: u64,
    pub last_built: Vec<(String, Charge)>,
    pub active_owners: usize,
    pub queued_keys: usize,
    pub admitted_keys: usize,
    pub waiting_callers: usize,
}
#[derive(Default)]
struct Counters {
    parses: AtomicU64,
    folds: AtomicU64,
    renewals: AtomicU64,
    restores: AtomicU64,
}
pub(super) struct View {
    pub(super) docs: Vec<Doc>,
    pub(super) raw: Vec<Fetched>,
    pub(super) ids: Option<Vec<InputId>>,
    pub(super) usable: Vec<String>,
    complete: bool,
    wall: f64,
    future: f64,
    checked: Mutex<Checked>,
    manifest: super::forecast_manifest::Manifest,
    epoch: u64,
    _state: Option<Arc<Mutex<Epoch>>>,
    pub(super) charge: Charge,
    _parent: Option<Pin>,
}
struct Checked {
    wall: f64,
    at: Instant,
}
pub(super) type Pin = Arc<WeightedValue<View>>;
#[derive(Clone, Default)]
pub(super) struct Documents(pub(super) Option<Pin>);
impl std::ops::Deref for Documents {
    type Target = [Doc];
    fn deref(&self) -> &[Doc] {
        self.0.as_ref().map_or(&[], |v| v.value.docs.as_slice())
    }
}
impl View {
    fn fresh(&self, now: f64) -> bool {
        now.is_finite()
            && now >= self.wall
            && now < self.future
            && self.checked.lock().is_ok_and(|c| now >= c.wall)
    }
    fn validated(&self, now: f64) -> bool {
        self.checked.lock().is_ok_and(|c| {
            now >= c.wall && now - c.wall < 30_000. && c.at.elapsed() < Duration::from_secs(30)
        })
    }
    pub(super) fn present(&self, partition: &str, now: f64) -> bool {
        self.raw
            .iter()
            .any(|f| f.partition == partition && f.fetched_at_ms as f64 <= now)
    }
    fn weigh(&self, key: &Key) -> Result<Charge, Error> {
        let mut raw = vector(&self.raw)?;
        let mut payload = 0usize;
        let mut ids = allocation(add(
            size_of::<WeightedValue<Self>>(),
            2 * size_of::<usize>(),
        )?)?;
        for f in &self.raw {
            ids = add(ids, allocation(f.partition.capacity())?)?;
            ids = add(ids, vector(&f.pages)?)?;
            for p in &f.pages {
                payload = add(payload, p.len())?;
                raw = add(raw, allocation(add(p.len(), 2 * size_of::<usize>())?)?)?;
            }
        }
        let mut docs = vector(&self.docs)?;
        for d in &self.docs {
            docs = add(docs, d.heap_weight()?)?;
        }
        if let Some(list) = &self.ids {
            ids = add(ids, vector(list)?)?;
            for id in list {
                ids = add(
                    ids,
                    add(
                        allocation(id.family.capacity())?,
                        allocation(id.content_sha256.capacity())?,
                    )?,
                )?;
            }
        }
        ids = add(ids, vector(&self.usable)?)?;
        for p in &self.usable {
            ids = add(ids, allocation(p.capacity())?)?;
        }
        ids = add(ids, allocation(size_of::<Key>())?)?;
        if let Key::Mid(_, s) = key {
            ids = add(ids, allocation(s.capacity())?)?;
        }
        ids = add(ids, self.manifest.weight()?)?;
        let total = add(add(raw, docs)?, ids)?;
        if payload > RAW_BYTES || docs > DOC_BYTES || ids > ID_BYTES || total > ENTRY_BYTES {
            return Err(Error::Capacity);
        }
        Ok(Charge {
            raw,
            docs,
            identities: ids,
            total,
            serialized: 0,
        })
    }
}
#[derive(Default)]
struct Epoch {
    value: u64,
    writers: usize,
    poisoned: bool,
    disk_wall_floor: f64,
}
type FlightKey = (Key, u64, Option<(u64, String)>);

struct Inner<T> {
    reader: Reader<T>,
    map: WeightedCache<Key, View>,
    budget: Arc<ByteBudget>,
    _metadata: ByteLease,
    epochs: Mutex<HashMap<Key, Arc<Mutex<Epoch>>>>,
    flights: OwnedFlights<FlightKey, Result<Pin, String>>,
    owners: Arc<Semaphore>,
    queued: Arc<Semaphore>,
    waiters: Arc<Semaphore>,
    cpu: Arc<Semaphore>,
    workspace: Arc<ByteBudget>,
    charges: Mutex<Vec<(Key, Charge)>>,
    counters: Arc<Counters>,
}
pub(super) struct Cache<T>(Arc<Inner<T>>);
impl<T> Clone for Cache<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
pub(super) struct Workspace {
    _slot: OwnedSemaphorePermit,
    _bytes: ByteLease,
}
impl<T: IndexListing + Clone + Send + Sync + 'static> Cache<T> {
    pub(super) fn new(reader: Reader<T>) -> Result<Self, Error> {
        Self::with_limits(reader, 128 * MIB)
    }
    fn with_limits(reader: Reader<T>, maximum: usize) -> Result<Self, Error> {
        let budget = ByteBudget::new(maximum)?;
        let metadata = budget.reserve(MIB)?;
        let mut charges = Vec::new();
        reserve(&mut charges, 128)?;
        Ok(Self(Arc::new(Inner {
            reader,
            map: WeightedCache::new(budget.clone(), 1, 128)?,
            budget,
            _metadata: metadata,
            epochs: Mutex::new(HashMap::new()),
            flights: OwnedFlights::new(OwnedConfig {
                running: 10,
                entries: 10,
                retain: Duration::ZERO,
            })
            .map_err(|_| Error::Capacity)?,
            owners: Arc::new(Semaphore::new(2)),
            queued: Arc::new(Semaphore::new(8)),
            waiters: Arc::new(Semaphore::new(128)),
            cpu: Arc::new(Semaphore::new(2)),
            workspace: ByteBudget::new(2 * WORKSPACE)?,
            charges: Mutex::new(charges),
            counters: Arc::new(Counters::default()),
        })))
    }
    pub(super) fn stats(&self) -> Stats {
        let charges = self.0.charges.lock().unwrap_or_else(|e| e.into_inner());
        Stats {
            mapped_entries: self.0.map.entries(),
            retained_logical_bytes: self.0.budget.used(),
            active_workspace_logical_bytes: self.0.workspace.used(),
            parse_acquisitions: self.0.counters.parses.load(Ordering::Relaxed),
            folds: self.0.counters.folds.load(Ordering::Relaxed),
            identity_renewals: self.0.counters.renewals.load(Ordering::Relaxed),
            disk_restores: self.0.counters.restores.load(Ordering::Relaxed),
            last_built: charges
                .iter()
                .map(|(key, c)| (format!("{key:?}"), *c))
                .collect(),
            active_owners: 2 - self.0.owners.available_permits(),
            queued_keys: 8 - self.0.queued.available_permits(),
            admitted_keys: self.0.flights.running(),
            waiting_callers: 128 - self.0.waiters.available_permits(),
        }
    }
    pub(super) fn wrap(
        &self,
        inner: Arc<dyn fetch::ForecastAcquire>,
    ) -> Arc<dyn fetch::ForecastAcquire> {
        Arc::new(Writer {
            inner,
            cache: self.clone(),
        })
    }
    fn state(&self, key: &Key) -> Result<Arc<Mutex<Epoch>>, Error> {
        let mut states = self.0.epochs.lock().map_err(|_| Error::Transport)?;
        if let Some(state) = states.get(key) {
            return Ok(state.clone());
        }
        // A retained view, build or writer pins its identity. Never recycle a live fence.
        states.retain(|_, state| Arc::strong_count(state) > 1);
        if states.len() >= 256 {
            return Err(Error::Capacity);
        }
        states.try_reserve(1).map_err(|_| Error::Capacity)?;
        let state = Arc::new(Mutex::new(Epoch::default()));
        states.insert(key.clone(), state.clone());
        Ok(state)
    }
    pub(super) async fn get(&self, key: Key, now: f64, until: Instant) -> Result<Pin, String> {
        if !now.is_finite() {
            return Err("forecast clock".into());
        }
        loop {
            {
                let fence = self.state(&key).map_err(|_| "forecast epoch capacity")?;
                let mut state = fence.lock().map_err(|_| "forecast epoch")?;
                if state.poisoned {
                    return Err("forecast epoch capacity".into());
                }
                if state.writers == 0
                    && let Some(pin) = self.0.map.get(&key)
                {
                    if pin.value.epoch == state.value && pin.value.fresh(now) {
                        if pin.value.validated(now) {
                            return Ok(pin);
                        }
                    } else {
                        if let Ok(checked) = pin.value.checked.lock()
                            && now < checked.wall
                        {
                            state.disk_wall_floor = state.disk_wall_floor.max(checked.wall);
                        }
                        self.0.map.remove(&key);
                    }
                }
            }
            match self.join(key.clone(), now, until, None).await {
                Err(reason) if reason == "forecast view boundary" && Instant::now() < until => {
                    // A concurrent writer or a different selector clock can retire this
                    // flight. Rejoin the current generation within the original deadline.
                    tokio::task::yield_now().await;
                }
                result => return result,
            }
        }
    }
    pub(super) async fn overlay(
        &self,
        key: Key,
        parent: Pin,
        own: Fetched,
        now: f64,
        until: Instant,
    ) -> Result<Pin, String> {
        self.join(key, now, until, Some((parent, own))).await
    }
    async fn join(
        &self,
        key: Key,
        now: f64,
        until: Instant,
        overlay: Option<(Pin, Fetched)>,
    ) -> Result<Pin, String> {
        let _waiter = self
            .0
            .waiters
            .clone()
            .try_acquire_owned()
            .map_err(|_| "forecast waiter capacity")?;
        let fence = self.state(&key).map_err(|_| "forecast epoch capacity")?;
        let epoch = fence.lock().map_err(|_| "forecast epoch")?.value;
        let is_overlay = overlay.is_some();
        let flight_key = (
            key.clone(),
            epoch,
            overlay
                .as_ref()
                .map(|(_, f)| (f.fetched_at_ms, super::identity(f).2)),
        );
        let cache = self.clone();
        let build_fence = fence.clone();
        let start = move |deadline| async move {
            cache
                .build(key, now, deadline, overlay, build_fence, epoch)
                .await
                .map_err(|e| format!("forecast cache: {e}"))
        };
        // Library callers may supply a longer diagnostic deadline. Native callers retain
        // their existing <=3s bound; the owner always has the same fixed eight seconds.
        let waited = if until.saturating_duration_since(Instant::now())
            > crate::resolver::owned::WAITER_BOUND
        {
            match tokio::time::timeout_at(until, self.0.flights.wait(flight_key, OWNER, start))
                .await
            {
                Ok(waited) => waited,
                Err(_) => return Err("forecast view unavailable".into()),
            }
        } else {
            self.0.flights.join(flight_key, until, OWNER, start).await
        };
        match waited {
            Waited::Ready(result) => result.and_then(|pin| {
                let state = fence.lock().map_err(|_| "forecast epoch")?;
                if pin.value.fresh(now)
                    && (is_overlay
                        || (!state.poisoned
                            && state.value == epoch
                            && (state.writers == 0
                                || (!pin.value.complete && pin.value.ids.is_none()))))
                {
                    Ok(pin)
                } else {
                    Err("forecast view boundary".into())
                }
            }),
            _ => Err("forecast view unavailable".into()),
        }
    }
    async fn build(
        &self,
        key: Key,
        now: f64,
        deadline: Instant,
        overlay: Option<(Pin, Fetched)>,
        fence: Arc<Mutex<Epoch>>,
        epoch: u64,
    ) -> Result<Pin, Error> {
        let admitted = Instant::now();
        let slot = match self.0.owners.clone().try_acquire_owned() {
            Ok(slot) => slot,
            Err(_) => {
                let queue = self
                    .0
                    .queued
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| Error::Capacity)?;
                let slot = self
                    .0
                    .owners
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| Error::Capacity)?;
                drop(queue);
                slot
            }
        };
        let workspace = Arc::new(Workspace {
            _slot: slot,
            _bytes: self.0.workspace.reserve(WORKSPACE)?,
        });
        if overlay.is_none() {
            let cached = self
                .0
                .map
                .get(&key)
                .filter(|pin| pin.value.epoch == epoch && pin.value.fresh(now));
            if let Some(pin) = cached {
                if pin
                    .value
                    .manifest
                    .unchanged(&self.0.reader, &key, now, deadline)
                    .await
                    .unwrap_or(false)
                {
                    let state = fence.lock().map_err(|_| Error::Transport)?;
                    if !state.poisoned
                        && state.writers == 0
                        && state.value == epoch
                        && pin.value.fresh(now)
                    {
                        *pin.value.checked.lock().map_err(|_| Error::Transport)? = Checked {
                            wall: now,
                            at: admitted,
                        };
                        self.0.counters.renewals.fetch_add(1, Ordering::Relaxed);
                        return Ok(pin);
                    }
                }
                let state = fence.lock().map_err(|_| Error::Transport)?;
                if state.value == epoch {
                    self.0.map.remove(&key);
                }
            }
        }
        if overlay.is_none()
            && let Some(pin) = self
                .restore(&key, now, deadline, &workspace, &fence, epoch, admitted)
                .await?
        {
            return Ok(pin);
        }
        let (raw, excluded, parent, original, manifest) = if let Some((parent, own)) = overlay {
            let mut raw = Vec::new();
            reserve(&mut raw, parent.value.raw.len() + 1)?;
            for f in &parent.value.raw {
                raw.push(f.checked_clone()?);
            }
            let original = if let Key::Grid(family, ..) = &key {
                grid_input_id(*family, key.kind(), &own)
            } else {
                None
            };
            raw.push(super::visible(own, now));
            (
                raw,
                usize::from(!parent.value.complete),
                Some(parent),
                original,
                super::forecast_manifest::Manifest::default(),
            )
        } else {
            let (raw, excluded, manifest) =
                self.read(&key, now, deadline, workspace.clone()).await?;
            (raw, excluded, None, None, manifest)
        };
        let cpu = self
            .0
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Capacity)?;
        let work_key = key.clone();
        let counters = self.0.counters.clone();
        // The closure pins its own guards; the owner retains workspace through validation.
        let fold_workspace = workspace.clone();
        let mut view = tokio::task::spawn_blocking(move || {
            let (_workspace, _cpu) = (fold_workspace, cpu);
            build_view(
                &work_key, raw, excluded, now, admitted, epoch, parent, original, &counters,
            )
        })
        .await
        .map_err(|_| Error::Transport)??;
        view.manifest = manifest;
        if view.complete
            && view._parent.is_none()
            && !view
                .manifest
                .unchanged(&self.0.reader, &key, now, deadline)
                .await
                .unwrap_or(false)
        {
            view.complete = false;
            view.ids = None;
        }
        view.charge = view.weigh(&key)?;
        view._state = Some(fence.clone());
        let disk_key = super::forecast_disk::key(&key);
        let writer = if view.complete && view._parent.is_none() {
            self.0
                .reader
                .transport
                .raw_cache()
                .and_then(|d| d.forecast_writer(&disk_key))
        } else {
            None
        };
        let (mut view, encoded) = if writer.is_some() {
            let cpu = self
                .0
                .cpu
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| Error::Capacity)?;
            let lease = workspace.clone();
            let encode_key = key.clone();
            tokio::task::spawn_blocking(move || {
                let (_lease, _cpu) = (lease, cpu);
                let encoded = super::forecast_disk::encode(
                    &encode_key,
                    &view.docs,
                    &view.raw,
                    view.ids.as_deref(),
                    &view.usable,
                    view.wall,
                    view.future,
                    &view.manifest,
                )
                .ok();
                (view, encoded)
            })
            .await
            .map_err(|_| Error::Transport)?
        } else {
            (view, None)
        };
        if let Some(bytes) = &encoded {
            view.charge.serialized = bytes.len();
        }
        let state = fence.lock().map_err(|_| Error::Transport)?;
        if state.poisoned {
            return Err(Error::Capacity);
        }
        if view._parent.is_none() && (state.writers != 0 || state.value != epoch) {
            // Request-local reconstruction remains usable while acquisition runs, but
            // its set cannot attest completeness or enter either canonical cache.
            // An overlay keeps its immutable parent's completeness and original IDs;
            // concurrent backfill cannot change the inputs this request already read.
            view.complete = false;
            view.ids = None;
        }
        let weight = view.charge.total;
        {
            let mut charges = self.0.charges.lock().map_err(|_| Error::Transport)?;
            if let Some((_, charge)) = charges.iter_mut().find(|(k, _)| k == &key) {
                *charge = view.charge;
            } else if charges.len() < 128 {
                charges.push((key.clone(), view.charge));
            }
        }
        if Instant::now() < deadline
            && view.complete
            && view._parent.is_none()
            && state.writers == 0
            && state.value == epoch
            && view.fresh(now)
        {
            if let (Some(writer), Some(body)) = (writer, encoded) {
                writer.enqueue(crate::storage::Object {
                    length: body.len(),
                    body,
                    metadata: Default::default(),
                });
            }
            self.0.map.insert(key, view, weight)
        } else {
            WeightedValue::charged(view, &self.0.budget, weight)
        }
    }
    /// A disk copy is never authoritative: controls, selectors and the current key fence gate it.
    #[allow(clippy::too_many_arguments)]
    async fn restore(
        &self,
        key: &Key,
        now: f64,
        deadline: Instant,
        workspace: &Arc<Workspace>,
        fence: &Arc<Mutex<Epoch>>,
        epoch: u64,
        admitted: Instant,
    ) -> Result<Option<Pin>, Error> {
        let Some(disk) = self.0.reader.transport.raw_cache() else {
            return Ok(None);
        };
        {
            let state = fence.lock().map_err(|_| Error::Transport)?;
            if state.poisoned || state.writers != 0 || state.value != epoch {
                return Ok(None);
            }
        }
        let Some(object) = disk
            .load_forecast(
                &super::forecast_disk::key(key),
                super::forecast_disk::MAXIMUM,
            )
            .await
        else {
            return Ok(None);
        };
        let bytes = object.body.len();
        let cpu = self
            .0
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Capacity)?;
        let lease = workspace.clone();
        let decode_key = key.clone();
        let decoded = tokio::task::spawn_blocking(move || {
            let (_lease, _cpu) = (lease, cpu);
            super::forecast_disk::decode(&decode_key, &object.body)
        })
        .await
        .map_err(|_| Error::Transport)?;
        let Ok(p) = decoded else {
            return Ok(None);
        };
        let future = p
            .raw
            .iter()
            .filter(|f| f.fetched_at_ms as f64 > p.wall)
            .map(|f| f.fetched_at_ms as f64)
            .fold(f64::INFINITY, f64::min);
        if p.expiry != boundary(key, &p.raw, p.wall).min(future) {
            return Ok(None);
        }
        let mut view = View {
            docs: p.docs,
            raw: p.raw,
            ids: p.ids,
            usable: p.usable,
            complete: true,
            wall: p.wall,
            future: p.expiry,
            checked: Mutex::new(Checked {
                wall: p.wall,
                at: admitted,
            }),
            manifest: p.manifest,
            epoch,
            _state: Some(fence.clone()),
            charge: Charge::default(),
            _parent: None,
        };
        if !view.fresh(now)
            || !view
                .manifest
                .unchanged(&self.0.reader, key, now, deadline)
                .await
                .unwrap_or(false)
        {
            return Ok(None);
        }
        view.charge = match view.weigh(key) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        view.charge.serialized = bytes;
        *view.checked.lock().map_err(|_| Error::Transport)? = Checked {
            wall: now,
            at: admitted,
        };
        let state = fence.lock().map_err(|_| Error::Transport)?;
        if state.poisoned
            || state.writers != 0
            || state.value != epoch
            || view.wall < state.disk_wall_floor
            || Instant::now() >= deadline
        {
            return Ok(None);
        }
        let charge = view.charge;
        if let Ok(pin) = self.0.map.insert(key.clone(), view, charge.total) {
            let mut charges = self.0.charges.lock().map_err(|_| Error::Transport)?;
            if let Some((_, old)) = charges.iter_mut().find(|(k, _)| k == key) {
                *old = charge;
            } else if charges.len() < 128 {
                charges.push((key.clone(), charge));
            }
            self.0.counters.restores.fetch_add(1, Ordering::Relaxed);
            Ok(Some(pin))
        } else {
            Ok(None)
        }
    }
    async fn read(
        &self,
        key: &Key,
        now: f64,
        deadline: Instant,
        workspace: Arc<Workspace>,
    ) -> Result<(Vec<Fetched>, usize, super::forecast_manifest::Manifest), Error> {
        let provider = key.provider();
        let reader = &self.0.reader;
        let mut scope = super::records::ForecastScope::default();
        let mut raw = Vec::new();
        let mut excluded = 0usize;
        match key {
            Key::Grid(..) | Key::Rss(..) => {
                let from = now
                    - match key {
                        Key::Grid(family, ..) => super::lookback_ms(*family),
                        _ => super::RSS_LOOKBACK_MS,
                    };
                let months = super::records::months(from, now);
                let oldest = schedule::from_ms(from as i64).partition();
                let parts = reader
                    .forecast_partitions(
                        key.source(),
                        key.kind(),
                        &provider,
                        &months,
                        &mut scope,
                        deadline,
                    )
                    .await?;
                for part in parts.into_iter().filter(|p| *p >= oldest) {
                    let (mut found, e) = reader
                        .forecast_acquisitions(
                            key.source(),
                            key.kind(),
                            &provider,
                            &part,
                            &mut scope,
                            deadline,
                        )
                        .await?;
                    excluded = add(excluded, e)?;
                    reserve(&mut raw, found.len())?;
                    raw.append(&mut found);
                }
            }
            Key::Mid(..) => {
                for month in checked_months(now)?.into_iter().rev() {
                    let parts = reader
                        .forecast_partitions(
                            key.source(),
                            key.kind(),
                            &provider,
                            &[month],
                            &mut scope,
                            deadline,
                        )
                        .await?;
                    for part in parts {
                        let (mut found, e) = reader
                            .forecast_acquisitions(
                                key.source(),
                                key.kind(),
                                &provider,
                                &part,
                                &mut scope,
                                deadline,
                            )
                            .await?;
                        excluded = add(excluded, e)?;
                        reserve(&mut raw, found.len())?;
                        raw.append(&mut found);
                    }
                    // The older fallback must retain exclusions from every searched newer month.
                    if let Key::Mid(model, code) = key {
                        let mut inputs = Vec::new();
                        reserve(&mut inputs, raw.len())?;
                        for f in &raw {
                            inputs.push(f.checked_clone()?);
                        }
                        let (model, code) = (*model, copied(code)?);
                        let lease = workspace.clone();
                        let counters = self.0.counters.clone();
                        let cpu = self
                            .0
                            .cpu
                            .clone()
                            .acquire_owned()
                            .await
                            .map_err(|_| Error::Capacity)?;
                        inputs.sort_by(|a, b| {
                            a.fetched_at_ms
                                .cmp(&b.fetched_at_ms)
                                .then_with(|| a.partition.cmp(&b.partition))
                        });
                        let found = tokio::task::spawn_blocking(move || {
                            let (_lease, _cpu) = (lease, cpu);
                            fold_mid(model, &code, &inputs, now, &counters)
                        })
                        .await
                        .map_err(|_| Error::Transport)??;
                        if !found.is_empty() {
                            break;
                        }
                    }
                }
            }
        }
        raw.sort_by(|a, b| {
            a.fetched_at_ms
                .cmp(&b.fetched_at_ms)
                .then_with(|| a.partition.cmp(&b.partition))
        });
        scope.manifest.normalize();
        Ok((raw, excluded, scope.manifest))
    }
}

// Keep canonical set/completeness, wall+monotonic expiry, writer epoch, overlay
// parent/original identity and counters explicit at the owned blocking boundary.
#[allow(clippy::too_many_arguments)]
fn build_view(
    key: &Key,
    raw: Vec<Fetched>,
    excluded: usize,
    now: f64,
    admitted: Instant,
    epoch: u64,
    parent: Option<Pin>,
    original: Option<InputId>,
    counters: &Counters,
) -> Result<View, Error> {
    let mut pages = 0usize;
    let mut bytes = 0usize;
    if raw.len() > 2048 {
        return Err(Error::Capacity);
    }
    for f in &raw {
        pages = add(pages, f.pages.len())?;
        for p in &f.pages {
            bytes = add(bytes, p.len())?;
            if p.len() > PAGE_BYTES {
                return Err(Error::Capacity);
            }
        }
    }
    if pages > 8192 || bytes > RAW_BYTES {
        return Err(Error::Capacity);
    }
    let mut usable = Vec::new();
    let mut ids = Vec::new();
    let mut future = f64::INFINITY;
    for f in &raw {
        if f.fetched_at_ms as f64 > now {
            future = future.min(f.fetched_at_ms as f64);
        }
        if let Key::Grid(family, ..) = key
            && f.fetched_at_ms as f64 <= now
            && let Some(id) = grid_input_id(*family, key.kind(), f)
        {
            reserve(&mut ids, 1)?;
            ids.push(id);
        }
    }
    if let Some(id) = original
        && let Some(last) = ids.last_mut()
    {
        *last = id;
    }
    let docs = match key {
        Key::Grid(family, x, y) => fold_grid(
            *family,
            Coord {
                mx: *x as f64,
                my: *y as f64,
            },
            &raw,
            now,
            &mut usable,
            counters,
        )?,
        Key::Rss(x, y) => fold_rss(
            Coord {
                mx: *x as f64,
                my: *y as f64,
            },
            &raw,
            now,
            counters,
        )?,
        Key::Mid(model, code) => fold_mid(*model, code, &raw, now, counters)?,
    };
    if docs.len() > DOCS {
        return Err(Error::Capacity);
    }
    let future = boundary(key, &raw, now).min(future);
    let mut view = View {
        docs,
        raw,
        ids: (excluded == 0).then_some(ids),
        usable,
        complete: excluded == 0,
        wall: now,
        future,
        checked: Mutex::new(Checked {
            wall: now,
            at: admitted,
        }),
        manifest: super::forecast_manifest::Manifest::default(),
        epoch,
        _state: None,
        charge: Charge::default(),
        _parent: parent,
    };
    view.charge = view.weigh(key)?;
    Ok(view)
}

/// Earliest actual pure-selector change. Arbitrary minutes with no removed input are safe.
fn boundary(key: &Key, raw: &[Fetched], now: f64) -> f64 {
    const MINUTE: f64 = 60_000.;
    const DAY: f64 = 86_400_000.;
    let kst = 9. * 3_600_000.;
    let mut next = ((now + kst) / DAY).floor().mul_add(DAY, DAY) - kst;
    let lookback = match key {
        Key::Grid(f, ..) => Some(super::lookback_ms(*f)),
        Key::Rss(..) => Some(super::RSS_LOOKBACK_MS),
        Key::Mid(..) => None,
    };
    if let Some(back) = lookback {
        for f in raw {
            if let Some(p) = super::partition_publication(&f.partition) {
                // The inclusive lower partition drops at the first later minute.
                let removed = schedule::to_ms(p) as f64 + back + MINUTE;
                if removed > now {
                    next = next.min(removed);
                }
            }
        }
    }
    let family = match key {
        Key::Grid(Family::Current, ..) => Some(schedule::Family::Current),
        Key::Grid(Family::Shortest, ..) => Some(schedule::Family::Shortest),
        Key::Grid(Family::Short, ..) => Some(schedule::Family::Short),
        _ => None,
    };
    let latest = family.and_then(|f| f.latest(now as i64));
    let lower_month = lookback.map(|back| super::records::months(now - back, now - back));
    let mut t = (now / MINUTE).floor().mul_add(MINUTE, MINUTE);
    // Every selector is minute-stepped; day clipping bounds this pure scan to1440 probes.
    while t < next {
        let publication_changed = family.is_some_and(|f| f.latest(t as i64) != latest);
        let rss_changed = matches!(key, Key::Rss(..)) && super::last_run(t) != super::last_run(now);
        let month_changed = lookback
            .zip(lower_month.as_ref())
            .is_some_and(|(back, month)| super::records::months(t - back, t - back) != *month);
        if publication_changed || rss_changed || month_changed {
            return t;
        }
        t += MINUTE;
    }
    next
}

fn references(f: &Fetched) -> Result<Vec<&[u8]>, Error> {
    let mut refs = Vec::new();
    reserve(&mut refs, f.pages.len())?;
    for p in &f.pages {
        if p.len() > PAGE_BYTES {
            return Err(Error::Capacity);
        }
        refs.push(&p[..]);
    }
    Ok(refs)
}
fn fold_grid(
    family: Family,
    coord: Coord,
    raw: &[Fetched],
    now: f64,
    usable: &mut Vec<String>,
    counters: &Counters,
) -> Result<Vec<Doc>, Error> {
    counters.folds.fetch_add(1, Ordering::Relaxed);
    let sf = match family {
        Family::Current => schedule::Family::Current,
        Family::Shortest => schedule::Family::Shortest,
        Family::Short => schedule::Family::Short,
    };
    let mut docs = super::GridDocs::default();
    for f in raw.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        let Some(p) = super::partition_publication(&f.partition) else {
            continue;
        };
        let slot_pub = if family == Family::Shortest {
            sf.request_publication(p)
        } else {
            p
        };
        let compact = slot_pub.compact();
        let slot = super::Slot::new(&compact[..8], &compact[8..]);
        counters.parses.fetch_add(1, Ordering::Relaxed);
        let Some(items) = super::items::bounded(&references(f)?)? else {
            continue;
        };
        if let super::Organized::Rows(rows) =
            super::grid::collect_bounded(family, &items, &slot, coord)?
        {
            let kept = family != Family::Current
                || (!rows.is_empty()
                    && rows
                        .iter()
                        .all(|r| r.num("t1h") != -50. && r.num("reh") != -1.));
            if kept {
                reserve(usable, 1)?;
                usable.push(copied(&f.partition)?);
            }
            docs.save_bounded(family, rows)?;
        }
    }
    if let Some(latest) = sf.latest(now as i64) {
        let anchor = if family == Family::Shortest {
            sf.request_publication(latest)
        } else {
            latest
        };
        docs.retain(schedule::to_ms(anchor) as f64);
    }
    Ok(docs.into_answer())
}
fn fold_rss(
    coord: Coord,
    raw: &[Fetched],
    now: f64,
    counters: &Counters,
) -> Result<Vec<Doc>, Error> {
    counters.folds.fetch_add(1, Ordering::Relaxed);
    let mut docs = super::RssDocs::default();
    for f in raw.iter().filter(|f| f.fetched_at_ms as f64 <= now) {
        docs.retain(f.fetched_at_ms as f64);
        let Some(page) = f.pages.first() else {
            continue;
        };
        counters.parses.fetch_add(1, Ordering::Relaxed);
        let Some(parsed) = super::rss::parse_bounded(page)? else {
            continue;
        };
        if super::korea_date(&parsed.publication).is_some_and(|p| docs.has_publication(p)) {
            continue;
        }
        docs.save_bounded(parsed)?;
    }
    docs.retain(super::last_run(now));
    let mut out = docs.into_answer();
    out.retain(|d| {
        d.get("mCoord")
            .and_then(super::Val::as_doc)
            .is_some_and(|m| {
                m.get("mx") == Some(&super::Val::num(coord.mx))
                    && m.get("my") == Some(&super::Val::num(coord.my))
            })
    });
    Ok(out)
}
fn fold_mid(
    model: MidModel,
    code: &str,
    raw: &[Fetched],
    now: f64,
    counters: &Counters,
) -> Result<Vec<Doc>, Error> {
    counters.folds.fetch_add(1, Ordering::Relaxed);
    // Preserve the existing newest-successful-month rule, independent of late completion order.
    for month in checked_months(now)?.into_iter().rev() {
        let mut docs = super::MidDoc::default();
        for f in raw.iter().filter(|f| {
            f.fetched_at_ms as f64 <= now && f.partition.starts_with(&format!("{month:06}"))
        }) {
            let Some(p) = super::partition_publication(&f.partition) else {
                continue;
            };
            let compact = p.compact();
            let Some(ms) = super::korea_date(&compact) else {
                continue;
            };
            if docs.has_publication(ms) {
                continue;
            }
            counters.parses.fetch_add(1, Ordering::Relaxed);
            let Some(items) = super::items::bounded(&references(f)?)? else {
                continue;
            };
            if let Some(record) = super::mid::organize_bounded(model, &items, &compact, code)? {
                docs.save_bounded(model, &record)?;
            }
        }
        let out = docs.into_answer()?;
        if !out.is_empty() {
            return Ok(out);
        }
    }
    Ok(Vec::new())
}
fn checked_months(now: f64) -> Result<Vec<u32>, Error> {
    let end = super::records::months(now, now)
        .last()
        .copied()
        .ok_or(Error::Invalid("forecast clock"))?;
    let mut out = Vec::new();
    let mut month = super::HISTORY_START_MONTH;
    while month <= end {
        if out.len() >= 1024 {
            return Err(Error::Capacity);
        }
        reserve(&mut out, 1)?;
        out.push(month);
        month = if month % 100 == 12 {
            month + 89
        } else {
            month + 1
        };
    }
    Ok(out)
}

struct Writer<T> {
    inner: Arc<dyn fetch::ForecastAcquire>,
    cache: Cache<T>,
}
struct Writing<T> {
    cache: Cache<T>,
    key: Key,
    state: Arc<Mutex<Epoch>>,
}
impl<T> Drop for Writing<T> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            match state.value.checked_add(1) {
                Some(v) => state.value = v,
                None => state.poisoned = true,
            }
            state.writers = state.writers.saturating_sub(1);
            self.cache.0.map.remove(&self.key);
        }
    }
}
fn request_key(request: &fetch::ForecastRequest) -> Option<Key> {
    use crate::domestic::family::{DataGoKrFamily as F, Target};
    match request {
        fetch::ForecastRequest::DataGoKr(r) => match (r.family(), r.target()) {
            (F::UltraSrtNcst, Target::Grid { nx, ny }) => {
                Some(Key::Grid(Family::Current, *nx, *ny))
            }
            (F::UltraSrtFcst, Target::Grid { nx, ny }) => {
                Some(Key::Grid(Family::Shortest, *nx, *ny))
            }
            (F::VilageFcst, Target::Grid { nx, ny }) => Some(Key::Grid(Family::Short, *nx, *ny)),
            (F::MidFcst, Target::Station(code)) => Some(Key::Mid(MidModel::Forecast, code.clone())),
            (F::MidLandFcst, Target::Region(code)) => Some(Key::Mid(MidModel::Land, code.clone())),
            (F::MidTa, Target::Region(code)) => Some(Key::Mid(MidModel::Temp, code.clone())),
            _ => None,
        },
        fetch::ForecastRequest::Rss(r) => r.grid().map(|(x, y)| Key::Rss(x, y)),
        _ => None,
    }
}
impl<T: IndexListing + Clone + Send + Sync + 'static> fetch::ForecastAcquire for Writer<T> {
    fn acquire(
        &self,
        request: fetch::ForecastRequest,
    ) -> crate::gateway::BoxFuture<'static, Result<fetch::Published, String>> {
        let inner = self.inner.clone();
        let cache = self.cache.clone();
        Box::pin(async move {
            let guard = if let Some(key) = request_key(&request) {
                let fence = cache.state(&key).map_err(|_| "forecast epoch capacity")?;
                {
                    let mut state = fence.lock().map_err(|_| "forecast epoch")?;
                    let Some(value) = state.value.checked_add(1) else {
                        state.poisoned = true;
                        return Err("forecast epoch capacity".into());
                    };
                    let writers = state
                        .writers
                        .checked_add(1)
                        .ok_or("forecast writer capacity")?;
                    state.value = value;
                    state.writers = writers;
                    cache.0.map.remove(&key);
                }
                Some(Writing {
                    cache: cache.clone(),
                    key,
                    state: fence,
                })
            } else {
                None
            };
            let result = inner.acquire(request).await;
            drop(guard);
            result
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty() -> View {
        View {
            docs: Vec::new(),
            raw: Vec::new(),
            ids: Some(Vec::new()),
            usable: Vec::new(),
            complete: true,
            wall: 1_790_214_600_000.,
            future: f64::INFINITY,
            checked: Mutex::new(Checked {
                wall: 1_790_214_600_000.,
                at: Instant::now(),
            }),
            manifest: super::super::forecast_manifest::Manifest::default(),
            epoch: 0,
            _state: None,
            charge: Charge::default(),
            _parent: None,
        }
    }
    #[test]
    fn freshness_clips_wall_and_future_equality() {
        let mut view = empty();
        let now = view.wall;
        assert!(view.fresh(now));
        assert!(view.fresh(now + 29_999.));
        assert!(!view.fresh(now - 1.));
        assert!(view.fresh(now + 60_000.));
        assert!(!view.fresh(f64::NAN));
        view.future = now + 500.;
        assert!(view.fresh(now + 499.));
        assert!(!view.fresh(now + 500.));
        view.future = f64::INFINITY;
        view.checked.lock().unwrap().at = Instant::now() - Duration::from_secs(30);
        assert!(view.fresh(now)); // Control revalidation is separate from selector expiry.
    }
    #[test]
    fn selector_interval_crosses_minutes_and_expires_at_publication() {
        let key = Key::Grid(Family::Current, 60, 127);
        let now = 1_790_214_600_000.; //10:50 KST, next Current selector11:40.
        let view = build_view(
            &key,
            vec![],
            0,
            now,
            Instant::now(),
            0,
            None,
            None,
            &Counters::default(),
        )
        .unwrap();
        assert!(
            view.fresh(now + 60_000.),
            "arbitrary minute must not expire the fold"
        );
        assert!(view.fresh(now + 50. * 60_000. - 1.));
        assert!(!view.fresh(now + 50. * 60_000.));
        assert!(!view.fresh(now - 1.));
    }
    #[test]
    fn evicted_reader_pins_keep_the_exact_charge_and_fail_closed() {
        let key = Key::Grid(Family::Current, 60, 127);
        let view = empty();
        let weight = view.weigh(&key).unwrap().total;
        let budget = ByteBudget::new(weight + 1).unwrap();
        let map = WeightedCache::new(budget.clone(), 1, 1).unwrap();
        let pin = map.insert(key.clone(), view, weight).unwrap();
        let reader = pin.clone();
        map.clear();
        assert_eq!(budget.used(), weight);
        assert!(matches!(
            map.insert(key.clone(), empty(), weight),
            Err(Error::Capacity)
        ));
        drop(pin);
        assert_eq!(budget.used(), weight);
        drop(reader);
        assert_eq!(budget.used(), 0);
        assert!(map.insert(key, empty(), weight).is_ok());
    }
    #[test]
    fn doc_weights_count_backing_capacity_instead_of_json_bytes() {
        let mut s = String::with_capacity(4096);
        s.push('x');
        let large = Doc::new().with("s", super::super::Val::Str(s));
        let small = Doc::new().with("s", super::super::Val::str("x"));
        assert_eq!(large.json(), small.json());
        assert!(large.heap_weight().unwrap() > small.heap_weight().unwrap() + 4000);
    }
    #[test]
    fn checked_arithmetic_and_allocator_allowance_do_not_wrap() {
        assert_eq!(allocation(0).unwrap(), 64);
        assert_eq!(allocation(1).unwrap(), 80);
        assert_eq!(allocation(16).unwrap(), 80);
        assert_eq!(allocation(17).unwrap(), 96);
        assert!(matches!(add(usize::MAX, 1), Err(Error::Capacity)));
        assert!(matches!(allocation(usize::MAX), Err(Error::Capacity)));
    }
    #[test]
    fn bounded_json_distinguishes_rejection_from_pressure() {
        assert!(
            super::super::items::bounded(&[b"bad JSON"])
                .unwrap()
                .is_none()
        );
        let too_large = vec![b' '; PAGE_BYTES + 1];
        assert!(matches!(
            super::super::items::bounded(&[&too_large]),
            Err(Error::Capacity)
        ));
        let nested = format!("{}0{}", "[".repeat(33), "]".repeat(33));
        assert!(matches!(
            super::super::items::bounded(&[nested.as_bytes()]),
            Err(Error::Capacity)
        ));
    }
    #[tokio::test]
    async fn actual_writer_future_invalidates_at_start_and_at_cancellation_drop() {
        struct Hold {
            started: Arc<tokio::sync::Notify>,
            panic: bool,
        }
        impl fetch::ForecastAcquire for Hold {
            fn acquire(
                &self,
                _: fetch::ForecastRequest,
            ) -> crate::gateway::BoxFuture<'static, Result<fetch::Published, String>> {
                let started = self.started.clone();
                let fail = self.panic;
                Box::pin(async move {
                    started.notify_one();
                    assert!(!fail, "owned test writer panic");
                    std::future::pending().await
                })
            }
        }
        let transport = crate::world::BoundedS3::new(
            crate::storage::HttpS3Transport::new(
                "http://127.0.0.1:9",
                "server2-local",
                "ap-northeast-2",
                rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
            )
            .unwrap(),
            2,
        );
        let cache = Cache::new(Reader {
            transport: transport.clone(),
            store: Arc::new(
                crate::storage::CatalogStore::new(
                    transport,
                    crate::storage::CatalogLimits::default(),
                )
                .unwrap(),
            ),
        })
        .unwrap();
        let key = Key::Grid(Family::Current, 60, 127);
        let view = empty();
        let weight = view.weigh(&key).unwrap().total;
        cache.0.map.insert(key.clone(), view, weight).unwrap();
        let rss = Key::Rss(60, 127);
        let rss_view = empty();
        let rss_weight = rss_view.weigh(&rss).unwrap().total;
        cache.0.map.insert(rss, rss_view, rss_weight).unwrap();
        let other = Key::Grid(Family::Current, 61, 127);
        let other_view = empty();
        let other_weight = other_view.weigh(&other).unwrap().total;
        let other_pin = cache
            .0
            .map
            .insert(other.clone(), other_view, other_weight)
            .unwrap();
        let started = Arc::new(tokio::sync::Notify::new());
        let writer = cache.wrap(Arc::new(Hold {
            started: started.clone(),
            panic: false,
        }));
        let task = tokio::spawn(writer.acquire(fetch::ForecastRequest::Rss(
            crate::domestic::family::WebRequest::town_rss(60, 127).unwrap(),
        )));
        started.notified().await;
        {
            let fence = cache.state(&Key::Rss(60, 127)).unwrap();
            let state = fence.lock().unwrap();
            assert_eq!(state.value, 1);
            assert_eq!(state.writers, 1);
            assert_eq!(
                cache.0.map.entries(),
                2,
                "RSS acquisition must retain unrelated Current views"
            );
        }
        let warm = cache
            .get(
                other.clone(),
                other_pin.value.wall,
                Instant::now() + Duration::from_secs(1),
            )
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&warm, &other_pin));
        assert_eq!(cache.stats().parse_acquisitions, 0);
        assert_eq!(cache.stats().folds, 0);
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let fence = cache.state(&Key::Rss(60, 127)).unwrap();
        {
            let state = fence.lock().unwrap();
            assert_eq!(state.value, 2);
            assert_eq!(state.writers, 0);
        }
        let writer = cache.wrap(Arc::new(Hold {
            started: started.clone(),
            panic: true,
        }));
        let failed = tokio::spawn(writer.acquire(fetch::ForecastRequest::Rss(
            crate::domestic::family::WebRequest::town_rss(60, 127).unwrap(),
        )));
        assert!(failed.await.unwrap_err().is_panic());
        let state = fence.lock().unwrap();
        assert_eq!(state.value, 4);
        assert_eq!(state.writers, 0);
        assert_eq!(cache.0.map.entries(), 2);
        // No transport operation was invoked: this exercises the real installed wrapper future.
    }
}

#[cfg(test)]
mod retention_tests {
    use super::*;
    use crate::storage::{
        CatalogLimits, CatalogStore, CatalogTransport, ControlObject, ListPage, Object,
        ObjectTransport, PreparedRecord, WriteCondition,
    };
    #[derive(Clone, Default)]
    struct Empty {
        disk: Option<Arc<crate::cache::disk::DiskCache>>,
        raw: Arc<AtomicU64>,
        pause: Option<
            Arc<(
                std::sync::atomic::AtomicBool,
                tokio::sync::Notify,
                tokio::sync::Notify,
            )>,
        >,
    }
    impl ObjectTransport for Empty {
        fn raw_cache(&self) -> Option<Arc<crate::cache::disk::DiskCache>> {
            self.disk.clone()
        }
        async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
            Err(Error::Transport)
        }
        async fn head(&self, _: &str) -> Result<Object, Error> {
            Err(Error::NotFound)
        }
        async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
            self.raw.fetch_add(1, Ordering::SeqCst);
            Err(Error::NotFound)
        }
    }
    impl CatalogTransport for Empty {
        async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
            Err(Error::NotFound)
        }
        async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
            Err(Error::Transport)
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            Err(Error::Transport)
        }
    }
    impl IndexListing for Empty {
        async fn list_index(&self, _: &str, _: Option<&str>) -> Result<ListPage, Error> {
            if let Some(p) = &self.pause
                && !p.0.swap(true, Ordering::SeqCst)
            {
                p.1.notify_one();
                p.2.notified().await;
            }
            Ok(ListPage {
                keys: vec![],
                next: None,
            })
        }
    }
    fn reader(t: Empty) -> Reader<Empty> {
        Reader {
            transport: t.clone(),
            store: Arc::new(CatalogStore::new(t, CatalogLimits::default()).unwrap()),
        }
    }
    const NOW: f64 = 1_790_214_600_000.;
    fn until() -> Instant {
        Instant::now() + Duration::from_secs(3)
    }
    #[tokio::test]
    async fn small_memory_budget_evicts_and_restores_without_raw_parse_or_fold() {
        let root =
            std::env::temp_dir().join(format!("server2-2850-eviction-{}", std::process::id()));
        assert!(!root.exists());
        let disk =
            Arc::new(crate::cache::disk::DiskCache::new(&root, "owned-2850", 65536, 32).unwrap());
        let t = Empty {
            disk: Some(disk.clone()),
            ..Default::default()
        };
        let a = Key::Grid(Family::Current, 60, 127);
        let b = Key::Grid(Family::Current, 61, 127);
        let c = Cache::new(reader(t.clone())).unwrap();
        let first = c.get(a.clone(), NOW, until()).await.unwrap();
        let weight = first.value.charge.total;
        drop(first);
        drop(c);
        assert!(disk.idle(until()).await);
        let c = Cache::with_limits(reader(t.clone()), MIB + weight + 128).unwrap();
        drop(c.get(a.clone(), NOW, until()).await.unwrap());
        drop(c.get(b.clone(), NOW, until()).await.unwrap());
        assert_eq!(
            c.stats().mapped_entries,
            1,
            "budget must be smaller than both views"
        );
        assert!(c.0.map.get(&a).is_none());
        assert!(disk.idle(until()).await);
        let before = c.stats();
        let restored = c.get(a, NOW, until()).await.unwrap();
        assert!(restored.value.docs.is_empty());
        assert_eq!(c.stats().parse_acquisitions, before.parse_acquisitions);
        assert_eq!(c.stats().folds, before.folds);
        assert_eq!(c.stats().disk_restores, before.disk_restores + 1);
        assert_eq!(t.raw.load(Ordering::SeqCst), 0);
        assert!(disk.metrics().bytes <= 65536);
        drop(restored);
        drop(c);
        drop(t);
        drop(disk);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn writer_during_build_fences_old_flight_and_installation() {
        struct Done;
        impl fetch::ForecastAcquire for Done {
            fn acquire(
                &self,
                _: fetch::ForecastRequest,
            ) -> crate::gateway::BoxFuture<'static, Result<fetch::Published, String>> {
                Box::pin(async { Ok(None) })
            }
        }
        let pause = Arc::new((
            std::sync::atomic::AtomicBool::new(false),
            tokio::sync::Notify::new(),
            tokio::sync::Notify::new(),
        ));
        let c = Cache::new(reader(Empty {
            pause: Some(pause.clone()),
            ..Default::default()
        }))
        .unwrap();
        let copy = c.clone();
        let key = Key::Rss(60, 127);
        let pending = tokio::spawn(async move { copy.get(Key::Rss(60, 127), NOW, until()).await });
        pause.1.notified().await;
        c.wrap(Arc::new(Done))
            .acquire(fetch::ForecastRequest::Rss(
                crate::domestic::family::WebRequest::town_rss(60, 127).unwrap(),
            ))
            .await
            .unwrap();
        pause.2.notify_one();
        drop(pending.await.unwrap().unwrap());
        assert_eq!(c.stats().folds, 2, "retired flight requires a fresh build");
        drop(c.get(key, NOW, until()).await.unwrap());
        assert_eq!(c.stats().mapped_entries, 1);
    }
    #[tokio::test]
    async fn active_writer_allows_request_local_reconstruction_without_complete_ids() {
        struct Pending(Arc<tokio::sync::Notify>);
        impl fetch::ForecastAcquire for Pending {
            fn acquire(
                &self,
                _: fetch::ForecastRequest,
            ) -> crate::gateway::BoxFuture<'static, Result<fetch::Published, String>> {
                let started = self.0.clone();
                Box::pin(async move {
                    started.notify_one();
                    std::future::pending().await
                })
            }
        }
        let cache = Cache::new(reader(Empty::default())).unwrap();
        let started = Arc::new(tokio::sync::Notify::new());
        let writer = cache.wrap(Arc::new(Pending(started.clone())));
        let task = tokio::spawn(writer.acquire(fetch::ForecastRequest::Rss(
            crate::domestic::family::WebRequest::town_rss(60, 127).unwrap(),
        )));
        started.notified().await;
        let key = Key::Rss(60, 127);
        let transient = cache.get(key.clone(), NOW, until()).await.unwrap();
        assert!(!transient.value.complete);
        assert!(transient.value.ids.is_none());
        assert!(cache.0.map.get(&key).is_none());
        assert_eq!(cache.stats().folds, 1);
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        drop(transient);
        let canonical = cache.get(key, NOW, until()).await.unwrap();
        assert!(canonical.value.complete);
        assert!(canonical.value.ids.is_some());
        assert_eq!(cache.stats().mapped_entries, 1);
    }
    #[tokio::test]
    async fn overlay_preserves_complete_parent_identity_during_same_key_backfill() {
        let cache = Cache::new(reader(Empty::default())).unwrap();
        let key = Key::Rss(60, 127);
        let parent = cache.get(key.clone(), NOW, until()).await.unwrap();
        assert!(parent.value.complete);
        // Hold the exact same-key writer fence through overlay construction. An overlay
        // describes the already-read parent plus this request's acquisition, not a new
        // canonical read that could attest concurrent writes.
        let state = cache.state(&key).unwrap();
        {
            let mut fence = state.lock().unwrap();
            fence.value += 1;
            fence.writers += 1;
            cache.0.map.remove(&key);
        }
        let writing = Writing {
            cache: cache.clone(),
            key: key.clone(),
            state,
        };
        let own = Fetched {
            fetched_at_ms: NOW as u64 + 5_000,
            partition: schedule::from_ms(NOW as i64).partition(),
            pages: vec![],
        };
        let overlay = cache
            .overlay(
                key.clone(),
                parent,
                own.checked_clone().unwrap(),
                NOW,
                until(),
            )
            .await
            .unwrap();
        assert!(overlay.value.complete, "complete parent remains complete");
        assert!(overlay.value.ids.is_some());
        assert!(cache.0.map.get(&key).is_none(), "overlay is request-local");
        // This exemption cannot promote a parent read while a writer was active.
        let partial = cache.get(key.clone(), NOW, until()).await.unwrap();
        assert!(!partial.value.complete);
        let partial_overlay = cache
            .overlay(key.clone(), partial, own, NOW, until())
            .await
            .unwrap();
        assert!(!partial_overlay.value.complete);
        assert!(partial_overlay.value.ids.is_none());
        assert!(cache.0.map.get(&key).is_none());
        drop(writing);
    }
    #[test]
    fn registry_is_bounded_and_cannot_recycle_a_live_state_identity() {
        let c = Cache::new(reader(Empty::default())).unwrap();
        let mut held = Vec::new();
        for i in 0..256 {
            held.push(
                c.state(&Key::Mid(MidModel::Forecast, format!("{i}")))
                    .unwrap(),
            );
        }
        assert!(matches!(c.state(&Key::Rss(60, 127)), Err(Error::Capacity)));
        let retained = held[0].clone();
        drop(held);
        c.state(&Key::Rss(60, 127)).unwrap();
        assert!(Arc::ptr_eq(
            &retained,
            &c.state(&Key::Mid(MidModel::Forecast, "0".into())).unwrap()
        ));
    }
    #[test]
    fn selector_boundaries_cover_rss_retention_calendar_and_future_visibility() {
        let rss = Key::Rss(60, 127);
        assert_eq!(boundary(&rss, &[], NOW), NOW + 12. * 60_000.);
        let mid = Key::Mid(MidModel::Temp, "11B10101".into());
        let at = |date, time| {
            schedule::to_ms(crate::domestic::publication::Publication::new(date, time).unwrap())
                as f64
        };
        assert_eq!(boundary(&mid, &[], at(20260930, 2359)), at(20261001, 0));
        let key = Key::Grid(Family::Current, 60, 127);
        let part = schedule::from_ms((NOW - super::super::lookback_ms(Family::Current)) as i64)
            .partition();
        let f = Fetched {
            fetched_at_ms: (NOW + 500.) as u64,
            partition: part,
            pages: vec![],
        };
        let v = build_view(
            &key,
            vec![f],
            0,
            NOW,
            Instant::now(),
            0,
            None,
            None,
            &Counters::default(),
        )
        .unwrap();
        assert!(v.fresh(NOW + 499.));
        assert!(!v.fresh(NOW + 500.));
        let old = Fetched {
            fetched_at_ms: 1,
            partition: schedule::from_ms((NOW - super::super::lookback_ms(Family::Current)) as i64)
                .partition(),
            pages: vec![],
        };
        assert_eq!(boundary(&key, &[old], NOW), NOW + 60_000.);
    }
}
