//! Mutable notice control state is read directly from S3, never the raw disk cache.
use super::{Error, Notice, Text, utc};
use crate::storage::{CatalogTransport, Error as S3Error, WriteCondition};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};
use tokio::sync::Mutex;

pub const KEY: &str = "index/v2/notices/state.json";
const CAP: usize = 8 * 1024 * 1024;
const MAX_RECORDS: usize = 10000;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub schema: u8,
    pub next_id: u64,
    pub records: Vec<Notice>,
    pub operations: BTreeMap<String, u64>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            schema: 1,
            next_id: 1,
            records: Vec::new(),
            operations: BTreeMap::new(),
        }
    }
}
impl State {
    fn validate(&self) -> Result<(), Error> {
        if self.schema != 1
            || self.next_id == 0
            || self.next_id > 9_007_199_254_740_992
            || self.records.len() > MAX_RECORDS
        {
            return Err(Error::Corrupt);
        }
        let mut ids = BTreeSet::new();
        for n in &self.records {
            n.validate().map_err(|_| Error::Corrupt)?;
            if n.id >= self.next_id || !ids.insert(n.id) {
                return Err(Error::Corrupt);
            }
        }
        if self
            .operations
            .iter()
            .any(|(op, id)| !valid_operation(op) || !ids.contains(id))
        {
            return Err(Error::Corrupt);
        }
        Ok(())
    }
}
fn valid_operation(op: &str) -> bool {
    op.len() == 64 && op.bytes().all(|b| b.is_ascii_hexdigit())
}
pub fn source_fingerprint(n: &Notice) -> String {
    let (l, t) = n.source();
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(l, &t.title, &t.body)).expect("serializable notice text")
        )
    )
}
#[derive(Clone)]
pub enum Mutation {
    Add(Value),
    Update {
        id: u64,
        input: Value,
        expected_source: Option<String>,
    },
    Withdraw(u64),
    Fill {
        id: u64,
        source: String,
        texts: BTreeMap<String, Text>,
    },
}
impl Mutation {
    fn apply(&self, state: &mut State, now: i64) -> Result<u64, Error> {
        match self {
            Self::Add(input) => {
                if state.records.len() >= MAX_RECORDS {
                    return Err(Error::Capacity);
                }
                let id = state.next_id;
                let n = Notice::from_input(id, input, now)?;
                state.next_id = state.next_id.checked_add(1).ok_or(Error::Capacity)?;
                state.records.push(n);
                Ok(id)
            }
            Self::Withdraw(id) => {
                let n = state
                    .records
                    .iter_mut()
                    .find(|n| n.id == *id)
                    .ok_or(Error::NotFound)?;
                n.withdrawn_at = Some(now);
                n.updated_at = now;
                n.validate()?;
                Ok(*id)
            }
            Self::Update {
                id,
                input,
                expected_source,
            } => {
                let n = state
                    .records
                    .iter_mut()
                    .find(|n| n.id == *id)
                    .ok_or(Error::NotFound)?;
                if expected_source
                    .as_ref()
                    .is_some_and(|f| *f != source_fingerprint(n))
                {
                    return Err(Error::Conflict);
                }
                let mut v = json!({"texts":n.texts,"linkUrl":n.link_url,"startsAt":utc(n.starts_at),"endsAt":n.ends_at.map(utc)});
                for (k, val) in input.as_object().ok_or(Error::Invalid("notice update"))? {
                    v[k] = val.clone();
                }
                let mut replacement = Notice::from_input(*id, &v, now)?;
                replacement.created_at = n.created_at;
                replacement.withdrawn_at = n.withdrawn_at;
                replacement.validate()?;
                *n = replacement;
                Ok(*id)
            }
            Self::Fill { id, source, texts } => {
                let n = state
                    .records
                    .iter_mut()
                    .find(|n| n.id == *id)
                    .ok_or(Error::NotFound)?;
                if *source != source_fingerprint(n) {
                    return Err(Error::Conflict);
                }
                for (l, t) in texts {
                    n.texts.entry(l.clone()).or_insert_with(|| t.clone());
                }
                n.updated_at = now;
                n.validate()?;
                Ok(*id)
            }
        }
    }
}
struct Versioned {
    state: State,
    etag: Option<String>,
}
// Unknown PUT results remain pending while the canonical precondition is unchanged.
// An identical retry uses exactly the same body/id; only a changed base rules out
// the old CAS. Retained operation identities and monotonic IDs prevent ETag ABA.
#[derive(Clone)]
struct Pending {
    base: Option<String>,
    body: Vec<u8>,
    next: State,
    id: u64,
}
pub struct NoticeStore<T> {
    transport: T,
    verified: Mutex<Option<State>>,
}
impl<T: CatalogTransport> NoticeStore<T> {
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            verified: Mutex::new(None),
        }
    }
    async fn current(&self) -> Result<Versioned, Error> {
        let r = tokio::time::timeout(Duration::from_secs(2), self.transport.get_control(KEY, CAP))
            .await
            .map_err(|_| Error::Unavailable)?;
        let v = match r {
            Err(S3Error::NotFound) => Versioned {
                state: State::default(),
                etag: None,
            },
            Err(_) => return Err(Error::Unavailable),
            Ok(o) => {
                if o.body.len() > CAP {
                    return Err(Error::Corrupt);
                }
                let state: State = serde_json::from_slice(&o.body).map_err(|_| Error::Corrupt)?;
                state.validate()?;
                Versioned {
                    state,
                    etag: Some(o.etag),
                }
            }
        };
        *self.verified.lock().await = Some(v.state.clone());
        Ok(v)
    }
    /// Read failures retain only a fully verified copy. Cold failures are errors.
    pub async fn view(&self) -> Result<State, Error> {
        crate::observability::observe(
            crate::observability::Component::Notice,
            crate::observability::Stage::Lookup,
            async {
                match self.current().await {
                    Ok(v) => Ok(v.state),
                    Err(e) => {
                        crate::observability::event(
                            crate::observability::Component::Notice,
                            crate::observability::Stage::Restore,
                            crate::observability::Cause::Dependency,
                            crate::observability::Action::UseCache,
                            crate::observability::Outcome::Failed,
                            crate::observability::Details::default(),
                        );
                        self.verified.lock().await.clone().ok_or(e)
                    }
                }
            },
        )
        .await
    }
    /// Operator reads/mutations require canonical state; they never mutate fallback memory.
    pub async fn canonical(&self) -> Result<State, Error> {
        Ok(self.current().await?.state)
    }
    pub async fn apply(&self, operation: &str, mutation: Mutation, now: i64) -> Result<u64, Error> {
        crate::observability::observe(
            crate::observability::Component::Notice,
            crate::observability::Stage::Publish,
            async {
                if !valid_operation(operation) {
                    return Err(Error::Invalid("notice operation identity"));
                }
                let mut pending: Option<Pending> = None;
                for _ in 0..8 {
                    let v = self.current().await.map_err(|e| {
                        if pending.is_some() {
                            Error::Uncertain
                        } else {
                            e
                        }
                    })?;
                    if let Some(id) = v.state.operations.get(operation) {
                        return Ok(*id);
                    }
                    if pending.as_ref().is_some_and(|p| p.base != v.etag) {
                        // A strong canonical read observed an intervening write. The old
                        // conditional PUT can no longer commit against its prior base.
                        pending = None;
                    }
                    let attempt = if let Some(p) = &pending {
                        p.clone()
                    } else {
                        let mut next = v.state;
                        let id = mutation.apply(&mut next, now)?;
                        next.operations.insert(operation.to_owned(), id);
                        next.validate()?;
                        let body = serde_json::to_vec(&next).map_err(|_| Error::Corrupt)?;
                        if body.len() > CAP {
                            return Err(Error::Capacity);
                        }
                        Pending {
                            base: v.etag,
                            body,
                            next,
                            id,
                        }
                    };
                    let condition = attempt
                        .base
                        .clone()
                        .map(WriteCondition::Match)
                        .unwrap_or(WriteCondition::Absent);
                    let outcome = tokio::time::timeout(
                        Duration::from_secs(2),
                        self.transport.put_control(KEY, &attempt.body, &condition),
                    )
                    .await;
                    match outcome {
                        Ok(Ok(200..=299)) => {
                            *self.verified.lock().await = Some(attempt.next);
                            return Ok(attempt.id);
                        }
                        Ok(Ok(409 | 412)) => continue,
                        Ok(Ok(status)) if status < 500 => {
                            return Err(if pending.is_some() {
                                Error::Uncertain
                            } else {
                                Error::Unavailable
                            });
                        }
                        _ => {
                            pending = Some(attempt);
                            let readback = self.current().await.map_err(|_| Error::Uncertain)?;
                            if let Some(id) = readback.state.operations.get(operation) {
                                return Ok(*id);
                            }
                            if pending.as_ref().is_some_and(|p| p.base != readback.etag) {
                                pending = None;
                            }
                            // An unchanged readback does not resolve a delayed PUT.
                        }
                    }
                }
                Err(if pending.is_some() {
                    Error::Uncertain
                } else {
                    Error::Conflict
                })
            },
        )
        .await
    }
}
