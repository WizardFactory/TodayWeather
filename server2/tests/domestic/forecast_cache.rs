//! D2 warm-read regression over the existing public source interface and owned S06 peer.
//! This small golden Current acquisition discriminates redundant S3 reads; it does not replace
//! the complete 730-acquisition baseline/default-policy acceptance corpus.
use super::source::{at, docs_json, items_of, number, oracle, pages, same, text};
use super::source_s3::{NOW, Peer, S3_PEERS, Unreachable, deadline};
use server2::domestic::asos::AsosRequest;
use server2::domestic::family::WebRequest;
use server2::domestic::kma::source::observe::Acquire;
use server2::domestic::kma::source::{Family, Fetched, S3Source, grid_input_id};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::{BoxFuture, OrderedJson};
use server2::history::Grid;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, LookupOutcome,
    RawRecord, sha256,
};
use server2::summary::InputId;
use std::collections::BTreeMap;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering::SeqCst},
};
use tokio::time::Instant;

/// General-provider boundary is a counting deny stub; forecast acquisition is disabled (None).
#[derive(Default)]
struct DenyProviders(AtomicUsize);
impl Acquire for DenyProviders {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
}

async fn counts(peer: &Peer) -> BTreeMap<String, u64> {
    let response = reqwest::get(format!("{}/__catalog/status", peer.endpoint()))
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    serde_json::from_slice(&response.bytes().await.unwrap()).unwrap()
}
fn forecast_reads(counts: &BTreeMap<String, u64>) -> BTreeMap<String, u64> {
    counts
        .iter()
        .filter(|(key, _)| {
            key.starts_with("OP LIST index/v2/data-go-kr/ultra-srt-ncst/")
                || key.starts_with("OP GET index/v2/data-go-kr/ultra-srt-ncst/")
                // This peer contains only this forecast acquisition; descriptors use hash keys.
                || key.starts_with("OP GET index/v2/groups/")
                || key.starts_with("OP GET raw/v2/data-go-kr/ultra-srt-ncst/")
        })
        .map(|(key, count)| (key.clone(), *count))
        .collect()
}

type Source = S3Source<server2::world::BoundedS3<server2::storage::HttpS3Transport>>;
struct Fixture {
    peer: Peer,
    source: Source,
    expected: OrderedJson,
    providers: Arc<DenyProviders>,
}
async fn fixture() -> Fixture {
    let peer = Peer::persistent();
    let grid = Grid::new(60, 127).unwrap();
    let golden = items_of(at(oracle(), &["grid"]))
        .iter()
        .find(|g| text(at(g, &["id"])) == "current")
        .unwrap();
    let run = items_of(at(golden, &["runs"])).last().unwrap();
    assert_eq!(text(at(run, &["period"])), "20260924-1000");
    let raw_pages = pages(run);
    assert_eq!(raw_pages.len(), 1);
    assert_eq!(
        sha256(&raw_pages[0]),
        "e1b1b0ff08b4d8335d7e8b556e47326830608332829d82820e26b87d6fcaa7be"
    );
    let fetched_at = number(at(run, &["fetched_at"])) as u64;
    assert_eq!(fetched_at, 1_790_214_300_000);
    let publication = Publication::new(20260924, 1000).unwrap();
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        "data-go-kr",
        "ultra-srt-ncst",
        &grid.provider_key(),
        publication.period(),
        fetched_at,
        200,
        "application/json",
        None,
        raw_pages[0].clone().into(),
        &limits.raw,
    )
    .unwrap();
    let id = CatalogId::for_record(&record.envelope.identity, &publication.partition()).unwrap();
    let declaration = GroupDeclaration::new(
        vec![GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![id.clone()],
        }],
        &limits,
    )
    .unwrap();
    let store = CatalogStore::new(peer.transport(), limits).unwrap();
    store
        .publish(declaration, vec![record], deadline())
        .await
        .unwrap();
    // Witness the acknowledged complete acquisition independently of the source under test.
    let LookupOutcome::Ready(set) = store.lookup(&id, deadline()).await.unwrap() else {
        panic!("fixture did not publish a complete S06 acquisition");
    };
    assert_eq!(set.excluded_groups(), 0);
    assert_eq!(set.acquisitions().len(), 1);
    let records = set.acquisitions()[0].records();
    assert_eq!(records.len(), 1);
    assert_eq!(&*records[0].bytes, &raw_pages[0]);
    assert_eq!(records[0].envelope.identity.fetched_at_ms, fetched_at);
    let fetched = Fetched {
        fetched_at_ms: fetched_at,
        partition: publication.partition(),
        pages: vec![records[0].bytes.clone()],
    };
    let expected_id = InputId {
        family: "ultra-srt-ncst".into(),
        start_ms: server2::history::schedule::to_ms(publication),
        end_ms: server2::history::schedule::to_ms(publication),
        fetched_at_ms: fetched_at,
        content_sha256: "6b14af117757731042ea8ff05f5f9ccc231b219b8c01db3aac8e72914750112d".into(),
    };
    assert_eq!(
        grid_input_id(Family::Current, "ultra-srt-ncst", &fetched),
        Some(expected_id)
    );
    // This ID assertion covers the public identity function and stored fixture, not the private
    // snapshot summary-input handoff (which needs the separate settled-observation acceptance).
    let providers = Arc::new(DenyProviders::default());
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        providers.clone(),
        Arc::new(Unreachable),
    )
    .unwrap();
    let expected = OrderedJson::Array(vec![
        items_of(at(golden, &["answers", "current"]))
            .last()
            .unwrap()
            .clone(),
    ]);
    Fixture {
        peer,
        source,
        expected,
        providers,
    }
}

#[tokio::test]
async fn warm_current_reuses_docs_without_forecast_list_or_get() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    let grid = Grid::new(60, 127).unwrap();
    let before_cold = forecast_reads(&counts(&peer).await);
    let cold = source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&cold), &expected, "cold golden Current document");
    assert_eq!(providers.0.load(SeqCst), 0, "cold must not call a provider");
    let after_cold = forecast_reads(&counts(&peer).await);
    assert!(
        after_cold.iter().any(|(key, n)| key.starts_with("OP LIST ")
            && *n > before_cold.get(key).copied().unwrap_or(0)),
        "cold must really LIST the forecast prefix"
    );
    assert!(
        after_cold.iter().any(|(key, n)| key.starts_with("OP GET ")
            && *n > before_cold.get(key).copied().unwrap_or(0)),
        "cold must really GET forecast data"
    );
    let warm = source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&warm), &expected, "warm golden Current document");
    assert_eq!(providers.0.load(SeqCst), 0, "warm must not call a provider");
    let after_warm = forecast_reads(&counts(&peer).await);
    // Intended pre-fix Red is here, after every fixture/parity/provider prerequisite above.
    assert_eq!(
        after_warm, after_cold,
        "warm forecast must perform zero additional LIST/GET operations"
    );
}

#[tokio::test]
async fn unchanged_controls_renew_without_raw_parse_or_fold() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    let grid = Grid::new(60, 127).unwrap();
    source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    let before = forecast_reads(&counts(&peer).await);
    let stats = source.forecast_cache_stats();
    let answer = source
        .grid_answer(Family::Current, grid, NOW + 60_000., deadline())
        .await
        .unwrap();
    same(&docs_json(&answer), &expected, "renewed Current");
    let after = forecast_reads(&counts(&peer).await);
    assert!(
        after
            .iter()
            .any(|(k, n)| k.starts_with("OP LIST ") && *n > before.get(k).copied().unwrap_or(0)),
        "external check must really list"
    );
    assert!(
        after.iter().any(
            |(k, n)| k.starts_with("OP GET index/v2/data-go-kr/ultra-srt-ncst/")
                && *n > before.get(k).copied().unwrap_or(0)
        ),
        "must check catalog contents, not only partition names"
    );
    for (k, n) in &after {
        if k.starts_with("OP GET raw/") || k.starts_with("OP GET index/v2/groups/") {
            assert_eq!(
                *n,
                before.get(k).copied().unwrap_or(0),
                "renewal must not fetch {k}"
            );
        }
    }
    assert_eq!(
        source.forecast_cache_stats().parse_acquisitions,
        stats.parse_acquisitions
    );
    assert_eq!(source.forecast_cache_stats().folds, stats.folds);
    assert_eq!(providers.0.load(SeqCst), 0);
}

#[tokio::test]
async fn wall_rewind_refolds_and_later_unchanged_minute_only_revalidates() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    let grid = Grid::new(60, 127).unwrap();
    let first = source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&first), &expected, "initial Doc");
    let warm = forecast_reads(&counts(&peer).await);
    let rewind = source
        .grid_answer(Family::Current, grid, NOW - 1., deadline())
        .await
        .unwrap();
    same(&docs_json(&rewind), &expected, "rewound Doc");
    let after_rewind = forecast_reads(&counts(&peer).await);
    assert_ne!(
        after_rewind, warm,
        "wall rewind cannot hit a newer validation"
    );
    let advanced = source
        .grid_answer(Family::Current, grid, NOW + 60_000., deadline())
        .await
        .unwrap();
    same(
        &docs_json(&advanced),
        &expected,
        "next oldest-partition minute Doc",
    );
    assert_ne!(forecast_reads(&counts(&peer).await), after_rewind);
    assert_eq!(source.forecast_cache_stats().folds, 2);
    assert_eq!(providers.0.load(SeqCst), 0);
}

#[tokio::test]
async fn short_waiter_does_not_cancel_the_owned_forecast_restore() {
    use std::time::Duration;
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    reqwest::Client::new()
        .post(format!(
            "{}/__catalog?mode=slow-all&key=owned",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let grid = Grid::new(60, 127).unwrap();
    assert!(
        source
            .grid_answer(
                Family::Current,
                grid,
                NOW,
                Instant::now() + Duration::from_millis(5)
            )
            .await
            .is_err()
    );
    assert!(
        source.forecast_cache_stats().active_workspace_logical_bytes > 0,
        "owner must retain its workspace after the short waiter ends"
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while source.forecast_cache_stats().active_workspace_logical_bytes > 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned small restore must finish independently");
    let before = forecast_reads(&counts(&peer).await);
    let docs = source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&docs), &expected, "owner continuation Doc");
    assert_eq!(
        forecast_reads(&counts(&peer).await),
        before,
        "later waiter must reuse the completed restore"
    );
    assert_eq!(source.forecast_cache_stats().folds, 1);
    assert_eq!(providers.0.load(SeqCst), 0);
}

/// Poll the complete admitted cohort before waiting for any result; no runtime-private helper.
async fn together<F: std::future::Future>(futures: Vec<F>) -> Vec<F::Output> {
    use std::task::Poll;
    let mut work: Vec<_> = futures.into_iter().map(|f| Some(Box::pin(f))).collect();
    let mut output: Vec<Option<F::Output>> =
        std::iter::repeat_with(|| None).take(work.len()).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (i, work) in work.iter_mut().enumerate() {
            if let Some(future) = work {
                match future.as_mut().poll(cx) {
                    Poll::Ready(value) => {
                        output[i] = Some(value);
                        *work = None;
                    }
                    Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    output.into_iter().map(Option::unwrap).collect()
}

async fn slow_peer(peer: &Peer) {
    reqwest::Client::new()
        .post(format!(
            "{}/__catalog?mode=slow-all&key=owned",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
}
#[tokio::test]
async fn one_cold_key_admits128_waiters_and_refuses_the129th() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    slow_peer(&peer).await;
    let source = Arc::new(source);
    let grid = Grid::new(60, 127).unwrap();
    let results = together(
        (0..129)
            .map(|_| {
                let source = source.clone();
                async move {
                    source
                        .grid_answer(Family::Current, grid, NOW, deadline())
                        .await
                }
            })
            .collect(),
    )
    .await;
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 128);
    let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("waiter capacity"), "{errors:?}");
    for docs in results.into_iter().filter_map(Result::ok) {
        same(&docs_json(&docs), &expected, "joined Doc");
    }
    assert_eq!(source.forecast_cache_stats().folds, 1);
    assert_eq!(providers.0.load(SeqCst), 0);
}
#[tokio::test]
async fn distinct_cold_keys_have_two_active_owners_and_eight_queued_keys() {
    use std::time::Duration;
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        providers,
        ..
    } = fixture().await;
    slow_peer(&peer).await;
    let source = Arc::new(source);
    let work = source.clone();
    let task = tokio::spawn(async move {
        together(
            (0..13)
                .map(|i| {
                    let source = work.clone();
                    async move {
                        source
                            .grid_answer(
                                Family::Current,
                                Grid::new(60 + i, 127).unwrap(),
                                NOW,
                                deadline(),
                            )
                            .await
                    }
                })
                .collect(),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let state = source.forecast_cache_stats();
            if state.queued_keys == 8 {
                assert_eq!(state.active_owners, 2);
                assert_eq!(state.admitted_keys, 10);
                assert_eq!(state.active_workspace_logical_bytes, 2 * 192 * 1024 * 1024);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("observe the held bounded cold cohort");
    let results = task.await.unwrap();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 10);
    assert_eq!(results.iter().filter(|r| r.is_err()).count(), 3);
    let state = source.forecast_cache_stats();
    assert_eq!(state.queued_keys, 0);
    assert_eq!(state.active_owners, 0);
    assert_eq!(state.active_workspace_logical_bytes, 0);
    assert_eq!(providers.0.load(SeqCst), 0);
}

fn disk_source(
    peer: &Peer,
    root: &std::path::Path,
    providers: Arc<DenyProviders>,
) -> (Source, Arc<server2::cache::disk::DiskCache>) {
    disk_source_with_cap(peer, root, providers, 8 * 1024 * 1024 * 1024)
}
fn disk_source_with_cap(
    peer: &Peer,
    root: &std::path::Path,
    providers: Arc<DenyProviders>,
    cap: u64,
) -> (Source, Arc<server2::cache::disk::DiskCache>) {
    use server2::storage::{ObjectTransport, S3Settings};
    let settings = S3Settings::from_vars_at(
        &|name| match name {
            "AWS_ACCESS_KEY" => Some("server2-local".into()),
            "AWS_SECRET_KEY" => Some("server2-local-secret".into()),
            "SERVER2_S3_BUCKET" => Some("server2-local".into()),
            "SERVER2_LOCAL_CACHE_DIR" => Some(root.to_str().unwrap().into()),
            "SERVER2_LOCAL_CACHE_MAX_BYTES" => Some(cap.to_string()),
            _ => None,
        },
        Some(peer.endpoint()),
    )
    .unwrap();
    let transport = settings.transport().unwrap();
    let disk = transport.raw_cache().unwrap();
    let source = S3Source::new(
        server2::world::BoundedS3::new(transport, 4),
        Arc::new(|| NOW),
        providers,
        Arc::new(Unreachable),
    )
    .unwrap();
    (source, disk)
}
#[tokio::test]
async fn process_restart_restores_folded_current_without_parse_or_fold() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    drop(source);
    let root = std::env::temp_dir().join(format!("server2-2850-restart-{}", std::process::id()));
    assert!(!root.exists(), "test must own a new cache root");
    let grid = Grid::new(60, 127).unwrap();
    let (first, disk) = disk_source(&peer, &root, providers.clone());
    let cold = first
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&cold), &expected, "disk fill Current");
    assert!(disk.idle(deadline()).await);
    drop(cold);
    drop(first);
    drop(disk);
    let before = forecast_reads(&counts(&peer).await);
    let (second, disk) = disk_source(&peer, &root, providers.clone());
    let restored = second
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    same(&docs_json(&restored), &expected, "disk restored Current");
    assert_eq!(
        second.forecast_cache_stats().parse_acquisitions,
        0,
        "restart must restore folded Docs"
    );
    assert_eq!(second.forecast_cache_stats().folds, 0);
    let after = forecast_reads(&counts(&peer).await);
    for (k, n) in after {
        if k.starts_with("OP GET raw/") || k.starts_with("OP GET index/v2/groups/") {
            assert_eq!(
                n,
                before.get(&k).copied().unwrap_or(0),
                "restore must not fetch {k}"
            );
        }
    }
    assert_eq!(providers.0.load(SeqCst), 0);
    assert!(disk.idle(deadline()).await);
    drop(restored);
    drop(second);
    drop(disk);
    std::fs::remove_dir_all(root).unwrap();
}

async fn newer_current(peer: &Peer) {
    let g = items_of(at(oracle(), &["grid"]))
        .iter()
        .find(|g| text(at(g, &["id"])) == "current")
        .unwrap();
    let run = items_of(at(g, &["runs"])).last().unwrap();
    let mut body: serde_json::Value = serde_json::from_slice(&pages(run)[0]).unwrap();
    let rows = body["response"]["body"]["items"]["item"]
        .as_array_mut()
        .unwrap();
    let row = rows.iter_mut().find(|r| r["category"] == "T1H").unwrap();
    row["obsrValue"] = serde_json::json!("31.5");
    let limits = CatalogLimits::default();
    let p = Publication::new(20260924, 1000).unwrap();
    let record = RawRecord::new(
        "data-go-kr",
        "ultra-srt-ncst",
        &Grid::new(60, 127).unwrap().provider_key(),
        p.period(),
        (NOW + 1.) as u64,
        200,
        "application/json",
        None,
        serde_json::to_vec(&body).unwrap().into(),
        &limits.raw,
    )
    .unwrap();
    let id = CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap();
    let declaration = GroupDeclaration::new(
        vec![GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![id],
        }],
        &limits,
    )
    .unwrap();
    CatalogStore::new(peer.transport(), limits)
        .unwrap()
        .publish(declaration, vec![record], deadline())
        .await
        .unwrap();
}
#[tokio::test]
async fn external_same_partition_write_is_visible_after_delay_and_failed_check_never_renews() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    let grid = Grid::new(60, 127).unwrap();
    source
        .grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    newer_current(&peer).await;
    let before = source
        .grid_answer(Family::Current, grid, NOW + 29_999., deadline())
        .await
        .unwrap();
    same(
        &docs_json(&before),
        &expected,
        "bounded observation interval",
    );
    let after = source
        .grid_answer(Family::Current, grid, NOW + 30_000., deadline())
        .await
        .unwrap();
    assert_ne!(docs_json(&after), expected);
    assert!(after.iter().any(
        |d| matches!(d.get("currentData").and_then(|v|v.as_doc()).and_then(|v|v.get("t1h")),Some(server2::domestic::kma::source::Val::Num(n)) if *n==31.5)
    ));
    assert_eq!(source.forecast_cache_stats().folds, 2);
    let renewals = source.forecast_cache_stats().identity_renewals;
    reqwest::Client::new()
        .post(format!(
            "{}/__catalog?mode=bad-list&key=owned",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(
        source
            .grid_answer(Family::Current, grid, NOW + 60_000., deadline())
            .await
            .is_err()
    );
    assert_eq!(source.forecast_cache_stats().identity_renewals, renewals);
    assert_eq!(providers.0.load(SeqCst), 0);
}
fn stored_view_path(peer: &Peer, root: &std::path::Path) -> std::path::PathBuf {
    let namespace = format!(
        "raw-cache-v1\n{}\nserver2-local\nap-northeast-2",
        peer.endpoint()
    );
    let key = format!("forecast-view-v1/{}", sha256(b"Grid(Current, 60, 127)"));
    root.join(sha256(namespace.as_bytes()))
        .join(format!("{}.raw", sha256(key.as_bytes())))
}
fn rehash_local(bytes: &mut [u8]) {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(&bytes[52..]);
    bytes[20..52].copy_from_slice(&digest);
}
#[tokio::test]
async fn disk_faults_and_changed_s3_identity_rebuild_identical_docs_under_the_cap() {
    let _serial = S3_PEERS.lock().await;
    let Fixture {
        peer,
        source,
        expected,
        providers,
    } = fixture().await;
    drop(source);
    let root = std::env::temp_dir().join(format!("server2-2850-faults-{}", std::process::id()));
    assert!(!root.exists());
    let grid = Grid::new(60, 127).unwrap();
    let (s, d) = disk_source(&peer, &root, providers.clone());
    s.grid_answer(Family::Current, grid, NOW, deadline())
        .await
        .unwrap();
    assert!(d.idle(deadline()).await);
    drop(s);
    drop(d);
    let path = stored_view_path(&peer, &root);
    assert!(path.is_file());
    for fault in ["hash", "truncate", "key", "schema", "identities"] {
        let mut bytes = std::fs::read(&path).unwrap();
        let header = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let body = 52 + header;
        match fault {
            "hash" => *bytes.last_mut().unwrap() ^= 1,
            "truncate" => {
                bytes.pop();
            }
            "schema" => {
                bytes[body + 7] = b'2';
                rehash_local(&mut bytes);
            }
            "key" => {
                let start = body + 8 + 4;
                assert_eq!(&bytes[start..start + 7], b"Grid(Cu");
                let at = bytes[start..].windows(2).position(|v| v == b"60").unwrap() + start;
                bytes[at + 1] = b'1';
                rehash_local(&mut bytes);
            }
            "identities" => {
                let n = bytes.len() - 1;
                bytes[n] = if bytes[n] == b'0' { b'1' } else { b'0' };
                rehash_local(&mut bytes);
            }
            _ => unreachable!(),
        }
        std::fs::write(&path, bytes).unwrap();
        let (s, d) = disk_source(&peer, &root, providers.clone());
        let answer = s
            .grid_answer(Family::Current, grid, NOW, deadline())
            .await
            .unwrap();
        same(&docs_json(&answer), &expected, fault);
        assert_eq!(s.forecast_cache_stats().disk_restores, 0, "{fault}");
        assert_eq!(s.forecast_cache_stats().folds, 1, "{fault}");
        assert!(d.idle(deadline()).await);
        drop(s);
        drop(d);
    }
    newer_current(&peer).await;
    let (s, d) = disk_source(&peer, &root, providers.clone());
    let changed = s
        .grid_answer(Family::Current, grid, NOW + 30_000., deadline())
        .await
        .unwrap();
    assert_ne!(docs_json(&changed), expected);
    assert_eq!(s.forecast_cache_stats().disk_restores, 0);
    assert_eq!(s.forecast_cache_stats().folds, 1);
    assert!(d.idle(deadline()).await);
    drop(s);
    drop(d);
    // A pre-existing entry larger than a lowered cap must be evicted on open.
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.resize(16384, 0);
    std::fs::write(&path, bytes).unwrap();
    let (s, d) = disk_source_with_cap(&peer, &root, providers.clone(), 4096);
    let answer = s
        .grid_answer(Family::Current, grid, NOW + 30_000., deadline())
        .await
        .unwrap();
    same(
        &docs_json(&answer),
        &docs_json(&changed),
        "over-cap fallback",
    );
    assert_eq!(s.forecast_cache_stats().disk_restores, 0);
    assert!(d.idle(deadline()).await);
    assert!(d.metrics().bytes <= 4096);
    assert!(d.metrics().evictions > 0);
    drop(s);
    drop(d);
    std::fs::remove_dir_all(root).unwrap();
}
