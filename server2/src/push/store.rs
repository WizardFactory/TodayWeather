//! Server2-owned push registration state: the two legacy collections (`pushes` for alarms,
//! `alertpushes` for alerts) as ordered in-memory records with the MongoDB 3.4 equality-match
//! semantics the legacy store relies on, and a transaction overlay that plans one request's
//! changes without touching the shared state until the change is durable.
use crate::world::js::{Obj, Val};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// A 12-byte MongoDB ObjectId.
pub type Oid = [u8; 12];

pub fn oid_hex(oid: &Oid) -> String {
    oid.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn parse_oid(hex: &str) -> Option<Oid> {
    if hex.len() != 24 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 12];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Coll {
    /// `pushes` (model `push`): scheduled alarms.
    Alarm,
    /// `alertpushes` (model `AlertPush`): conditional alerts.
    Alert,
}
impl Coll {
    pub fn collection(self) -> &'static str {
        match self {
            Coll::Alarm => "pushes",
            Coll::Alert => "alertpushes",
        }
    }
    pub fn model(self) -> &'static str {
        match self {
            Coll::Alarm => "push",
            Coll::Alert => "AlertPush",
        }
    }
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "pushes" => Some(Coll::Alarm),
            "alertpushes" => Some(Coll::Alert),
            _ => None,
        }
    }
}

/// One stored document. `doc` holds every field except `_id`, in stored order; values are the
/// BSON kinds legacy writes (null, boolean, number, string, date, array, embedded document).
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub oid: Oid,
    pub doc: Obj,
}
impl Record {
    pub fn token(&self, field: &str) -> Option<&str> {
        self.doc.get(field).str()
    }
}

/// A query condition after Mongoose casting: equality (`null` also matches a missing field) or
/// `$in` (Mongoose turns an array query value into `$in`).
#[derive(Clone, Debug, PartialEq)]
pub enum Cond {
    Eq(Val),
    In(Vec<Val>),
}

pub const TOKEN_FIELDS: [&str; 2] = ["fcmToken", "registrationId"];
/// The fields the legacy store queries by (`keyQuery`, `tokenQuery`, token renames).
pub const KEY_FIELDS: [&str; 7] = [
    "type",
    "cityIndex",
    "id",
    "fcmToken",
    "registrationId",
    "pushTime",
    "enable",
];

/// A record as stored: `(n, _id, encoded document, import digest)`.
pub type Encoded<'a> = (u64, &'a Oid, &'a [u8], Option<&'a str>);

/// A stored record kept compact: the encoded document plus the fields queries match on.
#[derive(Clone, Debug)]
struct Stored {
    oid: Oid,
    doc: Box<[u8]>,
    keys: Box<[Val; 7]>,
    /// sha256 of the legacy document as last imported (one-time copy only).
    imported: Option<Box<str>>,
}
impl Stored {
    fn new(record: &Record, imported: Option<Box<str>>) -> Self {
        let mut doc = String::new();
        super::ejson::write_obj(&record.doc, &mut doc);
        Self {
            oid: record.oid,
            doc: doc.into_bytes().into_boxed_slice(),
            keys: Box::new(KEY_FIELDS.map(|f| record.doc.get(f).clone())),
            imported,
        }
    }
    fn record(&self) -> Record {
        let parsed = crate::gateway::OrderedJson::parse(&self.doc).expect("stored document");
        let Ok(Val::Obj(doc)) = super::ejson::read_val(&parsed) else {
            unreachable!("stored documents are objects");
        };
        Record { oid: self.oid, doc }
    }
    fn token(&self, i: usize) -> Option<&str> {
        self.keys[3 + i].str()
    }
    /// Query match without decoding when the query names only key fields.
    fn matches(&self, query: &[(String, Cond)]) -> Option<bool> {
        let mut all = true;
        for (key, cond) in query {
            let i = KEY_FIELDS.iter().position(|f| f == key)?;
            all &= matches_value(&self.keys[i], cond);
        }
        Some(all)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Collection {
    records: BTreeMap<u64, Stored>,
    tokens: [HashMap<String, BTreeSet<u64>>; 2],
    /// `_id`s of removed records (the import never re-creates an acknowledged removal).
    deleted: HashSet<Oid>,
}
impl Collection {
    pub fn len(&self) -> usize {
        self.records.len()
    }
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
    pub fn get(&self, n: u64) -> Option<Record> {
        self.records.get(&n).map(Stored::record)
    }
    /// `find({pushTime: time}).$where(enable !== false)`: due alarms in natural order.
    pub fn due(&self, time: f64) -> Vec<(u64, Record)> {
        self.records
            .iter()
            .filter(|(_, r)| {
                matches!(r.keys[5], Val::Num(t) if t == time) && r.keys[6] != Val::Bool(false)
            })
            .map(|(n, r)| (*n, r.record()))
            .collect()
    }
    /// Records in natural (insertion) order, decoded.
    pub fn iter(&self) -> impl Iterator<Item = (u64, Record)> + '_ {
        self.records.iter().map(|(n, r)| (*n, r.record()))
    }
    /// Records in natural order as `(n, _id, encoded document, import digest)` (snapshots,
    /// import planning).
    pub fn iter_encoded(&self) -> impl Iterator<Item = Encoded<'_>> {
        self.records
            .iter()
            .map(|(n, r)| (*n, &r.oid, &r.doc[..], r.imported.as_deref()))
    }
    fn index(&mut self, n: u64, stored: &Stored, add: bool) {
        for i in 0..TOKEN_FIELDS.len() {
            if let Some(t) = stored.token(i) {
                if add {
                    self.tokens[i].entry(t.to_owned()).or_default().insert(n);
                } else if let Some(set) = self.tokens[i].get_mut(t) {
                    set.remove(&n);
                    if set.is_empty() {
                        self.tokens[i].remove(t);
                    }
                }
            }
        }
    }
    /// Store a record; an existing import digest at `n` is kept unless `imported` replaces it.
    pub fn put(&mut self, n: u64, record: Record) {
        self.put_imported(n, record, None);
    }
    pub fn put_imported(&mut self, n: u64, record: Record, imported: Option<&str>) {
        let digest = imported
            .map(Into::into)
            .or_else(|| self.records.get(&n).and_then(|old| old.imported.clone()));
        self.put_stored(n, Stored::new(&record, digest));
    }
    fn put_stored(&mut self, n: u64, stored: Stored) {
        if let Some(old) = self.records.remove(&n) {
            self.index(n, &old, false);
        }
        self.index(n, &stored, true);
        self.records.insert(n, stored);
    }
    pub fn remove(&mut self, n: u64) {
        if let Some(old) = self.records.remove(&n) {
            self.index(n, &old, false);
        }
    }
    /// Record an acknowledged removal of `oid`.
    pub fn mark_deleted(&mut self, oid: Oid) {
        self.deleted.insert(oid);
    }
    pub fn is_deleted(&self, oid: &Oid) -> bool {
        self.deleted.contains(oid)
    }
    /// Removed `_id`s, sorted (snapshots).
    pub fn deleted(&self) -> Vec<Oid> {
        let mut out: Vec<Oid> = self.deleted.iter().copied().collect();
        out.sort_unstable();
        out
    }
    fn matches(&self, n: u64, query: &[(String, Cond)]) -> bool {
        let Some(stored) = self.records.get(&n) else {
            return false;
        };
        stored
            .matches(query)
            .unwrap_or_else(|| matches(&stored.record(), query))
    }
    /// Candidate record numbers for a query: the token index when the query pins a token by
    /// string equality (or `$in` of strings), otherwise every record.
    fn candidates(&self, query: &[(String, Cond)]) -> Option<BTreeSet<u64>> {
        for (key, cond) in query {
            let Some(i) = TOKEN_FIELDS.iter().position(|f| f == key) else {
                continue;
            };
            let values: Vec<&Val> = match cond {
                Cond::Eq(v) => vec![v],
                Cond::In(vs) => vs.iter().collect(),
            };
            if values.iter().all(|v| matches!(v, Val::Str(_))) {
                let mut out = BTreeSet::new();
                for v in values {
                    if let Some(set) = self.tokens[i].get(v.str().unwrap_or_default()) {
                        out.extend(set);
                    }
                }
                return Some(out);
            }
        }
        None
    }
}

/// The complete registration state at one journal sequence.
#[derive(Clone, Debug, Default)]
pub struct State {
    pub alarms: Collection,
    pub alerts: Collection,
    /// Last applied journal sequence (0 before the first entry).
    pub seq: u64,
    /// Next natural-order record number.
    pub next_n: u64,
}
impl State {
    pub fn coll(&self, c: Coll) -> &Collection {
        match c {
            Coll::Alarm => &self.alarms,
            Coll::Alert => &self.alerts,
        }
    }
    pub fn coll_mut(&mut self, c: Coll) -> &mut Collection {
        match c {
            Coll::Alarm => &mut self.alarms,
            Coll::Alert => &mut self.alerts,
        }
    }
    /// Apply final record states (journal replay and acknowledged commits).
    pub fn apply(&mut self, changes: &[Change]) {
        for change in changes {
            match &change.record {
                Some(r) => self.coll_mut(change.coll).put_imported(
                    change.n,
                    r.clone(),
                    change.imported.as_deref(),
                ),
                None => {
                    let coll = self.coll_mut(change.coll);
                    coll.remove(change.n);
                    coll.mark_deleted(change.oid);
                }
            }
            self.next_n = self.next_n.max(change.n + 1);
        }
    }
}

/// The final state of one record after a request (`None`: removed).
#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub coll: Coll,
    pub n: u64,
    /// The record's `_id` (kept for a removal, so a re-run import cannot revive it).
    pub oid: Oid,
    pub record: Option<Record>,
    /// For an imported legacy record: sha256 of its encoded document (`None`: keep the digest).
    pub imported: Option<String>,
}

/// MongoDB equality for one query value against a stored field value.
pub fn matches_value(stored: &Val, cond: &Cond) -> bool {
    match cond {
        Cond::Eq(q) => eq_match(stored, q),
        Cond::In(qs) => qs.iter().any(|q| eq_match(stored, q)),
    }
}
fn eq_match(stored: &Val, q: &Val) -> bool {
    if matches!(q, Val::Null | Val::Undef) {
        return match stored {
            Val::Undef | Val::Null => true,
            Val::Arr(a) => a.iter().any(|e| matches!(e, Val::Null)),
            _ => false,
        };
    }
    bson_eq(stored, q) || matches!(stored, Val::Arr(a) if a.iter().any(|e| bson_eq(e, q)))
}
/// BSON value equality (numbers by value, embedded documents by ordered fields).
pub fn bson_eq(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Null | Val::Undef, Val::Null | Val::Undef) => true,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        (Val::Num(x), Val::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        (Val::Str(x), Val::Str(y)) => x == y,
        (Val::Date(x), Val::Date(y)) => x == y,
        (Val::Arr(x), Val::Arr(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| bson_eq(a, b))
        }
        (Val::Obj(x), Val::Obj(y)) => {
            x.entries().len() == y.entries().len()
                && x.entries()
                    .iter()
                    .zip(y.entries())
                    .all(|((ka, va), (kb, vb))| ka == kb && bson_eq(va, vb))
        }
        _ => false,
    }
}
/// Stored-value identity used for `nModified` (type and value, ordered documents).
pub fn same_doc(a: &Obj, b: &Obj) -> bool {
    bson_eq(&Val::Obj(a.clone()), &Val::Obj(b.clone()))
        && a.entries()
            .iter()
            .zip(b.entries())
            .all(|((_, x), (_, y))| same_kind(x, y))
}
fn same_kind(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Null | Val::Undef, Val::Null | Val::Undef) => true,
        (Val::Arr(x), Val::Arr(y)) => x.iter().zip(y).all(|(a, b)| same_kind(a, b)),
        (Val::Obj(x), Val::Obj(y)) => x
            .entries()
            .iter()
            .zip(y.entries())
            .all(|((_, a), (_, b))| same_kind(a, b)),
        _ => std::mem::discriminant(a) == std::mem::discriminant(b),
    }
}

pub fn matches(record: &Record, query: &[(String, Cond)]) -> bool {
    query.iter().all(|(key, cond)| {
        let stored = if key == "_id" {
            Val::Str(oid_hex(&record.oid))
        } else {
            record.doc.get(key).clone()
        };
        matches_value(&stored, cond)
    })
}

/// Source of new ObjectIds (production: time + random + counter; tests: deterministic).
pub trait OidSource: Send {
    fn next(&mut self, now_ms: f64) -> Oid;
}

/// One request's planned changes over the shared state. Later operations of the same request
/// see earlier ones, as the legacy store saw its own committed writes.
pub struct Txn<'a> {
    base: &'a State,
    changes: BTreeMap<(Coll, u64), Option<Record>>,
    removed: HashMap<(Coll, u64), Oid>,
    next_n: u64,
    pub now_ms: f64,
    ids: &'a mut dyn OidSource,
}
impl<'a> Txn<'a> {
    pub fn new(base: &'a State, now_ms: f64, ids: &'a mut dyn OidSource) -> Self {
        Self {
            base,
            changes: BTreeMap::new(),
            removed: HashMap::new(),
            next_n: base.next_n,
            now_ms,
            ids,
        }
    }
    /// The next natural-order number after this transaction's inserts.
    pub fn next_n(&self) -> u64 {
        self.next_n
    }
    pub fn new_oid(&mut self) -> Oid {
        self.ids.next(self.now_ms)
    }
    pub fn get(&self, c: Coll, n: u64) -> Option<Record> {
        match self.changes.get(&(c, n)) {
            Some(r) => r.clone(),
            None => self.base.coll(c).get(n),
        }
    }
    /// The query key fields ([`KEY_FIELDS`]) of record `n`, without decoding an unchanged record.
    pub fn keys(&self, c: Coll, n: u64) -> Option<[Val; 7]> {
        match self.changes.get(&(c, n)) {
            Some(r) => r.as_ref().map(|r| KEY_FIELDS.map(|f| r.doc.get(f).clone())),
            None => self.base.coll(c).records.get(&n).map(|s| (*s.keys).clone()),
        }
    }
    /// Matching record numbers in natural order.
    pub fn find(&self, c: Coll, query: &[(String, Cond)]) -> Vec<u64> {
        let base = self.base.coll(c);
        let mut candidates: BTreeSet<u64> = match base.candidates(query) {
            Some(set) => set,
            None => base.records.keys().copied().collect(),
        };
        candidates.extend(
            self.changes
                .iter()
                .filter(|((cc, _), r)| *cc == c && r.is_some())
                .map(|((_, n), _)| *n),
        );
        candidates
            .into_iter()
            .filter(|n| match self.changes.get(&(c, *n)) {
                Some(r) => r.as_ref().is_some_and(|r| matches(r, query)),
                None => base.matches(*n, query),
            })
            .collect()
    }
    pub fn put(&mut self, c: Coll, n: u64, record: Record) {
        self.changes.insert((c, n), Some(record));
    }
    pub fn remove(&mut self, c: Coll, n: u64) {
        if let Some(oid) = self.get(c, n).map(|r| r.oid) {
            self.removed.insert((c, n), oid);
        }
        self.changes.insert((c, n), None);
    }
    pub fn insert(&mut self, c: Coll, record: Record) -> u64 {
        let n = self.next_n;
        self.next_n += 1;
        self.changes.insert((c, n), Some(record));
        n
    }
    /// Final record states that differ from the base state.
    pub fn changes(&self) -> Vec<Change> {
        self.changes
            .iter()
            .filter(|((c, n), r)| self.base.coll(*c).get(*n) != **r)
            .map(|((c, n), r)| Change {
                coll: *c,
                n: *n,
                oid: r
                    .as_ref()
                    .map_or_else(|| self.removed[&(*c, *n)], |r| r.oid),
                record: r.clone(),
                imported: None,
            })
            .collect()
    }
}
