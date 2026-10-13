//! Durable warning reads/writes on S06 catalogs. Type catalogs are the only latest authority.
use super::{
    js,
    provider::kst_date,
    records::{self, Bulletin, Member, ZONE_KIND, ZONE_SEED_KIND},
    zones::{Entry, ZoneState, prepare_events},
};
use crate::storage::{
    CatalogLimits, CatalogStore, CatalogTransport, CompleteSet, Error, LookupOutcome, RawRecord,
    RepairOutcome, RepairScope,
};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tokio::{task::JoinSet, time::Instant};

pub const ZONE_LOOKBACK_DAYS: i64 = 59;
const FLASH_VALID_MS: i64 = 10 * 3_600_000;

#[derive(Clone, Debug)]
pub struct StoreConfig {
    /// Days walked back for types 1-3 (no age expiry beyond this bound).
    pub lookback_days: i64,
    /// Concurrent day lookups per wave.
    pub wave: usize,
}
impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            lookback_days: 400,
            wave: 8,
        }
    }
}
impl StoreConfig {
    pub fn validate(&self) -> Result<(), Error> {
        if !(1..=3660).contains(&self.lookback_days) || !(1..=16).contains(&self.wave) {
            return Err(Error::Invalid("warning store config"));
        }
        Ok(())
    }
}
/// Operator-visible counters (no identities or bodies).
#[derive(Debug, Default)]
pub struct Counters {
    pub day_lookups: AtomicU64,
    pub repairs: AtomicU64,
    pub repaired_days: AtomicU64,
    pub incomplete_days: AtomicU64,
    pub excluded: AtomicU64,
    pub published: AtomicU64,
}
/// Complete acquisitions of one partition plus how they were obtained.
#[derive(Debug, Default)]
pub struct Day {
    pub acquisitions: Vec<Vec<RawRecord>>,
    pub repaired: bool,
    pub incomplete: bool,
}
pub struct WarningStore<T> {
    catalogs: Arc<CatalogStore<T>>,
    limits: CatalogLimits,
    config: StoreConfig,
    pub counters: Arc<Counters>,
}
fn records_of(set: &CompleteSet) -> Vec<Vec<RawRecord>> {
    set.acquisitions()
        .iter()
        .map(|a| a.records().to_vec())
        .collect()
}
async fn day_inner<T: CatalogTransport>(
    catalogs: Arc<CatalogStore<T>>,
    counters: Arc<Counters>,
    kind: String,
    date: u32,
    deadline: Instant,
) -> Result<Day, Error> {
    counters.day_lookups.fetch_add(1, Ordering::Relaxed);
    let id = records::catalog(&kind, date)?;
    if let LookupOutcome::Ready(set) = catalogs.lookup(&id, deadline).await? {
        return Ok(Day {
            acquisitions: records_of(&set),
            ..Day::default()
        });
    }
    // Missing or unusable catalog: bounded repair of this exact period. An acknowledged
    // group always has its published catalog, so Incomplete cannot hide an acknowledged record.
    counters.repairs.fetch_add(1, Ordering::Relaxed);
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![records::period(&kind, date)],
    };
    // A failed repair (for example rejected catalog writes) likewise cannot hide one.
    let Ok(outcome) = catalogs.repair(&scope, deadline).await else {
        counters.incomplete_days.fetch_add(1, Ordering::Relaxed);
        return Ok(Day {
            incomplete: true,
            ..Day::default()
        });
    };
    let set = match outcome {
        RepairOutcome::Complete(set) => Some(set),
        RepairOutcome::Indexed { .. } => match catalogs.lookup(&id, deadline).await? {
            LookupOutcome::Ready(set) => Some(set),
            LookupOutcome::Incomplete => None,
        },
        RepairOutcome::CompleteEmpty { .. } => return Ok(Day::default()),
        RepairOutcome::Incomplete => {
            counters.incomplete_days.fetch_add(1, Ordering::Relaxed);
            return Ok(Day {
                incomplete: true,
                ..Day::default()
            });
        }
    };
    let Some(set) = set else {
        counters.incomplete_days.fetch_add(1, Ordering::Relaxed);
        return Ok(Day {
            incomplete: true,
            ..Day::default()
        });
    };
    counters.repaired_days.fetch_add(1, Ordering::Relaxed);
    Ok(Day {
        acquisitions: records_of(&set),
        repaired: true,
        incomplete: false,
    })
}
/// The greatest announcement of a partition; equal announcements keep the earliest fetch.
fn best(kind: u8, date: u32, day: &Day, counters: &Counters) -> Result<Option<Bulletin>, Error> {
    let mut found: Option<Bulletin> = None;
    for records in &day.acquisitions {
        let Some(b) = records::derive(kind, records)? else {
            continue;
        };
        if b.date() != date {
            counters.excluded.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        if found.as_ref().is_none_or(|f| b.stored_ms > f.stored_ms) {
            found = Some(b);
        }
    }
    Ok(found)
}
impl<T: CatalogTransport> WarningStore<T> {
    pub fn new(transport: T, limits: CatalogLimits, config: StoreConfig) -> Result<Self, Error> {
        config.validate()?;
        Ok(Self {
            catalogs: Arc::new(CatalogStore::new(transport, limits.clone())?),
            limits,
            config,
            counters: Arc::new(Counters::default()),
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
        self.catalogs.publish(declaration, raw, deadline).await?;
        self.counters.published.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    pub async fn day(&self, kind: &str, date: u32, deadline: Instant) -> Result<Day, Error> {
        day_inner(
            self.catalogs.clone(),
            self.counters.clone(),
            kind.into(),
            date,
            deadline,
        )
        .await
    }
    /// Days newest first in bounded concurrent waves; returns the first `Some` of `pick`.
    async fn walk<R, F>(
        &self,
        kind: &str,
        newest: i64,
        oldest: i64,
        deadline: Instant,
        mut pick: F,
    ) -> Result<Option<R>, Error>
    where
        F: FnMut(u32, &Day) -> Result<Option<R>, Error>,
    {
        let mut day = newest;
        while day >= oldest {
            let low = (day - self.config.wave as i64 + 1).max(oldest);
            let mut set = JoinSet::new();
            for index in (low..=day).rev() {
                let date = js::date_of_index(index);
                let (c, n, k) = (
                    self.catalogs.clone(),
                    self.counters.clone(),
                    kind.to_owned(),
                );
                set.spawn(async move { (index, day_inner(c, n, k, date, deadline).await) });
            }
            let mut results = Vec::new();
            while let Some(joined) = set.join_next().await {
                results.push(joined.map_err(|_| Error::Transport)?);
            }
            results.sort_by_key(|r| std::cmp::Reverse(r.0));
            for (index, result) in results {
                if let Some(r) = pick(js::date_of_index(index), &result?)? {
                    return Ok(Some(r));
                }
            }
            day = low - 1;
        }
        Ok(None)
    }
    /// Latest bulletin of `kind` at `now_ms`. Types 1-3 have no age expiry within
    /// `lookback_days`; type 4 is `None` once `stored + 10 h < now` (actual + 19 h).
    /// `floor` (a known older partition) bounds memory refreshes.
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
        let mut oldest = if kind == 4 {
            js::day_index(js::ymd(now_ms - FLASH_VALID_MS))
        } else {
            newest - self.config.lookback_days
        };
        if let Some(f) = floor {
            oldest = oldest.max(js::day_index(f));
        }
        let counters = self.counters.clone();
        let found = self
            .walk(
                records::bulletin_kind(kind),
                newest,
                oldest,
                deadline,
                |date, day| best(kind, date, day, &counters),
            )
            .await?;
        Ok(found.filter(|b| kind != 4 || b.stored_ms + FLASH_VALID_MS >= now_ms))
    }
    /// True when a complete acquisition already derives this announcement (legacy `_exists`).
    pub async fn exists(&self, kind: u8, stored_ms: i64, deadline: Instant) -> Result<bool, Error> {
        let date = js::ymd(stored_ms);
        let day = self
            .day(records::bulletin_kind(kind), date, deadline)
            .await?;
        for records in &day.acquisitions {
            if records::derive(kind, records)?.is_some_and(|b| b.stored_ms == stored_ms) {
                return Ok(true);
            }
        }
        Ok(false)
    }
    /// Zone state: newest legacy zone seed, then every published getPwnCd revision of the
    /// last 60 KST days replayed as one batch. Derived in memory only.
    pub async fn zone_state(&self, now_ms: i64, deadline: Instant) -> Result<ZoneState, Error> {
        let mut state = ZoneState::default();
        let seed = self
            .day(ZONE_SEED_KIND, records::SEED_DATE, deadline)
            .await?;
        if let Some(latest) = seed.acquisitions.last() {
            for doc in records::zone_seed(latest)? {
                if let Some(entry) = Entry::from_legacy(&doc) {
                    state.insert(entry);
                }
            }
        }
        let today = js::day_index(kst_date(now_ms, 0));
        let oldest = today - ZONE_LOOKBACK_DAYS;
        let mut days: Vec<(u32, Day)> = Vec::new();
        self.walk::<(), _>(ZONE_KIND, today, oldest, deadline, |date, day| {
            days.push((
                date,
                Day {
                    acquisitions: day.acquisitions.clone(),
                    repaired: day.repaired,
                    incomplete: day.incomplete,
                },
            ));
            Ok(None)
        })
        .await?;
        days.sort_by_key(|(d, _)| *d);
        let mut rows = Vec::new();
        for (_, day) in &days {
            for records in &day.acquisitions {
                rows.extend(records::zone_rows(records)?);
            }
        }
        state.apply(&prepare_events(&rows));
        Ok(state)
    }
    /// Zone sync progress derived from published day catalogs:
    /// (last fetch time, oldest day of the contiguous covered range).
    pub async fn zone_progress(
        &self,
        now_ms: i64,
        deadline: Instant,
    ) -> Result<Option<(u64, u32)>, Error> {
        let today = js::day_index(kst_date(now_ms, 0));
        let oldest = today - ZONE_LOOKBACK_DAYS;
        let mut newest: Option<(u64, u32)> = None;
        let mut covered = true;
        self.walk::<(), _>(ZONE_KIND, today, oldest, deadline, |date, day| {
            if day.acquisitions.is_empty() {
                if newest.is_some() {
                    covered = false;
                }
                return Ok(None);
            }
            let fetched = day
                .acquisitions
                .iter()
                .flat_map(|a| a.iter().map(|r| r.envelope.identity.fetched_at_ms))
                .max()
                .unwrap_or(0);
            match &mut newest {
                None => newest = Some((fetched, date)),
                Some((_, oldest_covered)) if covered => *oldest_covered = date,
                Some(_) => {}
            }
            Ok(None)
        })
        .await?;
        Ok(newest)
    }
}
