//! Scoped synthetic feasibility tool. No public routes or inferred AWS performance claims.
#[path = "../tools/benchmark/aws.rs"]
mod aws;
#[path = "../tools/benchmark/model.rs"]
mod model;
use model::{Case, Component, Config, Sample, summarize};
use serde_json::{Value, json};
use server2::{
    budget::{BudgetPolicy, BudgetStore, Clock, Provider, SystemClock},
    cache::ResponseKey,
    providers,
    resolver::*,
    storage::*,
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
fn transport(
    s: &str,
    observed: Arc<Observations>,
) -> Result<MeasuredTransport, server2::storage::Error> {
    Ok(MeasuredTransport {
        inner: Arc::new(HttpS3Transport::new(
            s,
            "server2-local",
            "ap-northeast-2",
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )?),
        observed,
    })
}
#[derive(Clone)]
struct MeasuredTransport {
    inner: Arc<HttpS3Transport>,
    observed: Arc<Observations>,
}
#[derive(Default)]
struct Observations {
    calls: std::sync::Mutex<BTreeMap<String, Vec<Value>>>,
    counts: std::sync::Mutex<BTreeMap<String, u64>>,
}
struct Call {
    observed: Arc<Observations>,
    kind: &'static str,
    start: Instant,
    result: Option<(Option<u16>, usize, Option<usize>, String)>,
}
impl Call {
    fn new(observed: Arc<Observations>, kind: &'static str) -> Self {
        Self {
            observed,
            kind,
            start: Instant::now(),
            result: None,
        }
    }
    fn finish(&mut self, status: Option<u16>, sent: usize, received: Option<usize>, outcome: &str) {
        self.result = Some((status, sent, received, outcome.into()));
    }
}
impl Drop for Call {
    fn drop(&mut self) {
        let (status, sent, received, outcome) =
            self.result
                .take()
                .unwrap_or((None, 0, None, "cancelled_or_unobserved".into()));
        let mut counts = self.observed.counts.lock().expect("benchmark count lock");
        *counts.entry(self.kind.into()).or_insert(0) += 1;
        drop(counts);
        let mut calls = self.observed.calls.lock().expect("benchmark sample lock");
        let v = calls.entry(self.kind.into()).or_default();
        if v.len() < 4096 {
            v.push(json!({"elapsed_us":self.start.elapsed().as_micros()as u64,"received_status":status,"sent_body_bytes":sent,"received_body_bytes":received,"outcome":outcome}));
        }
    }
}
impl Observations {
    fn report(&self) -> Value {
        let calls = self.calls.lock().expect("benchmark samples");
        let counts = self.counts.lock().expect("benchmark counts");
        let mut result = BTreeMap::new();
        for (k, v) in calls.iter() {
            let durations: Vec<_> = v.iter().filter_map(|s| s["elapsed_us"].as_u64()).collect();
            result.insert(k,json!({"calls":counts[k],"retained_samples":v.len(),"sample_cap":4096,"complete":counts[k]as usize==v.len(),"retained_client_elapsed":model::Distribution::new(&durations),"samples":v}));
        }
        json!({"operations":result,"scope":"First4096 client adapter completion samples per operation; incomplete means no full-tail claim; cancelled futures have unknown received status; independent peer counts show server observations"})
    }
}
fn storage_status<T>(r: &Result<T, server2::storage::Error>) -> Option<u16> {
    match r {
        Ok(_) => Some(200),
        Err(server2::storage::Error::Status(n)) => Some(*n),
        Err(server2::storage::Error::NotFound) => Some(404),
        _ => None,
    }
}
impl ObjectTransport for MeasuredTransport {
    async fn put(&self, p: &PreparedRecord) -> Result<u16, server2::storage::Error> {
        let mut call = Call::new(self.observed.clone(), "PUT:raw");
        let r = self.inner.put(p).await;
        call.finish(
            r.as_ref().ok().copied().or_else(|| storage_status(&r)),
            p.body.len(),
            None,
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
    async fn head(&self, key: &str) -> Result<Object, server2::storage::Error> {
        let mut call = Call::new(self.observed.clone(), "HEAD:raw");
        let r = self.inner.head(key).await;
        call.finish(
            storage_status(&r),
            0,
            Some(0),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
    async fn get(&self, key: &str, max: usize) -> Result<Object, server2::storage::Error> {
        let mut call = Call::new(self.observed.clone(), "GET:raw");
        let r = self.inner.get(key, max).await;
        call.finish(
            storage_status(&r),
            0,
            r.as_ref().ok().map(|v| v.body.len()),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
}
impl CatalogTransport for MeasuredTransport {
    async fn get_control(
        &self,
        key: &str,
        max: usize,
    ) -> Result<ControlObject, server2::storage::Error> {
        let mut call = Call::new(
            self.observed.clone(),
            if key.starts_with("index/v2/groups/") {
                "GET:group"
            } else {
                "GET:catalog"
            },
        );
        let r = self.inner.get_control(key, max).await;
        call.finish(
            storage_status(&r),
            0,
            r.as_ref().ok().map(|v| v.body.len()),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
    async fn put_control(
        &self,
        key: &str,
        bytes: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, server2::storage::Error> {
        let mut call = Call::new(
            self.observed.clone(),
            if key.starts_with("index/v2/groups/") {
                "PUT:group"
            } else {
                "PUT:catalog"
            },
        );
        let r = self.inner.put_control(key, bytes, condition).await;
        call.finish(
            r.as_ref().ok().copied().or_else(|| storage_status(&r)),
            bytes.len(),
            None,
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        keys: usize,
        max: usize,
    ) -> Result<Vec<u8>, server2::storage::Error> {
        let mut call = Call::new(self.observed.clone(), "LIST:raw");
        let r = self.inner.list_raw_document(prefix, token, keys, max).await;
        call.finish(
            storage_status(&r),
            0,
            r.as_ref().ok().map(Vec::len),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
}
impl server2::budget::BudgetTransport for MeasuredTransport {
    async fn get_budget(
        &self,
        key: &str,
    ) -> Result<server2::budget::BudgetObject, server2::budget::BudgetError> {
        let mut call = Call::new(self.observed.clone(), "GET:budget");
        let r = self.inner.get_budget(key).await;
        let status = match &r {
            Ok(_) => Some(200),
            Err(server2::budget::BudgetError::NotFound) => Some(404),
            Err(server2::budget::BudgetError::Status(n)) => Some(*n),
            _ => None,
        };
        call.finish(
            status,
            0,
            r.as_ref().ok().map(|v| v.body.len()),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, server2::budget::BudgetError> {
        let mut call = Call::new(self.observed.clone(), "PUT:budget");
        let r = self.inner.put_budget(key, body, condition).await;
        call.finish(
            r.as_ref().ok().copied(),
            body.len(),
            None,
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
}
struct MeasuredProvider {
    inner: providers::HttpProviderTransport,
    observed: Arc<Observations>,
}
impl providers::ProviderTransport for MeasuredProvider {
    async fn send(
        &self,
        request: &providers::Request,
    ) -> Result<providers::ProviderResponse, providers::ProviderTransportError> {
        let mut call = Call::new(self.observed.clone(), "GET:provider");
        let r = self.inner.send(request).await;
        call.finish(
            r.as_ref().ok().map(|r| r.status),
            0,
            r.as_ref().ok().map(|r| r.body.len()),
            if r.is_ok() { "returned" } else { "error" },
        );
        r
    }
}

fn outcome(e: &server2::resolver::Error) -> String {
    match e {
        server2::resolver::Error::Storage(server2::storage::Error::Capacity) => "capacity",
        server2::resolver::Error::Storage(server2::storage::Error::Timeout) => "timeout",
        server2::resolver::Error::Storage(server2::storage::Error::Ambiguous) => "ambiguous",
        server2::resolver::Error::Incomplete => "incomplete",
        server2::resolver::Error::AcquisitionDenied => "acquisition_denied",
        _ => "other_error",
    }
    .into()
}
#[derive(Clone)]
struct Fixture {
    requests: Vec<ResolutionRequest>,
    catalog_keys: Vec<String>,
}
fn acquisition(
    i: usize,
    p: Period,
    f: u64,
    body: Vec<u8>,
    siblings: usize,
    partition: &str,
) -> Result<Acquisition, server2::storage::Error> {
    let raw = RawRecord::new(
        "benchmark",
        "synthetic-json",
        &ProviderKey::Grid {
            nx: (i % 149 + 1) as u16,
            ny: (i / 149 + 1) as u16,
        },
        p,
        f,
        200,
        "application/json",
        None,
        body.into(),
        &Limits::default(),
    )?;
    let catalogs = (0..siblings)
        .map(|s| CatalogId::for_record(&raw.envelope.identity, &format!("{partition}-{s}")))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Acquisition {
        declaration: GroupDeclaration::new(
            vec![GroupMember {
                envelope: raw.envelope.clone(),
                catalogs,
            }],
            &CatalogLimits::default(),
        )?,
        records: vec![raw],
    })
}
fn body(i: usize, r: usize, size: usize) -> Vec<u8> {
    let mut v = b"{\"ok\":true,\"padding\":\"".to_vec();
    let end = size - 2;
    let mut state = (i as u64 + 1)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(r as u64 + 1);
    while v.len() < end {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        v.push(b'a' + (state % 26) as u8);
    }
    v.extend_from_slice(b"\"}");
    v
}
fn request(
    c: &Case,
    run: &str,
    i: usize,
    seg: usize,
    id: CatalogId,
    periods: Vec<Period>,
    target: RecordId,
) -> Result<ResolutionRequest, server2::resolver::Error> {
    let mut params = BTreeMap::new();
    params.insert("benchmark_segment".into(), seg.to_string());
    let response = ResponseKey::new(
        "benchmark/synthetic",
        "v000903",
        &format!("{run}-{}-{i}", c.name),
        "en",
        "C",
        "aqi",
        "s09-synthetic-1",
        params,
    )?;
    let selection = match c.selection.as_str() {
        "targeted" => ReadSelection::Targeted(target),
        "latest" => ReadSelection::Latest,
        _ => ReadSelection::FullHistory,
    };
    ResolutionRequest::new(
        response,
        RepairScope {
            catalog: id,
            periods,
        },
        selection,
        64,
        32 * 1024 * 1024,
        Duration::from_secs(60),
        Duration::from_secs(60),
    )
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| "admin client".into())
}
async fn forget(c: &Config, key: &str) -> Result<(), String> {
    let mut u: reqwest::Url = format!("{}__benchmark/forget", c.s3_endpoint)
        .parse()
        .map_err(|_| "admin URL")?;
    u.query_pairs_mut().append_pair("key", key);
    let r = client()?
        .post(u)
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .map_err(|_| "forget wire")?;
    if r.status().as_u16() != 204 {
        return Err("forget status".into());
    }
    Ok(())
}
async fn fixture(
    c: &Config,
    k: &Case,
    i: usize,
    observed: Arc<Observations>,
) -> Result<Fixture, String> {
    let store = CatalogStore::new(
        transport(&c.s3_endpoint, observed.clone()).map_err(|_| "transport")?,
        CatalogLimits::default(),
    )
    .map_err(|_| "store")?;
    let mut requests = vec![];
    let mut keys = vec![];
    for day in 0..if k.workload == "history8" { 8 } else { 1 } {
        let mut periods = vec![];
        let mut first = None;
        let mut id = None;
        for r in 0..if k.workload == "history8" {
            24
        } else {
            k.revisions
        } {
            let p = Period {
                local_date: 20261001 + day,
                slot: if k.workload == "history8" {
                    format!("{r:02}00")
                } else {
                    "1200".into()
                },
            };
            if !periods.contains(&p) {
                periods.push(p.clone())
            }
            let a = acquisition(
                i,
                p,
                (r + 1) as u64,
                body(i, r, k.record_bytes),
                k.siblings,
                &format!("{}-{day}", c.run_id),
            )
            .map_err(|_| "fixture group")?;
            if first.is_none() {
                first = Some(a.records[0].envelope.identity.clone());
                id = Some(a.declaration.partitions[0].clone());
                keys.extend(a.declaration.partitions.iter().map(CatalogId::key));
            }
            if !k.mode.starts_with("provider_") {
                store
                    .publish(a.declaration, a.records, deadline())
                    .await
                    .map_err(|e| format!("seed publication: {e}"))?;
            }
        }
        for (seg, p) in periods.chunks(16).enumerate() {
            requests.push(
                request(
                    k,
                    &c.run_id,
                    i,
                    day as usize * 2 + seg,
                    id.clone().ok_or("catalog")?,
                    p.to_vec(),
                    first.clone().ok_or("target")?,
                )
                .map_err(|e| format!("fixture request: {e:?}"))?,
            );
        }
    }
    if k.layout == "orphan" {
        for key in &keys {
            forget(c, key).await?;
        }
    }
    if k.layout == "partial" {
        for key in keys.iter().skip(1) {
            forget(c, key).await?;
        }
    }
    Ok(Fixture {
        requests,
        catalog_keys: keys,
    })
}
#[derive(Default)]
struct Timings {
    parse_us: AtomicU64,
    assembly_us: AtomicU64,
    parsed_bytes: AtomicU64,
    parse_calls: AtomicU64,
    assembly_calls: AtomicU64,
}
struct Builder(Arc<Timings>);
impl ViewBuilder for Builder {
    fn parse(
        &self,
        p: &[RawView<'_>],
        _: &str,
        o: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        let t = std::time::Instant::now();
        let mut bytes = 0;
        for r in p {
            let _: Value = serde_json::from_slice(r.bytes)
                .map_err(|_| server2::storage::Error::Corrupt("synthetic JSON"))?;
            o.append(sha256(r.bytes).as_bytes())?;
            bytes += r.bytes.len();
        }
        self.0
            .parse_us
            .fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
        self.0
            .parsed_bytes
            .fetch_add(bytes as u64, Ordering::Relaxed);
        self.0.parse_calls.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    fn assemble(
        &self,
        r: &ResolutionRequest,
        i: &CheckedInput,
        p: &[&[u8]],
        o: &mut CappedOutput,
    ) -> Result<(), server2::resolver::Error> {
        let t = std::time::Instant::now();
        if matches!(r.selection(), ReadSelection::FullHistory) {
            i.require_full_history()?;
        }
        o.append(&serde_json::to_vec(&json!({"synthetic":true,"acquisitions":p.len(),"digests":p.iter().map(|v|sha256(v)).collect::<Vec<_>>()})).map_err(|_|server2::resolver::Error::TaskFailed)?)?;
        self.0
            .assembly_us
            .fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
        self.0.assembly_calls.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}
struct Acquirer {
    observed: Arc<Observations>,
    s3: String,
    provider: String,
    mode: String,
    data: Arc<AtomicU64>,
    nodata: Arc<AtomicU64>,
    denied: Arc<AtomicU64>,
    terminal: Arc<AtomicU64>,
}
impl FundedAcquirer for Acquirer {
    async fn acquire(
        &self,
        r: AcquisitionRequest,
        c: OperationContext,
    ) -> Result<Acquisition, server2::resolver::Error> {
        if !self.mode.starts_with("provider_") {
            return Err(server2::resolver::Error::AcquisitionDenied);
        }
        c.check()?;
        let now = SystemClock
            .now_ms()
            .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        let policy = BudgetPolicy {
            provider: Provider::DataGoKr,
            quota_id: sha256(r.resolution().fingerprint()?.as_bytes()),
            window_id: "synthetic_s09".into(),
            starts_at_ms: now.saturating_sub(1000),
            ends_at_ms: now + 60000,
            limit: 2,
            block_units: 2,
        };
        let budget = Arc::new(
            BudgetStore::new(
                Arc::new(transport(&self.s3, self.observed.clone())?),
                policy,
                Arc::new(SystemClock),
            )
            .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
        );
        if self.mode == "provider_denied" {
            let _spent = budget
                .reserve(2, c.deadline())
                .await
                .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        }
        let executor = providers::FundedExecutor::new(
            Provider::DataGoKr,
            1,
            Arc::new(MeasuredProvider {
                inner: providers::HttpProviderTransport::new(65536)
                    .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
                observed: self.observed.clone(),
            }),
            Arc::new(|v: &Value| v.get("ok") == Some(&true.into())),
        )
        .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        let mode = match self.mode.as_str() {
            "provider_nodata" => "nodata",
            "provider_error" => "error",
            _ => "data",
        };
        let url = format!("{}provider?mode={mode}", self.provider)
            .parse()
            .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        let response = executor
            .execute(
                url,
                vec![providers::Candidate {
                    budget,
                    key: providers::ProviderKey::new("benchmark-only".into())
                        .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
                }],
                c.deadline(),
            )
            .await;
        let b = match response {
            Ok(providers::AcquisitionOutcome::Data(b)) => b,
            Ok(providers::AcquisitionOutcome::NoData(_)) => {
                self.nodata.fetch_add(1, Ordering::Relaxed);
                return Err(server2::resolver::Error::AcquisitionDenied);
            }
            Err(providers::AcquisitionError::Funding(_)) => {
                self.denied.fetch_add(1, Ordering::Relaxed);
                return Err(server2::resolver::Error::AcquisitionDenied);
            }
            Err(_) => {
                self.terminal.fetch_add(1, Ordering::Relaxed);
                return Err(server2::resolver::Error::AcquisitionDenied);
            }
        };
        let s = r.resolution().scope();
        let raw = RawRecord {
            envelope: Envelope {
                schema: 2,
                identity: RecordId {
                    source: s.catalog.source.clone(),
                    kind: s.catalog.kind.clone(),
                    key_sha256: s.catalog.key_sha256.clone(),
                    period: s.periods[0].clone(),
                    fetched_at_ms: 1000,
                    raw_sha256: sha256(&b.body),
                },
                status: b.status,
                content_type: b.content_type,
                raw_length: b.body.len(),
                pagination: None,
                fetch_group: None,
            },
            bytes: b.body.into(),
        };
        raw.envelope.validate(&Limits::default())?;
        self.data.fetch_add(1, Ordering::Relaxed);
        Ok(Acquisition {
            declaration: GroupDeclaration::new(
                vec![GroupMember {
                    envelope: raw.envelope.clone(),
                    catalogs: vec![s.catalog.clone()],
                }],
                &CatalogLimits::default(),
            )?,
            records: vec![raw],
        })
    }
}
type Bench = Resolver<MeasuredTransport, Acquirer, Builder>;
async fn idle(r: &Bench) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(4), async {
        while r.metrics().active_maintenance > 0 {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .map_err(|_| "maintenance idle deadline".into())
}
async fn snapshot(s: &str) -> Result<Value, String> {
    let r = client()?
        .get(format!("{s}__benchmark/status"))
        .send()
        .await
        .map_err(|_| "snapshot wire")?;
    if r.status().as_u16() != 200 {
        return Err("snapshot status".into());
    }
    let b = r.bytes().await.map_err(|_| "snapshot body")?;
    if b.len() > 65536 {
        return Err("snapshot cap".into());
    }
    serde_json::from_slice(&b).map_err(|_| "snapshot JSON".into())
}
fn metrics(r: &Bench) -> Value {
    let m = r.metrics();
    json!({"hits":m.hits,"misses":m.misses,"admission_rejections":m.admission_rejections,"foreground_io":m.foreground_io,"background_io":m.background_io,"maintenance_started":m.maintenance_started,"maintenance_finished":m.maintenance_finished,"maintenance_failed":m.maintenance_failed,"maintenance_skipped":m.maintenance_skipped,"cache_bytes":m.cache_bytes,"operation_bytes":m.operation_bytes})
}
async fn batch(r: Bench, f: Fixture, trial: usize, client: usize) -> Sample {
    let t = Instant::now();
    let mut components = vec![];
    let mut bytes = 0;
    let mut status = "success".to_string();
    for request in f.requests {
        let start = Instant::now();
        let (s, n) = match r.resolve(request, deadline()).await {
            Ok(v) => ("success".to_string(), v.bytes().len()),
            Err(e) => (outcome(&e), 0),
        };
        if s != "success" && status == "success" {
            status = s.clone();
        }
        bytes += n;
        components.push(Component {
            elapsed_us: Some(start.elapsed().as_micros() as u64),
            outcome: s,
            returned_bytes: n,
        });
    }
    Sample {
        trial,
        client,
        elapsed_us: Some(t.elapsed().as_micros() as u64),
        outcome: status,
        returned_bytes: bytes,
        components,
    }
}
async fn run(c: &Config) -> Result<Value, String> {
    let observed = Arc::new(Observations::default());
    let mut cases = vec![];
    let mut index = 0;
    for k in &c.cases {
        let mut samples = vec![];
        let mut trials = vec![];
        for trial in 0..k.trials {
            let before_seed = snapshot(&c.s3_endpoint).await?;
            let seed_started = Instant::now();
            let mut fixtures = vec![];
            for _ in 0..k.clients {
                fixtures.push(fixture(c, k, index, observed.clone()).await?);
                index += 1;
            }
            let seed_wall_us = seed_started.elapsed().as_micros() as u64;
            let after_seed = snapshot(&c.s3_endpoint).await?;
            let t = Arc::new(Timings::default());
            let data = Arc::new(AtomicU64::new(0));
            let nodata = Arc::new(AtomicU64::new(0));
            let denied = Arc::new(AtomicU64::new(0));
            let terminal = Arc::new(AtomicU64::new(0));
            let r = Resolver::new(
                CatalogBackend::new(
                    transport(&c.s3_endpoint, observed.clone()).map_err(|_| "transport")?,
                    CatalogLimits::default(),
                )
                .map_err(|_| "backend")?,
                Acquirer {
                    observed: observed.clone(),
                    s3: c.s3_endpoint.clone(),
                    provider: c.provider_endpoint.clone(),
                    mode: k.mode.clone(),
                    data: data.clone(),
                    nodata: nodata.clone(),
                    denied: denied.clone(),
                    terminal: terminal.clone(),
                },
                Builder(t.clone()),
                ResolverConfig {
                    operations: k.owners,
                    ..ResolverConfig::default()
                },
            )
            .map_err(|_| "resolver")?;
            let mut warmup = vec![];
            let mut ready = true;
            if k.mode == "warm" {
                for (i, f) in fixtures.iter().enumerate() {
                    let s = batch(r.clone(), f.clone(), trial, i).await;
                    if s.outcome != "success" {
                        ready = false;
                    }
                    warmup.push(s);
                }
                idle(&r).await?;
            }
            let before = snapshot(&c.s3_endpoint).await?;
            let mbefore = metrics(&r);
            let timing_before = [
                t.parse_us.load(Ordering::Relaxed),
                t.assembly_us.load(Ordering::Relaxed),
                t.parsed_bytes.load(Ordering::Relaxed),
                t.parse_calls.load(Ordering::Relaxed),
                t.assembly_calls.load(Ordering::Relaxed),
            ];
            let start = Instant::now();
            let mut joins = tokio::task::JoinSet::new();
            if ready {
                for (i, f) in fixtures.iter().enumerate() {
                    joins.spawn(batch(r.clone(), f.clone(), trial, i));
                }
                while let Some(s) = joins.join_next().await {
                    samples.push(s.map_err(|_| "client task failed")?);
                }
            } else {
                for i in 0..k.clients {
                    samples.push(Sample {
                        trial,
                        client: i,
                        elapsed_us: None,
                        outcome: "warm_unavailable".into(),
                        returned_bytes: 0,
                        components: vec![],
                    });
                }
            }
            let wall = start.elapsed().as_micros() as u64;
            let foreground = snapshot(&c.s3_endpoint).await?;
            let mf = metrics(&r);
            idle(&r).await?;
            let after = snapshot(&c.s3_endpoint).await?;
            let ma = metrics(&r);
            let drain = r.drain(Instant::now() + Duration::from_secs(4)).await;
            let mut durable_checks = 0usize;
            if k.mode == "provider_data" {
                let store = CatalogStore::new(
                    transport(&c.s3_endpoint, observed.clone()).map_err(|_| "durable transport")?,
                    CatalogLimits::default(),
                )
                .map_err(|_| "durable store")?;
                for f in &fixtures {
                    let LookupOutcome::Ready(set) = store
                        .lookup(&f.requests[0].scope().catalog, deadline())
                        .await
                        .map_err(|_| "fresh durable read")?
                    else {
                        return Err("fresh durable incomplete".into());
                    };
                    if set.acquisitions().len() != 1
                        || set.acquisitions()[0].records().len() != 1
                        || set.acquisitions()[0].records()[0].bytes.as_ref()
                            != b"{\"ok\":true,\"value\":42}"
                    {
                        return Err("fresh durable bytes".into());
                    }
                    durable_checks += 1;
                }
            }
            let after_verification = snapshot(&c.s3_endpoint).await?;

            trials.push(json!({"trial":trial,"warmup":warmup,"warm_available":ready,"seed_wall_us":seed_wall_us,"wire_before_seed":before_seed,"wire_after_seed":after_seed,"wire_before":before,"wire_foreground_end":foreground,"wire_after_maintenance":after,"resolver_before":mbefore,"resolver_foreground_end":mf,"resolver_after_maintenance":ma,"foreground_wall_us":wall,"parse_elapsed_us":t.parse_us.load(Ordering::Relaxed)-timing_before[0],"assembly_elapsed_us":t.assembly_us.load(Ordering::Relaxed)-timing_before[1],"parsed_bytes":t.parsed_bytes.load(Ordering::Relaxed)-timing_before[2],"parse_calls":t.parse_calls.load(Ordering::Relaxed)-timing_before[3],"assembly_calls":t.assembly_calls.load(Ordering::Relaxed)-timing_before[4],"warmup_view_timings":{"parse_elapsed_us":timing_before[0],"assembly_elapsed_us":timing_before[1],"parsed_bytes":timing_before[2],"parse_calls":timing_before[3],"assembly_calls":timing_before[4]},"acquirer_data":data.load(Ordering::Relaxed),"acquirer_nodata":nodata.load(Ordering::Relaxed),"acquirer_denied":denied.load(Ordering::Relaxed),"acquirer_terminal":terminal.load(Ordering::Relaxed),"fixture_catalogs":fixtures.iter().map(|f|f.catalog_keys.len()).sum::<usize>(),"drain":format!("{drain:?}"),"fresh_s3_only_checks":durable_checks,"wire_after_verification":after_verification}));
        }
        samples.sort_by_key(|s| (s.trial, s.client));
        let n = if k.workload == "history8" {
            192
        } else {
            k.revisions
        };
        cases.push(json!({"configuration":k,"workload_label":if k.workload=="history8"{"synthetic_16_resolution_8_day_batch"}else{"synthetic_single_resolution"},"identity_counts_scope":"requested synthetic fixture; terminal provider modes archive zero","record_revisions_per_key":n,"distinct_period_identities_per_key":if k.workload=="history8"{192}else{1},"groups_per_key":n,"catalogs_per_key":if k.workload=="history8"{8*k.siblings}else{k.siblings},"resolutions_per_client":if k.workload=="history8"{16}else{1},"summary":summarize(&samples),"samples":samples,"trials":trials}));
    }
    Ok(
        json!({"schema":1,"measurement_scope":"loopback_protocol_and_synthetic_origin_library","client_http_measurements":observed.report(),"source_provenance":provenance(),"configuration":c,"bounds":{"offered_clients_max":64,"owner_admission_max":16,"owner_deadline_ms":3000,"view_cpu":2,"catalog_io":16,"catalog_cpu":2,"raw_io":16,"raw_cpu":2,"cache_bytes":128*1024*1024,"owner_reservation_bytes":64*1024*1024,"cpu_pools_shared":false},"cases":cases,"cost_prices":null,"cloudfront_client_transport_measured":false,"api_parity_verified":false,"production_cutover_authorized":false,"gate_status":"requires_intended_host_and_same_region_measurements","rust_decision":"pending_O2","lifecycle_decision":"pending_O5"}),
    )
}
fn provenance() -> Value {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut hashes = BTreeMap::new();
    for p in [
        "benches/feasibility.rs",
        "tools/benchmark/model.rs",
        "tools/benchmark/local_peer.py",
        "Cargo.lock",
    ] {
        hashes.insert(p, std::fs::read(root.join(p)).ok().map(|b| sha256(&b)));
    }
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
    };
    let binary = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .map(|b| sha256(&b));
    json!({"checkout_revision":git(&["rev-parse","HEAD"]),"checkout_dirty":git(&["status","--porcelain"]).map(|s|!s.is_empty()),"current_source_hashes":hashes,"binary_sha256":binary,"platform":std::env::consts::OS,"arch":std::env::consts::ARCH,"note":"Dirty current source hashes are not asserted to belong to checkout_revision; later committed source mapping is separate evidence"})
}
#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    let a: Vec<_> = std::env::args().collect();
    if a.len() == 2 && a[1] == "--help" {
        println!("server2-feasibility --config PATH | --validate-config PATH");
        println!(
            "--validate-aws-config PATH | --aws-config PATH --run-manifest PATH --execute-approved-run"
        );
        println!("--local-approved-worker PATH --run-manifest PATH --loopback-s3 URL");
        println!(
            "Local modes are local-only. Live execution requires the pinned private approved allocation; O2/O5 and route gates remain pending."
        );
        return;
    }
    let result = async {
        if a.len() == 7 && a[1] == "--local-approved-worker" && a[3] == "--run-manifest" && a[5] == "--loopback-s3" {
            return aws::local_worker(std::path::Path::new(&a[2]),std::path::Path::new(&a[4]),&a[6]).await;
        }
        if a.len() == 6 && a[1] == "--aws-config" && a[3] == "--run-manifest" && a[5] == "--execute-approved-run" {
            return aws::execute(std::path::Path::new(&a[2]),std::path::Path::new(&a[4])).await;
        }
        if a.len() != 3 || !matches!(a[1].as_str(), "--config" | "--validate-config" | "--validate-aws-config") {
            return Err("usage: --config PATH".into());
        }
        if a.len() == 3 && a[1] == "--validate-aws-config" {
            let _ = aws::read_config(std::path::Path::new(&a[2])).map_err(str::to_owned)?;
            return Ok(json!({"schema":1,"configuration_valid":true,"execution":false,"metadata_requests":0,"S3_requests":0}));
        }
        let p = std::path::Path::new(&a[2]);
        if std::fs::metadata(p).map_err(|_| "config metadata")?.len() > 65536 {
            return Err("config size".into());
        }
        let file = std::fs::File::open(p).map_err(|_| "config read")?;
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(65537)
            .read_to_end(&mut bytes)
            .map_err(|_| "config read")?;
        if bytes.len() > 65536 {
            return Err("config stream size".into());
        }
        let c: Config = serde_json::from_slice(&bytes).map_err(|_| "config JSON schema")?;
        c.validate().map_err(str::to_owned)?;
        if a[1] == "--validate-config" {
            return Ok(json!({"schema":1,"configuration_valid":true,"local_only":true}));
        }
        let mut report = run(&c).await?;
        report["config_sha256"] = sha256(&bytes).into();
        Ok::<_, String>(report)
    }
    .await;
    match result {
        Ok(r) => println!("{}", serde_json::to_string(&r).expect("measurement report")),
        Err(e) => {
            eprintln!("benchmark failed: {e}");
            std::process::exit(1)
        }
    }
}
