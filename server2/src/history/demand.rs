//! Durable acquisition demand under `state/demand/grid/` (O-1/O-11 and the cold-cell
//! clarification). Records hold only the KMA grid, the last demand time and the expiry; push
//! demand is one aggregate of grid cells without subscriber data. Anything else is rejected.
use super::Grid;
use crate::storage::WriteCondition;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    future::Future,
    sync::{Arc, Mutex},
};

/// Request demand keeps a cell captured for 8 days after its last demand (O-1).
pub const DEMAND_WINDOW_MS: i64 = 8 * 24 * 3_600_000;
pub const PREFIX: &str = "state/demand/grid/";
pub const REQUEST_PREFIX: &str = "state/demand/grid/request/";
pub const PUSH_KEY: &str = "state/demand/grid/push.json";
pub const REQUEST_BYTES: usize = 4096;
/// Fits the largest valid aggregate (8,192 cells with 15-digit times, about 790 KB).
pub const PUSH_BYTES: usize = 1024 * 1024;
pub const PUSH_CELLS: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DemandError {
    Invalid(&'static str),
    Corrupt(&'static str),
    /// Conditional writes kept losing to concurrent writers.
    Conflict,
    Transport,
    Status(u16),
}
impl fmt::Display for DemandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "demand state: {self:?}")
    }
}
impl std::error::Error for DemandError {}

#[derive(Debug, Clone)]
pub struct DemandObject {
    pub body: Vec<u8>,
    /// Opaque quoted HTTP validator.
    pub etag: String,
}
#[derive(Debug, Clone, Default)]
pub struct DemandPage {
    pub keys: Vec<String>,
    pub next: Option<String>,
}
/// Prefix-scoped conditional JSON objects. `get_demand` returns `None` for a missing object;
/// `put_demand` returns the exact HTTP status (412/409 are conflicts, 200 success).
pub trait DemandTransport: Send + Sync + 'static {
    fn get_demand(
        &self,
        key: &str,
    ) -> impl Future<Output = Result<Option<DemandObject>, DemandError>> + Send;
    fn put_demand(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> impl Future<Output = Result<u16, DemandError>> + Send;
    fn list_demand(
        &self,
        prefix: &str,
        token: Option<&str>,
    ) -> impl Future<Output = Result<DemandPage, DemandError>> + Send;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestRecord {
    schema: u8,
    grid: Grid,
    #[serde(rename = "lastDemandMs")]
    last_demand_ms: i64,
    #[serde(rename = "expiresMs")]
    expires_ms: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PushCell {
    pub grid: Grid,
    #[serde(rename = "lastDemandMs")]
    pub last_demand_ms: i64,
    #[serde(rename = "expiresMs")]
    pub expires_ms: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PushRecord {
    schema: u8,
    /// Time the push aggregate was observed; every cell carries it as its last demand.
    #[serde(rename = "lastDemandMs")]
    last_demand_ms: i64,
    cells: Vec<PushCell>,
}

fn time_ok(ms: i64) -> bool {
    (0..=253_402_300_799_999).contains(&ms)
}
/// `state/demand/grid/request/{nx:03}-{ny:03}.json`.
pub fn request_key(grid: Grid) -> String {
    format!("{REQUEST_PREFIX}{:03}-{:03}.json", grid.nx(), grid.ny())
}
fn grid_of_key(key: &str) -> Option<Grid> {
    let name = key.strip_prefix(REQUEST_PREFIX)?.strip_suffix(".json")?;
    let (x, y) = name.split_once('-')?;
    if x.len() != 3 || y.len() != 3 || !(x.bytes().chain(y.bytes())).all(|b| b.is_ascii_digit()) {
        return None;
    }
    Grid::new(x.parse().ok()?, y.parse().ok()?)
}
/// Strict request-record parse: exact fields, key/body grid match, 8-day expiry.
fn parse_request(key: &str, body: &[u8]) -> Result<RequestRecord, DemandError> {
    let invalid = DemandError::Invalid("request demand record");
    if body.len() > REQUEST_BYTES {
        return Err(invalid);
    }
    let record: RequestRecord = serde_json::from_slice(body).map_err(|_| invalid.clone())?;
    if record.schema != 1
        || !record.grid.valid()
        || grid_of_key(key) != Some(record.grid)
        || !time_ok(record.last_demand_ms)
        || record.last_demand_ms.checked_add(DEMAND_WINDOW_MS) != Some(record.expires_ms)
    {
        return Err(invalid);
    }
    Ok(record)
}
fn encode_request(grid: Grid, last_demand_ms: i64) -> Vec<u8> {
    serde_json::to_vec(&RequestRecord {
        schema: 1,
        grid,
        last_demand_ms,
        expires_ms: last_demand_ms + DEMAND_WINDOW_MS,
    })
    .expect("demand serialization")
}
fn parse_push(body: &[u8]) -> Result<PushRecord, DemandError> {
    let invalid = DemandError::Invalid("push demand aggregate");
    if body.len() > PUSH_BYTES {
        return Err(invalid);
    }
    let record: PushRecord = serde_json::from_slice(body).map_err(|_| invalid.clone())?;
    if record.schema != 1
        || !time_ok(record.last_demand_ms)
        || record.cells.len() > PUSH_CELLS
        || record.cells.windows(2).any(|w| w[0].grid >= w[1].grid)
        || record.cells.iter().any(|c| {
            !c.grid.valid()
                || c.last_demand_ms != record.last_demand_ms
                || c.expires_ms <= c.last_demand_ms
                || c.expires_ms - c.last_demand_ms > DEMAND_WINDOW_MS
        })
    {
        return Err(invalid);
    }
    Ok(record)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushOutcome {
    Replaced,
    /// A newer snapshot was already durable; it was kept and adopted.
    Superseded,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DemandChange {
    /// No valid durable record existed.
    New,
    /// A record existed but had expired: the cell resumes after a demand gap.
    Resumed,
    /// The durable record was advanced.
    Refreshed,
    /// Recorded in memory only; the durable record is recent enough.
    Unchanged,
}
#[derive(Debug, Clone)]
pub struct DemandConfig {
    /// Minimum age of the durable `lastDemandMs` before a new request rewrites it.
    pub refresh_ms: i64,
    pub attempts: usize,
    pub list_pages: usize,
}
impl Default for DemandConfig {
    fn default() -> Self {
        Self {
            refresh_ms: 10 * 60_000,
            attempts: 4,
            list_pages: 64,
        }
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RebuildReport {
    pub request_records: usize,
    pub push_cells: usize,
    /// Objects rejected by the strict schema; they never count as demand.
    pub invalid: usize,
}
#[derive(Default)]
struct Memory {
    /// grid -> (latest demand seen by this process, durable lastDemandMs if known)
    request: BTreeMap<Grid, (i64, Option<i64>)>,
    push: Vec<PushCell>,
    push_snapshot: Option<i64>,
}
pub struct DemandStore<T> {
    transport: Arc<T>,
    config: DemandConfig,
    memory: Mutex<Memory>,
}
impl<T: DemandTransport> DemandStore<T> {
    pub fn new(transport: Arc<T>, config: DemandConfig) -> Result<Self, DemandError> {
        if !(0..=DEMAND_WINDOW_MS).contains(&config.refresh_ms)
            || !(1..=8).contains(&config.attempts)
            || !(1..=1024).contains(&config.list_pages)
        {
            return Err(DemandError::Invalid("demand configuration"));
        }
        Ok(Self {
            transport,
            config,
            memory: Mutex::new(Memory::default()),
        })
    }
    fn memory(&self) -> std::sync::MutexGuard<'_, Memory> {
        self.memory.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Record request demand for one grid cell at `now_ms`.
    pub async fn touch(&self, grid: Grid, now_ms: i64) -> Result<DemandChange, DemandError> {
        if !grid.valid() || !time_ok(now_ms) {
            return Err(DemandError::Invalid("demand grid or time"));
        }
        {
            let mut m = self.memory();
            let entry = m.request.entry(grid).or_insert((now_ms, None));
            entry.0 = entry.0.max(now_ms);
            if let Some(durable) = entry.1
                && now_ms - durable < self.config.refresh_ms
                && durable + DEMAND_WINDOW_MS > now_ms
            {
                return Ok(DemandChange::Unchanged);
            }
        }
        let key = request_key(grid);
        for _ in 0..self.config.attempts {
            let (condition, stored) = match self.transport.get_demand(&key).await? {
                None => (WriteCondition::Absent, None),
                Some(object) => (
                    WriteCondition::Match(object.etag),
                    parse_request(&key, &object.body).ok(),
                ),
            };
            let change = match stored {
                None => DemandChange::New,
                Some(r) if r.expires_ms <= now_ms => DemandChange::Resumed,
                Some(_) => DemandChange::Refreshed,
            };
            let last = stored.map_or(now_ms, |r| r.last_demand_ms.max(now_ms));
            match self
                .transport
                .put_demand(&key, &encode_request(grid, last), &condition)
                .await?
            {
                200 => {
                    let mut m = self.memory();
                    let entry = m.request.entry(grid).or_insert((last, None));
                    entry.0 = entry.0.max(last);
                    entry.1 = Some(entry.1.map_or(last, |d| d.max(last)));
                    return Ok(change);
                }
                409 | 412 => continue,
                status => return Err(DemandError::Status(status)),
            }
        }
        Err(DemandError::Conflict)
    }
    /// Replace the aggregate push demand with `cells` observed at `snapshot_ms`. The caller
    /// (the S18 push reconciler) supplies grid identities only. An older snapshot never
    /// replaces a newer durable one, also after a conflict retry or a reordered completion.
    pub async fn replace_push(
        &self,
        cells: &[Grid],
        snapshot_ms: i64,
        ttl_ms: i64,
    ) -> Result<PushOutcome, DemandError> {
        if !time_ok(snapshot_ms)
            || ttl_ms <= 0
            || ttl_ms > DEMAND_WINDOW_MS
            || cells.iter().any(|g| !g.valid())
        {
            return Err(DemandError::Invalid("push demand"));
        }
        let grids: BTreeSet<Grid> = cells.iter().copied().collect();
        if grids.len() > PUSH_CELLS {
            return Err(DemandError::Invalid("push demand cells"));
        }
        let cells: Vec<PushCell> = grids
            .into_iter()
            .map(|grid| PushCell {
                grid,
                last_demand_ms: snapshot_ms,
                expires_ms: snapshot_ms + ttl_ms,
            })
            .collect();
        let record = PushRecord {
            schema: 1,
            last_demand_ms: snapshot_ms,
            cells,
        };
        let body = serde_json::to_vec(&record).expect("push serialization");
        if body.len() > PUSH_BYTES {
            return Err(DemandError::Invalid("push demand aggregate size"));
        }
        for _ in 0..self.config.attempts {
            let condition = match self.transport.get_demand(PUSH_KEY).await? {
                None => WriteCondition::Absent,
                Some(object) => {
                    if let Ok(stored) = parse_push(&object.body)
                        && stored.last_demand_ms > snapshot_ms
                    {
                        self.adopt_push(stored);
                        return Ok(PushOutcome::Superseded);
                    }
                    WriteCondition::Match(object.etag)
                }
            };
            match self
                .transport
                .put_demand(PUSH_KEY, &body, &condition)
                .await?
            {
                200 => {
                    self.adopt_push(record);
                    return Ok(PushOutcome::Replaced);
                }
                409 | 412 => continue,
                status => return Err(DemandError::Status(status)),
            }
        }
        Err(DemandError::Conflict)
    }
    /// Keep the newest push aggregate in memory regardless of completion order.
    fn adopt_push(&self, record: PushRecord) {
        let mut m = self.memory();
        if m.push_snapshot.is_none_or(|s| s <= record.last_demand_ms) {
            m.push_snapshot = Some(record.last_demand_ms);
            m.push = record.cells;
        }
    }
    /// Reload every durable record (after a replacement). Invalid objects are counted and ignored.
    pub async fn rebuild(&self) -> Result<RebuildReport, DemandError> {
        let mut report = RebuildReport::default();
        let mut keys = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..self.config.list_pages {
            let page = self
                .transport
                .list_demand(REQUEST_PREFIX, token.as_deref())
                .await?;
            keys.extend(page.keys);
            token = page.next;
            if token.is_none() {
                break;
            }
        }
        if token.is_some() {
            return Err(DemandError::Corrupt(
                "demand listing exceeds its page bound",
            ));
        }
        let mut request = BTreeMap::new();
        for key in keys {
            let Some(object) = self.transport.get_demand(&key).await? else {
                continue;
            };
            match parse_request(&key, &object.body) {
                Ok(r) => {
                    report.request_records += 1;
                    request.insert(r.grid, (r.last_demand_ms, Some(r.last_demand_ms)));
                }
                Err(_) => report.invalid += 1,
            }
        }
        let push = match self.transport.get_demand(PUSH_KEY).await? {
            None => None,
            Some(object) => match parse_push(&object.body) {
                Ok(record) => Some(record),
                Err(_) => {
                    report.invalid += 1;
                    None
                }
            },
        };
        report.push_cells = push.as_ref().map_or(0, |r| r.cells.len());
        let mut m = self.memory();
        for (grid, (last, durable)) in request {
            let entry = m.request.entry(grid).or_insert((last, durable));
            entry.0 = entry.0.max(last);
            entry.1 = Some(entry.1.map_or(last, |d| d.max(last)));
        }
        drop(m);
        // Monotonic: a concurrent replace_push that completed after this read is never undone,
        // and a missing or invalid object never clears demand already held in memory.
        if let Some(record) = push {
            self.adopt_push(record);
        }
        Ok(report)
    }
    /// Cells with request demand in the last 8 days or unexpired push demand at `now_ms`.
    pub fn active(&self, now_ms: i64) -> BTreeSet<Grid> {
        let m = self.memory();
        m.request
            .iter()
            .filter(|(_, (last, durable))| {
                (*last).max(durable.unwrap_or(i64::MIN)) + DEMAND_WINDOW_MS > now_ms
            })
            .map(|(g, _)| *g)
            .chain(
                m.push
                    .iter()
                    .filter(|c| c.expires_ms > now_ms)
                    .map(|c| c.grid),
            )
            .collect()
    }
    /// Every grid with any known demand record, expired or not (index rebuild scope).
    pub fn known(&self) -> BTreeSet<Grid> {
        let m = self.memory();
        m.request
            .keys()
            .copied()
            .chain(m.push.iter().map(|c| c.grid))
            .collect()
    }
}
