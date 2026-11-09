//! S3 reads of the source: published catalogs only (an interrupted upload never counts), listed
//! per key and KST month and read through S06 `lookup`, every complete acquisition with its pages
//! in page order and its fetch instant.
use crate::history::IndexListing;
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, CatalogStore, Envelope, Error, LookupOutcome, PageOutcome,
    ProviderKey, RawRecord, ReadCursor, ReadOrder, sha256,
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
        let mut groups: BTreeMap<String, (u64, Envelope)> = BTreeMap::new();
        for e in catalog.entries {
            let group = match &e.fetch_group {
                Some(g) => g.descriptor_key()?,
                None => e.identity.raw_sha256.clone(),
            };
            let fetched = e.identity.fetched_at_ms;
            groups
                .entry(group)
                .and_modify(|(f, _)| *f = (*f).max(fetched))
                .or_insert((fetched, e));
        }
        Ok(groups
            .into_iter()
            .map(|(group, (fetched, e))| (fetched, group, e))
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
        self.restored(source, kind, key, partition, 1, deadline)
            .await
    }
    /// [`Self::acquisitions`] with up to `width` S3 reads in flight
    /// ([`CatalogStore::lookup_wide`]), for a read a request waits on.
    pub async fn acquisitions_wide(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        width: usize,
        deadline: Instant,
    ) -> Result<Vec<Fetched>, Error> {
        self.restored(source, kind, key, partition, width, deadline)
            .await
            .map(|(f, _)| f)
    }
    /// One catalog's complete acquisitions and excluded groups, restored with `width` S3 reads in
    /// flight (one: [`CatalogStore::lookup`]).
    async fn restored(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        width: usize,
        deadline: Instant,
    ) -> Result<(Vec<Fetched>, usize), Error> {
        let id = CatalogId {
            source: source.into(),
            kind: kind.into(),
            key_sha256: sha256(&key.canonical_bytes()?),
            partition: partition.into(),
        };
        id.validate()?;
        let looked = if width > 1 {
            self.store.lookup_wide(&id, width, deadline).await
        } else {
            self.store.lookup(&id, deadline).await
        };
        let set = match looked {
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
    /// [`Self::acquisitions_counted`] of the `i`-th partition of [`Self::available`].
    async fn indexed(
        &self,
        i: usize,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partition: &str,
        deadline: Instant,
    ) -> (usize, Result<(Vec<Fetched>, usize), Error>) {
        (
            i,
            self.acquisitions_counted(source, kind, key, partition, deadline)
                .await,
        )
    }
    /// [`Self::all_counted`] for a read a request waits on (KMA-RESTART-BOUND): a partition whose
    /// read fails because the store is slow, busy or unreachable ([`absent`]), or has not ended
    /// by `stop`, is left out and named in [`Partial::unread`], so the request treats it as absent
    /// instead of failing or waiting on. At most [`LOOKUPS`] lookups run at once. A defect (a
    /// corrupt or invalid object) is still an error.
    #[allow(clippy::too_many_arguments)] // One key's partitions plus the deadline and the stop.
    pub async fn available(
        &self,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partitions: &[String],
        deadline: Instant,
        stop: Instant,
    ) -> Result<Partial, Error> {
        use futures_util::StreamExt;
        let mut read = Partial::default();
        let mut ended = vec![false; partitions.len()];
        let mut defect = None;
        {
            let mut running = futures_util::stream::FuturesUnordered::new();
            let mut next = 0;
            let collect = async {
                loop {
                    while running.len() < LOOKUPS && next < partitions.len() {
                        running.push(self.indexed(
                            next,
                            source,
                            kind,
                            key,
                            &partitions[next],
                            deadline,
                        ));
                        next += 1;
                    }
                    let Some((i, r)) = running.next().await else {
                        return;
                    };
                    ended[i] = true;
                    match r {
                        Ok((f, e)) => {
                            read.fetched.extend(f);
                            read.excluded += e;
                        }
                        Err(e) if absent(&e) => read.unread.push(partitions[i].clone()),
                        Err(e) => {
                            defect = Some(e);
                            return;
                        }
                    }
                }
            };
            let _ = tokio::time::timeout_at(stop, collect).await;
        }
        if let Some(e) = defect {
            return Err(e);
        }
        read.unread.extend(
            partitions
                .iter()
                .zip(&ended)
                .filter(|(_, ended)| !**ended)
                .map(|(p, _)| p.clone()),
        );
        read.fetched.sort_by(|a, b| {
            a.fetched_at_ms
                .cmp(&b.fetched_at_ms)
                .then_with(|| a.partition.cmp(&b.partition))
        });
        Ok(read)
    }
}
/// A request's read of several partitions ([`Reader::available`]).
#[derive(Debug, Clone, Default)]
pub struct Partial {
    /// The acquisitions of the partitions read, ordered by fetch instant (stable by partition).
    pub fetched: Vec<Fetched>,
    /// Listed groups S06 excluded (S16 completeness).
    pub excluded: usize,
    /// Partitions whose read was [`absent`]: their acquisitions are absent for this request.
    pub unread: Vec<String>,
    /// Some partitions come from an earlier completed read ([`Restores`]), not this request's.
    pub earlier: bool,
}
impl Partial {
    /// Whether every listed group was read by this request (S16 records only from such a read).
    pub fn complete(&self) -> bool {
        self.excluded == 0 && self.unread.is_empty() && !self.earlier
    }
}
/// How long an owned listing runs at most.
const LIST_FOR: std::time::Duration = std::time::Duration::from_secs(8);
/// How long an owned partition read runs at most (over thirty partitions, eight at a time, each
/// up to the catalog's 3 s deadline).
const READ_FOR: std::time::Duration = std::time::Duration::from_secs(15);
/// An owned read ends its lookups this long before its owner deadline, so it answers.
const READ_MARGIN: std::time::Duration = std::time::Duration::from_millis(200);
/// The completed partition reads kept for a later request: bytes, entries and age.
const EARLIER_BYTES: usize = 64 * 1024 * 1024;
const EARLIER_ENTRIES: usize = 8192;
const EARLIER_AGE: std::time::Duration = std::time::Duration::from_secs(30 * 60);
/// KMA-RESTART-BOUND (review round 2): the stored restores a request of the observed source
/// waits for until its bound only. Each listing and partition read runs as owned work, one per
/// key, that outlives the request (joined by later requests, bounded by its own deadline), and
/// its completed result is kept: a request whose own read is not done by its bound answers from
/// the latest completed read of each partition (`Partial::earlier`) or leaves the partition
/// absent. Nothing is cancelled at a request's bound.
pub struct Restores {
    lists: crate::resolver::OwnedFlights<String, Result<Vec<String>, Error>>,
    reads: crate::resolver::OwnedFlights<String, Result<Partial, Error>>,
    earlier: Arc<std::sync::Mutex<Earlier>>,
}
#[derive(Default)]
struct Earlier {
    lists: HashMap<String, (std::time::Instant, Vec<String>)>,
    /// Per catalog: when read, its acquisitions and their bytes.
    reads: HashMap<String, (std::time::Instant, Vec<Fetched>, usize)>,
    bytes: usize,
}
impl Earlier {
    fn list(&mut self, key: String, partitions: Vec<String>) {
        if self.lists.len() >= EARLIER_ENTRIES && !self.lists.contains_key(&key) {
            self.lists.clear();
        }
        self.lists
            .insert(key, (std::time::Instant::now(), partitions));
    }
    fn read(&mut self, prefix: &str, wanted: &[String], read: &Partial) {
        let now = std::time::Instant::now();
        for partition in wanted.iter().filter(|p| !read.unread.contains(p)) {
            let fetched: Vec<Fetched> = read
                .fetched
                .iter()
                .filter(|f| f.partition == *partition)
                .cloned()
                .collect();
            let bytes = fetched
                .iter()
                .flat_map(|f| f.pages.iter())
                .map(|p| p.len())
                .sum();
            let key = format!("{prefix}{partition}");
            if let Some((_, _, old)) = self.reads.insert(key, (now, fetched, bytes)) {
                self.bytes -= old;
            }
            self.bytes += bytes;
        }
        while self.bytes > EARLIER_BYTES || self.reads.len() > EARLIER_ENTRIES {
            let Some(oldest) = self
                .reads
                .iter()
                .min_by_key(|(_, (at, _, _))| *at)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some((_, _, old)) = self.reads.remove(&oldest) {
                self.bytes -= old;
            }
        }
    }
}
impl Default for Restores {
    fn default() -> Self {
        let config = crate::resolver::OwnedConfig {
            running: 64,
            entries: 4096,
            retain: std::time::Duration::from_secs(3),
        };
        Self {
            lists: crate::resolver::OwnedFlights::new(config.clone())
                .expect("static owned restore bounds"),
            reads: crate::resolver::OwnedFlights::new(config).expect("static owned restore bounds"),
            earlier: Arc::default(),
        }
    }
}
impl Restores {
    /// [`Reader::partitions`] as owned work the request waits for until `stop`: None when it is
    /// not done by then (or the store is unavailable) and no earlier listing of the key is kept.
    #[allow(clippy::too_many_arguments)] // One key's months plus the reader and the stop.
    pub async fn partitions<T: IndexListing + Clone + Send + Sync + 'static>(
        &self,
        reader: &Reader<T>,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        months: &[u32],
        stop: Instant,
    ) -> Result<Option<Vec<String>>, Error> {
        let flight = format!("{}{months:?}", Reader::<T>::prefix(source, kind, key)?);
        let start = {
            let (reader, source, kind, key, months) = (
                reader.clone(),
                source.to_owned(),
                kind.to_owned(),
                key.clone(),
                months.to_vec(),
            );
            let (earlier, flight) = (self.earlier.clone(), flight.clone());
            move |deadline: Instant| async move {
                let listed = reader
                    .partitions(&source, &kind, &key, &months, deadline)
                    .await;
                if let Ok(partitions) = &listed {
                    earlier
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .list(flight, partitions.clone());
                }
                listed
            }
        };
        match self.lists.join(flight.clone(), stop, LIST_FOR, start).await {
            crate::resolver::Waited::Ready(Ok(partitions)) => return Ok(Some(partitions)),
            crate::resolver::Waited::Ready(Err(e)) if !absent(&e) => return Err(e),
            _ => {}
        }
        let earlier = self.earlier.lock().unwrap_or_else(|e| e.into_inner());
        Ok(earlier
            .lists
            .get(&flight)
            .filter(|(at, _)| at.elapsed() < EARLIER_AGE)
            .map(|(_, partitions)| partitions.clone()))
    }
    /// [`Reader::available`] as owned work the request waits for until `stop`. Partitions it has
    /// not read by then come from the latest completed read of each, when one is kept
    /// (`Partial::earlier`), and are unread otherwise.
    #[allow(clippy::too_many_arguments)] // One key's partitions plus the reader and the stop.
    pub async fn available<T: IndexListing + Clone + Send + Sync + 'static>(
        &self,
        reader: &Reader<T>,
        source: &str,
        kind: &str,
        key: &ProviderKey,
        partitions: &[String],
        stop: Instant,
    ) -> Result<Partial, Error> {
        let prefix = Reader::<T>::prefix(source, kind, key)?;
        let flight = format!("{prefix}{}", partitions.join(","));
        let start = {
            let (reader, source, kind, key, partitions) = (
                reader.clone(),
                source.to_owned(),
                kind.to_owned(),
                key.clone(),
                partitions.to_vec(),
            );
            let (earlier, prefix) = (self.earlier.clone(), prefix.clone());
            move |deadline: Instant| async move {
                let read = reader
                    .available(
                        &source,
                        &kind,
                        &key,
                        &partitions,
                        deadline,
                        deadline.checked_sub(READ_MARGIN).unwrap_or(deadline),
                    )
                    .await;
                if let Ok(read) = &read {
                    earlier.lock().unwrap_or_else(|e| e.into_inner()).read(
                        &prefix,
                        &partitions,
                        read,
                    );
                }
                read
            }
        };
        match self.reads.join(flight, stop, READ_FOR, start).await {
            crate::resolver::Waited::Ready(read) => read,
            _ => {
                let earlier = self.earlier.lock().unwrap_or_else(|e| e.into_inner());
                let mut read = Partial::default();
                for partition in partitions {
                    match earlier
                        .reads
                        .get(&format!("{prefix}{partition}"))
                        .filter(|(at, _, _)| at.elapsed() < EARLIER_AGE)
                    {
                        Some((_, fetched, _)) => {
                            read.fetched.extend(fetched.iter().cloned());
                            read.earlier = true;
                        }
                        None => read.unread.push(partition.clone()),
                    }
                }
                read.fetched.sort_by(|a, b| {
                    a.fetched_at_ms
                        .cmp(&b.fetched_at_ms)
                        .then_with(|| a.partition.cmp(&b.partition))
                });
                Ok(read)
            }
        }
    }
}
/// KMA-RESTART-BOUND: whether a failed read leaves what it reads absent for the request instead
/// of failing the answer. True when the store was slow, busy or unreachable: its deadline passed
/// (on EC2 after a restart, a catalog read on a saturated CPU passed the catalog's 3 s deadline),
/// an admission or connection failed, or it answered an error status. False for a defect in what
/// it holds (a corrupt or invalid object), which keeps failing the answer.
pub fn absent(e: &Error) -> bool {
    matches!(
        e,
        Error::Timeout | Error::Transport | Error::Capacity | Error::Status(_) | Error::Ambiguous
    )
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
    /// KMA-RESTART-BOUND: a slow, busy or unreachable store leaves the read absent; a defect in
    /// what it holds does not.
    #[test]
    fn only_an_unavailable_store_leaves_a_read_absent() {
        for e in [
            Error::Timeout,
            Error::Transport,
            Error::Capacity,
            Error::Status(503),
            Error::Ambiguous,
        ] {
            assert!(absent(&e), "{e:?}");
        }
        for e in [
            Error::Corrupt("catalog"),
            Error::Invalid("key"),
            Error::NotFound,
        ] {
            assert!(!absent(&e), "{e:?}");
        }
    }
}
