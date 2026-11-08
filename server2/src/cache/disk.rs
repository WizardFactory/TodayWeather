//! Disposable, bounded cache of already verified immutable weather raw S3 objects.
//! Catalogs, absence, credentials, geocode and push state are never cached here.
use crate::storage::{Error, Object, RecordId, sha256};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::UNIX_EPOCH,
};
use tokio::time::Instant;

const MAGIC: &[u8; 8] = b"TWCACHE1";
const HEADER: usize = 16 * 1024;
const MAX_BODY: usize = 65 * 1024 * 1024;
/// Loads queued at once on the cache thread; each waits only for the loads ahead of it.
const LOADS: usize = 8;
/// Disk fills and removals pending at once (reserved, queued or running); more are dropped.
const WRITES: usize = 2;
const ENTRY_LIMIT: usize = 131_072;
pub const DEFAULT_MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// A cache is configured explicitly; construction performs no filesystem I/O.
/// The namespace must identify the S3 endpoint, bucket, region and cache schema.
///
/// Its loads and writes run on its own thread, started with the first of them, never on the
/// blocking pool (KMA-RESTART-CPU DISK-CACHE). Loads go first; a load that arrives while a write
/// runs misses (the caller reads S3) instead of waiting for it, and a fill or removal that finds
/// `WRITES` pending is dropped and counted. Request work never waits on a disk write.
pub struct DiskCache {
    directory: PathBuf,
    maximum: u64,
    entries: usize,
    state: Mutex<State>,
    worker: Arc<Worker>,
    counters: Counters,
    #[cfg(test)]
    fail_write: std::sync::atomic::AtomicBool,
    /// Test seam: the next write signals once it holds the cache, then waits for release.
    #[cfg(test)]
    hold_write: Mutex<Option<HeldWrite>>,
}
#[cfg(test)]
type HeldWrite = (
    tokio::sync::oneshot::Sender<()>,
    std::sync::mpsc::Receiver<()>,
);
/// The queues of a cache's thread; the thread holds only a weak reference to its cache.
#[derive(Default)]
struct Worker {
    queue: Mutex<Queue>,
    ready: Condvar,
    done: tokio::sync::Notify,
}
#[derive(Default)]
struct Queue {
    loads: VecDeque<Load>,
    writes: VecDeque<WriteJob>,
    /// Write slots taken by [`DiskCache::writer`] and not yet enqueued.
    reserved: usize,
    running: Option<Running>,
    started: bool,
    closed: bool,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Running {
    Load,
    Write,
}
struct Load {
    key: String,
    maximum: usize,
    reply: tokio::sync::oneshot::Sender<io::Result<Option<Object>>>,
}
enum WriteJob {
    Fill { key: String, object: Object },
    Remove { key: String },
}
enum Job {
    Load(Load),
    Write(WriteJob),
}
impl Queue {
    fn writes_pending(&self) -> usize {
        self.reserved + self.writes.len() + usize::from(self.running == Some(Running::Write))
    }
    fn idle(&self) -> bool {
        self.loads.is_empty()
            && self.writes.is_empty()
            && self.reserved == 0
            && self.running.is_none()
    }
    /// Close for good: queued loads see their reply dropped (a miss).
    fn close(&mut self) {
        self.closed = true;
        self.loads.clear();
        self.writes.clear();
    }
}
impl Worker {
    fn lock(&self) -> std::sync::MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(|p| p.into_inner())
    }
    /// The cache thread: one job at a time, loads before writes, until the cache is dropped.
    fn run(&self, cache: &Weak<DiskCache>) {
        /// Whatever ends the thread closes the queues, so no load waits for it.
        struct Closer<'a>(&'a Worker);
        impl Drop for Closer<'_> {
            fn drop(&mut self) {
                let mut q = self.0.lock();
                q.close();
                q.running = None;
                drop(q);
                self.0.done.notify_waiters();
            }
        }
        let _closer = Closer(self);
        loop {
            let job = {
                let mut q = self.lock();
                loop {
                    if q.closed {
                        return;
                    }
                    if let Some(load) = q.loads.pop_front() {
                        q.running = Some(Running::Load);
                        break Job::Load(load);
                    }
                    if let Some(write) = q.writes.pop_front() {
                        q.running = Some(Running::Write);
                        break Job::Write(write);
                    }
                    q = self.ready.wait(q).unwrap_or_else(|p| p.into_inner());
                }
            };
            let Some(cache) = cache.upgrade() else {
                return;
            };
            let fill = matches!(job, Job::Write(WriteJob::Fill { .. }));
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match job {
                Job::Load(Load {
                    key,
                    maximum,
                    reply,
                }) => {
                    let _ = reply.send(cache.load_file(&key, maximum));
                }
                Job::Write(WriteJob::Fill { key, object }) => {
                    if cache.write_file(&key, object).is_err() {
                        cache.counters.errors.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Job::Write(WriteJob::Remove { key }) => {
                    let mut s = cache.state.lock().unwrap_or_else(|p| p.into_inner());
                    cache.remove(&mut s, &sha256(key.as_bytes()));
                    cache.counters.corrupt.fetch_add(1, Ordering::Relaxed);
                }
            }));
            if ran.is_err() {
                cache.counters.errors.fetch_add(1, Ordering::Relaxed);
            }
            if fill {
                cache.counters.pending.fetch_sub(1, Ordering::SeqCst);
            }
            // Release the cache before signalling idle: a caller that then drops it frees its
            // owner lock at once.
            drop(cache);
            self.lock().running = None;
            self.done.notify_waiters();
        }
    }
}
#[derive(Default)]
struct State {
    owner: Option<File>,
    files: HashMap<String, Entry>,
    bytes: u64,
    clock: u64,
    unit: u64,
}
struct Entry {
    bytes: u64,
    last: u64,
}
#[derive(Default)]
struct Counters {
    hits: AtomicU64,
    misses: AtomicU64,
    writes: AtomicU64,
    errors: AtomicU64,
    corrupt: AtomicU64,
    evictions: AtomicU64,
    bytes: AtomicU64,
    peak: AtomicU64,
    root_bytes: AtomicU64,
    root_peak: AtomicU64,
    entries: AtomicUsize,
    pending: AtomicUsize,
    dropped: AtomicU64,
}
/// Sanitized counts only: no raw key, path, endpoint or coordinate labels.
#[derive(Clone, Debug, Serialize)]
pub struct Metrics {
    pub hits: u64,
    pub misses: u64,
    pub writes: u64,
    pub errors: u64,
    pub corruptions: u64,
    pub evictions: u64,
    pub bytes: u64,
    pub peak_bytes: u64,
    pub root_observed_bytes: u64,
    pub peak_root_reserved_bytes: u64,
    pub entries: usize,
    pub pending_writes: usize,
    pub dropped_writes: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    key: String,
    metadata: BTreeMap<String, String>,
    length: usize,
}
fn failed() -> io::Error {
    io::Error::other("disposable cache unavailable")
}
/// Provider raw records; the products processes make from them (the AirKorea hourly forecast,
/// the KMA station page products) are read from S3.
fn eligible(id: &RecordId) -> bool {
    id.validate().is_ok()
        && (matches!(id.source.as_str(), "data-go-kr" | "vc")
            || (id.source == "kma-web"
                && id.kind != crate::domestic::kma::source::observe_product::KIND)
            || (id.source == "airkorea-image" && id.kind == "airkorea-forecast-image"))
}
fn token(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn allocated(m: &fs::Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        m.blocks().saturating_mul(512).max(m.len())
    }
    #[cfg(not(unix))]
    {
        m.len()
    }
}
fn directory(path: &Path) -> io::Result<()> {
    if !path.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path)?;
    }
    let m = fs::symlink_metadata(path)?;
    if !m.is_dir() || m.file_type().is_symlink() {
        return Err(failed());
    }
    Ok(())
}
fn private_file(path: &Path, exclusive: bool) -> io::Result<File> {
    if let Ok(m) = fs::symlink_metadata(path)
        && (!m.is_file() || m.file_type().is_symlink())
    {
        return Err(failed());
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if exclusive {
        options.create_new(true);
    } else {
        options.create(true).truncate(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Count managed raw/temporary allocation across every cache namespace under this
/// dedicated root. Never descend into arbitrary directories or follow symlinks.
fn root_usage(root: &Path) -> io::Result<u64> {
    let mut bytes = 0u64;
    let mut walked = 0usize;
    for namespace in fs::read_dir(root)? {
        let namespace = namespace?;
        let name = namespace.file_name();
        if !name.to_str().is_some_and(token) {
            continue;
        }
        let meta = fs::symlink_metadata(namespace.path())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            continue;
        }
        for entry in fs::read_dir(namespace.path())? {
            walked += 1;
            if walked > 1_000_000 {
                return Err(failed());
            }
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !managed(name) {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path())?;
            if meta.is_file() && !meta.file_type().is_symlink() {
                bytes = bytes.checked_add(allocated(&meta)).ok_or_else(failed)?;
            }
        }
    }
    Ok(bytes)
}
fn managed(name: &str) -> bool {
    name.strip_suffix(".raw").is_some_and(token)
        || name
            .strip_prefix(".tmp-")
            .and_then(|v| v.split('-').next())
            .is_some_and(token)
}
fn capacity_lock(root: &Path) -> io::Result<File> {
    let lock = private_file(&root.join(".capacity"), false)?;
    lock.try_lock().map_err(|_| failed())?;
    Ok(lock)
}

impl DiskCache {
    pub fn new(
        root: impl AsRef<Path>,
        namespace: &str,
        maximum_bytes: u64,
        maximum_entries: usize,
    ) -> Result<Self, Error> {
        if root.as_ref().as_os_str().is_empty()
            || namespace.is_empty()
            || namespace.len() > 4096
            || !(4096..=1024 * 1024 * 1024 * 1024).contains(&maximum_bytes)
            || maximum_entries == 0
            || maximum_entries > ENTRY_LIMIT
        {
            return Err(Error::Invalid("local cache configuration"));
        }
        Ok(Self {
            directory: root.as_ref().join(sha256(namespace.as_bytes())),
            maximum: maximum_bytes,
            entries: maximum_entries,
            state: Mutex::new(State::default()),
            worker: Arc::default(),
            counters: Counters::default(),
            #[cfg(test)]
            fail_write: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            hold_write: Mutex::new(None),
        })
    }
    pub fn metrics(&self) -> Metrics {
        let c = &self.counters;
        Metrics {
            hits: c.hits.load(Ordering::Relaxed),
            misses: c.misses.load(Ordering::Relaxed),
            writes: c.writes.load(Ordering::Relaxed),
            errors: c.errors.load(Ordering::Relaxed),
            corruptions: c.corrupt.load(Ordering::Relaxed),
            evictions: c.evictions.load(Ordering::Relaxed),
            bytes: c.bytes.load(Ordering::Relaxed),
            peak_bytes: c.peak.load(Ordering::Relaxed),
            root_observed_bytes: c.root_bytes.load(Ordering::Relaxed),
            peak_root_reserved_bytes: c.root_peak.load(Ordering::Relaxed),
            entries: c.entries.load(Ordering::Relaxed),
            pending_writes: c.pending.load(Ordering::Relaxed),
            dropped_writes: c.dropped.load(Ordering::Relaxed),
        }
    }
    /// Observe completion of owned local work (nothing reserved, queued or running); this is
    /// not an S3 durability acknowledgment.
    pub async fn idle(&self, deadline: Instant) -> bool {
        loop {
            let done = self.worker.done.notified();
            tokio::pin!(done);
            done.as_mut().enable();
            if self.worker.lock().idle() {
                return true;
            }
            if tokio::time::timeout_at(deadline, done).await.is_err() {
                return false;
            }
        }
    }
    /// Start the cache thread with the first job; false when it cannot run (closed).
    fn started(self: &Arc<Self>, q: &mut Queue) -> bool {
        if q.closed {
            return false;
        }
        if !q.started {
            let worker = self.worker.clone();
            let cache = Arc::downgrade(self);
            let spawned = std::thread::Builder::new()
                .name("disk-cache".into())
                .spawn(move || worker.run(&cache));
            if spawned.is_err() {
                q.close();
                return false;
            }
            q.started = true;
        }
        true
    }
    fn charge(&self, state: &State, temp: u64) {
        let bytes = state.bytes.saturating_add(temp);
        self.counters.bytes.store(bytes, Ordering::Relaxed);
        self.counters.peak.fetch_max(bytes, Ordering::Relaxed);
        self.counters
            .entries
            .store(state.files.len(), Ordering::Relaxed);
    }
    fn remove(&self, s: &mut State, name: &str) {
        if let Some(e) = s.files.remove(name) {
            let p = self.directory.join(format!("{name}.raw"));
            match fs::remove_file(&p) {
                Ok(()) => s.bytes = s.bytes.saturating_sub(e.bytes),
                Err(e2) if e2.kind() == io::ErrorKind::NotFound => {
                    s.bytes = s.bytes.saturating_sub(e.bytes)
                }
                Err(_) => {
                    s.files.insert(name.to_owned(), e);
                    return;
                }
            }
        }
        self.charge(s, 0);
    }
    fn evict(&self, s: &mut State, reserve: u64, adding: bool) -> io::Result<()> {
        while s.bytes.saturating_add(reserve) > self.maximum
            || (adding && s.files.len() >= self.entries)
        {
            let name = s
                .files
                .iter()
                .min_by_key(|(_, e)| e.last)
                .map(|(n, _)| n.clone())
                .ok_or_else(failed)?;
            let before = s.files.len();
            self.remove(s, &name);
            if before == s.files.len() {
                return Err(failed());
            }
            self.counters.evictions.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }
    fn open(&self, s: &mut State) -> io::Result<()> {
        if s.owner.is_some() {
            return Ok(());
        }
        let result = self.initialize(s);
        if result.is_err() {
            *s = State::default();
            self.charge(s, 0);
        }
        result
    }
    fn initialize(&self, s: &mut State) -> io::Result<()> {
        let root = self.directory.parent().ok_or_else(failed)?;
        directory(root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if fs::metadata(root)?.permissions().mode() & 0o077 != 0 {
                return Err(failed());
            }
        }
        let _capacity = capacity_lock(root)?;
        directory(&self.directory)?;
        let owner = private_file(&self.directory.join(".owner"), false)?;
        owner.try_lock().map_err(|_| failed())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            s.unit = fs::metadata(&self.directory)?.blksize().max(4096);
        }
        #[cfg(not(unix))]
        {
            s.unit = 4096;
        }
        s.owner = Some(owner);
        for (walk, e) in fs::read_dir(&self.directory)?.enumerate() {
            if walk > 1_000_000 {
                return Err(failed());
            }
            let e = e?;
            let name = e.file_name();
            let Some(name) = name.to_str() else { continue };
            let m = fs::symlink_metadata(e.path())?;
            if !m.is_file() || m.file_type().is_symlink() {
                continue;
            }
            if let Some(hash) = name.strip_suffix(".raw")
                && token(hash)
            {
                let bytes = allocated(&m);
                let last = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |t| t.as_secs());
                s.clock = s.clock.max(last);
                s.bytes = s.bytes.saturating_add(bytes);
                s.files.insert(hash.into(), Entry { bytes, last });
                self.evict(s, 0, false)?;
                while s.files.len() > self.entries {
                    self.evict(s, 0, true)?;
                }
            } else if name.starts_with(".tmp-")
                && name
                    .strip_prefix(".tmp-")
                    .and_then(|v| v.split('-').next())
                    .is_some_and(token)
            {
                fs::remove_file(e.path())?;
            }
        }
        self.charge(s, 0);
        Ok(())
    }
    fn load_file(&self, key: &str, maximum: usize) -> io::Result<Option<Object>> {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        self.open(&mut s)?;
        let name = sha256(key.as_bytes());
        let path = self.directory.join(format!("{name}.raw"));
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                self.remove(&mut s, &name);
                return Ok(None);
            }
            Err(e) => return Err(e),
        };
        let result = (|| {
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() > (52 + HEADER + maximum.min(MAX_BODY)) as u64
            {
                return Err(failed());
            }
            let mut file = File::open(&path)?;
            let mut prefix = [0u8; 52];
            file.read_exact(&mut prefix)?;
            if &prefix[..8] != MAGIC {
                return Err(failed());
            }
            let hn = u32::from_le_bytes(prefix[8..12].try_into().unwrap()) as usize;
            let bn = u64::from_le_bytes(prefix[12..20].try_into().unwrap());
            if hn > HEADER || bn > maximum.min(MAX_BODY) as u64 || meta.len() != 52 + hn as u64 + bn
            {
                return Err(failed());
            }
            let mut header = vec![0; hn];
            let mut body = vec![0; bn as usize];
            file.read_exact(&mut header)?;
            file.read_exact(&mut body)?;
            let mut checksum = Sha256::new();
            checksum.update(&header);
            checksum.update(&body);
            if checksum.finalize()[..] != prefix[20..52] {
                return Err(failed());
            }
            let h: Header = serde_json::from_slice(&header).map_err(|_| failed())?;
            if h.key != key || h.length != body.len() {
                return Err(failed());
            }
            Ok(Object {
                metadata: h.metadata,
                length: h.length,
                body,
            })
        })();
        match result {
            Ok(object) => {
                s.clock = s.clock.saturating_add(1);
                let last = s.clock;
                if let Some(e) = s.files.get_mut(&name) {
                    e.last = last
                }
                self.counters.hits.fetch_add(1, Ordering::Relaxed);
                Ok(Some(object))
            }
            Err(_) => {
                self.counters.corrupt.fetch_add(1, Ordering::Relaxed);
                self.remove(&mut s, &name);
                Ok(None)
            }
        }
    }
    pub(crate) async fn load(self: &Arc<Self>, id: &RecordId, maximum: usize) -> Option<Object> {
        crate::observability::work(
            crate::observability::Component::Cache,
            crate::observability::Stage::Lookup,
            async {
                if !eligible(id) {
                    return None;
                }
                let Ok(key) = id.object_key() else {
                    return None;
                };
                let (reply, found) = tokio::sync::oneshot::channel();
                {
                    let mut q = self.worker.lock();
                    // A load waits only for the loads ahead of it: while a write runs, or with
                    // the load queue full, it misses and the caller reads S3.
                    if q.running == Some(Running::Write)
                        || q.loads.len() >= LOADS
                        || !self.started(&mut q)
                    {
                        drop(q);
                        self.counters.misses.fetch_add(1, Ordering::Relaxed);
                        return None;
                    }
                    q.loads.push_back(Load {
                        key,
                        maximum,
                        reply,
                    });
                }
                self.worker.ready.notify_one();
                match found.await {
                    Ok(Ok(Some(o))) => Some(o),
                    Ok(Ok(None)) => {
                        self.counters.misses.fetch_add(1, Ordering::Relaxed);
                        None
                    }
                    _ => {
                        crate::observability::event(
                            crate::observability::Component::Cache,
                            crate::observability::Stage::Lookup,
                            crate::observability::Cause::Dependency,
                            crate::observability::Action::Fallback,
                            crate::observability::Outcome::Failed,
                            Default::default(),
                        );
                        self.counters.errors.fetch_add(1, Ordering::Relaxed);
                        self.counters.misses.fetch_add(1, Ordering::Relaxed);
                        None
                    }
                }
            },
        )
        .await
    }
    /// Remove a cached object that failed verification, on the cache thread (not awaited;
    /// dropped and counted when `WRITES` are pending).
    pub(crate) fn invalidate(self: &Arc<Self>, id: &RecordId) {
        let Ok(key) = id.object_key() else { return };
        let mut q = self.worker.lock();
        if q.writes_pending() >= WRITES || !self.started(&mut q) {
            drop(q);
            self.counters.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        q.writes.push_back(WriteJob::Remove { key });
        drop(q);
        self.worker.ready.notify_one();
    }
    /// Reserve a disk fill before the caller copies the object; none (dropped and counted)
    /// when `WRITES` are pending. Reserving never touches the disk or starts the thread.
    pub(crate) fn writer(self: &Arc<Self>, id: &RecordId) -> Option<Writer> {
        if !eligible(id) {
            return None;
        }
        let key = id.object_key().ok()?;
        let mut q = self.worker.lock();
        if q.closed || q.writes_pending() >= WRITES {
            drop(q);
            self.counters.dropped.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        q.reserved += 1;
        Some(Writer {
            cache: self.clone(),
            key: Some(key),
        })
    }
    fn write_file(&self, key: &str, object: Object) -> io::Result<()> {
        if object.length != object.body.len() || object.body.len() > MAX_BODY {
            return Err(failed());
        }
        let header = serde_json::to_vec(&Header {
            key: key.into(),
            metadata: object.metadata,
            length: object.length,
        })
        .map_err(|_| failed())?;
        if header.len() > HEADER {
            return Err(failed());
        }
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        #[cfg(test)]
        if let Some((reached, release)) = self.hold_write.lock().unwrap().take() {
            let _ = reached.send(());
            let _ = release.recv();
        }
        self.open(&mut s)?;
        let size = 52 + header.len() as u64 + object.body.len() as u64;
        let unit = s.unit.max(4096);
        let reserve = size.div_ceil(unit) * unit;
        if reserve > self.maximum {
            return Ok(());
        }
        let name = sha256(key.as_bytes());
        let root = self.directory.parent().ok_or_else(failed)?;
        let _capacity = capacity_lock(root)?;
        self.remove(&mut s, &name);
        self.evict(&mut s, reserve, true)?;
        // The root lock covers admission, temporary allocation, rename and cleanup
        // across processes and namespaces. Old namespaces are neither reused nor deleted.
        let mut total = root_usage(root)?;
        self.counters.root_bytes.store(total, Ordering::Relaxed);
        while total.saturating_add(reserve) > self.maximum {
            let Some(oldest) = s
                .files
                .iter()
                .min_by_key(|(_, e)| e.last)
                .map(|(n, _)| n.clone())
            else {
                return Ok(()); // Other namespaces consume the cap: safely skip disk fill.
            };
            let before = s.files.len();
            self.remove(&mut s, &oldest);
            if before == s.files.len() {
                return Err(failed());
            }
            self.counters.evictions.fetch_add(1, Ordering::Relaxed);
            total = root_usage(root)?;
        }
        self.counters
            .root_peak
            .fetch_max(total.saturating_add(reserve), Ordering::Relaxed);
        self.charge(&s, reserve);
        let suffix = self.counters.writes.load(Ordering::Relaxed);
        let temporary = self
            .directory
            .join(format!(".tmp-{name}-{}-{suffix}", std::process::id()));
        let final_path = self.directory.join(format!("{name}.raw"));
        let result = (|| {
            let mut file = private_file(&temporary, true)?;
            #[cfg(test)]
            if self.fail_write.swap(false, Ordering::SeqCst) {
                return Err(io::Error::from_raw_os_error(28));
            }
            let mut checksum = Sha256::new();
            checksum.update(&header);
            checksum.update(&object.body);
            let digest = checksum.finalize();
            file.write_all(MAGIC)?;
            file.write_all(&(header.len() as u32).to_le_bytes())?;
            file.write_all(&(object.body.len() as u64).to_le_bytes())?;
            file.write_all(&digest)?;
            file.write_all(&header)?;
            file.write_all(&object.body)?;
            file.flush()?;
            let bytes = allocated(&file.metadata()?);
            if bytes > reserve {
                return Err(failed());
            }
            fs::rename(&temporary, &final_path)?;
            s.clock = s.clock.saturating_add(1);
            let last = s.clock;
            s.files.insert(name, Entry { bytes, last });
            s.bytes = s.bytes.saturating_add(bytes);
            self.counters.writes.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })();
        if result.is_err() {
            match fs::remove_file(&temporary) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                // Never free the reservation of an undeletable temporary. The remaining
                // namespace capacity is reduced until restart can clean up the orphan.
                Err(_) => s.bytes = s.bytes.saturating_add(reserve),
            }
        }
        self.charge(&s, 0);
        if let Ok(total) = root_usage(root) {
            self.counters.root_bytes.store(total, Ordering::Relaxed);
        }
        result
    }
}
/// A reserved disk fill: the caller makes the optional object copy only after reserving.
pub(crate) struct Writer {
    cache: Arc<DiskCache>,
    key: Option<String>,
}
impl Writer {
    /// Queue the fill on the cache thread (never waits).
    pub(crate) fn enqueue(mut self, object: Object) {
        let Some(key) = self.key.take() else { return };
        let cache = &self.cache;
        let mut q = cache.worker.lock();
        q.reserved -= 1;
        if !cache.started(&mut q) {
            drop(q);
            cache.counters.dropped.fetch_add(1, Ordering::Relaxed);
            cache.worker.done.notify_waiters();
            return;
        }
        q.writes.push_back(WriteJob::Fill { key, object });
        cache.counters.pending.fetch_add(1, Ordering::SeqCst);
        drop(q);
        cache.worker.ready.notify_one();
    }
}
impl Drop for Writer {
    /// A reservation never enqueued is released.
    fn drop(&mut self) {
        if self.key.is_some() {
            let mut q = self.cache.worker.lock();
            q.reserved -= 1;
            drop(q);
            self.cache.worker.done.notify_waiters();
        }
    }
}
impl Drop for DiskCache {
    /// The thread ends; queued work is discarded (the cache is disposable).
    fn drop(&mut self) {
        self.worker.lock().close();
        self.worker.ready.notify_all();
        self.worker.done.notify_waiters();
    }
}

#[cfg(test)]
mod fault_tests {
    use super::*;
    use crate::storage::{Limits, ProviderKey, RawRecord};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn setup() -> (PathBuf, Arc<DiskCache>, RecordId, Object) {
        let root = std::env::temp_dir().join(format!(
            "server2-disk-fault-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let cache = Arc::new(DiskCache::new(&root, "fault-test", 32768, 4).unwrap());
        let r = RawRecord::new(
            "data-go-kr",
            "ultra-srt-ncst",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            crate::storage::Period {
                local_date: 20261016,
                slot: "1200".into(),
            },
            1,
            200,
            "application/json",
            None,
            b"weather".as_slice().into(),
            &Limits::default(),
        )
        .unwrap();
        let p = r.prepare(&Limits::default()).unwrap();
        (
            root,
            cache,
            r.envelope.identity,
            Object {
                metadata: p.metadata,
                length: p.body.len(),
                body: p.body,
            },
        )
    }
    #[tokio::test]
    async fn shared_root_cap_counts_other_namespaces_and_temporary_files() {
        let (root, c, id, object) = setup();
        c.writer(&id).unwrap().enqueue(object.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        drop(c);
        let old = root.join(sha256(b"fault-test"));
        // A different live namespace must account for old raw plus an incomplete
        // temporary in that old namespace. It must not delete/reuse either one.
        let temp = old.join(format!(".tmp-{}-owned", sha256(b"other")));
        fs::write(&temp, vec![7; 8192]).unwrap();
        let before = root_usage(&root).unwrap();
        let c = Arc::new(DiskCache::new(&root, "new-bucket", before, 4).unwrap());
        c.writer(&id).unwrap().enqueue(object.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert_eq!(root_usage(&root).unwrap(), before);
        assert_eq!(c.metrics().writes, 0);
        assert!(temp.exists());
        // Once space is freed externally, this namespace can fill normally.
        fs::remove_file(temp).unwrap();
        c.writer(&id).unwrap().enqueue(object);
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert_eq!(c.metrics().writes, 1);
        assert!(root_usage(&root).unwrap() <= before);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn root_lock_serializes_namespace_admission_and_busy_cache_safely_skips() {
        let (root, c, id, o) = setup();
        c.writer(&id).unwrap().enqueue(o.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let b = Arc::new(DiskCache::new(&root, "other", 32768, 4).unwrap());
        let lock = capacity_lock(&root).unwrap();
        b.writer(&id).unwrap().enqueue(o.clone());
        assert!(
            b.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert_eq!(b.metrics().writes, 0);
        drop(lock);
        // Two namespaces submit at once; each successful reservation stays under
        // the one root cap, and busy writes may be skipped rather than queued.
        let mut id2 = id.clone();
        id2.fetched_at_ms += 1;
        c.writer(&id2).unwrap().enqueue(o.clone());
        b.writer(&id).unwrap().enqueue(o);
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert!(
            b.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert!(root_usage(&root).unwrap() <= 32768);
        assert!(c.metrics().peak_root_reserved_bytes <= 32768);
        assert!(b.metrics().peak_root_reserved_bytes <= 32768);
        drop(c);
        drop(b);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn writer_admission_is_bounded_and_cancellation_releases_reservations() {
        let (root, c, id, _) = setup();
        let a = c.writer(&id).unwrap();
        let b = c.writer(&id).unwrap();
        assert!(c.writer(&id).is_none());
        drop(a);
        assert!(c.writer(&id).is_some());
        drop(b);
        drop(c);
        assert!(!root.exists()); // Reserving optional work never touches disk.
    }
    #[tokio::test]
    async fn enospc_after_temporary_creation_releases_charge_and_recovers() {
        let (root, c, id, o) = setup();
        c.fail_write.store(true, Ordering::SeqCst);
        c.writer(&id).unwrap().enqueue(o.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let m = c.metrics();
        assert_eq!(m.errors, 1);
        assert_eq!(m.bytes, 0);
        assert_eq!(m.entries, 0);
        assert!(m.peak_bytes <= 32768);
        assert_eq!(fs::read_dir(&c.directory).unwrap().count(), 1);
        c.writer(&id).unwrap().enqueue(o);
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert!(c.load(&id, 8192).await.is_some());
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn stale_temporary_files_are_cleaned_but_unrelated_files_are_preserved() {
        let (root, c, id, o) = setup();
        c.writer(&id).unwrap().enqueue(o.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let path = c.directory.clone();
        drop(c);
        let temp = path.join(format!(
            ".tmp-{}-111-0",
            sha256(id.object_key().unwrap().as_bytes())
        ));
        fs::write(&temp, b"interrupted").unwrap();
        fs::write(path.join("keep-operator-note"), b"untouched").unwrap();
        let c = Arc::new(DiskCache::new(&root, "fault-test", 32768, 4).unwrap());
        assert!(c.load(&id, 8192).await.is_some());
        assert!(!temp.exists());
        assert_eq!(
            fs::read(path.join("keep-operator-note")).unwrap(),
            b"untouched"
        );
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn another_namespace_owner_bypasses_without_deleting_the_first_cache() {
        let (root, c, id, o) = setup();
        c.writer(&id).unwrap().enqueue(o);
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let other = Arc::new(DiskCache::new(&root, "fault-test", 32768, 4).unwrap());
        assert!(other.load(&id, 8192).await.is_none());
        assert!(other.metrics().errors > 0);
        assert!(c.load(&id, 8192).await.is_some());
        drop(other);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn tiny_entries_are_charged_in_allocated_blocks_and_lower_cap_evicts_on_restart() {
        let (root, c, id, o) = setup();
        for i in 1..=4 {
            let mut id = id.clone();
            id.fetched_at_ms = i;
            c.writer(&id).unwrap().enqueue(o.clone());
            assert!(
                c.idle(Instant::now() + std::time::Duration::from_secs(3))
                    .await
            );
            assert!(c.metrics().bytes >= 4096);
            assert!(c.metrics().peak_bytes <= 32768);
        }
        drop(c);
        let c = Arc::new(DiskCache::new(&root, "fault-test", 4096, 4).unwrap());
        let _ = c.load(&id, 8192).await;
        assert!(c.metrics().bytes <= 4096);
        assert!(c.metrics().entries <= 1);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_cache_file_is_not_followed_and_new_files_are_private() {
        use std::os::unix::{
            fs::MetadataExt,
            fs::{PermissionsExt, symlink},
        };
        let (root, c, id, o) = setup();
        c.writer(&id).unwrap().enqueue(o);
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let raw = c.directory.join(format!(
            "{}.raw",
            sha256(id.object_key().unwrap().as_bytes())
        ));
        assert_eq!(fs::metadata(&raw).unwrap().mode() & 0o777, 0o600);
        assert_eq!(
            fs::metadata(&c.directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_file(&raw).unwrap();
        let outside = root.join("operator-private");
        fs::write(&outside, b"DO-NOT-READ-OR-WRITE").unwrap();
        symlink(&outside, &raw).unwrap();
        assert!(c.load(&id, 8192).await.is_none());
        assert_eq!(fs::read(outside).unwrap(), b"DO-NOT-READ-OR-WRITE");
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    /// A held write: the seam fires on the next write once it holds the cache.
    fn hold(
        c: &DiskCache,
    ) -> (
        tokio::sync::oneshot::Receiver<()>,
        std::sync::mpsc::Sender<()>,
    ) {
        let (reached, held) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        *c.hold_write.lock().unwrap() = Some((reached, wait));
        (held, release)
    }
    /// DISK-CACHE: a load while a cache write is held answers at once instead of waiting for it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_held_cache_write_does_not_delay_a_load() {
        let (root, c, id, o) = setup();
        c.writer(&id).unwrap().enqueue(o.clone());
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        let (held, release) = hold(&c);
        let mut other = id.clone();
        other.fetched_at_ms += 1;
        c.writer(&other).unwrap().enqueue(o);
        held.await.unwrap();
        let load =
            tokio::time::timeout(std::time::Duration::from_millis(500), c.load(&id, 8192)).await;
        release.send(()).unwrap();
        assert!(load.is_ok(), "a held write delayed the load");
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
    /// DISK-CACHE: with the only blocking thread held, a cache write completes and a load hits.
    #[test]
    fn cache_loads_and_writes_do_not_use_the_blocking_pool() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (root, c, id, o) = setup();
            let (started, held) = tokio::sync::oneshot::channel::<()>();
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let blocking = tokio::task::spawn_blocking(move || {
                let _ = started.send(());
                let _ = wait.recv();
            });
            held.await.unwrap();
            c.writer(&id).unwrap().enqueue(o);
            let written = c
                .idle(Instant::now() + std::time::Duration::from_secs(2))
                .await;
            let read =
                tokio::time::timeout(std::time::Duration::from_secs(2), c.load(&id, 8192)).await;
            release.send(()).unwrap();
            blocking.await.unwrap();
            assert!(written, "the write waited for the blocking pool");
            assert!(
                read.is_ok_and(|r| r.is_some()),
                "the load waited for the blocking pool"
            );
            drop(c);
            fs::remove_dir_all(root).unwrap();
        });
    }
    /// DISK-CACHE: while a write is held, one more fill is reserved and the next is dropped and
    /// counted; the reserved one still lands.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fills_beyond_the_pending_bound_are_dropped_and_counted() {
        let (root, c, id, o) = setup();
        let (held, release) = hold(&c);
        c.writer(&id).unwrap().enqueue(o.clone());
        held.await.unwrap();
        let mut next = id.clone();
        next.fetched_at_ms += 1;
        let mut last = next.clone();
        last.fetched_at_ms += 1;
        let queued = c.writer(&next);
        let refused = c.writer(&last);
        assert!(queued.is_some());
        assert!(refused.is_none());
        assert_eq!(c.metrics().dropped_writes, 1);
        queued.unwrap().enqueue(o);
        release.send(()).unwrap();
        assert!(
            c.idle(Instant::now() + std::time::Duration::from_secs(3))
                .await
        );
        assert_eq!(c.metrics().writes, 2);
        drop(c);
        fs::remove_dir_all(root).unwrap();
    }
}
