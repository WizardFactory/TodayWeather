//! Real loopback S3 transport; no provider/AWS credentials or live endpoints.
use rusty_s3::Credentials;
use serde_json::{Value, json};
use server2::{
    budget::{BudgetError, Clock},
    domestic::kma::{recalculate_nation_air, source::air_input::AirInputs},
    gateway::OrderedJson,
    storage::{
        CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
        Pagination, Period, ProviderKey, RawRecord,
    },
    world::BoundedS3,
};
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::time::Instant;
struct Fixed(i64);
impl Clock for Fixed {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.0)
    }
}
struct Peer(std::process::Child, String);
impl Peer {
    fn new() -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.starts_with("http://127.0.0.1:"));
        Self(child, line.trim().into())
    }
    fn transport(&self) -> BoundedS3<HttpS3Transport> {
        BoundedS3::new(
            HttpS3Transport::new(
                &self.1,
                "server2-local",
                "ap-northeast-2",
                Credentials::new("server2-local", "server2-local-secret"),
            )
            .unwrap(),
            4,
        )
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
async fn publish(
    store: &CatalogStore<BoundedS3<HttpS3Transport>>,
    kind: &str,
    key: &str,
    partition: &str,
    now: f64,
    items: Vec<Value>,
) {
    let limits = CatalogLimits::default();
    let body = serde_json::to_vec(&json!({"response":{"body":{"items":items}}})).unwrap();
    let record = RawRecord::new(
        "data-go-kr",
        kind,
        &ProviderKey::Named { id: key.into() },
        Period {
            local_date: 20261016,
            slot: "0900".into(),
        },
        now as u64,
        200,
        "application/json",
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true,
        }),
        body.into(),
        &limits.raw,
    )
    .unwrap();
    let declaration = GroupDeclaration::new(
        vec![GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, partition).unwrap()],
        }],
        &limits,
    )
    .unwrap();
    store
        .publish(
            declaration,
            vec![record],
            Instant::now() + Duration::from_secs(20),
        )
        .await
        .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_memory_nation_projection_restores_from_shared_national_s3_records_without_providers()
{
    eprintln!("S17c stage: peer startup");
    let peer = Peer::new();
    eprintln!("S17c stage: peer started");
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let oracle: Value = serde_json::from_str(include_str!("oracle.json")).unwrap();
    let case = oracle["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "all-provinces")
        .unwrap();
    let now =
        server2::world::vc::parse_iso_z(&oracle["now"].as_str().unwrap().replace(".000Z", "Z"));
    let mut national = case["nationwideInputs"].as_array().unwrap().clone();
    let stations=national.iter().map(|r|json!({"stationName":r["stationName"],"dmX":"37.5","dmY":"127","addr":if r["sidoName"]=="광주"{"광주광역시 북구"}else{"전라남도 목포시"}})).collect();
    for row in &mut national {
        if row["sidoName"] == "광주" || row["sidoName"] == "전남" {
            row["sidoName"] = json!("전남광주");
        }
    }
    eprintln!("S17c stage: publish");
    publish(
        &store,
        "airkorea-station-list",
        "stations",
        "20261016",
        now - 60_000.,
        stations,
    )
    .await;
    eprintln!("S17c stage: publish");
    publish(
        &store,
        "airkorea-station",
        "sido-nationwide",
        "20261016-0900",
        now - 60_000.,
        national,
    )
    .await;
    eprintln!("S17c stage: published");
    let expected = OrderedJson::parse(case["body"].as_str().unwrap().as_bytes()).unwrap();
    for _ in 0..2 {
        // Entirely new input source: provider disabled and no memo or process memory survives.
        let inputs = AirInputs::new(transport.clone(), store.clone())
            .with_clock(Arc::new(Fixed(now as i64)));
        eprintln!("S17c stage: nation request");
        let answer = inputs
            .nation(now, Instant::now() + Duration::from_secs(3))
            .await;
        eprintln!("S17c stage: nation ready {}", answer.rows.len());
        let rows = answer
            .rows
            .iter()
            .map(|r| recalculate_nation_air(r, &server2::nation::text("airkorea")).unwrap())
            .collect();
        assert_eq!(
            OrderedJson::Array(rows).to_bytes(),
            expected.get("air").unwrap().to_bytes()
        );
        assert_eq!(
            answer.status.to_bytes(),
            expected.get("airStatus").unwrap().to_bytes()
        );
    }
}

struct Fallback;
impl server2::world::AirSource for Fallback {
    fn current(
        &self,
        lat: f64,
        _: f64,
        _: f64,
    ) -> server2::gateway::BoxFuture<'_, server2::world::AirOutcome> {
        Box::pin(async move {
            if lat != 37.5665 {
                return server2::world::AirOutcome::None;
            }
            server2::world::AirOutcome::Observation(server2::world::air::Observation {
                provider: "openweather".into(),
                station_based: false,
                observed_at: Some("2026-10-16T00:00:00.000Z".into()),
                pollutants: vec![("pm10", 25.), ("pm25", 12.)],
                attribution: server2::world::js::Val::Str("OpenWeather".into()),
                station_name: None,
                station_geo: None,
            })
        })
    }
    fn current_with_reason(
        &self,
        lat: f64,
        lon: f64,
        now: f64,
    ) -> server2::gateway::BoxFuture<'_, (server2::world::AirOutcome, Option<&'static str>)> {
        Box::pin(async move {
            let outcome = self.current(lat, lon, now).await;
            let reason = if matches!(outcome, server2::world::AirOutcome::None) {
                Some("no-provider")
            } else {
                None
            };
            (outcome, reason)
        })
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_national_records_use_legacy_labelled_fallback_and_safe_status_reasons() {
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let oracle: Value = serde_json::from_str(include_str!("oracle.json")).unwrap();
    let now =
        server2::world::vc::parse_iso_z(&oracle["now"].as_str().unwrap().replace(".000Z", "Z"));
    for (id, air) in [
        ("empty-no-provider", None),
        (
            "representative",
            Some(Arc::new(Fallback) as Arc<dyn server2::world::AirSource>),
        ),
    ] {
        let inputs = AirInputs::new(transport.clone(), store.clone())
            .with_clock(Arc::new(Fixed(now as i64)))
            .with_air(air);
        let answer = inputs
            .nation(now, Instant::now() + Duration::from_secs(3))
            .await;
        let case = oracle["scenarios"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap();
        let expected = OrderedJson::parse(case["body"].as_str().unwrap().as_bytes()).unwrap();
        let rows = answer
            .rows
            .iter()
            .map(|r| recalculate_nation_air(r, &server2::nation::text("airkorea")).unwrap())
            .collect();
        assert_eq!(
            OrderedJson::Array(rows).to_bytes(),
            expected.get("air").unwrap().to_bytes(),
            "{id}"
        );
        assert_eq!(
            answer.status.to_bytes(),
            expected.get("airStatus").unwrap().to_bytes(),
            "{id}"
        );
    }
}

struct SlowAcquirer {
    store: Arc<CatalogStore<BoundedS3<HttpS3Transport>>>,
    calls: Arc<std::sync::atomic::AtomicUsize>,
    done: Arc<tokio::sync::Notify>,
    now: f64,
}
impl server2::domestic::kma::source::live::AirKoreaAcquire for SlowAcquirer {
    fn acquire(
        &self,
        request: server2::domestic::airkorea::AirKoreaRequest,
    ) -> server2::gateway::BoxFuture<'static, Result<Option<Period>, String>> {
        assert_eq!(
            request.operation(),
            server2::domestic::airkorea::AirKoreaOperation::Station
        );
        let (store, calls, done, now) = (
            self.store.clone(),
            self.calls.clone(),
            self.done.clone(),
            self.now,
        );
        Box::pin(async move {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(3200)).await;
            publish(&store,"airkorea-station","sido-nationwide","20261016-0900",now,vec![json!({"stationName":"서울-1","sidoName":"서울","mangName":"도시대기","dataTime":"2026-10-16 09:00","pm10Value":"23"})]).await;
            done.notify_one();
            Ok(Some(Period {
                local_date: 20261016,
                slot: "0900".into(),
            }))
        })
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_nation_requests_share_one_late_national_acquisition_and_next_request_uses_it() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let peer = Peer::new();
    let transport = peer.transport();
    let store = Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let now = server2::history::schedule::to_ms(
        server2::domestic::publication::Publication::new(20261016, 910).unwrap(),
    ) as f64;
    publish(
        &store,
        "airkorea-station-list",
        "stations",
        "20261016",
        now - 60_000.,
        vec![json!({"stationName":"서울-1","dmX":"37.5","dmY":"127","addr":"서울특별시"})],
    )
    .await;
    let calls = Arc::new(AtomicUsize::new(0));
    let done = Arc::new(tokio::sync::Notify::new());
    let inputs = Arc::new(
        AirInputs::new(transport.clone(), store.clone())
            .with_clock(Arc::new(Fixed(now as i64)))
            .with_acquire(Some(Arc::new(SlowAcquirer {
                store,
                calls: calls.clone(),
                done: done.clone(),
                now,
            }))),
    );
    let started = Instant::now();
    let mut jobs = tokio::task::JoinSet::new();
    for _ in 0..12 {
        let inputs = inputs.clone();
        jobs.spawn(async move {
            inputs
                .nation(now, Instant::now() + Duration::from_secs(3))
                .await
        });
    }
    while let Some(result) = jobs.join_next().await {
        assert!(result.unwrap().rows.is_empty());
    }
    assert!(started.elapsed() < Duration::from_millis(3250));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tokio::time::timeout(Duration::from_secs(3), done.notified())
        .await
        .unwrap();
    let next = inputs
        .nation(now, Instant::now() + Duration::from_secs(3))
        .await;
    assert_eq!(next.rows.len(), 1);
    assert_eq!(next.rows[0].get("pm10Value").unwrap().number(), Some(23.));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
