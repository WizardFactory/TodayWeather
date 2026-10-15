//! S15b-3b: the life-index, KASI and MFDS inputs of one request.
//!
//! Every input is a national dataset shared by all requests (AK, 2026-10-14):
//! - the life index: S13 `uv-idx-v5` (all areas, one issuance every three hours) and
//!   `oak|pine|weeds-pollen-v3` (all areas, 06 and 18 KST) acquisitions of the last 14 days,
//!   folded with the legacy save rules ([`LifeIndex`]);
//! - MFDS food-poisoning risk: `mfds-food-poisoning` acquisitions of the last three KST days
//!   ([`FoodPoisoning`]);
//! - KASI rise/set: `kasi-area-rise-set` acquisitions of every area for the UTC days D-8..D+9
//!   ([`RiseSets`]).
//!
//! S3 reads run as owned single-flight tasks that update the process folds; a request waits for
//! them only until its own deadline and otherwise answers with the last folds.
//!
//! Freshness (owned acquisitions, S13d `OwnedFlights`, 10-minute retry per dataset key): a
//! request whose UV fold lacks the current three-hour slot, whose pollen fold lacks the latest
//! 06/18 KST issuance, or whose MFDS fold lacks the current 08:20/12:20/17:20 KST slot starts the
//! acquisition and waits for it only until its deadline (then answers with what S3 holds, the
//! legacy output for missing data). A pollen issuance the provider answers with no data (out of
//! season, `99`) is not asked again; an MFDS slot is asked once (legacy `lastSlot`). KASI is
//! captured while requests arrive (legacy `gatherKasiRiseSet`, hourly): every missing area/day,
//! today's column first; requests never wait for it and answer `[]` until the first full S3 read
//! (legacy then computes rise/set itself).
use super::kasi::RiseSets;
use super::life::{KINDS, LifeIndex};
use super::life_live::{LifeAcquire, LifeOutcome, LifeRequest};
use super::live::Flights;
use super::mfds::FoodPoisoning;
use super::records::{Fetched, Reader, months};
use crate::domestic::acquire::Paged;
use crate::domestic::family::{DataGoKrFamily, DataGoKrRequest, Target};
use crate::domestic::mfds::{self as mfds_provider, MfdsRequest};

use crate::domestic::publication::{self, Publication};
use crate::domestic::riseset::{AREAS, RiseSetRequest};
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::resolver::{OwnedConfig, OwnedFlights};
use crate::storage::{CatalogStore, ProviderKey};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;
use tokio::time::Instant;

const DATA_GO_KR: &str = "data-go-kr";
const HOUR_MS: f64 = 3_600_000.;
const DAY_MS: f64 = 86_400_000.;
/// Acquisitions read for the life index: documents live 10 days after their date and a pollen
/// issuance dates documents up to 3 days ahead, so 14 days cover every stored document.
const LIFE_LOOKBACK_MS: f64 = 14. * DAY_MS;
/// MFDS acquisitions read: a row's date is at most two days after its base date.
const MFDS_DAYS: i64 = 3;
/// A fold is re-read at most this often unless an own acquisition published.
const MEMO: Duration = Duration::from_secs(60);
/// A complete re-read of the life index (acquisitions of earlier partitions by other hosts).
const FULL_READ: Duration = Duration::from_secs(86_400);
/// The latest partitions of each life kind re-read on every refresh (a repeated acquisition of
/// the previous issuance lands in its partition).
const RECENT_PARTITIONS: usize = 3;
/// Retry throttle of one dataset key (S15b-3a).
const RETRY: Duration = Duration::from_secs(600);
/// Owned S3 read tasks.
const READ_FOR: Duration = Duration::from_secs(120);
/// Requests in this window keep the KASI capture running.
const DEMAND_MS: f64 = 24. * HOUR_MS;
/// KASI capture interval (legacy `gatherKasiRiseSet` at minute 55 of every hour).
const KASI_EVERY: Duration = Duration::from_secs(3600);
/// KASI documents older than this many days before the window are forgotten (the places they
/// name stay for the nearest-location choice).
const KASI_KEEP_DAYS: f64 = 30.;
/// A settled key outlives its slot or issuance.
const SETTLED_FOR: Duration = Duration::from_secs(2 * 86_400);
/// Bound of one KASI S3 listing or read-back.
const KASI_READ: Duration = Duration::from_secs(60);

/// One acquisition to apply: (kind index, completion instant, pages).
type Run = (usize, f64, Vec<Arc<[u8]>>);
/// The four life-index families and their legacy `indexType`.
pub const LIFE_FAMILIES: [(DataGoKrFamily, &str); 4] = [
    (DataGoKrFamily::UvIdxV5, KINDS[0]),
    (DataGoKrFamily::OakPollenV3, KINDS[1]),
    (DataGoKrFamily::PinePollenV3, KINDS[2]),
    (DataGoKrFamily::WeedsPollenV3, KINDS[3]),
];
fn all_areas() -> ProviderKey {
    ProviderKey::Named {
        id: "all-areas".into(),
    }
}
fn wall_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0., |d| d.as_millis() as f64)
}
/// `response.body.items.item` of every page in page order (an array, or one object as KASI
/// answers); None when a page is not an item page.
pub fn life_items(pages: &[Arc<[u8]>]) -> Option<Vec<Value>> {
    let mut out = Vec::new();
    for p in pages {
        let json: Value = serde_json::from_slice(p).ok()?;
        match json
            .get("response")?
            .get("body")?
            .get("items")?
            .get("item")?
        {
            Value::Array(a) => out.extend(a.iter().cloned()),
            item @ Value::Object(_) => out.push(item.clone()),
            _ => return None,
        }
    }
    Some(out)
}
/// The KST date `YYYYMMDD` of an instant.
fn kst_date(ms: f64) -> u32 {
    crate::world::js::parts(ms + 9. * HOUR_MS)
        .map_or(0, |p| (p.year * 10000 + p.month * 100 + p.day) as u32)
}
/// The UTC date `YYYYMMDD` of an instant.
fn utc_date(ms: f64) -> String {
    crate::world::js::parts(ms).map_or_else(String::new, |p| {
        format!("{:04}{:02}{:02}", p.year, p.month, p.day)
    })
}
/// The pollen issuance expected at `now`: the latest 06 or 18 KST hour.
pub fn pollen_issuance(now: f64) -> Option<Publication> {
    let hour = publication::pollen_time(now as i64)?;
    match hour.hour() {
        0..=5 => Publication::new(kst_date(now - DAY_MS), 1800),
        6..=17 => Publication::new(hour.date(), 600),
        _ => Publication::new(hour.date(), 1800),
    }
}
fn issuance10(p: Publication) -> String {
    p.compact()[..10].to_owned()
}

/// The single-flight key of a read at `now` after `published` own publications, the last
/// completed at `published_at`.
fn read_key(dataset: &str, published: u64, published_at: f64, now: f64) -> String {
    format!("{dataset}-{published}-{}", u8::from(now >= published_at))
}
/// Which outcome of an owned acquisition settles its key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Settle {
    /// Never (UV: retried after the throttle).
    Never,
    /// A no-data answer (pollen out of season).
    NoData,
    /// Any attempt (MFDS: once per slot).
    Always,
}
/// What one request reads from the life inputs.
#[derive(Clone)]
pub struct LifeAnswers {
    pub life: Arc<LifeIndex>,
    pub mfds: Arc<FoodPoisoning>,
    /// None until the first complete KASI read.
    pub kasi: Option<Arc<RiseSets>>,
}

#[derive(Default)]
struct LifeState {
    folded: Arc<LifeIndex>,
    /// Applied acquisitions: (kind index, partition, completion instant).
    seen: HashSet<(usize, String, u64)>,
    /// The order key of the last applied acquisition.
    last: Option<(u64, &'static str, String)>,
    /// Acquisitions completed after `cut` are not applied yet; the cut never moves back.
    cut: f64,
    refreshed: Option<std::time::Instant>,
    full: Option<std::time::Instant>,
    /// The own-publication count the fold has read (a newer one invalidates the memo).
    published: u64,
}
#[derive(Default)]
struct MfdsState {
    folded: Arc<FoodPoisoning>,
    /// Collection slots (`YYYYMMDDHHMM`) with an applied acquisition (the record period chosen
    /// before the call, as legacy `collect` keeps the queued time for slot identity).
    slots: HashSet<String>,
    cut: f64,
    refreshed: Option<std::time::Instant>,
    published: u64,
}
#[derive(Default)]
struct KasiState {
    folded: Arc<RiseSets>,
    loaded: bool,
}

struct Shared<T> {
    reader: Reader<T>,
    acquire: Option<Arc<dyn LifeAcquire>>,
    flights: Flights,
    reads: OwnedFlights<String, bool>,
    life: std::sync::Mutex<LifeState>,
    mfds: std::sync::Mutex<MfdsState>,
    kasi: std::sync::Mutex<KasiState>,
    /// One refresh of a fold at a time: each starts from the committed state and commits fold,
    /// applied set, cut and publication count together.
    life_refresh: tokio::sync::Mutex<()>,
    mfds_refresh: tokio::sync::Mutex<()>,
    /// Dataset keys not asked again (a no-data pollen issuance, an asked MFDS slot), kept
    /// [`SETTLED_FOR`].
    settled: std::sync::Mutex<HashMap<String, std::time::Instant>>,
    demand_ms: AtomicI64,
    /// Own publications so far: a read started before one cannot answer a request that waited
    /// for it.
    published: std::sync::atomic::AtomicU64,
    /// Wall-clock ms when the last own publication completed: a fold whose cut is earlier does
    /// not contain it, whatever count it read.
    published_at: AtomicI64,
    kasi_started: AtomicBool,
    /// First KASI pass after the first request, then every `kasi_every`.
    kasi_first: Duration,
    kasi_every: Duration,
    cpu: Arc<tokio::sync::Semaphore>,
}
/// Inputs shared by every request of the process.
pub struct LifeInputs<T> {
    shared: Arc<Shared<T>>,
}
impl<T: IndexListing + Clone + 'static> LifeInputs<T> {
    pub fn new(transport: T, store: Arc<CatalogStore<T>>) -> Self {
        Self::build(
            Reader { transport, store },
            None,
            (Duration::ZERO, KASI_EVERY),
        )
    }
    fn build(
        reader: Reader<T>,
        acquire: Option<Arc<dyn LifeAcquire>>,
        (kasi_first, kasi_every): (Duration, Duration),
    ) -> Self {
        let reads = OwnedFlights::new(OwnedConfig {
            running: 8,
            entries: 64,
            // A read that ended answers no later joiner: the memo decides when to read again.
            retain: Duration::ZERO,
        })
        .expect("valid read bounds");
        Self {
            shared: Arc::new(Shared {
                reader,
                acquire,
                flights: Flights::new(RETRY),
                reads,
                life: Default::default(),
                mfds: Default::default(),
                kasi: Default::default(),
                life_refresh: Default::default(),
                mfds_refresh: Default::default(),
                settled: Default::default(),
                demand_ms: AtomicI64::new(0),
                published: std::sync::atomic::AtomicU64::new(0),
                published_at: AtomicI64::new(0),
                kasi_started: AtomicBool::new(false),
                kasi_first,
                kasi_every,
                cpu: Arc::new(tokio::sync::Semaphore::new(2)),
            }),
        }
    }
    /// Owned acquisitions (None: stored records only).
    pub fn with_acquire(self, acquire: Option<Arc<dyn LifeAcquire>>) -> Self {
        let s = Arc::try_unwrap(self.shared).unwrap_or_else(|_| panic!("unshared inputs"));
        Self::build(s.reader, acquire, (s.kasi_first, s.kasi_every))
    }
    /// The KASI capture schedule: the first pass `first` after the first request, then every
    /// `every` (the runtime: at once, then hourly).
    pub fn with_kasi_schedule(self, first: Duration, every: Duration) -> Self {
        let s = Arc::try_unwrap(self.shared).unwrap_or_else(|_| panic!("unshared inputs"));
        Self::build(s.reader, s.acquire, (first, every))
    }
    /// The life, MFDS and KASI folds for a request at `now`. Waits end 200 ms before the
    /// deadline; whatever is not ready then is answered from the last folds.
    pub async fn load(&self, now: f64, deadline: Instant) -> LifeAnswers {
        let until = deadline - Duration::from_millis(200);
        self.note_demand();
        let (life, mfds) = tokio::join!(self.life(now, until), self.mfds(now, until));
        LifeAnswers {
            life,
            mfds,
            kasi: self.kasi(),
        }
    }
    fn kasi(&self) -> Option<Arc<RiseSets>> {
        let state = self.shared.kasi.lock().unwrap_or_else(|e| e.into_inner());
        state.loaded.then(|| state.folded.clone())
    }

    // ---- life index ----

    async fn life(&self, now: f64, until: Instant) -> Arc<LifeIndex> {
        self.read_life(now, until).await;
        let mut flights = Vec::new();
        if let Some(acquire) = self.shared.acquire.clone() {
            let folded = self.life_fold();
            // UV (legacy `taskUltrvV5`): the current three-hour slot, then each earlier
            // candidate while a slot answers no data; no data stays retryable.
            if let Some(slots) = publication::uv_slots(now as i64)
                && let Some(slot) = slots.first().copied()
                && folded
                    .last_issued(KINDS[0])
                    .is_none_or(|l| l < issuance10(slot).as_str())
            {
                let candidates: Vec<LifeRequest> = slots
                    .iter()
                    .filter_map(|p| {
                        DataGoKrRequest::new(DataGoKrFamily::UvIdxV5, Target::AllAreas, *p).ok()
                    })
                    .map(LifeRequest::Index)
                    .collect();
                flights.push(self.flight(
                    acquire.clone(),
                    format!("uv-{}", slot.compact()),
                    candidates,
                    Settle::Never,
                    until,
                ));
            }
            let mut wanted: Vec<(DataGoKrFamily, Publication, String)> = Vec::new();
            if let (Some(expected), Some(time)) =
                (pollen_issuance(now), publication::pollen_time(now as i64))
            {
                for (family, kind) in &LIFE_FAMILIES[1..] {
                    if folded
                        .last_issued(kind)
                        .is_none_or(|l| l < issuance10(expected).as_str())
                    {
                        wanted.push((
                            *family,
                            time,
                            format!("{}-{}", family.kind(), expected.compact()),
                        ));
                    }
                }
            }
            for (family, time, key) in wanted {
                let Ok(request) = DataGoKrRequest::new(family, Target::AllAreas, time) else {
                    continue;
                };
                if self.is_settled(&key) {
                    continue;
                }
                flights.push(self.flight(
                    acquire.clone(),
                    key,
                    vec![LifeRequest::Index(request)],
                    Settle::NoData,
                    until,
                ));
            }
        }
        let published = crate::history::join_all(flights).await;
        if published.into_iter().any(|p| p) {
            self.read_life(wall_ms().max(now), until).await;
        }
        self.life_fold()
    }
    fn life_fold(&self) -> Arc<LifeIndex> {
        self.shared
            .life
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .folded
            .clone()
    }
    /// Join the owned S3 read of the life index (cut `now`) until `until`. The fold is read at
    /// most every MEMO (acquisitions of other hosts appear within it) unless an own acquisition
    /// published since its last read.
    async fn read_life(&self, now: f64, until: Instant) {
        {
            let state = self.shared.life.lock().unwrap_or_else(|e| e.into_inner());
            // An own publication completed after the fold's cut is not in it yet.
            if state.published == self.shared.published.load(Ordering::Acquire)
                && state.cut >= self.shared.published_at.load(Ordering::Acquire) as f64
                && state.refreshed.is_some_and(|r| r.elapsed() < MEMO)
            {
                return;
            }
        }
        let shared = self.shared.clone();
        let _ = self
            .shared
            .reads
            .join(
                self.read_key("life", now),
                until,
                READ_FOR,
                move |deadline| async move { read_life(&shared, now, deadline).await.is_ok() },
            )
            .await;
    }

    // ---- MFDS ----

    async fn mfds(&self, now: f64, until: Instant) -> Arc<FoodPoisoning> {
        self.read_mfds(now, until).await;
        if let (Some(acquire), Some(slot)) =
            (self.shared.acquire.clone(), mfds_provider::slot_at(now))
        {
            let collected = self
                .shared
                .mfds
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .slots
                .contains(&slot.compact());
            let key = format!("mfds-{}", slot.compact());
            // Legacy `collect` marks the slot before it fetches: a failure waits for the next
            // slot (the owned task settles the key; concurrent requests join it).
            if !collected
                && self
                    .flight(
                        acquire,
                        key,
                        vec![LifeRequest::Mfds(slot)],
                        Settle::Always,
                        until,
                    )
                    .await
            {
                self.read_mfds(wall_ms().max(now), until).await;
            }
        }
        self.shared
            .mfds
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .folded
            .clone()
    }
    async fn read_mfds(&self, now: f64, until: Instant) {
        {
            let state = self.shared.mfds.lock().unwrap_or_else(|e| e.into_inner());
            // An own publication completed after the fold's cut is not in it yet.
            if state.published == self.shared.published.load(Ordering::Acquire)
                && state.cut >= self.shared.published_at.load(Ordering::Acquire) as f64
                && state.refreshed.is_some_and(|r| r.elapsed() < MEMO)
            {
                return;
            }
        }
        let shared = self.shared.clone();
        let _ = self
            .shared
            .reads
            .join(
                self.read_key("mfds", now),
                until,
                READ_FOR,
                move |deadline| async move { read_mfds(&shared, now, deadline).await.is_ok() },
            )
            .await;
    }

    // ---- owned acquisitions ----

    fn is_settled(&self, key: &str) -> bool {
        let mut settled = self
            .shared
            .settled
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        settled.retain(|_, at| at.elapsed() < SETTLED_FOR);
        settled.contains_key(key)
    }
    /// The single-flight key of a read: one per dataset, own-publication count and whether the
    /// read's cut reaches the last own publication. A request never joins a read whose cut
    /// excludes a publication its own cut includes.
    fn read_key(&self, dataset: &str, now: f64) -> String {
        read_key(
            dataset,
            self.shared.published.load(Ordering::Acquire),
            self.shared.published_at.load(Ordering::Acquire) as f64,
            now,
        )
    }
    /// Start (or join) one owned acquisition and wait for it until `until`: true when it
    /// published by then. The owned task tries `requests` in order while one answers no data
    /// (UV slot candidates); `settle` decides which outcome marks the key not to be asked again.
    async fn flight(
        &self,
        acquire: Arc<dyn LifeAcquire>,
        key: String,
        requests: Vec<LifeRequest>,
        settle: Settle,
        until: Instant,
    ) -> bool {
        let owned_for = requests
            .iter()
            .map(LifeRequest::owned_for)
            .fold(Duration::ZERO, |a, b| a.saturating_add(b))
            .min(crate::resolver::owned::MAX_OWNED);
        let shared = self.shared.clone();
        let name = key.clone();
        let mark = move |shared: &Shared<T>| {
            shared
                .settled
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(name.clone(), std::time::Instant::now())
                .is_none()
        };
        self.shared
            .flights
            .join_for(
                &key,
                until,
                owned_for,
                move || -> BoxFuture<'static, bool> {
                    Box::pin(async move {
                        // Legacy `collect` marks the slot before it fetches.
                        if settle == Settle::Always && !mark(&shared) {
                            return false;
                        }
                        for request in requests {
                            match acquire.acquire(request).await {
                                Ok(LifeOutcome::Published) => {
                                    shared
                                        .published_at
                                        .fetch_max(wall_ms() as i64, Ordering::AcqRel);
                                    shared.published.fetch_add(1, Ordering::AcqRel);
                                    return true;
                                }
                                Ok(LifeOutcome::NoData) if settle == Settle::NoData => {
                                    mark(&shared);
                                    return false;
                                }
                                Ok(LifeOutcome::NoData) => continue,
                                Ok(LifeOutcome::Nothing) | Err(_) => return false,
                            }
                        }
                        false
                    })
                },
            )
            .await
    }

    // ---- KASI ----

    /// Record demand and start the KASI capture once (only with an acquirer: a stored-only
    /// source never reads KASI and answers `[]`).
    fn note_demand(&self) {
        self.shared
            .demand_ms
            .store(wall_ms() as i64, Ordering::Release);
        if self.shared.acquire.is_none() || self.shared.kasi_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let shared = self.shared.clone();
        tokio::spawn(async move {
            let every = shared.kasi_every;
            let mut tick = tokio::time::interval_at(Instant::now() + shared.kasi_first, every);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let now = wall_ms();
                if now - shared.demand_ms.load(Ordering::Acquire) as f64 > DEMAND_MS {
                    continue;
                }
                let _ = kasi_pass(&shared, now).await;
            }
        });
    }
    /// One KASI capture pass at `now` (the capture task runs it every hour; tests call it).
    pub async fn kasi_pass(&self, now: f64) -> Result<(), String> {
        kasi_pass(&self.shared, now).await
    }
}
/// Read the life-index acquisitions up to `cut` and apply the new ones (or refold all when one
/// completed before the last applied acquisition, and daily).
async fn read_life<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    deadline: Instant,
) -> Result<(), String> {
    let _refresh = tokio::time::timeout_at(deadline, shared.life_refresh.lock())
        .await
        .map_err(|_| "life refresh deadline".to_owned())?;
    let full_due = shared
        .life
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .full
        .is_none_or(|f| f.elapsed() >= FULL_READ);
    if !read_life_once(shared, now, deadline, full_due).await? {
        // An acquisition completed before the last applied one: read everything again.
        read_life_once(shared, now, deadline, true).await?;
    }
    Ok(())
}
/// One read; false when the new acquisitions cannot be applied in order (a full read is due).
async fn read_life_once<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    deadline: Instant,
    full_due: bool,
) -> Result<bool, String> {
    // The publication count before reading: every own publication up to it is in S3.
    let published = shared.published.load(Ordering::Acquire);
    let (cut, last, seen) = {
        let state = shared.life.lock().unwrap_or_else(|e| e.into_inner());
        (state.cut.max(now), state.last.clone(), state.seen.clone())
    };
    let from = Publication::new(kst_date(cut - LIFE_LOOKBACK_MS), 0)
        .map(Publication::partition)
        .unwrap_or_default();
    let window = months(cut - LIFE_LOOKBACK_MS, cut);
    let mut found: Vec<(usize, Fetched)> = Vec::new();
    for (k, (family, _)) in LIFE_FAMILIES.iter().enumerate() {
        let partitions = shared
            .reader
            .partitions(DATA_GO_KR, family.kind(), &all_areas(), &window, deadline)
            .await
            .map_err(|e| format!("life listing: {e}"))?;
        let partitions: Vec<String> = partitions.into_iter().filter(|p| *p >= from).collect();
        let known: BTreeSet<&str> = seen
            .iter()
            .filter(|(kk, _, _)| *kk == k)
            .map(|(_, p, _)| p.as_str())
            .collect();
        let recent = partitions.len().saturating_sub(RECENT_PARTITIONS);
        let wanted: Vec<String> = partitions
            .iter()
            .enumerate()
            .filter(|(i, p)| full_due || *i >= recent || !known.contains(p.as_str()))
            .map(|(_, p)| p.clone())
            .collect();
        let fetched = shared
            .reader
            .all(DATA_GO_KR, family.kind(), &all_areas(), &wanted, deadline)
            .await
            .map_err(|e| format!("life read: {e}"))?;
        found.extend(fetched.into_iter().map(|f| (k, f)));
    }
    // Acquisitions of one instant apply in legacy kind-name order (stable, any order is valid).
    let order = |(k, f): &(usize, Fetched)| (f.fetched_at_ms, KINDS[*k], f.partition.clone());
    let mut fresh: Vec<(usize, Fetched)> = found
        .into_iter()
        .filter(|(k, f)| {
            f.fetched_at_ms as f64 <= cut
                && (full_due || !seen.contains(&(*k, f.partition.clone(), f.fetched_at_ms)))
        })
        .collect();
    fresh.sort_by_key(order);
    if !full_due
        && fresh
            .iter()
            .any(|a| last.as_ref().is_some_and(|l| order(a) <= *l))
    {
        return Ok(false);
    }
    let base = if full_due {
        Arc::new(LifeIndex::default())
    } else {
        shared
            .life
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .folded
            .clone()
    };
    let applied: Vec<(usize, String, u64)> = fresh
        .iter()
        .map(|(k, f)| (*k, f.partition.clone(), f.fetched_at_ms))
        .collect();
    let newest = fresh.last().map(order);
    let folded = if fresh.is_empty() {
        base
    } else {
        let runs: Vec<Run> = fresh
            .into_iter()
            .map(|(k, f)| (k, f.fetched_at_ms as f64, f.pages))
            .collect();
        let cpu = shared.cpu.clone();
        let work = async move {
            super::air_input::cpu_task(&cpu, move || {
                let mut out = (*base).clone();
                for (k, fetched, pages) in &runs {
                    if let Some(items) = life_items(pages) {
                        out.apply(KINDS[*k], *fetched, &items);
                    }
                }
                Arc::new(out)
            })
            .await
        };
        tokio::time::timeout_at(deadline, work)
            .await
            .map_err(|_| "life fold deadline".to_owned())??
    };
    let mut state = shared.life.lock().unwrap_or_else(|e| e.into_inner());
    if full_due {
        state.seen.clear();
        state.last = None;
        state.full = Some(std::time::Instant::now());
    }
    state.seen.extend(applied);
    if newest.is_some() {
        state.last = newest;
    }
    state.folded = folded;
    state.cut = cut;
    state.published = published;
    state.refreshed = Some(std::time::Instant::now());
    Ok(true)
}
/// Read the MFDS acquisitions of the last three KST days up to `cut` and fold them.
async fn read_mfds<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    deadline: Instant,
) -> Result<(), String> {
    let _refresh = tokio::time::timeout_at(deadline, shared.mfds_refresh.lock())
        .await
        .map_err(|_| "mfds refresh deadline".to_owned())?;
    let published = shared.published.load(Ordering::Acquire);
    let cut = shared
        .mfds
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .cut
        .max(now);
    let days: Vec<String> = (0..MFDS_DAYS)
        .rev()
        .map(|d| format!("{:08}", kst_date(cut - d as f64 * DAY_MS)))
        .collect();
    // Only published partitions are looked up (a missing catalog is not an empty one).
    let listed = shared
        .reader
        .partitions(
            mfds_provider::SOURCE,
            mfds_provider::KIND,
            &MfdsRequest::provider_key(),
            &months(cut - (MFDS_DAYS - 1) as f64 * DAY_MS, cut),
            deadline,
        )
        .await
        .map_err(|e| format!("mfds listing: {e}"))?;
    let days: Vec<String> = days.into_iter().filter(|d| listed.contains(d)).collect();
    // Raw records keep the envelope period: the slot the acquisition was made for.
    let mut runs: Vec<(f64, Vec<Arc<[u8]>>)> = Vec::new();
    let mut slots = HashSet::new();
    for day in &days {
        let acquisitions = shared
            .reader
            .raw(
                mfds_provider::SOURCE,
                mfds_provider::KIND,
                &MfdsRequest::provider_key(),
                day,
                deadline,
            )
            .await
            .map_err(|e| format!("mfds read: {e}"))?;
        for records in acquisitions {
            let Some(completed) = records
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
            else {
                continue;
            };
            if completed as f64 > cut {
                continue;
            }
            let period = &records[0].envelope.identity.period;
            slots.insert(format!("{:08}{}", period.local_date, period.slot));
            runs.push((
                completed as f64,
                records.iter().map(|r| r.bytes.clone()).collect(),
            ));
        }
    }
    runs.sort_by(|a, b| a.0.total_cmp(&b.0));
    let cpu = shared.cpu.clone();
    let folded = tokio::time::timeout_at(
        deadline,
        super::air_input::cpu_task(&cpu, move || {
            let mut out = FoodPoisoning::default();
            for (fetched, pages) in &runs {
                let Some(body) = pages
                    .first()
                    .and_then(|p| serde_json::from_slice::<Value>(p).ok())
                else {
                    continue;
                };
                if let Ok(rows) = mfds_provider::parse(&body, *fetched) {
                    out.apply(&rows);
                }
            }
            out.expire(cut);
            Arc::new(out)
        }),
    )
    .await
    .map_err(|_| "mfds fold deadline".to_owned())??;
    let mut state = shared.mfds.lock().unwrap_or_else(|e| e.into_inner());
    state.folded = folded;
    state.slots = slots;
    state.cut = cut;
    state.published = published;
    state.refreshed = Some(std::time::Instant::now());
    Ok(())
}
/// The legacy capture window: UTC days D-8..D+9 (`gatherAreaRiseSetFromApi`).
fn kasi_days(now: f64) -> Vec<String> {
    (-8..10)
        .map(|i| utc_date(now + f64::from(i) * DAY_MS))
        .collect()
}
fn kasi_key(area: &str) -> Option<ProviderKey> {
    RiseSetRequest::new(area, 20000101)
        .ok()
        .map(|r| r.provider_key())
}
/// One KASI capture pass: read every area's stored days of the window from S3 (the fold is then
/// loaded), then acquire the missing area/days, today's column first (legacy `mapSeries`
/// order is per area; the stored set is the same, and every area has today early).
async fn kasi_pass<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
) -> Result<(), String> {
    let days = kasi_days(now);
    let first_day = crate::world::js::parts(now - (8. + KASI_KEEP_DAYS) * DAY_MS).map_or(0., |p| {
        crate::world::js::days_from_civil(p.year, p.month, p.day) as f64 * DAY_MS
    });
    let window: Vec<u32> = {
        let mut m: Vec<u32> = days.iter().filter_map(|d| d[..6].parse().ok()).collect();
        m.dedup();
        m
    };
    // Read: one listing per area, then the stored days the fold lacks. Every S3 call has its
    // own bound (a pass can run for many minutes).
    let read_by = || Instant::now() + KASI_READ;
    let mut stored: Vec<(String, Vec<String>)> = Vec::new();
    for chunk in AREAS.chunks(8) {
        let lists = crate::history::join_all(
            chunk
                .iter()
                .map(|area| {
                    let shared = shared.clone();
                    let window = window.clone();
                    async move {
                        let key = kasi_key(area).ok_or_else(|| "kasi key".to_owned())?;
                        shared
                            .reader
                            .partitions(DATA_GO_KR, "kasi-area-rise-set", &key, &window, read_by())
                            .await
                            .map(|p| ((*area).to_owned(), p))
                            .map_err(|e| format!("kasi listing: {e}"))
                    }
                })
                .collect(),
        )
        .await;
        for l in lists {
            stored.push(l?);
        }
    }
    let loaded = shared.kasi.lock().unwrap_or_else(|e| e.into_inner()).loaded;
    for (area, partitions) in &stored {
        let (missing, placed) = {
            let state = shared.kasi.lock().unwrap_or_else(|e| e.into_inner());
            let missing: Vec<String> = partitions
                .iter()
                .filter(|p| days.contains(p) && !state.folded.has(area, p))
                .cloned()
                .collect();
            (missing, state.folded.has_place(area))
        };
        let key = kasi_key(area).ok_or("kasi key")?;
        if !missing.is_empty() {
            let fetched = shared
                .reader
                .all(DATA_GO_KR, "kasi-area-rise-set", &key, &missing, read_by())
                .await
                .map_err(|e| format!("kasi read: {e}"))?;
            apply_kasi(shared, area, &fetched, first_day);
        } else if !loaded && !placed {
            // A cold process learns the place of an area that has only older days (legacy
            // keeps them, and they still decide the nearest location): its newest stored day.
            let all = shared
                .reader
                .partitions(
                    DATA_GO_KR,
                    "kasi-area-rise-set",
                    &key,
                    &super::history_months(now),
                    read_by(),
                )
                .await
                .map_err(|e| format!("kasi listing: {e}"))?;
            if let Some(last) = all.last() {
                let fetched = shared
                    .reader
                    .acquisitions(DATA_GO_KR, "kasi-area-rise-set", &key, last, read_by())
                    .await
                    .map_err(|e| format!("kasi read: {e}"))?;
                apply_kasi(shared, area, &fetched, first_day);
            }
        }
    }
    shared.kasi.lock().unwrap_or_else(|e| e.into_inner()).loaded = true;
    // Acquire what is still missing.
    let Some(acquire) = shared.acquire.clone() else {
        return Ok(());
    };
    let today = utc_date(now);
    let mut order: Vec<&String> = days.iter().filter(|d| **d >= today).collect();
    order.extend(days.iter().filter(|d| **d < today).rev());
    let mut failed: HashSet<&str> = HashSet::new();
    for day in order {
        for area in AREAS {
            if failed.contains(area) {
                continue;
            }
            let have = shared
                .kasi
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .folded
                .has(area, day);
            if have {
                continue;
            }
            let Ok(request) = RiseSetRequest::new(area, day.parse().unwrap_or(0)) else {
                continue;
            };
            let key = format!("kasi-{area}-{day}");
            let owned_for = LifeRequest::RiseSet(request.clone()).owned_for();
            let acquire = acquire.clone();
            let outcome = std::sync::Arc::new(std::sync::Mutex::new(None));
            let seen = outcome.clone();
            let published = shared
                .flights
                .run(&key, owned_for, move || -> BoxFuture<'static, bool> {
                    Box::pin(async move {
                        let result = acquire.acquire(LifeRequest::RiseSet(request)).await;
                        let published = matches!(result, Ok(LifeOutcome::Published));
                        *seen.lock().unwrap_or_else(|e| e.into_inner()) = Some(result.is_ok());
                        published
                    })
                })
                .await;
            if *outcome.lock().unwrap_or_else(|e| e.into_inner()) == Some(false) {
                // Legacy `mapSeries` stops an area at its first failure.
                failed.insert(area);
                continue;
            }
            if published {
                // A read-back that fails is retried by the next pass's S3 read.
                let k = kasi_key(area).ok_or("kasi key")?;
                if let Ok(fetched) = shared
                    .reader
                    .acquisitions(DATA_GO_KR, "kasi-area-rise-set", &k, day, read_by())
                    .await
                {
                    apply_kasi(shared, area, &fetched, first_day);
                }
            }
        }
    }
    Ok(())
}
/// Apply KASI acquisitions of one area in completion order (the first per day wins).
fn apply_kasi<T>(shared: &Arc<Shared<T>>, area: &str, fetched: &[Fetched], first_day: f64) {
    let mut runs: Vec<&Fetched> = fetched.iter().collect();
    runs.sort_by_key(|f| f.fetched_at_ms);
    let mut state = shared.kasi.lock().unwrap_or_else(|e| e.into_inner());
    let folded = Arc::make_mut(&mut state.folded);
    for f in runs {
        let Some(items) = life_items(&f.pages) else {
            continue;
        };
        if let Some(item) = items.first() {
            folded.apply(area, &f.partition, item);
        }
    }
    folded.forget_before(first_day);
}

#[cfg(test)]
mod tests {
    use super::read_key;

    /// A request whose cut reaches the last own publication never joins a read whose cut does
    /// not (that read cannot contain the publication), and requests on the same side share one.
    #[test]
    fn reads_are_shared_only_by_cuts_on_the_same_side_of_the_last_publication() {
        let published_at = 1_000.;
        let before = read_key("life", 3, published_at, 999.);
        let after = read_key("life", 3, published_at, 1_000.);
        assert_ne!(before, after);
        assert_eq!(after, read_key("life", 3, published_at, 5_000.));
        assert_eq!(before, read_key("life", 3, published_at, 10.));
        assert_ne!(after, read_key("life", 4, published_at, 5_000.));
        assert_ne!(after, read_key("mfds", 3, published_at, 5_000.));
    }
}
