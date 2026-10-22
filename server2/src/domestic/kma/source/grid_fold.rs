//! Short/Shortest fold: preserve eager validation/admission, materialize outer Docs once.
use super::super::forecast_cache::{DOCS, add, allocation, reserve};
use super::*;
use crate::storage::Error;

struct Slot {
    coord: Coord,
    publication: f64,
    forecast: f64,
    weight: usize,
}

/// Schema-cast data and bounded slot/index metadata. The data vector has the same
/// element layout and reserve policy as the eager outer-Doc vector, so its capacity
/// also supplies the exact virtual collection-root charge before retention.
#[derive(Default)]
pub(in super::super) struct DeferredGridDocs {
    slots: Vec<Slot>,
    index: std::collections::HashMap<(u64, u64, u64), usize>,
    data: Vec<Doc>,
    total_weight: usize,
    metadata_weight: Option<(usize, usize)>,
}
impl DeferredGridDocs {
    pub(in super::super) fn save(
        &mut self,
        family: Family,
        rows: Vec<Row>,
    ) -> Result<(), crate::storage::Error> {
        debug_assert!(family != Family::Current);
        let Some(first) = rows.first() else {
            return Ok(());
        };
        let coord = Coord {
            mx: first.num("mx"),
            my: first.num("my"),
        };
        let publication = korea_date(&first.text("pubDate")).unwrap_or(f64::NAN);
        let key = |v: f64| {
            if v == 0. { 0 } else { v.to_bits() }
        };
        for row in rows {
            let Some(fcs) = korea_date(&(row.text("date") + &row.text("time"))) else {
                break;
            };
            if publication.is_nan() {
                break;
            }
            let k = (key(coord.mx), key(coord.my), key(fcs));
            // BSON number equality identifies signed zeros and infinities, but NaN
            // never matches an existing coordinate, even with the same bit pattern.
            let indexable = !coord.mx.is_nan() && !coord.my.is_nan();
            let found = indexable.then(|| self.index.get(&k).copied()).flatten();
            let bound = publication
                + if family == Family::Shortest {
                    30. * 60_000.
                } else {
                    0.
                };
            if let Some(i) = found
                && self.slots[i].publication > bound
            {
                continue;
            }
            // Keep eager row/strict validation and every pre-retention collection admission.
            // Only the outer document copying is deferred. The ledger mirrors its exact shape.
            let data =
                super::super::doc::checked_strict(&row.checked_materialized()?, family.schema())?;
            let (metadata, transient_coord) = match self.metadata_weight {
                Some(weights) => weights,
                None => {
                    let empty = Doc::new();
                    let input_coord = coord_doc(coord);
                    let mut skeleton = Doc::new();
                    skeleton.try_set("mCoord", &input_coord)?;
                    skeleton.try_set("fcsDate", &date_val(fcs))?;
                    skeleton.try_set("pubDate", &date_val(publication))?;
                    skeleton.try_set(family.data_key(), &empty.clone().into())?;
                    skeleton.try_set("__v", &Val::Num(0.))?;
                    let stored_coord = skeleton.get("mCoord").and_then(Val::as_doc).unwrap();
                    let original_coord = input_coord.as_doc().unwrap();
                    let weights = (
                        skeleton.heap_weight()? - empty.heap_weight()?,
                        original_coord.heap_weight()? - stored_coord.heap_weight()?,
                    );
                    self.metadata_weight = Some(weights);
                    weights
                }
            };
            let weight = add(metadata, data.heap_weight()?)?;
            let entry_peak = add(weight, if found.is_some() { transient_coord } else { 0 })?;
            if entry_peak > 8 * 1024 * 1024 {
                return Err(Error::Capacity);
            }
            let next_total = add(
                self.total_weight - found.map_or(0, |i| self.slots[i].weight),
                weight,
            )?;
            let n = self.slots.len() + usize::from(found.is_none());
            let root = allocation(
                self.data
                    .capacity()
                    .max(n)
                    .checked_mul(std::mem::size_of::<Doc>())
                    .ok_or(Error::Capacity)?,
            )?;
            if n > DOCS || add(root, next_total)? > 8 * 1024 * 1024 {
                return Err(Error::Capacity);
            }
            self.total_weight = next_total;
            if let Some(i) = found {
                self.slots[i] = Slot {
                    coord,
                    publication,
                    forecast: fcs,
                    weight,
                };
                self.data[i] = data;
            } else {
                reserve(&mut self.data, 1)?;
                reserve(&mut self.slots, 1)?;
                if indexable {
                    self.index.try_reserve(1).map_err(|_| Error::Capacity)?;
                }
                self.data.push(data);
                if indexable {
                    self.index.insert(k, self.slots.len());
                }
                self.slots.push(Slot {
                    coord,
                    publication,
                    forecast: fcs,
                    weight,
                });
            }
        }
        Ok(())
    }
    pub(in super::super) fn finish(
        self,
        family: Family,
        anchor: Option<f64>,
    ) -> Result<Vec<Doc>, crate::storage::Error> {
        use super::super::doc::checked_store;
        let mut docs = GridDocs::default();
        for (slot, data) in self.slots.into_iter().zip(self.data) {
            let Slot {
                coord,
                publication,
                forecast: fcs,
                ..
            } = slot;
            if anchor.is_some_and(|a| fcs <= a - RETENTION_MS) {
                continue;
            }
            let mut d = Doc::new();
            d.try_set("mCoord", &coord_doc(coord))?;
            d.try_set("fcsDate", &date_val(fcs))?;
            d.try_set("pubDate", &date_val(publication))?;
            d.try_set(family.data_key(), &data.into())?;
            d.try_set("__v", &Val::Num(0.))?;
            checked_store(&mut docs.docs, None, d)?;
        }
        Ok(docs.into_answer())
    }
}

#[cfg(test)]
mod structural_contract_tests {
    use super::*;
    use crate::storage::Error;

    fn row(publication: &str, date: &str, time: &str, value: f64) -> Row {
        let mut r = Row::new(SHORT_TEMPLATE);
        for (k, v) in [("pubDate", publication), ("date", date), ("time", time)] {
            r.set(k, Val::str(v));
        }
        r.set("mx", Val::num(60.));
        r.set("my", Val::num(127.));
        r.set("pop", Val::num(value));
        r
    }
    fn reference(family: Family, batches: Vec<Vec<Row>>, anchor: f64) -> Result<Vec<Doc>, Error> {
        let mut d = GridDocs::default();
        for rows in batches {
            d.save_bounded(family, rows)?;
        }
        d.retain(anchor);
        Ok(d.into_answer())
    }
    fn candidate(family: Family, batches: Vec<Vec<Row>>, anchor: f64) -> Result<Vec<Doc>, Error> {
        let mut d = DeferredGridDocs::default();
        for rows in batches {
            d.save(family, rows)?;
        }
        d.finish(family, Some(anchor))
    }
    fn same(family: Family, batches: Vec<Vec<Row>>, anchor: f64) {
        let expected = reference(family, batches.clone(), anchor);
        let actual = candidate(family, batches, anchor);
        match (actual, expected) {
            (Ok(a), Ok(b)) => assert_eq!(a, b),
            (Err(a), Err(b)) => assert_eq!(format!("{a:?}"), format!("{b:?}")),
            (a, b) => panic!("candidate {a:?} != reference {b:?}"),
        }
    }
    #[test]
    fn coordinate_identity_and_unknown_fields_keep_eager_semantics() {
        for family in [Family::Short, Family::Shortest] {
            let batches: Vec<_> = [0., -0., f64::NAN, f64::INFINITY, 60., 61.]
                .into_iter()
                .enumerate()
                .map(|(n, coord)| {
                    let mut r = row("202609240800", "20260924", "0900", n as f64);
                    r.set("mx", Val::Num(coord));
                    r.set("providerExtra", Val::str("x".repeat(4000)));
                    vec![r]
                })
                .collect();
            let anchor = korea_date("202609241000").unwrap();
            let original = reference(family, batches.clone(), anchor).unwrap();
            let selected = candidate(family, batches.clone(), anchor).unwrap();
            // NaN is not reflexively equal; Debug retains ordered fields and the
            // distinct NaN/infinity values, unlike JSON's null conversion.
            assert_eq!(format!("{selected:?}"), format!("{original:?}"));
            let mut d = DeferredGridDocs::default();
            for rows in batches {
                d.save(family, rows).unwrap();
            }
            assert!(d.data.iter().all(|v| !v.has("providerExtra")));
        }
    }
    #[test]
    fn document_count_boundary_is_checked_before_retention() {
        let mut original = GridDocs::default();
        let mut deferred = DeferredGridDocs::default();
        for n in 0..=DOCS {
            let mut r = Row::new(&[]);
            for (k, v) in [
                ("pubDate", "202609240800"),
                ("date", "20260924"),
                ("time", "0900"),
            ] {
                r.set(k, Val::str(v));
            }
            r.set("mx", Val::num(n as f64));
            r.set("my", Val::num(127.));
            let a = original.save_bounded(Family::Short, vec![r.clone()]);
            let b = deferred.save(Family::Short, vec![r]);
            assert_eq!(a.is_ok(), b.is_ok(), "key {n}");
            if n == DOCS {
                assert!(matches!(a, Err(Error::Capacity)));
                assert!(matches!(b, Err(Error::Capacity)));
            } else {
                a.unwrap();
                b.unwrap();
            }
        }
        assert_eq!(original.docs.len(), DOCS);
        assert_eq!(deferred.index.len(), DOCS);
        assert_eq!(deferred.slots.len(), DOCS);
        assert_eq!(deferred.data.len(), DOCS);
    }
    #[test]
    fn structural_contract_ordered_revisions_fences_and_retention() {
        let anchor = korea_date("202609241000").unwrap();
        let mut seed = 9u64;
        for family in [Family::Short, Family::Shortest] {
            for _ in 0..80 {
                let mut batches = Vec::new();
                for n in 0..24 {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let publication = [
                        "202609240800",
                        "202609240830",
                        "202609240900",
                        "202609240930",
                    ][(seed >> 32) as usize % 4];
                    let time = ["0900", "1200", "1500", "1800"][(seed >> 16) as usize % 4];
                    batches.push(vec![
                        row(publication, "20260924", time, n as f64),
                        row(publication, "20260901", time, n as f64),
                    ]);
                }
                same(family, batches, anchor);
            }
        }
    }
    #[test]
    fn structural_contract_bad_date_stops_the_batch() {
        same(
            Family::Short,
            vec![vec![
                row("202609240800", "20260924", "0900", 1.),
                row("202609240800", "bad", "date", 2.),
                row("202609240800", "20260924", "1200", 3.),
            ]],
            korea_date("202609241000").unwrap(),
        );
    }
    #[test]
    fn structural_contract_superseded_row_must_still_fail_capacity() {
        let mut bad = row("202609240800", "20260924", "0900", 1.);
        for n in 0..33 {
            bad.set(&format!("extra{n}"), Val::num(n as f64));
        }
        same(
            Family::Short,
            vec![vec![bad], vec![row("202609240900", "20260924", "0900", 2.)]],
            korea_date("202609241000").unwrap(),
        );
    }
}

#[cfg(test)]
mod checked_deferred_contract_tests {
    use super::*;
    fn rows(publication: &str, large: bool) -> Vec<Row> {
        (0..24)
            .map(|h| {
                let mut row = Row::new(SHORT_TEMPLATE);
                row.set("pubDate", Val::str(publication));
                row.set("date", Val::str("20260925"));
                row.set("time", Val::str(format!("{h:02}00")));
                row.set("mx", Val::num(60.));
                row.set("my", Val::num(127.));
                row.set("r06", Val::num(0.5));
                if large {
                    let text = format!("1{}mm 미만", " ".repeat(400 * 1024));
                    assert!(precip::parse(&V::s(&text), "mm", None).is_some());
                    row.set("r06Text", Val::str(text));
                }
                row
            })
            .collect()
    }
    #[test]
    fn checked_deferred_rejects_pre_retention_byte_overflow_even_when_replaced() {
        let batches = vec![rows("202609240800", true), rows("202609240900", false)];
        let mut original = GridDocs::default();
        let mut deferred = DeferredGridDocs::default();
        for batch in batches {
            let a = original.save_bounded(Family::Short, batch.clone());
            let b = deferred.save(Family::Short, batch);
            assert_eq!(a.is_ok(), b.is_ok());
            if a.is_err() {
                assert!(matches!(a, Err(crate::storage::Error::Capacity)));
                assert!(matches!(b, Err(crate::storage::Error::Capacity)));
                return;
            }
        }
        panic!("the eager collection bound must reject the large history");
    }
    #[test]
    fn checked_deferred_ledger_matches_actual_doc_weights_after_replacements() {
        for family in [Family::Short, Family::Shortest] {
            let mut original = GridDocs::default();
            let mut deferred = DeferredGridDocs::default();
            for n in 0..16 {
                let mut batch = rows(
                    if n % 3 == 0 {
                        "202609240800"
                    } else {
                        "202609240900"
                    },
                    false,
                );
                for (i, row) in batch.iter_mut().enumerate() {
                    row.set("r06Text", Val::str("x".repeat((i * 17 + n * 23) % 2000)));
                    row.set("r06", Val::num(n as f64));
                }
                original.save_bounded(family, batch.clone()).unwrap();
                deferred.save(family, batch).unwrap();
                assert_eq!(original.docs.len(), deferred.slots.len());
                for (i, doc) in original.docs.iter().enumerate() {
                    assert_eq!(
                        doc.heap_weight().unwrap(),
                        deferred.slots[i].weight,
                        "{family:?} row {i} revision {n}"
                    );
                }
            }
            assert_eq!(
                original.into_answer(),
                deferred.finish(family, None).unwrap()
            );
        }
    }
}
