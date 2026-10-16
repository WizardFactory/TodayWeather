//! Owned-loopback HTTP measurement only. No dotenv, provider, AWS, IAM or network latency claim.
//! Usage: kma_cache_measure http://127.0.0.1:PORT/ EMPTY_CACHE_DIRECTORY
//! Leaves recent synthetic current observations in the owned S3 peer for native HTTP smoke.
use serde_json::{Value, json};
use server2::domestic::publication::{Publication, current_base};
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, Limits, ObjectTransport,
    Pagination, ProviderKey, RawRecord, RawRecordStore, S3Settings,
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::Instant;
fn settings(endpoint: &str, cache: Option<&Path>) -> S3Settings {
    let mut vars = BTreeMap::from([
        ("SERVER2_S3_BUCKET", "server2-local".to_owned()),
        ("AWS_ACCESS_KEY", "server2-local".to_owned()),
        ("AWS_SECRET_KEY", "server2-local-secret".to_owned()),
    ]);
    if let Some(p) = cache {
        vars.insert("SERVER2_LOCAL_CACHE_DIR", p.to_str().unwrap().into());
        vars.insert(
            "SERVER2_LOCAL_CACHE_MAX_BYTES",
            (16 * 1024 * 1024).to_string(),
        );
    }
    S3Settings::from_vars_at(&|k| vars.get(k).cloned(), Some(endpoint)).unwrap()
}
fn current_page(p: Publication) -> Vec<u8> {
    let items: Vec<_> = [("PTY","0"),("REH","60"),("RN1","0"),("T1H","21.5"),
        ("UUU","1.2"),("VEC","200"),("VVV","-0.5"),("WSD","2.1")].iter().map(|(c,v)|
        json!({"baseDate":p.base_date(),"baseTime":p.base_time(),"category":c,"nx":60,"ny":127,"obsrValue":v})).collect();
    serde_json::to_vec(&json!({"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"dataType":"JSON","items":{"item":items},"pageNo":1,"numOfRows":999,"totalCount":8}}})).unwrap()
}
fn raw(p: Publication, at: u64, image: bool) -> RawRecord {
    let body = if image {
        // Incompressible image-sized raw bytes, NOT a valid GIF or a decoder fixture.
        let mut seed = 0x1846fa21u32;
        (0..6 * 1024 * 1024)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed as u8
            })
            .collect()
    } else {
        current_page(p)
    };
    RawRecord::new(
        if image {
            "airkorea-image"
        } else {
            "data-go-kr"
        },
        if image {
            "airkorea-forecast-image"
        } else {
            "ultra-srt-ncst"
        },
        &if image {
            ProviderKey::Named {
                id: "image-sized-measurement".into(),
            }
        } else {
            ProviderKey::Grid { nx: 60, ny: 127 }
        },
        p.period(),
        at,
        200,
        if image {
            "application/octet-stream"
        } else {
            "application/json"
        },
        if image {
            None
        } else {
            Some(Pagination {
                page: 1,
                pages: 1,
                complete: true,
            })
        },
        body.into(),
        &Limits::default(),
    )
    .unwrap()
}
async fn publish(endpoint: &str, row: RawRecord, p: Publication) {
    let limits = CatalogLimits::default();
    let s = CatalogStore::new(
        settings(endpoint, None).transport().unwrap(),
        limits.clone(),
    )
    .unwrap();
    let d = GroupDeclaration::new(
        vec![GroupMember {
            envelope: row.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&row.envelope.identity, &p.partition()).unwrap()],
        }],
        &limits,
    )
    .unwrap();
    s.publish(d, vec![row], Instant::now() + Duration::from_secs(3))
        .await
        .unwrap();
}
fn files(root: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .flat_map(|e| {
            std::fs::read_dir(e.path())
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .map(|e| e.path())
        })
        .filter(|p| p.extension().is_some_and(|e| e == "raw"))
        .collect()
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 || !args[0].starts_with("http://127.0.0.1:") {
        return Err("owned IPv4 loopback endpoint and cache directory required".into());
    }
    let endpoint = &args[0];
    let root = Path::new(&args[1]);
    if root.exists() && std::fs::read_dir(root)?.next().is_some() {
        return Err("cache directory must be empty".into());
    }
    let at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let p = current_base(at as i64).unwrap();
    for hours in [-2, -1, 0] {
        let p = p.add_hours(hours).unwrap();
        publish(endpoint, raw(p, at, false), p).await;
    }
    let image = raw(p, at, true);
    let raw_bytes = image.bytes.len();
    let wire_bytes = image.prepare(&Limits::default())?.body.len();
    publish(endpoint, image.clone(), p).await;
    let mut observations: Vec<Value> = vec![];
    // Each iteration owns a new store and cache handle: no retained application RAM.
    for phase in [
        "cold-empty-ram-and-disk",
        "warm-disk-empty-ram",
        "corrupt-disk",
        "missing-disk",
    ] {
        if phase == "corrupt-disk" {
            let f = files(root).pop().ok_or("missing measured cache file")?;
            std::fs::write(f, b"truncated")?;
        }
        if phase == "missing-disk" {
            for f in files(root) {
                std::fs::remove_file(f)?;
            }
        }
        let transport = Arc::new(settings(endpoint, Some(root)).transport()?);
        let cache = transport.raw_cache().unwrap();
        let store = RawRecordStore::new_shared(transport, Limits::default())?;
        let start = Instant::now();
        let restored = store.load(&image.envelope.identity).await?;
        let elapsed = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(restored.bytes, image.bytes);
        assert!(cache.idle(Instant::now() + Duration::from_secs(3)).await);
        observations.push(json!({"phase":phase,"elapsed_ms":elapsed,"metrics":cache.metrics()}));
        drop(store);
        drop(cache);
    }
    println!(
        "{}",
        serde_json::to_string(
            &json!({"scope":"owned-loopback HTTP; debug build; synthetic incompressible raw image-sized payload; not GIF decoding, AWS or full KMA latency", "raw_sha256":image.envelope.identity.raw_sha256,"raw_bytes":raw_bytes,"gzip_wire_bytes":wire_bytes,"cache_cap_bytes":16*1024*1024,"phases":observations,"seeded_current_publications":3})
        )?
    );
    Ok(())
}
