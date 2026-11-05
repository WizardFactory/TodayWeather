//! S3 reads of the source: published catalogs only (an interrupted upload never counts), listed
//! per key and KST month and read through S06 `lookup`, every complete acquisition with its pages
//! in page order and its fetch instant.
use crate::history::IndexListing;
use crate::storage::{
    CatalogId, CatalogStore, Error, LookupOutcome, PageOutcome, ProviderKey, RawRecord, ReadCursor,
    ReadOrder, sha256,
};
use std::{collections::HashMap, sync::Arc};
use tokio::time::Instant;

/// One complete acquisition.
#[derive(Debug, Clone)]
pub struct Fetched {
    pub fetched_at_ms: u64,
    /// The catalog partition (publication `YYYYMMDD-HHMM` or KST day).
    pub partition: String,
    pub pages: Vec<Arc<[u8]>>,
    /// Full canonical RawId keys, parallel to pages. Empty only for synthetic legacy fixtures.
    pub raw_ids: Vec<String>,
}
impl Fetched {
    pub fn page_refs(&self) -> Vec<&[u8]> {
        self.pages.iter().map(|p| &p[..]).collect()
    }
}
/// LIST pages allowed per key and month (1,000 keys each; a month of hourly partitions is 744).
const LIST_PAGES: usize = 4;
/// LIST pages allowed for every key of one kind (1,000 keys each).
const KIND_LIST_PAGES: usize = 1024;
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
    /// Every key under `prefix`, from one paged LIST. An incomplete listing is an error: absence
    /// cannot be proved.
    async fn listed(
        &self,
        prefix: &str,
        pages: usize,
        deadline: Instant,
    ) -> Result<Vec<String>, Error> {
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..pages {
            let page = tokio::time::timeout_at(
                deadline,
                self.transport.list_index(prefix, token.as_deref()),
            )
            .await
            .map_err(|_| Error::Timeout)??;
            out.extend(page.keys);
            token = page.next;
            if token.is_none() {
                return Ok(out);
            }
        }
        Err(Error::Capacity)
    }
    /// Published partitions of one key in the given KST months (`YYYYMM`), ascending. A range
    /// longer than two months lists the key once, so an existence question costs one LIST however
    /// long the range has grown.
    pub async fn partitions(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        months: &[u32],
        deadline: Instant,
    ) -> Result<Vec<String>, Error> {
        let prefix = Self::prefix(source, kind, key)?;
        let of = |key: &String| {
            key.strip_prefix(&prefix)
                .and_then(|k| k.strip_suffix(".json"))
                .map(str::to_owned)
        };
        let mut out = Vec::new();
        if months.len() > 2 {
            let wanted: Vec<String> = months.iter().map(|m| format!("{m:06}")).collect();
            let keys = self
                .listed(&prefix, LIST_PAGES * months.len(), deadline)
                .await?;
            out.extend(
                keys.iter()
                    .filter_map(of)
                    .filter(|p| wanted.iter().any(|m| p.starts_with(m))),
            );
        } else {
            for month in months {
                let keys = self
                    .listed(&format!("{prefix}{month:06}"), LIST_PAGES, deadline)
                    .await?;
                out.extend(keys.iter().filter_map(of));
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }
    /// Every published partition of one key, ascending, from one LIST of the key.
    pub async fn key_partitions(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        deadline: Instant,
    ) -> Result<Vec<String>, Error> {
        let prefix = Self::prefix(source, kind, key)?;
        let mut out: Vec<String> = self
            .listed(&prefix, LIST_PAGES, deadline)
            .await?
            .iter()
            .filter_map(|key| {
                key.strip_prefix(&prefix)
                    .and_then(|k| k.strip_suffix(".json"))
                    .map(str::to_owned)
            })
            .collect();
        out.sort();
        out.dedup();
        Ok(out)
    }
    /// Published partitions of every key of one kind by key hash, ascending, from one paged LIST.
    pub async fn kind_partitions(
        &self,
        source: &str,
        kind: &str,
        deadline: Instant,
    ) -> Result<HashMap<String, Vec<String>>, Error> {
        let prefix = format!("index/v2/{source}/{kind}/");
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        for key in self.listed(&prefix, KIND_LIST_PAGES, deadline).await? {
            if let Some((hash, partition)) = key
                .strip_prefix(&prefix)
                .and_then(|k| k.strip_suffix(".json"))
                .and_then(|k| k.split_once('/'))
            {
                out.entry(hash.to_owned())
                    .or_default()
                    .push(partition.to_owned());
            }
        }
        for partitions in out.values_mut() {
            partitions.sort();
        }
        Ok(out)
    }
    /// The hash a key's partitions are listed under.
    pub fn key_hash(key: &ProviderKey) -> Result<String, Error> {
        Ok(sha256(&key.canonical_bytes()?))
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
                raw_ids: records
                    .iter()
                    .map(|r| r.envelope.identity.object_key())
                    .collect::<Result<_, _>>()?,
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
/// Complete groups have already been validated. Fold each original raw body once
/// when a discovery and a RAM handoff both include that same full identity.
pub fn deduplicate(fetched: &mut Vec<Fetched>) {
    let mut seen = std::collections::HashSet::new();
    for acquisition in fetched.iter_mut() {
        if acquisition.raw_ids.len() != acquisition.pages.len() || acquisition.raw_ids.is_empty() {
            continue;
        }
        let mut ids = Vec::new();
        let mut pages = Vec::new();
        for (id, page) in acquisition
            .raw_ids
            .drain(..)
            .zip(acquisition.pages.drain(..))
        {
            if seen.insert(id.clone()) {
                ids.push(id);
                pages.push(page);
            }
        }
        acquisition.raw_ids = ids;
        acquisition.pages = pages;
    }
    fetched.retain(|f| !f.pages.is_empty());
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
    #[test]
    fn canonical_and_ram_fold_a_full_raw_identity_once() {
        let make = |id: &str| Fetched {
            fetched_at_ms: 1,
            partition: "20261025-1200".into(),
            pages: vec![Arc::from(&b"same body"[..])],
            raw_ids: vec![id.into()],
        };
        let mut copies = vec![
            make("kma/grid60/127/1200/1/hash"),
            make("kma/grid60/127/1200/1/hash"),
            make("kma/grid61/127/1200/1/hash"),
        ];
        deduplicate(&mut copies);
        assert_eq!(
            copies.len(),
            2,
            "same digest/time in another full RawId must remain distinct"
        );
    }
}
