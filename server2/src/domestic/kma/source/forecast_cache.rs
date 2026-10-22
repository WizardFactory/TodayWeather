//! Source-local immutable forecast views. Limits are logical admission policy, not RSS.
use super::{Coord, Doc, Family, Fetched, MidModel, fetch, grid_input_id, records::Reader};
use crate::cache::{ByteBudget, ByteLease, WeightedCache, WeightedValue};
use crate::history::{Grid, IndexListing, schedule};
use crate::resolver::{OwnedConfig, OwnedFlights, Waited};
use crate::storage::{Error, ProviderKey};
use crate::summary::InputId;
use std::{
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
/// Partition lookups in flight per view build: the forecast store's lookup and raw-load
/// admission, not above the process S3 gate (`S3_IN_FLIGHT` in `gateway/runtime.rs`, 12).
pub(super) const READ_AHEAD: usize = 12;

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
    fn source(&self) -> &'static str {
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
    fn provider(&self) -> ProviderKey {
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
}
#[derive(Debug, serde::Serialize)]
pub struct Stats {
    pub mapped_entries: usize,
    pub retained_logical_bytes: usize,
    pub active_workspace_logical_bytes: usize,
    pub parse_acquisitions: u64,
    pub folds: u64,
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
}
pub(super) struct View {
    pub(super) docs: Vec<Doc>,
    pub(super) raw: Vec<Fetched>,
    pub(super) ids: Option<Vec<InputId>>,
    pub(super) usable: Vec<String>,
    complete: bool,
    wall: f64,
    minute: i64,
    future: f64,
    admitted: Instant,
    epoch: u64,
    pub(super) charge: Charge,
    _parent: Option<Pin>,
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
            && (now / 60_000.).floor() as i64 == self.minute
            && self.admitted.elapsed() < Duration::from_secs(30)
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
        let total = add(add(raw, docs)?, ids)?;
        if payload > RAW_BYTES || docs > DOC_BYTES || ids > ID_BYTES || total > ENTRY_BYTES {
            return Err(Error::Capacity);
        }
        Ok(Charge {
            raw,
            docs,
            identities: ids,
            total,
        })
    }
}
struct Epoch {
    value: u64,
    writers: usize,
    poisoned: bool,
}
type FlightKey = (Key, Option<(u64, String)>);

struct Inner<T> {
    reader: Reader<T>,
    map: WeightedCache<Key, View>,
    budget: Arc<ByteBudget>,
    _metadata: ByteLease,
    epoch: Mutex<Epoch>,
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
/// Fields drop in declaration order: the bytes return before the owner slot wakes the next
/// owner, whose reservation refuses rather than waits.
pub(super) struct Workspace {
    _bytes: ByteLease,
    _slot: OwnedSemaphorePermit,
}
impl<T: IndexListing + Clone + Send + Sync + 'static> Cache<T> {
    pub(super) fn new(reader: Reader<T>) -> Result<Self, Error> {
        let budget = ByteBudget::new(128 * MIB)?;
        let metadata = budget.reserve(MIB)?;
        let mut charges = Vec::new();
        reserve(&mut charges, 128)?;
        Ok(Self(Arc::new(Inner {
            reader,
            map: WeightedCache::new(budget.clone(), 1, 128)?,
            budget,
            _metadata: metadata,
            epoch: Mutex::new(Epoch {
                value: 0,
                writers: 0,
                poisoned: false,
            }),
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
    pub(super) async fn get(&self, key: Key, now: f64, until: Instant) -> Result<Pin, String> {
        if !now.is_finite() {
            return Err("forecast clock".into());
        }
        {
            let state = self.0.epoch.lock().map_err(|_| "forecast epoch")?;
            if state.poisoned {
                return Err("forecast epoch capacity".into());
            }
            if state.writers == 0
                && let Some(pin) = self.0.map.get(&key)
            {
                if pin.value.epoch == state.value && pin.value.fresh(now) {
                    return Ok(pin);
                }
                self.0.map.remove(&key);
            }
        }
        self.join(key, now, until, None).await
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
        let flight_key = (
            key.clone(),
            overlay
                .as_ref()
                .map(|(_, f)| (f.fetched_at_ms, super::identity(f).2)),
        );
        let cache = self.clone();
        let start = move |deadline| async move {
            cache
                .build(key, now, deadline, overlay)
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
                if pin.value.fresh(now) {
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
        let epoch = self.0.epoch.lock().map_err(|_| Error::Transport)?.value;
        let (raw, excluded, parent, original) = if let Some((parent, own)) = overlay {
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
            )
        } else {
            let (raw, excluded) = self.read(&key, now, deadline, workspace.clone()).await?;
            (raw, excluded, None, None)
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
        // These guards move into the blocking closure: timeout/drop cannot release them early.
        let view = tokio::task::spawn_blocking(move || {
            let (_workspace, _cpu) = (workspace, cpu);
            build_view(
                &work_key, raw, excluded, now, admitted, epoch, parent, original, &counters,
            )
        })
        .await
        .map_err(|_| Error::Transport)??;
        let state = self.0.epoch.lock().map_err(|_| Error::Transport)?;
        if state.poisoned {
            return Err(Error::Capacity);
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
            self.0.map.insert(key, view, weight)
        } else {
            WeightedValue::charged(view, &self.0.budget, weight)
        }
    }
    async fn read(
        &self,
        key: &Key,
        now: f64,
        deadline: Instant,
        workspace: Arc<Workspace>,
    ) -> Result<(Vec<Fetched>, usize), Error> {
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
                let parts = parts.into_iter().filter(|p| *p >= oldest);
                let (mut found, e) =
                    read_partitions(reader, key, &provider, parts, &mut scope, deadline).await?;
                excluded = add(excluded, e)?;
                reserve(&mut raw, found.len())?;
                raw.append(&mut found);
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
                    let (mut found, e) =
                        read_partitions(reader, key, &provider, parts, &mut scope, deadline)
                            .await?;
                    excluded = add(excluded, e)?;
                    reserve(&mut raw, found.len())?;
                    raw.append(&mut found);
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
        Ok((raw, excluded))
    }
}

/// The acquisitions and excluded groups of `parts` (ascending). Up to [`READ_AHEAD`] lookups
/// overlap, but results are consumed in partition order: the retained acquisitions, the
/// partition whose scope totals fail and the first error equal a sequential read. Returning
/// early drops the lookups still in flight.
async fn read_partitions<T: IndexListing + Clone>(
    reader: &Reader<T>,
    key: &Key,
    provider: &ProviderKey,
    parts: impl IntoIterator<Item = String>,
    scope: &mut super::records::ForecastScope,
    deadline: Instant,
) -> Result<(Vec<Fetched>, usize), Error> {
    use futures_util::{StreamExt, stream};
    let mut lookups = stream::iter(parts)
        .map(|part| async move {
            reader
                .forecast_lookup(key.source(), key.kind(), provider, &part, deadline)
                .await
        })
        .buffered(READ_AHEAD);
    let (mut raw, mut excluded) = (Vec::new(), 0usize);
    while let Some(looked) = lookups.next().await {
        let mut looked = looked?;
        scope.admit(&looked.counted)?;
        excluded = add(excluded, looked.excluded)?;
        reserve(&mut raw, looked.found.len())?;
        raw.append(&mut looked.found);
    }
    Ok((raw, excluded))
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
    let mut view = View {
        docs,
        raw,
        ids: (excluded == 0).then_some(ids),
        usable,
        complete: excluded == 0,
        wall: now,
        minute: (now / 60_000.).floor() as i64,
        future,
        admitted,
        epoch,
        charge: Charge::default(),
        _parent: parent,
    };
    view.charge = view.weigh(key)?;
    Ok(view)
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
    let mut deferred = super::grid::DeferredGridDocs::default();
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
            if family == Family::Current {
                docs.save_bounded(family, rows)?;
            } else {
                deferred.save(family, rows)?;
            }
        }
    }
    let anchor = sf.latest(now as i64).map(|latest| {
        let anchor = if family == Family::Shortest {
            sf.request_publication(latest)
        } else {
            latest
        };
        schedule::to_ms(anchor) as f64
    });
    if family == Family::Current {
        if let Some(anchor) = anchor {
            docs.retain(anchor);
        }
        Ok(docs.into_answer())
    } else {
        deferred.finish(family, anchor)
    }
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
struct Writing<T>(Cache<T>);
impl<T> Drop for Writing<T> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.0.epoch.lock() {
            match state.value.checked_add(1) {
                Some(v) => state.value = v,
                None => state.poisoned = true,
            }
            state.writers = state.writers.saturating_sub(1);
            self.0.0.map.clear();
        }
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
            let guard = if matches!(
                request,
                fetch::ForecastRequest::Zones | fetch::ForecastRequest::Warnings
            ) {
                None
            } else {
                let mut state = cache.0.epoch.lock().map_err(|_| "forecast epoch")?;
                state.value = state
                    .value
                    .checked_add(1)
                    .ok_or("forecast epoch capacity")?;
                state.writers = state
                    .writers
                    .checked_add(1)
                    .ok_or("forecast writer capacity")?;
                cache.0.map.clear();
                Some(Writing(cache.clone()))
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
            minute: 1_790_214_600_000_i64 / 60_000,
            future: f64::INFINITY,
            admitted: Instant::now(),
            epoch: 0,
            charge: Charge::default(),
            _parent: None,
        }
    }
    #[test]
    fn an_owner_hand_off_returns_the_workspace_before_waking_the_next_owner() {
        use std::future::Future;
        use std::task::{Context, Wake, Waker};
        /// The workspace in use when the next owner is woken, inside the slot release.
        struct Observe(Arc<ByteBudget>, Mutex<Option<usize>>);
        impl Wake for Observe {
            fn wake(self: Arc<Self>) {
                self.wake_by_ref();
            }
            fn wake_by_ref(self: &Arc<Self>) {
                *self.1.lock().unwrap() = Some(self.0.used());
            }
        }
        let owners = Arc::new(Semaphore::new(1));
        let budget = ByteBudget::new(WORKSPACE).unwrap();
        let workspace = Workspace {
            _slot: owners.clone().try_acquire_owned().unwrap(),
            _bytes: budget.reserve(WORKSPACE).unwrap(),
        };
        let observe = Arc::new(Observe(budget.clone(), Mutex::new(None)));
        let waker = Waker::from(observe.clone());
        let mut next = Box::pin(owners.clone().acquire_owned());
        assert!(
            next.as_mut()
                .poll(&mut Context::from_waker(&waker))
                .is_pending()
        );
        drop(workspace);
        assert_eq!(
            *observe.1.lock().unwrap(),
            Some(0),
            "the woken owner must find the previous workspace returned"
        );
    }
    #[test]
    fn freshness_clips_monotonic_wall_minute_and_future_equality() {
        let mut view = empty();
        let now = view.wall;
        assert!(view.fresh(now));
        assert!(view.fresh(now + 29_999.));
        assert!(!view.fresh(now - 1.));
        assert!(!view.fresh(now + 60_000.));
        assert!(!view.fresh(f64::NAN));
        view.future = now + 500.;
        assert!(view.fresh(now + 499.));
        assert!(!view.fresh(now + 500.));
        view.future = f64::INFINITY;
        view.admitted = Instant::now() - Duration::from_secs(30);
        assert!(!view.fresh(now));
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
        }
        impl fetch::ForecastAcquire for Hold {
            fn acquire(
                &self,
                _: fetch::ForecastRequest,
            ) -> crate::gateway::BoxFuture<'static, Result<fetch::Published, String>> {
                let started = self.started.clone();
                Box::pin(async move {
                    started.notify_one();
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
        cache.0.map.insert(key, view, weight).unwrap();
        let started = Arc::new(tokio::sync::Notify::new());
        let writer = cache.wrap(Arc::new(Hold {
            started: started.clone(),
        }));
        let task = tokio::spawn(writer.acquire(fetch::ForecastRequest::Rss(
            crate::domestic::family::WebRequest::town_rss(60, 127).unwrap(),
        )));
        started.notified().await;
        {
            let state = cache.0.epoch.lock().unwrap();
            assert_eq!(state.value, 1);
            assert_eq!(state.writers, 1);
            assert_eq!(cache.0.map.entries(), 0);
        }
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let state = cache.0.epoch.lock().unwrap();
        assert_eq!(state.value, 2);
        assert_eq!(state.writers, 0);
        // No transport operation was invoked: this exercises the real installed wrapper future.
    }
}
