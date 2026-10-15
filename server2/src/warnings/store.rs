//! Durable warning reads/writes on S06 catalogs. Type catalogs are the only latest authority.
use super::{
    js,
    provider::kst_date,
    records::{self, Bulletin, Member, SOURCE, ZONE_KIND, ZONE_SEED_KIND},
    zones::{Entry, ZoneState, prepare_events},
};
use crate::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error, LookupOutcome,
    Object, ObjectTransport, PageOutcome, PreparedRecord, RawRecord, ReadOrder, RepairOutcome,
    RepairScope, WriteCondition, decode_list,
};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    task::JoinSet,
    time::Instant,
};

/// Days the collector may still (re)publish: `planDays` covers today - 59 .. today.
pub const ZONE_LOOKBACK_DAYS: i64 = 59;
const FLASH_VALID_MS: i64 = 10 * 3_600_000;
/// The earliest date a raw-record period can carry (`Period` validation); discovery scans
/// every year down to it, so no stored bulletin is excluded by age.
const FIRST_DATE: u32 = 19700101;
/// Bounded restarts when a concurrent publication changes a catalog between pages.
const PAGE_RESTARTS: usize = 3;

#[derive(Clone, Debug)]
pub struct StoreConfig {
    /// Days per walk wave; the first wave is also the recent repair window.
    pub wave: usize,
    /// Store-wide bound on concurrent S3 read operations (day reads and discovery LISTs),
    /// shared by every walk, zone refresh and collector check of this store.
    pub reads: usize,
    /// Complete acquisitions materialized per paged read when a day exceeds one read.
    pub page_acquisitions: usize,
    /// LIST pages allowed per discovery year (1000 keys each).
    pub list_pages: usize,
}
impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            wave: 8,
            reads: 4,
            page_acquisitions: 8,
            list_pages: 256,
        }
    }
}
impl StoreConfig {
    pub fn validate(&self) -> Result<(), Error> {
        if !(1..=16).contains(&self.wave)
            || !(1..=16).contains(&self.reads)
            || !(1..=64).contains(&self.page_acquisitions)
            || !(1..=4096).contains(&self.list_pages)
        {
            return Err(Error::Invalid("warning store config"));
        }
        Ok(())
    }
}
/// Operator-visible counters (no identities or bodies).
#[derive(Debug, Default)]
pub struct Counters {
    pub day_lookups: AtomicU64,
    pub paged_days: AtomicU64,
    pub repairs: AtomicU64,
    pub repaired_days: AtomicU64,
    pub incomplete_days: AtomicU64,
    pub excluded: AtomicU64,
    pub published: AtomicU64,
    pub list_pages: AtomicU64,
}
/// Per-acquisition results of one partition plus how they were obtained.
#[derive(Debug)]
pub struct Day<R> {
    pub items: Vec<R>,
    pub repaired: bool,
    pub incomplete: bool,
}
impl<R> Default for Day<R> {
    fn default() -> Self {
        Self {
            items: vec![],
            repaired: false,
            incomplete: false,
        }
    }
}
/// Shares one transport between the catalog store and bounded discovery LISTs.
pub struct Shared<T>(Arc<T>);
impl<T: ObjectTransport> ObjectTransport for Shared<T> {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        self.0.put(record).await
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        self.0.head(key).await
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
        self.0.get(key, maximum).await
    }
    async fn ready(&self) -> Result<(), Error> {
        self.0.ready().await
    }
}
impl<T: CatalogTransport> CatalogTransport for Shared<T> {
    async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
        self.0.get_control(key, maximum).await
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        self.0.put_control(key, body, condition).await
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        maximum_keys: usize,
        maximum_bytes: usize,
    ) -> Result<Vec<u8>, Error> {
        self.0
            .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
            .await
    }
}
async fn acquire(reads: &Arc<Semaphore>, deadline: Instant) -> Result<OwnedSemaphorePermit, Error> {
    tokio::time::timeout_at(deadline, reads.clone().acquire_owned())
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|_| Error::Transport)
}
type Map<R> = Arc<dyn Fn(&[RawRecord]) -> Result<R, Error> + Send + Sync>;
struct Reader<T> {
    catalogs: Arc<CatalogStore<Shared<T>>>,
    counters: Arc<Counters>,
    page: usize,
    reads: Arc<Semaphore>,
}
impl<T> Clone for Reader<T> {
    fn clone(&self) -> Self {
        Self {
            catalogs: self.catalogs.clone(),
            counters: self.counters.clone(),
            page: self.page,
            reads: self.reads.clone(),
        }
    }
}
impl<T: CatalogTransport> Reader<T> {
    /// Every complete acquisition of a catalog in fetch order, mapped one at a time.
    /// `None` when the catalog is missing or has no complete acquisition.
    async fn read<R>(
        &self,
        id: &CatalogId,
        map: &Map<R>,
        deadline: Instant,
    ) -> Result<Option<Vec<R>>, Error> {
        match self.catalogs.lookup(id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => {
                return set
                    .acquisitions()
                    .iter()
                    .map(|a| map(a.records()))
                    .collect::<Result<Vec<_>, _>>()
                    .map(Some);
            }
            Ok(LookupOutcome::Incomplete) => return Ok(None),
            // The whole history exceeds one read's output bound: page whole acquisitions.
            Err(Error::Capacity) => {}
            Err(e) => return Err(e),
        }
        self.counters.paged_days.fetch_add(1, Ordering::Relaxed);
        // Each published group fit one operation, so a one-acquisition page always fits.
        let mut size = self.page;
        let mut restarts = 0;
        while restarts < PAGE_RESTARTS {
            let mut out = Vec::new();
            let mut cursor = None;
            let complete = loop {
                let page = match self
                    .catalogs
                    .lookup_page(
                        id,
                        ReadOrder::EarliestFirst,
                        cursor.as_ref(),
                        size,
                        deadline,
                    )
                    .await
                {
                    Err(Error::Capacity) if size > 1 => {
                        size = (size / 2).max(1);
                        break None;
                    }
                    other => other?,
                };
                match page {
                    PageOutcome::Incomplete if cursor.is_none() => return Ok(None),
                    // A concurrent publication changed the cohort: restart from the first page.
                    PageOutcome::Incomplete => break Some(false),
                    PageOutcome::Ready(page) => {
                        for a in page.acquisitions() {
                            out.push(map(a.records())?);
                        }
                        match page.next() {
                            Some(next) => cursor = Some(next.clone()),
                            None => break Some(true),
                        }
                    }
                }
            };
            match complete {
                Some(true) => return Ok(Some(out)),
                Some(false) => restarts += 1,
                // Smaller pages: restart without consuming a churn restart.
                None => {}
            }
        }
        Err(Error::Capacity)
    }
    /// One partition; a missing or unusable catalog is repaired from its exact raw prefix.
    async fn day<R>(
        &self,
        kind: &str,
        date: u32,
        map: &Map<R>,
        deadline: Instant,
    ) -> Result<Day<R>, Error> {
        // Each day read holds one store-wide slot for its whole lookup/repair sequence, so
        // concurrent walks never exceed `reads` S3 operations (S3 admission is finite).
        let _slot = acquire(&self.reads, deadline).await?;
        self.counters.day_lookups.fetch_add(1, Ordering::Relaxed);
        let id = records::catalog(kind, date)?;
        if let Some(items) = self.read(&id, map, deadline).await? {
            return Ok(Day {
                items,
                ..Day::default()
            });
        }
        // An acknowledged group always has its published catalog and catalogs are never
        // deleted, so an incomplete or failed repair cannot hide an acknowledged record.
        self.counters.repairs.fetch_add(1, Ordering::Relaxed);
        let scope = RepairScope {
            catalog: id.clone(),
            periods: vec![records::period(kind, date)],
        };
        let incomplete = || {
            self.counters
                .incomplete_days
                .fetch_add(1, Ordering::Relaxed);
            Day {
                incomplete: true,
                ..Day::default()
            }
        };
        match self.catalogs.repair_index(&scope, deadline).await {
            Ok(RepairOutcome::CompleteEmpty { .. }) => Ok(Day::default()),
            Ok(RepairOutcome::Indexed { .. } | RepairOutcome::Complete(_)) => {
                match self.read(&id, map, deadline).await? {
                    Some(items) => {
                        self.counters.repaired_days.fetch_add(1, Ordering::Relaxed);
                        Ok(Day {
                            items,
                            repaired: true,
                            incomplete: false,
                        })
                    }
                    None => Ok(incomplete()),
                }
            }
            Ok(RepairOutcome::Incomplete) | Err(_) => Ok(incomplete()),
        }
    }
}
pub struct WarningStore<T> {
    transport: Arc<T>,
    reader: Reader<T>,
    limits: CatalogLimits,
    config: StoreConfig,
    pub counters: Arc<Counters>,
}
fn bulletin_map(kind: u8, date: u32, counters: Arc<Counters>) -> Map<Option<Bulletin>> {
    Arc::new(move |records| {
        let b = records::derive(kind, records)?;
        if b.as_ref().is_some_and(|b| b.date() != date) {
            counters.excluded.fetch_add(1, Ordering::Relaxed);
            return Ok(None);
        }
        Ok(b)
    })
}
/// The greatest announcement; equal announcements keep the earliest fetch (fetch order input).
fn best(items: Vec<Option<Bulletin>>) -> Option<Bulletin> {
    let mut found: Option<Bulletin> = None;
    for b in items.into_iter().flatten() {
        if found.as_ref().is_none_or(|f| b.stored_ms > f.stored_ms) {
            found = Some(b);
        }
    }
    found
}
impl<T: CatalogTransport> WarningStore<T> {
    pub fn new(transport: T, limits: CatalogLimits, config: StoreConfig) -> Result<Self, Error> {
        config.validate()?;
        let transport = Arc::new(transport);
        let counters = Arc::new(Counters::default());
        Ok(Self {
            reader: Reader {
                catalogs: Arc::new(CatalogStore::new(
                    Shared(transport.clone()),
                    limits.clone(),
                )?),
                counters: counters.clone(),
                page: config.page_acquisitions,
                reads: Arc::new(Semaphore::new(config.reads)),
            },
            transport,
            limits,
            config,
            counters,
        })
    }
    pub fn limits(&self) -> &CatalogLimits {
        &self.limits
    }
    pub fn config(&self) -> &StoreConfig {
        &self.config
    }
    /// Acknowledged only when every member, descriptor and catalog is durable (O-9).
    pub async fn publish(
        &self,
        kind: &str,
        date: u32,
        members: Vec<Member>,
        deadline: Instant,
    ) -> Result<(), Error> {
        let (declaration, raw) = records::group(kind, date, members, &self.limits)?;
        // Publication I/O (preflight/CAS catalog reads, raw/descriptor PUTs, reconciliation
        // HEAD/GET and final verification) is sequential, so one slot bounds it as well.
        let _slot = acquire(&self.reader.reads, deadline).await?;
        self.reader
            .catalogs
            .publish(declaration, raw, deadline)
            .await?;
        self.counters.published.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    /// Raw records of one partition, acquisition by acquisition.
    pub async fn day(
        &self,
        kind: &str,
        date: u32,
        deadline: Instant,
    ) -> Result<Day<Vec<RawRecord>>, Error> {
        let map: Map<Vec<RawRecord>> = Arc::new(|r| Ok(r.to_vec()));
        self.reader.day(kind, date, &map, deadline).await
    }
    /// Evaluate `dates` in order in bounded concurrent waves; the first `Some` of `pick` wins.
    async fn first<R: Send + 'static, P>(
        &self,
        kind: &str,
        dates: Vec<u32>,
        map: &impl Fn(u32) -> Map<R>,
        mut pick: impl FnMut(Day<R>) -> Option<P>,
        deadline: Instant,
    ) -> Result<Option<P>, Error> {
        for wave in dates.chunks(self.config.wave) {
            let mut set = JoinSet::new();
            for (i, date) in wave.iter().enumerate() {
                let (reader, kind, date, map) =
                    (self.reader.clone(), kind.to_owned(), *date, map(*date));
                set.spawn(async move { (i, reader.day(&kind, date, &map, deadline).await) });
            }
            let mut results = Vec::new();
            while let Some(joined) = set.join_next().await {
                results.push(joined.map_err(|_| Error::Transport)?);
            }
            results.sort_by_key(|r| r.0);
            for (_, result) in results {
                if let Some(p) = pick(result?) {
                    return Ok(Some(p));
                }
            }
        }
        Ok(None)
    }
    /// Distinct partition dates with raw objects of `kind` in `year`, from a complete LIST.
    async fn listed(
        &self,
        kind: &str,
        year: i64,
        deadline: Instant,
    ) -> Result<BTreeSet<u32>, Error> {
        let prefix = format!("raw/v2/{SOURCE}/{kind}/{year:04}/");
        let mut dates = BTreeSet::new();
        let mut token: Option<String> = None;
        let mut tokens = BTreeSet::new();
        for _ in 0..self.config.list_pages {
            let _slot = acquire(&self.reader.reads, deadline).await?;
            let list = tokio::time::timeout_at(
                deadline,
                self.transport.list_raw_document(
                    &prefix,
                    token.as_deref(),
                    1000,
                    self.limits.control_bytes,
                ),
            )
            .await
            .map_err(|_| Error::Timeout)??;
            self.counters.list_pages.fetch_add(1, Ordering::Relaxed);
            let page = decode_list(&list, 1000)?;
            for key in page.keys {
                let rest = key
                    .strip_prefix(&prefix)
                    .ok_or(Error::Corrupt("LIST scope"))?;
                let mut parts = rest.split('/');
                let (Some(m), Some(d)) = (parts.next(), parts.next()) else {
                    return Err(Error::Corrupt("raw key layout"));
                };
                let date = format!("{year:04}{m}{d}")
                    .parse::<u32>()
                    .map_err(|_| Error::Corrupt("raw key date"))?;
                dates.insert(date);
            }
            match page.next {
                None => return Ok(dates),
                Some(next) => {
                    if !tokens.insert(next.clone()) {
                        return Err(Error::Corrupt("repeated LIST token"));
                    }
                    token = Some(next);
                }
            }
        }
        // An unfinished LIST cannot prove which day is newest.
        Err(Error::Capacity)
    }
    /// Dates of `kind` with raw objects in `[from, to]`, newest first, discovered by year.
    async fn discovered(
        &self,
        kind: &str,
        from: u32,
        to: u32,
        deadline: Instant,
    ) -> Result<Vec<u32>, Error> {
        let mut out = Vec::new();
        if from > to {
            return Ok(out);
        }
        for year in (i64::from(from / 10000)..=i64::from(to / 10000)).rev() {
            let dates = self.listed(kind, year, deadline).await?;
            out.extend(dates.into_iter().rev().filter(|d| (from..=to).contains(d)));
        }
        Ok(out)
    }
    /// Latest bulletin of `kind` at `now_ms`. Types 1-3 have no age expiry: after the recent
    /// day walk, older days are discovered by complete raw LISTs back to 1970, the earliest
    /// storable period. Announcements after KST tomorrow cannot come from the provider.
    /// Type 4 is `None` once `stored + 10 h < now` (actual + 19 h). `floor` (a known older
    /// partition) bounds memory refreshes.
    pub async fn latest(
        &self,
        kind: u8,
        now_ms: i64,
        floor: Option<u32>,
        deadline: Instant,
    ) -> Result<Option<Bulletin>, Error> {
        if !(1..=4).contains(&kind) {
            return Err(Error::Invalid("warning type"));
        }
        let newest = js::day_index(kst_date(now_ms, 1));
        let floor_index = floor.map(js::day_index);
        let mut oldest = if kind == 4 {
            js::day_index(js::ymd(now_ms - FLASH_VALID_MS))
        } else {
            newest - self.config.wave as i64 + 1
        };
        if let Some(f) = floor_index {
            oldest = oldest.max(f);
        }
        let name = records::bulletin_kind(kind);
        let counters = self.counters.clone();
        let map = |date| bulletin_map(kind, date, counters.clone());
        let recent: Vec<u32> = (oldest..=newest).rev().map(js::date_of_index).collect();
        let mut found = self
            .first(name, recent, &map, |day| best(day.items), deadline)
            .await?;
        if found.is_none() && kind != 4 && floor_index.is_none_or(|f| f < oldest) {
            let low = floor.unwrap_or(FIRST_DATE);
            let older = self
                .discovered(name, low, js::date_of_index(oldest - 1), deadline)
                .await?;
            found = self
                .first(name, older, &map, |day| best(day.items), deadline)
                .await?;
        }
        Ok(found.filter(|b| kind != 4 || b.stored_ms + FLASH_VALID_MS >= now_ms))
    }
    /// True when a complete acquisition already derives this announcement (legacy `_exists`).
    pub async fn exists(&self, kind: u8, stored_ms: i64, deadline: Instant) -> Result<bool, Error> {
        let date = js::ymd(stored_ms);
        let map = bulletin_map(kind, date, self.counters.clone());
        let day = self
            .reader
            .day(records::bulletin_kind(kind), date, &map, deadline)
            .await?;
        Ok(day.items.iter().flatten().any(|b| b.stored_ms == stored_ms))
    }
    /// getPwnCd rows of the given days, ascending by day, then fetch order.
    async fn zone_rows(&self, mut dates: Vec<u32>, deadline: Instant) -> Result<Vec<Value>, Error> {
        dates.sort_unstable();
        let map = |_| -> Map<Vec<Value>> { Arc::new(records::zone_rows) };
        let mut rows = Vec::new();
        self.first(
            ZONE_KIND,
            dates,
            &map,
            |day| {
                rows.extend(day.items.into_iter().flatten());
                None::<()>
            },
            deadline,
        )
        .await?;
        Ok(rows)
    }
    /// Zone state: newest legacy zone seed, then every published getPwnCd revision since the
    /// seed snapshot (all published days without a seed), replayed as one batch in memory.
    pub async fn zone_state(&self, now_ms: i64, deadline: Instant) -> Result<ZoneState, Error> {
        let mut state = ZoneState::default();
        let seed = self
            .day(ZONE_SEED_KIND, records::SEED_DATE, deadline)
            .await?;
        let mut from = FIRST_DATE;
        if let Some(latest) = seed.items.last() {
            let docs = records::zone_seed(latest)?;
            for doc in &docs {
                if let Some(entry) = Entry::from_legacy(doc) {
                    state.insert(entry);
                }
            }
            // The snapshot reflects events only through its `_sync.lastSyncAt` (a later export
            // time proves nothing); getPwnCd rows are final at D+2, so replay from two days
            // before that sync. Without a valid marker, replay every published day.
            // An unfinished legacy bootstrap (covered start later than sync - 59 days) has not
            // seen older days either, so it also replays everything.
            let marker = docs
                .iter()
                .find(|d| d.get("areaCode").and_then(Value::as_str) == Some("_sync"));
            let synced = marker
                .and_then(|d| d.get("lastSyncAt"))
                .and_then(Value::as_str)
                .and_then(js::parse_iso);
            let covered = |synced: i64| {
                marker
                    .and_then(|d| d.get("oldestSyncedTmFc"))
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<u32>().ok())
                    .is_some_and(|oldest| oldest <= kst_date(synced, -ZONE_LOOKBACK_DAYS))
            };
            if let Some(synced) = synced.filter(|s| covered(*s)) {
                let exported = latest[0].envelope.identity.fetched_at_ms as i64;
                from = kst_date(synced.min(exported), -2).max(FIRST_DATE);
            }
        }
        let today = js::day_index(kst_date(now_ms, 0));
        let recent_start = (today - ZONE_LOOKBACK_DAYS).max(js::day_index(from));
        // Older published days are discovered; recent days are probed directly so complete
        // orphan groups the collector may still be writing are repaired.
        let mut dates = self
            .discovered(
                ZONE_KIND,
                from,
                js::date_of_index(recent_start - 1),
                deadline,
            )
            .await?;
        dates.extend((recent_start..=today).map(js::date_of_index));
        let rows = self.zone_rows(dates, deadline).await?;
        state.apply(&prepare_events(&rows));
        Ok(state)
    }
    /// Rows of the days the collector can still publish (warm refresh on top of a state).
    pub async fn recent_zone_rows(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Vec<Value>, Error> {
        let today = js::day_index(kst_date(now_ms, 0));
        let dates = (today - ZONE_LOOKBACK_DAYS..=today)
            .map(js::date_of_index)
            .collect();
        self.zone_rows(dates, deadline).await
    }
    /// Zone sync progress derived from published day catalogs:
    /// (last fetch time, oldest day of the contiguous covered range).
    pub async fn zone_progress(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Option<(u64, u32)>, Error> {
        let today = js::day_index(kst_date(now_ms, 0));
        let map = |_| -> Map<u64> {
            Arc::new(|r: &[RawRecord]| {
                Ok(r.iter()
                    .map(|x| x.envelope.identity.fetched_at_ms)
                    .max()
                    .unwrap_or(0))
            })
        };
        let dates: Vec<u32> = (today - ZONE_LOOKBACK_DAYS..=today)
            .rev()
            .map(js::date_of_index)
            .collect();
        let mut days = Vec::new();
        self.first(
            ZONE_KIND,
            dates.clone(),
            &map,
            |day| {
                days.push(day.items);
                None::<()>
            },
            deadline,
        )
        .await?;
        let mut newest: Option<(u64, u32)> = None;
        let mut covered = true;
        for (date, items) in dates.into_iter().zip(days) {
            if items.is_empty() {
                if newest.is_some() {
                    covered = false;
                }
                continue;
            }
            let fetched = items.into_iter().max().unwrap_or(0);
            match &mut newest {
                None => newest = Some((fetched, date)),
                Some((_, oldest)) if covered => *oldest = date,
                Some(_) => {}
            }
        }
        Ok(newest)
    }
}
