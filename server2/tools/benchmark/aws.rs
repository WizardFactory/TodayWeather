//! Approved-run benchmark primitives. No implicit AWS discovery or runtime library changes.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use server2::{
    budget::{BudgetError, BudgetObject, BudgetTransport},
    storage::*,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::Instant;
const ACCOUNT: &str = "141248341265";
const REGION: &str = "ap-northeast-2";
const BUCKET: &str = "server2-s09-141248341265-apne2-20261008";
const ROLE: &str = "server2-s09-benchmark-20261008";
const RUN: &str = "s09-20261008-approval044959";
const ENDPOINT: &str = "https://s3.ap-northeast-2.amazonaws.com/";
const OVERHEAD: u64 = 16384;
const PROTOCOL: u64 = 65536;
const GIB: u64 = 1024 * 1024 * 1024;
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn source(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn now_ms() -> Result<u64, &'static str> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "clock")?
        .as_millis()
        .try_into()
        .map_err(|_| "clock overflow")
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct LiveCase {
    pub name: String,
    pub workload: String,
    pub mode: String,
    pub selection: String,
    pub clients: usize,
    pub owners: usize,
    pub target_samples: usize,
    pub revisions: usize,
    pub record_bytes: usize,
    pub load_model: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AwsConfig {
    pub schema: u8,
    pub execution_enabled: bool,
    pub run_id: String,
    pub account: String,
    pub region: String,
    pub bucket: String,
    pub role: String,
    pub endpoint: String,
    pub source_revision: Option<String>,
    pub source_map_sha256: Option<String>,
    pub lock_sha256: Option<String>,
    pub review_candidate_sha256: Option<String>,
    pub cases: Vec<LiveCase>,
}
impl AwsConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema != 1
            || self.run_id != RUN
            || self.account != ACCOUNT
            || self.region != REGION
            || self.bucket != BUCKET
            || self.role != ROLE
            || self.endpoint != ENDPOINT
        {
            return Err("approved resource identity");
        }
        if self.source_revision.as_ref().is_some_and(|s| !source(s))
            || [
                &self.source_map_sha256,
                &self.lock_sha256,
                &self.review_candidate_sha256,
            ]
            .iter()
            .any(|v| v.as_ref().is_some_and(|s| !digest(s)))
        {
            return Err("source hash");
        }
        if self.execution_enabled
            && (self.source_revision.is_none()
                || self.source_map_sha256.is_none()
                || self.lock_sha256.is_none()
                || self.review_candidate_sha256.is_none())
        {
            return Err("unpinned execution");
        }
        if self.cases.is_empty() || self.cases.len() > 32 {
            return Err("case count");
        }
        let mut names = std::collections::BTreeSet::new();
        for c in &self.cases {
            if c.name.is_empty()
                || c.name.len() > 32
                || !c
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || !names.insert(&c.name)
                || !matches!(c.workload.as_str(), "revisions" | "history8")
                || !matches!(
                    c.mode.as_str(),
                    "cold"
                        | "warm"
                        | "provider_data"
                        | "provider_nodata"
                        | "provider_denied"
                        | "provider_error"
                        | "repair"
                )
                || !matches!(c.selection.as_str(), "targeted" | "latest" | "full_history")
                || !matches!(c.load_model.as_str(), "hot_key" | "distinct_response_keys")
                || !matches!(c.clients, 8 | 16 | 32 | 64)
                || !(1..=16).contains(&c.owners)
                || !(1..=1000).contains(&c.target_samples)
                || !(1..=240).contains(&c.revisions)
                || !(32..=65536).contains(&c.record_bytes)
            {
                return Err("bounded live case");
            }
            if c.mode == "repair" && c.target_samples != 1 {
                return Err("repair measured once per orphan fixture");
            }
            if c.workload == "history8"
                && (c.revisions != 1
                    || c.selection != "full_history"
                    || !matches!(c.mode.as_str(), "cold" | "warm"))
            {
                return Err("history scope");
            }
            if c.mode.starts_with("provider_")
                && (c.revisions != 1 || c.workload != "revisions" || c.selection != "latest")
            {
                return Err("provider scope");
            }
        }
        Ok(())
    }
}
pub fn read_config(path: &std::path::Path) -> Result<(AwsConfig, Vec<u8>), &'static str> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "config read")?
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "config read")?;
    if bytes.len() > 65536 {
        return Err("config size");
    }
    let c: AwsConfig = serde_json::from_slice(&bytes).map_err(|_| "config schema")?;
    c.validate()?;
    Ok((c, bytes))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Allocation {
    pub read_attempts: u64,
    pub write_attempts: u64,
    pub download_bytes: u64,
    pub stored_version_charge_bytes: u64,
    pub metadata_download_bytes: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Phase {
    pub read_attempts: u64,
    pub write_attempts: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuardProof {
    pub status: String,
    pub run_id: String,
    pub instance_id: String,
    pub source_revision: String,
    pub observed_at_ms: u64,
    pub proof_sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorReservation {
    pub read_attempts: u64,
    pub write_attempts: u64,
    pub bootstrap_download_bytes: u64,
    pub administrative_download_bytes: u64,
    pub stored_version_charge_bytes: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: u8,
    pub run_id: String,
    pub allocation_id: String,
    pub source_map: BTreeMap<String, String>,
    pub account: String,
    pub region: String,
    pub bucket: String,
    pub role: String,
    pub instance_id: String,
    pub source_revision: String,
    pub source_map_sha256: String,
    pub binary_sha256: String,
    pub lock_sha256: String,
    pub requested_config_sha256: String,
    pub approval_expires_at_ms: u64,
    pub host_expires_at_ms: u64,
    pub benchmark_expires_at_ms: u64,
    pub provider_endpoint: String,
    pub allocations: Allocation,
    pub operator_reservation_summary: OperatorReservation,
    pub phases: BTreeMap<String, Phase>,
    pub guard_proof: GuardProof,
}
impl Manifest {
    pub fn validate(
        &self,
        c: &AwsConfig,
        config_hash: &str,
        binary_hash: &str,
        now: u64,
    ) -> Result<(), &'static str> {
        c.validate()?;
        if !c.execution_enabled
            || self.schema != 1
            || self.run_id != RUN
            || self.allocation_id != format!("{RUN}-worker1")
            || self.account != ACCOUNT
            || self.region != REGION
            || self.bucket != BUCKET
            || self.role != ROLE
            || self.instance_id.len() != 19
            || !self.instance_id.starts_with("i-")
            || !self.instance_id[2..].bytes().all(|b| b.is_ascii_hexdigit())
            || Some(&self.source_revision) != c.source_revision.as_ref()
            || Some(&self.source_map_sha256) != c.source_map_sha256.as_ref()
            || Some(&self.lock_sha256) != c.lock_sha256.as_ref()
            || self.binary_sha256 != binary_hash
            || self.requested_config_sha256 != config_hash
            || ![
                &self.source_map_sha256,
                &self.binary_sha256,
                &self.lock_sha256,
                &self.requested_config_sha256,
            ]
            .iter()
            .all(|s| digest(s))
        {
            return Err("manifest identity/hash");
        }
        if self.approval_expires_at_ms != 1791642600000
            || now >= self.approval_expires_at_ms
            || now >= self.host_expires_at_ms
            || now >= self.benchmark_expires_at_ms
            || self.benchmark_expires_at_ms > self.host_expires_at_ms
            || self.benchmark_expires_at_ms > self.approval_expires_at_ms
            || self.benchmark_expires_at_ms - now > 3600000
            || self.host_expires_at_ms - now > 7200000
        {
            return Err("manifest expiry");
        }
        let a = &self.allocations;
        let o = &self.operator_reservation_summary;
        if a.read_attempts > 390000
            || a.write_attempts > 18000
            || a.download_bytes > 26 * GIB
            || a.stored_version_charge_bytes > 63 * 1024 * 1024
            || a.metadata_download_bytes > 512 * 1024 * 1024
            || o.read_attempts != 10000
            || o.write_attempts != 2000
            || o.bootstrap_download_bytes != 3 * GIB
            || o.administrative_download_bytes != GIB
            || o.stored_version_charge_bytes != 1024 * 1024
        {
            return Err("manifest allocation");
        }
        let allowed = [
            ("protocol", 5000, 3500),
            ("cold", 280000, 0),
            ("repair", 60000, 4000),
            ("warm", 10000, 0),
            ("funding", 10000, 5500),
            ("failure", 25000, 5000),
        ];
        if self.phases.len() != allowed.len() {
            return Err("phase schema");
        }
        for (k, r, w) in allowed {
            let p = self.phases.get(k).ok_or("phase missing")?;
            if p.read_attempts > r || p.write_attempts > w {
                return Err("phase cap");
            }
        }
        if self.phases.values().map(|p| p.read_attempts).sum::<u64>() > a.read_attempts
            || self.phases.values().map(|p| p.write_attempts).sum::<u64>() > a.write_attempts
        {
            return Err("phase aggregate");
        }
        let g = &self.guard_proof;
        if g.status != "verified"
            || g.run_id != self.run_id
            || g.instance_id != self.instance_id
            || g.source_revision != self.source_revision
            || !digest(&g.proof_sha256)
            || g.observed_at_ms > now
            || now - g.observed_at_ms > 300000
        {
            return Err("guard proof binding");
        }
        Ok(())
    }
}
#[derive(Default, Serialize)]
struct Used {
    read_attempts: u64,
    write_attempts: u64,
    download_reserved_bytes: u64,
    observed_body_bytes: u64,
    stored_version_charge_bytes: u64,
    uncertain_calls: u64,
    dispatch_stopped: bool,
    confirmed_statuses: BTreeMap<u16, u64>,
    phase_attempts: BTreeMap<String, (u64, u64)>,
    active: u64,
    operation_attempts: BTreeMap<String, u64>,
    operation_samples: BTreeMap<String, Vec<Value>>,
}
pub struct Ledger {
    allocation: Allocation,
    phases: BTreeMap<String, Phase>,
    expires: Instant,
    state: Mutex<Used>,
}
#[derive(Clone, Copy)]
pub enum Kind {
    Read,
    Write,
    List,
}
impl Ledger {
    pub fn new(allocation: Allocation, phases: BTreeMap<String, Phase>, expires: Instant) -> Self {
        Self {
            allocation,
            phases,
            expires,
            state: Mutex::new(Used::default()),
        }
    }
    pub fn reserve(
        self: &Arc<Self>,
        phase: &str,
        kind: Kind,
        max_body: u64,
        put_body: Option<usize>,
    ) -> Result<Ticket, Error> {
        if Instant::now() >= self.expires {
            return Err(Error::Timeout);
        }
        let cap = self.phases.get(phase).ok_or(Error::Invalid("phase"))?;
        let mut s = self
            .state
            .lock()
            .map_err(|_| Error::Invalid("ledger poison"))?;
        if Instant::now() >= self.expires {
            return Err(Error::Timeout);
        }
        if s.dispatch_stopped {
            return Err(Error::Invalid("run admission stopped"));
        }
        let read = matches!(kind, Kind::Read);
        let rd = u64::from(read);
        let wr = u64::from(!read);
        let d = max_body.checked_add(PROTOCOL).ok_or(Error::Capacity)?;
        let store = put_body
            .map(|n| (n as u64).checked_add(OVERHEAD).ok_or(Error::Capacity))
            .transpose()?
            .unwrap_or(0);
        let (pr, pw) = s.phase_attempts.get(phase).copied().unwrap_or_default();
        if s.read_attempts
            .checked_add(rd)
            .is_none_or(|v| v > self.allocation.read_attempts)
            || s.write_attempts
                .checked_add(wr)
                .is_none_or(|v| v > self.allocation.write_attempts)
            || pr + rd > cap.read_attempts
            || pw + wr > cap.write_attempts
            || s.download_reserved_bytes
                .checked_add(d)
                .is_none_or(|v| v > self.allocation.download_bytes)
            || s.stored_version_charge_bytes
                .checked_add(store)
                .is_none_or(|v| v > self.allocation.stored_version_charge_bytes)
        {
            return Err(Error::Capacity);
        }
        s.read_attempts += rd;
        s.write_attempts += wr;
        s.download_reserved_bytes += d;
        s.stored_version_charge_bytes += store;
        s.phase_attempts.insert(phase.into(), (pr + rd, pw + wr));
        s.active += 1;
        Ok(Ticket {
            ledger: self.clone(),
            maximum_body: max_body,
            settled: false,
            operation: None,
            started: Instant::now(),
            phase: phase.to_owned(),
        })
    }
    fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.dispatch_stopped = true;
        }
    }
    pub fn checkpoint(&self) -> Value {
        let mut r = self.report();
        if let Some(o) = r["used"].as_object_mut() {
            o.remove("operation_samples");
        }
        r
    }
    pub fn report(&self) -> Value {
        match self.state.lock() {
            Ok(s) => {
                json!({"used":&*s,"allocation":&self.allocation,"phase_caps":&self.phases,"admitted_attempts_are_dispatch_upper_bound":true,"physical_network_bound":false,"uncertainty_compliance_pass":s.uncertain_calls==0&&s.active==0,"stored_version_charge_per_PUT":"body_length + 16384; permanent"})
            }
            Err(_) => json!({"ledger_poisoned":true,"uncertainty_compliance_pass":false}),
        }
    }
}
pub struct Ticket {
    ledger: Arc<Ledger>,
    maximum_body: u64,
    settled: bool,
    operation: Option<String>,
    started: Instant,
    phase: String,
}
impl Ticket {
    fn named(mut self, method: &str, key: &str) -> Self {
        let namespace = if key.starts_with("raw/v2/") {
            "raw"
        } else if key.starts_with("index/v2/groups/") {
            "group"
        } else if key.starts_with("index/v2/") {
            "catalog"
        } else if key.starts_with("budgets/v2/") {
            "budget"
        } else {
            "list"
        };
        let name = format!("{method}:{namespace}");
        if let Ok(mut state) = self.ledger.state.lock() {
            *state.operation_attempts.entry(name.clone()).or_default() += 1;
        }
        self.operation = Some(name);
        self
    }
    fn finish(&mut self, status: Option<u16>, complete_body: Option<usize>) {
        if let Ok(mut s) = self.ledger.state.lock() {
            if let Some(status) = status {
                *s.confirmed_statuses.entry(status).or_default() += 1
            } else {
                s.uncertain_calls += 1
            }
            if let Some(n) = complete_body {
                if n as u64 <= self.maximum_body {
                    s.download_reserved_bytes -= self.maximum_body - n as u64;
                    s.observed_body_bytes += n as u64;
                } else {
                    s.uncertain_calls += 1
                }
            }
            if let Some(name) = &self.operation {
                let samples = s.operation_samples.entry(name.clone()).or_default();
                if samples.len() < 1000 {
                    samples.push(json!({"phase":self.phase,"received_status":status,"elapsed_us":self.started.elapsed().as_micros()as u64,"complete_body_bytes":complete_body}));
                }
            }
            s.active -= 1;
            self.settled = true;
        }
    }
}
impl Drop for Ticket {
    fn drop(&mut self) {
        if !self.settled
            && let Ok(mut s) = self.ledger.state.lock()
        {
            s.uncertain_calls += 1;
            s.active -= 1;
        }
    }
}
fn status<T>(r: &Result<T, Error>) -> Option<u16> {
    match r {
        Ok(_) => Some(200),
        Err(Error::Status(s)) => Some(*s),
        Err(Error::NotFound) => Some(404),
        _ => None,
    }
}
fn budget_status<T>(r: &Result<T, BudgetError>) -> Option<u16> {
    match r {
        Ok(_) => Some(200),
        Err(BudgetError::Status(s)) => Some(*s),
        Err(BudgetError::NotFound) => Some(404),
        _ => None,
    }
}
/// Bench-only metered composition. No automatic retry and no discovery chain.
#[derive(Clone)]
pub struct LiveTransport {
    pub credentials: Option<Arc<Metadata>>,
    pub inner: Arc<HttpS3Transport>,
    pub ledger: Arc<Ledger>,
    pub phase: String,
    pub raw_cap: usize,
    pub control_cap: usize,
    pub list_cap: usize,
}
impl LiveTransport {
    async fn ready(&self) -> Result<(), Error> {
        if let Some(c) = &self.credentials {
            c.fresh().await?
        }
        Ok(())
    }
    fn ticket(&self, k: Kind, max: usize, put: Option<usize>) -> Result<Ticket, Error> {
        self.ledger.reserve(&self.phase, k, max as u64, put)
    }
}
impl ObjectTransport for LiveTransport {
    async fn put(&self, p: &PreparedRecord) -> Result<u16, Error> {
        self.ready().await?;
        let mut t = self
            .ticket(Kind::Write, 65536, Some(p.body.len()))?
            .named("PUT", &p.key);
        let r = self.inner.put(p).await;
        t.finish(r.as_ref().ok().copied().or_else(|| status(&r)), None);
        r
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        self.ready().await?;
        let mut t = self.ticket(Kind::Read, 65536, None)?.named("HEAD", key);
        let r = self.inner.head(key).await;
        t.finish(status(&r), None);
        r
    }
    async fn get(&self, key: &str, max: usize) -> Result<Object, Error> {
        let cap = max.min(self.raw_cap);
        self.ready().await?;
        let mut t = self.ticket(Kind::Read, cap, None)?.named("GET", key);
        let r = self.inner.get(key, cap).await;
        t.finish(status(&r), r.as_ref().ok().map(|o| o.body.len()));
        r
    }
}
impl CatalogTransport for LiveTransport {
    async fn get_control(&self, key: &str, max: usize) -> Result<ControlObject, Error> {
        let cap = max.min(self.control_cap);
        self.ready().await?;
        let mut t = self.ticket(Kind::Read, cap, None)?.named("GET", key);
        let r = self.inner.get_control(key, cap).await;
        t.finish(status(&r), r.as_ref().ok().map(|o| o.body.len()));
        r
    }
    async fn put_control(&self, key: &str, body: &[u8], c: &WriteCondition) -> Result<u16, Error> {
        self.ready().await?;
        let mut t = self
            .ticket(Kind::Write, 65536, Some(body.len()))?
            .named("PUT", key);
        let r = self.inner.put_control(key, body, c).await;
        t.finish(r.as_ref().ok().copied().or_else(|| status(&r)), None);
        r
    }
    async fn list_raw_document(
        &self,
        p: &str,
        token: Option<&str>,
        keys: usize,
        max: usize,
    ) -> Result<Vec<u8>, Error> {
        let cap = max.min(self.list_cap);
        self.ready().await?;
        let mut t = self.ticket(Kind::List, cap, None)?.named("LIST", p);
        let r = self.inner.list_raw_document(p, token, keys, cap).await;
        t.finish(status(&r), r.as_ref().ok().map(Vec::len));
        r
    }
}
impl BudgetTransport for LiveTransport {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        self.ready().await.map_err(|_| BudgetError::Transport)?;
        let mut t = self
            .ticket(Kind::Read, 4096, None)
            .map_err(|_| BudgetError::Exhausted)?
            .named("GET", key);
        let r = self.inner.get_budget(key).await;
        t.finish(budget_status(&r), r.as_ref().ok().map(|o| o.body.len()));
        r
    }
    async fn put_budget(
        &self,
        key: &str,
        b: &[u8],
        c: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        self.ready().await.map_err(|_| BudgetError::Transport)?;
        let mut t = self
            .ticket(Kind::Write, 65536, Some(b.len()))
            .map_err(|_| BudgetError::Exhausted)?
            .named("PUT", key);
        let r = self.inner.put_budget(key, b, c).await;
        t.finish(r.as_ref().ok().copied().or_else(|| budget_status(&r)), None);
        r
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn ledger(read: u64, write: u64, bytes: u64, store: u64) -> Arc<Ledger> {
        Arc::new(Ledger::new(
            Allocation {
                read_attempts: read,
                write_attempts: write,
                download_bytes: bytes,
                stored_version_charge_bytes: store,
                metadata_download_bytes: 0,
            },
            BTreeMap::from([(
                "cold".into(),
                Phase {
                    read_attempts: read,
                    write_attempts: write,
                },
            )]),
            Instant::now() + Duration::from_secs(3),
        ))
    }
    #[test]
    fn exact_storage_margin_and_unknown_drop_stay_charged() {
        let l = ledger(0, 2, 1024 * 1024, OVERHEAD + 10);
        let t = l.reserve("cold", Kind::Write, 0, Some(10)).unwrap();
        assert!(matches!(
            l.reserve("cold", Kind::Write, 0, Some(0)),
            Err(Error::Capacity)
        ));
        drop(t);
        let r = l.report();
        assert_eq!(r["used"]["stored_version_charge_bytes"], OVERHEAD + 10);
        assert_eq!(r["used"]["uncertain_calls"], 1);
        assert_eq!(r["uncertainty_compliance_pass"], false);
    }
    #[test]
    fn definitive_read_refunds_only_unused_body_not_protocol() {
        let l = ledger(1, 0, PROTOCOL + 100, 0);
        let mut t = l.reserve("cold", Kind::Read, 100, None).unwrap();
        t.finish(Some(200), Some(10));
        drop(t);
        assert_eq!(l.report()["used"]["download_reserved_bytes"], PROTOCOL + 10);
        assert!(matches!(
            l.reserve("cold", Kind::Read, 1, None),
            Err(Error::Capacity)
        ));
    }
    #[test]
    fn status_failure_never_refunds_write_charge() {
        let l = ledger(0, 1, 1024 * 1024, OVERHEAD + 10);
        let mut t = l.reserve("cold", Kind::Write, 65536, Some(10)).unwrap();
        t.finish(Some(403), None);
        drop(t);
        let r = l.report();
        assert_eq!(r["used"]["stored_version_charge_bytes"], OVERHEAD + 10);
        assert_eq!(r["used"]["download_reserved_bytes"], PROTOCOL + 65536);
        assert_eq!(r["used"]["confirmed_statuses"]["403"], 1);
    }
    #[test]
    fn concurrent_tickets_admit_exactly_one_without_replenishment() {
        let l = ledger(1, 0, 1024 * 1024, 0);
        let joins = (0..16)
            .map(|_| {
                let l = l.clone();
                std::thread::spawn(move || l.reserve("cold", Kind::Read, 1, None).is_ok())
            })
            .collect::<Vec<_>>();
        assert_eq!(
            joins
                .into_iter()
                .map(|j| j.join().unwrap())
                .filter(|ok| *ok)
                .count(),
            1
        );
        assert_eq!(l.report()["used"]["read_attempts"], 1);
    }
    #[test]
    fn overflow_and_expiry_are_not_admitted() {
        let l = ledger(u64::MAX, u64::MAX, u64::MAX, u64::MAX);
        assert!(matches!(
            l.reserve("cold", Kind::Read, u64::MAX, None),
            Err(Error::Capacity)
        ));
        let expired = Arc::new(Ledger::new(
            l.allocation.clone(),
            l.phases.clone(),
            Instant::now(),
        ));
        assert!(matches!(
            expired.reserve("cold", Kind::Read, 1, None),
            Err(Error::Timeout)
        ));
    }
}
#[derive(Default, Serialize)]
struct MetadataUsed {
    admitted_requests: u64,
    reserved_bytes: u64,
    observed_body_bytes: u64,
    unknown_calls: u64,
    failed_known: u64,
    confirmed_statuses: BTreeMap<u16, u64>,
}
pub struct Metadata {
    endpoint: String,
    client: reqwest::Client,
    identity: (String, String, String),
    role: String,
    handle: RefreshableCredentials,
    probe_credentials: tokio::sync::RwLock<rusty_s3::Credentials>,
    expiration_ms: std::sync::atomic::AtomicU64,
    gate: tokio::sync::Mutex<()>,
    used: Mutex<MetadataUsed>,
    limit: u64,
    expires: Instant,
}
impl Metadata {
    fn new(m: &Manifest, expires: Instant) -> Result<Self, &'static str> {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| "metadata client")?;
        Ok(Self {
            endpoint: "http://169.254.169.254".into(),
            client,
            identity: (m.account.clone(), m.region.clone(), m.instance_id.clone()),
            role: m.role.clone(),
            handle: RefreshableCredentials::new(rusty_s3::Credentials::new("unready", "unready")),
            probe_credentials: tokio::sync::RwLock::new(rusty_s3::Credentials::new(
                "unready", "unready",
            )),
            expiration_ms: std::sync::atomic::AtomicU64::new(0),
            gate: tokio::sync::Mutex::new(()),
            used: Mutex::new(MetadataUsed::default()),
            limit: m.allocations.metadata_download_bytes,
            expires,
        })
    }
    async fn document(&self, path: &str, token: Option<&str>, put: bool) -> Result<Vec<u8>, Error> {
        let maximum = 16384u64;
        let reserved = maximum + PROTOCOL;
        if Instant::now() >= self.expires {
            return Err(Error::Timeout);
        }
        {
            let mut s = self
                .used
                .lock()
                .map_err(|_| Error::Invalid("metadata ledger"))?;
            if s.admitted_requests >= 1024
                || s.reserved_bytes
                    .checked_add(reserved)
                    .is_none_or(|n| n > self.limit)
            {
                return Err(Error::Capacity);
            }
            s.admitted_requests += 1;
            s.reserved_bytes += reserved;
            s.unknown_calls += 1;
        }
        let url = format!("{}{path}", self.endpoint);
        let mut request = if put {
            self.client
                .put(url)
                .header("X-aws-ec2-metadata-token-ttl-seconds", "21600")
        } else {
            self.client.get(url)
        };
        if let Some(token) = token {
            request = request.header("X-aws-ec2-metadata-token", token)
        }
        let mut response = request.send().await.map_err(|_| Error::Transport)?;
        let status = response.status().as_u16();
        {
            let mut state = self
                .used
                .lock()
                .map_err(|_| Error::Invalid("metadata ledger"))?;
            *state.confirmed_statuses.entry(status).or_default() += 1;
        }
        if status != 200
            || response
                .headers()
                .iter()
                .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                .sum::<usize>()
                > 8192
            || response.headers().contains_key("content-encoding")
        {
            self.known_failure()?;
            return Err(Error::Invalid("metadata response"));
        }
        if response.headers().get("content-length").is_some_and(|v| {
            v.to_str()
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .is_none_or(|n| n > maximum)
        }) {
            self.known_failure()?;
            return Err(Error::Invalid("metadata length"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
            if chunk.len() > maximum as usize - bytes.len() {
                self.known_failure()?;
                return Err(Error::Invalid("metadata stream"));
            }
            bytes.extend_from_slice(&chunk)
        }
        {
            let mut s = self
                .used
                .lock()
                .map_err(|_| Error::Invalid("metadata ledger"))?;
            s.unknown_calls -= 1;
            s.reserved_bytes -= maximum - bytes.len() as u64;
            s.observed_body_bytes += bytes.len() as u64;
        }
        Ok(bytes)
    }
    fn known_failure(&self) -> Result<(), Error> {
        let mut state = self
            .used
            .lock()
            .map_err(|_| Error::Invalid("metadata ledger"))?;
        state.unknown_calls -= 1;
        state.failed_known += 1;
        Ok(())
    }
    #[cfg(test)]
    fn test_metadata(endpoint: String, expires: Instant) -> Self {
        assert!(loopback(&endpoint));
        Self {
            endpoint: endpoint.trim_end_matches('/').into(),
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .no_gzip()
                .timeout(Duration::from_secs(1))
                .build()
                .unwrap(),
            identity: (ACCOUNT.into(), REGION.into(), "i-0123456789abcdef0".into()),
            role: ROLE.into(),
            handle: RefreshableCredentials::new(rusty_s3::Credentials::new("unready", "unready")),
            probe_credentials: tokio::sync::RwLock::new(rusty_s3::Credentials::new(
                "unready", "unready",
            )),
            expiration_ms: std::sync::atomic::AtomicU64::new(0),
            gate: tokio::sync::Mutex::new(()),
            used: Mutex::new(MetadataUsed::default()),
            limit: 512 * 1024 * 1024,
            expires,
        }
    }
    pub async fn fresh(&self) -> Result<(), Error> {
        use std::sync::atomic::Ordering;
        let now = now_ms().map_err(|_| Error::Invalid("clock"))?;
        if self.expiration_ms.load(Ordering::Acquire) > now + 120000
            && Instant::now() < self.expires
        {
            return Ok(());
        }
        let _held = tokio::time::timeout_at(self.expires, self.gate.lock())
            .await
            .map_err(|_| Error::Timeout)?;
        let now = now_ms().map_err(|_| Error::Invalid("clock"))?;
        if Instant::now() >= self.expires {
            return Err(Error::Timeout);
        }
        if self.expiration_ms.load(Ordering::Acquire) > now + 120000 {
            return Ok(());
        }
        let token = self.document("/latest/api/token", None, true).await?;
        let token = std::str::from_utf8(&token).map_err(|_| Error::Invalid("metadata token"))?;
        if token.is_empty() || token.len() > 4096 || token.chars().any(char::is_control) {
            return Err(Error::Invalid("metadata token"));
        }
        let identity = self
            .document(
                "/latest/dynamic/instance-identity/document",
                Some(token),
                false,
            )
            .await?;
        let identity: Value =
            serde_json::from_slice(&identity).map_err(|_| Error::Invalid("metadata identity"))?;
        if identity["accountId"].as_str() != Some(self.identity.0.as_str())
            || identity["region"].as_str() != Some(self.identity.1.as_str())
            || identity["instanceId"].as_str() != Some(self.identity.2.as_str())
        {
            return Err(Error::Invalid("metadata identity"));
        }
        let role = self
            .document(
                "/latest/meta-data/iam/security-credentials/",
                Some(token),
                false,
            )
            .await?;
        if std::str::from_utf8(&role)
            .map_err(|_| Error::Invalid("metadata role"))?
            .trim()
            != self.role
        {
            return Err(Error::Invalid("metadata role"));
        }
        let bytes = self
            .document(
                &format!("/latest/meta-data/iam/security-credentials/{}", self.role),
                Some(token),
                false,
            )
            .await?;
        let text =
            std::str::from_utf8(&bytes).map_err(|_| Error::Invalid("metadata credentials"))?;
        let code: Value =
            serde_json::from_str(text).map_err(|_| Error::Invalid("metadata credentials"))?;
        if code["Code"] != "Success" {
            return Err(Error::Invalid("metadata credentials"));
        }
        let parsed =
            rusty_s3::credentials::Ec2SecurityCredentialsMetadataResponse::deserialize(text)
                .map_err(|_| Error::Invalid("metadata credentials"))?;
        let expiry = parsed.expiration().as_millisecond();
        let expiry: u64 = expiry
            .try_into()
            .map_err(|_| Error::Invalid("metadata expiry"))?;
        if expiry <= now + 120000
            || parsed.key().is_empty()
            || parsed.secret().is_empty()
            || parsed.token().is_empty()
        {
            return Err(Error::Invalid("metadata expiry/credentials"));
        }
        let credentials = parsed.into_credentials();
        self.handle.replace(credentials.clone()).await?;
        *self.probe_credentials.write().await = credentials;
        self.expiration_ms.store(expiry, Ordering::Release);
        Ok(())
    }
    pub fn report(&self) -> Value {
        match self.used.lock() {
            Ok(s) => {
                json!({"used":&*s,"limit_bytes":self.limit,"allocation":"subgrant of controller1GiB, not extra","credentials_or_metadata_bodies_logged":false})
            }
            Err(_) => json!({"metadata_ledger_failed":true}),
        }
    }
}
fn source_check(m: &Manifest) -> Result<(), &'static str> {
    let declaration: Value = serde_json::from_str(include_str!("../../config/tasks/S09.json"))
        .map_err(|_| "source declaration")?;
    let mut paths = declaration["server2_paths"]
        .as_array()
        .ok_or("source paths")?
        .iter()
        .map(|v| v.as_str().ok_or("source path"))
        .collect::<Result<Vec<_>, _>>()?;
    for v in declaration["outside"].as_array().ok_or("source outside")? {
        paths.push(v["path"].as_str().ok_or("source path")?)
    }
    if paths.is_empty()
        || paths.len() > 128
        || paths
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != paths.len()
        || m.source_map.len() != paths.len()
        || paths.iter().any(|p| !m.source_map.contains_key(*p))
    {
        return Err("source map paths");
    }
    if sha256(&serde_json::to_vec(&m.source_map).map_err(|_| "source map")?) != m.source_map_sha256
    {
        return Err("source map digest");
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("source root")?;
    for (p, expected) in &m.source_map {
        if !digest(expected) || hash_file(&root.join(p), 8 * 1024 * 1024)? != *expected {
            return Err("source byte drift");
        }
    }
    if hash_file(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock"),
        1024 * 1024,
    )? != m.lock_sha256
    {
        return Err("lock byte drift");
    }
    Ok(())
}
fn hash_file(p: &std::path::Path, maximum: u64) -> Result<String, &'static str> {
    use std::io::Read;
    let mut b = Vec::new();
    std::fs::File::open(p)
        .map_err(|_| "provenance read")?
        .take(maximum + 1)
        .read_to_end(&mut b)
        .map_err(|_| "provenance read")?;
    if b.len() as u64 > maximum {
        return Err("provenance size");
    };
    Ok(sha256(&b))
}
fn loopback(s: &str) -> bool {
    s.parse::<reqwest::Url>().is_ok_and(|u| {
        u.scheme() == "http"
            && u.host_str() == Some("127.0.0.1")
            && u.port().is_some_and(|p| p > 0)
            && u.path() == "/"
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
    })
}
fn private_manifest(path: &std::path::Path) -> Result<Manifest, &'static str> {
    let expected = std::path::PathBuf::from(format!("/opt/server2-s09/run/{RUN}/manifest.json"));
    if path != expected {
        return Err("private manifest location");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        for p in [
            std::path::Path::new("/opt/server2-s09"),
            std::path::Path::new("/opt/server2-s09/run"),
            expected.parent().ok_or("run directory")?,
        ] {
            let s = std::fs::symlink_metadata(p).map_err(|_| "private directory")?;
            if !s.is_dir() || s.uid() != 0 || s.mode() & 0o077 != 0 {
                return Err("private directory ownership");
            }
        }
        let f = std::fs::symlink_metadata(path).map_err(|_| "private manifest")?;
        if !f.is_file() || f.uid() != 0 || f.mode() & 0o077 != 0 {
            return Err("private manifest ownership");
        }
    }
    use std::io::Read;
    let mut b = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "manifest read")?
        .take(65537)
        .read_to_end(&mut b)
        .map_err(|_| "manifest read")?;
    if b.len() > 65536 {
        return Err("manifest size");
    };
    serde_json::from_slice(&b).map_err(|_| "manifest schema")
}
fn claim(path: &std::path::Path, m: &Manifest) -> Result<(), &'static str> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| "worker already claimed or unsafe")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "claim permissions")?;
    }
    f.write_all(&serde_json::to_vec(&json!({"run_id":m.run_id,"allocation_id":m.allocation_id,"source_revision":m.source_revision,"allocation":m.allocations,"state":"non-resumable; uncertainty consumes full allocation"})).map_err(|_|"claim JSON")?).map_err(|_|"claim write")?;
    f.sync_all().map_err(|_| "claim durability")?;
    Ok(())
}
struct CountedProvider {
    inner: server2::providers::HttpProviderTransport,
    calls: Arc<std::sync::atomic::AtomicU64>,
}
impl server2::providers::ProviderTransport for CountedProvider {
    async fn send(
        &self,
        r: &server2::providers::Request,
    ) -> Result<server2::providers::ProviderResponse, server2::providers::ProviderTransportError>
    {
        self.calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.inner.send(r).await
    }
}
struct LiveAcquirer {
    provider_calls: Arc<std::sync::atomic::AtomicU64>,
    transport: Arc<LiveTransport>,
    provider: String,
    mode: String,
    data: Arc<std::sync::atomic::AtomicU64>,
    nodata: Arc<std::sync::atomic::AtomicU64>,
    denied: Arc<std::sync::atomic::AtomicU64>,
    terminal: Arc<std::sync::atomic::AtomicU64>,
}
impl server2::resolver::FundedAcquirer for LiveAcquirer {
    async fn acquire(
        &self,
        r: server2::resolver::AcquisitionRequest,
        c: server2::resolver::OperationContext,
    ) -> Result<server2::resolver::Acquisition, server2::resolver::Error> {
        use server2::{
            budget::{BudgetPolicy, BudgetStore, Clock, Provider, SystemClock},
            providers,
        };
        use std::sync::atomic::Ordering;
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
            window_id: "synthetic_s09_live".into(),
            starts_at_ms: now.saturating_sub(1000),
            ends_at_ms: now + 60000,
            limit: 2,
            block_units: 2,
        };
        let store = Arc::new(
            BudgetStore::new(self.transport.clone(), policy, Arc::new(SystemClock))
                .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
        );
        if self.mode == "provider_denied" {
            let _spent = store
                .reserve(2, c.deadline())
                .await
                .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        }
        let exec = providers::FundedExecutor::new(
            Provider::DataGoKr,
            1,
            Arc::new(CountedProvider {
                inner: providers::HttpProviderTransport::new(65536)
                    .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
                calls: self.provider_calls.clone(),
            }),
            Arc::new(|v: &Value| v.get("ok") == Some(&true.into())),
        )
        .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        let mode = match self.mode.as_str() {
            "provider_nodata" => "nodata",
            "provider_error" => "error",
            _ => "data",
        };
        let endpoint = format!("{}provider?mode={mode}", self.provider)
            .parse()
            .map_err(|_| server2::resolver::Error::AcquisitionDenied)?;
        let body = match exec
            .execute(
                endpoint,
                vec![providers::Candidate {
                    budget: store,
                    key: providers::ProviderKey::new("benchmark-only".into())
                        .map_err(|_| server2::resolver::Error::AcquisitionDenied)?,
                }],
                c.deadline(),
            )
            .await
        {
            Ok(providers::AcquisitionOutcome::Data(v)) => v,
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
        let scope = r.resolution().scope();
        let raw = RawRecord {
            envelope: Envelope {
                schema: 2,
                identity: RecordId {
                    source: scope.catalog.source.clone(),
                    kind: scope.catalog.kind.clone(),
                    key_sha256: scope.catalog.key_sha256.clone(),
                    period: scope.periods[0].clone(),
                    fetched_at_ms: 1000,
                    raw_sha256: sha256(&body.body),
                },
                status: body.status,
                content_type: body.content_type,
                raw_length: body.body.len(),
                pagination: None,
                fetch_group: None,
            },
            bytes: body.body.into(),
        };
        raw.envelope.validate(&Limits::default())?;
        self.data.fetch_add(1, Ordering::Relaxed);
        Ok(server2::resolver::Acquisition {
            declaration: GroupDeclaration::new(
                vec![GroupMember {
                    envelope: raw.envelope.clone(),
                    catalogs: vec![scope.catalog.clone()],
                }],
                &CatalogLimits::default(),
            )?,
            records: vec![raw],
        })
    }
}
fn case(c: &LiveCase) -> super::Case {
    super::Case {
        name: c.name.clone(),
        workload: c.workload.clone(),
        mode: c.mode.clone(),
        selection: c.selection.clone(),
        clients: c.clients,
        owners: c.owners,
        trials: 1,
        revisions: c.revisions,
        record_bytes: c.record_bytes,
        siblings: 1,
        layout: "complete".into(),
    }
}
#[derive(Clone)]
struct Profile {
    scopes: Vec<(CatalogId, Vec<Period>, RecordId)>,
    groups: usize,
    physical_key: usize,
}
fn call_deadline(end: Instant) -> Instant {
    (Instant::now() + Duration::from_secs(3)).min(end)
}
fn measured_transport(
    inner: Arc<HttpS3Transport>,
    credentials: Option<Arc<Metadata>>,
    ledger: Arc<Ledger>,
    phase: &str,
    record_bytes: usize,
) -> Arc<LiveTransport> {
    Arc::new(LiveTransport {
        inner,
        credentials,
        ledger,
        phase: phase.into(),
        raw_cap: (record_bytes + 1024).min(8 * 1024 * 1024),
        control_cap: 512 * 1024,
        list_cap: 512 * 1024,
    })
}
async fn seed(
    c: &LiveCase,
    i: usize,
    t: Arc<LiveTransport>,
    end: Instant,
) -> Result<Profile, String> {
    let store = CatalogStore::new(t.as_ref().clone(), CatalogLimits::default())
        .map_err(|_| "seed store")?;
    let mut scopes = vec![];
    let mut groups = 0;
    for day in 0..if c.workload == "history8" { 8 } else { 1 } {
        let mut periods = vec![];
        let mut first = None;
        let mut id = None;
        for r in 0..if c.workload == "history8" {
            24
        } else {
            c.revisions
        } {
            let p = Period {
                local_date: 20261001 + day,
                slot: if c.workload == "history8" {
                    format!("{r:02}00")
                } else {
                    "1200".into()
                },
            };
            if !periods.contains(&p) {
                periods.push(p.clone())
            }
            let a = super::acquisition(
                i,
                p,
                (r + 1) as u64,
                super::body(i, r, c.record_bytes),
                1,
                &format!("{RUN}-{day}"),
            )
            .map_err(|_| "seed identity")?;
            if first.is_none() {
                first = Some(a.records[0].envelope.identity.clone());
                id = Some(a.declaration.partitions[0].clone())
            }
            if !c.mode.starts_with("provider_") {
                if c.mode == "repair" {
                    let limits = CatalogLimits::default();
                    let descriptor = a
                        .declaration
                        .bytes(&limits)
                        .map_err(|_| "orphan descriptor")?;
                    let reference = a
                        .declaration
                        .reference(&limits)
                        .map_err(|_| "orphan reference")?;
                    let raw = RawRecordStore::new_shared(t.clone(), Limits::default())
                        .map_err(|_| "orphan raw store")?;
                    for record in a
                        .declaration
                        .attach(a.records, &limits)
                        .map_err(|_| "orphan metadata")?
                    {
                        tokio::time::timeout_at(call_deadline(end), raw.publish(record))
                            .await
                            .map_err(|_| "orphan raw timeout")?
                            .map_err(|_| "orphan raw publish")?;
                    }
                    let status = t
                        .put_control(
                            &reference.descriptor_key().map_err(|_| "descriptor key")?,
                            &descriptor,
                            &WriteCondition::Absent,
                        )
                        .await
                        .map_err(|_| "orphan descriptor PUT")?;
                    if status != 200 {
                        return Err("orphan descriptor status".into());
                    }
                } else {
                    store
                        .publish(a.declaration, a.records, call_deadline(end))
                        .await
                        .map_err(|e| format!("seed outcome: {e}"))?;
                }
            }
            groups += 1;
        }
        for p in periods.chunks(16) {
            scopes.push((
                id.clone().ok_or("seed catalog")?,
                p.to_vec(),
                first.clone().ok_or("seed target")?,
            ))
        }
    }
    Ok(Profile {
        scopes,
        groups,
        physical_key: i,
    })
}
fn requests(
    c: &LiveCase,
    p: &Profile,
    response_key: usize,
) -> Result<Vec<server2::resolver::ResolutionRequest>, String> {
    let k = case(c);
    p.scopes
        .iter()
        .enumerate()
        .map(|(seg, (id, periods, target))| {
            super::request(
                &k,
                RUN,
                response_key,
                seg,
                id.clone(),
                periods.clone(),
                target.clone(),
            )
            .map_err(|_| "request identity".into())
        })
        .collect()
}
async fn resolve_batch<T: CatalogTransport + 'static>(
    r: server2::resolver::Resolver<T, LiveAcquirer, super::Builder>,
    reqs: Vec<server2::resolver::ResolutionRequest>,
    end: Instant,
    trial: usize,
    client: usize,
) -> super::model::Sample {
    let began = Instant::now();
    let mut components = vec![];
    let mut outcome = "success".to_string();
    let mut bytes = 0;
    for request in reqs {
        let start = Instant::now();
        let (s, n) = match r.resolve(request, call_deadline(end)).await {
            Ok(v) => ("success".to_string(), v.bytes().len()),
            Err(e) => (super::outcome(&e), 0),
        };
        if s != "success" && outcome == "success" {
            outcome = s.clone()
        }
        bytes += n;
        components.push(super::model::Component {
            elapsed_us: Some(start.elapsed().as_micros() as u64),
            outcome: s,
            returned_bytes: n,
        })
    }
    super::model::Sample {
        trial,
        client,
        elapsed_us: Some(began.elapsed().as_micros() as u64),
        outcome,
        returned_bytes: bytes,
        components,
    }
}
fn execution_compliant(ledger: &Ledger) -> bool {
    ledger.report()["uncertainty_compliance_pass"] == true
}
fn abort_run(report: &mut Value, ledger: &Ledger, reason: &'static str) {
    ledger.stop();
    report["run_status"] = "ABORTED".into();
    if report["abort_reason"].is_null() {
        report["abort_reason"] = reason.into();
    }
    report["requested_case_coverage_complete"] = false.into();
    report["overall_accounting_compliance_pass"] = false.into();
}
fn empty_aborted_report(reason: &'static str, ledger: &Ledger) -> Value {
    let mut report = json!({"schema":1,"cases":[],"protocol":null,"policy_checks":null,"intended_host_gate_pass":false,"gate_status":"requires_original_measurement_headroom_and_AK_decisions","rust_decision":"pending_O2","lifecycle_decision":"pending_O5","api_parity_verified":false,"production_cutover_authorized":false});
    abort_run(&mut report, ledger, reason);
    report
}
fn bounded_export(mut report: Value, ledger: &Ledger) -> Result<Value, String> {
    if serde_json::to_vec(&report)
        .map_err(|_| "report JSON")?
        .len()
        > 2 * 1024 * 1024
    {
        fn omit_details(value: &mut Value) {
            match value {
                Value::Object(o) => {
                    for k in ["operation_samples", "trials", "retained_samples"] {
                        o.remove(k);
                    }
                    for v in o.values_mut() {
                        omit_details(v);
                    }
                }
                Value::Array(a) => {
                    for v in a {
                        omit_details(v);
                    }
                }
                _ => {}
            }
        }
        omit_details(&mut report);
        report["export_details_omitted"] = true.into();
        abort_run(&mut report, ledger, "bounded export detail insufficient");
    }
    if serde_json::to_vec(&report)
        .map_err(|_| "report JSON")?
        .len()
        > 2 * 1024 * 1024
    {
        return Err("bounded summary export insufficient".into());
    }
    Ok(report)
}
pub async fn execute(
    config_path: &std::path::Path,
    manifest_path: &std::path::Path,
) -> Result<Value, String> {
    let (c, bytes) = read_config(config_path).map_err(str::to_owned)?;
    let m = private_manifest(manifest_path).map_err(str::to_owned)?;
    if std::env::consts::OS != "linux"
        || std::env::consts::ARCH != "x86_64"
        || !cfg!(target_env = "musl")
    {
        return Err("intended Linux x86_64 musl required".into());
    }
    let executable = std::env::current_exe().map_err(|_| "executable")?;
    let binary = hash_file(&executable, 128 * 1024 * 1024).map_err(str::to_owned)?;
    let config_hash = sha256(&bytes);
    let now = now_ms().map_err(str::to_owned)?;
    m.validate(&c, &config_hash, &binary, now)
        .map_err(str::to_owned)?;
    if option_env!("S09_SOURCE_REVISION") != Some(m.source_revision.as_str())
        || !loopback(&m.provider_endpoint)
    {
        return Err("compiled source/provider identity".into());
    }
    source_check(&m).map_err(str::to_owned)?;
    let end = Instant::now() + Duration::from_millis(m.benchmark_expires_at_ms - now);
    // Local client construction performs no I/O and must fail before the one-use claim.
    let credentials = Arc::new(Metadata::new(&m, end).map_err(str::to_owned)?);
    claim(&manifest_path.with_file_name("worker.claim"), &m).map_err(str::to_owned)?;
    let ledger = Arc::new(Ledger::new(m.allocations.clone(), m.phases.clone(), end));
    let outcome: Result<Value, String> = async {
        credentials
            .fresh()
            .await
            .map_err(|_| "private metadata preflight")?;
        let inner = Arc::new(
            HttpS3Transport::with_credentials(ENDPOINT, BUCKET, REGION, credentials.handle.clone())
                .map_err(|_| "live S3 transport")?,
        );
        run_live(
            &c,
            &m,
            inner,
            Some(credentials.clone()),
            ledger.clone(),
            end,
        )
        .await
    }
    .await;
    let mut report = outcome.unwrap_or_else(|_| {
        empty_aborted_report("private preflight or run prerequisite failed", &ledger)
    });
    if hash_file(config_path, 65536).ok().as_deref() != Some(config_hash.as_str())
        || hash_file(&executable, 128 * 1024 * 1024).ok().as_deref() != Some(binary.as_str())
        || source_check(&m).is_err()
    {
        abort_run(&mut report, &ledger, "execution input drift");
    }
    report["run_id"] = m.run_id.into();
    report["allocation_id"] = m.allocation_id.into();
    report["source_revision"] = m.source_revision.into();
    report["source_map_sha256"] = m.source_map_sha256.into();
    report["binary_sha256"] = binary.into();
    report["lock_sha256"] = m.lock_sha256.into();
    report["requested_config_sha256"] = config_hash.into();
    report["guard_proof_sha256"] = m.guard_proof.proof_sha256.into();
    report["S3_accounting"] = ledger.report();
    report["metadata_accounting"] = credentials.report();
    let metadata_known = report["metadata_accounting"]["used"]["unknown_calls"] == 0;
    let s3_known = report["S3_accounting"]["uncertainty_compliance_pass"] == true;
    if !metadata_known || !s3_known {
        abort_run(&mut report, &ledger, "uncertain S3 or metadata accounting");
    }
    report["overall_accounting_compliance_pass"] =
        (metadata_known && s3_known && report["run_status"] != "ABORTED").into();
    bounded_export(report, &ledger)
}
async fn protocol(t: Arc<LiveTransport>, end: Instant) -> Result<Value, String> {
    let a = super::acquisition(
        22000,
        Period {
            local_date: 20261001,
            slot: "1200".into(),
        },
        1,
        super::body(22000, 1, 128),
        1,
        "s09-protocol-group",
    )
    .map_err(|_| "protocol acquisition")?;
    let limits = CatalogLimits::default();
    let descriptor = a
        .declaration
        .bytes(&limits)
        .map_err(|_| "protocol descriptor")?;
    let reference = a
        .declaration
        .reference(&limits)
        .map_err(|_| "protocol group")?;
    let attached = a
        .declaration
        .attach(a.records.clone(), &limits)
        .map_err(|_| "protocol attach")?;
    let prepared = attached[0]
        .prepare(&Limits::default())
        .map_err(|_| "protocol gzip")?;
    if t.put(&prepared).await.map_err(|_| "protocol PUT")? != 200
        || t.put(&prepared).await.map_err(|_| "protocol duplicate")? != 412
    {
        return Err("protocol conditional status".into());
    }
    let raw = RawRecordStore::new_shared(t.clone(), Limits::default())
        .map_err(|_| "protocol rawstore")?;
    let found =
        tokio::time::timeout_at(call_deadline(end), raw.load(&attached[0].envelope.identity))
            .await
            .map_err(|_| "protocol load timeout")?
            .map_err(|_| "protocol raw verification")?;
    if found.bytes != attached[0].bytes || found.envelope != attached[0].envelope {
        return Err("protocol exact raw".into());
    }
    let head = t.head(&prepared.key).await.map_err(|_| "protocol HEAD")?;
    if head.length != prepared.body.len() {
        return Err("protocol HEAD length".into());
    }
    let mut absent = attached[0].envelope.identity.clone();
    absent.fetched_at_ms = 100;
    if !matches!(
        t.get(&absent.object_key().map_err(|_| "protocol key")?, 4096)
            .await,
        Err(Error::NotFound)
    ) || !matches!(
        t.head(&absent.object_key().map_err(|_| "protocol key")?)
            .await,
        Err(Error::NotFound)
    ) {
        return Err("protocol missing must404".into());
    }
    let mut bad = super::acquisition(
        22000,
        absent.period.clone(),
        101,
        super::body(22000, 2, 128),
        1,
        "s09-protocol-md5",
    )
    .map_err(|_| "protocol badMD5 identity")?
    .records[0]
        .prepare(&Limits::default())
        .map_err(|_| "protocol badMD5 gzip")?;
    bad.md5 = "AAAAAAAAAAAAAAAAAAAAAA==".into();
    if t.put(&bad).await.map_err(|_| "protocol MD5 response")? != 400 {
        return Err("protocol MD5 must400".into());
    }
    let descriptor_key = reference
        .descriptor_key()
        .map_err(|_| "protocol descriptor key")?;
    if t.put_control(&descriptor_key, &descriptor, &WriteCondition::Absent)
        .await
        .map_err(|_| "descriptor PUT")?
        != 200
        || t.put_control(&descriptor_key, &descriptor, &WriteCondition::Absent)
            .await
            .map_err(|_| "descriptor duplicate")?
            != 412
    {
        return Err("immutable descriptor conditional".into());
    }
    let store =
        CatalogStore::new(t.as_ref().clone(), limits.clone()).map_err(|_| "protocol catalog")?;
    store
        .publish(a.declaration, a.records, call_deadline(end))
        .await
        .map_err(|_| "protocol complete publication")?;
    let cas_id = CatalogId::for_record(&attached[0].envelope.identity, "s09-protocol-cas")
        .map_err(|_| "protocol CAS identity")?;
    let mut catalog = Catalog::empty(cas_id.clone());
    let b = catalog.bytes(&limits).map_err(|_| "protocol CAS bytes")?;
    if !matches!(
        t.get_control(&cas_id.key(), 4096).await,
        Err(Error::NotFound)
    ) {
        return Err("allowed control404".into());
    }
    if t.put_control(&cas_id.key(), &b, &WriteCondition::Absent)
        .await
        .map_err(|_| "protocol CAS create")?
        != 200
    {
        return Err("protocol CAS create status".into());
    }
    let original = t
        .get_control(&cas_id.key(), 4096)
        .await
        .map_err(|_| "protocol CAS validator")?;
    catalog.generation = 1;
    let changed = catalog.bytes(&limits).map_err(|_| "protocol CAS bytes")?;
    if t.put_control(
        &cas_id.key(),
        &changed,
        &WriteCondition::Match(original.etag.clone()),
    )
    .await
    .map_err(|_| "protocol CAS update")?
        != 200
        || t.put_control(&cas_id.key(), &b, &WriteCondition::Match(original.etag))
            .await
            .map_err(|_| "protocol staleCAS")?
            != 412
    {
        return Err("protocol opaque CAS status".into());
    }
    let latest = t
        .get_control(&cas_id.key(), 4096)
        .await
        .map_err(|_| "protocol CAS readback")?;
    if latest.body != changed || latest.version.is_none() {
        return Err("versioned CAS readback".into());
    }
    let clock = Arc::new(server2::budget::SystemClock);
    let now = server2::budget::Clock::now_ms(clock.as_ref()).map_err(|_| "protocol clock")?;
    let budget = server2::budget::BudgetStore::new(
        t.clone(),
        server2::budget::BudgetPolicy {
            provider: server2::budget::Provider::DataGoKr,
            quota_id: sha256(b"s09-protocol-budget"),
            window_id: "protocol".into(),
            starts_at_ms: now - 1000,
            ends_at_ms: now + 60000,
            limit: 2,
            block_units: 2,
        },
        clock,
    )
    .map_err(|_| "protocol budget")?;
    let _permit = budget
        .reserve(2, call_deadline(end))
        .await
        .map_err(|_| "protocol budget CAS/witness")?;
    if !matches!(
        budget.reserve(1, call_deadline(end)).await,
        Err(BudgetError::Exhausted)
    ) {
        return Err("protocol budget exhaustion".into());
    }
    Ok(
        json!({"budget_authority_witness_and_terminal_exhaustion":true,"raw_200_412_exact_HEAD_GET_gzip_hash":true,"allowed_absence_404":true,"MD5_rejection_400":true,"immutable_descriptor_200_412":true,"opaque_CAS_200_412_and_version":true,"controller_negative_policy_version_probes_required":true}),
    )
}
struct FixtureEstimate {
    stored_charge: u64,
    raw_body_cap: usize,
    control_body_cap: usize,
}
fn seed_charge(c: &LiveCase, i: usize) -> Result<FixtureEstimate, String> {
    let limits = CatalogLimits::default();
    let mut total = 0u64;
    let mut raw_body_cap = 0;
    let mut control_body_cap = 0;
    for day in 0..if c.workload == "history8" { 8 } else { 1 } {
        let mut catalog: Option<Catalog> = None;
        for r in 0..if c.workload == "history8" {
            24
        } else {
            c.revisions
        } {
            let period = Period {
                local_date: 20261001 + day,
                slot: if c.workload == "history8" {
                    format!("{r:02}00")
                } else {
                    "1200".into()
                },
            };
            let a = super::acquisition(
                i,
                period,
                (r + 1) as u64,
                super::body(i, r, c.record_bytes),
                1,
                &format!("{RUN}-{day}"),
            )
            .map_err(|_| "estimate identity")?;
            let attached = a
                .declaration
                .attach(a.records.clone(), &limits)
                .map_err(|_| "estimate metadata")?;
            let gzip = attached[0]
                .prepare(&limits.raw)
                .map_err(|_| "estimate gzip")?;
            let descriptor = a
                .declaration
                .bytes(&limits)
                .map_err(|_| "estimate descriptor")?;
            total = total
                .checked_add(gzip.body.len() as u64 + descriptor.len() as u64 + 2 * OVERHEAD)
                .ok_or("estimate overflow")?;
            raw_body_cap = raw_body_cap.max(gzip.body.len());
            control_body_cap = control_body_cap.max(descriptor.len());
            let base = catalog
                .take()
                .unwrap_or_else(|| Catalog::empty(a.declaration.partitions[0].clone()));
            let next = base
                .union(
                    &a.declaration
                        .envelopes(&limits)
                        .map_err(|_| "estimate envelope")?,
                    &limits,
                )
                .map_err(|_| "estimate union")?;
            let catalog_bytes = next.bytes(&limits).map_err(|_| "estimate catalog")?;
            control_body_cap = control_body_cap.max(catalog_bytes.len());
            if c.mode != "repair" {
                total = total
                    .checked_add(catalog_bytes.len() as u64 + OVERHEAD)
                    .ok_or("estimate overflow")?;
            }
            catalog = Some(next);
        }
    }
    // Every real retry/denial remains charged separately; this estimate does not authorize it.
    Ok(FixtureEstimate {
        stored_charge: total,
        raw_body_cap: raw_body_cap + 1024,
        control_body_cap: control_body_cap + 1024,
    })
}
async fn run_live(
    c: &AwsConfig,
    m: &Manifest,
    inner: Arc<HttpS3Transport>,
    credentials: Option<Arc<Metadata>>,
    ledger: Arc<Ledger>,
    end: Instant,
) -> Result<Value, String> {
    use server2::resolver::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    let mut reports = vec![];
    let mut partial = Value::Null;
    let mut protocol_value = Value::Null;
    let mut policy_checks = Value::Null;
    let execution: Result<(),String> = async {
    let setup = measured_transport(
        inner.clone(),
        credentials.clone(),
        ledger.clone(),
        "protocol",
        65536,
    );
    protocol_value = protocol(setup.clone(), end).await?;
    policy_checks = if let Some(credentials) = credentials.clone() {
        negative_policy_probes(credentials, ledger.clone(), end).await?
    } else {
        json!({"scope":"local worker, no real IAM policy assertions","sweeps_allowed_only_local":true})
    };
    let mut profiles = BTreeMap::<String, Profile>::new();
    let mut next_key = 1usize;
    let mut provider_key = 64usize;
    for cse in &c.cases {
        if ledger.report()["used"]["uncertain_calls"].as_u64().unwrap_or(1) > 0 {
            ledger.stop();
            return Err("uncertain completion before next case admission".into());
        }
        partial = json!({"configuration":cse,"status":"ABORTED","summary":super::model::summarize(&[]),"retained_samples":[],"trials":[]});
        if Instant::now()>=end { return Err("benchmark deadline reached".into()); }
        let began = Instant::now();
        let n = if cse.workload == "history8" {
            192
        } else {
            cse.revisions
        };
        let profile_key = format!(
            "{}-{}-{}-{}",
            cse.workload,
            cse.revisions,
            cse.record_bytes,
            cse.mode == "repair"
        );
        let offered_samples = cse.target_samples.div_ceil(cse.clients) * cse.clients;
        let fixture = seed_charge(cse, next_key)?;
        let seed_estimate = fixture.stored_charge;
        let trial_request_estimate = if cse.selection == "full_history" {
            (n as u64).saturating_mul(n as u64 + 32) + 100
        } else {
            (n as u64).saturating_mul(16) + 100
        };
        let mut sweep_estimate =
            trial_request_estimate.saturating_mul(if cse.load_model == "hot_key" {
                cse.target_samples.div_ceil(cse.clients) as u64
            } else {
                offered_samples as u64
            });
        let anticipated_trials = cse.target_samples.div_ceil(cse.clients) as u64;
        let owner_count = if cse.load_model == "hot_key" {
            anticipated_trials
        } else {
            offered_samples as u64
        };
        if cse.mode == "warm" {
            let scopes = if cse.workload == "history8" { 16 } else { 1 };
            let keys = if cse.load_model == "hot_key" {
                1
            } else {
                cse.clients as u64
            };
            sweep_estimate = trial_request_estimate
                .saturating_mul(keys)
                .saturating_add(120 * 2 * scopes * keys);
        }
        let maximum_body = if cse.mode.starts_with("provider_") {
            65536
        } else {
            fixture.raw_body_cap.max(fixture.control_body_cap)
        } as u64;
        let download_estimate = sweep_estimate.saturating_mul(PROTOCOL + maximum_body);
        let phase = if cse.mode.starts_with("provider_") {
            "funding"
        } else if cse.mode == "repair" {
            "repair"
        } else if cse.mode == "warm" {
            "warm"
        } else {
            "cold"
        };
        let sweep_writes = if cse.mode.starts_with("provider_") {
            owner_count.saturating_mul(16)
        } else if cse.mode == "repair" {
            (n as u64).saturating_mul(12)
        } else {
            0
        };
        let existing = profiles.contains_key(&profile_key);
        let needs_seed = !existing && !cse.mode.starts_with("provider_");
        let seed_writes = if needs_seed { n as u64 * 8 } else { 0 };
        let requested_store = if cse.mode.starts_with("provider_") {
            owner_count.saturating_mul(16 * (OVERHEAD + 65536))
        } else if needs_seed {
            seed_estimate
        } else {
            0
        };
        let used = ledger.report();
        let remaining_reads = m.allocations.read_attempts.saturating_sub(
            used["used"]["read_attempts"]
                .as_u64()
                .unwrap_or(m.allocations.read_attempts),
        );
        let remaining_store = m.allocations.stored_version_charge_bytes.saturating_sub(
            used["used"]["stored_version_charge_bytes"]
                .as_u64()
                .unwrap_or(m.allocations.stored_version_charge_bytes),
        );
        let remaining_download = m.allocations.download_bytes.saturating_sub(
            used["used"]["download_reserved_bytes"]
                .as_u64()
                .unwrap_or(m.allocations.download_bytes),
        );
        let remaining_writes = m.allocations.write_attempts.saturating_sub(
            used["used"]["write_attempts"]
                .as_u64()
                .unwrap_or(m.allocations.write_attempts),
        );
        let phase_used = used["used"]["phase_attempts"][phase].as_array();
        let phase_reads_used = phase_used
            .and_then(|v| v.first())
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let phase_writes_used = phase_used
            .and_then(|v| v.get(1))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let phase_cap = m.phases.get(phase).ok_or("phase estimate")?;
        let estimate = json!({"read_attempts_conservative":sweep_estimate,"seed_stored_version_charge_conservative":seed_estimate,"remaining_reads":remaining_reads,"remaining_store_charge":remaining_store,"download_bytes_upper_estimate":download_estimate,"PUT_LIST_attempts_upper_estimate":sweep_writes+seed_writes,"remaining_download":remaining_download,"remaining_writes":remaining_writes,"fixture_raw_body_cap":fixture.raw_body_cap,"fixture_control_body_cap":fixture.control_body_cap,"fixture_margin_bytes":1024,"estimated_additional_store_charge":requested_store,"phase":phase,"estimate_is_not_budget_renewal":true});
        if Instant::now() >= end
            || sweep_estimate > remaining_reads
            || download_estimate > remaining_download
            || sweep_writes + seed_writes > remaining_writes
            || requested_store > remaining_store
            || sweep_estimate > phase_cap.read_attempts.saturating_sub(phase_reads_used)
            || sweep_writes > phase_cap.write_attempts.saturating_sub(phase_writes_used)
        {
            reports.push(json!({"configuration":cse,"status":"INSUFFICIENT","reason":"pre-sweep cap estimate","estimate":estimate}));
            partial = Value::Null;
            continue;
        }
        let profile = if cse.mode.starts_with("provider_") {
            None
        } else {
            if !profiles.contains_key(&profile_key) {
                let s = seed(cse, next_key, setup.clone(), end).await;
                next_key += 1;
                match s {
                    Ok(p) => {
                        profiles.insert(profile_key.clone(), p);
                    }
                    Err(e) => {
                        partial = json!({"configuration":cse,"status":"ABORTED","reason":e,"estimate":estimate});
                        return Err("fixture publication failed".into());
                    }
                }
            }
            profiles.get(&profile_key).cloned()
        };
        let mut samples = vec![];
        let mut trials = vec![];
        let mut warm_resolver: Option<(
            Resolver<LiveTransport, LiveAcquirer, super::Builder>,
            Arc<super::Timings>,
        )> = None;
        let mut warm_prepared = true;
        for trial in 0..cse.target_samples.div_ceil(cse.clients) {
            if Instant::now() >= end
                || ledger.report()["used"]["uncertain_calls"]
                    .as_u64()
                    .unwrap_or(1)
                    > 0
            {
                return Err("uncertain completion or benchmark deadline".into());
            }
            let phase = if cse.mode.starts_with("provider_") {
                "funding"
            } else if cse.mode == "repair" {
                "repair"
            } else if cse.mode == "warm" {
                "warm"
            } else {
                "cold"
            };
            let t = measured_transport(
                inner.clone(),
                credentials.clone(),
                ledger.clone(),
                phase,
                cse.record_bytes,
            );
            let t = if !cse.mode.starts_with("provider_") {
                let mut concrete = t.as_ref().clone();
                concrete.raw_cap = fixture.raw_body_cap;
                concrete.control_cap = fixture.control_body_cap;
                Arc::new(concrete)
            } else {
                t
            };
            let mut timing = Arc::new(super::Timings::default());
            let provider_calls = Arc::new(AtomicU64::new(0));
            let data = Arc::new(AtomicU64::new(0));
            let nodata = Arc::new(AtomicU64::new(0));
            let denied = Arc::new(AtomicU64::new(0));
            let terminal = Arc::new(AtomicU64::new(0));
            let resolver = Resolver::new(
                CatalogBackend::new(t.as_ref().clone(), CatalogLimits::default())
                    .map_err(|_| "live backend")?,
                LiveAcquirer {
                    provider_calls: provider_calls.clone(),
                    transport: t.clone(),
                    provider: m.provider_endpoint.clone(),
                    mode: cse.mode.clone(),
                    data: data.clone(),
                    nodata: nodata.clone(),
                    denied: denied.clone(),
                    terminal: terminal.clone(),
                },
                super::Builder(timing.clone()),
                ResolverConfig {
                    operations: cse.owners,
                    ..ResolverConfig::default()
                },
            )
            .map_err(|_| "live resolver")?;
            let resolver = if cse.mode == "warm" {
                if let Some((old, old_timing)) = &warm_resolver {
                    timing = old_timing.clone();
                    old.clone()
                } else {
                    warm_resolver = Some((resolver.clone(), timing.clone()));
                    resolver
                }
            } else {
                resolver
            };
            let mut requested = vec![];
            for client in 0..cse.clients {
                let p = if let Some(p) = &profile {
                    p.clone()
                } else {
                    let index = if cse.load_model == "hot_key" {
                        provider_key
                    } else {
                        provider_key + client
                    };
                    seed(cse, index, setup.clone(), end).await?
                };
                let response = if cse.load_model == "hot_key" {
                    p.physical_key
                } else {
                    p.physical_key + 100000 * (client + 1)
                };
                requested.push(requests(cse, &p, response)?);
            }
            if cse.mode.starts_with("provider_") {
                provider_key += if cse.load_model == "hot_key" {
                    1
                } else {
                    cse.clients
                };
            }
            let mut warm_ok = warm_prepared;
            let mut warmup = vec![];
            if cse.mode == "warm" && trial == 0 {
                for (client, q) in requested.iter().enumerate() {
                    let s = resolve_batch(resolver.clone(), q.clone(), end, trial, client).await;
                    if s.outcome != "success" {
                        warm_ok = false
                    }
                    warmup.push(s)
                }
                warm_prepared = warm_ok;
            }
            let idle_before = tokio::time::timeout_at(
                (Instant::now() + Duration::from_secs(4)).min(end),
                async {
                    while resolver.metrics().active_maintenance > 0 {
                        tokio::time::sleep(Duration::from_millis(1)).await
                    }
                },
            )
            .await
            .is_ok();
            let baseline = ledger.checkpoint();
            let parse_before = timing.parse_us.load(Ordering::Relaxed);
            let assembly_before = timing.assembly_us.load(Ordering::Relaxed);
            let mut tasks = tokio::task::JoinSet::new();
            if warm_ok && idle_before {
                for (client, q) in requested.into_iter().enumerate() {
                    let r = resolver.clone();
                    tasks.spawn(resolve_batch(r, q, end, trial, client));
                }
                while let Some(s) = tasks.join_next().await {
                    samples.push(s.map_err(|_| "live client task")?);
                }
            } else {
                for client in 0..cse.clients {
                    samples.push(super::model::Sample {
                        trial,
                        client,
                        elapsed_us: None,
                        outcome: "warm_unavailable".into(),
                        returned_bytes: 0,
                        components: vec![],
                    });
                }
            }
            let foreground = ledger.checkpoint();
            let drain_performed = cse.mode != "warm";
            if drain_performed {
                let _ = resolver
                    .drain((Instant::now() + Duration::from_secs(4)).min(end))
                    .await;
            }
            let metrics = resolver.metrics();
            let after = ledger.checkpoint();
            let archive_delta =
                BTreeMap::from(["PUT:raw", "PUT:group", "PUT:catalog"].map(|key| {
                    (
                        key.to_owned(),
                        after["used"]["operation_attempts"][key]
                            .as_u64()
                            .unwrap_or(0)
                            .saturating_sub(
                                baseline["used"]["operation_attempts"][key]
                                    .as_u64()
                                    .unwrap_or(0),
                            ),
                    )
                }));
            let terminal_mode = matches!(
                cse.mode.as_str(),
                "provider_nodata" | "provider_denied" | "provider_error"
            );
            let terminal_archive_zero = archive_delta.values().all(|v| *v == 0);
            trials.push(json!({"trial":trial,"warmup_summary":super::model::summarize(&warmup),"maintenance_idle_before":idle_before,"warm_available":warm_ok&&idle_before,"ledger_before":baseline["used"],"ledger_foreground_end":foreground["used"],"drain_performed_this_wave":drain_performed,"ledger_after_owned_work":ledger.checkpoint()["used"],"resolver_metric_scope":"case-cumulative for warm; trial-owned for cold","foreground_io":metrics.foreground_io,"background_io":metrics.background_io,"maintenance_failed":metrics.maintenance_failed,"owner_rejections":metrics.admission_rejections,"parse_elapsed_us":timing.parse_us.load(Ordering::Relaxed)-parse_before,"assembly_elapsed_us":timing.assembly_us.load(Ordering::Relaxed)-assembly_before,"archive_PUT_deltas":archive_delta,"terminal_archive_zero":terminal_archive_zero,"provider_http_calls":provider_calls.load(Ordering::Relaxed),"provider_data":data.load(Ordering::Relaxed),"provider_NoData":nodata.load(Ordering::Relaxed),"funding_denied":denied.load(Ordering::Relaxed),"provider_terminal":terminal.load(Ordering::Relaxed)}));
            partial = json!({"configuration":cse,"status":"ABORTED","summary":super::model::summarize(&samples),"measured_samples":samples.len(),"retained_samples":samples.iter().take(4).collect::<Vec<_>>(),"detail_samples_complete":samples.len()<=4,"trials":trials.iter().take(2).collect::<Vec<_>>(),"trial_details_complete":trials.len()<=2});
            if terminal_mode
                && (!terminal_archive_zero
                    || (cse.mode == "provider_denied"
                        && provider_calls.load(Ordering::Relaxed) != 0))
            {
                return Err("terminal provider archive/denial fence failed".into());
            }
        }
        if let Some((r, _)) = &warm_resolver {
            let _ = r
                .drain((Instant::now() + Duration::from_secs(4)).min(end))
                .await;
        }
        if samples.iter().any(|s| s.outcome == "ambiguous") {
            return Err("uncertain publication; allocation cannot resume".into());
        }
        let summary = super::model::summarize(&samples);
        let expected = if matches!(
            cse.mode.as_str(),
            "provider_nodata" | "provider_denied" | "provider_error"
        ) {
            "acquisition_denied"
        } else {
            "success"
        };
        let expected_outcomes = samples.iter().filter(|s| s.outcome == expected).count();
        let status = if samples.len() < cse.target_samples
            || expected_outcomes != samples.len()
            || ledger.report()["used"]["uncertain_calls"]
                .as_u64()
                .unwrap_or(1)
                > 0
        {
            "INSUFFICIENT"
        } else {
            "MEASURED"
        };
        reports.push(json!({"configuration":cse,"status":status,"estimate":estimate,"summary":summary,"expected_outcome":expected,"expected_outcomes":expected_outcomes,"retained_samples":samples.iter().take(4).collect::<Vec<_>>(),"detail_samples_complete":samples.len()<=4,"measured_samples":samples.len(),"target_samples_are_offered_client_observations":true,"independent_RAM_empty_resolver_trials":if cse.mode=="warm"{0}else{trials.len()},"warm_observation_waves":if cse.mode=="warm"{trials.len()}else{0},"independent_cold_trial_target":300,"independent_cold_trial_target_met":cse.mode!="cold"||trials.len()>=300,"independent_trial_tail_insufficient":cse.mode=="warm"||trials.len()<100,"warm_wave_tail_insufficient":if cse.mode=="warm"{Some(trials.len()<100)}else{None},"trials":trials.iter().take(2).collect::<Vec<_>>(),"trial_details_complete":trials.len()<=2,"seed_reused_across_cold_trials":profile.is_some(),"repair_samples_are_first_shared_flight_only":cse.mode=="repair","repair_tail_latency_claim":false,"physical_keys":if profile.is_some(){1}else{if cse.load_model=="hot_key"{cse.target_samples.div_ceil(cse.clients)}else{cse.target_samples.div_ceil(cse.clients)*cse.clients}},"physical_groups_per_key":profile.as_ref().map(|p|p.groups),"day_catalogs_per_key":if cse.workload=="history8"{8}else{1},"resolutions_per_client":if cse.workload=="history8"{16}else{1},"case_elapsed_us":began.elapsed().as_micros()as u64}));
        partial = Value::Null;
    }
    Ok(())
    }.await;
    let abort = execution.err();
    if abort.is_some() {
        ledger.stop();
        if !partial.is_null() {
            reports.push(partial);
        }
    }
    let complete = abort.is_none()
        && reports.len() == c.cases.len()
        && reports.iter().all(|r| r["status"] == "MEASURED");
    Ok(
        json!({"schema":1,"measurement_scope":"approved_intended_host_same_region_synthetic_library","protocol":protocol_value,"policy_checks":policy_checks,"run_status":if abort.is_some(){"ABORTED"}else{"COMPLETED"},"abort_reason":abort,"overall_accounting_compliance_pass":execution_compliant(&ledger)&&abort.is_none(),"cases":reports,"requested_case_coverage_complete":complete,"coverage":"configured subset only; full Cartesian matrix not required or inferred","transport_pool_state":"shared_after_protocol_and_seeding","first_network_context":"first protocol adapter completion; separately retained phase-tagged samples, not fresh Spot GET timing","original_cold_trial_coverage_proven":false,"local_history8_baseline_us":14054289,"process_resources":process_resources(),"warm_resolver_lifecycle":"one case-owned resolver after complete prewarm and maintenance idle","cold_RAM_empty":"new resolver per cold trial; fixture identities retained but no rawresponsecache","native_host_abi":std::env::consts::ARCH,"musl":cfg!(target_env="musl"),"cost_prices":null,"api_parity_verified":false,"cloudfront_client_transport_measured":false,"production_cutover_authorized":false,"rust_decision":"pending_O2","lifecycle_decision":"pending_O5","gate_status":"requires_original_measurement_headroom_and_AK_decisions"}),
    )
}

pub async fn local_worker(
    config_path: &std::path::Path,
    manifest_path: &std::path::Path,
    endpoint: &str,
) -> Result<Value, String> {
    if !loopback(endpoint) {
        return Err("local worker S3 endpoint must be literal loopback".into());
    }
    let (c, bytes) = read_config(config_path).map_err(str::to_owned)?;
    use std::io::Read;
    let mut manifest_bytes = vec![];
    std::fs::File::open(manifest_path)
        .map_err(|_| "local manifest read")?
        .take(65537)
        .read_to_end(&mut manifest_bytes)
        .map_err(|_| "local manifest stream")?;
    if manifest_bytes.len() > 65536 {
        return Err("local manifest size".into());
    }
    let m: Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "local manifest schema")?;
    let executable = std::env::current_exe().map_err(|_| "local executable")?;
    let binary = hash_file(&executable, 128 * 1024 * 1024).map_err(str::to_owned)?;
    let config_hash = sha256(&bytes);
    let now = now_ms().map_err(str::to_owned)?;
    m.validate(&c, &config_hash, &binary, now)
        .map_err(str::to_owned)?;
    if !loopback(&m.provider_endpoint) {
        return Err("local provider endpoint".into());
    }
    source_check(&m).map_err(str::to_owned)?;
    let end = Instant::now() + Duration::from_millis(m.benchmark_expires_at_ms - now);
    let inner = Arc::new(
        HttpS3Transport::new(
            endpoint,
            "server2-local",
            REGION,
            rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
        )
        .map_err(|_| "local S3")?,
    );
    claim(&manifest_path.with_file_name("worker.claim"), &m).map_err(str::to_owned)?;
    let ledger = Arc::new(Ledger::new(m.allocations.clone(), m.phases.clone(), end));
    let mut report = run_live(&c, &m, inner, None, ledger.clone(), end).await?;
    if hash_file(config_path, 65536).ok().as_deref() != Some(config_hash.as_str())
        || hash_file(&executable, 128 * 1024 * 1024).ok().as_deref() != Some(binary.as_str())
        || source_check(&m).is_err()
    {
        abort_run(&mut report, &ledger, "local input drift");
    }
    report["measurement_scope"] = "local_worker_handshake".into();
    report["intended_host_gate_pass"] = false.into();
    report["AWS_requests"] = 0.into();
    report["metadata_requests"] = 0.into();
    report["run_id"] = m.run_id.into();
    report["allocation_id"] = m.allocation_id.into();
    report["source_revision"] = m.source_revision.into();
    report["source_map_sha256"] = m.source_map_sha256.into();
    report["binary_sha256"] = binary.into();
    report["lock_sha256"] = m.lock_sha256.into();
    report["requested_config_sha256"] = config_hash.into();
    report["guard_proof_sha256"] = m.guard_proof.proof_sha256.into();
    report["S3_accounting"] = ledger.report();
    if !execution_compliant(&ledger) {
        abort_run(&mut report, &ledger, "uncertain local accounting");
    }
    report["overall_accounting_compliance_pass"] =
        (execution_compliant(&ledger) && report["run_status"] != "ABORTED").into();
    bounded_export(report, &ledger)
}

fn process_resources() -> Value {
    let status = std::fs::read_to_string("/proc/self/status").ok();
    let rss = status
        .as_ref()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmHWM:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<u64>().ok())
        })
        .map(|k| k * 1024);
    let stat = std::fs::read_to_string("/proc/self/stat").ok();
    let fields = stat.as_ref().and_then(|s| {
        s.rsplit_once(") ")
            .map(|(_, r)| r.split_whitespace().collect::<Vec<_>>())
    });
    json!({"peak_RSS_bytes":rss,"user_CPU_clock_ticks":fields.as_ref().and_then(|v|v.get(11)).and_then(|v|v.parse::<u64>().ok()),"system_CPU_clock_ticks":fields.as_ref().and_then(|v|v.get(12)).and_then(|v|v.parse::<u64>().ok()),"CPU_clock_tick_rate":null,"scope":"whole process including seeding and protocol, not cold request wall time","unavailable_is_null_not_zero":true})
}

async fn negative_policy_probes(
    credentials: Arc<Metadata>,
    ledger: Arc<Ledger>,
    end: Instant,
) -> Result<Value, String> {
    use rusty_s3::S3Action;
    credentials
        .fresh()
        .await
        .map_err(|_| "policy credentials")?;
    let private = tokio::time::timeout_at(end, credentials.probe_credentials.read())
        .await
        .map_err(|_| "policy credential deadline")?
        .clone();
    let bucket = rusty_s3::Bucket::new(
        ENDPOINT.parse().map_err(|_| "policy endpoint")?,
        rusty_s3::UrlStyle::Path,
        BUCKET.to_owned(),
        REGION.to_owned(),
    )
    .map_err(|_| "policy bucket")?;
    let record = super::acquisition(
        22000,
        Period {
            local_date: 20261001,
            slot: "1200".into(),
        },
        1,
        super::body(22000, 1, 128),
        1,
        "s09-protocol-group",
    )
    .map_err(|_| "policy record")?
    .records[0]
        .prepare(&Limits::default())
        .map_err(|_| "policy gzip")?;
    let mut statuses = vec![];
    for (key, conditional) in [
        (&record.key, false),
        (&"forbidden/s09-policy.json".to_string(), true),
    ] {
        let mut ticket = ledger
            .reserve("protocol", Kind::Write, 65536, Some(record.body.len()))
            .map_err(|_| "policy probe admission")?
            .named("PUT", key);
        let mut action = bucket.put_object(Some(&private), key);
        action.headers_mut().insert("content-md5", &record.md5);
        action
            .headers_mut()
            .insert("content-type", "application/gzip");
        if conditional {
            action.headers_mut().insert("if-none-match", "*");
        }
        let url = action.sign(Duration::from_secs(30));
        let mut request = credentials
            .client
            .put(url)
            .header("content-md5", &record.md5)
            .header("content-type", "application/gzip");
        if conditional {
            request = request.header("if-none-match", "*")
        }
        let mut response =
            tokio::time::timeout_at(call_deadline(end), request.body(record.body.clone()).send())
                .await
                .map_err(|_| "policy probe timeout")?
                .map_err(|_| "policy probe transport")?;
        let status = response.status().as_u16();
        if response
            .headers()
            .iter()
            .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
            .sum::<usize>()
            > 8192
            || response.headers().contains_key("content-encoding")
        {
            return Err("policy probe headers".into());
        }
        let mut bytes = 0usize;
        while let Some(chunk) = tokio::time::timeout_at(call_deadline(end), response.chunk())
            .await
            .map_err(|_| "policy body timeout")?
            .map_err(|_| "policy body transport")?
        {
            if chunk.len() > 65536 - bytes {
                return Err("policy body bound".into());
            }
            bytes += chunk.len()
        }
        ticket.finish(Some(status), Some(bytes));
        statuses.push(status);
        if status != 403 {
            return Err(
                "required runtime-role missing-conditional/namespace denial not403; sweeps blocked"
                    .into(),
            );
        }
    }
    Ok(
        json!({"runtime_role_missing_condition_status":statuses[0],"runtime_role_forbidden_namespace_status":statuses[1],"sweeps_allowed":true,"delete_probe_performed":false,"denied_PUTs_permanently_charged":true}),
    )
}

#[cfg(test)]
mod wire_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    struct Peer {
        child: Child,
        endpoint: String,
    }
    impl Peer {
        fn start() -> Self {
            Self::start_with_fault(false)
        }
        fn start_with_fault(fault: bool) -> Self {
            Self::start_fault(fault.then_some("uncertain-provider-publication"))
        }
        fn start_fault(fault: Option<&str>) -> Self {
            let mut command = Command::new("python3");
            command.arg("tools/benchmark/local_peer.py");
            if let Some(fault) = fault {
                command.args(["--fault", fault]);
            }
            let mut child = command
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap();
            let mut endpoint = String::new();
            BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut endpoint)
                .unwrap();
            assert!(loopback(endpoint.trim()));
            Self {
                child,
                endpoint: endpoint.trim().into(),
            }
        }
    }
    impl Drop for Peer {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
    fn transport(p: &Peer, read: u64, write: u64, store: u64) -> LiveTransport {
        LiveTransport {
            credentials: None,
            inner: Arc::new(
                HttpS3Transport::new(
                    &p.endpoint,
                    "server2-local",
                    REGION,
                    rusty_s3::Credentials::new("server2-local", "server2-local-secret"),
                )
                .unwrap(),
            ),
            ledger: Arc::new(Ledger::new(
                Allocation {
                    read_attempts: read,
                    write_attempts: write,
                    download_bytes: 32 * 1024 * 1024,
                    stored_version_charge_bytes: store,
                    metadata_download_bytes: 0,
                },
                BTreeMap::from([(
                    "cold".into(),
                    Phase {
                        read_attempts: read,
                        write_attempts: write,
                    },
                )]),
                Instant::now() + Duration::from_secs(10),
            )),
            phase: "cold".into(),
            raw_cap: 65536,
            control_cap: 65536,
            list_cap: 65536,
        }
    }
    #[tokio::test]
    async fn wire_meter_counts_raw_control_list_budget_and_stops_before_dispatch() {
        let p = Peer::start();
        let t = transport(&p, 20, 20, 1024 * 1024);
        let a = super::super::acquisition(
            99,
            Period {
                local_date: 20261001,
                slot: "1200".into(),
            },
            1,
            super::super::body(99, 1, 128),
            1,
            "meter",
        )
        .unwrap();
        let record = a.records[0].prepare(&Limits::default()).unwrap();
        assert_eq!(t.put(&record).await.unwrap(), 200);
        assert_eq!(t.put(&record).await.unwrap(), 412);
        assert_eq!(t.get(&record.key, 65536).await.unwrap().body, record.body);
        assert_eq!(t.head(&record.key).await.unwrap().length, record.body.len());
        let group = a
            .declaration
            .reference(&CatalogLimits::default())
            .unwrap()
            .descriptor_key()
            .unwrap();
        let body = a.declaration.bytes(&CatalogLimits::default()).unwrap();
        assert_eq!(
            t.put_control(&group, &body, &WriteCondition::Absent)
                .await
                .unwrap(),
            200
        );
        assert_eq!(t.get_control(&group, 65536).await.unwrap().body, body);
        let document = t
            .list_raw_document("raw/v2/", None, 100, 65536)
            .await
            .unwrap();
        assert_eq!(decode_list(&document, 100).unwrap().keys.len(), 1);
        let budget = format!(
            "budgets/v2/data_go_kr/{}/window/authority.json",
            sha256(b"meter")
        );
        let result = t.get_budget(&budget).await;
        assert!(matches!(result, Err(BudgetError::NotFound)));
        assert_eq!(
            t.put_budget(&budget, b"{}", &WriteCondition::Absent)
                .await
                .unwrap(),
            200
        );
        let r = t.ledger.report();
        assert_eq!(r["used"]["read_attempts"], 4);
        assert_eq!(r["used"]["write_attempts"], 5);
        assert_eq!(
            r["used"]["stored_version_charge_bytes"],
            2 * record.body.len() as u64 + body.len() as u64 + 2 + 4 * OVERHEAD
        );
        assert_eq!(r["used"]["operation_attempts"]["PUT:raw"], 2);
        assert_eq!(r["used"]["operation_attempts"]["PUT:budget"], 1);
        let denied = transport(&p, 0, 0, 0);
        assert!(matches!(
            denied.get(&record.key, 65536).await,
            Err(Error::Capacity)
        ));
        assert_eq!(denied.ledger.report()["used"]["read_attempts"], 0);
    }
    #[test]
    fn successor_source_map_matches_exact_compiled_declaration() {
        let mut m = manifest("http://127.0.0.1:1");
        let declaration: Value =
            serde_json::from_str(include_str!("../../config/tasks/S09.json")).unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        for path in declaration["server2_paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .chain(
                declaration["outside"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["path"].as_str().unwrap()),
            )
        {
            m.source_map.insert(
                path.into(),
                hash_file(&root.join(path), 8 * 1024 * 1024).unwrap(),
            );
        }
        m.source_map_sha256 = sha256(&serde_json::to_vec(&m.source_map).unwrap());
        m.lock_sha256 = hash_file(&root.join("server2/Cargo.lock"), 1024 * 1024).unwrap();
        assert_eq!(source_check(&m), Ok(()));
        m.source_map
            .remove("server2/deploy/benchmark/ssm_startup_recovery.py");
        m.source_map_sha256 = sha256(&serde_json::to_vec(&m.source_map).unwrap());
        assert_eq!(source_check(&m), Err("source map paths"));
    }
    #[test]
    fn successor_expiry_is_fixed_and_durations_remain_bounded() {
        let now = 1791635400000u64;
        let mut m = manifest("http://127.0.0.1:1");
        let (mut c, _) = read_config(std::path::Path::new("config/benchmarks/aws.json")).unwrap();
        c.execution_enabled = true;
        c.source_revision = Some(m.source_revision.clone());
        c.source_map_sha256 = Some(m.source_map_sha256.clone());
        c.lock_sha256 = Some(m.lock_sha256.clone());
        c.review_candidate_sha256 = Some("0".repeat(64));
        m.approval_expires_at_ms = 1791642600000;
        m.host_expires_at_ms = now + 3600000;
        m.benchmark_expires_at_ms = now + 1800000;
        m.guard_proof.observed_at_ms = now;
        let validate = |m: &Manifest, now| m.validate(&c, &"0".repeat(64), &"0".repeat(64), now);
        assert_eq!(validate(&m, now), Ok(()));
        m.approval_expires_at_ms += 1;
        assert_eq!(validate(&m, now), Err("manifest expiry"));
        m.approval_expires_at_ms = 1791642600000;
        m.host_expires_at_ms = now + 7200001;
        assert_eq!(validate(&m, now), Err("manifest expiry"));
        m.host_expires_at_ms = 1791642600000;
        m.benchmark_expires_at_ms = 1791642600000;
        m.guard_proof.observed_at_ms = 1791642599999;
        assert_eq!(validate(&m, 1791642599999), Ok(()));
        assert_eq!(validate(&m, 1791642600000), Err("manifest expiry"));
        let old_now = 1791630000000;
        m.approval_expires_at_ms = 1791631080000; // reject even before old expiry
        m.host_expires_at_ms = old_now + 600000;
        m.benchmark_expires_at_ms = old_now + 300000;
        m.guard_proof.observed_at_ms = old_now;
        assert_eq!(validate(&m, old_now), Err("manifest expiry"));
    }
    fn manifest(provider: &str) -> Manifest {
        serde_json::from_value(json!({"schema":1,"run_id":RUN,"allocation_id":format!("{RUN}-worker1"),"source_map":{},"account":ACCOUNT,"region":REGION,"bucket":BUCKET,"role":ROLE,"instance_id":"i-0123456789abcdef0","source_revision":"0".repeat(40),"source_map_sha256":"0".repeat(64),"binary_sha256":"0".repeat(64),"lock_sha256":"0".repeat(64),"requested_config_sha256":"0".repeat(64),"approval_expires_at_ms":1791642600000u64,"host_expires_at_ms":1791642600000u64,"benchmark_expires_at_ms":1791642600000u64,"provider_endpoint":provider,"allocations":{"read_attempts":390000,"write_attempts":18000,"download_bytes":26*GIB,"stored_version_charge_bytes":63*1024*1024,"metadata_download_bytes":0},"operator_reservation_summary":{"read_attempts":10000,"write_attempts":2000,"bootstrap_download_bytes":3*GIB,"administrative_download_bytes":GIB,"stored_version_charge_bytes":1048576},"phases":{"protocol":{"read_attempts":5000,"write_attempts":3500},"cold":{"read_attempts":280000,"write_attempts":0},"repair":{"read_attempts":60000,"write_attempts":4000},"warm":{"read_attempts":10000,"write_attempts":0},"funding":{"read_attempts":10000,"write_attempts":5500},"failure":{"read_attempts":25000,"write_attempts":5000}},"guard_proof":{"status":"verified","run_id":RUN,"instance_id":"i-0123456789abcdef0","source_revision":"0".repeat(40),"observed_at_ms":0,"proof_sha256":"0".repeat(64)}})).unwrap()
    }
    #[tokio::test]
    async fn prior_uncertain_cold_trial_prevents_next_profile_seed_and_charge() {
        let peer = Peer::start_fault(Some("uncertain-cold-final-trial"));
        let m = manifest(&peer.endpoint);
        let end = Instant::now() + Duration::from_secs(10);
        let ledger = Arc::new(Ledger::new(m.allocations.clone(), m.phases.clone(), end));
        let t = transport(&peer, 1000, 1000, 10 * 1024 * 1024);
        let (mut c, _) = read_config(std::path::Path::new("config/benchmarks/aws.json")).unwrap();
        c.cases = (1..=2)
            .map(|revisions| LiveCase {
                name: format!("cold-{revisions}"),
                workload: "revisions".into(),
                mode: "cold".into(),
                selection: "targeted".into(),
                clients: 1,
                owners: 1,
                target_samples: 2,
                revisions,
                record_bytes: 128,
                load_model: "hot_key".into(),
            })
            .collect();
        let report = run_live(&c, &m, t.inner, None, ledger.clone(), end)
            .await
            .unwrap();
        let body = reqwest::get(format!("{}__benchmark/status", peer.endpoint))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let peer_report: Value = serde_json::from_slice(&body).unwrap();
        let checkpoint = &peer_report["fault_checkpoint"];
        assert!(
            checkpoint.is_object(),
            "final cold trial fault must be reached"
        );
        assert_eq!(
            peer_report["requests"], checkpoint["requests"],
            "no next-case peer requests: {peer_report}"
        );
        assert_eq!(peer_report["request_bytes"], checkpoint["request_bytes"]);
        assert_eq!(
            peer_report["stored_version_charge_bytes"],
            checkpoint["stored_version_charge_bytes"]
        );
        let puts: u64 = checkpoint["requests"]
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with("PUT:"))
            .map(|(_, v)| v.as_u64().unwrap())
            .sum();
        let lists: u64 = checkpoint["requests"]
            .as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| k.starts_with("LIST:"))
            .map(|(_, v)| v.as_u64().unwrap())
            .sum();
        let used = ledger.report();
        assert_eq!(used["used"]["write_attempts"], puts + lists);
        assert_eq!(
            used["used"]["stored_version_charge_bytes"],
            checkpoint["request_bytes"].as_u64().unwrap() + puts * OVERHEAD
        );
        assert_eq!(report["run_status"], "ABORTED");
        assert_eq!(report["overall_accounting_compliance_pass"], false);
        assert_eq!(report["cases"].as_array().unwrap().len(), 1);
        assert_eq!(report["cases"][0]["summary"]["outcomes"]["success"], 1);
        assert_eq!(report["cases"][0]["summary"]["outcomes"]["other_error"], 1);
        assert!(ledger.reserve("cold", Kind::Read, 1, None).is_err());
    }
    #[tokio::test]
    async fn late_uncertain_publication_retains_completed_and_partial_report() {
        let peer = Peer::start_with_fault(true);
        let m = manifest(&peer.endpoint);
        let end = Instant::now() + Duration::from_secs(10);
        let ledger = Arc::new(Ledger::new(m.allocations.clone(), m.phases.clone(), end));
        let t = transport(&peer, 1000, 1000, 10 * 1024 * 1024);
        let (mut c, _) = read_config(std::path::Path::new("config/benchmarks/aws.json")).unwrap();
        c.cases = ["cold", "provider_data", "provider_data"]
            .into_iter()
            .enumerate()
            .map(|(index, mode)| LiveCase {
                name: format!("case-{index}"),
                workload: "revisions".into(),
                mode: mode.into(),
                selection: "targeted".into(),
                clients: 1,
                owners: 1,
                target_samples: 1,
                revisions: 1,
                record_bytes: 128,
                load_model: "hot_key".into(),
            })
            .collect();
        let outcome = run_live(&c, &m, t.inner, None, ledger.clone(), end).await;
        assert!(
            outcome.is_ok(),
            "must retain a bounded report after the one-use run started: {outcome:?}"
        );
        let report = outcome.unwrap();
        assert_eq!(report["run_status"], "ABORTED");
        assert_eq!(report["overall_accounting_compliance_pass"], false);
        assert_eq!(report["requested_case_coverage_complete"], false);
        assert_eq!(
            report["cases"][0]["summary"]["outcomes"]["success"], 1,
            "{report}"
        );
        assert_eq!(
            report["cases"][1]["summary"]["outcomes"]["ambiguous"], 1,
            "{report}"
        );
        assert_eq!(
            report["cases"].as_array().unwrap().len(),
            2,
            "no following case dispatch"
        );
        assert!(
            report["abort_reason"]
                .as_str()
                .unwrap()
                .contains("uncertain")
        );
        let used = ledger.report();
        assert!(used["used"]["uncertain_calls"].as_u64().unwrap() > 0);
        assert!(
            ledger.reserve("cold", Kind::Read, 1, None).is_err(),
            "abort must close admission"
        );
    }
    #[tokio::test]
    async fn definitive_metadata_rejections_are_known_failures_not_unknown() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for status in [401, 404] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}/", listener.local_addr().unwrap());
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut input = [0; 4096];
                let _ = stream.read(&mut input).await.unwrap();
                stream.write_all(format!("HTTP/1.1 {status} Rejected{crlf}Content-Length: 0{crlf}Connection: close{crlf}{crlf}",crlf="\r\n").as_bytes()).await.unwrap();
            });
            let metadata =
                Metadata::test_metadata(endpoint, Instant::now() + Duration::from_secs(3));
            assert!(
                metadata
                    .document("/latest/api/token", None, true)
                    .await
                    .is_err()
            );
            task.await.unwrap();
            let report = metadata.report();
            assert_eq!(
                report["used"]["unknown_calls"], 0,
                "definitive status is known"
            );
            assert_eq!(report["used"]["failed_known"], 1);
            assert_eq!(report["used"]["confirmed_statuses"][status.to_string()], 1);
            assert!(report["used"]["reserved_bytes"].as_u64().unwrap() > 0);
        }
    }
    #[tokio::test]
    async fn known_metadata_headers_and_incomplete_transport_remain_distinct() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (headers, body, unknown) in [
            ("Content-Length: 16385", "", false),
            ("Content-Length: 0\r\nContent-Encoding: gzip", "", false),
            ("Content-Length: 5", "x", true),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}/", listener.local_addr().unwrap());
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut input = [0; 4096];
                let _ = stream.read(&mut input).await.unwrap();
                stream
                    .write_all(
                        format!("{protocol} 200 OK{crlf}{headers}{crlf}Connection: close{crlf}{crlf}{body}", protocol="HTTP/1.1", crlf="\r\n")
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
            });
            let metadata =
                Metadata::test_metadata(endpoint, Instant::now() + Duration::from_secs(3));
            assert!(
                metadata
                    .document("/latest/api/token", None, true)
                    .await
                    .is_err()
            );
            task.await.unwrap();
            let report = metadata.report();
            assert_eq!(report["used"]["unknown_calls"], u64::from(unknown));
            assert_eq!(report["used"]["failed_known"], u64::from(!unknown));
            assert_eq!(report["used"]["confirmed_statuses"]["200"], 1);
            assert!(report["used"]["reserved_bytes"].as_u64().unwrap() >= 16384);
        }
    }
    #[test]
    fn oversized_details_export_retains_summary_and_false_compliance() {
        let m = manifest("http://127.0.0.1:1/");
        let ledger = Ledger::new(
            m.allocations,
            m.phases,
            Instant::now() + Duration::from_secs(3),
        );
        let report = json!({"run_id":"bounded-run", "run_status":"COMPLETED", "overall_accounting_compliance_pass":true, "requested_case_coverage_complete":true, "cases":[{"summary":{"samples":123,"outcomes":{"success":122,"ambiguous":1}},"retained_samples":["x".repeat(2*1024*1024)]}], "S3_accounting":{"used":{"write_attempts":7,"operation_samples":["x".repeat(100)]}}});
        let report = bounded_export(report, &ledger).unwrap();
        assert!(serde_json::to_vec(&report).unwrap().len() <= 2 * 1024 * 1024);
        assert_eq!(report["run_id"], "bounded-run");
        assert_eq!(report["cases"][0]["summary"]["samples"], 123);
        assert_eq!(report["S3_accounting"]["used"]["write_attempts"], 7);
        assert_eq!(report["run_status"], "ABORTED");
        assert_eq!(report["overall_accounting_compliance_pass"], false);
        assert_eq!(report["requested_case_coverage_complete"], false);
        assert_eq!(ledger.report()["used"]["dispatch_stopped"], true);
    }
    #[tokio::test]
    async fn warm_multiple_waves_reuse_verified_case_resolver_without_new_wire() {
        let peer = Peer::start();
        let m = manifest(&peer.endpoint);
        let end = Instant::now() + Duration::from_secs(10);
        let ledger = Arc::new(Ledger::new(m.allocations.clone(), m.phases.clone(), end));
        let t = transport(&peer, 1000, 1000, 10 * 1024 * 1024);
        let (mut c, _) = read_config(std::path::Path::new("config/benchmarks/aws.json")).unwrap();
        c.cases = vec![LiveCase {
            name: "warm-waves".into(),
            workload: "revisions".into(),
            mode: "warm".into(),
            selection: "targeted".into(),
            clients: 8,
            owners: 4,
            target_samples: 16,
            revisions: 1,
            record_bytes: 128,
            load_model: "hot_key".into(),
        }];
        let report = run_live(&c, &m, t.inner, None, ledger, end).await.unwrap();
        let case = &report["cases"][0];
        assert_eq!(case["summary"]["outcomes"]["success"], 16);
        let waves = case["trials"].as_array().unwrap();
        assert_eq!(waves.len(), 2);
        assert_eq!(
            waves[1]["warmup_summary"]["samples"], 0,
            "a verified warm case must not start a fresh resolver/prewarm again"
        );
        assert_eq!(
            waves[0]["ledger_after_owned_work"], waves[1]["ledger_after_owned_work"],
            "second warm wave must retain exact zero S3/provider I/O"
        );
        assert_eq!(waves[1]["provider_http_calls"], 0);
    }
    #[tokio::test]
    async fn canonical_fixture_forecast_covers_actual_wire_and_all_versions() {
        let peer = Peer::start();
        let c = LiveCase {
            name: "forecast".into(),
            workload: "revisions".into(),
            mode: "cold".into(),
            selection: "latest".into(),
            clients: 8,
            owners: 4,
            target_samples: 8,
            revisions: 3,
            record_bytes: 128,
            load_model: "hot_key".into(),
        };
        let estimate = seed_charge(&c, 31).unwrap();
        let mut t = transport(&peer, 1000, 1000, 10 * 1024 * 1024);
        t.raw_cap = estimate.raw_body_cap;
        t.control_cap = estimate.control_body_cap;
        let profile = seed(
            &c,
            31,
            Arc::new(t.clone()),
            Instant::now() + Duration::from_secs(10),
        )
        .await
        .unwrap();
        assert_eq!(profile.groups, 3);
        let actual = t.ledger.report();
        assert_eq!(
            actual["used"]["stored_version_charge_bytes"], estimate.stored_charge,
            "canonical forecast includes every actual catalog version and PUT overhead"
        );
        assert!(actual["used"]["write_attempts"].as_u64().unwrap() <= 3 * 8);
        assert!(actual["used"]["read_attempts"].as_u64().unwrap() <= 3 * 16 + 100);
        for (operation, values) in actual["used"]["operation_samples"].as_object().unwrap() {
            if !operation.starts_with("GET:") {
                continue;
            }
            let cap = if operation == "GET:raw" {
                estimate.raw_body_cap
            } else {
                estimate.control_body_cap
            };
            for value in values.as_array().unwrap() {
                if value["received_status"] == 200 {
                    assert!(value["complete_body_bytes"].as_u64().unwrap() <= cap as u64);
                }
            }
        }
        assert!(estimate.raw_body_cap < 8 * 1024 * 1024);
        assert!(estimate.control_body_cap < 8 * 1024 * 1024);
        assert_eq!(actual["uncertainty_compliance_pass"], true);
    }
    #[tokio::test]
    async fn exact_fixture_stream_bound_and_plus_one_are_enforced() {
        let peer = Peer::start();
        let t = transport(&peer, 4, 4, 1024 * 1024);
        let a = super::super::acquisition(
            97,
            Period {
                local_date: 20261001,
                slot: "1200".into(),
            },
            1,
            super::super::body(97, 1, 128),
            1,
            "bound",
        )
        .unwrap();
        let r = a.records[0].prepare(&Limits::default()).unwrap();
        assert_eq!(t.put(&r).await.unwrap(), 200);
        assert_eq!(
            t.get(&r.key, r.body.len()).await.unwrap().body.len(),
            r.body.len()
        );
        assert!(t.get(&r.key, r.body.len() - 1).await.is_err());
        assert_eq!(
            t.ledger.report()["uncertainty_compliance_pass"],
            false,
            "an incomplete bounded read cannot certify accounting"
        );
    }
    #[tokio::test]
    async fn lost_put_stays_charged_and_reconciliation_does_not_refund_version() {
        let p = Peer::start();
        let t = transport(&p, 4, 4, 1024 * 1024);
        let a = super::super::acquisition(
            98,
            Period {
                local_date: 20261001,
                slot: "1200".into(),
            },
            1,
            super::super::body(98, 1, 128),
            1,
            "lost",
        )
        .unwrap();
        let r = a.records[0].prepare(&Limits::default()).unwrap();
        let mut control: reqwest::Url = format!("{}__test/fault/drop-after-put", p.endpoint)
            .parse()
            .unwrap();
        control.query_pairs_mut().append_pair("key", &r.key);
        reqwest::Client::new()
            .post(control)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
        assert!(t.put(&r).await.is_err());
        assert_eq!(t.put(&r).await.unwrap(), 412);
        assert_eq!(t.get(&r.key, 65536).await.unwrap().body, r.body);
        let report = t.ledger.report();
        assert_eq!(
            report["used"]["stored_version_charge_bytes"],
            2 * (r.body.len() as u64 + OVERHEAD)
        );
        assert_eq!(report["used"]["uncertain_calls"], 1);
        assert_eq!(report["uncertainty_compliance_pass"], false);
    }
    async fn metadata_peer(account: &str) -> (String, tokio::task::JoinHandle<usize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let account = account.to_owned();
        let task = tokio::spawn(async move {
            let mut calls = 0;
            loop {
                let Ok(Ok((mut socket, _))) =
                    tokio::time::timeout(Duration::from_millis(500), listener.accept()).await
                else {
                    break;
                };
                let mut data = vec![];
                loop {
                    let mut b = [0; 1024];
                    let n = socket.read(&mut b).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    data.extend_from_slice(&b[..n]);
                    if data.windows(4).any(|v| v == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&data);
                let body = if request.starts_with("PUT /latest/api/token") {
                    "synthetic-token".to_owned()
                } else if request.contains("instance-identity/document") {
                    json!({"accountId":account,"region":REGION,"instanceId":"i-0123456789abcdef0"})
                        .to_string()
                } else if request.contains(&format!("security-credentials/{ROLE}")) {
                    json!({"Code":"Success","Type":"AWS-HMAC","AccessKeyId":"synthetic-key","SecretAccessKey":"synthetic-secret","Token":"synthetic-session","Expiration":"2030-01-01T00:00:00Z","LastUpdated":"2026-10-08T00:00:00Z"}).to_string()
                } else {
                    ROLE.to_owned()
                };
                socket.write_all(format!("HTTP/1.1 200 OK{crlf}Content-Length: {}{crlf}Connection: close{crlf}{crlf}{body}",body.len(),crlf="\r\n").as_bytes()).await.unwrap();
                calls += 1;
            }
            calls
        });
        (endpoint, task)
    }
    #[tokio::test]
    async fn coherent_private_metadata_refresh_has_no_discovery_or_secret_report() {
        let (endpoint, task) = metadata_peer(ACCOUNT).await;
        let metadata = Arc::new(Metadata::test_metadata(
            endpoint,
            Instant::now() + Duration::from_secs(5),
        ));
        let mut jobs = tokio::task::JoinSet::new();
        for _ in 0..8 {
            let m = metadata.clone();
            jobs.spawn(async move { m.fresh().await });
        }
        while let Some(r) = jobs.join_next().await {
            r.unwrap().unwrap()
        }
        assert_eq!(task.await.unwrap(), 4);
        let report = metadata.report().to_string();
        for s in [
            "synthetic-key",
            "synthetic-secret",
            "synthetic-session",
            "synthetic-token",
        ] {
            assert!(!report.contains(s));
        }
        assert_eq!(metadata.report()["used"]["admitted_requests"], 4);
        metadata
            .expiration_ms
            .store(0, std::sync::atomic::Ordering::Release);
        assert!(metadata.fresh().await.is_err());
        assert!(metadata.report()["used"]["unknown_calls"].as_u64().unwrap() > 0);
    }
    #[tokio::test]
    async fn foreign_metadata_identity_stops_before_role_credentials() {
        let (endpoint, task) = metadata_peer("foreign").await;
        let metadata = Metadata::test_metadata(endpoint, Instant::now() + Duration::from_secs(3));
        assert!(matches!(
            metadata.fresh().await,
            Err(Error::Invalid("metadata identity"))
        ));
        assert_eq!(task.await.unwrap(), 2);
        assert_eq!(
            metadata
                .expiration_ms
                .load(std::sync::atomic::Ordering::Acquire),
            0
        );
    }
}
