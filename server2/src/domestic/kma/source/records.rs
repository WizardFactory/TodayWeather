//! S3 reads of the source: published catalogs only (an interrupted upload never counts), listed
//! per key and KST month and read through S06 `lookup`, every complete acquisition with its pages
//! in page order and its fetch instant.
use crate::history::IndexListing;
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, CatalogStore, Envelope, Error, GroupDeclaration,
    LookupOutcome, PageOutcome, ProviderKey, RawRecord, ReadCursor, ReadOrder, sha256,
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
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
/// One fetch group a catalog lists, read from the catalog control object alone.
#[derive(Debug, Clone)]
pub struct ListedGroup {
    /// Its completion: the latest fetch instant of its members.
    pub completed: u64,
    /// The fetch group (its descriptor key; a lone record's raw hash).
    pub group: String,
    /// The member the catalog lists first, which names the group to [`Reader::members`].
    pub member: Envelope,
    /// Every member's raw hash, in page order ([`page_order`]).
    pub raw_sha256: Vec<String>,
    /// Every listed member, in page order (KMA-LIFE-DISTINCT): the first places the group in
    /// `lookup`'s order ([`lookup_order`]), and the members name its records.
    pub entries: Vec<Envelope>,
}
/// The order of one acquisition's pages: the page number (1 without pagination), then the fetch
/// instant and raw hash, which order a catalog's entries.
pub fn page_order(e: &Envelope) -> (u32, u64, &str) {
    (
        e.pagination.as_ref().map_or(1, |p| p.page),
        e.identity.fetched_at_ms,
        &e.identity.raw_sha256,
    )
}
/// The order S06 `lookup` returns a catalog's acquisitions in, by the identity of each one's first
/// record (S06 `identity_order`): fetch instant, raw hash, period, then the catalog's names.
fn lookup_order(e: &Envelope) -> (u64, &str, u32, &str, &str, &str, &str) {
    let id = &e.identity;
    (
        id.fetched_at_ms,
        &id.raw_sha256,
        id.period.local_date,
        &id.period.slot,
        &id.source,
        &id.kind,
        &id.key_sha256,
    )
}
/// One restored acquisition as [`Reader::acquisitions`] returns it: completed when its last page
/// arrived, its pages and raw ids in page order. None without records.
fn restored_fetched(records: &[RawRecord], partition: &str) -> Result<Option<Fetched>, Error> {
    let mut records: Vec<&RawRecord> = records.iter().collect();
    records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
    // An acquisition is complete when its last page arrived: that instant orders replays and
    // decides whether it existed at a request instant.
    let Some(completed) = records
        .iter()
        .map(|r| r.envelope.identity.fetched_at_ms)
        .max()
    else {
        return Ok(None);
    };
    Ok(Some(Fetched {
        fetched_at_ms: completed,
        partition: partition.into(),
        pages: records.iter().map(|r| r.bytes.clone()).collect(),
        raw_ids: records
            .iter()
            .map(|r| r.envelope.identity.object_key())
            .collect::<Result<_, _>>()?,
    }))
}
/// Whether the catalog lists every member of the group, so that its raw hashes in page order are
/// its whole content (a lone record is its only member).
fn whole(g: &ListedGroup) -> bool {
    let members = g.entries[0]
        .fetch_group
        .as_ref()
        .map_or(1, |r| r.members as usize);
    g.entries.len() == members
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
/// The catalog of one key and partition.
pub fn catalog(
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
    /// The acquisitions one catalog lists: (completion instant, fetch group, a member envelope),
    /// from the catalog control object alone (no descriptor or record body is read); empty when
    /// the catalog does not exist. One acquisition per fetch group; its completion is its
    /// members' latest fetch instant.
    pub async fn listed_acquisitions(
        &self,
        id: &CatalogId,
        deadline: Instant,
    ) -> Result<Vec<(u64, String, Envelope)>, Error> {
        Ok(self
            .listed_groups(id, deadline)
            .await?
            .into_iter()
            .map(|g| (g.completed, g.group, g.member))
            .collect())
    }
    /// [`Self::listed_acquisitions`] with every member's raw hash of each group, in page order
    /// (KMA-ZONE-NEWEST: an order key from the catalog alone). Groups in fetch-group order.
    pub async fn listed_groups(
        &self,
        id: &CatalogId,
        deadline: Instant,
    ) -> Result<Vec<ListedGroup>, Error> {
        let limits = CatalogLimits::default();
        let object = match tokio::time::timeout_at(
            deadline,
            self.transport.get_control(&id.key(), limits.control_bytes),
        )
        .await
        {
            Err(_) => return Err(Error::Timeout),
            Ok(Err(Error::NotFound)) => return Ok(Vec::new()),
            Ok(Err(e)) => return Err(e),
            Ok(Ok(object)) => object,
        };
        let catalog = Catalog::from_bytes(&object.body, id, &limits)?;
        let mut groups: BTreeMap<String, Vec<Envelope>> = BTreeMap::new();
        for e in catalog.entries {
            let group = match &e.fetch_group {
                Some(g) => g.descriptor_key()?,
                None => e.identity.raw_sha256.clone(),
            };
            groups.entry(group).or_default().push(e);
        }
        Ok(groups
            .into_iter()
            .map(|(group, entries)| {
                let completed = entries
                    .iter()
                    .map(|e| e.identity.fetched_at_ms)
                    .max()
                    .unwrap_or_default();
                let member = entries[0].clone();
                let mut paged = entries;
                paged.sort_by(|a, b| page_order(a).cmp(&page_order(b)));
                let raw_sha256 = paged
                    .iter()
                    .map(|e| e.identity.raw_sha256.clone())
                    .collect();
                ListedGroup {
                    completed,
                    group,
                    member,
                    raw_sha256,
                    entries: paged,
                }
            })
            .collect())
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
        let id = catalog(source, kind, key, partition)?;
        let set = match self.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => set,
            Ok(LookupOutcome::Incomplete) => return Err(Error::Corrupt("incomplete catalog")),
            Err(Error::NotFound) => return Ok((Vec::new(), 0)),
            Err(e) => return Err(e),
        };
        let mut out = Vec::new();
        for a in set.acquisitions() {
            out.extend(restored_fetched(a.records(), partition)?);
        }
        Ok((out, set.excluded_groups()))
    }
    /// KMA-LIFE-DISTINCT D1, for the life read only: one catalog's complete acquisitions and
    /// excluded groups as [`Self::acquisitions_counted`] returns them, each distinct content
    /// restored once. One read of the catalog control object lists the groups; a group's content is
    /// its members' raw hashes in page order (the catalog lists every member). The groups of one
    /// content are restored in `lookup`'s order with its per-group rules ([`Self::members`]) until
    /// one restores: a group S06 excludes (descriptor or a member's body missing, not eligible) is
    /// counted and the next is tried, and an error ends the read. Every later group of that content
    /// is returned with the restored group's pages, at its own completion and place in `lookup`'s
    /// order, without reading its own descriptor or bodies (so it is applied even when they are
    /// lost). No catalog, or no restored group: `lookup`'s incomplete catalog, as before.
    pub async fn distinct(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<(Vec<Fetched>, usize), Error> {
        let id = catalog(source, kind, key, partition)?;
        // An absent catalog lists no group: the incomplete catalog below, as `lookup`'s.
        let mut groups = self.listed_groups(&id, deadline).await?;
        groups.sort_by(|a, b| lookup_order(&a.entries[0]).cmp(&lookup_order(&b.entries[0])));
        // The pages each restored content is read from.
        let mut read: HashMap<String, Vec<Arc<[u8]>>> = HashMap::new();
        let mut out: Vec<(Envelope, Fetched)> = Vec::new();
        let mut excluded = 0;
        for g in &groups {
            let content = whole(g).then(|| super::pages_digest(&g.raw_sha256));
            if let Some(pages) = content.as_ref().and_then(|c| read.get(c)) {
                out.push((
                    g.entries[0].clone(),
                    Fetched {
                        fetched_at_ms: g.completed,
                        partition: partition.into(),
                        pages: pages.clone(),
                        raw_ids: g
                            .entries
                            .iter()
                            .map(|e| e.identity.object_key())
                            .collect::<Result<_, _>>()?,
                    },
                ));
                continue;
            }
            let restored = match self
                .members(&id, std::slice::from_ref(&g.member.identity), deadline)
                .await
            {
                Ok(Some(acquisitions)) => acquisitions,
                Ok(None) => {
                    excluded += 1;
                    continue;
                }
                // As `lookup`'s missing lone record in `acquisitions_counted`.
                Err(Error::NotFound) => return Ok((Vec::new(), 0)),
                Err(e) => return Err(e),
            };
            for records in restored {
                let Some(fetched) = restored_fetched(&records, partition)? else {
                    continue;
                };
                // The content is read from this group only when its pages are the listed ones.
                let mut paged: Vec<&Envelope> = records.iter().map(|r| &r.envelope).collect();
                paged.sort_by(|a, b| page_order(a).cmp(&page_order(b)));
                if let Some(c) = &content
                    && paged
                        .iter()
                        .map(|e| &e.identity.raw_sha256)
                        .eq(g.raw_sha256.iter())
                {
                    read.insert(c.clone(), fetched.pages.clone());
                }
                out.push((records[0].envelope.clone(), fetched));
            }
        }
        if out.is_empty() {
            return Err(Error::Corrupt("incomplete catalog"));
        }
        out.sort_by(|a, b| lookup_order(&a.0).cmp(&lookup_order(&b.0)));
        Ok((out.into_iter().map(|(_, f)| f).collect(), excluded))
    }
    /// [`Self::distinct`] of many partitions of one key, at most [`LOOKUPS`] at a time, ordered as
    /// [`Self::all`] orders its acquisitions (by completion, stable by partition).
    pub async fn all_distinct(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partitions: &[String],
        deadline: Instant,
    ) -> Result<Vec<Fetched>, Error> {
        let mut out = Vec::new();
        for chunk in partitions.chunks(LOOKUPS) {
            let reads = crate::history::join_all(
                chunk
                    .iter()
                    .map(|p| self.distinct(source, kind, key, p, deadline))
                    .collect(),
            )
            .await;
            for r in reads {
                out.extend(r?.0);
            }
        }
        out.sort_by(|a, b| {
            a.fetched_at_ms
                .cmp(&b.fetched_at_ms)
                .then_with(|| a.partition.cmp(&b.partition))
        });
        Ok(out)
    }
    /// KMA-LIFE-DISTINCT D2: the stored group of `declaration`'s catalog that holds the same content
    /// as the acquisition it declares (its members' raw hashes in page order) and restores
    /// completely, as [`Self::distinct`] restores (groups of that content in `lookup`'s order, S06
    /// exclusions tried past): its (partition, completion). None when no such group restores or the
    /// declaration names more than one catalog.
    pub async fn stored_twin(
        &self,
        declaration: &GroupDeclaration,
        deadline: Instant,
    ) -> Result<Option<(String, u64)>, Error> {
        let [id] = declaration.partitions.as_slice() else {
            return Ok(None);
        };
        let mut members: Vec<&Envelope> = declaration.members.iter().map(|m| &m.envelope).collect();
        members.sort_by(|a, b| page_order(a).cmp(&page_order(b)));
        let content: Vec<&str> = members
            .iter()
            .map(|e| e.identity.raw_sha256.as_str())
            .collect();
        let mut twins: Vec<ListedGroup> = self
            .listed_groups(id, deadline)
            .await?
            .into_iter()
            .filter(|g| {
                g.raw_sha256
                    .iter()
                    .map(String::as_str)
                    .eq(content.iter().copied())
            })
            .collect();
        twins.sort_by(|a, b| lookup_order(&a.entries[0]).cmp(&lookup_order(&b.entries[0])));
        for g in twins {
            let Some(restored) = self
                .members(id, std::slice::from_ref(&g.member.identity), deadline)
                .await?
            else {
                continue;
            };
            for mut records in restored {
                records.sort_by(|a, b| page_order(&a.envelope).cmp(&page_order(&b.envelope)));
                let pages = records
                    .iter()
                    .map(|r| r.envelope.identity.raw_sha256.as_str());
                if let Some(completed) = records
                    .iter()
                    .map(|r| r.envelope.identity.fetched_at_ms)
                    .max()
                    && pages.eq(content.iter().copied())
                {
                    return Ok(Some((id.partition.clone(), completed)));
                }
            }
        }
        Ok(None)
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
    /// [`Self::raw`] and a listed member of each group S06 excluded (S16 completeness).
    pub async fn raw_excluded(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> Result<(Vec<Vec<RawRecord>>, Vec<crate::storage::RecordId>), Error> {
        let id = catalog(source, kind, key, partition)?;
        match self.store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => Ok((
                set.acquisitions()
                    .iter()
                    .map(|a| ordered(a.records()))
                    .collect(),
                set.excluded_members().to_vec(),
            )),
            Ok(LookupOutcome::Incomplete) => Err(Error::Corrupt("incomplete catalog")),
            Err(Error::NotFound) => Ok((Vec::new(), Vec::new())),
            Err(e) => Err(e),
        }
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
    /// The acquisitions of the named members of one catalog as raw records in member order (pages
    /// in page order): one catalog read and the named groups only. None when a member is not
    /// listed or its group is not complete.
    pub async fn members(
        &self,
        id: &CatalogId,
        members: &[crate::storage::RecordId],
        deadline: Instant,
    ) -> Result<Option<Vec<Vec<RawRecord>>>, Error> {
        match self.store.lookup_members(id, members, deadline).await? {
            PageOutcome::Ready(found) => Ok(Some(
                found
                    .acquisitions()
                    .iter()
                    .map(|a| ordered(a.records()))
                    .collect(),
            )),
            PageOutcome::Incomplete => Ok(None),
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
