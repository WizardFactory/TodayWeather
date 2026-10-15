//! Durable push state in S3: an ordered journal of accepted changes plus periodic snapshots.
//!
//! - `index/v2/push/state/journal/{seq:012}.json`: one entry per accepted request (or import
//!   chunk), written with `If-None-Match: *`. A sequence number is owned by exactly one entry,
//!   so two writers can never both commit it; the loser sees `412` and catches up.
//! - An unknown write outcome (timeout, transport error, 5xx) is reconciled by reading the entry
//!   back; when it is absent, a `void` entry is written conditionally so the original write can
//!   never commit later. Until that settles, the writer accepts no further change.
//! - `index/v2/push/state/snapshot/{seq:012}-{nonce}/{part:04}.json`: record parts of a full
//!   state, then `index/v2/push/state/head.json` (conditional) names the parts and their digest.
//! - Restore: head, its parts (bounded parallel reads, digests checked), then journal entries
//!   from `head.seq + 1` until the first absent sequence.
use super::ejson::{self, DecodeError};
use super::store::{Change, Coll, Oid, State};
use crate::gateway::OrderedJson;
use crate::storage::{CatalogTransport, Error, WriteCondition, sha256};
use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

const PREFIX: &str = "index/v2/push/state";
const MAX_OBJECT: usize = 8 * 1024 * 1024;

pub fn head_key() -> String {
    format!("{PREFIX}/head.json")
}
pub fn journal_key(seq: u64) -> String {
    format!("{PREFIX}/journal/{seq:012}.json")
}

#[derive(Clone, Debug)]
pub struct DurableConfig {
    /// Bound of one S3 operation.
    pub op_deadline: Duration,
    /// Journal entries after the head snapshot that trigger a new snapshot.
    pub compact_every: u64,
    /// Serialized bytes per snapshot part.
    pub part_bytes: usize,
    /// Concurrent S3 reads/writes during restore and snapshots (process S3 bound is 12).
    pub parallel: usize,
    /// Journal entry size the importer splits its changes into (a single entry is at most the
    /// 8 MiB control-object limit).
    pub entry_bytes: usize,
}
impl Default for DurableConfig {
    fn default() -> Self {
        Self {
            op_deadline: Duration::from_secs(2),
            compact_every: 1024,
            part_bytes: 2 * 1024 * 1024,
            parallel: 8,
            entry_bytes: 1024 * 1024,
        }
    }
}

/// Aggregate, identity-free counters for operations.
#[derive(Debug, Default)]
pub struct Counters {
    pub committed: AtomicU64,
    pub conflicts: AtomicU64,
    pub ambiguous: AtomicU64,
    pub reconciled_committed: AtomicU64,
    pub voided: AtomicU64,
    pub failed: AtomicU64,
    pub replayed: AtomicU64,
    pub snapshots: AtomicU64,
    pub snapshot_failures: AtomicU64,
}
impl Counters {
    pub fn render(&self) -> String {
        let f = |a: &AtomicU64| a.load(Ordering::Relaxed);
        format!(
            "server2_push_state_committed_total {}\nserver2_push_state_conflicts_total {}\nserver2_push_state_ambiguous_total {}\nserver2_push_state_reconciled_committed_total {}\nserver2_push_state_voided_total {}\nserver2_push_state_failed_total {}\nserver2_push_state_replayed_total {}\nserver2_push_state_snapshots_total {}\nserver2_push_state_snapshot_failures_total {}\n",
            f(&self.committed),
            f(&self.conflicts),
            f(&self.ambiguous),
            f(&self.reconciled_committed),
            f(&self.voided),
            f(&self.failed),
            f(&self.replayed),
            f(&self.snapshots),
            f(&self.snapshot_failures)
        )
    }
}

/// Outcome of committing one change set at `state.seq + 1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Commit {
    /// Durable; the caller applies the changes.
    Committed,
    /// Another writer owns the sequence; catch up and plan again.
    Conflict,
    /// Not durable; the sequence now holds a void entry (the caller advances `seq`).
    Voided,
    /// Not durable: S3 rejected the write before accepting it (the sequence stays free).
    Rejected,
    /// Not durable and not settled (the writer stays blocked until [`Durable::settle`]).
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateError {
    Storage(Error),
    Corrupt(&'static str),
}
impl From<Error> for StateError {
    fn from(e: Error) -> Self {
        StateError::Storage(e)
    }
}
impl From<DecodeError> for StateError {
    fn from(e: DecodeError) -> Self {
        StateError::Corrupt(e.0)
    }
}
impl std::fmt::Display for StateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StateError::Storage(e) => write!(f, "push state storage: {e}"),
            StateError::Corrupt(what) => write!(f, "push state corrupt: {what}"),
        }
    }
}
impl std::error::Error for StateError {}

pub fn nonce() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut h = RandomState::new().build_hasher();
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    format!("{:016x}", h.finish())
}

/// A journal entry body for `changes` at `seq`: a header line, then one line per changed
/// record (JSON lines keep every parse small).
pub fn entry_bytes(seq: u64, next_n: u64, nonce: &str, changes: &[Change]) -> Vec<u8> {
    let mut s = format!(
        "{{\"schema\":1,\"seq\":{seq},\"nonce\":\"{nonce}\",\"next_n\":{next_n},\"changes\":{}}}\n",
        changes.len()
    );
    for change in changes {
        match &change.record {
            Some(r) => ejson::write_record(change.coll, change.n, r, &mut s),
            None => s.push_str(&format!(
                "{{\"c\":\"{}\",\"n\":{},\"removed\":true}}",
                change.coll.collection(),
                change.n
            )),
        }
        s.push('\n');
    }
    s.into_bytes()
}
fn void_bytes(seq: u64, nonce: &str) -> Vec<u8> {
    format!("{{\"schema\":1,\"seq\":{seq},\"nonce\":\"{nonce}\",\"void\":true}}\n").into_bytes()
}

fn lines(body: &[u8]) -> impl Iterator<Item = &[u8]> {
    body.split(|b| *b == b'\n').filter(|l| !l.is_empty())
}

/// A decoded journal entry: `None` for a void entry.
fn parse_entry(seq: u64, body: &[u8]) -> Result<Option<(u64, Vec<Change>)>, StateError> {
    let mut it = lines(body);
    let header = it.next().ok_or(StateError::Corrupt("journal header"))?;
    let v = OrderedJson::parse(header).map_err(|_| StateError::Corrupt("journal json"))?;
    if v.get("schema").and_then(OrderedJson::number) != Some(1.)
        || v.get("seq").and_then(OrderedJson::number) != Some(seq as f64)
    {
        return Err(StateError::Corrupt("journal header"));
    }
    if v.get("void") == Some(&OrderedJson::Bool(true)) {
        return Ok(None);
    }
    let next_n = v
        .get("next_n")
        .and_then(OrderedJson::number)
        .ok_or(StateError::Corrupt("journal next_n"))? as u64;
    let count = v
        .get("changes")
        .and_then(OrderedJson::number)
        .ok_or(StateError::Corrupt("journal changes"))? as usize;
    let mut changes = Vec::with_capacity(count);
    for line in it {
        let item = OrderedJson::parse(line).map_err(|_| StateError::Corrupt("journal change"))?;
        if item.get("removed") == Some(&OrderedJson::Bool(true)) {
            let coll = item
                .get("c")
                .and_then(OrderedJson::string)
                .and_then(|c| Coll::parse(&c))
                .ok_or(StateError::Corrupt("journal removal"))?;
            let n = item
                .get("n")
                .and_then(OrderedJson::number)
                .ok_or(StateError::Corrupt("journal removal"))? as u64;
            changes.push(Change {
                coll,
                n,
                record: None,
            });
        } else {
            let (coll, n, record) = ejson::read_record(&item)?;
            changes.push(Change {
                coll,
                n,
                record: Some(record),
            });
        }
    }
    if changes.len() != count {
        return Err(StateError::Corrupt("journal change count"));
    }
    Ok(Some((next_n, changes)))
}

pub struct Durable<T> {
    transport: Arc<T>,
    pub config: DurableConfig,
    pub counters: Arc<Counters>,
    head_etag: Option<String>,
    head_seq: u64,
    /// An entry whose outcome is unknown: (sequence, body).
    pending: Option<(u64, Vec<u8>)>,
}

impl<T: CatalogTransport + Send + Sync + 'static> Durable<T> {
    pub fn new(transport: Arc<T>, config: DurableConfig, counters: Arc<Counters>) -> Self {
        Self {
            transport,
            config,
            counters,
            head_etag: None,
            head_seq: 0,
            pending: None,
        }
    }

    async fn bounded<F, R>(&self, f: F) -> Result<R, Error>
    where
        F: std::future::Future<Output = Result<R, Error>>,
    {
        tokio::time::timeout(self.config.op_deadline, f)
            .await
            .unwrap_or(Err(Error::Timeout))
    }

    async fn get(&self, key: &str) -> Result<Option<crate::storage::ControlObject>, Error> {
        match self
            .bounded(self.transport.get_control(key, MAX_OBJECT))
            .await
        {
            Ok(o) => Ok(Some(o)),
            Err(Error::NotFound) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Full restore: head snapshot, then the journal after it.
    pub async fn restore(&mut self) -> Result<State, StateError> {
        let mut state = State::default();
        self.head_etag = None;
        self.head_seq = 0;
        self.pending = None;
        if let Some(head) = self.get(&head_key()).await? {
            let v = OrderedJson::parse(&head.body).map_err(|_| StateError::Corrupt("head json"))?;
            let seq = v
                .get("seq")
                .and_then(OrderedJson::number)
                .ok_or(StateError::Corrupt("head seq"))? as u64;
            let next_n = v
                .get("next_n")
                .and_then(OrderedJson::number)
                .ok_or(StateError::Corrupt("head next_n"))? as u64;
            let Some(OrderedJson::Array(parts)) = v.get("parts") else {
                return Err(StateError::Corrupt("head parts"));
            };
            let mut wanted = Vec::with_capacity(parts.len());
            for p in parts {
                let key = p
                    .get("key")
                    .and_then(OrderedJson::string)
                    .ok_or(StateError::Corrupt("head part key"))?;
                let digest = p
                    .get("sha256")
                    .and_then(OrderedJson::string)
                    .ok_or(StateError::Corrupt("head part digest"))?;
                let count = p
                    .get("records")
                    .and_then(OrderedJson::number)
                    .ok_or(StateError::Corrupt("head part count"))?
                    as usize;
                wanted.push((key, digest, count));
            }
            let mut set = tokio::task::JoinSet::new();
            let gate = Arc::new(tokio::sync::Semaphore::new(self.config.parallel.max(1)));
            for (i, (key, digest, count)) in wanted.into_iter().enumerate() {
                let transport = self.transport.clone();
                let gate = gate.clone();
                let deadline = self.config.op_deadline;
                set.spawn(async move {
                    let _permit = gate.acquire_owned().await.map_err(|_| Error::Capacity)?;
                    let object =
                        tokio::time::timeout(deadline, transport.get_control(&key, MAX_OBJECT))
                            .await
                            .unwrap_or(Err(Error::Timeout))?;
                    Ok::<_, Error>((i, digest, count, object.body))
                });
            }
            let mut loaded = Vec::new();
            while let Some(joined) = set.join_next().await {
                let (i, digest, count, body) =
                    joined.map_err(|_| StateError::Corrupt("snapshot task"))??;
                if sha256(&body) != digest {
                    return Err(StateError::Corrupt("snapshot part digest"));
                }
                loaded.push((i, count, body));
            }
            loaded.sort_by_key(|(i, ..)| *i);
            for (_, count, body) in loaded {
                let mut it = lines(&body);
                let header = it
                    .next()
                    .ok_or(StateError::Corrupt("snapshot part header"))?;
                let v = OrderedJson::parse(header)
                    .map_err(|_| StateError::Corrupt("snapshot part json"))?;
                if v.get("records").and_then(OrderedJson::number) != Some(count as f64) {
                    return Err(StateError::Corrupt("snapshot part count"));
                }
                let mut seen = 0usize;
                for line in it {
                    let r = OrderedJson::parse(line)
                        .map_err(|_| StateError::Corrupt("snapshot record json"))?;
                    let (c, n, record) = ejson::read_record(&r)?;
                    state.coll_mut(c).put(n, record);
                    seen += 1;
                }
                if seen != count {
                    return Err(StateError::Corrupt("snapshot part count"));
                }
            }
            state.seq = seq;
            state.next_n = next_n;
            self.head_etag = Some(head.etag);
            self.head_seq = seq;
        }
        self.catch_up(&mut state).await?;
        Ok(state)
    }

    /// Apply every journal entry after `state.seq` (restore and conflicts).
    pub async fn catch_up(&mut self, state: &mut State) -> Result<(), StateError> {
        for (seq, body) in self.fetch_after(state.seq).await? {
            self.apply_entry(state, seq, &body)?;
        }
        Ok(())
    }

    /// Whether another writer has committed after `seq` (one read of the next sequence).
    pub async fn next_exists(&self, seq: u64) -> Result<bool, StateError> {
        Ok(self.get(&journal_key(seq + 1)).await?.is_some())
    }

    /// The journal entries after `seq`, in order (parallel probes of `parallel` sequences).
    pub async fn fetch_after(&self, seq: u64) -> Result<Vec<(u64, Vec<u8>)>, StateError> {
        let mut out = Vec::new();
        let mut next = seq + 1;
        loop {
            let mut set = tokio::task::JoinSet::new();
            for probe in next..next + self.config.parallel.max(1) as u64 {
                let transport = self.transport.clone();
                let deadline = self.config.op_deadline;
                set.spawn(async move {
                    let r = tokio::time::timeout(
                        deadline,
                        transport.get_control(&journal_key(probe), MAX_OBJECT),
                    )
                    .await
                    .unwrap_or(Err(Error::Timeout));
                    (probe, r)
                });
            }
            let mut found = Vec::new();
            while let Some(joined) = set.join_next().await {
                found.push(joined.map_err(|_| StateError::Corrupt("journal task"))?);
            }
            found.sort_by_key(|(probe, _)| *probe);
            for (probe, r) in found {
                match r {
                    Ok(object) => {
                        out.push((probe, object.body));
                        next = probe + 1;
                    }
                    Err(Error::NotFound) => return Ok(out),
                    Err(e) => return Err(StateError::Storage(e)),
                }
            }
        }
    }

    pub fn apply_entry(&self, state: &mut State, seq: u64, body: &[u8]) -> Result<(), StateError> {
        if let Some((next_n, changes)) = parse_entry(seq, body)? {
            state.apply(&changes);
            state.next_n = state.next_n.max(next_n);
        }
        state.seq = seq;
        self.counters.replayed.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Resolve an earlier unknown write before accepting new changes. Returns the journal
    /// entries to apply (the reconciled entry itself, or what another writer committed).
    pub async fn settle(&mut self, seq_now: u64) -> Result<Vec<(u64, Vec<u8>)>, StateError> {
        let Some((seq, body)) = self.pending.clone() else {
            return Ok(Vec::new());
        };
        match self.reconcile(seq, &body).await {
            Reconciled::Ours => {
                self.pending = None;
                self.counters
                    .reconciled_committed
                    .fetch_add(1, Ordering::Relaxed);
                let mut out = vec![(seq, body)];
                out.extend(self.fetch_after(seq).await?);
                Ok(out)
            }
            Reconciled::Theirs | Reconciled::Voided => {
                self.pending = None;
                self.fetch_after(seq_now).await
            }
            Reconciled::Unknown(e) => Err(StateError::Storage(e)),
        }
    }

    pub fn unsettled(&self) -> bool {
        self.pending.is_some()
    }

    /// Read back `seq`; when absent, void it so the original write can never commit.
    async fn reconcile(&self, seq: u64, body: &[u8]) -> Reconciled {
        let key = journal_key(seq);
        for _ in 0..2 {
            match self.get(&key).await {
                Ok(Some(object)) => {
                    return if object.body == body {
                        Reconciled::Ours
                    } else {
                        Reconciled::Theirs
                    };
                }
                Ok(None) => {
                    let void = void_bytes(seq, &nonce());
                    match self
                        .bounded(
                            self.transport
                                .put_control(&key, &void, &WriteCondition::Absent),
                        )
                        .await
                    {
                        Ok(200) => {
                            self.counters.voided.fetch_add(1, Ordering::Relaxed);
                            return Reconciled::Voided;
                        }
                        // Someone (possibly our late write) committed meanwhile: read it again.
                        Ok(409 | 412) => continue,
                        Ok(status) => return Reconciled::Unknown(Error::Status(status)),
                        Err(e) => return Reconciled::Unknown(e),
                    }
                }
                Err(e) => return Reconciled::Unknown(e),
            }
        }
        Reconciled::Unknown(Error::Ambiguous)
    }

    /// Write `changes` as journal entry `seq` (the state's next sequence).
    pub async fn commit(&mut self, seq: u64, changes: &[Change], next_n: u64) -> Commit {
        if self.pending.is_some() {
            return Commit::Failed;
        }
        let body = entry_bytes(seq, next_n, &nonce(), changes);
        if body.len() > MAX_OBJECT {
            self.counters.failed.fetch_add(1, Ordering::Relaxed);
            return Commit::Rejected;
        }
        // Credentials first (S10f): a failure here means no request was sent.
        if self.bounded(self.transport.ready()).await.is_err() {
            self.counters.failed.fetch_add(1, Ordering::Relaxed);
            return Commit::Rejected;
        }
        let key = journal_key(seq);
        let written = self
            .bounded(
                self.transport
                    .put_control(&key, &body, &WriteCondition::Absent),
            )
            .await;
        match written {
            Ok(200) => {
                self.counters.committed.fetch_add(1, Ordering::Relaxed);
                Commit::Committed
            }
            Ok(409 | 412) => {
                self.counters.conflicts.fetch_add(1, Ordering::Relaxed);
                Commit::Conflict
            }
            // A rejection before the body was accepted (4xx other than conflicts) is not a
            // commit; anything else may have committed and is reconciled.
            Ok(status) if (400..500).contains(&status) => {
                self.counters.failed.fetch_add(1, Ordering::Relaxed);
                Commit::Rejected
            }
            _ => {
                self.counters.ambiguous.fetch_add(1, Ordering::Relaxed);
                match self.reconcile(seq, &body).await {
                    Reconciled::Ours => {
                        self.counters
                            .reconciled_committed
                            .fetch_add(1, Ordering::Relaxed);
                        Commit::Committed
                    }
                    Reconciled::Theirs => {
                        self.counters.conflicts.fetch_add(1, Ordering::Relaxed);
                        Commit::Conflict
                    }
                    Reconciled::Voided => {
                        self.counters.failed.fetch_add(1, Ordering::Relaxed);
                        Commit::Voided
                    }
                    Reconciled::Unknown(_) => {
                        self.pending = Some((seq, body));
                        self.counters.failed.fetch_add(1, Ordering::Relaxed);
                        Commit::Failed
                    }
                }
            }
        }
    }

    pub fn needs_snapshot(&self, state: &State) -> bool {
        state.seq >= self.head_seq + self.config.compact_every
    }

    /// Serialize a full snapshot of `state` (CPU only; the caller holds its read access).
    pub fn prepare_snapshot(&self, state: &State) -> SnapshotPlan {
        let id = format!("{PREFIX}/snapshot/{:012}-{}", state.seq, nonce());
        let mut all: Vec<(u64, Coll, &Oid, &[u8])> = state
            .alarms
            .iter_encoded()
            .map(|(n, o, d)| (n, Coll::Alarm, o, d))
            .chain(
                state
                    .alerts
                    .iter_encoded()
                    .map(|(n, o, d)| (n, Coll::Alert, o, d)),
            )
            .collect();
        all.sort_by_key(|(n, ..)| *n);
        let mut parts: Vec<(String, Vec<u8>, usize)> = Vec::new();
        let mut current = String::new();
        let mut count = 0usize;
        let flush =
            |current: &mut String, count: &mut usize, parts: &mut Vec<(String, Vec<u8>, usize)>| {
                let key = format!("{id}/{:04}.json", parts.len());
                let body = format!("{{\"schema\":1,\"records\":{count}}}\n{current}").into_bytes();
                current.clear();
                parts.push((key, body, std::mem::take(count)));
            };
        for (n, c, oid, doc) in all {
            let mut line = String::new();
            ejson::write_encoded(c, n, oid, doc, &mut line);
            if count > 0 && current.len() + line.len() + 64 > self.config.part_bytes {
                flush(&mut current, &mut count, &mut parts);
            }
            current.push_str(&line);
            current.push('\n');
            count += 1;
        }
        if count > 0 || parts.is_empty() {
            flush(&mut current, &mut count, &mut parts);
        }
        SnapshotPlan {
            seq: state.seq,
            next_n: state.next_n,
            parts,
        }
    }

    /// Write a prepared snapshot and point the head at it. Failure leaves the journal
    /// authoritative; a later snapshot retries.
    pub async fn write_snapshot(&mut self, plan: SnapshotPlan) -> Result<(), StateError> {
        let result = self.write_snapshot_inner(plan).await;
        let counter = if result.is_ok() {
            &self.counters.snapshots
        } else {
            &self.counters.snapshot_failures
        };
        counter.fetch_add(1, Ordering::Relaxed);
        result
    }
    async fn write_snapshot_inner(&mut self, plan: SnapshotPlan) -> Result<(), StateError> {
        let mut set = tokio::task::JoinSet::new();
        let gate = Arc::new(tokio::sync::Semaphore::new(self.config.parallel.max(1)));
        let mut listed = Vec::new();
        for (key, body, records) in plan.parts {
            listed.push((key.clone(), sha256(&body), records));
            let transport = self.transport.clone();
            let gate = gate.clone();
            let deadline = self.config.op_deadline * 4;
            set.spawn(async move {
                let _permit = gate.acquire_owned().await.map_err(|_| Error::Capacity)?;
                match tokio::time::timeout(
                    deadline,
                    transport.put_control(&key, &body, &WriteCondition::Absent),
                )
                .await
                .unwrap_or(Err(Error::Timeout))?
                {
                    200 => Ok(()),
                    status => Err(Error::Status(status)),
                }
            });
        }
        while let Some(joined) = set.join_next().await {
            joined.map_err(|_| Error::Transport).and_then(|r| r)?;
        }
        let mut head = format!(
            "{{\"schema\":1,\"seq\":{},\"next_n\":{},\"parts\":[",
            plan.seq, plan.next_n
        );
        for (i, (key, digest, records)) in listed.iter().enumerate() {
            if i > 0 {
                head.push(',');
            }
            head.push_str(&format!(
                "{{\"key\":\"{key}\",\"sha256\":\"{digest}\",\"records\":{records}}}"
            ));
        }
        head.push_str("]}");
        let condition = match &self.head_etag {
            Some(etag) => WriteCondition::Match(etag.clone()),
            None => WriteCondition::Absent,
        };
        // The write status alone is not trusted: read the head back to learn its validator
        // (or another writer's newer head).
        let _ = self
            .bounded(
                self.transport
                    .put_control(&head_key(), head.as_bytes(), &condition),
            )
            .await;
        let object = self
            .get(&head_key())
            .await?
            .ok_or(StateError::Storage(Error::NotFound))?;
        let seq = OrderedJson::parse(&object.body)
            .ok()
            .and_then(|v| v.get("seq").and_then(OrderedJson::number))
            .ok_or(StateError::Corrupt("head seq"))? as u64;
        self.head_etag = Some(object.etag);
        self.head_seq = seq;
        if object.body == head.as_bytes() {
            Ok(())
        } else {
            Err(StateError::Storage(Error::Status(412)))
        }
    }
}

/// Serialized snapshot parts awaiting upload.
pub struct SnapshotPlan {
    pub seq: u64,
    pub next_n: u64,
    parts: Vec<(String, Vec<u8>, usize)>,
}

enum Reconciled {
    Ours,
    Theirs,
    Voided,
    Unknown(Error),
}
