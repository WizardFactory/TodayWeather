//! Explicit complete-source finalization, separate from merge-only migration. The caller's
//! custody receipts prove format/binding only; they never prove a real host was frozen.
use super::{
    durable::{self, Commit, Durable, StateError},
    ejson, migrate,
    store::{Change, Coll, Oid, Record, State},
};
use crate::{
    gateway::OrderedJson,
    storage::{CatalogTransport, sha256},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_SAFE: u64 = (1u64 << 53) - 1;
pub const MAX_BUNDLE: usize = 8 * 1024 * 1024;
pub const MAX_ROWS: usize = 100_000;
const VERSION: &str = "final-copy-v1";

fn bad(what: &'static str) -> StateError {
    StateError::Corrupt(what)
}
pub fn digest_ok(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn safe(n: u64) -> bool {
    n > 0 && n <= MAX_SAFE
}
fn json<T: Serialize>(value: &T) -> Result<Vec<u8>, StateError> {
    serde_json::to_vec(value).map_err(|_| bad("final copy encoding"))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Predecessor {
    pub seq: u64,
    pub plan: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceMark {
    pub id: String,
    pub generation: u64,
    pub prev: Option<Predecessor>,
    pub export: String,
    pub base: String,
    pub plan: String,
    pub seq: u64,
}
impl SourceMark {
    pub fn validate(&self) -> Result<(), StateError> {
        if !id_ok(&self.id)
            || !safe(self.generation)
            || !safe(self.seq)
            || !digest_ok(&self.export)
            || !digest_ok(&self.base)
            || !digest_ok(&self.plan)
            || self
                .prev
                .as_ref()
                .is_some_and(|p| !safe(p.seq) || p.seq >= self.seq || !digest_ok(&p.plan))
        {
            return Err(bad("final copy marker"));
        }
        Ok(())
    }
    pub fn predecessor(&self) -> Predecessor {
        Predecessor {
            seq: self.seq,
            plan: self.plan.clone(),
        }
    }
    pub fn follows(&self, previous: Option<&Self>) -> Result<(), StateError> {
        self.validate()?;
        match previous {
            Some(old)
                if old.id == self.id
                    && self.generation > old.generation
                    && self.prev.as_ref() == Some(&old.predecessor())
                    && self.seq > old.seq =>
            {
                Ok(())
            }
            None if self.prev.is_none() => Ok(()),
            _ => Err(bad("final copy marker order")),
        }
    }
}

/// Parse the recognized metadata strictly, without changing legacy unmarked header handling.
pub(crate) fn header_source(
    bytes: &[u8],
    seq: u64,
    head: bool,
) -> Result<Option<SourceMark>, StateError> {
    #[derive(Deserialize)]
    struct Header {
        #[serde(default)]
        source: Option<SourceMark>,
    }
    let parsed = OrderedJson::parse(bytes).map_err(|_| bad("final copy header"))?;
    if parsed.get("source").is_none() {
        return Ok(None);
    }
    // Struct deserialization rejects duplicate recognized keys and unknown SourceMark fields.
    let value: Header = serde_json::from_slice(bytes).map_err(|_| bad("final copy marker"))?;
    let mark = value.source.ok_or_else(|| bad("final copy marker"))?;
    mark.validate()?;
    for key in if head {
        &["seq", "next_n"][..]
    } else {
        &["seq", "next_n", "changes"][..]
    } {
        let n = parsed
            .get(key)
            .and_then(OrderedJson::number)
            .ok_or_else(|| bad("final copy header integer"))?;
        if !n.is_finite() || n < 0.0 || n.fract() != 0.0 || n > MAX_SAFE as f64 {
            return Err(bad("final copy header integer"));
        }
    }
    let wire_seq = parsed
        .get("seq")
        .and_then(OrderedJson::number)
        .ok_or_else(|| bad("final copy header sequence"))?;
    if !safe(seq)
        || !wire_seq.is_finite()
        || wire_seq.fract() != 0.0
        || wire_seq != seq as f64
        || wire_seq > MAX_SAFE as f64
        || (head && mark.seq > seq)
        || (!head && mark.seq != seq)
    {
        return Err(bad("final copy marker sequence"));
    }
    Ok(Some(mark))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIdentity {
    pub id: String,
    pub store: String,
    pub database: String,
    pub revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CollectionExport {
    pub collection: String,
    pub complete: bool,
    pub count: u64,
    pub raw: String,
    pub raw_sha256: String,
    pub canonical_sha256: String,
    pub report_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Export {
    pub generation: u64,
    pub exported_at_ms: u64,
    pub collections: Vec<CollectionExport>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub reference: String,
    pub body: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Custody {
    pub process_exit: Evidence,
    pub edit_freeze: Evidence,
    pub settled_cutoff: Evidence,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub bucket: String,
    pub region: String,
    pub state_prefix: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EvidenceBody {
    kind: String,
    observed_at_ms: u64,
    subject_ids: Vec<String>,
    details: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    pub schema: u64,
    pub target: Target,
    pub source: SourceIdentity,
    pub baseline: Export,
    pub final_export: Export,
    pub previous: Option<Predecessor>,
    pub custody: Custody,
}
impl Bundle {
    pub fn parse(bytes: &[u8]) -> Result<Self, StateError> {
        if bytes.len() > MAX_BUNDLE {
            return Err(bad("final copy bundle size"));
        }
        let bundle: Self = serde_json::from_slice(bytes).map_err(|_| bad("final copy bundle"))?;
        bundle.validate()?;
        Ok(bundle)
    }
    pub fn validate(&self) -> Result<(), StateError> {
        let s = &self.source;
        if !id_ok(&self.target.bucket)
            || !id_ok(&self.target.region)
            || self.target.state_prefix != "index/v2/push/state"
        {
            return Err(bad("final copy target"));
        }
        if self.schema != 1
            || !id_ok(&s.id)
            || s.store != "mongo"
            || !id_ok(&s.database)
            || s.revision.len() != 40
            || !s
                .revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !safe(self.baseline.generation)
            || !safe(self.final_export.generation)
            || self.final_export.generation <= self.baseline.generation
            || !safe(self.baseline.exported_at_ms)
            || !safe(self.final_export.exported_at_ms)
            || self.final_export.exported_at_ms < self.baseline.exported_at_ms
            || self
                .previous
                .as_ref()
                .is_some_and(|p| !safe(p.seq) || !digest_ok(&p.plan))
        {
            return Err(bad("final copy source identity"));
        }
        for (kind, e) in [
            ("process-exit", &self.custody.process_exit),
            ("edit-freeze", &self.custody.edit_freeze),
            ("settled-cutoff", &self.custody.settled_cutoff),
        ] {
            if e.reference.is_empty()
                || e.reference.len() > 256
                || e.reference.chars().any(char::is_control)
                || e.body.len() < 16
                || e.body.len() > 16 * 1024
                || !digest_ok(&e.sha256)
                || sha256(e.body.as_bytes()) != e.sha256
                || matches!(e.body.trim(), "true" | "false")
            {
                return Err(bad("final copy custody binding"));
            }
            let body: EvidenceBody =
                serde_json::from_str(&e.body).map_err(|_| bad("final copy custody receipt"))?;
            if body.kind != kind
                || !safe(body.observed_at_ms)
                || body.observed_at_ms > self.final_export.exported_at_ms
                || body.subject_ids.is_empty()
                || body.subject_ids.len() > 128
                || body.subject_ids.iter().any(|id| !id_ok(id))
                || body.details.trim().len() < 16
                || body.details.len() > 8192
            {
                return Err(bad("final copy custody receipt"));
            }
        }
        records(&self.baseline)?;
        records(&self.final_export)?;
        if json(self)?.len() > MAX_BUNDLE {
            return Err(bad("final copy bundle size"));
        }
        Ok(())
    }
    /// Stable logical source scope; source deployment revision is bound by the bundle/plan.
    pub fn source_id(&self) -> Result<String, StateError> {
        Ok(sha256(&json(&(
            "source-scope-v1",
            &self.source.id,
            &self.source.store,
            &self.source.database,
            ["pushes", "alertpushes"],
        ))?))
    }
    pub fn digest(&self) -> Result<String, StateError> {
        Ok(sha256(&json(self)?))
    }
    pub fn export_digest(&self) -> Result<String, StateError> {
        Ok(sha256(&json(&self.final_export)?))
    }
}

type Records = BTreeMap<(Coll, Oid), Record>;
fn records(export: &Export) -> Result<Records, StateError> {
    if export.collections.len() != 2 {
        return Err(bad("final copy collection scope"));
    }
    let mut seen = BTreeSet::new();
    let mut result = Records::new();
    for input in &export.collections {
        let coll = Coll::parse(&input.collection).ok_or_else(|| bad("final copy collection"))?;
        if !seen.insert(coll)
            || !input.complete
            || input.count > MAX_ROWS as u64
            || input.raw.len() > MAX_BUNDLE
            || !digest_ok(&input.raw_sha256)
            || !digest_ok(&input.canonical_sha256)
            || !digest_ok(&input.report_sha256)
            || sha256(input.raw.as_bytes()) != input.raw_sha256
        {
            return Err(bad("final copy complete export"));
        }
        let mut canonical = String::new();
        let mut report = migrate::Report::default();
        migrate::convert(coll, input.raw.as_bytes(), &mut canonical, &mut report);
        if !report.malformed.is_empty()
            || *report.read.get(coll.collection()).unwrap_or(&0) as u64 != input.count
            || *report.converted.get(coll.collection()).unwrap_or(&0) as u64 != input.count
            || sha256(canonical.as_bytes()) != input.canonical_sha256
            || sha256(report.to_json().as_bytes()) != input.report_sha256
        {
            return Err(bad("final copy export counts or digest"));
        }
        for (c, record) in migrate::parse_import(canonical.as_bytes())
            .map_err(|_| bad("final copy canonical records"))?
        {
            if result.insert((c, record.oid), record).is_some() {
                return Err(bad("final copy duplicate identity"));
            }
        }
    }
    if result.len() > MAX_ROWS {
        return Err(bad("final copy record bound"));
    }
    Ok(result)
}
fn record_digest(record: &Record) -> String {
    let mut text = String::new();
    ejson::write_obj(&record.doc, &mut text);
    sha256(text.as_bytes())
}

/// Includes all native state/ownership, not only rows that happen to be changed by the export.
pub fn native_digest(state: &State) -> Result<String, StateError> {
    use sha2::{Digest, Sha256};
    if state.seq > MAX_SAFE
        || state.next_n > MAX_SAFE
        || state.alarms.len() + state.alerts.len() > MAX_ROWS
    {
        return Err(bad("final copy native capacity"));
    }
    if let Some(mark) = &state.source {
        mark.validate()?;
    }
    let mut hash = Sha256::new();
    hash.update(format!("{VERSION}\n{}\n{}\n", state.seq, state.next_n).as_bytes());
    hash.update(json(&state.source)?);
    for coll in [Coll::Alarm, Coll::Alert] {
        hash.update(coll.collection().as_bytes());
        hash.update(b"\n");
        for (n, oid, doc, imported) in state.coll(coll).iter_encoded() {
            let mut line = String::new();
            ejson::write_encoded(coll, n, oid, doc, imported, &mut line);
            hash.update(line.as_bytes());
            hash.update(b"\n");
        }
        let tombstones = state.coll(coll).deleted();
        if tombstones.len() > MAX_ROWS {
            return Err(bad("final copy tombstone capacity"));
        }
        for oid in tombstones {
            hash.update(super::store::oid_hex(&oid).as_bytes());
            hash.update(b"\n");
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counts {
    pub inserted: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub native_created_kept: usize,
    pub native_modified_kept: usize,
    pub native_deleted_kept: usize,
    pub source_absent_delete: usize,
}
#[derive(Clone, Debug)]
pub struct Plan {
    pub mark: SourceMark,
    pub bundle_digest: String,
    pub native_digest: String,
    pub counts: Counts,
    pub changes: Vec<Change>,
    pub next_n: u64,
    pub post_digest: String,
}

/// Pure final-only planner. It never changes the legacy merge-only planner's absence semantics.
pub fn plan(state: &State, bundle: &Bundle) -> Result<Plan, StateError> {
    bundle.validate()?;
    if state.seq >= MAX_SAFE {
        return Err(bad("final copy sequence capacity"));
    }
    let source_id = bundle.source_id()?;
    match &state.source {
        Some(mark)
            if mark.id == source_id
                && bundle.previous.as_ref() == Some(&mark.predecessor())
                && bundle.final_export.generation > mark.generation
                && bundle.baseline.generation == mark.generation
                && sha256(&json(&bundle.baseline)?) == mark.export => {}
        None if bundle.previous.is_none() => {}
        _ => return Err(bad("final copy predecessor or superseded export")),
    }
    let baseline = records(&bundle.baseline)?;
    let final_records = records(&bundle.final_export)?;
    let mut current = BTreeMap::new();
    for coll in [Coll::Alarm, Coll::Alert] {
        for (n, oid, doc, imported) in state.coll(coll).iter_encoded() {
            if current.insert((coll, *oid), (n, doc, imported)).is_some() {
                return Err(bad("final copy native duplicate identity"));
            }
            if imported.is_some() && !baseline.contains_key(&(coll, *oid)) {
                return Err(bad("final copy incomplete ownership baseline"));
            }
        }
    }
    let mut changes = Vec::new();
    let mut counts = Counts::default();
    let mut next_n = state.next_n;
    for (key @ (coll, oid), old) in &baseline {
        if !current.contains_key(key) && !state.coll(*coll).is_deleted(oid) {
            return Err(bad("final copy baseline missing natively"));
        }
        if let Some((_, _, imported)) = current.get(key)
            && *imported != Some(record_digest(old).as_str())
        {
            return Err(bad("final copy baseline ownership"));
        }
    }
    for (key @ (coll, oid), record) in &final_records {
        if state.coll(*coll).is_deleted(oid) {
            counts.native_deleted_kept += 1;
            continue;
        }
        let digest = record_digest(record);
        match current.get(key) {
            None => {
                if next_n >= MAX_SAFE {
                    return Err(bad("final copy record capacity"));
                }
                changes.push(Change {
                    coll: *coll,
                    n: next_n,
                    oid: *oid,
                    record: Some(record.clone()),
                    imported: Some(digest),
                });
                next_n += 1;
                counts.inserted += 1;
            }
            Some((n, bytes, imported)) => {
                let existing = sha256(bytes);
                match baseline.get(key) {
                    None if imported.is_none() && existing == digest => {
                        counts.native_created_kept += 1
                    }
                    None => return Err(bad("final copy native identity collision")),
                    Some(old) if existing == digest => {
                        let _ = old;
                        counts.unchanged += 1;
                    }
                    Some(old) if existing == record_digest(old) => {
                        changes.push(Change {
                            coll: *coll,
                            n: *n,
                            oid: *oid,
                            record: Some(record.clone()),
                            imported: Some(digest),
                        });
                        counts.updated += 1;
                    }
                    Some(old) if digest == record_digest(old) => counts.native_modified_kept += 1,
                    _ => return Err(bad("final copy concurrent source and native edit")),
                }
            }
        }
    }
    for (key @ (coll, oid), old) in &baseline {
        if final_records.contains_key(key) {
            continue;
        }
        if state.coll(*coll).is_deleted(oid) {
            counts.native_deleted_kept += 1;
            continue;
        }
        let Some((n, bytes, imported)) = current.get(key) else {
            return Err(bad("final copy baseline missing natively"));
        };
        let digest = record_digest(old);
        if *imported != Some(digest.as_str()) || sha256(bytes) != digest {
            return Err(bad("final copy absent source row modified natively"));
        }
        changes.push(Change {
            coll: *coll,
            n: *n,
            oid: *oid,
            record: None,
            imported: None,
        });
        counts.source_absent_delete += 1;
    }
    // Native-only rows absent from both source snapshots are preserved, with explicit counts.
    counts.native_created_kept += current
        .keys()
        .filter(|key| !baseline.contains_key(*key) && !final_records.contains_key(*key))
        .count();
    changes.sort_by_key(|c| (c.n, c.coll, c.oid));
    let native = native_digest(state)?;
    let bundle_digest = bundle.digest()?;
    let delta = durable::entry_bytes(state.seq + 1, next_n, "0000000000000000", &changes);
    let plan_digest = sha256(&json(&(
        VERSION,
        &bundle_digest,
        &native,
        next_n,
        &counts,
        sha256(&delta),
    ))?);
    let mark = SourceMark {
        id: source_id,
        generation: bundle.final_export.generation,
        prev: bundle.previous.clone(),
        export: bundle.export_digest()?,
        base: native.clone(),
        plan: plan_digest,
        seq: state.seq + 1,
    };
    mark.follows(state.source.as_ref())?;
    let mut after = state.clone();
    after.apply(&changes)?;
    after.seq = mark.seq;
    after.next_n = next_n;
    after.source = Some(mark.clone());
    let post_digest = native_digest(&after)?;
    Ok(Plan {
        mark,
        bundle_digest,
        native_digest: native,
        counts,
        changes,
        next_n,
        post_digest,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    pub schema: u64,
    pub bundle_digest: String,
    pub mark: SourceMark,
    pub next_n: u64,
    pub post_digest: String,
    pub encoded: Vec<u8>,
}
impl Operation {
    pub fn prepare(plan: &Plan) -> Result<Self, StateError> {
        let body = durable::entry_bytes_with_source(
            plan.mark.seq,
            plan.next_n,
            &durable::nonce(),
            &plan.changes,
            Some(&plan.mark),
        )?;
        Ok(Self {
            schema: 1,
            bundle_digest: plan.bundle_digest.clone(),
            mark: plan.mark.clone(),
            next_n: plan.next_n,
            post_digest: plan.post_digest.clone(),
            encoded: body,
        })
    }
    pub fn parse(bytes: &[u8]) -> Result<Self, StateError> {
        if bytes.len() > MAX_BUNDLE * 4 {
            return Err(bad("final copy operation size"));
        }
        let op: Self = serde_json::from_slice(bytes).map_err(|_| bad("final copy operation"))?;
        op.validate()?;
        Ok(op)
    }
    pub fn validate(&self) -> Result<(), StateError> {
        self.mark.validate()?;
        if self.schema != 1
            || !digest_ok(&self.post_digest)
            || !digest_ok(&self.bundle_digest)
            || self.next_n > MAX_SAFE
            || self.encoded.len() > MAX_BUNDLE
        {
            return Err(bad("final copy operation"));
        }
        let first = self
            .encoded
            .split(|b| *b == b'\n')
            .next()
            .ok_or_else(|| bad("final copy operation header"))?;
        if header_source(first, self.mark.seq, false)? != Some(self.mark.clone()) {
            return Err(bad("final copy operation marker"));
        }
        let header = OrderedJson::parse(first).map_err(|_| bad("final copy operation header"))?;
        if header.get("next_n").and_then(OrderedJson::number) != Some(self.next_n as f64) {
            return Err(bad("final copy operation next_n"));
        }
        Ok(())
    }
    pub fn matches(&self, plan: &Plan) -> Result<(), StateError> {
        self.validate()?;
        if self.mark != plan.mark
            || self.bundle_digest != plan.bundle_digest
            || self.next_n != plan.next_n
            || self.post_digest != plan.post_digest
        {
            return Err(bad("final copy stale plan"));
        }
        let first = self
            .encoded
            .split(|b| *b == b'\n')
            .next()
            .ok_or_else(|| bad("final copy operation header"))?;
        let header = OrderedJson::parse(first).map_err(|_| bad("final copy operation header"))?;
        let nonce = header
            .get("nonce")
            .and_then(OrderedJson::string)
            .ok_or_else(|| bad("final copy operation nonce"))?;
        if nonce.len() != 16
            || !nonce
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(bad("final copy operation nonce"));
        }
        let expected = durable::entry_bytes_with_source(
            plan.mark.seq,
            plan.next_n,
            &nonce,
            &plan.changes,
            Some(&plan.mark),
        )?;
        if expected != self.encoded {
            return Err(bad("final copy altered operation"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Receipt {
    pub status: &'static str,
    pub plan_digest: String,
    pub generation: u64,
    pub journal_seq: u64,
    pub counts: Counts,
    pub snapshot_pending: bool,
    pub operational_freeze_verified: bool,
    pub production_eligible: bool,
}
fn receipt(
    status: &'static str,
    op: &Operation,
    counts: Counts,
    snapshot_pending: bool,
) -> Receipt {
    Receipt {
        status,
        plan_digest: op.mark.plan.clone(),
        generation: op.mark.generation,
        journal_seq: op.mark.seq,
        counts,
        snapshot_pending,
        operational_freeze_verified: false,
        production_eligible: false,
    }
}
async fn predecessor<T: CatalogTransport + Send + Sync + 'static>(
    d: &Durable<T>,
    state: &State,
    bundle: &Bundle,
) -> Result<(), StateError> {
    match (&state.source, &bundle.previous) {
        (Some(mark), Some(prev)) if mark.predecessor() == *prev => {
            let body = d
                .journal_body(prev.seq)
                .await?
                .ok_or_else(|| bad("final copy missing predecessor"))?;
            let first = body
                .split(|b| *b == b'\n')
                .next()
                .ok_or_else(|| bad("final copy predecessor header"))?;
            if header_source(first, prev.seq, false)? != Some(mark.clone()) {
                return Err(bad("final copy predecessor mismatch"));
            }
            Ok(())
        }
        (None, None) => Ok(()),
        _ => Err(bad("final copy erased predecessor")),
    }
}
pub async fn preview<T: CatalogTransport + Send + Sync + 'static>(
    d: &mut Durable<T>,
    bundle: &Bundle,
) -> Result<Plan, StateError> {
    bundle.validate()?;
    let state = d.restore().await?;
    predecessor(d, &state, bundle).await?;
    plan(&state, bundle)
}
pub async fn apply<T: CatalogTransport + Send + Sync + 'static>(
    d: &mut Durable<T>,
    bundle: &Bundle,
    op: &Operation,
) -> Result<Receipt, StateError> {
    bundle.validate()?;
    op.validate()?;
    // Do not let restore clear a pending original attempt in this same owner.
    if d.unsettled() {
        return Ok(receipt("SETTLEMENT_REQUIRED", op, Counts::default(), false));
    }
    if bundle.digest()? != op.bundle_digest {
        return Err(bad("final copy operation bundle"));
    }
    if op.encoded.len() > d.config.entry_bytes || op.encoded.len() > MAX_BUNDLE {
        return Err(bad("final copy entry size"));
    }
    let mut state = d.restore().await?;
    if state.source.as_ref() == Some(&op.mark) {
        if d.journal_body(op.mark.seq).await?.as_deref() != Some(op.encoded.as_slice()) {
            return Err(bad("final copy committed operation mismatch"));
        }
        return Ok(receipt("ALREADY_COMMITTED", op, Counts::default(), false));
    }
    predecessor(d, &state, bundle).await?;
    let planned = plan(&state, bundle)?;
    op.matches(&planned)?;
    match d.commit_final(op.mark.seq, &op.encoded).await {
        Commit::Committed => {
            d.apply_entry(&mut state, op.mark.seq, &op.encoded)?;
            let snapshot = d.prepare_snapshot(&state);
            let pending = d.write_snapshot(snapshot).await.is_err();
            Ok(receipt("COMMITTED", op, planned.counts, pending))
        }
        Commit::Conflict => Ok(receipt("STALE", op, Counts::default(), false)),
        Commit::Rejected | Commit::Voided => {
            Ok(receipt("NOT_APPLIED", op, Counts::default(), false))
        }
        Commit::Failed => Ok(receipt("SETTLEMENT_REQUIRED", op, Counts::default(), false)),
    }
}
/// Settlement never submits the original payload. Its only possible write is the existing void.
pub async fn settle<T: CatalogTransport + Send + Sync + 'static>(
    d: &mut Durable<T>,
    op: &Operation,
) -> Result<Receipt, StateError> {
    op.validate()?;
    if op.encoded.len() > d.config.entry_bytes {
        return Err(bad("final copy entry size"));
    }
    // Never fence an arbitrary future sequence from a user-provided operation descriptor.
    if let Some(body) = d.journal_body(op.mark.seq).await? {
        return Ok(receipt(
            if body == op.encoded {
                "COMMITTED"
            } else {
                "STALE"
            },
            op,
            Counts::default(),
            false,
        ));
    }
    let state = d.restore().await?;
    if state.seq + 1 != op.mark.seq || native_digest(&state)? != op.mark.base {
        return Err(bad("final copy stale settlement"));
    }
    let result = d.settle_final(op.mark.seq, &op.encoded).await;
    Ok(receipt(
        match result {
            Commit::Committed => "COMMITTED",
            Commit::Conflict => "STALE",
            Commit::Voided | Commit::Rejected => "NOT_APPLIED",
            Commit::Failed => "SETTLEMENT_REQUIRED",
        },
        op,
        Counts::default(),
        false,
    ))
}

/// Fresh authoritative restore. A later native write is observed, never rolled back to the plan.
pub async fn verify<T: CatalogTransport + Send + Sync + 'static>(
    d: &mut Durable<T>,
    op: &Operation,
) -> Result<Receipt, StateError> {
    op.validate()?;
    let state = d.restore().await?;
    if state.source.as_ref() != Some(&op.mark)
        || d.journal_body(op.mark.seq).await?.as_deref() != Some(op.encoded.as_slice())
    {
        return Err(bad("final copy verify operation"));
    }
    if state.seq == op.mark.seq {
        if native_digest(&state)? != op.post_digest {
            return Err(bad("final copy verify poststate"));
        }
        Ok(receipt("VERIFIED", op, Counts::default(), false))
    } else {
        Ok(receipt("COMMITTED", op, Counts::default(), false))
    }
}

/// Read-only status for retained CLI custody. An absent key proves no terminal outcome.
pub async fn status<T: CatalogTransport + Send + Sync + 'static>(
    d: &mut Durable<T>,
    op: &Operation,
) -> Result<Receipt, StateError> {
    op.validate()?;
    match d.journal_body(op.mark.seq).await? {
        Some(body) if body == op.encoded => {
            let state = d.restore().await?;
            Ok(receipt(
                if state.source.as_ref() == Some(&op.mark) {
                    "ALREADY_COMMITTED"
                } else {
                    "COMMITTED"
                },
                op,
                Counts::default(),
                false,
            ))
        }
        Some(body) => {
            let first = body
                .split(|b| *b == b'\n')
                .next()
                .ok_or_else(|| bad("final copy status header"))?;
            let header = OrderedJson::parse(first).map_err(|_| bad("final copy status header"))?;
            Ok(receipt(
                if header.get("void") == Some(&OrderedJson::Bool(true)) {
                    "NOT_APPLIED"
                } else {
                    "STALE"
                },
                op,
                Counts::default(),
                false,
            ))
        }
        None => Ok(receipt("SETTLEMENT_REQUIRED", op, Counts::default(), false)),
    }
}
