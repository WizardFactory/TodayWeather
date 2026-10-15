//! The internal last-year lookup (O-13: no response exposure).
//!
//! Dates: the same date one year earlier (Feb 29 → Feb 28), then the nearest dates ±1..±3,
//! earlier first on a tie. At each date the sources are tried in order: the stored grid summary
//! of the town; the station's ASOS summary (when missing, one on-demand data.go.kr daily range
//! `[base-3, base+3]` is acquired through the funded S15b-2 acquirer, published to S06 and its
//! complete days stored); the VC summary of the cell (when missing, derived from stored raw VC
//! records of that date, never from the VC provider). The first complete summary wins.
//!
//! A failed S3 read or provider failure returns an error instead of a lower-priority answer, so
//! the chosen source and date are deterministic for the stored data.
use super::store::SummaryStore;
use super::transport::SummaryTransport;
use super::{Source, Summary, SummaryKey, add_days};
use crate::domestic::Acquired;
use crate::domestic::asos::{AsosKind, AsosRequest};
use crate::domestic::kma::source::asos::AsosFetched;
use crate::domestic::kma::source::observe::Acquire;
use crate::gateway::BoxFuture;
use crate::storage::{CatalogStore, CatalogTransport, Error};
use crate::world::{CatalogWorldStore, Cell, RawFetch};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

/// An on-demand ASOS range of a station is not acquired again within this long.
pub const ASOS_RETRY: Duration = Duration::from_secs(24 * 3600);
/// Days on each side of the base date.
pub const SPREAD: i64 = 3;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Target {
    /// The town (`town.first/second/third`) for its grid summaries.
    pub town: Option<[String; 3]>,
    /// The mapped ASOS station (S15b-2 nearest city station within 100 km).
    pub station: Option<String>,
    /// The S11 VC cell.
    pub cell: Option<(i16, i16)>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub source: Source,
    pub date: u32,
    /// Days from the base date.
    pub offset: i64,
    pub summary: Summary,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupError {
    Storage(Error),
    /// The on-demand ASOS acquisition failed (not "no data").
    Provider,
    Invalid,
}

/// One on-demand ASOS daily range, acquired and published; `None` when the provider has no
/// data for it.
pub trait AsosOnDemand: Send + Sync + 'static {
    fn daily(
        &self,
        station: String,
        start: u32,
        end: u32,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Option<Vec<AsosFetched>>, LookupError>>;
}
/// Stored raw VC fetches of a cell whose first local date is one of `first_dates`.
pub trait VcRecords: Send + Sync + 'static {
    fn fetches(
        &self,
        cell: Cell,
        first_dates: Vec<u32>,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, LookupError>>;
}

/// The production ASOS path: the S15b-2 funded acquirer, then S06 publication.
pub struct PublishingAsos<T> {
    pub acquire: Arc<dyn Acquire>,
    pub catalogs: Arc<CatalogStore<T>>,
}
impl<T: CatalogTransport + 'static> AsosOnDemand for PublishingAsos<T> {
    fn daily(
        &self,
        station: String,
        start: u32,
        end: u32,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Option<Vec<AsosFetched>>, LookupError>> {
        Box::pin(async move {
            let (a, b) = (format!("{start:08}"), format!("{end:08}"));
            let request = AsosRequest::new(AsosKind::Daily, &station, &a, &b)
                .map_err(|_| LookupError::Invalid)?;
            let acquisition = match self.acquire.asos(request, deadline).await {
                Ok(Acquired::Complete(acquisition)) => acquisition,
                Ok(_) => return Ok(None),
                Err(_) => return Err(LookupError::Provider),
            };
            let pages = acquisition
                .records
                .iter()
                .map(|r| r.bytes.clone())
                .collect();
            let fetched_at = acquisition
                .records
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
                .unwrap_or(0);
            self.catalogs
                .publish(acquisition.declaration, acquisition.records, deadline)
                .await
                .map_err(LookupError::Storage)?;
            Ok(Some(vec![AsosFetched {
                kind: AsosKind::Daily,
                start: a,
                end: b,
                fetched_at_ms: fetched_at as f64,
                pages,
            }]))
        })
    }
}
impl<T: CatalogTransport + 'static> VcRecords for CatalogWorldStore<T> {
    fn fetches(
        &self,
        cell: Cell,
        first_dates: Vec<u32>,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<RawFetch>, LookupError>> {
        Box::pin(async move {
            self.load_first_dates(cell, &first_dates, deadline)
                .await
                .map_err(|e| match e {
                    crate::world::StoreError::Storage(e) => LookupError::Storage(e),
                    crate::world::StoreError::Incomplete => LookupError::Storage(Error::Timeout),
                })
        })
    }
}

/// Candidate (offset, date) pairs in lookup order for `today` (`YYYYMMDD`).
pub fn candidates(today: u32) -> Vec<(i64, u32)> {
    let (y, m, d) = (today / 10000, today / 100 % 100, today % 100);
    let d = if m == 2 && d == 29 { 28 } else { d };
    let base = (y - 1) * 10000 + m * 100 + d;
    let mut out = vec![(0, base)];
    for k in 1..=SPREAD {
        for offset in [-k, k] {
            if let Some(date) = add_days(base, offset) {
                out.push((offset, date));
            }
        }
    }
    out
}

pub struct Lookup<T> {
    store: SummaryStore<T>,
    asos: Option<Arc<dyn AsosOnDemand>>,
    vc: Option<Arc<dyn VcRecords>>,
    attempted: Mutex<HashMap<(String, u32), std::time::Instant>>,
}
impl<T: SummaryTransport> Lookup<T> {
    pub fn new(
        transport: T,
        asos: Option<Arc<dyn AsosOnDemand>>,
        vc: Option<Arc<dyn VcRecords>>,
    ) -> Self {
        Self {
            store: SummaryStore::new(transport),
            asos,
            vc,
            attempted: Mutex::new(HashMap::new()),
        }
    }
    pub fn store(&self) -> &SummaryStore<T> {
        &self.store
    }
    async fn stored(
        &self,
        key: &SummaryKey,
        date: u32,
        deadline: Instant,
    ) -> Result<Option<Summary>, LookupError> {
        self.store
            .newest(key, date, deadline)
            .await
            .map(|s| s.map(|s| s.summary))
            .map_err(LookupError::Storage)
    }
    /// Claim the on-demand range of `station` around `base` (once per [`ASOS_RETRY`]).
    fn claim(&self, station: &str, base: u32) -> bool {
        let mut attempted = self.attempted.lock().unwrap_or_else(|e| e.into_inner());
        attempted.retain(|_, at| at.elapsed() < ASOS_RETRY);
        let key = (station.to_owned(), base);
        if attempted.contains_key(&key) {
            return false;
        }
        attempted.insert(key, std::time::Instant::now());
        true
    }
    /// Acquire `[base-3, base+3]` for `station` and store its complete days.
    async fn asos_on_demand(
        &self,
        station: &str,
        dates: &[u32],
        deadline: Instant,
    ) -> Result<Vec<Summary>, LookupError> {
        let Some(asos) = &self.asos else {
            return Ok(Vec::new());
        };
        let (Some(start), Some(end)) = (dates.iter().min(), dates.iter().max()) else {
            return Ok(Vec::new());
        };
        if !self.claim(station, *start) {
            return Ok(Vec::new());
        }
        let result = async {
            let Some(fetched) = asos
                .daily(station.to_owned(), *start, *end, deadline)
                .await?
            else {
                return Ok(Vec::new());
            };
            let summaries = super::asos::summaries(station, &fetched, dates);
            for s in &summaries {
                self.store
                    .publish(s, deadline)
                    .await
                    .map_err(LookupError::Storage)?;
            }
            Ok(summaries)
        }
        .await;
        if result.is_err() {
            // A failure is not "absent": a later lookup may try the range again.
            self.attempted
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&(station.to_owned(), *start));
        }
        result
    }
    /// The last-year summary for `target` on `today` (`YYYYMMDD`, KST), or None.
    pub async fn last_year(
        &self,
        target: &Target,
        today: u32,
        deadline: Instant,
    ) -> Result<Option<Found>, LookupError> {
        let order = candidates(today);
        let mut dates: Vec<u32> = order.iter().map(|(_, d)| *d).collect();
        dates.sort_unstable();
        let mut acquired: Option<Vec<Summary>> = None;
        let found = |source, offset, date, summary| {
            Ok(Some(Found {
                source,
                date,
                offset,
                summary,
            }))
        };
        for &(offset, date) in &order {
            if let Some(town) = &target.town {
                let key = SummaryKey::Grid { town: town.clone() };
                if let Some(s) = self.stored(&key, date, deadline).await? {
                    return found(Source::Grid, offset, date, s);
                }
            }
            if let Some(station) = &target.station {
                let key = SummaryKey::Asos {
                    station: station.clone(),
                };
                if let Some(s) = acquired
                    .as_ref()
                    .and_then(|a| a.iter().find(|s| s.date == date).cloned())
                {
                    return found(Source::Asos, offset, date, s);
                }
                if let Some(s) = self.stored(&key, date, deadline).await? {
                    return found(Source::Asos, offset, date, s);
                }
                if acquired.is_none() {
                    let a = self.asos_on_demand(station, &dates, deadline).await?;
                    if let Some(s) = a.iter().find(|s| s.date == date).cloned() {
                        return found(Source::Asos, offset, date, s);
                    }
                    acquired = Some(a);
                }
            }
            if let Some((lat, lon)) = target.cell {
                let key = SummaryKey::Vc { lat, lon };
                if let Some(s) = self.stored(&key, date, deadline).await? {
                    return found(Source::Vc, offset, date, s);
                }
                if let Some(vc) = &self.vc {
                    let cell = Cell {
                        lat: f64::from(lat) / 100.,
                        lon: f64::from(lon) / 100.,
                    };
                    let first_dates = [-2, -1, 0]
                        .iter()
                        .filter_map(|d| add_days(date, *d))
                        .collect();
                    let fetches = vc.fetches(cell, first_dates, deadline).await?;
                    if let Some(s) = super::vc::summary(cell, date, &fetches) {
                        self.store
                            .publish(&s, deadline)
                            .await
                            .map_err(LookupError::Storage)?;
                        return found(Source::Vc, offset, date, s);
                    }
                }
            }
        }
        Ok(None)
    }
}
