//! Explicit operator operations. Construction/preview never performs an S3 request.
//! This module is included only by the declared operator/owned-smoke example.
use server2::{
    domestic::kma::source::{
        rainfall_store::{Activation, Checkpoint, Namespace, Store},
        seed,
    },
    storage::S3Settings,
};
use std::{io::Read, path::Path, time::Duration};
use tokio::time::Instant;
fn bounded(path: &Path) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 1024 * 1024 {
        return Err("operator input exceeds1MiB".into());
    }
    Ok(bytes)
}
pub async fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let usage = "usage: rainfall_handover_smoke preview|activate SEED ACTIVATION_JSON; verify SEED";
    let operation = args.first().ok_or(usage)?;
    if !matches!(operation.as_str(), "preview" | "activate" | "verify") {
        return Err(usage.into());
    }
    if args.len() != if operation == "verify" { 2 } else { 3 } {
        return Err(usage.into());
    }
    let settings = S3Settings::from_vars(&|k| std::env::var(k).ok())?;
    let target = Namespace::new(settings.bucket.clone(), settings.region.clone())?;
    let bytes = bounded(Path::new(&args[1]))?;
    let seed = seed::parse(&bytes)?;
    if operation == "verify" {
        let transport = server2::world::BoundedS3::new(settings.transport()?, 4);
        let catalog = server2::storage::CatalogStore::new(
            transport.clone(),
            server2::storage::CatalogLimits::default(),
        )?;
        let store = Store { transport, target };
        let candidate_sha256 = server2::storage::sha256(&bytes);
        let (state, object, restored) = store
            .resolve(
                std::sync::Arc::new(seed),
                &catalog,
                Instant::now() + Duration::from_secs(3),
            )
            .await?
            .ok_or("authority absent")?;
        println!(
            "{}",
            serde_json::json!({"operation":"verify","revision":state.revision,
            "checkpoint_sha256":server2::storage::sha256(&object.body),"bytes":object.body.len(),"rows":state.rows.len(),
            "candidate_seed_sha256":candidate_sha256,"authority_seed_sha256":state.activation.seed_body_sha256,
            "seed_restored":restored.exported_at_ms==state.activation.seed_exported_at_ms && candidate_sha256!=state.activation.seed_body_sha256})
        );
        return Ok(());
    }
    let activation: Activation = serde_json::from_slice(&bounded(Path::new(&args[2]))?)?;
    let state = Checkpoint::initial(activation, &seed, &target)?;
    let body = state.encode()?;
    if operation == "preview" {
        // Exact bytes reviewed here are encoded by the same schema used for conditional PUT.
        println!("{}", String::from_utf8(body)?);
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();
    if now < u128::from(state.activation.shutdown_at_ms) {
        return Err("shutdown is in the future".into());
    }
    let store = Store {
        transport: settings.transport()?,
        target,
    };
    store
        .activate(&state, &seed, Instant::now() + Duration::from_secs(3))
        .await?;
    println!(
        "{}",
        serde_json::json!({"operation":"activate","acknowledged":true,"revision":1,"checkpoint_sha256":server2::storage::sha256(&body),"bytes":body.len()})
    );
    Ok(())
}

/// Owned loopback proof uses the actual Gateway/DirectRoutes/KmaBackend TCP request path.
/// It does not construct RuntimeServices/process listeners or exercise production signals.
pub mod owned {
    use serde_json::{Value, json};
    use server2::{
        domestic::{
            Acquired, DomesticError,
            kma::{
                AssemblyConfig,
                backend::{Clock, KmaBackend},
                source::{
                    S3Source, Val,
                    observe::{Acquire, Locate},
                    pages,
                    rainfall_store::{Checkpoint, Namespace, Store},
                    seed,
                    stations::RowStore,
                },
            },
            publication::Publication,
        },
        gateway::{BackendDispatcher, BoxFuture, Gateway, GatewayError, Geocoder},
        history::{Grid, schedule},
        storage::{
            CatalogId, CatalogLimits, CatalogStore, CatalogTransport, GroupDeclaration,
            GroupMember, HttpS3Transport, ProviderKey, RawRecord, WriteCondition, sha256,
        },
        world::BoundedS3,
    };
    use std::{sync::Arc, time::Duration};
    use tokio::time::Instant;
    type Transport = BoundedS3<HttpS3Transport>;
    fn deadline() -> Instant {
        Instant::now() + Duration::from_secs(20)
    }
    const DAY: u32 = 20261017;
    const OID: &str = "000000000000000000000108";
    const STATE_KEY: &str = "index/v2/statistics/rns/state.json";
    const POLICY: &str = "flat-minute-rnshit-v1";
    const SEED_ADDRESS: &str = "owned-rainfall-2819-seoul";

    // Diagnostic-only owned-example seam. No library observer or production mode is added.
    mod diagnostic {
        use super::*;
        use server2::domestic::kma::{
            DbVersion, KmaRequest, KmaStore, MidModel, Outcome, StoreResult, TownModel,
            backend::{KmaSource, SourceAnswer},
        };
        use server2::storage::{ControlObject, Error, Object, ObjectTransport, PreparedRecord};
        use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering};

        const REQUESTS: usize = 16;
        const IOS: usize = 64;
        #[derive(Clone, Copy)]
        #[repr(usize)]
        enum Event {
            PublicEnter,
            PublicReturn,
            PublicDrop,
            PublicDroppedPending,
            PrepareEnter,
            PrepareReady,
            PrepareDroppedPending,
            SnapshotEnter,
            SnapshotReady,
            SnapshotDroppedPending,
            AsOfEnter,
            AsOfReturn,
            AssemblyReadEnter,
            AssemblyReadReturn,
            SummaryEnter,
            SummaryReturn,
            ChainFinished,
            ChainCheckReturn,
            StoreDrop,
        }
        const EVENTS: [&str; 19] = [
            "public_enter",
            "public_return",
            "public_drop",
            "public_dropped_pending",
            "prepare_enter",
            "prepare_ready",
            "prepare_dropped_pending",
            "snapshot_enter",
            "snapshot_ready",
            "snapshot_dropped_pending",
            "as_of_enter",
            "as_of_return",
            "assembly_read_enter",
            "assembly_read_return",
            "summary_enter",
            "summary_return",
            "chain_finished",
            "chain_check_return",
            "store_drop",
        ];
        struct Slot {
            active: AtomicBool,
            ambiguous: AtomicBool,
            status: AtomicU16,
            answer: AtomicU16,
            first_read: AtomicUsize,
            remaining_ns: [AtomicU64; 4],
            events: [AtomicU64; EVENTS.len()],
        }
        impl Slot {
            fn new() -> Self {
                Self {
                    active: AtomicBool::new(false),
                    ambiguous: AtomicBool::new(false),
                    status: AtomicU16::new(0),
                    answer: AtomicU16::new(0),
                    first_read: AtomicUsize::new(0),
                    remaining_ns: std::array::from_fn(|_| AtomicU64::new(0)),
                    events: std::array::from_fn(|_| AtomicU64::new(0)),
                }
            }
        }
        struct Io {
            method: AtomicU16,
            start: AtomicU64,
            end: AtomicU64,
            result: AtomicU16,
        }
        impl Io {
            fn new() -> Self {
                Self {
                    method: AtomicU16::new(0),
                    start: AtomicU64::new(0),
                    end: AtomicU64::new(0),
                    result: AtomicU16::new(0),
                }
            }
        }
        pub(super) struct Recorder {
            start: std::time::Instant,
            slots: [Slot; REQUESTS],
            ios: [Io; IOS],
            next: AtomicUsize,
            next_io: AtomicUsize,
            unassociated: AtomicUsize,
        }
        #[derive(Clone)]
        struct Trace {
            recorder: Arc<Recorder>,
            slot: Option<usize>,
        }
        impl Trace {
            fn valid_slot(&self) -> Option<usize> {
                self.slot.filter(|&i| {
                    !self.recorder.overflowed()
                        && !self.recorder.slots[i].ambiguous.load(Ordering::SeqCst)
                })
            }
            fn stamp(&self, event: Event) {
                if let Some(slot) = self.valid_slot() {
                    let _ = self.recorder.slots[slot].events[event as usize].compare_exchange(
                        0,
                        self.recorder.tick(),
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    );
                }
            }
            fn remaining(&self, index: usize, deadline: Instant) {
                if let Some(i) = self.valid_slot() {
                    let ns = deadline
                        .saturating_duration_since(Instant::now())
                        .as_nanos()
                        .min(u128::from(u64::MAX - 1)) as u64
                        + 1;
                    self.recorder.slots[i].remaining_ns[index].store(ns, Ordering::SeqCst);
                }
            }
            fn read<R>(&self, method: usize, f: impl FnOnce() -> R) -> R {
                let first = self.valid_slot().is_some_and(|i| {
                    self.recorder.slots[i]
                        .first_read
                        .compare_exchange(0, method, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                });
                if first {
                    self.stamp(Event::AssemblyReadEnter);
                }
                let answer = f();
                if first {
                    self.stamp(Event::AssemblyReadReturn);
                }
                answer
            }
        }
        pub(super) struct PublicGuard {
            trace: Trace,
            returned: bool,
        }
        impl PublicGuard {
            pub(super) fn returned(&mut self, status: u16) {
                if let Some(i) = self.trace.valid_slot() {
                    self.trace.recorder.slots[i]
                        .status
                        .store(status, Ordering::SeqCst);
                }
                self.trace.stamp(Event::PublicReturn);
                self.returned = true;
            }
        }
        impl Drop for PublicGuard {
            fn drop(&mut self) {
                self.trace.stamp(Event::PublicDrop);
                if !self.returned {
                    self.trace.stamp(Event::PublicDroppedPending);
                }
                if let Some(i) = self.trace.slot {
                    self.trace.recorder.slots[i]
                        .active
                        .store(false, Ordering::SeqCst);
                }
            }
        }
        struct Pending {
            trace: Trace,
            event: Event,
            returned: bool,
        }
        impl Pending {
            fn returned(&mut self) {
                self.returned = true;
            }
        }
        impl Drop for Pending {
            fn drop(&mut self) {
                if !self.returned {
                    self.trace.stamp(self.event);
                }
            }
        }
        pub(super) struct IoGuard {
            recorder: Arc<Recorder>,
            slot: Option<usize>,
            returned: bool,
        }
        impl IoGuard {
            pub(super) fn returned(&mut self, result: u16) {
                if let Some(i) = self.slot {
                    self.recorder.ios[i].result.store(result, Ordering::SeqCst);
                    self.recorder.ios[i]
                        .end
                        .store(self.recorder.tick(), Ordering::SeqCst);
                }
                self.returned = true;
            }
        }
        impl Drop for IoGuard {
            fn drop(&mut self) {
                if !self.returned {
                    // 5 is a dropped pending future, never an assertion that the remote write stopped.
                    self.returned(5);
                }
            }
        }
        impl Recorder {
            pub(super) fn new() -> Arc<Self> {
                Arc::new(Self {
                    start: std::time::Instant::now(),
                    slots: std::array::from_fn(|_| Slot::new()),
                    ios: std::array::from_fn(|_| Io::new()),
                    next: AtomicUsize::new(0),
                    next_io: AtomicUsize::new(0),
                    unassociated: AtomicUsize::new(0),
                })
            }
            fn tick(&self) -> u64 {
                self.start
                    .elapsed()
                    .as_nanos()
                    .min(u128::from(u64::MAX - 1)) as u64
                    + 1
            }
            fn overflowed(&self) -> bool {
                // Monotonic/saturating counter: one overflow invalidates this whole recorder forever.
                self.next.load(Ordering::SeqCst) > REQUESTS
            }
            fn claim_request(&self) -> Option<usize> {
                let n = self
                    .next
                    .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                        Some(n.saturating_add(1))
                    })
                    .unwrap();
                if n >= REQUESTS {
                    // Mark even unactivated slots. A last claimant can still be paused before
                    // active=true; active-only invalidation would falsely associate the overflow.
                    for s in &self.slots {
                        s.ambiguous.store(true, Ordering::SeqCst);
                    }
                }
                (n < REQUESTS).then_some(n)
            }
            fn activate_request(self: &Arc<Self>, slot: Option<usize>) -> PublicGuard {
                if let Some(i) = slot {
                    self.slots[i].active.store(true, Ordering::SeqCst);
                    if self.overflowed()
                        || self
                            .slots
                            .iter()
                            .filter(|s| s.active.load(Ordering::SeqCst))
                            .count()
                            > 1
                    {
                        for s in &self.slots {
                            if self.overflowed() || s.active.load(Ordering::SeqCst) {
                                s.ambiguous.store(true, Ordering::SeqCst);
                            }
                        }
                    }
                }
                let trace = Trace {
                    recorder: self.clone(),
                    slot,
                };
                trace.stamp(Event::PublicEnter);
                PublicGuard {
                    trace,
                    returned: false,
                }
            }
            pub(super) fn request(self: &Arc<Self>) -> PublicGuard {
                self.activate_request(self.claim_request())
            }
            fn association(self: &Arc<Self>) -> Trace {
                let mut active = self
                    .slots
                    .iter()
                    .enumerate()
                    .filter(|(_, s)| s.active.load(Ordering::SeqCst));
                let first = active.next();
                let slot = match (first, active.next()) {
                    (Some((i, s)), None)
                        if !self.overflowed() && !s.ambiguous.load(Ordering::SeqCst) =>
                    {
                        Some(i)
                    }
                    _ => None,
                };
                if slot.is_none() {
                    let _ = self
                        .unassociated
                        .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                            Some(n.saturating_add(1))
                        });
                }
                Trace {
                    recorder: self.clone(),
                    slot,
                }
            }
            pub(super) fn io(self: &Arc<Self>, method: u16) -> IoGuard {
                let n = self
                    .next_io
                    .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                        Some(n.saturating_add(1))
                    })
                    .unwrap();
                let slot = (n < IOS).then_some(n);
                if let Some(i) = slot {
                    self.ios[i].method.store(method, Ordering::SeqCst);
                    self.ios[i].start.store(self.tick(), Ordering::SeqCst);
                }
                IoGuard {
                    recorder: self.clone(),
                    slot,
                    returned: false,
                }
            }
            fn report(&self, reason: &str) -> Value {
                let requests: Vec<_> = self.slots.iter().enumerate().take(self.next.load(Ordering::SeqCst).min(REQUESTS))
                    .map(|(i, s)| {
                        let events: serde_json::Map<String, Value> = EVENTS.iter().enumerate().filter_map(|(n, name)| {
                            let at = s.events[n].load(Ordering::SeqCst);
                            (at != 0).then(|| ((*name).to_owned(), json!(at - 1)))
                        }).collect();
                        json!({"slot":i,"active":s.active.load(Ordering::SeqCst),
                            "association_ambiguous":s.ambiguous.load(Ordering::SeqCst),
                            "http_status":s.status.load(Ordering::SeqCst),"source_answer":s.answer.load(Ordering::SeqCst),
                            "first_read_method":s.first_read.load(Ordering::SeqCst),"events_ns":events,
                            "remaining_ns_plus_one":s.remaining_ns.iter().map(|n|n.load(Ordering::SeqCst)).collect::<Vec<_>>()})
                    }).collect();
                let io: Vec<_> = self.ios.iter().enumerate().take(self.next_io.load(Ordering::SeqCst).min(IOS))
                    .map(|(i,s)| json!({"slot":i,"method":s.method.load(Ordering::SeqCst),
                        "start_ns_plus_one":s.start.load(Ordering::SeqCst),"end_ns_plus_one":s.end.load(Ordering::SeqCst),
                        "result":s.result.load(Ordering::SeqCst)})).collect();
                let mut report = json!({"schema":1,"reason":reason,"request_capacity":REQUESTS,"io_capacity":IOS,
                    "association_invalidated":self.overflowed(),
                    "terminal_candidate":false,"terminal_rainfall_drained":false,
                    "terminal_recorded_public_inactive":false,"terminal_drain_io_slot":null,
                    "association_rule":"Any request overflow permanently invalidates ALL per-request observations from this server, including earlier snapshots. Interpret only the runner's whole-log collection after its final real-drain terminal and child reap/no-further-requests sequence; absent terminal revokes all views. Never interpret a standalone raw line.",
                    "request_overflow":self.next.load(Ordering::SeqCst).saturating_sub(REQUESTS),
                    "io_overflow":self.next_io.load(Ordering::SeqCst).saturating_sub(IOS),
                    "unassociated_source_calls":self.unassociated.load(Ordering::SeqCst),"requests":requests,"server_io":io,
                    "limits":"Serial owned attempts only; overlap marked ambiguous. Store-drop is destructor entry, not exact closure completion. No exact offer return, CPU grant, dispatch or final assembler-completion observation. IO is server-scoped, never request-attributed.",
                    "source_answer_codes":"0 none,1 Snapshot,2 Forward,3 Failed",
                    "remaining_codes":"array prepare-enter/ready,snapshot-enter/ready;0 unobserved;otherwise remaining-ns+1;passed deadline unchanged",
                    "first_read_codes":"1 db_version,2 towns,3 town,4 region_code,5 town_model,6 mid_model,7 forecast_zone,8 stn_hourly_and_min_rns,9 city_hourly,10 history,11 area_no,12 area_no_near,13 life_index,14 food_poisoning,15 arpltn,16 dust_forecast,17 air_fallback,18 air_forecast,19 rise_set,20 special_zones",
                    "io_method_codes":"1 checkpoint GET,2 checkpoint PUT,3 real quiesce/drain",
                    "io_result_codes":"0 pending,1 drain true,2 timeout,3 transport,4 other error,5 dropped pending,6 drain false,100..599 actual HTTP status (control GET success=200);drain covers rainfall permits only, child reaping is separate"});
                let request_count = self.next.load(Ordering::SeqCst);
                let overflowed = request_count > REQUESTS;
                report["association_invalidated"] = json!(overflowed);
                report["request_overflow"] = json!(request_count.saturating_sub(REQUESTS));
                for request in report["requests"]
                    .as_array_mut()
                    .expect("fixed report requests")
                {
                    if overflowed || request["association_ambiguous"] == true {
                        request["association_ambiguous"] = json!(true);
                        request["http_status"] = json!(0);
                        request["source_answer"] = json!(0);
                        request["first_read_method"] = json!(0);
                        request["events_ns"] = json!({});
                        request["remaining_ns_plus_one"] = json!([0, 0, 0, 0]);
                    }
                }
                // A future overflow can occur after this return. Whole-log collection must
                // therefore invalidate earlier snapshots too; this check alone is not enough.
                report
            }
            fn drain_report(&self, drained: bool, drain: &IoGuard) -> Value {
                let mut report = self.report("drain");
                let inactive = report["requests"]
                    .as_array()
                    .expect("bounded requests")
                    .iter()
                    .all(|request| request["active"] == false);
                let io_complete = drain.returned
                    && drain.slot.is_some_and(|i| {
                        self.ios[i].method.load(Ordering::SeqCst) == 3
                            && self.ios[i].result.load(Ordering::SeqCst) == 1
                            && self.ios[i].end.load(Ordering::SeqCst) != 0
                    });
                let candidate = drained && inactive && io_complete;
                report["terminal_candidate"] = json!(candidate);
                report["terminal_rainfall_drained"] = json!(drained);
                report["terminal_recorded_public_inactive"] = json!(inactive);
                report["terminal_drain_io_slot"] = json!(drain.slot);
                report["terminal_scope"] = json!(
                    "Candidate trace cutoff only: real rainfall drain and observed recorded public inactivity. Runner must seal requests, reap child and require this final log snapshot. No global CPU/assembly/wire completion proof."
                );
                if candidate {
                    report["reason"] = json!("terminal");
                }
                report
            }
            pub(super) fn flush_drain(&self, drained: bool, drain: &IoGuard) -> bool {
                let report = self.drain_report(drained, drain);
                let candidate = report["terminal_candidate"]
                    .as_bool()
                    .expect("fixed candidate");
                eprintln!("RAINFALL_DIAGNOSTIC {}", report);
                candidate
            }
            pub(super) fn flush(&self, reason: &str) {
                // At most16 request records and64 IO records; no raw bodies, paths or credentials.
                eprintln!("RAINFALL_DIAGNOSTIC {}", self.report(reason));
            }
        }
        pub(super) struct Source {
            pub(super) inner: Arc<dyn KmaSource>,
            pub(super) recorder: Arc<Recorder>,
        }
        impl KmaSource for Source {
            fn prepare(
                &self,
                request: KmaRequest,
                deadline: Instant,
            ) -> BoxFuture<'_, Result<KmaRequest, Outcome>> {
                let trace = self.recorder.association();
                trace.stamp(Event::PrepareEnter);
                trace.remaining(0, deadline);
                let mut pending = Pending {
                    trace: trace.clone(),
                    event: Event::PrepareDroppedPending,
                    returned: false,
                };
                let answer = self.inner.prepare(request, deadline);
                Box::pin(async move {
                    let answer = answer.await;
                    trace.stamp(Event::PrepareReady);
                    trace.remaining(1, deadline);
                    pending.returned();
                    answer
                })
            }
            fn snapshot(
                &self,
                request: &KmaRequest,
                deadline: Instant,
            ) -> BoxFuture<'_, SourceAnswer> {
                // KmaSource's returned future lifetime is tied to self, not the borrowed request;
                // invoke the real seam before constructing this future, preserving that contract.
                let trace = self.recorder.association();
                trace.stamp(Event::SnapshotEnter);
                trace.remaining(2, deadline);
                let mut pending = Pending {
                    trace: trace.clone(),
                    event: Event::SnapshotDroppedPending,
                    returned: false,
                };
                let answer = self.inner.snapshot(request, deadline);
                Box::pin(async move {
                    let answer = answer.await;
                    if let Some(i) = trace.valid_slot() {
                        self.recorder.slots[i].answer.store(
                            match &answer {
                                SourceAnswer::Snapshot(_) => 1,
                                SourceAnswer::Forward(_) => 2,
                                SourceAnswer::Failed(_) => 3,
                            },
                            Ordering::SeqCst,
                        );
                    }
                    trace.stamp(Event::SnapshotReady);
                    trace.remaining(3, deadline);
                    pending.returned();
                    match answer {
                        SourceAnswer::Snapshot(inner) => {
                            SourceAnswer::Snapshot(Box::new(StoreTrace { inner, trace }))
                        }
                        other => other,
                    }
                })
            }
        }
        struct StoreTrace {
            inner: Box<dyn KmaStore + Send>,
            trace: Trace,
        }
        impl Drop for StoreTrace {
            fn drop(&mut self) {
                self.trace.stamp(Event::StoreDrop);
            }
        }
        impl KmaStore for StoreTrace {
            fn db_version(&self) -> DbVersion {
                self.trace.read(1, || self.inner.db_version())
            }
            fn towns(&self) -> StoreResult {
                self.trace.read(2, || self.inner.towns())
            }
            fn town(&self, first: &str, second: &str, third: &str) -> StoreResult {
                self.trace.read(3, || self.inner.town(first, second, third))
            }
            fn region_code(&self, region: &str, city: &str) -> StoreResult {
                self.trace.read(4, || self.inner.region_code(region, city))
            }
            fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
                self.trace.read(5, || self.inner.town_model(model, mx, my))
            }
            fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
                self.trace.read(6, || self.inner.mid_model(model, reg_id))
            }
            fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
                self.trace
                    .read(7, || self.inner.forecast_zone(region, city))
            }
            fn stn_hourly_and_min_rns(
                &self,
                town: &Value,
                date_time: &str,
                current: &Value,
            ) -> StoreResult {
                self.trace.read(8, || {
                    self.inner.stn_hourly_and_min_rns(town, date_time, current)
                })
            }
            fn city_hourly(&self, town: &Value) -> StoreResult {
                self.trace.read(9, || self.inner.city_hourly(town))
            }
            fn history(&self, town: &Value) -> StoreResult {
                self.trace.read(10, || self.inner.history(town))
            }
            fn area_no(&self, first: &str, second: &str, third: &str) -> StoreResult {
                self.trace
                    .read(11, || self.inner.area_no(first, second, third))
            }
            fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
                self.trace.read(12, || self.inner.area_no_near(lon_lat))
            }
            fn life_index(&self, area_no: f64) -> StoreResult {
                self.trace.read(13, || self.inner.life_index(area_no))
            }
            fn food_poisoning(&self, sd: &str, sgg: &str, start: &str, end: &str) -> StoreResult {
                self.trace
                    .read(14, || self.inner.food_poisoning(sd, sgg, start, end))
            }
            fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
                self.trace.read(15, || self.inner.arpltn(town, now_ms))
            }
            fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
                self.trace
                    .read(16, || self.inner.dust_forecast(region, city, date))
            }
            fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
                self.trace
                    .read(17, || self.inner.air_fallback(g_coord, now_ms))
            }
            fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
                self.trace
                    .read(18, || self.inner.air_forecast(source, station))
            }
            fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
                self.trace.read(19, || self.inner.rise_set(geocode, dates))
            }
            fn special_zones(&self, area_codes: &[String]) -> StoreResult {
                self.trace.read(20, || self.inner.special_zones(area_codes))
            }
            fn as_of_ms(&self) -> Option<f64> {
                self.trace.stamp(Event::AsOfEnter);
                let answer = self.inner.as_of_ms();
                self.trace.stamp(Event::AsOfReturn);
                answer
            }
            fn summary_inputs(&self) -> Option<server2::summary::GridInputs> {
                self.trace.stamp(Event::SummaryEnter);
                let answer = self.inner.summary_inputs();
                self.trace.stamp(Event::SummaryReturn);
                answer
            }
            fn unconsumed(&self) -> Option<String> {
                self.trace.stamp(Event::ChainFinished);
                let answer = self.inner.unconsumed();
                self.trace.stamp(Event::ChainCheckReturn);
                answer
            }
        }
        #[derive(Clone)]
        pub(super) struct TransportTrace<T> {
            pub(super) inner: T,
            pub(super) recorder: Arc<Recorder>,
        }
        fn io_result<T>(answer: &Result<T, Error>) -> u16 {
            match answer {
                Ok(_) => 200,
                Err(Error::Status(code)) => *code,
                Err(Error::NotFound) => 404,
                Err(Error::Timeout) => 2,
                Err(Error::Transport) => 3,
                Err(_) => 4,
            }
        }
        impl<T: CatalogTransport> ObjectTransport for TransportTrace<T> {
            fn raw_cache(&self) -> Option<Arc<server2::cache::disk::DiskCache>> {
                self.inner.raw_cache()
            }
            async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
                self.inner.put(record).await
            }
            async fn head(&self, key: &str) -> Result<Object, Error> {
                self.inner.head(key).await
            }
            async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
                self.inner.get(key, maximum).await
            }
            async fn ready(&self) -> Result<(), Error> {
                self.inner.ready().await
            }
        }
        impl<T: CatalogTransport> CatalogTransport for TransportTrace<T> {
            async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
                let mut trace = (key == STATE_KEY).then(|| self.recorder.io(1));
                let answer = self.inner.get_control(key, maximum).await;
                if let Some(trace) = &mut trace {
                    trace.returned(io_result(&answer));
                }
                answer
            }
            async fn put_control(
                &self,
                key: &str,
                body: &[u8],
                condition: &WriteCondition,
            ) -> Result<u16, Error> {
                let mut trace = (key == STATE_KEY).then(|| self.recorder.io(2));
                let answer = self.inner.put_control(key, body, condition).await;
                if let Some(trace) = &mut trace {
                    trace.returned(match &answer {
                        Ok(code) => *code,
                        Err(_) => io_result(&answer),
                    });
                }
                answer
            }
            async fn list_raw_document(
                &self,
                prefix: &str,
                token: Option<&str>,
                maximum_keys: usize,
                maximum_bytes: usize,
            ) -> Result<Vec<u8>, Error> {
                self.inner
                    .list_raw_document(prefix, token, maximum_keys, maximum_bytes)
                    .await
            }
        }

        impl<T: server2::history::IndexListing> server2::history::IndexListing for TransportTrace<T> {
            async fn list_index(
                &self,
                prefix: &str,
                token: Option<&str>,
            ) -> Result<server2::storage::ListPage, Error> {
                self.inner.list_index(prefix, token).await
            }
        }

        #[cfg(test)]
        mod tests {
            use super::*;
            use std::{
                sync::Mutex,
                task::{Context, Poll, Waker},
            };
            type Calls = Arc<Mutex<Vec<(String, String)>>>;
            struct Probe {
                calls: Calls,
                drops: Arc<AtomicUsize>,
            }
            impl Probe {
                fn record(&self, method: &str, args: String) {
                    self.calls.lock().unwrap().push((method.to_owned(), args));
                }
            }
            impl Drop for Probe {
                fn drop(&mut self) {
                    self.drops.fetch_add(1, Ordering::SeqCst);
                }
            }
            impl KmaStore for Probe {
                fn db_version(&self) -> DbVersion {
                    self.record("db_version", format!("{:?}", ()));
                    DbVersion::V1
                }
                fn towns(&self) -> StoreResult {
                    self.record("towns", format!("{:?}", ()));
                    Err(server2::domestic::kma::StoreError("probe:towns".into()))
                }
                fn town(&self, first: &str, second: &str, third: &str) -> StoreResult {
                    self.record("town", format!("{:?}", (first, second, third,)));
                    Err(server2::domestic::kma::StoreError("probe:town".into()))
                }
                fn region_code(&self, region: &str, city: &str) -> StoreResult {
                    self.record("region_code", format!("{:?}", (region, city,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:region_code".into(),
                    ))
                }
                fn town_model(&self, model: TownModel, mx: &Value, my: &Value) -> StoreResult {
                    self.record("town_model", format!("{:?}", (model, mx, my,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:town_model".into(),
                    ))
                }
                fn mid_model(&self, model: MidModel, reg_id: &Value) -> StoreResult {
                    self.record("mid_model", format!("{:?}", (model, reg_id,)));
                    Err(server2::domestic::kma::StoreError("probe:mid_model".into()))
                }
                fn forecast_zone(&self, region: &str, city: &str) -> StoreResult {
                    self.record("forecast_zone", format!("{:?}", (region, city,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:forecast_zone".into(),
                    ))
                }
                fn stn_hourly_and_min_rns(
                    &self,
                    town: &Value,
                    date_time: &str,
                    current: &Value,
                ) -> StoreResult {
                    self.record(
                        "stn_hourly_and_min_rns",
                        format!("{:?}", (town, date_time, current,)),
                    );
                    Err(server2::domestic::kma::StoreError(
                        "probe:stn_hourly_and_min_rns".into(),
                    ))
                }
                fn city_hourly(&self, town: &Value) -> StoreResult {
                    self.record("city_hourly", format!("{:?}", (town,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:city_hourly".into(),
                    ))
                }
                fn history(&self, town: &Value) -> StoreResult {
                    self.record("history", format!("{:?}", (town,)));
                    Err(server2::domestic::kma::StoreError("probe:history".into()))
                }
                fn area_no(&self, first: &str, second: &str, third: &str) -> StoreResult {
                    self.record("area_no", format!("{:?}", (first, second, third,)));
                    Err(server2::domestic::kma::StoreError("probe:area_no".into()))
                }
                fn area_no_near(&self, lon_lat: &Value) -> StoreResult {
                    self.record("area_no_near", format!("{:?}", (lon_lat,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:area_no_near".into(),
                    ))
                }
                fn life_index(&self, area_no: f64) -> StoreResult {
                    self.record("life_index", format!("{:?}", (area_no,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:life_index".into(),
                    ))
                }
                fn food_poisoning(
                    &self,
                    sd: &str,
                    sgg: &str,
                    start: &str,
                    end: &str,
                ) -> StoreResult {
                    self.record("food_poisoning", format!("{:?}", (sd, sgg, start, end,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:food_poisoning".into(),
                    ))
                }
                fn arpltn(&self, town: &Value, now_ms: f64) -> StoreResult {
                    self.record("arpltn", format!("{:?}", (town, now_ms,)));
                    Err(server2::domestic::kma::StoreError("probe:arpltn".into()))
                }
                fn dust_forecast(&self, region: &str, city: &str, date: &str) -> StoreResult {
                    self.record("dust_forecast", format!("{:?}", (region, city, date,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:dust_forecast".into(),
                    ))
                }
                fn air_fallback(&self, g_coord: &Value, now_ms: f64) -> StoreResult {
                    self.record("air_fallback", format!("{:?}", (g_coord, now_ms,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:air_fallback".into(),
                    ))
                }
                fn air_forecast(&self, source: &str, station: &Value) -> StoreResult {
                    self.record("air_forecast", format!("{:?}", (source, station,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:air_forecast".into(),
                    ))
                }
                fn rise_set(&self, geocode: &Value, dates: &[String]) -> StoreResult {
                    self.record("rise_set", format!("{:?}", (geocode, dates,)));
                    Err(server2::domestic::kma::StoreError("probe:rise_set".into()))
                }
                fn special_zones(&self, area_codes: &[String]) -> StoreResult {
                    self.record("special_zones", format!("{:?}", (area_codes,)));
                    Err(server2::domestic::kma::StoreError(
                        "probe:special_zones".into(),
                    ))
                }
                fn as_of_ms(&self) -> Option<f64> {
                    self.record("as_of_ms", "()".into());
                    Some(12345.)
                }
                fn unconsumed(&self) -> Option<String> {
                    self.record("unconsumed", "()".into());
                    Some("probe:unconsumed".into())
                }
                fn summary_inputs(&self) -> Option<server2::summary::GridInputs> {
                    self.record("summary_inputs", "()".into());
                    Some(server2::summary::GridInputs {
                        town: ["a".into(), "b".into(), "c".into()],
                        grid: (61, 128),
                        ids: vec![],
                        asos: None,
                    })
                }
            }
            fn request() -> KmaRequest {
                server2::domestic::kma::backend::parse_path(
                    "/v000903/kma/addr/a/b/c?probe=unchanged",
                    "ko",
                )
                .unwrap()
            }
            fn event(r: &Recorder, slot: usize, name: Event) -> u64 {
                r.slots[slot].events[name as usize].load(Ordering::SeqCst)
            }
            #[test]
            fn every_store_method_forwards_arguments_results_and_lifetime() {
                let r = Recorder::new();
                let mut public = r.request();
                let calls: Calls = Arc::default();
                let drops = Arc::new(AtomicUsize::new(0));
                let store = StoreTrace {
                    inner: Box::new(Probe {
                        calls: calls.clone(),
                        drops: drops.clone(),
                    }),
                    trace: r.association(),
                };
                let value = json!({"probe":17});
                let other = json!([19, 23]);
                let dates = vec!["dateA".to_owned(), "dateB".to_owned()];
                let areas = vec!["zoneX".to_owned(), "zoneY".to_owned()];
                let mut expected = Vec::new();
                assert_eq!(store.db_version(), DbVersion::V1);
                expected.push(("db_version".to_owned(), format!("{:?}", ())));
                assert_eq!(store.towns().unwrap_err().0, "probe:towns");
                expected.push(("towns".to_owned(), format!("{:?}", ())));
                assert_eq!(
                    store.town("first", "second", "third").unwrap_err().0,
                    "probe:town"
                );
                expected.push((
                    "town".to_owned(),
                    format!("{:?}", ("first", "second", "third",)),
                ));
                assert_eq!(
                    store.region_code("region", "city").unwrap_err().0,
                    "probe:region_code"
                );
                expected.push((
                    "region_code".to_owned(),
                    format!("{:?}", ("region", "city",)),
                ));
                assert_eq!(
                    store
                        .town_model(TownModel::Shortest, &value, &other)
                        .unwrap_err()
                        .0,
                    "probe:town_model"
                );
                expected.push((
                    "town_model".to_owned(),
                    format!("{:?}", (TownModel::Shortest, &value, &other,)),
                ));
                assert_eq!(
                    store.mid_model(MidModel::Land, &value).unwrap_err().0,
                    "probe:mid_model"
                );
                expected.push((
                    "mid_model".to_owned(),
                    format!("{:?}", (MidModel::Land, &value,)),
                ));
                assert_eq!(
                    store
                        .forecast_zone("zone-region", "zone-city")
                        .unwrap_err()
                        .0,
                    "probe:forecast_zone"
                );
                expected.push((
                    "forecast_zone".to_owned(),
                    format!("{:?}", ("zone-region", "zone-city",)),
                ));
                assert_eq!(
                    store
                        .stn_hourly_and_min_rns(&value, "202610171000", &other)
                        .unwrap_err()
                        .0,
                    "probe:stn_hourly_and_min_rns"
                );
                expected.push((
                    "stn_hourly_and_min_rns".to_owned(),
                    format!("{:?}", (&value, "202610171000", &other,)),
                ));
                assert_eq!(
                    store.city_hourly(&value).unwrap_err().0,
                    "probe:city_hourly"
                );
                expected.push(("city_hourly".to_owned(), format!("{:?}", (&value,))));
                assert_eq!(store.history(&other).unwrap_err().0, "probe:history");
                expected.push(("history".to_owned(), format!("{:?}", (&other,))));
                assert_eq!(
                    store
                        .area_no("area-first", "area-second", "area-third")
                        .unwrap_err()
                        .0,
                    "probe:area_no"
                );
                expected.push((
                    "area_no".to_owned(),
                    format!("{:?}", ("area-first", "area-second", "area-third",)),
                ));
                assert_eq!(
                    store.area_no_near(&other).unwrap_err().0,
                    "probe:area_no_near"
                );
                expected.push(("area_no_near".to_owned(), format!("{:?}", (&other,))));
                assert_eq!(store.life_index(37.25).unwrap_err().0, "probe:life_index");
                expected.push(("life_index".to_owned(), format!("{:?}", (37.25,))));
                assert_eq!(
                    store
                        .food_poisoning("sd", "sgg", "start", "end")
                        .unwrap_err()
                        .0,
                    "probe:food_poisoning"
                );
                expected.push((
                    "food_poisoning".to_owned(),
                    format!("{:?}", ("sd", "sgg", "start", "end",)),
                ));
                assert_eq!(store.arpltn(&value, 1234.5).unwrap_err().0, "probe:arpltn");
                expected.push(("arpltn".to_owned(), format!("{:?}", (&value, 1234.5,))));
                assert_eq!(
                    store
                        .dust_forecast("dust-region", "dust-city", "dust-date")
                        .unwrap_err()
                        .0,
                    "probe:dust_forecast"
                );
                expected.push((
                    "dust_forecast".to_owned(),
                    format!("{:?}", ("dust-region", "dust-city", "dust-date",)),
                ));
                assert_eq!(
                    store.air_fallback(&other, 5678.25).unwrap_err().0,
                    "probe:air_fallback"
                );
                expected.push((
                    "air_fallback".to_owned(),
                    format!("{:?}", (&other, 5678.25,)),
                ));
                assert_eq!(
                    store.air_forecast("air-source", &value).unwrap_err().0,
                    "probe:air_forecast"
                );
                expected.push((
                    "air_forecast".to_owned(),
                    format!("{:?}", ("air-source", &value,)),
                ));
                assert_eq!(
                    store.rise_set(&value, &dates).unwrap_err().0,
                    "probe:rise_set"
                );
                expected.push(("rise_set".to_owned(), format!("{:?}", (&value, &dates,))));
                assert_eq!(
                    store.special_zones(&areas).unwrap_err().0,
                    "probe:special_zones"
                );
                expected.push(("special_zones".to_owned(), format!("{:?}", (&areas,))));
                assert_eq!(store.as_of_ms(), Some(12345.));
                expected.push(("as_of_ms".into(), "()".into()));
                let inputs = store
                    .summary_inputs()
                    .expect("must forward optional override");
                assert_eq!(inputs.town, ["a", "b", "c"]);
                assert_eq!(inputs.grid, (61, 128));
                expected.push(("summary_inputs".into(), "()".into()));
                assert_eq!(store.unconsumed().as_deref(), Some("probe:unconsumed"));
                expected.push(("unconsumed".into(), "()".into()));
                assert_eq!(*calls.lock().unwrap(), expected);
                assert!(
                    event(&r, 0, Event::AsOfReturn) > 0
                        && event(&r, 0, Event::ChainCheckReturn) > 0
                );
                public.returned(200);
                drop(public);
                assert_eq!(
                    drops.load(Ordering::SeqCst),
                    0,
                    "public Drop must not release a separately retained store"
                );
                assert_eq!(event(&r, 0, Event::StoreDrop), 0);
                drop(store);
                assert_eq!(drops.load(Ordering::SeqCst), 1);
                assert!(event(&r, 0, Event::StoreDrop) > 0);
                assert_eq!(r.slots[0].first_read.load(Ordering::SeqCst), 1);
            }
            #[derive(Clone, Copy)]
            enum Mode {
                Snapshot,
                Forward,
                Failed,
                PendingPrepare,
                PendingSnapshot,
                RejectPrepare,
            }
            struct Fake {
                mode: Mode,
                until: Instant,
                calls: Calls,
                drops: Arc<AtomicUsize>,
            }
            struct Lifetime(Arc<AtomicUsize>);
            impl Drop for Lifetime {
                fn drop(&mut self) {
                    self.0.fetch_add(1, Ordering::SeqCst);
                }
            }
            impl KmaSource for Fake {
                fn prepare(
                    &self,
                    mut request: KmaRequest,
                    deadline: Instant,
                ) -> BoxFuture<'_, Result<KmaRequest, Outcome>> {
                    assert_eq!(deadline, self.until);
                    assert_eq!(
                        request.original_url,
                        "/v000903/kma/addr/a/b/c?probe=unchanged"
                    );
                    assert_eq!(
                        request.query,
                        vec![("probe".to_owned(), "unchanged".to_owned())]
                    );
                    request.query.push(("real-prepare".into(), "kept".into()));
                    let mode = self.mode;
                    let life = Lifetime(self.drops.clone());
                    Box::pin(async move {
                        let _life = life;
                        if matches!(mode, Mode::PendingPrepare) {
                            std::future::pending::<()>().await;
                        }
                        if matches!(mode, Mode::RejectPrepare) {
                            Err(Outcome::Status(409, "real-rejection".into()))
                        } else {
                            Ok(request)
                        }
                    })
                }
                fn snapshot(
                    &self,
                    request: &KmaRequest,
                    deadline: Instant,
                ) -> BoxFuture<'_, SourceAnswer> {
                    assert_eq!(deadline, self.until);
                    assert!(request.original_url.ends_with("probe=unchanged"));
                    let mode = self.mode;
                    let probe = Probe {
                        calls: self.calls.clone(),
                        drops: self.drops.clone(),
                    };
                    Box::pin(async move {
                        match mode {
                            Mode::PendingSnapshot => {
                                let _probe = probe;
                                std::future::pending().await
                            }
                            Mode::Forward => SourceAnswer::Forward("real-forward".into()),
                            Mode::Failed => SourceAnswer::Failed("real-failed".into()),
                            _ => SourceAnswer::Snapshot(Box::new(probe)),
                        }
                    })
                }
            }
            fn source(
                r: Arc<Recorder>,
                mode: Mode,
                drops: Arc<AtomicUsize>,
                until: Instant,
            ) -> Source {
                Source {
                    inner: Arc::new(Fake {
                        mode,
                        until,
                        calls: Arc::default(),
                        drops,
                    }),
                    recorder: r,
                }
            }
            #[tokio::test]
            async fn source_results_and_snapshot_lifetime_are_transparent() {
                for mode in [
                    Mode::Snapshot,
                    Mode::Forward,
                    Mode::Failed,
                    Mode::RejectPrepare,
                ] {
                    let r = Recorder::new();
                    let mut public = r.request();
                    let drops = Arc::new(AtomicUsize::new(0));
                    let until = Instant::now() + Duration::from_secs(3);
                    let source = source(r.clone(), mode, drops.clone(), until);
                    let prepared = source.prepare(request(), until).await;
                    if matches!(mode, Mode::RejectPrepare) {
                        assert!(
                            matches!(prepared,Err(Outcome::Status(409,ref body)) if body=="real-rejection")
                        );
                        assert!(event(&r, 0, Event::PrepareReady) > 0);
                        assert_eq!(event(&r, 0, Event::PrepareDroppedPending), 0);
                        continue;
                    }
                    let prepared = prepared.unwrap();
                    assert_eq!(
                        prepared.query.last(),
                        Some(&("real-prepare".to_owned(), "kept".to_owned()))
                    );
                    let answer = source.snapshot(&prepared, until).await;
                    match (mode, answer) {
                        (Mode::Snapshot, SourceAnswer::Snapshot(store)) => {
                            assert_eq!(store.as_of_ms(), Some(12345.));
                            public.returned(200);
                            drop(public);
                            assert_eq!(event(&r, 0, Event::StoreDrop), 0);
                            drop(store);
                            assert!(event(&r, 0, Event::StoreDrop) > 0);
                        }
                        (Mode::Forward, SourceAnswer::Forward(body)) => {
                            assert_eq!(body, "real-forward")
                        }
                        (Mode::Failed, SourceAnswer::Failed(body)) => {
                            assert_eq!(body, "real-failed")
                        }
                        _ => panic!("source answer changed by diagnostic wrapper"),
                    }
                    assert!(event(&r, 0, Event::SnapshotReady) > 0);
                    assert_eq!(event(&r, 0, Event::SnapshotDroppedPending), 0);
                }
            }
            #[test]
            fn whole_pending_guard_survives_before_poll_and_classifies_both_source_futures() {
                for prepare in [true, false] {
                    for action in ["ready", "unpolled-cancel", "pending-cancel"] {
                        let r = Recorder::new();
                        let _public = r.request();
                        let drops = Arc::new(AtomicUsize::new(0));
                        let until = Instant::now() + Duration::from_secs(3);
                        let mode = if action == "ready" {
                            Mode::Snapshot
                        } else if prepare {
                            Mode::PendingPrepare
                        } else {
                            Mode::PendingSnapshot
                        };
                        let source = source(r.clone(), mode, drops.clone(), until);
                        let mut context = Context::from_waker(Waker::noop());
                        let pending = if prepare {
                            Event::PrepareDroppedPending
                        } else {
                            Event::SnapshotDroppedPending
                        };
                        let ready = if prepare {
                            Event::PrepareReady
                        } else {
                            Event::SnapshotReady
                        };
                        let request = request();
                        if prepare {
                            let mut future = source.prepare(request, until);
                            assert_eq!(
                                event(&r, 0, pending),
                                0,
                                "guard must be retained before first poll"
                            );
                            assert_eq!(drops.load(Ordering::SeqCst), 0);
                            if action == "ready" {
                                assert!(matches!(
                                    future.as_mut().poll(&mut context),
                                    Poll::Ready(Ok(_))
                                ));
                            } else if action == "pending-cancel" {
                                assert!(matches!(
                                    future.as_mut().poll(&mut context),
                                    Poll::Pending
                                ));
                            }
                            drop(future);
                        } else {
                            let mut future = source.snapshot(&request, until);
                            assert_eq!(
                                event(&r, 0, pending),
                                0,
                                "guard must be retained before first poll"
                            );
                            assert_eq!(drops.load(Ordering::SeqCst), 0);
                            if action == "ready" {
                                match future.as_mut().poll(&mut context) {
                                    Poll::Ready(SourceAnswer::Snapshot(store)) => {
                                        drop(store);
                                    }
                                    _ => panic!("ready source answer changed"),
                                }
                            } else if action == "pending-cancel" {
                                assert!(matches!(
                                    future.as_mut().poll(&mut context),
                                    Poll::Pending
                                ));
                            }
                            drop(future);
                        }
                        assert_eq!(
                            drops.load(Ordering::SeqCst),
                            1,
                            "underlying future/store lifetime must also retire"
                        );
                        if action == "ready" {
                            assert!(event(&r, 0, ready) > 0);
                            assert_eq!(
                                event(&r, 0, pending),
                                0,
                                "completed future must not report pending Drop"
                            );
                        } else {
                            assert_eq!(event(&r, 0, ready), 0);
                            assert!(
                                event(&r, 0, pending) > 0,
                                "cancelled whole future must report pending Drop"
                            );
                        }
                    }
                }
            }
            #[test]
            fn pending_future_drop_and_public_drop_are_observed_without_io() {
                for mode in [Mode::PendingPrepare, Mode::PendingSnapshot] {
                    let r = Recorder::new();
                    let public = r.request();
                    let drops = Arc::new(AtomicUsize::new(0));
                    let until = Instant::now() + Duration::from_secs(3);
                    let source = source(r.clone(), mode, drops.clone(), until);
                    let mut context = Context::from_waker(Waker::noop());
                    let event_name = if matches!(mode, Mode::PendingPrepare) {
                        let mut future = source.prepare(request(), until);
                        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
                        drop(future);
                        Event::PrepareDroppedPending
                    } else {
                        let request = request();
                        let mut future = source.snapshot(&request, until);
                        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
                        drop(future);
                        Event::SnapshotDroppedPending
                    };
                    assert_eq!(
                        drops.load(Ordering::SeqCst),
                        1,
                        "underlying pending future must also be dropped"
                    );
                    assert!(event(&r, 0, event_name) > 0);
                    drop(public);
                    assert!(event(&r, 0, Event::PublicDroppedPending) > 0);
                }
            }
            #[derive(Clone)]
            struct FakeTransport(Calls);
            impl FakeTransport {
                fn record(&self, method: &str, args: String) {
                    self.0.lock().unwrap().push((method.into(), args));
                }
            }
            impl ObjectTransport for FakeTransport {
                fn raw_cache(&self) -> Option<Arc<server2::cache::disk::DiskCache>> {
                    self.record("raw_cache", "()".into());
                    None
                }
                async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
                    self.record("put", format!("{record:?}"));
                    Ok(201)
                }
                async fn head(&self, key: &str) -> Result<Object, Error> {
                    self.record("head", key.into());
                    Err(Error::NotFound)
                }
                async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
                    self.record("get", format!("{key}:{maximum}"));
                    Ok(Object {
                        metadata: Default::default(),
                        length: 3,
                        body: vec![1, 2, 3],
                    })
                }
                async fn ready(&self) -> Result<(), Error> {
                    self.record("ready", "()".into());
                    Err(Error::Capacity)
                }
            }
            impl CatalogTransport for FakeTransport {
                async fn get_control(
                    &self,
                    key: &str,
                    maximum: usize,
                ) -> Result<ControlObject, Error> {
                    self.record("get_control", format!("{key}:{maximum}"));
                    if key == STATE_KEY {
                        Err(Error::NotFound)
                    } else {
                        Ok(ControlObject {
                            body: vec![4, 5],
                            etag: "\"original\"".into(),
                            version: Some("original-version".into()),
                        })
                    }
                }
                async fn put_control(
                    &self,
                    key: &str,
                    body: &[u8],
                    condition: &WriteCondition,
                ) -> Result<u16, Error> {
                    self.record("put_control", format!("{key}:{body:?}:{condition:?}"));
                    Ok(412)
                }
                async fn list_raw_document(
                    &self,
                    prefix: &str,
                    token: Option<&str>,
                    maximum_keys: usize,
                    maximum_bytes: usize,
                ) -> Result<Vec<u8>, Error> {
                    self.record(
                        "list",
                        format!("{prefix}:{token:?}:{maximum_keys}:{maximum_bytes}"),
                    );
                    Ok(vec![6, 7])
                }
            }
            impl server2::history::IndexListing for FakeTransport {
                async fn list_index(
                    &self,
                    prefix: &str,
                    token: Option<&str>,
                ) -> Result<server2::storage::ListPage, Error> {
                    self.record("list_index", format!("{prefix}:{token:?}"));
                    Ok(server2::storage::ListPage {
                        keys: vec!["index/v2/original.json".into()],
                        next: Some("original-next".into()),
                    })
                }
            }
            #[tokio::test]
            async fn transport_forwards_all_arguments_and_records_only_authority_and_real_drain() {
                let r = Recorder::new();
                let calls: Calls = Arc::default();
                let t = TransportTrace {
                    inner: FakeTransport(calls.clone()),
                    recorder: r.clone(),
                };
                assert!(t.raw_cache().is_none());
                let prepared = PreparedRecord {
                    key: "raw-original".into(),
                    metadata: Default::default(),
                    md5: "original-md5".into(),
                    body: vec![11, 12],
                };
                assert_eq!(t.put(&prepared).await, Ok(201));
                assert!(matches!(
                    t.head("head-original").await,
                    Err(Error::NotFound)
                ));
                assert_eq!(
                    t.get("get-original", 321).await.unwrap().body,
                    vec![1, 2, 3]
                );
                assert_eq!(t.ready().await, Err(Error::Capacity));
                let control = t.get_control("non-authority", 543).await.unwrap();
                assert_eq!(control.body, vec![4, 5]);
                assert_eq!(control.etag, "\"original\"");
                assert_eq!(control.version.as_deref(), Some("original-version"));
                assert_eq!(r.next_io.load(Ordering::SeqCst), 0);
                assert!(matches!(
                    t.get_control(STATE_KEY, 765).await,
                    Err(Error::NotFound)
                ));
                let condition = WriteCondition::Match("\"original-etag\"".into());
                assert_eq!(
                    t.put_control(STATE_KEY, &[13, 14], &condition).await,
                    Ok(412)
                );
                assert_eq!(
                    t.list_raw_document("original-prefix", Some("original-token"), 17, 987)
                        .await,
                    Ok(vec![6, 7])
                );
                let index = server2::history::IndexListing::list_index(
                    &t,
                    "index/v2/original",
                    Some("original-index-token"),
                )
                .await
                .unwrap();
                assert_eq!(index.keys, vec!["index/v2/original.json"]);
                assert_eq!(index.next.as_deref(), Some("original-next"));
                assert_eq!(
                    *calls.lock().unwrap(),
                    vec![
                        ("raw_cache".into(), "()".into()),
                        ("put".into(), format!("{prepared:?}")),
                        ("head".into(), "head-original".into()),
                        ("get".into(), "get-original:321".into()),
                        ("ready".into(), "()".into()),
                        ("get_control".into(), "non-authority:543".into()),
                        ("get_control".into(), format!("{STATE_KEY}:765")),
                        (
                            "put_control".into(),
                            format!("{STATE_KEY}:{:?}:{condition:?}", [13u8, 14])
                        ),
                        (
                            "list".into(),
                            "original-prefix:Some(\"original-token\"):17:987".into()
                        ),
                        (
                            "list_index".into(),
                            r#"index/v2/original:Some("original-index-token")"#.into()
                        ),
                    ]
                );
                assert_eq!(r.next_io.load(Ordering::SeqCst), 2);
                assert_eq!(r.ios[0].result.load(Ordering::SeqCst), 404);
                assert_eq!(r.ios[1].result.load(Ordering::SeqCst), 412);
                let pending = r.io(3);
                drop(pending);
                assert_eq!(r.ios[2].result.load(Ordering::SeqCst), 5);
                assert!(r.ios[2].end.load(Ordering::SeqCst) > 0);
            }
            #[test]
            fn terminal_candidate_requires_real_drain_marker_and_recorded_public_inactivity() {
                let r = Recorder::new();
                let mut public = r.request();
                let mut drain = r.io(3);
                drain.returned(1);
                assert_eq!(r.drain_report(true, &drain)["terminal_candidate"], false);
                public.returned(200);
                drop(public);
                let terminal = r.drain_report(true, &drain);
                assert_eq!(terminal["reason"], "terminal");
                assert_eq!(terminal["terminal_candidate"], true);
                assert_eq!(terminal["terminal_rainfall_drained"], true);
                assert_eq!(terminal["terminal_recorded_public_inactive"], true);
                assert_eq!(terminal["terminal_drain_io_slot"], 0);
                assert_eq!(r.drain_report(false, &drain)["terminal_candidate"], false);
                let pending = r.io(3);
                assert_eq!(r.drain_report(true, &pending)["terminal_candidate"], false);
                assert_eq!(r.report("response")["terminal_candidate"], false);
            }
            #[test]
            fn last_slot_claim_before_activation_is_invalidated_by_concurrent_overflow() {
                use std::sync::mpsc;
                let r = Recorder::new();
                let mut earlier = r.request();
                let old_trace = r.association();
                old_trace.stamp(Event::SnapshotEnter);
                earlier.returned(200);
                drop(earlier);
                let before = r.report("control");
                assert_eq!(before["association_invalidated"], false);
                assert_eq!(before["requests"][0]["http_status"], 200);
                r.next.store(REQUESTS - 1, Ordering::SeqCst);
                let (claimed_tx, claimed_rx) = mpsc::channel();
                let (resume_tx, resume_rx) = mpsc::channel();
                let worker = {
                    let r = r.clone();
                    std::thread::spawn(move || {
                        let slot = r.claim_request();
                        claimed_tx.send(slot).unwrap();
                        resume_rx
                            .recv_timeout(Duration::from_secs(2))
                            .expect("finite last-slot barrier");
                        let mut public = r.activate_request(slot);
                        public.returned(200);
                        drop(public);
                    })
                };
                assert_eq!(
                    claimed_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
                    Some(REQUESTS - 1)
                );
                // A owns the last index, but active is still false.
                assert!(!r.slots[REQUESTS - 1].active.load(Ordering::SeqCst));
                let overflow = r.request(); // B is an unrecorded request at exactly this boundary.
                assert!(r.overflowed());
                assert_eq!(r.association().slot, None);
                old_trace.stamp(Event::SnapshotReady);
                old_trace.remaining(3, Instant::now() + Duration::from_secs(3));
                assert_eq!(
                    old_trace.read(17, || 123),
                    123,
                    "invalidation must not suppress the delegate"
                );
                assert_eq!(event(&r, 0, Event::SnapshotReady), 0);
                assert_eq!(r.slots[0].first_read.load(Ordering::SeqCst), 0);
                drop(overflow);
                resume_tx.send(()).unwrap();
                worker.join().unwrap();
                assert_eq!(r.association().slot, None);
                assert_eq!(r.slots[REQUESTS - 1].status.load(Ordering::SeqCst), 0);
                let after = r.report("control");
                assert_eq!(after["association_invalidated"], true);
                assert_eq!(after["request_overflow"], 1);
                for request in after["requests"].as_array().unwrap() {
                    assert_eq!(request["association_ambiguous"], true);
                    assert_eq!(request["http_status"], 0);
                    assert_eq!(request["source_answer"], 0);
                    assert_eq!(request["first_read_method"], 0);
                    assert_eq!(request["events_ns"], json!({}));
                    assert_eq!(request["remaining_ns_plus_one"], json!([0, 0, 0, 0]));
                }
                // `before` was returned before B overflowed. Its interpretation is deliberately
                // revoked by the whole-log collector; a report finalcheck cannot close that race.
            }
            #[test]
            fn overlapping_requests_are_ambiguous_and_slots_never_reuse() {
                let r = Recorder::new();
                let a = r.request();
                assert_eq!(r.association().slot, Some(0));
                let b = r.request();
                assert_eq!(r.association().slot, None);
                assert!(r.slots[0].ambiguous.load(Ordering::SeqCst));
                assert!(r.slots[1].ambiguous.load(Ordering::SeqCst));
                drop(b);
                assert_eq!(
                    r.association().slot,
                    None,
                    "previous overlap remains ambiguous"
                );
                drop(a);
                let c = r.request();
                assert_eq!(r.association().slot, Some(2));
                drop(c);
                for _ in 3..REQUESTS + 7 {
                    drop(r.request());
                }
                for _ in 0..IOS + 9 {
                    let mut io = r.io(1);
                    io.returned(200);
                }
                let report = r.report("control");
                assert_eq!(report["requests"].as_array().unwrap().len(), REQUESTS);
                assert_eq!(report["server_io"].as_array().unwrap().len(), IOS);
                assert_eq!(report["request_overflow"], 7);
                assert_eq!(report["io_overflow"], 9);
                assert!(serde_json::to_vec(&report).unwrap().len() < 64 * 1024);
                let original_enter = event(&r, 0, Event::PublicEnter);
                r.next.store(usize::MAX, Ordering::SeqCst);
                r.next_io.store(usize::MAX, Ordering::SeqCst);
                drop(r.request());
                drop(r.request());
                drop(r.io(1));
                drop(r.io(1));
                assert_eq!(r.next.load(Ordering::SeqCst), usize::MAX);
                assert_eq!(r.next_io.load(Ordering::SeqCst), usize::MAX);
                assert_eq!(event(&r, 0, Event::PublicEnter), original_enter);
            }
        }
    }

    fn publication(time: u16) -> Publication {
        Publication::new(DAY, time).unwrap()
    }
    fn utc(time: u16) -> i64 {
        schedule::to_ms(publication(time))
    }
    fn digest(value: Value) -> String {
        sha256(&serde_json::to_vec(&value).unwrap())
    }
    fn seed_bytes() -> Vec<u8> {
        let line = serde_json::to_string(&json!({
            "_id": {"$oid": OID}, "stnId": "108", "stnName": "서울",
            "addr": SEED_ADDRESS, "isCityWeather": true,
            "altitude": 86, "geo": [126.9658, 37.5714], "__v": 0,
            "rnsHit": 3, "rnsCount": 4, "isMountain": false
        }))
        .unwrap()
            + "\n";
        let manifest = json!({
            "schema": 1, "tool": "export_station_seeds", "collection": "kmastninfos",
            "exportedAt": "2026-10-16T00:00:00.000Z", "documents": 1,
            "sourceSha256": sha256(line.as_bytes())
        });
        format!("{}\n{line}", serde_json::to_string(&manifest).unwrap()).into_bytes()
    }
    fn checkpoint(bytes: &[u8]) -> Vec<u8> {
        let imported = seed::parse(bytes).unwrap();
        let seed_hash = sha256(bytes);
        serde_json::to_vec(&json!({
            "schema": 1, "revision": 1,
            "activation": {
                "epoch": sha256(b"owned-rainfall-handover-2819"), "policy": POLICY,
                "target": {"bucket": "server2-local", "region": "ap-northeast-2"},
                "source": {"store": "mongo", "database": "owned-test", "collection": "kmastninfos"},
                "seed_body_sha256": seed_hash,
                "seed_source_sha256": imported.source_sha256,
                "seed_exported_at_ms": imported.exported_at_ms, "seed_documents": 1,
                "seed_identity_sha256": digest(json!(["rns-identities-v1", [OID]])),
                "baseline_sha256": digest(json!(["rns-baseline-v1", seed_hash, [[OID, 3.0, 4.0]]])),
                "shutdown_at_ms": imported.exported_at_ms - 60_000,
                "shutdown_evidence_sha256": sha256(b"synthetic-owned-test-shutdown-proof"),
                "first_end_ms": pages::page_date("2026.10.17.10:00") as u64,
                "first_end_basis": "full-post-shutdown-hour", "legacy_highwater_ms": null
            },
            "rows": [{"oid": OID, "rns_hit": 3.0, "rns_count": 4.0,
                      "last_end_ms": null, "receipt": null}]
        }))
        .unwrap()
    }
    fn current_page() -> Vec<u8> {
        let values = [
            ("PTY", "1"),
            ("RN1", "0.5"),
            ("T1H", "18"),
            ("REH", "60"),
            ("UUU", "1.2"),
            ("VEC", "200"),
            ("VVV", "-0.5"),
            ("WSD", "2.1"),
        ];
        let items: Vec<Value> = values
            .iter()
            .map(|(category, value)| {
                json!({
                    "baseDate": DAY.to_string(), "baseTime": "1000", "category": category,
                    "nx": 60, "ny": 127, "obsrValue": value
                })
            })
            .collect();
        serde_json::to_vec(&json!({"response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {"dataType": "JSON", "items": {"item": items},
                     "pageNo": 1, "numOfRows": 999, "totalCount": items.len()}
        }}))
        .unwrap()
    }
    fn minute_page(at: Publication, rain: bool) -> Vec<u8> {
        let mark = if rain {
            "<font color=blue>●</font>"
        } else {
            "<font color=red>○</font>"
        };
        let columns = [
            "108",
            "서울",
            "86m",
            mark,
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "18.4",
            "270.1",
            "W",
            "1.2",
            "265.0",
            "WSW",
            "1.4",
            "61",
            "1013.2",
            "서울특별시 종로구 송월동",
        ];
        let cells: String = columns.iter().map(|c| format!("<td>{c}</td>")).collect();
        let html = format!(
            concat!(
                r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
                "\n",
                r#"<span class=ehead>[ 매분관측자료 ] 2026.10.17.{:02}:{:02}</span>"#,
                "\n",
                r#"<table border=0 cellspacing=0 cellpadding=0><tr><td bgcolor=#999999><table border=0 cellspacing=1 cellpadding=1>"#,
                "\n",
                r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#,
                "\n",
                r#"<tr align=center class=text>{cells}</tr>"#,
                "\n",
                r#"</table></td></tr></table></BODY></HTML>"#
            ),
            at.hour(),
            at.minute(),
            cells = cells
        );
        encoding_rs::EUC_KR.encode(&html).0.into_owned()
    }
    async fn publish_record(store: &CatalogStore<Transport>, record: RawRecord) {
        let id = &record.envelope.identity;
        let partition = if id.kind == "ultra-srt-ncst" {
            format!("{}-{}", id.period.local_date, id.period.slot)
        } else {
            id.period.local_date.to_string()
        };
        let member = GroupMember {
            catalogs: vec![CatalogId::for_record(&record.envelope.identity, &partition).unwrap()],
            envelope: record.envelope.clone(),
        };
        store
            .publish(
                GroupDeclaration::new(vec![member], &CatalogLimits::default()).unwrap(),
                vec![record],
                deadline(),
            )
            .await
            .unwrap();
    }
    #[allow(clippy::too_many_arguments)]
    fn record(
        source: &str,
        kind: &str,
        key: &ProviderKey,
        at: Publication,
        fetched: u64,
        body: Vec<u8>,
        content_type: &str,
    ) -> RawRecord {
        RawRecord::new(
            source,
            kind,
            key,
            at.period(),
            fetched,
            200,
            content_type,
            None,
            body.into(),
            &CatalogLimits::default().raw,
        )
        .unwrap()
    }
    async fn prepare(transport: Transport, active: bool) {
        let store = CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap();
        // Reuse the existing owned forecast-zone fixture; other sections may legitimately be empty.

        let bytes = seed_bytes();
        let acquired = seed::acquisition(&bytes).unwrap();
        store
            .publish(acquired.declaration, acquired.records, deadline())
            .await
            .unwrap();
        let current = record(
            "data-go-kr",
            "ultra-srt-ncst",
            &Grid::new(60, 127).unwrap().provider_key(),
            publication(1000),
            utc(1040) as u64,
            current_page(),
            "application/json",
        );
        eprintln!(
            "rainfall current identity: {}",
            serde_json::to_string(&current.envelope.identity).unwrap()
        );
        publish_record(&store, current).await;
        let key = ProviderKey::Named {
            id: "aws-national".into(),
        };
        let mut rows = RowStore::default();
        let mut identities = Vec::new();
        for offset in (2..=60).step_by(2).chain(std::iter::once(106)) {
            let at = schedule::from_ms(utc(900) + offset * 60_000);
            let body = minute_page(at, offset == 2);
            let parsed = pages::parse_aws(&body, None).expect("owned minute HTML must parse");
            assert_eq!(
                parsed.rows.len(),
                1,
                "one actual sensor row per raw acquisition"
            );
            assert_eq!(parsed.rows[0].get("rns"), Some(&Val::Bool(offset == 2)));
            rows.save(&parsed.rows);
            let raw = record(
                "kma-web",
                "aws-minute",
                &key,
                at,
                (schedule::to_ms(at) + 30_000) as u64,
                body,
                "text/html;charset=euc-kr",
            );
            identities.push(raw.envelope.identity.clone());
            publish_record(&store, raw).await;
        }
        let end = pages::page_date("2026.10.17.10:00");
        let window: Vec<_> = rows
            .after(108., end - 3_600_000.)
            .into_iter()
            .filter(|r| server2::domestic::kma::source::stations::date_of(r) <= end)
            .collect();
        assert_eq!(
            window.len(),
            30,
            "statistics window contains 30 actual unique minutes"
        );
        assert_eq!(
            window
                .iter()
                .filter(|r| r.get("rns") == Some(&Val::Bool(true)))
                .count(),
            1
        );
        assert_eq!(
            server2::domestic::kma::source::stations::date_of(&window[0]),
            pages::page_date("2026.10.17.09:02")
        );
        assert_eq!(
            identities.len(),
            31,
            "10:46 false is only a public station-path input"
        );
        eprintln!(
            "rainfall minute identities: {}",
            serde_json::to_string(&identities).unwrap()
        );
        eprintln!("rainfall seed sha256: {}", sha256(&bytes));
        if active {
            let body = checkpoint(&bytes);
            assert_eq!(
                transport
                    .put_control(STATE_KEY, &body, &WriteCondition::Absent)
                    .await
                    .unwrap(),
                200
            );
            assert_eq!(
                transport
                    .get_control(STATE_KEY, 1024 * 1024)
                    .await
                    .unwrap()
                    .body,
                body
            );
        }
    }

    struct Denied;
    impl Acquire for Denied {
        fn web(
            &self,
            _: server2::domestic::family::WebRequest,
            _: Instant,
        ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
            Box::pin(async { Err(DomesticError::Transport) })
        }
        fn asos(
            &self,
            _: server2::domestic::asos::AsosRequest,
            _: Instant,
        ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
            Box::pin(async { Err(DomesticError::Transport) })
        }
    }
    impl Locate for Denied {
        fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
            Box::pin(async { None })
        }
    }
    impl Geocoder for Denied {
        fn coord(
            &self,
            _: [f64; 2],
            _: String,
        ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, GatewayError>> {
            Box::pin(async { Err(GatewayError::NotFound) })
        }
        fn addr(
            &self,
            _: String,
            _: String,
        ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, GatewayError>> {
            Box::pin(async { Err(GatewayError::NotFound) })
        }
    }
    fn transport(endpoint: &str) -> Result<Transport, Box<dyn std::error::Error>> {
        let url = reqwest::Url::parse(endpoint)?;
        if url.scheme() != "http"
            || !url
                .host_str()
                .and_then(|h| h.parse::<std::net::IpAddr>().ok())
                .is_some_and(|ip| ip.is_loopback())
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("owned command requires loopback root".into());
        }
        Ok(BoundedS3::new(
            HttpS3Transport::new(
                endpoint,
                "server2-local",
                "ap-northeast-2",
                rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
            )?,
            4,
        ))
    }
    async fn next(transport: Transport) {
        let store = CatalogStore::new(transport, CatalogLimits::default()).unwrap();
        let mut page: Value = serde_json::from_slice(&current_page()).unwrap();
        for item in page["response"]["body"]["items"]["item"]
            .as_array_mut()
            .unwrap()
        {
            item["baseTime"] = json!("1100");
        }
        publish_record(
            &store,
            record(
                "data-go-kr",
                "ultra-srt-ncst",
                &Grid::new(60, 127).unwrap().provider_key(),
                publication(1100),
                utc(1140) as u64,
                serde_json::to_vec(&page).unwrap(),
                "application/json",
            ),
        )
        .await;
        let key = ProviderKey::Named {
            id: "aws-national".into(),
        };
        let mut ids = Vec::new();
        for offset in (2..=60).step_by(2).chain(std::iter::once(106)) {
            let at = schedule::from_ms(utc(1000) + offset * 60_000);
            let raw = record(
                "kma-web",
                "aws-minute",
                &key,
                at,
                (schedule::to_ms(at) + 30_000) as u64,
                minute_page(at, false),
                "text/html;charset=euc-kr",
            );
            ids.push(raw.envelope.identity.clone());
            publish_record(&store, raw).await;
        }
        eprintln!(
            "rainfall next minute identities: {}",
            serde_json::to_string(&ids).unwrap()
        );
    }
    fn many_seed() -> Vec<u8> {
        let mut lines = String::new();
        for id in 1..=1024 {
            lines += &(serde_json::to_string(&json!({"_id":{"$oid":format!("{id:024x}")},"stnId":id.to_string(),"stnName":"owned","addr":SEED_ADDRESS,"isCityWeather":true,"geo":[126.9658,37.5714],"rnsHit":3,"rnsCount":4,"isMountain":false})).unwrap()+"\n");
        }
        format!("{}\n{lines}", json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos","exportedAt":"2026-10-16T00:01:00.000Z","documents":1024,"sourceSha256":sha256(lines.as_bytes())})).into_bytes()
    }
    fn state_for_seed(bytes: &[u8], target: &Namespace) -> Checkpoint {
        use server2::domestic::kma::source::rainfall_store::{self, Activation};
        let seed = seed::parse(bytes).unwrap();
        let rows = rainfall_store::baseline(&seed).unwrap();
        let mut activation: Activation = serde_json::from_value(
            serde_json::from_slice::<Value>(&checkpoint(&seed_bytes())).unwrap()["activation"]
                .clone(),
        )
        .unwrap();
        activation.seed_body_sha256 = sha256(bytes);
        activation.seed_source_sha256 = seed.source_sha256.clone();
        activation.seed_exported_at_ms = seed.exported_at_ms;
        activation.seed_documents = seed.docs.len();
        activation.seed_identity_sha256 = rainfall_store::identity_digest(&rows);
        activation.baseline_sha256 = rainfall_store::baseline_digest(&seed, &rows);
        Checkpoint::initial(activation, &seed, target).unwrap()
    }
    fn rows_page(at: Publication) -> Vec<u8> {
        let mut html = format!(
            "<HTML><BODY><span class=ehead>[ 매분관측자료 ] 2026.10.17.{:02}:{:02}</span><table><tr><td><table><tr><td>header</td></tr>",
            at.hour(),
            at.minute()
        );
        for id in 1..=1024 {
            html += "<tr>";
            for cell in [
                id.to_string(),
                "x".into(),
                "1m".into(),
                "○".into(),
                "0".into(),
                "0".into(),
                "0".into(),
                "0".into(),
                "0".into(),
                "0".into(),
                "1".into(),
                "1".into(),
                "W".into(),
                "1".into(),
                "1".into(),
                "W".into(),
                "1".into(),
                "1".into(),
                "1".into(),
                "x".into(),
            ] {
                html += &format!("<td>{cell}</td>");
            }
            html += "</tr>";
        }
        html += "</table></td></tr></table></BODY></HTML>";
        encoding_rs::EUC_KR.encode(&html).0.into_owned()
    }
    fn padded_minute(at: Publication, wanted: usize) -> Vec<u8> {
        pad(minute_page(at, false), wanted)
    }
    fn pad(mut page: Vec<u8>, wanted: usize) -> Vec<u8> {
        let extra = wanted
            .checked_sub(page.len())
            .expect("profile page exceeds base HTML");
        let at = page.windows(7).position(|p| p == b"</BODY>").unwrap();
        let mut padding = Vec::with_capacity(extra);
        for _ in 0..extra / 8 {
            padding.extend_from_slice(b"<i>x</i>");
        }
        padding.resize(extra, b' ');
        page.splice(at..at, padding);
        assert_eq!(page.len(), wanted);
        page
    }
    async fn pressure(transport: Transport, profile: &str) {
        prepare(transport.clone(), false).await;
        let store = CatalogStore::new(transport, CatalogLimits::default()).unwrap();
        let base: usize = (2..=60)
            .step_by(2)
            .map(|offset| {
                minute_page(schedule::from_ms(utc(900) + offset * 60_000), offset == 2).len()
            })
            .sum();
        let additional = match profile {
            "page" => 16,
            "count" => 226,
            "rows" => 60,
            _ => panic!("pressure profile page|count|rows"),
        };
        if profile == "rows" {
            let bytes = many_seed();
            let a = seed::acquisition(&bytes).unwrap();
            store
                .publish(a.declaration, a.records, deadline())
                .await
                .unwrap();
            let public = rows_page(publication(1046));
            assert_eq!(pages::parse_aws(&public, None).unwrap().rows.len(), 1024);
            publish_record(
                &store,
                record(
                    "kma-web",
                    "aws-minute",
                    &ProviderKey::Named {
                        id: "aws-national".into(),
                    },
                    publication(1046),
                    (utc(1046) + 30_001) as u64,
                    public,
                    "text/html;charset=euc-kr",
                ),
            )
            .await;
        }
        let remaining = 16 * 1024 * 1024 - base;
        let mut selected_bytes = base;
        let mut ids = Vec::new();
        for i in 0..additional {
            let length = if profile == "page" {
                (1024 * 1024).min(remaining - (selected_bytes - base))
            } else {
                remaining / additional + usize::from(i < remaining % additional)
            };
            let offset = if profile == "rows" {
                i + 1
            } else {
                (i % 30 + 1) * 2
            };
            let at = schedule::from_ms(utc(900) + offset as i64 * 60_000);
            let body = if profile == "rows" {
                let page = rows_page(at);
                assert_eq!(pages::parse_aws(&page, None).unwrap().rows.len(), 1024);
                pad(page, length)
            } else {
                padded_minute(at, length)
            };
            let raw = record(
                "kma-web",
                "aws-minute",
                &ProviderKey::Named {
                    id: "aws-national".into(),
                },
                at,
                utc(1045) as u64 + i as u64,
                body,
                "text/html;charset=euc-kr",
            );
            selected_bytes += raw.bytes.len();
            ids.push(raw.envelope.identity.clone());
            publish_record(&store, raw).await;
        }
        assert_eq!(selected_bytes, 16 * 1024 * 1024);
        assert!(additional + 30 <= 256);
        eprintln!(
            "rainfall pressure identities: {}",
            serde_json::to_string(&ids).unwrap()
        );
        println!(
            "{}",
            json!({"profile":profile,"selected_acquisitions":additional+30,"selected_raw_bytes":selected_bytes,"max_page_bytes": if profile == "page" {1024*1024} else {remaining.div_ceil(additional)},"target_identities":if profile=="rows"{1024}else{1},"maximum_retained_projection":if profile=="rows"{60*1024}else{30},"padded_shape":"flat i/text nodes appended inside body; full actual20-column station rows retained"})
        );
    }
    fn pressure_source_files() -> Value {
        json!([
            [
                "rainfall_input.rs",
                sha256(include_bytes!(
                    "../../src/domestic/kma/source/rainfall_input.rs"
                ))
            ],
            [
                "rainfall.rs",
                sha256(include_bytes!("../../src/domestic/kma/source/rainfall.rs"))
            ],
            [
                "pages.rs",
                sha256(include_bytes!("../../src/domestic/kma/source/pages.rs"))
            ],
            [
                "html.rs",
                sha256(include_bytes!("../../src/domestic/kma/source/html.rs"))
            ],
            [
                "stations.rs",
                sha256(include_bytes!("../../src/domestic/kma/source/stations.rs"))
            ],
            [
                "doc.rs",
                sha256(include_bytes!("../../src/domestic/kma/source/doc.rs"))
            ],
            [
                "js.rs",
                sha256(include_bytes!("../../src/domestic/kma/js.rs"))
            ],
            [
                "html-entities.json",
                sha256(include_bytes!(
                    "../../src/domestic/kma/source/data/html-entities.json"
                ))
            ],
            ["Cargo.toml", sha256(include_bytes!("../../Cargo.toml"))],
            ["Cargo.lock", sha256(include_bytes!("../../Cargo.lock"))],
            [
                "rainfall_activation.rs",
                sha256(include_bytes!("rainfall_activation.rs"))
            ]
        ])
    }
    async fn export_pressure(
        transport: Transport,
        profile: &str,
        output: &std::path::Path,
    ) -> Result<(), Box<dyn std::error::Error>> {
        use server2::storage::{Catalog, PageOutcome};
        let expected_count = match profile {
            "page" => 46,
            "count" => 256,
            "rows" => 90,
            _ => return Err("pressure profile page|count|rows".into()),
        };
        // This explicit fixture export never accepts a source path or a cloud object namespace.
        std::fs::create_dir(output)?;
        let id = CatalogId {
            source: "kma-web".into(),
            kind: "aws-minute".into(),
            key_sha256: sha256(
                &ProviderKey::Named {
                    id: "aws-national".into(),
                }
                .canonical_bytes()?,
            ),
            partition: DAY.to_string(),
        };
        let before = transport.get_control(&id.key(), 1024 * 1024).await?;
        let control = Catalog::from_bytes(&before.body, &id, &CatalogLimits::default())?;
        let end = pages::page_date("2026.10.17.10:00") as u64;
        let start = end - 3_600_000;
        let cutoff = u64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_millis(),
        )?;
        let mut selected = Vec::new();
        for envelope in control.entries {
            let at = Publication::new(
                envelope.identity.period.local_date,
                envelope.identity.period.slot.parse()?,
            )
            .ok_or("corpus publication")?;
            let wall = u64::try_from(schedule::to_ms(at))? + 9 * 3_600_000;
            if wall > start && wall <= end && envelope.identity.fetched_at_ms <= cutoff {
                selected.push(envelope);
            }
        }
        selected.sort_by(|a, b| {
            let a = &a.identity;
            let b = &b.identity;
            (
                a.fetched_at_ms,
                &a.raw_sha256,
                a.period.local_date,
                &a.period.slot,
                &a.source,
                &a.kind,
                &a.key_sha256,
            )
                .cmp(&(
                    b.fetched_at_ms,
                    &b.raw_sha256,
                    b.period.local_date,
                    &b.period.slot,
                    &b.source,
                    &b.kind,
                    &b.key_sha256,
                ))
        });
        if selected.len() != expected_count {
            return Err("physical corpus count mismatch".into());
        }
        let store = CatalogStore::new(transport.clone(), CatalogLimits::default())?;
        let mut records = Vec::new();
        let mut total = 0usize;
        for (n, envelope) in selected.iter().enumerate() {
            let PageOutcome::Ready(page) = store
                .lookup_acquisition(&id, &envelope.identity, deadline())
                .await?
            else {
                return Err("physical corpus incomplete".into());
            };
            if page.excluded_groups() != 0
                || page.acquisitions().len() != 1
                || page.acquisitions()[0].records().len() != 1
            {
                return Err("physical corpus member group".into());
            }
            let raw = &page.acquisitions()[0].records()[0];
            if raw.envelope != *envelope || raw.bytes.len() > 1024 * 1024 {
                return Err("physical corpus member binding".into());
            }
            total = total
                .checked_add(raw.bytes.len())
                .filter(|n| *n <= 16 * 1024 * 1024)
                .ok_or("physical corpus raw cap")?;
            let file = format!("raw-{n:03}.bin");
            std::fs::write(output.join(&file), &raw.bytes)?;
            records.push(json!({"file":file,"envelope":raw.envelope}));
        }
        if total != 16 * 1024 * 1024 {
            return Err("physical corpus total mismatch".into());
        }
        let after = transport.get_control(&id.key(), 1024 * 1024).await?;
        if before.body != after.body || before.etag != after.etag || before.version != after.version
        {
            return Err("physical corpus catalog changed".into());
        }
        std::fs::write(output.join("catalog-0.json"), &before.body)?;
        let manifest = json!({"schema":1,"profile":profile,"source_files":pressure_source_files(),"current_end_ms":end,
            "cutoff_at_ms":cutoff,"selected_raw_bytes":total,
            "sensors":if profile=="rows" { (1..=1024).map(|n|n as f64).collect::<Vec<_>>() } else { vec![108.] },
            "controls":[{"file":"catalog-0.json","id":id,"body_sha256":sha256(&before.body),"etag":before.etag,"version":before.version}],
            "records":records});
        let bytes = serde_json::to_vec(&manifest)?;
        if bytes.len() > 1024 * 1024 {
            return Err("physical corpus manifest cap".into());
        }
        std::fs::write(output.join("manifest.json"), &bytes)?;
        println!(
            "{}",
            json!({"operation":"owned-export-pressure","profile":profile,"manifest_sha256":sha256(&bytes),"selected_raw_bytes":total,"selected_records":records.len(),"source_files":pressure_source_files()})
        );
        Ok(())
    }
    pub async fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
        if args.len() < 2 {
            return Err("owned command requires operation and endpoint".into());
        }
        let operation = &args[0];
        let t = transport(&args[1])?;
        match operation.as_str() {
            "owned-prepare" => prepare(t, false).await,
            "owned-pressure" => {
                pressure(t, args.get(2).ok_or("pressure profile page|count|rows")?).await
            }
            "owned-export-pressure" => {
                let endpoint: reqwest::Url = args[1].parse()?;
                if endpoint.scheme() != "http"
                    || endpoint.host_str() != Some("127.0.0.1")
                    || endpoint.port().is_none()
                {
                    return Err(
                        "physical corpus export requires the explicit owned IPv4 loopback peer"
                            .into(),
                    );
                }
                export_pressure(
                    t,
                    args.get(2).ok_or("export profile")?,
                    std::path::Path::new(args.get(3).ok_or("export output directory")?),
                )
                .await?;
            }
            "owned-next" => next(t).await,
            "owned-activate" => {
                let bytes = if args.get(2).is_some_and(|p| p == "rows") {
                    many_seed()
                } else {
                    seed_bytes()
                };
                let seed = seed::parse(&bytes)?;
                let target = Namespace::new("server2-local".into(), "ap-northeast-2".into())?;
                let state = state_for_seed(&bytes, &target);
                let store = Store {
                    transport: t,
                    target,
                };
                store.activate(&state, &seed, deadline()).await?;
                println!(
                    "{}",
                    json!({"operation":"owned-activate","acknowledged":true,"bytes":state.encode()?.len()})
                );
            }
            "owned-server" => {
                let time: u16 = args.get(2).ok_or("owned-server needs HHMM")?.parse()?;
                let clock: Clock = Arc::new(move || utc(time) as f64);
                let recorder = diagnostic::Recorder::new();
                let source = Arc::new(
                    S3Source::new(
                        diagnostic::TransportTrace {
                            inner: t,
                            recorder: recorder.clone(),
                        },
                        clock.clone(),
                        Arc::new(Denied),
                        Arc::new(Denied),
                    )?
                    .with_rainfall(Namespace::new(
                        "server2-local".into(),
                        "ap-northeast-2".into(),
                    )?)?,
                );
                let rainfall = source.rainfall_owner().expect("owned source owner");
                let source = Arc::new(diagnostic::Source {
                    inner: source,
                    recorder: recorder.clone(),
                });
                let backend = Arc::new(KmaBackend::new(source, clock, AssemblyConfig::default()));
                let dispatcher = BackendDispatcher::native_only();
                let direct = server2::api::DirectRoutes::new(
                    backend,
                    server2::api::DirectFamilies {
                        kma_v000903: true,
                        ..Default::default()
                    },
                    dispatcher.clone(),
                );
                let gateway = Arc::new(
                    Gateway::new(Arc::new(Denied), dispatcher).with_direct(Arc::new(direct)),
                );
                let drain_recorder = recorder.clone();
                let app = axum::Router::new()
                    .route(
                        "/__owned/rainfall-drain",
                        axum::routing::post(move || {
                            let rainfall = rainfall.clone();
                            let recorder = drain_recorder.clone();
                            async move {
                                let mut trace = recorder.io(3);
                                rainfall.quiesce();
                                let drained = rainfall
                                    .drain(Instant::now() + Duration::from_secs(3))
                                    .await;
                                trace.returned(if drained { 1 } else { 6 });
                                let terminal_candidate = recorder.flush_drain(drained, &trace);
                                axum::Json(json!({"drained":drained,"terminal_candidate":terminal_candidate}))
                            }
                        }),
                    )
                    .fallback(move |request: axum::extract::Request| {
                        let gateway = gateway.clone();
                        let recorder = recorder.clone();
                        async move {
                            let mut trace = recorder.request();
                            let response = gateway.handle(request).await;
                            trace.returned(response.status().as_u16());
                            drop(trace);
                            recorder.flush("response");
                            response
                        }
                    });
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
                println!("OWNED_HTTP_READY http://{}/", listener.local_addr()?);
                axum::serve(listener, app).await?;
            }
            _ => return Err("unknown owned operation".into()),
        }
        Ok(())
    }
}
