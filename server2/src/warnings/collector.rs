//! One gather cycle ported from `server/lib/kmaWarningCollector.js` (ca8735cf).
//! Mongo existence/upsert/`_sync` state is replaced by type/day catalogs and memory.
//! No timer is wired into the server2 process by S12; the push feed belongs to S18.
use super::{
    js,
    provider::{
        self, FetchError, NATIONWIDE_STN_ID, Operation, PAGE_ROWS, Page, WarningSource,
        ZONE_PAGE_ROWS, get_all, kst_date,
    },
    records::{self, Member, ZONE_KIND},
    store::{WarningStore, ZONE_LOOKBACK_DAYS},
    zones::{ZoneState, drift_from_t6, prepare_events, same_text},
};
use crate::{
    budget::Clock,
    storage::{CatalogTransport, Error, sha256},
};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

pub const MAX_PENDING_CYCLES: u32 = 20;
pub const RESYNC_MS: i64 = 60 * 60 * 1000;
pub const ZONE_DAYS_PER_SYNC: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CycleError {
    Fetch(Operation, FetchError),
    Store(Error),
}
impl CycleError {
    fn is_quota(&self) -> bool {
        matches!(self, Self::Fetch(_, FetchError::Quota))
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Report {
    /// Newly acknowledged bulletin acquisitions.
    pub stored: usize,
    /// Zone sync ran in this cycle.
    pub synced: bool,
    /// Day acquisitions published by zone syncs.
    pub zone_days: usize,
    /// Pending type 1 announcement cycles (legacy `pending.cycles`).
    pub pending_cycles: u32,
    pub errors: Vec<CycleError>,
}
#[derive(Default)]
struct State {
    pending: Option<(String, u32)>,
    progress_loaded: bool,
    last_sync_at_ms: Option<i64>,
    oldest_synced: Option<u32>,
    bootstrap_complete: bool,
    zones: Option<ZoneState>,
    published: HashMap<u32, String>,
}
pub struct WarningCollector<S: ?Sized, T> {
    source: Arc<S>,
    store: Arc<WarningStore<T>>,
    clock: Arc<dyn Clock>,
    state: Mutex<State>,
    step: Duration,
}
fn shift_day(day: u32, n: i64) -> u32 {
    js::date_of_index(js::day_index(day) + n)
}
/// `planDays(now, marker)`: KST days for one sync and the resulting covered start.
pub fn plan_days(
    now_ms: i64,
    last_sync_at_ms: Option<i64>,
    oldest_synced: Option<u32>,
) -> (Vec<u32>, u32) {
    let today = kst_date(now_ms, 0);
    let earliest = kst_date(now_ms, -ZONE_LOOKBACK_DAYS);
    let mut from = last_sync_at_ms.map_or(today, |l| kst_date(l, -1));
    from = from.clamp(earliest, today);
    let mut days = Vec::new();
    let mut offset = 0;
    while kst_date(now_ms, -offset) >= from {
        days.push(kst_date(now_ms, -offset));
        offset += 1;
    }
    let covered = oldest_synced.filter(|_| days.len() <= ZONE_DAYS_PER_SYNC);
    days.truncate(ZONE_DAYS_PER_SYNC);
    let last = *days.last().expect("today is always planned");
    let mut oldest = covered.filter(|c| *c < last).unwrap_or(last);
    let mut back = 1;
    while days.len() < ZONE_DAYS_PER_SYNC {
        let day = shift_day(oldest, -back);
        if day < earliest {
            break;
        }
        days.push(day);
        back += 1;
    }
    if *days.last().unwrap() < oldest {
        oldest = *days.last().unwrap();
    }
    (days, oldest)
}
struct Synced {
    rows: Vec<Value>,
    complete: bool,
}
impl<S: WarningSource + ?Sized, T: CatalogTransport> WarningCollector<S, T> {
    pub fn new(source: Arc<S>, store: Arc<WarningStore<T>>, clock: Arc<dyn Clock>) -> Self {
        Self {
            source,
            store,
            clock,
            state: Mutex::new(State::default()),
            step: Duration::from_secs(30),
        }
    }
    /// Per-step deadline (provider pages and S3 publication share it).
    pub fn with_step_deadline(mut self, step: Duration) -> Self {
        self.step = step;
        self
    }
    fn deadline(&self) -> Instant {
        Instant::now() + self.step
    }
    fn now(&self) -> Result<i64, CycleError> {
        self.clock
            .now_ms()
            .map_err(|_| CycleError::Store(Error::Invalid("clock")))
    }
    /// One legacy `gather` cycle. A quota rejection ends the cycle.
    pub async fn gather(&self) -> Report {
        let mut state = self.state.lock().await;
        let mut report = Report::default();
        let steps: [u8; 5] = [1, 0, 2, 3, 4];
        for step in steps {
            let result = match step {
                1 => self.special_step(&mut state, &mut report).await,
                0 => self.resync_step(&mut state, &mut report).await,
                kind => self.bulletin_step(kind, &mut report).await,
            };
            if let Err(e) = result {
                let quota = e.is_quota();
                report.errors.push(e);
                if quota {
                    break;
                }
            }
        }
        report.pending_cycles = state.pending.as_ref().map_or(0, |p| p.1);
        report
    }
    async fn load_progress(&self, state: &mut State, now_ms: i64) -> Result<(), CycleError> {
        if state.progress_loaded {
            return Ok(());
        }
        let deadline = self.deadline();
        let progress = self
            .store
            .zone_progress(now_ms, deadline)
            .await
            .map_err(CycleError::Store)?;
        let zones = self
            .store
            .zone_state(now_ms, deadline)
            .await
            .map_err(CycleError::Store)?;
        if let Some((fetched, oldest)) = progress {
            state.last_sync_at_ms = i64::try_from(fetched).ok();
            state.oldest_synced = Some(oldest);
            state.bootstrap_complete = oldest <= kst_date(now_ms, -ZONE_LOOKBACK_DAYS);
        }
        state.zones = Some(zones);
        state.progress_loaded = true;
        Ok(())
    }
    /// `syncZones`: fetch every planned day first; publish only after the whole series succeeds.
    async fn sync_zones(
        &self,
        state: &mut State,
        report: &mut Report,
    ) -> Result<Synced, CycleError> {
        let now_ms = self.now()?;
        self.load_progress(state, now_ms).await?;
        let (days, oldest) = plan_days(now_ms, state.last_sync_at_ms, state.oldest_synced);
        let mut fetched: Vec<(u32, Vec<Page>)> = Vec::new();
        for day in &days {
            let d = format!("{day:08}");
            let pages = get_all(
                &*self.source,
                Operation::PwnCd,
                vec![("fromTmFc", d.clone()), ("toTmFc", d)],
                ZONE_PAGE_ROWS,
                self.deadline(),
            )
            .await
            .map_err(|e| CycleError::Fetch(Operation::PwnCd, e))?;
            fetched.push((*day, pages));
        }
        let mut rows = Vec::new();
        for (day, pages) in fetched {
            rows.extend(pages.iter().flat_map(|p| p.items.iter().cloned()));
            if pages.is_empty() {
                continue;
            }
            let digest = sha256(
                &pages
                    .iter()
                    .map(|p| sha256(&p.body))
                    .collect::<Vec<_>>()
                    .join(",")
                    .into_bytes(),
            );
            if state.published.get(&day) == Some(&digest) {
                continue;
            }
            self.store
                .publish(
                    ZONE_KIND,
                    day,
                    records::members_from_pages(&pages),
                    self.deadline(),
                )
                .await
                .map_err(CycleError::Store)?;
            state.published.insert(day, digest);
            report.zone_days += 1;
        }
        state
            .zones
            .get_or_insert_with(ZoneState::default)
            .apply(&prepare_events(&rows));
        let complete = oldest <= kst_date(now_ms, -ZONE_LOOKBACK_DAYS);
        state.last_sync_at_ms = Some(now_ms);
        state.oldest_synced = Some(oldest);
        state.bootstrap_complete = complete;
        Ok(Synced { rows, complete })
    }
    /// Type 1: getPwnStatus every cycle; a new announcement triggers getWthrWrnMsg and getPwnCd.
    async fn special_step(&self, state: &mut State, report: &mut Report) -> Result<(), CycleError> {
        let page = self
            .source
            .fetch(
                Operation::PwnStatus,
                vec![("pageNo", "1".into()), ("numOfRows", "10".into())],
                self.deadline(),
            )
            .await
            .map_err(|e| CycleError::Fetch(Operation::PwnStatus, e))?;
        let Some(page) = page else {
            return Ok(());
        };
        let Some(status) = provider::latest_item(&page.items).cloned() else {
            return Ok(());
        };
        let Some(announcement) = provider::announcement_of(status.get("tmFc")) else {
            return Ok(());
        };
        if self
            .store
            .exists(1, announcement, self.deadline())
            .await
            .map_err(CycleError::Store)?
        {
            state.pending = None;
            return Ok(());
        }
        let key = format!(
            "{}|{}",
            js::string(status.get("tmFc")),
            js::string(status.get("tmSeq"))
        );
        if state.pending.as_ref().is_none_or(|p| p.0 != key) {
            state.pending = Some((key, 0));
        }
        let cycles = {
            let p = state.pending.as_mut().unwrap();
            p.1 += 1;
            p.1
        };
        let day: String = js::string(status.get("tmFc")).chars().take(8).collect();
        let mut errors = Vec::new();
        let mut messages = Vec::new();
        let mut bulletin = false;
        match get_all(
            &*self.source,
            Operation::WrnMsg,
            vec![
                ("stnId", NATIONWIDE_STN_ID.into()),
                ("fromTmFc", day.clone()),
                ("toTmFc", day),
            ],
            PAGE_ROWS,
            self.deadline(),
        )
        .await
        {
            Ok(pages) => {
                bulletin = pages.iter().flat_map(|p| &p.items).any(|item| {
                    same_text(item.get("tmFc"), status.get("tmFc"))
                        && (item.get("tmSeq").is_none()
                            || same_text(item.get("tmSeq"), status.get("tmSeq")))
                });
                messages = pages;
            }
            Err(e) => errors.push(CycleError::Fetch(Operation::WrnMsg, e)),
        }
        let mut zone = None;
        if !errors.iter().any(CycleError::is_quota) {
            match self.sync_zones(state, report).await {
                Ok(z) => zone = Some(z),
                Err(e) => errors.push(e),
            }
        }
        if let Some(e) = errors.iter().find(|e| e.is_quota()) {
            return Err(e.clone());
        }
        report.synced = zone.is_some();
        let drift = zone.as_ref().and_then(|_| {
            state
                .zones
                .as_ref()
                .map(|z| drift_from_t6(z.entries(), status.get("t6")))
        });
        let has_rows = zone.as_ref().is_some_and(|z| {
            z.rows.iter().any(|row| {
                same_text(row.get("tmFc"), status.get("tmFc"))
                    && same_text(row.get("tmSeq"), status.get("tmSeq"))
            })
        });
        let quiet = zone.as_ref().is_some_and(|z| z.complete)
            && drift
                .as_ref()
                .is_some_and(|(active, none, _)| *none && *active == 0);
        let ready = bulletin && (has_rows || quiet);
        if !errors.is_empty() {
            return Err(errors.remove(0));
        }
        if !ready && cycles < MAX_PENDING_CYCLES {
            return Ok(());
        }
        let mut members = records::members_from_pages(std::slice::from_ref(&page));
        members.extend(records::members_from_pages(&messages));
        self.store
            .publish(
                records::bulletin_kind(1),
                js::ymd(announcement),
                members,
                self.deadline(),
            )
            .await
            .map_err(CycleError::Store)?;
        state.pending = None;
        report.stored += 1;
        Ok(())
    }
    /// Hourly getPwnCd resync without a change, and bootstrap continuation.
    async fn resync_step(&self, state: &mut State, report: &mut Report) -> Result<(), CycleError> {
        if report.synced {
            return Ok(());
        }
        let now_ms = self.now()?;
        self.load_progress(state, now_ms).await?;
        if let Some(last) = state.last_sync_at_ms
            && state.bootstrap_complete
            && now_ms - last < RESYNC_MS
        {
            return Ok(());
        }
        self.sync_zones(state, report).await?;
        report.synced = true;
        Ok(())
    }
    /// Types 2-4: the latest item of yesterday and today (KST).
    async fn bulletin_step(&self, kind: u8, report: &mut Report) -> Result<(), CycleError> {
        let op =
            records::summary_operation(kind).ok_or(CycleError::Store(Error::Invalid("type")))?;
        let now_ms = self.now()?;
        let pages = get_all(
            &*self.source,
            op,
            vec![
                ("stnId", NATIONWIDE_STN_ID.into()),
                ("fromTmFc", format!("{:08}", kst_date(now_ms, -1))),
                ("toTmFc", format!("{:08}", kst_date(now_ms, 0))),
            ],
            PAGE_ROWS,
            self.deadline(),
        )
        .await
        .map_err(|e| CycleError::Fetch(op, e))?;
        let items: Vec<Value> = pages.iter().flat_map(|p| p.items.iter().cloned()).collect();
        let Some(item) = provider::latest_item(&items) else {
            return Ok(());
        };
        let Some(announcement) = provider::announcement_of(item.get("tmFc")) else {
            return Ok(());
        };
        if self
            .store
            .exists(kind, announcement, self.deadline())
            .await
            .map_err(CycleError::Store)?
        {
            return Ok(());
        }
        let members: Vec<Member> = records::members_from_pages(&pages);
        self.store
            .publish(
                records::bulletin_kind(kind),
                js::ymd(announcement),
                members,
                self.deadline(),
            )
            .await
            .map_err(CycleError::Store)?;
        report.stored += 1;
        Ok(())
    }
}
