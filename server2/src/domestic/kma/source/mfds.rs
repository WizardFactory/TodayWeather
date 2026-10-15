//! S15b-3b: the MFDS food-poisoning collection and its reader.
//!
//! Legacy references (master `7ca6f002`, `lib/foodPoisoning.js`): `collect` (L141) saves every
//! `parse` row with `updateOne({_id, publication: {$lte}}, {$set: row}, {upsert: true})` (L169):
//! a stored row with a newer publication stays (the upsert's duplicate `_id` error is ignored).
//! `models/modelFoodPoisoning.js` expires a row at the end of its KST date (`expireAt` TTL).
//! Reader: `append` (L178) `find({sd, sgg: {$in: [sgg, '']}, date: {$gte: start, $lte: end}})`
//! with `lean()`; its row checks run in the assembly (`kma::air`).
use super::doc::{Doc, Val};
use crate::domestic::mfds::RiskRow;
use crate::gateway::OrderedJson;

/// The `mfds_food_poisoning` collection in natural order.
#[derive(Debug, Clone, Default)]
pub struct FoodPoisoning {
    docs: Vec<Doc>,
}
impl FoodPoisoning {
    pub fn len(&self) -> usize {
        self.docs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Array(self.docs.iter().map(Doc::json).collect())
    }
    /// One collection's rows (`parse` output) in order.
    pub fn apply(&mut self, rows: &[RiskRow]) {
        for row in rows {
            let set = [
                ("_id", Val::str(&row.id)),
                ("sd", Val::str(&row.sd)),
                ("sgg", Val::str(&row.sgg)),
                ("date", Val::str(&row.date)),
                ("risk", Val::num(row.risk)),
                ("value", Val::num(row.value)),
                ("grade", Val::num(row.grade)),
                ("baseDate", Val::str(&row.base_date)),
                ("publication", Val::str(&row.publication)),
                ("fetchedAt", Val::Date(row.fetched_at)),
                ("expireAt", Val::Date(row.expire_at)),
            ];
            let found = self
                .docs
                .iter()
                .position(|d| d.get("_id").and_then(Val::as_str) == Some(row.id.as_str()));
            let i = match found {
                Some(i) => {
                    let newer = self.docs[i]
                        .get("publication")
                        .and_then(Val::as_str)
                        .is_some_and(|p| p > row.publication.as_str());
                    if newer {
                        // The filter misses and the upsert's insert is a duplicate `_id`.
                        continue;
                    }
                    i
                }
                None => {
                    self.docs.push(
                        Doc::new()
                            .with("_id", Val::str(&row.id))
                            .with("__v", Val::num(0.)),
                    );
                    self.docs.len() - 1
                }
            };
            // An explicit `$set` applies its fields in order.
            for (k, v) in set {
                self.docs[i].set(k, v);
            }
        }
    }
    /// The TTL monitor: rows whose `expireAt` passed are removed.
    pub fn expire(&mut self, now_ms: f64) {
        self.docs
            .retain(|d| !matches!(d.get("expireAt"), Some(Val::Date(ms)) if *ms <= now_ms));
    }
    /// `find({sd, sgg: {$in: [sgg, '']}, date: {$gte: start, $lte: end}})`, natural order.
    pub fn find(&self, sd: &str, sgg: &str, start: &str, end: &str) -> OrderedJson {
        OrderedJson::Array(
            self.docs
                .iter()
                .filter(|d| {
                    let s = |k| d.get(k).and_then(Val::as_str);
                    s("sd") == Some(sd)
                        && (s("sgg") == Some(sgg) || s("sgg") == Some(""))
                        && s("date").is_some_and(|x| x >= start && x <= end)
                })
                .map(Doc::json)
                .collect(),
        )
    }
}
