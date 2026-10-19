//! `kma.town.mid.{forecast,land,temp}` documents rebuilt from `mid-fcst`, `mid-land-fcst` and
//! `mid-ta` acquisitions with the legacy collector at master: `organizeForecastData`,
//! `midForecastPolicy.parse`, `_emitOrganizedData`, `kmaTownMid.saveMid` with
//! `saveOnlyLastOne` (one document per region) and the `checkPubDate` skip of a stored
//! publication. Regions legacy never collects have no document.
use super::doc::{Doc, Val, strict};
use super::grid::korea_date;
use super::items::Item;
use crate::domestic::kma::MidModel;
use crate::domestic::kma::precip::js_ws;
use crate::world::js::string_to_number;
use std::sync::OnceLock;

/// `collectTownForecast` `listPointNumber` (getMidFcst `stnId`).
pub const POINT_NUMBERS: [&str; 10] = [
    "105", "108", "109", "131", "133", "146", "156", "143", "159", "184",
];
/// `collectTownForecast` `listAreaCode` (getMidLandFcst `regId`).
pub const LAND_CODES: [&str; 10] = [
    "11B00000", "11D10000", "11D20000", "11C20000", "11C10000", "11F20000", "11F10000", "11H10000",
    "11H20000", "11G00000",
];
const LAND_ZONES_CSV: &str = include_str!("data/kma_forecast_land_zones.csv");
/// `KmaForecastZoneController.landZoneIds()`.
pub fn land_zone_ids() -> &'static [String] {
    static IDS: OnceLock<Vec<String>> = OnceLock::new();
    IDS.get_or_init(|| {
        LAND_ZONES_CSV
            .split('\n')
            .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("REG_ID,"))
            .filter_map(|l| l.split(',').next())
            .filter(|id| {
                id.len() == 8
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
            })
            .map(str::to_owned)
            .collect()
    })
}
fn land_fields() -> Vec<String> {
    let mut out = Vec::new();
    for d in 3..=10 {
        let halves: &[&str] = if d <= 7 { &["Am", "Pm"] } else { &[""] };
        for h in halves {
            out.push(format!("wf{d}{h}"));
            out.push(format!("rnSt{d}{h}"));
        }
    }
    out
}
fn temp_fields() -> Vec<String> {
    (3..=10)
        .flat_map(|d| [format!("taMin{d}"), format!("taMax{d}")])
        .collect()
}
fn schema(model: MidModel) -> Vec<String> {
    let mut s: Vec<String> = match model {
        MidModel::Forecast => vec!["date", "time", "pointNumber", "cnt", "wfsv"],
        MidModel::Land | MidModel::Temp => vec!["regId", "date", "time"],
    }
    .into_iter()
    .map(str::to_owned)
    .collect();
    match model {
        MidModel::Land => s.extend(land_fields()),
        MidModel::Temp => s.extend(temp_fields()),
        MidModel::Forecast => {}
    }
    s
}
/// `midForecastPolicy` weather texts.
fn weather(v: &str) -> bool {
    const TEXTS: [&str; 24] = [
        "맑음",
        "구름조금",
        "구름많음",
        "흐림",
        "흐리고 한때 비",
        "흐리고 비",
        "흐리고 소나기",
        "구름적고 한때 비",
        "구름적고 비",
        "구름많고 한때 비",
        "구름많고 비",
        "구름많고 소나기",
        "흐리고 한때 눈",
        "흐리고 눈",
        "구름적고 한때 눈",
        "구름적고 눈",
        "구름많고 한때 눈",
        "구름많고 눈",
        "구름적고 비/눈",
        "구름적고 눈/비",
        "구름많고 비/눈",
        "구름많고 눈/비",
        "흐리고 비/눈",
        "흐리고 눈/비",
    ];
    TEXTS.contains(&v.trim_matches(js_ws))
}
/// `exports.number(value)` for xml2js text.
fn policy_number(v: &str, bounded: bool) -> f64 {
    let t = v.trim_matches(js_ws);
    let u = t.strip_prefix(['+', '-']).unwrap_or(t);
    let ok = match u.split_once('.') {
        Some((a, b)) => {
            (!a.is_empty()
                && a.bytes().all(|c| c.is_ascii_digit())
                && b.bytes().all(|c| c.is_ascii_digit()))
                || (a.is_empty() && !b.is_empty() && b.bytes().all(|c| c.is_ascii_digit()))
        }
        None => !u.is_empty() && u.bytes().all(|c| c.is_ascii_digit()),
    };
    if ok {
        if bounded {
            t.parse::<f64>().unwrap_or(f64::NAN)
        } else {
            string_to_number(v)
        }
    } else {
        f64::NAN
    }
}
/// `exports.publication(value)`: a 06:00 or 18:00 KST publication.
fn publication_ok(p: &str) -> bool {
    p.len() == 12
        && p.bytes().all(|b| b.is_ascii_digit())
        && (p.ends_with("0600") || p.ends_with("1800"))
        && korea_date(p).is_some_and(f64::is_finite)
}
/// Small per-acquisition policy for the cache organizer. Fixed schema construction is
/// independent of provider input; provider-sized canonical strings and Doc growth are charged
/// before their fallible copies. The public compatibility organizer uses no policy.
#[derive(Default)]
struct BuildPolicy {
    limit: Option<usize>,
    used: usize,
    capacity: bool,
    copied_texts: usize,
}
impl BuildPolicy {
    fn take(&mut self, n: usize) -> Option<()> {
        let Some(next) = self.used.checked_add(n) else {
            self.capacity = true;
            return None;
        };
        if self.limit.is_some_and(|limit| next > limit) {
            self.capacity = true;
            return None;
        }
        self.used = next;
        Some(())
    }
    fn put_text(&mut self, doc: &mut Doc, key: &str, text: &str) -> Option<()> {
        if self.limit.is_none() {
            doc.set(key, Val::str(text));
            return Some(());
        }
        use super::forecast_cache::{add, allocation};
        // Canonical stand-ins expand each four-byte scalar to two four-byte scalars.
        // Prepared value and setter copy coexist; key and potential old/new field backing
        // are charged separately before either canonicalization or Doc mutation.
        let result = (|| {
            let length = text.chars().try_fold(0usize, |n, c| {
                add(
                    n,
                    if c as u32 >= 0x10F800 {
                        8
                    } else {
                        c.len_utf8()
                    },
                )
            })?;
            let strings = allocation(length)?
                .checked_mul(2)
                .ok_or(crate::storage::Error::Capacity)?;
            let fields = allocation(std::mem::size_of::<(String, Val)>() * 2)?;
            add(add(strings, allocation(key.len())?)?, fields)
        })();
        let Ok(charge) = result else {
            self.capacity = true;
            return None;
        };
        self.take(charge)?;
        let result = Val::checked_str(text).and_then(|value| doc.try_set(key, &value));
        if result.is_err() {
            self.capacity = true;
            return None;
        }
        self.copied_texts += 1;
        Some(())
    }
    fn put_number(&mut self, doc: &mut Doc, key: &str, number: f64) -> Option<()> {
        if self.limit.is_none() {
            doc.set(key, Val::Num(number));
            return Some(());
        }
        let charge = super::forecast_cache::allocation(key.len()).and_then(|key| {
            super::forecast_cache::add(
                key,
                super::forecast_cache::allocation(std::mem::size_of::<(String, Val)>() * 2)?,
            )
        });
        let Ok(charge) = charge else {
            self.capacity = true;
            return None;
        };
        self.take(charge)?;
        if doc.try_set(key, &Val::Num(number)).is_err() {
            self.capacity = true;
            return None;
        }
        Some(())
    }
}
/// The organized first record of one acquisition (`newData[0]`), or None when legacy fails it.
pub fn organize(model: MidModel, items: &[Item], publication: &str, code: &str) -> Option<Doc> {
    organize_with(model, items, publication, code, &mut BuildPolicy::default())
}
#[allow(clippy::ptr_arg)] // The backing capacity belongs to the admitted input plan.
pub(super) fn organize_bounded(
    model: MidModel,
    items: &Vec<Item>,
    publication: &str,
    code: &str,
) -> Result<Option<Doc>, crate::storage::Error> {
    use super::forecast_cache::{add, allocation, vector};
    // JSON nodes have been dropped; converted input backing remains live beside output.
    let mut input = vector(items)?;
    for item in items {
        input = add(input, vector(&item.0)?)?;
        for (key, value) in &item.0 {
            input = add(
                input,
                add(allocation(key.capacity())?, allocation(value.capacity())?)?,
            )?;
        }
    }
    let mut policy = BuildPolicy {
        limit: Some(super::forecast_cache::PARSE_BYTES),
        ..Default::default()
    };
    if policy.take(input).is_none() {
        return Err(crate::storage::Error::Capacity);
    }
    let result = organize_with(model, items, publication, code, &mut policy);
    if policy.capacity {
        Err(crate::storage::Error::Capacity)
    } else {
        Ok(result)
    }
}
fn organize_with(
    model: MidModel,
    items: &[Item],
    publication: &str,
    code: &str,
    policy: &mut BuildPolicy,
) -> Option<Doc> {
    let (date, time) = (&publication[..8], &publication[8..]);
    match model {
        MidModel::Forecast => {
            // Validate every item but materialize only the first, just as get_or_insert_with.
            let mut first = None;
            for item in items {
                let wfsv = item
                    .get("wfSv")
                    .filter(|s| !s.trim_matches(js_ws).is_empty())?;
                if first.is_none() {
                    let mut record = Doc::new();
                    policy.put_text(&mut record, "pubDate", publication)?;
                    policy.put_text(&mut record, "date", date)?;
                    policy.put_text(&mut record, "time", time)?;
                    policy.put_text(&mut record, "pointNumber", code)?;
                    policy.put_number(&mut record, "cnt", 0.)?;
                    policy.put_text(&mut record, "wfsv", wfsv)?;
                    first = Some(record);
                }
            }
            first
        }
        MidModel::Land | MidModel::Temp => {
            if !publication_ok(publication) || items.is_empty() {
                return None;
            }
            let fields = if model == MidModel::Land {
                land_fields()
            } else {
                temp_fields()
            };
            let mut first = None;
            for item in items {
                let reg_id = item
                    .get("regId")
                    .filter(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_alphanumeric()))?;
                let mut r = Doc::new();
                policy.put_text(&mut r, "regId", reg_id)?;
                policy.put_text(&mut r, "date", date)?;
                policy.put_text(&mut r, "time", time)?;
                policy.put_text(&mut r, "pubDate", publication)?;
                let mut usable = 0;
                for key in &fields {
                    let Some(value) = item.get(key) else { continue };
                    if key.starts_with("wf") {
                        if weather(value) {
                            policy.put_text(&mut r, key, value.trim_matches(js_ws))?;
                            usable += 1;
                        }
                    } else {
                        let n = policy_number(value, policy.limit.is_some());
                        let ok = n.is_finite()
                            && if model == MidModel::Temp {
                                n > -50. && n < 60.
                            } else {
                                (0. ..=100.).contains(&n)
                            };
                        if ok {
                            policy.put_number(&mut r, key, n)?;
                            if model == MidModel::Temp {
                                usable += 1;
                            }
                        }
                    }
                }
                if usable == 0 {
                    return None;
                }
                first.get_or_insert(r);
            }
            first
        }
    }
}

/// One region's stored document (`saveOnlyLastOne`).
#[derive(Debug, Clone, Default)]
pub struct MidDoc(Option<Doc>);
impl MidDoc {
    pub(super) fn save_bounded(
        &mut self,
        model: MidModel,
        record: &Doc,
    ) -> Result<(), crate::storage::Error> {
        use super::doc::checked_strict;
        let text = |k| record.get(k).and_then(Val::as_str).unwrap_or("");
        let reg_id = record
            .get("pointNumber")
            .or_else(|| record.get("regId"))
            .unwrap_or(&Val::Null);
        let (Some(publication), Some(fcs)) = (
            korea_date(text("pubDate")),
            korea_date(&(text("date").to_owned() + text("time"))),
        ) else {
            return Ok(());
        };
        let fields = schema(model);
        let names: Vec<&str> = fields.iter().map(String::as_str).collect();
        let data = checked_strict(record, &names)?;
        let mut d = match &self.0 {
            Some(d) => d.checked_clone()?,
            None => Doc::new(),
        };
        if self.0.is_some() {
            d.try_set("data", &data.into())?;
            d.try_set("fcsDate", &Val::Date(fcs))?;
            d.try_set("pubDate", &Val::Date(publication))?;
            d.try_set("regId", reg_id)?;
        } else {
            d.try_set("regId", reg_id)?;
            d.try_set("__v", &Val::Num(0.))?;
            d.try_set("data", &data.into())?;
            d.try_set("fcsDate", &Val::Date(fcs))?;
            d.try_set("pubDate", &Val::Date(publication))?;
        }
        self.0 = Some(d);
        Ok(())
    }
    pub(super) fn into_answer(self) -> Result<Vec<Doc>, crate::storage::Error> {
        let mut out = Vec::new();
        if let Some(d) = self.0 {
            super::forecast_cache::reserve(&mut out, 1)?;
            out.push(d);
        }
        Ok(out)
    }
    /// `checkPubDate`: the stored document already has this publication.
    pub fn has_publication(&self, publication_ms: f64) -> bool {
        self.0
            .as_ref()
            .is_some_and(|d| d.get("pubDate") == Some(&Val::Date(publication_ms)))
    }
    /// `saveMid(type, record, overwrite = true)`.
    pub fn save(&mut self, model: MidModel, record: &Doc) {
        let text = |k| record.get(k).and_then(Val::as_str).unwrap_or("").to_owned();
        let reg_id = match record.get("pointNumber") {
            Some(v) => v.clone(),
            None => record.get("regId").cloned().unwrap_or(Val::Null),
        };
        let (Some(publication), Some(fcs)) = (
            korea_date(&text("pubDate")),
            korea_date(&(text("date") + &text("time"))),
        ) else {
            return;
        };
        let fields = schema(model);
        let names: Vec<&str> = fields.iter().map(String::as_str).collect();
        let data = strict(record, &names);
        match &mut self.0 {
            Some(d) => {
                d.set("data", data.into());
                d.set("fcsDate", Val::Date(fcs));
                d.set("pubDate", Val::Date(publication));
                d.set("regId", reg_id);
            }
            None => {
                self.0 = Some(
                    Doc::new()
                        .with("regId", reg_id)
                        .with("__v", Val::Num(0.))
                        .with("data", data.into())
                        .with("fcsDate", Val::Date(fcs))
                        .with("pubDate", Val::Date(publication)),
                )
            }
        }
    }
    /// `find({regId}).sort({pubDate: -1}).limit(1)`.
    pub fn answer(&self) -> Vec<Doc> {
        self.0.iter().cloned().collect()
    }
}

#[cfg(test)]
mod bounded_tests {
    use super::*;
    #[test]
    fn validated_decimal_numbers_avoid_provider_sized_lowercase_scratch() {
        for text in [
            "0", "+12.5", "-0", " .5 ", "1.", "-50", "60", "0x10", "NaN", "1e2", ".", "",
        ] {
            let old = policy_number(text, false);
            let bounded = policy_number(text, true);
            assert!(
                old == bounded || old.is_nan() && bounded.is_nan(),
                "{text:?}"
            );
            if old == 0. {
                assert_eq!(old.is_sign_negative(), bounded.is_sign_negative());
            }
        }
        let huge = "9".repeat(256 * 1024);
        assert_eq!(policy_number(&huge, true), f64::INFINITY);
        assert_eq!(policy_number(&huge, true), policy_number(&huge, false));
    }
    #[test]
    fn large_forecast_text_and_canonical_expansion_match_compatibility() {
        for text in ["large ".repeat(43000), "\u{10F800}".repeat(65536)] {
            let items = vec![Item(vec![("wfSv".into(), text.clone())])];
            let old = organize(MidModel::Forecast, &items, "202609240600", "109").unwrap();
            let actual = organize_bounded(MidModel::Forecast, &items, "202609240600", "109")
                .unwrap()
                .unwrap();
            assert_eq!(actual, old);
            let stored = actual.get("wfsv").unwrap().as_str().unwrap();
            assert_eq!(
                stored.len(),
                if text.starts_with('\u{10F800}') {
                    text.len() * 2
                } else {
                    text.len()
                }
            );
        }
    }
    #[test]
    fn organizer_scratch_exact_boundary_refuses_large_copy_before_growth() {
        let text = "\u{10F800}".repeat(65536);
        let items = [Item(vec![("wfSv".into(), text)])];
        let mut measured = BuildPolicy {
            limit: Some(super::super::forecast_cache::PARSE_BYTES),
            ..Default::default()
        };
        let expected = organize_with(
            MidModel::Forecast,
            &items,
            "202609240600",
            "109",
            &mut measured,
        )
        .unwrap();
        assert_eq!(measured.copied_texts, 5);
        for extra in [-1isize, 0, 1] {
            let mut policy = BuildPolicy {
                limit: Some(measured.used.checked_add_signed(extra).unwrap()),
                ..Default::default()
            };
            let actual = organize_with(
                MidModel::Forecast,
                &items,
                "202609240600",
                "109",
                &mut policy,
            );
            if extra < 0 {
                assert!(policy.capacity);
                assert!(actual.is_none());
                assert_eq!(
                    policy.copied_texts, 4,
                    "large wfSv must not be copied after failed admission"
                );
            } else {
                assert!(!policy.capacity);
                assert_eq!(actual, Some(expected.clone()));
            }
        }
    }
}
