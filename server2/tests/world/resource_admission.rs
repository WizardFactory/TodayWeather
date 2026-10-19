//! Actual resource-aware world composition; standalone constructors retain their contract.
use server2::{
    gateway::BoxFuture, operational_metrics::CpuKind, runtime_resources::CpuAdmission, world::*,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
#[derive(Default)]
struct LocalVc(AtomicUsize);
impl VcSource for LocalVc {
    fn fetch(&self, _: Cell, _: Range, _: Instant) -> BoxFuture<'_, Result<Vec<u8>, VcError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(VcError::LocalCapacity) })
    }
}
#[tokio::test]
async fn local_capacity_has_only_two_second_cell_cooldown_not_provider_penalty() {
    let clock = Arc::new(FixedClock::new(1792411200000.));
    let vc = Arc::new(LocalVc::default());
    let world = World::new(
        Arc::new(MemoryWorldStore::default()),
        vc.clone(),
        Arc::new(Unconfigured),
        clock.clone(),
        WorldConfig::default(),
    );
    let call = || {
        world.records(
            37.5,
            127.0,
            world.now_ms(),
            Instant::now() + Duration::from_secs(1),
        )
    };
    assert!(call().await.is_err());
    assert_eq!(vc.0.load(Ordering::SeqCst), 1);
    clock.set(world.now_ms() + 1000.);
    assert!(call().await.is_err());
    assert_eq!(vc.0.load(Ordering::SeqCst), 1);
    clock.set(world.now_ms() + 1001.);
    assert!(call().await.is_err());
    assert_eq!(vc.0.load(Ordering::SeqCst), 2);
    assert_eq!(world.metrics().provider_failures.load(Ordering::Relaxed), 0);
    assert_eq!(
        world.metrics().publication_failures.load(Ordering::Relaxed),
        0
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_restore_cpu_refusal_does_not_fund_or_install_local_cooldown() {
    let cpu = CpuAdmission::new(1);
    let (start, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let held = cpu.clone();
    let blocker = tokio::spawn(async move {
        held.immediate(CpuKind::Foundation, move || {
            let _ = start.send(());
            let _ = wait.recv();
        })
        .await
    });
    ready.await.unwrap();
    let vc = Arc::new(LocalVc::default());
    let world = World::new_with_cpu(
        Arc::new(MemoryWorldStore::default()),
        vc.clone(),
        Arc::new(Unconfigured),
        Arc::new(FixedClock::new(1792411200000.)),
        WorldConfig {
            load: Duration::from_millis(100),
            ..Default::default()
        },
        Some(cpu),
    );
    assert!(
        world
            .records(
                37.5,
                127.,
                world.now_ms(),
                Instant::now() + Duration::from_secs(1)
            )
            .await
            .is_err()
    );
    assert_eq!(vc.0.load(Ordering::SeqCst), 0);
    release.send(()).unwrap();
    assert!(blocker.await.unwrap().is_ok());
    assert!(
        world
            .records(
                37.5,
                127.,
                world.now_ms(),
                Instant::now() + Duration::from_secs(1)
            )
            .await
            .is_err()
    );
    assert_eq!(
        vc.0.load(Ordering::SeqCst),
        1,
        "cold CPU refusal cannot mark provider/cell down"
    );
}
struct EmptyS3;
impl server2::storage::ObjectTransport for EmptyS3 {
    async fn put(
        &self,
        _: &server2::storage::PreparedRecord,
    ) -> Result<u16, server2::storage::Error> {
        panic!("read-only restore")
    }
    async fn head(&self, _: &str) -> Result<server2::storage::Object, server2::storage::Error> {
        Err(server2::storage::Error::NotFound)
    }
    async fn get(
        &self,
        _: &str,
        _: usize,
    ) -> Result<server2::storage::Object, server2::storage::Error> {
        Err(server2::storage::Error::NotFound)
    }
}
impl server2::storage::CatalogTransport for EmptyS3 {
    async fn get_control(
        &self,
        _: &str,
        _: usize,
    ) -> Result<server2::storage::ControlObject, server2::storage::Error> {
        Err(server2::storage::Error::NotFound)
    }
    async fn put_control(
        &self,
        _: &str,
        _: &[u8],
        _: &server2::storage::WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        panic!("empty restore writes nothing")
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        Ok(br#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>"#.to_vec())
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn default_world_fanout_four_progresses_under_process_cpu_two() {
    let cpu = CpuAdmission::new(2);
    let store = CatalogWorldStore::new_with_cpu(
        EmptyS3,
        server2::storage::CatalogLimits::default(),
        Some(cpu.clone()),
    )
    .unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        store.load(
            Cell::of(37.5, 127.).unwrap(),
            1792411200000.,
            Instant::now() + Duration::from_secs(2),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(result.is_empty());
    assert_eq!(cpu.available(), 2);
}

#[tokio::test(start_paused = true)]
async fn default_cold_owner_reports_actual_cpu_budget_at_caller_deadline() {
    const CHILD: &str = "SERVER2_TEST_CPU_OBSERVER_CHILD";
    if std::env::var_os(CHILD).is_none() {
        for mode in ["memory", "catalog"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "resource_admission::default_cold_owner_reports_actual_cpu_budget_at_caller_deadline", "--nocapture"])
                .env(CHILD, mode).output().unwrap();
            assert!(
                output.status.success(),
                "{mode} child: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let stderr = String::from_utf8_lossy(&output.stderr);
            let caller_prefix = stderr.split("CALLER_DEADLINE_OBSERVED").next().unwrap();
            let typed = caller_prefix
                .lines()
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
                .any(|e| {
                    e["component"] == "world"
                        && e["cause"] == "capacity"
                        && e["action"] == "return_error"
                });
            assert!(stderr.contains("CALLER_DEADLINE_OBSERVED"));
            assert!(
                typed,
                "{mode}: caller result must be typed before the later owner timeout: {stderr}"
            );
        }
        return;
    }
    let cpu = CpuAdmission::new(1);
    let (start, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let held = cpu.clone();
    let blocker = tokio::spawn(async move {
        held.immediate(CpuKind::Foundation, move || {
            let _ = start.send(());
            let _ = wait.recv();
        })
        .await
    });
    ready.await.unwrap();
    let vc = Arc::new(LocalVc::default());
    let store: Arc<dyn WorldStore> = if std::env::var(CHILD).unwrap() == "catalog" {
        Arc::new(
            CatalogWorldStore::new_with_cpu(
                EmptyS3,
                server2::storage::CatalogLimits::default(),
                Some(cpu.clone()),
            )
            .unwrap(),
        )
    } else {
        Arc::new(MemoryWorldStore::default())
    };
    let world = World::new_with_cpu(
        store,
        vc.clone(),
        Arc::new(Unconfigured),
        Arc::new(FixedClock::new(1792411200000.)),
        WorldConfig::default(),
        Some(cpu.clone()),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    let owned = world.clone();
    let call =
        tokio::spawn(async move { owned.records(37.5, 127., owned.now_ms(), deadline).await });
    while !cpu
        .render()
        .lines()
        .any(|l| l.starts_with("server2_cpu_pool_queued ") && l != "server2_cpu_pool_queued 0")
    {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(Duration::from_secs(3)).await;
    assert!(call.await.unwrap().is_err());
    assert_eq!(vc.0.load(Ordering::SeqCst), 0);
    assert!(server2::observability::flush(Duration::from_millis(100)));
    eprintln!("CALLER_DEADLINE_OBSERVED");
    if std::env::var(CHILD).unwrap() == "memory" {
        assert!(
            cpu.render()
                .lines()
                .any(|l| l.starts_with("server2_cpu_pool_queued ")
                    && l != "server2_cpu_pool_queued 0"),
            "the eight-second memory owner outlives this three-second caller"
        );
    }
    // CatalogLimits independently bounds each control operation at three seconds.
    // The catalog and caller timers became ready together; its typed cause above must
    // survive even when that narrower operation has already retired at this point.

    tokio::time::advance(Duration::from_secs(5)).await;
    while !cpu
        .render()
        .lines()
        .any(|l| l == "server2_cpu_pool_queued 0")
    {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        vc.0.load(Ordering::SeqCst),
        0,
        "owner expiry cannot fund a provider"
    );
    release.send(()).unwrap();
    assert!(blocker.await.unwrap().is_ok());
    while cpu.available() != 1
        || cpu
            .render()
            .lines()
            .any(|l| l == "server2_cpu_pool_queued 1")
    {
        tokio::task::yield_now().await;
    }
    assert!(
        world
            .records(
                37.5,
                127.,
                world.now_ms(),
                Instant::now() + Duration::from_secs(3)
            )
            .await
            .is_err()
    );
    assert_eq!(
        vc.0.load(Ordering::SeqCst),
        1,
        "no cooldown from the unfunded cold load"
    );
    assert!(server2::observability::flush(Duration::from_millis(100)));
}
