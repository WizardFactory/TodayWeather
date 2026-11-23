//! S3-backed persistence and reconciliation service for official Korean almanac editions.
//!
//! Stores each validated edition (metadata + base64-encoded raw PDF bytes) as an immutable
//! [`RawRecord`] under `raw/v2/` indexed by [`CatalogStore`] under `index/v2/`, reusing the
//! provisioned `tw-server2-runtime` IAM prefixes without introducing a new top-level prefix.

use super::api::CalendarApi;
use super::astro::ALGORITHM;
use super::calendar::{
    Calendar, CalendarError, Clock, EditionRecord, TermEntry, YearSnapshot, check_years,
    format_utc_iso, korea_date, sha256_hex, validate_edition,
};
use super::official::{FetchedEdition, OfficialSource};
use super::summary::Policy;
use super::{Reconcile, TermLookup};
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, CatalogStore, Error as StorageError, Limits, PageOutcome,
    Period, ProviderKey, RawRecord, sha256,
};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

pub const SOURCE: &str = "kr-solar-terms";
pub const KIND: &str = "almanac";
const STORE_OP_TIMEOUT: Duration = Duration::from_secs(30);
const FETCH_OP_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEdition {
    edition: EditionRecord,
    verified_at: String,
    algorithm: String,
    pdf_base64: String,
}

#[derive(Debug)]
pub enum StoreError {
    Calendar(CalendarError),
    Storage(StorageError),
    Conflict(String),
    Corrupt(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Calendar(e) => write!(f, "{e}"),
            Self::Storage(e) => write!(f, "{e}"),
            Self::Conflict(s) | Self::Corrupt(s) => f.write_str(s),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<CalendarError> for StoreError {
    fn from(value: CalendarError) -> Self {
        Self::Calendar(value)
    }
}

impl From<StorageError> for StoreError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

fn year_key(year: i32) -> ProviderKey {
    ProviderKey::Named {
        id: format!("{year:04}"),
    }
}

fn edition_partition(edition: &EditionRecord) -> Result<(u32, String, String), StoreError> {
    let date_digits = edition.publication_date.replace('-', "");
    let local_date: u32 = date_digits
        .parse()
        .map_err(|_| StoreError::Calendar(CalendarError("Invalid publication date".into())))?;
    let serial = edition
        .order
        .split_once('/')
        .map(|(_, s)| s.to_owned())
        .ok_or_else(|| StoreError::Calendar(CalendarError("Invalid edition order".into())))?;
    let partition = format!("{date_digits}-{serial}");
    Ok((local_date, serial, partition))
}

fn catalog_id(year: i32, partition: &str) -> Result<CatalogId, StorageError> {
    let id = CatalogId {
        source: SOURCE.to_owned(),
        kind: KIND.to_owned(),
        key_sha256: sha256(&year_key(year).canonical_bytes()?),
        partition: partition.to_owned(),
    };
    id.validate()?;
    Ok(id)
}

pub struct Store<T> {
    transport: T,
    catalog: CatalogStore<T>,
}

impl<T: IndexListing + Clone> Store<T> {
    pub fn new(transport: T) -> Result<Self, StorageError> {
        Ok(Self {
            catalog: CatalogStore::new(transport.clone(), CatalogLimits::default())?,
            transport,
        })
    }

    /// Persist a validated official almanac edition atomically to `raw/v2/` + `index/v2/`.
    ///
    /// Identical replays of an already-published `(year, order)` succeed idempotently.
    /// A conflicting digest or differing dates for the same `(year, order)` return `StoreError::Conflict`
    /// without overwriting the stored edition.
    pub async fn publish(
        &self,
        fetched: &FetchedEdition,
        verified_at_ms: i64,
        deadline: Instant,
    ) -> Result<(), StoreError> {
        validate_edition(&fetched.edition)?;
        if sha256_hex(&fetched.pdf) != fetched.edition.source_digest {
            return Err(StoreError::Calendar(CalendarError(
                "Official document digest mismatch".into(),
            )));
        }
        let (local_date, slot, partition) = edition_partition(&fetched.edition)?;
        let id = catalog_id(fetched.edition.year, &partition)?;

        // Check existing catalog entry for this exact (year, order) first.
        if let Some(existing) = self.read_partition(&id, deadline).await? {
            if existing.edition.source_digest == fetched.edition.source_digest
                && existing.edition.dates == fetched.edition.dates
            {
                return Ok(());
            }
            return Err(StoreError::Conflict(
                "Conflicting publication for an existing gazette edition".into(),
            ));
        }

        let envelope = StoredEdition {
            edition: fetched.edition.clone(),
            verified_at: format_utc_iso(verified_at_ms),
            algorithm: ALGORITHM.to_owned(),
            pdf_base64: base64::engine::general_purpose::STANDARD.encode(&fetched.pdf),
        };
        let payload = serde_json::to_vec(&envelope)
            .map_err(|e| StoreError::Corrupt(format!("edition encode failed: {e}")))?;
        let fetched_at_ms = u64::try_from(verified_at_ms.max(0)).unwrap_or(0);
        let record = RawRecord::new(
            SOURCE,
            KIND,
            &year_key(fetched.edition.year),
            Period { local_date, slot },
            fetched_at_ms,
            200,
            "application/json",
            None,
            Arc::from(payload),
            &Limits::default(),
        )?;

        let winner = self.catalog.publish_once(id, record, deadline).await?;
        let stored: StoredEdition = serde_json::from_slice(&winner.bytes)
            .map_err(|e| StoreError::Corrupt(format!("stored edition decode failed: {e}")))?;
        if stored.edition.source_digest != fetched.edition.source_digest
            || stored.edition.dates != fetched.edition.dates
        {
            return Err(StoreError::Conflict(
                "Conflicting publication for an existing gazette edition".into(),
            ));
        }
        Ok(())
    }

    async fn read_partition(
        &self,
        id: &CatalogId,
        deadline: Instant,
    ) -> Result<Option<StoredEdition>, StoreError> {
        let limits = CatalogLimits::default();
        let object = match tokio::time::timeout_at(
            deadline,
            self.transport.get_control(&id.key(), limits.control_bytes),
        )
        .await
        .map_err(|_| StorageError::Timeout)?
        {
            Ok(obj) => obj,
            Err(StorageError::NotFound) => return Ok(None),
            Err(err) => return Err(StoreError::Storage(err)),
        };
        let cat = Catalog::from_bytes(&object.body, id, &limits)?;
        let Some(entry) = cat.entries.last() else {
            return Ok(None);
        };
        let PageOutcome::Ready(page) = self
            .catalog
            .lookup_acquisition(id, &entry.identity, deadline)
            .await?
        else {
            return Err(StoreError::Corrupt(
                "incomplete solar-term catalog page".into(),
            ));
        };
        let records: Vec<&RawRecord> = page
            .acquisitions()
            .iter()
            .flat_map(|a| a.records())
            .collect();
        if records.len() != 1 {
            return Err(StoreError::Corrupt(
                "unexpected solar-term raw record cardinality".into(),
            ));
        }
        let stored: StoredEdition = serde_json::from_slice(&records[0].bytes)
            .map_err(|e| StoreError::Corrupt(format!("corrupt solar-term record: {e}")))?;
        validate_edition(&stored.edition)?;
        let pdf = base64::engine::general_purpose::STANDARD
            .decode(&stored.pdf_base64)
            .map_err(|_| StoreError::Corrupt("corrupt stored PDF bytes".into()))?;
        if sha256_hex(&pdf) != stored.edition.source_digest {
            return Err(StoreError::Corrupt("stored PDF digest mismatch".into()));
        }
        Ok(Some(stored))
    }

    /// List and decode all stored editions for `year` in ascending `(publicationDate, serial)` order.
    pub async fn load_year_editions(
        &self,
        year: i32,
        deadline: Instant,
    ) -> Result<Vec<EditionRecord>, StoreError> {
        let key_sha = sha256(&year_key(year).canonical_bytes()?);
        let prefix = format!("index/v2/{SOURCE}/{KIND}/{key_sha}/");
        let mut partitions = BTreeSet::new();
        let mut token = None;
        let mut seen = BTreeSet::new();
        for page in 0..8 {
            let list = tokio::time::timeout_at(
                deadline,
                self.transport.list_index(&prefix, token.as_deref()),
            )
            .await
            .map_err(|_| StorageError::Timeout)??;
            for path in list.keys {
                if let Some(part) = path
                    .strip_prefix(&prefix)
                    .and_then(|rest| rest.strip_suffix(".json"))
                {
                    partitions.insert(part.to_owned());
                }
            }
            match list.next {
                None => break,
                Some(next) if page < 7 && seen.insert(next.clone()) => token = Some(next),
                Some(_) => return Err(StoreError::Storage(StorageError::Capacity)),
            }
        }
        let mut editions = Vec::with_capacity(partitions.len());
        for part in partitions {
            let id = catalog_id(year, &part)?;
            if let Some(stored) = self.read_partition(&id, deadline).await?
                && stored.edition.year == year
            {
                editions.push(stored.edition);
            }
        }
        Ok(editions)
    }

    /// Refresh current and next KST years from S3 into `calendar`, then clear the restart `503` guard.
    ///
    /// Any conflict between stored S3 editions and bundled seeds aborts the refresh while keeping
    /// the restart `503` guard active so an inconsistent state is never silently served.
    pub async fn refresh(&self, calendar: &Calendar, deadline: Instant) -> Result<(), StoreError> {
        let first = calendar.current_year();
        let mut loaded = Vec::new();
        for year in [first, first + 1] {
            let editions = self.load_year_editions(year, deadline).await?;
            for edition in &editions {
                calendar
                    .check_edition(edition)
                    .map_err(|e| StoreError::Conflict(e.0))?;
            }
            loaded.extend(editions);
        }
        for edition in loaded {
            calendar
                .apply(edition)
                .map_err(|e| StoreError::Conflict(e.0))?;
        }
        calendar.finish_restore();
        Ok(())
    }
}

pub struct Service<T> {
    calendar: Arc<Calendar>,
    store: Store<T>,
    source: Option<Arc<dyn OfficialSource>>,
    policy: RwLock<Arc<Policy>>,
    last_checked_day: Mutex<Option<String>>,
    reconcile_lock: Mutex<()>,
}

impl<T: IndexListing + Clone + Send + Sync + 'static> Service<T> {
    pub fn new(
        transport: T,
        clock: Clock,
        future_years: i32,
        seeds: &[EditionRecord],
        source: Option<Arc<dyn OfficialSource>>,
    ) -> Result<Self, StoreError> {
        let calendar = Arc::new(Calendar::new(clock, future_years, seeds)?);
        calendar.begin_restore();
        let store = Store::new(transport)?;
        let policy = Arc::new(Policy::bundled().map_err(StoreError::Corrupt)?);
        Ok(Self {
            calendar,
            store,
            source,
            policy: RwLock::new(policy),
            last_checked_day: Mutex::new(None),
            reconcile_lock: Mutex::new(()),
        })
    }

    pub fn calendar(&self) -> &Arc<Calendar> {
        &self.calendar
    }

    pub fn store(&self) -> &Store<T> {
        &self.store
    }

    /// Replace the active KR policy if valid; invalid JSON retains the prior policy and returns `false`.
    pub fn activate_policy_json(&self, json: &str) -> bool {
        match Policy::parse_json(json) {
            Ok(parsed) => {
                *self.policy.write().expect("policy lock") = Arc::new(parsed);
                true
            }
            Err(_) => false,
        }
    }

    /// Run one reconciliation step: prepare rolling horizon, refresh from S3, and once per KST day
    /// check official almanac publications for `check_years(now)`.
    pub async fn reconcile_once(&self) {
        let _guard = self.reconcile_lock.lock().await;
        if let Err(err) = self.calendar.prepare() {
            eprintln!("solar-terms prepare failed: {err}");
            return;
        }
        let s3_deadline = Instant::now() + STORE_OP_TIMEOUT;
        if let Err(err) = self.store.refresh(&self.calendar, s3_deadline).await {
            eprintln!("solar-terms S3 refresh failed: {err}");
            return;
        }
        let Some(source) = &self.source else {
            return;
        };
        let now_ms = self.calendar.now_ms();
        let today = korea_date(now_ms);
        {
            let mut last = self.last_checked_day.lock().await;
            if last.as_deref() == Some(today.as_str()) {
                return;
            }
            *last = Some(today);
        }
        for year in check_years(now_ms) {
            let fetch_deadline = Instant::now() + FETCH_OP_TIMEOUT;
            match source.fetch_edition(year, fetch_deadline).await {
                Ok(fetched) => {
                    if let Err(err) = self.calendar.check_edition(&fetched.edition) {
                        eprintln!("solar-terms conflict {year} before S3 publish: {err}");
                        continue;
                    }
                    let pub_deadline = Instant::now() + STORE_OP_TIMEOUT;
                    if let Err(err) = self.store.publish(&fetched, now_ms, pub_deadline).await {
                        eprintln!("solar-terms publish {year} failed: {err}");
                        continue;
                    }
                    if let Err(err) = self.calendar.apply(fetched.edition) {
                        eprintln!("solar-terms apply {year} failed: {err}");
                    }
                }
                Err(err) => {
                    eprintln!("solar-terms verification {year}: {err}");
                }
            }
        }
    }
}

impl<T: IndexListing + Clone + Send + Sync + 'static> CalendarApi for Service<T> {
    fn in_range(&self, year: i32) -> bool {
        self.calendar.in_range(year)
    }

    fn read_year(&self, year: i32) -> Option<Arc<YearSnapshot>> {
        self.calendar.read_year(year)
    }
}

impl<T: IndexListing + Clone + Send + Sync + 'static> TermLookup for Service<T> {
    fn term_for_date(&self, iso_date: &str) -> Option<TermEntry> {
        self.calendar.term_for_kst_date(iso_date).map(|(t, _)| t)
    }

    fn year_available(&self, year: i32) -> bool {
        self.calendar.read_year(year).is_some()
    }

    fn policy(&self) -> Arc<Policy> {
        Arc::clone(&self.policy.read().expect("policy lock"))
    }
}

impl<T: IndexListing + Clone + Send + Sync + 'static> Reconcile for Service<T> {
    fn tick(&self) -> BoxFuture<'_, ()> {
        Box::pin(self.reconcile_once())
    }
}

/// Standalone in-memory lookup adapter for tests or callers without S3.
pub struct MemoryLookup {
    calendar: Arc<Calendar>,
    policy: RwLock<Arc<Policy>>,
}

impl MemoryLookup {
    pub fn new(calendar: Arc<Calendar>, policy: Policy) -> Self {
        Self {
            calendar,
            policy: RwLock::new(Arc::new(policy)),
        }
    }

    pub fn activate_policy_json(&self, json: &str) -> bool {
        match Policy::parse_json(json) {
            Ok(parsed) => {
                *self.policy.write().expect("policy lock") = Arc::new(parsed);
                true
            }
            Err(_) => false,
        }
    }
}

impl CalendarApi for MemoryLookup {
    fn in_range(&self, year: i32) -> bool {
        self.calendar.in_range(year)
    }

    fn read_year(&self, year: i32) -> Option<Arc<YearSnapshot>> {
        self.calendar.read_year(year)
    }
}

impl TermLookup for MemoryLookup {
    fn term_for_date(&self, iso_date: &str) -> Option<TermEntry> {
        self.calendar.term_for_kst_date(iso_date).map(|(t, _)| t)
    }

    fn year_available(&self, year: i32) -> bool {
        self.calendar.read_year(year).is_some()
    }

    fn policy(&self) -> Arc<Policy> {
        Arc::clone(&self.policy.read().expect("policy lock"))
    }
}
