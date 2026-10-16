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
