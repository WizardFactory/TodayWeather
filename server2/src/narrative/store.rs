use super::{
    Acquire, DAY_MS, Narrative, OFFICES, Read, announcement, now_ms,
    provider::{Page, Source},
    select,
};
use crate::{
    gateway::BoxFuture,
    history::IndexListing,
    storage::{
        Catalog, CatalogId, CatalogLimits, CatalogStore, Error, Limits, PageOutcome, Period,
        ProviderKey, RawRecord, sha256,
    },
};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

pub const SOURCE: &str = "kma-forecast-narrative";
pub const KIND: &str = "overview";
const MAX_PAGE_BYTES: usize = 2 << 20; // Same bound as the native data.go.kr transport.
fn key(station: u16) -> ProviderKey {
    ProviderKey::Named {
        id: station.to_string(),
    }
}
fn identity(station: u16, tm: &str) -> Result<CatalogId, Error> {
    let id = CatalogId {
        source: SOURCE.into(),
        kind: KIND.into(),
        key_sha256: sha256(&key(station).canonical_bytes()?),
        partition: tm.into(),
    };
    id.validate()?;
    Ok(id)
}
/// Raw response bytes are immutable; the catalog winner binds their selected publication.
pub struct Store<T> {
    transport: T,
    catalog: CatalogStore<T>,
}
impl<T: IndexListing + Clone> Store<T> {
    pub fn new(transport: T) -> Result<Self, Error> {
        Ok(Self {
            catalog: CatalogStore::new(transport.clone(), CatalogLimits::default())?,
            transport,
        })
    }
    pub async fn publish(
        &self,
        station: u16,
        page: Page,
        deadline: Instant,
    ) -> Result<Option<Narrative>, Error> {
        if page.body.len() > MAX_PAGE_BYTES {
            return Err(Error::Capacity);
        }
        let fetched =
            i64::try_from(page.fetched_at_ms).map_err(|_| Error::Invalid("narrative clock"))?;
        let rows = crate::warnings::provider::items(&page.body)
            .map_err(|_| Error::Invalid("narrative page"))?;
        let Some(rows) = rows else { return Ok(None) };
        let Some((tm, _)) =
            select(station, &rows, fetched).map_err(|_| Error::Invalid("narrative rows"))?
        else {
            return Ok(None);
        };
        let record = RawRecord::new(
            SOURCE,
            KIND,
            &key(station),
            Period {
                local_date: tm[..8].parse().map_err(|_| Error::Invalid("date"))?,
                slot: tm[8..].into(),
            },
            page.fetched_at_ms,
            200,
            &page.content_type,
            None,
            page.body,
            &Limits::default(),
        )?;
        let winner = self
            .catalog
            .publish_once(identity(station, &tm)?, record, deadline)
            .await?;
        decode(station, &tm, &winner, now_ms()).map(Some)
    }
    pub async fn read(
        &self,
        station: u16,
        now: i64,
        deadline: Instant,
    ) -> Result<Option<Narrative>, Error> {
        if !OFFICES.iter().any(|o| o.0 == station) {
            return Ok(None);
        }
        tokio::time::timeout_at(deadline, async {
            let id = identity(station, "placeholder")?;
            let mut publications = BTreeSet::new();
            for offset in [0, -1] {
                let date = crate::warnings::provider::kst_date(now, offset);
                let prefix = format!("index/v2/{SOURCE}/{KIND}/{}/{date}", id.key_sha256);
                let mut token = None;
                let mut seen = BTreeSet::new();
                for page in 0..8 {
                    let list = self.transport.list_index(&prefix, token.as_deref()).await?;
                    if list.keys.len() > 1000 {
                        return Err(Error::Capacity);
                    }
                    for path in list.keys {
                        let tm = path
                            .strip_prefix(&format!("index/v2/{SOURCE}/{KIND}/{}/", id.key_sha256))
                            .and_then(|p| p.strip_suffix(".json"))
                            .ok_or(Error::Corrupt("narrative index namespace"))?;
                        let at = announcement(tm)
                            .ok_or(Error::Corrupt("narrative index publication"))?;
                        if now >= at && now - at < DAY_MS {
                            publications.insert(tm.to_owned());
                        }
                        if publications.len() > 1000 {
                            return Err(Error::Capacity);
                        }
                    }
                    match list.next {
                        None => break,
                        Some(next) if page < 7 && seen.insert(next.clone()) => token = Some(next),
                        Some(_) => return Err(Error::Capacity),
                    }
                }
            }
            let Some(tm) = publications.last() else {
                return Ok(None);
            };
            let id = identity(station, tm)?;
            let object = self
                .transport
                .get_control(&id.key(), CatalogLimits::default().control_bytes)
                .await?;
            let catalog = Catalog::from_bytes(&object.body, &id, &CatalogLimits::default())?;
            if catalog.entries.len() != 1 {
                return Err(Error::Corrupt("narrative catalog cardinality"));
            }
            let entry = &catalog.entries[0];
            if entry.raw_length > MAX_PAGE_BYTES {
                return Err(Error::Capacity);
            }
            if entry.fetch_group.is_some() || entry.pagination.is_some() {
                return Err(Error::Corrupt("narrative group"));
            }
            let PageOutcome::Ready(page) = self
                .catalog
                .lookup_acquisition(&id, &entry.identity, deadline)
                .await?
            else {
                return Err(Error::Corrupt("narrative incomplete"));
            };
            let records = page
                .acquisitions()
                .iter()
                .flat_map(|a| a.records())
                .collect::<Vec<_>>();
            if records.len() != 1 {
                return Err(Error::Corrupt("narrative raw cardinality"));
            }
            decode(station, tm, records[0], now).map(Some)
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
}
fn decode(station: u16, tm: &str, raw: &RawRecord, now: i64) -> Result<Narrative, Error> {
    let rows = crate::warnings::provider::items(&raw.bytes)
        .map_err(|_| Error::Corrupt("narrative page"))?
        .ok_or(Error::Corrupt("narrative noData"))?;
    let fetched = i64::try_from(raw.envelope.identity.fetched_at_ms)
        .map_err(|_| Error::Corrupt("narrative clock"))?;
    let (selected, n) = select(station, &rows, fetched)
        .map_err(|_| Error::Corrupt("narrative rows"))?
        .ok_or(Error::Corrupt("narrative empty"))?;
    if selected != tm
        || !n.fresh(now)
        || raw.envelope.identity.period.local_date.to_string() != tm[..8]
        || raw.envelope.identity.period.slot != tm[8..]
    {
        return Err(Error::Corrupt("narrative publication identity/expiry"));
    }
    Ok(n)
}
/// Completed storage faults have a short gate, not a confirmed-absence entry.
const ERROR_RETRY: Duration = Duration::from_secs(1);
/// How long a stored answer (a narrative or its confirmed absence) is served.
const ANSWER_FOR: Duration = Duration::from_secs(30);
/// One owned store read of an office (S3, never a request's wait).
const READ_FOR: Duration = Duration::from_secs(30);
/// An office's raced acquisition starts at most this often.
const RACE_RETRY: Duration = Duration::from_secs(600);
/// One acquisition of an office (its provider calls).
const FETCH_FOR: Duration = Duration::from_secs(30);
/// The publication after an acquisition.
const PUBLISH_FOR: Duration = Duration::from_secs(3);
/// What one owned fetch of an office did: None when it fetched or published nothing, otherwise
/// what its publication selected.
type Fetched = Option<Option<Narrative>>;
#[derive(Default)]
struct OfficeCache {
    answer: Option<(Instant, Option<Narrative>)>,
    retry_after: Option<Instant>,
    /// An owned store read of the office runs.
    reading: bool,
    /// When the office's raced acquisition last started.
    raced: Option<Instant>,
}
impl OfficeCache {
    /// Install `value` (a stored read's or an acquisition's) as the office's answer unless the
    /// unexpired answer holds a later announcement: the newest publication answers, whichever
    /// ends last (RR2-narrative-regression).
    fn install(&mut self, value: Option<Narrative>) {
        let held = self
            .answer
            .as_ref()
            .and_then(|(until, n)| n.clone().filter(|_| Instant::now() < *until));
        let value = match (value, held) {
            (Some(new), Some(held)) if held.announcement > new.announcement => Some(held),
            (None, Some(held)) => Some(held),
            (value, _) => value,
        };
        self.answer = Some((Instant::now() + ANSWER_FOR, value));
        self.retry_after = None;
    }
}
/// What an office's memory answers now.
enum Memory {
    Answer(Option<Narrative>),
    /// A completed storage fault within its short gate.
    Gated,
    Missing,
}
struct Inner<T> {
    store: Store<T>,
    source: Arc<dyn Source>,
    /// One fetch and publication per office at a time, shared by the periodic refresh and the
    /// request race (RR2-narrative-singleflight): a caller that comes while one runs joins it.
    fetches: crate::resolver::OwnedFlights<u16, Fetched>,
    cycle: Mutex<()>,
    cache: [std::sync::Mutex<OfficeCache>; 10],
    /// Bumped whenever an office's memory changes.
    changed: [tokio::sync::watch::Sender<u64>; 10],
}
/// The narrative service: stored reads run as owned work per office (KMA-RESTART-RACE: a
/// waiter that stops waiting neither cancels a read nor keeps its answer from the next request),
/// and the periodic refresh acquires every office.
pub struct Service<T> {
    inner: Arc<Inner<T>>,
}
impl<T: IndexListing + Clone> Service<T> {
    pub fn new(transport: T, source: Arc<dyn Source>) -> Result<Self, Error> {
        Ok(Self {
            inner: Arc::new(Inner {
                store: Store::new(transport)?,
                source,
                fetches: crate::resolver::OwnedFlights::new(crate::resolver::OwnedConfig {
                    running: OFFICES.len(),
                    entries: OFFICES.len() * 4,
                    retain: Duration::from_secs(3),
                })
                .expect("static narrative fetch bounds"),
                cycle: Mutex::new(()),
                cache: std::array::from_fn(|_| std::sync::Mutex::new(OfficeCache::default())),
                changed: std::array::from_fn(|_| tokio::sync::watch::channel(0).0),
            }),
        })
    }
}
fn office_index(station: u16) -> Option<usize> {
    OFFICES.iter().position(|o| o.0 == station)
}
impl<T: IndexListing + Clone + 'static> Inner<T> {
    fn office(&self, i: usize) -> std::sync::MutexGuard<'_, OfficeCache> {
        self.cache[i].lock().unwrap_or_else(|e| e.into_inner())
    }
    fn memory(&self, i: usize) -> Memory {
        let cache = self.office(i);
        if let Some((until, value)) = cache.answer.as_ref()
            && Instant::now() < *until
        {
            let now = now_ms();
            return Memory::Answer(value.as_ref().filter(|n| n.fresh(now)).cloned());
        }
        if cache
            .retry_after
            .is_some_and(|until| Instant::now() < until)
        {
            return Memory::Gated;
        }
        Memory::Missing
    }
    fn changed(&self, i: usize) {
        self.changed[i].send_modify(|n| *n = n.wrapping_add(1));
    }
    /// Start the owned store read of an office unless one runs. Its outcome is the office's
    /// answer (a fault: the short gate); a newer narrative a raced acquisition published
    /// meanwhile stays.
    fn start_read(self: &Arc<Self>, i: usize, station: u16) {
        {
            let mut cache = self.office(i);
            if cache.reading {
                return;
            }
            cache.reading = true;
        }
        let inner = self.clone();
        crate::observability::spawn(async move {
            let reading = Reading(inner.clone(), i);
            let result = crate::observability::observe(
                crate::observability::Component::Domestic,
                crate::observability::Stage::Lookup,
                inner
                    .store
                    .read(station, now_ms(), Instant::now() + READ_FOR),
            )
            .await;
            {
                let mut cache = inner.office(i);
                match result {
                    Ok(value) => cache.install(value),
                    Err(_) => {
                        // Preserve any expired answer without extending its TTL or serving it
                        // stale.
                        cache.retry_after = Some(Instant::now() + ERROR_RETRY);
                    }
                }
            }
            drop(reading);
            inner.changed(i);
        });
    }
    /// At `race_at` an office whose stored read has no answer yet (still running, or failed)
    /// gets one acquisition and publication, at most once per [`RACE_RETRY`]; the published
    /// narrative answers unless the office holds a newer one by then. An answer by then (a
    /// narrative or none stored) asks nothing, as a running process asks nothing during a request.
    fn race(self: &Arc<Self>, i: usize, station: u16, race_at: Instant) {
        let inner = self.clone();
        crate::observability::spawn(async move {
            tokio::time::sleep_until(race_at).await;
            if matches!(inner.memory(i), Memory::Answer(_)) {
                return;
            }
            {
                let mut cache = inner.office(i);
                if cache.raced.is_some_and(|at| at.elapsed() < RACE_RETRY) {
                    return;
                }
                cache.raced = Some(Instant::now());
            }
            crate::resolver::race::raced(crate::observability::Component::Domestic);
            inner.acquire(i, station).await;
        });
    }
    /// Fetch and publish office `i` ([`Self::fetch`]) and install what the publication selected
    /// unless the office holds a newer narrative: the race and the periodic refresh both end so,
    /// whichever of them and the stored read ends last.
    async fn acquire(self: &Arc<Self>, i: usize, station: u16) {
        if let Some(Some(published)) = self.fetch(station).await {
            self.office(i).install(Some(published));
            self.changed(i);
        }
    }
    /// Fetch and publish `station`'s narrative, or join the fetch of it that runs: one provider
    /// call however many callers come while it runs (and within a few seconds after).
    async fn fetch(self: &Arc<Self>, station: u16) -> Fetched {
        let inner = self.clone();
        let waited = self
            .fetches
            .wait(station, FETCH_FOR + PUBLISH_FOR, move |_| async move {
                let deadline = Instant::now() + FETCH_FOR;
                let fetched = crate::observability::observe(
                    crate::observability::Component::Provider,
                    crate::observability::Stage::Acquire,
                    async {
                        tokio::time::timeout_at(deadline, inner.source.fetch(station, deadline))
                            .await
                            .map_err(|_| super::provider::Error::Deadline)?
                    },
                )
                .await;
                let Ok(Some(page)) = fetched else {
                    return None;
                };
                crate::observability::observe(
                    crate::observability::Component::Domestic,
                    crate::observability::Stage::Publish,
                    inner
                        .store
                        .publish(station, page, Instant::now() + PUBLISH_FOR),
                )
                .await
                .ok()
            })
            .await;
        match waited {
            crate::resolver::Waited::Ready(fetched) => fetched,
            _ => None,
        }
    }
}
/// Marks an office's owned read ended when dropped (also if the read panicked).
struct Reading<T: IndexListing + Clone + 'static>(Arc<Inner<T>>, usize);
impl<T: IndexListing + Clone + 'static> Drop for Reading<T> {
    fn drop(&mut self) {
        self.0.office(self.1).reading = false;
    }
}
impl<T: IndexListing + Clone + 'static> Read for Service<T> {
    fn read(&self, station: u16, deadline: Instant) -> BoxFuture<'_, Option<Narrative>> {
        Box::pin(async move {
            let i = office_index(station)?;
            let mut changes = self.inner.changed[i].subscribe();
            loop {
                match self.inner.memory(i) {
                    Memory::Answer(value) => return value,
                    Memory::Gated => return None,
                    Memory::Missing => self.inner.start_read(i, station),
                }
                // The read goes on past this waiter; the next request uses its answer.
                match tokio::time::timeout_at(deadline, changes.changed()).await {
                    Ok(Ok(())) => {}
                    _ => return None,
                }
            }
        })
    }
    fn prefetch(&self, station: u16, race_at: Instant) {
        let Some(i) = office_index(station) else {
            return;
        };
        match self.inner.memory(i) {
            Memory::Answer(_) => return,
            Memory::Gated => {}
            Memory::Missing => self.inner.start_read(i, station),
        }
        self.inner.race(i, station, race_at);
    }
}
impl<T: IndexListing + Clone + 'static> Acquire for Service<T> {
    fn refresh(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let Ok(_cycle) = self.inner.cycle.try_lock() else {
                return;
            };
            for (i, (station, _, _)) in OFFICES.iter().enumerate() {
                // A request race fetching the office now is joined, not repeated.
                self.inner.acquire(i, *station).await;
            }
        })
    }
}
