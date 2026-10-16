//! The alarm worker's store calls, planned in the writer's transaction like the HTTP routes:
//! `lib/pushStore/mongo.js` `removeDuplicateAlarms`, `disableAlarmsByFcm`, `removeAlarms`
//! (with `makeRemoveSelector`) and `controllerPush.updatePushInfo` for the `updatedAt` stamp.
use crate::push::{
    mongoose,
    routes::{self, TxnBackend},
    service::InternalOp,
    store::{Coll, Cond, KEY_FIELDS, Txn},
};
use crate::world::js::{Obj, Val};
use std::collections::BTreeMap;

/// Plan one operation; `false` is a store error (legacy logs it and continues).
pub fn plan(op: &InternalOp, txn: &mut Txn<'_>) -> bool {
    match op {
        InternalOp::DisableAlarmsByFcm(token) => {
            let now = txn.now_ms;
            let query = [("fcmToken".to_owned(), Cond::Eq(Val::Str(token.clone())))];
            for n in txn.find(Coll::Alarm, &query) {
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
        InternalOp::RemoveAlarms {
            n,
            oid,
            selected,
            cutoff_ms,
            filter,
        } => {
            // `removeAlarms(makeRemoveSelector(pushInfo))`, record by record: the selected record
            // only while it is unchanged since selection or changed only by this worker's own
            // disable of an unregistered token (legacy removed such a record the same minute);
            // any other record the filter matches only while it is itself older than the cutoff.
            // A user update in between keeps the record.
            let Ok(query) = mongoose::cast_query(Coll::Alarm, filter) else {
                return false;
            };
            let mut removed = false;
            for m in txn.find(Coll::Alarm, &query) {
                let record = txn.get(Coll::Alarm, m).expect("found record");
                let remove = if m == *n {
                    record.oid == *oid
                        && (record.doc == *selected || same_except_disable(&record.doc, selected))
                } else {
                    matches!(record.doc.get("updatedAt"), Val::Date(ms) if (*ms as i64) < *cutoff_ms)
                };
                if remove {
                    txn.remove(Coll::Alarm, m);
                    removed = true;
                }
            }
            removed
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

/// The fields `disableAlarmsByFcm` sets.
const DISABLE_FIELDS: [&str; 3] = ["enable", "updatedAt", "updatedBy"];

/// `current` is `selected` with only the worker's disable applied (`enable: false`,
/// `updatedBy: 'push'`, a new `updatedAt`); the other fields are equal and in the same order.
fn same_except_disable(current: &Obj, selected: &Obj) -> bool {
    let rest = |o: &Obj| -> Vec<(String, Val)> {
        o.entries()
            .iter()
            .filter(|(k, _)| !DISABLE_FIELDS.contains(&k.as_str()))
            .cloned()
            .collect()
    };
    current.get("enable") == &Val::Bool(false)
        && current.get("updatedBy") == &Val::Str("push".into())
        && rest(current) == rest(selected)
}

/// `makeRemoveSelector(pushInfo)` as a filter.
pub fn remove_filter(info: &Obj) -> Option<Vec<(String, Val)>> {
    routes::remove_selector(&Val::Obj(info.clone()))
}
