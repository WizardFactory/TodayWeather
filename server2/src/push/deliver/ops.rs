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
        InternalOp::UpdateAlertState {
            n,
            oid,
            selected,
            precip,
            air,
        } => {
            let Some(mut record) = txn.get(Coll::Alert, *n) else {
                return false;
            };
            if record.oid != *oid || &record.doc != selected {
                return false;
            }
            let mut fields = Obj::new();
            fields.set("airAlerts", air.clone());
            fields.set("precipAlerts", precip.clone());
            let Ok(set) = mongoose::cast_set(Coll::Alert, &fields, false) else {
                return false;
            };
            mongoose::apply_set(&mut record.doc, &set);
            txn.put(Coll::Alert, *n, record);
            true
        }
        InternalOp::DisableAlertsByFcm { token } => {
            let query = [("fcmToken".to_owned(), Cond::Eq(Val::Str(token.clone())))];
            for n in txn.find(Coll::Alert, &query) {
                let mut record = txn.get(Coll::Alert, n).expect("found record");
                mongoose::apply_set(
                    &mut record.doc,
                    &[
                        ("enable".into(), Val::Bool(false)),
                        ("updatedAt".into(), Val::Date(txn.now_ms)),
                        ("updatedBy".into(), Val::Str("push".into())),
                    ],
                );
                txn.put(Coll::Alert, n, record);
            }
            true
        }
        InternalOp::RemoveDuplicateAlerts => {
            remove_duplicates(txn, Coll::Alert);
            true
        }
        InternalOp::DisableAlarmsByFcm { token, spare } => {
            let now = txn.now_ms;
            let mut spared: Vec<u64> = spare.iter().flat_map(|s| still_stale(txn, s)).collect();
            spared.sort_unstable();
            spared.dedup();
            let query = [("fcmToken".to_owned(), Cond::Eq(Val::Str(token.clone())))];
            // The stale records this minute's cleanup would remove (of every selection with this
            // token) are removed here, in the same journal entry as the disable (legacy disabled,
            // then removed them the same minute), so no restart or later failure can leave one
            // of them enabled, and disabling one never makes another look recently updated.
            for n in &spared {
                txn.remove(Coll::Alarm, *n);
            }
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
            remove_duplicates(txn, Coll::Alarm);
            true
        }
    }
}

/// Groups by (registrationId, cityIndex, id) with a defined `registrationId` and more than one
/// record; the records whose `updatedAt` equals the earlier of the group's dates are removed.
/// Legacy compares only the first two `$addToSet` values (unordered) and throws when a group has
/// a single distinct date; server2 uses the earliest date and skips groups with one date or a
/// missing date (recorded difference).
fn remove_duplicates(txn: &mut Txn<'_>, coll: Coll) {
    // Group on the indexed key fields (no document is decoded); only the members of a group
    // with more than one record are decoded for their dates. This runs every minute.
    let mut groups: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    for n in txn.find(coll, &[]) {
        let keys = txn.keys(coll, n).expect("found record");
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
                let record = txn.get(coll, *n).expect("found record");
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
                txn.remove(coll, n);
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
