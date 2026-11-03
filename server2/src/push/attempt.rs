//! Ephemeral writer-issued ownership for one conditional-alert state update.
//! A receipt permits one conditional undo, never an external send retry.
use super::ejson::DecodeError;
use super::store::{Change, Coll, Oid, State, Txn};
use crate::world::js::{Obj, Val};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
};

const PARENTS: [&str; 2] = ["precipAlerts", "airAlerts"];
const FIELDS: [&[&str]; 2] = [
    &["lastState", "pushTime"],
    &["lastGrade", "lastCode", "pushTime"],
];

#[derive(Clone, Copy)]
pub(crate) struct Channels {
    pub precip: bool,
    pub air: bool,
}
pub(crate) struct Input {
    pub n: u64,
    pub oid: Oid,
    pub selected: Obj,
    pub precip: Val,
    pub air: Val,
    pub channels: Channels,
}
pub(crate) enum Committed {
    Owned(Receipt),
    NotApplied,
    Uncertain,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Restored {
    Applied { fields: usize },
    Superseded,
    Foreign,
    Uncertain,
}
#[derive(Clone)]
struct Leaf {
    parent: usize,
    key: &'static str,
    before: Option<Val>,
    after: Option<Val>,
}
pub(crate) struct Prepared {
    transaction_time: f64,
    n: u64,
    oid: Oid,
    selected: Obj,
    leaves: Vec<Leaf>,
    parents_before: [Option<Val>; 2],
    prunable: u8,
}
struct Lease {
    prepared: Prepared,
    writer: Arc<()>,
    live: AtomicBool,
    restoring: AtomicBool,
    valid: AtomicU8,
    prunable: AtomicU8,
}
/// Sealed and deliberately not Clone: the caller can submit it for restore once.
pub(crate) struct Receipt {
    lease: Arc<Lease>,
}
impl Receipt {
    /// Known commit time is only a construction input for the exact undo patch; restore
    /// writes no new timestamps and never uses it to authorize an external send.
    pub(crate) fn transaction_time(&self) -> f64 {
        self.lease.prepared.transaction_time
    }
    pub(crate) fn claim_restore(&self) -> bool {
        !self.lease.restoring.swap(true, Ordering::AcqRel)
    }
    pub(crate) fn selected(&self) -> &Obj {
        &self.lease.prepared.selected
    }
    pub(crate) fn current(&self) -> bool {
        self.lease.live.load(Ordering::Acquire)
            && !self.lease.restoring.load(Ordering::Acquire)
            && self.lease.valid.load(Ordering::Acquire) == mask(self.lease.prepared.leaves.len())
    }
}
pub(crate) struct Tracker {
    writer: Arc<()>,
    active: BTreeMap<u64, Vec<Weak<Lease>>>,
}
impl Default for Tracker {
    fn default() -> Self {
        Self {
            writer: Arc::new(()),
            active: BTreeMap::new(),
        }
    }
}
fn mask(len: usize) -> u8 {
    (1u8 << len) - 1
}
fn present(obj: &Obj, key: &str) -> Option<Val> {
    obj.entries()
        .iter()
        .find(|(k, _)| k.as_str() == key)
        .map(|(_, v)| v.clone())
}
fn leaf(parent: Option<&Val>, key: &str) -> Option<Val> {
    match parent {
        Some(Val::Obj(o)) => present(o, key),
        _ => None,
    }
}

pub(crate) fn prepare(input: &Input, txn: &mut Txn<'_>) -> Result<Option<Prepared>, DecodeError> {
    let active = [input.channels.precip, input.channels.air];
    if !active.iter().any(|x| *x)
        || (active[0] && !matches!(input.precip, Val::Obj(_)))
        || (active[1] && !matches!(input.air, Val::Obj(_)))
    {
        return Ok(None);
    }
    let Some(before) = txn.get(Coll::Alert, input.n)? else {
        return Ok(None);
    };
    if !super::deliver::ops::update_alert_state(
        txn,
        input.n,
        input.oid,
        &input.selected,
        &input.precip,
        &input.air,
    )? {
        return Ok(None);
    }
    let after = txn
        .get(Coll::Alert, input.n)?
        .ok_or(DecodeError("successful state update lost its record"))?;
    let parents_before = [
        present(&before.doc, PARENTS[0]),
        present(&before.doc, PARENTS[1]),
    ];
    let mut leaves = Vec::new();
    let mut prunable = 0;
    for parent in 0..2 {
        if !active[parent] {
            continue;
        }
        if !matches!(parents_before[parent], Some(Val::Obj(_))) {
            prunable |= 1 << parent;
        }
        let after_parent = present(&after.doc, PARENTS[parent]);
        for &key in FIELDS[parent] {
            let before = leaf(parents_before[parent].as_ref(), key);
            let after = leaf(after_parent.as_ref(), key);
            if before != after {
                leaves.push(Leaf {
                    parent,
                    key,
                    before,
                    after,
                });
            }
        }
    }
    Ok(Some(Prepared {
        transaction_time: txn.now_ms,
        n: input.n,
        oid: input.oid,
        selected: after.doc,
        leaves,
        parents_before,
        prunable,
    }))
}
impl Tracker {
    pub(crate) fn prune(&mut self) {
        self.active.retain(|_, leases| {
            leases.retain(|w| w.strong_count() != 0);
            !leases.is_empty()
        });
    }
    pub(crate) fn revoke_all(&mut self) {
        for leases in self.active.values() {
            for lease in leases.iter().filter_map(Weak::upgrade) {
                lease.live.store(false, Ordering::Release);
                lease.valid.store(0, Ordering::Release);
                lease.prunable.store(0, Ordering::Release);
            }
        }
        self.active.clear();
    }
    /// Called only after known durable success/application (or a successful no-change plan).
    pub(crate) fn issue(&mut self, prepared: Prepared) -> Receipt {
        self.prune();
        let lease = Arc::new(Lease {
            writer: self.writer.clone(),
            live: AtomicBool::new(true),
            restoring: AtomicBool::new(false),
            valid: AtomicU8::new(mask(prepared.leaves.len())),
            prunable: AtomicU8::new(prepared.prunable),
            prepared,
        });
        self.active
            .entry(lease.prepared.n)
            .or_default()
            .push(Arc::downgrade(&lease));
        Receipt { lease }
    }
    /// Observe every individual applied change, including each intermediate replayed entry.
    pub(crate) fn observe(&mut self, state: &State, change: &Change) {
        if change.coll != Coll::Alert {
            return;
        }
        let Some(leases) = self.active.get_mut(&change.n) else {
            return;
        };
        let before = state.coll(Coll::Alert).get(change.n);
        leases.retain(|weak| {
            let Some(lease) = weak.upgrade() else {
                return false;
            };
            let (Ok(Some(before)), Some(after)) = (before.as_ref(), change.record.as_ref()) else {
                lease.live.store(false, Ordering::Release);
                return true;
            };
            if before.oid != lease.prepared.oid || after.oid != lease.prepared.oid {
                lease.live.store(false, Ordering::Release);
                return true;
            }
            for (parent, &key) in PARENTS.iter().enumerate() {
                if present(&before.doc, key) != present(&after.doc, key) {
                    lease.prunable.fetch_and(!(1 << parent), Ordering::AcqRel);
                }
            }
            for (i, owned) in lease.prepared.leaves.iter().enumerate() {
                let before_parent = present(&before.doc, PARENTS[owned.parent]);
                let after_parent = present(&after.doc, PARENTS[owned.parent]);
                if !matches!(before_parent, Some(Val::Obj(_)))
                    || !matches!(after_parent, Some(Val::Obj(_)))
                    || leaf(before_parent.as_ref(), owned.key)
                        != leaf(after_parent.as_ref(), owned.key)
                {
                    lease.valid.fetch_and(!(1 << i), Ordering::AcqRel);
                }
            }
            true
        });
        if leases.is_empty() {
            self.active.remove(&change.n);
        }
    }
    pub(crate) fn restore(
        &self,
        receipt: &Receipt,
        txn: &mut Txn<'_>,
    ) -> Result<Restored, DecodeError> {
        let lease = &receipt.lease;
        if !Arc::ptr_eq(&self.writer, &lease.writer) {
            return Ok(Restored::Foreign);
        }
        if !lease.live.load(Ordering::Acquire) {
            return Ok(Restored::Superseded);
        }
        let Some(mut record) = txn.get(Coll::Alert, lease.prepared.n)? else {
            return Ok(Restored::Superseded);
        };
        if record.oid != lease.prepared.oid {
            return Ok(Restored::Superseded);
        }
        let valid = lease.valid.load(Ordering::Acquire);
        let mut fields = 0;
        for (i, owned) in lease.prepared.leaves.iter().enumerate() {
            if valid & (1 << i) == 0 {
                continue;
            }
            let key = PARENTS[owned.parent];
            let Some(Val::Obj(mut parent)) = present(&record.doc, key) else {
                continue;
            };
            if present(&parent, owned.key) != owned.after {
                continue;
            }
            match &owned.before {
                Some(v) => parent.set(owned.key, v.clone()),
                None => {
                    parent.remove(owned.key);
                }
            }
            record.doc.set(key, Val::Obj(parent));
            fields += 1;
        }
        if fields == 0 && !lease.prepared.leaves.is_empty() {
            return Ok(Restored::Superseded);
        }
        let prunable = lease.prunable.load(Ordering::Acquire);
        for (parent, &key) in PARENTS.iter().enumerate() {
            if prunable & (1 << parent) != 0
                && matches!(record.doc.get(key), Val::Obj(o) if o.entries().is_empty())
            {
                match &lease.prepared.parents_before[parent] {
                    Some(v) => record.doc.set(key, v.clone()),
                    None => {
                        record.doc.remove(key);
                    }
                }
            }
        }
        if fields != 0 {
            txn.put(Coll::Alert, lease.prepared.n, record)?;
        }
        Ok(Restored::Applied { fields })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::push::{ObjectIds, Record, State};

    fn parent(last: f64, time: Option<Val>) -> Val {
        let mut o = Obj::new();
        o.set("lastState", Val::Num(last));
        if let Some(v) = time {
            o.set("pushTime", v);
        }
        Val::Obj(o)
    }
    fn change(record: Option<Record>) -> Change {
        Change {
            coll: Coll::Alert,
            n: 0,
            oid: [7; 12],
            record,
            imported: None,
        }
    }
    fn image(state: &State) -> Record {
        state.coll(Coll::Alert).get(0).unwrap().unwrap()
    }
    fn put(tracker: &mut Tracker, state: &mut State, record: Option<Record>) {
        state
            .apply_observed(&[change(record)], |state, change| {
                tracker.observe(state, change)
            })
            .unwrap();
    }
    fn owned(before_parent: Option<Val>) -> (Tracker, State, Receipt) {
        let mut doc = Obj::new();
        doc.set("fcmToken", Val::Str("old-token".into()));
        if let Some(v) = before_parent {
            doc.set("precipAlerts", v);
        }
        let mut air = Obj::new();
        air.set("lastGrade", Val::Num(1.));
        doc.set("airAlerts", Val::Obj(air.clone()));
        let mut state = State::default();
        state
            .apply(&[change(Some(Record {
                oid: [7; 12],
                doc: doc.clone(),
            }))])
            .unwrap();
        air.set("lastGrade", Val::Num(2.));
        let input = Input {
            n: 0,
            oid: [7; 12],
            selected: doc,
            precip: parent(1., Some(Val::Date(42.))),
            air: Val::Obj(air),
            channels: Channels {
                precip: true,
                air: false,
            },
        };
        let mut ids = ObjectIds::new();
        let mut txn = Txn::new(&state, 42., &mut ids);
        let prepared = prepare(&input, &mut txn).unwrap().unwrap();
        let changes = txn.changes().unwrap();
        let mut tracker = Tracker::default();
        state
            .apply_observed(&changes, |state, change| tracker.observe(state, change))
            .unwrap();
        let receipt = tracker.issue(prepared);
        (tracker, state, receipt)
    }
    fn undo(tracker: &mut Tracker, state: &mut State, receipt: Receipt) -> Restored {
        assert!(receipt.claim_restore());
        let mut ids = ObjectIds::new();
        let mut txn = Txn::new(state, 43., &mut ids);
        let result = tracker.restore(&receipt, &mut txn).unwrap();
        let changes = txn.changes().unwrap();
        state
            .apply_observed(&changes, |state, change| tracker.observe(state, change))
            .unwrap();
        result
    }
    #[test]
    fn undo_preserves_metadata_and_non_sending_observations() {
        let (mut tracker, mut state, receipt) = owned(Some(parent(0., None)));
        let mut record = image(&state);
        record.doc.set("fcmToken", Val::Str("rotated".into()));
        record.doc.set("name", Val::Str("edited".into()));
        let mut air = Obj::new();
        air.set("lastGrade", Val::Num(4.));
        record.doc.set("airAlerts", Val::Obj(air));
        put(&mut tracker, &mut state, Some(record));
        assert!(
            receipt.current(),
            "leaf ownership survives unrelated metadata; full-document send guard is separate"
        );
        assert_eq!(
            undo(&mut tracker, &mut state, receipt),
            Restored::Applied { fields: 2 }
        );
        let record = image(&state);
        assert_eq!(record.doc.get("precipAlerts"), &parent(0., None));
        assert_eq!(record.doc.get("fcmToken"), &Val::Str("rotated".into()));
        assert_eq!(record.doc.get("name"), &Val::Str("edited".into()));
        assert_eq!(record.doc.get("airAlerts").get("lastGrade"), &Val::Num(4.));
    }
    #[test]
    fn a_newer_leaf_does_not_keep_this_attempts_independently_owned_timestamp() {
        let (mut tracker, mut state, receipt) = owned(Some(parent(0., None)));
        let mut record = image(&state);
        record
            .doc
            .set("precipAlerts", parent(9., Some(Val::Date(42.))));
        put(&mut tracker, &mut state, Some(record));
        assert!(!receipt.current());
        assert_eq!(
            undo(&mut tracker, &mut state, receipt),
            Restored::Applied { fields: 1 }
        );
        assert_eq!(image(&state).doc.get("precipAlerts"), &parent(9., None));
    }
    #[test]
    fn intermediate_aba_in_one_apply_batch_never_regains_ownership() {
        let (mut tracker, mut state, receipt) = owned(Some(parent(0., None)));
        let original = image(&state);
        let mut newer = original.clone();
        newer
            .doc
            .set("precipAlerts", parent(9., Some(Val::Date(99.))));
        state
            .apply_observed(
                &[change(Some(newer)), change(Some(original.clone()))],
                |state, change| tracker.observe(state, change),
            )
            .unwrap();
        assert!(!receipt.current());
        assert_eq!(
            undo(&mut tracker, &mut state, receipt),
            Restored::Superseded
        );
        assert_eq!(image(&state), original);
    }
    #[test]
    fn deleted_recreated_and_structural_parent_aba_remain_superseded() {
        for deletion in [true, false] {
            let (mut tracker, mut state, receipt) = owned(Some(parent(0., None)));
            let original = image(&state);
            if deletion {
                put(&mut tracker, &mut state, None);
            } else {
                let mut r = original.clone();
                r.doc.set("precipAlerts", Val::Null);
                put(&mut tracker, &mut state, Some(r));
            }
            put(&mut tracker, &mut state, Some(original.clone()));
            assert!(!receipt.current());
            assert_eq!(
                undo(&mut tracker, &mut state, receipt),
                Restored::Superseded
            );
            assert_eq!(image(&state), original);
        }
    }
    #[test]
    fn exact_missing_and_null_presence_are_different() {
        for old in [None, Some(Val::Null)] {
            let (mut tracker, mut state, receipt) = owned(Some(parent(0., old.clone())));
            assert_eq!(
                undo(&mut tracker, &mut state, receipt),
                Restored::Applied { fields: 2 }
            );
            let r = image(&state);
            let Val::Obj(p) = r.doc.get("precipAlerts") else {
                panic!("parent")
            };
            assert_eq!(present(p, "pushTime"), old);
        }
    }
    #[test]
    fn attempt_created_parent_returns_to_its_exact_absent_null_or_scalar_shape() {
        for old in [None, Some(Val::Null), Some(Val::Num(5.))] {
            let (mut tracker, mut state, receipt) = owned(old.clone());
            assert_eq!(
                undo(&mut tracker, &mut state, receipt),
                Restored::Applied { fields: 2 }
            );
            assert_eq!(present(&image(&state).doc, "precipAlerts"), old);
        }
    }
    #[test]
    fn a_user_parent_edit_revokes_structural_pruning_even_after_value_aba() {
        let (mut tracker, mut state, receipt) = owned(None);
        let original = image(&state);
        let mut edited = original.clone();
        let Val::Obj(mut p) = edited.doc.get("precipAlerts").clone() else {
            panic!("parent")
        };
        p.set("custom", Val::Bool(true));
        edited.doc.set("precipAlerts", Val::Obj(p));
        put(&mut tracker, &mut state, Some(edited));
        put(&mut tracker, &mut state, Some(original));
        assert_eq!(
            undo(&mut tracker, &mut state, receipt),
            Restored::Applied { fields: 2 }
        );
        assert_eq!(
            present(&image(&state).doc, "precipAlerts"),
            Some(Val::Obj(Obj::new())),
            "preserve the newer empty-object representation"
        );
    }
    #[test]
    fn whole_state_replacement_revokes_a_live_strong_receipt() {
        let (mut tracker, mut state, receipt) = owned(Some(parent(0., None)));
        let current = image(&state);
        tracker.revoke_all();
        assert!(!receipt.current());
        assert_eq!(
            undo(&mut tracker, &mut state, receipt),
            Restored::Superseded
        );
        assert_eq!(image(&state), current);
    }
    #[test]
    fn foreign_writer_and_duplicate_restore_claims_are_rejected() {
        let (_tracker, state, receipt) = owned(Some(parent(0., None)));
        let duplicate = Receipt {
            lease: receipt.lease.clone(),
        };
        assert!(receipt.claim_restore());
        assert!(!duplicate.claim_restore());
        assert!(!receipt.current());
        let mut ids = ObjectIds::new();
        let mut txn = Txn::new(&state, 43., &mut ids);
        assert_eq!(
            Tracker::default().restore(&receipt, &mut txn).unwrap(),
            Restored::Foreign
        );
        assert!(txn.changes().unwrap().is_empty());
    }
    #[test]
    fn dropped_receipts_do_not_accumulate_historical_registration_entries() {
        let mut tracker = Tracker::default();
        for n in 0..4096 {
            let receipt = tracker.issue(Prepared {
                transaction_time: 42.,
                n,
                oid: [7; 12],
                selected: Obj::new(),
                leaves: Vec::new(),
                parents_before: [None, None],
                prunable: 0,
            });
            assert!(receipt.current());
            assert_eq!(tracker.active.len(), 1);
            drop(receipt);
        }
        tracker.prune();
        assert!(tracker.active.is_empty());
    }
}
