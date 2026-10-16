//! The alarm worker's store calls, planned in the writer's transaction like the HTTP routes:
//! `lib/pushStore/mongo.js` `removeDuplicateAlarms`, `disableAlarmsByFcm`, `removeAlarms`
//! (with `makeRemoveSelector`) and `controllerPush.updatePushInfo` for the `updatedAt` stamp.
use crate::push::{
    mongoose,
    routes::{self, TxnBackend},
    service::{InternalOp, StaleSelection},
    store::{Coll, Cond, KEY_FIELDS, Txn},
};
use crate::world::js::{Obj, Val};
use std::collections::BTreeMap;

/// Plan one operation; `false` is a store error (legacy logs it and continues).
pub fn plan(op: &InternalOp, txn: &mut Txn<'_>) -> bool {
    match op {
        InternalOp::DisableAlarmsByFcm { token, spare } => {
            let now = txn.now_ms;
            let spared = spare
                .as_ref()
                .map(|s| still_stale(txn, s))
                .unwrap_or_default();
            let query = [("fcmToken".to_owned(), Cond::Eq(Val::Str(token.clone())))];
            for n in txn.find(Coll::Alarm, &query) {
                if spared.contains(&n) {
                    continue;
                }
                let mut record = txn.get(Coll::Alarm, n).expect("found record");
                mongoose::apply_set(
                    &mut record.doc,
                    &[
                        ("enable".into(), Val::Bool(false)),
                        ("updatedAt".into(), Val::Date(now)),
                        ("updatedBy".into(), Val::Str("push".into())),
                    ],
                );
                txn.put(Coll::Alarm, n, record);
            }
            true
        }
        InternalOp::RemoveAlarms(stale) => {
            let numbers = still_stale(txn, stale);
            for m in &numbers {
                txn.remove(Coll::Alarm, *m);
            }
            !numbers.is_empty()
        }
        InternalOp::StampAlarm { n, oid, info } => {
            let unstamped = txn
                .get(Coll::Alarm, *n)
                .is_some_and(|r| r.oid == *oid && r.doc.get("updatedAt").is_nullish());
            if !unstamped {
                return false;
            }
            let mut info = info.clone();
            matches!(
                routes::update_push_info(&mut info, &mut TxnBackend { txn }),
                Ok(Ok(_))
            )
        }
        InternalOp::RemoveDuplicateAlarms => {
            remove_duplicates(txn);
            true
        }
    }
}

/// Groups by (registrationId, cityIndex, id) with a defined `registrationId` and more than one
/// record; the records whose `updatedAt` equals the earlier of the group's dates are removed.
/// Legacy compares only the first two `$addToSet` values (unordered) and throws when a group has
/// a single distinct date; server2 uses the earliest date and skips groups with one date or a
/// missing date (recorded difference).
fn remove_duplicates(txn: &mut Txn<'_>) {
    // Group on the indexed key fields (no document is decoded); only the members of a group
    // with more than one record are decoded for their dates. This runs every minute.
    let mut groups: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    for n in txn.find(Coll::Alarm, &[]) {
        let keys = txn.keys(Coll::Alarm, n).expect("found record");
        let field = |name: &str| {
            keys[KEY_FIELDS
                .iter()
                .position(|f| *f == name)
                .expect("key field")]
            .clone()
        };
        let reg = field("registrationId");
        if reg.is_nullish() {
            continue;
        }
        let key = Val::Arr(vec![reg, field("cityIndex"), field("id")]).to_json();
        groups
            .entry(String::from_utf8_lossy(&key).into_owned())
            .or_default()
            .push(n);
    }
    for numbers in groups.values().filter(|g| g.len() > 1) {
        let members: Vec<(u64, Option<f64>)> = numbers
            .iter()
            .map(|n| {
                let record = txn.get(Coll::Alarm, *n).expect("found record");
                let date = match record.doc.get("updatedAt") {
                    Val::Date(ms) => Some(*ms),
                    _ => None,
                };
                (*n, date)
            })
            .collect();
        if members.iter().any(|(_, d)| d.is_none()) {
            continue;
        }
        let mut dates: Vec<f64> = members.iter().filter_map(|(_, d)| *d).collect();
        dates.sort_by(f64::total_cmp);
        dates.dedup();
        if dates.len() < 2 {
            continue;
        }
        for (n, d) in members {
            if d == Some(dates[0]) {
                txn.remove(Coll::Alarm, n);
            }
        }
    }
}

/// The records of a stale selection's filter that are still stale (see [`StaleSelection`]).
fn still_stale(txn: &Txn<'_>, stale: &StaleSelection) -> Vec<u64> {
    let Ok(query) = mongoose::cast_query(Coll::Alarm, &stale.filter) else {
        return Vec::new();
    };
    txn.find(Coll::Alarm, &query)
        .into_iter()
        .filter(|m| {
            let record = txn.get(Coll::Alarm, *m).expect("found record");
            if *m == stale.n {
                record.oid == stale.oid && record.doc == stale.selected
            } else {
                matches!(record.doc.get("updatedAt"), Val::Date(ms) if (*ms as i64) < stale.cutoff_ms)
            }
        })
        .collect()
}

/// `makeRemoveSelector(pushInfo)` as a filter.
pub fn remove_filter(info: &Obj) -> Option<Vec<(String, Val)>> {
    routes::remove_selector(&Val::Obj(info.clone()))
}
