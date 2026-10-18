//! Owned HTTP fixture only. Fixed domain time is not a real five-minute throughput claim.
use super::{
    common::{GoogleDouble, Recorder, fcm, temp_dir},
    state_common::{FixedClock, OracleIds, ms},
};
use rusty_s3::Credentials;
use server2::{
    gateway::BoxFuture,
    push::{
        Coll, PushConfig, PushService, Record,
        deliver::{
            warning_feed::WarningFeed,
            warnings::{Locations, WarningWorker},
        },
        durable::{Commit, Counters, Durable, DurableConfig},
        store::Change,
    },
    storage::{CatalogLimits, HttpS3Transport},
    warnings::{
        StoreConfig, WarningStore,
        provider::{Operation, Page},
        records::{
            LEGACY_ZONE_ROLE, Member, SEED_DATE, ZONE_KIND, ZONE_SEED_KIND, members_from_pages,
        },
    },
    world::js::{Obj, Val},
};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant as WallInstant},
};
use tokio::time::Instant;

struct Peer {
    child: Child,
    endpoint: String,
}
impl Peer {
    fn new() -> Self {
        let mut child = Command::new("python3")
            .args([
                "tests/storage/catalog_peer.py",
                "--persistent",
                "--fanout-capacity",
            ])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let out = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let r = BufReader::new(out).read_line(&mut line).map(|_| line);
            let _ = tx.send(r);
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(line)) if line.starts_with("http://127.0.0.1:") => Self {
                child,
                endpoint: line.trim().into(),
            },
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("owned fanout peer startup");
            }
        }
    }
    fn transport(&self) -> HttpS3Transport {
        HttpS3Transport::new(
            &self.endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap()
    }
    async fn counts(&self) -> BTreeMap<String, u64> {
        serde_json::from_slice(
            &reqwest::Client::new()
                .get(format!("{}__catalog/status", self.endpoint))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap()
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
struct KnownTown(AtomicUsize);
impl Locations for KnownTown {
    fn zones<'a>(&'a self, _: &'a Obj, _: i64) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(vec!["L1010100".into()]) })
    }
}
fn event() -> serde_json::Value {
    serde_json::json!({"areaCode":"L1010100","areaName":"Synthetic Seoul","warnVar":2,"warnStress":0,"command":"1","cancel":"0","tmFc":202610161000u64,"tmSeq":1,"endTime":0,"allEndTime":0})
}
fn registration(n: usize) -> Record {
    let mut doc = Obj::new();
    for (k, v) in [
        ("fcmToken", format!("synthetic-fanout-{n:05}")),
        ("package", "todayWeather".into()),
        ("lang", "ko".into()),
        ("type", "ios".into()),
        ("town", "Synthetic shared town".into()),
    ] {
        doc.set(k, v);
    }
    doc.set("cityIndex", n as f64);
    doc.set("enable", true);
    doc.set("startTime", 0.);
    doc.set("endTime", 86399.);
    doc.set("reverseTime", false);
    let mut precip = Obj::new();
    precip.set("pushTime", Val::Date(ms("2026-10-16T01:01:00Z") as f64));
    doc.set("precipAlerts", Val::Obj(precip));
    let mut oid = [0x35; 12];
    oid[4..].copy_from_slice(&(n as u64).to_be_bytes());
    Record { oid, doc }
}
fn delta(a: &BTreeMap<String, u64>, b: &BTreeMap<String, u64>) -> BTreeMap<String, u64> {
    b.iter()
        .filter_map(|(k, v)| {
            let d = v
                .checked_sub(*a.get(k).unwrap_or(&0))
                .expect("monotonic peer counters");
            (d > 0
                && (k.starts_with("OP ") || k.starts_with("BODYIN ") || k.starts_with("BODYOUT ")))
            .then(|| (k.clone(), d))
        })
        .collect()
}
fn category(operation: &str) -> &'static str {
    // This isolated fixture publishes only S12 acquisition groups: their immutable
    // descriptor keys are content-addressed and omit the source name.
    if operation.contains("kma-warning/") || operation.contains("index/v2/groups/") {
        "s12"
    } else if operation.contains("push/warning-feed/") {
        "feed"
    } else if operation.contains("push/delivery/warning/") {
        "ledger"
    } else if operation.contains("push/") {
        "journal"
    } else {
        "other"
    }
}
fn summary(d: &BTreeMap<String, u64>) -> serde_json::Value {
    let mut out: BTreeMap<String, u64> = BTreeMap::new();
    for (k, n) in d {
        let (kind, operation) = k.split_once(' ').unwrap();
        let metric = match kind {
            "OP" => "requests",
            "BODYIN" => "consumed_request_body_bytes",
            "BODYOUT" => "written_response_body_bytes",
            _ => unreachable!(),
        };
        *out.entry(format!("{}.{}", category(operation), metric))
            .or_default() += n;
        *out.entry(format!("total.{metric}")).or_default() += n;
    }
    serde_json::to_value(out).unwrap()
}
fn report(p: &server2::push::deliver::warnings::PollReport) -> serde_json::Value {
    serde_json::json!({"selected":p.selected,"attempted":p.attempted,"accepted":p.accepted,"skipped":p.skipped,"failed":p.failed})
}

/// Full transport boundary, including registration journal. No native geocoder claim:
/// KnownTown is a counted synthetic location adapter; separate regressions cover ApiLocations.
pub async fn run(recipients: usize) -> serde_json::Value {
    assert!((1..=5000).contains(&recipients));
    let elapsed = WallInstant::now();
    let peer = Peer::new();
    let transport = Arc::new(peer.transport());
    let clock = FixedClock::at("2026-10-16T01:02:00Z");
    let now = ms("2026-10-16T01:02:00Z");
    let records = (0..recipients).map(registration).collect::<Vec<_>>();
    let mut durable = Durable::new(
        transport.clone(),
        DurableConfig::default(),
        Arc::new(Counters::default()),
    );
    let restored = durable.restore().await.unwrap();
    assert_eq!(restored.seq, 0);
    for (chunk_i, chunk) in records.chunks(500).enumerate() {
        let start = chunk_i * 500;
        let changes = chunk
            .iter()
            .enumerate()
            .map(|(i, rec)| Change {
                coll: Coll::Alert,
                n: (start + i) as u64,
                oid: rec.oid,
                record: Some(rec.clone()),
                imported: None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            durable
                .commit((chunk_i + 1) as u64, &changes, (start + chunk.len()) as u64)
                .await,
            Commit::Committed
        );
    }
    let push = PushService::start(
        transport.clone(),
        clock.clone(),
        Box::new(OracleIds(0)),
        PushConfig::default(),
    );
    tokio::time::timeout(Duration::from_secs(20), async {
        while !push.ready() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("actual HTTP registration restore");
    let store = Arc::new(
        WarningStore::new(
            peer.transport(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let seed = serde_json::json!([{"areaCode":"_sync","lastSyncAt":"2026-10-16T01:02:00Z","oldestSyncedTmFc":"19700101"}]);
    store
        .publish(
            ZONE_SEED_KIND,
            SEED_DATE,
            vec![Member {
                role: LEGACY_ZONE_ROLE.into(),
                bytes: serde_json::to_vec(&seed).unwrap().into(),
                fetched_at_ms: now as u64,
            }],
            Instant::now() + Duration::from_secs(9),
        )
        .await
        .unwrap();
    for date in [20261014, 20261015, 20261016] {
        let rows = if date == 20261016 {
            vec![event()]
        } else {
            vec![]
        };
        let body=serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":rows}}}})).unwrap();
        let page = Page {
            operation: Operation::PwnCd,
            body: body.into(),
            fetched_at_ms: now as u64,
            items: rows,
        };
        store
            .publish(
                ZONE_KIND,
                date,
                members_from_pages(&[page]),
                Instant::now() + Duration::from_secs(9),
            )
            .await
            .unwrap();
    }
    let google = GoogleDouble::start().await;
    let fcm = Arc::new(fcm(&google, &temp_dir("warning-fanout-http")));
    let locations = Arc::new(KnownTown::default());
    let feed = Arc::new(WarningFeed::new(transport.clone(), clock.clone()));
    feed.publish(&[]).await.unwrap();
    let worker = WarningWorker::new(
        push,
        transport,
        feed.clone(),
        store.clone(),
        locations.clone(),
        fcm,
        clock,
        Arc::new(Recorder::default()),
    );
    assert_eq!(worker.poll().await.unwrap().attempted, 0);
    feed.publish(&[event()]).await.unwrap();
    let a = peer.counts().await;
    let sampled = store
        .zone_state(now, Instant::now() + Duration::from_secs(4))
        .await
        .unwrap();
    assert!(
        sampled
            .entries()
            .any(|x| x.area_code == "L1010100" && x.active)
    );
    let b = peer.counts().await;
    let sample = delta(&a, &b);
    let first = worker.poll().await.unwrap();
    let c = peer.counts().await;
    assert_eq!(
        first.accepted, recipients,
        "complete outcome required; savings cannot hide drops"
    );
    assert_eq!(google.sends().len(), recipients);
    let first_delta = delta(&b, &c);
    let repeated = worker.poll().await.unwrap();
    let d = peer.counts().await;
    assert_eq!(repeated.attempted, 0);
    assert_eq!(google.sends().len(), recipients);
    let repeat_delta = delta(&c, &d);
    let result_keys = c
        .keys()
        .filter_map(|k| k.strip_prefix("OP PUT "))
        .filter(|k| k.contains("push/delivery/warning/") && k.ends_with(".result.json"))
        .collect::<Vec<_>>();
    let claim_keys = c
        .keys()
        .filter_map(|k| k.strip_prefix("OP PUT "))
        .filter(|k| k.contains("push/delivery/warning/") && !k.ends_with(".result.json"))
        .count();
    assert_eq!(claim_keys, recipients);
    assert_eq!(result_keys.len(), recipients);
    let client = reqwest::Client::new();
    for key in result_keys {
        let res = client
            .get(format!("{}server2-local/{key}", peer.endpoint))
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16(), 200);
        let body: serde_json::Value = serde_json::from_slice(&res.bytes().await.unwrap()).unwrap();
        assert_eq!(body["outcome"], "accepted");
    }
    let verified = peer.counts().await;
    serde_json::json!({"scope":"owned synthetic HTTP only; no AWS/native geocode/provider/device telemetry","recipients":recipients,"fixed_domain_time":"2026-10-16T01:02:00Z","wall_elapsed_ms":elapsed.elapsed().as_millis(),"seed":"complete synthetic _sync; replay20261014..20261016, not60day worst case","peer_capacity":{"objects":16384,"stored_bytes":67108864,"connections":16,"socket_seconds":2},"s3_endpoint":peer.endpoint,"oauth_fcm_endpoint":google.root,"single_zone_acquisition":summary(&sample),"first":report(&first),"first_transport":summary(&first_delta),"repeated":report(&repeated),"repeated_transport":summary(&repeat_delta),"verified_accepted_result_objects":recipients,"unique_claims":claim_keys,"location_adapter_calls":locations.0.load(Ordering::SeqCst),"oauth_calls":google.tokens().len(),"owned_fcm_posts":google.sends().len(),"verification_reads":summary(&delta(&d,&verified)),"byte_scope":"consumed request bodies and successfully written response bodies; headers excluded, chunk framing only if fault mode enabled; no partial socket-error wire-byte claim","raw_counter_deltas":{"sample":sample,"first":first_delta,"repeated":repeat_delta}})
}
