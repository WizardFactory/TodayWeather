//! In-memory capture/coverage index: captured publications, captured minute pages and legacy
//! export snapshots. Updated after each S06 publish and rebuilt after a replacement from bounded
//! raw LIST pages. Raw presence is optimistic only for an interrupted multi-page publication; the
//! S06 catalog read stays authoritative when inputs are read.
use super::IndexListing;
use super::{
    Grid,
    legacy::{ExportKey, LegacyKind, SOURCE as LEGACY_SOURCE},
    schedule::{self, Family, Target},
};
use crate::domestic::publication::Publication;
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, Envelope, Error, Period, ProviderKey, sha256,
};
use std::collections::{BTreeMap, BTreeSet, HashSet};

const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Default)]
pub struct CaptureIndex {
    captured: HashSet<(Family, Target, Publication)>,
    minutes: BTreeSet<Publication>,
    exports: BTreeMap<(LegacyKind, ExportKey), BTreeSet<i64>>,
    incomplete: BTreeSet<(String, u32)>,
}
impl CaptureIndex {
    pub fn insert(&mut self, family: Family, target: Target, publication: Publication) {
        if family == Family::AwsMinute {
            self.minutes.insert(publication);
        } else {
            self.captured.insert((family, target, publication));
        }
    }
    pub fn has(&self, family: Family, target: Target, publication: Publication) -> bool {
        if family == Family::AwsMinute {
            return self.minutes.contains(&publication);
        }
        self.captured.contains(&(family, target, publication))
    }
    pub fn insert_minute(&mut self, observed: Publication) {
        self.minutes.insert(observed);
    }
    /// Captured minute-page observation instants, ascending.
    pub fn minutes(&self) -> impl Iterator<Item = Publication> + '_ {
        self.minutes.iter().copied()
    }
    pub fn last_minute(&self) -> Option<Publication> {
        self.minutes.last().copied()
    }
    pub fn add_export(&mut self, kind: LegacyKind, key: ExportKey, exported_at_ms: i64) {
        self.exports
            .entry((kind, key))
            .or_default()
            .insert(exported_at_ms);
    }
    /// Export snapshot instants for one legacy collection and key, ascending.
    pub fn exports(&self, kind: LegacyKind, key: ExportKey) -> Vec<i64> {
        self.exports
            .get(&(kind, key))
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }
    /// A bounded LIST could not prove the listing of this kind/date complete.
    pub fn mark_incomplete(&mut self, kind: &str, date: u32) {
        self.incomplete.insert((kind.to_owned(), date));
    }
    /// Incomplete for this date, or for every date of the kind (`ALL_DATES`).
    pub fn is_incomplete(&self, kind: &str, date: u32) -> bool {
        self.incomplete.contains(&(kind.to_owned(), date))
            || self.incomplete.contains(&(kind.to_owned(), ALL_DATES))
    }
    pub fn merge(&mut self, other: &CaptureIndex) {
        self.captured.extend(other.captured.iter().copied());
        self.minutes.extend(other.minutes.iter().copied());
        for (k, v) in &other.exports {
            self.exports.entry(*k).or_default().extend(v);
        }
        self.incomplete.extend(other.incomplete.iter().cloned());
    }

    /// Rebuild after a replacement from *published* S06 catalogs only (raw objects without a
    /// catalog entry are interrupted publications and do not count). data.go.kr and legacy
    /// catalogs are listed per key (`index/v2/{source}/{kind}/{key}/`); national pages share a
    /// KST-day catalog whose entries name the captured publications. Legacy export catalogs are
    /// read for their exact export instants. A listing or catalog that cannot be read completely
    /// marks its kind incomplete, which forwards affected requests to legacy.
    pub async fn rebuild<T: IndexListing>(
        transport: &T,
        grids: &BTreeSet<Grid>,
        stations: &BTreeSet<u32>,
        now_ms: i64,
        config: &RebuildConfig,
    ) -> Result<(Self, RebuildReport), Error> {
        let mut index = Self::default();
        let mut report = RebuildReport::default();
        let limits = CatalogLimits::default();
        let capture_from = schedule::from_ms(now_ms - i64::from(config.capture_days) * DAY_MS);
        let export_from_ms = now_ms - i64::from(config.export_days) * DAY_MS;
        for grid in grids {
            let sha = grid.key_sha256();
            for family in Family::PER_CELL {
                let prefix = format!("index/v2/{}/{}/{sha}/", family.source(), family.kind());
                let Some(keys) = list_months(
                    transport,
                    &prefix,
                    now_ms,
                    config.capture_days,
                    config,
                    &mut report,
                )
                .await?
                else {
                    index.mark_incomplete(family.kind(), ALL_DATES);
                    continue;
                };
                for key in keys {
                    let Some(publication) = partition_publication(&prefix, &key) else {
                        report.unparsed += 1;
                        continue;
                    };
                    if publication >= capture_from {
                        index.insert(family, Target::Cell(*grid), publication);
                        report.captured += 1;
                    }
                }
            }
        }
        for family in [Family::AwsHourly, Family::CityObs, Family::AwsMinute] {
            let id = if family == Family::CityObs {
                "city-national"
            } else {
                "aws-national"
            };
            let sha = sha256(&ProviderKey::Named { id: id.into() }.canonical_bytes()?);
            for date in dates(now_ms, config.capture_days) {
                let catalog = CatalogId {
                    source: family.source().into(),
                    kind: family.kind().into(),
                    key_sha256: sha.clone(),
                    partition: format!("{date:08}"),
                };
                match entries(transport, &catalog, &limits, &mut report).await? {
                    Some(found) => {
                        for e in found {
                            if let Some(p) = period_publication(&e.identity.period) {
                                index.insert(family, Target::National, p);
                                report.captured += 1;
                            }
                        }
                    }
                    None => index.mark_incomplete(family.kind(), date),
                }
            }
        }
        let mut export_keys: Vec<ExportKey> = grids.iter().map(|g| ExportKey::Grid(*g)).collect();
        export_keys.extend(stations.iter().map(|s| ExportKey::Station(*s)));
        for key in export_keys {
            let sha = sha256(&key.provider_key().canonical_bytes()?);
            for kind in LegacyKind::ALL {
                if matches!(key, ExportKey::Station(_)) != kind.is_station() {
                    continue;
                }
                let prefix = format!("index/v2/{LEGACY_SOURCE}/{}/{sha}/", kind.kind());
                let Some(keys) = list_months(
                    transport,
                    &prefix,
                    now_ms,
                    config.export_days,
                    config,
                    &mut report,
                )
                .await?
                else {
                    index.mark_incomplete(kind.kind(), ALL_DATES);
                    continue;
                };
                for catalog_key in keys {
                    let Some(publication) = partition_publication(&prefix, &catalog_key) else {
                        report.unparsed += 1;
                        continue;
                    };
                    if schedule::to_ms(publication) + 60_000 <= export_from_ms {
                        continue;
                    }
                    let catalog = CatalogId {
                        source: LEGACY_SOURCE.into(),
                        kind: kind.kind().into(),
                        key_sha256: sha.clone(),
                        partition: publication.partition(),
                    };
                    match entries(transport, &catalog, &limits, &mut report).await? {
                        Some(found) => {
                            for e in found {
                                if let Ok(at) = i64::try_from(e.identity.fetched_at_ms) {
                                    index.add_export(kind, key, at);
                                    report.exports += 1;
                                }
                            }
                        }
                        None => index.mark_incomplete(kind.kind(), ALL_DATES),
                    }
                }
            }
        }
        report.incomplete = index.incomplete.iter().cloned().collect();
        Ok((index, report))
    }
}

#[derive(Debug, Clone)]
pub struct RebuildConfig {
    /// Days of captures kept (lookback plus today).
    pub capture_days: u32,
    /// Days of legacy export snapshots kept (station hourly retention plus today).
    pub export_days: u32,
    pub pages_per_prefix: usize,
}
impl Default for RebuildConfig {
    fn default() -> Self {
        Self {
            capture_days: 10,
            export_days: 11,
            pages_per_prefix: 4,
        }
    }
}
#[derive(Debug, Clone, Default)]
pub struct RebuildReport {
    pub lists: usize,
    pub keys: usize,
    pub captured: usize,
    pub exports: usize,
    pub catalogs: usize,
    pub unparsed: usize,
    /// Kind/date listings that exceeded their page bound.
    pub incomplete: Vec<(String, u32)>,
}

/// Marks a kind incomplete for every date (a per-key listing could not be completed).
pub const ALL_DATES: u32 = 0;

fn dates(now_ms: i64, days: u32) -> Vec<u32> {
    (0..days as i64)
        .rev()
        .map(|i| schedule::from_ms(now_ms - i * DAY_MS).date())
        .collect()
}
/// Catalog keys under `prefix` for the KST months covering the last `days` days.
async fn list_months<T: IndexListing>(
    transport: &T,
    prefix: &str,
    now_ms: i64,
    days: u32,
    config: &RebuildConfig,
    report: &mut RebuildReport,
) -> Result<Option<Vec<String>>, Error> {
    let months: BTreeSet<u32> = dates(now_ms, days).into_iter().map(|d| d / 100).collect();
    let mut out = Vec::new();
    for month in months {
        match list(transport, &format!("{prefix}{month:06}"), config, report).await? {
            Some(keys) => out.extend(keys),
            None => return Ok(None),
        }
    }
    Ok(Some(out))
}
async fn list<T: IndexListing>(
    transport: &T,
    prefix: &str,
    config: &RebuildConfig,
    report: &mut RebuildReport,
) -> Result<Option<Vec<String>>, Error> {
    let mut keys = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..config.pages_per_prefix {
        let page = transport.list_index(prefix, token.as_deref()).await?;
        report.lists += 1;
        report.keys += page.keys.len();
        keys.extend(page.keys);
        token = page.next;
        if token.is_none() {
            return Ok(Some(keys));
        }
    }
    Ok(None)
}
/// Entries of one published catalog; `Some(empty)` when it does not exist, `None` when it
/// exists but cannot be validated.
async fn entries<T: IndexListing>(
    transport: &T,
    id: &CatalogId,
    limits: &CatalogLimits,
    report: &mut RebuildReport,
) -> Result<Option<Vec<Envelope>>, Error> {
    report.catalogs += 1;
    match transport.get_control(&id.key(), limits.control_bytes).await {
        Ok(object) => Ok(Catalog::from_bytes(&object.body, id, limits)
            .ok()
            .map(|c| c.entries)),
        Err(Error::NotFound) => Ok(Some(Vec::new())),
        Err(e) => Err(e),
    }
}
/// `{prefix}{YYYYMMDD-HHMM}.json` to its publication.
fn partition_publication(prefix: &str, key: &str) -> Option<Publication> {
    let name = key.strip_prefix(prefix)?.strip_suffix(".json")?;
    let (date, time) = name.split_once('-')?;
    if date.len() != 8 || time.len() != 4 {
        return None;
    }
    Publication::new(date.parse().ok()?, time.parse().ok()?)
}
fn period_publication(period: &Period) -> Option<Publication> {
    if period.slot.len() != 4 {
        return None;
    }
    Publication::new(period.local_date, period.slot.parse().ok()?)
}
