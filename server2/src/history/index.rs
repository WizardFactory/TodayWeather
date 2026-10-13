//! In-memory capture/coverage index: captured publications, captured minute pages and legacy
//! export snapshots. Updated after each S06 publish and rebuilt after a replacement from bounded
//! raw LIST pages. Raw presence is optimistic only for an interrupted multi-page publication; the
//! S06 catalog read stays authoritative when inputs are read.
use super::{
    Grid,
    legacy::{ExportKey, LegacyKind, SOURCE as LEGACY_SOURCE},
    schedule::{self, Family, Target},
};
use crate::domestic::publication::Publication;
use crate::storage::{CatalogTransport, Error, ProviderKey, decode_list, sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

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
    pub fn is_incomplete(&self, kind: &str, date: u32) -> bool {
        self.incomplete.contains(&(kind.to_owned(), date))
    }
    pub fn merge(&mut self, other: &CaptureIndex) {
        self.captured.extend(other.captured.iter().copied());
        self.minutes.extend(other.minutes.iter().copied());
        for (k, v) in &other.exports {
            self.exports.entry(*k).or_default().extend(v);
        }
        self.incomplete.extend(other.incomplete.iter().cloned());
    }

    /// Rebuild from raw object keys: per-cell families for `grids`, national pages, and legacy
    /// export records for `grids`/`stations`, over the lookback dates ending at `now_ms`.
    pub async fn rebuild<T: CatalogTransport>(
        transport: &T,
        grids: &BTreeSet<Grid>,
        stations: &BTreeSet<u32>,
        now_ms: i64,
        config: &RebuildConfig,
    ) -> Result<(Self, RebuildReport), Error> {
        let mut index = Self::default();
        let mut report = RebuildReport::default();
        let mut keys: HashMap<String, Target> = grids
            .iter()
            .map(|g| (g.key_sha256(), Target::Cell(*g)))
            .collect();
        for id in ["aws-national", "city-national"] {
            keys.insert(
                sha256(&ProviderKey::Named { id: id.into() }.canonical_bytes()?),
                Target::National,
            );
        }
        let mut export_keys: HashMap<String, ExportKey> = grids
            .iter()
            .map(|g| (g.key_sha256(), ExportKey::Grid(*g)))
            .collect();
        for s in stations {
            export_keys.insert(
                sha256(&ExportKey::Station(*s).provider_key().canonical_bytes()?),
                ExportKey::Station(*s),
            );
        }
        let families = [
            Family::Current,
            Family::Shortest,
            Family::Short,
            Family::AwsHourly,
            Family::CityObs,
            Family::AwsMinute,
        ];
        for date in dates(now_ms, config.capture_days) {
            for family in families {
                let prefix = day_prefix(family.source(), family.kind(), date);
                let Some(found) = list(transport, &prefix, config, &mut report).await? else {
                    index.mark_incomplete(family.kind(), date);
                    continue;
                };
                for key in found {
                    let Some(raw) = RawKey::parse(&key) else {
                        report.unparsed += 1;
                        continue;
                    };
                    let Some(target) = keys.get(raw.key_sha256) else {
                        continue;
                    };
                    let Some(publication) = Publication::new(date, raw.slot) else {
                        report.unparsed += 1;
                        continue;
                    };
                    let expected = match family {
                        Family::AwsMinute => matches!(target, Target::National),
                        f if f.per_cell() => matches!(target, Target::Cell(_)),
                        _ => matches!(target, Target::National),
                    };
                    if expected {
                        index.insert(family, *target, publication);
                        report.captured += 1;
                    }
                }
            }
        }
        for date in dates(now_ms, config.export_days) {
            for kind in LegacyKind::ALL {
                let prefix = day_prefix(LEGACY_SOURCE, kind.kind(), date);
                let Some(found) = list(transport, &prefix, config, &mut report).await? else {
                    index.mark_incomplete(kind.kind(), date);
                    continue;
                };
                for key in found {
                    let Some(raw) = RawKey::parse(&key) else {
                        report.unparsed += 1;
                        continue;
                    };
                    if let Some(export) = export_keys.get(raw.key_sha256) {
                        index.add_export(kind, *export, raw.fetched_at_ms);
                        report.exports += 1;
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
    /// KST dates scanned for captures (lookback plus today).
    pub capture_days: u32,
    /// KST dates scanned for legacy export snapshots (station hourly retention plus today).
    pub export_days: u32,
    pub pages_per_prefix: usize,
}
impl Default for RebuildConfig {
    fn default() -> Self {
        Self {
            capture_days: 10,
            export_days: 11,
            pages_per_prefix: 16,
        }
    }
}
#[derive(Debug, Clone, Default)]
pub struct RebuildReport {
    pub lists: usize,
    pub keys: usize,
    pub captured: usize,
    pub exports: usize,
    pub unparsed: usize,
    /// Kind/date listings that exceeded their page bound.
    pub incomplete: Vec<(String, u32)>,
}

fn dates(now_ms: i64, days: u32) -> Vec<u32> {
    (0..days as i64)
        .rev()
        .map(|i| schedule::from_ms(now_ms - i * DAY_MS).date())
        .collect()
}
fn day_prefix(source: &str, kind: &str, date: u32) -> String {
    format!(
        "raw/v2/{source}/{kind}/{:04}/{:02}/{:02}/",
        date / 10000,
        (date / 100) % 100,
        date % 100
    )
}
async fn list<T: CatalogTransport>(
    transport: &T,
    prefix: &str,
    config: &RebuildConfig,
    report: &mut RebuildReport,
) -> Result<Option<Vec<String>>, Error> {
    let mut keys = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..config.pages_per_prefix {
        let bytes = transport
            .list_raw_document(prefix, token.as_deref(), 1000, 4 * 1024 * 1024)
            .await?;
        let page = decode_list(&bytes, 1000)?;
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

/// `raw/v2/{source}/{kind}/{YYYY}/{MM}/{DD}/{slot}/{key_sha256}/{fetched}-{raw_sha256}.raw.gz`.
struct RawKey<'a> {
    slot: u16,
    key_sha256: &'a str,
    fetched_at_ms: i64,
}
impl<'a> RawKey<'a> {
    fn parse(key: &'a str) -> Option<Self> {
        let parts: Vec<&str> = key.split('/').collect();
        if parts.len() != 10 || parts[0] != "raw" || parts[1] != "v2" {
            return None;
        }
        let slot = parts[7];
        if slot.len() != 4 || !slot.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let (fetched, _) = parts[9].strip_suffix(".raw.gz")?.split_once('-')?;
        Some(Self {
            slot: slot.parse().ok()?,
            key_sha256: parts[8],
            fetched_at_ms: fetched.parse().ok()?,
        })
    }
}
