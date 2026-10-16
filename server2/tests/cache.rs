//! Explicit cache configuration only; no environment or external network.
use server2::cache::disk::DiskCache;
use server2::storage::{
    Error, Limits, Object, ObjectTransport, Period, PreparedRecord, ProviderKey, RawRecord,
    RawRecordStore,
};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "server2-disk-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&p).unwrap();
        Self(p)
    }
    fn files(&self) -> Vec<PathBuf> {
        std::fs::read_dir(&self.0)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|d| d.path().is_dir())
            .flat_map(|d| {
                std::fs::read_dir(d.path())
                    .into_iter()
                    .flatten()
                    .filter_map(Result::ok)
                    .map(|e| e.path())
            })
            .filter(|p| p.extension().is_some_and(|x| x == "raw"))
            .collect()
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
struct Wire {
    objects: BTreeMap<String, Object>,
    gets: AtomicUsize,
}
struct Transport {
    wire: Arc<Wire>,
    cache: Option<Arc<DiskCache>>,
}
impl ObjectTransport for Transport {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        unreachable!()
    }
    async fn head(&self, k: &str) -> Result<Object, Error> {
        self.wire.objects.get(k).cloned().ok_or(Error::NotFound)
    }
    async fn get(&self, k: &str, _: usize) -> Result<Object, Error> {
        self.wire.gets.fetch_add(1, Ordering::SeqCst);
        self.wire.objects.get(k).cloned().ok_or(Error::NotFound)
    }
    fn raw_cache(&self) -> Option<Arc<DiskCache>> {
        self.cache.clone()
    }
}
fn record(source: &str, kind: &str, at: u64, body: Vec<u8>) -> RawRecord {
    RawRecord::new(
        source,
        kind,
        &ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20261016,
            slot: "1200".into(),
        },
        at,
        200,
        "application/octet-stream",
        None,
        body.into(),
        &Limits::default(),
    )
    .unwrap()
}
fn wire(rows: &[RawRecord]) -> Arc<Wire> {
    Arc::new(Wire {
        gets: AtomicUsize::new(0),
        objects: rows
            .iter()
            .map(|r| {
                let p = r.prepare(&Limits::default()).unwrap();
                (
                    p.key,
                    Object {
                        metadata: p.metadata,
                        length: p.body.len(),
                        body: p.body,
                    },
                )
            })
            .collect(),
    })
}
fn store(w: Arc<Wire>, c: Option<Arc<DiskCache>>) -> RawRecordStore<Transport> {
    RawRecordStore::new(Transport { wire: w, cache: c }, Limits::default()).unwrap()
}
async fn idle(c: &Arc<DiskCache>) {
    assert!(c.idle(Instant::now() + Duration::from_secs(3)).await);
}
#[tokio::test]
async fn restart_reuses_verified_weather_without_raw_get() {
    let d = Directory::new();
    let r = record("data-go-kr", "ultra-srt-ncst", 1, b"weather".to_vec());
    let w = wire(std::slice::from_ref(&r));
    {
        let c = Arc::new(DiskCache::new(&d.0, "bucket-a/seoul", 1048576, 16).unwrap());
        let s = store(w.clone(), Some(c.clone()));
        assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
        idle(&c).await;
    }
    let c = Arc::new(DiskCache::new(&d.0, "bucket-a/seoul", 1048576, 16).unwrap());
    let s = store(w.clone(), Some(c));
    assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
    assert_eq!(w.gets.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn corrupt_truncated_and_missing_files_recover_s3() {
    let d = Directory::new();
    let r = record("data-go-kr", "ultra-srt-ncst", 1, b"original".to_vec());
    let w = wire(std::slice::from_ref(&r));
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    let s = store(w.clone(), Some(c.clone()));
    for a in 0..4 {
        assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
        idle(&c).await;
        let p = d.files().pop().unwrap();
        match a {
            0 => {
                let mut b = std::fs::read(&p).unwrap();
                let n = b.len() - 1;
                b[n] ^= 1;
                std::fs::write(p, b).unwrap();
            }
            1 => std::fs::write(p, b"truncated").unwrap(),
            2 => std::fs::remove_file(p).unwrap(),
            _ => (),
        }
    }
    assert_eq!(w.gets.load(Ordering::SeqCst), 4);
}
#[tokio::test]
async fn namespace_and_weather_scope_exclude_private_raw() {
    let d = Directory::new();
    let a = record(
        "airkorea-image",
        "airkorea-forecast-image",
        1,
        b"GIF".to_vec(),
    );
    let b = record(
        "geocoder",
        "precise-coordinate",
        2,
        b"PRIVATE-NEVER-CACHED".to_vec(),
    );
    let w = wire(&[a.clone(), b.clone()]);
    for n in ["bucket-a/seoul", "bucket-b/seoul"] {
        let c = Arc::new(DiskCache::new(&d.0, n, 1048576, 16).unwrap());
        let s = store(w.clone(), Some(c.clone()));
        s.load(&a.envelope.identity).await.unwrap();
        s.load(&b.envelope.identity).await.unwrap();
        idle(&c).await;
    }
    assert_eq!(d.files().len(), 2);
    assert_eq!(w.gets.load(Ordering::SeqCst), 4);
    for p in d.files() {
        assert!(
            !std::fs::read(p)
                .unwrap()
                .windows(20)
                .any(|b| b == b"PRIVATE-NEVER-CACHED")
        );
    }
}
#[tokio::test]
async fn entry_and_byte_caps_evict_unusable_cache_is_a_miss() {
    let d = Directory::new();
    let rows: Vec<_> = (1..=4)
        .map(|at| record("kma-web", "aws-hourly", at, vec![at as u8; 2048]))
        .collect();
    let w = wire(&rows);
    let c = Arc::new(DiskCache::new(&d.0, "a", 16384, 2).unwrap());
    let s = store(w.clone(), Some(c.clone()));
    for r in &rows {
        s.load(&r.envelope.identity).await.unwrap();
        idle(&c).await;
        let m = c.metrics();
        assert!(m.bytes <= 16384);
        assert!(m.entries <= 2);
        assert_eq!(m.pending_writes, 0);
    }
    assert!(c.metrics().evictions >= 2);
    s.load(&rows[0].envelope.identity).await.unwrap();
    idle(&c).await;
    assert_eq!(w.gets.load(Ordering::SeqCst), 5);
    let bad = d.0.join("not-dir");
    std::fs::write(&bad, b"untouched").unwrap();
    let c = Arc::new(DiskCache::new(&bad, "a", 16384, 2).unwrap());
    let s = store(w, Some(c.clone()));
    assert!(s.load(&rows[0].envelope.identity).await.is_ok());
    idle(&c).await;
    assert_eq!(std::fs::read(bad).unwrap(), b"untouched");
}

#[test]
fn cache_settings_are_explicit_validated_and_never_touch_environment() {
    use server2::storage::S3Settings;
    let d = Directory::new();
    let mut values = BTreeMap::from([
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("AWS_ACCESS_KEY", "owned-placeholder".to_owned()),
        ("AWS_SECRET_KEY", "owned-placeholder-secret".to_owned()),
    ]);
    let settings = |v: &BTreeMap<&str, String>| {
        S3Settings::from_vars_at(&|k| v.get(k).cloned(), Some("http://127.0.0.1:9/"))
    };
    assert!(
        settings(&values)
            .unwrap()
            .transport()
            .unwrap()
            .raw_cache()
            .is_none()
    );
    values.insert("SERVER2_LOCAL_CACHE_MAX_BYTES", "8192".into());
    assert!(settings(&values).is_err());
    let nonexistent = d.0.join("not-created-during-settings");
    values.insert(
        "SERVER2_LOCAL_CACHE_DIR",
        nonexistent.to_str().unwrap().into(),
    );
    assert!(
        settings(&values)
            .unwrap()
            .transport()
            .unwrap()
            .raw_cache()
            .is_some()
    );
    assert!(!nonexistent.exists());
    values.insert("SERVER2_LOCAL_CACHE_MAX_BYTES", "4095".into());
    assert!(settings(&values).is_err());
    values.insert("SERVER2_LOCAL_CACHE_MAX_BYTES", "not-an-integer".into());
    assert!(settings(&values).is_err());
}

#[tokio::test]
async fn locally_checksum_valid_wrong_metadata_is_rejected_by_raw_codec() {
    use sha2::{Digest, Sha256};
    let d = Directory::new();
    let r = record("kma-web", "aws-hourly", 1, b"weather".to_vec());
    let w = wire(std::slice::from_ref(&r));
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    let s = store(w.clone(), Some(c.clone()));
    s.load(&r.envelope.identity).await.unwrap();
    idle(&c).await;
    let p = d.files().pop().unwrap();
    let mut bytes = std::fs::read(&p).unwrap();
    let n = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let mut h: serde_json::Value = serde_json::from_slice(&bytes[52..52 + n]).unwrap();
    h["metadata"]["s2-record"] = serde_json::json!("forged");
    let h = serde_json::to_vec(&h).unwrap();
    let body = bytes[52 + n..].to_vec();
    bytes.truncate(52);
    bytes[8..12].copy_from_slice(&(h.len() as u32).to_le_bytes());
    let mut sum = Sha256::new();
    sum.update(&h);
    sum.update(&body);
    bytes[20..52].copy_from_slice(&sum.finalize());
    bytes.extend_from_slice(&h);
    bytes.extend_from_slice(&body);
    std::fs::write(p, bytes).unwrap();
    assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
    idle(&c).await;
    assert_eq!(w.gets.load(Ordering::SeqCst), 2);
    assert!(c.metrics().corruptions > 0);
}

#[tokio::test]
async fn corrupt_canonical_s3_keeps_storage_error_and_never_fills_cache() {
    let d = Directory::new();
    let r = record("kma-web", "aws-hourly", 1, b"weather".to_vec());
    let mut prepared = r.prepare(&Limits::default()).unwrap();
    prepared.body[0] ^= 1;
    let w = Arc::new(Wire {
        gets: AtomicUsize::new(0),
        objects: BTreeMap::from([(
            prepared.key,
            Object {
                metadata: prepared.metadata,
                length: prepared.body.len(),
                body: prepared.body,
            },
        )]),
    });
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    assert!(
        store(w, Some(c.clone()))
            .load(&r.envelope.identity)
            .await
            .is_err()
    );
    idle(&c).await;
    assert_eq!(c.metrics().writes, 0);
    assert!(d.files().is_empty());
}

#[tokio::test]
async fn removing_the_entire_cache_tree_while_live_keeps_canonical_read_correct() {
    let d = Directory::new();
    let r = record("kma-web", "aws-hourly", 1, b"weather".to_vec());
    let w = wire(std::slice::from_ref(&r));
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    let s = store(w.clone(), Some(c.clone()));
    s.load(&r.envelope.identity).await.unwrap();
    idle(&c).await;
    std::fs::remove_dir_all(&d.0).unwrap();
    assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
    idle(&c).await;
    assert_eq!(w.gets.load(Ordering::SeqCst), 2);
}

#[cfg(unix)]
#[tokio::test]
async fn unsafe_root_permissions_and_symlink_capacity_lock_are_optional_cache_misses() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let d = Directory::new();
    let r = record("kma-web", "aws-hourly", 1, b"weather".to_vec());
    let w = wire(std::slice::from_ref(&r));
    std::fs::set_permissions(&d.0, std::fs::Permissions::from_mode(0o755)).unwrap();
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    assert!(
        store(w.clone(), Some(c.clone()))
            .load(&r.envelope.identity)
            .await
            .is_ok()
    );
    idle(&c).await;
    assert_eq!(c.metrics().writes, 0);
    drop(c);
    std::fs::set_permissions(&d.0, std::fs::Permissions::from_mode(0o700)).unwrap();
    let outside = d.0.join("operator-private");
    std::fs::write(&outside, b"DO-NOT-TOUCH").unwrap();
    symlink(&outside, d.0.join(".capacity")).unwrap();
    let c = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    assert!(
        store(w, Some(c.clone()))
            .load(&r.envelope.identity)
            .await
            .is_ok()
    );
    idle(&c).await;
    assert_eq!(c.metrics().writes, 0);
    assert_eq!(std::fs::read(outside).unwrap(), b"DO-NOT-TOUCH");
    assert!(d.files().is_empty());
}

#[tokio::test]
async fn publication_reconciliation_never_uses_cache_to_mask_same_length_s3_corruption() {
    struct PublishTransport {
        canonical: Arc<std::sync::Mutex<Object>>,
        gets: Arc<AtomicUsize>,
        cache: Arc<DiskCache>,
    }
    impl ObjectTransport for PublishTransport {
        fn raw_cache(&self) -> Option<Arc<DiskCache>> {
            Some(self.cache.clone())
        }
        async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
            Ok(412)
        }
        async fn head(&self, _: &str) -> Result<Object, Error> {
            Ok(self.canonical.lock().unwrap().clone())
        }
        async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
            self.gets.fetch_add(1, Ordering::SeqCst);
            Ok(self.canonical.lock().unwrap().clone())
        }
    }
    let d = Directory::new();
    let r = record("kma-web", "aws-hourly", 1, b"weather".to_vec());
    let p = r.prepare(&Limits::default()).unwrap();
    let canonical = Arc::new(std::sync::Mutex::new(Object {
        metadata: p.metadata,
        length: p.body.len(),
        body: p.body,
    }));
    let gets = Arc::new(AtomicUsize::new(0));
    let cache = Arc::new(DiskCache::new(&d.0, "a", 1048576, 16).unwrap());
    let s = RawRecordStore::new(
        PublishTransport {
            canonical: canonical.clone(),
            gets: gets.clone(),
            cache: cache.clone(),
        },
        Limits::default(),
    )
    .unwrap();
    assert_eq!(s.load(&r.envelope.identity).await.unwrap().bytes, r.bytes);
    idle(&cache).await;
    assert_eq!(cache.metrics().writes, 1);
    // Preserve length and envelope/gzip hash metadata, corrupt only the canonical bytes.
    canonical.lock().unwrap().body[0] ^= 1;
    let result = s.publish(r).await;
    assert!(
        matches!(result, Err(Error::Corrupt(_))),
        "publication must verify canonical S3, got {result:?}"
    );
    assert_eq!(gets.load(Ordering::SeqCst), 2);
}
