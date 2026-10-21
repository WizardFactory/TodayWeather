//! S3 reads of the source: published catalogs only (an interrupted upload never counts), listed
//! per key and KST month and read through S06 `lookup`, every complete acquisition with its pages
//! in page order and its fetch instant.
use crate::history::IndexListing;
use crate::storage::{
    CatalogId, CatalogStore, Error, LookupOutcome, PageOutcome, ProviderKey, RawRecord, ReadCursor,
    ReadOrder, sha256,
};
use std::sync::Arc;
use tokio::time::Instant;

/// One complete acquisition.
#[derive(Debug, Clone)]
pub struct Fetched {
    pub fetched_at_ms: u64,
    /// The catalog partition (publication `YYYYMMDD-HHMM` or KST day).
    pub partition: String,
    pub pages: Vec<Arc<[u8]>>,
}
impl Fetched {
    pub fn page_refs(&self) -> Vec<&[u8]> {
        self.pages.iter().map(|p| &p[..]).collect()
    }
    pub(super) fn checked_clone(&self) -> Result<Self, Error> {
        let mut pages = Vec::new();
        super::forecast_cache::reserve(&mut pages, self.pages.len())?;
        pages.extend(self.pages.iter().cloned());
        Ok(Self {
            fetched_at_ms: self.fetched_at_ms,
            partition: super::forecast_cache::copied(&self.partition)?,
            pages,
        })
    }
}
/// Per owned forecast scope, including invalid/rejected and newer fallback-month inputs.
#[derive(Default)]
pub(super) struct ForecastScope {
    partitions: usize,
    acquisitions: usize,
    pages: usize,
    raw: usize,
}
impl ForecastScope {
    fn partition(&mut self) -> Result<(), Error> {
        self.partitions = super::forecast_cache::add(self.partitions, 1)?;
        if self.partitions > 1024 {
            return Err(Error::Capacity);
        }
        Ok(())
    }
    /// One consumed partition, in partition order. Every total only grows and every violation
    /// is `Capacity`, so this fails at the same partition as checking each acquisition did.
    pub(super) fn admit(&mut self, counted: &Counted) -> Result<(), Error> {
        use super::forecast_cache::add;
        self.acquisitions = add(self.acquisitions, counted.acquisitions)?;
        self.pages = add(self.pages, counted.pages)?;
        self.raw = add(self.raw, counted.raw)?;
        if counted.oversize
            || self.acquisitions > 2048
            || self.pages > 8192
            || self.raw > 32 * 1024 * 1024
        {
            return Err(Error::Capacity);
        }
        Ok(())
    }
}
/// Scope totals of one looked-up partition: every acquisition of its S06 set, including one
/// that yields no [`Fetched`].
#[derive(Default)]
pub(super) struct Counted {
    acquisitions: usize,
    pages: usize,
    raw: usize,
    oversize: bool,
}
impl Counted {
    /// One acquisition with pages of these byte lengths.
    fn acquisition(&mut self, pages: impl ExactSizeIterator<Item = usize>) -> Result<(), Error> {
        use super::forecast_cache::{PAGE_BYTES, add};
        self.acquisitions = add(self.acquisitions, 1)?;
        self.pages = add(self.pages, pages.len())?;
        for bytes in pages {
            self.oversize |= bytes > PAGE_BYTES;
            self.raw = add(self.raw, bytes)?;
        }
        Ok(())
    }
}
/// One partition lookup: acquisitions in S06 order, excluded groups and scope totals.
pub(super) struct Looked {
    pub(super) found: Vec<Fetched>,
    pub(super) excluded: usize,
    pub(super) counted: Counted,
}
/// LIST pages allowed per key and month (1,000 keys each; a month of hourly partitions is 744).
const LIST_PAGES: usize = 4;
/// Catalog lookups in flight at once per load (below the shared S3 admission).
pub const LOOKUPS: usize = 8;

pub struct Reader<T> {
    pub transport: T,
    pub store: Arc<CatalogStore<T>>,
}
impl<T: Clone> Clone for Reader<T> {
    fn clone(&self) -> Self {
        Self {
            transport: self.transport.clone(),
            store: self.store.clone(),
        }
    }
}
fn catalog(
    source: &str,
    kind: &str,
    key: &ProviderKey,
    partition: &str,
) -> Result<CatalogId, Error> {
    let id = CatalogId {
        source: source.into(),
        kind: kind.into(),
        key_sha256: sha256(&key.canonical_bytes()?),
        partition: partition.into(),
    };
    id.validate()?;
    Ok(id)
}
/// Records of one acquisition in page order.
fn ordered(records: &[RawRecord]) -> Vec<RawRecord> {
    let mut records = records.to_vec();
    records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
    records
}
impl<T: IndexListing + Clone> Reader<T> {
    pub(super) async fn forecast_partitions(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        months: &[u32],
        scope: &mut ForecastScope,
        deadline: Instant,
    ) -> Result<Vec<String>, Error> {
        use super::forecast_cache::{copied, reserve};
        let prefix = Self::prefix(source, kind, key)?;
        let mut out = Vec::new();
        for month in months {
            let mut token = None;
            let mut done = false;
            for _ in 0..LIST_PAGES {
                let page = tokio::time::timeout_at(
                    deadline,
                    self.transport
                        .list_index(&format!("{prefix}{month:06}"), token.as_deref()),
                )
                .await
                .map_err(|_| Error::Timeout)??;
                for key in page.keys {
                    if let Some(p) = key
                        .strip_prefix(&prefix)
                        .and_then(|p| p.strip_suffix(".json"))
                    {
                        scope.partition()?;
                        if p.len() > 32 {
                            return Err(Error::Capacity);
                        }
                        reserve(&mut out, 1)?;
                        out.push(copied(p)?);
                    }
                }
                token = page.next;
                if token.is_none() {
                    done = true;
                    break;
                }
            }
            if !done {
                return Err(Error::Capacity);
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }
    /// One partition. Its S06 limits bound the lookup's records and controls while it is in
    /// flight; the caller admits its scope totals in partition order before retaining it.
    pub(super) async fn forecast_lookup(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<Looked, Error> {
        use super::forecast_cache::{copied, reserve};
        let id = catalog(source, kind, key, partition)?;
        let set = match self.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => set,
            Ok(LookupOutcome::Incomplete) => return Err(Error::Corrupt("incomplete catalog")),
            // This private path only reads partitions witnessed by LIST. A vanished catalog
            // is an eligible partial answer, not proof of reusable empty canonical state.
            Err(Error::NotFound) => {
                return Ok(Looked {
                    found: Vec::new(),
                    excluded: 1,
                    counted: Counted::default(),
                });
            }
            Err(e) => return Err(e),
        };
        let mut counted = Counted::default();
        let mut out = Vec::new();
        for a in set.acquisitions() {
            counted.acquisition(a.records().iter().map(|r| r.bytes.len()))?;
            let mut ordered = Vec::new();
            reserve(&mut ordered, a.records().len())?;
            ordered.extend(a.records().iter());
            ordered.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
            let Some(completed) = ordered
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
            else {
                continue;
            };
            let mut pages = Vec::new();
            reserve(&mut pages, ordered.len())?;
            pages.extend(ordered.into_iter().map(|r| r.bytes.clone()));
            reserve(&mut out, 1)?;
            out.push(Fetched {
                fetched_at_ms: completed,
                partition: copied(partition)?,
                pages,
            });
        }
        Ok(Looked {
            found: out,
            excluded: set.excluded_groups(),
            counted,
        })
    }
    fn prefix(source: &str, kind: &str, key: &ProviderKey) -> Result<String, Error> {
        Ok(format!(
            "index/v2/{source}/{kind}/{}/",
            sha256(&key.canonical_bytes()?)
        ))
    }
    /// Published partitions of one key in the given KST months (`YYYYMM`), ascending. An
    /// incomplete listing is an error: absence cannot be proved.
    pub async fn partitions(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        months: &[u32],
        deadline: Instant,
    ) -> Result<Vec<String>, Error> {
        let prefix = Self::prefix(source, kind, key)?;
        let mut out = Vec::new();
        for month in months {
            let mut token: Option<String> = None;
            let mut done = false;
            for _ in 0..LIST_PAGES {
                let page = tokio::time::timeout_at(
                    deadline,
                    self.transport
                        .list_index(&format!("{prefix}{month:06}"), token.as_deref()),
                )
                .await
                .map_err(|_| Error::Timeout)??;
                for key in page.keys {
                    if let Some(p) = key
                        .strip_prefix(&prefix)
                        .and_then(|k| k.strip_suffix(".json"))
                    {
                        out.push(p.to_owned());
                    }
                }
                token = page.next;
                if token.is_none() {
                    done = true;
                    break;
                }
            }
            if !done {
                return Err(Error::Capacity);
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }
    /// Every complete acquisition of one catalog; empty when the catalog does not exist.
    pub async fn acquisitions(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<Vec<Fetched>, Error> {
        self.acquisitions_counted(source, kind, key, partition, deadline)
            .await
            .map(|(f, _)| f)
    }
    /// [`Self::acquisitions`] and the number of listed groups S06 excluded (not eligible or a
    /// raw body missing): S16 records nothing from such a partial read.
    pub async fn acquisitions_counted(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<(Vec<Fetched>, usize), Error> {
        let id = CatalogId {
            source: source.into(),
            kind: kind.into(),
            key_sha256: sha256(&key.canonical_bytes()?),
            partition: partition.into(),
        };
        id.validate()?;
        let set = match self.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => set,
            Ok(LookupOutcome::Incomplete) => return Err(Error::Corrupt("incomplete catalog")),
            Err(Error::NotFound) => return Ok((Vec::new(), 0)),
            Err(e) => return Err(e),
        };
        let mut out = Vec::new();
        for a in set.acquisitions() {
            let mut records: Vec<_> = a.records().to_vec();
            records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
            // An acquisition is complete when its last page arrived: that instant orders
            // replays and decides whether it existed at a request instant.
            let Some(completed) = records
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
            else {
                continue;
            };
            out.push(Fetched {
                fetched_at_ms: completed,
                partition: partition.into(),
                pages: records.iter().map(|r| r.bytes.clone()).collect(),
            });
        }
        Ok((out, set.excluded_groups()))
    }
    /// Every complete acquisition of one catalog as raw records (envelopes kept), in catalog
    /// order; empty when the catalog does not exist.
    pub async fn raw(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<Vec<Vec<RawRecord>>, Error> {
        self.raw_counted(source, kind, key, partition, deadline)
            .await
            .map(|(r, _)| r)
    }
    /// [`Self::raw`] and the number of listed groups S06 excluded (S16 completeness).
    pub async fn raw_counted(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<(Vec<Vec<RawRecord>>, usize), Error> {
        let id = catalog(source, kind, key, partition)?;
        match self.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => Ok((
                set.acquisitions()
                    .iter()
                    .map(|a| ordered(a.records()))
                    .collect(),
                set.excluded_groups(),
            )),
            Ok(LookupOutcome::Incomplete) => Err(Error::Corrupt("incomplete catalog")),
            Err(Error::NotFound) => Ok((Vec::new(), 0)),
            Err(e) => Err(e),
        }
    }
    /// The newest acquisitions of one catalog, latest first, read in pages of `page` until
    /// `enough` holds for the acquisitions read so far (or the catalog ends).
    #[allow(clippy::too_many_arguments)] // One catalog identity plus paging and a stop rule.
    pub async fn latest_raw(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        page: usize,
        mut enough: impl FnMut(&[Vec<RawRecord>]) -> bool,
        deadline: Instant,
    ) -> Result<Vec<Vec<RawRecord>>, Error> {
        let id = catalog(source, kind, key, partition)?;
        let mut out = Vec::new();
        let mut cursor: Option<ReadCursor> = None;
        loop {
            let found = match self
                .store
                .lookup_page(&id, ReadOrder::LatestFirst, cursor.as_ref(), page, deadline)
                .await
            {
                Ok(PageOutcome::Ready(found)) => found,
                Ok(PageOutcome::Incomplete) => return Err(Error::Corrupt("incomplete catalog")),
                Err(Error::NotFound) => return Ok(out),
                Err(e) => return Err(e),
            };
            out.extend(found.acquisitions().iter().map(|a| ordered(a.records())));
            match found.next() {
                Some(next) if !enough(&out) => cursor = Some(next.clone()),
                _ => return Ok(out),
            }
        }
    }
    /// Acquisitions of many partitions of one key, at most [`LOOKUPS`] lookups at a time,
    /// ordered by fetch instant (stable by partition).
    pub async fn all(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partitions: &[String],
        deadline: Instant,
    ) -> Result<Vec<Fetched>, Error> {
        self.all_counted(source, kind, key, partitions, deadline)
            .await
            .map(|(f, _)| f)
    }
    /// [`Self::all`] and the number of listed groups S06 excluded (S16 completeness).
    pub async fn all_counted(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partitions: &[String],
        deadline: Instant,
    ) -> Result<(Vec<Fetched>, usize), Error> {
        let mut out = Vec::new();
        let mut excluded = 0;
        for chunk in partitions.chunks(LOOKUPS) {
            let reads = crate::history::join_all(
                chunk
                    .iter()
                    .map(|p| self.acquisitions_counted(source, kind, key, p, deadline))
                    .collect(),
            )
            .await;
            for r in reads {
                let (f, e) = r?;
                out.extend(f);
                excluded += e;
            }
        }
        out.sort_by(|a, b| {
            a.fetched_at_ms
                .cmp(&b.fetched_at_ms)
                .then_with(|| a.partition.cmp(&b.partition))
        });
        Ok((out, excluded))
    }
}
/// KST months (`YYYYMM`) from `from_ms` through `to_ms`.
pub fn months(from_ms: f64, to_ms: f64) -> Vec<u32> {
    let mut out = Vec::new();
    let mut t = from_ms;
    loop {
        if let Some(p) = crate::world::js::parts(t + 9. * 3_600_000.) {
            let m = (p.year * 100 + p.month) as u32;
            if out.last() != Some(&m) {
                out.push(m);
            }
        }
        if t >= to_ms {
            break;
        }
        t = (t + 86_400_000.).min(to_ms);
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domestic::kma::source::forecast_cache::PAGE_BYTES;
    const MIB: usize = 1024 * 1024;
    /// A partition: its acquisitions, each the byte lengths of its pages.
    type Partition = Vec<Vec<usize>>;
    /// The D2 accounting: every acquisition checked in order while partitions were read one at
    /// a time. The index of the partition whose acquisition failed.
    fn sequential(parts: &[Partition]) -> Option<usize> {
        let (mut acquisitions, mut pages, mut raw) = (0usize, 0usize, 0usize);
        for (i, part) in parts.iter().enumerate() {
            for acquisition in part {
                acquisitions += 1;
                pages += acquisition.len();
                if acquisitions > 2048 || pages > 8192 {
                    return Some(i);
                }
                for &bytes in acquisition {
                    if bytes > PAGE_BYTES {
                        return Some(i);
                    }
                    raw += bytes;
                    if raw > 32 * MIB {
                        return Some(i);
                    }
                }
            }
        }
        None
    }
    fn admitted(parts: &[Partition]) -> Option<usize> {
        let mut scope = ForecastScope::default();
        for (i, part) in parts.iter().enumerate() {
            let mut counted = Counted::default();
            for acquisition in part {
                counted.acquisition(acquisition.iter().copied()).unwrap();
            }
            if let Err(e) = scope.admit(&counted) {
                assert_eq!(e, Error::Capacity);
                return Some(i);
            }
        }
        None
    }
    #[test]
    fn partition_totals_keep_every_exact_scope_boundary() {
        let one = |acquisitions, pages, raw, oversize| Counted {
            acquisitions,
            pages,
            raw,
            oversize,
        };
        for (at, above) in [
            (one(2048, 0, 0, false), one(1, 0, 0, false)),
            (one(0, 8192, 0, false), one(0, 1, 0, false)),
            (one(0, 0, 32 * MIB, false), one(0, 0, 1, false)),
        ] {
            let mut scope = ForecastScope::default();
            scope.admit(&at).unwrap();
            assert_eq!(scope.admit(&above), Err(Error::Capacity));
        }
        let mut page = Counted::default();
        page.acquisition([PAGE_BYTES].into_iter()).unwrap();
        ForecastScope::default().admit(&page).unwrap();
        page.acquisition([PAGE_BYTES + 1].into_iter()).unwrap();
        assert_eq!(ForecastScope::default().admit(&page), Err(Error::Capacity));
        // An acquisition without pages still counts toward the 2048.
        let mut empty = Counted::default();
        for _ in 0..2049 {
            empty.acquisition(std::iter::empty()).unwrap();
        }
        assert_eq!(ForecastScope::default().admit(&empty), Err(Error::Capacity));
    }
    #[test]
    fn partition_totals_fail_at_the_same_partition_as_per_acquisition_checks() {
        let mut state = 0x2545_f491_4f6c_dd1d_u64;
        let mut next = |bound: u64| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state % bound
        };
        for case in 0..3000 {
            // Bias each case toward one of the caps: many acquisitions, many pages, large pages.
            let (acquisitions, pages, large) = match case % 3 {
                0 => (40, 2, false),
                1 => (4, 40, false),
                _ => (3, 3, true),
            };
            let parts: Vec<Partition> = (0..next(120) as usize + 1)
                .map(|_| {
                    (0..next(acquisitions))
                        .map(|_| {
                            (0..next(pages))
                                .map(|_| match (large, next(100)) {
                                    (true, 0) => PAGE_BYTES + 1,
                                    (true, n) if n < 50 => PAGE_BYTES - next(2) as usize,
                                    (_, _) => next(64 * 1024) as usize,
                                })
                                .collect()
                        })
                        .collect()
                })
                .collect();
            assert_eq!(admitted(&parts), sequential(&parts), "case {case}");
        }
    }
}
