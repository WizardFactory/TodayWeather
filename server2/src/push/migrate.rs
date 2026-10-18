//! One-time copy of the legacy push registrations (AK, 2026-10-14: copied before cutover; the
//! legacy database is only read). `convert` turns a `mongoexport` of `pushes` or `alertpushes`
//! (one document per line or `--jsonArray`, relaxed/canonical/legacy Extended JSON) into
//! canonical import lines and reports malformed documents by position and reason only (never
//! values or tokens). `import` merges the records into server2 state by `_id`; re-running it
//! with the same file changes nothing.
use super::durable::{Commit, Durable, StateError};
use super::ejson::{self, read_oid, read_val};
use super::mongoose::{Ty, schema};
use super::store::{Change, Coll, Encoded, Oid, Record, State, oid_hex, parse_oid};
use crate::gateway::OrderedJson;
use crate::storage::{CatalogTransport, sha256};
use crate::world::js::{Obj, Val};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Malformed {
    pub collection: &'static str,
    /// 1-based line (or array element) number in the export file.
    pub position: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub read: BTreeMap<&'static str, usize>,
    pub converted: BTreeMap<&'static str, usize>,
    /// Converted documents that carry fields the model does not declare (kept as stored).
    pub extra_fields: BTreeMap<&'static str, usize>,
    pub malformed: Vec<Malformed>,
}
impl Report {
    /// The report as JSON (counts, positions and reasons only).
    pub fn to_json(&self) -> String {
        let map = |m: &BTreeMap<&'static str, usize>| {
            let mut o = Obj::new();
            for (k, v) in m {
                o.set(k, *v as f64);
            }
            Val::Obj(o)
        };
        let mut o = Obj::new();
        o.set("read", map(&self.read));
        o.set("converted", map(&self.converted));
        o.set("extra_fields", map(&self.extra_fields));
        o.set(
            "malformed",
            Val::Arr(
                self.malformed
                    .iter()
                    .map(|m| {
                        let mut e = Obj::new();
                        e.set("collection", m.collection);
                        e.set("position", m.position as f64);
                        e.set("reason", m.reason.as_str());
                        Val::Obj(e)
                    })
                    .collect(),
            ),
        );
        String::from_utf8(Val::Obj(o).to_json()).expect("JSON text")
    }
}

/// Split an export into documents with their 1-based positions.
fn documents(input: &[u8]) -> Vec<(usize, Result<OrderedJson, ()>)> {
    let text = String::from_utf8_lossy(input);
    let trimmed = text.trim_start();
    if trimmed.starts_with('[') {
        return match OrderedJson::parse(trimmed.as_bytes()) {
            Ok(OrderedJson::Array(items)) => items
                .into_iter()
                .enumerate()
                .map(|(i, v)| (i + 1, Ok(v)))
                .collect(),
            _ => vec![(1, Err(()))],
        };
    }
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| (i + 1, OrderedJson::parse(l.as_bytes()).map_err(|_| ())))
        .collect()
}

fn type_ok(ty: Ty, v: &Val) -> bool {
    if v.is_nullish() {
        return true;
    }
    match (ty, v) {
        (Ty::Str, Val::Str(_)) | (Ty::Num, Val::Num(_)) | (Ty::Bool, Val::Bool(_)) => true,
        (Ty::Date, Val::Date(_)) => true,
        (Ty::Geo, Val::Arr(a)) => a.iter().all(|e| matches!(e, Val::Num(_) | Val::Null)),
        (Ty::Bools, Val::Arr(a)) => a.iter().all(|e| matches!(e, Val::Bool(_) | Val::Null)),
        (Ty::Nested(fields), Val::Obj(o)) => o.entries().iter().all(|(k, v)| {
            fields
                .iter()
                .find(|(f, _)| f == k)
                .is_none_or(|(_, t)| type_ok(*t, v))
        }),
        _ => false,
    }
}

/// Validate one exported document; the record or the reason it is malformed.
fn validate(c: Coll, v: &OrderedJson) -> Result<(Record, bool), String> {
    let OrderedJson::Object(entries) = v else {
        return Err("not a document".into());
    };
    let mut oid = None;
    let mut doc = Obj::new();
    for (k, value) in entries {
        let name = String::from_utf16_lossy(k);
        if name == "_id" {
            oid = Some(read_oid(value).ok_or("_id is not an ObjectId")?);
            continue;
        }
        let value = read_val(value).map_err(|e| format!("field {name}: {}", e.0))?;
        doc.set(&name, value);
    }
    let oid = oid.ok_or("missing _id")?;
    let fields = schema(c);
    let mut extra = false;
    for (name, value) in doc.entries() {
        match fields.iter().find(|(f, _)| f == name) {
            Some((_, ty)) if !type_ok(*ty, value) => {
                return Err(format!("field {name} does not match the model type"));
            }
            Some(_) => (),
            None => extra = true,
        }
    }
    let has_token = ["fcmToken", "registrationId"]
        .iter()
        .any(|f| matches!(doc.get(f), Val::Str(s) if !s.is_empty()));
    if !has_token {
        return Err("no fcmToken or registrationId".into());
    }
    Ok((Record { oid, doc }, extra))
}

/// Convert one collection export into canonical import lines appended to `out`.
pub fn convert(c: Coll, input: &[u8], out: &mut String, report: &mut Report) {
    let name = c.collection();
    let mut seen: HashSet<Oid> = HashSet::new();
    for (position, parsed) in documents(input) {
        *report.read.entry(name).or_default() += 1;
        let result = parsed
            .map_err(|_| "not valid JSON".to_owned())
            .and_then(|v| validate(c, &v));
        match result {
            Ok((record, extra)) => {
                if !seen.insert(record.oid) {
                    report.malformed.push(Malformed {
                        collection: name,
                        position,
                        reason: "duplicate _id".into(),
                    });
                    continue;
                }
                *report.converted.entry(name).or_default() += 1;
                if extra {
                    *report.extra_fields.entry(name).or_default() += 1;
                }
                out.push_str(&format!(
                    "{{\"c\":\"{name}\",\"_id\":\"{}\",\"doc\":",
                    oid_hex(&record.oid)
                ));
                ejson::write_obj(&record.doc, out);
                out.push_str("}\n");
            }
            Err(reason) => report.malformed.push(Malformed {
                collection: name,
                position,
                reason,
            }),
        }
    }
}

/// Read a canonical import file (`convert` output).
pub fn parse_import(input: &[u8]) -> Result<Vec<(Coll, Record)>, String> {
    let text = std::str::from_utf8(input).map_err(|_| "import file is not UTF-8".to_owned())?;
    let mut out = Vec::new();
    for (i, line) in text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let bad = || format!("import line {}", i + 1);
        let v = OrderedJson::parse(line.as_bytes()).map_err(|_| bad())?;
        let c = v
            .get("c")
            .and_then(OrderedJson::string)
            .and_then(|c| Coll::parse(&c))
            .ok_or_else(bad)?;
        let oid = v
            .get("_id")
            .and_then(OrderedJson::string)
            .and_then(|s| parse_oid(&s))
            .ok_or_else(bad)?;
        let Val::Obj(doc) = read_val(v.get("doc").ok_or_else(bad)?).map_err(|_| bad())? else {
            return Err(bad());
        };
        out.push((c, Record { oid, doc }));
    }
    Ok(out)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportCounts {
    pub inserted: usize,
    pub updated: usize,
    pub unchanged: usize,
    /// Records server2 changed after the legacy copy and legacy did not (or legacy is not
    /// newer); left as they are.
    pub kept: usize,
    /// Records server2 removed after an earlier copy; not re-created.
    pub deleted: usize,
}

/// The changes that merge `records` into `state` by `_id`. Each imported record keeps the
/// digest of the legacy document it came from, so a later run can tell who changed it:
/// - absent: inserted; removed in server2 after an earlier copy: stays removed (`deleted`);
/// - identical: `unchanged`;
/// - the legacy document is the one imported before (only server2 changed it): `kept`;
/// - server2 left the imported document as it was (only legacy changed it): `updated`;
/// - both changed: the newer `updatedAt` wins when both have one (`updated`), else `kept`.
pub fn plan_import(
    state: &State,
    records: &[(Coll, Record)],
) -> Result<(Vec<Change>, u64, ImportCounts), StateError> {
    let mut by_oid: HashMap<(Coll, Oid), Encoded<'_>> = HashMap::new();
    for c in [Coll::Alarm, Coll::Alert] {
        for e in state.coll(c).iter_encoded() {
            by_oid.insert((c, *e.1), e);
        }
    }
    let mut next_n = state.next_n;
    let mut counts = ImportCounts::default();
    let mut changes = Vec::new();
    for (c, record) in records {
        ejson::validate_document(&record.doc)?;
        let mut encoded = String::new();
        ejson::write_obj(&record.doc, &mut encoded);
        let digest = sha256(encoded.as_bytes());
        if state.coll(*c).is_deleted(&record.oid) {
            counts.deleted += 1;
            continue;
        }
        let change = |n: u64| Change {
            coll: *c,
            n,
            oid: record.oid,
            record: Some(record.clone()),
            imported: Some(digest.clone()),
        };
        match by_oid.get(&(*c, record.oid)) {
            None => {
                changes.push(change(next_n));
                next_n += 1;
                counts.inserted += 1;
            }
            Some((_, _, existing, _)) if *existing == encoded.as_bytes() => counts.unchanged += 1,
            Some((_, _, _, Some(previous))) if *previous == digest => counts.kept += 1,
            Some((n, _, existing, Some(previous))) if sha256(existing) == *previous => {
                changes.push(change(*n));
                counts.updated += 1;
            }
            Some((n, ..)) => {
                let existing = state
                    .coll(*c)
                    .get(*n)?
                    .ok_or(StateError::Corrupt("indexed record"))?;
                let newer = matches!(
                    (existing.doc.get("updatedAt"), record.doc.get("updatedAt")),
                    (Val::Date(old), Val::Date(new)) if new > old
                );
                if newer {
                    changes.push(change(*n));
                    counts.updated += 1;
                } else {
                    counts.kept += 1;
                }
            }
        }
    }
    Ok((changes, next_n, counts))
}

/// Merge `records` into the durable state: restore, plan, commit in bounded journal entries
/// (re-planning after a concurrent writer's entry), then write a snapshot.
pub async fn import<T: CatalogTransport + Send + Sync + 'static>(
    durable: &mut Durable<T>,
    records: &[(Coll, Record)],
) -> Result<ImportCounts, StateError> {
    let mut state = durable.restore().await?;
    let (mut changes, _, total) = plan_import(&state, records)?;
    let mut conflicts = 0;
    let wrote = !changes.is_empty();
    let mut done = 0usize;
    while done < changes.len() {
        // Largest run of changes that fits one journal entry.
        let limit = durable.config.entry_bytes;
        let (mut size, mut take) = (160usize, 0usize);
        for change in &changes[done..] {
            let mut line = String::new();
            match &change.record {
                Some(r) => ejson::write_record(
                    change.coll,
                    change.n,
                    r,
                    change.imported.as_deref(),
                    &mut line,
                ),
                None => line.push_str("{\"c\":\"alertpushes\",\"n\":0,\"removed\":true}"),
            }
            if take > 0 && size + line.len() + 1 > limit {
                break;
            }
            size += line.len() + 1;
            take += 1;
        }
        let chunk = &changes[done..done + take];
        let chunk_next = chunk
            .iter()
            .map(|c| c.n + 1)
            .max()
            .unwrap_or(0)
            .max(state.next_n);
        let seq = state.seq + 1;
        match durable.commit(seq, chunk, chunk_next).await {
            Commit::Committed => {
                state.apply(chunk)?;
                state.next_n = state.next_n.max(chunk_next);
                state.seq = seq;
                done += take;
            }
            Commit::Conflict | Commit::Voided if conflicts < 16 => {
                // Another writer committed (or our unknown write was voided): plan again.
                conflicts += 1;
                durable.catch_up(&mut state).await?;
                changes = plan_import(&state, records)?.0;
                done = 0;
            }
            _ => return Err(StateError::Storage(crate::storage::Error::Ambiguous)),
        }
    }
    if wrote {
        let plan = durable.prepare_snapshot(&state);
        durable.write_snapshot(plan).await?;
    }
    Ok(total)
}
